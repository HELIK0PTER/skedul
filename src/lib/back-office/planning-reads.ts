/**
 * Planning reads (spec § 7, § 13.2): the week's occurrences with their
 * attendees, the customer search and the two « Inscrire » / « Déplacer »
 * option reads. Testable core: takes `db`, imports neither
 * server-only, next/* nor the db index. Every query filters on professional_id
 * and every id that comes from the caller is checked against it.
 */
import { and, asc, eq, exists, gt, gte, ilike, inArray, isNotNull, isNull, lt, min, ne, or, sql, type SQL } from "drizzle-orm";

import { activeBookingOf } from "@/lib/booking/claims";
import { usableTickets } from "@/lib/booking/eligibility";
import { seatsShown } from "@/lib/booking/holds";
import type { DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import {
  booking,
  bookingAnswer,
  customer,
  event,
  eventTicketType,
  occurrence,
  question,
  ticket,
  ticketType,
  timeOff,
} from "@/lib/db/schema";
import {
  DEFAULT_COLOR,
  type Actor,
  type BookingCoverage,
  type BookingMode,
  type OccurrenceStatus,
  type QuestionType,
} from "@/lib/tickets-vocab";

export type PlanningAttendee = {
  bookingId: string;
  customerId: string;
  name: string;
  email: string;
  phone: string | null;
  status: "pending" | "confirmed";
  coverage: BookingCoverage;
  createdBy: Actor;
  ticket: { id: string; typeName: string; expiresAt: Date | null; purchased: boolean } | null;
  holdExpiresAt: Date | null;
  answers: { label: string; value: string }[];
  customerNotes: string | null;
  movedAt: Date | null;
  createdAt: Date;
};

export type PlanningQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  options: string[] | null;
  required: boolean;
};

export type PlanningItem = {
  id: string;
  kind: "seance" | "rdv";
  eventId: string | null;
  eventVersion: number | null;
  ticketTypeId: string | null;
  title: string;
  color: string;
  startsAt: Date;
  endsAt: Date;
  status: OccurrenceStatus;
  capacity: number;
  /** the raw seats_taken: pending holds count, lapsed ones too until the engine releases them */
  seatsTaken: number;
  /** pending bookings whose hold has elapsed and that nobody has released yet */
  elapsedHolds: number;
  /** the « inscrits »: confirmed bookings plus the holds still live (seatsTaken - elapsedHolds); one meaning for the whole back-office */
  liveSeats: number;
  seatsShown: number;
  location: string | null;
  eventLocation: string | null;
  locationOverride: string | null;
  bookingMode: BookingMode | null;
  isPrivate: boolean;
  acceptedTypes: { id: string; name: string; color: string }[];
  questions: PlanningQuestion[];
  seriesDate: DateKey | null;
  /** the event's frequency is not « once » */
  recurring: boolean;
  /** cancelled event séance, starts_at > now, segment not archived and series_date ≤ until_date (or no until) */
  canRestore: boolean;
  /** an event séance whose time was changed alone (occurrence.time_detached): « et les suivantes » leaves it where it is; false for an RDV */
  timeDetached: boolean;
  /** pending + confirmed, by createdAt */
  attendees: PlanningAttendee[];
};

export type PlanningTimeOff = { id: string; startAt: Date; endAt: Date; allDay: boolean; reason: string | null };

/* ───────────────────────── Occurrences ───────────────────────── */

function selectOccurrences(db: Db, where: SQL | undefined) {
  return db
    .select({
      id: occurrence.id,
      eventId: occurrence.eventId,
      ticketTypeId: occurrence.ticketTypeId,
      seriesDate: occurrence.seriesDate,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      status: occurrence.status,
      capacity: occurrence.capacity,
      seatsTaken: occurrence.seatsTaken,
      timeDetached: occurrence.timeDetached,
      locationOverride: occurrence.locationOverride,
      eventTitle: event.title,
      eventColor: event.color,
      eventLocation: event.location,
      eventVersion: event.version,
      bookingMode: event.bookingMode,
      isPrivate: event.isPrivate,
      freq: event.freq,
      archivedAt: event.archivedAt,
      untilDate: event.untilDate,
      typeName: ticketType.name,
      typeColor: ticketType.color,
    })
    .from(occurrence)
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(where)
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id));
}
type OccurrenceData = Awaited<ReturnType<typeof selectOccurrences>>[number];

