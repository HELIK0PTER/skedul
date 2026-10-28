import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_TOO_LONG } from "./notice";
import {
  RDV_NOT_BOOKABLE,
  acceptedByText,
  emptyOffersText,
  offerLine,
  rdvBadgeLabel,
  rdvIssueNote,
  rdvIssuesOf,
  showOrphanMark,
} from "./type-view";

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

/** A bookable paid RDV type: hours, a notice inside the horizon, one offer on sale. */
const RDV = {
  rdvEnabled: true,
  rdvFree: false,
  rdvDurationMin: 60,
  archived: false,
  hasHours: true,
  window: { minNoticeMinutes: 60, bookingHorizonDays: 60 },
  offersOnSale: 1,
};

test("rdvIssuesOf: why an RDV type offers no slot online (O14, P4CON:1353), nothing for a bookable, archived or non-RDV type", () => {
  assert.deepEqual(rdvIssuesOf(RDV), []);
  assert.deepEqual(rdvIssuesOf({ ...RDV, rdvEnabled: false, hasHours: false }), [], "not an RDV type");
  assert.deepEqual(rdvIssuesOf({ ...RDV, rdvDurationMin: null, hasHours: false }), [], "no duration: not bookable as an RDV at all");
  assert.deepEqual(rdvIssuesOf({ ...RDV, archived: true, hasHours: false }), [], "an archived type has its own banner");
  assert.deepEqual(rdvIssuesOf({ ...RDV, hasHours: false }), ["no_hours"]);
  assert.deepEqual(rdvIssuesOf({ ...RDV, window: { minNoticeMinutes: 2 * 1440 + 1, bookingHorizonDays: 2 } }), ["notice_over_horizon"]);
  assert.deepEqual(rdvIssuesOf({ ...RDV, window: { minNoticeMinutes: 2 * 1440, bookingHorizonDays: 2 } }), [], "a notice equal to the horizon still opens");
  assert.deepEqual(
    rdvIssuesOf({ ...RDV, hasHours: false, window: { minNoticeMinutes: 10_000, bookingHorizonDays: 1 }, offersOnSale: 0 }),
    ["no_hours", "notice_over_horizon"],
    "every closing reason, and the offer note only once the type can open",
  );
  assert.deepEqual(rdvIssuesOf({ ...RDV, offersOnSale: 0 }), ["no_offer"]);
  assert.deepEqual(rdvIssuesOf({ ...RDV, rdvFree: true, offersOnSale: 0 }), [], "a free type needs no offer");
});

test("rdvIssueNote: « Non réservable en ligne » with its reasons, or the ticket-holders-only note for a paid type with nothing on sale", () => {
  assert.equal(rdvIssueNote([]), null);
  assert.deepEqual(rdvIssueNote(["no_hours"]), {
    tone: "closed",
    title: "Non réservable en ligne",
    lines: ["Ce type n'a pas d'horaires propres et vos disponibilités générales sont vides : ajoutez des horaires."],
  });
  assert.deepEqual(rdvIssueNote(["notice_over_horizon"]), { tone: "closed", title: "Non réservable en ligne", lines: [NOTICE_TOO_LONG] });
  assert.equal(rdvIssueNote(["no_hours", "notice_over_horizon"])?.lines.length, 2);
  assert.deepEqual(rdvIssueNote(["no_offer"]), {
    tone: "tickets_only",
    title: "Réservable avec un ticket seulement",
    lines: ["Seuls les clients qui ont déjà des tickets de ce type peuvent réserver. Mettez une offre en vente pour les autres."],
  });
  assert.equal(RDV_NOT_BOOKABLE, "Non réservable en ligne");
});

test("type-view copy carries no em dash or en dash", () => {
  const all = [
    rdvBadgeLabel({ rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 }),
    offerLine({ label: "Carnet de 4", priceCents: 8500, validityText: "3 mois" }, "eur"),
    emptyOffersText(true),
    acceptedByText([{ title: "A" }, { title: "B" }]),
    JSON.stringify(rdvIssueNote(["no_hours", "notice_over_horizon"])),
    JSON.stringify(rdvIssueNote(["no_offer"])),
  ].join(" ");
  assert.equal(/[\u2013\u2014]/.test(all), false);
});
