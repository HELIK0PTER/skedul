import test from "node:test";
import assert from "node:assert/strict";

import { clientCanCancel, clientCancelDeadline } from "./cancellation";

const START = new Date("2026-10-20T17:00:00Z");
const hoursBefore = (h: number) => new Date(START.getTime() - h * 3_600_000);
const CREATED = new Date("2026-10-10T10:00:00Z");

const check = (over: Partial<Parameters<typeof clientCanCancel>[0]>) =>
  clientCanCancel({
    startsAt: START,
    now: hoursBefore(25),
    deadlineHours: 24,
    bookingCreatedAt: CREATED,
    occurrenceChangedAt: null,
    movedAt: null,
    ...over,
  });

test("clientCancelDeadline subtracts elapsed hours", () => {
  assert.equal(clientCancelDeadline(START, 24).toISOString(), "2026-10-19T17:00:00.000Z");
  assert.equal(clientCancelDeadline(START, 0).toISOString(), START.toISOString());
});

test("before the deadline the client cancels; after it, only the pro can", () => {
  assert.deepEqual(check({ now: hoursBefore(25) }), { allowed: true, reason: "before_deadline" });
  assert.deepEqual(check({ now: hoursBefore(23) }), { allowed: false, reason: "too_late" });
  // exactly at the deadline: startsAt − deadline > now is false
  assert.deepEqual(check({ now: hoursBefore(24) }), { allowed: false, reason: "too_late" });
});

test("a pro change after the booking re-opens cancellation until the start", () => {
  assert.deepEqual(check({ now: hoursBefore(23), occurrenceChangedAt: new Date("2026-10-15T09:00:00Z") }), {
    allowed: true,
    reason: "changed_by_pro",
  });
  // a change BEFORE the booking does not count
  assert.deepEqual(check({ now: hoursBefore(23), occurrenceChangedAt: new Date("2026-10-01T09:00:00Z") }), {
    allowed: false,
    reason: "too_late",
  });
  assert.deepEqual(check({ now: hoursBefore(1), movedAt: new Date("2026-10-15T09:00:00Z") }), {
    allowed: true,
    reason: "changed_by_pro",
  });
});

test("nobody cancels online once the occurrence has started", () => {
  assert.deepEqual(check({ now: START }), { allowed: false, reason: "started" });
  assert.deepEqual(check({ now: new Date(START.getTime() + 60_000), movedAt: CREATED }), {
    allowed: false,
    reason: "started",
  });
});

test("deadline 0: allowed until the start", () => {
  assert.deepEqual(check({ deadlineHours: 0, now: new Date(START.getTime() - 60_000) }), {
    allowed: true,
    reason: "before_deadline",
  });
});
