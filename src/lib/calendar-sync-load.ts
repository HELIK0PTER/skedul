/**
 * Database side of the Google sync of one occurrence. No `server-only`, no
 * next/* and no session: the pure sync core (calendar-sync-core.ts) takes these
 * functions as deps, and the DB tests call them directly. The occurrence id
 * comes from the engine (an effect), never from user input; the pro, the user
 * and the calendar are always read from the occurrence's own professional.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";

import type { LoadedOccurrence } from "@/lib/calendar-sync-core";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, occurrence, professional, ticketType } from "@/lib/db/schema";

/**
 * The occurrence as the sync needs it: pro user and calendar, title = event
 * title or type name (RDV), location = COALESCE(location_override, event.location)
 * (null for an RDV), confirmed attendees by created_at.
 */
export async function loadOccurrenceForSync(db: Db, occurrenceId: string): Promise<LoadedOccurrence | null> {
  const rows = await db
    .select({
      occurrenceId: occurrence.id,
      professionalId: occurrence.professionalId,
      userId: professional.userId,
      googleCalendarId: professional.googleCalendarId,
      timezone: professional.timezone,
      googleEventId: occurrence.googleEventId,
      status: occurrence.status,
      eventId: occurrence.eventId,
      eventTitle: event.title,
      eventLocation: event.location,
      locationOverride: occurrence.locationOverride,
      typeName: ticketType.name,
      startAt: occurrence.startsAt,
      endAt: occurrence.endsAt,
      capacity: occurrence.capacity,
    })
    .from(occurrence)
    .innerJoin(professional, eq(professional.id, occurrence.professionalId))
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(eq(occurrence.id, occurrenceId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const attendees = await db
    .select({ name: customer.name, email: customer.email })
    .from(booking)
    // The customer is joined through the occurrence's own pro (no composite FK enforces it): a booking
    // pointing at another pro's customer never puts that person's name and address in this pro's calendar.
    .innerJoin(customer, and(eq(customer.id, booking.customerId), eq(customer.professionalId, row.professionalId)))
    .where(
      and(
        eq(booking.occurrenceId, occurrenceId),
        eq(booking.professionalId, row.professionalId),
        eq(booking.status, "confirmed"),
      ),
    )
    .orderBy(asc(booking.createdAt), asc(booking.id));

  const isRdv = row.eventId === null;
  return {
    occurrenceId: row.occurrenceId,
    userId: row.userId,
    googleCalendarId: row.googleCalendarId,
    googleEventId: row.googleEventId,
    status: row.status,
    isRdv,
    title: (isRdv ? row.typeName : row.eventTitle) ?? "",
    location: isRdv ? null : (row.locationOverride ?? row.eventLocation ?? null),
    startAt: row.startAt,
    endAt: row.endAt,
    capacity: row.capacity,
    timezone: row.timezone,
    attendees,
  };
}

/**
 * Backfill (final review COV-2): the ids, soonest first, of the pro's future
 * scheduled occurrences that the calendar must hold (spec § 13.7): at least
 * one confirmed booking, séance or RDV (a pending hold, live or lapsed, is not
 * a booking, nor is a cancelled one). A marker already stored does not exclude
 * an occurrence: the sync is idempotent, and a marker left by a run that
 * started before a disconnect would otherwise hide it from the new calendar.
 * The pro comes from the session, never from input; both the occurrence and
 * the booking rows are scoped to it. The booking filter is an uncorrelated
 * sub-select, so no outer column is interpolated into it (drizzle would
 * render it unqualified).
 */
export async function listOccurrenceIdsToBackfill(
  db: Db,
  professionalId: string,
  now: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: occurrence.id })
    .from(occurrence)
    .where(
      and(
        eq(occurrence.professionalId, professionalId),
        eq(occurrence.status, "scheduled"),
        gt(occurrence.startsAt, now),
        inArray(
          occurrence.id,
          db
            .select({ id: booking.occurrenceId })
            .from(booking)
            .where(and(eq(booking.professionalId, professionalId), eq(booking.status, "confirmed"))),
        ),
      ),
    )
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Stores (or clears) the Google marker of one occurrence. */
export async function saveGoogleEventId(db: Db, occurrenceId: string, eventId: string | null): Promise<void> {
  await db.update(occurrence).set({ googleEventId: eventId }).where(eq(occurrence.id, occurrenceId));
}

/**
 * Disconnect (Q33): one batch clears the pro's calendar id and every Google
 * marker of the pro. Nothing is synced here: a later connection backfills the
 * booked future occurrences itself (listOccurrenceIdsToBackfill, COV-2).
 */
export async function clearGoogleLink(db: Db, professionalId: string): Promise<void> {
  await db.batch([
    db.update(professional).set({ googleCalendarId: null }).where(eq(professional.id, professionalId)),
    db.update(occurrence).set({ googleEventId: null }).where(eq(occurrence.professionalId, professionalId)),
  ]);
}
