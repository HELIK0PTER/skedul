import { buildSessionEvent } from "@/lib/google-event";

export interface LoadedSession {
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
