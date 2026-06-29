import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { booking, classSession, customer, eventType, professional } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  deleteEvent as gDeleteEvent,
  insertEvent as gInsertEvent,
  patchEvent as gPatchEvent,
} from "@/lib/google-calendar";
import { syncSessionWith, type SyncDeps, type LoadedSession } from "@/lib/calendar-sync-core";

/** Loads a session with its active attendees + the pro's Google connection. */
async function loadSession(sid: string): Promise<LoadedSession | null> {
  const rows = await db
    .select({
      sessionId: classSession.id,
      professionalId: classSession.professionalId,
      userId: professional.userId,
      googleCalendarId: professional.googleCalendarId,
      googleEventId: classSession.googleEventId,
      eventTitle: eventType.title,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
      timezone: professional.timezone,
    })
    .from(classSession)
    .innerJoin(professional, eq(professional.id, classSession.professionalId))
    .innerJoin(eventType, eq(eventType.id, classSession.eventTypeId))
    .where(eq(classSession.id, sid))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const attendees = await db
    .select({ name: customer.name, email: customer.email, status: booking.status })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(eq(booking.sessionId, sid));

  return {
    ...row,
    attendees: attendees
      .filter((a) => a.status === "pending" || a.status === "confirmed")
      .map((a) => ({ name: a.name, email: a.email })),
  };
}

async function getAccessToken(userId: string): Promise<string> {
  const result = await auth.api.getAccessToken({
    body: { providerId: "google", userId },
  });
  return result.accessToken;
}

async function saveEventId(sid: string, eventId: string | null): Promise<void> {
  await db
    .update(classSession)
    .set({ googleEventId: eventId })
    .where(eq(classSession.id, sid));
}

const defaultDeps: SyncDeps = {
  enabled: env.GOOGLE_CALENDAR_ENABLED,
  loadSession,
  getAccessToken,
  insertEvent: gInsertEvent,
  patchEvent: gPatchEvent,
  deleteEvent: gDeleteEvent,
  saveEventId,
};

/** Best-effort public entry point — never throws into a booking flow. */
export async function syncSession(sessionId: string): Promise<void> {
  try {
    await syncSessionWith(sessionId, defaultDeps);
  } catch (err) {
    console.error(`[calendar-sync] session ${sessionId} failed:`, err);
  }
}
