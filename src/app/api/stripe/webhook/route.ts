import type Stripe from "stripe";

import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

/**
 * Stripe webhook. Payments are rebuilt on the tickets engine in P4
 * (fulfillPurchase, releasePurchase); until then a verified event is only
 * logged and acknowledged, so Stripe does not retry it.
 */
export async function POST(request: Request) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Stripe not configured", { status: 200 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("[stripe] signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  console.warn(`[stripe] ${event.type} ignored: payments are being rebuilt`);
  return new Response("ok", { status: 200 });
}
