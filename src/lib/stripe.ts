import "server-only";
import Stripe from "stripe";

import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/notify-core";

/**
 * Stripe client. `null` when no real key is configured — the app then runs in
 * "mock payment" mode (checkout is simulated locally, see /api/mock-checkout).
 */
export const stripe = env.STRIPE_ENABLED
  ? new Stripe(env.STRIPE_SECRET_KEY!, { typescript: true })
  : null;

export const isStripeLive = env.STRIPE_ENABLED;

type CheckoutKind = "pack" | "booking";

interface CheckoutParams {
  kind: CheckoutKind;
  /** purchaseId for packs, bookingId for bookings */
  referenceId: string;
  productName: string;
  description?: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Returns a URL the client should be redirected to in order to pay.
 * - Live mode  → a real Stripe Checkout Session URL.
 * - Mock mode  → a local route that fulfills the order and redirects to success.
 */
export async function createCheckoutUrl(params: CheckoutParams): Promise<string> {
  if (!stripe) {
    const u = new URL("/api/mock-checkout", env.APP_URL);
    u.searchParams.set("kind", params.kind);
    u.searchParams.set("ref", params.referenceId);
    u.searchParams.set("redirect", params.successUrl);
    return u.toString();
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    customer_email: params.customerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: params.amountCents,
          product_data: {
            name: params.productName,
            ...(params.description
              ? { description: params.description }
              : {}),
          },
        },
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { kind: params.kind, referenceId: params.referenceId },
  };

  const checkout = await stripe.checkout.sessions.create(sessionParams);
  return checkout.url!;
}

/**
 * Best effort: closes a still-open Checkout session whose seat ended (the
 * pending purchase of a cancelled or released booking), so the client cannot
 * pay for a seat that no longer exists. "mock" when Stripe is off; "not_open"
 * when the session is already complete or expired (retrieved first, so Stripe
 * is never asked to expire what is not open); "expired" after sessions.expire;
 * "failed" on any error. Never throws.
 */
export async function expireCheckoutSession(
  checkoutSessionId: string,
): Promise<"expired" | "not_open" | "mock" | "failed"> {
  if (!stripe) return "mock";
  try {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    if (session.status !== "open") return "not_open";
    await stripe.checkout.sessions.expire(checkoutSessionId);
    return "expired";
  } catch (err) {
    console.error(`[stripe] expire failed: ${logSafeMessage(err)}`);
    return "failed";
  }
}
