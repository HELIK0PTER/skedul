import assert from "node:assert/strict";
import test from "node:test";

import type { ByDay } from "../../components/dashboard/weekly-hours-editor";
import { DAY_LABELS, DAY_ORDER, firstRangeProblem } from "./week-hours";

const DASH = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);

function week(over: Partial<ByDay> = {}): ByDay {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], ...over };
}

test("DAY_ORDER starts on Monday and DAY_LABELS names every day", () => {
  assert.deepEqual(DAY_ORDER, [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(
    DAY_ORDER.map((d) => DAY_LABELS[d]),
    ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
  );
});

test("firstRangeProblem: complete ranges, closed days and an empty week are fine", () => {
  assert.equal(firstRangeProblem(week()), null);
  assert.equal(
    firstRangeProblem(
      week({
        1: [
          { start: "10:00", end: "13:00" },
          { start: "17:30", end: "20:30" },
        ],
        6: [{ start: "00:00", end: "23:59" }],
      }),
    ),
    null,
  );
});

test("firstRangeProblem: an empty start time names the day and the range", () => {
  assert.deepEqual(firstRangeProblem(week({ 3: [{ start: "", end: "12:00" }] })), {
    day: 3,
    index: 0,
    field: "start",
    message: "Mercredi, plage 1 : indiquez l'heure de début.",
  });
});

test("firstRangeProblem: an empty end time names the day and the second range", () => {
  assert.deepEqual(
    firstRangeProblem(
      week({
        2: [
          { start: "09:00", end: "12:00" },
          { start: "14:00", end: "" },
        ],
      }),
    ),
    { day: 2, index: 1, field: "end", message: "Mardi, plage 2 : indiquez l'heure de fin." },
  );
});

test("firstRangeProblem: an end that is not after the start is refused on the end field", () => {
  const message = "Lundi, plage 1 : l'heure de fin doit être après l'heure de début.";
  assert.deepEqual(firstRangeProblem(week({ 1: [{ start: "18:00", end: "09:00" }] })), {
    day: 1,
    index: 0,
    field: "end",
    message,
  });
  // the same time twice is an empty range
  assert.deepEqual(firstRangeProblem(week({ 1: [{ start: "09:00", end: "09:00" }] })), {
    day: 1,
    index: 0,
    field: "end",
    message,
  });
  // an end read as midnight (00:00) is not after any start
  assert.equal(firstRangeProblem(week({ 1: [{ start: "09:00", end: "00:00" }] }))?.field, "end");
});

test("firstRangeProblem: the first problem wins, days in Monday-first order, start before end", () => {
  const found = firstRangeProblem(
    week({
      0: [{ start: "", end: "" }],
      4: [{ start: "09:00", end: "08:00" }],
      2: [{ start: "", end: "" }],
    }),
  );
  assert.equal(found?.day, 2, "Tuesday comes before Thursday and Sunday");
  assert.equal(found?.field, "start", "within a range the start is checked first");
  // Sunday is last in the Monday-first order
  assert.equal(firstRangeProblem(week({ 0: [{ start: "", end: "10:00" }] }))?.message, "Dimanche, plage 1 : indiquez l'heure de début.");
});

test("firstRangeProblem: a malformed time reads as missing", () => {
  assert.equal(firstRangeProblem(week({ 5: [{ start: "9h", end: "17:00" }] }))?.message, "Vendredi, plage 1 : indiquez l'heure de début.");
  assert.equal(firstRangeProblem(week({ 5: [{ start: "09:00", end: "25:61" }] }))?.field, "end");
});

test("firstRangeProblem messages end with a period and hold no dash", () => {
  const found = [
    firstRangeProblem(week({ 1: [{ start: "", end: "10:00" }] })),
    firstRangeProblem(week({ 1: [{ start: "10:00", end: "" }] })),
    firstRangeProblem(week({ 1: [{ start: "11:00", end: "10:00" }] })),
  ];
  for (const problem of found) {
    assert.ok(problem);
    assert.ok(problem.message.endsWith("."), problem.message);
    assert.ok(!DASH.test(problem.message), problem.message);
  }
});
