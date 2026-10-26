/**
 * The payment return in one pure module (G4c, Item 1): what the séance and offer pages show of a purchase (the block, the
 * booked state, the ended line) and what the block says (its view, its heading, its sentence). Every case runs with a
 * pro in Paris and a pro in Los Angeles, because the hold end is written in the PRO's zone, never the host's: run the file
 * under two host zones too (PowerShell `$env:TZ`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkoutBlockOf,
  paymentReturnOf,
  releaseOutcomeText,
  returnHeadingOf,
  returnTextOf,
  returnViewOf,
  type OwnerFacts,
} from "./checkout-return-view";
import type { ReferenceView } from "./visibility";

const NO_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** The same instant, written by two pros: 17:45 UTC is 19:45 in Paris (CEST) and 10:45 in Los Angeles (PDT). */
const NOW = new Date("2026-10-12T17:30:00Z");
const HOLD_LIVE = "2026-10-12T17:45:00.000Z";
const HOLD_ENDED = "2026-10-12T17:29:59.000Z";
const ZONES = [
  { tz: "Europe/Paris", live: "19:45" },
  { tz: "America/Los_Angeles", live: "10:45" },
] as const;

const view = (over: Partial<ReferenceView> = {}): ReferenceView => ({
  purchaseId: "p1",
  kind: "buybook",
  status: "pending",
  processing: false,
  livemode: false,
  resumeUrl: "https://checkout.test/p1",
  holdExpiresAt: HOLD_LIVE,
  booking: { occurrenceId: "o1", status: "pending" },
  ...over,
});
const shop = (over: Partial<ReferenceView> = {}): ReferenceView => view({ kind: "shop", booking: null, holdExpiresAt: null, ...over });

const inputs = (tz: string, over: Partial<Parameters<typeof paymentReturnOf>[0]> = {}): Parameters<typeof paymentReturnOf>[0] => ({
  slug: "altinha-paris",
  tz,
  now: NOW,
  readOnly: false,
  reference: null,
  ownerFacts: null,
  ownerPending: null,
  ...over,
});

const ownerFacts = (over: Partial<OwnerFacts> = {}): OwnerFacts => ({ booking: null, ended: null, ...over });
const activeBooking = (status: "pending" | "confirmed", purchaseId: string | null): OwnerFacts["booking"] => ({ status, purchaseId });

