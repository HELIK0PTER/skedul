import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { attachCheckoutSession, startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { releasePurchase } from "@/lib/booking/release";
import { textArray, type Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { mockSessionId } from "@/lib/payments/checkout";
import type { ActionVisitor } from "@/lib/public/context";
import { COPY } from "@/lib/public/messages";
import { abandonCheckoutCore, abandonInputSchema } from "@/lib/public/release-actions";
import { withoutPublicEffects } from "@/lib/public/result";
import { actionThrottleKeys, hitThrottle } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, THROTTLE_WINDOW_SEC } from "@/lib/tickets";
import { createTestPro, dbTest, deleteTestUser, testEmail, type TestPro } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import {
  actionVisitorOf,
  createTestClientUser,
  fakeCheckout,
  publicDepsOf,
  publicProOf,
  sessionOf,
  testIpHash,
  type FakeCheckout,
} from "@/test/public";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowSeance, rowType } from "@/test/rows";

type Held = {
  purchaseId: string;
  bookingId: string;
  occurrenceId: string;
  customerId: string;
  email: string;
  /** the session id attached to the purchase, null when none */
  sessionId: string | null;
};

/** A buy + book hold the way startBuyAndBookCore leaves it (pending purchase and booking, one seat taken); `session` picks what is attached. */
async function heldSeat(db: Db, pro: TestPro, session: "stripe" | "mock" | "none" = "stripe"): Promise<Held> {
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
  const email = testEmail("abandon");
  const customerId = await makeCustomer(db, pro, { email });
  const started = await startBuyAndBook(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    offerId,
  });
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId =
    session === "none" ? null : session === "mock" ? mockSessionId(started.purchaseId) : `cs_test_${nanoid()}`;
  if (sessionId !== null) {
    const attached = await attachCheckoutSession(db, {
      purchaseId: started.purchaseId,
      checkoutSessionId: sessionId,
      checkoutUrl: `https://checkout.test/${started.purchaseId}`,
    });
    assert.ok(attached.ok, JSON.stringify(attached));
  }
  return { purchaseId: started.purchaseId, bookingId: started.bookingId, occurrenceId: occ.id, customerId, email, sessionId };
}

/** The core as the wrapper calls it: the PublicPro read from the pro's row, a visitor built from `visitor`, one fresh `now`. */
async function abandon(db: Db, pro: TestPro, visitor: Partial<ActionVisitor>, input: unknown, fake: FakeCheckout) {
  return abandonCheckoutCore(db, await publicProOf(db, pro), actionVisitorOf(visitor), input, publicDepsOf(fake), new Date());
}

type Res = Awaited<ReturnType<typeof abandon>>;

function assertNotFound(res: Res): void {
  assert.ok(!res.ok, "refused");
  assert.equal(res.code, "not_found");
  assert.equal(res.error, "Paiement introuvable : rafraîchissez la page.");
  assert.deepEqual(res.effects, []);
}

async function purchaseStatus(db: Db, purchaseId: string): Promise<string> {
  const [row] = await db
    .select({ status: schema.ticketPurchase.status })
    .from(schema.ticketPurchase)
    .where(eq(schema.ticketPurchase.id, purchaseId));
  return row.status;
}

/** Nothing was released: the booking is still pending, its seat is taken, the purchase is pending. */
async function assertStillHeld(db: Db, held: Held, label: string): Promise<void> {
  assert.equal((await getBooking(db, held.bookingId)).status, "pending", `${label}: booking`);
  assert.equal((await getOccurrence(db, held.occurrenceId)).seatsTaken, 1, `${label}: seat`);
  assert.equal(await purchaseStatus(db, held.purchaseId), "pending", `${label}: purchase`);
}

/**
 * The `release` throttle rows (key and hits) this test can produce: the keys of its pro, its IP hash and the addresses it
 * names, as actionThrottleKeys builds them. A refused call must leave this list exactly as it found it. Scoped on
 * purpose: the `throttle` table is shared with every other test file, so a `release` row of someone else must not decide
 * this test.
 */
async function releaseThrottleRows(
  db: Db,
  scope: { pro: TestPro; ipHash: string; emails: string[] },
): Promise<{ key: string; hits: number }[]> {
  const keys = new Set<string>();
  for (const email of scope.emails) {
    for (const { key } of actionThrottleKeys({
      action: "release",
      professionalId: scope.pro.proId,
      ipHash: scope.ipHash,
      wideIpHash: null,
      subject: { kind: "email", email },
    })) {
      keys.add(key);
    }
  }
  const res = await db.execute<{ key: string; hits: number }>(
    sql`select key, hits from throttle where key = any(${textArray([...keys])}) order by key`,
  );
  return res.rows.map((r) => ({ key: r.key, hits: Number(r.hits) }));
}

