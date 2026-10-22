/**
 * The payment mode and the ONE rule that derives it from the Stripe key (contract § 3.6). No import on purpose: the
 * admin bar chart, a client component, reaches src/lib/admin-metrics.ts at run time, and no `@/lib/payments/*` module
 * may enter a client bundle. src/lib/payments/checkout.ts re-exports both names, so its importers keep working;
 * src/lib/payment-mode.test.ts pins the absence of imports.
 */
export type PaymentMode = "mock" | "test" | "live";

/** "mock" when disabled or without key; "live" for sk_live_ / rk_live_; else "test". src/lib/admin-metrics.ts re-exports it as stripeMode (COV-M8). */
export function paymentModeOf(secretKey: string | undefined, enabled: boolean): PaymentMode {
  if (!enabled || !secretKey) return "mock";
  return /^(sk|rk)_live_/.test(secretKey) ? "live" : "test";
}