for (const { tz, live } of ZONES) {
  test(`${tz}: a live hold is booked by reference, shows its end in the pro's zone and can be resumed`, () => {
    const got = paymentReturnOf(inputs(tz, { reference: view() }));
    assert.deepEqual(got.booked, { status: "pending", via: "reference" });
    assert.deepEqual(got.block, {
      slug: "altinha-paris",
      purchaseId: "p1",
      kind: "buybook",
      status: "pending",
      processing: false,
      resumeUrl: "https://checkout.test/p1",
      holdUntilLabel: live,
      merciHref: "/altinha-paris/merci?p=p1",
      readOnly: false,
    });
    assert.equal(got.ended, null);
    assert.equal(got.shownPurchaseId, "p1");
  });

  test(`${tz}: a lapsed hold is shown as expired, with no Checkout URL, no end time and no booked state`, () => {
    const got = paymentReturnOf(inputs(tz, { reference: view({ holdExpiresAt: HOLD_ENDED }) }));
    assert.equal(got.booked, null);
    assert.equal(got.block?.status, "expired");
    assert.equal(got.block?.resumeUrl, null);
    assert.equal(got.block?.holdUntilLabel, null);
    assert.equal(got.ended, null, "the block says it; the line above the form stays out");
    assert.equal(got.shownPurchaseId, "p1");
  });

  test(`${tz}: a booking the pro cancelled leaves no block and the line says so, whether the purchase still waits or expired`, () => {
    for (const status of ["pending", "expired"] as const) {
      const got = paymentReturnOf(inputs(tz, { reference: view({ status, booking: { occurrenceId: "o1", status: "cancelled" }, holdExpiresAt: null }) }));
      assert.equal(got.block, null, `purchase ${status}`);
      assert.equal(got.booked, null);
      assert.equal(got.ended, "cancelled");
      assert.equal(got.shownPurchaseId, null);
    }
  });

  test(`${tz}: an expired booking on a pending purchase is shown as expired, and a processing payment is not judged by the seat`, () => {
    const expired = paymentReturnOf(inputs(tz, { reference: view({ booking: { occurrenceId: "o1", status: "expired" }, holdExpiresAt: null }) }));
    assert.equal(expired.block?.status, "expired");
    assert.equal(expired.ended, null);
    const processing = paymentReturnOf(inputs(tz, { reference: view({ processing: true, holdExpiresAt: HOLD_ENDED }) }));
    assert.equal(processing.block?.status, "pending");
    assert.equal(processing.block?.processing, true);
    assert.equal(processing.block?.holdUntilLabel, null, "no hold end to promise once it ended");
    assert.equal(processing.booked, null, "a lapsed hold books nothing, even with a payment on its way");
    assert.equal(processing.ended, null);
  });

  test(`${tz}: a paid purchase with its confirmed booking is booked, with no resume and no hold end`, () => {
    const got = paymentReturnOf(
      inputs(tz, { reference: view({ status: "paid", resumeUrl: null, holdExpiresAt: null, booking: { occurrenceId: "o1", status: "confirmed" } }) }),
    );
    assert.deepEqual(got.booked, { status: "confirmed", via: "reference" });
    assert.equal(got.block?.status, "paid");
    assert.equal(got.block?.resumeUrl, null);
    assert.equal(got.block?.holdUntilLabel, null);
    assert.equal(got.ended, null);
  });

  test(`${tz}: a shop purchase holds no seat: its block follows its own status, and nothing is booked`, () => {
    const pending = paymentReturnOf(inputs(tz, { reference: shop() }));
    assert.equal(pending.booked, null);
    assert.equal(pending.block?.kind, "shop");
    assert.equal(pending.block?.status, "pending");
    assert.equal(pending.block?.resumeUrl, "https://checkout.test/p1");
    assert.equal(pending.block?.holdUntilLabel, null, "a shop purchase has no hold");
    const expired = paymentReturnOf(inputs(tz, { reference: shop({ status: "expired", resumeUrl: null }) }));
    assert.equal(expired.block?.status, "expired");
    assert.equal(expired.ended, null);
  });

  test(`${tz}: an Owner's pending purchase wins over a stale reference of her own for the same séance`, () => {
    // She holds X (pending, live); the URL carries an old Y of hers whose seat was released.
    const stale = view({ purchaseId: "y", status: "expired", resumeUrl: null, holdExpiresAt: null, booking: { occurrenceId: "o1", status: "expired" } });
    const x = view({ purchaseId: "x", resumeUrl: "https://checkout.test/x" });
    const got = paymentReturnOf(
      inputs(tz, { reference: stale, ownerFacts: ownerFacts({ booking: activeBooking("pending", "x") }), ownerPending: x }),
    );
    assert.deepEqual(got.booked, { status: "pending", via: "owner" });
    assert.equal(got.block?.purchaseId, "x");
    assert.equal(got.block?.status, "pending");
    assert.equal(got.block?.resumeUrl, "https://checkout.test/x");
    assert.equal(got.block?.holdUntilLabel, live);
    assert.equal(got.shownPurchaseId, "x");
    assert.equal(got.ended, null);
  });

  test(`${tz}: the URL reference that IS her pending purchase serves, and her pending purchase alone serves without a reference`, () => {
    const x = view({ purchaseId: "x" });
    const facts = ownerFacts({ booking: activeBooking("pending", "x") });
    assert.equal(paymentReturnOf(inputs(tz, { reference: x, ownerFacts: facts, ownerPending: null })).block?.purchaseId, "x");
    assert.equal(paymentReturnOf(inputs(tz, { reference: null, ownerFacts: facts, ownerPending: x })).block?.purchaseId, "x");
  });

  test(`${tz}: with an active booking, a stale reference of a booking that ended is not described at all`, () => {
    const stale = view({ purchaseId: "y", status: "expired", resumeUrl: null, holdExpiresAt: null, booking: { occurrenceId: "o1", status: "expired" } });
    // Confirmed through a paid purchase P, or through a held ticket (no purchase): « libérée, réservez à nouveau » would contradict « Vous êtes inscrit(e) ».
    for (const purchaseId of ["p", null]) {
      const got = paymentReturnOf(inputs(tz, { reference: stale, ownerFacts: ownerFacts({ booking: activeBooking("confirmed", purchaseId) }) }));
      assert.deepEqual(got.booked, { status: "confirmed", via: "owner" });
      assert.equal(got.block, null);
      assert.equal(got.ended, null);
      assert.equal(got.shownPurchaseId, null);
    }
    // Her booking's own purchase, opened by its cancel URL, still says « Paiement reçu ».
    const paid = view({ purchaseId: "p", status: "paid", resumeUrl: null, holdExpiresAt: null, booking: { occurrenceId: "o1", status: "confirmed" } });
    const own = paymentReturnOf(inputs(tz, { reference: paid, ownerFacts: ownerFacts({ booking: activeBooking("confirmed", "p") }) }));
    assert.equal(own.block?.status, "paid");
    assert.deepEqual(own.booked, { status: "confirmed", via: "owner" });
  });

  test(`${tz}: without an active booking the Owner's ended line stays, unless the block is absent because the pro cancelled`, () => {
    const noReference = paymentReturnOf(inputs(tz, { ownerFacts: ownerFacts({ ended: "expired" }) }));
    assert.equal(noReference.block, null);
    assert.equal(noReference.ended, "expired");
    assert.equal(paymentReturnOf(inputs(tz, { ownerFacts: ownerFacts({ ended: "cancelled" }) })).ended, "cancelled");
    // The block is shown: the line stays out.
    const shown = paymentReturnOf(inputs(tz, { reference: view({ holdExpiresAt: HOLD_ENDED }), ownerFacts: ownerFacts({ ended: "expired" }) }));
    assert.equal(shown.ended, null);
    // The reference's booking was cancelled: the block is absent for THAT reason and the line gives it, not an older expiry.
    const cancelled = view({ booking: { occurrenceId: "o1", status: "cancelled" }, holdExpiresAt: null });
    assert.equal(paymentReturnOf(inputs(tz, { reference: cancelled, ownerFacts: ownerFacts({ ended: "expired" }) })).ended, "cancelled");
  });

  test(`${tz}: read-only withholds the Checkout URL and tells the block`, () => {
    const got = paymentReturnOf(inputs(tz, { reference: view(), readOnly: true }));
    assert.equal(got.block?.resumeUrl, null);
    assert.equal(got.block?.readOnly, true);
    assert.equal(got.block?.holdUntilLabel, live, "the hold line stays");
    assert.equal(checkoutBlockOf(shop(), { slug: "s", tz, now: NOW, readOnly: true })?.resumeUrl, null);
  });
}

