/**
 * Customers and the client file (spec § 11 E1, E8). Every statement filters
 * professional_id. Part 1 (Task 19): identity, « Offrir », balance. Part 2
 * (Task 29): convert, close, point, unpoint, move, type facts.
 */
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { G, PlanError, textArray, tryAtomic, ts, type Db } from "@/lib/db/atomic";
import { customer, ticket, ticketType } from "@/lib/db/schema";
import { BOUNDS, customerInputSchema, normalizeEmail } from "@/lib/tickets";

import { fail, failOf, type Effect, type EngineResult } from "./types";

const customerExists = (professionalId: string, customerId: string) =>
  sql`exists (select 1 from customer where id = ${customerId} and professional_id = ${professionalId})`;

/**
 * Anonymous identity (E1, E3, E4, E9), ONE statement: insert, or on
 * (professional_id, email) fill only the blanks: phone and user_id are
 * COALESCEd, the name is NEVER overwritten by anonymous input. `userId` only
 * when a verified session carries the same e-mail (the caller checks). The
 * caller validated the input (customerInputSchema); a CHECK error throws.
 */
export async function upsertCustomer(
  db: Db,
  input: { professionalId: string; email: string; name: string; phone?: string | null; userId?: string | null },
  now: Date = new Date(),
): Promise<{ customerId: string }> {
  const res = await db.execute<{ id: string }>(sql`
    insert into customer (id, professional_id, email, name, phone, user_id, link_version, created_at, updated_at)
    values (${nanoid()}, ${input.professionalId}, ${normalizeEmail(input.email)}, ${input.name.trim()},
      ${input.phone?.trim() || null}, ${input.userId ?? null}, 1, ${ts(now)}, ${ts(now)})
    on conflict (professional_id, email) do update set
      phone = coalesce(customer.phone, excluded.phone),
      user_id = coalesce(customer.user_id, excluded.user_id),
      updated_at = excluded.updated_at
    returning id`);
  return { customerId: res.rows[0].id };
}

/**
 * « Nouveau client » (pro): the same upsert, but the pro's name wins, and the
 * phone too when one is given. `created` = a new row. Errors: invalid.
 */
export async function createCustomer(
  db: Db,
  input: { professionalId: string; name: string; email: string; phone?: string | null },
  now: Date = new Date(),
): Promise<EngineResult<{ customerId: string; created: boolean }>> {
  const parsed = customerInputSchema.safeParse({
    name: input.name,
    email: input.email.trim(),
    phone: input.phone ?? undefined,
  });
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const { name, email } = parsed.data;
  const phone = parsed.data.phone || null;
  const res = await tryAtomic(db, async () => () => [
    db.execute(sql`
      insert into customer (id, professional_id, email, name, phone, link_version, created_at, updated_at)
      values (${nanoid()}, ${input.professionalId}, ${email}, ${name}, ${phone}, 1, ${ts(now)}, ${ts(now)})
      on conflict (professional_id, email) do update set
        name = excluded.name,
        phone = coalesce(excluded.phone, customer.phone),
        updated_at = excluded.updated_at
      returning id, (xmax = 0) as created`),
  ]);
  if (!res.ok) return failOf(res);
  const [row] = (res.results[0] as { rows: { id: string; created: boolean }[] }).rows;
  return { ok: true, effects: [], customerId: row.id, created: row.created };
}

const customerEditSchema = z.object({
  name: z.string().trim().min(1).max(BOUNDS.name),
  phone: z.string().trim().max(BOUNDS.phone).nullable(),
});

