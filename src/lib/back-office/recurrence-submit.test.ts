import assert from "node:assert/strict";
import test from "node:test";

import { defaultRecurrenceForm, ruleFromForm, type RecurrenceFormValue } from "./recurrence-form";
import { startProblem, submittableRule } from "./recurrence-submit";

function form(over: Partial<RecurrenceFormValue>): RecurrenceFormValue {
  return { ...defaultRecurrenceForm({ startDate: "2026-10-14", startMinute: 1140 }, 60), ...over };
}

const weekly = form({ freq: "weekly", weekdays: [1, 3], endMode: "count", occurrenceCount: 4 });

test("submittableRule: a valid weekly form gives its rule and duration", () => {
  const built = submittableRule(weekly);
  assert.ok(built);
  assert.equal(built.durationMin, 60);
  assert.deepEqual(built.rule, {
    startDate: "2026-10-14",
    startMinute: 1140,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "count",
    untilDate: null,
    occurrenceCount: 4,
  });
});

test("submittableRule: a valid once form and the duration bounds 5 and 720", () => {
  assert.ok(submittableRule(form({})));
  assert.ok(submittableRule(form({ durationMin: 5 })));
  assert.ok(submittableRule(form({ durationMin: 720 })));
});

test("submittableRule: null when the rule is refused by the schema (weekly with no weekday, until before the start, no end date, interval too large)", () => {
  assert.equal(submittableRule(form({ freq: "weekly", weekdays: [] })), null);
  assert.equal(submittableRule(form({ freq: "daily", endMode: "until", untilDate: "2026-10-01" })), null);
  assert.equal(submittableRule(form({ freq: "daily", endMode: "until", untilDate: "" })), null);
  assert.equal(submittableRule(form({ freq: "daily", interval: 40 })), null);
});

test("submittableRule: null when the duration is 0, 7, 725, negative or not a whole number", () => {
  assert.equal(submittableRule(form({ durationMin: 0 })), null);
  assert.equal(submittableRule(form({ durationMin: 7 })), null);
  assert.equal(submittableRule(form({ durationMin: 725 })), null);
  assert.equal(submittableRule(form({ durationMin: -5 })), null);
  assert.equal(submittableRule(form({ durationMin: 12.5 })), null);
});

test("submittableRule: null for a cleared or malformed start time or date", () => {
  assert.equal(submittableRule(form({ startTime: "" })), null);
  assert.equal(submittableRule(form({ startTime: "25:00" })), null);
  assert.equal(submittableRule(form({ startDate: "" })), null);
  assert.equal(submittableRule(form({ startDate: "2026-02-30" })), null);
});

test("startProblem: names the date first, then the time, else null", () => {
  assert.equal(startProblem(form({ startDate: "" })), "date");
  assert.equal(startProblem(form({ startDate: "2026-02-30" })), "date");
  assert.equal(startProblem(form({ startTime: "" })), "time");
  assert.equal(startProblem(form({ startTime: "24:00" })), "time");
  assert.equal(startProblem(form({ startDate: "", startTime: "" })), "date");
  assert.equal(startProblem(weekly), null);
});

test("startProblem is null exactly when ruleFromForm builds a rule", () => {
  const values = [
    weekly,
    form({}),
    form({ freq: "weekly", weekdays: [] }),
    form({ startDate: "" }),
    form({ startTime: "" }),
    form({ startDate: "", startTime: "99:99" }),
  ];
  for (const v of values) {
    assert.equal(startProblem(v) === null, ruleFromForm(v) !== null, JSON.stringify(v));
  }
});
