import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COLOR } from "@/lib/tickets-vocab";

import { defaultEventStart, EVENT_DEFAULTS, parseClickedCell } from "./event-defaults";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";

// 2026-10-14 is a Wednesday; Paris is on summer time (UTC+2) until 25 October.
const parisAt = (hhmm: string, day = "2026-10-14") => new Date(`${day}T${hhmm}:00+02:00`);

test("EVENT_DEFAULTS", () => {
  assert.deepEqual(EVENT_DEFAULTS, { durationMin: 60, capacity: 12, bookingMode: "tickets", color: DEFAULT_COLOR });
});

test("a clicked cell today or later wins, its minute rounded down to 30", () => {
  const now = parisAt("10:00");
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked: { date: "2026-10-20", minute: 615 } }), {
    startDate: "2026-10-20",
    startMinute: 600,
  });
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked: { date: "2026-10-20", minute: 630 } }), {
    startDate: "2026-10-20",
    startMinute: 630,
  });
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked: { date: "2026-10-20", minute: 1439 } }), {
    startDate: "2026-10-20",
    startMinute: 1410,
  });
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked: { date: "2026-10-14", minute: 1100 } }), {
    startDate: "2026-10-14",
    startMinute: 1080,
  });
});

test("a clicked past date gives the default start", () => {
  const now = parisAt("10:20");
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked: { date: "2026-10-13", minute: 600 } }), {
    startDate: "2026-10-14",
    startMinute: 660,
  });
});

test("no click: the next full hour today", () => {
  assert.deepEqual(defaultEventStart({ now: parisAt("22:10"), tz: PARIS }), { startDate: "2026-10-14", startMinute: 1380 });
  assert.deepEqual(defaultEventStart({ now: parisAt("09:00"), tz: PARIS, clicked: null }), {
    startDate: "2026-10-14",
    startMinute: 600,
  });
  assert.deepEqual(defaultEventStart({ now: parisAt("00:05"), tz: PARIS }), { startDate: "2026-10-14", startMinute: 60 });
});

test("no full hour left today: tomorrow 09:00", () => {
  assert.deepEqual(defaultEventStart({ now: parisAt("23:10"), tz: PARIS }), { startDate: "2026-10-15", startMinute: 540 });
  assert.deepEqual(defaultEventStart({ now: parisAt("23:00"), tz: PARIS }), { startDate: "2026-10-15", startMinute: 540 });
});

test("the pro's zone decides, not the host's: a Los Angeles pro at Paris midnight", () => {
  // 2026-10-14 22:00Z = 2026-10-15 00:00 in Paris and 2026-10-14 15:00 in Los Angeles
  const now = new Date("2026-10-14T22:00:00.000Z");
  assert.deepEqual(defaultEventStart({ now, tz: LA }), { startDate: "2026-10-14", startMinute: 960 });
  assert.deepEqual(defaultEventStart({ now, tz: PARIS }), { startDate: "2026-10-15", startMinute: 60 });
  // the click on 14 October is today for the Los Angeles pro, but already past for the Paris one
  const clicked = { date: "2026-10-14", minute: 600 };
  assert.deepEqual(defaultEventStart({ now, tz: LA, clicked }), { startDate: "2026-10-14", startMinute: 600 });
  assert.deepEqual(defaultEventStart({ now, tz: PARIS, clicked }), { startDate: "2026-10-15", startMinute: 60 });
});

test("the proposed start follows the wall clock across the autumn change in Paris", () => {
  // Sunday 25 October 2026: 03:00 summer time becomes 02:00 winter time at 01:00Z.
  assert.deepEqual(defaultEventStart({ now: new Date("2026-10-25T00:30:00.000Z"), tz: PARIS }), {
    startDate: "2026-10-25",
    startMinute: 180,
  });
  assert.deepEqual(defaultEventStart({ now: new Date("2026-10-25T22:30:00.000Z"), tz: PARIS }), {
    startDate: "2026-10-26",
    startMinute: 540,
  });
});

test("parseClickedCell accepts a date and a minute", () => {
  assert.deepEqual(parseClickedCell({ date: "2026-10-20", minute: "615" }), { date: "2026-10-20", minute: 615 });
  assert.deepEqual(parseClickedCell({ date: "2026-10-20", minute: "0" }), { date: "2026-10-20", minute: 0 });
  assert.deepEqual(parseClickedCell({ date: "2026-10-20", minute: "1439" }), { date: "2026-10-20", minute: 1439 });
});

test("parseClickedCell rejects bad values", () => {
  const bad: { date?: string | string[]; minute?: string | string[] }[] = [
    {},
    { date: "2026-10-20" },
    { minute: "600" },
    { date: "2026-13-01", minute: "600" },
    { date: "2026-02-30", minute: "600" },
    { date: "20-10-2026", minute: "600" },
    { date: "", minute: "600" },
    { date: ["2026-10-20", "2026-10-21"], minute: "600" },
    { date: "2026-10-20", minute: ["600"] },
    { date: "2026-10-20", minute: "1440" },
    { date: "2026-10-20", minute: "-1" },
    { date: "2026-10-20", minute: "12.5" },
    { date: "2026-10-20", minute: "abc" },
    { date: "2026-10-20", minute: "" },
    { date: "2026-10-20", minute: "00600" },
  ];
  for (const params of bad) assert.equal(parseClickedCell(params), null, JSON.stringify(params));
});
