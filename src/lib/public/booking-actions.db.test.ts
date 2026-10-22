import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { and, eq, like, or } from "drizzle-orm";

import {
  booking as bookingTable,
  customer as customerTable,
  occurrence as occurrenceTable,
  question,
  throttle,
  ticketMovement,
  ticketPurchase,
} from "@/lib/db/schema";
import {
  activeBookingIdOf,
  bookWithHeldTicketCore,
  buyAndBookInputSchema,
  freeRegistrationInputSchema,
  heldTicketInputSchema,
  holdCeiling,
  honeypotFilled,
  identityInputSchema,
  identityOf,
  registerFreeCore,
  seatPressureOf,
  startBuyAndBookCore,
  throttleSubjectOf,
} from "@/lib/public/booking-actions";
import type { ActionVisitor } from "@/lib/public/context";
import { COPY } from "@/lib/public/messages";
import { withoutPublicEffects } from "@/lib/public/result";
import { checkActionThrottle } from "@/lib/throttle";
import { normalizeEmail } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type Db, type DbHarness } from "@/test/db";
import { getBooking, getOccurrence, giveTickets, makeEvent, makeOffer, makeType, ticketsOf } from "@/test/fixtures";
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
  opts: { visitor?: ActionVisitor; fake?: FakeCheckout; mockAllowed?: boolean; now?: Date; db?: Db } = {},
) {
  const pro = await publicProOf(h.db, h.pro);
  const visitor = opts.visitor ?? actionVisitorOf();
  const fake = opts.fake ?? fakeCheckout("test");
  const now = opts.now ?? new Date();
  const deps = publicDepsOf(fake, { mockAllowed: opts.mockAllowed ?? false });
  const res = await startBuyAndBookCore(opts.db ?? h.db, pro, visitor, input, deps, now);
  return { res, fake, visitor, now };
}

/**
 * The test database with one kind of read that throws: the `db.select(fields)` whose field names, joined by commas,
 * are `fields` (the Checkout product name is `title`; the first read of releasePurchase is `id,occurrenceId`),
 * while `armed()` is true; `times` limits how many throws (default: every one).
 */
function dbFailingSelect(db: Db, fields: string, message: string, armed: () => boolean = () => true, times = Infinity): Db {
  let thrown = 0;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "select") {
        return (selected?: Record<string, unknown>) => {
          if (selected !== undefined && Object.keys(selected).join() === fields && thrown < times && armed()) {
            thrown += 1;
            throw new Error(message);
          }
          return Reflect.apply(target.select, target, [selected]);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

/** What the thrown attach UPDATE looks like to the caller (the driver error wraps the unique violation). */
const ATTACH_FAILURE = /Failed query: update "ticket_purchase" set "checkout_session_id"/;

/** Makes the attach UPDATE of THIS purchase THROW: the session id the gateway is about to hand out is already attached to another purchase (ticket_purchase_checkout_session_uq). */
function attachWillThrow(h: DbHarness, s: Setup, fake: FakeCheckout): void {
  fake.onCreate = async (req) => {
    const otherCustomer = await rowCustomer(h.db, h.pro, {});
    const other = await rowPurchase(h.db, h.pro, {
      customerId: otherCustomer,
      offerId: s.offerId,
      ticketTypeId: s.typeId,
    });
    await h.db
      .update(ticketPurchase)
      .set({ checkoutSessionId: `cs_test_fake_${req.purchaseId}` })
      .where(eq(ticketPurchase.id, other));
  };
}

dbTest("a throw after the session was created (the attach step) closes the session, frees the seat and rethrows", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const email = testEmail("attachthrow");
  const fake = fakeCheckout("test");
  attachWillThrow(h, s, fake);

  await assert.rejects(
    run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake }),
    ATTACH_FAILURE,
  );

  assert.equal(fake.created.length, 1);
  const purchaseId = fake.created[0].purchaseId;
  assert.deepEqual(fake.expired, [`cs_test_fake_${purchaseId}`], "the open session is closed, once");
  const mine = (await purchasesOf(h)).find((p) => p.id === purchaseId);
  assert.equal(mine?.status, "expired");
  assert.equal(mine?.checkoutSessionId, null);
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
  assert.deepEqual(lines, [], "nothing to log when the clean-up itself succeeds");
});

