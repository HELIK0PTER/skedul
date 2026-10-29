/**
 * The public planning read (spec L490-496, L1440-1443): the séances a visitor may see on `/[slug]`. Testable core:
 * takes `db`, imports neither server-only, next/* nor the db index. Every statement filters `professional_id`, and the
 * pro comes from the slug on the server (resolvePublicPro), never from input. Reads return `Date`s: the pages turn them
 * into ISO strings or labels before any client prop (planning-view.ts).
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";

import { elapsedHoldsOf } from "@/lib/back-office/planning-reads";
import { effectiveWindow, type BookingWindow } from "@/lib/booking-window";
import { seatsShown } from "@/lib/booking/holds";
import { ts, type Db } from "@/lib/db/atomic";
import { event, eventTicketType, occurrence, ticketType } from "@/lib/db/schema";
import type { BookingMode, OccurrenceStatus } from "@/lib/tickets-vocab";

/** What one call lists at most (a week of a busy pro holds far fewer). */
export const PUBLIC_SEANCE_LIMIT = 300;

export type PublicSeance = {
  occurrenceId: string;
  eventId: string;
  title: string;
  color: string;
  startsAt: Date;
  endsAt: Date;
  /** the effective place: coalesce(o.location_override, e.location), "" -> null (L1441, as customer-space.ts) */
  location: string | null;
  status: OccurrenceStatus;
  bookingMode: BookingMode;
  /** the séance row's capacity (overrides included) */
  capacity: number;
  /** seatsShown({ capacity, seatsTaken, elapsedHolds }) */
  seatsLeft: number;
  /** non-archived linked types, by position; [] unless bookingMode is "tickets" (badges only for tickets mode) */
  acceptedTypes: { id: string; name: string; color: string }[];
  /** effectiveWindow(pro, event overrides) */
  window: BookingWindow;
  /** a time off overlaps (the séance is then closed online) */
  underTimeOff: boolean;
};

type PlanningPro = { professionalId: string; timezone: string; window: BookingWindow };

/** The effective place of a séance: its own, else the event's; an empty or blank place is no place. */
export function effectiveLocation(override: string | null, eventLocation: string | null): string | null {
  const place = override ?? eventLocation;
  return place !== null && place.trim() !== "" ? place : null;
}

/**
 * A time off of the pro overlaps the séance: literal table names, no interpolated column (drizzle's one-table trap).
 * The one spelling of the rule: the planning filter and column below and `getPublicSeance` (seance-reads.ts) use it, so
 * the list hides an empty séance under a time off exactly when the séance page says « Réservations fermées ».
 */
export const UNDER_TIME_OFF = sql`exists (select 1 from time_off t where t.professional_id = occurrence.professional_id
  and t.start_at < occurrence.ends_at and t.end_at > occurrence.starts_at)`;

/** The columns a read selects to build a PublicSeance (publicSeanceOf): listPublicSeances and getPublicSeance. */
export type PublicSeanceRow = {
  occurrenceId: string;
  eventId: string;
  title: string;
  color: string;
  startsAt: Date;
  endsAt: Date;
  locationOverride: string | null;
  eventLocation: string | null;
  status: OccurrenceStatus;
  bookingMode: BookingMode;
  capacity: number;
  seatsTaken: number;
  eventHorizonDays: number | null;
  eventNoticeMinutes: number | null;
  eventCancelHours: number | null;
  /** the UNDER_TIME_OFF column */
  underTimeOff: boolean;
};

/**
 * The one mapping from a selected row to a PublicSeance, for the planning list and the séance page alike: the place,
 * the seats (a lapsed hold is a free seat: `elapsedHolds` of the grouped read, by occurrence), the types a tickets
 * séance accepts (`typesByEvent` of acceptedTypesOf: [] for any other mode), the effective window and the time-off flag.
 */
export function publicSeanceOf(
  r: PublicSeanceRow,
  elapsedHolds: ReadonlyMap<string, number>,
  typesByEvent: ReadonlyMap<string, PublicSeance["acceptedTypes"]>,
  proWindow: BookingWindow,
): PublicSeance {
  return {
    occurrenceId: r.occurrenceId,
    eventId: r.eventId,
    title: r.title,
    color: r.color,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    location: effectiveLocation(r.locationOverride, r.eventLocation),
    status: r.status,
    bookingMode: r.bookingMode,
    capacity: r.capacity,
    seatsLeft: seatsShown({
      capacity: r.capacity,
      seatsTaken: r.seatsTaken,
      elapsedHolds: elapsedHolds.get(r.occurrenceId) ?? 0,
    }),
    acceptedTypes: r.bookingMode === "tickets" ? (typesByEvent.get(r.eventId) ?? []) : [],
    window: effectiveWindow(proWindow, {
      bookingHorizonDays: r.eventHorizonDays,
      minNoticeMinutes: r.eventNoticeMinutes,
      cancelDeadlineHours: r.eventCancelHours,
    }),
    underTimeOff: r.underTimeOff,
  };
}

