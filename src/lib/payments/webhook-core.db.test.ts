import assert from "node:assert/strict";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { attachCheckoutSession, startBuyAndBook } from "@/lib/booking/claims";
import { startPurchase } from "@/lib/booking/fulfillment";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { SESSION_APP } from "@/lib/payments/checkout";
import {
  handleStripeEvent,
  purchaseOfSession,
  type CheckoutSessionLike,
  type StripeEventLike,
  type WebhookOptions,
  type WebhookOutcome,
} from "@/lib/payments/webhook-core";
import { HEALTH_KEYS, readHealth } from "@/lib/throttle";
import { createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType, ticketsOf } from "@/test/fixtures";

const TEST: WebhookOptions = { env: "test", mode: "test" };
const LIVE: WebhookOptions = { env: "production", mode: "live" };

/** What every pending purchase of these tests carries: its id, the session attached to it, its price. */
type Base = { purchaseId: string; sessionId: string; amountCents: number; customerId: string };
type BuyBook = Base & { bookingId: string; occurrenceId: string };

async function attach(db: Db, purchaseId: string): Promise<string> {
  const sessionId = `cs_test_${nanoid()}`;
  const attached = await attachCheckoutSession(db, {
    purchaseId,
    checkoutSessionId: sessionId,
    checkoutUrl: `https://checkout.test/${purchaseId}`,
  });
  assert.ok(attached.ok, JSON.stringify(attached));
  return sessionId;
}

/** A buy + book purchase (4 tickets, 85 eur) with its booking held and its session attached, as startBuyAndBookCore leaves it. */
async function pendingBuyBook(db: Db, pro: TestPro): Promise<BuyBook> {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, {
    quantity: 4,
    priceCents: 8500,
    validityCount: 3,
    validityUnit: "month",
  });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const started = await startBuyAndBook(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    offerId,
  });
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId = await attach(db, started.purchaseId);
  return {
    purchaseId: started.purchaseId,
    sessionId,
    amountCents: started.amountCents,
    customerId,
    bookingId: started.bookingId,
    occurrenceId: occ.id,
  };
}

/** A shop purchase (3 tickets, 190 eur) with its session attached. */
async function pendingShop(db: Db, pro: TestPro): Promise<Base> {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 3, priceCents: 19000 });
  const customerId = await makeCustomer(db, pro);
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId = await attach(db, started.purchaseId);
  return { purchaseId: started.purchaseId, sessionId, amountCents: started.amountCents, customerId };
}

/** The session Stripe would send for `p`: our marker, the purchase id three ways, paid, the exact amount in eur. */
function checkoutSession(p: Pick<Base, "purchaseId" | "sessionId" | "amountCents">, over: Partial<CheckoutSessionLike> = {}, env = TEST.env): CheckoutSessionLike {
  return {
    id: p.sessionId,
    mode: "payment",
    metadata: { purchaseId: p.purchaseId, app: SESSION_APP, env },
    client_reference_id: p.purchaseId,
    payment_status: "paid",
    payment_intent: `pi_test_${nanoid()}`,
    amount_total: p.amountCents,
    currency: "eur",
    ...over,
  };
}

function stripeEvent(type: string, object: unknown, livemode = false): StripeEventLike {
  return { id: `evt_${nanoid()}`, type, livemode, data: { object } };
}

function deliver(db: Db, type: string, object: unknown, opts: WebhookOptions = TEST, livemode = false): Promise<WebhookOutcome> {
  return handleStripeEvent(db, stripeEvent(type, object, livemode), new Date(), opts);
}

const IGNORED: WebhookOutcome = { handled: "ignored", effects: [] };

async function orphans(db: Db): Promise<number> {
  return (await readHealth(db))[HEALTH_KEYS.orphanPayments]?.value ?? 0;
}

async function purchaseRow(db: Db, purchaseId: string) {
  const [row] = await db.select().from(schema.ticketPurchase).where(eq(schema.ticketPurchase.id, purchaseId));
  return row;
}

/** Runs `run` with console.warn / error / info collected into `lines`, restored afterwards. */
async function captureConsole<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const saved = { warn: console.warn, error: console.error, info: console.info };
  const take = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.warn = take;
  console.error = take;
  console.info = take;
  try {
    return { result: await run(), lines };
  } finally {
    console.warn = saved.warn;
    console.error = saved.error;
    console.info = saved.info;
  }
}