/**
 * Pending bookings whose hold has elapsed, per occurrence (not yet released by R / the sweep): the engine's
 * expireElapsedHolds rule (status pending and hold_expires_at < now). A grouped query, not a correlated subquery:
 * in a one-table select drizzle renders an interpolated column unqualified, which would resolve to the inner table.
 */
export async function elapsedHoldsOf(db: Db, professionalId: string, occurrenceIds: readonly string[], now: Date): Promise<Map<string, number>> {
  if (occurrenceIds.length === 0) return new Map();
  const rows = await db
    .select({ occurrenceId: booking.occurrenceId, n: sql<number>`count(*)::int` })
    .from(booking)
    .where(
      and(
        eq(booking.professionalId, professionalId),
        inArray(booking.occurrenceId, [...occurrenceIds]),
        eq(booking.status, "pending"),
        lt(booking.holdExpiresAt, now),
      ),
    )
    .groupBy(booking.occurrenceId);
  return new Map(rows.map((r) => [r.occurrenceId, Number(r.n)]));
}

async function loadAttendees(db: Db, professionalId: string, occurrenceIds: readonly string[]): Promise<Map<string, PlanningAttendee[]>> {
  const byOccurrence = new Map<string, PlanningAttendee[]>();
  const rows = await db
    .select({
      bookingId: booking.id,
      occurrenceId: booking.occurrenceId,
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: booking.status,
      coverage: booking.coverage,
      createdBy: booking.createdBy,
      holdExpiresAt: booking.holdExpiresAt,
      customerNotes: booking.customerNotes,
      movedAt: booking.movedAt,
      createdAt: booking.createdAt,
      ticketId: ticket.id,
      ticketExpiresAt: ticket.expiresAt,
      ticketPurchaseId: ticket.purchaseId,
      ticketTypeName: ticketType.name,
    })
    .from(booking)
    .innerJoin(customer, and(eq(customer.id, booking.customerId), eq(customer.professionalId, professionalId)))
    .leftJoin(ticket, eq(ticket.bookingId, booking.id))
    .leftJoin(ticketType, eq(ticketType.id, ticket.ticketTypeId))
    .where(
      and(
        eq(booking.professionalId, professionalId),
        inArray(booking.occurrenceId, [...occurrenceIds]),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    )
    .orderBy(asc(booking.createdAt), asc(booking.id));
  if (rows.length === 0) return byOccurrence;

  const answerRows = await db
    .select({ bookingId: bookingAnswer.bookingId, label: bookingAnswer.questionLabel, value: bookingAnswer.value })
    .from(bookingAnswer)
    .leftJoin(question, eq(question.id, bookingAnswer.questionId))
    .where(
      and(
        eq(bookingAnswer.professionalId, professionalId),
        inArray(bookingAnswer.bookingId, rows.map((r) => r.bookingId)),
      ),
    )
    .orderBy(asc(sql`coalesce(${question.position}, 1000000)`), asc(bookingAnswer.createdAt), asc(bookingAnswer.id));
  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answerRows) {
    const list = answersByBooking.get(a.bookingId) ?? [];
    list.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, list);
  }

  for (const r of rows) {
    const list = byOccurrence.get(r.occurrenceId) ?? [];
    list.push({
      bookingId: r.bookingId,
      customerId: r.customerId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      status: r.status === "pending" ? "pending" : "confirmed",
      coverage: r.coverage,
      createdBy: r.createdBy,
      ticket:
        r.ticketId === null
          ? null
          : { id: r.ticketId, typeName: r.ticketTypeName ?? "", expiresAt: r.ticketExpiresAt, purchased: r.ticketPurchaseId !== null },
      holdExpiresAt: r.holdExpiresAt,
      answers: answersByBooking.get(r.bookingId) ?? [],
      customerNotes: r.customerNotes,
      movedAt: r.movedAt,
      createdAt: r.createdAt,
    });
    byOccurrence.set(r.occurrenceId, list);
  }
  return byOccurrence;
}

