import assert from "node:assert/strict";
import test from "node:test";

import {
  answerErrorsById,
  answersFromValues,
  identityErrors,
  identityToSend,
  requiredAnswerErrors,
  type QuestionFieldDef,
} from "./occurrence-form";

const QUESTIONS: QuestionFieldDef[] = [
  { id: "q1", label: "Niveau", type: "text", options: null, required: true },
  { id: "q2", label: "Pied fort", type: "choice", options: ["Droit", "Gauche"], required: false },
  { id: "q3", label: "Première fois", type: "boolean", options: null, required: true },
];

test("identityErrors: a valid identity, with or without a phone, has no error", () => {
  assert.deepEqual(identityErrors({ name: "Test P4", email: "test-p4@skedul.test", phone: "" }), {});
  assert.deepEqual(identityErrors({ name: "Test P4", email: " Test-P4@Skedul.test ", phone: "06 12 34 56 78" }), {});
  assert.deepEqual(identityErrors({ name: "Test P4", email: "test-p4@skedul.test" }), {});
});

test("identityErrors: an empty identity is refused field by field, under the keys of the whole-input parse", () => {
  assert.deepEqual(identityErrors({ name: "", email: "", phone: "" }), {
    "identity.name": "Ce champ est obligatoire.",
    "identity.email": "Adresse email invalide.",
  });
});

test("identityErrors: a name with a link, an address or a long digit run is not a plain name (SEC-M9)", () => {
  const plain = { "identity.name": "Prénom et nom : n'indiquez que votre nom." };
  assert.deepEqual(identityErrors({ name: "visitez http://x.co", email: "a@b.co" }), plain);
  assert.deepEqual(identityErrors({ name: "a@b.co", email: "a@b.co" }), plain);
  assert.deepEqual(identityErrors({ name: "Ana 0612345678", email: "a@b.co" }), plain);
  assert.deepEqual(identityErrors({ name: "Ana 06 12 34 56 78", email: "a@b.co" }), plain);
  assert.deepEqual(identityErrors({ name: "Ana bit.ly/x", email: "a@b.co" }), plain);
});

test("identityErrors: a bad e-mail, a name or a phone over its bound", () => {
  assert.deepEqual(identityErrors({ name: "Ana", email: "pas-un-email" }), { "identity.email": "Adresse email invalide." });
  assert.deepEqual(identityErrors({ name: "A".repeat(81), email: "a@b.co" }), { "identity.name": "80 caractères au maximum." });
  assert.deepEqual(identityErrors({ name: "Ana", email: "a@b.co", phone: "0".repeat(31) }), {
    "identity.phone": "30 caractères au maximum.",
  });
});

test("identityToSend trims and omits an empty phone", () => {
  assert.deepEqual(identityToSend({ name: " Ana Souza ", email: " ana@example.com ", phone: "  " }), {
    name: "Ana Souza",
    email: "ana@example.com",
  });
  assert.deepEqual(identityToSend({ name: "Ana", email: "ana@example.com", phone: " 0612345678 " }), {
    name: "Ana",
    email: "ana@example.com",
    phone: "0612345678",
  });
  assert.deepEqual(identityToSend({ name: "Ana", email: "ana@example.com" }), { name: "Ana", email: "ana@example.com" });
});

test("answersFromValues: question order, trimmed, blank skipped, an unknown key ignored", () => {
  assert.deepEqual(answersFromValues(QUESTIONS, { q3: "Oui", q1: "  Débutant  ", q2: "", ghost: "x" }), [
    { questionId: "q1", value: "Débutant" },
    { questionId: "q3", value: "Oui" },
  ]);
  assert.deepEqual(answersFromValues(QUESTIONS, {}), []);
  assert.deepEqual(answersFromValues([], { q1: "x" }), []);
});

test("requiredAnswerErrors: the engine's sentence for each required question left blank", () => {
  assert.deepEqual(requiredAnswerErrors(QUESTIONS, {}), {
    q1: "Merci de répondre à : Niveau",
    q3: "Merci de répondre à : Première fois",
  });
  assert.deepEqual(requiredAnswerErrors(QUESTIONS, { q1: "   ", q3: "Non" }), { q1: "Merci de répondre à : Niveau" });
  assert.deepEqual(requiredAnswerErrors(QUESTIONS, { q1: "Débutant", q3: "Oui" }), {});
  assert.deepEqual(requiredAnswerErrors([], {}), {});
});

test("answerErrorsById maps a server error on answer i back to its question, first message wins", () => {
  const answers = [
    { questionId: "q1", value: "x" },
    { questionId: "q3", value: "Oui" },
  ];
  assert.deepEqual(
    answerErrorsById(answers, {
      "answers.1.value": "Réponse : 2 000 caractères au maximum.",
      "answers.1.questionId": "Identifiant invalide.",
      "answers.7.value": "ignored: no such answer",
      "identity.name": "not an answer error",
    }),
    { q3: "Réponse : 2 000 caractères au maximum." },
  );
  assert.deepEqual(answerErrorsById(answers, {}), {});
});
