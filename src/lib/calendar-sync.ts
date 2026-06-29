import { buildSessionEvent } from "@/lib/google-event";

interface LoadedSession {
  sessionId: string;
  professionalId: string;
  userId: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
  eventTitle: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: { name: string; email: string }[];
}

export interface SyncDeps {
  enabled: boolean;
  loadSession: (sessionId: string) => Promise<LoadedSession | null>;
  getAccessToken: (userId: string) => Promise<string>;
  insertEvent: (token: string, calId: string, body: ReturnType<typeof buildSessionEvent>) => Promise<string>;
  patchEvent: (token: string, calId: string, eventId: string, body: ReturnType<typeof buildSessionEvent>) => Promise<void>;
  deleteEvent: (token: string, calId: string, eventId: string) => Promise<void>;
  saveEventId: (sessionId: string, eventId: string | null) => Promise<void>;
}

/** Testable core: reconcile one session against Google with injected deps. */
export async function syncSessionWith(
  sessionId: string,
  deps: SyncDeps,
): Promise<void> {
  if (!deps.enabled) return;
  const s = await deps.loadSession(sessionId);
  if (!s || !s.googleCalendarId) return;

  const token = await deps.getAccessToken(s.userId);

  // No active attendees → remove the event if one exists.
  if (s.attendees.length === 0) {
    if (s.googleEventId) {
      await deps.deleteEvent(token, s.googleCalendarId, s.googleEventId);
      await deps.saveEventId(sessionId, null);
    }
    return;
  }

  const body = buildSessionEvent({
    eventTitle: s.eventTitle,
    startAt: s.startAt,
    endAt: s.endAt,
    capacity: s.capacity,
    timezone: s.timezone,
    attendees: s.attendees,
  });

  if (s.googleEventId) {
    await deps.patchEvent(token, s.googleCalendarId, s.googleEventId, body);
  } else {
    const eventId = await deps.insertEvent(token, s.googleCalendarId, body);
    await deps.saveEventId(sessionId, eventId);
  }
}

/** Best-effort public entry point — never throws into a booking flow. */
export async function syncSession(sessionId: string): Promise<void> {
  // Lazy-load server-side deps so the module can be imported in test environments
  // without DATABASE_URL / BETTER_AUTH_SECRET being present.
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { booking, classSession, customer, eventType, professional } =
    await import("@/lib/db/schema");
  const { auth } = await import("@/lib/auth");
  const { env } = await import("@/lib/env");
  const {
    deleteEvent: gDeleteEvent,
    insertEvent: gInsertEvent,
    patchEvent: gPatchEvent,
  } = await import("@/lib/google-calendar");

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

  try {
    await syncSessionWith(sessionId, defaultDeps);
  } catch (err) {
    console.error(`[calendar-sync] session ${sessionId} failed:`, err);
  }
}
