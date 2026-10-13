/**
 * E7 (spec § 11): « cette séance », the event editor (in place), « cette
 * séance et les suivantes » and « supprimer à partir du ». One tryAtomic
 * batch per action; series edits are version-guarded and re-plan once on stale.
 */
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  G,
  PlanError,
  RET,
  SEAT,
  lockRows,
  textArray,
  ts,
  tryAtomic,
  type ActorRef,
  type BatchCtx,
  type Db,
  type Query,
} from "@/lib/db/atomic";
import { booking, customer, event, occurrence, question, ticket } from "@/lib/db/schema";
import {
  BOOKING_MODES,
  BOUNDS,
  hexColorSchema,
  idSchema,
  questionInputSchema,
  windowOverridesSchema,
  type BookingMode,
  type QuestionInput,
  type WindowOverrides,
} from "@/lib/tickets";

import { endBookings, expireSessionEffects, readEndedByAction } from "./cancel";
import { fail, failOf, syncEffects, type Effect, type EngineResult } from "./types";

/* ───────────────────────── Shared helpers ───────────────────────── */

const durationOk = (min: number) =>
  Number.isInteger(min) &&
  min >= BOUNDS.eventDurationMin.min &&
  min <= BOUNDS.eventDurationMin.max &&
  min % BOUNDS.eventDurationMin.step === 0;

/** Active (pending + confirmed) bookings of these occurrences, grouped by occurrence. */
async function activeBookingsByOccurrence(db: Db, occurrenceIds: readonly string[]): Promise<Map<string, string[]>> {
  const byOcc = new Map<string, string[]>();
  if (occurrenceIds.length === 0) return byOcc;
  const rows = await db
    .select({ id: booking.id, occurrenceId: booking.occurrenceId })
    .from(booking)
    .where(and(inArray(booking.occurrenceId, [...occurrenceIds]), inArray(booking.status, ["pending", "confirmed"])))
    .orderBy(booking.id);
  for (const r of rows) byOcc.set(r.occurrenceId, [...(byOcc.get(r.occurrenceId) ?? []), r.id]);
  return byOcc;
}

/** Questions as rows to insert (choice keeps its options; other types store none). */
function questionValues(q: z.infer<typeof questionInputSchema>) {
  return { label: q.label, type: q.type, options: q.type === "choice" ? q.options : null, required: q.required };
}

/* ───────────────────────── « Cette séance » ───────────────────────── */

export type OccurrencePatch = { startsAt?: Date; durationMin?: number; capacity?: number; locationOverride?: string | null };

/**
 * « Cette séance » (event séances only; an RDV is moved by cancel + rebook).
 * Batch: lock; G(scheduled ∧ event séance ∧ starts_at = seen, 'changed');
 * optional E6a on unenrollBookingIds (end, G, SEAT(o, 0)); UPDATE occurrence
 * (time_detached + changed_at when date/time/duration change; capacity =
 * GREATEST(cap, seats_taken) + capacity_override; location_override); G(the
 * row has the planned times, 'changed'); RET(pro) when bookings ended.
 */
