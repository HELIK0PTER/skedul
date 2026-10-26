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
 * The offer page. No page (an unknown slug, an unknown offer or another pro's: the page answers notFound()) gets the
 * 404's metadata, never the business name; an offer on sale is « {label} · {business} »; an offer the Boutique no longer
 * sells is the business name, not indexed (the page says so and leads back to the Boutique). The referrer is never sent.
 */
export function offerMetadata(loaded: { pro: { businessName: string }; offer: PublicOfferDetail | null } | null): Metadata {
  if (!loaded || !loaded.offer) return notFoundMetadata();
  const { pro, offer } = loaded;
  if (offer.kind === "on_sale") return { title: `${offer.label} · ${pro.businessName}`, referrer: "no-referrer" };
  return { title: pro.businessName, referrer: "no-referrer", robots: { index: false } };
}
