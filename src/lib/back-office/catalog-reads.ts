/**
 * Catalog reads (spec § 13.1 « Tickets »): the ticket types of a pro with
 * their offers, the events that accept them and their usage, plus the RDV
 * libre details of one type. Pure functions of (db, professionalId, now): no
 * server-only and no next/*, so the DB tests call them directly;
 * src/server/catalog-queries.ts wraps them. Every statement filters
 * professional_id, except loadQuestions (booking/answers.ts), which filters by
 * ticket_type_id only: getTicketTypeDetail calls it after loadSummaries has
 * found the type among this pro's own, so the id is already known to be theirs.
 */
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";

import { loadQuestions, type QuestionRow } from "@/lib/booking/answers";
import { loadTypeFacts } from "@/lib/booking/wallet";
import type { BookingWindow } from "@/lib/booking-window";
import type { Db } from "@/lib/db/atomic";
import { availabilityRule, professional, ticket, ticketOffer, ticketType } from "@/lib/db/schema";
import type { AvailabilityRuleInput, WindowOverrides } from "@/lib/tickets";
import { offerLabel, validityLabel, type ValidityUnit } from "@/lib/tickets-vocab";
import { classifyTypes } from "@/lib/wallet-rules";

export type OfferView = {
  id: string;
  ticketTypeId: string;
  /** offerLabel(): the typed label, « À l'unité » or « Carnet de N » */
  label: string;
  customLabel: string | null;
  quantity: number;
  priceCents: number;
  validityCount: number | null;
  validityUnit: ValidityUnit | null;
  /** validityLabel(): « 3 mois », « 30 jours », null without validity */
  validityText: string | null;
  isActive: boolean;
  archived: boolean;
  /** paid purchases of this offer */
  sold: number;
};

export type AcceptedBy = { eventId: string; title: string; isPrivate: boolean };

export type TicketTypeSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  archived: boolean;
  rdvEnabled: boolean;
  rdvFree: boolean;
  rdvDurationMin: number | null;
  /** non-archived offers (en vente or not), by position, createdAt, id */
  offers: OfferView[];
  /** non-archived tickets-mode events linking the type, one per series root (its latest segment), by title */
  acceptedBy: AcceptedBy[];
  /** available and valid at now, every customer */
  usableTickets: number;
  /** classifyTypes(loadTypeFacts()) === "orphan" */
  orphan: boolean;
};

export type TicketTypeDetail = TicketTypeSummary & {
  rdvBufferBeforeMin: number;
  rdvBufferAfterMin: number;
  rdvOverrides: WindowOverrides;
  questions: QuestionRow[];
  ownHours: AvailabilityRuleInput[];
  globalHours: AvailabilityRuleInput[];
  archivedOffers: OfferView[];
  /** any > 0 means « Supprimer » archives instead of deleting */
  usage: { tickets: number; purchases: number; rdvs: number };
  proWindow: BookingWindow;
};

export type TypeOption = { id: string; name: string; color: string; rdvFree: boolean };

type TypeRow = typeof ticketType.$inferSelect;

/** Pushes `value` on the list of `key`. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/* ───────────────────────────── Offers ───────────────────────────── */

async function readOffers(
  db: Db,
  professionalId: string,
  scope: { ticketTypeId?: string; archived: boolean },
): Promise<OfferView[]> {
  const rows = await db
    .select({
      id: ticketOffer.id,
      ticketTypeId: ticketOffer.ticketTypeId,
      label: ticketOffer.label,
      quantity: ticketOffer.quantity,
      priceCents: ticketOffer.priceCents,
      validityCount: ticketOffer.validityCount,
      validityUnit: ticketOffer.validityUnit,
      isActive: ticketOffer.isActive,
      archivedAt: ticketOffer.archivedAt,
      // single-table select: an interpolated column renders unqualified, so the outer id is written out
      sold: sql<number>`(select count(*)::int from ticket_purchase p
        where p.offer_id = ticket_offer.id and p.professional_id = ticket_offer.professional_id and p.status = 'paid')`,
    })
    .from(ticketOffer)
    .where(
      and(
        eq(ticketOffer.professionalId, professionalId),
        scope.ticketTypeId === undefined ? undefined : eq(ticketOffer.ticketTypeId, scope.ticketTypeId),
        scope.archived ? isNotNull(ticketOffer.archivedAt) : isNull(ticketOffer.archivedAt),
      ),
    )
    .orderBy(asc(ticketOffer.position), asc(ticketOffer.createdAt), asc(ticketOffer.id));
  return rows.map((r) => ({
    id: r.id,
    ticketTypeId: r.ticketTypeId,
    label: offerLabel(r),
    customLabel: r.label,
    quantity: r.quantity,
    priceCents: r.priceCents,
    validityCount: r.validityCount,
    validityUnit: r.validityUnit,
    validityText: validityLabel(r.validityCount, r.validityUnit),
    isActive: r.isActive,
    archived: r.archivedAt !== null,
    sold: Number(r.sold),
  }));
}

