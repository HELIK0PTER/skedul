import test from "node:test";
import assert from "node:assert/strict";

import { computeSlots } from "./availability";

const TZ = "Europe/Paris";
// Fixed "now": Wed 2026-07-01 06:00 UTC (08:00 Paris)
const NOW = new Date("2026-07-01T06:00:00.000Z");
const EVT = "evt_1";

const rules = [
  { dayOfWeek: 5, startMinute: 540, endMinute: 660 }, // Friday 09:00–11:00
];

// Friday 2026-07-03 09:00 Paris = 07:00 UTC
const FRI_0900 = new Date("2026-07-03T07:00:00.000Z");

function base(overrides = {}) {
  return {
    rules,
    busy: [],
    sessions: [],
    eventTypeId: EVT,
    defaultCapacity: 1,
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
    ...overrides,
  };
}

test("an all-day time-off interval removes that day's slots", () => {
  const busy = [
    {
      startAt: new Date("2026-07-02T22:00:00.000Z"),
      endAt: new Date("2026-07-03T22:00:00.000Z"),
    },
  ];
  const slots = computeSlots(base({ busy }));
  const onFriday = slots.filter(
    (s) => s.start >= busy[0].startAt && s.start < busy[0].endAt,
  );
  assert.equal(onFriday.length, 0);
});

test("without time-off, the Friday slots exist", () => {
  const slots = computeSlots(base());
  const fri = slots.filter(
    (s) =>
      s.start >= new Date("2026-07-02T22:00:00.000Z") &&
      s.start < new Date("2026-07-03T22:00:00.000Z"),
  );
  assert.equal(fri.length, 2);
});

test("a fresh slot reports full capacity as seats remaining", () => {
  const slots = computeSlots(base({ defaultCapacity: 6 }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.ok(s);
  assert.equal(s.seatsRemaining, 6);
  assert.equal(s.capacity, 6);
});

test("a partially-filled session is still bookable with its remaining seats", () => {
  const sessions = [
    {
      eventTypeId: EVT,
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 2,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.ok(s);
  assert.equal(s.seatsRemaining, 2);
  assert.equal(s.capacity, 6);
});

test("a full session removes its slot", () => {
  const sessions = [
    {
      eventTypeId: EVT,
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 0,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.equal(s, undefined);
});

test("a session of another event type blocks this event's overlapping slot", () => {
  const sessions = [
    {
      eventTypeId: "evt_other",
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 3,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.equal(s, undefined);
});
