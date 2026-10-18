import assert from "node:assert/strict";
import test from "node:test";

import { BOUNDS } from "../tickets-vocab";
import { EMAIL_REQUIRED, NAME_REQUIRED, newClientProblems, type NewClientValue } from "./register-form";

const client = (over: Partial<NewClientValue> = {}): NewClientValue => ({
  name: "Test P3",
  email: "test-p3@skedul.test",
  phone: "",
  ...over,
});

test("newClientProblems: a valid client has no problem, with or without a phone", () => {
  assert.equal(newClientProblems(client()), null);
  assert.equal(newClientProblems(client({ phone: "06 12 34 56 78" })), null);
  assert.equal(newClientProblems(client({ name: "  Léa Martin  ", email: "  lea@example.com  " })), null);
});

test("newClientProblems: an empty name and an empty e-mail read as missing fields", () => {
  assert.deepEqual(newClientProblems(client({ name: "", email: "" })), { name: NAME_REQUIRED, email: EMAIL_REQUIRED });
  assert.deepEqual(newClientProblems(client({ name: "" })), { name: NAME_REQUIRED });
  assert.deepEqual(newClientProblems(client({ email: "" })), { email: EMAIL_REQUIRED });
});

test("newClientProblems: blanks count as empty", () => {
  assert.deepEqual(newClientProblems(client({ name: "   ", email: "   " })), { name: NAME_REQUIRED, email: EMAIL_REQUIRED });
});

test("newClientProblems: the messages of the missing fields are French sentences without a dash", () => {
  assert.equal(NAME_REQUIRED, "Indiquez le nom du client.");
  assert.equal(EMAIL_REQUIRED, "Indiquez l'adresse email du client.");
  assert.doesNotMatch(`${NAME_REQUIRED}${EMAIL_REQUIRED}`, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
});

test("newClientProblems: an invalid e-mail is named on the e-mail field only", () => {
  assert.deepEqual(newClientProblems(client({ email: "abc" })), { email: "Adresse email invalide." });
  assert.deepEqual(newClientProblems(client({ email: "a@b" })), { email: "Adresse email invalide." });
});

test("newClientProblems: a name or a phone over its bound is named on its own field", () => {
  assert.deepEqual(newClientProblems(client({ name: "x".repeat(BOUNDS.name + 1) })), {
    name: `${BOUNDS.name} caractères au maximum.`,
  });
  assert.deepEqual(newClientProblems(client({ phone: "1".repeat(BOUNDS.phone + 1) })), {
    phone: `${BOUNDS.phone} caractères au maximum.`,
  });
  assert.equal(newClientProblems(client({ name: "x".repeat(BOUNDS.name) })), null);
});

test("newClientProblems: several wrong fields are all reported", () => {
  assert.deepEqual(newClientProblems(client({ name: "", email: "abc", phone: "1".repeat(BOUNDS.phone + 1) })), {
    name: NAME_REQUIRED,
    email: "Adresse email invalide.",
    phone: `${BOUNDS.phone} caractères au maximum.`,
  });
});
