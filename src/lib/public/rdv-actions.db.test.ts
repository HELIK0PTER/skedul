import assert from "node:assert/strict";
import test from "node:test";

import { and, eq, isNull, like } from "drizzle-orm";

import { setAvailabilityRules } from "@/lib/booking/catalog";
import { addDays, dayOfWeek, instantAt, type DateKey } from "@/lib/civil-date";
import {
  booking as bookingTable,
  customer as customerTable,
  occurrence as occurrenceTable,
  professional as professionalTable,
  throttle,
  ticketPurchase,
} from "@/lib/db/schema";
import { stripeSessionParams } from "@/lib/payments/checkout";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { CLIENT_CONTEXT_MESSAGES, COPY, heldTicketButtonLabel } from "@/lib/public/messages";
import { purchaseByReference } from "@/lib/public/purchase-reads";
import { bookRdvCore, bookRdvInputSchema } from "@/lib/public/rdv-actions";
import { rdvOwnerTickets } from "@/lib/public/rdv-reads";
import { withoutPublicEffects } from "@/lib/public/result";
import { referenceForPage } from "@/lib/public/visibility";
import { checkActionThrottle } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, normalizeEmail } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { addMinutes, createTestPro, dbTest, deleteTestUser, inParallel, testEmail, type Db, type DbHarness } from "@/test/db";
import { dayIn, getBooking, getOccurrence, giveTickets, makeOffer, makeType, ticketsOf } from "@/test/fixtures";
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
import { rowCustomer, rowPurchase } from "@/test/rows";

const SLOT_TAKEN = "Ce créneau vient d'être pris.";
const RDV_GONE = "Ce rendez-vous ou cette offre n'existe plus : rafraîchissez la page.";
const RDV_STALE = "Les horaires ou l'offre ont changé : rafraîchissez la page.";

/* ───────────────────────── before any read (no database) ───────────────────────── */

/** A database that throws on ANY use: what a refusal before the throttle must never touch. */
const UNTOUCHABLE = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`the database was touched (${String(prop)})`);
    },
  },
) as unknown as Db;

const PRO: PublicPro = {
  professionalId: "pro_1",
  slug: "altinha-paris",
  businessName: "Altinha Paris",
  timezone: "Europe/Paris",
  currency: "eur",
  ownerUserId: "u_pro",
  window: { bookingHorizonDays: 60, minNoticeMinutes: 120, cancelDeadlineHours: 24 },
};

const SLOT = { ticketTypeId: "tt_1", startsAt: "2027-01-20T09:00:00.000Z", answers: [] };
const TYPED = { name: "Beatriz Almeida", email: "beatriz@skedul.test" };

/** One call of the core on the untouchable database: it must answer before its first read. */
function early(input: unknown, visitor: ActionVisitor = actionVisitorOf(), deps: PublicDeps = publicDepsOf(fakeCheckout("test"))) {
  return bookRdvCore(UNTOUCHABLE, PRO, visitor, input, deps, new Date("2027-01-13T09:00:00.000Z"));
}

/** No English zod text: every message a client can read here is one of the French sentences of zod-fr or of the copy. */
const ENGLISH = /\b(?:invalid|expected|required|unrecognized|received|string|number|too (?:small|big))\b/i;

test("bookRdvInputSchema: one strict shape per mode, held_ticket without any identity field", () => {
  for (const input of [
    { ...SLOT, mode: "held_ticket" },
    { ...SLOT, mode: "free", identity: TYPED },
    { ...SLOT, mode: "free", identity: TYPED, website: "" },
    { ...SLOT, mode: "buy", offerId: "of_1", identity: TYPED },
    { ...SLOT, mode: "buy", offerId: "of_1", identity: { ...TYPED, phone: "06 12 34 56 78" } },
    { ...SLOT, mode: "held_ticket", startsAt: "2027-01-20T09:00:00Z" },
  ]) {
    assert.equal(parseFr(bookRdvInputSchema, input).ok, true, JSON.stringify(input));
  }
  for (const [label, input] of [
    ["an identity on a held ticket", { ...SLOT, mode: "held_ticket", identity: TYPED }],
    ["an offer on a free booking", { ...SLOT, mode: "free", identity: TYPED, offerId: "of_1" }],
    ["a smuggled customer id", { ...SLOT, mode: "buy", offerId: "of_1", identity: TYPED, customerId: "c1" }],
    ["a smuggled user id", { ...SLOT, mode: "held_ticket", userId: "u1" }],
    ["a slug left in the rest", { ...SLOT, mode: "held_ticket", slug: "altinha-paris" }],
    ["an extra key in the identity", { ...SLOT, mode: "free", identity: { ...TYPED, userId: "u1" } }],
  ] as const) {
    const res = parseFr(bookRdvInputSchema, input);
    assert.ok(!res.ok, label);
    assert.equal(res.error, "Champ inattendu.", label);
  }
});

