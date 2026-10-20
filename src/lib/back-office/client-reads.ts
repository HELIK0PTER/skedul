/**
 * Client reads (spec § 9, § 13.1): the list with its filters and counts, the
 * alert counts of the overview and the client record. Every statement filters
 * professional_id; no `server-only`, no `next/*`, no `@/lib/db` index, so the
 * DB harness can test it. The list facts are plain counts (no dates), read with
 * raw SQL; everything that returns an instant goes through the query builder
 * (the neon-http driver returns raw timestamps as strings).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { listActiveTypeOptions, type TypeOption } from "@/lib/back-office/catalog-reads";
import {
  CLIENT_FILTERS,
  isListedClient,
  matchesClientFilter,
  type ClientFacts,
  type ClientFilter,
} from "@/lib/back-office/client-filters";
import { formatWhen, planningHref } from "@/lib/back-office/format";
import { historyLines, type HistoryLine, type LedgerMovementRow } from "@/lib/back-office/history";
import { groupWallet, type WalletGroup, type WalletTypeRow } from "@/lib/back-office/wallet-view";
import { loadTypeFacts } from "@/lib/booking/wallet";
import { ts, type Db } from "@/lib/db/atomic";
import {
  booking,
  customer,
  event,
  occurrence,
  professional,
  ticket,
  ticketMovement,
  ticketPurchase,
  ticketType,
} from "@/lib/db/schema";
import type { BookingCoverage, BookingStatus, OccurrenceStatus, PurchaseStatus } from "@/lib/tickets-vocab";
import { classifyTypes, customerAlerts } from "@/lib/wallet-rules";

/** Decision 30: the list shows at most this many clients. */
export const CLIENT_LIST_LIMIT = 500;
/** The record reads the newest bookings only (every upcoming one is among them). */
export const RECORD_BOOKINGS_MAX = 300;
/** « Passées »: at most this many past bookings on a record. */
export const PAST_BOOKINGS_MAX = 50;
/** The record reads the newest ledger movements only (whole actions: see wholeActions). */
export const HISTORY_MAX_MOVEMENTS = 3000;

/** « %q% » for `ILIKE … ESCAPE '!'`: `!`, `%` and `_` typed by the pro are literal characters. */
export function likePattern(q: string): string {
  return `%${q.replace(/[!%_]/g, "!$&")}%`;
}

export type ClientListRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  linkedAccount: boolean;
  holdings: { ticketTypeId: string; name: string; color: string; archived: boolean; usable: number }[];
  usableTickets: number;
  upcomingConfirmed: number;
  red: boolean;
  orange: boolean;
};

type FactsRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  linked: boolean;
  tickets_any: number;
  bookings_any: number;
  confirmed_bookings: number;
  upcoming_confirmed: number;
  purchases_any: number;
  matches_q: boolean;
};

type HeldRow = { customer_id: string; ticket_type_id: string; usable: number };

type Snapshot = { row: ClientListRow; facts: ClientFacts; matchesQ: boolean };

/**
 * Every LISTED client of the pro (isListedClient), in list order (lower(name),
 * id), with its facts and whether it matches `q`. Four queries in parallel:
 * per-customer counts, usable holdings, the types, the type facts.
 */
