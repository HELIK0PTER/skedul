/**
 * E11: releasing seats held by unpaid checkouts (spec § 11). Correctness never
 * depends on the nightly job: R(o) also releases elapsed holds before every
 * claim on o, and E4 releases the RDVs it overlaps.
 */
import { and, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import {
  PlanError,
  SEAT,
  atomic,
  lockRows,
  releaseEndedSeats,
  textArray,
  ts,
  tryAtomic,
  type BatchCtx,
  type Db,
} from "@/lib/db/atomic";
import { booking, ticketPurchase } from "@/lib/db/schema";
import { STALE_PURCHASE_GRACE_MINUTES } from "@/lib/tickets";

import { expireElapsedHolds, lapsedHold } from "./holds";
import { failOf, syncEffects, type EngineResult, type SyncEffect } from "./types";

/**
 * Idempotent. Callers (P4): the `checkout.session.expired` and
 * `async_payment_failed` webhooks, « Libérer ma place » (after
 * sessions.expire), a Stripe error right after E1/E4. Batch: lock the
 * booking's occurrence; booking pending → expired (aid); SEAT(o, 0) (an RDV
 * at 0 is cancelled); purchase pending → expired. A paid purchase is left
 * alone. Effects: google.sync_occurrence when a booking ended. Errors: not_found.
 * Caller precondition (OUT:74): `purchaseId` is server-derived, or a `?p=`
 * reference already checked against the page's pro by purchaseByReference and,
 * when a wallet owner is signed in, against its customer.
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

export type SweepReport = {
  expiredBookings: number;
  /** one Google re-sync per occurrence that had a hold released (an RDV left at 0 seats is cancelled) */
  effects: SyncEffect[];
  /** "occurrence <id>: <message>" for each occurrence whose batch threw; the next occurrences still ran */
  failures: string[];
};

/**
 * Nightly step 1 (E12). Reads the occurrences with an elapsed hold (id asc), then ONE batch per occurrence (P6 A16:
 * a drifted séance no longer blocks the others): lock it, expire its elapsed holds (aid), release those seats (an RDV
 * at 0 is cancelled). A batch that throws is reported in `failures` and wrote nothing; the next occurrence still
 * runs. Effects: google.sync_occurrence for each occurrence that had a hold released, as releasePurchase does.
 */
export async function sweepHolds(db: Db, now: Date = new Date()): Promise<SweepReport> {
  const elapsed = await db.execute<{ id: string }>(sql`select o.id from occurrence o
    where exists (select 1 from booking b where b.occurrence_id = o.id and ${lapsedHold(now, sql`b`)})
    order by o.id`);
  const aids: string[] = [];
  const failures: string[] = [];
  for (const { id } of elapsed.rows) {
    try {
      const done = await atomic(db, async () => (aid) => {
        const c: BatchCtx = { db, aid, now };
        return [
          lockRows(db, "occurrence", [id]),
          expireElapsedHolds(c, sql`select unnest(${textArray([id])})`),
          releaseEndedSeats(c),
        ];
      });
      aids.push(done.aid);
    } catch (err) {
      failures.push(`occurrence ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (aids.length === 0) return { expiredBookings: 0, effects: [], failures };
  const ended = await db
    .select({ occurrenceId: booking.occurrenceId, n: count() })
    .from(booking)
    .where(inArray(booking.endedActionId, aids))
    .groupBy(booking.occurrenceId)
    .orderBy(booking.occurrenceId);
  return {
    expiredBookings: ended.reduce((sum, r) => sum + r.n, 0),
    effects: syncEffects(ended.map((r) => r.occurrenceId)),
    failures,
  };
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
