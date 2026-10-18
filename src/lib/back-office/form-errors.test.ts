import assert from "node:assert/strict";
import test from "node:test";

import { changedKeys, RECURRENCE_ERROR_KEYS, withoutErrorsUnder } from "./form-errors";
import { defaultRecurrenceForm } from "./recurrence-form";

test("withoutErrorsUnder removes the key and its dotted children, and keeps the unrelated keys", () => {
  const errors = {
    title: "Titre",
    "questions.0.label": "Libellé",
    "questions.1.options": "Options",
    questions: "Questions",
    questionsExtra: "Not a child of questions",
    "rule.startDate": "Date",
  };
  assert.deepEqual(withoutErrorsUnder(errors, ["questions"]), {
    title: "Titre",
    questionsExtra: "Not a child of questions",
    "rule.startDate": "Date",
  });
  assert.deepEqual(withoutErrorsUnder(errors, ["title", "rule.startDate"]), {
    "questions.0.label": "Libellé",
    "questions.1.options": "Options",
    questions: "Questions",
    questionsExtra: "Not a child of questions",
  });
  assert.deepEqual(withoutErrorsUnder({ "rule.startDate": "Date" }, ["rule"]), {}, "a parent prefix removes its children");
  assert.deepEqual(withoutErrorsUnder({ "rule.startDate": "Date" }, ["rule.start"]), { "rule.startDate": "Date" }, "a prefix is a whole key segment");
});

test("withoutErrorsUnder returns the same object when nothing goes", () => {
  const errors = { title: "Titre", "rule.freq": "Fréquence" };
  assert.equal(withoutErrorsUnder(errors, ["capacity"]), errors);
  assert.equal(withoutErrorsUnder(errors, []), errors);
  const empty = {};
  assert.equal(withoutErrorsUnder(empty, ["title"]), empty);
  assert.notEqual(withoutErrorsUnder(errors, ["title"]), errors);
});

test("changedKeys lists the keys whose value differs, comparing arrays element by element", () => {
  const prev = { title: "A", weekdays: [1, 3], overrides: { days: 1 }, on: true };
  assert.deepEqual(changedKeys(prev, { ...prev }), []);
  assert.deepEqual(changedKeys(prev, { ...prev, weekdays: [1, 3] }), [], "a new array with the same items is not a change");
  assert.deepEqual(changedKeys(prev, { ...prev, weekdays: [1, 3, 5] }), ["weekdays"]);
  assert.deepEqual(changedKeys(prev, { ...prev, weekdays: [3, 1] }), ["weekdays"], "order counts");
  assert.deepEqual(changedKeys(prev, { ...prev, title: "B", on: false }), ["title", "on"]);
  assert.deepEqual(changedKeys(prev, { ...prev, overrides: { days: 1 } }), ["overrides"], "an object is compared by identity");
});

test("RECURRENCE_ERROR_KEYS has an entry for every key of a recurrence form value", () => {
  const value = defaultRecurrenceForm({ startDate: "2026-10-19", startMinute: 600 }, 60);
  for (const key of Object.keys(value)) {
    const entry = (RECURRENCE_ERROR_KEYS as Record<string, readonly string[] | undefined>)[key];
    assert.ok(entry !== undefined && entry.length > 0, `${key} lists the error keys that editing it resolves`);
  }
  assert.deepEqual(Object.keys(RECURRENCE_ERROR_KEYS).sort(), Object.keys(value).sort(), "no entry for a field the form no longer has");
});