dbTest("a throw before any session exists (the product-name read) releases the held seat and rethrows", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  const email = testEmail("titlethrow");

  await assert.rejects(
    run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), {
      fake,
      db: dbFailingSelect(h.db, "title", "neon: connection reset"),
    }),
    /connection reset/,
  );

  assert.equal(fake.created.length, 0, "Stripe was never asked for a session");
  assert.deepEqual(fake.expired, []);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("a release that throws after a failed Checkout create is tried again before the original failure surfaces", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const email = testEmail("releasethrow");
  const fake = fakeCheckout("test");
  let stripeAnswered = false;
  fake.create = async (req) => {
    fake.created.push(req);
    stripeAnswered = true;
    throw new Error("fake checkout: create failed");
  };
  // The first read of the release made right after the gateway failure throws once (a dropped connection).
  const db = dbFailingSelect(h.db, "id,occurrenceId", "neon: connection reset", () => stripeAnswered, 1);

  await assert.rejects(run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake, db }), /connection reset/);

  assert.deepEqual(fake.expired, []);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");
  const [held] = await bookingsOf(h, s.occ.id);
  assert.equal(held.status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
  assert.equal(lines.length, 1, "only the create failure is logged: the second release worked");
  assert.ok(lines[0].startsWith("[public] checkout create failed: "), lines[0]);
});

dbTest("the clean-up after a throw is best effort: a failing expire never keeps the seat, and its log carries no address", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const email = testEmail("cleanup");
  const fake = fakeCheckout("test");
  attachWillThrow(h, s, fake);
  fake.expire = async () => {
    throw new Error(`stripe down for ${email}`);
  };

  await assert.rejects(
    run(h, buyInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake }),
    ATTACH_FAILURE,
    "the caller sees the ORIGINAL failure, not the clean-up's",
  );

  const purchaseId = fake.created[0].purchaseId;
  const mine = (await purchasesOf(h)).find((p) => p.id === purchaseId);
  assert.equal(mine?.status, "expired");
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

/* ───────────────────────── Task 10: free registration and held ticket ───────────────────────── */

test("the free and held-ticket schemas are strict too", () => {
  const free = {
    occurrenceId: "o1",
    seenStartsAt: "2026-10-25T08:00:00.000Z",
    identity: { name: "Beatriz Almeida", email: "beatriz@example.com" },
    answers: [],
  };
  assert.equal(parseFr(freeRegistrationInputSchema, free).ok, true);
  assert.equal(parseFr(freeRegistrationInputSchema, { ...free, offerId: "f1" }).ok, false, "no offer in a free registration");
  assert.equal(parseFr(freeRegistrationInputSchema, { ...free, customerId: "c1" }).ok, false);

  const held = { occurrenceId: "o1", seenStartsAt: "2026-10-25T08:00:00.000Z", answers: [] };
  assert.equal(parseFr(heldTicketInputSchema, held).ok, true);
  for (const extra of [{ identity: free.identity }, { customerId: "c1" }, { userId: "u1" }, { website: "" }]) {
    const res = parseFr(heldTicketInputSchema, { ...held, ...extra });
    assert.equal(res.ok, false, JSON.stringify(extra));
    if (!res.ok) assert.equal(res.error, "Champ inattendu.", JSON.stringify(extra));
  }
});

test("registerFreeCore reads the existing booking and the seats of a typed address together (one round trip, Decision 64 residual)", () => {
  const source = readFileSync("src/lib/public/booking-actions.ts", "utf8");
  const start = source.indexOf("export async function registerFreeCore");
  assert.notEqual(start, -1, "registerFreeCore is declared");
  const end = source.indexOf("\n/**", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  // A fresh address pays only the engine call; the registered one must not also pay two reads in sequence.
  assert.match(
    body,
    /Promise\.all\(\[\s*activeBookingIdOf\([^)]*\),\s*seatsLeftOf\([^)]*\),?\s*\]\)/,
    "the two reads run through Promise.all",
  );
  assert.equal(body.match(/await activeBookingIdOf\(|await seatsLeftOf\(/g), null, "neither read is awaited on its own");
});

/** A free-mode séance (« Roda libre ») in 3 days; `occurrenceCount` > 1 makes a daily series. */
async function setupFree(h: DbHarness, over: { capacity?: number; occurrenceCount?: number } = {}) {
  const { eventId, occurrences } = await makeEvent(h.db, h.pro, {
    title: "Roda libre",
    bookingMode: "free",
    capacity: over.capacity ?? 12,
    rule:
      over.occurrenceCount === undefined
        ? undefined
        : { freq: "daily", interval: 1, endMode: "count", occurrenceCount: over.occurrenceCount },
  });
  return { eventId, occurrences, occ: occurrences[0] };
}

/** The raw input of a free registration or a held-ticket call for `occ`. */
function claimInput(occ: { id: string; startsAt: Date }, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { occurrenceId: occ.id, seenStartsAt: occ.startsAt.toISOString(), answers: [], ...over };
}

function freeInput(occ: { id: string; startsAt: Date }, over: Record<string, unknown> = {}): Record<string, unknown> {
  return claimInput(occ, { identity: { name: "Beatriz Almeida", email: testEmail("free") }, ...over });
}

async function runFree(h: DbHarness, input: unknown, opts: { visitor?: ActionVisitor; now?: Date } = {}) {
  const pro = await publicProOf(h.db, h.pro);
  const visitor = opts.visitor ?? actionVisitorOf();
  const now = opts.now ?? new Date();
  const res = await registerFreeCore(h.db, pro, visitor, input, now);
  return { res, visitor, now };
}

async function runHeld(h: DbHarness, input: unknown, opts: { visitor?: ActionVisitor; now?: Date } = {}) {
  const pro = await publicProOf(h.db, h.pro);
  const visitor = opts.visitor ?? actionVisitorOf();
  const now = opts.now ?? new Date();
  const res = await bookWithHeldTicketCore(h.db, pro, visitor, input, now);
  return { res, visitor, now };
}

dbTest("free registration confirms the booking and plans the confirmation, the pro's notice and the sync", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("free");
  const { res } = await runFree(h, freeInput(s.occ, { identity: { name: " Beatriz Almeida ", email, phone: "" } }));
  const browser = withoutPublicEffects(res);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(browser, { ok: true });

  const [b] = await bookingsOf(h, s.occ.id);
  assert.equal(b.status, "confirmed");
  assert.equal(b.coverage, "free");
  assert.equal(b.createdBy, "client");
  assert.equal(b.purchaseId, null);
  assert.deepEqual(res.effects, [
    { type: "email.booking_confirmed", bookingId: b.id },
    { type: "email.pro_new_booking", bookingId: b.id },
    { type: "google.sync_occurrence", occurrenceId: s.occ.id },
  ]);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);

  const row = await customerOf(h, email);
  assert.equal(row?.id, b.customerId);
  assert.equal(row?.name, "Beatriz Almeida");
  assert.equal(row?.phone, null);
  assert.equal(row?.userId, null);
});

