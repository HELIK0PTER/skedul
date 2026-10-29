import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { BOUNDS } from "../tickets-vocab";
import { parseFr } from "../zod-fr";
import { COPY } from "./messages";
import { isPlainName, plainNameSchema } from "./plain-name";

/** The full-width forms (U+FF10 to U+FF19 for the digits, U+FF20 for the at sign): what a visitor can type to dodge an ASCII-only check. */
const fullWidth = (text: string): string => text.replace(/[0-9@]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

/** Digits written as emoji keycaps: the digit, a variation selector (U+FE0F), the combining keycap (U+20E3). */
const keycap = (digits: string): string => Array.from(digits, (d) => d + String.fromCharCode(0xfe0f, 0x20e3)).join("");

test("isPlainName accepts real names", () => {
  for (const name of [
    "Beatriz Almeida",
    "Jean-Marie O'Neil",
    "Anne 2",
    "Anne 1234",
    "Anne 12 34",
    "Élodie Müller",
    "E\u0301lodie Mu\u0308ller", // decomposed accents
    "李小龍",
    "Marie  Curie",
    "Marie-Claire de La Tour d'Auvergne",
    "J. Dupont", // an initial: the dot is followed by a space
    "Jean P. Dupont",
    "Dr. Martin",
    "Ali\u200cakbar Rezaei", // a zero-width non-joiner is part of Persian names
    "\u0645\u0647\u0631\u200c\u0646\u0648\u0634", // the same joiner inside a name written in Persian script (Mehrnoush)
  ]) {
    assert.equal(isPlainName(name), true, name);
  }
});

test("isPlainName refuses links, domains, addresses and phone numbers however they are written (SEC-M9)", () => {
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
    // a phone number the way people write it
    "06 12 34 56 78",
    "Appelez le 06 12 34 56 78",
    "+33 6 12 34 56 78",
    "06.12.34.56.78",
    "06-12-34-56-78",
    "(06) 12 34 56 78",
    "06\u00a012\u00a034\u00a056\u00a078", // no-break spaces
    "Anne 1234 5678",
    "192.168.1.1",
    // a link without a scheme or a « www. »
    "bit.ly",
    "bit.ly/abc",
    "Payez sur bit.ly/x",
    "exemple.fr",
    "exemple.fr/promo",
    "café.fr",
    "a (at) b.fr",
    "Anne/Paul",
    // full-width digits, at sign, colon and slash fold into ASCII (NFKC)
    fullWidth("0612345678"),
    fullWidth("a@b.fr"),
    "https\uff1a\uff0f\uff0fx.fr",
    "exemple\uff0efr",
    "exemple\u3002fr", // ideographic full stop
    // digits of another script (Arabic-Indic)
    "\u0660\u0666\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668",
    // circled, superscript and keycap digits
    "①②③④⑤",
    "⁰⁶¹²³⁴⁵⁶",
    keycap("0612345678"),
    // invisible characters cutting the run or the domain
    "06\u200b12\u200b34\u200b56\u200b78",
    "bit\u200b.ly",
    // default-ignorable letters (not \p{C}): the Hangul fillers are blank to the eye and fold to U+1160
    "06\u316412\u316434\u316456\u316478", // hangul filler
    "06\uffa012\uffa034\uffa056\uffa078", // halfwidth hangul filler
    "06\u115f12\u115f34\u115f56\u115f78", // hangul choseong filler
    "06\u116012\u116034\u116056\u116078", // hangul jungseong filler
  ]) {
    assert.equal(isPlainName(name), false, name);
  }
});

test("plainNameSchema trims, refuses with COPY.PLAIN_NAME and keeps the parseFr wording for the rest", () => {
  assert.deepEqual(parseFr(plainNameSchema, "  Beatriz Almeida "), { ok: true, data: "Beatriz Almeida" });
  for (const refused of ["www.exemple.fr", "https://x.fr", "appelez a@b.fr", "0612345678", "Appelez le 06 12 34 56 78", "bit.ly/abc"]) {
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