async function loadAcceptedTypes(
  db: Db,
  professionalId: string,
  eventIds: readonly string[],
): Promise<Map<string, { id: string; name: string; color: string }[]>> {
  const byEvent = new Map<string, { id: string; name: string; color: string }[]>();
  if (eventIds.length === 0) return byEvent;
  const rows = await db
    .select({ eventId: eventTicketType.eventId, id: ticketType.id, name: ticketType.name, color: ticketType.color })
    .from(eventTicketType)
    .innerJoin(ticketType, eq(ticketType.id, eventTicketType.ticketTypeId))
    .where(and(eq(eventTicketType.professionalId, professionalId), inArray(eventTicketType.eventId, [...eventIds])))
    .orderBy(asc(ticketType.position), asc(ticketType.name), asc(ticketType.id));
  for (const r of rows) {
    const list = byEvent.get(r.eventId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    byEvent.set(r.eventId, list);
  }
  return byEvent;
}

async function loadQuestionsByOwner(
  db: Db,
  professionalId: string,
  eventIds: readonly string[],
  typeIds: readonly string[],
): Promise<{ byEvent: Map<string, PlanningQuestion[]>; byType: Map<string, PlanningQuestion[]> }> {
  const byEvent = new Map<string, PlanningQuestion[]>();
  const byType = new Map<string, PlanningQuestion[]>();
  const owners: SQL[] = [];
  if (eventIds.length > 0) owners.push(inArray(question.eventId, [...eventIds]));
  if (typeIds.length > 0) owners.push(inArray(question.ticketTypeId, [...typeIds]));
  if (owners.length === 0) return { byEvent, byType };
  const rows = await db
    .select({
      id: question.id,
      eventId: question.eventId,
      ticketTypeId: question.ticketTypeId,
      label: question.label,
      type: question.type,
      options: question.options,
      required: question.required,
    })
    .from(question)
    .where(and(eq(question.professionalId, professionalId), or(...owners)))
    .orderBy(asc(question.position), asc(question.createdAt), asc(question.id));
  for (const r of rows) {
    const q: PlanningQuestion = { id: r.id, label: r.label, type: r.type, options: r.options, required: r.required };
    const owner = r.eventId !== null ? byEvent : byType;
    const key = r.eventId ?? r.ticketTypeId ?? "";
    const list = owner.get(key) ?? [];
    list.push(q);
    owner.set(key, list);
  }
  return { byEvent, byType };
}

/** The seats that are really taken: confirmed bookings plus the holds still live, a lapsed hold being a free seat. */
export function liveSeatsOfOccurrence(o: { seatsTaken: number; elapsedHolds: number }): number {
  return Math.max(0, o.seatsTaken - o.elapsedHolds);
}

/**
 * A scheduled RDV that nobody holds any more (spec § 7: an RDV occupies a slot only with a confirmed booking or a
 * pending one whose hold has not ended). A client who abandons a buy-mode checkout leaves seats_taken at 1 and a
 * pending booking whose hold lapses; the RDV stays `scheduled` until the nightly sweep, but it is not an appointment.
 * A cancelled RDV is not concerned (it is cancelled, whatever its seats), and séances are never dropped: an empty
 * séance is still on offer.
 */
function isPhantomRdv(i: Pick<PlanningItem, "kind" | "status" | "liveSeats">): boolean {
  return i.kind === "rdv" && i.status === "scheduled" && i.liveSeats <= 0;
}

async function loadItems(db: Db, professionalId: string, rows: readonly OccurrenceData[], now: Date): Promise<PlanningItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const eventIds = [...new Set(rows.flatMap((r) => (r.eventId !== null ? [r.eventId] : [])))];
  const rdvTypeIds = [...new Set(rows.flatMap((r) => (r.eventId === null && r.ticketTypeId !== null ? [r.ticketTypeId] : [])))];
  const [elapsed, attendees, types, questions] = await Promise.all([
    elapsedHoldsOf(db, professionalId, ids, now),
    loadAttendees(db, professionalId, ids),
    loadAcceptedTypes(db, professionalId, eventIds),
    loadQuestionsByOwner(db, professionalId, eventIds, rdvTypeIds),
  ]);

  const items = rows.map((r): PlanningItem => {
    const elapsedHolds = elapsed.get(r.id) ?? 0;
    const isSeance = r.eventId !== null;
    const segmentLive = r.archivedAt === null && (r.untilDate === null || (r.seriesDate !== null && r.seriesDate <= r.untilDate));
    return {
      id: r.id,
      kind: isSeance ? "seance" : "rdv",
      eventId: r.eventId,
      eventVersion: r.eventVersion ?? null,
      ticketTypeId: r.ticketTypeId,
      title: r.eventTitle ?? r.typeName ?? "Rendez-vous",
      color: r.eventColor ?? r.typeColor ?? DEFAULT_COLOR,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      capacity: r.capacity,
      seatsTaken: r.seatsTaken,
      elapsedHolds,
      liveSeats: liveSeatsOfOccurrence({ seatsTaken: r.seatsTaken, elapsedHolds }),
      seatsShown: seatsShown({ capacity: r.capacity, seatsTaken: r.seatsTaken, elapsedHolds }),
      location: r.locationOverride ?? r.eventLocation ?? null,
      eventLocation: r.eventLocation ?? null,
      locationOverride: r.locationOverride,
      bookingMode: r.bookingMode ?? null,
      isPrivate: r.isPrivate ?? false,
      acceptedTypes: r.eventId !== null ? (types.get(r.eventId) ?? []) : [],
      questions:
        r.eventId !== null
          ? (questions.byEvent.get(r.eventId) ?? [])
          : (questions.byType.get(r.ticketTypeId ?? "") ?? []),
      seriesDate: r.seriesDate,
      recurring: r.freq !== null && r.freq !== "once",
      canRestore: isSeance && r.status === "cancelled" && r.startsAt.getTime() > now.getTime() && segmentLive,
      timeDetached: isSeance && r.timeDetached,
      attendees: attendees.get(r.id) ?? [],
    };
  });
  return items.filter((i) => !isPhantomRdv(i));
}

