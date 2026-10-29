import assert from "node:assert/strict";
import test from "node:test";

import {
  clientRecordsNote,
  pageContentNote,
  pendingPaymentsNote,
  ticketsNote,
  upcomingNote,
} from "./admin-deletion-copy";

// U+2013 (en dash) and U+2014 (em dash), built from code points so that this file holds no dash itself
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const STATS = { events: 7, ticketTypes: 5, confirmedBookings: 12, upcoming: 3, clients: 7, paidPurchases: 4 };

test("pageContentNote: the page, its slug and the counts, each with its own plural", () => {
  assert.equal(
    pageContentNote("altinha-paris", STATS),
    "La page /altinha-paris et tout son contenu : 7 événements, 5 types de ticket, 12 réservations confirmées, 7 clients, 4 achats payés.",
  );
  assert.equal(
    pageContentNote("solo", { events: 1, ticketTypes: 1, confirmedBookings: 1, upcoming: 0, clients: 1, paidPurchases: 1 }),
    "La page /solo et tout son contenu : 1 événement, 1 type de ticket, 1 réservation confirmée, 1 client, 1 achat payé.",
  );
  assert.equal(
    pageContentNote("big", { ...STATS, confirmedBookings: 1234 }),
    "La page /big et tout son contenu : 7 événements, 5 types de ticket, 1 234 réservations confirmées, 7 clients, 4 achats payés.",
  );
});

test("upcomingNote and ticketsNote: singular and plural agree with the count", () => {
  assert.equal(upcomingNote(1), "1 réservation à venir disparaîtra sans que le client soit prévenu.");
  assert.equal(upcomingNote(3), "3 réservations à venir disparaîtront sans que les clients soient prévenus.");
  assert.equal(ticketsNote(1), "1 ticket en circulation sera perdu pour ses clients, sans remboursement automatique.");
  assert.equal(ticketsNote(13), "13 tickets en circulation seront perdus pour ses clients, sans remboursement automatique.");
});

test("pendingPaymentsNote: one payment says its session, several say their sessions", () => {
  assert.equal(
    pendingPaymentsNote(1),
    "1 paiement en cours : sa session Stripe encore ouverte sera expirée avant la suppression.",
  );
  assert.equal(
    pendingPaymentsNote(2),
    "2 paiements en cours : leurs sessions Stripe encore ouvertes seront expirées avant la suppression.",
  );
  assert.equal(
    pendingPaymentsNote(1500),
    "1 500 paiements en cours : leurs sessions Stripe encore ouvertes seront expirées avant la suppression.",
  );
});

test("clientRecordsNote: one record reads « Sa fiche », several read « Ses N fiches »", () => {
  assert.equal(
    clientRecordsNote(1),
    "Sa fiche client chez un autre pro est conservée, mais détachée du compte.",
  );
  assert.equal(
    clientRecordsNote(3),
    "Ses 3 fiches client chez d'autres pros sont conservées, mais détachées du compte.",
  );
});

test("the deletion notes never contain an em dash or an en dash", () => {
  const texts = [
    pageContentNote("altinha-paris", STATS),
    upcomingNote(1),
    upcomingNote(3),
    ticketsNote(1),
    ticketsNote(13),
    pendingPaymentsNote(1),
    pendingPaymentsNote(2),
    clientRecordsNote(1),
    clientRecordsNote(3),
  ];
  for (const text of texts) assert.equal(DASH.test(text), false, text);
});
