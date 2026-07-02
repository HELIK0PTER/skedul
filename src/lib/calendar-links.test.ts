import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
} from "./calendar-links";

const base = {
  title: "Coaching 1h",
  description: "Rendez-vous avec Altinha Paris",
  startAt: new Date("2026-07-03T12:00:00.000Z"),
  endAt: new Date("2026-07-03T13:00:00.000Z"),
};

test("googleCalendarUrl → render?action=TEMPLATE with UTC compact dates", () => {
  const url = new URL(googleCalendarUrl(base));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Coaching 1h");
  assert.equal(url.searchParams.get("details"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("dates"), "20260703T120000Z/20260703T130000Z");
});

test("outlookCalendarUrl → deeplink/compose with ISO dates", () => {
  const url = new URL(outlookCalendarUrl(base));
  assert.equal(
    url.origin + url.pathname,
    "https://outlook.live.com/calendar/0/deeplink/compose",
  );
  assert.equal(url.searchParams.get("rru"), "addevent");
  assert.equal(url.searchParams.get("subject"), "Coaching 1h");
  assert.equal(url.searchParams.get("body"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("startdt"), "2026-07-03T12:00:00.000Z");
  assert.equal(url.searchParams.get("enddt"), "2026-07-03T13:00:00.000Z");
  assert.equal(url.searchParams.get("path"), null);
});

test("buildIcs → valid VCALENDAR with CRLF lines and UID", () => {
  const ics = buildIcs({ ...base, uid: "bk_123@skedul.app" });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("UID:bk_123@skedul.app"));
  assert.ok(lines.includes("DTSTART:20260703T120000Z"));
  assert.ok(lines.includes("DTEND:20260703T130000Z"));
  assert.ok(lines.includes("SUMMARY:Coaching 1h"));
  assert.ok(lines.includes("END:VCALENDAR"));
  // file ends with a CRLF
  assert.ok(ics.endsWith("\r\n"));
});

test("buildIcs → escapes commas, semicolons and newlines in text", () => {
  const ics = buildIcs({
    ...base,
    uid: "bk_esc@skedul.app",
    title: "Yoga; doux, matin",
    description: "Ligne 1\nLigne 2",
  });
  assert.ok(ics.includes("SUMMARY:Yoga\\; doux\\, matin"));
  assert.ok(ics.includes("DESCRIPTION:Ligne 1\\nLigne 2"));
});
