import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { and, eq, like, or } from "drizzle-orm";

import {
  booking as bookingTable,
  customer as customerTable,
  occurrence as occurrenceTable,
  question,
  throttle,
  ticketPurchase,
} from "@/lib/db/schema";
import {
  buyAndBookInputSchema,
  holdCeiling,
  honeypotFilled,
  identityInputSchema,
  identityOf,
  seatPressureOf,
  startBuyAndBookCore,
  throttleSubjectOf,
} from "@/lib/public/booking-actions";
import type { ActionVisitor } from "@/lib/public/context";
import { COPY } from "@/lib/public/messages";
import { checkActionThrottle } from "@/lib/throttle";
import { normalizeEmail } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type DbHarness } from "@/test/db";
import { getOccurrence, makeEvent, makeOffer, makeType } from "@/test/fixtures";
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
import { rowBooking, rowCustomer, rowPurchase } from "@/test/rows";

/* ───────────────────────── pure helpers (no database) ───────────────────────── */

test("holdCeiling: a third of the capacity, three at least", () => {
  assert.equal(holdCeiling(1), 3);
  assert.equal(holdCeiling(6), 3);
  assert.equal(holdCeiling(9), 3);
  assert.equal(holdCeiling(10), 4);
  assert.equal(holdCeiling(12), 4);
  assert.equal(holdCeiling(13), 5);
  assert.equal(holdCeiling(500), 167);
});

test("honeypotFilled: anything but undefined or the empty string", () => {
  assert.equal(honeypotFilled(undefined), false);
  assert.equal(honeypotFilled(""), false);
  for (const filled of [" ", "x", "http://spam.test", ["x"], [], 0, null, false, {}]) {
    assert.equal(honeypotFilled(filled), true, JSON.stringify(filled));
  }
});

test("identityOf: an Owner's session address replaces the typed one, an empty phone is null", () => {
  const typed = { name: "Beatriz Almeida", email: "typed@example.com", phone: "" };
  assert.deepEqual(identityOf(typed, { owner: null }), {
    name: "Beatriz Almeida",
    email: "typed@example.com",
    phone: null,
  });
  assert.equal(identityOf({ name: "B", email: "x@example.com" }, { owner: null }).phone, null);

  const owner = { professionalId: "p1", customerId: "c1", userId: "u1", email: "Beatriz@Example.com" };
  assert.deepEqual(identityOf({ ...typed, phone: "0612345678" }, { owner }), {
    name: "Beatriz Almeida",
    email: "beatriz@example.com",
    phone: "0612345678",
  });
});

test("throttleSubjectOf: a verified identity is keyed on its user, everything else on the typed address", () => {
  const user = { userId: "u1", email: "beatriz@example.com", name: "Beatriz" };
  assert.deepEqual(throttleSubjectOf(sessionOf(user, { verified: true }), "beatriz@example.com"), {
    kind: "user",
    userId: "u1",
  });
  assert.deepEqual(throttleSubjectOf(sessionOf(user, { verified: true }), " Beatriz@Example.com "), {
    kind: "user",
    userId: "u1",
  });
  const typed = { kind: "email", email: "beatriz@example.com" };
  assert.deepEqual(throttleSubjectOf(sessionOf(user, { verified: false }), "beatriz@example.com"), typed);
  assert.deepEqual(
    throttleSubjectOf(sessionOf(user, { verified: true, impersonated: true }), "beatriz@example.com"),
    typed,
  );
  assert.deepEqual(throttleSubjectOf(sessionOf(user, { verified: true }), "other@example.com"), {
    kind: "email",
    email: "other@example.com",
  });
  assert.deepEqual(throttleSubjectOf(null, "beatriz@example.com"), typed);
});

