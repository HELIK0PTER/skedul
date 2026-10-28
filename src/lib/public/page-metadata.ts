/**
 * Metadata of the public pages, as pure functions a test can read (G4b, Item 6). Imports types only.
 */
import type { Metadata } from "next";

import type { PublicOfferDetail } from "./offer-reads";
import type { PublicSeanceDetail } from "./seance-reads";

/** The metadata of a public page that answers 404: the 404's own title, not indexed, no referrer (the URL may carry `p`). */
export function notFoundMetadata(): Metadata {
  return { title: "Page introuvable", referrer: "no-referrer", robots: { index: false } };
}

/**
 * The offer page. Only an offer on sale is titled, « {label} · {business} », and indexable. Every other case gets the
 * 404's metadata, never the business name (G4b brief, Item 6): an unknown slug, an unknown offer or another pro's (the
 * page answers notFound()), and an offer the Boutique no longer sells (archived, paused, its type archived: the page
 * answers « Cette offre n'est plus proposée » and leads back to the Boutique). The referrer is never sent.
 */
export function offerMetadata(loaded: { pro: { businessName: string }; offer: PublicOfferDetail | null } | null): Metadata {
  if (loaded?.offer?.kind !== "on_sale") return notFoundMetadata();
  return { title: `${loaded.offer.label} · ${loaded.pro.businessName}`, referrer: "no-referrer" };
}

/** The query keys of a payment return to the séance page: `p`, the purchase reference, and `paiement`, the outcome. */
export type PaymentReturnQuery = { p?: string | string[]; paiement?: string | string[] };

/** The URL is a payment return: it carries `p` or `paiement`, whatever the value (an empty one or a repeated one too). */
export function isPaymentReturn(query: PaymentReturnQuery): boolean {
  return query.p !== undefined || query.paiement !== undefined;
}

type LoadedSeance = {
  pro: { businessName: string };
  detail: Pick<PublicSeanceDetail, "kind" | "title" | "isPrivate" | "archived"> | { kind: "rdv" } | null;
} | null;

/**
 * The séance page. It reads the séance only, never the viewer (SEC-M10): a public, non-archived séance is
 * « {title} · {business} » and indexable; a private, archived, RDV, unknown or foreign séance carries the business
 * name only, not indexed; an unknown slug gets the 404's metadata. The referrer is never sent (the URL may carry `p`).
 * A payment return (`isPaymentReturn`) is neither indexed nor followed, whatever the séance: the URL names a purchase
 * and comes back from Checkout (P4 final review, SEC-6); every other field stays as above.
 */
export function seanceMetadata(loaded: LoadedSeance, query: PaymentReturnQuery): Metadata {
  const metadata = seanceMetadataOf(loaded);
  return isPaymentReturn(query) ? { ...metadata, robots: { index: false, follow: false } } : metadata;
}

function seanceMetadataOf(loaded: LoadedSeance): Metadata {
  if (!loaded) return notFoundMetadata();
  const { pro, detail } = loaded;
  if (!detail || detail.kind === "rdv" || detail.isPrivate || detail.archived) {
    return { title: pro.businessName, referrer: "no-referrer", robots: { index: false } };
  }
  return { title: `${detail.title} · ${pro.businessName}`, referrer: "no-referrer" };
}
