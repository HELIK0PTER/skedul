/**
 * The SQL twin of the hold-lapse rule of src/lib/hold-rule.ts (P6 A12): a pending booking holds its seat while
 * `hold_expires_at > now` and has lapsed from `hold_expires_at` on. Every statement and read that asks whether a hold
 * still runs uses one of these fragments; atomic.ts imports it (R), so it imports nothing from atomic.ts.
 *
 * `b` is the booking table's alias (sql`b`, or sql`${booking}` in a drizzle select from booking); without it the
 * columns are unqualified (a statement on the booking table itself).
 */
import { sql, type SQL } from "drizzle-orm";

function col(name: "status" | "hold_expires_at", b?: SQL): SQL {
  return b ? sql`${b}.${sql.identifier(name)}` : sql`${sql.identifier(name)}`;
}

/** `now` as a timestamptz parameter: the cast of `ts()` (atomic.ts), written here so atomic.ts can import this module. */
function at(now: Date): SQL {
  return sql`${now.toISOString()}::timestamptz`;
}

/** A pending booking whose hold has lapsed at `now` (`hold_expires_at <= now`): its seat is free, the engine releases it. */
export function lapsedHold(now: Date, b?: SQL): SQL {
  return sql`(${col("status", b)} = 'pending' and ${col("hold_expires_at", b)} <= ${at(now)})`;
}

/** A pending booking whose hold still runs at `now` (`hold_expires_at > now`). */
export function liveHold(now: Date, b?: SQL): SQL {
  return sql`(${col("status", b)} = 'pending' and ${col("hold_expires_at", b)} > ${at(now)})`;
}

/** A booking a séance still counts on at `now`: confirmed, or pending with a live hold. */
export function holdsSeat(now: Date, b?: SQL): SQL {
  return sql`(${col("status", b)} = 'confirmed' or ${liveHold(now, b)})`;
}
