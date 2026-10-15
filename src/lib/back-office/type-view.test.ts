import assert from "node:assert/strict";
import test from "node:test";

import { acceptedByText, emptyOffersText, offerLine, rdvBadgeLabel, showOrphanMark } from "./type-view";

/** Intl puts a no-break space before the currency sign: compare with plain spaces. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");

test("rdvBadgeLabel: « RDV libre », « RDV gratuit », nothing without RDV", () => {
  assert.equal(rdvBadgeLabel({ rdvEnabled: false, rdvFree: false, rdvDurationMin: null }), null);
  assert.equal(rdvBadgeLabel({ rdvEnabled: true, rdvFree: false, rdvDurationMin: 60 }), "RDV libre · 60 min");
  assert.equal(rdvBadgeLabel({ rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 }), "RDV gratuit · 15 min");
  assert.equal(rdvBadgeLabel({ rdvEnabled: true, rdvFree: false, rdvDurationMin: null }), "RDV libre");
});

test("offerLine: label, price, validity", () => {
  assert.equal(plain(offerLine({ label: "À l'unité", priceCents: 2500, validityText: null }, "eur")), "À l'unité · 25 €");
  assert.equal(plain(offerLine({ label: "Carnet de 4", priceCents: 8500, validityText: "3 mois" }, "eur")), "Carnet de 4 · 85 € · 3 mois");
  assert.equal(plain(offerLine({ label: "Carnet de 10", priceCents: 19000, validityText: "6 mois" }, "eur")), "Carnet de 10 · 190 € · 6 mois");
  assert.equal(plain(offerLine({ label: "Essai", priceCents: 2550, validityText: "30 jours" }, "eur")), "Essai · 25,50 € · 30 jours");
});

test("emptyOffersText: a free RDV type has no offer by design", () => {
  assert.equal(emptyOffersText(false), "Aucune offre");
  assert.equal(emptyOffersText(true), "Gratuit, sans ticket");
});

test("acceptedByText: titles or nobody", () => {
  assert.equal(acceptedByText([]), "Accepté par aucun événement");
  assert.equal(acceptedByText([{ title: "Altinha débutants" }]), "Accepté par : Altinha débutants");
  assert.equal(
    acceptedByText([{ title: "Altinha débutants" }, { title: "Équipe compétition" }]),
    "Accepté par : Altinha débutants, Équipe compétition",
  );
});

test("showOrphanMark: orange only for an active, non-free type linked to no upcoming event", () => {
  assert.equal(showOrphanMark({ orphan: true, archived: false, rdvFree: false }), true);
  assert.equal(showOrphanMark({ orphan: false, archived: false, rdvFree: false }), false);
  assert.equal(showOrphanMark({ orphan: true, archived: true, rdvFree: false }), false, "an archived type is red, not orange");
  assert.equal(showOrphanMark({ orphan: true, archived: false, rdvFree: true }), false, "a free call needs no event");
});

test("type-view copy carries no em dash or en dash", () => {
  const all = [
    rdvBadgeLabel({ rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 }),
    offerLine({ label: "Carnet de 4", priceCents: 8500, validityText: "3 mois" }, "eur"),
    emptyOffersText(true),
    acceptedByText([{ title: "A" }, { title: "B" }]),
  ].join(" ");
  assert.equal(/[\u2013\u2014]/.test(all), false);
});