test("the strict schemas normalise the identity and refuse any extra key", () => {
  const valid = {
    occurrenceId: "o1",
    offerId: "f1",
    seenStartsAt: "2026-10-25T08:00:00.000Z",
    identity: { name: " Beatriz Almeida ", email: " Beatriz@Example.com ", phone: " 0612345678 " },
    answers: [],
  };
  const parsed = parseFr(buyAndBookInputSchema, valid);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.data.identity, {
      name: "Beatriz Almeida",
      email: "beatriz@example.com",
      phone: "0612345678",
    });
    assert.equal(parsed.data.website, undefined);
  }

  for (const [label, input] of [
    ["an extra key", { ...valid, userId: "u1" }],
    ["a smuggled customer id", { ...valid, customerId: "c1" }],
    ["an extra key in the identity", { ...valid, identity: { ...valid.identity, userId: "u1" } }],
  ] as const) {
    const res = parseFr(buyAndBookInputSchema, input);
    assert.equal(res.ok, false, label);
    if (!res.ok) assert.equal(res.error, "Champ inattendu.", label);
  }
  assert.equal(identityInputSchema.safeParse({ name: "A", email: "a@example.com", role: "admin" }).success, false);
});

/* ───────────────────────── DB cases: startBuyAndBookCore ───────────────────────── */

const EVENT_TITLE = "Altinha débutants";

/** A tickets-mode séance in 3 days (10:00, Paris), one linked type, one « Carnet de 4 » offer at 85 €. `occurrenceCount` > 1 makes a daily series. */
async function setup(h: DbHarness, over: { capacity?: number; occurrenceCount?: number } = {}) {
  const typeId = await makeType(h.db, h.pro, { name: "Altinha" });
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 4, priceCents: 8500 });
  const { eventId, occurrences } = await makeEvent(h.db, h.pro, {
    title: EVENT_TITLE,
    ticketTypeIds: [typeId],
    capacity: over.capacity ?? 12,
    rule:
      over.occurrenceCount === undefined
        ? undefined
        : { freq: "daily", interval: 1, endMode: "count", occurrenceCount: over.occurrenceCount },
  });
  return { typeId, offerId, eventId, occurrences, occ: occurrences[0] };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** The raw input of a buy + book call, as the browser sends it (the wrapper splits the slug off). */
function buyInput(
  s: Setup,
  over: Record<string, unknown> = {},
  occ: { id: string; startsAt: Date } = s.occ,
): Record<string, unknown> {
  return {
    occurrenceId: occ.id,
    offerId: s.offerId,
    seenStartsAt: occ.startsAt.toISOString(),
    identity: { name: "Beatriz Almeida", email: testEmail("buy") },
    answers: [],
    ...over,
  };
}

/** One call of the core: the real pro row, a visitor (default anonymous), a fake gateway and ONE `now`. */
async function run(
  h: DbHarness,
  input: unknown,
  opts: { visitor?: ActionVisitor; fake?: FakeCheckout; mockAllowed?: boolean; now?: Date } = {},
) {
  const pro = await publicProOf(h.db, h.pro);
  const visitor = opts.visitor ?? actionVisitorOf();
  const fake = opts.fake ?? fakeCheckout("test");
  const now = opts.now ?? new Date();
  const deps = publicDepsOf(fake, { mockAllowed: opts.mockAllowed ?? false });
  const res = await startBuyAndBookCore(h.db, pro, visitor, input, deps, now);
  return { res, fake, visitor, now };
}

const purchasesOf = (h: DbHarness) =>
  h.db.select().from(ticketPurchase).where(eq(ticketPurchase.professionalId, h.pro.proId));

const bookingsOf = (h: DbHarness, occurrenceId: string) =>
  h.db.select().from(bookingTable).where(eq(bookingTable.occurrenceId, occurrenceId));

async function customerOf(h: DbHarness, email: string) {
  const [row] = await h.db
    .select()
    .from(customerTable)
    .where(and(eq(customerTable.professionalId, h.pro.proId), eq(customerTable.email, normalizeEmail(email))));
  return row;
}