/**
 * Occurrences overlapping [start, end) (starts_at < end AND ends_at > start),
 * cancelled RDVs and phantom RDVs (only a lapsed hold left, see isPhantomRdv)
 * excluded, cancelled séances kept; attendees, answers, ticket and accepted
 * types loaded in bulk; the time off overlapping the same range. Never hides
 * anything else (planning-view does).
 */
export async function getPlanningRange(
  db: Db,
  professionalId: string,
  range: { start: Date; end: Date },
  now: Date,
): Promise<{ items: PlanningItem[]; timeOff: PlanningTimeOff[] }> {
  const [rows, offRows] = await Promise.all([
    selectOccurrences(
      db,
      and(
        eq(occurrence.professionalId, professionalId),
        lt(occurrence.startsAt, range.end),
        gt(occurrence.endsAt, range.start),
        or(isNotNull(occurrence.eventId), ne(occurrence.status, "cancelled")),
      ),
    ),
    db
      .select({ id: timeOff.id, startAt: timeOff.startAt, endAt: timeOff.endAt, allDay: timeOff.allDay, reason: timeOff.reason })
      .from(timeOff)
      .where(and(eq(timeOff.professionalId, professionalId), lt(timeOff.startAt, range.end), gt(timeOff.endAt, range.start)))
      .orderBy(asc(timeOff.startAt), asc(timeOff.id)),
  ]);
  return { items: await loadItems(db, professionalId, rows, now), timeOff: offRows };
}

/* ───────────────────────── Customers ───────────────────────── */

export type CustomerHit = { id: string; name: string; email: string; phone: string | null };

