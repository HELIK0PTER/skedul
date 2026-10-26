import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicVisitor, WalletOwner } from "./identity";
import type { PublicSeanceState } from "./planning-view";
import type { PurchaseReference } from "./purchase-reads";
import {
  canSeePrivateSeance,
  referenceForPage,
  seancePageMode,
  seanceViewerOf,
  seatGoneOf,
  type PageBooking,
  type ReferenceView,
  type SeanceViewer,
} from "./visibility";

const NO_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const VICTIM_CUSTOMER = "c-victim";
const SEANCE = { kind: "seance", occurrenceId: "o1" } as const;

/** A pending buy + book purchase of the customer of an e-mail somebody typed, with its own booking on séance o1. */
function ref(over: Partial<PurchaseReference> = {}): PurchaseReference {
  return {
    purchaseId: "p1",
    customerId: VICTIM_CUSTOMER,
    status: "pending",
    processing: false,
    livemode: false,
    label: "Carnet de 4",
    quantity: 4,
    amountCents: 8500,
    currency: "eur",
    ticketTypeName: "Cours collectif",
    offerId: "offer1",
    checkoutSessionId: "cs_test_1",
    resumeUrl: "https://checkout.test/p1",
    booking: {
      bookingId: "b1",
      occurrenceId: "o1",
      status: "pending",
      holdExpiresAt: new Date("2026-10-12T17:45:00Z"),
      title: "Altinha débutants",
      startsAt: new Date("2026-10-12T17:00:00Z"),
      endsAt: new Date("2026-10-12T18:00:00Z"),
      location: null,
    },
    ticketCount: 0,
    ...over,
  };
}

const shopRef = (over: Partial<PurchaseReference> = {}): PurchaseReference => ref({ booking: null, ...over });

const OWNER: WalletOwner = { professionalId: "pro1", customerId: "c-owner", userId: "u-owner", email: "beatriz@example.com" };
const ANONYMOUS: PublicVisitor = { state: "anonymous", email: null, name: null, isPageOwner: false, owner: null, guestCustomerId: null };
const view = (over: Partial<ReferenceView> = {}): ReferenceView => ({
  purchaseId: "p1",
  kind: "buybook",
  status: "pending",
  processing: false,
  livemode: false,
  resumeUrl: null,
  holdExpiresAt: null,
  booking: { occurrenceId: "o1", status: "pending" },
  ...over,
});

test("referenceForPage: no reference, no view", () => {
  assert.equal(referenceForPage(null, SEANCE, null), null);
  assert.equal(referenceForPage(null, { kind: "offer", offerId: "offer1" }, OWNER), null);
});

test("referenceForPage: on its own séance the view carries that purchase and its booking, and no customer", () => {
  const got = referenceForPage(ref(), SEANCE, null);
  assert.deepEqual(got, {
    purchaseId: "p1",
    kind: "buybook",
    status: "pending",
    processing: false,
    livemode: false,
    resumeUrl: "https://checkout.test/p1",
    holdExpiresAt: "2026-10-12T17:45:00.000Z",
    booking: { occurrenceId: "o1", status: "pending" },
  });
  assert.ok(got);
  assert.equal("customerId" in got, false, "SEC-C1: the view has no customerId key");
  assert.deepEqual(Object.keys(got).sort(), [
    "booking",
    "holdExpiresAt",
    "kind",
    "livemode",
    "processing",
    "purchaseId",
    "resumeUrl",
    "status",
  ]);
  assert.equal(JSON.stringify(got).includes(VICTIM_CUSTOMER), false);
});

test("referenceForPage: a booking on another séance, or none, is not shown on a séance page", () => {
  const elsewhere = ref({ booking: { ...ref().booking!, occurrenceId: "o2" } });
  assert.equal(referenceForPage(elsewhere, SEANCE, null), null);
  assert.equal(referenceForPage(shopRef(), SEANCE, null), null, "a shop purchase has no séance");
});

test("referenceForPage: a confirmed or ended booking has no hold end, a paid purchase keeps its status", () => {
  const paid = ref({ status: "paid", resumeUrl: null, booking: { ...ref().booking!, status: "confirmed", holdExpiresAt: null } });
  assert.deepEqual(referenceForPage(paid, SEANCE, null), {
    purchaseId: "p1",
    kind: "buybook",
    status: "paid",
    processing: false,
    livemode: false,
    resumeUrl: null,
    holdExpiresAt: null,
    booking: { occurrenceId: "o1", status: "confirmed" },
  });
  const expired = ref({ status: "expired", resumeUrl: null, booking: { ...ref().booking!, status: "expired" } });
  assert.equal(referenceForPage(expired, SEANCE, null)?.booking?.status, "expired");
});

