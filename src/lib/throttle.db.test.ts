import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";

import { throttle } from "./db/schema";
import { createTestPro, dbTest, deleteTestUser, inParallel, testEmail } from "../test/db";
import {
  actionThrottleKeys,
  bumpHealth,
  checkActionThrottle,
  consumeThrottle,
  HEALTH_KEYS,
  hitThrottle,
  nextWindow,
  readHealth,
  setHealth,
  throttleKey,
  type ActionThrottleArgs,
  type ThrottleState,
} from "./throttle";
import { THROTTLE_WINDOW_SEC } from "./tickets";

type Db = Parameters<typeof consumeThrottle>[0];

const T0 = new Date("2026-10-12T10:00:00Z");
const later = (sec: number) => new Date(T0.getTime() + sec * 1000);

async function dropKeys(db: Db, keys: readonly string[]): Promise<void> {
  await db.execute(sql`delete from throttle where key = any(${sql.param([...keys])}::text[])`);
}

async function readRow(db: Db, key: string): Promise<ThrottleState | null> {
  const [row] = await db.select().from(throttle).where(eq(throttle.key, key));
  return row ? { windowStart: row.windowStart, hits: row.hits } : null;
}

dbTest("consumeThrottle allows `limit` hits per window, refuses the next, reopens after the window", async ({ db }) => {
  const key = `t:test:ip:${nanoid()}`;
  const limit = { limit: 3, windowSec: 3600 };
  try {
    const instants = [later(0), later(60), later(120), later(180), later(3600), later(3660)];
    const allowed: boolean[] = [];
    let twin: ThrottleState | null = null;
    for (const at of instants) {
      allowed.push(await consumeThrottle(db, key, limit, at));
      twin = nextWindow(twin, at, limit.windowSec);
    }
    assert.deepEqual(allowed, [true, true, true, false, true, true]);
    assert.deepEqual(await readRow(db, key), twin);
    assert.deepEqual(twin, { windowStart: later(3600), hits: 2 });
  } finally {
    await dropKeys(db, [key]);
  }
});

dbTest("concurrent consumes are counted exactly once each", async ({ db }) => {
  const key = `t:test:ip:${nanoid()}`;
  try {
    const results = await inParallel(
      Array.from({ length: 10 }, () => () => consumeThrottle(db, key, { limit: 5, windowSec: 3600 }, T0)),
    );
    const allowed = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
    assert.equal(results.filter((r) => r.status === "rejected").length, 0);
    assert.equal(allowed, 5);
    assert.equal((await readRow(db, key))?.hits, 10);
  } finally {
    await dropKeys(db, [key]);
  }
});

/** 32 random lower-case hex characters: a valid ipHash (the shared `testIpHash()` helper arrives with Task 5). */
function freshIpHash(): string {
  return randomBytes(16).toString("hex");
}

/** checkActionThrottle at T0 that remembers every key it can write, so the test drops its rows at the end. */
function hitter(db: Db, seen: Set<string>) {
  return (args: ActionThrottleArgs, now: Date = T0): Promise<boolean> => {
    for (const { key } of actionThrottleKeys(args)) seen.add(key);
    return checkActionThrottle(db, args, now);
  };
}

const typed = (email: string) => ({ kind: "email" as const, email });