dbTest("E10 completed + paid fulfils a buy + book: tickets, confirmed booking, receipt + confirmation + pro notice + sync", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  const pi = `pi_test_${nanoid()}`;

  const out = await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_intent: pi }));
  assert.equal(out.handled, "fulfilled");
  assert.deepEqual(out.effects, [
    { type: "email.purchase_receipt", purchaseId: p.purchaseId },
    { type: "email.booking_confirmed", bookingId: p.bookingId },
    { type: "email.pro_new_booking", bookingId: p.bookingId },
    { type: "google.sync_occurrence", occurrenceId: p.occurrenceId },
  ]);

  const row = await purchaseRow(db, p.purchaseId);
  assert.equal(row.status, "paid");
  assert.equal(row.livemode, false);
  assert.equal(row.paymentIntentId, pi);
  assert.equal(row.checkoutSessionId, p.sessionId);
  assert.equal((await getBooking(db, p.bookingId)).status, "confirmed");
  assert.equal((await getOccurrence(db, p.occurrenceId)).seatsTaken, 1);
  const tickets = await ticketsOf(db, p.customerId);
  assert.equal(tickets.length, 4);
  assert.equal(tickets.filter((t) => t.status === "booked").length, 1);
});

dbTest("E10 the same completed event twice is a duplicate: no second ticket, no second e-mail (S12)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const event = stripeEvent("checkout.session.completed", checkoutSession(p));
  const before = await orphans(db);

  const first = await handleStripeEvent(db, event, new Date(), TEST);
  assert.equal(first.handled, "fulfilled");
  assert.deepEqual(first.effects, [{ type: "email.purchase_receipt", purchaseId: p.purchaseId }]);

  const again = await handleStripeEvent(db, event, new Date(), TEST);
  assert.deepEqual(again, { handled: "duplicate", effects: [] });
  assert.equal((await ticketsOf(db, p.customerId)).length, 3, "the tickets were issued once");
  assert.equal(await orphans(db), before, "a retry of the same payment is not an orphan");
});

dbTest("E10 a second payment of a paid purchase is an orphan: counted for a refund, no new ticket (SEC-M2)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  assert.equal((await deliver(db, "checkout.session.completed", checkoutSession(p))).handled, "fulfilled");
  const before = await orphans(db);

  // Another Checkout session of the same purchase, paid with another payment intent.
  const second = { ...p, sessionId: `cs_test_${nanoid()}` };
  const out = await deliver(db, "checkout.session.completed", checkoutSession(second));
  assert.deepEqual(out, { handled: "orphan", effects: [] });
  assert.equal(await orphans(db), before + 1);
  assert.equal((await ticketsOf(db, p.customerId)).length, 3, "no ticket for the second payment");
  assert.equal((await purchaseRow(db, p.purchaseId)).checkoutSessionId, p.sessionId, "the first payment stays the purchase's");
});

dbTest("E10 completed + unpaid marks processing (delayed method), then async_payment_succeeded fulfils", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const pi = `pi_test_${nanoid()}`;

  const unpaid = await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: "unpaid", payment_intent: pi }));
  assert.deepEqual(unpaid, { handled: "processing", effects: [] });
  const waiting = await purchaseRow(db, p.purchaseId);
  assert.equal(waiting.status, "pending");
  assert.ok(waiting.processingAt, "processing_at is set");
  assert.equal((await ticketsOf(db, p.customerId)).length, 0);

  const paid = await deliver(db, "checkout.session.async_payment_succeeded", checkoutSession(p, { payment_intent: pi }));
  assert.equal(paid.handled, "fulfilled");
  assert.deepEqual(paid.effects, [{ type: "email.purchase_receipt", purchaseId: p.purchaseId }]);
  assert.equal((await ticketsOf(db, p.customerId)).length, 3);

  // An unpaid event arriving after the payment cannot take the purchase back to processing.
  const late = await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: "unpaid", payment_intent: pi }));
  assert.deepEqual(late, IGNORED);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "paid");
});