/* ───────────────────────────── Accepted by ───────────────────────────── */

/**
 * The latest non-archived segment of each series (same series root), kept when
 * it is in tickets mode and links the type. Only a tickets-mode event accepts
 * tickets (src/lib/booking/eligibility.ts, the `linked` fact of loadTypeFacts),
 * so a free or no-booking event that still carries the link is not listed. The
 * mode filter is on the OUTER query: a series whose latest segment left tickets
 * mode does not fall back to an older segment, and an older segment of the same
 * series that still links the type is not listed either: a series is one entry,
 * addressed by its current segment.
 */
async function readAcceptedBy(db: Db, professionalId: string, ticketTypeId?: string): Promise<Map<string, AcceptedBy[]>> {
  const res = await db.execute<{ ticket_type_id: string; event_id: string; title: string; is_private: boolean }>(sql`
    select l.ticket_type_id, e.id as event_id, e.title, e.is_private
    from (
      select distinct on (coalesce(series_root_id, id)) id, title, is_private, booking_mode
      from event
      where professional_id = ${professionalId} and archived_at is null
      order by coalesce(series_root_id, id), start_date desc, created_at desc, id desc
    ) e
    join event_ticket_type l on l.event_id = e.id
    where l.professional_id = ${professionalId} and e.booking_mode = 'tickets'${ticketTypeId === undefined ? sql`` : sql` and l.ticket_type_id = ${ticketTypeId}`}`);
  const byType = new Map<string, AcceptedBy[]>();
  for (const r of res.rows) {
    pushTo(byType, r.ticket_type_id, { eventId: r.event_id, title: r.title, isPrivate: r.is_private });
  }
  for (const list of byType.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title, "fr") || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  }
  return byType;
}

/* ───────────────────────────── Usable tickets, usage ───────────────────────────── */

async function readUsableCounts(db: Db, professionalId: string, now: Date, ticketTypeId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ ticketTypeId: ticket.ticketTypeId, n: sql<number>`count(*)::int` })
    .from(ticket)
    .where(
      and(
        eq(ticket.professionalId, professionalId),
        ticketTypeId === undefined ? undefined : eq(ticket.ticketTypeId, ticketTypeId),
        eq(ticket.status, "available"),
        or(isNull(ticket.expiresAt), gt(ticket.expiresAt, now)),
      ),
    )
    .groupBy(ticket.ticketTypeId);
  return new Map(rows.map((r) => [r.ticketTypeId, Number(r.n)]));
}

/**
 * What blocks a DELETE of the type (the NO ACTION foreign keys): tickets (also
 * those converted away: their movement still names the type), purchases and RDV
 * occurrences.
 */
async function readUsage(db: Db, professionalId: string, ticketTypeId: string): Promise<TicketTypeDetail["usage"]> {
  const res = await db.execute<{ tickets: number; purchases: number; rdvs: number }>(sql`select
    (select count(*)::int from (
      select id from ticket where ticket_type_id = ${ticketTypeId} and professional_id = ${professionalId}
      union
      select ticket_id from ticket_movement
      where professional_id = ${professionalId} and (ticket_type_id = ${ticketTypeId} or from_ticket_type_id = ${ticketTypeId})
    ) u) as tickets,
    (select count(*)::int from ticket_purchase where ticket_type_id = ${ticketTypeId} and professional_id = ${professionalId}) as purchases,
    (select count(*)::int from occurrence where ticket_type_id = ${ticketTypeId} and professional_id = ${professionalId}) as rdvs`);
  const row = res.rows[0];
  return { tickets: Number(row?.tickets ?? 0), purchases: Number(row?.purchases ?? 0), rdvs: Number(row?.rdvs ?? 0) };
}

/** The pro's three booking settings (null when the professional row is gone). */
export async function readProWindow(db: Db, professionalId: string): Promise<BookingWindow | null> {
  const [row] = await db
    .select({
      bookingHorizonDays: professional.bookingHorizonDays,
      minNoticeMinutes: professional.minNoticeMinutes,
      cancelDeadlineHours: professional.cancelDeadlineHours,
    })
    .from(professional)
    .where(eq(professional.id, professionalId));
  return row ?? null;
}