/** Uses up the per-pro and the global e-mail keys of `release` for a typed address, the way 30 strangers typing it would. */
async function exhaustEmailKeys(db: Db, pro: TestPro, email: string): Promise<void> {
  const keys = actionThrottleKeys({
    action: "release",
    professionalId: pro.proId,
    ipHash: testIpHash(),
    wideIpHash: null,
    subject: { kind: "email", email },
  }).filter((k) => k.key.includes(":e:"));
  assert.equal(keys.length, 2, "the global and the per-pro e-mail keys");
  for (const { key, limit } of keys) await hitThrottle(db, key, limit, THROTTLE_WINDOW_SEC, new Date());
}

dbTest("E11 abandon: a closed, already closed or simulated session releases the hold, frees the seat and re-syncs Google", async ({ db, pro }) => {
  for (const [closeOutcome, session] of [
    ["expired", "stripe"],
    ["already_expired", "stripe"],
    ["mock", "mock"],
  ] as const) {
    const held = await heldSeat(db, pro, session);
    const fake = fakeCheckout();
    fake.closeOutcome = closeOutcome;

    const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
    assert.ok(res.ok, `${closeOutcome}: ${JSON.stringify(res)}`);
    assert.equal(res.outcome, "released", closeOutcome);
    assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: held.occurrenceId }], closeOutcome);
    assert.deepEqual(fake.closed, [held.sessionId], `${closeOutcome}: the purchase's own session was asked`);
    assert.equal((await getBooking(db, held.bookingId)).status, "expired", closeOutcome);
    assert.equal((await getOccurrence(db, held.occurrenceId)).seatsTaken, 0, `${closeOutcome}: seat freed`);
    assert.equal(await purchaseStatus(db, held.purchaseId), "expired", closeOutcome);
  }
});

dbTest("E11 abandon: Stripe says paid or processing, nothing is released (S8)", async ({ db, pro }) => {
  for (const closeOutcome of ["paid", "processing"] as const) {
    const held = await heldSeat(db, pro);
    const fake = fakeCheckout();
    fake.closeOutcome = closeOutcome;

    const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
    assert.ok(res.ok, closeOutcome);
    assert.equal(res.outcome, closeOutcome);
    assert.deepEqual(res.effects, []);
    assert.deepEqual(fake.closed, [held.sessionId]);
    await assertStillHeld(db, held, closeOutcome);
  }
});

dbTest("E11 abandon: Stripe cannot be reached, nothing is released and the client is told to retry (S8)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const fake = fakeCheckout();
  fake.closeOutcome = "failed";

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(!res.ok);
  assert.equal(res.error, COPY.RELEASE_CHECK_FAILED);
  assert.equal(res.error, "Le paiement n'a pas pu être vérifié. Réessayez dans un instant.");
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.closed, [held.sessionId]);
  await assertStillHeld(db, held, "failed");
});

dbTest("E11 abandon: a paid purchase answers paid without calling the gateway, the booking stays confirmed (S8)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const done = await fulfillPurchase(db, held.purchaseId, {
    sessionId: held.sessionId,
    paymentIntentId: `pi_test_${nanoid()}`,
    livemode: false,
  });
  assert.equal(done.outcome, "fulfilled");
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok);
  assert.equal(res.outcome, "paid");
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.closed, [], "no gateway call for a purchase that is already paid");
  assert.equal((await getBooking(db, held.bookingId)).status, "confirmed");
  assert.equal((await getOccurrence(db, held.occurrenceId)).seatsTaken, 1);
});

dbTest("E11 abandon: an expired purchase answers already_ended without calling the gateway", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const released = await releasePurchase(db, held.purchaseId, new Date());
  assert.ok(released.ok, JSON.stringify(released));
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok);
  assert.equal(res.outcome, "already_ended");
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.closed, []);
});