export async function updateOccurrence(
  db: Db,
  input: {
    professionalId: string;
    actorUserId: string;
    occurrenceId: string;
    seenStartsAt: Date;
    patch: OccurrencePatch;
    unenrollBookingIds?: string[];
  },
  now: Date = new Date(),
): Promise<EngineResult<{ timeChanged: boolean }>> {
  const { patch } = input;
  const unenroll = [...new Set(input.unenrollBookingIds ?? [])];
  if (patch.durationMin !== undefined && !durationOk(patch.durationMin)) return fail("invalid", "Durée invalide.");
  if (
    patch.capacity !== undefined &&
    (!Number.isInteger(patch.capacity) || patch.capacity < BOUNDS.capacity.min || patch.capacity > BOUNDS.capacity.max)
  ) {
    return fail("invalid", "Capacité invalide.");
  }
  if (patch.startsAt !== undefined && Number.isNaN(patch.startsAt.getTime())) return fail("invalid");
  const location = patch.locationOverride === undefined ? undefined : patch.locationOverride?.trim() || null;
  if (location && location.length > BOUNDS.location) return fail("invalid", "Lieu trop long.");
  const hasPatch =
    patch.startsAt !== undefined || patch.durationMin !== undefined || patch.capacity !== undefined || location !== undefined;
  if (!hasPatch && unenroll.length === 0) return fail("invalid", "Rien à modifier.");

  const outcome = { timeChanged: false, locationChanged: false };
  const res = await tryAtomic(db, async () => {
    const [o] = await db
      .select({
        id: occurrence.id,
        eventId: occurrence.eventId,
        status: occurrence.status,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        locationOverride: occurrence.locationOverride,
        eventLocation: event.location,
      })
      .from(occurrence)
      .leftJoin(event, eq(event.id, occurrence.eventId))
      .where(and(eq(occurrence.id, input.occurrenceId), eq(occurrence.professionalId, input.professionalId)));
    if (!o) throw new PlanError("not_found");
    if (o.eventId === null) {
      throw new PlanError("invalid", "Un rendez-vous se déplace en l'annulant puis en le réservant à nouveau.");
    }
    if (o.status !== "scheduled" || o.startsAt.getTime() !== input.seenStartsAt.getTime()) throw new PlanError("changed");
    if (unenroll.length > 0) {
      const found = await db
        .select({ id: booking.id, status: booking.status })
        .from(booking)
        .where(and(inArray(booking.id, unenroll), eq(booking.occurrenceId, o.id)));
      if (found.length !== unenroll.length) throw new PlanError("invalid");
      if (found.some((b) => b.status !== "pending" && b.status !== "confirmed")) throw new PlanError("changed");
    }

    const newStarts = patch.startsAt ?? o.startsAt;
    const durationMs = patch.durationMin !== undefined ? patch.durationMin * 60_000 : o.endsAt.getTime() - o.startsAt.getTime();
    const newEnds = new Date(newStarts.getTime() + durationMs);
    const timeChanged = newStarts.getTime() !== o.startsAt.getTime() || newEnds.getTime() !== o.endsAt.getTime();
    outcome.timeChanged = timeChanged;
    const oldPlace = o.locationOverride ?? o.eventLocation;
    const newPlace = (location === undefined ? o.locationOverride : location) ?? o.eventLocation;
    outcome.locationChanged = oldPlace !== newPlace;

    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const by: ActorRef = { actor: "pro", userId: input.actorUserId };
      const sets: SQL[] = [sql`updated_at = ${ts(now)}`];
      if (timeChanged) {
        sets.push(
          sql`starts_at = ${ts(newStarts)}`,
          sql`ends_at = ${ts(newEnds)}`,
          sql`block_start = ${ts(newStarts)}`,
          sql`block_end = ${ts(newEnds)}`,
          sql`time_detached = true`,
          sql`changed_at = ${ts(now)}`,
        );
      }
      if (patch.capacity !== undefined) {
        sets.push(sql`capacity = greatest(${patch.capacity}::int, seats_taken)`, sql`capacity_override = true`);
      }
      if (location !== undefined) sets.push(sql`location_override = ${location}`);

      const queries: Query[] = [
        lockRows(db, "occurrence", [o.id]),
        G(
          db,
          sql`exists (select 1 from occurrence where id = ${o.id} and professional_id = ${input.professionalId}
            and status = 'scheduled' and event_id is not null and starts_at = ${ts(input.seenStartsAt)})`,
          "changed",
        ),
      ];
      if (unenroll.length > 0) {
        queries.push(
          endBookings(c, { professionalId: input.professionalId, scope: { occurrenceId: o.id, bookingIds: unenroll }, by }),
          G(
            db,
            sql`(select count(*)::int from booking where ended_action_id = ${aid} and id = any(${textArray(unenroll)})) = ${unenroll.length}::int`,
            "changed",
          ),
          SEAT(c, o.id, 0),
        );
      }
      queries.push(
        db.execute(sql`update occurrence set ${sql.join(sets, sql`, `)}
          where id = ${o.id} and status = 'scheduled' and event_id is not null`),
        G(
          db,
          sql`exists (select 1 from occurrence where id = ${o.id} and status = 'scheduled'
            and starts_at = ${ts(newStarts)} and ends_at = ${ts(newEnds)})`,
          "changed",
        ),
      );
      if (unenroll.length > 0) queries.push(RET(c, by));
      return queries;
    };
  });
  if (!res.ok) return failOf(res);

  const effects: Effect[] = [];
  if (unenroll.length > 0) {
    const ended = await readEndedByAction(db, res.aid);
    for (const b of ended) effects.push({ type: "email.booking_cancelled", bookingId: b.bookingId, by: "pro" });
    effects.push(...expireSessionEffects(ended));
  }
  if (outcome.timeChanged || outcome.locationChanged) {
    const bookingIds = (await activeBookingsByOccurrence(db, [input.occurrenceId])).get(input.occurrenceId) ?? [];
    if (bookingIds.length > 0) effects.push({ type: "email.occurrence_changed", occurrenceId: input.occurrenceId, bookingIds });
  }
  effects.push(...syncEffects([input.occurrenceId]));
  return { ok: true, effects, timeChanged: outcome.timeChanged };
}

