/**
 * Customers and the client file (spec § 11 E1, E8). Every statement filters
 * professional_id. Part 1 (Task 19): identity, « Offrir », balance. Part 2
 * (Task 29): convert, close, point, unpoint, move, type facts.
 */
import { and, asc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { G, PlanError, R, SEAT, lockRows, textArray, tryAtomic, ts, type BatchCtx, type Db, type Query } from "@/lib/db/atomic";
import { booking, customer, event, eventTicketType, occurrence, ticket, ticketType } from "@/lib/db/schema";
import { BOUNDS, customerInputSchema, normalizeEmail, type MovementKind, type TicketCloseReason, type TicketStatus } from "@/lib/tickets";
import { consumptionOrder, type TypeFacts } from "@/lib/wallet-rules";

import { assertNotBooked } from "./claims";
import { fail, failOf, syncEffects, type Effect, type EngineResult } from "./types";

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

/* ───────────────────── Task 29: ticket actions + move (E8) ───────────────────── */

/** Which tickets an action targets: explicit ids, or N of a type picked in JS. */
export type TicketSelection = { ticketIds: string[] } | { ticketTypeId: string; quantity: number };

type E8Ticket = {
  id: string;
  ticketTypeId: string;
  status: TicketStatus;
  expiresAt: Date | null;
  purchaseId: string | null;
  createdAt: Date;
  statusChangedAt: Date;
};

type E8Spec = {
  professionalId: string;
  customerId: string;
  selection: TicketSelection;
  now: Date;
  /** JS mirror of the statement's expected state */
  qualifies: (t: E8Ticket) => boolean;
  order: (tickets: E8Ticket[]) => E8Ticket[];
  /** ONE statement: WITH u AS (UPDATE ticket … RETURNING …) INSERT INTO ticket_movement … SELECT … FROM u */
  statement: (c: BatchCtx, picked: E8Ticket[]) => Query;
  /** runs at the start of every plan (re-plan included) */
  check?: () => Promise<void>;
  extraGuards?: (c: BatchCtx) => Query[];
  afterPlan?: () => Promise<void>;
};

const e8Valid = (t: E8Ticket, at: Date) => t.expiresAt === null || t.expiresAt.getTime() > at.getTime();

/** zod-free validation of a selection (1..BOUNDS.walletQuantity tickets). */
function e8SelectionOk(selection: TicketSelection): boolean {
  if ("ticketIds" in selection) {
    const n = new Set(selection.ticketIds).size;
    return n >= 1 && n <= BOUNDS.walletQuantity && n === selection.ticketIds.length;
  }
  return Number.isInteger(selection.quantity) && selection.quantity >= 1 && selection.quantity <= BOUNDS.walletQuantity;
}

/**
 * The E8 pattern (spec § 11 E8): pick ids in JS (plan), one transition +
 * movement statement, G(movements of aid = N, 'stale'); re-plans once on
 * stale; fewer than N qualifying tickets → no_ticket.
 */
async function e8Run(db: Db, spec: E8Spec): Promise<EngineResult<{ ticketIds: string[] }>> {
  if (!e8SelectionOk(spec.selection)) return fail("invalid");
  const picked: { ids: string[] } = { ids: [] };
  const res = await tryAtomic(
    db,
    async () => {
      if (spec.check) await spec.check();
      const [cust] = await db
        .select({ id: customer.id })
        .from(customer)
        .where(and(eq(customer.id, spec.customerId), eq(customer.professionalId, spec.professionalId)));
      if (!cust) throw new PlanError("not_found");
      const sel = spec.selection;
      const rows: E8Ticket[] = await db
        .select({
          id: ticket.id,
          ticketTypeId: ticket.ticketTypeId,
          status: ticket.status,
          expiresAt: ticket.expiresAt,
          purchaseId: ticket.purchaseId,
          createdAt: ticket.createdAt,
          statusChangedAt: ticket.statusChangedAt,
        })
        .from(ticket)
        .where(
          and(
            eq(ticket.professionalId, spec.professionalId),
            eq(ticket.customerId, spec.customerId),
            "ticketIds" in sel ? inArray(ticket.id, sel.ticketIds) : eq(ticket.ticketTypeId, sel.ticketTypeId),
          ),
        );
      if ("ticketIds" in sel && rows.length !== sel.ticketIds.length) throw new PlanError("not_found");
      const want = "ticketIds" in sel ? sel.ticketIds.length : sel.quantity;
      const chosen = spec.order(rows.filter(spec.qualifies)).slice(0, want);
      if (chosen.length < want) throw new PlanError("no_ticket");
      picked.ids = chosen.map((t) => t.id);
      return (aid) => {
        const c: BatchCtx = { db, aid, now: spec.now };
        return [
          spec.statement(c, chosen),
          G(db, sql`(select count(*)::int from ticket_movement where action_id = ${aid}) = ${want}::int`, "stale"),
          ...(spec.extraGuards ? spec.extraGuards(c) : []),
        ];
      };
    },
    { replanOnStale: true, afterPlan: spec.afterPlan },
  );
  if (!res.ok) return failOf(res);
  return { ok: true, effects: [], ticketIds: picked.ids };
}

/** Columns every E8 movement shares, from the CTE `u` (id, professional_id, customer_id, purchase_id). */
function e8Movement(
  c: BatchCtx,
  actorUserId: string,
  cols: { kind: MovementKind; from: SQL; to: SQL; type: SQL; fromType: SQL; reason: string | null },
): SQL {
  return sql`
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status, to_status,
      ticket_type_id, from_ticket_type_id, purchase_id, actor, actor_user_id, reason, created_at)
    select professional_id, customer_id, id, ${c.aid}, ${cols.kind}::movement_kind, ${cols.from}, ${cols.to},
      ${cols.type}, ${cols.fromType}, purchase_id, 'pro'::actor, ${actorUserId}, ${cols.reason}, ${ts(c.now)}
    from u`;
}

/**
 * Convertir A → B (keeps purchase_id and expires_at): available tickets valid
 * at now, `convert` movements with from_ticket_type_id; G(N); G(B active).
 */
export async function convertTickets(
  db: Db,
  input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection; toTicketTypeId: string },
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult<{ ticketIds: string[] }>> {
  const sel = input.selection;
  if (!("ticketIds" in sel) && sel.ticketTypeId === input.toTicketTypeId) {
    return fail("invalid", "Choisissez un autre type de ticket.");
  }
  return e8Run(db, {
    professionalId: input.professionalId,
    customerId: input.customerId,
    selection: sel,
    now,
    afterPlan: opts.afterPlan,
    async check() {
      const [to] = await db
        .select({ id: ticketType.id })
        .from(ticketType)
        .where(
          and(
            eq(ticketType.id, input.toTicketTypeId),
            eq(ticketType.professionalId, input.professionalId),
            isNull(ticketType.archivedAt),
          ),
        );
      if (!to) throw new PlanError("not_found");
    },
    qualifies: (t) => t.status === "available" && e8Valid(t, now) && t.ticketTypeId !== input.toTicketTypeId,
    order: consumptionOrder,
    statement: (c, picked) =>
      db.execute(sql`
        with u as (
          update ticket t set ticket_type_id = ${input.toTicketTypeId}, updated_at = ${ts(now)}
          from unnest(${textArray(picked.map((t) => t.id))}, ${textArray(picked.map((t) => t.ticketTypeId))}) as f(id, from_type)
          where t.id = f.id and t.professional_id = ${input.professionalId} and t.customer_id = ${input.customerId}
            and t.ticket_type_id = f.from_type and t.status = 'available'
            and (t.expires_at is null or t.expires_at > ${ts(now)})
          returning t.id, t.professional_id, t.customer_id, t.purchase_id, f.from_type
        )
        ${e8Movement(c, input.actorUserId, {
          kind: "convert",
          from: sql`'available'::ticket_status`,
          to: sql`'available'::ticket_status`,
          type: sql`${input.toTicketTypeId}`,
          fromType: sql`from_type`,
          reason: null,
        })}`),
    extraGuards: () => [
      G(
        db,
        sql`exists (select 1 from ticket_type where id = ${input.toTicketTypeId} and professional_id = ${input.professionalId} and archived_at is null)`,
        "stale",
      ),
    ],
  });
}

/**
 * Clore (rembourse | compense | autre + note) or Retirer (reason retire):
 * available → closed. A type selection picks only offered tickets for retire;
 * an explicit paid id with retire hits ticket_retire_paid_chk → retire_paid.
 */
export async function closeTickets(
  db: Db,
  input: {
    professionalId: string;
    actorUserId: string;
    customerId: string;
    selection: TicketSelection;
    reason: TicketCloseReason;
    note?: string | null;
  },
  now: Date = new Date(),
): Promise<EngineResult<{ ticketIds: string[] }>> {
  const note = input.note?.trim() || null;
  if (note !== null && note.length > BOUNDS.note) return fail("invalid");
  if (input.reason === "autre" && note === null) return fail("invalid", "Précisez le motif.");
  const byType = !("ticketIds" in input.selection);
  const offeredOnly = input.reason === "retire" && byType;
  return e8Run(db, {
    professionalId: input.professionalId,
    customerId: input.customerId,
    selection: input.selection,
    now,
    qualifies: (t) => t.status === "available" && (!offeredOnly || t.purchaseId === null),
    order: consumptionOrder,
    statement: (c, picked) =>
      db.execute(sql`
        with u as (
          update ticket set status = 'closed', closed_reason = ${input.reason}::ticket_close_reason, closed_note = ${note},
            status_changed_at = ${ts(now)}, updated_at = ${ts(now)}
          where professional_id = ${input.professionalId} and customer_id = ${input.customerId}
            and id = any(${textArray(picked.map((t) => t.id))}) and status = 'available'
            ${offeredOnly ? sql`and purchase_id is null` : sql``}
          returning id, professional_id, customer_id, purchase_id, ticket_type_id
        )
        ${e8Movement(c, input.actorUserId, {
          kind: "close",
          from: sql`'available'::ticket_status`,
          to: sql`'closed'::ticket_status`,
          type: sql`ticket_type_id`,
          fromType: sql`null`,
          reason: note,
        })}`),
  });
}

/** Pointer: available (valid at now) → used, `pointage` movement (the note goes to reason). */
export async function pointTickets(
  db: Db,
  input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection; note?: string | null },
  now: Date = new Date(),
): Promise<EngineResult<{ ticketIds: string[] }>> {
  const note = input.note?.trim() || null;
  if (note !== null && note.length > BOUNDS.note) return fail("invalid");
  return e8Run(db, {
    professionalId: input.professionalId,
    customerId: input.customerId,
    selection: input.selection,
    now,
    qualifies: (t) => t.status === "available" && e8Valid(t, now),
    order: consumptionOrder,
    statement: (c, picked) =>
      db.execute(sql`
        with u as (
          update ticket set status = 'used', status_changed_at = ${ts(now)}, updated_at = ${ts(now)}
          where professional_id = ${input.professionalId} and customer_id = ${input.customerId}
            and id = any(${textArray(picked.map((t) => t.id))}) and status = 'available'
            and (expires_at is null or expires_at > ${ts(now)})
          returning id, professional_id, customer_id, purchase_id, ticket_type_id
        )
        ${e8Movement(c, input.actorUserId, {
          kind: "pointage",
          from: sql`'available'::ticket_status`,
          to: sql`'used'::ticket_status`,
          type: sql`ticket_type_id`,
          fromType: sql`null`,
          reason: note,
        })}`),
  });
}