dbTest("E11 async_payment_failed releases the hold: purchase and booking expired, seat freed, Google re-synced", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  const out = await deliver(db, "checkout.session.async_payment_failed", checkoutSession(p, { payment_status: "unpaid" }));
  assert.deepEqual(out, {
    handled: "released",
    effects: [{ type: "google.sync_occurrence", occurrenceId: p.occurrenceId }],
  });
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "expired");
  assert.equal((await getBooking(db, p.bookingId)).status, "expired");
  assert.equal((await getOccurrence(db, p.occurrenceId)).seatsTaken, 0);
});

dbTest("E11 expired releases the seat of a buy + book and expires a shop purchase; a second delivery is a no-op", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  const event = stripeEvent("checkout.session.expired", checkoutSession(p, { payment_status: "unpaid" }));
  const out = await handleStripeEvent(db, event, new Date(), TEST);
  assert.deepEqual(out, {
    handled: "released",
    effects: [{ type: "google.sync_occurrence", occurrenceId: p.occurrenceId }],
  });
  assert.equal((await getOccurrence(db, p.occurrenceId)).seatsTaken, 0);
  assert.deepEqual(await handleStripeEvent(db, event, new Date(), TEST), { handled: "released", effects: [] });

  const shop = await pendingShop(db, pro);
  const shopOut = await deliver(db, "checkout.session.expired", checkoutSession(shop, { payment_status: "unpaid" }));
  assert.deepEqual(shopOut, { handled: "released", effects: [] });
  assert.equal((await purchaseRow(db, shop.purchaseId)).status, "expired");
});

dbTest("E11 expired of a session that is not the purchase's is ignored and releases nothing (S13)", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  // The metadata names the purchase, but the session id is not the one attached to it.
  const stranger = checkoutSession(p, { id: `cs_test_${nanoid()}`, payment_status: "unpaid" });
  assert.deepEqual(await deliver(db, "checkout.session.expired", stranger), IGNORED);
  assert.deepEqual(await deliver(db, "checkout.session.async_payment_failed", stranger), IGNORED);

  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
  assert.equal((await getBooking(db, p.bookingId)).status, "pending");
  assert.equal((await getOccurrence(db, p.occurrenceId)).seatsTaken, 1);
});

dbTest("E11 expired of a purchase that does not exist is ignored (the route answers 200)", async ({ db }) => {
  const ghost = { purchaseId: nanoid(), sessionId: `cs_test_${nanoid()}`, amountCents: 8500 };
  assert.deepEqual(await deliver(db, "checkout.session.expired", checkoutSession(ghost, { payment_status: "unpaid" })), IGNORED);
  assert.deepEqual(await deliver(db, "checkout.session.async_payment_failed", checkoutSession(ghost, { payment_status: "unpaid" })), IGNORED);
});

