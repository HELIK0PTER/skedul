/**
 * E11: releasing seats held by unpaid checkouts (spec § 11). Correctness never
 * depends on the nightly job: R(o) also releases elapsed holds before every
 * claim on o, and E4 releases the RDVs it overlaps.
 */
import { and, count, eq, isNull, lt, sql } from "drizzle-orm";

import {
  PlanError,
  SEAT,
  atomic,
  lockRows,
  releaseEndedSeats,
  ts,
  tryAtomic,
  type BatchCtx,
  type Db,
} from "@/lib/db/atomic";
import { booking, ticketPurchase } from "@/lib/db/schema";
import { STALE_PURCHASE_GRACE_MINUTES } from "@/lib/tickets";

import { expireElapsedHolds } from "./holds";
import { failOf, syncEffects, type EngineResult } from "./types";

/**
 * Idempotent. Callers (P4): the `checkout.session.expired` and
 * `async_payment_failed` webhooks, « Libérer ma place » (after
 * sessions.expire), a Stripe error right after E1/E4. Batch: lock the
 * booking's occurrence; booking pending → expired (aid); SEAT(o, 0) (an RDV
 * at 0 is cancelled); purchase pending → expired. A paid purchase is left
 * alone. Effects: google.sync_occurrence when a booking ended. Errors: not_found.
 */
export async function releasePurchase(
  db: Db,
  purchaseId: string,
  now: Date = new Date(),
): Promise<EngineResult<{ released: boolean }>> {
  const res = await tryAtomic(db, async () => {
    const [row] = await db
      .select({ id: ticketPurchase.id, occurrenceId: booking.occurrenceId })
      .from(ticketPurchase)
      .leftJoin(booking, eq(booking.purchaseId, ticketPurchase.id))
      .where(eq(ticketPurchase.id, purchaseId));
    if (!row) throw new PlanError("not_found");
    const occurrenceId = row.occurrenceId;
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const expirePurchase = db.execute(sql`
        update ticket_purchase set status = 'expired', updated_at = ${ts(now)}
        where id = ${purchaseId} and status = 'pending'`);
      if (occurrenceId === null) return [expirePurchase];
      return [
        lockRows(db, "occurrence", [occurrenceId]),
        db.execute(sql`
          update booking set status = 'expired', ended_at = ${ts(now)}, ended_by = 'system',
            ended_action_id = ${aid}, updated_at = ${ts(now)}
          where purchase_id = ${purchaseId} and status = 'pending'`),
        SEAT(c, occurrenceId, 0),
        expirePurchase,
      ];
    };
  });
  if (!res.ok) return failOf(res);
  const ended = await db
    .select({ occurrenceId: booking.occurrenceId })
    .from(booking)
    .where(eq(booking.endedActionId, res.aid));
  return { ok: true, effects: syncEffects(ended.map((b) => b.occurrenceId)), released: ended.length > 0 };
}

/**
 * Nightly step 1 (E12). Batch: lock every occurrence with an elapsed hold (id
 * asc; EXISTS because Postgres refuses FOR NO KEY UPDATE with DISTINCT), expire those
 * bookings (aid), then release the seats in aggregate (N per occurrence; an
 * RDV at 0 is cancelled). No batch at all when nothing elapsed.
 */
export async function sweepHolds(db: Db, now: Date = new Date()): Promise<{ expiredBookings: number }> {
  const elapsed = sql`select o.id from occurrence o
    where exists (select 1 from booking b
                  where b.occurrence_id = o.id and b.status = 'pending' and b.hold_expires_at < ${ts(now)})`;
  const done = await atomic(db, async () => {
    const [pending] = await db
      .select({ n: count() })
      .from(booking)
      .where(and(eq(booking.status, "pending"), lt(booking.holdExpiresAt, now)));
    if (!pending || pending.n === 0) return () => [];
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      return [
        db.execute(sql`${elapsed} order by o.id for no key update`),
        expireElapsedHolds(c, elapsed),
        releaseEndedSeats(c),
      ];
    };
  });
  if (done.results.length === 0) return { expiredBookings: 0 };
  const [ended] = await db.select({ n: count() }).from(booking).where(eq(booking.endedActionId, done.aid));
  return { expiredBookings: ended?.n ?? 0 };
}

/**
 * Nightly step 2 (E11, E12): purchases still pending STALE_PURCHASE_GRACE_MINUTES
 * after checkout_expires_at, without processing_at, → expired. A payment that
 * still arrives is fulfilled from `expired` (E10).
 */
export async function expireStalePurchases(db: Db, now: Date = new Date()): Promise<{ expired: number }> {
  const cutoff = new Date(now.getTime() - STALE_PURCHASE_GRACE_MINUTES * 60_000);
  const rows = await db
    .update(ticketPurchase)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(ticketPurchase.status, "pending"),
        isNull(ticketPurchase.processingAt),
        lt(ticketPurchase.checkoutExpiresAt, cutoff),
      ),
    )
    .returning({ id: ticketPurchase.id });
  return { expired: rows.length };
}