/* ───────────────────────────── Types ───────────────────────────── */

async function loadSummaries(
  db: Db,
  professionalId: string,
  now: Date,
  onlyTypeId?: string,
): Promise<{ row: TypeRow; summary: TicketTypeSummary }[]> {
  const [rows, offers, accepted, usable, facts] = await Promise.all([
    db
      .select()
      .from(ticketType)
      .where(and(eq(ticketType.professionalId, professionalId), onlyTypeId === undefined ? undefined : eq(ticketType.id, onlyTypeId)))
      .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id)),
    readOffers(db, professionalId, { ticketTypeId: onlyTypeId, archived: false }),
    readAcceptedBy(db, professionalId, onlyTypeId),
    readUsableCounts(db, professionalId, now, onlyTypeId),
    loadTypeFacts(db, professionalId, now),
  ]);
  const classes = classifyTypes(facts);
  const offersByType = new Map<string, OfferView[]>();
  for (const o of offers) pushTo(offersByType, o.ticketTypeId, o);
  return rows.map((row) => ({
    row,
    summary: {
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      position: row.position,
      archived: row.archivedAt !== null,
      rdvEnabled: row.rdvEnabled,
      rdvFree: row.rdvFree,
      rdvDurationMin: row.rdvDurationMin,
      offers: offersByType.get(row.id) ?? [],
      acceptedBy: accepted.get(row.id) ?? [],
      usableTickets: usable.get(row.id) ?? 0,
      orphan: classes.get(row.id) === "orphan",
    },
  }));
}

/** Every type of the pro split active / archived, by position, createdAt, id (id tie-break: concurrent creates share a position). */
export async function listTicketTypes(
  db: Db,
  professionalId: string,
  now: Date,
): Promise<{ active: TicketTypeSummary[]; archived: TicketTypeSummary[] }> {
  const all = (await loadSummaries(db, professionalId, now)).map((x) => x.summary);
  return { active: all.filter((t) => !t.archived), archived: all.filter((t) => t.archived) };
}

/** One type of the pro (null for another pro's or an unknown id). */
export async function getTicketTypeDetail(
  db: Db,
  professionalId: string,
  ticketTypeId: string,
  now: Date,
): Promise<TicketTypeDetail | null> {
  const [one] = await loadSummaries(db, professionalId, now, ticketTypeId);
  if (!one) return null;
  const [questions, rules, archivedOffers, usage, proWindow] = await Promise.all([
    loadQuestions(db, { ticketTypeId }),
    db
      .select({
        ticketTypeId: availabilityRule.ticketTypeId,
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(
        and(
          eq(availabilityRule.professionalId, professionalId),
          or(isNull(availabilityRule.ticketTypeId), eq(availabilityRule.ticketTypeId, ticketTypeId)),
        ),
      )
      .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute), asc(availabilityRule.id)),
    readOffers(db, professionalId, { ticketTypeId, archived: true }),
    readUsage(db, professionalId, ticketTypeId),
    readProWindow(db, professionalId),
  ]);
  if (!proWindow) return null;
  const hours = (own: boolean): AvailabilityRuleInput[] =>
    rules
      .filter((r) => (r.ticketTypeId !== null) === own)
      .map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute }));
  const { row, summary } = one;
  return {
    ...summary,
    rdvBufferBeforeMin: row.rdvBufferBeforeMin,
    rdvBufferAfterMin: row.rdvBufferAfterMin,
    rdvOverrides: {
      bookingHorizonDays: row.rdvBookingHorizonDays,
      minNoticeMinutes: row.rdvMinNoticeMinutes,
      cancelDeadlineHours: row.rdvCancelDeadlineHours,
    },
    questions,
    ownHours: hours(true),
    globalHours: hours(false),
    archivedOffers,
    usage,
    proWindow,
  };
}

/** Non-archived types, by position, createdAt, id. */
export async function listActiveTypeOptions(db: Db, professionalId: string): Promise<TypeOption[]> {
  return db
    .select({ id: ticketType.id, name: ticketType.name, color: ticketType.color, rdvFree: ticketType.rdvFree })
    .from(ticketType)
    .where(and(eq(ticketType.professionalId, professionalId), isNull(ticketType.archivedAt)))
    .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id));
}
