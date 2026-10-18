import test from "node:test";
import assert from "node:assert/strict";

import { addDays, instantAt } from "./civil-date";
import type { RecurrenceRule } from "./recurrence";
import { describeSeriesEdit, planSeriesEdit, type SeriesEditInput, type SeriesRow } from "./series-plan";
import { MATERIALIZE_MAX_ROWS } from "./tickets";

const TZ = "Europe/Paris";

/** Old segment: Mon + Wed 19:00, 60 min, since 2026-09-07. */
const OLD: RecurrenceRule = {
  startDate: "2026-09-07",
  startMinute: 1140,
  durationMin: 60,
  freq: "weekly",
  interval: 1,
  weekdays: [1, 3],
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
};

/** New segment from d = 2026-10-19: Mon + Thu 19:30. */
const NEW: RecurrenceRule = { ...OLD, startDate: "2026-10-19", startMinute: 1170, weekdays: [1, 4] };

function row(id: string, seriesDate: string, over: Partial<SeriesRow> = {}): SeriesRow {
  const startsAt = instantAt(seriesDate, OLD.startMinute, TZ);
  return {
    id,
    seriesDate,
    startsAt,
    endsAt: new Date(startsAt.getTime() + OLD.durationMin * 60_000),
    status: "scheduled",
    timeDetached: false,
    activeBookings: 0,
    ticketBookings: 0,
    hasHistory: false,
    ...over,
  };
}

const ROWS: SeriesRow[] = [
  row("r1", "2026-10-19", { activeBookings: 2, ticketBookings: 1, hasHistory: true }),
  row("r2", "2026-10-21", { activeBookings: 1, ticketBookings: 1, hasHistory: true }),
  row("r3", "2026-10-26", { status: "cancelled", hasHistory: true }),
  row("r4", "2026-10-28", { hasHistory: true }),
  row("r6", "2026-11-02", { timeDetached: true, activeBookings: 3, ticketBookings: 3, hasHistory: true }),
  row("r7", "2026-11-04"),
];

const INPUT: SeriesEditInput = {
  tz: TZ,
  fromDate: "2026-10-19",
  horizonEnd: "2026-11-04",
  oldRule: OLD,
  newRule: NEW,
  rows: ROWS,
};

test("planSeriesEdit puts every row in exactly one bucket", () => {
  const plan = planSeriesEdit(INPUT);
  const placed = [
    ...plan.retime.map((r) => r.id),
    ...plan.reparentOnly,
    ...plan.delete,
    ...plan.cancelEmpty,
    ...plan.orphanBooked,
  ].sort();
  assert.deepEqual(placed, ROWS.map((r) => r.id).sort());
});

test("planSeriesEdit buckets: retime, reparentOnly, delete, cancelEmpty, orphanBooked", () => {
  const plan = planSeriesEdit(INPUT);
  assert.deepEqual(plan.retime.map((r) => r.id), ["r1", "r3"]);
  assert.deepEqual(plan.reparentOnly, ["r6"]);
  assert.deepEqual(plan.delete, ["r7"]);
  assert.deepEqual(plan.cancelEmpty, ["r4"]);
  assert.deepEqual(plan.orphanBooked, ["r2"]);
});

test("retime takes the new wall-clock time on each local date (both sides of DST)", () => {
  const plan = planSeriesEdit(INPUT);
  const [r1, r3] = plan.retime;
  // 19:30 Paris: summer time on 19 Oct, winter time on 26 Oct.
  assert.equal(r1.startsAt.toISOString(), "2026-10-19T17:30:00.000Z");
  assert.equal(r1.endsAt.toISOString(), "2026-10-19T18:30:00.000Z");
  assert.equal(r1.timeChanged, true);
  assert.equal(r3.startsAt.toISOString(), "2026-10-26T18:30:00.000Z");
  assert.equal(r3.timeChanged, true);
});

test("insert lists the new dates with no row, whatever the row's status", () => {
  const plan = planSeriesEdit(INPUT);
  assert.deepEqual(
    plan.insert.map((i) => [i.seriesDate, i.startsAt.toISOString(), i.endsAt.toISOString()]),
    [
      ["2026-10-22", "2026-10-22T17:30:00.000Z", "2026-10-22T18:30:00.000Z"],
      ["2026-10-29", "2026-10-29T18:30:00.000Z", "2026-10-29T19:30:00.000Z"],
    ],
  );
  assert.equal(plan.generatedUntil, "2026-11-04");
});

test("summary counts only scheduled rows whose time changes, and their active bookings", () => {
  const plan = planSeriesEdit(INPUT);
  assert.deepEqual(plan.summary, {
    modified: 1,
    notified: 2,
    orphans: 1,
    orphanTickets: 1,
    deleted: 1,
    cancelledEmpty: 1,
    inserted: 2,
  });
});