dbTest("checkActionThrottle refuses anything but the 32 hex characters of an ipHash and writes nothing (OUT:109, S18)", async ({ db, pro }) => {
  const email = testEmail("thr");
  const good = freshIpHash();
  const bad: ActionThrottleArgs[] = [
    { action: "shop", professionalId: pro.proId, ipHash: "1.2.3.4", wideIpHash: null, subject: typed(email) },
    { action: "shop", professionalId: pro.proId, ipHash: "ABCDEF0123456789ABCDEF0123456789", wideIpHash: null, subject: typed(email) },
    { action: "shop", professionalId: pro.proId, ipHash: good.slice(1), wideIpHash: null, subject: typed(email) },
    { action: "shop", professionalId: pro.proId, ipHash: good, wideIpHash: "2001:db8:abcd::/48", subject: typed(email) },
    { action: "shop", professionalId: pro.proId, ipHash: good, wideIpHash: "", subject: typed(email) },
  ];
  const keys = new Set<string>();
  try {
    for (const args of bad) {
      for (const { key } of actionThrottleKeys(args)) keys.add(key);
      await assert.rejects(checkActionThrottle(db, args, T0), /ipHash must be the 32 hex characters of ipHash\(\)/);
    }
    for (const key of keys) assert.equal(await readRow(db, key), null, `${key} was written`);
    // the same call with valid hashes is accepted and writes its rows
    const ok = { action: "shop" as const, professionalId: pro.proId, ipHash: good, wideIpHash: freshIpHash(), subject: typed(email) };
    for (const { key } of actionThrottleKeys(ok)) keys.add(key);
    assert.equal(await checkActionThrottle(db, ok, T0), true);
    assert.equal((await readRow(db, `t:shop:ip:${good}`))?.hits, 1);
  } finally {
    await dropKeys(db, [...keys]);
  }
});