test("malformed calls are refused before any read, in French (no English zod text), the start with milliseconds as an off-grid start", async () => {
  const cases: [string, unknown][] = [
    ["no input", null],
    ["a string", "rdv"],
    ["no mode", { ...SLOT }],
    ["an unknown mode", { ...SLOT, mode: "guest" }],
    ["a start that is no instant", { ...SLOT, mode: "held_ticket", startsAt: "demain" }],
    ["a start with an offset", { ...SLOT, mode: "held_ticket", startsAt: "2027-01-20T10:00:00+01:00" }],
    ["a start as a number", { ...SLOT, mode: "held_ticket", startsAt: 1_800_000_000_000 }],
    ["a type id that is no nanoid", { ...SLOT, mode: "held_ticket", ticketTypeId: "../x" }],
    ["a type id too long", { ...SLOT, mode: "held_ticket", ticketTypeId: "x".repeat(65) }],
    ["answers that are no list", { ...SLOT, mode: "held_ticket", answers: "oui" }],
    ["an answer without its question", { ...SLOT, mode: "held_ticket", answers: [{ value: "oui" }] }],
    ["an answer of the wrong type", { ...SLOT, mode: "held_ticket", answers: [{ questionId: "q1", value: 3 }] }],
    ["a typed address that is not one", { ...SLOT, mode: "free", identity: { name: "Beatriz", email: "beatriz" } }],
    ["a buy without its offer", { ...SLOT, mode: "buy", identity: TYPED }],
  ];
  for (const [label, input] of cases) {
    const res = await early(input);
    assert.ok(!res.ok, label);
    assert.doesNotMatch(res.error, ENGLISH, `${label}: ${res.error}`);
    for (const message of Object.values(res.fieldErrors ?? {})) assert.doesNotMatch(message, ENGLISH, `${label}: ${message}`);
    assert.deepEqual(res.effects, [], label);
  }
  // A start with milliseconds is no slot of any grid: the off-grid sentence, before any read.
  for (const startsAt of ["2027-01-20T09:00:00.001Z", "2027-01-20T09:00:00.5Z"]) {
    const res = await early({ ...SLOT, mode: "free", identity: TYPED, startsAt });
    assert.ok(!res.ok, startsAt);
    assert.equal(res.error, COPY.RDV_SLOT_GONE, startsAt);
  }
});

test("the honeypot, a simulated payment outside its allowance and a held ticket without an Owner of this pro are refused before any read", async () => {
  for (const website of ["x", " ", "http://spam.test"]) {
    for (const input of [
      { ...SLOT, mode: "free", identity: TYPED, website },
      { ...SLOT, mode: "buy", offerId: "of_1", identity: TYPED, website },
    ]) {
      const res = await early(input);
      assert.ok(!res.ok);
      assert.equal(res.error, COPY.HONEYPOT_REFUSED);
    }
  }

  const mock = publicDepsOf(fakeCheckout("mock"), { mockAllowed: false });
  const unavailable = await early({ ...SLOT, mode: "buy", offerId: "of_1", identity: TYPED }, actionVisitorOf(), mock);
  assert.ok(!unavailable.ok);
  assert.equal(unavailable.error, COPY.PAYMENT_UNAVAILABLE);

  const user = { userId: "u_client", email: "beatriz@skedul.test", name: "Beatriz Almeida" };
  const refusals: [string, ActionVisitor][] = [
    ["an anonymous visitor", actionVisitorOf()],
    ["a guest cookie alone", actionVisitorOf({ guestCustomerId: "c_1" })],
    ["an unverified session", actionVisitorOf({ session: sessionOf(user, { verified: false }) })],
    // The wrapper never builds an Owner for an impersonating admin (resolveVisitor): the session alone spends nothing.
    ["an impersonating admin", actionVisitorOf({ session: sessionOf(user, { verified: true, impersonated: true }) })],
    [
      "an Owner of another pro",
      actionVisitorOf({
        session: sessionOf(user),
        owner: { professionalId: "pro_2", customerId: "c_2", userId: user.userId, email: user.email },
      }),
    ],
  ];
  for (const [label, visitor] of refusals) {
    const res = await early({ ...SLOT, mode: "held_ticket" }, visitor);
    assert.ok(!res.ok, label);
    assert.equal(res.error, COPY.CONFIRM_EMAIL_TO_SPEND, label);
    assert.equal(res.code, undefined, label);
  }
});

/* ───────────────────────── DB cases ───────────────────────── */

/**
 * Global hours 08:00-20:00 every day; a paid RDV type « Massage sportif » (60 min) with its « À l'unité » offer at 60 €
 * and a free type « Bilan » (60 min); `at(minute)` = that minute in 3 days in the pro's zone.
 */
