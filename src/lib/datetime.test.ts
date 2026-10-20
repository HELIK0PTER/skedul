import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToKey,
  dayOfWeekForKey,
  dayOrdinal,
  formatDateLong,
  formatDateShort,
  formatDateTimeShort,
  frenchFirst,
  instantFromWallClock,
  startOfDayKey,
  wallClockMinutes,
} from "./datetime";

const TZ = "Europe/Paris";
const NY = "America/New_York";
const SYDNEY = "Australia/Sydney";

/** Every wall-clock case below, run by the tests under several host zones. */
function assertWallClockCases() {
  // Ordinary times: summer (UTC+2) and winter (UTC+1).
  assert.equal(instantFromWallClock(2026, 10, 12, 1140, TZ).toISOString(), "2026-10-12T17:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 1, 15, 600, TZ).toISOString(), "2026-01-15T09:00:00.000Z");
  // Local midnight, and 1440 = the next local midnight.
  assert.equal(instantFromWallClock(2026, 3, 1, 0, TZ).toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 26, 0, TZ).toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 1440, TZ).toISOString(), "2026-10-25T23:00:00.000Z");
  // Paris fall-back (25 Oct 2026, 03:00 CEST -> 02:00 CET): 02:00-02:59 happens twice, first instant wins.
  assert.equal(instantFromWallClock(2026, 10, 25, 119, TZ).toISOString(), "2026-10-24T23:59:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 120, TZ).toISOString(), "2026-10-25T00:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 150, TZ).toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 179, TZ).toISOString(), "2026-10-25T00:59:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 180, TZ).toISOString(), "2026-10-25T02:00:00.000Z");
  // Paris spring-forward (29 Mar 2026, 02:00 CET -> 03:00 CEST): 02:00-02:59 does not exist, shifted forward.
  assert.equal(instantFromWallClock(2026, 3, 29, 119, TZ).toISOString(), "2026-03-29T00:59:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 29, 120, TZ).toISOString(), "2026-03-29T01:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 29, 150, TZ).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 29, 180, TZ).toISOString(), "2026-03-29T01:00:00.000Z");
  // New York (UTC-4 / UTC-5): fall-back 1 Nov 2026 (01:30 happens twice), spring-forward 8 Mar 2026 (02:30 does not exist).
  assert.equal(instantFromWallClock(2026, 11, 1, 90, NY).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 8, 150, NY).toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 7, 4, 720, NY).toISOString(), "2026-07-04T16:00:00.000Z");
  // Southern hemisphere (UTC+11 / UTC+10): fall-back 5 Apr 2026, spring-forward 4 Oct 2026.
  assert.equal(instantFromWallClock(2026, 4, 5, 150, SYDNEY).toISOString(), "2026-04-04T15:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 4, 150, SYDNEY).toISOString(), "2026-10-03T16:30:00.000Z");
  // A zone without daylight saving time.
  assert.equal(instantFromWallClock(2026, 10, 12, 600, "UTC").toISOString(), "2026-10-12T10:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 12, 600, "Asia/Kolkata").toISOString(), "2026-10-12T04:30:00.000Z");
}

test("instantFromWallClock: Paris overlap takes the first instant, gap shifts forward", () => {
  // Spec section 7: 02:30 on 2026-10-25 (repeated) -> 00:30Z; 02:30 on 2026-03-29 (missing) -> 03:30 CEST = 01:30Z.
  assert.equal(instantFromWallClock(2026, 10, 25, 150, TZ).toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 29, 150, TZ).toISOString(), "2026-03-29T01:30:00.000Z");
});

test("instantFromWallClock: normal Paris times, local midnight and 1440", () => {
  assert.equal(instantFromWallClock(2026, 10, 12, 1140, TZ).toISOString(), "2026-10-12T17:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 1, 0, TZ).toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(instantFromWallClock(2026, 10, 25, 1440, TZ).toISOString(), "2026-10-25T23:00:00.000Z");
});

test("instantFromWallClock: America/New_York overlap and gap", () => {
  assert.equal(instantFromWallClock(2026, 11, 1, 90, NY).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(instantFromWallClock(2026, 3, 8, 150, NY).toISOString(), "2026-03-08T07:30:00.000Z");
});

test("instantFromWallClock does not depend on the host time zone", () => {
  const previous = process.env.TZ;
  try {
    for (const hostTz of ["UTC", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"]) {
      process.env.TZ = hostTz;
      try {
        assertWallClockCases();
      } catch (error) {
        throw new Error(`host TZ=${hostTz}: ${(error as Error).message}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

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

test("dayOrdinal: only the first of the month takes the ordinal", () => {
  assert.equal(dayOrdinal(1), "1er");
  for (const d of [2, 10, 11, 21, 31]) assert.equal(dayOrdinal(d), String(d));
});

test("frenchFirst writes « 1er » for a day 1 followed by a month name, long or short", () => {
  assert.equal(frenchFirst("dimanche 1 novembre"), "dimanche 1er novembre");
  assert.equal(frenchFirst("dim. 1 novembre 2026"), "dim. 1er novembre 2026");
  assert.equal(frenchFirst("1 janvier 2027"), "1er janvier 2027");
  assert.equal(frenchFirst("1 mai"), "1er mai");
  assert.equal(frenchFirst("1 août 2026"), "1er août 2026");
  assert.equal(frenchFirst("1 déc. 2026, 09:05"), "1er déc. 2026, 09:05");
  for (const short of ["janv.", "févr.", "avr.", "juil.", "sept.", "oct.", "nov.", "déc."]) {
    assert.equal(frenchFirst(`1 ${short} 2026`), `1er ${short} 2026`);
  }
  // The space may be a no-break one.
  assert.equal(frenchFirst("1\u00a0novembre"), "1er\u00a0novembre");
  // Both ends of a sentence, and more than one date.
  assert.equal(frenchFirst("du 1 mars au 1 avril"), "du 1er mars au 1er avril");
});

test("frenchFirst leaves every other number alone", () => {
  for (const same of [
    "lundi 11 octobre",
    "mercredi 21 octobre",
    "samedi 31 octobre",
    "dim. 10 novembre 2026",
    "lun. 12 octobre 2026 · 19:01 à 20:01",
    "01:30 à 01:30",
    "1 inscrit sur 12",
    "1 séance",
    "à 1 heure",
    "1 marseille",
    "2026 11 mai",
    "1er novembre",
    "dim. 1",
  ]) {
    assert.equal(frenchFirst(same), same);
  }
  // Idempotent.
  assert.equal(frenchFirst(frenchFirst("dimanche 1 novembre")), "dimanche 1er novembre");
});

test("the long date labels of datetime.ts write « 1er » on the first of the month, host zone ignored", () => {
  const first = new Date("2026-11-01T10:00:00Z");
  assert.equal(formatDateLong(first, TZ), "dimanche 1er novembre");
  assert.equal(formatDateShort(first, TZ), "1er nov. 2026");
  assert.equal(formatDateTimeShort(first, TZ), "1er nov. 2026, 11:00");
  // Other days keep their number.
  const eleventh = new Date("2026-11-11T10:00:00Z");
  assert.equal(formatDateLong(eleventh, TZ), "mercredi 11 novembre");
  assert.equal(formatDateShort(eleventh, TZ), "11 nov. 2026");
  const thirtyFirst = new Date("2026-10-31T10:00:00Z");
  assert.equal(formatDateLong(thirtyFirst, TZ), "samedi 31 octobre");
  assert.equal(formatDateTimeShort(thirtyFirst, TZ), "31 oct. 2026, 11:00");
});
