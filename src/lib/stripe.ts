import "server-only";
import Stripe from "stripe";

import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";
import {
  closeOutcomeOf,
  isMockSession,
  mockCheckoutAllowed,
  mockCheckoutUrl,
  mockSessionId,
  paymentModeOf,
  stripeSessionParams,
  type CheckoutGateway,
  type PaymentMode,
} from "@/lib/payments/checkout";

/**
 * Stripe client. `null` when no real key is configured: the app then runs in
 * "mock payment" mode (checkout is simulated locally, see /api/mock-checkout).
 */
export const stripe = env.STRIPE_ENABLED
  ? new Stripe(env.STRIPE_SECRET_KEY!, { typescript: true })
  : null;

/** paymentModeOf(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED): "mock", "test" or "live". */
export function paymentMode(): PaymentMode {
  return paymentModeOf(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED);
}

/**
 * Whether the simulated checkout may be reached: no Stripe keys AND neither APP_ENV nor VERCEL_ENV says production
 * (the one rule, Decision 27, SEC-I5). Used by the mock route and by publicDeps; no other file reads APP_ENV for payments.
 */
export function mockCheckoutEnabled(): boolean {
  return mockCheckoutAllowed({
    STRIPE_ENABLED: env.STRIPE_ENABLED,
    APP_ENV: env.APP_ENV,
    VERCEL_ENV: env.VERCEL_ENV,
  });
}

/** Stripe request options of « Libérer ma place »: a visitor is waiting, so one short try and one retry. */
const RELEASE_OPTIONS = { timeout: 10_000, maxNetworkRetries: 1 } as const;

function stripeGateway(client: Stripe, mode: PaymentMode): CheckoutGateway {
  return {
    mode,
    async create(req) {
      const session = await client.checkout.sessions.create(stripeSessionParams(req), {
        idempotencyKey: `checkout:${req.purchaseId}`,
      });
      if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
      return { sessionId: session.id, url: session.url };
    },
    async closeForRelease(sessionId) {
      if (isMockSession(sessionId)) return "mock";
      try {
        const session = await client.checkout.sessions.retrieve(sessionId, undefined, RELEASE_OPTIONS);
        const outcome = closeOutcomeOf(session);
        if (outcome !== "open") return outcome;
        await client.checkout.sessions.expire(sessionId, undefined, RELEASE_OPTIONS);
        return "expired";
      } catch (err) {
        console.error("[stripe] close failed: " + logSafeMessage(err));
        return "failed";
      }
    },
    async expire(sessionId) {
      await expireCheckoutSession(sessionId);
    },
  };
}

/** The simulated checkout: no network, the session id is `mock_<purchaseId>` and the URL is the mock route (Decision 29). */
const mockGateway: CheckoutGateway = {
  mode: "mock",
  async create(req) {
    return { sessionId: mockSessionId(req.purchaseId), url: mockCheckoutUrl(env.APP_URL, req.purchaseId) };
  },
  async closeForRelease() {
    return "mock";
  },
  async expire() {
    // a simulated session is never open anywhere: nothing to close
  },
};

/** Stripe when configured, else the mock: create = { sessionId: mockSessionId(id), url: mockCheckoutUrl(env.APP_URL, id) }, closeForRelease = "mock", expire = no-op. */
export const checkoutGateway: CheckoutGateway = stripe ? stripeGateway(stripe, paymentMode()) : mockGateway;

/**
 * Best effort: closes a still-open Checkout session whose seat ended (the
 * pending purchase of a cancelled or released booking), so the client cannot
 * pay for a seat that no longer exists. "mock" for a simulated session id or
 * when Stripe is off; "not_open" when the session is already complete or
 * expired (retrieved first, so Stripe is never asked to expire what is not
 * open); "expired" after sessions.expire; "failed" on any error. Never throws.
 *
 * "not_open" stands for a complete session (possibly paid) as well as an
 * expired one (LED:429): the two best-effort callers count it as « can no longer
 * be paid » and never touch a booking on it. A release decision reads
 * checkoutGateway.closeForRelease instead.
 *
 * `options` are Stripe per-request options applied to both calls. Without them
 * the client defaults apply (80 s timeout, 2 retries), which suits a background
 * effect; the account deletion passes a short timeout and no retry so that a
 * hung Stripe cannot hold it (DELETION_STRIPE_OPTIONS, src/lib/admin-deletion.ts).
 */
export async function expireCheckoutSession(
  checkoutSessionId: string,
  options?: { timeout?: number; maxNetworkRetries?: number },
): Promise<"expired" | "not_open" | "mock" | "failed"> {
  if (isMockSession(checkoutSessionId) || !stripe) return "mock";
  try {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, undefined, options);
    if (session.status !== "open") return "not_open";
    await stripe.checkout.sessions.expire(checkoutSessionId, undefined, options);
    return "expired";
  } catch (err) {
    console.error(`[stripe] expire failed: ${logSafeMessage(err)}`);
    return "failed";
  }
}
