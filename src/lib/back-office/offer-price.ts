/**
 * The lowest price of a paid offer: Stripe refuses a Checkout under its minimum charge, so the back-office refuses an
 * offer it could not sell (P4 final review PAY-3, Change to spec, stricter than L285 `price_cents > 0`; the DB CHECK and
 * the engine's schema keep > 0, no migration). Pure and client-safe: the offer cores refuse with it, and the offer
 * dialog checks it before the call and names it in the price help.
 */
import { formatMoney } from "@/lib/utils";

/**
 * Stripe's documented minimum charge in minor units, for each currency the app can carry (docs.stripe.com/currencies,
 * « Montant débité minimum par devise », read on 2026-10-28: 0,50 EUR). Every pro's currency is the euro: the
 * `professional.currency` column defaults to "eur" and no code path writes another value (onboarding, settings, seed).
 */
export const STRIPE_MINIMUM_CENTS: Readonly<Record<string, number>> = { eur: 50 };

/** A currency without an entry: 50 minor units, Stripe's minimum for the euro and the dollar. Add the documented entry before a pro can choose another currency. */
const FALLBACK_MINIMUM_CENTS = 50;

/** The minimum of `currency` (any case), in minor units. */
export function stripeMinimumCents(currency: string): number {
  const code = currency.toLowerCase();
  return Object.prototype.hasOwnProperty.call(STRIPE_MINIMUM_CENTS, code) ? STRIPE_MINIMUM_CENTS[code] : FALLBACK_MINIMUM_CENTS;
}

/** « Prix : minimum 0,50 €. »: the minimum formatted by formatMoney in the pro's currency, in the style of the schema's « Prix : minimum 1. ». */
export function offerPriceMinimumError(currency: string): string {
  return `Prix : minimum ${formatMoney(stripeMinimumCents(currency), currency)}.`;
}

/** offerPriceMinimumError for a finite price under the minimum (0 and negatives included), else null: a value that is not a finite number is the schema's to refuse. */
export function offerPriceRefusal(priceCents: unknown, currency: string): string | null {
  return typeof priceCents === "number" && Number.isFinite(priceCents) && priceCents < stripeMinimumCents(currency)
    ? offerPriceMinimumError(currency)
    : null;
}
