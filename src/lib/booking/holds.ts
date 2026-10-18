/**
 * Seat holds of the buy + book path (spec § 11 E1, E4, E11): a pending booking
 * keeps its seat until hold_expires_at; the Checkout session expires before
 * the hold. An elapsed hold is released lazily by R(o) before every claim, or
 * in bulk by sweepHolds; correctness never waits for the nightly job.
 */
import { sql, type SQL } from "drizzle-orm";

import { G, ts, type BatchCtx, type Query } from "@/lib/db/atomic";
import { CHECKOUT_MINUTES, HOLD_MINUTES, MAX_PENDING_HOLDS, SHOP_CHECKOUT_HOURS } from "@/lib/tickets";

const MINUTE = 60_000;

/** now + HOLD_MINUTES: booking.hold_expires_at. */
export function holdExpiry(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * MINUTE);
}

/** ticket_purchase.checkout_expires_at: now + CHECKOUT_MINUTES (buy + book) or SHOP_CHECKOUT_HOURS (shop). */
export function checkoutExpiry(now: Date, kind: "buybook" | "shop"): Date {
  const minutes = kind === "buybook" ? CHECKOUT_MINUTES : SHOP_CHECKOUT_HOURS * 60;
  return new Date(now.getTime() + minutes * MINUTE);
}

/**
 * G(live holds of the customer < MAX_PENDING_HOLDS, 'too_many_holds'), séances
 * and RDV together (a customer row belongs to one pro). Only LIVE holds count
 * (hold_expires_at > now): an elapsed one not yet swept does not block. Put it
 * BEFORE the new pending booking's INSERT. The caller must already hold the
 * customer row lock in the same batch (lockRows(db, "customer", …): E1 and
 * E4 « buy »). Under READ COMMITTED, two concurrent holds of one customer
 * would otherwise both pass this count.
 */
export function assertHoldQuota(c: BatchCtx, customerId: string): Query {
  return G(
    c.db,
    sql`(select count(*)::int from booking
      where customer_id = ${customerId} and status = 'pending' and hold_expires_at > ${ts(c.now)})
      < ${MAX_PENDING_HOLDS}::int`,
    "too_many_holds",
  );
}

/**
 * R over many occurrences: expires the elapsed holds of every booking whose
 * occurrence is returned by `occurrenceIds`, a subquery (`select id from …`;
 * for a JS list: sql`select unnest(${textArray(ids)})`), marking them with
 * the action id. Lock those occurrences first, then follow with
 * releaseEndedSeats (atomic.ts).
 */
export function expireElapsedHolds(c: BatchCtx, occurrenceIds: SQL): Query {
  return c.db.execute(sql`
    update booking set status = 'expired', ended_at = ${ts(c.now)}, ended_by = 'system',
      ended_action_id = ${c.aid}, updated_at = ${ts(c.now)}
    where occurrence_id in (${occurrenceIds}) and status = 'pending' and hold_expires_at < ${ts(c.now)}`);
}

/** Seats a visitor sees (spec § 7): capacity − seats taken + elapsed holds not yet released, never below 0. */
export function seatsShown(o: { capacity: number; seatsTaken: number; elapsedHolds: number }): number {
  return Math.max(0, o.capacity - o.seatsTaken + o.elapsedHolds);
}