/** Escapes the LIKE metacharacters (the backslash first). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** q trimmed, < 2 chars → []; ILIKE on name or email with %, _ and \ escaped; by name; at most `limit` (default 8). */
export async function searchCustomers(db: Db, professionalId: string, q: string, limit = 8): Promise<CustomerHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const pattern = likePattern(term);
  return db
    .select({ id: customer.id, name: customer.name, email: customer.email, phone: customer.phone })
    .from(customer)
    .where(and(eq(customer.professionalId, professionalId), or(ilike(customer.name, pattern), ilike(customer.email, pattern))))
    .orderBy(asc(customer.name), asc(customer.id))
    .limit(Math.min(50, Math.max(1, Math.trunc(limit))));
}

/* ───────────────────────── « Inscrire » options ───────────────────────── */

export type RegisterOptions = {
  mode: BookingMode;
  alreadyBooked: boolean;
  usable: { id: string; typeName: string; expiresAt: Date | null; purchased: boolean }[];
};

/**
 * Checks that the occurrence is an event séance of the pro and the customer is
 * the pro's (else null), then the tickets « utilisables ici » (consumption
 * order) and whether the customer already holds a live seat.
 */
export async function registerOptions(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  customerId: string,
  now: Date = new Date(),
): Promise<RegisterOptions | null> {
  const [seance] = await db
    .select({ mode: event.bookingMode })
    .from(occurrence)
    .innerJoin(event, eq(event.id, occurrence.eventId))
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId)));
  if (!seance) return null;
  const [owner] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId)));
  if (!owner) return null;

  const usable = await usableTickets(db, { customerId, occurrenceId });
  const typeIds = [...new Set(usable.map((u) => u.ticketTypeId))];
  const names = new Map<string, string>();
  if (typeIds.length > 0) {
    const typeRows = await db
      .select({ id: ticketType.id, name: ticketType.name })
      .from(ticketType)
      .where(and(eq(ticketType.professionalId, professionalId), inArray(ticketType.id, typeIds)));
    for (const t of typeRows) names.set(t.id, t.name);
  }
  const active = await activeBookingOf(db, { occurrenceId, customerId }, now);
  return {
    mode: seance.mode,
    alreadyBooked: active !== null,
    usable: usable.map((u) => ({
      id: u.id,
      typeName: names.get(u.ticketTypeId) ?? "",
      expiresAt: u.expiresAt,
      purchased: u.purchaseId !== null,
    })),
  };
}

/* ───────────────────────── « Déplacer » targets ───────────────────────── */

export type MoveTarget = {
  occurrenceId: string;
  seriesRootId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  seatsShown: number;
  capacity: number;
  full: boolean;
  accepted: boolean;
  conversionTypes: { id: string; name: string }[];
  expiresBefore: boolean;
  /**
   * The moved booking's customer already holds a live seat on this séance (a confirmed booking, or a pending one whose
   * hold has not elapsed): the move is refused with « already_booked », whether the séance is full or not.
   */
  customerBooked: boolean;
};

const MOVE_DAYS = 60;
const MOVE_TARGETS_MAX = 500;
const DAY_MS = 86_400_000;

/**
 * Ticket coverage: the event accepts the booked ticket's type (a live link, archived or not) or offers an active type
 * that is not rdv_free (a conversion). A correlated EXISTS over a joined select, so the outer `event.id` is qualified.
 */
function acceptsOrConverts(db: Db, professionalId: string, heldTypeId: string): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(eventTicketType)
      .innerJoin(ticketType, eq(ticketType.id, eventTicketType.ticketTypeId))
      .where(
        and(
          eq(eventTicketType.eventId, event.id),
          eq(eventTicketType.professionalId, professionalId),
          or(eq(eventTicketType.ticketTypeId, heldTypeId), and(isNull(ticketType.archivedAt), eq(ticketType.rdvFree, false))),
        ),
      ),
  );
}

type TargetLink = { id: string; name: string; archived: boolean; rdvFree: boolean };

