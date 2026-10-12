import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { throttle } from "./db/schema";
import { dbTest, inParallel, testEmail } from "../test/db";
import {
  bumpHealth,
  checkActionThrottle,
  consumeThrottle,
  HEALTH_KEYS,
  nextWindow,
  readHealth,
  setHealth,
  throttleKey,
  type ThrottleState,
} from "./throttle";

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

dbTest("checkActionThrottle caps an e-mail at 6 per hour and an IP at 20 per hour", async ({ db }) => {
  const ip = nanoid(32);
  const otherIp = nanoid(32);
  const emails = Array.from({ length: 4 }, () => testEmail("thr"));
  const keys = [
    throttleKey("free", "ip", ip),
    throttleKey("free", "ip", otherIp),
    ...emails.map((e) => throttleKey("free", "email", e)),
  ];
  try {
    const first: boolean[] = [];
    for (let i = 0; i < 7; i++) first.push(await checkActionThrottle(db, { action: "free", ipHash: ip, email: emails[0] }, T0));
    assert.deepEqual(first, [true, true, true, true, true, true, false]);
    // Same IP, other addresses: the IP key reaches 20 on the 20th call overall.
    const more: boolean[] = [];
    for (let i = 0; i < 14; i++) {
      more.push(await checkActionThrottle(db, { action: "free", ipHash: ip, email: emails[1 + Math.floor(i / 6)] }, T0));
    }
    assert.deepEqual(more.slice(0, 13), Array(13).fill(true));
    assert.equal(more[13], false, "21st call from the IP");
    assert.equal((await readRow(db, keys[0]))?.hits, 21);
    // The e-mail is normalised before hashing.
    assert.equal(await checkActionThrottle(db, { action: "free", ipHash: otherIp, email: emails[0].toUpperCase() }, later(60)), false);
  } finally {
    await dropKeys(db, keys);
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