const digestOf = (email: string): string =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);

/** Every throttle row a call with this IP hash or this address would have written. */
function throttleRowsOf(h: DbHarness, ipHash: string, email: string) {
  return h.db
    .select()
    .from(throttle)
    .where(or(like(throttle.key, `%${ipHash}%`), like(throttle.key, `%${digestOf(email)}%`)));
}

/** A verified client user, its customer row at h.pro (linked) and the Owner visitor built from them. Delete the user with deleteTestUser. */
async function ownerVisitor(h: DbHarness, email: string) {
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  const customerId = await rowCustomer(h.db, h.pro, { email, userId });
  const owner = { professionalId: h.pro.proId, customerId, userId, email };
  const visitor = actionVisitorOf({
    session: sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true }),
    owner,
  });
  return { userId, customerId, owner, visitor };
}

/** `live` live holds and `elapsed` elapsed ones made of raw rows (a pending purchase and its pending booking per customer), seats_taken kept in step (I1). */
async function addRowHolds(h: DbHarness, s: Setup, live: number, now: Date, elapsed = 0): Promise<void> {
  for (let i = 0; i < live + elapsed; i++) {
    const customerId = await rowCustomer(h.db, h.pro, {}, now);
    const purchaseId = await rowPurchase(
      h.db,
      h.pro,
      { customerId, offerId: s.offerId, ticketTypeId: s.typeId },
      now,
    );
    await rowBooking(
      h.db,
      h.pro,
      {
        occurrenceId: s.occ.id,
        customerId,
        status: "pending",
        coverage: "ticket",
        purchaseId,
        holdExpiresAt: i < live ? addMinutes(now, 45) : addMinutes(now, -5),
      },
      now,
    );
  }
  await h.db.update(occurrenceTable).set({ seatsTaken: live + elapsed }).where(eq(occurrenceTable.id, s.occ.id));
}

dbTest("E1 holds a seat and answers with the Checkout URL of the session the gateway created", async (h) => {
  const s = await setup(h);
  const email = testEmail("buy");
  const now = new Date();
  const input = buyInput(s, {
    identity: { name: " Beatriz Almeida ", email: ` ${email.toUpperCase()} `, phone: "06 12 34 56 78" },
  });
  const { res, fake } = await run(h, input, { now });
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.checkoutUrl, `https://checkout.test/${res.purchaseId}`);

  const [purchase] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, res.purchaseId));
  assert.equal(purchase.status, "pending");
  assert.equal(purchase.checkoutSessionId, `cs_test_fake_${res.purchaseId}`);
  assert.equal(purchase.checkoutUrl, res.checkoutUrl);
  assert.equal(purchase.offerId, s.offerId);
  assert.equal(purchase.amountCents, 8500);
  assert.equal(purchase.quantity, 4);

  const bookings = await bookingsOf(h, s.occ.id);
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].status, "pending");
  assert.equal(bookings[0].purchaseId, res.purchaseId);
  assert.equal(bookings[0].customerId, purchase.customerId);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);

  const row = await customerOf(h, email);
  assert.equal(row?.id, purchase.customerId);
  assert.equal(row?.email, email);
  assert.equal(row?.name, "Beatriz Almeida");
  assert.equal(row?.phone, "06 12 34 56 78");
  assert.equal(row?.userId, null);

  assert.equal(fake.created.length, 1);
  const req = fake.created[0];
  assert.equal(req.kind, "buybook");
  assert.equal(req.purchaseId, res.purchaseId);
  assert.equal(req.amountCents, 8500);
  assert.equal(req.currency, "eur");
  assert.equal(req.productName, `${EVENT_TITLE} · Carnet de 4`);
  assert.equal(req.customerEmail, email);
  assert.equal(req.env, "test");
  assert.ok(req.expiresAt.getTime() >= now.getTime() + 30 * 60_000, "Stripe needs 30 minutes at least");
  assert.equal(req.successUrl, `https://app.test/${h.pro.slug}/merci?p=${res.purchaseId}`);
  assert.equal(
    req.cancelUrl,
    `https://app.test/${h.pro.slug}/seance/${s.occ.id}?paiement=annule&p=${res.purchaseId}`,
  );
  assert.deepEqual(fake.expired, []);
});