dbTest("LED:427 a pending purchase deleted with its pro: its expired event is ignored, its paid event is an orphan", async ({ db }) => {
  const other = await createTestPro(db);
  try {
    const p = await pendingShop(db, other);
    // The admin deletion of the pro: one DELETE FROM "user", everything cascades from professional.
    await deleteTestUser(db, other.userId);
    assert.equal(await purchaseRow(db, p.purchaseId), undefined, "the purchase went with its pro");

    const before = await orphans(db);
    const expired = await deliver(db, "checkout.session.expired", checkoutSession(p, { payment_status: "unpaid" }));
    assert.deepEqual(expired, IGNORED);
    assert.equal(await orphans(db), before, "an expired session of a deleted purchase is nothing to refund");

    const paid = await deliver(db, "checkout.session.completed", checkoutSession(p));
    assert.deepEqual(paid, { handled: "orphan", effects: [] });
    assert.equal(await orphans(db), before + 1, "a payment that landed anyway is counted for a manual refund");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("E10 the purchase id is resolved from the session id when the metadata does not name an existing purchase", async ({ db, pro }) => {
  const bare = await pendingShop(db, pro);
  const noMetadataId = checkoutSession(bare, { metadata: { app: SESSION_APP, env: TEST.env }, client_reference_id: null });
  assert.equal((await deliver(db, "checkout.session.completed", noMetadataId)).handled, "fulfilled");
  assert.equal((await ticketsOf(db, bare.customerId)).length, 3);

  const stale = await pendingShop(db, pro);
  const unknownMetadataId = checkoutSession(stale, { metadata: { purchaseId: nanoid(), app: SESSION_APP, env: TEST.env } });
  assert.equal((await deliver(db, "checkout.session.completed", unknownMetadataId)).handled, "fulfilled");
  assert.equal((await ticketsOf(db, stale.customerId)).length, 3);
});

dbTest("E10 a client_reference_id that differs from the found purchase is ignored: nothing issued, nothing counted (SEC-I7)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const before = await orphans(db);
  const out = await deliver(db, "checkout.session.completed", checkoutSession(p, { client_reference_id: nanoid() }));
  assert.deepEqual(out, IGNORED);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
  assert.equal((await ticketsOf(db, p.customerId)).length, 0);
  assert.equal(await orphans(db), before);
});

dbTest("E10 a paid session of ours with no purchase to settle is an orphan: 200 and counted for a manual refund", async ({ db }) => {
  const ghost = { purchaseId: nanoid(), sessionId: `cs_test_${nanoid()}`, amountCents: 8500 };
  const before = await orphans(db);
  const out = await deliver(db, "checkout.session.completed", checkoutSession(ghost));
  assert.deepEqual(out, { handled: "orphan", effects: [] });
  assert.equal(await orphans(db), before + 1);

  const asyncOut = await deliver(db, "checkout.session.async_payment_succeeded", checkoutSession(ghost));
  assert.deepEqual(asyncOut, { handled: "orphan", effects: [] });
  assert.equal(await orphans(db), before + 2);
});

dbTest("E10 an amount or a currency that is not the purchase's issues nothing and is an orphan (SEC-M1, S39)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const before = await orphans(db);

  const wrong: [string, Partial<CheckoutSessionLike>][] = [
    ["one cent more", { amount_total: p.amountCents + 1 }],
    ["one cent less", { amount_total: p.amountCents - 1 }],
    ["no amount", { amount_total: null }],
    ["another currency", { currency: "usd" }],
    ["no currency", { currency: null }],
  ];
  for (const [label, over] of wrong) {
    const out = await deliver(db, "checkout.session.completed", checkoutSession(p, over));
    assert.deepEqual(out, { handled: "orphan", effects: [] }, label);
  }
  assert.equal(await orphans(db), before + wrong.length);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending", "the purchase is still waiting for its real payment");
  assert.equal((await ticketsOf(db, p.customerId)).length, 0);

  // The right amount in capitals (Stripe sends lower case, the comparison is case-insensitive) settles it.
  const ok = await deliver(db, "checkout.session.completed", checkoutSession(p, { currency: "EUR" }));
  assert.equal(ok.handled, "fulfilled");
  assert.equal((await ticketsOf(db, p.customerId)).length, 3);
});

dbTest("E10 no_payment_required and a missing payment status issue nothing (COV-M2)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const before = await orphans(db);
  assert.deepEqual(await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: "no_payment_required" })), IGNORED);
  assert.deepEqual(await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: null })), IGNORED);
  assert.deepEqual(await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: "something_new" })), IGNORED);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
  assert.equal((await ticketsOf(db, p.customerId)).length, 0);
  assert.equal(await orphans(db), before);
});

dbTest("SEC-I7 sessions that are not our app in this environment are ignored, never an orphan (S37)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const before = await orphans(db);

  const noMarker = checkoutSession(p, { metadata: { purchaseId: p.purchaseId } });
  const noMetadata = checkoutSession(p, { metadata: null });
  const otherApp = checkoutSession(p, { metadata: { purchaseId: p.purchaseId, app: "billing", env: TEST.env } });
  const otherEnv = checkoutSession(p, {}, "preview");
  const subscription = checkoutSession(p, { mode: "subscription" });
  for (const [label, session] of [
    ["no marker", noMarker],
    ["no metadata", noMetadata],
    ["another app", otherApp],
    ["another environment", otherEnv],
    ["subscription mode", subscription],
  ] as const) {
    assert.deepEqual(await deliver(db, "checkout.session.completed", session), IGNORED, label);
  }
  assert.equal(await orphans(db), before, "none of them is an orphan");
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
  assert.equal((await ticketsOf(db, p.customerId)).length, 0);

  // A foreign session of an unknown purchase is just as silent.
  const ghost = { purchaseId: nanoid(), sessionId: `cs_test_${nanoid()}`, amountCents: 8500 };
  assert.deepEqual(await deliver(db, "checkout.session.completed", checkoutSession(ghost, { metadata: null })), IGNORED);
  assert.equal(await orphans(db), before);

  // Ours, in this environment: settled.
  assert.equal((await deliver(db, "checkout.session.completed", checkoutSession(p))).handled, "fulfilled");
});

