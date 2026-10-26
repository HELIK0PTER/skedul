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

test("offerMetadata: an offer no longer sold (archived, paused, its type archived) is the business name, not indexed (G4b)", () => {
  // The page answers it: « Cette offre n'est plus proposée » and a way back to the Boutique; nothing there to index.
  assert.deepEqual(offerMetadata({ pro, offer: unavailable }), { title: "Altinha Paris", referrer: "no-referrer", robots: { index: false } });
});