test("the hold end follows the pro's zone across a DST change, whatever the host zone", () => {
  // Paris leaves summer time on 2026-10-25 (03:00 CEST -> 02:00 CET); Los Angeles on 2026-11-01 (02:00 PDT -> 01:00 PST).
  const paris = checkoutBlockOf(view({ holdExpiresAt: "2026-10-25T01:30:00.000Z" }), { slug: "s", tz: "Europe/Paris", now: new Date("2026-10-25T00:00:00Z"), readOnly: false });
  assert.equal(paris?.holdUntilLabel, "02:30", "after the change: UTC+1");
  const beforeParis = checkoutBlockOf(view({ holdExpiresAt: "2026-10-24T20:30:00.000Z" }), { slug: "s", tz: "Europe/Paris", now: new Date("2026-10-24T20:00:00Z"), readOnly: false });
  assert.equal(beforeParis?.holdUntilLabel, "22:30", "before the change: UTC+2");
  const la = checkoutBlockOf(view({ holdExpiresAt: "2026-11-01T09:30:00.000Z" }), { slug: "s", tz: "America/Los_Angeles", now: new Date("2026-11-01T09:00:00Z"), readOnly: false });
  assert.equal(la?.holdUntilLabel, "01:30", "after the change: UTC-8");
});

test("the block carries the pro's slug and a merci link that names only the purchase", () => {
  const got = checkoutBlockOf(view({ purchaseId: "a b/c" }), { slug: "altinha-paris", tz: "Europe/Paris", now: NOW, readOnly: false });
  assert.equal(got?.slug, "altinha-paris");
  assert.equal(got?.merciHref, "/altinha-paris/merci?p=a%20b%2Fc");
  assert.equal(JSON.stringify(got).includes("customer"), false, "no customer in the block");
});

test("the view and the sentence follow the state of the purchase", () => {
  const args = { kind: "buybook", resumeUrl: "https://checkout.test/p1", holdUntilLabel: "19:45", readOnly: false } as const;
  const pending = returnViewOf({ status: "pending", processing: false, outcome: null });
  assert.equal(pending, "pending");
  assert.equal(returnTextOf({ ...args, view: pending }), "Votre place est gardée jusqu'à 19:45.");

  const paid = returnViewOf({ status: "paid", processing: false, outcome: null });
  assert.equal(paid, "paid");
  assert.equal(returnTextOf({ ...args, view: paid }), "Paiement reçu");

  const processing = returnViewOf({ status: "pending", processing: true, outcome: null });
  assert.equal(processing, "processing");
  assert.equal(returnTextOf({ ...args, view: processing }), "Paiement en cours de traitement");

  const expired = returnViewOf({ status: "expired", processing: false, outcome: null });
  assert.equal(returnTextOf({ ...args, view: expired }), "Votre place a été libérée. Vous pouvez réserver à nouveau.");
  assert.equal(returnTextOf({ ...args, kind: "shop", view: expired }), "Ce paiement n'a pas abouti.");
  assert.equal(returnTextOf({ ...args, kind: "shop", view: pending }), "Votre achat n'est pas payé.");
});

