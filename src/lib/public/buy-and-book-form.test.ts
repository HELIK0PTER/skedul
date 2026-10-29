import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney } from "@/lib/utils";

import {
  BUY_TITLE,
  HOLD_ID_RE,
  HOLD_KEY_PREFIX,
  OFFERS_LEGEND,
  OFFER_TOO_SHORT,
  browserSessionStorage,
  firstCoveringOfferId,
  holdStorageKey,
  offerOptionLabel,
  payLabel,
  readHoldId,
  returnHref,
  safeCheckoutUrl,
  storeHoldId,
  type OfferChoice,
} from "./buy-and-book-form";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
/** Money is formatted with no-break spaces (U+00A0 and U+202F): compare on plain spaces. */
const plain = (text: string): string => text.replace(/[  ]/g, " ");

const SINGLE: OfferChoice = { offerId: "o1", label: "À l'unité", priceCents: 2500, validityText: null, covers: true };
const BOOK4: OfferChoice = { offerId: "o2", label: "Carnet de 4", priceCents: 8500, validityText: "3 mois", covers: true };
const SHORT: OfferChoice = { offerId: "o3", label: "Pass journée", priceCents: 1000, validityText: "1 jour", covers: false };

/** A Storage-shaped fake that keeps its entries in a map. */
function fakeStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => void map.set(key, value),
    map,
  };
}

test("offerOptionLabel: « {label} · {price} », then « · valable {validity} » when the offer has one", () => {
  assert.equal(plain(offerOptionLabel(SINGLE, "eur")), "À l'unité · 25 €");
  assert.equal(plain(offerOptionLabel(BOOK4, "eur")), "Carnet de 4 · 85 € · valable 3 mois");
  assert.equal(offerOptionLabel(SINGLE, "eur"), `À l'unité · ${formatMoney(2500, "eur")}`);
  assert.equal(plain(offerOptionLabel({ ...SINGLE, priceCents: 2550 }, "eur")), "À l'unité · 25,50 €");
});

test("firstCoveringOfferId: the first offer that covers the séance, null when none does", () => {
  assert.equal(firstCoveringOfferId([SHORT, BOOK4, SINGLE]), "o2");
  assert.equal(firstCoveringOfferId([SINGLE, BOOK4]), "o1");
  assert.equal(firstCoveringOfferId([SHORT]), null);
  assert.equal(firstCoveringOfferId([]), null);
});

test("payLabel: « Payer {price} » of the chosen offer", () => {
  assert.equal(plain(payLabel(SINGLE, "eur")), "Payer 25 €");
  assert.equal(plain(payLabel(BOOK4, "eur")), "Payer 85 €");
});

test("the fixed sentences of the block", () => {
  assert.equal(BUY_TITLE, "Acheter et réserver");
  assert.equal(OFFERS_LEGEND, "Choisissez une offre");
  assert.equal(OFFER_TOO_SHORT, "Validité trop courte pour cette séance");
  for (const text of [BUY_TITLE, OFFERS_LEGEND, OFFER_TOO_SHORT, offerOptionLabel(BOOK4, "eur"), payLabel(SINGLE, "eur")]) {
    assert.doesNotMatch(text, DASH, text);
  }
});

test("the held-seat id lives under skedul:hold:<occurrenceId> and round-trips through a storage", () => {
  assert.equal(HOLD_KEY_PREFIX, "skedul:hold:");
  assert.equal(holdStorageKey("occ_1"), "skedul:hold:occ_1");
  const storage = fakeStorage();
  storeHoldId(storage, "occ_1", "pur_Abc-123");
  assert.equal(storage.map.get("skedul:hold:occ_1"), "pur_Abc-123");
  assert.equal(readHoldId(storage, "occ_1"), "pur_Abc-123");
  assert.equal(readHoldId(storage, "occ_2"), null, "another séance has no entry");
});

test("a stored id that does not look like one of our purchase ids is never used", () => {
  for (const bad of ["", "a b", "a/b", "../x", "<script>", "é", "x".repeat(65)]) {
    assert.equal(readHoldId(fakeStorage({ "skedul:hold:occ_1": bad }), "occ_1"), null, JSON.stringify(bad));
    const storage = fakeStorage();
    storeHoldId(storage, "occ_1", bad);
    assert.equal(storage.map.size, 0, `nothing stored for ${JSON.stringify(bad)}`);
  }
  assert.ok(HOLD_ID_RE.test("x".repeat(64)));
});

test("a missing or throwing storage never throws (private window, blocked site data)", () => {
  assert.equal(readHoldId(null, "occ_1"), null);
  assert.doesNotThrow(() => storeHoldId(null, "occ_1", "pur_1"));
  const throwing = {
    getItem: (): string | null => {
      throw new Error("denied");
    },
    setItem: (): void => {
      throw new Error("denied");
    },
  };
  assert.equal(readHoldId(throwing, "occ_1"), null);
  assert.doesNotThrow(() => storeHoldId(throwing, "occ_1", "pur_1"));
  assert.equal(browserSessionStorage(), null, "no window on the server");
});

test("returnHref: the cancel page of the séance with the buyer's own reference", () => {
  assert.equal(returnHref("altinha-paris", "occ_1", "pur_1"), "/altinha-paris/seance/occ_1?paiement=annule&p=pur_1");
  assert.equal(returnHref("altinha-paris", "occ_1", "a/b"), "/altinha-paris/seance/occ_1?paiement=annule&p=a%2Fb");
});

test("safeCheckoutUrl: an https URL or a same-origin http URL only, never credentials, a script or a relative URL", () => {
  const origin = "http://localhost:3102";
  const stripe = "https://checkout.stripe.com/c/pay/cs_test_abc#frag";
  const mock = "http://localhost:3102/api/mock-checkout?purchase=p1";
  assert.equal(safeCheckoutUrl(stripe, origin), stripe);
  assert.equal(safeCheckoutUrl(mock, origin), mock);
  for (const refused of [
    "http://evil.test/x",
    "http://localhost:3103/api/mock-checkout",
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.test/x",
    "/api/mock-checkout?purchase=p1",
    "https://user:secret@evil.test/",
    "",
    "not a url",
  ]) {
    assert.equal(safeCheckoutUrl(refused, origin), null, refused);
  }
});