async function setup(h: DbHarness) {
  const hours = await setAvailabilityRules(h.db, {
    professionalId: h.pro.proId,
    ticketTypeId: null,
    rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 480, endMinute: 1200 })),
  });
  assert.ok(hours.ok, JSON.stringify(hours));
  const paidTypeId = await makeType(h.db, h.pro, { name: "Massage sportif", rdvEnabled: true, rdvDurationMin: 60 });
  const offerId = await makeOffer(h.db, h.pro, paidTypeId, { quantity: 1, priceCents: 6000 });
  const freeTypeId = await makeType(h.db, h.pro, { name: "Bilan", rdvEnabled: true, rdvDurationMin: 60, rdvFree: true });
  const day = dayIn(h.pro, 3);
  const at = (minute: number) => instantAt(day, minute, h.pro.tz);
  return { paidTypeId, offerId, freeTypeId, day, at };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const identity = (email: string) => ({ name: "Beatriz Almeida", email });

function buyInput(s: Setup, minute: number, email: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "buy",
    ticketTypeId: s.paidTypeId,
    offerId: s.offerId,
    startsAt: s.at(minute).toISOString(),
    identity: identity(email),
    answers: [],
    ...over,
  };
}

function freeInput(s: Setup, minute: number, email: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { mode: "free", ticketTypeId: s.freeTypeId, startsAt: s.at(minute).toISOString(), identity: identity(email), answers: [], ...over };
}

function heldInput(s: Setup, minute: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { mode: "held_ticket", ticketTypeId: s.paidTypeId, startsAt: s.at(minute).toISOString(), answers: [], ...over };
}

/** One call of the core: the real pro row, a visitor (default anonymous), a fake gateway and ONE `now`. */
async function run(
  h: DbHarness,
  input: unknown,
  opts: {
    visitor?: ActionVisitor;
    fake?: FakeCheckout;
    deps?: PublicDeps;
    now?: Date;
    afterPlan?: () => Promise<void>;
  } = {},
) {
  const pro = await publicProOf(h.db, h.pro);
  const visitor = opts.visitor ?? actionVisitorOf();
  const fake = opts.fake ?? fakeCheckout("test");
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? publicDepsOf(fake);
  const res = await bookRdvCore(h.db, pro, visitor, input, deps, now, { afterPlan: opts.afterPlan });
  return { res, fake, visitor, now };
}

/** This pro's RDV occurrences, every status. */
const rdvsOf = (h: DbHarness) =>
  h.db
    .select()
    .from(occurrenceTable)
    .where(and(eq(occurrenceTable.professionalId, h.pro.proId), isNull(occurrenceTable.eventId)));

const scheduledRdvsOf = async (h: DbHarness) => (await rdvsOf(h)).filter((o) => o.status === "scheduled");

const customersOf = (h: DbHarness) => h.db.select().from(customerTable).where(eq(customerTable.professionalId, h.pro.proId));

async function customerOf(h: DbHarness, email: string) {
  const [row] = await h.db
    .select()
    .from(customerTable)
    .where(and(eq(customerTable.professionalId, h.pro.proId), eq(customerTable.email, normalizeEmail(email))));
  return row;
}

const purchasesOf = (h: DbHarness) => h.db.select().from(ticketPurchase).where(eq(ticketPurchase.professionalId, h.pro.proId));

/** A verified client user, its customer row at h.pro (linked unless `linked: false`) and the Owner visitor built from them. Delete the user with deleteTestUser. */
async function ownerVisitor(h: DbHarness, email: string, opts: { linked?: boolean } = {}) {
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  const customerId = await rowCustomer(h.db, h.pro, { email, userId: opts.linked === false ? null : userId });
  const owner = { professionalId: h.pro.proId, customerId, userId, email };
  const visitor = actionVisitorOf({ session: sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true }), owner });
  return { userId, customerId, owner, visitor };
}

/** The outcome of a settled core call: "ok", the error sentence, or the thrown error. */
function outcomeOf(r: PromiseSettledResult<{ res: Awaited<ReturnType<typeof bookRdvCore>> }>): string {
  if (r.status === "rejected") return `threw: ${String(r.reason)}`;
  return r.value.res.ok ? "ok" : r.value.res.error;
}

dbTest("free: a typed identity books a free slot, confirmed, with the confirmation, the pro notice and the sync", async (h) => {
  const s = await setup(h);
  const email = testEmail("rdvfree");
  const { res, fake, visitor } = await run(h, freeInput(s, 600, ` ${email.toUpperCase()} `, { website: "" }));
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.kind, "booked");
  const [rdv] = await rdvsOf(h);
  assert.deepEqual(res.effects, [
    { type: "email.booking_confirmed", bookingId: res.kind === "booked" ? res.bookingId : "" },
    { type: "email.pro_new_booking", bookingId: res.kind === "booked" ? res.bookingId : "" },
    { type: "google.sync_occurrence", occurrenceId: rdv.id },
  ]);
  assert.deepEqual(Object.keys(withoutPublicEffects(res)).sort(), ["bookingId", "kind", "ok"], "no purchase, no URL, no customer id");
  assert.equal(rdv.status, "scheduled");
  assert.equal(rdv.ticketTypeId, s.freeTypeId);
  assert.equal(rdv.startsAt.getTime(), s.at(600).getTime());
  if (res.kind !== "booked") return;
  const b = await getBooking(h.db, res.bookingId);
  assert.equal(b.status, "confirmed");
  assert.equal(b.coverage, "free");
  const row = await customerOf(h, email);
  assert.equal(row?.id, b.customerId);
  assert.equal(row?.name, "Beatriz Almeida");
  assert.equal(row?.userId, null);
  assert.equal(fake.created.length, 0, "no Checkout for a free slot");
  // The throttle of RDV bookings: its per-pro IP key is consumed (O22).
  const keys = (await h.db.select().from(throttle).where(like(throttle.key, `%${visitor.ipHash}%`))).map((r) => r.key).sort();
  assert.deepEqual(keys, [`t:rdv:ip:${visitor.ipHash}`, `t:rdv:p:${h.pro.proId}:ip:${visitor.ipHash}`]);
});