test("referenceForPage: an offer page shows a shop purchase of this offer only", () => {
  const page = { kind: "offer", offerId: "offer1" } as const;
  assert.deepEqual(referenceForPage(shopRef({ resumeUrl: "https://checkout.test/shop" }), page, null), {
    purchaseId: "p1",
    kind: "shop",
    status: "pending",
    processing: false,
    livemode: false,
    resumeUrl: "https://checkout.test/shop",
    holdExpiresAt: null,
    booking: null,
  });
  assert.equal(referenceForPage(shopRef({ offerId: "offer2" }), page, null), null, "another offer");
  assert.equal(referenceForPage(ref(), page, null), null, "a buy + book purchase has a booking");
  assert.equal(referenceForPage(shopRef({ offerId: null }), page, null), null);
});

test("referenceForPage: an Owner ignores the reference of another customer (OUT:74)", () => {
  assert.equal(referenceForPage(ref(), SEANCE, OWNER), null);
  assert.equal(referenceForPage(shopRef(), { kind: "offer", offerId: "offer1" }, OWNER), null);
  const hers = ref({ customerId: OWNER.customerId });
  assert.equal(referenceForPage(hers, SEANCE, OWNER)?.purchaseId, "p1");
  assert.equal(referenceForPage(hers, SEANCE, null)?.purchaseId, "p1");
});

test("seanceViewerOf: the Owner wins, whatever the cookie or the reference", () => {
  const owner: PublicVisitor = { ...ANONYMOUS, state: "verified", email: OWNER.email, name: "Beatriz", owner: OWNER };
  const expected: SeanceViewer = { kind: "customer", customerId: "c-owner", source: "owner" };
  assert.deepEqual(seanceViewerOf({ visitor: owner, reference: null }), expected);
  assert.deepEqual(seanceViewerOf({ visitor: owner, reference: view() }), expected);
  assert.deepEqual(seanceViewerOf({ visitor: { ...owner, guestCustomerId: "c-cookie" }, reference: null }), expected);
});

test("seanceViewerOf: a verified session without a record and an impersonating admin ignore the cookie (L1370)", () => {
  const verified: PublicVisitor = { ...ANONYMOUS, state: "verified", email: "nouveau@example.com", name: "Nouveau" };
  const impersonating: PublicVisitor = { ...ANONYMOUS, state: "impersonating" };
  for (const visitor of [verified, impersonating]) {
    const planted = { ...visitor, guestCustomerId: "c-cookie" };
    assert.equal(seanceViewerOf({ visitor: planted, reference: null }), null, `${visitor.state} + cookie`);
    assert.deepEqual(seanceViewerOf({ visitor: planted, reference: view() }), { kind: "reference", reference: view() }, `${visitor.state} + cookie + reference`);
    assert.deepEqual(seanceViewerOf({ visitor, reference: view() }), { kind: "reference", reference: view() });
  }
});

test("seanceViewerOf: the guest cookie customer, a signed-in unverified visitor included", () => {
  const guest: PublicVisitor = { ...ANONYMOUS, guestCustomerId: "c-cookie" };
  const expected: SeanceViewer = { kind: "customer", customerId: "c-cookie", source: "guest" };
  assert.deepEqual(seanceViewerOf({ visitor: guest, reference: null }), expected);
  assert.deepEqual(seanceViewerOf({ visitor: guest, reference: view() }), expected, "the cookie wins over a reference");
  const unverified: PublicVisitor = { ...guest, state: "unverified", email: "u@example.com", name: "U" };
  assert.deepEqual(seanceViewerOf({ visitor: unverified, reference: null }), expected);
});

test("seanceViewerOf: a reference alone is a reference, never a customer", () => {
  const alone = seanceViewerOf({ visitor: ANONYMOUS, reference: view() });
  assert.deepEqual(alone, { kind: "reference", reference: view() });
  assert.ok(alone && alone.kind === "reference");
  assert.deepEqual(Object.keys(alone).sort(), ["kind", "reference"], "no customer id next to a reference");
  assert.equal(seanceViewerOf({ visitor: ANONYMOUS, reference: null }), null);
  const unverified: PublicVisitor = { ...ANONYMOUS, state: "unverified", email: "u@example.com", name: "U" };
  assert.deepEqual(seanceViewerOf({ visitor: unverified, reference: view() }), { kind: "reference", reference: view() });
});

test("seanceViewerOf: an impossible owner on an impersonating visitor is not a customer", () => {
  const odd: PublicVisitor = { ...ANONYMOUS, state: "impersonating", owner: OWNER };
  assert.equal(seanceViewerOf({ visitor: odd, reference: null }), null);
});