dbTest("E11 abandon: a pending purchase whose booking is already confirmed answers already_ended, no gateway call (SEC-C1)", async ({ db, pro }) => {
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const customerId = await rowCustomer(db, pro, { email: testEmail("confirmed") });
  const occurrenceId = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 1 });
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId, status: "pending" });
  const bookingId = await rowBooking(db, pro, { occurrenceId, customerId, status: "confirmed", coverage: "guest", purchaseId });
  // A session is attached: without the confirmed-booking guard the core would ask the gateway and end the purchase.
  const attached = await attachCheckoutSession(db, {
    purchaseId,
    checkoutSessionId: `cs_test_${nanoid()}`,
    checkoutUrl: `https://checkout.test/${purchaseId}`,
  });
  assert.ok(attached.ok, JSON.stringify(attached));
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId }, fake);
  assert.ok(res.ok);
  assert.equal(res.outcome, "already_ended");
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.closed, [], "no gateway call for a purchase whose seat is confirmed");
  assert.deepEqual(fake.expired, []);
  assert.equal((await getBooking(db, bookingId)).status, "confirmed", "a confirmed seat is never released by a reference");
  assert.equal((await getOccurrence(db, occurrenceId)).seatsTaken, 1);
  assert.equal(await purchaseStatus(db, purchaseId), "pending", "the purchase itself is left alone");
});

dbTest("E11 abandon: a reference to a shop purchase (no booking, no seat) is not found before any gateway call and ends nothing (G2b)", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const fake = fakeCheckout();
  // The visitor's IP hash and the three addresses of the loop are fixed up front: they are the keys this test can produce.
  const ipHash = testIpHash();
  const emails = [testEmail("shop"), testEmail("shop"), testEmail("shop"), testEmail("shop-paid")];
  const scope = { pro, ipHash, emails };
  const throttleBefore = await releaseThrottleRows(db, scope);

  for (const [i, session] of (["stripe", "mock", "none"] as const).entries()) {
    const customerId = await makeCustomer(db, pro, { email: emails[i] });
    const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
    assert.ok(started.ok, JSON.stringify(started));
    if (session !== "none") {
      const attached = await attachCheckoutSession(db, {
        purchaseId: started.purchaseId,
        checkoutSessionId: session === "mock" ? mockSessionId(started.purchaseId) : `cs_test_${nanoid()}`,
        checkoutUrl: `https://checkout.test/${started.purchaseId}`,
      });
      assert.ok(attached.ok, JSON.stringify(attached));
    }

    assertNotFound(await abandon(db, pro, { ipHash }, { purchaseId: started.purchaseId }, fake));
    assert.equal(await purchaseStatus(db, started.purchaseId), "pending", `${session}: the shop purchase is not ended by a seat release`);
  }
  assert.deepEqual(fake.closed, [], "no closeForRelease for a purchase without a seat");
  assert.deepEqual(fake.expired, [], "no session expired either");

  // A paid shop purchase gets the same answer: the reference stands for a seat to give back, and there is none.
  const customerId = await makeCustomer(db, pro, { email: emails[3] });
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const done = await fulfillPurchase(db, started.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false });
  assert.equal(done.outcome, "fulfilled");
  assertNotFound(await abandon(db, pro, { ipHash }, { purchaseId: started.purchaseId }, fake));
  assert.equal(await purchaseStatus(db, started.purchaseId), "paid");
  assert.deepEqual(fake.closed, []);
  assert.deepEqual(await releaseThrottleRows(db, scope), throttleBefore, "answered like a reference that names nothing: no throttle key consumed");
});

dbTest("E11 abandon: no session id attached means nothing to ask Stripe, the hold is released", async ({ db, pro }) => {
  const held = await heldSeat(db, pro, "none");
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok);
  assert.equal(res.outcome, "released");
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: held.occurrenceId }]);
  assert.deepEqual(fake.closed, []);
  assert.equal((await getBooking(db, held.bookingId)).status, "expired");
  assert.equal((await getOccurrence(db, held.occurrenceId)).seatsTaken, 0);
});

dbTest("E11 abandon: no session id but a payment being processed answers processing and releases nothing", async ({ db, pro }) => {
  const held = await heldSeat(db, pro, "none");
  await db
    .update(schema.ticketPurchase)
    .set({ processingAt: new Date() })
    .where(eq(schema.ticketPurchase.id, held.purchaseId));
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok);
  assert.equal(res.outcome, "processing");
  assert.deepEqual(fake.closed, []);
  await assertStillHeld(db, held, "processing without session");
});

dbTest("E11 abandon: the ok result carries exactly ok and outcome, nothing about the purchase's customer (SEC-C1)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fakeCheckout());
  // What runPublicAction hands to the browser: the core result without its effects.
  const browser = withoutPublicEffects(res);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(Object.keys(browser).sort(), ["ok", "outcome"]);
  assert.equal(JSON.stringify(browser).includes(held.email), false);
  assert.equal(JSON.stringify(browser).includes(held.customerId), false);
});

