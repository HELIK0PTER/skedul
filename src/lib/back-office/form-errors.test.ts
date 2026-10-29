import assert from "node:assert/strict";
import test from "node:test";

import { changedKeys, errorAfterEdit, OFFER_ERROR_FIELDS, RDV_ERROR_FIELDS, RECURRENCE_ERROR_KEYS, withoutErrorsUnder } from "./form-errors";
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

test("errorAfterEdit drops the message shown under the field that was edited, and only that one (final review UI-5)", () => {
  const under = { field: "price" as const, message: "Prix invalide." };
  assert.equal(errorAfterEdit(under, ["price"]), null, "the field was edited: its message goes");
  assert.equal(errorAfterEdit(under, ["quantity"]), under, "another field was edited: the message stays");
  assert.equal(errorAfterEdit(under, []), under, "an edit that resolves nothing keeps it");
  const general = { field: null, message: "La demande n'a pas abouti." };
  assert.equal(errorAfterEdit(general, ["price", "quantity"]), general, "a general message stays until the next submit");
  assert.equal(errorAfterEdit(null, ["price"]), null);
});

test("OFFER_ERROR_FIELDS: each offer form value resolves the message of its own field (final review UI-5)", () => {
  assert.deepEqual(OFFER_ERROR_FIELDS.quantity, ["quantity"]);
  assert.deepEqual(OFFER_ERROR_FIELDS.price, ["price"]);
  assert.deepEqual(OFFER_ERROR_FIELDS.label, ["label"]);
  assert.deepEqual(OFFER_ERROR_FIELDS.validity, ["validity"]);
  assert.deepEqual(OFFER_ERROR_FIELDS.validityCount, ["validity"], "the count and the unit share one message");
  assert.deepEqual(OFFER_ERROR_FIELDS.isActive, [], "the switch has no message of its own");
});

test("RDV_ERROR_FIELDS: the duration, the margins, and switching RDV off clear their own messages (final review UI-5)", () => {
  assert.deepEqual(RDV_ERROR_FIELDS.duration, ["duration"]);
  assert.deepEqual(RDV_ERROR_FIELDS.before, ["before"]);
  assert.deepEqual(RDV_ERROR_FIELDS.after, ["after"]);
  assert.deepEqual([...RDV_ERROR_FIELDS.enabled].sort(), ["after", "before", "duration"], "the fields are hidden when RDV is off");
  assert.deepEqual(RDV_ERROR_FIELDS.free, []);
  assert.deepEqual(RDV_ERROR_FIELDS.overrides, []);
});
