/**
 * Time off cores (spec § 7, E6c): the preview of the séances and RDVs a time off
 * would collide with, the creation with the pro's choice for the booked ones, and
 * the deletion. No server-only, no next/*: the "use server" wrappers live in
 * src/server/pro-planning.ts. `professionalId` and `actorUserId` come from `ctx`
 * only; the input is validated with parseFr (French messages) before the engine.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { formatWhen } from "@/lib/back-office/format";
import { actionFail, fromEngine, type ActionFail, type ActionResult, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { createTimeOffWithConflicts, previewTimeOffConflicts } from "@/lib/booking/cancel";
import { diffDays } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { occurrence, timeOff } from "@/lib/db/schema";
import { dateKeySchema, idSchema } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";
import { buildTimeOffInterval } from "@/lib/timeoff";
import { parseFr } from "@/lib/zod-fr";

export const timeOffFormSchema = z.object({
  startDate: dateKeySchema,
  endDate: dateKeySchema,
  allDay: z.boolean(),
  startMinute: z.number().int().min(0).max(1439).optional(),
  // 0 is accepted here: « Fin 00:00 » on a timed range means the end of that day (see intervalOf).
  endMinute: z.number().int().min(0).max(1440).optional(),
  reason: z.string().trim().max(BOUNDS.note).optional(),
});
export type TimeOffForm = z.input<typeof timeOffFormSchema>;

/** The most conflicts a creation accepts as « seen ». The preview refuses beyond it, so it never offers a list the creation would refuse. */
const MAX_SEEN = 500;

const createSchema = timeOffFormSchema.extend({
  seenOccurrenceIds: z.array(idSchema).max(MAX_SEEN),
  cancelBooked: z.boolean(),
});

export type TimeOffConflictVM = {
  occurrenceId: string;
  kind: "seance" | "rdv";
  title: string;
  whenLabel: string;
  activeBookings: number;
};

export const TIME_OFF_TOO_LONG = "Une indisponibilité dure au plus un an.";
export const TIME_OFF_TOO_MANY = `Cette période chevauche plus de ${MAX_SEEN} séances avec des inscrits : choisissez une période plus courte.`;
export const TIME_OFF_NOT_FOUND = "Indisponibilité introuvable.";
/** A calendar year plus the leap day. */
const MAX_DAYS = 366;

type Interval = { startAt: Date; endAt: Date };

/**
 * A timed range typed « 17:00 to 00:00 » runs until the midnight that ends its day: an end of 0 after a start
 * later than 0 reads as 1440. A start of 0 with an end of 0 stays 0 and is refused like any end before its start.
 */
function midnightEnd(form: z.output<typeof timeOffFormSchema>): z.output<typeof timeOffFormSchema> {
  return !form.allDay && form.endMinute === 0 && (form.startMinute ?? 0) > 0 ? { ...form, endMinute: 1440 } : form;
}

/** The pro-tz instants of a parsed form, or the French reason they cannot be built. */
function intervalOf(
  form: z.output<typeof timeOffFormSchema>,
  tz: string,
): { ok: true; interval: Interval } | ActionFail {
  let interval: Interval;
  try {
    interval = buildTimeOffInterval(midnightEnd(form), tz);
  } catch (e) {
    return actionFail(e instanceof Error ? e.message : "Entrée invalide.");
  }
  if (form.allDay && diffDays(form.startDate, form.endDate) + 1 > MAX_DAYS) return actionFail(TIME_OFF_TOO_LONG);
  return { ok: true, interval };
}

/**
 * previewTimeOffConflicts (the engine's own list and booking count, so the preview and the creation guard see the same set)
 * plus the kind (séance or RDV, read from occurrence.event_id) and the French « when » label.
 */
async function conflictsOf(db: Db, ctx: ProCtx, interval: Interval, now: Date): Promise<TimeOffConflictVM[]> {
  const conflicts = await previewTimeOffConflicts(
    db,
    { professionalId: ctx.professionalId, startAt: interval.startAt, endAt: interval.endAt },
    now,
  );
  if (conflicts.length === 0) return [];
  const rows = await db
    .select({ id: occurrence.id, eventId: occurrence.eventId })
    .from(occurrence)
    .where(
      and(
        eq(occurrence.professionalId, ctx.professionalId),
        inArray(
          occurrence.id,
          conflicts.map((c) => c.occurrenceId),
        ),
      ),
    );
  const kindOf = new Map(rows.map((r) => [r.id, r.eventId === null ? "rdv" : "seance"] as const));
  // The engine answers by id (its lock order); the pro reads the list by date.
  const byDate = [...conflicts].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.occurrenceId < b.occurrenceId ? -1 : 1),
  );
  return byDate.map((c) => ({
    occurrenceId: c.occurrenceId,
    kind: kindOf.get(c.occurrenceId) ?? "seance",
    title: c.title,
    whenLabel: formatWhen(c.startsAt, c.endsAt, ctx.timezone),
    activeBookings: c.activeBookings,
  }));
}

/** E6c step 1: the séances and RDVs with registrants that this time off would overlap. */
export async function previewTimeOffCore(
  db: Db,
  ctx: ProCtx,
  input: TimeOffForm,
  now: Date,
): Promise<ActionResult<{ conflicts: TimeOffConflictVM[] }>> {
  const parsed = parseFr(timeOffFormSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const built = intervalOf(parsed.data, ctx.timezone);
  if (!built.ok) return built;
  const conflicts = await conflictsOf(db, ctx, built.interval, now);
  if (conflicts.length > MAX_SEEN) return actionFail(TIME_OFF_TOO_MANY);
  return { ok: true, conflicts };
}

/**
 * E6c step 2: creates the time off. `seenOccurrenceIds` is the list the pro looked at;
 * if a registration appeared or vanished since, the engine answers `stale` and the UI
 * previews again. `cancelBooked` cancels those séances (tickets given back).
 */
export async function createTimeOffCore(
  db: Db,
  ctx: ProCtx,
  input: TimeOffForm & { seenOccurrenceIds: string[]; cancelBooked: boolean },
  now: Date,
): Promise<CoreResult<{ cancelledOccurrences: number }>> {
  const parsed = parseFr(createSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const built = intervalOf(parsed.data, ctx.timezone);
  if (!built.ok) return built;
  const res = await createTimeOffWithConflicts(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      startAt: built.interval.startAt,
      endAt: built.interval.endAt,
      allDay: parsed.data.allDay,
      reason: parsed.data.reason ?? null,
      seenOccurrenceIds: parsed.data.seenOccurrenceIds,
      cancelBooked: parsed.data.cancelBooked,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "timeOff");
  return { ok: true, effects: res.effects, cancelledOccurrences: res.cancelledOccurrences };
}

/** One statement, DELETE … WHERE id AND professional_id (ruling C4): another pro's id deletes nothing. */
export async function deleteTimeOffCore(
  db: Db,
  ctx: ProCtx,
  input: { timeOffId: string },
  now: Date,
): Promise<CoreResult> {
  void now;
  const parsed = parseFr(z.object({ timeOffId: idSchema }), input);
  if (!parsed.ok) return actionFail(parsed.error);
  const deleted = await db
    .delete(timeOff)
    .where(and(eq(timeOff.id, parsed.data.timeOffId), eq(timeOff.professionalId, ctx.professionalId)))
    .returning({ id: timeOff.id });
  if (deleted.length === 0) return actionFail(TIME_OFF_NOT_FOUND, "not_found");
  return { ok: true, effects: [] };
}