test("canSeePrivateSeance: the page owner, a customer with an active booking, a reference whose booking is on it", () => {
  const owner: SeanceViewer = { kind: "customer", customerId: "c1", source: "owner" };
  const guest: SeanceViewer = { kind: "customer", customerId: "c2", source: "guest" };
  const byRef: SeanceViewer = { kind: "reference", reference: view() };
  const byShop: SeanceViewer = { kind: "reference", reference: view({ kind: "shop", booking: null }) };
  const none = { isPageOwner: false, customerHasActiveBooking: false };

  assert.equal(canSeePrivateSeance({ ...none, isPageOwner: true, viewer: null }), true);
  assert.equal(canSeePrivateSeance({ ...none, isPageOwner: true, viewer: guest }), true);
  assert.equal(canSeePrivateSeance({ ...none, viewer: null }), false);
  assert.equal(canSeePrivateSeance({ ...none, viewer: null, customerHasActiveBooking: true }), false);
  for (const viewer of [owner, guest]) {
    assert.equal(canSeePrivateSeance({ ...none, viewer }), false, `${viewer.kind} without a booking`);
    assert.equal(canSeePrivateSeance({ ...none, viewer, customerHasActiveBooking: true }), true, `${viewer.kind} with a booking`);
  }
  assert.equal(canSeePrivateSeance({ ...none, viewer: byRef }), true);
  assert.equal(canSeePrivateSeance({ ...none, viewer: byShop }), false);
});

const OPEN: PublicSeanceState = { kind: "open", seatsLeft: 5 };
const FREE: PublicSeanceState = { kind: "free", seatsLeft: 5 };
const base = { state: OPEN, archived: false, isPrivate: false, booked: null, mode: "tickets" as const, canSpend: false, coveringOffers: 2 };

test("seancePageMode: the mode's form for an open or free séance", () => {
  assert.deepEqual(seancePageMode(base), { kind: "tickets", canSpend: false, coveringOffers: 2 });
  assert.deepEqual(seancePageMode({ ...base, canSpend: true, coveringOffers: 0 }), { kind: "tickets", canSpend: true, coveringOffers: 0 });
  assert.deepEqual(seancePageMode({ ...base, state: FREE, mode: "free" }), { kind: "free" });
  assert.deepEqual(seancePageMode({ ...base, mode: "none" }), { kind: "state", state: { kind: "onsite" } });
});

test("seancePageMode: every other state is shown as it is", () => {
  const states: PublicSeanceState[] = [
    { kind: "past" },
    { kind: "ongoing" },
    { kind: "onsite" },
    { kind: "notYet" },
    { kind: "closed" },
    { kind: "full" },
    { kind: "cancelled" },
  ];
  for (const state of states) assert.deepEqual(seancePageMode({ ...base, state }), { kind: "state", state });
});

test("seancePageMode: archived and private are closed, a cancelled séance stays cancelled", () => {
  const closed = { kind: "state", state: { kind: "closed" } };
  assert.deepEqual(seancePageMode({ ...base, archived: true }), closed);
  assert.deepEqual(seancePageMode({ ...base, isPrivate: true }), closed);
  assert.deepEqual(seancePageMode({ ...base, isPrivate: true, state: FREE, mode: "free" }), closed);
  assert.deepEqual(seancePageMode({ ...base, archived: true, state: { kind: "full" } }), closed);
  assert.deepEqual(seancePageMode({ ...base, archived: true, isPrivate: true, state: { kind: "cancelled" } }), {
    kind: "state",
    state: { kind: "cancelled" },
  });
});

test("seancePageMode: the Owner's or the reference's booking comes first", () => {
  const confirmed: PageBooking = { status: "confirmed", via: "owner" };
  const pending: PageBooking = { status: "pending", via: "reference" };
  assert.deepEqual(seancePageMode({ ...base, booked: confirmed }), { kind: "booked", status: "confirmed", via: "owner" });
  assert.deepEqual(seancePageMode({ ...base, booked: pending, state: { kind: "full" } }), { kind: "booked", status: "pending", via: "reference" });
  assert.deepEqual(seancePageMode({ ...base, booked: confirmed, isPrivate: true, archived: true }), {
    kind: "booked",
    status: "confirmed",
    via: "owner",
  });
});

test("seancePageMode: a guest cookie's booking is never a PageBooking, so it never hides the form", () => {
  // The page passes booked: null for a guest viewer (PageBooking has no "guest" via): the form stays.
  assert.deepEqual(seancePageMode({ ...base, booked: null }), { kind: "tickets", canSpend: false, coveringOffers: 2 });
  assert.deepEqual(seancePageMode({ ...base, booked: null, state: FREE, mode: "free" }), { kind: "free" });
});

