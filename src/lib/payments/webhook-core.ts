/**
 * The Stripe event handler on the tickets engine (spec E10, E11, L1106-1143,
 * contract § 3.12). Pure of Next and of the Stripe SDK: the route passes
 * stripe.webhooks.constructEvent in as a function and hands over the db, so
 * every rule below is tested without a network. Only sessions of OUR app in
 * OUR environment are acted on (SEC-I7): the Stripe account also receives the
 * SaaS billing, Payment Links and the events of other deployments, none of
 * which is ever an orphan to refund. Idempotency is the engine's.
 */
import { eq } from "drizzle-orm";

import { fulfillPurchase, markProcessing, recordOrphanPayment, type PaymentFacts } from "@/lib/booking/fulfillment";
import { releasePurchase } from "@/lib/booking/release";
import type { Effect } from "@/lib/booking/types";
import type { Db } from "@/lib/db/atomic";
import { ticketPurchase } from "@/lib/db/schema";
import { SESSION_APP, type PaymentMode } from "@/lib/payments/checkout";
import { idSchema } from "@/lib/tickets";

export type CheckoutSessionLike = {
  id: string;
  mode?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  payment_status?: string | null;
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
  currency?: string | null;
};

export type StripeEventLike = { id: string; type: string; livemode: boolean; data: { object: unknown } };

export type WebhookHandled = "fulfilled" | "duplicate" | "orphan" | "processing" | "released" | "ignored";
export type WebhookOutcome = { handled: WebhookHandled; effects: Effect[] };

/** The deployment the handler runs in (SEC-I7, SEC-M1): env = APP_ENV, mode = paymentMode(). */
export type WebhookOptions = { env: string; mode: PaymentMode };

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;
type HandledEvent = (typeof HANDLED_EVENTS)[number];

