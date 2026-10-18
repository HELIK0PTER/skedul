/**
 * Planning write cores (spec § 11 E2, E6, E7, E8). Testable: every core takes
 * `(db, ctx, input, now)`, `professionalId` and `actorUserId` come from `ctx`
 * (built from the session by the wrapper), never from input. They import
 * neither server-only, next/*, @/lib/db (index), @/lib/env, @/lib/session nor
 * @/lib/auth. Input is validated with parseFr before the engine is called, so
 * no English zod message reaches the UI; engine failures become French through
 * fromEngine(res, context). Effects are returned for the wrapper to run after
 * commit.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { expiryLabel } from "@/lib/back-office/format";
import { actionFail, fromEngine, type ActionFail, type ActionResult, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { cancelBookingsByPro, cancelOccurrence, restoreOccurrence } from "@/lib/booking/cancel";
import { ruleOf } from "@/lib/booking/occurrences";
import {
  bookingsExpiringBefore,
  editEventInPlace,
  editSeriesFrom,
  previewSeriesEdit,
  updateOccurrence,
  type OccurrencePatch,
} from "@/lib/booking/series";
import { fail } from "@/lib/booking/types";
import { instantAt, type DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { event, occurrence } from "@/lib/db/schema";
import type { ProErrorContext } from "@/lib/pro-messages";
import { expandDates, remainingCount, type RecurrenceRule } from "@/lib/recurrence";
import { describeSeriesEdit } from "@/lib/series-plan";
import { BOUNDS, dateKeySchema, idSchema, type OccurrenceStatus, type RecurrenceRuleInput } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export const TIME_PARTS_REQUIRED = "Indiquez la date et l'heure.";
export const FOLLOWING_DETACHED = "Cette séance ne fait plus partie de la série : modifiez-la seule.";
export const FOLLOWING_TIME_DETACHED =
  "Cette séance a été modifiée seule : elle ne suit plus l'horaire de la série. Modifiez-la avec « Cette séance », ou appliquez le changement à partir de la séance suivante.";

/** The engine's own texts for the refusals updateOccurrence makes while it plans (src/lib/booking/series.ts). */
const RDV_NOT_MOVABLE = "Un rendez-vous se déplace en l'annulant puis en le réservant à nouveau.";
const SEANCE_STARTED = "Une séance concernée a déjà commencé.";
const NEW_START_PAST = "La nouvelle date serait déjà passée.";

const startMinuteSchema = z.number().int().min(BOUNDS.startMinute.min).max(BOUNDS.startMinute.max);
const durationSchema = z
  .number()
  .int()
  .min(BOUNDS.eventDurationMin.min)
  .max(BOUNDS.eventDurationMin.max)
  .multipleOf(BOUNDS.eventDurationMin.step);

function notFound(context: ProErrorContext): ActionFail {
  return fromEngine(fail("not_found"), context);
}

type OccurrenceHead = {
  eventId: string | null;
  seriesDate: DateKey | null;
  status: OccurrenceStatus;
  startsAt: Date;
  timeDetached: boolean;
};

/** The pro's occurrence (null for an unknown id or another pro's). */
async function readOccurrenceOf(db: Db, professionalId: string, occurrenceId: string): Promise<OccurrenceHead | null> {
  const [row] = await db
    .select({
      eventId: occurrence.eventId,
      seriesDate: occurrence.seriesDate,
      status: occurrence.status,
      startsAt: occurrence.startsAt,
      timeDetached: occurrence.timeDetached,
    })
    .from(occurrence)
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId)));
  return row ?? null;
}

/* ───────────────────────── « Cette séance » ───────────────────────── */

export const occurrenceEditSchema = z.object({
  occurrenceId: idSchema,
  seenStartsAt: z.iso.datetime(),
  date: dateKeySchema.optional(),
  startMinute: startMinuteSchema.optional(),
  durationMin: durationSchema.optional(),
  locationOverride: z.string().trim().max(BOUNDS.location).nullable().optional(),
  unenrollBookingIds: z.array(idSchema).max(BOUNDS.capacity.max).default([]),
});
export type OccurrenceEditInput = z.input<typeof occurrenceEditSchema>;

