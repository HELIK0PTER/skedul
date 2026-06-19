import test from "node:test";
import assert from "node:assert/strict";

import { buildTimeOffInterval, coveredDayKeys } from "./timeoff";

const TZ = "Europe/Paris"; // UTC+2 in July

test("all-day single day → [00:00, next 00:00)", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-03", allDay: true },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-02T22:00:00.000Z");
  assert.equal(endAt.toISOString(), "2026-07-03T22:00:00.000Z");
});

test("all-day multi day → exclusive end is midnight after last day", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-05", allDay: true },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-02T22:00:00.000Z");
  // exclusive end = 2026-07-06 00:00 Paris = 2026-07-05 22:00 UTC
  assert.equal(endAt.toISOString(), "2026-07-05T22:00:00.000Z");
});

test("timed single day → wall-clock minutes mapped to instants", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    {
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      allDay: false,
      startMinute: 840, // 14:00
      endMinute: 960, // 16:00
    },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-03T12:00:00.000Z");
  assert.equal(endAt.toISOString(), "2026-07-03T14:00:00.000Z");
});

test("timed range across two days is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      {
        startDate: "2026-07-03",
        endDate: "2026-07-04",
        allDay: false,
        startMinute: 840,
        endMinute: 960,
      },
      TZ,
    ),
  );
});

test("timed range with end <= start is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      {
        startDate: "2026-07-03",
        endDate: "2026-07-03",
        allDay: false,
        startMinute: 960,
        endMinute: 840,
      },
      TZ,
    ),
  );
});

test("all-day endDate before startDate is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      { startDate: "2026-07-05", endDate: "2026-07-03", allDay: true },
      TZ,
    ),
  );
});

test("coveredDayKeys lists each local day in an all-day range", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-05", allDay: true },
    TZ,
  );
  assert.deepEqual(coveredDayKeys(startAt, endAt, TZ), [
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
  ]);
});

test("coveredDayKeys lists a single day for a timed range", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    {
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      allDay: false,
      startMinute: 840,
      endMinute: 960,
    },
    TZ,
  );
  assert.deepEqual(coveredDayKeys(startAt, endAt, TZ), ["2026-07-03"]);
});