async function loadTargetLinks(db: Db, professionalId: string, eventIds: readonly string[]): Promise<Map<string, TargetLink[]>> {
  const links = new Map<string, TargetLink[]>();
  if (eventIds.length === 0) return links;
  const rows = await db
    .select({
      eventId: eventTicketType.eventId,
      id: ticketType.id,
      name: ticketType.name,
      archivedAt: ticketType.archivedAt,
      rdvFree: ticketType.rdvFree,
    })
    .from(eventTicketType)
    .innerJoin(ticketType, eq(ticketType.id, eventTicketType.ticketTypeId))
    .where(and(eq(eventTicketType.professionalId, professionalId), inArray(eventTicketType.eventId, [...eventIds])))
    .orderBy(asc(ticketType.position), asc(ticketType.name), asc(ticketType.id));
  for (const l of rows) {
    const list = links.get(l.eventId) ?? [];
    list.push({ id: l.id, name: l.name, archived: l.archivedAt !== null, rdvFree: l.rdvFree });
    links.set(l.eventId, list);
  }
  return links;
}

/**
 * The occurrences among `occurrenceIds` where the customer holds a live seat: what moveAttendee refuses as
 * « already_booked » (assertNotBooked, placed after R, which has just expired every hold with hold_expires_at < now),
 * so confirmed, or pending with a hold not elapsed. activeBookingOf only differs at the very instant of the expiry.
 */
async function liveSeatsOf(
  db: Db,
  professionalId: string,
  customerId: string,
  occurrenceIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  if (occurrenceIds.length === 0) return new Set();
  const rows = await db
    .select({ occurrenceId: booking.occurrenceId })
    .from(booking)
    .where(
      and(
        eq(booking.professionalId, professionalId),
        eq(booking.customerId, customerId),
        inArray(booking.occurrenceId, [...occurrenceIds]),
        or(eq(booking.status, "confirmed"), and(eq(booking.status, "pending"), gte(booking.holdExpiresAt, now))),
      ),
    );
  return new Set(rows.map((r) => r.occurrenceId));
}

/**
 * Q18: for a confirmed booking of the pro on an event séance, the scheduled
 * event séances of the next `days` (default 60) other than the source. Ticket
 * coverage keeps only tickets-mode targets: `accepted` = the booked ticket's
 * type is linked, else `conversionTypes` = the active non-rdv_free linked types
 * (a target without any is dropped); `expiresBefore` = the ticket expires at or
 * before the target start. Other coverages see every target, accepted.
 * `customerBooked` flags the targets the customer already holds a live seat on.
 * `series` lists the roots of the targets that match everything above except the
 * `seriesRootId` filter, from a query of its own so that neither the filter nor
 * the cap hides a series. Null when the booking is not the pro's or not movable.
 * Every predicate (mode, usable types, series) is part of the SQL WHERE: the cap
 * of 500 targets is only a backstop. `opts.maxTargets` (test-only) lowers it.
 */
