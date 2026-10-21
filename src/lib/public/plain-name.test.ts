import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { BOUNDS } from "../tickets-vocab";
import { parseFr } from "../zod-fr";
import { COPY } from "./messages";
import { isPlainName, plainNameSchema } from "./plain-name";

test("isPlainName accepts real names", () => {
  for (const name of ["Beatriz Almeida", "Jean-Marie O'Neil", "Anne 2", "Anne 1234", "Élodie Müller", "李小龍", "Marie  Curie"]) {
    assert.equal(isPlainName(name), true, name);
  }
});

test("isPlainName refuses links, addresses and long digit runs (SEC-M9)", () => {
  for (const name of [
    "www.exemple.fr",
    "WWW.exemple.fr",
    "https://x.fr",
    "HTTP://x.fr",
    "appelez a@b.fr",
    "@beatriz",
    "0612345678",
    "Anne 12345",
    "Anne 123456 Dupont",
  ]) {
    assert.equal(isPlainName(name), false, name);
  }
});

test("plainNameSchema trims, refuses with COPY.PLAIN_NAME and keeps the parseFr wording for the rest", () => {
  assert.deepEqual(parseFr(plainNameSchema, "  Beatriz Almeida "), { ok: true, data: "Beatriz Almeida" });
  for (const refused of ["www.exemple.fr", "https://x.fr", "appelez a@b.fr", "0612345678"]) {
    const res = parseFr(plainNameSchema, refused);
    assert.equal(res.ok, false, refused);
    assert.equal(!res.ok && res.error, COPY.PLAIN_NAME, refused);
  }
  for (const empty of ["", "   ", null, undefined, 12]) {
    const res = parseFr(plainNameSchema, empty);
    assert.equal(!res.ok && res.error, "Ce champ est obligatoire.", String(empty));
  }
  const tooLong = parseFr(plainNameSchema, "a".repeat(BOUNDS.name + 1));
  assert.equal(!tooLong.ok && tooLong.error, "80 caractères au maximum.");
  assert.deepEqual(parseFr(plainNameSchema, "a".repeat(BOUNDS.name)).ok, true);
});

test("plainNameSchema inside a strict object: the field label prefixes the generic text, never COPY.PLAIN_NAME", () => {
  const schema = z.object({ name: plainNameSchema }).strict();
  const empty = parseFr(schema, { name: "" });
  assert.equal(!empty.ok && empty.error, "Nom : ce champ est obligatoire.");
  const link = parseFr(schema, { name: "a@b.fr" });
  assert.equal(!link.ok && link.error, COPY.PLAIN_NAME);
  assert.equal(!link.ok && link.fieldErrors.name, COPY.PLAIN_NAME);
  const extra = parseFr(schema, { name: "Beatriz", website: "x" });
  assert.equal(!extra.ok && extra.error, "Champ inattendu.");
});
