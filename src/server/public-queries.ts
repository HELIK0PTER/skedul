import "server-only";

import { cache } from "react";

import { minGeneratedUntil, needsHorizon } from "@/lib/booking/occurrences";
import type { DateKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import { listBoutique, type BoutiqueType } from "@/lib/public/boutique-reads";
import { publicPageProfileOfRow, type PublicPageProfile, type PublicPro } from "@/lib/public/context";
import { getPublicOffer, type PublicOfferDetail } from "@/lib/public/offer-reads";
import { listPublicSeances, nextPublicSeanceStart, type PublicSeance } from "@/lib/public/planning-reads";
import { readPublicPage } from "@/lib/public/profile-reads";
import { purchaseByReference, type PurchaseReference } from "@/lib/public/purchase-reads";
import { getPublicRdvType, listRdvCards, rdvOwnerTickets, type PublicRdvType, type RdvCard } from "@/lib/public/rdv-reads";
import {
  getPublicSeance,
  livePendingHoldsOf,
  seanceVisitorFacts,
  type LivePendingHold,
  type PublicSeanceDetail,
  type SeanceVisitorFacts,
} from "@/lib/public/seance-reads";
import { loadRdvWeek, type RdvWeek } from "@/lib/slots";
import { safeRead } from "@/server/safe-read";

/*
 * Server-side readers of the public pages: thin wrappers that bind the db to the testable cores in src/lib/public
 * (planning, boutique, séance, offer, purchase reference, RDV) and src/lib/slots.ts (the RDV slot loader). The clock is the page's: it reads `new Date()` once per
 * request and hands that instant to every read that depends on it and to the view functions that do (`seanceState`,
 * `toPublicSeanceVM`; `planningEmptyState` takes no instant), so a read and the page never disagree about « now » (G4a,
 * public-queries.test.ts). The espace wrappers of client-queries.ts take it the same way (G4c). The pro always comes from the page slug (resolvePublicPro or getPublicPage), never
 * from input; every client prop is built by the page from picked fields. Every wrapper's whole body goes through
 * `safeRead` (P4 final review RND-1, src/server/safe-read.test.ts): a failed query reaches Next's log as its SQL head only.
 */

/** The pro of a `[slug]` page: a live pro as the page holds it, or the bare fact that it is suspended. */
export type PublicPage = ({ suspended: false } & PublicPageProfile) | { suspended: true };

/**
 * The one read of the pro behind `/[slug]` (G4b, Item 6; null for an unknown slug): a live pro as the page holds it,
 * the pro the cores use, the branding fields of the shell and the presentation text, never the professional row (G4a:
 * no Stripe account, no Google calendar, no user id outside `pro.ownerUserId`); a suspended pro as `{ suspended: true }`
 * and nothing else. Memoized for ONE request only (React `cache`, nothing shared between requests): the layout (which
 * only needs the pro to exist, so the thank-you page of a suspended pro still works), generateMetadata and the page
 * (which take a suspended pro for an unknown one) run one professional query. Public data only, no client data.
 */
export const getPublicPage = cache(async (slug: string): Promise<PublicPage | null> => {
  return safeRead(async () => {
    const found = await readPublicPage(db, slug);
    if (!found) return null;
    return found.suspended ? { suspended: true } : { suspended: false, ...publicPageProfileOfRow(found.row) };
  });
});

/** The séances of [start, end) the public page lists for this pro (see listPublicSeances). */
export function getPlanningPage(pro: PublicPro, range: { start: Date; end: Date }, now: Date): Promise<PublicSeance[]> {
  return safeRead(() => listPublicSeances(db, pro, range, now));
}

/** The start of the first séance the planning shows at or after `after`; null when none. */
export function getNextSeanceStart(pro: PublicPro, after: Date, now: Date): Promise<Date | null> {
  return safeRead(() => nextPublicSeanceStart(db, pro, after, now));
}

/** The Boutique of the pro: offers on sale by ticket type. */
export function getBoutiquePage(professionalId: string): Promise<BoutiqueType[]> {
  return safeRead(() => listBoutique(db, professionalId));
}

/** True when an active series is generated less far ahead than a render tolerates (the page then schedules ensureHorizon in after()). */
export async function getHorizonNeed(pro: Pick<PublicPro, "professionalId" | "timezone">, now: Date): Promise<boolean> {
  return safeRead(async () => needsHorizon(await minGeneratedUntil(db, pro.professionalId, now), now, pro.timezone));
}

/** One occurrence of the pro for the séance page: the séance, { kind: "rdv" } for an RDV, null when not this pro's (see getPublicSeance). */
export function getSeancePage(pro: PublicPro, occurrenceId: string, now: Date): Promise<PublicSeanceDetail | { kind: "rdv" } | null> {
  return safeRead(() => getPublicSeance(db, pro, occurrenceId, now));
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
  return safeRead(() => seanceVisitorFacts(db, professionalId, occurrenceId, viewer, now));
}

/** The live seat holds of an Owner's customer at this pro, soonest end first (Owner only, see livePendingHoldsOf). */
export function getLivePendingHolds(professionalId: string, customerId: string, now: Date): Promise<LivePendingHold[]> {
  return safeRead(() => livePendingHoldsOf(db, professionalId, customerId, now));
}

/** The offer page's offer: on sale, unavailable, or null when not this pro's (see getPublicOffer). */
export function getOfferPage(professionalId: string, offerId: string): Promise<PublicOfferDetail | null> {
  return safeRead(() => getPublicOffer(db, professionalId, offerId));
}

/** The purchase a ?p= reference names, scoped to this pro. Server side only: its customerId never reaches a client component (see purchaseByReference, referenceForPage). */
export function getPurchaseReference(professionalId: string, purchaseId: string, now: Date): Promise<PurchaseReference | null> {
  return safeRead(() => purchaseByReference(db, professionalId, purchaseId, now));
}

/** The RDV page's type (facts, offers with their coverage, questions), or null when it is not a bookable RDV type of this pro (see getPublicRdvType). */
export function getRdvTypePage(pro: PublicPro, ticketTypeId: string, now: Date): Promise<PublicRdvType | null> {
  return safeRead(() => getPublicRdvType(db, pro, ticketTypeId, now));
}

/** The slots of the week holding `weekKey` for an RDV type of this pro, null when it is not bookable (see loadRdvWeek). */
export function getRdvWeek(pro: PublicPro, ticketTypeId: string, weekKey: DateKey, now: Date): Promise<RdvWeek | null> {
  return safeRead(() => loadRdvWeek(db, pro.professionalId, ticketTypeId, weekKey, now));
}

/** The RDV cards of `/[slug]`: the bookable RDV types of the pro, ordered like the Boutique (see listRdvCards). */
export function getRdvCards(professionalId: string): Promise<RdvCard[]> {
  return safeRead(() => listRdvCards(db, professionalId));
}

/** The tickets an Owner's customer could spend on an RDV of this type, in consumption order (Owner only, see rdvOwnerTickets). */
export function getRdvOwnerTickets(
  professionalId: string,
  customerId: string,
  ticketTypeId: string,
): Promise<{ expiresAt: string | null }[]> {
  return safeRead(() => rdvOwnerTickets(db, professionalId, customerId, ticketTypeId));
}
