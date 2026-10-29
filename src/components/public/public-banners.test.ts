import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnerPreviewBanner } from "./owner-preview-banner";
import { TestPaymentsBanner } from "./test-payments-banner";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

/** The visible text of a markup string: tags dropped, the entities of apostrophes and ampersands decoded. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

test("OwnerPreviewBanner is a note that says the owner's test bookings count in their figures", () => {
  const markup = renderToStaticMarkup(createElement(OwnerPreviewBanner));
  assert.match(markup, /<div[^>]*role="note"[^>]*>/);
  assert.equal(textOf(markup), "Vous êtes sur votre propre page : vos réservations de test comptent dans vos chiffres.");
  assert.doesNotMatch(markup, DASH);
});

test("TestPaymentsBanner in mock mode says the payment is simulated", () => {
  const markup = renderToStaticMarkup(createElement(TestPaymentsBanner, { mode: "mock" }));
  assert.match(markup, /<div[^>]*role="note"[^>]*>/);
  assert.equal(textOf(markup), "Paiements en mode test Aucun paiement réel : le paiement est simulé.");
  assert.doesNotMatch(markup, DASH);
});

test("TestPaymentsBanner with Stripe test keys says only the Stripe test cards work", () => {
  const markup = renderToStaticMarkup(createElement(TestPaymentsBanner, { mode: "test" }));
  assert.equal(
    textOf(markup),
    "Paiements en mode test Aucun paiement réel : seules les cartes de test Stripe fonctionnent.",
  );
  assert.doesNotMatch(markup, DASH);
});
