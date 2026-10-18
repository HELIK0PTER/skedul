import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAnswers, type QuestionRow } from "./answers";

const q = (over: Partial<QuestionRow> & Pick<QuestionRow, "id" | "label">): QuestionRow => ({
  type: "text",
  options: null,
  required: false,
  position: 0,
  ...over,
});

const level = q({ id: "q1", label: "Votre niveau ?", type: "choice", options: ["Débutant", "Confirmé"], required: true });
const ball = q({ id: "q2", label: "Avez-vous un ballon ?", type: "boolean", position: 1 });
const note = q({ id: "q3", label: "Une remarque ?", position: 2 });
const questions = [level, ball, note];

test("trims, keeps question order and snapshots the label", () => {
  const res = buildAnswers(
    questions,
    [
      { questionId: "q3", value: "  Genou fragile " },
      { questionId: "q1", value: "Débutant" },
      { questionId: "q2", value: "Oui" },
    ],
    { enforceRequired: true },
  );
  assert.deepEqual(res, {
    ok: true,
    rows: [
      { questionId: "q1", questionLabel: "Votre niveau ?", value: "Débutant" },
      { questionId: "q2", questionLabel: "Avez-vous un ballon ?", value: "Oui" },
      { questionId: "q3", questionLabel: "Une remarque ?", value: "Genou fragile" },
    ],
  });
});

test("empty answers are skipped; a missing required one fails only for clients", () => {
  const answers = [{ questionId: "q3", value: "   " }];
  assert.deepEqual(buildAnswers(questions, answers, { enforceRequired: true }), {
    ok: false,
    message: "Merci de répondre à : Votre niveau ?",
  });
  assert.deepEqual(buildAnswers(questions, answers, { enforceRequired: false }), { ok: true, rows: [] });
  assert.deepEqual(buildAnswers(questions, undefined, { enforceRequired: false }), { ok: true, rows: [] });
});

test("a choice must be one of the options and a boolean Oui or Non", () => {
  assert.deepEqual(buildAnswers(questions, [{ questionId: "q1", value: "Expert" }], { enforceRequired: false }), {
    ok: false,
    message: "Réponse invalide pour : Votre niveau ?",
  });
  assert.deepEqual(buildAnswers(questions, [{ questionId: "q2", value: "peut-être" }], { enforceRequired: false }), {
    ok: false,
    message: "Réponse invalide pour : Avez-vous un ballon ?",
  });
});

test("an unknown question, a duplicate answer or an over-long value is invalid", () => {
  const invalid = { ok: false, message: "Données invalides." };
  assert.deepEqual(buildAnswers(questions, [{ questionId: "nope", value: "x" }], { enforceRequired: false }), invalid);
  assert.deepEqual(
    buildAnswers(
      questions,
      [
        { questionId: "q3", value: "a" },
        { questionId: "q3", value: "b" },
      ],
      { enforceRequired: false },
    ),
    invalid,
  );
  assert.deepEqual(
    buildAnswers(questions, [{ questionId: "q3", value: "x".repeat(2001) }], { enforceRequired: false }),
    invalid,
  );
});

test("no question: any answer is invalid, none is fine", () => {
  assert.deepEqual(buildAnswers([], [], { enforceRequired: true }), { ok: true, rows: [] });
  assert.equal(buildAnswers([], [{ questionId: "q1", value: "x" }], { enforceRequired: true }).ok, false);
});