/**
 * « Cette séance »: date + startMinute (both or neither, else TIME_PARTS_REQUIRED)
 * become instantAt(date, minute, ctx.timezone) on the server, never in the
 * browser; updateOccurrence with seenStartsAt = the instant the form was
 * rendered with. Context "occurrence".
 */
export async function updateOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: OccurrenceEditInput,
  now: Date,
): Promise<CoreResult<{ timeChanged: boolean }>> {
  const parsed = parseFr(occurrenceEditSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  if ((p.date === undefined) !== (p.startMinute === undefined)) return actionFail(TIME_PARTS_REQUIRED);

  const patch: OccurrencePatch = {};
  if (p.date !== undefined && p.startMinute !== undefined) patch.startsAt = instantAt(p.date, p.startMinute, ctx.timezone);
  if (p.durationMin !== undefined) patch.durationMin = p.durationMin;
  if (p.locationOverride !== undefined) patch.locationOverride = p.locationOverride;

  const res = await updateOccurrence(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      occurrenceId: p.occurrenceId,
      seenStartsAt: new Date(p.seenStartsAt),
      patch,
      unenrollBookingIds: p.unenrollBookingIds,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "occurrence");
  return { ok: true, effects: res.effects, timeChanged: res.timeChanged };
}

const expiringSchema = z.object({ occurrenceId: idSchema, date: dateKeySchema, startMinute: startMinuteSchema });

/**
 * What updateOccurrence would refuse for a start moved to `newStartsAt`, with its
 * own texts and codes, in its order (an RDV, a séance no longer scheduled, a séance
 * that has started, a new start already behind). The warning below is shown before
 * the save, so it must not list consequences of a move the save then refuses. The
 * engine's seenStartsAt guard needs the instant the form was rendered with, which
 * the warning does not receive, and a start that does not move is never a time
 * change here (the duration is not part of the warning).
 */
function moveRefusal(occ: OccurrenceHead, newStartsAt: Date, now: Date): ActionFail | null {
  if (occ.eventId === null) return fromEngine(fail("invalid", RDV_NOT_MOVABLE), "occurrence");
  if (occ.status !== "scheduled") return fromEngine(fail("changed"), "occurrence");
  if (newStartsAt.getTime() === occ.startsAt.getTime()) return null;
  if (occ.startsAt.getTime() <= now.getTime()) return fromEngine(fail("invalid", SEANCE_STARTED), "occurrence");
  if (newStartsAt.getTime() <= now.getTime()) return fromEngine(fail("invalid", NEW_START_PAST), "occurrence");
  return null;
}

/**
 * Preview of « Déplacement au-delà de la validité »: the confirmed ticket
 * bookings whose ticket ends at or before instantAt(date, minute, tz). The
 * occurrence is checked against the pro first, so a foreign id is « Séance
 * introuvable. » and never an empty list; a move updateOccurrenceCore would
 * refuse (moveRefusal) is refused here with the same failure.
 */
export async function expiringBeforeCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; date: DateKey; startMinute: number },
  now: Date,
): Promise<ActionResult<{ bookings: { bookingId: string; customerName: string; expiryText: string }[] }>> {
  const parsed = parseFr(expiringSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const occ = await readOccurrenceOf(db, ctx.professionalId, p.occurrenceId);
  if (!occ) return notFound("occurrence");
  const newStartsAt = instantAt(p.date, p.startMinute, ctx.timezone);
  const refusal = moveRefusal(occ, newStartsAt, now);
  if (refusal !== null) return refusal;
  const rows = await bookingsExpiringBefore(db, {
    professionalId: ctx.professionalId,
    occurrenceId: p.occurrenceId,
    newStartsAt,
  });
  return {
    ok: true,
    bookings: rows.map((r) => ({
      bookingId: r.bookingId,
      customerName: r.customerName,
      expiryText: expiryLabel(r.expiresAt, ctx.timezone, now),
    })),
  };
}

/* ───────────────────────── Capacity (Q19) ───────────────────────── */

const capacitySchema = z.object({
  occurrenceId: idSchema,
  seenStartsAt: z.iso.datetime(),
  scope: z.enum(["occurrence", "event"]),
  capacity: z.number().int().min(BOUNDS.capacity.min).max(BOUNDS.capacity.max),
  seenVersion: z.number().int().min(1).nullable(),
});

/**
 * Q19: scope "occurrence" = updateOccurrence({ capacity }) (the séance gets
 * capacity_override); scope "event" = editEventInPlace({ capacity }) on the
 * séance's event with the version the page was rendered with: it reaches the
 * future scheduled séances WITHOUT a capacity_override, the overridden ones keep
 * theirs. Neither ever goes below the seats already taken. Context "occurrence"
 * / "event".
 */
export async function updateCapacityCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; seenStartsAt: string; scope: "occurrence" | "event"; capacity: number; seenVersion: number | null },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(capacitySchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;

  if (p.scope === "occurrence") {
    const res = await updateOccurrence(
      db,
      {
        professionalId: ctx.professionalId,
        actorUserId: ctx.actorUserId,
        occurrenceId: p.occurrenceId,
        seenStartsAt: new Date(p.seenStartsAt),
        patch: { capacity: p.capacity },
      },
      now,
    );
    if (!res.ok) return fromEngine(res, "occurrence");
    return { ok: true, effects: res.effects };
  }

  const occ = await readOccurrenceOf(db, ctx.professionalId, p.occurrenceId);
  if (!occ || occ.eventId === null) return notFound("occurrence");
  if (p.seenVersion === null) return fromEngine(fail("stale"), "event");
  const res = await editEventInPlace(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      eventId: occ.eventId,
      seenVersion: p.seenVersion,
      patch: { capacity: p.capacity },
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "event");
  return { ok: true, effects: res.effects };
}