/**
 * The filter listPublicSeances and nextPublicSeanceStart share (L490-496): séances of this pro's non-private,
 * non-archived events that start after `now`, scheduled or cancelled, whose local date is within the effective horizon,
 * except an empty scheduled séance under a time off (a booked one stays, closed online). The event row must be the
 * pro's own as well (defence in depth).
 */
function publicFilter(pro: PlanningPro, now: Date): SQL | undefined {
  return and(
    eq(occurrence.professionalId, pro.professionalId),
    eq(event.professionalId, pro.professionalId),
    isNotNull(occurrence.eventId),
    gt(occurrence.startsAt, now),
    inArray(occurrence.status, ["scheduled", "cancelled"]),
    eq(event.isPrivate, false),
    isNull(event.archivedAt),
    sql`(occurrence.starts_at at time zone ${pro.timezone}::text)::date
      <= (${ts(now)} at time zone ${pro.timezone}::text)::date + coalesce(event.booking_horizon_days, ${pro.window.bookingHorizonDays}::int)`,
    sql`not (occurrence.status = 'scheduled' and occurrence.seats_taken = 0 and ${UNDER_TIME_OFF})`,
  );
}

/**
 * The non-archived types linked to these events, per event, by position. Used for the badges of a tickets-mode séance
 * and for the « no accepted type » closure. Every statement filters the pro on both tables.
 */
export async function acceptedTypesOf(
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
    .where(
      and(
        eq(eventTicketType.professionalId, professionalId),
        eq(ticketType.professionalId, professionalId),
        isNull(ticketType.archivedAt),
        inArray(eventTicketType.eventId, [...eventIds]),
      ),
    )
    .orderBy(asc(ticketType.position), asc(ticketType.name), asc(ticketType.id));
  for (const r of rows) {
    const list = byEvent.get(r.eventId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    byEvent.set(r.eventId, list);
  }
  return byEvent;
}

/**
 * L490-496: séances of [start, end) of this pro (by starts_at), starts_at > now, of a non-private non-archived event,
 * scheduled or cancelled, local date <= today + effective horizon, EXCEPT empty scheduled séances under a time off;
 * by starts_at, id; at most PUBLIC_SEANCE_LIMIT. A lapsed hold is a free seat (a grouped read, not a correlated
 * subquery). Never writes.
 */
export async function listPublicSeances(
  db: Db,
  pro: PlanningPro,
  range: { start: Date; end: Date },
  now: Date,
): Promise<PublicSeance[]> {
  const rows = await db
    .select({
      occurrenceId: occurrence.id,
      eventId: event.id,
      title: event.title,
      color: event.color,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      locationOverride: occurrence.locationOverride,
      eventLocation: event.location,
      status: occurrence.status,
      bookingMode: event.bookingMode,
      capacity: occurrence.capacity,
      seatsTaken: occurrence.seatsTaken,
      eventHorizonDays: event.bookingHorizonDays,
      eventNoticeMinutes: event.minNoticeMinutes,
      eventCancelHours: event.cancelDeadlineHours,
      underTimeOff: sql<boolean>`${UNDER_TIME_OFF}`,
    })
    .from(occurrence)
    .innerJoin(event, eq(event.id, occurrence.eventId))
    .where(and(publicFilter(pro, now), gte(occurrence.startsAt, range.start), lt(occurrence.startsAt, range.end)))
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id))
    .limit(PUBLIC_SEANCE_LIMIT);
  if (rows.length === 0) return [];

  const ticketsEventIds = [...new Set(rows.filter((r) => r.bookingMode === "tickets").map((r) => r.eventId))];
  const [elapsed, types] = await Promise.all([
    elapsedHoldsOf(db, pro.professionalId, rows.map((r) => r.occurrenceId), now),
    acceptedTypesOf(db, pro.professionalId, ticketsEventIds),
  ]);
  return rows.map((r) => publicSeanceOf(r, elapsed, types, pro.window));
}

/** The start of the first séance listPublicSeances would show at or after `after`; null when none. */
export async function nextPublicSeanceStart(db: Db, pro: PlanningPro, after: Date, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ startsAt: occurrence.startsAt })
    .from(occurrence)
    .innerJoin(event, eq(event.id, occurrence.eventId))
    .where(and(publicFilter(pro, now), gte(occurrence.startsAt, after)))
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id))
    .limit(1);
  return row?.startsAt ?? null;
}
