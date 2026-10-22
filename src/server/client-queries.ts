import "server-only";

import { cache } from "react";

import type { ClientFilter } from "@/lib/back-office/client-filters";
import {
  getClientRecord,
  listClients,
  type ClientListRow,
  type ClientRecordData,
} from "@/lib/back-office/client-reads";
import { getCustomerSpace, type CustomerSpace } from "@/lib/back-office/customer-space";
import type { SpaceIdentity } from "@/lib/back-office/guest-access";
import { db } from "@/lib/db";
import { spaceIdentityOf } from "@/lib/public/identity";
import { getPublicProfile } from "@/server/queries";
import { currentPublicVisitor } from "@/server/visitor";

export type { SpaceIdentity };

/** The clients page: listed clients matching the filter and the search, plus the count of every filter. */
export async function getClientsPage(
  professionalId: string,
  opts: { q: string; filter: ClientFilter },
): Promise<{ rows: ClientListRow[]; counts: Record<ClientFilter, number> }> {
  return listClients(db, professionalId, new Date(), opts);
}

/** The client record page (null for another pro's or an unknown customer: the page answers notFound()). */
export async function getClientRecordPage(
  professionalId: string,
  customerId: string,
): Promise<ClientRecordData | null> {
  return getClientRecord(db, professionalId, customerId, new Date());
}

/* ───────────────────────────── Client space (/[slug]/espace) ───────────────────────────── */

/**
 * The pro of /[slug]/espace (null for an unknown or suspended pro), memoized for
 * ONE request only (React `cache`, nothing shared between requests): the segment
 * layout answers a real 404 with it and the page reads the branding with it, so
 * the database is hit once. Public data only, no client data.
 */
export const getSpaceProfile = cache((slug: string) => getPublicProfile(slug));

/**
 * Who is looking at this pro's espace (spec § 12, Decision 36): the request's visitor (fresh session, not
 * suspended, personal-link cookie, guest key; currentPublicVisitor, shared with the other public pages of the
 * request) mapped by the tested spaceIdentityOf. An impersonating admin first; the Owner; a verified session
 * without a record; an unverified session (the confirmation banner, never the code form); the cookie's customer;
 * else anonymous. A signed-in visitor never maps to anonymous (COV-C1).
 */
export async function resolveSpaceCustomer(pro: { id: string; userId: string }): Promise<SpaceIdentity> {
  return spaceIdentityOf(await currentPublicVisitor(pro.id, pro.userId));
}

/** The read-only espace of one customer of the pro (null when the customer is not this pro's). */
export function getCustomerSpacePage(professionalId: string, customerId: string): Promise<CustomerSpace | null> {
  return getCustomerSpace(db, professionalId, customerId, new Date());
}
