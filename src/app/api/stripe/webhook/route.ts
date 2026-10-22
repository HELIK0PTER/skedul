import { after } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";
import { handleStripeEvent, verifyWebhook, type StripeEventLike, type WebhookOutcome } from "@/lib/payments/webhook-core";
import { paymentMode, stripe } from "@/lib/stripe";
import { runEffects } from "@/server/notify";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function reply(body: string, status: number): Response {
  return new Response(body, { status, headers: NO_STORE });
}

/**
 * Stripe webhook (spec E10, E11, contract § 3.12). Stripe off: 404. Stripe on
 * without its signing secret: 500 and one log line (Stripe keeps retrying
 * while the owner fixes it, never a silent 200). The signature is checked on
 * the RAW body, so the body is read as text and never parsed first. A bad or
 * missing signature: 400 and the reason only. The event goes to the tested
 * handler with the deployment's environment and payment mode; an unexpected
 * throw is a 500 (Stripe retries), logged through logSafeMessage, never as a
 * raw error object. Every other outcome, `ignored` and `orphan` included, is a
 * 200. The effects (receipt, confirmation or late-payment notice, the pro's
 * notice, Google) run after the response with the budget "none": they are the
 * client's due and never count against a pro (Decision 74).
 */
export async function POST(request: Request): Promise<Response> {
  const client = stripe;
  if (!env.STRIPE_ENABLED || !client) return reply("Not found", 404);
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!env.STRIPE_WEBHOOK_CONFIGURED || !secret) {
    console.error("[stripe] webhook secret missing");
    return reply("Webhook not configured", 500);
  }

  const payload = await request.text();
  const verified = verifyWebhook(
    payload,
    request.headers.get("stripe-signature"),
    (body, signature) => client.webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike,
  );
  if (!verified.ok) {
    console.warn(`[stripe] signature rejected: ${verified.reason}`);
    return reply("Invalid signature", 400);
  }
  const { event } = verified;

  let outcome: WebhookOutcome;
  try {
    outcome = await handleStripeEvent(db, event, new Date(), { env: env.APP_ENV, mode: paymentMode() });
  } catch (err) {
    console.error(`[stripe] ${event.type} failed: ${logSafeMessage(err)}`);
    return reply("Error", 500);
  }

  const effects = outcome.effects;
  if (effects.length > 0) after(() => runEffects(effects, "none"));
  return reply("ok", 200);
}