dbTest("free registration on a tickets-mode séance answers the unavailable sentence", async (h) => {
  const s = await setup(h);
  const { res } = await runFree(h, freeInput(s.occ));
  assert.ok(!res.ok);
  assert.equal(res.error, "Cette séance n'est plus ouverte aux réservations.");
  assert.equal(res.code, "unavailable");
  assert.deepEqual(res.effects, []);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
});

dbTest("a full séance answers the French « Complet » sentence", async (h) => {
  const s = await setupFree(h, { capacity: 1 });
  const first = await runFree(h, freeInput(s.occ));
  assert.ok(first.res.ok, JSON.stringify(first.res));

  const second = await runFree(h, freeInput(s.occ));
  assert.ok(!second.res.ok);
  assert.equal(second.res.error, "Complet : il ne reste plus de place sur cette séance.");
  assert.equal(second.res.code, "full");
  assert.deepEqual(second.res.effects, []);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 1);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
});

dbTest("free: a third registration on one séance from one IP is throttled even with three addresses (S33, SEC-I1)", async (h) => {
  const s = await setupFree(h);
  const visitor = actionVisitorOf();
  const emails = [testEmail("a"), testEmail("b"), testEmail("c")];
  const results: Awaited<ReturnType<typeof runFree>>[] = [];
  for (const email of emails) {
    results.push(await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email } }), { visitor }));
  }
  assert.ok(results[0].res.ok, JSON.stringify(results[0].res));
  assert.ok(results[1].res.ok, JSON.stringify(results[1].res));
  const third = results[2].res;
  assert.ok(!third.ok);
  assert.equal(third.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(third.code, "throttled");
  assert.equal(await customerOf(h, emails[2]), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 2);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 2);
});

dbTest("free: the 7th request of one address at this pro is throttled before any write (S19)", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("limit");
  const now = new Date();
  for (let hit = 1; hit <= 6; hit++) {
    const allowed = await checkActionThrottle(
      h.db,
      {
        action: "free",
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

  const { res } = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email } }), { now });
  assert.ok(!res.ok);
  assert.equal(res.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(res.code, "throttled");
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
});

dbTest("free: the 7th registration at this pro from one IP is throttled, whatever the séance (S33, SEC-I1)", async (h) => {
  // Seven séances of one series: six earlier registrations from this IP, each on ANOTHER séance and with another
  // address (so neither the per-séance IP key nor an e-mail key is over), then the 7th on the first séance.
  const s = await setupFree(h, { occurrenceCount: 7 });
  const visitor = actionVisitorOf();
  const now = new Date();
  for (let hit = 1; hit <= 6; hit++) {
    const allowed = await checkActionThrottle(
      h.db,
      {
        action: "free",
        professionalId: h.pro.proId,
        ipHash: visitor.ipHash,
        wideIpHash: null,
        subject: { kind: "email", email: testEmail("earlier") },
        occurrenceId: s.occurrences[hit].id,
      },
      now,
    );
    assert.equal(allowed, true, `hit ${hit}`);
  }

  const email = testEmail("seventh");
  const { res } = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email } }), {
    visitor,
    now,
  });
  assert.ok(!res.ok);
  assert.equal(res.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(res.code, "throttled");
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
});

