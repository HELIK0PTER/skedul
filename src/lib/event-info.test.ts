import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COLOR, eventInfoSchema, eventInputSchema } from "./tickets";

const INFO_KEYS = [
  "bookingMode",
  "capacity",
  "color",
  "description",
  "isPrivate",
  "location",
  "overrides",
  "questions",
  "ticketTypeIds",
  "title",
];

const once = {
  startDate: "2026-10-20",
  startMinute: 600,
  freq: "once",
  interval: 1,
  weekdays: null,
  monthlyBy: null,
  monthWeek: null,
  endMode: "count",
  untilDate: null,
  occurrenceCount: 1,
};

test("eventInfoSchema has the information fields of an event and no schedule field", () => {
  assert.deepEqual(Object.keys(eventInfoSchema.shape).sort(), INFO_KEYS);
  for (const key of ["rule", "durationMin"]) assert.ok(!(key in eventInfoSchema.shape), key);
});

test("eventInfoSchema fills the same defaults as eventInputSchema", () => {
  const info = eventInfoSchema.parse({ title: "  Cours  " });
  assert.deepEqual(info, {
    title: "Cours",
    description: null,
    location: null,
    color: DEFAULT_COLOR,
    bookingMode: "tickets",
    isPrivate: false,
    capacity: 12,
    overrides: { bookingHorizonDays: null, minNoticeMinutes: null, cancelDeadlineHours: null },
    ticketTypeIds: [],
    questions: [],
  });
  const full = eventInputSchema.parse({ title: "  Cours  ", rule: once });
  for (const key of Object.keys(info) as (keyof typeof info)[]) assert.deepEqual(info[key], full[key], key);
});

test("eventInfoSchema refuses what eventInputSchema refuses and drops the schedule", () => {
  assert.equal(eventInfoSchema.safeParse({ title: "" }).success, false);
  assert.equal(eventInfoSchema.safeParse({ title: "A", capacity: 501 }).success, false);
  assert.equal(eventInfoSchema.safeParse({ title: "A", color: "red" }).success, false);
  const parsed = eventInfoSchema.parse({ title: "A", durationMin: 90, rule: once });
  assert.equal("rule" in parsed, false);
  assert.equal("durationMin" in parsed, false);
});
