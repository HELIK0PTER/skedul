import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKED_CONFIRMED,
  BOOKED_PENDING,
  FREE_BOOKING_TITLE,
  SEANCE_HEADING_ID,
  SEANCE_STATE_LINES,
  SEE_MY_SPACE,
  TICKETS_BOOKING_TITLE,
  stateLine,
  ticketUsedLine,
} from "./seance-copy";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("the state lines are the contract's, one per state that closes the booking", () => {
  assert.deepEqual(SEANCE_STATE_LINES, {
    cancelled: "Cette séance est annulée.",
    past: "Cette séance est terminée.",
    ongoing: "Cette séance a commencé.",
    onsite: "Pas de réservation en ligne : présentez-vous sur place.",
    notYet: "Les réservations ne sont pas encore ouvertes pour cette séance.",
    closed: "Les réservations en ligne sont fermées pour cette séance.",
    full: "Cette séance est complète.",
  });
});

test("stateLine has a sentence for every closed state and none for free and open", () => {
  assert.equal(stateLine("full"), "Cette séance est complète.");
  assert.equal(stateLine("cancelled"), "Cette séance est annulée.");
  assert.equal(stateLine("free"), null);
  assert.equal(stateLine("open"), null);
});

test("the booked lines, the titles and the ticket line", () => {
  assert.equal(BOOKED_CONFIRMED, "Vous êtes inscrit(e) à cette séance.");
  assert.equal(BOOKED_PENDING, "Un paiement est en attente pour cette séance.");
  assert.equal(SEE_MY_SPACE, "Voir mon espace");
  assert.equal(FREE_BOOKING_TITLE, "S'inscrire à cette séance");
  assert.equal(TICKETS_BOOKING_TITLE, "Réserver cette séance");
  assert.equal(ticketUsedLine("Cours collectif"), "Ticket utilisé : Cours collectif.");
  assert.equal(SEANCE_HEADING_ID, "seance-title", "the id the séance page gives its heading");
});

test("no string of the séance copy contains an em dash or an en dash", () => {
  const all = [
    ...Object.values(SEANCE_STATE_LINES),
    BOOKED_CONFIRMED,
    BOOKED_PENDING,
    SEE_MY_SPACE,
    FREE_BOOKING_TITLE,
    TICKETS_BOOKING_TITLE,
    ticketUsedLine("x"),
  ];
  for (const text of all) assert.doesNotMatch(text, DASH, text);
});
