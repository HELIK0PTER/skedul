import assert from "node:assert/strict";
import test from "node:test";

import type { QuestionRow } from "@/lib/booking/answers";

import { draftsFromRows, inputsFromDrafts, moveDraft, newQuestionDraft, withQuestionType, type QuestionDraft } from "./question-drafts";

const rows: QuestionRow[] = [
  { id: "q1", label: "Quel est votre objectif ?", type: "text", options: null, required: true, position: 0 },
  { id: "q2", label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false, position: 1 },
];

test("draftsFromRows: saved questions keep their id as key, options default to an empty list", () => {
  assert.deepEqual(draftsFromRows(rows), [
    { key: "q1", id: "q1", label: "Quel est votre objectif ?", type: "text", options: [], required: true },
    { key: "q2", id: "q2", label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false },
  ]);
});

test("inputsFromDrafts: trims, keeps options for a choice only, drops blank options, keeps ids of saved questions", () => {
  const drafts: QuestionDraft[] = [
    { key: "q1", id: "q1", label: "  Votre objectif ?  ", type: "text", options: ["reste d'un ancien choix"], required: true },
    { key: "new-1", label: "Niveau", type: "choice", options: [" Débutant ", "", "Confirmé", "   "], required: false },
  ];
  const inputs = inputsFromDrafts(drafts);
  assert.deepEqual(inputs, [
    { id: "q1", label: "Votre objectif ?", type: "text", options: [], required: true },
    { label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false },
  ]);
  assert.equal("id" in inputs[1], false, "a new question carries no id");
});

test("a round trip of saved rows changes nothing", () => {
  assert.deepEqual(
    inputsFromDrafts(draftsFromRows(rows)),
    rows.map((r) => ({ id: r.id, label: r.label, type: r.type, options: r.options ?? [], required: r.required })),
  );
});

test("newQuestionDraft: an empty optional text question", () => {
  assert.deepEqual(newQuestionDraft("new-a-1"), { key: "new-a-1", label: "", type: "text", options: [], required: false });
});

test("withQuestionType: a choice starts with two empty options, other types keep what was typed", () => {
  const base = newQuestionDraft("k");
  assert.deepEqual(withQuestionType(base, "choice").options, ["", ""]);
  assert.deepEqual(withQuestionType({ ...base, options: ["Oui"] }, "choice").options, ["Oui", ""]);
  assert.deepEqual(withQuestionType({ ...base, options: ["A", "B", "C"] }, "choice").options, ["A", "B", "C"]);
  const back = withQuestionType({ ...base, type: "choice", options: ["A", "B"] }, "boolean");
  assert.equal(back.type, "boolean");
  assert.deepEqual(back.options, ["A", "B"], "kept in the draft, dropped by inputsFromDrafts");
});

test("moveDraft: swaps with the neighbour, never mutates, ignores the ends", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveDraft(list, 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveDraft(list, 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveDraft(list, 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveDraft(list, 2, 1), ["a", "b", "c"]);
  assert.deepEqual(moveDraft(list, 5, 1), ["a", "b", "c"]);
  assert.deepEqual(list, ["a", "b", "c"]);
});
