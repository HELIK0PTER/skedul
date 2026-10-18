/**
 * DB test harness (spec § 14). Run with:
 *   ./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none 'src/**\/*.db.test.ts'
 * --test-isolation=none: one process for the whole run. A per-file child is
 * killed or crashes silently during its ~9 s tsx import (no stack, file-level
 * "test failed"); one process pays that import once. No DB test mocks globals.
 * Skips when DATABASE_URL_TEST is unset; refuses to run when DATABASE_URL and
 * DATABASE_URL_TEST point at different hosts; builds the client only after
 * those guards. Each dbTest creates its own pro and deletes its user at the end
 * (the deleteUser cascade, rule R2), after checking I1–I6 for that pro.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { nanoid } from "nanoid";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import type * as schemaModule from "../lib/db/schema";

/** Same type as `Db` in src/lib/db/atomic.ts (Task 14); declared here because the harness lands first. */
export type Db = NeonHttpDatabase<typeof schemaModule>;

export const DB_SKIP: string | false = process.env.DATABASE_URL_TEST
  ? false
  : "DATABASE_URL_TEST is not set (.env.test)";

/** Pure guard, unit-tested in src/test/db-guard.test.ts. */
export function sameHost(a: string, b: string): boolean {
  return new URL(a).host === new URL(b).host;
}

let dbPromise: Promise<Db> | null = null;

export function getTestDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const testUrl = process.env.DATABASE_URL_TEST;
    const url = process.env.DATABASE_URL;
    if (!testUrl) throw new Error("DATABASE_URL_TEST is not set");
    if (!url || !sameHost(url, testUrl)) {
      throw new Error("Refusing to run: DATABASE_URL and DATABASE_URL_TEST point at different hosts.");
    }
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const schema = await import("../lib/db/schema");
    return drizzle({ client: neon(testUrl), schema });
  })();
  return dbPromise;
}

export type TestPro = { userId: string; proId: string; slug: string; tz: string; currency: string };

/** A pro (user role pro, e-mail verified) with default booking settings, Europe/Paris, eur. */
export async function createTestPro(db: Db, opts: { tz?: string } = {}): Promise<TestPro> {
  const schema = await import("../lib/db/schema");
  const tag = nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const userId = nanoid();
  const proId = nanoid();
  const tz = opts.tz ?? "Europe/Paris";
  await db.insert(schema.user).values({
    id: userId,
    name: `Pro ${tag}`,
    email: `pro-${tag}@skedul.test`,
    emailVerified: true,
    role: "pro",
  });
  await db.insert(schema.professional).values({
    id: proId,
    userId,
    slug: `t-${tag}`,
    businessName: `Test ${tag}`,
    timezone: tz,
    currency: "eur",
  });
  return { userId, proId, slug: `t-${tag}`, tz, currency: "eur" };
}

/** The deleteUser path: one DELETE FROM "user" (everything cascades from professional). */
export async function deleteTestUser(db: Db, userId: string): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`delete from "user" where id = ${userId}`);
}

export type DbHarness = { db: Db; pro: TestPro };

/**
 * node:test wrapper: skip without DATABASE_URL_TEST; fresh pro per test;
 * after `fn`: checkInvariants({ proId }) must be [] (wired by Task 15), then
 * the user is deleted (even when fn threw).
 */
export function dbTest(
  name: string,
  fn: (h: DbHarness, t: TestContext) => Promise<void>,
  opts: { timeout?: number; invariants?: boolean } = {},
): void {
  test(name, { skip: DB_SKIP, timeout: opts.timeout ?? 120_000 }, async (t) => {
    const db = await getTestDb();
    const pro = await createTestPro(db);
    try {
      await fn({ db, pro }, t);
      if (opts.invariants !== false) {
        const { checkInvariants } = await import("../lib/booking/invariants");
        assert.deepEqual(await checkInvariants(db, { proId: pro.proId }), [], "invariants I1–I6");
      }
    } finally {
      await deleteTestUser(db, pro.userId);
    }
  });
}

/** Settles every promise; the caller counts outcomes (concurrency tests). */
export function inParallel<T>(fns: readonly (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(fns.map((f) => f()));
}

export const addMinutes = (d: Date, n: number): Date => new Date(d.getTime() + n * 60_000);
export const addDaysMs = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** Unique lower-case test address (never collides across runs: rate limits and throttle rows persist). */
export function testEmail(tag = "c"): string {
  return `t-${tag}-${nanoid(8)}@skedul.test`.toLowerCase();
}

/** A random IP in 198.18.0.0/15 (benchmark range): one Better Auth rate-limit bucket per call. */
export function testIp(): string {
  const n = Math.floor(Math.random() * 131_072);
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
}
