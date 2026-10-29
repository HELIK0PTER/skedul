/**
 * The page-view beacon core (P6 A8) against a fake database that records what is called: a beacon the tracker would
 * never send touches nothing, a beacon over either IP limit stops at the throttle (no pro lookup, no insert), and a
 * beacon under both is recorded once. The same paths on the real tables: src/lib/page-view.db.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf } from "@/test/source-guards";

import { ipBuckets } from "./client-ip";
import { recordPageView, type BeaconFacts } from "./page-view";
import { TRACK_THROTTLE_LIMITS } from "./tickets-vocab";
import { ipHash, visitorHash } from "./visitor-hash";

type Db = Parameters<typeof recordPageView>[0];

const NOW = new Date("2026-10-29T10:00:00Z");
const SALT = "a".repeat(64);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function factsOf(over: Partial<BeaconFacts> & { body?: string } = {}): BeaconFacts & { bodyReads: () => number } {
  let reads = 0;
  const body = over.body ?? JSON.stringify({ path: "/altinha-paris", first: true, referrer: "https://www.google.com/", source: "Newsletter" });
  return {
    userAgent: UA,
    secFetchSite: "same-origin",
    ownHost: "myskedul.com",
    ip: "203.0.113.7",
    country: "FR",
    readBody: async () => {
      reads++;
      return body;
    },
    ...over,
    bodyReads: () => reads,
  };
}

/** A database that answers nothing and lists every property read on it. */
function untouchedDb(): { db: Db; touched: string[] } {
  const touched: string[] = [];
  const db = new Proxy({}, {
    get: (_target, prop) => {
      touched.push(String(prop));
      throw new Error(`the database was touched (${String(prop)})`);
    },
  }) as Db;
  return { db, touched };
}

/** A database whose throttle upserts answer the given hit counts in turn, with the pro lookup and the insert recorded. */
function fakeDb(hits: number[]): { db: Db; calls: string[]; inserted: Record<string, unknown>[] } {
  const calls: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const queue = [...hits];
  const fake = {
    execute: async () => {
      calls.push("execute");
      return { rows: [{ hits: queue.shift() ?? 1 }] };
    },
    select: () => {
      calls.push("select");
      const chain = { from: () => chain, where: () => chain, limit: async () => [{ id: "pro_1" }] };
      return chain;
    },
    insert: () => {
      calls.push("insert");
      return {
        values: async (row: Record<string, unknown>) => {
          inserted.push(row);
        },
      };
    },
  };
  return { db: fake as unknown as Db, calls, inserted };
}

test("a beacon the tracker would never send is ignored before any salt, read or write; a refused header leaves the body unread", async () => {
  const headerRefusals: Partial<BeaconFacts>[] = [
    { userAgent: null },
    { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    { secFetchSite: "cross-site" },
  ];
  const bodyRefusals = [
    "not json",
    JSON.stringify({ first: true }),
    JSON.stringify({ path: "" }),
    JSON.stringify({ path: `/${"x".repeat(600)}` }),
    JSON.stringify({ path: "/altinha-paris", referrer: "r".repeat(2000) }),
    JSON.stringify({ path: "/dashboard" }),
    JSON.stringify({ path: "/api/track" }),
  ];
  const cases = [
    ...headerRefusals.map((over) => ({ facts: factsOf(over), readsBody: false })),
    ...bodyRefusals.map((body) => ({ facts: factsOf({ body }), readsBody: true })),
  ];
  for (const [i, { facts, readsBody }] of cases.entries()) {
    const { db, touched } = untouchedDb();
    let salts = 0;
    const outcome = await recordPageView(db, facts, async () => {
      salts++;
      return SALT;
    }, NOW);
    assert.equal(outcome, "ignored", `case ${i}`);
    assert.deepEqual(touched, [], `case ${i}: no database call`);
    assert.equal(salts, 0, `case ${i}: no salt read`);
    assert.equal(facts.bodyReads(), readsBody ? 1 : 0, `case ${i}: body reads`);
  }
});

test("over the IP limit, the beacon stops at the throttle: no pro lookup, no page view written (P6 A8)", async () => {
  const { db, calls, inserted } = fakeDb([TRACK_THROTTLE_LIMITS.ip + 1]);
  assert.equal(await recordPageView(db, factsOf(), async () => SALT, NOW), "throttled");
  assert.deepEqual(calls, ["execute"], "one upsert on the IPv4 key, nothing after it");
  assert.deepEqual(inserted, []);
});

test("over the /48 limit, an IPv6 beacon from another /64 stops at the throttle too (P6 A8)", async () => {
  const { db, calls, inserted } = fakeDb([1, TRACK_THROTTLE_LIMITS.ip48 + 1]);
  assert.equal(await recordPageView(db, factsOf({ ip: "2001:db8:abcd:12::1" }), async () => SALT, NOW), "throttled");
  assert.deepEqual(calls, ["execute", "execute"], "both IP keys counted at once, nothing after them");
  assert.deepEqual(inserted, []);
});

test("at the limit the beacon is still recorded: one hit per IP key, then the pro lookup and one insert", async () => {
  const { db, calls, inserted } = fakeDb([TRACK_THROTTLE_LIMITS.ip, TRACK_THROTTLE_LIMITS.ip48]);
  const facts = factsOf({ ip: "2001:db8:abcd:12::1" });
  assert.equal(await recordPageView(db, facts, async () => SALT, NOW), "recorded");
  assert.deepEqual(calls, ["execute", "execute", "select", "insert"]);
  assert.deepEqual(inserted, [
    {
      path: "/altinha-paris",
      professionalId: "pro_1",
      referrerHost: "google.com",
      source: "newsletter",
      entry: true,
      device: "desktop",
      country: "FR",
      visitorHash: visitorHash({ salt: SALT, ip: "2001:db8:abcd:12::1", userAgent: UA }),
    },
  ]);
});

test("a beacon with no client address is counted on the « unknown » bucket and hashed as 0.0.0.0, as before", async () => {
  const { db, calls, inserted } = fakeDb([1]);
  assert.equal(await recordPageView(db, factsOf({ ip: null, country: "not a country" }), async () => SALT, NOW), "recorded");
  assert.deepEqual(calls, ["execute", "select", "insert"]);
  assert.equal(inserted[0].visitorHash, visitorHash({ salt: SALT, ip: "0.0.0.0", userAgent: UA }));
  assert.equal(inserted[0].country, null);
  assert.equal(ipBuckets(null).narrow, "unknown");
  assert.notEqual(ipHash(SALT, "unknown"), ipHash(SALT, "0.0.0.0"));
});

test("the /api/track route is a thin wrapper: it reads the headers and the address, the core does the rest, and it always answers 204", () => {
  const route = readFileSync("src/app/api/track/route.ts", "utf8");
  const post = bodyOf(route, "POST");
  assert.match(post, /await recordPageView\(\s*db,/);
  assert.match(post, /ip: clientIpFrom\(request\.headers\),/);
  assert.match(post, /readBody: \(\) => request\.text\(\),/);
  assert.match(post, /\(\) => getDailySalt\(dayKeyInTz\(now, ADMIN_TZ\)\)/);
  assert.doesNotMatch(route, /\.insert\(|\.select\(|x-forwarded-for|x-real-ip/, "no read, write or address parsing of its own");
  assert.match(post, /console\.error\(`\[track\] could not record page view: \$\{logSafeMessage\(err\)\}`\);/);
  assert.match(post, /return noContent\(\);\s*\}\s*$/);
});
