/**
 * Invariants I1 to I6 (spec § 14), checked after every DB test
 * (src/test/db.ts) and every night (runNightly), plus I7 (same tenant) on the
 * unscoped nightly run only. Each invariant is ONE
 * read-only statement (one snapshot); they run in one db.batch, so one
 * round trip. [] = consistent.
 */
import { sql, type SQL } from "drizzle-orm";

import type { Db, Query } from "@/lib/db/atomic";

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7";
export type InvariantViolation = { invariant: InvariantId; rowId: string; detail: string };

type Row = { invariant: InvariantId; row_id: string; detail: string };

/**
 * I7, same tenant: every domain foreign key is single-column (no composite (professional_id, id) key), so the database
 * accepts a row of one pro that points at a row of another. Each link below is checked by the nightly run, which is
 * unscoped; the per-pro check after every DB test skips I7, because many tests build such a row on purpose to prove a
 * guard refuses it. A pure test keeps the list equal to the schema's domain foreign keys.
 */
export const SAME_TENANT_LINKS: readonly { child: string; column: string; parent: string }[] = [
  { child: "ticket_offer", column: "ticket_type_id", parent: "ticket_type" },
  { child: "availability_rule", column: "ticket_type_id", parent: "ticket_type" },
  { child: "event_ticket_type", column: "event_id", parent: "event" },
  { child: "event_ticket_type", column: "ticket_type_id", parent: "ticket_type" },
  { child: "question", column: "event_id", parent: "event" },
  { child: "question", column: "ticket_type_id", parent: "ticket_type" },
  { child: "occurrence", column: "event_id", parent: "event" },
  { child: "occurrence", column: "ticket_type_id", parent: "ticket_type" },
  { child: "ticket_purchase", column: "customer_id", parent: "customer" },
  { child: "ticket_purchase", column: "offer_id", parent: "ticket_offer" },
  { child: "ticket_purchase", column: "ticket_type_id", parent: "ticket_type" },
  { child: "booking", column: "occurrence_id", parent: "occurrence" },
  { child: "booking", column: "customer_id", parent: "customer" },
  { child: "booking", column: "purchase_id", parent: "ticket_purchase" },
  { child: "booking_answer", column: "booking_id", parent: "booking" },
  { child: "booking_answer", column: "question_id", parent: "question" },
  { child: "ticket", column: "customer_id", parent: "customer" },
  { child: "ticket", column: "ticket_type_id", parent: "ticket_type" },
  { child: "ticket", column: "purchase_id", parent: "ticket_purchase" },
  { child: "ticket", column: "booking_id", parent: "booking" },
  { child: "ticket_movement", column: "customer_id", parent: "customer" },
  { child: "ticket_movement", column: "ticket_id", parent: "ticket" },
  { child: "ticket_movement", column: "ticket_type_id", parent: "ticket_type" },
  { child: "ticket_movement", column: "from_ticket_type_id", parent: "ticket_type" },
  { child: "ticket_movement", column: "booking_id", parent: "booking" },
  { child: "ticket_movement", column: "purchase_id", parent: "ticket_purchase" },
];

/** The I7 statement: one UNION ALL over SAME_TENANT_LINKS (identifiers are the constants above, never input). */
function sameTenantStatement(): SQL {
  const parts = SAME_TENANT_LINKS.map(({ child, column, parent }) => {
    // event_ticket_type has no id column: its key is (event_id, ticket_type_id).
    const rowId = child === "event_ticket_type" ? "c.event_id || '/' || c.ticket_type_id" : "c.id";
    return sql.raw(`select 'I7' as invariant, ${rowId} as row_id,
        '${child}.${column} ' || c.${column} || ' belongs to another pro' as detail
      from ${child} c join ${parent} p on p.id = c.${column}
      where p.professional_id <> c.professional_id`);
  });
  return sql`${sql.join(parts, sql` union all `)} order by row_id, detail`;
}