test("an unchanged time is not a modification; a duration change is", () => {
  const same = planSeriesEdit({ ...INPUT, newRule: { ...OLD, startDate: "2026-10-19" } });
  assert.equal(same.retime.every((r) => !r.timeChanged), true);
  assert.equal(same.summary.modified, 0);
  assert.equal(same.summary.notified, 0);
  const longer = planSeriesEdit({ ...INPUT, newRule: { ...OLD, startDate: "2026-10-19", durationMin: 90 } });
  // Same days, 90 min: r1, r2, r4, r7 are scheduled and retimed (r3 is cancelled, r6 detached).
  assert.deepEqual(longer.retime.map((r) => r.id), ["r1", "r2", "r3", "r4", "r7"]);
  assert.equal(longer.retime.every((r) => r.timeChanged), true);
  assert.equal(longer.summary.modified, 4);
  assert.equal(longer.summary.notified, 3);
});

test("a cancelled date that disappears without history is cancelEmpty, never delete", () => {
  const plan = planSeriesEdit({
    ...INPUT,
    rows: [row("c1", "2026-10-21", { status: "cancelled" })],
  });
  assert.deepEqual(plan.cancelEmpty, ["c1"]);
  assert.deepEqual(plan.delete, []);
  // Already cancelled: the edit changes nothing for it, so the preview does not count it.
  assert.equal(plan.summary.cancelledEmpty, 0);
  assert.doesNotMatch(describeSeriesEdit(plan.summary, "keep"), /vide/);
});

test("new dates start at max(d, newRule.startDate)", () => {
  const plan = planSeriesEdit({ ...INPUT, newRule: { ...NEW, startDate: "2026-10-26" } });
  assert.deepEqual(plan.retime.map((r) => r.id), ["r3"]);
  assert.deepEqual(plan.orphanBooked, ["r1", "r2"]);
  assert.deepEqual(plan.insert.map((i) => i.seriesDate), ["2026-10-29"]);
});

test("insert is capped at MATERIALIZE_MAX_ROWS and generatedUntil follows the cap", () => {
  const daily: RecurrenceRule = { ...OLD, startDate: "2026-10-12", freq: "daily", weekdays: null };
  const capped = planSeriesEdit({
    tz: TZ,
    fromDate: "2026-10-12",
    horizonEnd: addDays("2026-10-12", 499),
    oldRule: daily,
    newRule: daily,
    rows: [],
  });
  assert.equal(capped.insert.length, MATERIALIZE_MAX_ROWS);
  assert.equal(capped.generatedUntil, addDays("2026-10-12", MATERIALIZE_MAX_ROWS - 1));
  assert.equal(capped.summary.inserted, MATERIALIZE_MAX_ROWS);
  const uncapped = planSeriesEdit({
    tz: TZ,
    fromDate: "2026-10-12",
    horizonEnd: addDays("2026-10-12", 399),
    oldRule: daily,
    newRule: daily,
    rows: [],
  });
  assert.equal(uncapped.insert.length, 400);
  assert.equal(uncapped.generatedUntil, addDays("2026-10-12", 399));
});

test("remainingCount comes from the old rule in count mode", () => {
  // Mon + Wed from 2026-09-07: 12 dates before 2026-10-19.
  const counted = planSeriesEdit({ ...INPUT, oldRule: { ...OLD, endMode: "count", occurrenceCount: 20 } });
  assert.equal(counted.remainingCount, 8);
  assert.equal(planSeriesEdit(INPUT).remainingCount, null);
});

test("describeSeriesEdit", () => {
  assert.equal(
    describeSeriesEdit(
      { modified: 12, notified: 3, orphans: 1, orphanTickets: 2, deleted: 0, cancelledEmpty: 0, inserted: 0 },
      "cancel",
    ),
    "12 séances modifiées, 3 inscrits prévenus, 1 séance annulée (2 tickets rendus)",
  );
  const summary = planSeriesEdit(INPUT).summary;
  assert.equal(
    describeSeriesEdit(summary, "cancel"),
    "1 séance modifiée, 2 inscrits prévenus, 1 séance annulée (1 ticket rendu), 1 séance vide annulée, 1 séance supprimée, 2 séances ajoutées",
  );
  assert.equal(
    describeSeriesEdit(summary, "keep"),
    "1 séance modifiée, 2 inscrits prévenus, 1 séance gardée à part, 1 séance vide annulée, 1 séance supprimée, 2 séances ajoutées",
  );
  assert.equal(
    describeSeriesEdit({ modified: 0, notified: 0, orphans: 2, orphanTickets: 0, deleted: 0, cancelledEmpty: 0, inserted: 0 }, "cancel"),
    "2 séances annulées",
  );
  assert.equal(
    describeSeriesEdit({ modified: 0, notified: 0, orphans: 0, orphanTickets: 0, deleted: 0, cancelledEmpty: 0, inserted: 0 }, "keep"),
    "Aucun changement sur les séances",
  );
});
