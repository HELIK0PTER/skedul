import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { and, eq, like, or } from "drizzle-orm";

import {
  booking as bookingTable,
  customer as customerTable,
  throttle,
  ticketOffer,
  ticketPurchase,
  ticketType,
} from "@/lib/db/schema";
import type { ActionVisitor } from "@/lib/public/context";
import { COPY } from "@/lib/public/messages";
import { shopPurchaseInputSchema, startShopPurchaseCore } from "@/lib/public/shop-actions";
import { checkActionThrottle } from "@/lib/throttle";
import { normalizeEmail } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { createTestPro, dbTest, deleteTestUser, testEmail, type DbHarness } from "@/test/db";
import { makeOffer, makeType } from "@/test/fixtures";
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

test("the shop schema normalises the identity and refuses any extra key", () => {
  const valid = {
    offerId: "f1",
    identity: { name: " Beatriz Almeida ", email: " Beatriz@Example.com ", phone: " 0612345678 " },
  };
  const parsed = parseFr(shopPurchaseInputSchema, valid);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.data.identity, {
      name: "Beatriz Almeida",
      email: "beatriz@example.com",
      phone: "0612345678",
    });
  }
  for (const [label, input] of [
    ["an extra key", { ...valid, userId: "u1" }],
    ["the slug the wrapper splits off", { ...valid, slug: "altinha-paris" }],
    ["an extra key in the identity", { ...valid, identity: { ...valid.identity, userId: "u1" } }],
  ] as const) {
    const res = parseFr(shopPurchaseInputSchema, input);
    assert.equal(res.ok, false, label);
    if (!res.ok) assert.equal(res.error, "Champ inattendu.", label);
  }
});

/** A type « Roda libre » and its « Carnet de 4 » offer at 85 €: a Boutique offer, no séance involved. */
async function setup(h: DbHarness) {
  const typeId = await makeType(h.db, h.pro, { name: "Roda libre" });
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 4, priceCents: 8500 });
  return { typeId, offerId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** The raw input of a shop call, as the browser sends it (the wrapper splits the slug off). */
function shopInput(s: Pick<Setup, "offerId">, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offerId: s.offerId,
    identity: { name: "Beatriz Almeida", email: testEmail("shop") },
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
  const res = await startShopPurchaseCore(h.db, pro, visitor, input, deps, now);
  return { res, fake, visitor, now };
}

const purchasesOf = (h: DbHarness) =>
  h.db.select().from(ticketPurchase).where(eq(ticketPurchase.professionalId, h.pro.proId));

const bookingsOfPro = (h: DbHarness) =>
  h.db.select().from(bookingTable).where(eq(bookingTable.professionalId, h.pro.proId));

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

dbTest("shop purchase: a pending purchase, the session the gateway created and the 24 h expiry of the row", async (h) => {
  const s = await setup(h);
  const email = testEmail("shop");
  const now = new Date();
  const { res, fake } = await run(h, shopInput(s, { identity: { name: " Beatriz Almeida ", email } }), { now });
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.checkoutUrl, `https://checkout.test/${res.purchaseId}`);

  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.id, res.purchaseId);
  assert.equal(purchase.status, "pending");
  assert.equal(purchase.offerId, s.offerId);
  assert.equal(purchase.ticketTypeId, s.typeId);
  assert.equal(purchase.label, "Carnet de 4");
  assert.equal(purchase.quantity, 4);
  assert.equal(purchase.amountCents, 8500);
  assert.equal(purchase.checkoutSessionId, `cs_test_fake_${res.purchaseId}`);
  assert.equal(purchase.checkoutUrl, res.checkoutUrl);
  assert.equal(purchase.checkoutExpiresAt.getTime(), now.getTime() + 24 * 60 * 60_000);
  assert.deepEqual(await bookingsOfPro(h), [], "a shop purchase holds no seat");

  const row = await customerOf(h, email);
  assert.equal(row?.id, purchase.customerId);
  assert.equal(row?.name, "Beatriz Almeida");
  assert.equal(row?.userId, null);

  assert.equal(fake.created.length, 1);
  const req = fake.created[0];
  assert.equal(req.kind, "shop");
  assert.equal(req.purchaseId, res.purchaseId);
  assert.equal(req.amountCents, 8500);
  assert.equal(req.currency, "eur");
  assert.equal(req.productName, "Roda libre · Carnet de 4");
  assert.equal(req.customerEmail, email);
  assert.equal(req.env, "test");
  assert.equal(req.expiresAt.getTime(), purchase.checkoutExpiresAt.getTime());
  assert.equal(req.successUrl, `https://app.test/${h.pro.slug}/merci?p=${res.purchaseId}`);
  assert.equal(
    req.cancelUrl,
    `https://app.test/${h.pro.slug}/offre/${s.offerId}?paiement=annule&p=${res.purchaseId}`,
  );
  assert.deepEqual(fake.expired, []);
});

