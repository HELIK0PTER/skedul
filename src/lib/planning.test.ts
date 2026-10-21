import { test } from "node:test";
import assert from "node:assert/strict";

import { BOUNDS } from "@/lib/tickets-vocab";

import {
  occurrenceStartWindow,
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

// R7: occurrence_pro_starts_idx is (professional_id, starts_at). With only `starts_at < end` the read walks the pro's
// whole history; the window gives it a lower bound too, while `ends_at > start` stays the exact overlap test.
test("occurrenceStartWindow: an occurrence overlapping the week starts less than the longest duration before it", () => {
  const ws = weekStartFromParam("2026-10-19", TZ, new Date());
  const range = weekBounds(ws, TZ);
  const { after, before } = occurrenceStartWindow(range);
  assert.equal(before.getTime(), range.end.getTime(), "an occurrence that starts at the end of the week does not overlap it");
  assert.equal(range.start.getTime() - after.getTime(), 720 * 60_000, "the longest séance (event_duration_chk) is 720 minutes");
  assert.equal(720, BOUNDS.eventDurationMin.max);
  assert.ok(BOUNDS.rdvDurationMin.max <= BOUNDS.eventDurationMin.max, "an RDV is never longer than a séance");
});

test("occurrenceStartWindow: the longest séance that overlaps the range by a minute is inside the window", () => {
  const range = { start: new Date("2026-10-18T22:00:00Z"), end: new Date("2026-10-25T23:00:00Z") };
  const { after } = occurrenceStartWindow(range);
  const startsAt = new Date(range.start.getTime() - 719 * 60_000); // 720 minutes long: ends one minute into the week
  assert.ok(startsAt.getTime() > after.getTime());
  const tooEarly = new Date(range.start.getTime() - 720 * 60_000); // ends exactly at the start: no overlap
  assert.ok(tooEarly.getTime() <= after.getTime());
});