dbTest("E11 abandon: after 30 hits on the e-mail keys of the purchase's customer the request is refused before any gateway call (S19, SEC-I2)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  await exhaustEmailKeys(db, pro, held.email);
  const fake = fakeCheckout();

  const res = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
  assert.ok(!res.ok);
  assert.equal(res.code, "throttled");
  assert.equal(res.error, ENGINE_ERROR_MESSAGES.throttled);
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.closed, [], "the throttle comes before the Stripe call");
  await assertStillHeld(db, held, "throttled");
});

dbTest("E11 abandon: strangers typing an address cannot lock out its verified holder, who is throttled on the user key only (SEC-I6)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const client = await createTestClientUser(db, { email: held.email, verified: true });
  try {
    await db.update(schema.customer).set({ userId: client.userId }).where(eq(schema.customer.id, held.customerId));
    await exhaustEmailKeys(db, pro, held.email);
    const fake = fakeCheckout();

    const stranger = await abandon(db, pro, {}, { purchaseId: held.purchaseId }, fake);
    assert.ok(!stranger.ok);
    assert.equal(stranger.code, "throttled");

    const holder = {
      session: sessionOf({ userId: client.userId, email: held.email }, { verified: true }),
      owner: { professionalId: pro.proId, customerId: held.customerId, userId: client.userId, email: held.email },
    };
    const res = await abandon(db, pro, holder, { purchaseId: held.purchaseId }, fake);
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(res.outcome, "released");

    // The user key is the holder's own limit: once it is used up the holder is refused too, whatever the e-mail keys say.
    const userKeys = actionThrottleKeys({
      action: "release",
      professionalId: pro.proId,
      ipHash: testIpHash(),
      wideIpHash: null,
      subject: { kind: "user", userId: client.userId },
    }).filter((k) => k.key.includes(":u:"));
    assert.equal(userKeys.length, 1, "the holder has one user key");
    await hitThrottle(db, userKeys[0].key, userKeys[0].limit, THROTTLE_WINDOW_SEC, new Date());
    const refused = await abandon(db, pro, holder, { purchaseId: held.purchaseId }, fake);
    assert.ok(!refused.ok);
    assert.equal(refused.code, "throttled");
  } finally {
    await deleteTestUser(db, client.userId);
  }
});