dbTest("the 21st request of one IP hash is refused whatever the e-mail (OUT:109)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const ip = freshIpHash();
  const call = (ipHash: string) =>
    hit({ action: "shop", professionalId: pro.proId, ipHash, wideIpHash: null, subject: typed(testEmail("thr")) });
  try {
    // 19 hits are already on this IP's key: the next call is the 20th, the one after the 21st.
    seen.add(throttleKey("shop", "ip", ip));
    await hitThrottle(db, throttleKey("shop", "ip", ip), 19, THROTTLE_WINDOW_SEC, T0);
    assert.deepEqual([await call(ip), await call(ip)], [true, false]);
    assert.equal((await readRow(db, throttleKey("shop", "ip", ip)))?.hits, 21);
    assert.equal(await call(freshIpHash()), true, "another IP hash is not affected");
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("the 7th request of one e-mail at one pro is refused while the same e-mail at another pro passes", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const email = testEmail("thr");
  const call = (professionalId: string) =>
    hit({ action: "shop", professionalId, ipHash: freshIpHash(), wideIpHash: null, subject: typed(`  ${email.toUpperCase()} `) });
  try {
    const first: boolean[] = [];
    for (let i = 0; i < 7; i++) first.push(await call(pro.proId));
    assert.deepEqual(first, [true, true, true, true, true, true, false]);
    assert.equal(await call(other.proId), true, "the other pro's per-pro key is its own");
    // the global key counted all eight, the e-mail being normalised before it is hashed
    assert.equal((await readRow(db, throttleKey("shop", "email", email)))?.hits, 8);
  } finally {
    await deleteTestUser(db, other.userId);
    await dropKeys(db, [...seen]);
  }
});

dbTest("the 21st request of one e-mail across pros is refused (global mailbox key)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const email = testEmail("thr");
  const globalKey = throttleKey("shop", "email", email);
  // The throttle table has no foreign key to professional: a made-up pro id only names a per-pro key.
  const call = (professionalId: string) =>
    hit({ action: "shop", professionalId, ipHash: freshIpHash(), wideIpHash: null, subject: typed(email) });
  try {
    seen.add(globalKey);
    await hitThrottle(db, globalKey, 19, THROTTLE_WINDOW_SEC, T0);
    assert.deepEqual([await call(pro.proId), await call(nanoid())], [true, false]);
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("a verified identity keeps its own key when strangers lock the typed-address keys (SEC-I6)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const email = testEmail("thr");
  const userId = nanoid();
  const asStranger = () =>
    hit({ action: "shop", professionalId: pro.proId, ipHash: freshIpHash(), wideIpHash: null, subject: typed(email) });
  try {
    const stranger: boolean[] = [];
    for (let i = 0; i < 7; i++) stranger.push(await asStranger());
    assert.deepEqual(stranger, [true, true, true, true, true, true, false], "the address is locked for typed requests");
    // The holder, signed in and verified, is throttled on her user key: she passes.
    const holder = await hit({
      action: "shop",
      professionalId: pro.proId,
      ipHash: freshIpHash(),
      wideIpHash: null,
      subject: { kind: "user", userId },
    });
    assert.equal(holder, true);
    assert.equal((await readRow(db, `t:shop:u:${userId}`))?.hits, 1);
    // and her request touched no e-mail key
    assert.equal((await readRow(db, throttleKey("shop", "email", email)))?.hits, 7);
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("the 3rd buy + book of one séance from one IP hash is refused, another séance or another IP passes (SEC-I1)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const ip = freshIpHash();
  const call = (occurrenceId: string, ipHash: string) =>
    hit({ action: "buybook", professionalId: pro.proId, ipHash, wideIpHash: null, occurrenceId, subject: typed(testEmail("thr")) });
  const occurrenceId = nanoid();
  try {
    assert.deepEqual([await call(occurrenceId, ip), await call(occurrenceId, ip), await call(occurrenceId, ip)], [true, true, false]);
    assert.equal(await call(nanoid(), ip), true, "another séance, same IP");
    assert.equal(await call(occurrenceId, freshIpHash()), true, "same séance, another IP");
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("free registrations are bounded per pro and per IP: the 7th is refused, another pro passes (SEC-I1)", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const ip = freshIpHash();
  // a new séance and a new address every time: only the per-pro IP key can refuse
  const call = (professionalId: string) =>
    hit({ action: "free", professionalId, ipHash: ip, wideIpHash: null, occurrenceId: nanoid(), subject: typed(testEmail("thr")) });
  try {
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) results.push(await call(pro.proId));
    assert.deepEqual(results, [true, true, true, true, true, true, false]);
    assert.equal(await call(other.proId), true, "the same IP at another pro");
  } finally {
    await deleteTestUser(db, other.userId);
    await dropKeys(db, [...seen]);
  }
});

dbTest("addresses of one IPv6 /48 share a key: the 61st request is refused (SEC-I1)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  const wide = freshIpHash();
  const call = (wideIpHash: string) =>
    hit({ action: "shop", professionalId: pro.proId, ipHash: freshIpHash(), wideIpHash, subject: typed(testEmail("thr")) });
  try {
    const wideKey = `t:shop:ip48:${wide}`;
    seen.add(wideKey);
    await hitThrottle(db, wideKey, 59, THROTTLE_WINDOW_SEC, T0);
    assert.deepEqual([await call(wide), await call(wide)], [true, false]);
    assert.equal(await call(freshIpHash()), true, "another /48");
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("held, cancel and release are throttled on their own limits (SEC-I2)", async ({ db, pro }) => {
  const seen = new Set<string>();
  const hit = hitter(db, seen);
  try {
    for (const [action, limit] of [["held", 10], ["cancel", 10], ["release", 30]] as const) {
      const userId = nanoid();
      const userKey = `t:${action}:u:${userId}`;
      seen.add(userKey);
      await hitThrottle(db, userKey, limit - 1, THROTTLE_WINDOW_SEC, T0);
      const call = () =>
        hit({ action, professionalId: pro.proId, ipHash: freshIpHash(), wideIpHash: null, subject: { kind: "user", userId } });
      assert.deepEqual([await call(), await call()], [true, false], action);
    }
  } finally {
    await dropKeys(db, [...seen]);
  }
});

dbTest("health counters: set, bump and read", async ({ db }) => {
  const key = HEALTH_KEYS.orphanPayments;
  const before = await readRow(db, key);
  try {
    await setHealth(db, key, 7, T0);
    await bumpHealth(db, key, 2, later(60));
    const health = await readHealth(db);
    assert.deepEqual(health[key], { value: 9, at: later(60) });
  } finally {
    if (before) {
      await db.update(throttle).set({ hits: before.hits, windowStart: before.windowStart }).where(eq(throttle.key, key));
    } else {
      await dropKeys(db, [key]);
    }
  }
});
