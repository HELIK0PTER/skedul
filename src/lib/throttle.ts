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

/** The first 32 hex characters of sha256(normalizeEmail(email)): an address never reaches a key in clear, and the digest survives the daily IP salt rotation. */
function emailDigest(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);
}

/** `t:<action>:ip:<ipHash>` / `t:<action>:e:<sha256(normalizedEmail) first 32 hex>`; actions "otp" and "reset" are the auth mail caps. */
export function throttleKey(action: ThrottleAction | "otp" | "reset", kind: "ip" | "email", value: string): string {
  if (kind === "ip") return `t:${action}:ip:${value}`;
  return `t:${action}:e:${emailDigest(value)}`;
}

export function otpThrottleKey(email: string): string {
  return throttleKey("otp", "email", email);
}

/** Password-reset mails per address; its own counter, so reset spam cannot use up the sign-in codes of the same address. */
export function resetThrottleKey(email: string): string {
  return throttleKey("reset", "email", email);
}

/** Client e-mails sent from a pro's actions (src/lib/mail-budget.ts): one counter per pro, so one pro never spends another one's budget. */
export function proMailThrottleKey(professionalId: string): string {
  return `t:mail:p:${professionalId}`;
}

/**
 * Atomic upsert on `throttle` (one statement) that counts `by` hits at once and
 * returns the hits of the window after them: a new window opens with `by` hits
 * when the previous one has elapsed, else `by` is added to it.
 */
export async function hitThrottle(db: ThrottleDb, key: string, by: number, windowSec: number, now: Date): Promise<number> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const elapsed = sql`throttle.window_start <= ${at} - make_interval(secs => ${windowSec}::int)`;
  const result = await db.execute<{ hits: number }>(sql`
    insert into throttle (key, window_start, hits) values (${key}, ${at}, ${by}::int)
    on conflict (key) do update set
      window_start = case when ${elapsed} then ${at} else throttle.window_start end,
      hits = case when ${elapsed} then ${by}::int else throttle.hits + ${by}::int end
    returning hits`);
  return Number(result.rows[0]?.hits);
}

/** Atomic upsert on `throttle` (one statement); true while hits ≤ limit. */
export async function consumeThrottle(db: ThrottleDb, key: string, limit: ThrottleLimit, now: Date): Promise<boolean> {
  return (await hitThrottle(db, key, 1, limit.windowSec, now)) <= limit.limit;
}

/** What `ipHash()` of src/lib/visitor-hash.ts returns: 32 lower-case hex characters. Anything else (a raw address, a bucket text) is refused before a key is built. */
export const IP_HASH_RE = /^[0-9a-f]{32}$/;

/** A typed address (per-pro and global e-mail keys) or a verified identity (its user key only: strangers typing the address cannot lock it out). */
export type ThrottleSubject = { kind: "email"; email: string } | { kind: "user"; userId: string };

/** The actions that take a seat: their per-séance IP key needs the séance (THROTTLE_LIMITS[action].perOccurrenceIp is not null for exactly these, pinned by throttle.test.ts). */
export type SeatTakingThrottleAction = "buybook" | "free";

type ActionThrottleBase = {
  professionalId: string;
  /** ipHash(daily salt, ipBuckets(ip).narrow), never an address */
  ipHash: string;
  /** ipHash(daily salt, ipBuckets(ip).wide), null for IPv4 */
  wideIpHash: string | null;
  subject: ThrottleSubject;
};

/**
 * One throttled call. A seat-taking action (buybook, free) must name its séance: its per-séance IP key
 * is part of the limit, so the type refuses the call without it (a forgotten key would silently weaken
 * the limit, S33) and `actionThrottleKeys` throws on it at run time too. The other actions take no séance.
 */
export type ActionThrottleArgs =
  | (ActionThrottleBase & { action: SeatTakingThrottleAction; occurrenceId: string })
  | (ActionThrottleBase & { action: Exclude<ThrottleAction, SeatTakingThrottleAction>; occurrenceId?: string });

/**
 * Pure: every key and limit the action consumes, in this order: the IP key, the /48 key (when there is
 * one), then for a typed address the global e-mail key and the per-pro e-mail key, or for a verified
 * identity its user key, then the per-séance IP key (seat-taking actions) and the per-pro IP key (free
 * registrations and RDV bookings). Throws when a seat-taking action has no occurrence id.
 */
export function actionThrottleKeys(args: ActionThrottleArgs): { key: string; limit: number }[] {
  const { action, professionalId } = args;
  const limits = THROTTLE_LIMITS[action];
  if (limits.perOccurrenceIp !== null && !args.occurrenceId) throw new Error(`throttle: occurrenceId required for ${action}`);
  const keys: { key: string; limit: number }[] = [{ key: throttleKey(action, "ip", args.ipHash), limit: limits.ip }];
  if (args.wideIpHash !== null) keys.push({ key: `t:${action}:ip48:${args.wideIpHash}`, limit: limits.ip48 });
  if (args.subject.kind === "email") {
    const digest = emailDigest(args.subject.email);
    keys.push({ key: `t:${action}:e:${digest}`, limit: limits.emailGlobal });
    keys.push({ key: `t:${action}:e:${professionalId}:${digest}`, limit: limits.email });
  } else {
    keys.push({ key: `t:${action}:u:${args.subject.userId}`, limit: limits.email });
  }
  if (limits.perOccurrenceIp !== null) {
    keys.push({ key: `t:${action}:o:${args.occurrenceId}:ip:${args.ipHash}`, limit: limits.perOccurrenceIp });
  }
  if (limits.perProIp !== null) {
    keys.push({ key: `t:${action}:p:${professionalId}:ip:${args.ipHash}`, limit: limits.perProIp });
  }
  return keys;
}

/** Throws (nothing consumed) when ipHash or a non-null wideIpHash fails IP_HASH_RE, or when a seat-taking action has no occurrence id; else consumes every actionThrottleKeys entry in ONE Promise.all (THROTTLE_WINDOW_SEC); false if any is over. */
export async function checkActionThrottle(db: ThrottleDb, args: ActionThrottleArgs, now: Date): Promise<boolean> {
  if (!IP_HASH_RE.test(args.ipHash) || (args.wideIpHash !== null && !IP_HASH_RE.test(args.wideIpHash))) {
    throw new Error("checkActionThrottle: ipHash must be the 32 hex characters of ipHash()");
  }
  // Built before the first write: a forgotten occurrence id throws here, with nothing consumed.
  const keys = actionThrottleKeys(args);
  const results = await Promise.all(
    keys.map(({ key, limit }) => consumeThrottle(db, key, { limit, windowSec: THROTTLE_WINDOW_SEC }, now)),
  );
  return results.every(Boolean);
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
