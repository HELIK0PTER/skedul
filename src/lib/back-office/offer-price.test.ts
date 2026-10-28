import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatMoney } from "@/lib/utils";

import { STRIPE_MINIMUM_CENTS, offerPriceMinimumError, offerPriceRefusal, stripeMinimumCents } from "./offer-price";

const plain = (text: string): string => text.replace(/[  ]/g, " ");

test("stripeMinimumCents: 50 cents for the euro, the documented Stripe minimum (P4 final review PAY-3)", () => {
  assert.deepEqual(STRIPE_MINIMUM_CENTS, { eur: 50 });
  assert.equal(stripeMinimumCents("eur"), 50);
  assert.equal(stripeMinimumCents("EUR"), 50, "the code is read in any case");
  // A currency without an entry, an inherited key included, falls back to 50 minor units.
  for (const other of ["usd", "constructor", "toString", ""]) assert.equal(stripeMinimumCents(other), 50, other);
});

test("every currency the app can carry has its documented minimum: the professional's currency column defaults to eur", () => {
  const schema = readFileSync("src/lib/db/schema.ts", "utf8");
  assert.match(schema, /currency: text\("currency"\)\.default\("eur"\)\.notNull\(\),/);
  assert.ok(Object.prototype.hasOwnProperty.call(STRIPE_MINIMUM_CENTS, "eur"));
});

test("offerPriceMinimumError: « Prix : minimum 0,50 € », formatted by formatMoney in the pro's currency", () => {
  assert.equal(offerPriceMinimumError("eur"), `Prix : minimum ${formatMoney(50, "eur")}.`);
  assert.equal(plain(offerPriceMinimumError("eur")), "Prix : minimum 0,50 €.");
  assert.equal(/[\u2013\u2014]/.test(offerPriceMinimumError("eur")), false, "no dash");
});

test("offerPriceRefusal: a price under the minimum, 0 and negatives included, is refused; the minimum and more pass; a value that is not a number is the schema's", () => {
  const message = offerPriceMinimumError("eur");
  for (const cents of [49, 1, 0, -5, 49.5]) assert.equal(offerPriceRefusal(cents, "eur"), message, String(cents));
  for (const cents of [50, 51, 2500, 1_000_000]) assert.equal(offerPriceRefusal(cents, "eur"), null, String(cents));
  for (const value of [undefined, null, "10", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, {}]) {
    assert.equal(offerPriceRefusal(value, "eur"), null, String(value));
  }
});
