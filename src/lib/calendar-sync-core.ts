/**
 * Google Calendar sync of ONE occurrence (spec § 13.7), with injected deps so it
 * is testable without network or DB. The Google event id is derived from the
 * occurrence (googleEventId), `occurrence.google_event_id` is only a marker that
 * says « an event may exist ». A Google event is wanted for a scheduled
 * occurrence with at least one confirmed attendee, a séance or an RDV.
 */
import { buildOccurrenceEvent, type GoogleEventBody } from "@/lib/google-event";
import type { OccurrenceStatus } from "@/lib/tickets-vocab";

export interface LoadedOccurrence {
  occurrenceId: string;
  userId: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
  status: OccurrenceStatus;
  isRdv: boolean;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: { name: string; email: string }[];
}

export interface SyncDeps {
  enabled: boolean;
  loadOccurrence: (occurrenceId: string) => Promise<LoadedOccurrence | null>;
  getAccessToken: (userId: string) => Promise<string>;
  insertEvent: (token: string, calendarId: string, body: GoogleEventBody) => Promise<"created" | "exists">;
  patchEvent: (token: string, calendarId: string, eventId: string, body: GoogleEventBody) => Promise<"patched" | "missing">;
  deleteEvent: (token: string, calendarId: string, eventId: string) => Promise<void>;
  saveEventId: (occurrenceId: string, eventId: string | null) => Promise<void>;
}

export type SyncOutcome = "disabled" | "skipped" | "noop" | "deleted" | "created" | "updated";

/** A Google event is wanted for a scheduled occurrence with ≥ 1 confirmed attendee (séance or RDV, spec § 13.7). */
export function wantsGoogleEvent(o: Pick<LoadedOccurrence, "status" | "attendees">): boolean {
  return o.status === "scheduled" && o.attendees.length >= 1;
}

/**
 * Reconcile one occurrence with Google. Nothing wanted and no marker: no token
 * and no API call. Nothing wanted and a marker: delete (404 / 410 count as
 * success) then clear the marker. Wanted: PATCH when there is a marker (a 404
 * falls back to the insert); insert with the deterministic id, and when Google
 * answers « exists » (an event it keeps as cancelled) PATCH the full body, which
 * revives it; then store the marker.
 */
export async function syncOccurrenceWith(occurrenceId: string, deps: SyncDeps): Promise<SyncOutcome> {
  if (!deps.enabled) return "disabled";
  const o = await deps.loadOccurrence(occurrenceId);
  if (!o || !o.googleCalendarId) return "skipped";
  const calendarId = o.googleCalendarId;

  if (!wantsGoogleEvent(o)) {
    if (!o.googleEventId) return "noop";
    const token = await deps.getAccessToken(o.userId);
    await deps.deleteEvent(token, calendarId, o.googleEventId);
    await deps.saveEventId(o.occurrenceId, null);
    return "deleted";
  }

  const token = await deps.getAccessToken(o.userId);
  const body = buildOccurrenceEvent({
    occurrenceId: o.occurrenceId,
    title: o.title,
    isRdv: o.isRdv,
    location: o.location,
    startAt: o.startAt,
    endAt: o.endAt,
    capacity: o.capacity,
    timezone: o.timezone,
    attendees: o.attendees,
  });

  if (o.googleEventId) {
    const patched = await deps.patchEvent(token, calendarId, o.googleEventId, body);
    if (patched === "patched") return "updated";
  }

  const inserted = await deps.insertEvent(token, calendarId, body);
  if (inserted === "exists") await deps.patchEvent(token, calendarId, body.id, body);
  await deps.saveEventId(o.occurrenceId, body.id);
  return "created";
}
