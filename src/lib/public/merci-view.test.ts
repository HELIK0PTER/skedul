import assert from "node:assert/strict";
import test from "node:test";

import type { BookingStatus } from "@/lib/tickets-vocab";

import { merciCopy, merciStateOf, type MerciState } from "./merci-view";
import type { PurchaseReference } from "./purchase-reads";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const BASE: PurchaseReference = {
  purchaseId: "p1",
  customerId: "c1",
  status: "paid",
  processing: false,
  livemode: false,
  label: "À l'unité",
  quantity: 1,
  amountCents: 2500,
  currency: "eur",
  ticketTypeName: "Cours collectif",
  offerId: "o1",
  checkoutSessionId: "mock_p1",
  resumeUrl: null,
  booking: null,
  ticketCount: 1,
};

function booking(startsAt: string, endsAt: string, status: BookingStatus = "confirmed"): NonNullable<PurchaseReference["booking"]> {
  return {
    bookingId: "b1",
    occurrenceId: "occ1",
    isRdv: false,
    ticketTypeId: null,
    status,
    holdExpiresAt: null,
    title: "Altinha débutants",
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    location: "Gymnase",
  };
}

const ref = (over: Partial<PurchaseReference>): PurchaseReference => ({ ...BASE, ...over });

/** One DST day per zone: the clocks move on these Sundays, the label must still read the pro's wall clock. */
const DST_DAYS = [
  { tz: "Europe/Paris", day: "spring forward", startsAt: "2026-03-29T08:00:00Z", endsAt: "2026-03-29T09:00:00Z", when: "dim. 29 mars 2026 · 10:00 à 11:00" },
  { tz: "Europe/Paris", day: "fall back", startsAt: "2026-10-25T09:00:00Z", endsAt: "2026-10-25T10:00:00Z", when: "dim. 25 octobre 2026 · 10:00 à 11:00" },
  { tz: "America/Los_Angeles", day: "spring forward", startsAt: "2026-03-08T17:00:00Z", endsAt: "2026-03-08T18:00:00Z", when: "dim. 8 mars 2026 · 10:00 à 11:00" },
  { tz: "America/Los_Angeles", day: "fall back", startsAt: "2026-11-01T18:00:00Z", endsAt: "2026-11-01T19:00:00Z", when: "dim. 1er novembre 2026 · 10:00 à 11:00" },
];

test("a paid buy + book with a confirmed booking is « booked » and names the séance on the pro's wall clock, on four DST days", () => {
  for (const c of DST_DAYS) {
    const state = merciStateOf(ref({ booking: booking(c.startsAt, c.endsAt) }), c.tz);
    assert.deepEqual(state, { kind: "booked", title: "Altinha débutants", whenLabel: c.when, isRdv: false }, `${c.tz}, ${c.day}`);
  }
});

test("the same instant reads in the zone of the pro, never in the host's zone", () => {
  const label = (startsAt: string, endsAt: string, tz: string): string => {
    const state = merciStateOf(ref({ booking: booking(startsAt, endsAt) }), tz);
    assert.equal(state.kind, "booked");
    return state.kind === "booked" ? state.whenLabel : "";
  };
  assert.equal(label("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "America/Los_Angeles"), "dim. 25 octobre 2026 · 02:00 à 03:00");
  assert.equal(label("2026-11-01T18:00:00Z", "2026-11-01T19:00:00Z", "Europe/Paris"), "dim. 1er novembre 2026 · 19:00 à 20:00");
});

test("a paid purchase whose booking EXPIRED is « paid_late »: only a hold expires, so the place was released before the payment landed", () => {
  const state = merciStateOf(
    ref({ quantity: 4, ticketCount: 4, booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "expired") }),
    "Europe/Paris",
  );
  assert.deepEqual(state, { kind: "paid_late", count: 4, isRdv: false });
});

test("a paid purchase whose booking was CANCELLED is « paid_cancelled »: it cannot tell a late payment from a booking cancelled after it was confirmed, so it gives no reason (G4c)", () => {
  for (const [quantity, ticketCount] of [[4, 4], [1, 0], [1, 1]] as const) {
    const state = merciStateOf(
      ref({ quantity, ticketCount, booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "cancelled") }),
      "Europe/Paris",
    );
    assert.deepEqual(state, { kind: "paid_cancelled", isRdv: false }, `${quantity} / ${ticketCount}`);
  }
  // Only the paid purchase: an unpaid one whose booking was cancelled is still « expired », whatever its booking says.
  const unpaid = merciStateOf(
    ref({ status: "expired", booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "cancelled") }),
    "Europe/Paris",
  );
  assert.deepEqual(unpaid, { kind: "expired", withBooking: true, isRdv: false });
});