export async function checkInvariants(db: Db, opts: { proId?: string } = {}): Promise<InvariantViolation[]> {
  const pro = (alias: string): SQL =>
    opts.proId ? sql`and ${sql.raw(alias)}.professional_id = ${opts.proId}` : sql``;

  const statements: Query[] = [
    // I1: seats_taken = pending + confirmed bookings
    db.execute<Row>(sql`
      select 'I1' as invariant, o.id as row_id,
        'seats_taken ' || o.seats_taken || ' but ' || a.n || ' active bookings' as detail
      from occurrence o
      cross join lateral (
        select count(*)::int as n from booking b
        where b.occurrence_id = o.id and b.status in ('pending', 'confirmed')
      ) a
      where o.seats_taken <> a.n ${pro("o")}
      order by o.id`),
    // I2a: a booked ticket points at a confirmed `ticket` booking of the same customer
    db.execute<Row>(sql`
      select 'I2' as invariant, t.id as row_id,
        'booked ticket on booking ' || coalesce(b.id, 'missing') || ' (' || coalesce(b.status::text, '-')
          || ', ' || coalesce(b.coverage::text, '-') || ')' as detail
      from ticket t
      left join booking b on b.id = t.booking_id
      where t.status = 'booked'
        and (b.id is null or b.status <> 'confirmed' or b.coverage <> 'ticket' or b.customer_id <> t.customer_id)
        ${pro("t")}
      order by t.id`),
    // I2b: a confirmed `ticket` booking has a booked ticket
    db.execute<Row>(sql`
      select 'I2' as invariant, b.id as row_id, 'confirmed ticket booking without a booked ticket' as detail
      from booking b
      where b.status = 'confirmed' and b.coverage = 'ticket'
        and not exists (select 1 from ticket t where t.booking_id = b.id and t.status = 'booked')
        ${pro("b")}
      order by b.id`),
    // I3: paid → exactly `quantity` tickets; not paid → none
    db.execute<Row>(sql`
      select 'I3' as invariant, p.id as row_id,
        p.status || ' purchase of ' || p.quantity || ' with ' || c.n || ' tickets' as detail
      from ticket_purchase p
      cross join lateral (select count(*)::int as n from ticket t where t.purchase_id = p.id) c
      where ((p.status = 'paid' and c.n <> p.quantity) or (p.status <> 'paid' and c.n > 0)) ${pro("p")}
      order by p.id`),
    // I4: the last movement (by seq) matches the ticket's status and type
    db.execute<Row>(sql`
      select 'I4' as invariant, t.id as row_id,
        case when m.id is null then 'no movement'
          else 'last movement ' || m.kind || ' to ' || m.to_status || '/' || m.ticket_type_id
            || ' but ticket is ' || t.status || '/' || t.ticket_type_id end as detail
      from ticket t
      left join lateral (
        select mv.id, mv.kind, mv.to_status, mv.ticket_type_id from ticket_movement mv
        where mv.ticket_id = t.id order by mv.seq desc limit 1
      ) m on true
      where (m.id is null or m.to_status <> t.status or m.ticket_type_id <> t.ticket_type_id) ${pro("t")}
      order by t.id`),
    // I5a: no active booking on a cancelled occurrence
    db.execute<Row>(sql`
      select 'I5' as invariant, b.id as row_id, 'active booking on cancelled occurrence ' || o.id as detail
      from booking b
      join occurrence o on o.id = b.occurrence_id
      where o.status = 'cancelled' and b.status in ('pending', 'confirmed') ${pro("b")}
      order by b.id`),
    // I5b: an RDV is scheduled exactly when its one seat is taken
    db.execute<Row>(sql`
      select 'I5' as invariant, o.id as row_id, 'RDV ' || o.status || ' with seats_taken ' || o.seats_taken as detail
      from occurrence o
      where o.event_id is null and (o.status = 'scheduled') <> (o.seats_taken = 1) ${pro("o")}
      order by o.id`),
    // I6: paid → paid_at and fulfilled_action_id; livemode → payment_intent_id
    db.execute<Row>(sql`
      select 'I6' as invariant, p.id as row_id,
        case when p.status = 'paid' and p.paid_at is null then 'paid without paid_at'
          when p.status = 'paid' and p.fulfilled_action_id is null then 'paid without fulfilled_action_id'
          else 'livemode without payment_intent_id' end as detail
      from ticket_purchase p
      where ((p.status = 'paid' and (p.paid_at is null or p.fulfilled_action_id is null))
        or (p.livemode and p.payment_intent_id is null)) ${pro("p")}
      order by p.id`),
  ];
  if (!opts.proId) statements.push(db.execute<Row>(sameTenantStatement()));

  const results = (await db.batch(statements as [Query, ...Query[]])) as { rows: Row[] }[];
  return results.flatMap((r) =>
    r.rows.map((row) => ({ invariant: row.invariant, rowId: row.row_id, detail: row.detail })),
  );
}
