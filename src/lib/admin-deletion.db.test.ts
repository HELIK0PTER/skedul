import assert from "node:assert/strict";
import { nanoid } from "nanoid";

import { attachCheckoutSession } from "./booking/claims";
import { fulfillPurchase, startPurchase } from "./booking/fulfillment";
import type { Db } from "./db/atomic";
import { expireOpenCheckoutsCore, type ExpireOutcome } from "./admin-deletion";
import { createTestPro, dbTest, deleteTestUser, type TestPro } from "../test/db";
import { makeCustomer, makeOffer, makeType } from "../test/fixtures";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

/** A pending purchase of `pro` (through the engine), with a Checkout session id when `session` is true. */
async function pendingPurchase(
  db: Db,
  pro: TestPro,
  offerId: string,
  customerId: string,
  session: boolean,
): Promise<{ purchaseId: string; sessionId: string | null }> {
  const shop = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  must(shop, "startPurchase");
  if (!session) return { purchaseId: shop.purchaseId, sessionId: null };
  const sessionId = `cs_test_${nanoid(12)}`;
  must(
    await attachCheckoutSession(db, {
      purchaseId: shop.purchaseId,
      checkoutSessionId: sessionId,
      checkoutUrl: "https://checkout.example.test/s",
    }),
    "attachCheckoutSession",
  );
  return { purchaseId: shop.purchaseId, sessionId };
}

async function shopOf(db: Db, pro: TestPro): Promise<{ offerId: string; customerId: string }> {
  const typeId = await makeType(db, pro);
  return { offerId: await makeOffer(db, pro, typeId), customerId: await makeCustomer(db, pro) };
}

const ZERO = { total: 0, closed: 0, failed: 0, unfinished: 0, timedOut: false, listFailed: false };

dbTest("expireOpenCheckoutsCore: only this pro's pending purchases with a session id are expired, counts returned", async ({ db, pro }) => {
  const mine = await shopOf(db, pro);
  const open1 = await pendingPurchase(db, pro, mine.offerId, mine.customerId, true);
  const open2 = await pendingPurchase(db, pro, mine.offerId, mine.customerId, true);
  await pendingPurchase(db, pro, mine.offerId, mine.customerId, false); // no session id: nothing to expire
  const paid = await pendingPurchase(db, pro, mine.offerId, mine.customerId, true);
  const fulfilled = await fulfillPurchase(db, paid.purchaseId, { sessionId: paid.sessionId, paymentIntentId: null, livemode: false });
  assert.equal(fulfilled.outcome, "fulfilled"); // a paid purchase is no longer open

  const other = await createTestPro(db);
  try {
    const theirs = await shopOf(db, other);
    const foreign = await pendingPurchase(db, other, theirs.offerId, theirs.customerId, true);

    const asked: string[] = [];
    const logs: string[] = [];
    const report = await expireOpenCheckoutsCore(
      db,
      pro.proId,
      async (sessionId): Promise<ExpireOutcome> => {
        asked.push(sessionId);
        return sessionId === open1.sessionId ? "expired" : "not_open";
      },
      30_000,
      (line) => logs.push(line),
    );

    assert.deepEqual([...asked].sort(), [open1.sessionId, open2.sessionId].sort());
    assert.ok(!asked.includes(foreign.sessionId as string), "another pro's session is never touched");
    assert.ok(!asked.includes(paid.sessionId as string), "a paid purchase's session is never touched");
    assert.deepEqual(report, { ...ZERO, total: 2, closed: 2 });
    assert.deepEqual(logs, []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("expireOpenCheckoutsCore: a pro without open session expires nothing", async ({ db, pro }) => {
  const mine = await shopOf(db, pro);
  await pendingPurchase(db, pro, mine.offerId, mine.customerId, false);
  let calls = 0;
  const report = await expireOpenCheckoutsCore(db, pro.proId, async () => {
    calls += 1;
    return "expired";
  }, 30_000);
  assert.equal(calls, 0);
  assert.deepEqual(report, ZERO);
});

dbTest("expireOpenCheckoutsCore: a failing, throwing or never-resolving expire never throws out of the core and the deadline holds", async ({ db, pro }) => {
  const mine = await shopOf(db, pro);
  const sessions: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    sessions.push((await pendingPurchase(db, pro, mine.offerId, mine.customerId, true)).sessionId as string);
  }
  const [throwing, failing, notOpen, mock] = sessions; // the fifth one hangs
  const logs: string[] = [];
  const DEADLINE = 4_000;

  const started = Date.now();
  const report = await expireOpenCheckoutsCore(
    db,
    pro.proId,
    (sessionId): Promise<ExpireOutcome> => {
      if (sessionId === throwing) return Promise.reject(new Error(`boom ${throwing} for jane.doe@example.com`));
      if (sessionId === failing) return Promise.resolve("failed");
      if (sessionId === notOpen) return Promise.resolve("not_open");
      if (sessionId === mock) return Promise.resolve("mock");
      return new Promise<ExpireOutcome>(() => {}); // hangs: only the deadline can end it
    },
    DEADLINE,
    (line) => logs.push(line),
  );
  const elapsed = Date.now() - started;

  assert.deepEqual(report, { total: 5, closed: 2, failed: 2, unfinished: 1, timedOut: true, listFailed: false });
  assert.ok(elapsed >= DEADLINE - 100, `returned before the deadline: ${elapsed} ms`);
  assert.ok(elapsed < DEADLINE + 1_500, `did not return right after the deadline: ${elapsed} ms`);
  // what is logged is scrubbed: no session id, no e-mail address
  const text = logs.join("\n");
  assert.ok(logs.length > 0, "a throwing expire is logged");
  assert.doesNotMatch(text, /cs_(test|live)_/);
  assert.doesNotMatch(text, /@/);
  assert.match(text, /\[session\]/);
  assert.match(text, /\[email\]/);
});

dbTest("expireOpenCheckoutsCore: a listing failure is logged scrubbed and never throws", async ({ pro }) => {
  const broken = {
    select() {
      throw new Error("connection to jane.doe@example.com lost for cs_live_abc123");
    },
  } as unknown as Db;
  const logs: string[] = [];
  const report = await expireOpenCheckoutsCore(
    broken,
    pro.proId,
    async () => {
      throw new Error("expire must not be called when nothing was listed");
    },
    30_000,
    (line) => logs.push(line),
  );
  assert.deepEqual(report, { ...ZERO, listFailed: true });
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /cs_live_|@/);
  assert.match(logs[0], /\[email\]/);
  assert.match(logs[0], /\[session\]/);
});