dbTest("held: the Owner spends one ticket of THIS type, her account gets linked, and « il vous en restera N » counts this type only", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("rdvheld"), { linked: false });
  try {
    await giveTickets(h.db, h.pro, o.customerId, s.paidTypeId, 2);
    const otherTypeId = await makeType(h.db, h.pro, { name: "Cours collectif" });
    await giveTickets(h.db, h.pro, o.customerId, otherTypeId, 1);

    // The count the RDV page shows before the booking: the Owner's tickets of THIS type (rdvOwnerTickets), minus the one spent.
    const before = await rdvOwnerTickets(h.db, h.pro.proId, o.customerId, s.paidTypeId);
    assert.equal(before.length, 2, "the ticket of another type is not counted");
    assert.equal(heldTicketButtonLabel(before.length - 1), "Réserver avec 1 ticket (il vous en restera 1)");

    const { res, fake } = await run(h, heldInput(s, 600), { visitor: o.visitor });
    assert.ok(res.ok && res.kind === "booked", JSON.stringify(res));
    const [rdv] = await scheduledRdvsOf(h);
    assert.deepEqual(res.effects, [
      { type: "email.booking_confirmed", bookingId: res.bookingId },
      { type: "email.pro_new_booking", bookingId: res.bookingId },
      { type: "google.sync_occurrence", occurrenceId: rdv.id },
    ]);
    const b = await getBooking(h.db, res.bookingId);
    assert.equal(b.status, "confirmed");
    assert.equal(b.coverage, "ticket");
    assert.equal(b.customerId, o.customerId);
    const tickets = await ticketsOf(h.db, o.customerId);
    assert.equal(tickets.filter((t) => t.status === "booked" && t.ticketTypeId === s.paidTypeId).length, 1);
    assert.equal(tickets.filter((t) => t.status === "available" && t.ticketTypeId === otherTypeId).length, 1, "the other type is untouched");
    assert.equal((await rdvOwnerTickets(h.db, h.pro.proId, o.customerId, s.paidTypeId)).length, 1, "« il vous en restera 1 » held");
    assert.equal((await customerOf(h, o.owner.email))?.userId, o.userId, "her row is linked to her account (L1345)");
    assert.equal(fake.created.length, 0);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("buy: the slot is held and the Checkout request is a card session of 31 minutes back to the RDV page", async (h) => {
  const s = await setup(h);
  const email = testEmail("rdvbuy");
  const before = Date.now();
  const { res, fake } = await run(h, buyInput(s, 600, email));
  const after = Date.now();
  assert.ok(res.ok && res.kind === "checkout", JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.checkoutUrl, `https://checkout.test/${res.purchaseId}`);

  assert.equal(fake.created.length, 1);
  const req = fake.created[0];
  assert.equal(req.kind, "buybook");
  assert.deepEqual(stripeSessionParams(req).payment_method_types, ["card"], "card only, like a séance buy + book");
  assert.equal(req.purchaseId, res.purchaseId);
  assert.equal(req.amountCents, 6000);
  assert.equal(req.currency, "eur");
  assert.equal(req.productName, "Massage sportif · À l'unité");
  assert.equal(req.customerEmail, email);
  assert.equal(req.env, "test");
  assert.ok(req.expiresAt.getTime() >= before + 31 * 60_000 && req.expiresAt.getTime() <= after + 31 * 60_000, "31 minutes, stamped right before the call");
  assert.equal(req.successUrl, `https://app.test/${h.pro.slug}/merci?p=${res.purchaseId}`);
  assert.equal(req.cancelUrl, `https://app.test/${h.pro.slug}/rdv/${s.paidTypeId}?paiement=annule&p=${res.purchaseId}`);

  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "pending");
  assert.equal(purchase.checkoutSessionId, `cs_test_fake_${res.purchaseId}`);
  assert.equal(purchase.checkoutUrl, res.checkoutUrl);
  const [rdv] = await scheduledRdvsOf(h);
  assert.equal(rdv.ticketTypeId, s.paidTypeId);
  const [held] = await h.db.select().from(bookingTable).where(eq(bookingTable.occurrenceId, rdv.id));
  assert.equal(held.status, "pending");
  assert.equal(held.purchaseId, res.purchaseId);
  assert.deepEqual(fake.expired, []);
});

