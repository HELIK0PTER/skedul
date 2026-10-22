import assert from "node:assert/strict";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { attachCheckoutSession, startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { releasePurchase } from "@/lib/booking/release";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { mockSessionId } from "@/lib/payments/checkout";
import { mockCheckoutState, mockPay } from "@/lib/payments/mock-checkout";
import { HEALTH_KEYS, readHealth } from "@/lib/throttle";
import { formatMoney } from "@/lib/utils";
import { createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType, ticketsOf } from "@/test/fixtures";

type Session = "mock" | "none" | "stripe";

/** Attaches the session of `kind` to the purchase, the way the action leaves it (`none` leaves the purchase unattached). */
async function attach(db: Db, purchaseId: string, kind: Session): Promise<string | null> {
  if (kind === "none") return null;
  const sessionId = kind === "mock" ? mockSessionId(purchaseId) : `cs_test_${nanoid()}`;
  const attached = await attachCheckoutSession(db, {
    purchaseId,
    checkoutSessionId: sessionId,
    checkoutUrl: `https://checkout.test/${purchaseId}`,
  });
  assert.ok(attached.ok, JSON.stringify(attached));
  return sessionId;
}

/** A buy + book purchase of « Altinha débutants » (4 tickets, 85 eur) with its booking held. */
async function buyBook(db: Db, pro: TestPro, kind: Session = "mock") {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, {
    quantity: 4,
    priceCents: 8500,
    validityCount: 3,
    validityUnit: "month",
  });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const started = await startBuyAndBook(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    offerId,
  });
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId = await attach(db, started.purchaseId, kind);
  return { purchaseId: started.purchaseId, bookingId: started.bookingId, occurrenceId: occ.id, offerId, customerId, sessionId };
}

/** A shop purchase of the 3-ticket offer (190 eur). */
async function shop(db: Db, pro: TestPro, kind: Session = "mock") {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 3, priceCents: 19000 });
  const customerId = await makeCustomer(db, pro);
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId = await attach(db, started.purchaseId, kind);
  return { purchaseId: started.purchaseId, offerId, customerId, sessionId };
}

async function purchaseRow(db: Db, purchaseId: string) {
  const [row] = await db.select().from(schema.ticketPurchase).where(eq(schema.ticketPurchase.id, purchaseId));
  return row;
}

async function businessNameOf(db: Db, pro: TestPro): Promise<string> {
  const [row] = await db
    .select({ businessName: schema.professional.businessName })
    .from(schema.professional)
    .where(eq(schema.professional.id, pro.proId));
  return row.businessName;
}

const orphans = async (db: Db): Promise<number> => (await readHealth(db))[HEALTH_KEYS.orphanPayments]?.value ?? 0;

dbTest("mockCheckoutState: a pending simulated purchase shows its view, the cancel link goes back to the séance or the offer", async ({ db, pro }) => {
  const businessName = await businessNameOf(db, pro);

  const b = await buyBook(db, pro);
  assert.deepEqual(await mockCheckoutState(db, b.purchaseId), {
    kind: "pending",
    view: {
      purchaseId: b.purchaseId,
      businessName,
      productLabel: "Altinha débutants · Carnet de 4",
      amountLabel: formatMoney(8500, "eur"),
      cancelPath: `/${pro.slug}/seance/${b.occurrenceId}?paiement=annule&p=${b.purchaseId}`,
    },
  });

  const s = await shop(db, pro);
  assert.deepEqual(await mockCheckoutState(db, s.purchaseId), {
    kind: "pending",
    view: {
      purchaseId: s.purchaseId,
      businessName,
      productLabel: "Cours collectif · Carnet de 3",
      amountLabel: formatMoney(19000, "eur"),
      cancelPath: `/${pro.slug}/offre/${s.offerId}?paiement=annule&p=${s.purchaseId}`,
    },
  });

  // A purchase with no session attached yet (the window between the engine and the gateway) is simulated too.
  const unattached = await shop(db, pro, "none");
  assert.equal((await mockCheckoutState(db, unattached.purchaseId))?.kind, "pending");
});

dbTest("mockCheckoutState writes nothing: a GET is safe for prefetchers and link scanners (S15)", async ({ db, pro }) => {
  const b = await buyBook(db, pro);
  const snapshot = async () => ({
    purchase: await purchaseRow(db, b.purchaseId),
    booking: await getBooking(db, b.bookingId),
    occurrence: await getOccurrence(db, b.occurrenceId),
    tickets: (await ticketsOf(db, b.customerId)).length,
    orphans: await orphans(db),
  });
  const before = await snapshot();
  assert.equal((await mockCheckoutState(db, b.purchaseId))?.kind, "pending");
  assert.equal((await mockCheckoutState(db, b.purchaseId))?.kind, "pending");
  assert.deepEqual(await snapshot(), before);
  assert.equal(before.purchase.status, "pending");
});

