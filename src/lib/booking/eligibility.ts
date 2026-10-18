/**
 * THE eligibility rule (spec § 9), one SQL fragment shared by the spend (E2,
 * E4) and the « utilisable ici » reads. Links are read live: an inner EXISTS on
 * event_ticket_type, so an empty list accepts nobody.
 */
import { sql, type SQL } from "drizzle-orm";

import { G, ts, type ActorRef, type BatchCtx, type Db, type Query } from "@/lib/db/atomic";

/**
 * Over the aliases t = ticket, tt = its ticket_type, o = occurrence, e = event
 * LEFT JOINed on o.event_id. Valid AT THE SÉANCE (expires_at > o.starts_at),
 * not at now: the pro may register someone on a past séance.
 */
export const ELIGIBLE: SQL = sql`(
  t.status = 'available' and tt.archived_at is null
  and (t.expires_at is null or t.expires_at > o.starts_at)
  and (
    (o.event_id is not null and e.booking_mode = 'tickets'
      and exists (select 1 from event_ticket_type l where l.event_id = o.event_id and l.ticket_type_id = t.ticket_type_id))
    or (o.event_id is null and o.ticket_type_id = t.ticket_type_id and tt.rdv_enabled and not tt.rdv_free)
  )
)`;

/** The FROM clause ELIGIBLE expects, for one customer and one occurrence. */
function eligibleFrom(customerId: string, occurrenceId: string): SQL {
  return sql`from ticket t
    join ticket_type tt on tt.id = t.ticket_type_id
    join occurrence o on o.id = ${occurrenceId}
    left join event e on e.id = o.event_id
    where t.customer_id = ${customerId} and t.professional_id = o.professional_id and ${ELIGIBLE}`;
}

const CONSUMPTION_ORDER = sql`order by t.expires_at asc nulls last, t.created_at, t.id`;

/**
 * Scalar subquery: the ticket to spend (consumption order: soonest expiry,
 * then oldest), or the forced `ticketId` if it is eligible. FOR NO KEY UPDATE OF t
 * SKIP LOCKED: two concurrent spends never pick the same row; NULL when none.
 */
export function pickTicket(args: { customerId: string; occurrenceId: string; ticketId?: string | null }): SQL {
  const forced = args.ticketId ? sql` and t.id = ${args.ticketId}` : sql``;
  return sql`(select t.id ${eligibleFrom(args.customerId, args.occurrenceId)}${forced}
    ${CONSUMPTION_ORDER}
    limit 1
    for no key update of t skip locked)`;
}

/**
 * One statement: book the picked ticket on `bookingId` and write its `spend`
 * movement (marked with the action id). The booking INSERT must come before
 * it in the batch (FK); follow with assertSpent.
 */
export function spendTicket(
  c: BatchCtx,
  args: { bookingId: string; customerId: string; occurrenceId: string; ticketId?: string | null; by: ActorRef },
): Query {
  return c.db.execute(sql`
    with u as (
      update ticket set status = 'booked', booking_id = ${args.bookingId},
        status_changed_at = ${ts(c.now)}, updated_at = ${ts(c.now)}
      where id = ${pickTicket(args)} and status = 'available'
      returning id, professional_id, customer_id, ticket_type_id, purchase_id
    )
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status,
      to_status, ticket_type_id, booking_id, purchase_id, actor, actor_user_id, created_at)
    select professional_id, customer_id, id, ${c.aid}, 'spend', 'available', 'booked',
      ticket_type_id, ${args.bookingId}, purchase_id, ${args.by.actor}::actor, ${args.by.userId}, ${ts(c.now)}
    from u`);
}

/** G(a ticket is booked on this booking, 'no_ticket'). */
export function assertSpent(c: BatchCtx, bookingId: string): Query {
  return G(c.db, sql`exists (select 1 from ticket where booking_id = ${bookingId})`, "no_ticket");
}

/** « Utilisable ici »: the customer's eligible tickets for the occurrence, in consumption order, without lock. */
export async function usableTickets(
  db: Db,
  args: { customerId: string; occurrenceId: string },
): Promise<{ id: string; ticketTypeId: string; expiresAt: Date | null; purchaseId: string | null }[]> {
  const res = await db.execute<{
    id: string;
    ticket_type_id: string;
    expires_at: string | null;
    purchase_id: string | null;
  }>(sql`select t.id, t.ticket_type_id, t.expires_at, t.purchase_id
    ${eligibleFrom(args.customerId, args.occurrenceId)}
    ${CONSUMPTION_ORDER}`);
  return res.rows.map((r) => ({
    id: r.id,
    ticketTypeId: r.ticket_type_id,
    expiresAt: r.expires_at === null ? null : new Date(r.expires_at),
    purchaseId: r.purchase_id,
  }));
}