dbTest("buy: a Checkout create failure cancels the RDV at once (the slot is bookable again) and returns the sync effect", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  fake.failCreate = true;
  const { res } = await run(h, buyInput(s, 600, testEmail("rdvfail")), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, COPY.CHECKOUT_FAILED);
  const [rdv] = await rdvsOf(h);
  assert.equal(rdv.status, "cancelled", "an RDV at 0 seats is cancelled and leaves the EXCLUDE");
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: rdv.id }]);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");

  const again = await run(h, freeInput(s, 600, testEmail("rdvagain")));
  assert.ok(again.res.ok, `the slot is free again: ${JSON.stringify(again.res)}`);
});

dbTest("buy: a refused attachment answers the RDV stale sentence, closes the session and cancels the RDV", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  fake.onCreate = async (req) => {
    await h.db.update(ticketPurchase).set({ status: "expired" }).where(eq(ticketPurchase.id, req.purchaseId));
  };
  const { res } = await run(h, buyInput(s, 600, testEmail("rdvstale")), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, RDV_STALE);
  assert.equal(res.code, "stale");
  assert.equal("checkoutUrl" in res, false);
  assert.equal("purchaseId" in res, false);
  const purchaseId = fake.created[0].purchaseId;
  assert.deepEqual(fake.expired, [`cs_test_fake_${purchaseId}`]);
  const [rdv] = await rdvsOf(h);
  assert.equal(rdv.status, "cancelled");
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: rdv.id }]);
});

dbTest("buy: a throw once the slot is held (before the session, or at the attach) releases it and rethrows (abandonPurchase, PAY-1 order)", async (h) => {
  const s = await setup(h);

  // 1. Before any session exists: the request cannot be built.
  const fake = fakeCheckout("test");
  const deps = publicDepsOf(fake);
  Object.defineProperty(deps, "appUrl", {
    get() {
      throw new Error("config: app url unreadable");
    },
  });
  await assert.rejects(run(h, buyInput(s, 600, testEmail("rdvthrow1")), { fake, deps }), /app url unreadable/);
  assert.equal(fake.created.length, 0, "Stripe was never asked for a session");
  let rdvs = await rdvsOf(h);
  assert.deepEqual(rdvs.map((o) => o.status), ["cancelled"]);
  assert.deepEqual((await purchasesOf(h)).map((p) => p.status), ["expired"]);

  // 2. At the attach: the session id is already attached to another purchase (unique violation), so the UPDATE throws.
  const second = fakeCheckout("test");
  second.onCreate = async (req) => {
    const otherCustomer = await rowCustomer(h.db, h.pro, {});
    const other = await rowPurchase(h.db, h.pro, { customerId: otherCustomer, offerId: s.offerId, ticketTypeId: s.paidTypeId });
    await h.db.update(ticketPurchase).set({ checkoutSessionId: `cs_test_fake_${req.purchaseId}` }).where(eq(ticketPurchase.id, other));
  };
  await assert.rejects(run(h, buyInput(s, 720, testEmail("rdvthrow2")), { fake: second }), /Failed query: update "ticket_purchase"/);
  const purchaseId = second.created[0].purchaseId;
  assert.deepEqual(second.expired, [`cs_test_fake_${purchaseId}`], "the open session is closed, once");
  rdvs = await rdvsOf(h);
  assert.deepEqual(rdvs.map((o) => o.status), ["cancelled", "cancelled"]);
  assert.equal((await purchasesOf(h)).find((p) => p.id === purchaseId)?.status, "expired");
});

