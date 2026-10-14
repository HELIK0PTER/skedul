/**
 * E7 (spec § 11): « cette séance », the event editor (in place), « cette
 * séance et les suivantes » and « supprimer à partir du ». One tryAtomic
 * batch per action; series edits are version-guarded and re-plan once on stale.
 */
import { and, asc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { addDays, formatDayMonthYear, minKey, todayKey, type DateKey } from "@/lib/civil-date";
import {
  G,
  PlanError,
  RET,
  SEAT,
  lockRows,
  textArray,
  ts,
  tsArray,
  tryAtomic,
  type ActorRef,
  type BatchCtx,
  type Db,
  type Query,
} from "@/lib/db/atomic";
import { booking, customer, event, occurrence, professional, question, ticket } from "@/lib/db/schema";
import { lastSeriesDate, type RecurrenceRule } from "@/lib/recurrence";
import { planSeriesEdit, type SeriesEditPlan, type SeriesEditSummary, type SeriesRow } from "@/lib/series-plan";
import {
  BOOKING_MODES,
  BOUNDS,
  dateKeySchema,
  hexColorSchema,
  idSchema,
  questionInputSchema,
  recurrenceRuleSchema,
  windowOverridesSchema,
  type BookingMode,
  type QuestionInput,
  type RecurrenceRuleInput,
  type WindowOverrides,
} from "@/lib/tickets";

import {
  cancelOccurrencesQuery,
  endBookings,
  expireSessionEffects,
  occurrenceCancelledEffects,
  readEndedByAction,
} from "./cancel";
import { horizonEnd, insertOccurrences, ruleOf, type EventRow, type OccurrenceDraft } from "./occurrences";
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
 * A time change is refused once the séance has started, and into the past
 * (checked at plan time against `now`); capacity and place stay editable.
 * `opts.afterPlan` is test-only: it runs between the plan and its batch.
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
  opts: { afterPlan?: () => Promise<void> } = {},
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
    if (timeChanged && o.startsAt.getTime() <= now.getTime()) {
      throw new PlanError("invalid", "Une séance concernée a déjà commencé.");
    }
    if (timeChanged && newStarts.getTime() <= now.getTime()) {
      throw new PlanError("invalid", "La nouvelle date serait déjà passée.");
    }
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
            and status = 'scheduled' and event_id is not null and starts_at = ${ts(input.seenStartsAt)}
            and ends_at = ${ts(o.endsAt)})`,
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
  }, { afterPlan: opts.afterPlan });
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
    // A repeated id is kept once; each repeat becomes a new question (same as catalog.setTypeQuestions).
    const seen = new Set<string>();
    const questions = (p.questions ?? []).map((q, position) => {
      if (q.id !== undefined && !existingIds.has(q.id)) throw new PlanError("invalid", "Question inconnue.");
      const keep = q.id !== undefined && !seen.has(q.id);
      if (keep && q.id !== undefined) seen.add(q.id);
      return { ...q, position, keep, newId: keep && q.id !== undefined ? q.id : nanoid() };
    });
    const keptIds = questions.filter((q) => q.keep).map((q) => q.newId);

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
        for (const q of questions.filter((x) => x.keep)) {
          const v = questionValues(q);
          queries.push(
            db.execute(sql`
              update question set label = ${v.label}, type = ${v.type}::question_type,
                options = ${v.options ? textArray(v.options) : null}, required = ${v.required},
                position = ${q.position}::int, updated_at = ${ts(now)}
              where id = ${q.newId} and event_id = ${ev.id}`),
          );
        }
        const fresh = questions.filter((x) => !x.keep);
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

/* ───────────────────── « Cette séance et les suivantes » ───────────────────── */

/** « Séance modifiée » e-mails + Google sync for the occurrences that still have active bookings. */
function changedEffects(byOcc: Map<string, string[]>): Effect[] {
  const effects: Effect[] = [];
  for (const [occurrenceId, bookingIds] of byOcc) {
    effects.push({ type: "email.occurrence_changed", occurrenceId, bookingIds });
  }
  return [...effects, ...syncEffects([...byOcc.keys()])];
}

export type SeriesEditInput = {
  professionalId: string;
  actorUserId: string;
  eventId: string;
  seenVersion: number;
  fromDate: DateKey;
  rule: RecurrenceRuleInput;
  durationMin: number;
  orphans: "keep" | "cancel";
};

type SeriesContext = {
  tz: string;
  ev: EventRow;
  oldRule: RecurrenceRule;
  /** rows with series_date ≥ d, as the planner wants them */
  rows: SeriesRow[];
  /**
   * true = rows exist before d AND d > start_date: the edit splits. Otherwise it
   * is applied in place; rows before d can then only be leftovers kept by an
   * earlier edit before the current start_date, and they stay on the event untouched.
   */
  split: boolean;
  /** rows of the segment with series_date < d */
  rowsBefore: number;
  /** the earliest start_date of a later non-archived segment of the same series, if any */
  laterSegmentStart: DateKey | null;
};

/** `event` rows that are later non-archived segments of ev's series (same root, start_date after ev's). */
function laterSegments(ev: Pick<EventRow, "id" | "professionalId" | "seriesRootId" | "startDate">): SQL {
  return sql`professional_id = ${ev.professionalId} and coalesce(series_root_id, id) = ${ev.seriesRootId ?? ev.id}
    and id <> ${ev.id} and archived_at is null and start_date > ${ev.startDate}::date`;
}

/**
 * Plan reads shared by preview, edit and delete: the pro's tz, the segment,
 * its rows ≥ d (with activity), the count of rows before d and the start of
 * the next later segment of the series (planEdit refuses to reach it). Throws
 * PlanError: not_found (unknown or archived event), invalid (d before local
 * today or a row ≥ d already started).
 */
async function loadSeriesContext(
  db: Db,
  args: { professionalId: string; eventId: string; fromDate: DateKey },
  now: Date,
): Promise<SeriesContext> {
  const [pro] = await db.select({ tz: professional.timezone }).from(professional).where(eq(professional.id, args.professionalId));
  if (!pro) throw new PlanError("not_found");
  const [ev] = await db
    .select()
    .from(event)
    .where(and(eq(event.id, args.eventId), eq(event.professionalId, args.professionalId)));
  if (!ev || ev.archivedAt) throw new PlanError("not_found");
  if (!dateKeySchema.safeParse(args.fromDate).success) throw new PlanError("invalid");
  if (args.fromDate < todayKey(now, pro.tz)) {
    throw new PlanError("invalid", "La modification doit partir d'aujourd'hui ou d'une date future.");
  }

  // `occurrence.id` is written as plain SQL on purpose: in a single-table select, drizzle
  // renders a column inside a sql`` field unqualified ("id"), which the subquery would
  // resolve to b.id.
  const rows = await db
    .select({
      id: occurrence.id,
      seriesDate: occurrence.seriesDate,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      status: occurrence.status,
      timeDetached: occurrence.timeDetached,
      activeBookings: sql<number>`(select count(*)::int from booking b where b.occurrence_id = occurrence.id and b.status in ('pending', 'confirmed'))`.mapWith(
        Number,
      ),
      ticketBookings: sql<number>`(select count(*)::int from booking b where b.occurrence_id = occurrence.id and b.status = 'confirmed' and b.coverage = 'ticket')`.mapWith(
        Number,
      ),
      hasHistory: sql<boolean>`exists (select 1 from booking b where b.occurrence_id = occurrence.id)`,
    })
    .from(occurrence)
    .where(and(eq(occurrence.eventId, ev.id), gte(occurrence.seriesDate, args.fromDate)))
    .orderBy(asc(occurrence.seriesDate));
  if (rows.some((r) => r.startsAt.getTime() <= now.getTime())) {
    throw new PlanError("invalid", "Une séance concernée a déjà commencé.");
  }
  const [before] = await db
    .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(occurrence)
    .where(and(eq(occurrence.eventId, ev.id), lt(occurrence.seriesDate, args.fromDate)));
  const before_ = before?.n ?? 0;
  const [later] = await db
    .select({ startDate: event.startDate })
    .from(event)
    .where(laterSegments(ev))
    .orderBy(asc(event.startDate))
    .limit(1);

  return {
    tz: pro.tz,
    ev,
    oldRule: ruleOf(ev),
    rows: rows.map((r) => ({ ...r, seriesDate: String(r.seriesDate), hasHistory: r.hasHistory === true })),
    split: before_ > 0 && args.fromDate > ev.startDate,
    rowsBefore: before_,
    laterSegmentStart: later?.startDate ?? null,
  };
}

/** Validates the new rule and runs the pure planner. */
function planEdit(
  ctx: SeriesContext,
  args: { fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number },
  now: Date,
): { plan: SeriesEditPlan; newRule: RecurrenceRule; last: DateKey | null } {
  const parsed = recurrenceRuleSchema.safeParse(args.rule);
  if (!parsed.success) throw new PlanError("invalid", parsed.error.issues[0]?.message);
  if (!durationOk(args.durationMin)) throw new PlanError("invalid", "Durée invalide.");
  if (parsed.data.startDate < args.fromDate) {
    throw new PlanError("invalid", "La nouvelle règle doit commencer à la date choisie ou après.");
  }
  const newRule: RecurrenceRule = { ...parsed.data, durationMin: args.durationMin };
  // A later segment already holds the dates from its start: the new rule must stop before it.
  const last = lastSeriesDate(newRule);
  if (ctx.laterSegmentStart !== null && (last === null || last >= ctx.laterSegmentStart)) {
    throw new PlanError(
      "invalid",
      `La série change déjà à partir du ${formatDayMonthYear(ctx.laterSegmentStart)} : modifiez-la depuis cette date, ou terminez celle-ci avant.`,
    );
  }
  const plan = planSeriesEdit({
    tz: ctx.tz,
    fromDate: args.fromDate,
    horizonEnd: horizonEnd(now, ctx.tz),
    oldRule: ctx.oldRule,
    newRule,
    rows: ctx.rows,
  });
  if (plan.retime.some((r) => r.startsAt.getTime() <= now.getTime()) || plan.insert.some((r) => r.startsAt.getTime() <= now.getTime())) {
    throw new PlanError("invalid", "Une séance de la nouvelle règle serait déjà passée.");
  }
  return { plan, newRule, last };
}

/** Rule columns of `event` for a new rule (SET list). */
function ruleSets(r: RecurrenceRule): SQL[] {
  return [
    sql`start_date = ${r.startDate}::date`,
    sql`start_minute = ${r.startMinute}::int`,
    sql`duration_min = ${r.durationMin}::int`,
    sql`freq = ${r.freq}::recurrence_freq`,
    sql`"interval" = ${r.interval}::smallint`,
    sql`weekdays = ${r.weekdays ? sql`${sql.param(r.weekdays)}::smallint[]` : null}`,
    sql`monthly_by = ${r.monthlyBy}::monthly_by`,
    sql`month_week = ${r.monthWeek}::smallint`,
    sql`end_mode = ${r.endMode}::recurrence_end`,
    sql`until_date = ${r.untilDate}::date`,
    sql`occurrence_count = ${r.occurrenceCount}::int`,
  ];
}

/**
 * The end of the old segment at d: until = min(d − 1, its last date), unless
 * the old rule already stops before d (then its rule columns stay as they are).
 */
function endOldSegmentSets(oldRule: RecurrenceRule, fromDate: DateKey): SQL[] {
  const last = lastSeriesDate(oldRule);
  if (last !== null && last < fromDate) return [];
  const until = last === null ? addDays(fromDate, -1) : minKey(addDays(fromDate, -1), last);
  return [sql`end_mode = 'until'`, sql`until_date = ${until}::date`, sql`occurrence_count = null`];
}

/** Same reads as editSeriesFrom, no write: the preview the editor shows. */
export async function previewSeriesEdit(
  db: Db,
  input: Omit<SeriesEditInput, "actorUserId" | "seenVersion" | "orphans">,
  now: Date = new Date(),
): Promise<EngineResult<{ summary: SeriesEditSummary; remainingCount: number | null; inPlace: boolean }>> {
  try {
    const ctx = await loadSeriesContext(db, input, now);
    const { plan } = planEdit(ctx, input, now);
    return { ok: true, effects: [], summary: plan.summary, remainingCount: plan.remainingCount, inPlace: !ctx.split };
  } catch (err) {
    if (err instanceof PlanError) return fail(err.code, err.detail);
    throw err;
  }
}

/**
 * « Cette séance et les suivantes » (spec § 11 E7, contract § 5.20 batch
 * order). Split when rows exist before d and d > start_date, else in place on
 * the same event. Re-plans once on stale (a concurrent claim, ensureHorizon
 * rows, a version bump, a planned row moved by « cette séance »).
 */
export async function editSeriesFrom(
  db: Db,
  input: SeriesEditInput,
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult<{ eventId: string; summary: SeriesEditSummary }>> {
  const committed: { plan: SeriesEditPlan | null; targetId: string } = { plan: null, targetId: "" };
  const res = await tryAtomic(
    db,
    async () => {
      if (input.orphans !== "keep" && input.orphans !== "cancel") throw new PlanError("invalid");
      const ctx = await loadSeriesContext(db, input, now);
      const { plan, newRule, last } = planEdit(ctx, input, now);
      const { ev } = ctx;
      const targetId = ctx.split ? nanoid() : ev.id;
      const oldQuestions = ctx.split
        ? await db.select().from(question).where(eq(question.eventId, ev.id)).orderBy(asc(question.position))
        : [];
      const drafts: OccurrenceDraft[] = plan.insert.map((d) => ({ id: nanoid(), ...d }));
      committed.plan = plan;
      committed.targetId = targetId;

      return (aid) => {
        const c: BatchCtx = { db, aid, now };
        const by: ActorRef = { actor: "pro", userId: input.actorUserId };
        const segmentRows = sql`event_id = ${ev.id} and series_date >= ${input.fromDate}::date`;
        const queries: Query[] = [];

        // 1. version guard; the old segment ends at d − 1 (split) or takes the new rule (in place)
        const sets: SQL[] = [sql`version = version + 1`, sql`last_action_id = ${aid}`, sql`updated_at = ${ts(now)}`];
        if (ctx.split) sets.push(...endOldSegmentSets(ctx.oldRule, input.fromDate));
        else sets.push(...ruleSets(newRule), sql`generated_until = ${plan.generatedUntil}::date`);
        queries.push(
          db.execute(sql`update event set ${sql.join(sets, sql`, `)}
            where id = ${ev.id} and professional_id = ${input.professionalId} and version = ${input.seenVersion}::int
              and archived_at is null`),
          G(db, sql`(select last_action_id from event where id = ${ev.id}) = ${aid}`, "stale"),
          // no later segment inside the new rule's dates appeared since the plan (re-plan → invalid)
          G(
            db,
            sql`not exists (select 1 from event where ${laterSegments(ev)}
              ${last === null ? sql`` : sql`and start_date <= ${last}::date`})`,
            "stale",
          ),
        );

        // 2. the new segment, its links and its questions (split only)
        if (ctx.split) {
          queries.push(
            db.insert(event).values({
              id: targetId,
              professionalId: input.professionalId,
              title: ev.title,
              description: ev.description,
              location: ev.location,
              color: ev.color,
              bookingMode: ev.bookingMode,
              isPrivate: ev.isPrivate,
              capacity: ev.capacity,
              durationMin: newRule.durationMin,
              startDate: newRule.startDate,
              startMinute: newRule.startMinute,
              freq: newRule.freq,
              interval: newRule.interval,
              weekdays: newRule.weekdays,
              monthlyBy: newRule.monthlyBy,
              monthWeek: newRule.monthWeek,
              endMode: newRule.endMode,
              untilDate: newRule.untilDate,
              occurrenceCount: newRule.occurrenceCount,
              bookingHorizonDays: ev.bookingHorizonDays,
              minNoticeMinutes: ev.minNoticeMinutes,
              cancelDeadlineHours: ev.cancelDeadlineHours,
              generatedUntil: plan.generatedUntil,
              seriesRootId: ev.seriesRootId ?? ev.id,
              version: 1,
              lastActionId: aid,
              createdAt: now,
              updatedAt: now,
            }),
            db.execute(sql`
              insert into event_ticket_type (event_id, ticket_type_id, professional_id, created_at)
              select ${targetId}, ticket_type_id, professional_id, ${ts(now)} from event_ticket_type where event_id = ${ev.id}`),
          );
          if (oldQuestions.length > 0) {
            queries.push(
              db.insert(question).values(
                oldQuestions.map((q) => ({
                  id: nanoid(),
                  professionalId: input.professionalId,
                  eventId: targetId,
                  label: q.label,
                  type: q.type,
                  options: q.options,
                  required: q.required,
                  position: q.position,
                  createdAt: now,
                  updatedAt: now,
                })),
              ),
            );
          }
        }

        // 3. lock the rows ≥ d; 4. reparent them (split), then the planned-row-count guard
        queries.push(db.execute(sql`select id from occurrence where ${segmentRows} order by id for no key update`));
        if (ctx.split) {
          queries.push(
            db.execute(sql`update occurrence set event_id = ${targetId}, updated_at = ${ts(now)} where ${segmentRows}`),
            G(db, sql`(select count(*)::int from occurrence where event_id = ${targetId}) = ${ctx.rows.length}::int`, "stale"),
          );
        } else {
          queries.push(
            G(db, sql`(select count(*)::int from occurrence where ${segmentRows}) = ${ctx.rows.length}::int`, "stale"),
          );
        }
        // Every row planned as not detached must still be: one moved by « cette séance » since
        // the plan (no version bump) makes the batch stale, and the re-plan reparents it only.
        const plannedAttached = [...plan.retime.map((r) => r.id), ...plan.delete, ...plan.cancelEmpty, ...plan.orphanBooked];
        if (plannedAttached.length > 0) {
          queries.push(
            G(db, sql`not exists (select 1 from occurrence where id = any(${textArray(plannedAttached)}) and time_detached)`, "stale"),
          );
        }

        // 5. retime, never a detached row, then G(every planned row has its planned times)
        if (plan.retime.length > 0) {
          const retime = sql`unnest(${textArray(plan.retime.map((r) => r.id))}, ${tsArray(plan.retime.map((r) => r.startsAt))},
            ${tsArray(plan.retime.map((r) => r.endsAt))}) as v(id, s, e)`;
          queries.push(
            db.execute(sql`
              update occurrence o set starts_at = v.s, ends_at = v.e, block_start = v.s, block_end = v.e,
                changed_at = case when o.starts_at <> v.s or o.ends_at <> v.e then ${ts(now)} else o.changed_at end,
                capacity = case when o.capacity_override then o.capacity else greatest(${ev.capacity}::int, o.seats_taken) end,
                updated_at = ${ts(now)}
              from ${retime}
              where o.id = v.id and o.event_id = ${targetId} and not o.time_detached`),
            G(
              db,
              sql`(select count(*)::int from occurrence o join ${retime} on o.id = v.id
                where o.starts_at = v.s and o.ends_at = v.e and not o.time_detached) = ${plan.retime.length}::int`,
              "stale",
            ),
          );
        }

        // 6. delete the never-booked rows whose date disappears
        if (plan.delete.length > 0) {
          queries.push(
            db.execute(sql`
              delete from occurrence where id = any(${textArray(plan.delete)}) and seats_taken = 0
                and not exists (select 1 from booking b where b.occurrence_id = occurrence.id)`),
            G(db, sql`not exists (select 1 from occurrence where id = any(${textArray(plan.delete)}))`, "stale"),
          );
        }

        // 7. empty rows with history → cancelled; booked orphans → isolated, or E6b
        if (plan.cancelEmpty.length > 0) {
          queries.push(
            db.execute(sql`
              update occurrence set status = 'cancelled', cancelled_at = coalesce(cancelled_at, ${ts(now)}), updated_at = ${ts(now)}
              where id = any(${textArray(plan.cancelEmpty)}) and seats_taken = 0`),
            G(
              db,
              sql`(select count(*)::int from occurrence where id = any(${textArray(plan.cancelEmpty)}) and status = 'cancelled') = ${plan.cancelEmpty.length}::int`,
              "stale",
            ),
          );
        }
        if (plan.orphanBooked.length > 0 && input.orphans === "keep") {
          queries.push(
            db.execute(sql`update occurrence set time_detached = true, updated_at = ${ts(now)}
              where id = any(${textArray(plan.orphanBooked)})`),
          );
        }
        if (plan.orphanBooked.length > 0 && input.orphans === "cancel") {
          queries.push(
            cancelOccurrencesQuery(c, { professionalId: input.professionalId, occurrenceIds: plan.orphanBooked }),
            G(
              db,
              sql`(select count(*)::int from occurrence where id = any(${textArray(plan.orphanBooked)}) and status = 'cancelled') = ${plan.orphanBooked.length}::int`,
              "stale",
            ),
            endBookings(c, { professionalId: input.professionalId, scope: { occurrenceIds: plan.orphanBooked }, by }),
          );
        }

        // 8. new dates (generated_until was set with the segment in step 1 or 2)
        if (drafts.length > 0) {
          queries.push(
            insertOccurrences(c, { professionalId: input.professionalId, eventId: targetId, capacity: ev.capacity, drafts }),
          );
        }

        // 9. tickets of cancelled orphans come back
        if (plan.orphanBooked.length > 0 && input.orphans === "cancel") queries.push(RET(c, by));
        return queries;
      };
    },
    { replanOnStale: true, afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  const plan = committed.plan;
  if (!plan) throw new Error("editSeriesFrom: no committed plan");

  const changedIds = plan.retime.filter((r) => r.timeChanged).map((r) => r.id);
  const effects = changedEffects(await activeBookingsByOccurrence(db, changedIds));
  if (plan.orphanBooked.length > 0 && input.orphans === "cancel") {
    effects.push(...(await occurrenceCancelledEffects(db, res.aid, plan.orphanBooked)).effects);
  }
  return { ok: true, effects, eventId: committed.targetId, summary: plan.summary };
}

/* ───────────────────────── « Supprimer à partir du » ───────────────────────── */

/**
 * Never-booked event with no séance before d and no later segment rooted on
 * it: DELETE event (cascade; a 23503 from a booking taken meanwhile → stale →
 * re-plan). Else: version-guarded end (until = d − 1, or archived_at when
 * d ≤ start_date, refused while a scheduled future leftover remains before d),
 * lock rows ≥ d, G(row count), delete the rows without history, cancel (E6b)
 * the scheduled ones with history, RET, G(no scheduled row ≥ d left).
 * `opts.afterPlan` is test-only: it runs between the plan and its batch.
 */
export async function deleteSeriesFrom(
  db: Db,
  input: { professionalId: string; actorUserId: string; eventId: string; seenVersion: number; fromDate: DateKey },
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number }>> {
  const outcome = { deletedEvent: false, toCancel: [] as string[], deleted: 0 };
  const res = await tryAtomic(
    db,
    async () => {
      const ctx = await loadSeriesContext(db, input, now);
      const { ev } = ctx;
      // d ≤ start_date: the whole segment ends (archived). Rows before d can then only be
      // leftovers kept by an earlier edit; a scheduled future one must be cancelled first.
      const archive = input.fromDate <= ev.startDate;
      const liveBefore = sql`event_id = ${ev.id} and series_date < ${input.fromDate}::date
        and status = 'scheduled' and starts_at > ${ts(now)}`;
      const flags = await db.execute<{ booked: boolean; root_in_use: boolean; live_before: boolean }>(sql`select
        exists (select 1 from booking b join occurrence o on o.id = b.occurrence_id where o.event_id = ${ev.id}) as booked,
        exists (select 1 from event e where e.series_root_id = ${ev.id} and e.id <> ${ev.id}) as root_in_use,
        exists (select 1 from occurrence where ${liveBefore}) as live_before`);
      const f = flags.rows[0];

      // Never booked, no séance before d, no later segment rooted on it: physical delete.
      if (f?.booked !== true && ctx.rowsBefore === 0 && f?.root_in_use !== true) {
        Object.assign(outcome, { deletedEvent: true, toCancel: [], deleted: ctx.rows.length });
        return () => [
          db.execute(sql`delete from event where id = ${ev.id} and professional_id = ${input.professionalId}
            and version = ${input.seenVersion}::int`),
          G(db, sql`not exists (select 1 from event where id = ${ev.id})`, "stale"),
        ];
      }
      if (archive && f?.live_before === true) {
        throw new PlanError("invalid", "Une séance isolée avec inscrits reste avant cette date. Annulez-la d'abord.");
      }

      const del = ctx.rows.filter((r) => !r.hasHistory).map((r) => r.id);
      const toCancel = ctx.rows.filter((r) => r.hasHistory && r.status === "scheduled").map((r) => r.id);
      Object.assign(outcome, { deletedEvent: false, toCancel, deleted: del.length });
      return (aid) => {
        const c: BatchCtx = { db, aid, now };
        const by: ActorRef = { actor: "pro", userId: input.actorUserId };
        const segmentRows = sql`event_id = ${ev.id} and series_date >= ${input.fromDate}::date`;
        const end = archive ? [sql`archived_at = ${ts(now)}`] : endOldSegmentSets(ctx.oldRule, input.fromDate);
        const queries: Query[] = [
          db.execute(sql`update event set ${sql.join(
            [sql`version = version + 1`, sql`last_action_id = ${aid}`, sql`updated_at = ${ts(now)}`, ...end],
            sql`, `,
          )} where id = ${ev.id} and professional_id = ${input.professionalId} and version = ${input.seenVersion}::int`),
          G(db, sql`(select last_action_id from event where id = ${ev.id}) = ${aid}`, "stale"),
        ];
        if (archive) queries.push(G(db, sql`not exists (select 1 from occurrence where ${liveBefore})`, "stale"));
        queries.push(
          db.execute(sql`select id from occurrence where ${segmentRows} order by id for no key update`),
          G(db, sql`(select count(*)::int from occurrence where ${segmentRows}) = ${ctx.rows.length}::int`, "stale"),
        );
        if (del.length > 0) {
          queries.push(
            db.execute(sql`
              delete from occurrence where id = any(${textArray(del)}) and seats_taken = 0
                and not exists (select 1 from booking b where b.occurrence_id = occurrence.id)`),
            G(db, sql`not exists (select 1 from occurrence where id = any(${textArray(del)}))`, "stale"),
          );
        }
        if (toCancel.length > 0) {
          queries.push(
            cancelOccurrencesQuery(c, { professionalId: input.professionalId, occurrenceIds: toCancel }),
            G(
              db,
              sql`(select count(*)::int from occurrence where id = any(${textArray(toCancel)}) and status = 'cancelled') = ${toCancel.length}::int`,
              "stale",
            ),
            endBookings(c, { professionalId: input.professionalId, scope: { occurrenceIds: toCancel }, by }),
            RET(c, by),
          );
        }
        // End state: nothing ≥ d stays bookable (a séance restored since the plan → stale → re-plan).
        queries.push(G(db, sql`not exists (select 1 from occurrence where ${segmentRows} and status = 'scheduled')`, "stale"));
        return queries;
      };
    },
    { replanOnStale: true, afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  const effects =
    outcome.toCancel.length > 0 ? (await occurrenceCancelledEffects(db, res.aid, outcome.toCancel)).effects : [];
  return {
    ok: true,
    effects,
    deletedEvent: outcome.deletedEvent,
    cancelledOccurrences: outcome.toCancel.length,
    deletedOccurrences: outcome.deleted,
  };
}