dbTest("free: a filled honeypot is refused before any customer or throttle row is written (S20)", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("bot");
  const visitor = actionVisitorOf();
  for (const website of ["http://spam.test", "x", ["x"], 0, null]) {
    const { res } = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email }, website }), {
      visitor,
    });
    assert.ok(!res.ok, JSON.stringify(website));
    assert.equal(res.error, COPY.HONEYPOT_REFUSED);
    assert.equal(res.code, undefined);
    assert.deepEqual(res.effects, []);
  }
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);
});

dbTest("free: a typed address already registered gets the success answer and its own confirmation again (S34, Decision 64)", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("again");
  const identity = { name: "Beatriz Almeida", email };

  const first = await runFree(h, freeInput(s.occ, { identity }));
  const firstBrowser = withoutPublicEffects(first.res);
  assert.ok(first.res.ok, JSON.stringify(first.res));
  const [created] = await bookingsOf(h, s.occ.id);

  const second = await runFree(h, freeInput(s.occ, { identity }));
  const secondBrowser = withoutPublicEffects(second.res);
  assert.ok(second.res.ok, JSON.stringify(second.res));
  assert.deepEqual(secondBrowser, firstBrowser, "the browser cannot tell a repeat from a fresh registration");
  assert.deepEqual(second.res.effects, [{ type: "email.booking_confirmed", bookingId: created.id }]);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 1);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
});

dbTest("free: on a full séance a registered address and a fresh one get the same « Complet » answer (S34, Decision 64)", async (h) => {
  const s = await setupFree(h, { capacity: 1 });
  const registered = testEmail("registered");
  const first = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email: registered } }));
  assert.ok(first.res.ok, JSON.stringify(first.res));
  const [created] = await bookingsOf(h, s.occ.id);

  const again = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email: registered } }));
  const fresh = await runFree(h, freeInput(s.occ, { identity: { name: "Camille Durand", email: testEmail("fresh") } }));
  assert.ok(!fresh.res.ok, JSON.stringify(fresh.res));
  assert.equal(fresh.res.error, "Complet : il ne reste plus de place sur cette séance.");
  assert.equal(fresh.res.code, "full");
  assert.ok(!again.res.ok, "the registered address must not learn it is registered: the séance is full for everyone");
  assert.deepEqual(
    withoutPublicEffects(again.res),
    withoutPublicEffects(fresh.res),
    "the browser cannot tell a registered address from a fresh one on a full séance",
  );

  // Only the inbox owner can tell: the confirmation of her EXISTING booking goes to her address again.
  assert.deepEqual(fresh.res.effects, []);
  assert.deepEqual(again.res.effects, [{ type: "email.booking_confirmed", bookingId: created.id }]);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 1);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
});

dbTest("free: a stale hold the engine would release does not make a registered address look full (S34, Decision 64)", async (h) => {
  // Capacity 2: the registered address holds one seat, a stale hold of another customer still counts in seats_taken
  // until the next engine action releases it. A fresh address would get that seat back (R(o) before SEAT), so the
  // registered one must be answered as a success too: counting the stale hold would make her « Complet » alone.
  const s = await setupFree(h, { capacity: 2 });
  const typeId = await makeType(h.db, h.pro, { name: "Altinha" });
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 4, priceCents: 8500 });
  const now = new Date();
  const registered = testEmail("registered");
  const first = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email: registered } }), { now });
  assert.ok(first.res.ok, JSON.stringify(first.res));
  const [created] = await bookingsOf(h, s.occ.id);

  const holder = await rowCustomer(h.db, h.pro, {}, now);
  const purchaseId = await rowPurchase(h.db, h.pro, { customerId: holder, offerId, ticketTypeId: typeId }, now);
  await rowBooking(
    h.db,
    h.pro,
    {
      occurrenceId: s.occ.id,
      customerId: holder,
      status: "pending",
      coverage: "ticket",
      purchaseId,
      holdExpiresAt: addMinutes(now, -5),
    },
    now,
  );
  await h.db.update(occurrenceTable).set({ seatsTaken: 2 }).where(eq(occurrenceTable.id, s.occ.id));

  const again = await runFree(h, freeInput(s.occ, { identity: { name: "Beatriz Almeida", email: registered } }), { now });
  assert.ok(again.res.ok, JSON.stringify(again.res));
  assert.deepEqual(again.res.effects, [{ type: "email.booking_confirmed", bookingId: created.id }]);

  const fresh = await runFree(h, freeInput(s.occ, { identity: { name: "Camille Durand", email: testEmail("fresh") } }), { now });
  assert.ok(fresh.res.ok, JSON.stringify(fresh.res));
  assert.deepEqual(withoutPublicEffects(again.res), withoutPublicEffects(fresh.res));
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 2, "the stale hold went, the fresh address took its seat");
});

