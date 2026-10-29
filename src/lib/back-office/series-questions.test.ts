import assert from "node:assert/strict";
import test from "node:test";

import type { QuestionRow } from "@/lib/booking/answers";

import { questionsForSegment } from "./series-questions";

const row = (id: string, label: string, position: number, over: Partial<QuestionRow> = {}): QuestionRow => ({
  id,
  label,
  type: "text",
  options: null,
  required: false,
  position,
  ...over,
});

const source = [row("a1", "Niveau", 0), row("a2", "Allergies", 1)];
const target = [row("b1", "Niveau", 0), row("b2", "Allergies", 1)];

test("questionsForSegment: a question the pro kept takes the id of the copy at the same place in the other segment", () => {
  const patch = [
    { id: "a1", label: "Niveau de pratique", type: "text" as const, required: true },
    { id: "a2", label: "Allergies", type: "text" as const, required: false },
  ];
  assert.deepEqual(questionsForSegment(patch, source, target), [
    { id: "b1", label: "Niveau de pratique", type: "text", required: true },
    { id: "b2", label: "Allergies", type: "text", required: false },
  ]);
});

test("questionsForSegment: a reordered list follows the questions, not the positions", () => {
  const patch = [
    { id: "a2", label: "Allergies", type: "text" as const, required: false },
    { id: "a1", label: "Niveau", type: "text" as const, required: false },
  ];
  assert.deepEqual(
    questionsForSegment(patch, source, target).map((q) => q.id),
    ["b2", "b1"],
  );
});

test("questionsForSegment: a new question has no id, and so has one with no copy to follow", () => {
  const patch = [
    { id: "a1", label: "Niveau", type: "text" as const, required: false },
    { label: "Objectif", type: "text" as const, required: false },
  ];
  assert.deepEqual(questionsForSegment(patch, source, []), [
    { label: "Niveau", type: "text", required: false },
    { label: "Objectif", type: "text", required: false },
  ]);
  // the other segment has fewer questions than the edited one
  assert.deepEqual(
    questionsForSegment([{ id: "a2", label: "Allergies", type: "text" as const, required: false }], source, [target[0]]).map((q) => q.id),
    [undefined],
  );
});

test("questionsForSegment: a copy that was edited on its own is not mistaken for the same question", () => {
  const edited = [row("b1", "Niveau (débutant ou confirmé)", 0), target[1]];
  const patch = [{ id: "a1", label: "Niveau", type: "text" as const, required: false }];
  assert.deepEqual(questionsForSegment(patch, source, edited).map((q) => q.id), [undefined], "different label");
  const retyped = [row("b1", "Niveau", 0, { type: "choice", options: ["A", "B"] }), target[1]];
  assert.deepEqual(questionsForSegment(patch, source, retyped).map((q) => q.id), [undefined], "different type");
});

test("questionsForSegment: an unknown id, a repeated id and an empty list", () => {
  assert.deepEqual(
    questionsForSegment([{ id: "ghost", label: "X", type: "text" as const, required: false }], source, target).map((q) => q.id),
    [undefined],
  );
  const twice = [
    { id: "a1", label: "Niveau", type: "text" as const, required: false },
    { id: "a1", label: "Niveau bis", type: "text" as const, required: false },
  ];
  assert.deepEqual(
    questionsForSegment(twice, source, target).map((q) => q.id),
    ["b1", undefined],
    "a copy is followed once",
  );
  assert.deepEqual(questionsForSegment([], source, target), []);
});
