import type Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, packPurchase } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fulfillBooking, fulfillPackPurchase } from "@/lib/payments";
import { stripe } from "@/lib/stripe";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const kind = session.metadata?.kind;
    const referenceId = session.metadata?.referenceId;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;

    if (referenceId && kind === "pack") {
      await db
        .update(packPurchase)
        .set({
          stripeSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        })
        .where(eq(packPurchase.id, referenceId));
      await fulfillPackPurchase(referenceId);
    } else if (referenceId && kind === "booking") {
      await db
        .update(booking)
        .set({ stripeSessionId: session.id })
        .where(eq(booking.id, referenceId));
      await fulfillBooking(referenceId);
    }
  }

  return new Response("ok", { status: 200 });
}
