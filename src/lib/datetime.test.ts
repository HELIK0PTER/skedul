import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToKey,
  dayOfWeekForKey,
  startOfDayKey,
  wallClockMinutes,
} from "./datetime";

const TZ = "Europe/Paris";

test("addDaysToKey crosses months, years and leap days", () => {
  assert.equal(addDaysToKey("2026-10-24", 1), "2026-10-25");
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToKey("2028-03-01", -1), "2028-02-29");
  assert.equal(addDaysToKey("2026-10-19", 7), "2026-10-26");
});

test("dayOfWeekForKey: 2026-10-25 is a Sunday, 2026-10-19 a Monday", () => {
  assert.equal(dayOfWeekForKey("2026-10-25"), 0);
  assert.equal(dayOfWeekForKey("2026-10-19"), 1);
});

test("startOfDayKey gives local midnight on both sides of the fall-back change", () => {
  // 25 Oct 2026 starts in summer time (UTC+2), 26 Oct in winter time (UTC+1).
  assert.equal(startOfDayKey("2026-10-25", TZ).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(startOfDayKey("2026-10-26", TZ).toISOString(), "2026-10-25T23:00:00.000Z");
});

test("wallClockMinutes reads the wall clock, not time elapsed since midnight", () => {
  // 25 Oct 2026, 19:00 Paris (UTC+1) = 18:00Z. 20 hours have elapsed since local midnight.
  assert.equal(wallClockMinutes(new Date("2026-10-25T18:00:00Z"), TZ), 19 * 60);
  // 29 Mar 2026, 19:00 Paris (UTC+2) = 17:00Z. Only 18 hours have elapsed.
  assert.equal(wallClockMinutes(new Date("2026-03-29T17:00:00Z"), TZ), 19 * 60);
});