dbTest("free: a verified identity already registered keeps the engine sentence, it is her own state", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("verified");
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  try {
    const visitor = actionVisitorOf({
      session: sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true }),
    });
    const identity = { name: "Beatriz Almeida", email };

    const first = await runFree(h, freeInput(s.occ, { identity }), { visitor });
    assert.ok(first.res.ok, JSON.stringify(first.res));
    assert.equal((await customerOf(h, email))?.userId, userId);

    const second = await runFree(h, freeInput(s.occ, { identity }), { visitor });
    assert.ok(!second.res.ok);
    assert.equal(second.res.error, "Vous êtes déjà inscrit(e).");
    assert.equal(second.res.code, "already_booked");
    assert.deepEqual(second.res.effects, []);
    assert.equal((await bookingsOf(h, s.occ.id)).length, 1);
  } finally {
    await deleteTestUser(h.db, userId);
  }
});

dbTest("free: a séance of another pro is not found and nothing is booked (S6)", async (h) => {
  const other = await createTestPro(h.db);
  try {
    const otherHarness: DbHarness = { db: h.db, pro: other };
    const foreign = await setupFree(otherHarness);
    const email = testEmail("tenant");

    const { res } = await runFree(h, freeInput(foreign.occ, { identity: { name: "Beatriz Almeida", email } }));
    assert.ok(!res.ok);
    assert.equal(res.error, "Cette séance n'existe plus : rafraîchissez la page.");
    assert.equal(res.code, "not_found");
    assert.deepEqual(res.effects, []);
    assert.equal((await bookingsOf(h, foreign.occ.id)).length, 0);
    assert.equal((await getOccurrence(h.db, foreign.occ.id)).seatsTaken, 0);
    assert.equal(await customerOf(otherHarness, email), undefined, "the typed address never reaches the other pro");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("free: a malformed input is refused whole, before anything is read or written (S43, SEC-M15)", async (h) => {
  const s = await setupFree(h);
  const email = testEmail("bad");
  const good = freeInput(s.occ, { identity: { name: "Beatriz Almeida", email } });
  const visitor = actionVisitorOf();

  const cases: { label: string; input: unknown; error: string }[] = [
    { label: "an extra key", input: { ...good, userId: "u1" }, error: "Champ inattendu." },
    { label: "an offer id (a buy + book field)", input: { ...good, offerId: "f1" }, error: "Champ inattendu." },
    { label: "identity null", input: { ...good, identity: null }, error: "Valeur invalide." },
    { label: "a wrong type", input: { ...good, occurrenceId: 42 }, error: "Ce champ est obligatoire." },
    { label: "answers that are not a list", input: { ...good, answers: {} }, error: "Valeur invalide." },
    { label: "null", input: null, error: "Valeur invalide." },
  ];
  for (const c of cases) {
    const { res } = await runFree(h, c.input, { visitor });
    assert.ok(!res.ok, c.label);
    assert.equal(res.error, c.error, c.label);
    assert.equal(res.code, undefined, c.label);
    assert.deepEqual(res.effects, [], c.label);
  }
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);
});

dbTest("held: only an Owner spends tickets, never a typed address, a guest cookie, an unverified or an impersonated session (S1, S2)", async (h) => {
  const s = await setup(h);
  const email = testEmail("holder");
  const holder = await ownerVisitor(h, email);
  try {
    const [ticketId] = await giveTickets(h.db, h.pro, holder.customerId, s.typeId, 1);
    const user = { userId: holder.userId, email, name: "Beatriz Almeida" };
    const refusals: [string, ActionVisitor][] = [
      ["an anonymous visitor", actionVisitorOf()],
      ["a guest cookie alone", actionVisitorOf({ guestCustomerId: holder.customerId })],
      [
        "an impersonated session of the holder",
        actionVisitorOf({ session: sessionOf(user, { verified: true, impersonated: true }) }),
      ],
      [
        "an unverified session of the holder's address",
        actionVisitorOf({ session: sessionOf(user, { verified: false }) }),
      ],
    ];
    for (const [label, visitor] of refusals) {
      const { res } = await runHeld(h, claimInput(s.occ), { visitor });
      assert.ok(!res.ok, label);
      assert.equal(res.error, COPY.CONFIRM_EMAIL_TO_SPEND, label);
      assert.equal(res.code, undefined, label);
      assert.deepEqual(res.effects, [], label);
      assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), [], `${label}: refused before the throttle`);
    }

    // A typed address has no way in: the held-ticket input carries no identity field at all.
    const typed = await runHeld(h, claimInput(s.occ, { identity: { name: "Mallory", email } }));
    assert.ok(!typed.res.ok);
    assert.equal(typed.res.error, "Champ inattendu.");

    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
    const tickets = await ticketsOf(h.db, holder.customerId);
    assert.deepEqual(
      tickets.map((t) => [t.id, t.status]),
      [[ticketId, "available"]],
    );
  } finally {
    await deleteTestUser(h.db, holder.userId);
  }
});

