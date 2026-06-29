import "server-only";

import type { GoogleEventBody } from "@/lib/google-event";

const API = "https://www.googleapis.com/calendar/v3";

async function call(
  accessToken: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return res;
}

async function ensureOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Calendar ${action} failed (${res.status}): ${text}`);
  }
}

/** Creates the dedicated "Skedul" secondary calendar; returns its id. */
export async function createSkedulCalendar(
  accessToken: string,
): Promise<string> {
  const res = await call(accessToken, "/calendars", {
    method: "POST",
    body: { summary: "Skedul" },
  });
  await ensureOk(res, "create calendar");
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventBody,
): Promise<string> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body },
  );
  await ensureOk(res, "insert event");
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body },
  );
  await ensureOk(res, "patch event");
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // 404/410 = already gone → treat as success.
  if (res.status === 404 || res.status === 410) return;
  await ensureOk(res, "delete event");
}
