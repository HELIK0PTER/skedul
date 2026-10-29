/**
 * E13, the testable core of the account deletion: before `DELETE FROM "user"`,
 * the open Stripe Checkout sessions of the pro page are expired so that no client
 * can pay a purchase that is about to disappear. Best effort and bounded: a hung or
 * failing Stripe must never block a deletion the admin confirmed (a payment that
 * still lands is an orphan, counted by healthCounts and refunded by hand).
 *
 * Plain module (no server-only, no next/*, no env): `expire` is passed in
 * (`expireCheckoutSession` of src/lib/stripe.ts in production), so the DB test
 * can drive it with stubs.
 */
import { pendingCheckoutSessions } from "@/lib/booking/account";
import type { Db } from "@/lib/db/atomic";
import { logSafeMessage } from "@/lib/log-safe";

/** What expireCheckoutSession answers (src/lib/stripe.ts); it never throws. */
export type ExpireOutcome = "expired" | "not_open" | "mock" | "failed";

/** Per-request Stripe options of the deletion path: a hung Stripe costs 8 s per call and is never retried. */
export const DELETION_STRIPE_OPTIONS = { timeout: 8_000, maxNetworkRetries: 0 } as const;

/** The whole expiry step (listing included) stops here, and the deletion goes on. */
export const CHECKOUT_EXPIRY_DEADLINE_MS = 15_000;

export type CheckoutExpiryReport = {
  /** Open sessions listed for the pro. */
  total: number;
  /** Sessions that can no longer be paid: expired now, already complete or expired, or Stripe is mocked. */
  closed: number;
  /** Sessions Stripe could not expire (it answered « failed », or the expire call threw). */
  failed: number;
  /** Sessions still unanswered when the deadline hit. */
  unfinished: number;
  /** The deadline ended the step. */
  timedOut: boolean;
  /** The sessions could not be listed (nothing was tried). */
  listFailed: boolean;
};

/**
 * Lists the pro's pending purchases that hold a Checkout session and expires them
 * all at once. Never throws and never outlives `deadlineMs`; a late answer after
 * the deadline is ignored. `log` receives scrubbed lines only (logSafeMessage:
 * no e-mail address, no session id).
 */
export async function expireOpenCheckoutsCore(
  db: Db,
  professionalId: string,
  expire: (checkoutSessionId: string) => Promise<ExpireOutcome>,
  deadlineMs: number = CHECKOUT_EXPIRY_DEADLINE_MS,
  log: (line: string) => void = console.error,
): Promise<CheckoutExpiryReport> {
  const live: CheckoutExpiryReport = { total: 0, closed: 0, failed: 0, unfinished: 0, timedOut: false, listFailed: false };

  const work = (async () => {
    let sessions: { checkoutSessionId: string }[];
    try {
      sessions = await pendingCheckoutSessions(db, professionalId);
    } catch (err) {
      live.listFailed = true;
      log(`[admin] could not list the open checkout sessions to expire: ${logSafeMessage(err)}`);
      return;
    }
    live.total = sessions.length;
    await Promise.allSettled(
      sessions.map(async ({ checkoutSessionId }) => {
        let outcome: ExpireOutcome;
        try {
          outcome = await expire(checkoutSessionId);
        } catch (err) {
          log(`[admin] a checkout session could not be expired: ${logSafeMessage(err)}`);
          outcome = "failed";
        }
        if (outcome === "failed") live.failed += 1;
        else live.closed += 1;
      }),
    );
  })().catch((err) => {
    log(`[admin] checkout expiry stopped unexpectedly: ${logSafeMessage(err)}`);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), deadlineMs);
  });
  try {
    if ((await Promise.race([work, deadline])) === "deadline") live.timedOut = true;
  } finally {
    clearTimeout(timer);
  }
  // a snapshot: answers that come in after the deadline must not change what was reported
  return { ...live, unfinished: live.total - live.closed - live.failed };
}
