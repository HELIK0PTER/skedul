/**
 * The hold-lapse rule, in ONE place (P6 A12; spec § 11 E1, E11; P4 Decision 31; P3OUT:151). A pending booking holds its
 * seat while `hold_expires_at > now`. From `hold_expires_at` on (`hold_expires_at <= now`) the hold has lapsed: its seat
 * counts as free for every read, and the engine releases it on the next claim (R), in a cancel or a series edit, or in
 * the nightly sweep. Same instant rule as a ticket's `expires_at` (expired once `expires_at <= now`). A pending booking
 * without a readable hold end holds nothing (the schema forbids it: booking_pending_chk).
 *
 * Pure, no import: client components read it through planning-view.ts. Its SQL twin is src/lib/db/hold-sql.ts, which
 * the engine (atomic.ts, holds.ts) and the reads use; no other file compares hold_expires_at with a clock
 * (src/lib/hold-rule.test.ts).
 */

/** Whether a hold ending at `holdExpiresAt` is over at instant `at` (no readable end: over). */
export function holdEndedBy(holdExpiresAt: Date | null, at: Date): boolean {
  return holdExpiresAt === null || holdExpiresAt.getTime() <= at.getTime();
}

/** A pending booking whose hold has lapsed at `now`: its seat is free, the engine releases it. */
export function isLapsedHold(b: { status: string; holdExpiresAt: Date | null }, now: Date): boolean {
  return b.status === "pending" && holdEndedBy(b.holdExpiresAt, now);
}

/** A pending booking whose hold still runs at `now`: it holds its seat. */
export function isLiveHold(b: { status: string; holdExpiresAt: Date | null }, now: Date): boolean {
  return b.status === "pending" && !holdEndedBy(b.holdExpiresAt, now);
}

/** A booking a séance still counts on at `now`: confirmed, or pending with a live hold. */
export function holdsSeatAt(b: { status: string; holdExpiresAt: Date | null }, now: Date): boolean {
  return b.status === "confirmed" || isLiveHold(b, now);
}