/** « Modifier nom / téléphone ». Errors: invalid, not_found. */
export async function updateCustomer(
  db: Db,
  input: { professionalId: string; customerId: string; name: string; phone: string | null },
  now: Date = new Date(),
): Promise<EngineResult> {
  const parsed = customerEditSchema.safeParse({ name: input.name, phone: input.phone });
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const res = await tryAtomic(db, async () => () => [
    db
      .update(customer)
      .set({ name: parsed.data.name, phone: parsed.data.phone || null, updatedAt: now })
      .where(and(eq(customer.id, input.customerId), eq(customer.professionalId, input.professionalId))),
    G(db, customerExists(input.professionalId, input.customerId), "not_found"),
  ]);
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/** « Déconnecter ses liens »: link_version + 1 revokes every personal link of the customer. Errors: not_found. */
export async function revokeLinks(
  db: Db,
  input: { professionalId: string; customerId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ linkVersion: number }>> {
  const res = await tryAtomic(db, async () => () => [
    db.execute(sql`
      update customer set link_version = link_version + 1, updated_at = ${ts(now)}
      where id = ${input.customerId} and professional_id = ${input.professionalId}
      returning link_version`),
    G(db, customerExists(input.professionalId, input.customerId), "not_found"),
  ]);
  if (!res.ok) return failOf(res);
  const [row] = (res.results[0] as { rows: { link_version: number }[] }).rows;
  return { ok: true, effects: [], linkVersion: row.link_version };
}

/**
 * « Offrir N » (E8): N tickets (JS ids, purchase_id NULL, available, optional
 * expiry) for a customer of the pro, of an active type of the pro, and their
 * `offer` movements, in ONE statement; then G(N movements for this action,
 * 'stale'). Effects: email.tickets_offered when `notify`.
 * Errors: invalid (quantity, expiry not in the future, note too long), not_found, stale.
 */
export async function offerTickets(
  db: Db,
  input: {
    professionalId: string;
    actorUserId: string;
    customerId: string;
    ticketTypeId: string;
    quantity: number;
    expiresAt: Date | null;
    reason?: string | null;
    notify: boolean;
  },
  now: Date = new Date(),
): Promise<EngineResult<{ ticketIds: string[] }>> {
  const n = input.quantity;
  if (!Number.isInteger(n) || n < 1 || n > BOUNDS.walletQuantity) return fail("invalid");
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return fail("invalid");
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > BOUNDS.note) return fail("invalid");
  const p = input.professionalId;
  const ticketIds = Array.from({ length: n }, () => nanoid());
  const expiresAt = input.expiresAt ? ts(input.expiresAt) : sql`null::timestamptz`;

  const res = await tryAtomic(db, async () => {
    const [c] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, input.customerId), eq(customer.professionalId, p)));
    const [t] = await db
      .select({ id: ticketType.id })
      .from(ticketType)
      .where(and(eq(ticketType.id, input.ticketTypeId), eq(ticketType.professionalId, p), isNull(ticketType.archivedAt)));
    if (!c || !t) throw new PlanError("not_found");
    return (aid) => [
      db.execute(sql`
        with t as (
          insert into ticket (id, professional_id, customer_id, ticket_type_id, purchase_id, status, booking_id,
            expires_at, status_changed_at, created_at, updated_at)
          select x.id, c.professional_id, c.id, tt.id, null, 'available'::ticket_status, null,
            ${expiresAt}, ${ts(now)}, ${ts(now)}, ${ts(now)}
          from unnest(${textArray(ticketIds)}) as x(id)
          join customer c on c.id = ${input.customerId} and c.professional_id = ${p}
          join ticket_type tt on tt.id = ${input.ticketTypeId} and tt.professional_id = ${p} and tt.archived_at is null
          returning id, professional_id, customer_id, ticket_type_id
        )
        insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status, to_status,
          ticket_type_id, actor, actor_user_id, reason, created_at)
        select professional_id, customer_id, id, ${aid}, 'offer'::movement_kind, null, 'available'::ticket_status,
          ticket_type_id, 'pro'::actor, ${input.actorUserId}, ${reason}, ${ts(now)}
        from t`),
      G(db, sql`(select count(*)::int from ticket_movement where action_id = ${aid}) = ${n}::int`, "stale"),
    ];
  });
  if (!res.ok) return failOf(res);
  const effects: Effect[] = input.notify
    ? [{ type: "email.tickets_offered", customerId: input.customerId, actionId: res.aid, quantity: n }]
    : [];
  return { ok: true, effects, ticketIds };
}

/**
 * Usable tickets per type (the balance predicate of spec § 9: available and
 * not expired at `now`), with the soonest expiry; ordered by type id.
 */
export async function walletBalance(
  db: Db,
  input: { professionalId: string; customerId: string },
  now: Date = new Date(),
): Promise<{ ticketTypeId: string; usable: number; nextExpiry: Date | null }[]> {
  return db
    .select({
      ticketTypeId: ticket.ticketTypeId,
      usable: sql<number>`count(*)::int`,
      nextExpiry: sql<Date | null>`min(${ticket.expiresAt})`.mapWith(ticket.expiresAt),
    })
    .from(ticket)
    .where(
      and(
        eq(ticket.professionalId, input.professionalId),
        eq(ticket.customerId, input.customerId),
        eq(ticket.status, "available"),
        or(isNull(ticket.expiresAt), gt(ticket.expiresAt, now)),
      ),
    )
    .groupBy(ticket.ticketTypeId)
    .orderBy(asc(ticket.ticketTypeId));
}
