/**
 * The page-view beacon on the real tables (P6 A8): a beacon is recorded with its pro and counted on its own throttle
 * key; past the IP limit, or past the /48 limit from another /64, it writes no page view. Each test uses a random salt,
 * so its throttle keys are its own; it removes the rows it wrote (its page views by pro, its throttle keys).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { createTestPro, dbTest, deleteTestUser, testIp, type Db } from "../test/db";

import { ipBuckets } from "./client-ip";
import { pageView, throttle } from "./db/schema";
import { recordPageView, type BeaconFacts } from "./page-view";
import { hitThrottle, trackThrottleKeys } from "./throttle";
import { THROTTLE_WINDOW_SEC, TRACK_THROTTLE_LIMITS } from "./tickets";
import { ipHash, visitorHash } from "./visitor-hash";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function beacon(slug: string, ip: string): BeaconFacts {
  return {
    userAgent: UA,
    secFetchSite: "same-origin",
    ownHost: "myskedul.com",
    ip,
    country: "FR",
    readBody: async () => JSON.stringify({ path: `/${slug}`, first: false }),
  };
}

function keysOf(salt: string, ip: string): { key: string; limit: number }[] {
  const { narrow, wide } = ipBuckets(ip);
  return trackThrottleKeys({ ipHash: ipHash(salt, narrow), wideIpHash: wide === null ? null : ipHash(salt, wide) });
}

async function viewsOf(db: Db, proId: string): Promise<{ visitorHash: string }[]> {
  return db.select({ visitorHash: pageView.visitorHash }).from(pageView).where(eq(pageView.professionalId, proId));
}

async function cleanUp(db: Db, proId: string, keys: readonly string[]): Promise<void> {
  await db.delete(pageView).where(eq(pageView.professionalId, proId));
  await db.execute(sql`delete from throttle where key = any(${sql.param([...keys])}::text[])`);
}

/** A random IPv6 /48 under the documentation prefix, as « 2001:db8:<group> ». */
function randomV6Prefix(): string {
  return `2001:db8:${randomBytes(2).toString("hex")}`;
}

dbTest("a beacon under the limits is recorded for its pro and counted once on its own IP key (P6 A8)", async ({ db, pro }) => {
  const salt = randomBytes(32).toString("hex");
  const ip = testIp();
  const keys = keysOf(salt, ip);
  try {
    const now = new Date();
    assert.equal(await recordPageView(db, beacon(pro.slug, ip), async () => salt, now), "recorded");
    assert.deepEqual(await viewsOf(db, pro.proId), [{ visitorHash: visitorHash({ salt, ip, userAgent: UA }) }]);
    assert.equal(keys.length, 1, "an IPv4 address has no /48 key");
    const [row] = await db.select().from(throttle).where(eq(throttle.key, keys[0].key));
    assert.equal(row?.hits, 1);
  } finally {
    await cleanUp(db, pro.proId, keys.map((k) => k.key));
  }
});

dbTest("past the IP limit, a beacon writes no page view; another address still gets through (P6 A8)", async ({ db, pro }) => {
  const salt = randomBytes(32).toString("hex");
  const ip = testIp();
  const other = testIp();
  const keys = [...keysOf(salt, ip), ...keysOf(salt, other)];
  try {
    const now = new Date();
    await hitThrottle(db, keys[0].key, TRACK_THROTTLE_LIMITS.ip, THROTTLE_WINDOW_SEC, now);
    assert.equal(await recordPageView(db, beacon(pro.slug, ip), async () => salt, now), "throttled");
    assert.deepEqual(await viewsOf(db, pro.proId), [], "no page view for the refused beacon");
    assert.equal(await recordPageView(db, beacon(pro.slug, other), async () => salt, now), "recorded");
    assert.equal((await viewsOf(db, pro.proId)).length, 1);
  } finally {
    await cleanUp(db, pro.proId, keys.map((k) => k.key));
  }
});

dbTest("past the /48 limit, an IPv6 beacon from another /64 of the same /48 writes no page view (P6 A8)", async ({ db, pro }) => {
  const salt = randomBytes(32).toString("hex");
  const prefix = randomV6Prefix();
  const first = `${prefix}:1::1`;
  const sibling = `${prefix}:2::1`;
  const keys = [...keysOf(salt, first), ...keysOf(salt, sibling)];
  try {
    const now = new Date();
    const [, wide] = keysOf(salt, first);
    assert.equal(wide.key, keysOf(salt, sibling)[1].key, "one /48 key for both /64");
    await hitThrottle(db, wide.key, TRACK_THROTTLE_LIMITS.ip48, THROTTLE_WINDOW_SEC, now);
    assert.equal(await recordPageView(db, beacon(pro.slug, sibling), async () => salt, now), "throttled");
    assert.deepEqual(await viewsOf(db, pro.proId), []);
  } finally {
    await cleanUp(db, pro.proId, [...new Set(keys.map((k) => k.key))]);
  }
});

dbTest("a page view goes to the pro of its slug and to no other pro (P6 A8)", async ({ db, pro }) => {
  const salt = randomBytes(32).toString("hex");
  const ip = testIp();
  const keys = keysOf(salt, ip);
  const otherPro = await createTestPro(db);
  try {
    assert.equal(await recordPageView(db, beacon(otherPro.slug, ip), async () => salt, new Date()), "recorded");
    assert.deepEqual(await viewsOf(db, pro.proId), [], "nothing on the harness pro");
    assert.equal((await viewsOf(db, otherPro.proId)).length, 1, "the view goes to the pro of the slug");
  } finally {
    await cleanUp(db, otherPro.proId, keys.map((k) => k.key));
    await deleteTestUser(db, otherPro.userId);
  }
});
