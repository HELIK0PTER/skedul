/**
 * Metadata of the public pages, as pure functions a test can read (G4b, Item 6). Imports types only.
 */
import type { Metadata } from "next";

import type { PublicOfferDetail } from "./offer-reads";

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
