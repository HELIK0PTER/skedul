import assert from "node:assert/strict";
import test from "node:test";

import type { PublicOfferDetail } from "./offer-reads";
import { isPaymentReturn, notFoundMetadata, offerMetadata, seanceMetadata } from "./page-metadata";

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

const seance = { kind: "seance", title: "Altinha débutants", isPrivate: false, archived: false } as const;
const NOT_FOLLOWED = { index: false, follow: false };

test("seanceMetadata: a public séance is « title · business », indexable; every other case carries the business name only, not indexed (SEC-M10)", () => {
  assert.deepEqual(seanceMetadata({ pro, detail: seance }, {}), { title: "Altinha débutants · Altinha Paris", referrer: "no-referrer" });
  const hidden = { title: "Altinha Paris", referrer: "no-referrer", robots: { index: false } };
  assert.deepEqual(seanceMetadata({ pro, detail: { ...seance, isPrivate: true } }, {}), hidden, "private");
  assert.deepEqual(seanceMetadata({ pro, detail: { ...seance, archived: true } }, {}), hidden, "archived");
  assert.deepEqual(seanceMetadata({ pro, detail: { kind: "rdv" } }, {}), hidden, "a rendez-vous");
  assert.deepEqual(seanceMetadata({ pro, detail: null }, {}), hidden, "unknown or another pro's séance");
  assert.deepEqual(seanceMetadata(null, {}), NOT_FOUND, "unknown slug: the 404's metadata");
});

test("seanceMetadata: a payment-return URL (it carries p or paiement, whatever the value) is neither indexed nor followed, every other field kept (SEC-6)", () => {
  const returns = [{ p: "pur_1" }, { paiement: "annule" }, { paiement: "ok", p: "pur_1" }, { p: "" }, { p: ["a", "b"] }, { paiement: [] }];
  for (const query of returns) {
    const label = JSON.stringify(query);
    assert.deepEqual(
      seanceMetadata({ pro, detail: seance }, query),
      { title: "Altinha débutants · Altinha Paris", referrer: "no-referrer", robots: NOT_FOLLOWED },
      label,
    );
    assert.deepEqual(
      seanceMetadata({ pro, detail: { ...seance, isPrivate: true } }, query),
      { title: "Altinha Paris", referrer: "no-referrer", robots: NOT_FOLLOWED },
      label,
    );
    assert.deepEqual(seanceMetadata(null, query), { ...NOT_FOUND, robots: NOT_FOLLOWED }, label);
  }
  // Another query key is not a payment return; nor is a key that only contains the letter.
  assert.deepEqual(seanceMetadata({ pro, detail: seance }, { semaine: "2030-01-07" } as never), {
    title: "Altinha débutants · Altinha Paris",
    referrer: "no-referrer",
  });
  assert.equal(isPaymentReturn({}), false);
  assert.equal(isPaymentReturn({ p: undefined, paiement: undefined }), false);
  assert.equal(isPaymentReturn({ p: "x" }), true);
  assert.equal(isPaymentReturn({ paiement: "annule" }), true);
});

test("seanceMetadata: a fresh object each time, so Next can never change a shared one", () => {
  assert.notEqual(seanceMetadata(null, { p: "x" }), seanceMetadata(null, { p: "x" }));
  const first = seanceMetadata({ pro, detail: seance }, { p: "x" });
  const second = seanceMetadata({ pro, detail: seance }, { p: "x" });
  assert.notEqual(first.robots, second.robots);
});
