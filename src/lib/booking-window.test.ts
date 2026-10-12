import test from "node:test";
import assert from "node:assert/strict";

import { effectiveWindow, fitsAvailability, lastBookableDate, onlineBookability, type BookingWindow } from "./booking-window";

const TZ = "Europe/Paris";
const PRO: BookingWindow = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };

test("effectiveWindow: each non-null override wins, null and missing fall back to the pro", () => {
  assert.deepEqual(effectiveWindow(PRO), PRO);
  assert.deepEqual(effectiveWindow(PRO, null), PRO);
  assert.deepEqual(
    effectiveWindow(PRO, { bookingHorizonDays: 7, minNoticeMinutes: null, cancelDeadlineHours: null }),
    { bookingHorizonDays: 7, minNoticeMinutes: 60, cancelDeadlineHours: 24 },
  );
  assert.deepEqual(effectiveWindow(PRO, { minNoticeMinutes: 0, cancelDeadlineHours: 0 }), {
    bookingHorizonDays: 60,
    minNoticeMinutes: 0,
    cancelDeadlineHours: 0,
  });
});

test("lastBookableDate counts from the LOCAL today", () => {
  // 22:30Z on 24 Oct is already 25 Oct in Paris.
  assert.equal(lastBookableDate(new Date("2026-10-24T22:30:00Z"), TZ, 60), "2026-12-24");
  assert.equal(lastBookableDate(new Date("2026-10-24T21:30:00Z"), TZ, 60), "2026-12-23");
  assert.equal(lastBookableDate(new Date("2026-10-12T10:00:00Z"), TZ, 1), "2026-10-13");
});

test("onlineBookability: past, notice, horizon, ok", () => {
  const now = new Date("2026-10-12T08:00:00Z"); // 10:00 Paris
  const at = (iso: string) => onlineBookability({ startsAt: new Date(iso), now, tz: TZ, window: PRO });
  assert.deepEqual(at("2026-10-12T08:00:00Z"), { ok: false, reason: "past" });
  assert.deepEqual(at("2026-10-12T07:00:00Z"), { ok: false, reason: "past" });
  assert.deepEqual(at("2026-10-12T08:59:00Z"), { ok: false, reason: "notice" });
  assert.deepEqual(at("2026-10-12T09:00:00Z"), { ok: true });
  // today + 60 = 11 Dec: 23:30 Paris on the 11th is in, 00:30 on the 12th is out.
  assert.deepEqual(at("2026-12-11T22:30:00Z"), { ok: true });
  assert.deepEqual(at("2026-12-11T23:30:00Z"), { ok: false, reason: "horizon" });
});

test("onlineBookability honours an event override", () => {
  const now = new Date("2026-10-12T08:00:00Z");
  const window = effectiveWindow(PRO, { bookingHorizonDays: 7, minNoticeMinutes: 0 });
  assert.deepEqual(onlineBookability({ startsAt: new Date("2026-10-12T08:01:00Z"), now, tz: TZ, window }), { ok: true });
  assert.deepEqual(onlineBookability({ startsAt: new Date("2026-10-19T17:00:00Z"), now, tz: TZ, window }), { ok: true });
  assert.deepEqual(onlineBookability({ startsAt: new Date("2026-10-20T08:00:00Z"), now, tz: TZ, window }), {
    ok: false,
    reason: "horizon",
  });
});

test("fitsAvailability: inside one rule window of the local weekday", () => {
  const rules = [
    { dayOfWeek: 1, startMinute: 600, endMinute: 780 }, // Monday 10:00–13:00
    { dayOfWeek: 0, startMinute: 600, endMinute: 720 }, // Sunday 10:00–12:00
    { dayOfWeek: 5, startMinute: 1320, endMinute: 1440 }, // Friday 22:00–24:00
  ];
  const fits = (s: string, e: string) => fitsAvailability(rules, new Date(s), new Date(e), TZ);
  // Monday 12 Oct 2026, Paris = UTC+2
  assert.equal(fits("2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z"), true);
  assert.equal(fits("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z"), true); // ends exactly 13:00
  assert.equal(fits("2026-10-12T10:30:00Z", "2026-10-12T11:30:00Z"), false); // 12:30–13:30
  assert.equal(fits("2026-10-12T07:30:00Z", "2026-10-12T08:30:00Z"), false); // starts 09:30
  assert.equal(fits("2026-10-13T08:00:00Z", "2026-10-13T09:00:00Z"), false); // Tuesday
  // Sunday 29 March 2026 (spring forward): 10:00 Paris = 08:00Z
  assert.equal(fits("2026-03-29T08:00:00Z", "2026-03-29T09:00:00Z"), true);
  // Friday 16 Oct 23:00–24:00 Paris: ends at the next local midnight
  assert.equal(fits("2026-10-16T21:00:00Z", "2026-10-16T22:00:00Z"), true);
  // Friday 23:30 → Saturday 00:30 crosses midnight
  assert.equal(fits("2026-10-16T21:30:00Z", "2026-10-16T22:30:00Z"), false);
  assert.equal(fits("2026-10-12T09:00:00Z", "2026-10-12T09:00:00Z"), false);
  assert.equal(fitsAvailability([], new Date("2026-10-12T08:00:00Z"), new Date("2026-10-12T09:00:00Z"), TZ), false);
});