dbTest("SEC-M1 the livemode of the event must be the deployment's: a test event on a live handler and the reverse are ignored", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const before = await orphans(db);

  const liveOnTest = await deliver(db, "checkout.session.completed", checkoutSession(p), TEST, true);
  assert.deepEqual(liveOnTest, IGNORED);
  const testOnLive = await deliver(db, "checkout.session.completed", checkoutSession(p, {}, LIVE.env), LIVE, false);
  assert.deepEqual(testOnLive, IGNORED);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
  assert.equal(await orphans(db), before);

  // A live payment on a live handler is stored as live with its payment intent (I6 holds, checked after the test).
  const pi = `pi_live_${nanoid()}`;
  const ok = await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_intent: pi }, LIVE.env), LIVE, true);
  assert.equal(ok.handled, "fulfilled");
  const row = await purchaseRow(db, p.purchaseId);
  assert.equal(row.livemode, true);
  assert.equal(row.paymentIntentId, pi);
});

dbTest("OUT:32 an expanded payment intent object is stored by its id (S14)", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const pi = `pi_test_${nanoid()}`;
  const out = await deliver(db, "checkout.session.completed", checkoutSession(p, { payment_intent: { id: pi } }));
  assert.equal(out.handled, "fulfilled");
  assert.equal((await purchaseRow(db, p.purchaseId)).paymentIntentId, pi);
});

dbTest("events that are not handled, or whose object is not a session, are ignored", async ({ db, pro }) => {
  const p = await pendingShop(db, pro);
  const session = checkoutSession(p);
  for (const type of ["payment_intent.succeeded", "customer.subscription.created", "checkout.session.async_payment_other", "invoice.paid", ""]) {
    assert.deepEqual(await deliver(db, type, session), IGNORED, JSON.stringify(type));
  }
  for (const object of [null, undefined, "cs_test_x", 5, {}, { id: 5 }, { id: "" }, []]) {
    assert.deepEqual(await deliver(db, "checkout.session.completed", object), IGNORED, JSON.stringify(object));
  }
  const noData = { id: "evt_x", type: "checkout.session.completed", livemode: false, data: undefined } as unknown as StripeEventLike;
  assert.deepEqual(await handleStripeEvent(db, noData, new Date(), TEST), IGNORED);
  assert.equal((await purchaseRow(db, p.purchaseId)).status, "pending");
});

dbTest("E10 a payment that lands after the hold was released fills the wallet and says so: receipt + late payment, the booking stays expired", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  await deliver(db, "checkout.session.expired", checkoutSession(p, { payment_status: "unpaid" }));
  assert.equal((await getBooking(db, p.bookingId)).status, "expired");

  const out = await deliver(db, "checkout.session.completed", checkoutSession(p));
  assert.equal(out.handled, "fulfilled");
  assert.deepEqual(out.effects, [
    { type: "email.purchase_receipt", purchaseId: p.purchaseId },
    { type: "email.late_payment", purchaseId: p.purchaseId },
  ]);
  assert.equal((await getBooking(db, p.bookingId)).status, "expired", "an ended booking is never resurrected");
  assert.equal((await getOccurrence(db, p.occurrenceId)).seatsTaken, 0);
  const tickets = await ticketsOf(db, p.customerId);
  assert.equal(tickets.length, 4);
  assert.ok(tickets.every((t) => t.status === "available"));
});

