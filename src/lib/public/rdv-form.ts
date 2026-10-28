/**
 * Pure helpers of the RDV booking block (P5 dossier § 3.3, O6): the purchase id the buyer's OWN tab keeps for a slot it
 * started paying (sessionStorage, keyed by the type and the slot start), and the page that takes her back to it. Client
 * safe: no server module. The stored id is the buyer's own reference of HER purchase, which the RDV page re-reads
 * through the slug's pro (referenceForPage); nothing here identifies a customer.
 */
import { HOLD_ID_RE, HOLD_KEY_PREFIX } from "@/lib/public/buy-and-book-form";

/**
 * `skedul:hold:rdv:{ticketTypeId}:{startsAtIso}`: one key per slot of one type, apart from the séance keys
 * (`skedul:hold:{occurrenceId}`, whose ids never contain a colon). `startsAtIso` is the `toISOString()` the server
 * rendered for the slot, the same string the form posts.
 */
export function rdvHoldStorageKey(ticketTypeId: string, startsAtIso: string): string {
  return `${HOLD_KEY_PREFIX}rdv:${ticketTypeId}:${startsAtIso}`;
}

/** Keeps the purchase id of a started RDV payment for this slot; never throws, stores only a plausible id. */
export function storeRdvHoldId(
  storage: Pick<Storage, "setItem"> | null,
  ticketTypeId: string,
  startsAtIso: string,
  purchaseId: string,
): void {
  if (storage === null || !HOLD_ID_RE.test(purchaseId)) return;
  try {
    storage.setItem(rdvHoldStorageKey(ticketTypeId, startsAtIso), purchaseId);
  } catch {
    // The storage is full or blocked: the resume link is a convenience, the purchase itself is safe on the server.
  }
}

/** The purchase id kept for this slot, or null (absent, unreadable, or not shaped like one of our ids). */
export function readRdvHoldId(
  storage: Pick<Storage, "getItem"> | null,
  ticketTypeId: string,
  startsAtIso: string,
): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(rdvHoldStorageKey(ticketTypeId, startsAtIso));
    return value !== null && HOLD_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * /{slug}/rdv/{ticketTypeId}?paiement=annule&p={holdId}: the return page of an RDV payment the buyer left, the same path
 * as the Checkout cancel URL (`cancelPathOf` with kind `rdv`, pinned by rdv-form.test.ts). Every segment is URL-encoded.
 */
export function rdvReturnHref(slug: string, ticketTypeId: string, holdId: string): string {
  return `/${encodeURIComponent(slug)}/rdv/${encodeURIComponent(ticketTypeId)}?paiement=annule&p=${encodeURIComponent(holdId)}`;
}