/** Move preview: confirmed ticket bookings whose ticket is no longer valid at newStartsAt (expires_at ≤ newStartsAt). */
export async function bookingsExpiringBefore(
  db: Db,
  input: { professionalId: string; occurrenceId: string; newStartsAt: Date },
): Promise<{ bookingId: string; customerName: string; expiresAt: Date }[]> {
  const rows = await db
    .select({ bookingId: booking.id, customerName: customer.name, expiresAt: ticket.expiresAt })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .innerJoin(ticket, eq(ticket.bookingId, booking.id))
    .where(
      and(
        eq(booking.occurrenceId, input.occurrenceId),
        eq(booking.professionalId, input.professionalId),
        eq(booking.status, "confirmed"),
        sql`${ticket.expiresAt} is not null and ${ticket.expiresAt} <= ${ts(input.newStartsAt)}`,
      ),
    )
    .orderBy(asc(customer.name), asc(booking.id));
  return rows.flatMap((r) => (r.expiresAt ? [{ bookingId: r.bookingId, customerName: r.customerName, expiresAt: r.expiresAt }] : []));
}

/* ───────────────────────── Event editor (in place) ───────────────────────── */

export type EventInPlacePatch = {
  title?: string;
  description?: string | null;
  location?: string | null;
  color?: string;
  isPrivate?: boolean;
  bookingMode?: BookingMode;
  ticketTypeIds?: string[];
  questions?: QuestionInput[];
  overrides?: WindowOverrides;
  capacity?: number;
};

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const inPlaceSchema = z.object({
  title: z.string().trim().min(1).max(BOUNDS.title).optional(),
  description: nullableText(BOUNDS.description).optional(),
  location: nullableText(BOUNDS.location).optional(),
  color: hexColorSchema.optional(),
  isPrivate: z.boolean().optional(),
  bookingMode: z.enum(BOOKING_MODES).optional(),
  ticketTypeIds: z.array(idSchema).max(50).optional(),
  questions: z.array(questionInputSchema).max(BOUNDS.questions).optional(),
  overrides: windowOverridesSchema.optional(),
  capacity: z.number().int().min(BOUNDS.capacity.min).max(BOUNDS.capacity.max).optional(),
});

/**
 * Event editor, in place on ONE segment: UPDATE event … version + 1,
 * last_action_id = aid WHERE id AND version = seen; G(last_action_id = aid,
 * 'stale'); links, questions and capacity propagation (future scheduled
 * séances without capacity_override: GREATEST(cap, seats_taken)) in the same batch.
 */