/**
 * Annuler le pointage: used → available, or expired when past expires_at
 * (like RET); `unpoint` movement. A type selection takes the most recently
 * pointed tickets first.
 */
export async function unpointTickets(
  db: Db,
  input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection },
  now: Date = new Date(),
): Promise<EngineResult<{ ticketIds: string[] }>> {
  return e8Run(db, {
    professionalId: input.professionalId,
    customerId: input.customerId,
    selection: input.selection,
    now,
    qualifies: (t) => t.status === "used",
    order: (tickets) =>
      [...tickets].sort((a, b) => b.statusChangedAt.getTime() - a.statusChangedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
    statement: (c, picked) =>
      db.execute(sql`
        with u as (
          update ticket set
            status = case when expires_at is not null and expires_at <= ${ts(now)} then 'expired'::ticket_status else 'available'::ticket_status end,
            status_changed_at = ${ts(now)}, updated_at = ${ts(now)}
          where professional_id = ${input.professionalId} and customer_id = ${input.customerId}
            and id = any(${textArray(picked.map((t) => t.id))}) and status = 'used'
          returning id, professional_id, customer_id, purchase_id, ticket_type_id, status
        )
        ${e8Movement(c, input.actorUserId, {
          kind: "unpoint",
          from: sql`'used'::ticket_status`,
          to: sql`status`,
          type: sql`ticket_type_id`,
          fromType: sql`null`,
          reason: null,
        })}`),
  });
}

/**
 * Déplacer un inscrit (confirmed booking) to another EVENT séance: lock both
 * occurrences (id asc); R both; SEAT(src, −1), SEAT(tgt, +1); move with
 * moved_at; G(moved, 'stale'); G(target scheduled ∧ event séance ∧ (coverage ≠
 * ticket ∨ its ticket's type accepted in tickets mode), 'not_eligible');
 * without force, G(ticket valid at the target start, 'ticket_expires_before').
 * assertNotBooked(target) sits between R(target) and SEAT(target, +1): a client
 * already on a full target is « already_booked », not « full » (ledger ruling Task 20).
 */
export async function moveAttendee(
  db: Db,
  input: { professionalId: string; actorUserId: string; bookingId: string; targetOccurrenceId: string; force: boolean },
  now: Date = new Date(),
): Promise<EngineResult<{ fromOccurrenceId: string }>> {
  const from = { id: "" };
  const res = await tryAtomic(db, async () => {
    const [b] = await db
      .select({
        id: booking.id,
        customerId: booking.customerId,
        occurrenceId: booking.occurrenceId,
        status: booking.status,
        coverage: booking.coverage,
        srcEventId: occurrence.eventId,
      })
      .from(booking)
      .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
      .where(and(eq(booking.id, input.bookingId), eq(booking.professionalId, input.professionalId)));
    if (!b) throw new PlanError("not_found");
    if (b.status !== "confirmed") throw new PlanError("stale");
    if (b.srcEventId === null) throw new PlanError("invalid", "Un rendez-vous ne se déplace pas : annulez-le puis réservez à nouveau.");
    if (b.occurrenceId === input.targetOccurrenceId) throw new PlanError("invalid");
    const [tgt] = await db
      .select({ id: occurrence.id, eventId: occurrence.eventId, status: occurrence.status, startsAt: occurrence.startsAt, bookingMode: event.bookingMode })
      .from(occurrence)
      .leftJoin(event, eq(event.id, occurrence.eventId))
      .where(and(eq(occurrence.id, input.targetOccurrenceId), eq(occurrence.professionalId, input.professionalId)));
    if (!tgt) throw new PlanError("not_found");
    if (tgt.eventId === null || tgt.status !== "scheduled") throw new PlanError("not_eligible");
    if (b.coverage === "ticket") {
      const [t] = await db
        .select({ ticketTypeId: ticket.ticketTypeId, expiresAt: ticket.expiresAt })
        .from(ticket)
        .where(eq(ticket.bookingId, b.id));
      if (!t) throw new PlanError("stale");
      const [link] = await db
        .select({ eventId: eventTicketType.eventId })
        .from(eventTicketType)
        .where(and(eq(eventTicketType.eventId, tgt.eventId), eq(eventTicketType.ticketTypeId, t.ticketTypeId)));
      if (!link || tgt.bookingMode !== "tickets") throw new PlanError("not_eligible");
      if (!input.force && t.expiresAt !== null && t.expiresAt.getTime() <= tgt.startsAt.getTime()) {
        throw new PlanError("ticket_expires_before");
      }
    }
    from.id = b.occurrenceId;
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const queries: Query[] = [
        lockRows(db, "occurrence", [b.occurrenceId, tgt.id]),
        R(c, b.occurrenceId),
        R(c, tgt.id),
        assertNotBooked(c, tgt.id, b.customerId),
        SEAT(c, b.occurrenceId, -1),
        SEAT(c, tgt.id, 1),
        db.execute(sql`
          update booking set occurrence_id = ${tgt.id}, moved_at = ${ts(now)}, updated_at = ${ts(now)}
          where id = ${b.id} and occurrence_id = ${b.occurrenceId} and professional_id = ${input.professionalId}
            and status = 'confirmed'`),
        G(db, sql`(select occurrence_id from booking where id = ${b.id} and status = 'confirmed') = ${tgt.id}`, "stale"),
        G(
          db,
          sql`exists (
            select 1 from booking bk
            join occurrence o on o.id = ${tgt.id}
            join event e on e.id = o.event_id
            where bk.id = ${b.id} and o.professional_id = ${input.professionalId} and o.status = 'scheduled'
              and (bk.coverage <> 'ticket' or (e.booking_mode = 'tickets' and exists (
                select 1 from ticket t
                join event_ticket_type l on l.event_id = o.event_id and l.ticket_type_id = t.ticket_type_id
                where t.booking_id = bk.id))))`,
          "not_eligible",
        ),
      ];
      if (!input.force) {
        queries.push(
          G(
            db,
            sql`not exists (select 1 from ticket t join occurrence o on o.id = ${tgt.id}
              where t.booking_id = ${b.id} and t.expires_at is not null and t.expires_at <= o.starts_at)`,
            "ticket_expires_before",
          ),
        );
      }
      return queries;
    };
  });
  if (!res.ok) return failOf(res);
  return {
    ok: true,
    effects: [
      { type: "email.attendee_moved", bookingId: input.bookingId, fromOccurrenceId: from.id },
      ...syncEffects([from.id, input.targetOccurrenceId]),
    ],
    fromOccurrenceId: from.id,
  };
}

/** One query per pro: the facts classifyTypes (src/lib/wallet-rules.ts) needs. */
export async function loadTypeFacts(db: Db, professionalId: string, now: Date = new Date()): Promise<TypeFacts[]> {
  const rows = await db
    .select({
      ticketTypeId: ticketType.id,
      archivedAt: ticketType.archivedAt,
      rdvEnabled: ticketType.rdvEnabled,
      // single-table select: an interpolated column renders unqualified, so the outer id is written out
      linked: sql<boolean>`exists (
        select 1 from event_ticket_type l
        join event e on e.id = l.event_id
        where l.ticket_type_id = ticket_type.id and e.booking_mode = 'tickets' and e.archived_at is null
          and exists (select 1 from occurrence o where o.event_id = e.id and o.status = 'scheduled' and o.starts_at > ${ts(now)}))`,
    })
    .from(ticketType)
    .where(eq(ticketType.professionalId, professionalId))
    .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id));
  return rows.map((r) => ({
    ticketTypeId: r.ticketTypeId,
    archived: r.archivedAt !== null,
    rdvEnabled: r.rdvEnabled,
    linkedToUpcomingEvent: r.linked === true,
  }));
}
