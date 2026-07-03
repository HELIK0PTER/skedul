import test from "node:test";
import assert from "node:assert/strict";

import { getMonthGridDays, parseDayKey, toDayKey } from "./calendar-grid";

test("toDayKey: formats a local date as yyyy-MM-dd", () => {
  assert.equal(toDayKey(new Date(2026, 6, 3)), "2026-07-03"); // month is 0-indexed (June=5, July=6)
});

test("toDayKey: pads single-digit month and day", () => {
  assert.equal(toDayKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("parseDayKey: round-trips with toDayKey", () => {
  const key = "2026-07-28";
  assert.equal(toDayKey(parseDayKey(key)), key);
});

test("getMonthGridDays: starts on a Monday and ends on a Sunday", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1)); // July 2026
  assert.equal(days[0].getDay(), 1); // Monday
  assert.equal(days[days.length - 1].getDay(), 0); // Sunday
});

test("getMonthGridDays: length is a multiple of 7", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1));
  assert.equal(days.length % 7, 0);
});

test("getMonthGridDays: includes every day of the target month", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1)); // July 2026 has 31 days
  const julyDays = days.filter((d) => d.getMonth() === 6 && d.getFullYear() === 2026);
  assert.equal(julyDays.length, 31);
  assert.equal(toDayKey(julyDays[0]), "2026-07-01");
  assert.equal(toDayKey(julyDays[julyDays.length - 1]), "2026-07-31");
});

test("getMonthGridDays: February in a leap year", () => {
  const days = getMonthGridDays(new Date(2028, 1, 15)); // Feb 2028, leap year
  const febDays = days.filter((d) => d.getMonth() === 1 && d.getFullYear() === 2028);
  assert.equal(febDays.length, 29);
});
