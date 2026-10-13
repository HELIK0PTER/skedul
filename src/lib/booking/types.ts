/**
 * Engine result shapes. The engine never sends e-mails and never calls Stripe
 * or Google: it returns effect descriptors that carry ids only, executed after
 * commit by src/server/notify.ts (P3/P4), which re-reads names, dates and
 * amounts by id.
 */
import type { EngineErrorCode } from "@/lib/tickets";

export type Effect =
  /** client: confirmation of a booking, whatever its coverage */
  | { type: "email.booking_confirmed"; bookingId: string }
  /** pro: a client booked (never when the pro registered someone) */
  | { type: "email.pro_new_booking"; bookingId: string }
  /** client: their booking was cancelled (by themselves or by the pro) */
  | { type: "email.booking_cancelled"; bookingId: string; by: "client" | "pro" }
  /** pro: a client cancelled */
  | { type: "email.pro_booking_cancelled"; bookingId: string }
  /** clients of a cancelled séance (tickets given back) */
  | { type: "email.occurrence_cancelled"; occurrenceId: string; bookingIds: string[] }
  /** clients of a séance whose date, time, duration, title or effective location changed */
  | { type: "email.occurrence_changed"; occurrenceId: string; bookingIds: string[] }
  /** client moved by the pro */
  | { type: "email.attendee_moved"; bookingId: string; fromOccurrenceId: string }
  /** receipt with expiry, after a fulfilled purchase */
  | { type: "email.purchase_receipt"; purchaseId: string }
  /** paid after the hold ended: the tickets went to the wallet */
  | { type: "email.late_payment"; purchaseId: string }
  /** optional e-mail after « Offrir » */
  | { type: "email.tickets_offered"; customerId: string; actionId: string; quantity: number }
  /** re-sync the Google event of this occurrence (P3) */
  | { type: "google.sync_occurrence"; occurrenceId: string }
  /** expire a still-open Checkout session (pending purchase whose seat ended) */
  | { type: "stripe.expire_session"; purchaseId: string; checkoutSessionId: string };

export type EngineOk<T extends object = object> = { ok: true; effects: Effect[] } & T;
export type EngineFail = { ok: false; code: EngineErrorCode; message?: string };
export type EngineResult<T extends object = object> = EngineOk<T> | EngineFail;

/** A pro acting from the back-office. */
export type ProActor = { professionalId: string; userId: string };

/** One google.sync_occurrence effect per distinct occurrence id, in first-seen order. */
export function syncEffects(occurrenceIds: readonly string[]): Effect[] {
  return [...new Set(occurrenceIds)].map(
    (occurrenceId): Effect => ({ type: "google.sync_occurrence", occurrenceId }),
  );
}

/** `{ ok: false, code }`, with `message` only when one is given. */
export function fail(code: EngineErrorCode, message?: string): EngineFail {
  return message === undefined ? { ok: false, code } : { ok: false, code, message };
}

/**
 * A failed `tryAtomic` outcome as an engine failure. `duplicate`
 * (skedul:already_paid) only means something to fulfillment, which handles it
 * itself; anywhere else it is reported as `stale`.
 */
export function failOf(res: { ok: false; code: EngineErrorCode | "duplicate"; message?: string }): EngineFail {
  return res.code === "duplicate" ? fail("stale") : fail(res.code, res.message);
}