dbTest("a gateway failure releases the seat at once and answers CHECKOUT_FAILED", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const fake = fakeCheckout("test");
  fake.failCreate = true;
  const email = testEmail("fail");

  const { res } = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, COPY.CHECKOUT_FAILED);
  assert.equal(res.code, undefined);
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: s.occ.id }]);

  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");
  assert.equal(purchase.checkoutSessionId, null);
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
  assert.deepEqual(fake.expired, []);

  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("[public] checkout create failed: "), lines[0]);
  assert.equal(lines[0].includes("@"), false);
  assert.equal(lines[0].includes(email), false);
});

dbTest("a refused attachment expires the session, frees the seat and says the offer changed", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  fake.onCreate = async (req) => {
    await h.db.update(ticketPurchase).set({ status: "expired" }).where(eq(ticketPurchase.id, req.purchaseId));
  };

  const { res } = await run(h, buyInput(s), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, "L'offre a changé : rafraîchissez la page.");
  assert.equal(res.code, "stale");
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: s.occ.id }]);

  const purchaseId = fake.created[0].purchaseId;
  assert.deepEqual(fake.expired, [`cs_test_fake_${purchaseId}`]);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.checkoutSessionId, null);
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("a gateway that throws while expiring the session still lets the seat go, and logs no address", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const email = testEmail("expire");
  const fake = fakeCheckout("test");
  fake.onCreate = async (req) => {
    await h.db.update(ticketPurchase).set({ status: "expired" }).where(eq(ticketPurchase.id, req.purchaseId));
  };
  fake.expire = async () => {
    throw new Error(`stripe down for ${email}`);
  };

  const { res } = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake });
  assert.ok(!res.ok);
  assert.equal(res.code, "stale");
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
  assert.deepEqual(lines, ["[public] checkout expire failed: stripe down for [email]"]);
});

dbTest("a filled honeypot is refused before any customer or throttle row is written (S20)", async (h) => {
  const s = await setup(h);
  const email = testEmail("bot");
  const visitor = actionVisitorOf();
  for (const website of ["http://spam.test", "x", " ", ["x"], 0, null, {}]) {
    const { res, fake } = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email }, website }), {
      visitor,
    });
    assert.ok(!res.ok, JSON.stringify(website));
    assert.equal(res.error, COPY.HONEYPOT_REFUSED);
    assert.equal(res.code, undefined);
    assert.deepEqual(res.effects, []);
    assert.equal(fake.created.length, 0);
  }
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  // A real browser sends an empty field: that call goes through.
  const real = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email }, website: "" }), { visitor });
  assert.ok(real.res.ok, JSON.stringify(real.res));
});

