/**
 * Cancellations (spec § 11 E5, E6a, E6b, rétablir, E6c). Every write is one
 * tryAtomic batch: lock first, guarded UPDATE + G, SEAT once per occurrence,
 * RET once per action. Effects are descriptors run after commit (P3/P4).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

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
import { booking, event, occurrence, ticketPurchase, ticketType, timeOff } from "@/lib/db/schema";
import { BOUNDS } from "@/lib/tickets";

import { fail, failOf, syncEffects, type Effect, type EngineResult } from "./types";

/* ───────────────────────── Shared helpers ───────────────────────── */

/** `return` movements written by one action. */
async function countReturned(db: Db, aid: string): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ticket_movement where action_id = ${aid} and kind = 'return'`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

/* ───────────────────────── Statement builders ───────────────────────── */

/** UPDATE booking → cancelled (ended_at, ended_by, ended_action_id = aid, cancel_reason) for the scope, pending|confirmed, this pro. */
export function endBookings(
  c: BatchCtx,
  args: {
    professionalId: string;
    scope: { occurrenceIds: readonly string[] } | { occurrenceId: string; bookingIds: readonly string[] };
    by: ActorRef;
    reason?: string | null;
  },
): Query {
  const scope =
    "occurrenceIds" in args.scope
      ? sql`occurrence_id = any(${textArray(args.scope.occurrenceIds)})`
      : sql`occurrence_id = ${args.scope.occurrenceId} and id = any(${textArray(args.scope.bookingIds)})`;
  return c.db.execute(sql`
    update booking set status = 'cancelled', ended_at = ${ts(c.now)}, ended_by = ${args.by.actor}::actor,
      ended_action_id = ${c.aid}, cancel_reason = ${args.reason ?? null}, updated_at = ${ts(c.now)}
    where professional_id = ${args.professionalId} and status in ('pending', 'confirmed') and ${scope}`);
}

/** UPDATE occurrence → cancelled, cancelled_at = now, seats_taken = 0 WHERE id = any AND pro AND scheduled. */
export function cancelOccurrencesQuery(
  c: BatchCtx,
  args: { professionalId: string; occurrenceIds: readonly string[] },
): Query {
  return c.db.execute(sql`
    update occurrence set status = 'cancelled', cancelled_at = ${ts(c.now)}, seats_taken = 0, updated_at = ${ts(c.now)}
    where id = any(${textArray(args.occurrenceIds)}) and professional_id = ${args.professionalId} and status = 'scheduled'`);
}

/** Final read after commit: bookings ended by `aid`, with their purchase state (for effects). */
export async function readEndedByAction(
  db: Db,
  aid: string,
): Promise<
  { bookingId: string; occurrenceId: string; purchaseId: string | null; purchasePending: boolean; checkoutSessionId: string | null }[]
> {
  const rows = await db
    .select({
      bookingId: booking.id,
      occurrenceId: booking.occurrenceId,
      purchaseId: booking.purchaseId,
      purchaseStatus: ticketPurchase.status,
      checkoutSessionId: ticketPurchase.checkoutSessionId,
    })
    .from(booking)
    .leftJoin(ticketPurchase, eq(ticketPurchase.id, booking.purchaseId))
    .where(eq(booking.endedActionId, aid))
    .orderBy(booking.id);
  return rows.map((r) => ({
    bookingId: r.bookingId,
    occurrenceId: r.occurrenceId,
    purchaseId: r.purchaseId,
    purchasePending: r.purchaseStatus === "pending",
    checkoutSessionId: r.checkoutSessionId,
  }));
}

/** stripe.expire_session for every ended booking whose purchase is still pending with a session. */
export function expireSessionEffects(ended: Awaited<ReturnType<typeof readEndedByAction>>): Effect[] {
  const effects: Effect[] = [];
  for (const b of ended) {
    if (b.purchaseId && b.purchasePending && b.checkoutSessionId) {
      effects.push({ type: "stripe.expire_session", purchaseId: b.purchaseId, checkoutSessionId: b.checkoutSessionId });
    }
  }
  return effects;
}

/**
 * E6b effects for séances cancelled by action `aid`: one « séance annulée »
 * e-mail per séance that had bookings, Stripe expiry for pending purchases,
 * a Google sync per séance. Shared with series.ts (orphans cancelled).
 */
export async function occurrenceCancelledEffects(
  db: Db,
  aid: string,
  occurrenceIds: readonly string[],
): Promise<{ effects: Effect[]; bookingsCancelled: number }> {
  const ended = await readEndedByAction(db, aid);
  const effects: Effect[] = [];
  for (const occurrenceId of occurrenceIds) {
    const bookingIds = ended.filter((b) => b.occurrenceId === occurrenceId).map((b) => b.bookingId);
    if (bookingIds.length > 0) effects.push({ type: "email.occurrence_cancelled", occurrenceId, bookingIds });
  }
  effects.push(...expireSessionEffects(ended), ...syncEffects(occurrenceIds));
  return { effects, bookingsCancelled: ended.length };
}

/* ───────────────────────── E5: client cancellation ───────────────────────── */

/**
 * E5. Caller precondition (P4): `customerId` is the VERIFIED wallet owner
 * (session or guest link); the engine only checks that the booking belongs to
 * that customer and to `professionalId`.
 * Batch: lock occurrence; guarded UPDATE (deadline OR changed_at > created_at
 * OR moved_at); G(marked by aid, 'too_late_or_done'); SEAT(o, 0); RET(client).
 */
export async function cancelByClient(
  db: Db,
  input: { professionalId: string; customerId: string; bookingId: string; actorUserId: string | null },
  now: Date = new Date(),
): Promise<EngineResult<{ occurrenceId: string; ticketReturned: boolean }>> {
  let occurrenceId = "";
  const res = await tryAtomic(db, async () => {
    const [b] = await db
      .select({ id: booking.id, occurrenceId: booking.occurrenceId })
      .from(booking)
      .where(
        and(
          eq(booking.id, input.bookingId),
          eq(booking.professionalId, input.professionalId),
          eq(booking.customerId, input.customerId),
        ),
      );
    if (!b) throw new PlanError("not_found");
    occurrenceId = b.occurrenceId;
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      return [
        lockRows(db, "occurrence", [b.occurrenceId]),
        db.execute(sql`
          update booking b set status = 'cancelled', ended_at = ${ts(now)}, ended_by = 'client',
            ended_action_id = ${aid}, updated_at = ${ts(now)}
          where b.id = ${b.id} and b.customer_id = ${input.customerId} and b.occurrence_id = ${b.occurrenceId}
            and b.status = 'confirmed'
            and exists (
              select 1 from occurrence o
              join professional p on p.id = o.professional_id
              left join event e on e.id = o.event_id
              left join ticket_type tt on tt.id = o.ticket_type_id
              where o.id = b.occurrence_id and o.starts_at > ${ts(now)}
                and (o.starts_at - make_interval(hours => coalesce(e.cancel_deadline_hours, tt.rdv_cancel_deadline_hours, p.cancel_deadline_hours)) > ${ts(now)}
                     or o.changed_at > b.created_at
                     or b.moved_at is not null))`),
        G(db, sql`exists (select 1 from booking where id = ${b.id} and ended_action_id = ${aid})`, "too_late_or_done"),
        SEAT(c, b.occurrenceId, 0),
        RET(c, { actor: "client", userId: input.actorUserId }),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  const returned = await countReturned(db, res.aid);
  return {
    ok: true,
    effects: [
      { type: "email.booking_cancelled", bookingId: input.bookingId, by: "client" },
      { type: "email.pro_booking_cancelled", bookingId: input.bookingId },
      ...syncEffects([occurrenceId]),
    ],
    occurrenceId,
    ticketReturned: returned > 0,
  };
}

/* ───────────────────────── E6a: pro cancels bookings ───────────────────────── */

/**
 * E6a: one or several bookings of ONE occurrence, any time (past too, to fix
 * a mistake). Batch: lock occurrence; end them; G(all marked, 'stale');
 * SEAT(o, 0); RET(pro).
 */
export async function cancelBookingsByPro(
  db: Db,
  input: { professionalId: string; actorUserId: string; occurrenceId: string; bookingIds: string[]; reason?: string | null },
  now: Date = new Date(),
): Promise<EngineResult<{ cancelled: number; ticketsReturned: number }>> {
  const ids = [...new Set(input.bookingIds)];
  const reason = input.reason?.trim() || null;
  if (ids.length === 0 || ids.length > BOUNDS.capacity.max) return fail("invalid");
  if (reason !== null && reason.length > BOUNDS.note) return fail("invalid");

  const res = await tryAtomic(db, async () => {
    const [o] = await db
      .select({ id: occurrence.id })
      .from(occurrence)
      .where(and(eq(occurrence.id, input.occurrenceId), eq(occurrence.professionalId, input.professionalId)));
    if (!o) throw new PlanError("not_found");
    const found = await db
      .select({ id: booking.id, status: booking.status })
      .from(booking)
      .where(and(eq(booking.occurrenceId, o.id), eq(booking.professionalId, input.professionalId), inArray(booking.id, ids)));
    if (found.length !== ids.length) throw new PlanError("not_found");
    if (found.some((b) => b.status !== "pending" && b.status !== "confirmed")) throw new PlanError("stale");
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      return [
        lockRows(db, "occurrence", [o.id]),
        endBookings(c, {
          professionalId: input.professionalId,
          scope: { occurrenceId: o.id, bookingIds: ids },
          by: { actor: "pro", userId: input.actorUserId },
          reason,
        }),
        G(
          db,
          sql`(select count(*)::int from booking where ended_action_id = ${aid} and id = any(${textArray(ids)})) = ${ids.length}::int`,
          "stale",
        ),
        SEAT(c, o.id, 0),
        RET(c, { actor: "pro", userId: input.actorUserId }),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  const ended = await readEndedByAction(db, res.aid);
  const effects: Effect[] = [
    ...ended.map((b): Effect => ({ type: "email.booking_cancelled", bookingId: b.bookingId, by: "pro" })),
    ...expireSessionEffects(ended),
    ...syncEffects([input.occurrenceId]),
  ];
  return { ok: true, effects, cancelled: ended.length, ticketsReturned: await countReturned(db, res.aid) };
}

/* ───────────────────────── E6b: pro cancels a séance ───────────────────────── */

/**
 * E6b, idempotent: the guarded UPDATE locks the occurrence (→ cancelled,
 * seats 0); G(cancelled, 'not_found'); end every pending|confirmed booking;
 * RET(pro). An already cancelled séance is a success with nothing to do.
 */
export async function cancelOccurrence(
  db: Db,
  input: { professionalId: string; actorUserId: string; occurrenceId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ bookingsCancelled: number; ticketsReturned: number }>> {
  const res = await tryAtomic(db, async () => {
    const [o] = await db
      .select({ id: occurrence.id })
      .from(occurrence)
      .where(and(eq(occurrence.id, input.occurrenceId), eq(occurrence.professionalId, input.professionalId)));
    if (!o) throw new PlanError("not_found");
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const by: ActorRef = { actor: "pro", userId: input.actorUserId };
      return [
        cancelOccurrencesQuery(c, { professionalId: input.professionalId, occurrenceIds: [o.id] }),
        G(
          db,
          sql`(select status from occurrence where id = ${o.id} and professional_id = ${input.professionalId}) = 'cancelled'`,
          "not_found",
        ),
        endBookings(c, { professionalId: input.professionalId, scope: { occurrenceIds: [o.id] }, by }),
        RET(c, by),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  const { effects, bookingsCancelled } = await occurrenceCancelledEffects(db, res.aid, [input.occurrenceId]);
  return { ok: true, effects, bookingsCancelled, ticketsReturned: await countReturned(db, res.aid) };
}

/* ───────────────────────── Rétablir ───────────────────────── */

/**
 * Future EVENT séance only (never an RDV): → scheduled, cancelled_at NULL,
 * changed_at = now. The roster stays empty; nothing goes to Google before the
 * first booking. Idempotent on a scheduled séance.
 */
export async function restoreOccurrence(
  db: Db,
  input: { professionalId: string; occurrenceId: string },
  now: Date = new Date(),
): Promise<EngineResult> {
  const res = await tryAtomic(db, async () => {
    const [o] = await db
      .select({ id: occurrence.id })
      .from(occurrence)
      .where(and(eq(occurrence.id, input.occurrenceId), eq(occurrence.professionalId, input.professionalId)));
    if (!o) throw new PlanError("not_found");
    return () => [
      db.execute(sql`
        update occurrence set status = 'scheduled', cancelled_at = null, changed_at = ${ts(now)}, updated_at = ${ts(now)}
        where id = ${o.id} and professional_id = ${input.professionalId} and status = 'cancelled'
          and event_id is not null and starts_at > ${ts(now)}`),
      G(db, sql`(select status from occurrence where id = ${o.id}) = 'scheduled'`, "not_found"),
    ];
  });
  if (!res.ok) return failOf(res);
  return { ok: true, effects: [] };
}

/* ───────────────────────── E6c: time off ───────────────────────── */

export type TimeOffConflict = { occurrenceId: string; startsAt: Date; endsAt: Date; title: string; activeBookings: number };

/** Block range of a scheduled occurrence overlaps [startAt, endAt). */
function overlapsRange(startAt: Date, endAt: Date) {
  return sql`tstzrange(${occurrence.blockStart}, ${occurrence.blockEnd}) && tstzrange(${ts(startAt)}, ${ts(endAt)})`;
}

/** E6c preview: scheduled occurrences (séances and RDV) overlapping the range that have seats taken, id asc. */
export async function previewTimeOffConflicts(
  db: Db,
  input: { professionalId: string; startAt: Date; endAt: Date },
): Promise<TimeOffConflict[]> {
  const rows = await db
    .select({
      occurrenceId: occurrence.id,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      eventTitle: event.title,
      typeName: ticketType.name,
      activeBookings: sql<number>`(select count(*)::int from booking b where b.occurrence_id = ${occurrence.id} and b.status in ('pending', 'confirmed'))`.mapWith(
        Number,
      ),
    })
    .from(occurrence)
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(
      and(
        eq(occurrence.professionalId, input.professionalId),
        eq(occurrence.status, "scheduled"),
        sql`${occurrence.seatsTaken} > 0`,
        overlapsRange(input.startAt, input.endAt),
      ),
    )
    .orderBy(occurrence.id);
  return rows.map((r) => ({
    occurrenceId: r.occurrenceId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    title: r.eventTitle ?? r.typeName ?? "",
    activeBookings: r.activeBookings,
  }));
}

/**
 * E6c. Batch: lock professional; lock every scheduled occurrence overlapping
 * the range (empty ones too, id asc); INSERT time_off; G(set of overlapping
 * scheduled occurrences with seats taken = seen set, 'stale'); cancelBooked →
 * E6b on that set. Returns `stale` to the UI (new preview), never re-plans.
 */
export async function createTimeOffWithConflicts(
  db: Db,
  input: {
    professionalId: string;
    actorUserId: string;
    startAt: Date;
    endAt: Date;
    allDay: boolean;
    reason: string | null;
    seenOccurrenceIds: string[];
    cancelBooked: boolean;
  },
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult<{ timeOffId: string; cancelledOccurrences: number }>> {
  const reason = input.reason?.trim() || null;
  const seen = [...new Set(input.seenOccurrenceIds)];
  if (!(input.endAt.getTime() > input.startAt.getTime())) {
    return fail("invalid", "La fin de l'indisponibilité doit être après son début.");
  }
  if (reason !== null && reason.length > BOUNDS.note) return fail("invalid");
  const timeOffId = nanoid();
  const toCancel = input.cancelBooked ? seen : [];

  const res = await tryAtomic(
    db,
    async () => (aid) => {
      const c: BatchCtx = { db, aid, now };
      const by: ActorRef = { actor: "pro", userId: input.actorUserId };
      const overlap = sql`professional_id = ${input.professionalId} and status = 'scheduled'
        and tstzrange(block_start, block_end) && tstzrange(${ts(input.startAt)}, ${ts(input.endAt)})`;
      const queries: Query[] = [
        lockRows(db, "professional", [input.professionalId]),
        db.execute(sql`select id from occurrence where ${overlap} order by id for no key update`),
        db.insert(timeOff).values({
          id: timeOffId,
          professionalId: input.professionalId,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          reason,
          createdAt: now,
          updatedAt: now,
        }),
        // Both sides sorted by the database collation: an order-free set comparison.
        G(
          db,
          sql`(select coalesce(array_agg(id order by id), '{}'::text[]) from occurrence where ${overlap} and seats_taken > 0)
            = (select coalesce(array_agg(x order by x), '{}'::text[]) from unnest(${textArray(seen)}) as x)`,
          "stale",
        ),
      ];
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
      return queries;
    },
    { afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  const effects = toCancel.length > 0 ? (await occurrenceCancelledEffects(db, res.aid, toCancel)).effects : [];
  return { ok: true, effects, timeOffId, cancelledOccurrences: toCancel.length };
}
