/**
 * Checkout gateway and the pure rules around it (spec § 11 E1 and E9, § 14, contract § 3.6). No `server-only`, no
 * env and no Stripe client (the Stripe import is a type): the real gateway lives in src/lib/stripe.ts and the
 * tests, the cores and the mock route use this module as it is.
 *
 * Every Skedul tickets session carries `metadata { purchaseId, app, env }` (and the same on its payment intent) so
 * the webhook handles only sessions of its own app and environment (SEC-I7). Every URL is built from the trusted
 * app URL and ids only: no redirect or next parameter, no address (S16).
 */
import type Stripe from "stripe";

import { CHECKOUT_MINUTES } from "@/lib/tickets-vocab";

export type PaymentMode = "mock" | "test" | "live";
export type CheckoutKind = "buybook" | "shop";

export type CheckoutRequest = {
  kind: CheckoutKind;
  purchaseId: string;
  amountCents: number;
  currency: string;
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  /** APP_ENV of the deployment that creates the session (SEC-I7) */
  env: string;
};

/** The marker every Skedul tickets session carries in its metadata (SEC-I7); the webhook ignores any other session. */
export const SESSION_APP = "skedul-tickets";

export type CheckoutCreated = { sessionId: string; url: string };
export type CheckoutCloseOutcome = "expired" | "already_expired" | "paid" | "processing" | "mock" | "failed";

export interface CheckoutGateway {
  readonly mode: PaymentMode;
  /** Creates the Checkout session (idempotency key checkout:<purchaseId>); throws on any error. */
  create(req: CheckoutRequest): Promise<CheckoutCreated>;
  /** « Libérer ma place » (L1166-1167): retrieve, expire when open. Never throws ("failed"). */
  closeForRelease(sessionId: string): Promise<CheckoutCloseOutcome>;
  /** Best effort expiry of a session the engine refused to attach. Never throws. */
  expire(sessionId: string): Promise<void>;
}

export const MOCK_SESSION_PREFIX = "mock_";

/** `mock_<purchaseId>`: the session id stored for a simulated checkout. */
export function mockSessionId(purchaseId: string): string {
  return `${MOCK_SESSION_PREFIX}${purchaseId}`;
}

/** True for a simulated session id; every Stripe call short-circuits on it (Decision 29). */
export function isMockSession(sessionId: string): boolean {
  return sessionId.startsWith(MOCK_SESSION_PREFIX);
}

/** The app URL without its trailing slashes. */
function baseOf(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/** `${appUrl}/api/mock-checkout?purchase=<id>` (L815): the only parameter. */
export function mockCheckoutUrl(appUrl: string, purchaseId: string): string {
  return `${baseOf(appUrl)}/api/mock-checkout?purchase=${encodeURIComponent(purchaseId)}`;
}

export type CheckoutTarget = { slug: string; purchaseId: string } & (
  | { kind: "buybook"; occurrenceId: string }
  | { kind: "shop"; offerId: string }
);

/** Path of the cancel page: /{slug}/seance/{o}?paiement=annule&p={id} (L812) or /{slug}/offre/{offerId}?paiement=annule&p={id}. */
export function cancelPathOf(t: CheckoutTarget): string {
  const page =
    t.kind === "buybook"
      ? `seance/${encodeURIComponent(t.occurrenceId)}`
      : `offre/${encodeURIComponent(t.offerId)}`;
  return `/${encodeURIComponent(t.slug)}/${page}?paiement=annule&p=${encodeURIComponent(t.purchaseId)}`;
}

/** success = `${appUrl}/{slug}/merci?p={id}` (L811); cancel = appUrl + cancelPathOf(t). Built from the trusted app URL only. */
export function checkoutUrls(appUrl: string, t: CheckoutTarget): { successUrl: string; cancelUrl: string } {
  const base = baseOf(appUrl);
  return {
    successUrl: `${base}/${encodeURIComponent(t.slug)}/merci?p=${encodeURIComponent(t.purchaseId)}`,
    cancelUrl: `${base}${cancelPathOf(t)}`,
  };
}

/** nowMs + CHECKOUT_MINUTES minutes, computed right before the Stripe call (L808). */
export function buybookCheckoutExpiry(nowMs: number): Date {
  return new Date(nowMs + CHECKOUT_MINUTES * 60_000);
}

/**
 * The Stripe session params (L808, L1103-1104): one line item, `client_reference_id` and the app marker as
 * consistency data, whole-second `expires_at`, French page. A buy + book is card only; a shop purchase uses the
 * methods of the Stripe dashboard.
 */
export function stripeSessionParams(req: CheckoutRequest): Stripe.Checkout.SessionCreateParams {
  const marker = { purchaseId: req.purchaseId, app: SESSION_APP, env: req.env };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    customer_email: req.customerEmail,
    client_reference_id: req.purchaseId,
    metadata: marker,
    payment_intent_data: { metadata: { ...marker } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: req.currency,
          unit_amount: req.amountCents,
          product_data: { name: req.productName },
        },
      },
    ],
    expires_at: Math.floor(req.expiresAt.getTime() / 1000),
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
    locale: "fr",
    submit_type: "pay",
  };
  if (req.kind === "buybook") params.payment_method_types = ["card"];
  return params;
}

/**
 * What « Libérer ma place » learns from a retrieved session: open → "open"; expired → "already_expired"; complete
 * and paid → "paid"; anything else, no_payment_required included, → "processing" (never release on doubt, COV-M2).
 */
export function closeOutcomeOf(session: {
  status: string | null;
  payment_status: string | null;
}): "open" | "already_expired" | "paid" | "processing" {
  if (session.status === "open") return "open";
  if (session.status === "expired") return "already_expired";
  if (session.status === "complete" && session.payment_status === "paid") return "paid";
  return "processing";
}

/** "mock" when disabled or without key; "live" for sk_live_ / rk_live_; else "test". The ONE mode rule: src/lib/admin-metrics.ts re-exports it as stripeMode (COV-M8). */
export function paymentModeOf(secretKey: string | undefined, enabled: boolean): PaymentMode {
  if (!enabled || !secretKey) return "mock";
  return /^(sk|rk)_live_/.test(secretKey) ? "live" : "test";
}

/**
 * The simulated checkout is reachable only without Stripe keys AND outside production, by APP_ENV and by
 * VERCEL_ENV (SEC-I5, Decision 27): APP_ENV defaults to development when unset, so a keyless Vercel production
 * would otherwise hand out free tickets.
 */
export function mockCheckoutAllowed(e: { STRIPE_ENABLED: boolean; APP_ENV: string; VERCEL_ENV?: string }): boolean {
  return !e.STRIPE_ENABLED && e.APP_ENV !== "production" && e.VERCEL_ENV !== "production";
}
