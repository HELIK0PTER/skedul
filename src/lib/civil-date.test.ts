import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  addMonthsClamped,
  compareKeys,
  dayNumber,
  dayOfWeek,
  daysInMonth,
  diffDays,
  formatDayMonth,
  formatDayMonthYear,
  fromDayNumber,
  instantAt,
  makeKey,
  maxKey,
  minKey,
  mondayOf,
  monthIndex,
  nthWeekdayOfMonth,
  parseKey,
  todayKey,
} from "./civil-date";

const TZ = "Europe/Paris";

test("parseKey reads a key and rejects malformed or impossible dates", () => {
  assert.deepEqual(parseKey("2026-10-12"), { y: 2026, m: 10, d: 12 });
  assert.deepEqual(parseKey("2028-02-29"), { y: 2028, m: 2, d: 29 });
  for (const bad of ["2026-13-01", "2026-00-10", "2026-02-29", "2026-04-31", "26-1-1", "2026-1-01", "", "2026-10-12T00:00"]) {
    assert.throws(() => parseKey(bad), /Invalid date key/, bad);
  }
});

test("makeKey normalises overflowing months and days", () => {
  assert.equal(makeKey(2026, 2, 31), "2026-03-03");
  assert.equal(makeKey(2026, 13, 1), "2027-01-01");
  assert.equal(makeKey(2026, 0, 1), "2025-12-01");
  assert.equal(makeKey(2026, 3, 0), "2026-02-28");
  assert.equal(makeKey(2026, 10, 12), "2026-10-12");
});

test("dayNumber and fromDayNumber round-trip around the epoch", () => {
  assert.equal(dayNumber("1970-01-01"), 0);
  assert.equal(dayNumber("1969-12-31"), -1);
  assert.equal(dayNumber("1970-01-02"), 1);
  for (const key of ["1969-12-31", "2000-02-29", "2026-03-29", "2026-10-25", "2099-12-31"]) {
    assert.equal(fromDayNumber(dayNumber(key)), key);
  }
});

test("addDays and diffDays cross months, years and leap days", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(diffDays("2026-10-12", "2026-10-26"), 14);
  assert.equal(diffDays("2026-10-26", "2026-10-12"), -14);
  assert.equal(diffDays("2026-01-01", "2027-01-01"), 365);
  assert.equal(diffDays("2028-01-01", "2029-01-01"), 366);
});

test("dayOfWeek: 0 = Sunday … 6 = Saturday", () => {
  assert.equal(dayOfWeek("2026-10-14"), 3);
  assert.equal(dayOfWeek("2026-11-01"), 0);
  assert.equal(dayOfWeek("2026-10-30"), 5);
  assert.equal(dayOfWeek("2026-10-12"), 1);
  assert.equal(dayOfWeek("2026-10-17"), 6);
});

test("mondayOf returns the Monday of the ISO week (Sunday belongs to the week before)", () => {
  assert.equal(mondayOf("2026-10-12"), "2026-10-12");
  assert.equal(mondayOf("2026-10-14"), "2026-10-12");
  assert.equal(mondayOf("2026-10-18"), "2026-10-12");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
});

test("daysInMonth and monthIndex", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(monthIndex("2026-01-15"), 2026 * 12);
  assert.equal(monthIndex("2026-12-01"), 2026 * 12 + 11);
});

test("addMonthsClamped clamps to the target month's last day", () => {
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsClamped("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonthsClamped("2026-08-31", 1), "2026-09-30");
  assert.equal(addMonthsClamped("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonthsClamped("2026-01-15", -1), "2025-12-15");
  assert.equal(addMonthsClamped("2026-02-28", 12), "2027-02-28");
  assert.equal(addMonthsClamped("2026-10-12", 0), "2026-10-12");
});

test("nthWeekdayOfMonth: 1st..4th and last", () => {
  assert.equal(nthWeekdayOfMonth(2026, 11, 0, 1), "2026-11-01");
  assert.equal(nthWeekdayOfMonth(2026, 12, 5, -1), "2026-12-25");
  assert.equal(nthWeekdayOfMonth(2026, 10, 5, -1), "2026-10-30");
  assert.equal(nthWeekdayOfMonth(2026, 10, 2, 2), "2026-10-13");
  assert.equal(nthWeekdayOfMonth(2026, 2, 6, 4), "2026-02-28");
  assert.equal(nthWeekdayOfMonth(2026, 12, 0, 1), "2026-12-06");
  assert.equal(nthWeekdayOfMonth(2027, 1, 0, 1), "2027-01-03");
  assert.equal(nthWeekdayOfMonth(2026, 3, 0, -1), "2026-03-29");
});

test("compareKeys, minKey, maxKey", () => {
  assert.equal(compareKeys("2026-10-12", "2026-10-13"), -1);
  assert.equal(compareKeys("2026-10-13", "2026-10-12"), 1);
  assert.equal(compareKeys("2026-10-12", "2026-10-12"), 0);
  assert.equal(minKey("2026-10-12", "2025-12-31"), "2025-12-31");
  assert.equal(maxKey("2026-10-12", "2025-12-31"), "2026-10-12");
});

test("todayKey is the local date in tz, not the UTC date", () => {
  // 22:30Z on 24 Oct 2026 is 00:30 on the 25th in Paris (summer time).
  assert.equal(todayKey(new Date("2026-10-24T22:30:00Z"), TZ), "2026-10-25");
  assert.equal(todayKey(new Date("2026-10-24T21:59:59Z"), TZ), "2026-10-24");
  assert.equal(todayKey(new Date("2026-10-24T22:30:00Z"), "UTC"), "2026-10-24");
});

test("instantAt follows Paris DST: shift forward, first instant, local midnight", () => {
  assert.equal(instantAt("2026-03-29", 150, TZ).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(instantAt("2026-10-25", 150, TZ).toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(instantAt("2026-03-01", 0, TZ).toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(instantAt("2026-10-26", 0, TZ).toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(instantAt("2026-10-12", 1140, TZ).toISOString(), "2026-10-12T17:00:00.000Z");
  // 1440 = the next local midnight
  assert.equal(instantAt("2026-02-28", 1440, TZ).toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(instantAt("2026-10-25", 1440, TZ).toISOString(), "2026-10-25T23:00:00.000Z");
});

test("formatDayMonth and formatDayMonthYear", () => {
  assert.equal(formatDayMonth("2026-10-12"), "12/10");
  assert.equal(formatDayMonth("2026-06-30"), "30/06");
  assert.equal(formatDayMonthYear("2026-10-12"), "12/10/2026");
  assert.equal(formatDayMonthYear("2027-01-03"), "03/01/2027");
});
