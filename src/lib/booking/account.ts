/** E13 (spec § 11): what deleteUser (P3, src/server/admin.ts) reads before `DELETE FROM "user"`. */
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import { ts, type Db } from "@/lib/db/atomic";
import { ticketPurchase } from "@/lib/db/schema";

/** Pending purchases of the pro with a Checkout session to expire (best effort, before the delete). */
export async function pendingCheckoutSessions(
  db: Db,
  professionalId: string,
): Promise<{ purchaseId: string; checkoutSessionId: string }[]> {
  const rows = await db
    .select({ purchaseId: ticketPurchase.id, checkoutSessionId: ticketPurchase.checkoutSessionId })
    .from(ticketPurchase)
    .where(
      and(
        eq(ticketPurchase.professionalId, professionalId),
        eq(ticketPurchase.status, "pending"),
        isNotNull(ticketPurchase.checkoutSessionId),
      ),
    )
    .orderBy(asc(ticketPurchase.id));
  return rows.flatMap((r) => (r.checkoutSessionId ? [{ purchaseId: r.purchaseId, checkoutSessionId: r.checkoutSessionId }] : []));
}

/**
 * delete-user-card impact: usable tickets in circulation (available, not
 * expired at now) and payments still in progress (pending with an open
 * checkout, or an asynchronous payment being processed).
 */
export async function deletionImpact(
  db: Db,
  professionalId: string,
  now: Date = new Date(),
): Promise<{ ticketsInCirculation: number; pendingPayments: number }> {
  const res = await db.execute<{ tickets: number; payments: number }>(sql`
    select
      (select count(*)::int from ticket where professional_id = ${professionalId} and status = 'available'
        and (expires_at is null or expires_at > ${ts(now)})) as tickets,
      (select count(*)::int from ticket_purchase where professional_id = ${professionalId} and status = 'pending'
        and (checkout_expires_at > ${ts(now)} or processing_at is not null)) as payments`);
  const row = res.rows[0];
  return { ticketsInCirculation: Number(row?.tickets ?? 0), pendingPayments: Number(row?.payments ?? 0) };
}
