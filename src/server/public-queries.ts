import "server-only";

import { cache } from "react";

import { minGeneratedUntil, needsHorizon } from "@/lib/booking/occurrences";
import { db } from "@/lib/db";
import { listBoutique, type BoutiqueType } from "@/lib/public/boutique-reads";
import type { PublicPro } from "@/lib/public/context";
import { listPublicSeances, nextPublicSeanceStart, type PublicSeance } from "@/lib/public/planning-reads";
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
