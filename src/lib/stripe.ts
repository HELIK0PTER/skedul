import "server-only";
import Stripe from "stripe";

import { env } from "@/lib/env";

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