dbTest("mockPay: a simulated buy + book is fulfilled with livemode false, the booking is confirmed, the merci path is the pro's own", async ({ db, pro }) => {
  const b = await buyBook(db, pro);
  const res = await mockPay(db, b.purchaseId, new Date());
  assert.deepEqual(res, {
    kind: "paid",
    merciPath: `/${pro.slug}/merci?p=${b.purchaseId}`,
    effects: [
      { type: "email.purchase_receipt", purchaseId: b.purchaseId },
      { type: "email.booking_confirmed", bookingId: b.bookingId },
      { type: "email.pro_new_booking", bookingId: b.bookingId },
      { type: "google.sync_occurrence", occurrenceId: b.occurrenceId },
    ],
  });
  const row = await purchaseRow(db, b.purchaseId);
  assert.equal(row.status, "paid");
  assert.equal(row.livemode, false);
  assert.equal(row.paymentIntentId, null);
  assert.equal(row.checkoutSessionId, mockSessionId(b.purchaseId), "the simulated session id stays");
  assert.equal((await getBooking(db, b.bookingId)).status, "confirmed");
  const tickets = await ticketsOf(db, b.customerId);
  assert.equal(tickets.length, 4);
  assert.equal(tickets.filter((t) => t.status === "booked").length, 1);

  // The page of a paid purchase sends the visitor to the merci page.
  assert.deepEqual(await mockCheckoutState(db, b.purchaseId), { kind: "paid", merciPath: `/${pro.slug}/merci?p=${b.purchaseId}` });

  // A second click, or a double submit: the same path, no effect, no new ticket.
  assert.deepEqual(await mockPay(db, b.purchaseId, new Date()), {
    kind: "paid",
    merciPath: `/${pro.slug}/merci?p=${b.purchaseId}`,
    effects: [],
  });
  assert.equal((await ticketsOf(db, b.customerId)).length, 4);
});

dbTest("mockPay: a shop purchase with no session attached is simulated too and keeps its session null", async ({ db, pro }) => {
  const s = await shop(db, pro, "none");
  const res = await mockPay(db, s.purchaseId, new Date());
  assert.deepEqual(res, {
    kind: "paid",
    merciPath: `/${pro.slug}/merci?p=${s.purchaseId}`,
    effects: [{ type: "email.purchase_receipt", purchaseId: s.purchaseId }],
  });
  const row = await purchaseRow(db, s.purchaseId);
  assert.equal(row.status, "paid");
  assert.equal(row.checkoutSessionId, null);
  assert.equal((await ticketsOf(db, s.customerId)).length, 3);
});

dbTest("SEC-M3 the mock pays only simulated sessions: a purchase opened against Stripe is neither shown nor paid (S40)", async ({ db, pro }) => {
  const b = await buyBook(db, pro, "stripe");
  assert.equal(await mockCheckoutState(db, b.purchaseId), null);
  assert.deepEqual(await mockPay(db, b.purchaseId, new Date()), { kind: "not_found" });
  assert.equal((await purchaseRow(db, b.purchaseId)).status, "pending");
  assert.equal((await getBooking(db, b.bookingId)).status, "pending");
  assert.equal((await getOccurrence(db, b.occurrenceId)).seatsTaken, 1);
  assert.equal((await ticketsOf(db, b.customerId)).length, 0);

  // Once Stripe has paid it, the mock still knows nothing of it (no merci redirect for a Stripe payment).
  const s = await shop(db, pro, "stripe");
  await fulfillPurchase(db, s.purchaseId, { sessionId: s.sessionId, paymentIntentId: `pi_test_${nanoid()}`, livemode: false });
  assert.equal(await mockCheckoutState(db, s.purchaseId), null);
  assert.deepEqual(await mockPay(db, s.purchaseId, new Date()), { kind: "not_found" });
  assert.equal((await ticketsOf(db, s.customerId)).length, 3, "no second set of tickets");
});

dbTest("mockPay on a simulated purchase whose hold was released: tickets and a late-payment notice, the booking stays expired", async ({ db, pro }) => {
  const b = await buyBook(db, pro);
  const released = await releasePurchase(db, b.purchaseId, new Date());
  assert.ok(released.ok, JSON.stringify(released));
  assert.equal(await mockCheckoutState(db, b.purchaseId), null, "an expired purchase shows no page");

  const res = await mockPay(db, b.purchaseId, new Date());
  assert.deepEqual(res, {
    kind: "paid",
    merciPath: `/${pro.slug}/merci?p=${b.purchaseId}`,
    effects: [
      { type: "email.purchase_receipt", purchaseId: b.purchaseId },
      { type: "email.late_payment", purchaseId: b.purchaseId },
    ],
  });
  assert.equal((await getBooking(db, b.bookingId)).status, "expired", "an ended booking is never resurrected");
  assert.equal((await ticketsOf(db, b.customerId)).length, 4);
});

dbTest("an unknown or malformed id is null and not_found, and the simulation never counts an orphan", async ({ db }) => {
  const before = await orphans(db);
  for (const id of [nanoid(), "../x", "", " ", "a".repeat(65), "p;q", "é"]) {
    assert.equal(await mockCheckoutState(db, id), null, JSON.stringify(id));
    assert.deepEqual(await mockPay(db, id, new Date()), { kind: "not_found" }, JSON.stringify(id));
  }
  assert.equal(await orphans(db), before);
});

dbTest("tenancy: another pro's simulated purchase is paid within its own pro, redirects to its own page, and leaves this pro untouched (S6)", async ({ db, pro }) => {
  const mine = await shop(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await buyBook(db, other);
    const state = await mockCheckoutState(db, theirs.purchaseId);
    assert.ok(state?.kind === "pending");
    assert.equal(state.view.cancelPath, `/${other.slug}/seance/${theirs.occurrenceId}?paiement=annule&p=${theirs.purchaseId}`);
    assert.equal(state.view.businessName, await businessNameOf(db, other));

    const res = await mockPay(db, theirs.purchaseId, new Date());
    assert.ok(res.kind === "paid");
    assert.equal(res.merciPath, `/${other.slug}/merci?p=${theirs.purchaseId}`, "never the page of another pro");
    assert.equal((await ticketsOf(db, theirs.customerId)).length, 4);

    assert.equal((await purchaseRow(db, mine.purchaseId)).status, "pending");
    assert.equal((await ticketsOf(db, mine.customerId)).length, 0);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
