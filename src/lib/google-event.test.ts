import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionEvent } from "./google-event";

const base = {
  startAt: new Date("2026-07-03T12:00:00.000Z"),
  endAt: new Date("2026-07-03T13:00:00.000Z"),
  timezone: "Europe/Paris",
};

test("1:1 session → summary appends the single attendee name", () => {
  const ev = buildSessionEvent({
    ...base,
    eventTitle: "Coaching 1h",
    capacity: 1,
    attendees: [{ name: "Alice", email: "alice@example.com" }],
  });
  assert.equal(ev.summary, "Coaching 1h · Alice");
  assert.equal(ev.start.dateTime, "2026-07-03T12:00:00.000Z");
  assert.equal(ev.start.timeZone, "Europe/Paris");
  assert.match(ev.description, /alice@example\.com/);
  assert.match(ev.description, /Géré par Skedul/);
});

test("group session → summary stays the title, description shows seat count", () => {
  const ev = buildSessionEvent({
    ...base,
    eventTitle: "Yoga collectif",
    capacity: 10,
    attendees: [
      { name: "Alice", email: "a@x.com" },
      { name: "Bob", email: "b@x.com" },
    ],
  });
  assert.equal(ev.summary, "Yoga collectif");
  assert.match(ev.description, /2\/10/);
  assert.match(ev.description, /Alice/);
  assert.match(ev.description, /Bob/);
});