dbTest("E11 abandon: tenancy, a purchase of another pro is not found under either page and nothing changes (S6, S7)", async ({ db, pro }) => {
  const fake = fakeCheckout();
  const mine = await heldSeat(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await heldSeat(db, other);
    assertNotFound(await abandon(db, pro, {}, { purchaseId: theirs.purchaseId }, fake));
    assertNotFound(await abandon(db, other, {}, { purchaseId: mine.purchaseId }, fake));
    assert.deepEqual(fake.closed, [], "no gateway call for a purchase of another pro");
    await assertStillHeld(db, mine, "mine");
    await assertStillHeld(db, theirs, "theirs");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("E11 abandon: an Owner who is not the purchase's customer gets not found, the purchase's own customer can release it (OUT:74)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const fake = fakeCheckout();
  const someoneElse = await makeCustomer(db, pro);
  const stranger = {
    owner: { professionalId: pro.proId, customerId: someoneElse, userId: "user-someone-else", email: "someone-else@skedul.test" },
  };

  assertNotFound(await abandon(db, pro, stranger, { purchaseId: held.purchaseId }, fake));
  assert.deepEqual(fake.closed, []);
  await assertStillHeld(db, held, "other Owner");

  const owner = {
    owner: { professionalId: pro.proId, customerId: held.customerId, userId: "user-owner", email: held.email },
  };
  const res = await abandon(db, pro, owner, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.outcome, "released");
  assert.deepEqual(fake.closed, [held.sessionId]);
});

dbTest("E11 abandon: an admin impersonating the purchase's own address releases nothing, whatever else the visitor carries (G4b, SEC-M6)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const fake = fakeCheckout();
  const ipHash = testIpHash();
  const scope = { pro, ipHash, emails: [held.email] };
  const throttleBefore = await releaseThrottleRows(db, scope);
  // The session of the address that bought the seat, read while an admin impersonates it: no client identity (resolveVisitor
  // gives it no Owner and no guest cookie). The core refuses it on the session alone, so a visitor built wrongly (an Owner
  // or a cookie of the purchase's own customer) is refused too.
  const session = sessionOf({ userId: "user-impersonated", email: held.email }, { verified: true, impersonated: true });
  const owner = { professionalId: pro.proId, customerId: held.customerId, userId: "user-impersonated", email: held.email };
  for (const [label, visitor] of [
    ["as resolveVisitor builds it", { session, ipHash }],
    ["with the purchase's customer as Owner", { session, owner, ipHash }],
    ["with a planted cookie of the purchase's customer", { session, guestCustomerId: held.customerId, ipHash }],
  ] as const) {
    assertNotFound(await abandon(db, pro, visitor, { purchaseId: held.purchaseId }, fake));
    await assertStillHeld(db, held, label);
  }
  assert.deepEqual(fake.closed, [], "no closeForRelease: the Checkout session stays open");
  assert.deepEqual(fake.expired, [], "no session expired");
  assert.deepEqual(await releaseThrottleRows(db, scope), throttleBefore, "refused before any throttle key");

  // The same reference still works for the visitor it was given to (a signed-out browser holding ?p=).
  const res = await abandon(db, pro, { ipHash }, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.outcome, "released");
});

dbTest("E11 abandon: a malformed input is refused whole, in French, with no gateway call, no write and no throttle key consumed (S43)", async ({ db, pro }) => {
  const held = await heldSeat(db, pro);
  const fake = fakeCheckout();
  // Every call below comes from this IP hash, and the only address a reference can name is the hold's own: these are the
  // keys this test can produce (the pro's, the IP's and the address's).
  const ipHash = testIpHash();
  const scope = { pro, ipHash, emails: [held.email] };
  const throttleBefore = await releaseThrottleRows(db, scope);
  // The `throttle` table is shared with every other test file: a `release` row of someone else appears while this test
  // runs. It is not this test's to compare (only the keys it can produce are).
  await hitThrottle(db, `t:release:ip:${testIpHash()}`, 1, THROTTLE_WINDOW_SEC, new Date());
  const cases: [unknown, string][] = [
    [null, "Valeur invalide."],
    ["x", "Valeur invalide."],
    [[], "Valeur invalide."],
    [{}, "Ce champ est obligatoire."],
    [{ purchaseId: 5 }, "Ce champ est obligatoire."],
    [{ purchaseId: ["a"] }, "Ce champ est obligatoire."],
    [{ purchaseId: "" }, "Ce champ est obligatoire."],
    [{ purchaseId: "a".repeat(65) }, "64 caractères au maximum."],
    [{ purchaseId: held.purchaseId, extra: true }, "Champ inattendu."],
    // This schema has no identity and no honeypot: both keys of the other public forms are unexpected here.
    [{ purchaseId: held.purchaseId, identity: null }, "Champ inattendu."],
    [{ purchaseId: held.purchaseId, website: ["x"] }, "Champ inattendu."],
    [{ purchaseId: held.purchaseId, website: "x" }, "Champ inattendu."],
  ];
  for (const [input, error] of cases) {
    const res = await abandon(db, pro, { ipHash }, input, fake);
    assert.ok(!res.ok, JSON.stringify(input));
    assert.equal(res.error, error, JSON.stringify(input));
    assert.deepEqual(res.effects, []);
  }
  assert.deepEqual(fake.closed, []);
  assert.deepEqual(fake.expired, []);
  await assertStillHeld(db, held, "malformed");
  assert.deepEqual(await releaseThrottleRows(db, scope), throttleBefore, "a refused input consumed no throttle key");

  // The schema itself: strict, one key.
  assert.equal(abandonInputSchema.safeParse({ purchaseId: held.purchaseId }).success, true);
  assert.equal(abandonInputSchema.safeParse({ purchaseId: held.purchaseId, slug: "x" }).success, false);

  // A well-formed id that names nothing is the same not found as a foreign one.
  assertNotFound(await abandon(db, pro, { ipHash }, { purchaseId: nanoid() }, fake));
  assertNotFound(await abandon(db, pro, { ipHash }, { purchaseId: "../x" }, fake));
  assert.deepEqual(await releaseThrottleRows(db, scope), throttleBefore, "nor did a reference that names nothing");

  // Control: a valid call does consume keys, so the comparison above could have failed.
  const res = await abandon(db, pro, { ipHash }, { purchaseId: held.purchaseId }, fake);
  assert.ok(res.ok, JSON.stringify(res));
  assert.notDeepEqual(await releaseThrottleRows(db, scope), throttleBefore);
});