/* ───────────────────────── Cancel, restore, unenroll ───────────────────────── */

const occurrenceIdSchema = z.object({ occurrenceId: idSchema });

/** E6b: the séance (or the RDV) is cancelled, its bookings are ended and the tickets return. Context "cancel". */
export async function cancelOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string },
  now: Date,
): Promise<CoreResult<{ bookingsCancelled: number; ticketsReturned: number }>> {
  const parsed = parseFr(occurrenceIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await cancelOccurrence(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, occurrenceId: parsed.data.occurrenceId },
    now,
  );
  if (!res.ok) return fromEngine(res, "cancel");
  return { ok: true, effects: res.effects, bookingsCancelled: res.bookingsCancelled, ticketsReturned: res.ticketsReturned };
}

/** « Rétablir »: a future event séance becomes scheduled again, empty. Context "restore". */
export async function restoreOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(occurrenceIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await restoreOccurrence(db, { professionalId: ctx.professionalId, occurrenceId: parsed.data.occurrenceId }, now);
  if (!res.ok) return fromEngine(res, "restore");
  return { ok: true, effects: res.effects };
}

const unenrollSchema = z.object({
  occurrenceId: idSchema,
  bookingIds: z.array(idSchema).min(1).max(BOUNDS.capacity.max),
  reason: z.string().trim().max(BOUNDS.note).nullable(),
});

