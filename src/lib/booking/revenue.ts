/**
 * « Encaissé » (spec § 9): ONE predicate over ticket_purchase, shared by the
 * dashboard, /dashboard/payments and admin-queries.ts (re-exported by
 * src/server/revenue.ts in P3). Mock and Stripe test keys write
 * livemode = false, live keys livemode = true: the caller passes `live` from
 * the Stripe mode in use, so test environments still show figures.
 */
import { asc, sql, type SQL } from "drizzle-orm";

import { ts, type Db } from "@/lib/db/atomic";
import { ticketPurchase } from "@/lib/db/schema";

export type RevenueScope = { live: boolean; professionalId?: string; since?: Date };

/**
 * status = 'paid' AND livemode = live [AND professional_id] [AND paid_at ≥ since].
 * Columns are qualified with "ticket_purchase": use it in queries on that
 * table without an alias.
 */
export function paidPurchaseOf(opts: RevenueScope): SQL {
  const parts: SQL[] = [
    sql`${ticketPurchase.status} = 'paid'`,
    sql`${ticketPurchase.livemode} = ${opts.live}`,
  ];
  if (opts.professionalId) parts.push(sql`${ticketPurchase.professionalId} = ${opts.professionalId}`);
  if (opts.since) parts.push(sql`${ticketPurchase.paidAt} >= ${ts(opts.since)}`);
  return sql`(${sql.join(parts, sql` and `)})`;
}

/** Σ amount_cents of the paid purchases in scope, per currency (ordered by currency). */
export async function revenueByCurrency(db: Db, opts: RevenueScope): Promise<{ currency: string; cents: number }[]> {
  return db
    .select({
      currency: ticketPurchase.currency,
      cents: sql<number>`coalesce(sum(${ticketPurchase.amountCents}), 0)`.mapWith(Number),
    })
    .from(ticketPurchase)
    .where(paidPurchaseOf(opts))
    .groupBy(ticketPurchase.currency)
    .orderBy(asc(ticketPurchase.currency));
}