test("a paid purchase whose booking is still pending is a transient moment: « pending », so the page keeps looking", () => {
  const state = merciStateOf(ref({ booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "pending") }), "Europe/Paris");
  assert.deepEqual(state, { kind: "pending" });
});

test("a paid purchase without a booking is « paid_shop »; the count is the tickets issued, else the quantity", () => {
  assert.deepEqual(merciStateOf(ref({ quantity: 4, ticketCount: 4 }), "Europe/Paris"), {
    kind: "paid_shop",
    count: 4,
    typeName: "Cours collectif",
  });
  assert.deepEqual(merciStateOf(ref({ quantity: 4, ticketCount: 0 }), "Europe/Paris"), {
    kind: "paid_shop",
    count: 4,
    typeName: "Cours collectif",
  });
});

test("pending is « processing » while a delayed payment is on its way and « pending » otherwise; expired remembers its booking", () => {
  assert.deepEqual(merciStateOf(ref({ status: "pending", processing: true, ticketCount: 0 }), "Europe/Paris"), { kind: "processing" });
  assert.deepEqual(merciStateOf(ref({ status: "pending", processing: false, ticketCount: 0 }), "Europe/Paris"), { kind: "pending" });
  assert.deepEqual(merciStateOf(ref({ status: "expired", ticketCount: 0 }), "Europe/Paris"), { kind: "expired", withBooking: false, isRdv: false });
  assert.deepEqual(
    merciStateOf(
      ref({ status: "expired", ticketCount: 0, booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z", "expired") }),
      "Europe/Paris",
    ),
    { kind: "expired", withBooking: true, isRdv: false },
  );
});

test("a state never carries the purchase, the customer or any identity (Decision 71)", () => {
  const states: MerciState[] = [
    merciStateOf(ref({ booking: booking("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z") }), "Europe/Paris"),
    merciStateOf(ref({}), "Europe/Paris"),
    merciStateOf(ref({ status: "pending" }), "Europe/Paris"),
    merciStateOf(ref({ status: "expired" }), "Europe/Paris"),
  ];
  for (const state of states) {
    for (const key of Object.keys(state)) {
      assert.ok(!/id$/i.test(key) && key !== "email", `unexpected key ${key} in ${state.kind}`);
    }
  }
});

test("merciCopy: every title and body, exact", () => {
  assert.deepEqual(merciCopy({ kind: "booked", title: "Altinha débutants", whenLabel: "dim. 25 octobre 2026 · 10:00 à 11:00", isRdv: false }), {
    title: "Inscription confirmée",
    body: "Paiement reçu. Vous êtes inscrit(e) à « Altinha débutants » (dim. 25 octobre 2026 · 10:00 à 11:00). Vous recevez par email la confirmation et le reçu.",
  });
  assert.deepEqual(merciCopy({ kind: "paid_shop", count: 1, typeName: "Cours collectif" }), {
    title: "Paiement reçu",
    body: "Votre ticket « Cours collectif » est dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy({ kind: "paid_shop", count: 4, typeName: "Cours collectif" }), {
    title: "Paiement reçu",
    body: "Vos 4 tickets « Cours collectif » sont dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy({ kind: "paid_late", count: 1, isRdv: false }), {
    title: "Paiement reçu",
    body: "Paiement reçu, votre place n'était plus réservée : votre ticket est dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy({ kind: "paid_late", count: 4, isRdv: false }), {
    title: "Paiement reçu",
    body: "Paiement reçu, votre place n'était plus réservée : vos 4 tickets sont dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy({ kind: "paid_cancelled", isRdv: false }), {
    title: "Paiement reçu",
    body: "Paiement reçu. Cette réservation a été annulée.",
  });
  assert.deepEqual(merciCopy({ kind: "processing" }), {
    title: "Paiement en cours de traitement",
    body: "Votre banque confirme le paiement. Vous recevrez un email dès qu'il sera validé.",
  });
  assert.deepEqual(merciCopy({ kind: "pending" }), {
    title: "Paiement en attente de confirmation",
    body: "La confirmation arrive dans quelques secondes. Cette page se met à jour toute seule.",
  });
  assert.deepEqual(merciCopy({ kind: "expired", withBooking: true, isRdv: false }), {
    title: "Place expirée",
    body: "Le paiement n'a pas abouti et votre réservation a expiré.",
  });
  assert.deepEqual(merciCopy({ kind: "expired", withBooking: false, isRdv: false }), {
    title: "Paiement non abouti",
    body: "Le paiement n'a pas abouti.",
  });
});

/** An RDV purchase: its booking is on an occurrence with no event (P5 T10, D § 3.13). */
const rdvBooking = (status: BookingStatus = "confirmed"): NonNullable<PurchaseReference["booking"]> => ({
  ...booking("2026-10-26T18:00:00Z", "2026-10-26T19:00:00Z", status),
  isRdv: true,
  ticketTypeId: "tt1",
  title: "Cours particulier",
  location: null,
});

const RDV_STATES: MerciState[] = [
  { kind: "booked", title: "Cours particulier", whenLabel: "lun. 26 octobre 2026 · 19:00 à 20:00", isRdv: true },
  { kind: "paid_late", count: 1, isRdv: true },
  { kind: "paid_late", count: 4, isRdv: true },
  { kind: "paid_cancelled", isRdv: true },
  { kind: "expired", withBooking: true, isRdv: true },
];

test("merciStateOf: an RDV purchase carries isRdv into every state that names its booking", () => {
  assert.deepEqual(merciStateOf(ref({ booking: rdvBooking() }), "Europe/Paris"), RDV_STATES[0]);
  assert.deepEqual(merciStateOf(ref({ booking: rdvBooking("expired") }), "Europe/Paris"), RDV_STATES[1]);
  assert.deepEqual(merciStateOf(ref({ booking: rdvBooking("cancelled") }), "Europe/Paris"), RDV_STATES[3]);
  assert.deepEqual(merciStateOf(ref({ status: "expired", booking: rdvBooking("expired") }), "Europe/Paris"), RDV_STATES[4]);
  assert.deepEqual(merciStateOf(ref({ booking: rdvBooking("pending") }), "Europe/Paris"), { kind: "pending" });
  // the Los Angeles wall clock of the same instant
  const la = merciStateOf(ref({ booking: rdvBooking() }), "America/Los_Angeles");
  assert.deepEqual(la, { kind: "booked", title: "Cours particulier", whenLabel: "lun. 26 octobre 2026 · 11:00 à 12:00", isRdv: true });
});

test("merciCopy: the RDV states say « rendez-vous » and « créneau », never « séance », « inscrit » or « place » (P5 T10)", () => {
  assert.deepEqual(merciCopy(RDV_STATES[0]), {
    title: "Rendez-vous confirmé",
    body: "Paiement reçu. Votre rendez-vous « Cours particulier » (lun. 26 octobre 2026 · 19:00 à 20:00) est réservé. Vous recevez par email la confirmation et le reçu.",
  });
  assert.deepEqual(merciCopy(RDV_STATES[1]), {
    title: "Paiement reçu",
    body: "Paiement reçu, votre créneau n'était plus réservé : votre ticket est dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy(RDV_STATES[2]), {
    title: "Paiement reçu",
    body: "Paiement reçu, votre créneau n'était plus réservé : vos 4 tickets sont dans votre portefeuille.",
  });
  assert.deepEqual(merciCopy(RDV_STATES[3]), { title: "Paiement reçu", body: "Paiement reçu. Ce rendez-vous a été annulé." });
  assert.deepEqual(merciCopy(RDV_STATES[4]), {
    title: "Créneau expiré",
    body: "Le paiement n'a pas abouti et votre créneau n'est plus réservé.",
  });
  for (const state of RDV_STATES) {
    const { title, body } = merciCopy(state);
    assert.doesNotMatch(`${title} ${body}`, /[Ss][ée]ance|[Ii]nscri|(^|[^a-zà-ÿ])place([^a-zà-ÿ]|$)/, state.kind);
  }
});

test("no copy of any state contains a dash or a « tu » form, and a type name is shown as the pro wrote it", () => {
  const states: MerciState[] = [
    { kind: "booked", title: "Altinha débutants", whenLabel: DST_DAYS[3].when, isRdv: false },
    { kind: "paid_shop", count: 1, typeName: "Cours collectif" },
    { kind: "paid_shop", count: 4, typeName: "Cours d'essai" },
    { kind: "paid_late", count: 1, isRdv: false },
    { kind: "paid_late", count: 4, isRdv: false },
    { kind: "paid_cancelled", isRdv: false },
    { kind: "processing" },
    { kind: "pending" },
    { kind: "expired", withBooking: true, isRdv: false },
    { kind: "expired", withBooking: false, isRdv: false },
    ...RDV_STATES,
  ];
  for (const state of states) {
    const { title, body } = merciCopy(state);
    for (const text of [title, body]) {
      assert.doesNotMatch(text, DASH, `${state.kind}: ${text}`);
      // JavaScript's \b is ASCII-only and would flag « êtes »: the boundary is spelled out with the French letters (Task 2).
      assert.doesNotMatch(text, /(^|[^a-zàâäçéèêëîïôöùûüÿœæ])(tu|ton|ta|tes)(?![a-zàâäçéèêëîïôöùûüÿœæ])/i, `${state.kind}: ${text}`);
    }
  }
  assert.match(merciCopy({ kind: "paid_shop", count: 4, typeName: "Cours d'essai" }).body, /« Cours d'essai »/);
});
