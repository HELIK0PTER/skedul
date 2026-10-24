import "server-only";

import { cache } from "react";

import { minGeneratedUntil, needsHorizon } from "@/lib/booking/occurrences";
import { db } from "@/lib/db";
import { listBoutique, type BoutiqueType } from "@/lib/public/boutique-reads";
import { publicPageProfileOfRow, type PublicPageProfile, type PublicPro } from "@/lib/public/context";
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
 * Server-side readers of the public pages: thin wrappers that bind the db to the testable cores in src/lib/public
 * (planning, boutique, séance, offer, purchase reference). The clock is the page's: it reads `new Date()` once per
 * request and hands that instant to every read that depends on it and to the view functions (`seanceState`,
 * `toPublicSeanceVM`, `planningEmptyState`), so a read and the page never disagree about « now » (G4a,
 * public-queries.test.ts). The pro always comes from the page slug (resolvePublicPro or getPublicPageProfile), never
 * from input; every client prop is built by the page from picked fields.
 */

/**
 * The pro of the public page `/[slug]` (null for an unknown or suspended pro) as the page holds it: the pro the cores
 * use, the branding fields of the shell and the presentation text, never the professional row (G4a: no Stripe
 * account, no Google calendar, no user id outside `pro.ownerUserId`). Memoized for ONE request only (React `cache`,
 * nothing shared between requests): generateMetadata and the page read the database once. Public data only, no client
 * data.
 */
export const getPublicPageProfile = cache(async (slug: string): Promise<PublicPageProfile | null> => {
  const profile = await getPublicProfile(slug);
  return profile ? publicPageProfileOfRow(profile.pro) : null;
});

/** The séances of [start, end) the public page lists for this pro (see listPublicSeances). */
export function getPlanningPage(pro: PublicPro, range: { start: Date; end: Date }, now: Date): Promise<PublicSeance[]> {
  return listPublicSeances(db, pro, range, now);
}

/** The start of the first séance the planning shows at or after `after`; null when none. */
export function getNextSeanceStart(pro: PublicPro, after: Date, now: Date): Promise<Date | null> {
  return nextPublicSeanceStart(db, pro, after, now);
}

/** The Boutique of the pro: offers on sale by ticket type. */
export function getBoutiquePage(professionalId: string): Promise<BoutiqueType[]> {
  return listBoutique(db, professionalId);
}

/** True when an active series is generated less far ahead than a render tolerates (the page then schedules ensureHorizon in after()). */
export async function getHorizonNeed(pro: Pick<PublicPro, "professionalId" | "timezone">, now: Date): Promise<boolean> {
  return needsHorizon(await minGeneratedUntil(db, pro.professionalId, now), now, pro.timezone);
}

/** One occurrence of the pro for the séance page: the séance, { kind: "rdv" } for an RDV, null when not this pro's (see getPublicSeance). */
export function getSeancePage(pro: PublicPro, occurrenceId: string, now: Date): Promise<PublicSeanceDetail | { kind: "rdv" } | null> {
  return getPublicSeance(db, pro, occurrenceId, now);
}

/**
 * What ONE server-derived customer (an Owner, or the guest cookie's customer: never a typed e-mail, never the customer
 * of a ?p= reference) holds on this séance. A guest gets the booking only: its status, and also its `bookingId` and its
 * `coverage` (Decision 63: the contract's type requires them, so the page must never hand either to a client
 * component, seance-facts-guard.test.ts), never a `purchaseId`, a `resumeUrl`, a wallet or an ended state (see
 * seanceVisitorFacts).
 */
export function getSeanceVisitorFacts(
  professionalId: string,
  occurrenceId: string,
  viewer: { customerId: string; source: "owner" | "guest" },
  now: Date,
): Promise<SeanceVisitorFacts> {
  return seanceVisitorFacts(db, professionalId, occurrenceId, viewer, now);
}

/** The live seat holds of an Owner's customer at this pro, soonest end first (Owner only, see livePendingHoldsOf). */
export function getLivePendingHolds(professionalId: string, customerId: string, now: Date): Promise<LivePendingHold[]> {
  return livePendingHoldsOf(db, professionalId, customerId, now);
}

/** The offer page's offer: on sale, unavailable, or null when not this pro's (see getPublicOffer). */
export function getOfferPage(professionalId: string, offerId: string): Promise<PublicOfferDetail | null> {
  return getPublicOffer(db, professionalId, offerId);
}

/** The purchase a ?p= reference names, scoped to this pro. Server side only: its customerId never reaches a client component (see purchaseByReference, referenceForPage). */
export function getPurchaseReference(professionalId: string, purchaseId: string, now: Date): Promise<PurchaseReference | null> {
  return purchaseByReference(db, professionalId, purchaseId, now);
}

/** True when a pro page exists at this slug, suspended or not, memoized for ONE request (see the layout of the public segment). */
export const publicPageExists = cache(async (slug: string): Promise<boolean> => (await getPublicProfile(slug, { includeSuspended: true })) !== null);
