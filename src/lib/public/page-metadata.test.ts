import assert from "node:assert/strict";
import test from "node:test";

import type { PublicOfferDetail } from "./offer-reads";
import { notFoundMetadata, offerMetadata } from "./page-metadata";

const pro = { businessName: "Altinha Paris" };
const onSale = { kind: "on_sale", label: "Carnet de 4" } as PublicOfferDetail;
const unavailable: PublicOfferDetail = { kind: "unavailable" };
const NOT_FOUND = { title: "Page introuvable", referrer: "no-referrer", robots: { index: false } };

test("notFoundMetadata: the 404's own title, not indexed, no referrer, a fresh object each time (G4b)", () => {
  assert.deepEqual(notFoundMetadata(), NOT_FOUND);
  assert.notEqual(notFoundMetadata(), notFoundMetadata(), "never one shared object Next could change");
});

test("offerMetadata: no page (an unknown slug, an unknown offer, another pro's offer) is titled as the 404, never with the business name (G4b)", () => {
  assert.deepEqual(offerMetadata(null), NOT_FOUND, "unknown slug");
  assert.deepEqual(offerMetadata({ pro, offer: null }), NOT_FOUND, "unknown or foreign offer: getOfferPage is null, the page answers notFound()");
});

test("offerMetadata: an offer on sale is « label · business », indexable, without referrer (the URL may carry p)", () => {
  assert.deepEqual(offerMetadata({ pro, offer: onSale }), { title: "Carnet de 4 · Altinha Paris", referrer: "no-referrer" });
});

test("offerMetadata: an offer no longer sold (archived, paused, its type archived) gets the unknown-slug metadata, never the business name (G4b brief, Item 6)", () => {
  // The page body says « Cette offre n'est plus proposée » and leads back to the Boutique; its metadata is the 404's, so
  // an archived offer id and an unknown one carry the same title.
  assert.deepEqual(offerMetadata({ pro, offer: unavailable }), NOT_FOUND);
  assert.doesNotMatch(String(offerMetadata({ pro, offer: unavailable }).title), /Altinha Paris/, "no business name");
});
