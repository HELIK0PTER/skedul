/**
 * Ticket validity (spec § 9). A ticket bought with an N-day or N-month offer
 * is valid through local day (purchase day + N), months clamped to the
 * month's end, and expires at the local midnight that follows. `expires_at`
 * stores that first invalid instant; a ticket is usable on an occurrence when
 * expires_at > starts_at.
 */
import { addDays, addMonthsClamped, instantAt, todayKey, type DateKey } from "@/lib/civil-date";
import type { ValidityUnit } from "@/lib/tickets";

export type Validity = { count: number; unit: ValidityUnit } | null;

/** First instant a ticket is no longer valid: local midnight after (local date of paidAt + N days or months, months clamped). null = no expiry. */
export function ticketExpiry(paidAt: Date, validity: Validity, tz: string): Date | null {
  if (validity === null) return null;
  const paidDay = todayKey(paidAt, tz);
  const lastDay =
    validity.unit === "month" ? addMonthsClamped(paidDay, validity.count) : addDays(paidDay, validity.count);
  return expiryFromLastDay(lastDay, tz);
}

/** From an offer/purchase snapshot. */
export function validityOf(row: { validityCount: number | null; validityUnit: ValidityUnit | null }): Validity {
  if (row.validityCount === null || row.validityUnit === null) return null;
  return { count: row.validityCount, unit: row.validityUnit };
}

/** Last valid local day (« valable jusqu'au 12/01 inclus »): local date of (expiresAt − 1 ms). */
export function lastValidDay(expiresAt: Date, tz: string): DateKey {
  return todayKey(new Date(expiresAt.getTime() - 1), tz);
}

/** expires_at for a pro-chosen last day (Offrir): local midnight after lastDay. */
export function expiryFromLastDay(lastDay: DateKey, tz: string): Date {
  return instantAt(addDays(lastDay, 1), 0, tz);
}

/** expiresAt null or expiresAt > startsAt. */
export function validAt(expiresAt: Date | null, startsAt: Date): boolean {
  return expiresAt === null || expiresAt.getTime() > startsAt.getTime();
}

/** validAt(ticketExpiry(now, validity, tz), startsAt). */
export function offerCovers(now: Date, validity: Validity, tz: string, startsAt: Date): boolean {
  return validAt(ticketExpiry(now, validity, tz), startsAt);
}