dbTest("held: an Owner of another pro, or a customer of another pro, spends nothing on this page (S6)", async (h) => {
  const s = await setup(h);
  const other = await createTestPro(h.db);
  const email = testEmail("holder");
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  try {
    const otherHarness: DbHarness = { db: h.db, pro: other };
    const foreign = await setup(otherHarness);
    const otherCustomer = await rowCustomer(h.db, other, { email, userId });
    await giveTickets(h.db, other, otherCustomer, foreign.typeId, 1);
    const session = sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true });

    // 1. an Owner of the OTHER pro asks on this pro's page
    const elsewhere = actionVisitorOf({
      session,
      owner: { professionalId: other.proId, customerId: otherCustomer, userId, email },
    });
    const refused = await runHeld(h, claimInput(s.occ), { visitor: elsewhere });
    assert.ok(!refused.res.ok);
    assert.equal(refused.res.error, COPY.CONFIRM_EMAIL_TO_SPEND);

    // 2. an owner naming this pro but carrying the other pro's customer (the wrapper never builds one): the engine refuses it
    const forged = actionVisitorOf({
      session,
      owner: { professionalId: h.pro.proId, customerId: otherCustomer, userId, email },
    });
    const forgedRes = await runHeld(h, claimInput(s.occ), { visitor: forged });
    assert.ok(!forgedRes.res.ok);
    assert.equal(forgedRes.res.error, "Cette séance n'existe plus : rafraîchissez la page.");
    assert.equal(forgedRes.res.code, "not_found");

    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    assert.deepEqual(
      (await ticketsOf(h.db, otherCustomer)).map((t) => t.status),
      ["available"],
    );
  } finally {
    await deleteTestUser(h.db, other.userId);
    await deleteTestUser(h.db, userId);
  }
});

