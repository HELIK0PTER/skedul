import { and, asc, count, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { revenueByCurrency } from "@/lib/booking/revenue";
import type { Db } from "@/lib/db/atomic";
import {
  booking,
  bookingAnswer,
  customer,
  event,
  occurrence,
  ticket,
  ticketOffer,
  ticketPurchase,
  ticketType,
  timeOff,
} from "@/lib/db/schema";
import { DEFAULT_COLOR, type BookingCoverage, type BookingStatus, type PurchaseStatus } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";

import { customerAlertCounts } from "./client-reads";
import type { KpiInput } from "./dashboard-view";
import { listEvents } from "./event-reads";
import { formatWhen, planningHref } from "./format";
import { elapsedHoldsOf, liveSeatsOfOccurrence } from "./planning-reads";
import { hiddenByTimeOff } from "./planning-view";

export type BookingDetailVM = {
  bookingId: string;
  occurrenceId: string;
  kind: "seance" | "rdv";
  title: string;
  color: string;
  startsAt: string;
  endsAt: string;
  whenLabel: string;
  status: BookingStatus;
  coverage: BookingCoverage;
  ticketTypeName: string | null;
  purchase: { status: PurchaseStatus; amountLabel: string; livemode: boolean } | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  answers: { label: string; value: string }[];
  planningHref: string;
};

export type DashboardData = {
  kpis: KpiInput;
  alerts: {
    redClients: number;
    orangeClients: number;
    eventsWithoutActiveType: { eventId: string; title: string }[];
  };
  gettingStarted: { hasType: boolean; hasOffer: boolean; hasEvent: boolean; firstTypeId: string | null };
  upcomingBookings: BookingDetailVM[];
};

const DAY_MS = 86_400_000;
const UPCOMING_LIMIT = 8;

/**
 * Séances of [now, now + 7 d) and their confirmed registrants (Q25). A pending booking is no registrant, its hold
 * lapsed or not; an RDV counts only with a confirmed booking (one that only a lapsed hold keeps is not an appointment).
 * A séance under a time off is « empty » on its live seats, as on the planning: a seat kept only by a lapsed hold is free.
 */
async function weekCounts(
  db: Db,
  professionalId: string,
  now: Date,
): Promise<{ seances: number; registrants: number }> {
  const end = new Date(now.getTime() + 7 * DAY_MS);
  const rows = await db
    .select({
      id: occurrence.id,
      eventId: occurrence.eventId,
      status: occurrence.status,
      seatsTaken: occurrence.seatsTaken,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
    })
    .from(occurrence)
    .where(
      and(
        eq(occurrence.professionalId, professionalId),
        eq(occurrence.status, "scheduled"),
        gte(occurrence.startsAt, now),
        lt(occurrence.startsAt, end),
      ),
    );
  if (rows.length === 0) return { seances: 0, registrants: 0 };

  // A time off that starts after the window can still overlap the last séance.
  const lastEnd = new Date(rows.reduce((max, r) => Math.max(max, r.endsAt.getTime()), 0));
  const rdvIds = rows.filter((r) => r.eventId === null).map((r) => r.id);
  const seanceIds = rows.filter((r) => r.eventId !== null).map((r) => r.id);
  const [offs, rdvBookings, elapsed] = await Promise.all([
    db
      .select({ startAt: timeOff.startAt, endAt: timeOff.endAt })
      .from(timeOff)
      .where(and(eq(timeOff.professionalId, professionalId), lt(timeOff.startAt, lastEnd), gt(timeOff.endAt, now))),
    rdvIds.length === 0
      ? Promise.resolve([] as { occurrenceId: string }[])
      : db
          .select({ occurrenceId: booking.occurrenceId })
          .from(booking)
          .where(
            and(
              eq(booking.professionalId, professionalId),
              eq(booking.status, "confirmed"),
              inArray(booking.occurrenceId, rdvIds),
            ),
          ),
    elapsedHoldsOf(db, professionalId, seanceIds, now),
  ]);
  const bookedRdv = new Set(rdvBookings.map((b) => b.occurrenceId));

  const counted: string[] = [];
  for (const r of rows) {
    if (r.eventId !== null) {
      const liveSeats = liveSeatsOfOccurrence({ seatsTaken: r.seatsTaken, elapsedHolds: elapsed.get(r.id) ?? 0 });
      const hidden = hiddenByTimeOff(
        { kind: "seance", status: r.status, liveSeats, startsAt: r.startsAt, endsAt: r.endsAt },
        offs,
      );
      if (!hidden) counted.push(r.id);
    } else if (bookedRdv.has(r.id)) {
      counted.push(r.id);
    }
  }
  if (counted.length === 0) return { seances: 0, registrants: 0 };

  const [{ n }] = await db
    .select({ n: count() })
    .from(booking)
    .where(
      and(
        eq(booking.professionalId, professionalId),
        eq(booking.status, "confirmed"),
        inArray(booking.occurrenceId, counted),
      ),
    );
  return { seances: counted.length, registrants: n };
}

/** `available` and valid at now, archived types included (the wallet balance predicate). */
async function ticketsInCirculation(db: Db, professionalId: string, now: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(ticket)
    .where(
      and(
        eq(ticket.professionalId, professionalId),
        eq(ticket.status, "available"),
        or(isNull(ticket.expiresAt), gt(ticket.expiresAt, now)),
      ),
    );
  return n;
}

/** isClient (spec § 9): a confirmed booking, or at least one ticket in any state. */
async function clientCount(db: Db, professionalId: string): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from customer c
    where c.professional_id = ${professionalId}
      and (
        exists (
          select 1 from booking b
          where b.customer_id = c.id and b.professional_id = c.professional_id and b.status = 'confirmed'
        )
        or exists (
          select 1 from ticket t
          where t.customer_id = c.id and t.professional_id = c.professional_id
        )
      )`);
  return Number(res.rows[0]?.n ?? 0);
}

async function gettingStarted(db: Db, professionalId: string): Promise<DashboardData["gettingStarted"]> {
  const [types, offers, events] = await Promise.all([
    db
      .select({ id: ticketType.id, rdvFree: ticketType.rdvFree })
      .from(ticketType)
      .where(and(eq(ticketType.professionalId, professionalId), isNull(ticketType.archivedAt)))
      .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id)),
    db
      .select({ n: count() })
      .from(ticketOffer)
      .innerJoin(ticketType, eq(ticketType.id, ticketOffer.ticketTypeId))
      .where(
        and(
          eq(ticketOffer.professionalId, professionalId),
          eq(ticketOffer.isActive, true),
          isNull(ticketOffer.archivedAt),
          isNull(ticketType.archivedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(event)
      .where(and(eq(event.professionalId, professionalId), isNull(event.archivedAt))),
  ]);
  return {
    hasType: types.length > 0,
    hasOffer: (offers[0]?.n ?? 0) > 0,
    hasEvent: (events[0]?.n ?? 0) > 0,
    // An RDV « Gratuit » type cannot take an offer: it is never the first type to open.
    firstTypeId: types.find((t) => !t.rdvFree)?.id ?? null,
  };
}

/**
 * The next bookings: confirmed only, on a scheduled séance or RDV that starts after now. A pending booking is not
 * listed whatever its hold (a lapsed one is not even a live booking: the engine frees its seat on the next claim).
 */
async function upcomingBookings(
  db: Db,
  pro: { id: string; timezone: string },
  now: Date,
): Promise<BookingDetailVM[]> {
  const rdvType = alias(ticketType, "rdv_type");
  const heldType = alias(ticketType, "held_type");
  const rows = await db
    .select({
      bookingId: booking.id,
      occurrenceId: occurrence.id,
      eventId: occurrence.eventId,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      status: booking.status,
      coverage: booking.coverage,
      notes: booking.customerNotes,
      eventTitle: event.title,
      eventColor: event.color,
      rdvTypeName: rdvType.name,
      rdvTypeColor: rdvType.color,
      heldTypeName: heldType.name,
      purchaseStatus: ticketPurchase.status,
      purchaseCents: ticketPurchase.amountCents,
      purchaseCurrency: ticketPurchase.currency,
      purchaseLive: ticketPurchase.livemode,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
    })
    .from(booking)
    .innerJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, pro.id)))
    .innerJoin(customer, and(eq(customer.id, booking.customerId), eq(customer.professionalId, pro.id)))
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(rdvType, eq(rdvType.id, occurrence.ticketTypeId))
    .leftJoin(ticketPurchase, and(eq(ticketPurchase.id, booking.purchaseId), eq(ticketPurchase.professionalId, pro.id)))
    .leftJoin(
      ticket,
      and(eq(ticket.bookingId, booking.id), eq(ticket.status, "booked"), eq(ticket.professionalId, pro.id)),
    )
    .leftJoin(heldType, eq(heldType.id, ticket.ticketTypeId))
    .where(
      and(
        eq(booking.professionalId, pro.id),
        eq(booking.status, "confirmed"),
        eq(occurrence.status, "scheduled"),
        gt(occurrence.startsAt, now),
      ),
    )
    .orderBy(asc(occurrence.startsAt), asc(booking.createdAt), asc(booking.id))
    .limit(UPCOMING_LIMIT);
  if (rows.length === 0) return [];

  const answers = await db
    .select({ bookingId: bookingAnswer.bookingId, label: bookingAnswer.questionLabel, value: bookingAnswer.value })
    .from(bookingAnswer)
    .where(
      and(
        eq(bookingAnswer.professionalId, pro.id),
        inArray(
          bookingAnswer.bookingId,
          rows.map((r) => r.bookingId),
        ),
      ),
    )
    .orderBy(asc(bookingAnswer.createdAt), asc(bookingAnswer.id));
  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answers) {
    const list = answersByBooking.get(a.bookingId) ?? [];
    list.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, list);
  }

  return rows.map((r) => ({
    bookingId: r.bookingId,
    occurrenceId: r.occurrenceId,
    kind: r.eventId === null ? "rdv" : "seance",
    title: r.eventTitle ?? r.rdvTypeName ?? "Rendez-vous",
    color: r.eventColor ?? r.rdvTypeColor ?? DEFAULT_COLOR,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    whenLabel: formatWhen(r.startsAt, r.endsAt, pro.timezone),
    status: r.status,
    coverage: r.coverage,
    ticketTypeName: r.heldTypeName,
    purchase:
      r.purchaseStatus === null || r.purchaseCents === null || r.purchaseCurrency === null || r.purchaseLive === null
        ? null
        : {
            status: r.purchaseStatus,
            amountLabel: formatMoney(r.purchaseCents, r.purchaseCurrency),
            livemode: r.purchaseLive,
          },
    customerId: r.customerId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
    notes: r.notes,
    answers: answersByBooking.get(r.bookingId) ?? [],
    planningHref: planningHref({ occurrenceId: r.occurrenceId, startsAt: r.startsAt, tz: pro.timezone }),
  }));
}

/** Q25 KPIs, Q28 alerts (customerAlertCounts + listEvents noActiveType), Q29 steps, the next 8 bookings. */
export async function getDashboardData(
  db: Db,
  pro: { id: string; timezone: string; currency: string },
  now: Date,
  live: boolean,
): Promise<DashboardData> {
  const [week, tickets, clients, revenue, alertCounts, events, steps, bookings] = await Promise.all([
    weekCounts(db, pro.id, now),
    ticketsInCirculation(db, pro.id, now),
    clientCount(db, pro.id),
    revenueByCurrency(db, { live, professionalId: pro.id }),
    customerAlertCounts(db, pro.id, now),
    listEvents(db, pro.id, now),
    gettingStarted(db, pro.id),
    upcomingBookings(db, pro, now),
  ]);

  return {
    kpis: {
      upcomingSeances7d: week.seances,
      upcomingRegistrants7d: week.registrants,
      ticketsInCirculation: tickets,
      clients,
      revenue,
      currency: pro.currency,
    },
    alerts: {
      redClients: alertCounts.red,
      orangeClients: alertCounts.orange,
      eventsWithoutActiveType: events.live
        .filter((e) => e.noActiveType)
        .map((e) => ({ eventId: e.eventId, title: e.title })),
    },
    gettingStarted: steps,
    upcomingBookings: bookings,
  };
}
