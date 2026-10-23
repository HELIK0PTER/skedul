import "server-only";

import { cache } from "react";

import { minGeneratedUntil, needsHorizon } from "@/lib/booking/occurrences";
import { db } from "@/lib/db";
import { listBoutique, type BoutiqueType } from "@/lib/public/boutique-reads";
import type { PublicPro } from "@/lib/public/context";
import { getPublicOffer, type PublicOfferDetail } from "@/lib/public/offer-reads";
import { listPublicSeances, nextPublicSeanceStart, type PublicSeance } from "@/lib/public/planning-reads";
import { purchaseByReference, type PurchaseReference } from "@/lib/public/purchase-reads";
import {
  getPublicSeance,
  livePendingHoldsOf,
  seanceVisitorFacts,
  type LivePendingHold,
  type PublicSeanceDetail,
  type SeanceVisitorFacts,
} from "@/lib/public/seance-reads";
import { getPublicProfile } from "@/server/queries";

/*
 * Server-side readers of the public pages: thin wrappers that bind the db and the clock to the testable cores in
 * src/lib/public (planning, boutique, séance, offer, purchase reference). The pro always comes from the page slug
 * (resolvePublicPro or getPublicPageProfile), never from input; every client prop is built by the page from picked
 * fields.
 */

/**
 * The pro of the public page `/[slug]` with its presentation text (null for an unknown or suspended pro), memoized for
 * ONE request only (React `cache`, nothing shared between requests): generateMetadata and the page read the database
 * once. Public data only, no client data.
 */
export const getPublicPageProfile = cache((slug: string) => getPublicProfile(slug));

/** The séances of [start, end) the public page lists for this pro (see listPublicSeances). */
export function getPlanningPage(pro: PublicPro, range: { start: Date; end: Date }): Promise<PublicSeance[]> {
  return listPublicSeances(db, pro, range, new Date());
}

/** The start of the first séance the planning shows at or after `after`; null when none. */
export function getNextSeanceStart(pro: PublicPro, after: Date): Promise<Date | null> {
  return nextPublicSeanceStart(db, pro, after, new Date());
}

/** The Boutique of the pro: offers on sale by ticket type. */
export function getBoutiquePage(professionalId: string): Promise<BoutiqueType[]> {
  return listBoutique(db, professionalId);
}

/** True when an active series is generated less far ahead than a render tolerates (the page then schedules ensureHorizon in after()). */
export async function getHorizonNeed(pro: Pick<PublicPro, "professionalId" | "timezone">): Promise<boolean> {
  const now = new Date();
  return needsHorizon(await minGeneratedUntil(db, pro.professionalId, now), now, pro.timezone);
}

/** One occurrence of the pro for the séance page: the séance, { kind: "rdv" } for an RDV, null when not this pro's (see getPublicSeance). */
export function getSeancePage(pro: PublicPro, occurrenceId: string): Promise<PublicSeanceDetail | { kind: "rdv" } | null> {
  return getPublicSeance(db, pro, occurrenceId, new Date());
}

/**
 * What ONE server-derived customer (an Owner, or the guest cookie's customer: never a typed e-mail, never the customer
 * of a ?p= reference) holds on this séance. A guest gets the booking status only (see seanceVisitorFacts).
 */
export function getSeanceVisitorFacts(
  professionalId: string,
  occurrenceId: string,
  viewer: { customerId: string; source: "owner" | "guest" },
): Promise<SeanceVisitorFacts> {
  return seanceVisitorFacts(db, professionalId, occurrenceId, viewer, new Date());
}

/** The live seat holds of an Owner's customer at this pro, soonest end first (Owner only, see livePendingHoldsOf). */
export function getLivePendingHolds(professionalId: string, customerId: string): Promise<LivePendingHold[]> {
  return livePendingHoldsOf(db, professionalId, customerId, new Date());
}

/** The offer page's offer: on sale, unavailable, or null when not this pro's (see getPublicOffer). */
export function getOfferPage(professionalId: string, offerId: string): Promise<PublicOfferDetail | null> {
  return getPublicOffer(db, professionalId, offerId);
}

/** The purchase a ?p= reference names, scoped to this pro. Server side only: its customerId never reaches a client component (see purchaseByReference, referenceForPage). */
export function getPurchaseReference(professionalId: string, purchaseId: string): Promise<PurchaseReference | null> {
  return purchaseByReference(db, professionalId, purchaseId, new Date());
}

/** True when a pro page exists at this slug, suspended or not, memoized for ONE request (see the layout of the public segment). */
export const publicPageExists = cache(async (slug: string): Promise<boolean> => (await getPublicProfile(slug, { includeSuspended: true })) !== null);