dbTest("the 7th request of one address at this pro is throttled before any write (S19)", async (h) => {
  const s = await setup(h);
  const email = testEmail("limit");
  const now = new Date();
  for (let hit = 1; hit <= 6; hit++) {
    const allowed = await checkActionThrottle(
      h.db,
      {
        action: "buybook",
        professionalId: h.pro.proId,
        ipHash: testIpHash(),
        wideIpHash: null,
        subject: { kind: "email", email },
        occurrenceId: s.occ.id,
      },
      now,
    );
    assert.equal(allowed, true, `hit ${hit}`);
  }

  const { res, fake } = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { now });
  assert.ok(!res.ok);
  assert.equal(res.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(res.code, "throttled");
  assert.deepEqual(res.effects, []);
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal(fake.created.length, 0);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("a third request on one séance from one IP is throttled even with three addresses (S33, SEC-I1)", async (h) => {
  const s = await setup(h);
  const visitor = actionVisitorOf();
  const emails = [testEmail("a"), testEmail("b"), testEmail("c")];
  const results: Awaited<ReturnType<typeof run>>[] = [];
  for (const email of emails) {
    results.push(await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { visitor }));
  }
  assert.ok(results[0].res.ok, JSON.stringify(results[0].res));
  assert.ok(results[1].res.ok, JSON.stringify(results[1].res));
  const third = results[2].res;
  assert.ok(!third.ok);
  assert.equal(third.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(third.code, "throttled");
  assert.equal(await customerOf(h, emails[2]), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 2);
  assert.equal((await purchasesOf(h)).length, 2);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 2);
});

dbTest("a typed address cannot take a seat on a séance at its hold ceiling; an Owner still can (S33, SEC-I6)", async (h) => {
  const s = await setup(h, { capacity: 6 });
  const now = new Date();
  assert.equal(holdCeiling(6), 3);
  await addRowHolds(h, s, 3, now);

  const email = testEmail("ceiling");
  const typed = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { now });
  assert.ok(!typed.res.ok);
  assert.equal(typed.res.error, COPY.TOO_MANY_PAYMENTS);
  assert.equal(typed.res.code, undefined);
  assert.deepEqual(typed.res.effects, []);
  assert.equal(await customerOf(h, email), undefined);
  assert.equal(typed.fake.created.length, 0);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 3);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 3);

  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const owned = await run(h, buyInput(s), { visitor: o.visitor, now });
    assert.ok(owned.res.ok, JSON.stringify(owned.res));
    assert.equal((await bookingsOf(h, s.occ.id)).length, 4);
    assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 4);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("a mock gateway outside its allowance answers PAYMENT_UNAVAILABLE and writes nothing", async (h) => {
  const s = await setup(h);
  const email = testEmail("mock");
  const visitor = actionVisitorOf();
  const input = buyInput(s, { identity: { name: "Beatriz Almeida", email } });

  const blocked = await run(h, input, { fake: fakeCheckout("mock"), mockAllowed: false, visitor });
  assert.ok(!blocked.res.ok);
  assert.equal(blocked.res.error, COPY.PAYMENT_UNAVAILABLE);
  assert.equal(blocked.res.code, undefined);
  assert.deepEqual(blocked.res.effects, []);
  assert.equal(blocked.fake.created.length, 0);
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);

  // The same call is the same call once the mock is allowed: the gate is the only difference.
  const allowed = await run(h, input, { fake: fakeCheckout("mock"), mockAllowed: true, visitor });
  assert.ok(allowed.res.ok, JSON.stringify(allowed.res));
});

