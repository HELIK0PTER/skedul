/**
 * Database side of the Google sync of one occurrence. No `server-only`, no
 * next/* and no session: the pure sync core (calendar-sync-core.ts) takes these
 * functions as deps, and the DB tests call them directly. The occurrence id
 * comes from the engine (an effect), never from user input; the pro, the user
 * and the calendar are always read from the occurrence's own professional.
 */
import { and, asc, eq } from "drizzle-orm";

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
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(and(eq(booking.occurrenceId, occurrenceId), eq(booking.status, "confirmed")))
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

/** Stores (or clears) the Google marker of one occurrence. */
export async function saveGoogleEventId(db: Db, occurrenceId: string, eventId: string | null): Promise<void> {
  await db.update(occurrence).set({ googleEventId: eventId }).where(eq(occurrence.id, occurrenceId));
}

/**
 * Disconnect (Q33): one batch clears the pro's calendar id and every Google
 * marker of the pro. Nothing is backfilled when the pro connects again: only
 * occurrences that change afterwards are synced.
 */
export async function clearGoogleLink(db: Db, professionalId: string): Promise<void> {
  await db.batch([
    db.update(professional).set({ googleCalendarId: null }).where(eq(professional.id, professionalId)),
    db.update(occurrence).set({ googleEventId: null }).where(eq(occurrence.professionalId, professionalId)),
  ]);
}