function isHandled(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/** A string id, an expanded object's id, or null (OUT:32). */
export function paymentIntentIdOf(pi: CheckoutSessionLike["payment_intent"]): string | null {
  if (typeof pi === "string") return pi === "" ? null : pi;
  if (typeof pi === "object" && pi !== null && typeof pi.id === "string" && pi.id !== "") return pi.id;
  return null;
}

/** SEC-I7: "own" = mode "payment", metadata.app === SESSION_APP and metadata.env === opts.env; "other_env" = our marker with another env; "foreign" = anything else (SaaS billing, Payment Links, other apps on the account). */
export function sessionOrigin(session: CheckoutSessionLike, opts: WebhookOptions): "own" | "other_env" | "foreign" {
  if (session.mode !== "payment") return "foreign";
  const meta = session.metadata;
  if (!meta || meta.app !== SESSION_APP) return "foreign";
  return meta.env === opts.env ? "own" : "other_env";
}

export type SessionPurchase = { kind: "found"; purchaseId: string } | { kind: "none" } | { kind: "mismatch" };

/** metadata.purchaseId (idSchema) of an existing purchase, else the purchase whose checkout_session_id = session.id (UNIQUE); a set client_reference_id that differs from the found id → mismatch (it is only a consistency check, SEC-I7). */
export async function purchaseOfSession(db: Db, session: CheckoutSessionLike): Promise<SessionPurchase> {
  let purchaseId: string | null = null;
  const fromMetadata = idSchema.safeParse(session.metadata?.purchaseId);
  if (fromMetadata.success) {
    const [row] = await db.select({ id: ticketPurchase.id }).from(ticketPurchase).where(eq(ticketPurchase.id, fromMetadata.data));
    purchaseId = row?.id ?? null;
  }
  if (purchaseId === null) {
    const [row] = await db
      .select({ id: ticketPurchase.id })
      .from(ticketPurchase)
      .where(eq(ticketPurchase.checkoutSessionId, session.id));
    purchaseId = row?.id ?? null;
  }
  if (purchaseId === null) return { kind: "none" };
  const reference = session.client_reference_id;
  if (typeof reference === "string" && reference !== "" && reference !== purchaseId) return { kind: "mismatch" };
  return { kind: "found", purchaseId };
}

export type VerifiedWebhook =
  | { ok: true; event: StripeEventLike }
  | { ok: false; reason: "missing_signature" | "bad_signature" };

/** Pure: no signature → missing; `verify` throwing → bad (the route passes stripe.webhooks.constructEvent bound to the secret). */
export function verifyWebhook(
  payload: string,
  signature: string | null,
  verify: (payload: string, signature: string) => StripeEventLike,
): VerifiedWebhook {
  if (!signature) return { ok: false, reason: "missing_signature" };
  try {
    return { ok: true, event: verify(payload, signature) };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

const ignored = (): WebhookOutcome => ({ handled: "ignored", effects: [] });

/** The object of an event when it looks like a session: a non-null object with a non-empty string id. */
function sessionOf(object: unknown): CheckoutSessionLike | null {
  if (typeof object !== "object" || object === null) return null;
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? (object as CheckoutSessionLike) : null;
}

/** Money for a session that cannot be settled (no purchase, wrong amount): counted and logged by the engine, refunded by hand. */
async function orphan(db: Db, facts: PaymentFacts, now: Date): Promise<WebhookOutcome> {
  await recordOrphanPayment(db, facts, now);
  return { handled: "orphan", effects: [] };
}

/** Rule 5: a paid session settles its purchase, or is an orphan. */
async function fulfil(
  db: Db,
  found: SessionPurchase,
  session: CheckoutSessionLike,
  facts: PaymentFacts,
  now: Date,
): Promise<WebhookOutcome> {
  if (found.kind !== "found") return orphan(db, facts, now);

  const [snapshot] = await db
    .select({ amountCents: ticketPurchase.amountCents, currency: ticketPurchase.currency })
    .from(ticketPurchase)
    .where(eq(ticketPurchase.id, found.purchaseId));
  if (!snapshot) return orphan(db, facts, now);
  if (
    session.amount_total !== snapshot.amountCents ||
    (session.currency ?? "").toLowerCase() !== snapshot.currency.toLowerCase()
  ) {
    const settled = await orphan(db, facts, now);
    console.error("[stripe] amount mismatch on a purchase");
    return settled;
  }

  const res = await fulfillPurchase(db, found.purchaseId, facts, now);
  if (res.outcome === "duplicate") {
    // Read after the engine answered: two identical concurrent deliveries (one wins, one is the duplicate) store the same ids.
    const [stored] = await db
      .select({ paymentIntentId: ticketPurchase.paymentIntentId, checkoutSessionId: ticketPurchase.checkoutSessionId })
      .from(ticketPurchase)
      .where(eq(ticketPurchase.id, found.purchaseId));
    if (!stored) return orphan(db, facts, now);
    const otherPayment = stored.paymentIntentId !== null && stored.paymentIntentId !== facts.paymentIntentId;
    const otherSession = stored.checkoutSessionId !== null && stored.checkoutSessionId !== facts.sessionId;
    if (otherPayment || otherSession) return orphan(db, facts, now);
  }
  return { handled: res.outcome, effects: res.effects };
}

/**
 * Rules 6 and 7: an event that changes the state of a purchase without paying it (processing, release) acts only when the
 * session is the purchase's OWN. `gone`: the purchase no longer exists (LED:427: the pro was deleted, its open sessions
 * expire, their purchases are gone). `other`: it carries a different session, said in the log without any id. A purchase with
 * no session attached yet counts as `own`: the event cannot belong to another one.
 */
async function ownSession(
  db: Db,
  purchaseId: string,
  session: CheckoutSessionLike,
  type: string,
): Promise<"own" | "gone" | "other"> {
  const [row] = await db
    .select({ checkoutSessionId: ticketPurchase.checkoutSessionId })
    .from(ticketPurchase)
    .where(eq(ticketPurchase.id, purchaseId));
  if (!row) return "gone";
  if (row.checkoutSessionId !== null && row.checkoutSessionId !== session.id) {
    console.warn(`[stripe] ${type} ignored: not the purchase's session`);
    return "other";
  }
  return "own";
}

/** Rule 7: `async_payment_failed` and `expired` release the purchase of THIS session only. */
async function release(
  db: Db,
  found: SessionPurchase,
  session: CheckoutSessionLike,
  type: string,
  now: Date,
): Promise<WebhookOutcome> {
  // The common case of LED:427: no purchase any more, nothing to release.
  if (found.kind !== "found") return ignored();
  if ((await ownSession(db, found.purchaseId, session, type)) !== "own") return ignored();
  const res = await releasePurchase(db, found.purchaseId, now);
  if (res.ok) return { handled: "released", effects: res.effects };
  if (res.code === "not_found") return ignored();
  throw new Error(`releasePurchase ${found.purchaseId}: unexpected ${res.code}`);
}

/** E10 / E11 dispatch (rules below). Idempotent through the engine; throws on an unexpected error (the route answers 500 and Stripe retries). */
export async function handleStripeEvent(
  db: Db,
  event: StripeEventLike,
  now: Date,
  opts: WebhookOptions,
): Promise<WebhookOutcome> {
  const type = event.type;
  if (!isHandled(type)) return ignored();
  const session = sessionOf(event.data?.object);
  if (!session) return ignored();

  if (event.livemode !== (opts.mode === "live")) {
    console.warn(`[stripe] ${type} ignored: livemode mismatch`);
    return ignored();
  }
  const origin = sessionOrigin(session, opts);
  if (origin === "foreign") return ignored();
  if (origin === "other_env") {
    console.warn(`[stripe] ${type} ignored: other environment`);
    return ignored();
  }

  const facts: PaymentFacts = {
    sessionId: session.id,
    paymentIntentId: paymentIntentIdOf(session.payment_intent),
    livemode: event.livemode,
  };
  const found = await purchaseOfSession(db, session);
  if (found.kind === "mismatch") {
    console.warn(`[stripe] ${type} ignored: reference mismatch`);
    return ignored();
  }

  switch (type) {
    case "checkout.session.async_payment_succeeded":
      return fulfil(db, found, session, facts, now);
    case "checkout.session.completed": {
      if (session.payment_status === "paid") return fulfil(db, found, session, facts, now);
      if (session.payment_status === "no_payment_required") {
        console.warn("[stripe] no_payment_required ignored");
        return ignored();
      }
      if (session.payment_status === "unpaid" && found.kind === "found") {
        // Rule 6: only the purchase's own session may freeze it out of the nightly expiry.
        if ((await ownSession(db, found.purchaseId, session, type)) !== "own") return ignored();
        const res = await markProcessing(db, found.purchaseId, now);
        return res.ok ? { handled: "processing", effects: [] } : ignored();
      }
      return ignored();
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return release(db, found, session, type, now);
  }
}