dbTest("a typed address never links someone else's account (OUT:69)", async (h) => {
  const s = await setup(h);
  const victimEmail = testEmail("victim");
  const otherEmail = testEmail("other");
  const strangerEmail = testEmail("stranger");
  const victim = await createTestClientUser(h.db, { email: victimEmail, name: "Victime", verified: true });
  const other = await createTestClientUser(h.db, { email: otherEmail, name: "Autre", verified: true });
  try {
    // 1. nobody is signed in and the visitor types the victim's address
    const anonymous = await run(h, buyInput(s, { identity: { name: "Mallory", email: victimEmail } }));
    assert.ok(anonymous.res.ok, JSON.stringify(anonymous.res));
    assert.equal((await customerOf(h, victimEmail))?.userId, null);

    // 2. a verified user signed in as ANOTHER address types a third address: no link either
    const signedIn = actionVisitorOf({
      session: sessionOf({ userId: other.userId, email: otherEmail, name: "Autre" }, { verified: true }),
    });
    const typedStranger = await run(h, buyInput(s, { identity: { name: "Mallory", email: strangerEmail } }), {
      visitor: signedIn,
    });
    assert.ok(typedStranger.res.ok, JSON.stringify(typedStranger.res));
    assert.equal((await customerOf(h, strangerEmail))?.userId, null);

    // 3. the same user typing their own address is linked (the contrast)
    const own = await run(h, buyInput(s, { identity: { name: "Autre", email: otherEmail } }), { visitor: signedIn });
    assert.ok(own.res.ok, JSON.stringify(own.res));
    assert.equal((await customerOf(h, otherEmail))?.userId, other.userId);
  } finally {
    await deleteTestUser(h.db, victim.userId);
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("an Owner typing another address buys as herself: the session address wins", async (h) => {
  const s = await setup(h);
  const ownerEmail = testEmail("owner");
  const typedEmail = testEmail("typed");
  const o = await ownerVisitor(h, ownerEmail);
  try {
    const { res, fake } = await run(h, buyInput(s, { identity: { name: "Autre Nom", email: typedEmail } }), {
      visitor: o.visitor,
    });
    assert.ok(res.ok, JSON.stringify(res));
    const [purchase] = await purchasesOf(h);
    assert.equal(purchase.customerId, o.customerId);
    assert.equal(await customerOf(h, typedEmail), undefined);
    assert.equal(fake.created[0].customerEmail, ownerEmail);
    const [held] = await bookingsOf(h, s.occ.id);
    assert.equal(held.customerId, o.customerId);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("an occurrence or an offer of another pro is not found and nothing is booked or sold (S6)", async (h) => {
  const s = await setup(h);
  const other = await createTestPro(h.db);
  try {
    const otherHarness: DbHarness = { db: h.db, pro: other };
    const foreign = await setup(otherHarness);
    const email = testEmail("tenant");
    const identity = { name: "Beatriz Almeida", email };
    const notFound = "Cette séance ou cette offre n'existe plus : rafraîchissez la page.";

    const cases: [string, Record<string, unknown>][] = [
      ["a foreign occurrence with this pro's offer", buyInput(s, { identity }, foreign.occ)],
      ["this pro's occurrence with a foreign offer", buyInput(s, { identity, offerId: foreign.offerId })],
      ["a foreign occurrence and a foreign offer", buyInput(foreign, { identity }, foreign.occ)],
    ];
    for (const [label, input] of cases) {
      const { res, fake } = await run(h, input);
      assert.ok(!res.ok, label);
      assert.equal(res.error, notFound, label);
      assert.equal(res.code, "not_found", label);
      assert.deepEqual(res.effects, [], label);
      assert.equal(fake.created.length, 0, label);
    }

    assert.equal((await purchasesOf(h)).length, 0);
    assert.equal((await purchasesOf(otherHarness)).length, 0);
    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    assert.equal((await bookingsOf(h, foreign.occ.id)).length, 0);
    assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
    assert.equal((await getOccurrence(h.db, foreign.occ.id)).seatsTaken, 0);
    assert.equal(await customerOf(otherHarness, email), undefined, "the typed address never reaches the other pro");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("a typed address already booked on the séance gets the neutral refusal: no code, no URL, no second purchase (S24, S34)", async (h) => {
  const s = await setup(h);
  const email = testEmail("twice");
  const identity = { name: "Beatriz Almeida", email };

  const first = await run(h, buyInput(s, { identity }));
  assert.ok(first.res.ok, JSON.stringify(first.res));

  const second = await run(h, buyInput(s, { identity }));
  assert.ok(!second.res.ok);
  assert.equal(second.res.error, COPY.BUYBOOK_NOT_POSSIBLE);
  assert.equal("code" in second.res, false, "no code key: nothing about another customer's state (Decision 64)");
  assert.equal("checkoutUrl" in second.res, false);
  assert.equal("purchaseId" in second.res, false);
  assert.deepEqual(second.res.effects, []);
  assert.equal(second.fake.created.length, 0);
  assert.equal((await purchasesOf(h)).length, 1);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 1);
});

dbTest("a typed address holding two live holds gets the same neutral refusal (S34)", async (h) => {
  const s = await setup(h, { occurrenceCount: 3 });
  const email = testEmail("holds");
  const identity = { name: "Beatriz Almeida", email };
  const visitor = actionVisitorOf();

  for (const occ of s.occurrences.slice(0, 2)) {
    const held = await run(h, buyInput(s, { identity }, occ), { visitor });
    assert.ok(held.res.ok, JSON.stringify(held.res));
  }
  const third = await run(h, buyInput(s, { identity }, s.occurrences[2]), { visitor });
  assert.ok(!third.res.ok);
  assert.equal(third.res.error, COPY.BUYBOOK_NOT_POSSIBLE);
  assert.equal("code" in third.res, false, "no code key: nothing about another customer's state (Decision 64)");
  assert.equal("checkoutUrl" in third.res, false);
  assert.equal("purchaseId" in third.res, false);
  assert.equal((await purchasesOf(h)).length, 2);
  assert.equal(third.fake.created.length, 0);
});

dbTest("an Owner keeps the engine sentences of her own state", async (h) => {
  const s = await setup(h, { occurrenceCount: 3 });
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const [first, second, third] = s.occurrences;
    const held = await run(h, buyInput(s, {}, first), { visitor: o.visitor });
    assert.ok(held.res.ok, JSON.stringify(held.res));

    const again = await run(h, buyInput(s, {}, first), { visitor: o.visitor });
    assert.ok(!again.res.ok);
    assert.equal(again.res.error, "Vous êtes déjà inscrit(e).");
    assert.equal(again.res.code, "already_booked");

    const secondHold = await run(h, buyInput(s, {}, second), { visitor: o.visitor });
    assert.ok(secondHold.res.ok, JSON.stringify(secondHold.res));

    const tooMany = await run(h, buyInput(s, {}, third), { visitor: o.visitor });
    assert.ok(!tooMany.res.ok);
    assert.equal(tooMany.res.error, "Vous avez déjà deux paiements en cours. Terminez-les ou libérez une place.");
    assert.equal(tooMany.res.code, "too_many_holds");
    assert.equal((await purchasesOf(h)).length, 2);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("a required answer is enforced with the engine's French message, and accepted once given", async (h) => {
  const s = await setup(h);
  await h.db.insert(question).values({
    professionalId: h.pro.proId,
    eventId: s.eventId,
    label: "Votre niveau ?",
    type: "text",
    required: true,
    position: 0,
  });
  const [q] = await h.db.select().from(question).where(eq(question.eventId, s.eventId));
  const email = testEmail("answers");
  const identity = { name: "Beatriz Almeida", email };

  const missing = await run(h, buyInput(s, { identity }));
  assert.ok(!missing.res.ok);
  assert.equal(missing.res.error, "Merci de répondre à : Votre niveau ?");
  assert.equal(missing.res.code, "invalid");
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  const answered = await run(h, buyInput(s, { identity, answers: [{ questionId: q.id, value: "Débutant" }] }));
  assert.ok(answered.res.ok, JSON.stringify(answered.res));
});

dbTest("field errors are keyed under identity. and the name refuses links and digit runs (S44)", async (h) => {
  const s = await setup(h);

  // parseFr (src/lib/zod-fr.ts at HEAD): `error` carries the field label prefix, `fieldErrors` the bare issue
  // text that IdentityFields shows under the Email field (contract § 7 quotes the prefixed text for both; the code
  // of parseFr wins for what exists).
  const badEmail = await run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email: "x" } }));
  assert.ok(!badEmail.res.ok);
  assert.equal(badEmail.res.error, "Email : adresse email invalide.");
  assert.deepEqual(badEmail.res.fieldErrors, { "identity.email": "Adresse email invalide." });

  for (const name of ["www.arnaque.fr", "https://x.fr", "Appelez le 0612345678", "Appelez le 06 12 34 56 78", "bit.ly/x"]) {
    const { res } = await run(h, buyInput(s, { identity: { name, email: testEmail("name") } }));
    assert.ok(!res.ok, name);
    assert.equal(res.error, COPY.PLAIN_NAME, name);
    assert.deepEqual(res.fieldErrors, { "identity.name": COPY.PLAIN_NAME }, name);
  }
  assert.equal((await purchasesOf(h)).length, 0);
});

dbTest("a seenStartsAt that is not the séance's start answers « changed » and holds nothing", async (h) => {
  const s = await setup(h);
  const stale = addMinutes(s.occ.startsAt, -60).toISOString();
  const { res } = await run(h, buyInput(s, { seenStartsAt: stale }));
  assert.ok(!res.ok);
  assert.equal(res.error, "La séance a changé, rafraîchissez la page.");
  assert.equal(res.code, "changed");
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("a malformed input is refused whole, before anything is read or written (S43, SEC-M15)", async (h) => {
  const s = await setup(h);
  const email = testEmail("bad");
  const identity = { name: "Beatriz Almeida", email };
  const good = buyInput(s, { identity });
  const visitor = actionVisitorOf();

  const cases: { label: string; input: unknown; error: string }[] = [
    { label: "an extra key", input: { ...good, userId: "u1" }, error: "Champ inattendu." },
    { label: "a smuggled customer id", input: { ...good, customerId: "c1" }, error: "Champ inattendu." },
    { label: "a smuggled professional id", input: { ...good, professionalId: "p1" }, error: "Champ inattendu." },
    {
      label: "an extra key in the identity",
      input: { ...good, identity: { ...identity, role: "admin" } },
      error: "Champ inattendu.",
    },
    { label: "a wrong type", input: { ...good, occurrenceId: 42 }, error: "Ce champ est obligatoire." },
    { label: "a missing offer", input: { ...good, offerId: undefined }, error: "Ce champ est obligatoire." },
    { label: "identity null", input: { ...good, identity: null }, error: "Valeur invalide." },
    { label: "answers that are not a list", input: { ...good, answers: "x" }, error: "Valeur invalide." },
    {
      label: "a start that is not a date",
      input: { ...good, seenStartsAt: "demain" },
      error: "Date et heure invalides.",
    },
    { label: "a string", input: "x", error: "Valeur invalide." },
    { label: "null", input: null, error: "Valeur invalide." },
    { label: "a list", input: [], error: "Valeur invalide." },
  ];
  for (const c of cases) {
    const { res, fake } = await run(h, c.input, { visitor });
    assert.ok(!res.ok, c.label);
    assert.equal(res.error, c.error, c.label);
    assert.equal(res.code, undefined, c.label);
    assert.deepEqual(res.effects, [], c.label);
    assert.equal(fake.created.length, 0, c.label);
  }

  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("seatPressureOf counts the live holds of this pro's séance only", async (h) => {
  const s = await setup(h, { capacity: 6 });
  const now = new Date();
  assert.deepEqual(await seatPressureOf(h.db, h.pro.proId, s.occ.id, now), { liveHolds: 0, capacity: 6 });

  await addRowHolds(h, s, 2, now, 1);
  assert.deepEqual(
    await seatPressureOf(h.db, h.pro.proId, s.occ.id, now),
    { liveHolds: 2, capacity: 6 },
    "the elapsed hold does not count",
  );

  const other = await createTestPro(h.db);
  try {
    const foreign = await setup({ db: h.db, pro: other });
    assert.equal(await seatPressureOf(h.db, h.pro.proId, foreign.occ.id, now), null);
    assert.equal(await seatPressureOf(h.db, other.proId, s.occ.id, now), null);
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
  assert.equal(await seatPressureOf(h.db, h.pro.proId, "unknown-occurrence", now), null);
});
