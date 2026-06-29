import { test } from "node:test";
import assert from "node:assert/strict";

import {
  weekStartFromParam,
  weekBounds,
  weekDays,
  minutesIntoDay,
  gridRange,
  paramForWeek,
} from "./planning";

const TZ = "Europe/Paris";

test("weekStartFromParam: Monday of the week containing a Wednesday", () => {
  // 2026-06-24 is a Wednesday → Monday is 2026-06-22
  const ws = weekStartFromParam("2026-06-24", TZ, new Date("2026-01-01T00:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekStartFromParam: a Monday maps to itself", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date("2026-01-01T00:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekStartFromParam: a Sunday maps back to its Monday", () => {
  // 2026-06-28 is a Sunday → Monday is 2026-06-22
  const ws = weekStartFromParam("2026-06-28", TZ, new Date("2026-01-01T00:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekStartFromParam: undefined falls back to now's week", () => {
  const ws = weekStartFromParam(undefined, TZ, new Date("2026-06-24T10:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekBounds spans exactly 7 days", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const { start, end } = weekBounds(ws);
  assert.equal((end.getTime() - start.getTime()) / 86_400_000, 7);
});

test("weekDays returns 7 days Monday→Sunday", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const days = weekDays(ws);
  assert.equal(days.length, 7);
  assert.equal(paramForWeek(days[0], TZ), "2026-06-22");
  assert.equal(paramForWeek(days[6], TZ), "2026-06-28");
});

test("minutesIntoDay: 10:30 local is 630 minutes after local midnight", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const dayStart = weekDays(ws)[0]; // Mon 00:00 local
  const at = new Date(dayStart.getTime() + 630 * 60_000);
  assert.equal(minutesIntoDay(at, dayStart), 630);
});

test("gridRange: empty → default 8..21", () => {
  assert.deepEqual(gridRange([], TZ), { startHour: 8, endHour: 21 });
});

test("gridRange: widens to fit an early/late event", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const day = weekDays(ws)[0];
  const ev = {
    startAt: new Date(day.getTime() + 7 * 60 * 60_000), // 07:00
    endAt: new Date(day.getTime() + 22.5 * 60 * 60_000), // 22:30
  };
  assert.deepEqual(gridRange([ev], TZ), { startHour: 7, endHour: 23 });
});