dbTest("held: an Owner cannot spend on a séance of another pro (S6)", async (h) => {
  const s = await setup(h);
  const other = await createTestPro(h.db);
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const foreign = await setup({ db: h.db, pro: other });
    const [ticketId] = await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);

    const { res } = await runHeld(h, claimInput(foreign.occ), { visitor: o.visitor });
    assert.ok(!res.ok);
    assert.equal(res.error, "Cette séance n'existe plus : rafraîchissez la page.");
    assert.equal(res.code, "not_found");
    assert.deepEqual(res.effects, []);
    assert.equal((await bookingsOf(h, foreign.occ.id)).length, 0);
    assert.equal((await getOccurrence(h.db, foreign.occ.id)).seatsTaken, 0);
    const tickets = await ticketsOf(h.db, o.customerId);
    assert.deepEqual(
      tickets.map((t) => [t.id, t.status]),
      [[ticketId, "available"]],
    );
  } finally {
    await deleteTestUser(h.db, other.userId);
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held: an Owner spends her ticket, the booking is confirmed and the movement records her user", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const [ticketId] = await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);

    const { res } = await runHeld(h, claimInput(s.occ), { visitor: o.visitor });
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepEqual(res.effects, [
      { type: "email.booking_confirmed", bookingId: res.bookingId },
      { type: "email.pro_new_booking", bookingId: res.bookingId },
      { type: "google.sync_occurrence", occurrenceId: s.occ.id },
    ]);

    const b = await getBooking(h.db, res.bookingId);
    assert.equal(b.status, "confirmed");
    assert.equal(b.coverage, "ticket");
    assert.equal(b.createdBy, "client");
    assert.equal(b.customerId, o.customerId);
    assert.equal(b.occurrenceId, s.occ.id);

    const [spent] = await ticketsOf(h.db, o.customerId);
    assert.equal(spent.id, ticketId);
    assert.equal(spent.status, "booked");
    assert.equal(spent.bookingId, res.bookingId);
    const [movement] = await h.db
      .select()
      .from(ticketMovement)
      .where(and(eq(ticketMovement.ticketId, ticketId), eq(ticketMovement.kind, "spend")));
    assert.equal(movement.actor, "client");
    assert.equal(movement.actorUserId, o.userId);
    assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held: an Owner without a usable ticket gets the engine sentence and no booking", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const { res } = await runHeld(h, claimInput(s.occ), { visitor: o.visitor });
    assert.ok(!res.ok);
    assert.equal(res.error, "Aucun ticket utilisable pour cette séance.");
    assert.equal(res.code, "no_ticket");
    assert.deepEqual(res.effects, []);
    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held: after 10 hits on her user key the Owner is throttled and nothing changes (S19, SEC-I2)", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const [ticketId] = await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);
    const now = new Date();
    for (let hit = 1; hit <= 10; hit++) {
      const allowed = await checkActionThrottle(
        h.db,
        {
          action: "held",
          professionalId: h.pro.proId,
          ipHash: testIpHash(),
          wideIpHash: null,
          subject: { kind: "user", userId: o.userId },
        },
        now,
      );
      assert.equal(allowed, true, `hit ${hit}`);
    }

    const { res } = await runHeld(h, claimInput(s.occ), { visitor: o.visitor, now });
    assert.ok(!res.ok);
    assert.equal(res.error, "Trop de demandes. Réessayez dans un moment.");
    assert.equal(res.code, "throttled");
    assert.deepEqual(res.effects, []);
    const [key] = await h.db.select().from(throttle).where(eq(throttle.key, `t:held:u:${o.userId}`));
    assert.equal(key.hits, 11, "the held limit is keyed on the user, not on the address");
    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    const tickets = await ticketsOf(h.db, o.customerId);
    assert.deepEqual(
      tickets.map((t) => [t.id, t.status]),
      [[ticketId, "available"]],
    );
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held: a malformed input is refused whole, before the Owner check and the throttle (S43, SEC-M15)", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("owner"));
  try {
    const [ticketId] = await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);
    const good = claimInput(s.occ);
    const cases: { label: string; input: unknown; error: string }[] = [
      { label: "an extra key", input: { ...good, userId: "u1" }, error: "Champ inattendu." },
      { label: "a customer id", input: { ...good, customerId: o.customerId }, error: "Champ inattendu." },
      { label: "an identity", input: { ...good, identity: { name: "A", email: "a@example.com" } }, error: "Champ inattendu." },
      { label: "a wrong type", input: { ...good, occurrenceId: 42 }, error: "Ce champ est obligatoire." },
      { label: "a start that is not a date", input: { ...good, seenStartsAt: "demain" }, error: "Date et heure invalides." },
      { label: "a honeypot field (this schema has none)", input: { ...good, website: ["x"] }, error: "Champ inattendu." },
      { label: "null", input: null, error: "Valeur invalide." },
    ];
    for (const c of cases) {
      const { res } = await runHeld(h, c.input, { visitor: o.visitor });
      assert.ok(!res.ok, c.label);
      assert.equal(res.error, c.error, c.label);
      assert.equal(res.code, undefined, c.label);
      assert.deepEqual(res.effects, [], c.label);
    }
    const rows = await h.db.select().from(throttle).where(eq(throttle.key, `t:held:u:${o.userId}`));
    assert.deepEqual(rows, [], "a malformed call consumes no throttle");
    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
    const tickets = await ticketsOf(h.db, o.customerId);
    assert.deepEqual(
      tickets.map((t) => [t.id, t.status]),
      [[ticketId, "available"]],
    );
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

/** Like ownerVisitor, but her customer row is NOT linked to the account yet (user_id null): the state in which the first spend links it. */
async function unlinkedOwnerVisitor(h: DbHarness, email: string) {
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  const customerId = await rowCustomer(h.db, h.pro, { email });
  const owner = { professionalId: h.pro.proId, customerId, userId, email };
  const visitor = actionVisitorOf({
    session: sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true }),
    owner,
  });
  return { userId, customerId, owner, visitor };
}

/** customer.user_id of one row. */
async function linkedUserOf(h: DbHarness, customerId: string): Promise<string | null> {
  const [row] = await h.db
    .select({ userId: customerTable.userId })
    .from(customerTable)
    .where(eq(customerTable.id, customerId));
  return row.userId;
}