test("the heading follows the view: a payment that went through or is on its way is not « interrompu » (G4c)", () => {
  for (const v of ["pending", "expired", "released", "ended"] as const) assert.equal(returnHeadingOf(v), "Paiement interrompu", v);
  for (const v of ["paid", "processing"] as const) assert.equal(returnHeadingOf(v), "Votre paiement", v);
  // The cancel URL of a PAID purchase: « Votre paiement » above « Paiement reçu », never « Paiement interrompu » above it.
  const paid = returnViewOf({ status: "paid", processing: false, outcome: null });
  assert.equal(returnHeadingOf(paid), "Votre paiement");
  assert.equal(returnTextOf({ view: paid, kind: "buybook", resumeUrl: null, holdUntilLabel: null, readOnly: false }), "Paiement reçu");
  // A payment the bank is confirming, on a cancel URL.
  assert.equal(returnHeadingOf(returnViewOf({ status: "pending", processing: true, outcome: null })), "Votre paiement");
  // A release that finds the payment turns the block into the paid / processing one, heading included.
  assert.equal(returnHeadingOf(returnViewOf({ status: "pending", processing: false, outcome: "paid" })), "Votre paiement");
  assert.equal(returnHeadingOf(returnViewOf({ status: "pending", processing: false, outcome: "processing" })), "Votre paiement");
  // A release that gave the seat back keeps the seat's heading.
  assert.equal(returnHeadingOf(returnViewOf({ status: "pending", processing: false, outcome: "released" })), "Paiement interrompu");
});

test("a release made here wins over the props, and its sentence follows it", () => {
  const args = { kind: "buybook", resumeUrl: "https://checkout.test/p1", holdUntilLabel: "19:45", readOnly: false } as const;
  const released = returnViewOf({ status: "pending", processing: false, outcome: "released" });
  assert.equal(released, "released");
  assert.equal(returnTextOf({ ...args, view: released }), "Votre place est libérée.");
  assert.equal(returnViewOf({ status: "pending", processing: false, outcome: "already_ended" }), "ended");
  assert.equal(returnTextOf({ ...args, view: "ended" }), "Cette réservation n'est plus en attente de paiement.");
  // The release found a payment: the block turns into the paid / processing one.
  const paid = returnViewOf({ status: "pending", processing: false, outcome: "paid" });
  assert.equal(paid, "paid");
  assert.equal(returnViewOf({ status: "pending", processing: false, outcome: "processing" }), "processing");
  assert.equal(returnViewOf({ status: "expired", processing: false, outcome: "paid" }), "paid");
  assert.equal(returnViewOf({ status: "paid", processing: false, outcome: "released" }), "released", "what the server just did wins over the props it has not caught up with");
});

test("the pending sentence: read-only never invites a release, a closed session does", () => {
  const base = { view: "pending", kind: "buybook", holdUntilLabel: "19:45" } as const;
  assert.equal(returnTextOf({ ...base, resumeUrl: null, readOnly: false }), "La page de paiement a expiré. Vous pouvez libérer votre place maintenant.");
  assert.equal(returnTextOf({ ...base, resumeUrl: null, readOnly: true }), "Votre place est gardée jusqu'à 19:45.", "no Checkout URL is passed when read-only");
  assert.equal(returnTextOf({ ...base, holdUntilLabel: null, resumeUrl: "https://checkout.test/p1", readOnly: false }), null, "no hold end to promise");
});

test("the release outcome lines are the ones the block and PendingHolds share", () => {
  assert.equal(releaseOutcomeText("released"), "Votre place est libérée.");
  assert.equal(releaseOutcomeText("paid"), "Paiement reçu");
  assert.equal(releaseOutcomeText("processing"), "Paiement en cours de traitement");
  assert.equal(releaseOutcomeText("already_ended"), "Cette réservation n'est plus en attente de paiement.");
});

test("nothing the module says carries a dash", () => {
  const strings: string[] = [];
  for (const v of ["pending", "paid", "processing", "expired", "released", "ended"] as const) {
    strings.push(returnHeadingOf(v));
    for (const kind of ["buybook", "shop"] as const) {
      for (const readOnly of [true, false]) {
        const t = returnTextOf({ view: v, kind, resumeUrl: null, holdUntilLabel: "19:45", readOnly });
        if (t !== null) strings.push(t);
      }
    }
  }
  assert.ok(strings.length > 14);
  for (const s of strings) assert.equal(NO_DASH.test(s), false, s);
});
