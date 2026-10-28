import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EMPTY_OFFER_FORM, offerErrorField, offerFormFromView, offerInputFromForm, type OfferFormValues } from "./offer-form";
import { offerPriceMinimumError } from "./offer-price";

const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");
const form = (over: Partial<OfferFormValues> = {}): OfferFormValues => ({ ...EMPTY_OFFER_FORM, price: "40", ...over });
/** The dialog of a pro whose currency is the euro. */
const build = (f: OfferFormValues) => offerInputFromForm("t1", f, "eur");

test("offerInputFromForm: a unit offer without validity", () => {
  assert.deepEqual(build(form({ price: "25" })), {
    ok: true,
    input: { ticketTypeId: "t1", quantity: 1, priceCents: 2500, label: null, validityCount: null, validityUnit: null, isActive: true },
  });
});

test("offerInputFromForm: a book with a validity in months and a typed label", () => {
  assert.deepEqual(
    build(form({ quantity: "2", price: "40", label: "  Carnet été ", validity: "month", validityCount: "2", isActive: false })),
    {
      ok: true,
      input: { ticketTypeId: "t1", quantity: 2, priceCents: 4000, label: "Carnet été", validityCount: 2, validityUnit: "month", isActive: false },
    },
  );
  const days = build(form({ validity: "day", validityCount: "30" }));
  assert.ok(days.ok);
  assert.deepEqual([days.input.validityCount, days.input.validityUnit], [30, "day"]);
});

test("offerInputFromForm: the price accepts « 25,50 » and « 25.5 », refuses the rest with « Prix invalide. »", () => {
  const cents = (price: string) => {
    const res = build(form({ price }));
    return res.ok ? res.input.priceCents : res;
  };
  assert.equal(cents("25,50"), 2550);
  assert.equal(cents("25.5"), 2550);
  for (const bad of ["", "abc", "0", "-5", "1,234", "12 euros"]) {
    assert.deepEqual(cents(bad), { ok: false, field: "price", error: "Prix invalide." }, `price « ${bad} »`);
  }
});

test("offerInputFromForm: a price above the bound names the maximum", () => {
  assert.equal(build(form({ price: "10000" })).ok, true);
  const res = build(form({ price: "10001" }));
  assert.ok(!res.ok);
  assert.equal(res.field, "price");
  assert.equal(plain(res.error), "Prix invalide : 10 000 au maximum.");
});

test("offerInputFromForm: a price under the Stripe minimum of the pro's currency is refused under the price field with the server's own message (P4 final review PAY-3)", () => {
  for (const price of ["0,49", "0.3", "0,01"]) {
    assert.deepEqual(build(form({ price })), { ok: false, field: "price", error: offerPriceMinimumError("eur") }, `price « ${price} »`);
  }
  assert.equal(plain(offerPriceMinimumError("eur")), "Prix : minimum 0,50 €.");
  const least = build(form({ price: "0,50" }));
  assert.ok(least.ok);
  assert.equal(least.input.priceCents, 50);
  assert.equal(offerErrorField(offerPriceMinimumError("eur")), "price", "the server's refusal lands under the same field");
});

test("the offer dialog checks the price against its own currency and says the minimum in the price help (PAY-3)", () => {
  const dialog = readFileSync("src/components/dashboard/offer-list.tsx", "utf8");
  assert.match(dialog, /const built = offerInputFromForm\(ticketTypeId, values, currency\);/);
  assert.match(dialog, /help=\{priceHelp\(currency\)\}/, "the price field's help names the minimum");
  assert.match(dialog, /`Minimum \$\{formatMoney\(stripeMinimumCents\(currency\), currency\)\}\. /);
});

test("offerInputFromForm: quantity and validity count must be whole numbers", () => {
  for (const quantity of ["", "x", "1.5", "-1"]) {
    assert.deepEqual(build(form({ quantity })), {
      ok: false,
      field: "quantity",
      error: "Quantité : indiquez un nombre entier.",
    });
  }
  assert.deepEqual(build(form({ validity: "day", validityCount: "" })), {
    ok: false,
    field: "validity",
    error: "Validité : indiquez un nombre entier.",
  });
  // The bounds (1 to 100, 1 to 1000) are the server's: « 0 » goes through to its French message.
  assert.equal(build(form({ quantity: "0" })).ok, true);
  // Without a validity unit the count is ignored.
  const none = build(form({ validity: "none", validityCount: "abc" }));
  assert.ok(none.ok);
  assert.deepEqual([none.input.validityCount, none.input.validityUnit], [null, null]);
});

test("offerFormFromView: an offer back to form values", () => {
  assert.deepEqual(
    offerFormFromView({ quantity: 4, priceCents: 8550, customLabel: "Carnet été", validityCount: 3, validityUnit: "month", isActive: false }),
    { quantity: "4", price: "85,50", label: "Carnet été", validity: "month", validityCount: "3", isActive: false },
  );
  assert.deepEqual(
    offerFormFromView({ quantity: 1, priceCents: 2500, customLabel: null, validityCount: null, validityUnit: null, isActive: true }),
    { quantity: "1", price: "25", label: "", validity: "none", validityCount: "1", isActive: true },
  );
});

test("offerErrorField: the field a French message belongs to", () => {
  assert.equal(offerErrorField("Quantité : minimum 1."), "quantity");
  assert.equal(offerErrorField("Prix : minimum 1."), "price");
  assert.equal(offerErrorField("Libellé : 80 caractères au maximum."), "label");
  assert.equal(offerErrorField("Validité : maximum 1 000."), "validity");
  assert.equal(offerErrorField("Indiquez une durée et une unité de validité, ou aucune."), "validity");
  assert.equal(offerErrorField("Type ou offre introuvable."), null);
  assert.equal(offerErrorField("Un rendez-vous gratuit ne se vend pas : retirez l'option « Gratuit » pour créer une offre."), null);
});

test("offer form copy carries no em dash or en dash", () => {
  const results = [form({ price: "abc" }), form({ quantity: "x" }), form({ validity: "day", validityCount: "" }), form({ price: "10001" })].map(
    (f) => build(f),
  );
  const texts = results.map((r) => (r.ok ? "" : r.error));
  assert.equal(texts.filter((t) => t !== "").length, 4, "each invalid form gives a message");
  assert.equal(/[\u2013\u2014]/.test(texts.join(" ")), false);
});