export async function editEventInPlace(
  db: Db,
  input: { professionalId: string; actorUserId: string; eventId: string; seenVersion: number; patch: EventInPlacePatch },
  now: Date = new Date(),
): Promise<EngineResult<{ version: number }>> {
  const parsed = inPlaceSchema.safeParse(input.patch);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const p = parsed.data;
  const typeIds = p.ticketTypeIds === undefined ? undefined : [...new Set(p.ticketTypeIds)];

  const outcome = { locationChanged: false, describedChanged: false };
  const res = await tryAtomic(db, async () => {
    const [ev] = await db
      .select({ id: event.id, location: event.location, title: event.title, description: event.description, archivedAt: event.archivedAt })
      .from(event)
      .where(and(eq(event.id, input.eventId), eq(event.professionalId, input.professionalId)));
    if (!ev || ev.archivedAt) throw new PlanError("not_found");
    outcome.locationChanged = p.location !== undefined && p.location !== ev.location;
    outcome.describedChanged =
      outcome.locationChanged ||
      (p.title !== undefined && p.title !== ev.title) ||
      (p.description !== undefined && p.description !== ev.description);

    const existing = p.questions
      ? await db.select({ id: question.id }).from(question).where(eq(question.eventId, ev.id))
      : [];
    const existingIds = new Set(existing.map((q) => q.id));
    const questions = (p.questions ?? []).map((q, position) => {
      if (q.id !== undefined && !existingIds.has(q.id)) throw new PlanError("invalid", "Question inconnue.");
      return { ...q, position, newId: q.id ?? nanoid() };
    });
    const keptIds = questions.filter((q) => q.id !== undefined).map((q) => q.newId);

    return (aid) => {
      const sets: SQL[] = [
        sql`version = version + 1`,
        sql`last_action_id = ${aid}`,
        sql`updated_at = ${ts(now)}`,
      ];
      if (p.title !== undefined) sets.push(sql`title = ${p.title}`);
      if (p.description !== undefined) sets.push(sql`description = ${p.description}`);
      if (p.location !== undefined) sets.push(sql`location = ${p.location}`);
      if (p.color !== undefined) sets.push(sql`color = ${p.color}`);
      if (p.isPrivate !== undefined) sets.push(sql`is_private = ${p.isPrivate}`);
      if (p.bookingMode !== undefined) sets.push(sql`booking_mode = ${p.bookingMode}::booking_mode`);
      if (p.capacity !== undefined) sets.push(sql`capacity = ${p.capacity}::int`);
      if (p.overrides !== undefined) {
        sets.push(
          sql`booking_horizon_days = ${p.overrides.bookingHorizonDays}::int`,
          sql`min_notice_minutes = ${p.overrides.minNoticeMinutes}::int`,
          sql`cancel_deadline_hours = ${p.overrides.cancelDeadlineHours}::int`,
        );
      }
      const queries: Query[] = [
        db.execute(sql`update event set ${sql.join(sets, sql`, `)}
          where id = ${ev.id} and professional_id = ${input.professionalId} and version = ${input.seenVersion}::int
            and archived_at is null`),
        G(db, sql`(select last_action_id from event where id = ${ev.id}) = ${aid}`, "stale"),
      ];
      if (typeIds !== undefined) {
        queries.push(db.execute(sql`delete from event_ticket_type where event_id = ${ev.id}`));
        if (typeIds.length > 0) {
          queries.push(
            db.execute(sql`
              insert into event_ticket_type (event_id, ticket_type_id, professional_id, created_at)
              select ${ev.id}, id, ${input.professionalId}, ${ts(now)} from ticket_type
              where id = any(${textArray(typeIds)}) and professional_id = ${input.professionalId}`),
          );
        }
        queries.push(
          G(db, sql`(select count(*)::int from event_ticket_type where event_id = ${ev.id}) = ${typeIds.length}::int`, "invalid"),
        );
      }
      if (p.questions !== undefined) {
        queries.push(
          db.execute(sql`delete from question where event_id = ${ev.id} and not (id = any(${textArray(keptIds)}))`),
        );
        for (const q of questions.filter((x) => x.id !== undefined)) {
          const v = questionValues(q);
          queries.push(
            db.execute(sql`
              update question set label = ${v.label}, type = ${v.type}::question_type,
                options = ${v.options ? textArray(v.options) : null}, required = ${v.required},
                position = ${q.position}::int, updated_at = ${ts(now)}
              where id = ${q.newId} and event_id = ${ev.id}`),
          );
        }
        const fresh = questions.filter((x) => x.id === undefined);
        if (fresh.length > 0) {
          queries.push(
            db.insert(question).values(
              fresh.map((q) => ({
                id: q.newId,
                professionalId: input.professionalId,
                eventId: ev.id,
                ...questionValues(q),
                position: q.position,
                createdAt: now,
                updatedAt: now,
              })),
            ),
          );
        }
        queries.push(
          G(db, sql`(select count(*)::int from question where event_id = ${ev.id}) = ${questions.length}::int`, "stale"),
        );
      }
      if (p.capacity !== undefined) {
        const propagated = sql`event_id = ${ev.id} and professional_id = ${input.professionalId} and status = 'scheduled'
          and starts_at > ${ts(now)} and not capacity_override`;
        queries.push(
          // Lock first, id asc (event → occurrence): a fan-out UPDATE alone would lock in scan order
          // and could deadlock with sweepHolds, E6c or moveAttendee.
          db.execute(sql`select id from occurrence where ${propagated} order by id for no key update`),
          db.execute(sql`
            update occurrence set capacity = greatest(${p.capacity}::int, seats_taken), updated_at = ${ts(now)}
            where ${propagated}`),
        );
      }
      return queries;
    };
  });
  if (!res.ok) return failOf(res);

  const effects: Effect[] = [];
  if (outcome.describedChanged) {
    const future = await db
      .select({ id: occurrence.id, locationOverride: occurrence.locationOverride })
      .from(occurrence)
      .where(and(eq(occurrence.eventId, input.eventId), eq(occurrence.status, "scheduled"), gt(occurrence.startsAt, now)));
    const byOcc = await activeBookingsByOccurrence(
      db,
      future.map((o) => o.id),
    );
    if (outcome.locationChanged) {
      for (const o of future) {
        const bookingIds = byOcc.get(o.id) ?? [];
        if (o.locationOverride === null && bookingIds.length > 0) {
          effects.push({ type: "email.occurrence_changed", occurrenceId: o.id, bookingIds });
        }
      }
    }
    effects.push(...syncEffects([...byOcc.keys()]));
  }
  return { ok: true, effects, version: input.seenVersion + 1 };
}