dbTest("EXCLUDE in the UI (O1): two typed buyers, an Owner and a typed buyer, a buy and a free booking on one slot: one wins, the other reads « Ce créneau vient d'être pris. »", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("rdvrace-owner"));
  try {
    const races: [string, () => Promise<{ res: Awaited<ReturnType<typeof bookRdvCore>> }>, () => Promise<{ res: Awaited<ReturnType<typeof bookRdvCore>> }>][] = [
      ["typed + typed", () => run(h, buyInput(s, 600, testEmail("rdvrace-a"))), () => run(h, buyInput(s, 600, testEmail("rdvrace-b")))],
      ["Owner + typed", () => run(h, buyInput(s, 720, o.owner.email), { visitor: o.visitor }), () => run(h, buyInput(s, 720, testEmail("rdvrace-c")))],
      ["buy + free", () => run(h, buyInput(s, 840, testEmail("rdvrace-d"))), () => run(h, freeInput(s, 840, testEmail("rdvrace-e")))],
    ];
    for (const [label, a, b] of races) {
      const settled = await inParallel([a, b]);
      assert.deepEqual(settled.map(outcomeOf).sort(), ["Ce créneau vient d'être pris.", "ok"].sort(), label);
      for (const r of settled) {
        if (r.status === "fulfilled" && !r.value.res.ok) {
          assert.equal(r.value.res.error, SLOT_TAKEN, label);
          assert.equal(r.value.res.code, "slot_taken", label);
          assert.equal(r.value.res.resumeHref, undefined, `${label}: the slot is not the loser's own hold`);
        }
      }
    }
    assert.equal((await scheduledRdvsOf(h)).length, 3, "one RDV per slot");
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("double submit: a typed address gets the plain sentence; the Owner gets the way back to HER OWN hold only", async (h) => {
  const s = await setup(h);
  const typedEmail = testEmail("rdvdouble");
  const settled = await inParallel([() => run(h, buyInput(s, 600, typedEmail)), () => run(h, buyInput(s, 600, typedEmail))]);
  assert.deepEqual(settled.map(outcomeOf).sort(), [SLOT_TAKEN, "ok"].sort());
  for (const r of settled) if (r.status === "fulfilled" && !r.value.res.ok) assert.equal(r.value.res.resumeHref, undefined);

  const o = await ownerVisitor(h, testEmail("rdvdouble-owner"));
  const other = await ownerVisitor(h, testEmail("rdvdouble-other"));
  try {
    const first = await run(h, buyInput(s, 720, o.owner.email), { visitor: o.visitor });
    assert.ok(first.res.ok && first.res.kind === "checkout", JSON.stringify(first.res));
    const mine = `/${h.pro.slug}/rdv/${s.paidTypeId}?paiement=annule&p=${first.res.purchaseId}`;

    // Her second submit, a held-ticket try and a free try on a free type at the same start all meet her own live hold.
    for (const input of [buyInput(s, 720, o.owner.email), heldInput(s, 720)]) {
      const again = await run(h, input, { visitor: o.visitor });
      assert.ok(!again.res.ok);
      assert.equal(again.res.error, SLOT_TAKEN);
      assert.equal(again.res.resumeHref, mine);
    }
    const free = await run(h, freeInput(s, 720, o.owner.email), { visitor: o.visitor });
    assert.ok(!free.res.ok);
    assert.equal(free.res.resumeHref, undefined, "her hold is of another type: no way back from this type's page");

    // The way back names her own purchase, which the RDV page accepts for her.
    const now = new Date();
    const ref = await purchaseByReference(h.db, h.pro.proId, first.res.purchaseId, now);
    assert.notEqual(referenceForPage(ref, { kind: "rdv", ticketTypeId: s.paidTypeId }, o.owner), null);

    // Another Owner, and a typed visitor with her address, read the plain sentence.
    for (const [label, visitor, email] of [
      ["another Owner", other.visitor, other.owner.email],
      ["a typed visitor with her address", actionVisitorOf(), o.owner.email],
    ] as const) {
      const refused = await run(h, buyInput(s, 720, email), { visitor });
      assert.ok(!refused.res.ok, label);
      assert.equal(refused.res.error, SLOT_TAKEN, label);
      assert.equal(refused.res.resumeHref, undefined, label);
    }
  } finally {
    await deleteTestUser(h.db, o.userId);
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("off-grid starts (10:07, :30 s, +1 ms, outside the hours, a DST gap instant) read RDV_SLOT_GONE and write no customer row", async (h) => {
  const s = await setup(h);
  // A type whose own hours are 01:00-04:00 on the Sunday Paris springs forward (2027-03-28: 02:00 → 03:00).
  const gapDay: DateKey = "2027-03-28";
  const nightTypeId = await makeType(h.db, h.pro, { name: "Nuit", rdvEnabled: true, rdvDurationMin: 60, rdvFree: true });
  const night = await setAvailabilityRules(h.db, {
    professionalId: h.pro.proId,
    ticketTypeId: nightTypeId,
    rules: [{ dayOfWeek: dayOfWeek(gapDay), startMinute: 60, endMinute: 240 }],
  });
  assert.ok(night.ok, JSON.stringify(night));
  const at = (minute: number, ms = 0) => new Date(s.at(minute).getTime() + ms).toISOString();
  const cases: [string, Record<string, unknown>, boolean][] = [
    ["10:07", freeInput(s, 607, testEmail("grid"), {}), true],
    [":30 s", freeInput(s, 600, testEmail("grid"), { startsAt: at(600, 30_000) }), true],
    ["+1 ms", freeInput(s, 600, testEmail("grid"), { startsAt: at(600, 1) }), false],
    ["outside the hours (07:00)", buyInput(s, 420, testEmail("grid")), true],
    // 02:30 does not exist that night: instantAt shifts it to 03:30 CEST (01:30Z), which no 60-minute grid start is.
    [
      "a DST gap instant",
      freeInput(s, 0, testEmail("grid"), { ticketTypeId: nightTypeId, startsAt: instantAt(gapDay, 150, "Europe/Paris").toISOString() }),
      true,
    ],
  ];
  for (const [label, input, coded] of cases) {
    const { res } = await run(h, input);
    assert.ok(!res.ok, label);
    assert.equal(res.error, COPY.RDV_SLOT_GONE, label);
    assert.equal(res.code, coded ? "unavailable" : undefined, label);
  }
  // The real grid of that night is 00:00Z and 01:00Z (03:00 CEST): the gap start above is refused by the grid alone.
  assert.equal(instantAt(gapDay, 150, "Europe/Paris").toISOString(), "2027-03-28T01:30:00.000Z");
  assert.deepEqual(await customersOf(h), [], "no customer row");
  assert.deepEqual(await rdvsOf(h), []);
});

dbTest("throttled: the per-pro IP key of RDV bookings stops the seventh call of one address, nothing is written", async (h) => {
  const s = await setup(h);
  const ipHash = testIpHash();
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    assert.ok(
      await checkActionThrottle(
        h.db,
        { action: "rdv", professionalId: h.pro.proId, ipHash, wideIpHash: null, subject: { kind: "email", email: testEmail(`thr${i}`) } },
        now,
      ),
    );
  }
  const email = testEmail("rdvthrottled");
  const { res } = await run(h, freeInput(s, 600, email), { visitor: actionVisitorOf({ ipHash }), now });
  assert.ok(!res.ok);
  assert.equal(res.error, ENGINE_ERROR_MESSAGES.throttled);
  assert.equal(res.code, "throttled");
  assert.equal(await customerOf(h, email), undefined);
  assert.deepEqual(await rdvsOf(h), []);
  const [perPro] = await h.db.select().from(throttle).where(eq(throttle.key, `t:rdv:p:${h.pro.proId}:ip:${ipHash}`));
  assert.equal(perPro?.hits, 7, "the key t:rdv:p:<pro>:ip:<hash> counted the seven calls");
});

dbTest("no pro-wide hold ceiling (O23 withdrawn, R1): three live RDV holds of other typed buyers leave a new typed buyer its hold and its Checkout on a free slot", async (h) => {
  const s = await setup(h);
  const now = new Date();
  for (const [i, minute] of [600, 660, 720].entries()) {
    const { res } = await run(h, buyInput(s, minute, testEmail(`ceil${i}`)), { now });
    assert.ok(res.ok && res.kind === "checkout", JSON.stringify(res));
  }
  assert.equal((await scheduledRdvsOf(h)).length, 3, "three live RDV holds of this pro");

  const email = testEmail("ceilfourth");
  const fourth = await run(h, buyInput(s, 840, email), { now });
  assert.ok(fourth.res.ok && fourth.res.kind === "checkout", JSON.stringify(fourth.res));
  assert.equal(fourth.fake.created.length, 1, "its Checkout session");
  assert.equal(fourth.fake.created[0].purchaseId, fourth.res.purchaseId);
  assert.ok(await customerOf(h, email), "its customer row");
  const rdv = (await scheduledRdvsOf(h)).find((o) => o.startsAt.getTime() === s.at(840).getTime());
  assert.ok(rdv, "its slot is held");
  const [held] = await h.db.select().from(bookingTable).where(eq(bookingTable.occurrenceId, rdv.id));
  assert.equal(held.status, "pending");
  assert.equal(held.purchaseId, fourth.res.purchaseId);
});

dbTest("too_many_holds: a typed address reads the neutral sentence, a verified Owner the RDV sentence with its code", async (h) => {
  const s = await setup(h);
  const now = new Date();
  const typed = testEmail("holds");
  for (const minute of [600, 660]) assert.ok((await run(h, buyInput(s, minute, typed), { now })).res.ok);
  const third = await run(h, buyInput(s, 720, typed), { now });
  assert.ok(!third.res.ok);
  assert.equal(third.res.error, COPY.BUYBOOK_NOT_POSSIBLE);
  assert.equal(third.res.code, undefined, "Decision 64: nothing about her own state");

  const o = await ownerVisitor(h, testEmail("holdsowner"));
  try {
    for (const minute of [780, 840]) assert.ok((await run(h, buyInput(s, minute, o.owner.email), { visitor: o.visitor, now })).res.ok);
    const mine = await run(h, buyInput(s, 900, o.owner.email), { visitor: o.visitor, now });
    assert.ok(!mine.res.ok);
    assert.equal(mine.res.error, CLIENT_CONTEXT_MESSAGES.rdv?.too_many_holds);
    assert.equal(mine.res.code, "too_many_holds");
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

dbTest("stale: a zone switched between the plan and the batch is surfaced, not retried, and books nothing", async (h) => {
  const s = await setup(h);
  const { res } = await run(h, freeInput(s, 600, testEmail("rdvtz")), {
    afterPlan: async () => {
      await h.db.update(professionalTable).set({ timezone: "America/Los_Angeles" }).where(eq(professionalTable.id, h.pro.proId));
    },
  });
  assert.ok(!res.ok);
  assert.equal(res.error, RDV_STALE);
  assert.equal(res.code, "stale");
  assert.deepEqual(await scheduledRdvsOf(h), []);
});

dbTest("the notice crossed between the render and the submit: the RDV « unavailable » sentence, nothing booked", async (h) => {
  const s = await setup(h);
  const typeId = await makeType(h.db, h.pro, {
    name: "Appel",
    rdvEnabled: true,
    rdvDurationMin: 60,
    rdvFree: true,
    rdvOverrides: { bookingHorizonDays: null, minNoticeMinutes: 120, cancelDeadlineHours: null },
  });
  const start = s.at(600);
  // Rendered at start − 121 min (the slot was offered); submitted at start − 119 min, inside the notice.
  const { res } = await run(
    h,
    { mode: "free", ticketTypeId: typeId, startsAt: start.toISOString(), identity: identity(testEmail("notice")), answers: [] },
    { now: addMinutes(start, -119) },
  );
  assert.ok(!res.ok);
  assert.equal(res.error, COPY.RDV_SLOT_GONE);
  assert.equal(res.code, "unavailable");
  assert.deepEqual(await rdvsOf(h), []);
});

dbTest("second pro: pro A's page with pro B's type, offer or start answers not_found or off-grid, no customer at either pro, B's calendar unchanged", async (h) => {
  const s = await setup(h);
  const other = await createTestPro(h.db);
  try {
    const b: DbHarness = { db: h.db, pro: other };
    const hoursB = await setAvailabilityRules(h.db, {
      professionalId: other.proId,
      ticketTypeId: null,
      rules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 360, endMinute: 480 })),
    });
    assert.ok(hoursB.ok, JSON.stringify(hoursB));
    const typeB = await makeType(h.db, other, { name: "Type de B", rdvEnabled: true, rdvDurationMin: 60 });
    const offerB = await makeOffer(h.db, other, typeB, { quantity: 1, priceCents: 5000 });
    const freeB = await makeType(h.db, other, { name: "Gratuit de B", rdvEnabled: true, rdvDurationMin: 60, rdvFree: true });
    const dayB = dayIn(other, 3);
    const atB = (minute: number) => instantAt(dayB, minute, other.tz);

    const cases: [string, Record<string, unknown>, string, string][] = [
      ["B's paid type", buyInput(s, 600, testEmail("x1"), { ticketTypeId: typeB, offerId: offerB, startsAt: atB(360).toISOString() }), RDV_GONE, "not_found"],
      ["B's free type", freeInput(s, 600, testEmail("x2"), { ticketTypeId: freeB, startsAt: atB(360).toISOString() }), RDV_GONE, "not_found"],
      ["B's offer on A's type", buyInput(s, 600, testEmail("x3"), { offerId: offerB }), RDV_GONE, "not_found"],
      ["B's start on A's type", freeInput(s, 600, testEmail("x4"), { startsAt: atB(360).toISOString() }), COPY.RDV_SLOT_GONE, "unavailable"],
    ];
    for (const [label, input, error, code] of cases) {
      const { res, fake } = await run(h, input);
      assert.ok(!res.ok, label);
      assert.equal(res.error, error, label);
      assert.equal(res.code, code, label);
      assert.equal(fake.created.length, 0, label);
    }
    assert.deepEqual(await customersOf(h), [], "no customer at A");
    assert.deepEqual(await customersOf(b), [], "no customer at B");
    assert.deepEqual(await rdvsOf(h), []);
    assert.deepEqual(await rdvsOf(b), [], "B's calendar unchanged");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("a free booking with the Owner's address lands on her own row, typed or from her session (her session address wins over the typed one)", async (h) => {
  const s = await setup(h);
  const o = await ownerVisitor(h, testEmail("rdvownerfree"));
  try {
    const typed = await run(h, freeInput(s, 600, o.owner.email));
    assert.ok(typed.res.ok && typed.res.kind === "booked", JSON.stringify(typed.res));
    assert.equal((await getBooking(h.db, typed.res.bookingId)).customerId, o.customerId, "the same customer row: the address identifies, it authorises nothing");

    // Her own session: her address wins over the one typed, and the booking is hers.
    const mine = await run(h, freeInput(s, 720, testEmail("ignored")), { visitor: o.visitor });
    assert.ok(mine.res.ok && mine.res.kind === "booked", JSON.stringify(mine.res));
    assert.equal((await getBooking(h.db, mine.res.bookingId)).customerId, o.customerId);
    assert.equal((await customersOf(h)).length, 1, "no row for the ignored typed address");
    const rdv = (await scheduledRdvsOf(h)).find((r) => r.startsAt.getTime() === s.at(720).getTime());
    assert.ok(rdv);
    assert.equal((await getOccurrence(h.db, rdv.id)).seatsTaken, 1);
  } finally {
    await deleteTestUser(h.db, o.userId);
  }
});

/** Pins the day arithmetic the DST case relies on: the gap night is a Sunday, the day after a Saturday. */
test("the DST case: 2027-03-28 is a Sunday", () => {
  assert.equal(dayOfWeek("2027-03-28"), 0);
  assert.equal(dayOfWeek(addDays("2027-03-28", -1)), 6);
});