/** E6a « Désinscrire » one or several bookings of one occurrence, any time (past séances too). Context "unenroll". */
export async function unenrollCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; bookingIds: string[]; reason: string | null },
  now: Date,
): Promise<CoreResult<{ cancelled: number; ticketsReturned: number }>> {
  const parsed = parseFr(unenrollSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await cancelBookingsByPro(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      occurrenceId: parsed.data.occurrenceId,
      bookingIds: parsed.data.bookingIds,
      reason: parsed.data.reason,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "unenroll");
  return { ok: true, effects: res.effects, cancelled: res.cancelled, ticketsReturned: res.ticketsReturned };
}

/* ───────────────────── « Cette séance et les suivantes » (time only) ───────────────────── */

/**
 * The rule of Q8 « Cette séance et les suivantes » from the dialog: the
 * event's own rule with startDate = this séance's series_date and the new
 * start minute; count mode keeps the dates left from here
 * (remainingCount(old, seriesDate)). It only makes sense for a séance that sits
 * on a date of the old rule: any other (past the last counted or until date,
 * off the weekday pattern or the interval, a month without that day) was kept
 * apart or brought back by « Rétablir », and the new rule starting there would
 * reshape the series around it (the planner would delete or cancel it). So when
 * expandDates(old, seriesDate, seriesDate) is empty the séance is refused with
 * FOLLOWING_DETACHED. That one check also covers the monthly « jour du mois »
 * rule whose series_date has another day than the rule's (such a rule only
 * produces dates on its own day), which is why there is no separate guard.
 */
export function followingRuleOf(
  old: RecurrenceRule,
  seriesDate: DateKey,
  startMinute: number,
): { ok: true; rule: RecurrenceRuleInput } | { ok: false; error: string } {
  if (expandDates(old, seriesDate, seriesDate).length === 0) return { ok: false, error: FOLLOWING_DETACHED };
  // A counted date of the rule: at least this one is left.
  const occurrenceCount = old.endMode === "count" ? remainingCount(old, seriesDate) : old.occurrenceCount;
  return {
    ok: true,
    rule: {
      startDate: seriesDate,
      startMinute,
      freq: old.freq,
      interval: old.interval,
      weekdays: old.weekdays,
      monthlyBy: old.monthlyBy,
      monthWeek: old.monthWeek,
      endMode: old.endMode,
      untilDate: old.untilDate,
      occurrenceCount,
    },
  };
}

type FollowingTarget = { ok: true; eventId: string; fromDate: DateKey; rule: RecurrenceRuleInput };

/**
 * The event segment owning this séance (the pro's, not archived) and the rule to apply from the séance's date.
 * A séance whose time was changed alone (time_detached) is refused: the planner keeps such a row where it is
 * (reparentOnly), so the preview would count it among the séances to change while the apply leaves it behind.
 */
async function followingTarget(
  db: Db,
  ctx: ProCtx,
  occurrenceId: string,
  startMinute: number,
): Promise<FollowingTarget | ActionFail> {
  const occ = await readOccurrenceOf(db, ctx.professionalId, occurrenceId);
  if (!occ || occ.eventId === null || occ.seriesDate === null) return notFound("series");
  const [ev] = await db
    .select()
    .from(event)
    .where(and(eq(event.id, occ.eventId), eq(event.professionalId, ctx.professionalId)));
  if (!ev || ev.archivedAt !== null) return notFound("series");
  if (occ.timeDetached) return actionFail(FOLLOWING_TIME_DETACHED);
  const built = followingRuleOf(ruleOf(ev), occ.seriesDate, startMinute);
  if (!built.ok) return actionFail(built.error);
  return { ok: true, eventId: ev.id, fromDate: occ.seriesDate, rule: built.rule };
}

const previewFollowingSchema = z.object({ occurrenceId: idSchema, startMinute: startMinuteSchema, durationMin: durationSchema });
const applyFollowingSchema = previewFollowingSchema.extend({ seenVersion: z.number().int().min(1) });

/**
 * The preview of the same edit as applyFollowingCore, no write: « 12 séances modifiées, 3 inscrits prévenus ».
 * previewSeriesEdit runs the very reads and plan of editSeriesFrom, so the refusals are the same (a started
 * séance, a cut before today, a new time already behind, a later segment); only the version guard is the
 * action's own. Context "series".
 */
export async function previewFollowingCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; startMinute: number; durationMin: number },
  now: Date,
): Promise<ActionResult<{ text: string; fromDate: DateKey }>> {
  const parsed = parseFr(previewFollowingSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const target = await followingTarget(db, ctx, p.occurrenceId, p.startMinute);
  if (!target.ok) return target;
  const res = await previewSeriesEdit(
    db,
    {
      professionalId: ctx.professionalId,
      eventId: target.eventId,
      fromDate: target.fromDate,
      rule: target.rule,
      durationMin: p.durationMin,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, text: describeSeriesEdit(res.summary, "keep"), fromDate: target.fromDate };
}

/** editSeriesFrom from this séance's date, orphans kept (a time change never removes a date). eventId = the segment after a split. Context "series". */
export async function applyFollowingCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; seenVersion: number; startMinute: number; durationMin: number },
  now: Date,
): Promise<CoreResult<{ eventId: string; summaryText: string }>> {
  const parsed = parseFr(applyFollowingSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const target = await followingTarget(db, ctx, p.occurrenceId, p.startMinute);
  if (!target.ok) return target;
  const res = await editSeriesFrom(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      eventId: target.eventId,
      seenVersion: p.seenVersion,
      fromDate: target.fromDate,
      rule: target.rule,
      durationMin: p.durationMin,
      orphans: "keep",
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, effects: res.effects, eventId: res.eventId, summaryText: describeSeriesEdit(res.summary, "keep") };
}

/* ───────────────────────── Attendees: register and move ───────────────────────── */