export async function moveTargets(
  db: Db,
  professionalId: string,
  bookingId: string,
  now: Date,
  opts: { seriesRootId?: string | null; days?: number; maxTargets?: number } = {},
): Promise<{ series: { seriesRootId: string; title: string }[]; targets: MoveTarget[] } | null> {
  const [source] = await db
    .select({
      id: booking.id,
      status: booking.status,
      coverage: booking.coverage,
      customerId: booking.customerId,
      occurrenceId: booking.occurrenceId,
      sourceEventId: occurrence.eventId,
    })
    .from(booking)
    .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
    .where(and(eq(booking.id, bookingId), eq(booking.professionalId, professionalId), eq(occurrence.professionalId, professionalId)));
  if (!source || source.status !== "confirmed" || source.sourceEventId === null) return null;

  let held: { ticketTypeId: string; expiresAt: Date | null } | null = null;
  if (source.coverage === "ticket") {
    const [t] = await db
      .select({ ticketTypeId: ticket.ticketTypeId, expiresAt: ticket.expiresAt })
      .from(ticket)
      .where(and(eq(ticket.bookingId, source.id), eq(ticket.professionalId, professionalId), eq(ticket.status, "booked")));
    if (!t) return null;
    held = t;
  }

  const until = new Date(now.getTime() + (opts.days ?? MOVE_DAYS) * DAY_MS);
  const cap = Math.min(MOVE_TARGETS_MAX, Math.max(1, Math.trunc(opts.maxTargets ?? MOVE_TARGETS_MAX)));
  const heldTypeId = held?.ticketTypeId ?? null;
  const heldExpiresAt = held?.expiresAt ?? null;
  const reachable = and(
    eq(occurrence.professionalId, professionalId),
    eq(occurrence.status, "scheduled"),
    ne(occurrence.id, source.occurrenceId),
    gt(occurrence.startsAt, now),
    lt(occurrence.startsAt, until),
    heldTypeId === null ? undefined : and(eq(event.bookingMode, "tickets"), acceptsOrConverts(db, professionalId, heldTypeId)),
  );
  const wanted = opts.seriesRootId ?? null;
  const inSeries =
    wanted === null ? undefined : or(eq(event.seriesRootId, wanted), and(isNull(event.seriesRootId), eq(event.id, wanted)));

  const [seriesRows, rows] = await Promise.all([
    // One row per event with a target, earliest first (the title of a series is its first séance's): bounded by the
    // number of events, not of séances, and blind to the series filter.
    db
      .select({ eventId: event.id, seriesRootId: event.seriesRootId, title: event.title })
      .from(occurrence)
      .innerJoin(event, eq(event.id, occurrence.eventId))
      .where(reachable)
      .groupBy(event.id)
      .orderBy(asc(min(occurrence.startsAt)), asc(event.id))
      .limit(MOVE_TARGETS_MAX),
    db
      .select({
        occurrenceId: occurrence.id,
        eventId: event.id,
        seriesRootId: event.seriesRootId,
        title: event.title,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        capacity: occurrence.capacity,
        seatsTaken: occurrence.seatsTaken,
      })
      .from(occurrence)
      .innerJoin(event, eq(event.id, occurrence.eventId))
      .where(and(reachable, inSeries))
      .orderBy(asc(occurrence.startsAt), asc(occurrence.id))
      .limit(cap),
  ]);

  const occurrenceIds = rows.map((r) => r.occurrenceId);
  const [links, elapsed, booked] = await Promise.all([
    heldTypeId === null
      ? Promise.resolve(new Map<string, TargetLink[]>())
      : loadTargetLinks(db, professionalId, [...new Set(rows.map((r) => r.eventId))]),
    elapsedHoldsOf(db, professionalId, occurrenceIds, now),
    liveSeatsOf(db, professionalId, source.customerId, occurrenceIds, now),
  ]);

  const targets: MoveTarget[] = [];
  for (const r of rows) {
    let accepted = true;
    let conversionTypes: { id: string; name: string }[] = [];
    let expiresBefore = false;
    if (heldTypeId !== null) {
      const linked = links.get(r.eventId) ?? [];
      accepted = linked.some((l) => l.id === heldTypeId);
      if (!accepted) {
        conversionTypes = linked.filter((l) => !l.archived && !l.rdvFree).map((l) => ({ id: l.id, name: l.name }));
        if (conversionTypes.length === 0) continue; // already left out by the WHERE
      }
      expiresBefore = heldExpiresAt !== null && heldExpiresAt.getTime() <= r.startsAt.getTime();
    }
    const shown = seatsShown({ capacity: r.capacity, seatsTaken: r.seatsTaken, elapsedHolds: elapsed.get(r.occurrenceId) ?? 0 });
    targets.push({
      occurrenceId: r.occurrenceId,
      seriesRootId: r.seriesRootId ?? r.eventId,
      title: r.title,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      seatsShown: shown,
      capacity: r.capacity,
      full: shown === 0,
      accepted,
      conversionTypes,
      expiresBefore,
      customerBooked: booked.has(r.occurrenceId),
    });
  }

  const roots = new Map<string, string>();
  for (const s of seriesRows) {
    const root = s.seriesRootId ?? s.eventId;
    if (!roots.has(root)) roots.set(root, s.title);
  }
  const series = Array.from(roots, ([seriesRootId, title]) => ({ seriesRootId, title })).sort(
    (a, b) => a.title.localeCompare(b.title, "fr") || a.seriesRootId.localeCompare(b.seriesRootId),
  );
  return { series, targets };
}