dbTest("held link: a malformed input, or a visitor who is not an Owner, links no account (Revision 3.2)", async (h) => {
  const s = await setup(h);
  const o = await unlinkedOwnerVisitor(h, testEmail("owner"));
  try {
    await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);
    assert.equal(await linkedUserOf(h, o.customerId), null, "the row starts unlinked");
    const good = claimInput(s.occ);
    for (const input of [{ ...good, userId: "u1" }, { ...good, occurrenceId: 42 }, { ...good, seenStartsAt: "demain" }, null]) {
      const { res } = await runHeld(h, input, { visitor: o.visitor });
      assert.ok(!res.ok, JSON.stringify(input));
    }
    // a guest cookie alone is no Owner: the row it reaches is not linked either
    const cookie = await runHeld(h, good, { visitor: actionVisitorOf({ guestCustomerId: o.customerId }) });
    assert.ok(!cookie.res.ok);
    assert.equal(cookie.res.error, COPY.CONFIRM_EMAIL_TO_SPEND);

    assert.equal(await linkedUserOf(h, o.customerId), null, "nothing was linked");
    assert.deepEqual(await h.db.select().from(throttle).where(eq(throttle.key, `t:held:u:${o.userId}`)), [], "and nothing was consumed");
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held link: a throttled call links no account (Revision 3.2)", async (h) => {
  const s = await setup(h);
  const o = await unlinkedOwnerVisitor(h, testEmail("owner"));
  try {
    await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);
    const now = new Date();
    for (let hit = 1; hit <= 10; hit++) {
      const allowed = await checkActionThrottle(
        h.db,
        {
          action: "held",
          professionalId: h.pro.proId,
          ipHash: testIpHash(),
          wideIpHash: null,
          subject: { kind: "user", userId: o.userId },
        },
        now,
      );
      assert.equal(allowed, true, `hit ${hit}`);
    }

    const { res } = await runHeld(h, claimInput(s.occ), { visitor: o.visitor, now });
    assert.ok(!res.ok);
    assert.equal(res.code, "throttled");
    assert.equal(await linkedUserOf(h, o.customerId), null, "the throttled call wrote nothing");
    assert.equal((await bookingsOf(h, s.occ.id)).length, 0);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("held link: the first accepted call links the Owner's account to her own row, and only hers (Revision 3.2)", async (h) => {
  const s = await setup(h);
  const o = await unlinkedOwnerVisitor(h, testEmail("owner"));
  const bystander = await rowCustomer(h.db, h.pro, { email: testEmail("bystander") });
  try {
    await giveTickets(h.db, h.pro, o.customerId, s.typeId, 1);
    const { res } = await runHeld(h, claimInput(s.occ), { visitor: o.visitor });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(await linkedUserOf(h, o.customerId), o.userId, "linked by her own spend");
    assert.equal(await linkedUserOf(h, bystander), null, "no other row of the pro is touched");
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("activeBookingIdOf names the customer's confirmed booking on this pro's séance and nothing else", async (h) => {
  const s = await setupFree(h);
  const now = new Date();
  const customerId = await rowCustomer(h.db, h.pro, { email: testEmail("active") }, now);
  assert.equal(await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, customerId, now), null);

  const bookingId = await rowBooking(
    h.db,
    h.pro,
    { occurrenceId: s.occ.id, customerId, status: "confirmed", coverage: "free" },
    now,
  );
  const cancelledCustomer = await rowCustomer(h.db, h.pro, { email: testEmail("cancelled") }, now);
  await rowBooking(
    h.db,
    h.pro,
    { occurrenceId: s.occ.id, customerId: cancelledCustomer, status: "cancelled", coverage: "free" },
    now,
  );
  await h.db.update(occurrenceTable).set({ seatsTaken: 1 }).where(eq(occurrenceTable.id, s.occ.id));

  assert.equal(await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, customerId, now), bookingId);
  assert.equal(await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, cancelledCustomer, now), null, "ended is not active");
  assert.equal(await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, "unknown-customer", now), null);

  const other = await createTestPro(h.db);
  try {
    assert.equal(
      await activeBookingIdOf(h.db, other.proId, s.occ.id, customerId, now),
      null,
      "another pro's scope never names this pro's booking",
    );
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("activeBookingIdOf counts a pending booking only while its hold is live", async (h) => {
  const s = await setup(h);
  const now = new Date();
  /** A pending booking of its own customer (and its pending purchase) whose hold ends at `holdExpiresAt`. */
  async function pendingBooking(label: string, holdExpiresAt: Date) {
    const customerId = await rowCustomer(h.db, h.pro, { email: testEmail(label) }, now);
    const purchaseId = await rowPurchase(h.db, h.pro, { customerId, offerId: s.offerId, ticketTypeId: s.typeId }, now);
    const bookingId = await rowBooking(
      h.db,
      h.pro,
      { occurrenceId: s.occ.id, customerId, status: "pending", coverage: "ticket", purchaseId, holdExpiresAt },
      now,
    );
    return { customerId, bookingId };
  }
  const live = await pendingBooking("live", addMinutes(now, 45));
  const lapsed = await pendingBooking("lapsed", addMinutes(now, -5));
  const ending = await pendingBooking("ending", now);
  await h.db.update(occurrenceTable).set({ seatsTaken: 3 }).where(eq(occurrenceTable.id, s.occ.id));

  assert.equal(await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, live.customerId, now), live.bookingId);
  assert.equal(
    await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, lapsed.customerId, now),
    null,
    "a hold that lapsed is not an active booking: the seat is the next claim's",
  );
  assert.equal(
    await activeBookingIdOf(h.db, h.pro.proId, s.occ.id, ending.customerId, now),
    null,
    "a hold that ends exactly now is over (strictly later than now counts)",
  );
});
