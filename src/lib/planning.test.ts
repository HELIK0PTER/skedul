import { test } from "node:test";
import assert from "node:assert/strict";

import {
  weekStartFromParam,
  weekBounds,
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

test("weekBounds: a fall-back week ends at the next local Monday midnight", () => {
  const ws = weekStartFromParam("2026-10-21", TZ, new Date());
  const { start, end } = weekBounds(ws, TZ);
  assert.equal(start.toISOString(), "2026-10-18T22:00:00.000Z"); // Mon 19 Oct 00:00 CEST
  assert.equal(end.toISOString(), "2026-10-25T23:00:00.000Z"); // Mon 26 Oct 00:00 CET
});
