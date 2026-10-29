/**
 * Pure helpers of the buy + book block of the séance page (contract § 3.23 `OccurrenceBooking`, COV-M6, COV-M12):
 * the offer rows, the id of the seat the buyer holds (kept in the tab's sessionStorage so that a refused second
 * attempt can offer a way back to « Libérer ma place »), and the check of the URL the browser leaves for. Client-safe:
 * no server module. Nothing here identifies a customer: the held id is the buyer's own reference of THEIR purchase,
 * which the séance page re-reads through the slug's pro.
 */
import { formatMoney } from "@/lib/utils";

/** An offer of the séance as the form needs it (the page picks these fields). */
export type OfferChoice = {
  offerId: string;
  label: string;
  priceCents: number;
  validityText: string | null;
  covers: boolean;
};

export const BUY_TITLE = "Acheter et réserver";
export const OFFERS_LEGEND = "Choisissez une offre";
/** Why an offer cannot be picked: its validity ends before this séance. */
export const OFFER_TOO_SHORT = "Validité trop courte pour cette séance";

/** « {label} · {price} » plus « · valable {validityText} » when the offer has a validity (the price through formatMoney). */
export function offerOptionLabel(offer: OfferChoice, currency: string): string {
  const base = `${offer.label} · ${formatMoney(offer.priceCents, currency)}`;
  return offer.validityText ? `${base} · valable ${offer.validityText}` : base;
}

/** The id of the first offer that covers the séance, null when none does. */
export function firstCoveringOfferId(offers: readonly OfferChoice[]): string | null {
  return offers.find((o) => o.covers)?.offerId ?? null;
}

/** « Payer {price} » of the chosen offer. */
export function payLabel(offer: OfferChoice, currency: string): string {
  return `Payer ${formatMoney(offer.priceCents, currency)}`;
}

export const HOLD_KEY_PREFIX = "skedul:hold:";
/** What one of our purchase ids looks like (a nanoid): anything else read from a storage is ignored. */
export const HOLD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function holdStorageKey(occurrenceId: string): string {
  return `${HOLD_KEY_PREFIX}${occurrenceId}`;
}

/** The session storage of the tab, null when the browser refuses it (private window, blocked data) or on the server. */
export function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the purchase id of a started payment for this séance; never throws, stores only a plausible id. */
export function storeHoldId(storage: Pick<Storage, "setItem"> | null, occurrenceId: string, purchaseId: string): void {
  if (storage === null || !HOLD_ID_RE.test(purchaseId)) return;
  try {
    storage.setItem(holdStorageKey(occurrenceId), purchaseId);
  } catch {
    // The storage is full or blocked: the return link is a convenience, the purchase itself is safe on the server.
  }
}

/** The purchase id kept for this séance, or null (absent, unreadable, or not shaped like one of our ids). */
export function readHoldId(storage: Pick<Storage, "getItem"> | null, occurrenceId: string): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(holdStorageKey(occurrenceId));
    return value !== null && HOLD_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** /{slug}/seance/{occurrenceId}?paiement=annule&p={holdId}: the return page of a payment the buyer left (COV-M6). */
export function returnHref(slug: string, occurrenceId: string, holdId: string): string {
  return `/${slug}/seance/${occurrenceId}?paiement=annule&p=${encodeURIComponent(holdId)}`;
}

/** The URL to leave for, or null: an https URL without credentials, or a same-origin http URL (the dev mock checkout). */
export function safeCheckoutUrl(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.protocol === "https:") return parsed.toString();
    if (parsed.protocol === "http:" && parsed.origin === origin) return parsed.toString();
    return null;
  } catch {
    return null;
  }
}