async function loadSnapshots(db: Db, professionalId: string, now: Date, q: string): Promise<Snapshot[]> {
  const p = professionalId;
  const matches =
    q === ""
      ? sql`true`
      : sql`(c.name ilike ${likePattern(q)} escape '!' or c.email ilike ${likePattern(q)} escape '!')`;
  const [factsRes, heldRes, types, typeFacts] = await Promise.all([
    db.execute<FactsRow>(sql`
      with tk as (
        select customer_id, count(*)::int as n from ticket where professional_id = ${p} group by customer_id
      ), bk as (
        select b.customer_id,
          count(*)::int as any_n,
          count(*) filter (where b.status = 'confirmed')::int as confirmed_n,
          count(*) filter (where b.status = 'confirmed' and o.status = 'scheduled' and o.starts_at > ${ts(now)})::int as upcoming_n
        from booking b join occurrence o on o.id = b.occurrence_id and o.professional_id = b.professional_id
        where b.professional_id = ${p}
        group by b.customer_id
      ), pu as (
        select customer_id, count(*)::int as n from ticket_purchase where professional_id = ${p} group by customer_id
      )
      select c.id, c.name, c.email, c.phone, (c.user_id is not null) as linked,
        coalesce(tk.n, 0) as tickets_any, coalesce(bk.any_n, 0) as bookings_any,
        coalesce(bk.confirmed_n, 0) as confirmed_bookings, coalesce(bk.upcoming_n, 0) as upcoming_confirmed,
        coalesce(pu.n, 0) as purchases_any, ${matches} as matches_q
      from customer c
      left join tk on tk.customer_id = c.id
      left join bk on bk.customer_id = c.id
      left join pu on pu.customer_id = c.id
      where c.professional_id = ${p}
      order by lower(c.name), c.id`),
    db.execute<HeldRow>(sql`
      select customer_id, ticket_type_id, count(*)::int as usable
      from ticket
      where professional_id = ${p} and status = 'available' and (expires_at is null or expires_at > ${ts(now)})
      group by customer_id, ticket_type_id`),
    db
      .select({ id: ticketType.id, name: ticketType.name, color: ticketType.color, archivedAt: ticketType.archivedAt })
      .from(ticketType)
      .where(eq(ticketType.professionalId, p))
      .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id)),
    loadTypeFacts(db, p, now),
  ]);
  const classes = classifyTypes(typeFacts);
  const typeOrder = new Map(types.map((t, i) => [t.id, i]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const heldBy = new Map<string, { ticketTypeId: string; usable: number }[]>();
  for (const h of heldRes.rows) {
    const list = heldBy.get(h.customer_id) ?? [];
    list.push({ ticketTypeId: h.ticket_type_id, usable: Number(h.usable) });
    heldBy.set(h.customer_id, list);
  }

  const out: Snapshot[] = [];
  for (const r of factsRes.rows) {
    const holdings = (heldBy.get(r.id) ?? [])
      .sort((a, b) => (typeOrder.get(a.ticketTypeId) ?? 0) - (typeOrder.get(b.ticketTypeId) ?? 0))
      .flatMap((h) => {
        const t = typeById.get(h.ticketTypeId);
        return t
          ? [{ ticketTypeId: h.ticketTypeId, name: t.name, color: t.color, archived: t.archivedAt !== null, usable: h.usable }]
          : [];
      });
    const usableTickets = holdings.reduce((n, h) => n + h.usable, 0);
    const { red, orange } = customerAlerts(holdings, classes);
    const facts: ClientFacts = {
      usableTickets,
      upcomingConfirmed: Number(r.upcoming_confirmed),
      red,
      orange,
      confirmedBookings: Number(r.confirmed_bookings),
      ticketsAny: Number(r.tickets_any),
      bookingsAny: Number(r.bookings_any),
      purchasesAny: Number(r.purchases_any),
    };
    if (!isListedClient(facts)) continue;
    out.push({
      facts,
      matchesQ: r.matches_q === true,
      row: {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        linkedAccount: r.linked === true,
        holdings,
        usableTickets,
        upcomingConfirmed: facts.upcomingConfirmed,
        red,
        orange,
      },
    });
  }
  return out;
}

/**
 * Listed clients (isListedClient) matching the filter and `q` (ILIKE on name or
 * e-mail, escaped), by lower(name), id, at most CLIENT_LIST_LIMIT; the counts
 * are per filter over every listed client (the search is ignored).
 */
export async function listClients(
  db: Db,
  professionalId: string,
  now: Date,
  opts: { q: string; filter: ClientFilter },
): Promise<{ rows: ClientListRow[]; counts: Record<ClientFilter, number> }> {
  const all = await loadSnapshots(db, professionalId, now, opts.q.trim());
  const counts: Record<ClientFilter, number> = { tous: 0, tickets: 0, "a-venir": 0, alertes: 0 };
  const rows: ClientListRow[] = [];
  for (const s of all) {
    for (const f of CLIENT_FILTERS) if (matchesClientFilter(s.facts, f)) counts[f] += 1;
    if (s.matchesQ && matchesClientFilter(s.facts, opts.filter) && rows.length < CLIENT_LIST_LIMIT) rows.push(s.row);
  }
  return { rows, counts };
}

/** Listed clients with a red / orange alert (the overview card). */
export async function customerAlertCounts(
  db: Db,
  professionalId: string,
  now: Date,
): Promise<{ red: number; orange: number }> {
  const all = await loadSnapshots(db, professionalId, now, "");
  return { red: all.filter((s) => s.facts.red).length, orange: all.filter((s) => s.facts.orange).length };
}

export type ClientBookingRow = {
  bookingId: string;
  occurrenceId: string;
  kind: "seance" | "rdv";
  title: string;
  startsAt: string;
  endsAt: string;
  whenLabel: string;
  /** A pending booking whose hold has lapsed reads « expired »: its seat is already free (engine rule, not yet swept). */
  status: BookingStatus;
  coverage: BookingCoverage;
  ticketTypeName: string | null;
  occurrenceStatus: OccurrenceStatus;
  /** confirmed, event séance, scheduled, starts_at > now */
  canMove: boolean;
  /** a live registration: confirmed, or pending with a hold that has not lapsed (past séances too, E6a) */
  canUnenroll: boolean;
  moved: boolean;
  hasTicket: boolean;
  pending: boolean;
  planningHref: string;
};

export type ClientPurchaseRow = {
  id: string;
  label: string;
  quantity: number;
  amountCents: number;
  currency: string;
  status: PurchaseStatus;
  livemode: boolean;
  createdAt: Date;
  paidAt: Date | null;
};

export type ClientRecordData = {
  customer: { id: string; name: string; email: string; phone: string | null; linkedAccount: boolean; createdAt: Date };
  wallet: WalletGroup[];
  typeOptions: TypeOption[];
  /** upcoming = live and not ended, by start asc; past = the rest, by start desc, at most PAST_BOOKINGS_MAX */
  bookings: { upcoming: ClientBookingRow[]; past: ClientBookingRow[] };
  /** by created_at desc */
  purchases: ClientPurchaseRow[];
  /** whole actions only: never a line counting part of an action (see wholeActions) */
  history: HistoryLine[];
};

type BookingQueryRow = {
  bookingId: string;
  occurrenceId: string;
  status: BookingStatus;
  coverage: BookingCoverage;
  holdExpiresAt: Date | null;
  movedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
  occurrenceStatus: OccurrenceStatus;
  eventId: string | null;
  eventTitle: string | null;
  rdvTypeName: string | null;
  heldTicketId: string | null;
  heldTypeName: string | null;
};

/**
 * What the booking is right now: a pending one whose hold has ended (`hold_expires_at <= now`, the rule of the
 * planning) is not a live registration, the engine releases its seat on the next claim: it reads « expired ».
 */
function statusAt(r: Pick<BookingQueryRow, "status" | "holdExpiresAt">, now: Date): BookingStatus {
  const lapsed = r.status === "pending" && (r.holdExpiresAt === null || r.holdExpiresAt.getTime() <= now.getTime());
  return lapsed ? "expired" : r.status;
}

function bookingRow(r: BookingQueryRow, now: Date, tz: string): ClientBookingRow {
  const kind = r.eventId === null ? "rdv" : "seance";
  const title = (kind === "seance" ? r.eventTitle : r.rdvTypeName) ?? (kind === "seance" ? "Séance" : "Rendez-vous");
  const status = statusAt(r, now);
  return {
    bookingId: r.bookingId,
    occurrenceId: r.occurrenceId,
    kind,
    title,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    whenLabel: formatWhen(r.startsAt, r.endsAt, tz),
    status,
    coverage: r.coverage,
    ticketTypeName: r.heldTypeName,
    occurrenceStatus: r.occurrenceStatus,
    canMove:
      status === "confirmed" &&
      kind === "seance" &&
      r.occurrenceStatus === "scheduled" &&
      r.startsAt.getTime() > now.getTime(),
    canUnenroll: status === "pending" || status === "confirmed",
    moved: r.movedAt !== null,
    hasTicket: r.heldTicketId !== null,
    pending: status === "pending",
    planningHref: planningHref({ occurrenceId: r.occurrenceId, startsAt: r.startsAt, tz }),
  };
}

/**
 * The newest movements of a customer (`rows`, seq desc, read with ONE extra row beyond `max`) cut on an action
 * boundary. When the extra row is there the ledger goes further back, and an action with movements on both sides of
 * the cut would read as a smaller one (« Acheté 3 » for a pack of 10): every such action is dropped whole. Found
 * with one more read, only in that case (an action's movements are not assumed to be contiguous in seq).
 */
async function wholeActions<T extends { seq: number; actionId: string }>(
  db: Db,
  professionalId: string,
  customerId: string,
  rows: readonly T[],
  max: number,
): Promise<T[]> {
  if (rows.length <= max) return [...rows];
  const cut = rows[max].seq; // the newest movement left out
  const res = await db.execute<{ action_id: string }>(sql`
    select distinct older.action_id
    from ticket_movement older
    where older.professional_id = ${professionalId} and older.customer_id = ${customerId} and older.seq <= ${cut}
      and exists (
        select 1 from ticket_movement newer
        where newer.professional_id = ${professionalId} and newer.customer_id = ${customerId}
          and newer.action_id = older.action_id and newer.seq > ${cut})`);
  const straddling = new Set(res.rows.map((r) => r.action_id));
  return rows.slice(0, max).filter((r) => !straddling.has(r.actionId));
}

/**
 * The client record (null for another pro's or an unknown customer): wallet via
 * groupWallet(loadTypeFacts → classifyTypes), history via historyLines.
 * `opts.historyMaxMovements` is for the tests (it lowers HISTORY_MAX_MOVEMENTS).
 */
export async function getClientRecord(
  db: Db,
  professionalId: string,
  customerId: string,
  now: Date,
  opts: { historyMaxMovements?: number } = {},
): Promise<ClientRecordData | null> {
  const p = professionalId;
  const [[cust], [pro]] = await Promise.all([
    db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        userId: customer.userId,
        createdAt: customer.createdAt,
      })
      .from(customer)
      .where(and(eq(customer.id, customerId), eq(customer.professionalId, p))),
    db.select({ timezone: professional.timezone }).from(professional).where(eq(professional.id, p)),
  ]);
  if (!cust || !pro) return null;
  const tz = pro.timezone;

  const rdvType = alias(ticketType, "rdv_type");
  const heldType = alias(ticketType, "held_type");
  const movementRdvType = alias(ticketType, "movement_rdv_type");
  const historyMax = opts.historyMaxMovements ?? HISTORY_MAX_MOVEMENTS;
  const [tickets, types, typeFacts, bookingRows, purchases, newestMovements, typeOptions] = await Promise.all([
    db
      .select({
        id: ticket.id,
        ticketTypeId: ticket.ticketTypeId,
        status: ticket.status,
        expiresAt: ticket.expiresAt,
        purchaseId: ticket.purchaseId,
        closedReason: ticket.closedReason,
        closedNote: ticket.closedNote,
        statusChangedAt: ticket.statusChangedAt,
        createdAt: ticket.createdAt,
        bookingStartsAt: occurrence.startsAt,
      })
      .from(ticket)
      .leftJoin(booking, and(eq(booking.id, ticket.bookingId), eq(booking.professionalId, p)))
      .leftJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, p)))
      .where(and(eq(ticket.professionalId, p), eq(ticket.customerId, customerId))),
    db
      .select({ id: ticketType.id, name: ticketType.name, color: ticketType.color, archivedAt: ticketType.archivedAt })
      .from(ticketType)
      .where(eq(ticketType.professionalId, p))
      .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id)),
    loadTypeFacts(db, p, now),
    db
      .select({
        bookingId: booking.id,
        occurrenceId: occurrence.id,
        status: booking.status,
        coverage: booking.coverage,
        holdExpiresAt: booking.holdExpiresAt,
        movedAt: booking.movedAt,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        occurrenceStatus: occurrence.status,
        eventId: occurrence.eventId,
        eventTitle: event.title,
        rdvTypeName: rdvType.name,
        heldTicketId: ticket.id,
        heldTypeName: heldType.name,
      })
      .from(booking)
      .innerJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, p)))
      .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, p)))
      .leftJoin(rdvType, and(eq(rdvType.id, occurrence.ticketTypeId), eq(rdvType.professionalId, p)))
      .leftJoin(ticket, and(eq(ticket.bookingId, booking.id), eq(ticket.professionalId, p)))
      .leftJoin(heldType, and(eq(heldType.id, ticket.ticketTypeId), eq(heldType.professionalId, p)))
      .where(and(eq(booking.professionalId, p), eq(booking.customerId, customerId)))
      .orderBy(desc(occurrence.startsAt), desc(booking.id))
      .limit(RECORD_BOOKINGS_MAX),
    db
      .select({
        id: ticketPurchase.id,
        label: ticketPurchase.label,
        quantity: ticketPurchase.quantity,
        amountCents: ticketPurchase.amountCents,
        currency: ticketPurchase.currency,
        status: ticketPurchase.status,
        livemode: ticketPurchase.livemode,
        createdAt: ticketPurchase.createdAt,
        paidAt: ticketPurchase.paidAt,
      })
      .from(ticketPurchase)
      .where(and(eq(ticketPurchase.professionalId, p), eq(ticketPurchase.customerId, customerId)))
      .orderBy(desc(ticketPurchase.createdAt), desc(ticketPurchase.id)),
    db
      .select({
        seq: ticketMovement.seq,
        actionId: ticketMovement.actionId,
        kind: ticketMovement.kind,
        ticketTypeId: ticketMovement.ticketTypeId,
        fromTicketTypeId: ticketMovement.fromTicketTypeId,
        actor: ticketMovement.actor,
        reason: ticketMovement.reason,
        createdAt: ticketMovement.createdAt,
        closedReason: ticket.closedReason,
        seanceStartsAt: occurrence.startsAt,
        eventTitle: event.title,
        rdvTypeName: movementRdvType.name,
      })
      .from(ticketMovement)
      .innerJoin(ticket, and(eq(ticket.id, ticketMovement.ticketId), eq(ticket.professionalId, p)))
      .leftJoin(booking, and(eq(booking.id, ticketMovement.bookingId), eq(booking.professionalId, p)))
      .leftJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, p)))
      .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, p)))
      .leftJoin(movementRdvType, and(eq(movementRdvType.id, occurrence.ticketTypeId), eq(movementRdvType.professionalId, p)))
      .where(and(eq(ticketMovement.professionalId, p), eq(ticketMovement.customerId, customerId)))
      .orderBy(desc(ticketMovement.seq))
      .limit(historyMax + 1),
    listActiveTypeOptions(db, p),
  ]);

  const walletTypes: WalletTypeRow[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    archived: t.archivedAt !== null,
  }));
  const wallet = groupWallet(tickets, walletTypes, classifyTypes(typeFacts), now, tz);

  const upcoming: ClientBookingRow[] = [];
  const past: ClientBookingRow[] = [];
  for (const r of bookingRows) {
    const row = bookingRow(r, now, tz);
    const live = row.status === "pending" || row.status === "confirmed"; // a lapsed hold reads « expired »
    (live && r.endsAt.getTime() > now.getTime() ? upcoming : past).push(row);
  }
  upcoming.reverse(); // the query is newest first: upcoming reads soonest first

  const movements = await wholeActions(
    db,
    p,
    customerId,
    newestMovements.map((m) => ({ ...m, seq: Number(m.seq) })),
    historyMax,
  );
  const ledger: LedgerMovementRow[] = movements.map((m) => ({
    seq: m.seq,
    actionId: m.actionId,
    kind: m.kind,
    ticketTypeId: m.ticketTypeId,
    fromTicketTypeId: m.fromTicketTypeId,
    actor: m.actor,
    reason: m.reason,
    createdAt: m.createdAt,
    // the ticket's closed_reason belongs to its close movement only (it would split the lines of an earlier action)
    closedReason: m.kind === "close" ? m.closedReason : null,
    occurrence:
      (m.kind === "spend" || m.kind === "return") && m.seanceStartsAt !== null
        ? { title: m.eventTitle ?? m.rdvTypeName ?? "Séance", startsAt: m.seanceStartsAt }
        : null,
  }));
  const history = historyLines(ledger, new Map(types.map((t) => [t.id, t.name])), tz);

  return {
    customer: {
      id: cust.id,
      name: cust.name,
      email: cust.email,
      phone: cust.phone,
      linkedAccount: cust.userId !== null,
      createdAt: cust.createdAt,
    },
    wallet,
    typeOptions,
    bookings: { upcoming, past: past.slice(0, PAST_BOOKINGS_MAX) },
    purchases,
    history,
  };
}
