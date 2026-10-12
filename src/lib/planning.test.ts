import { test } from "node:test";
import assert from "node:assert/strict";

import {
  weekStartFromParam,
  weekBounds,
  weekDays,
  adjacentWeekParam,
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
  const { start, end } = weekBounds(ws, TZ);
  assert.equal((end.getTime() - start.getTime()) / 86_400_000, 7);
});

test("weekDays returns 7 days Monday→Sunday", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const days = weekDays(ws, TZ);
  assert.equal(days.length, 7);
  assert.equal(paramForWeek(days[0], TZ), "2026-06-22");
  assert.equal(paramForWeek(days[6], TZ), "2026-06-28");
});

test("gridRange: empty → default 8..21", () => {
  assert.deepEqual(gridRange([], TZ), { startHour: 8, endHour: 21 });
});

test("gridRange: widens to fit an early/late event", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const day = weekDays(ws, TZ)[0];
  const ev = {
    startAt: new Date(day.getTime() + 7 * 60 * 60_000), // 07:00
    endAt: new Date(day.getTime() + 22.5 * 60 * 60_000), // 22:30
  };
  assert.deepEqual(gridRange([ev], TZ), { startHour: 7, endHour: 23 });
});

test("adjacentWeekParam: next week across the fall-back change (25 Oct 2026)", () => {
  const ws = weekStartFromParam("2026-10-19", TZ, new Date());
  assert.equal(adjacentWeekParam(ws, TZ, 1), "2026-10-26");
  const next = weekStartFromParam(adjacentWeekParam(ws, TZ, 1), TZ, new Date());
  assert.equal(paramForWeek(next, TZ), "2026-10-26");
});

test("adjacentWeekParam: previous week across the spring-forward change (29 Mar 2026)", () => {
  const ws = weekStartFromParam("2026-03-30", TZ, new Date());
  assert.equal(adjacentWeekParam(ws, TZ, -1), "2026-03-23");
});

test("weekBounds: a fall-back week ends at the next local Monday midnight", () => {
  const ws = weekStartFromParam("2026-10-21", TZ, new Date());
  const { start, end } = weekBounds(ws, TZ);
  assert.equal(start.toISOString(), "2026-10-18T22:00:00.000Z"); // Mon 19 Oct 00:00 CEST
  assert.equal(end.toISOString(), "2026-10-25T23:00:00.000Z"); // Mon 26 Oct 00:00 CET
});

test("weekDays: a fall-back week lists Monday 19 to Sunday 25 October", () => {
  const ws = weekStartFromParam("2026-10-25", TZ, new Date());
  const keys = weekDays(ws, TZ).map((d) => paramForWeek(d, TZ));
  assert.deepEqual(keys, [
    "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
    "2026-10-23", "2026-10-24", "2026-10-25",
  ]);
});