dbTest("shop purchase: an offer that is no longer on sale answers « n'est plus proposée »", async (h) => {
  const s = await setup(h);
  await h.db.update(ticketOffer).set({ isActive: false }).where(eq(ticketOffer.id, s.offerId));

  const { res, fake } = await run(h, shopInput(s));
  assert.ok(!res.ok);
  assert.equal(res.error, "Cette offre n'est plus proposée.");
  assert.equal(res.code, "not_found");
  assert.deepEqual(res.effects, []);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal(fake.created.length, 0);
});

dbTest("shop purchase: a type switched to « Gratuit » sells nothing: the stale wording, no purchase row", async (h) => {
  const s = await setup(h);
  await h.db
    .update(ticketType)
    .set({ rdvEnabled: true, rdvDurationMin: 60, rdvFree: true })
    .where(eq(ticketType.id, s.typeId));

  const { res, fake } = await run(h, shopInput(s));
  assert.ok(!res.ok);
  assert.equal(res.error, "L'offre a changé : rafraîchissez la page.");
  assert.equal(res.code, "stale");
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal(fake.created.length, 0);
});

dbTest("shop purchase: an offer of another pro is not found and nothing is sold (S6)", async (h) => {
  await setup(h);
  const other = await createTestPro(h.db);
  try {
    const otherHarness: DbHarness = { db: h.db, pro: other };
    const foreign = await setup(otherHarness);
    const email = testEmail("tenant");

    const { res, fake } = await run(h, shopInput(foreign, { identity: { name: "Beatriz Almeida", email } }));
    assert.ok(!res.ok);
    assert.equal(res.error, "Cette offre n'est plus proposée.");
    assert.equal(res.code, "not_found");
    assert.deepEqual(res.effects, []);
    assert.equal(fake.created.length, 0);
    assert.equal((await purchasesOf(h)).length, 0);
    assert.equal((await purchasesOf(otherHarness)).length, 0);
    assert.equal(await customerOf(otherHarness, email), undefined, "the typed address never reaches the other pro");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("shop purchase: a gateway failure expires the purchase and answers CHECKOUT_FAILED", async (h, t) => {
  const s = await setup(h);
  const lines: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const fake = fakeCheckout("test");
  const email = testEmail("fail");
  // A gateway failure that quotes the typed address and a session id: the log line must not repeat either
  // (logSafeMessage), which a fixed message could never prove.
  fake.create = async (req) => {
    fake.created.push(req);
    throw new Error(`Invalid email address: ${email} (session cs_test_a1B2c3D4e5F6)`);
  };

  const { res } = await run(h, shopInput(s, { identity: { name: "Beatriz Almeida", email } }), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, COPY.CHECKOUT_FAILED);
  assert.equal(res.code, undefined);
  assert.deepEqual(res.effects, []);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");
  assert.equal(purchase.checkoutSessionId, null);
  assert.deepEqual(fake.expired, []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "[public] checkout create failed: Invalid email address: [email] (session [session])");
  assert.equal(lines[0].includes("@"), false);
  assert.equal(lines[0].includes(email), false);
  assert.equal(lines[0].includes("cs_test_"), false);
});

dbTest("shop purchase: a refused attachment expires the session and says the offer changed", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  fake.onCreate = async (req) => {
    await h.db.update(ticketPurchase).set({ status: "expired" }).where(eq(ticketPurchase.id, req.purchaseId));
  };

  const { res } = await run(h, shopInput(s), { fake });
  assert.ok(!res.ok);
  assert.equal(res.error, "L'offre a changé : rafraîchissez la page.");
  assert.equal(res.code, "stale");
  assert.deepEqual(res.effects, []);
  assert.deepEqual(fake.expired, [`cs_test_fake_${fake.created[0].purchaseId}`]);
  const [purchase] = await purchasesOf(h);
  assert.equal(purchase.status, "expired");
  assert.equal(purchase.checkoutSessionId, null);
});

/** What the thrown attach UPDATE looks like to the caller (the driver error wraps the unique violation). */
const ATTACH_FAILURE = /Failed query: update "ticket_purchase" set "checkout_session_id"/;

dbTest("shop purchase: a throw after the session was created closes the session, expires the purchase and rethrows", async (h) => {
  const s = await setup(h);
  const fake = fakeCheckout("test");
  // The session id the gateway is about to hand out is already attached to another purchase
  // (ticket_purchase_checkout_session_uq): the attach UPDATE THROWS instead of answering « stale ».
  fake.onCreate = async (req) => {
    const otherCustomer = await rowCustomer(h.db, h.pro, {});
    const other = await rowPurchase(h.db, h.pro, { customerId: otherCustomer, offerId: s.offerId, ticketTypeId: s.typeId });
    await h.db
      .update(ticketPurchase)
      .set({ checkoutSessionId: `cs_test_fake_${req.purchaseId}` })
      .where(eq(ticketPurchase.id, other));
  };

  await assert.rejects(run(h, shopInput(s), { fake }), ATTACH_FAILURE);

  const purchaseId = fake.created[0].purchaseId;
  assert.deepEqual(fake.expired, [`cs_test_fake_${purchaseId}`], "the open session is closed, once");
  const mine = (await purchasesOf(h)).find((p) => p.id === purchaseId);
  assert.equal(mine?.status, "expired");
  assert.equal(mine?.checkoutSessionId, null);
  assert.deepEqual(await bookingsOfPro(h), [], "a shop purchase holds no seat");
});

dbTest("shop purchase: the 7th request of one address at this pro is throttled before any write (S19)", async (h) => {
  const s = await setup(h);
  const email = testEmail("limit");
  const now = new Date();
  for (let hit = 1; hit <= 6; hit++) {
    const allowed = await checkActionThrottle(
      h.db,
      {
        action: "shop",
        professionalId: h.pro.proId,
        ipHash: testIpHash(),
        wideIpHash: null,
        subject: { kind: "email", email },
      },
      now,
    );
    assert.equal(allowed, true, `hit ${hit}`);
  }

  const { res, fake } = await run(h, shopInput(s, { identity: { name: "Beatriz Almeida", email } }), { now });
  assert.ok(!res.ok);
  assert.equal(res.error, "Trop de demandes. Réessayez dans un moment.");
  assert.equal(res.code, "throttled");
  assert.deepEqual(res.effects, []);
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.equal(fake.created.length, 0);
});

dbTest("shop purchase: strangers typing an address cannot lock out its verified holder (S36, SEC-I6)", async (h) => {
  const s = await setup(h);
  const email = testEmail("holder");
  const { userId } = await createTestClientUser(h.db, { email, name: "Beatriz Almeida", verified: true });
  try {
    const now = new Date();
    for (let hit = 1; hit <= 7; hit++) {
      await checkActionThrottle(
        h.db,
        {
          action: "shop",
          professionalId: h.pro.proId,
          ipHash: testIpHash(),
          wideIpHash: null,
          subject: { kind: "email", email },
        },
        now,
      );
    }

    // A stranger typing the address is over the per-pro address key.
    const stranger = await run(h, shopInput(s, { identity: { name: "Mallory", email } }), { now });
    assert.ok(!stranger.res.ok);
    assert.equal(stranger.res.code, "throttled");
    assert.equal(await customerOf(h, email), undefined);

    // Its verified holder is keyed on her user, not on the address: she still buys, and her account is linked.
    const visitor = actionVisitorOf({
      session: sessionOf({ userId, email, name: "Beatriz Almeida" }, { verified: true }),
    });
    const holder = await run(h, shopInput(s, { identity: { name: "Beatriz Almeida", email } }), { visitor, now });
    assert.ok(holder.res.ok, JSON.stringify(holder.res));
    assert.equal((await customerOf(h, email))?.userId, userId);
    assert.equal((await purchasesOf(h)).length, 1);
  } finally {
    await deleteTestUser(h.db, userId);
  }
});

dbTest("shop purchase: a filled honeypot is refused before any customer or throttle row is written (S20)", async (h) => {
  const s = await setup(h);
  const email = testEmail("bot");
  const visitor = actionVisitorOf();
  for (const website of ["http://spam.test", "x", ["x"], 0, null]) {
    const { res, fake } = await run(h, shopInput(s, { identity: { name: "Beatriz Almeida", email }, website }), {
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
});

dbTest("shop purchase: a mock gateway outside its allowance answers PAYMENT_UNAVAILABLE and writes nothing", async (h) => {
  const s = await setup(h);
  const email = testEmail("mock");
  const visitor = actionVisitorOf();
  const input = shopInput(s, { identity: { name: "Beatriz Almeida", email } });

  const blocked = await run(h, input, { fake: fakeCheckout("mock"), mockAllowed: false, visitor });
  assert.ok(!blocked.res.ok);
  assert.equal(blocked.res.error, COPY.PAYMENT_UNAVAILABLE);
  assert.equal(blocked.res.code, undefined);
  assert.equal(blocked.fake.created.length, 0);
  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);

  const allowed = await run(h, input, { fake: fakeCheckout("mock"), mockAllowed: true, visitor });
  assert.ok(allowed.res.ok, JSON.stringify(allowed.res));
});

dbTest("shop purchase: an Owner buys as herself, and a typed address never links someone else's account", async (h) => {
  const s = await setup(h);
  const ownerEmail = testEmail("owner");
  const typedEmail = testEmail("typed");
  const victimEmail = testEmail("victim");
  const owner = await createTestClientUser(h.db, { email: ownerEmail, name: "Beatriz Almeida", verified: true });
  const victim = await createTestClientUser(h.db, { email: victimEmail, name: "Victime", verified: true });
  try {
    const customerId = await rowCustomer(h.db, h.pro, { email: ownerEmail, userId: owner.userId });
    const visitor = actionVisitorOf({
      session: sessionOf({ userId: owner.userId, email: ownerEmail, name: "Beatriz Almeida" }, { verified: true }),
      owner: { professionalId: h.pro.proId, customerId, userId: owner.userId, email: ownerEmail },
    });

    // The Owner types another address: the session address wins.
    const owned = await run(h, shopInput(s, { identity: { name: "Autre Nom", email: typedEmail } }), { visitor });
    assert.ok(owned.res.ok, JSON.stringify(owned.res));
    const [purchase] = await purchasesOf(h);
    assert.equal(purchase.customerId, customerId);
    assert.equal(await customerOf(h, typedEmail), undefined);
    assert.equal(owned.fake.created[0].customerEmail, ownerEmail);

    // Nobody signed in types the victim's address: the row is created unlinked.
    const anonymous = await run(h, shopInput(s, { identity: { name: "Mallory", email: victimEmail } }));
    assert.ok(anonymous.res.ok, JSON.stringify(anonymous.res));
    assert.equal((await customerOf(h, victimEmail))?.userId, null);
  } finally {
    await deleteTestUser(h.db, owner.userId);
    await deleteTestUser(h.db, victim.userId);
  }
});

dbTest("shop purchase: a malformed input is refused whole, before anything is read or written (S43, SEC-M15)", async (h) => {
  const s = await setup(h);
  const email = testEmail("bad");
  const identity = { name: "Beatriz Almeida", email };
  const good = shopInput(s, { identity });
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
    { label: "a wrong type", input: { ...good, offerId: 42 }, error: "Ce champ est obligatoire." },
    { label: "a missing offer", input: { ...good, offerId: undefined }, error: "Ce champ est obligatoire." },
    { label: "identity null", input: { ...good, identity: null }, error: "Valeur invalide." },
    { label: "a string", input: "x", error: "Valeur invalide." },
    { label: "null", input: null, error: "Valeur invalide." },
  ];
  for (const c of cases) {
    const { res, fake } = await run(h, c.input, { visitor });
    assert.ok(!res.ok, c.label);
    assert.equal(res.error, c.error, c.label);
    assert.equal(res.code, undefined, c.label);
    assert.deepEqual(res.effects, [], c.label);
    assert.equal(fake.created.length, 0, c.label);
  }

  const badName = await run(h, shopInput(s, { identity: { name: "www.arnaque.fr", email } }), { visitor });
  assert.ok(!badName.res.ok);
  assert.equal(badName.res.error, COPY.PLAIN_NAME);
  assert.deepEqual(badName.res.fieldErrors, { "identity.name": COPY.PLAIN_NAME });

  assert.equal(await customerOf(h, email), undefined);
  assert.equal((await purchasesOf(h)).length, 0);
  assert.deepEqual(await throttleRowsOf(h, visitor.ipHash, email), []);
});