dbTest("tenancy: an event settles only the purchase of its own session, the other pro's purchase and wallet are untouched (S6)", async ({ db, pro }) => {
  const mine = await pendingShop(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await pendingShop(db, other);

    assert.equal((await deliver(db, "checkout.session.completed", checkoutSession(mine))).handled, "fulfilled");
    assert.equal((await ticketsOf(db, mine.customerId)).length, 3);
    assert.equal((await purchaseRow(db, theirs.purchaseId)).status, "pending");
    assert.equal((await ticketsOf(db, theirs.customerId)).length, 0);

    assert.equal((await deliver(db, "checkout.session.expired", checkoutSession(theirs, { payment_status: "unpaid" }))).handled, "released");
    assert.equal((await purchaseRow(db, theirs.purchaseId)).status, "expired");
    assert.equal((await purchaseRow(db, mine.purchaseId)).status, "paid", "my paid purchase is not released by their session");
    assert.equal((await ticketsOf(db, mine.customerId)).length, 3);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("purchaseOfSession: metadata first, then the session id; a different client_reference_id is a mismatch", async ({ db, pro }) => {
  const a = await pendingShop(db, pro);
  const b = await pendingShop(db, pro);

  assert.deepEqual(await purchaseOfSession(db, checkoutSession(a)), { kind: "found", purchaseId: a.purchaseId });
  assert.deepEqual(
    await purchaseOfSession(db, checkoutSession(a, { metadata: { app: SESSION_APP, env: TEST.env }, client_reference_id: null })),
    { kind: "found", purchaseId: a.purchaseId },
    "by the attached session id",
  );
  assert.deepEqual(
    await purchaseOfSession(db, checkoutSession(a, { metadata: { purchaseId: "../x", app: SESSION_APP, env: TEST.env } })),
    { kind: "found", purchaseId: a.purchaseId },
    "an odd-looking metadata id names nothing, so the session id decides",
  );
  assert.deepEqual(
    await purchaseOfSession(db, checkoutSession(a, { id: `cs_test_${nanoid()}` })),
    { kind: "found", purchaseId: a.purchaseId },
    "the metadata wins over an unknown session id",
  );
  assert.deepEqual(await purchaseOfSession(db, checkoutSession(a, { client_reference_id: b.purchaseId })), { kind: "mismatch" });
  assert.deepEqual(await purchaseOfSession(db, checkoutSession(a, { client_reference_id: "" })), { kind: "found", purchaseId: a.purchaseId });
  assert.deepEqual(
    await purchaseOfSession(db, checkoutSession({ purchaseId: nanoid(), sessionId: `cs_test_${nanoid()}`, amountCents: 1 })),
    { kind: "none" },
  );
});

dbTest("S31 the log lines of ignored events carry no session id, payment intent or address", async ({ db, pro }) => {
  const p = await pendingBuyBook(db, pro);
  const quiet = (lines: string[]) =>
    assert.ok(lines.every((l) => !/@|cs_(test|live)_|pi_(test|live)_/.test(l)), JSON.stringify(lines));

  const livemode = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p), TEST, true));
  assert.deepEqual(livemode.result, IGNORED);
  assert.deepEqual(livemode.lines, ["[stripe] checkout.session.completed ignored: livemode mismatch"]);

  const otherEnv = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p, {}, "preview")));
  assert.deepEqual(otherEnv.lines, ["[stripe] checkout.session.completed ignored: other environment"]);

  const reference = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p, { client_reference_id: nanoid() })));
  assert.deepEqual(reference.lines, ["[stripe] checkout.session.completed ignored: reference mismatch"]);

  const free = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p, { payment_status: "no_payment_required" })));
  assert.deepEqual(free.lines, ["[stripe] no_payment_required ignored"]);

  const notTheirs = await captureConsole(() =>
    deliver(db, "checkout.session.expired", checkoutSession(p, { id: `cs_test_${nanoid()}`, payment_status: "unpaid" })),
  );
  assert.deepEqual(notTheirs.lines, ["[stripe] checkout.session.expired ignored: not the purchase's session"]);

  const foreign = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p, { metadata: null })));
  assert.deepEqual(foreign.lines, [], "a foreign session is silent");

  for (const lines of [livemode.lines, otherEnv.lines, reference.lines, free.lines, notTheirs.lines, foreign.lines]) quiet(lines);

  // The two lines of an amount mismatch: the engine's orphan warning (the one place the Stripe ids stay, L1116) and ours, without any.
  const wrong = await captureConsole(() => deliver(db, "checkout.session.completed", checkoutSession(p, { amount_total: p.amountCents + 1 })));
  assert.deepEqual(wrong.result, { handled: "orphan", effects: [] });
  assert.equal(wrong.lines.length, 2);
  assert.ok(wrong.lines[0].startsWith("[stripe] orphan payment "), wrong.lines[0]);
  assert.equal(wrong.lines[1], "[stripe] amount mismatch on a purchase");
});
