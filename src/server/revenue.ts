import "server-only";

import { stripeMode } from "@/lib/admin-metrics";
import { env } from "@/lib/env";

export { paidPurchaseOf, revenueByCurrency, type RevenueScope } from "@/lib/booking/revenue";

/**
 * True only with a live Stripe key: then only livemode purchases count as
 * « Encaissé » (spec § 9). Mock and test keys write livemode = false, so
 * development and preview environments still show their test figures.
 */
export function revenueLive(): boolean {
  return stripeMode(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED) === "live";
}
