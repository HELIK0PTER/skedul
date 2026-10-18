/**
 * Application rate limits (spec § 12) and the admin health counters, both on
 * the `throttle` table (no professional_id). One fixed window per key: a
 * single atomic upsert either opens a new window or counts one more hit, so
 * concurrent requests are counted exactly. No IP or e-mail is stored in
 * clear: the caller hashes the IP with the day's salt (`ipHash`,
 * src/lib/visitor-hash.ts); the e-mail is hashed here with an unsalted
 * sha256, so its cap survives the daily salt rotation.
 * `health:*` rows hold counters, not windows: the nightly purge (E12) must
 * skip them. No server-only: the auth hook, the actions and the tests use it.
 */
import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";
import { normalizeEmail, THROTTLE_LIMITS, THROTTLE_WINDOW_SEC, type ThrottleAction } from "@/lib/tickets";

/** Same type as `Db` of src/lib/db/atomic.ts (Task 14), declared here because this module comes first. */
type ThrottleDb = NeonHttpDatabase<typeof schema>;

export type ThrottleState = { windowStart: Date; hits: number };
export type ThrottleLimit = { limit: number; windowSec: number };

/** Pure twin of the SQL upsert: a new window when prev is null or windowStart ≤ now − windowSec, else hits + 1. */
export function nextWindow(prev: ThrottleState | null, now: Date, windowSec: number): ThrottleState {
  if (prev === null || prev.windowStart.getTime() <= now.getTime() - windowSec * 1000) {
    return { windowStart: now, hits: 1 };
  }
  return { windowStart: prev.windowStart, hits: prev.hits + 1 };
}

/** `t:<action>:ip:<ipHash>` / `t:<action>:e:<sha256(normalizedEmail) first 32 hex>`; actions "otp" and "reset" are the auth mail caps. */
export function throttleKey(action: ThrottleAction | "otp" | "reset", kind: "ip" | "email", value: string): string {
  if (kind === "ip") return `t:${action}:ip:${value}`;
  const digest = createHash("sha256").update(normalizeEmail(value)).digest("hex").slice(0, 32);
  return `t:${action}:e:${digest}`;
}

export function otpThrottleKey(email: string): string {
  return throttleKey("otp", "email", email);
}

/** Password-reset mails per address; its own counter, so reset spam cannot use up the sign-in codes of the same address. */
export function resetThrottleKey(email: string): string {
  return throttleKey("reset", "email", email);
}

/** Atomic upsert on `throttle` (one statement); true while hits ≤ limit. */
export async function consumeThrottle(db: ThrottleDb, key: string, limit: ThrottleLimit, now: Date): Promise<boolean> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const elapsed = sql`throttle.window_start <= ${at} - make_interval(secs => ${limit.windowSec}::int)`;
  const result = await db.execute<{ hits: number }>(sql`
    insert into throttle (key, window_start, hits) values (${key}, ${at}, 1)
    on conflict (key) do update set
      window_start = case when ${elapsed} then ${at} else throttle.window_start end,
      hits = case when ${elapsed} then 1 else throttle.hits + 1 end
    returning hits`);
  return Number(result.rows[0]?.hits) <= limit.limit;
}

/** P4 actions: consumes the IP key and the e-mail key (THROTTLE_LIMITS, THROTTLE_WINDOW_SEC); false if either is over. */
export async function checkActionThrottle(
  db: ThrottleDb,
  args: { action: ThrottleAction; ipHash: string; email: string },
  now: Date,
): Promise<boolean> {
  const limits = THROTTLE_LIMITS[args.action];
  const [ipOk, emailOk] = await Promise.all([
    consumeThrottle(db, throttleKey(args.action, "ip", args.ipHash), { limit: limits.ip, windowSec: THROTTLE_WINDOW_SEC }, now),
    consumeThrottle(db, throttleKey(args.action, "email", args.email), { limit: limits.email, windowSec: THROTTLE_WINDOW_SEC }, now),
  ]);
  return ipOk && emailOk;
}

/* ───────────────────────── Health counters ───────────────────────── */

export const HEALTH_KEYS = {
  orphanPayments: "health:orphan_payments",
  invariantViolations: "health:invariant_violations",
} as const;
export type HealthKey = (typeof HEALTH_KEYS)[keyof typeof HEALTH_KEYS];

/** value += by; window_start = now (time of the last change). */
export async function bumpHealth(db: ThrottleDb, key: HealthKey, by: number, now: Date): Promise<void> {
  await db.execute(sql`
    insert into throttle (key, window_start, hits) values (${key}, ${now.toISOString()}::timestamptz, ${by}::int)
    on conflict (key) do update set hits = throttle.hits + excluded.hits, window_start = excluded.window_start`);
}

/** value = value; window_start = now. */
export async function setHealth(db: ThrottleDb, key: HealthKey, value: number, now: Date): Promise<void> {
  await db.execute(sql`
    insert into throttle (key, window_start, hits) values (${key}, ${now.toISOString()}::timestamptz, ${value}::int)
    on conflict (key) do update set hits = excluded.hits, window_start = excluded.window_start`);
}

export async function readHealth(db: ThrottleDb): Promise<Partial<Record<HealthKey, { value: number; at: Date }>>> {
  const keys: HealthKey[] = Object.values(HEALTH_KEYS);
  const rows = await db.select().from(schema.throttle).where(inArray(schema.throttle.key, keys));
  const out: Partial<Record<HealthKey, { value: number; at: Date }>> = {};
  for (const row of rows) {
    const key = keys.find((k) => k === row.key);
    if (key) out[key] = { value: row.hits, at: row.windowStart };
  }
  return out;
}