const SEAT_NOW = new Date("2026-10-12T17:30:00Z");
const HOLD_LIVE = "2026-10-12T17:45:00.000Z";
const HOLD_ENDED = "2026-10-12T17:29:59.000Z";
const ON_O1 = (status: "pending" | "confirmed" | "cancelled" | "expired") => ({ occurrenceId: "o1", status });

test("seatGoneOf: a pending buy + book purchase keeps its seat while its hold is live", () => {
  assert.equal(seatGoneOf(view({ holdExpiresAt: HOLD_LIVE, resumeUrl: "https://checkout.test/p1" }), SEAT_NOW), null);
});

test("seatGoneOf: a hold that ended frees the seat even before the nightly sweep (Decision 31)", () => {
  assert.equal(seatGoneOf(view({ holdExpiresAt: HOLD_ENDED }), SEAT_NOW), "expired");
  assert.equal(seatGoneOf(view({ holdExpiresAt: SEAT_NOW.toISOString() }), SEAT_NOW), "expired", "the hold ends at its end instant");
  assert.equal(seatGoneOf(view({ holdExpiresAt: null }), SEAT_NOW), "expired", "a pending booking with no readable hold end holds nothing");
});

test("seatGoneOf: a booking the pro cancelled is a seat gone while the purchase still waits for its session to expire", () => {
  // The purchase stays pending until the expiry webhook (up to 31 minutes in mock mode): the block must not promise the seat.
  const cancelled = { booking: ON_O1("cancelled"), resumeUrl: "https://checkout.test/p1" };
  assert.equal(seatGoneOf(view({ ...cancelled, holdExpiresAt: null }), SEAT_NOW), "cancelled");
  assert.equal(seatGoneOf(view({ ...cancelled, holdExpiresAt: HOLD_LIVE }), SEAT_NOW), "cancelled", "whatever the hold end says");
  assert.equal(seatGoneOf(view({ ...cancelled, holdExpiresAt: HOLD_ENDED }), SEAT_NOW), "cancelled", "cancelled wins over a lapsed hold");
});

test("seatGoneOf: a cancelled booking stays « cancelled » once the purchase expired (the steady state after the expiry webhook)", () => {
  // releasePurchase only turns a PENDING booking into expired: the booking the pro cancelled stays cancelled while the
  // purchase moves pending -> expired, so the cancel URL must keep saying COPY.ENDED_CANCELLED, not « réserver à nouveau ».
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("cancelled") }), SEAT_NOW), "cancelled");
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("cancelled"), holdExpiresAt: HOLD_ENDED }), SEAT_NOW), "cancelled");
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("cancelled"), holdExpiresAt: HOLD_LIVE }), SEAT_NOW), "cancelled");
});

test("seatGoneOf: an expired purchase otherwise says it itself, and a payment on its way still wins", () => {
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("expired") }), SEAT_NOW), null);
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("pending"), holdExpiresAt: HOLD_ENDED }), SEAT_NOW), null);
  assert.equal(seatGoneOf(view({ status: "expired", processing: true, booking: ON_O1("cancelled") }), SEAT_NOW), null, "E10: a late payment is fulfilled from expired, the webhook decides");
});

test("seatGoneOf: a paid purchase is never judged by the seat, even with a cancelled booking", () => {
  assert.equal(seatGoneOf(view({ status: "paid", booking: ON_O1("cancelled") }), SEAT_NOW), null);
});

test("seatGoneOf: an expired booking is a seat gone, whatever the hold end says", () => {
  assert.equal(seatGoneOf(view({ booking: ON_O1("expired"), holdExpiresAt: HOLD_LIVE }), SEAT_NOW), "expired");
  assert.equal(seatGoneOf(view({ booking: ON_O1("expired"), holdExpiresAt: null }), SEAT_NOW), "expired");
});

test("seatGoneOf: a payment on its way, a settled purchase and a shop purchase are not judged by the seat", () => {
  assert.equal(seatGoneOf(view({ processing: true, booking: ON_O1("cancelled"), holdExpiresAt: HOLD_ENDED }), SEAT_NOW), null, "the webhook decides");
  assert.equal(seatGoneOf(view({ processing: true, holdExpiresAt: HOLD_ENDED }), SEAT_NOW), null);
  assert.equal(seatGoneOf(view({ status: "paid", booking: ON_O1("confirmed") }), SEAT_NOW), null);
  assert.equal(seatGoneOf(view({ status: "expired", booking: ON_O1("expired") }), SEAT_NOW), null, "the status already says it");
  assert.equal(seatGoneOf(view({ kind: "shop", booking: null }), SEAT_NOW), null, "a shop purchase holds no seat");
});

test("no module string carries a dash", () => {
  const strings = JSON.stringify([seancePageMode(base), referenceForPage(ref(), SEANCE, null)]);
  assert.equal(NO_DASH.test(strings), false);
});
