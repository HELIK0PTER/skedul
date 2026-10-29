/**
 * Public purchase of a ticket offer from the Boutique (spec § 11 E9): no séance, so no seat and no hold. The
 * core follows the order of E1 (src/lib/public/booking-actions.ts): the whole strict input first, the
 * honeypot, payment availability, the throttle, the customer row, the engine, then the Checkout session and
 * its attachment (createCheckoutAndAttach, shared with E1). No server-only, no next/*.
 */
import { z } from "zod";

import { startPurchase } from "@/lib/booking/fulfillment";
import type { Db } from "@/lib/db/atomic";
import { checkoutUrls, type CheckoutRequest } from "@/lib/payments/checkout";
import {
  createCheckoutAndAttach,
  identityInputSchema,
  paidActionGate,
  upsertTypedCustomer,
  type IdentityInput,
} from "@/lib/public/booking-actions";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { fromEngineClient, fromParse, type PublicCoreResult } from "@/lib/public/result";
import { idSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export type ShopPurchaseInput = { offerId: string; identity: IdentityInput; website?: string };

/** The WHOLE input, `.strict()` (SEC-M15): z.object({ offerId: idSchema, identity: identityInputSchema, website: z.unknown().optional() }).strict(). */
export const shopPurchaseInputSchema = z
  .object({ offerId: idSchema, identity: identityInputSchema, website: z.unknown().optional() })
  .strict();

/** E9 (L1099-1104): shape, honeypot, payment availability, throttle "shop", upsertCustomer, startPurchase, Checkout (expires_at = the purchase's checkout_expires_at, dashboard payment methods), attachCheckoutSession; a Stripe failure or a refused attach expires the purchase (releasePurchase). */
export async function startShopPurchaseCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  deps: PublicDeps,
  now: Date,
): Promise<PublicCoreResult<{ purchaseId: string; checkoutUrl: string }>> {
  // 1. The whole input, strict: a malformed call reads and writes nothing.
  const parsed = parseFr(shopPurchaseInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const data = parsed.data;

  // 2 to 5. The honeypot, the identity and who is rate limited, payment availability, the throttle (paidActionGate,
  // shared with E1). No séance, so no per-séance or per-pro IP key.
  const vars = { businessName: pro.businessName };
  const gate = await paidActionGate(db, pro, visitor, data, deps, { action: "shop" }, now);
  if (!gate.ok) return gate.refusal;
  const { identity, subject } = gate;

  // 6. The customer row identifies who buys (upsertTypedCustomer).
  const customerId = await upsertTypedCustomer(db, pro.professionalId, identity, subject, now);

  // 7. The engine: a pending purchase for an offer of THIS pro (its not_found and stale say nothing about
  // another customer, so they reach the browser as they are).
  const res = await startPurchase(db, { professionalId: pro.professionalId, offerId: data.offerId, customerId }, now);
  if (!res.ok) return fromEngineClient(res, "shop", vars);

  // 8 and 9. The Checkout session, expiring with the purchase (24 h), then its attachment.
  const request: CheckoutRequest = {
    kind: "shop",
    purchaseId: res.purchaseId,
    amountCents: res.amountCents,
    currency: res.currency,
    productName: `${res.ticketTypeName} · ${res.label}`,
    customerEmail: identity.email,
    env: deps.env,
    ...checkoutUrls(deps.appUrl, {
      kind: "shop",
      slug: pro.slug,
      purchaseId: res.purchaseId,
      offerId: data.offerId,
    }),
    expiresAt: res.checkoutExpiresAt,
  };
  return createCheckoutAndAttach(db, deps, request, "shop", pro.businessName, now);
}
