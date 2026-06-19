import test from "node:test";
import assert from "node:assert/strict";

import { computeSlots } from "./availability";

const TZ = "Europe/Paris";
// Fixed "now": Wed 2026-07-01 06:00 UTC (08:00 Paris)
const NOW = new Date("2026-07-01T06:00:00.000Z");

const rules = [
  { dayOfWeek: 5, startMinute: 540, endMinute: 660 }, // Friday 09:00–11:00
];

test("an all-day time-off interval removes that day's slots", () => {
  // Friday 2026-07-03 all day, in Paris (UTC+2)
  const busy = [
    {
      startAt: new Date("2026-07-02T22:00:00.000Z"),
      endAt: new Date("2026-07-03T22:00:00.000Z"),
    },
  ];
  const slots = computeSlots({
    rules,
    busy,
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
  });
  const onFriday = slots.filter(
    (s) => s.start >= busy[0].startAt && s.start < busy[0].endAt,
  );
  assert.equal(onFriday.length, 0);
});

test("without time-off, the Friday slots exist", () => {
  const slots = computeSlots({
    rules,
    busy: [],
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
  });
  // Friday 2026-07-03 should yield 09:00 and 10:00 starts
  const fri = slots.filter(
    (s) =>
      s.start >= new Date("2026-07-02T22:00:00.000Z") &&
      s.start < new Date("2026-07-03T22:00:00.000Z"),
  );
  assert.equal(fri.length, 2);
});
