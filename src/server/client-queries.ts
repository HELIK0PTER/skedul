import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { ClientFilter } from "@/lib/back-office/client-filters";
import {
  getClientRecord,
  listClients,
  type ClientListRow,
  type ClientRecordData,
} from "@/lib/back-office/client-reads";
import { getCustomerSpace, type CustomerSpace } from "@/lib/back-office/customer-space";
import { resolveSpaceIdentity, type SpaceIdentity } from "@/lib/back-office/guest-access";
import { db } from "@/lib/db";
import { GUEST_COOKIE } from "@/lib/guest-link";
import { getFreshSession } from "@/lib/session";
import { guestKey } from "@/server/guest-key";
import { getPublicProfile } from "@/server/queries";

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
 * Who is looking at this pro's espace (spec § 12, Decision 36): the session
 * (read WITHOUT the cookie cache), the personal-link cookie and the guest key,
 * handed to the tested core `resolveSpaceIdentity`. A verified, non-impersonated
 * session wins; else the cookie, checked against this pro and the customer's
 * current link version on every request; else anonymous.
 */
export async function resolveSpaceCustomer(pro: { id: string }): Promise<SpaceIdentity> {
  const session = await getFreshSession();
  return resolveSpaceIdentity(db, pro.id, {
    session: session
      ? {
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          impersonated: Boolean(session.session.impersonatedBy),
        }
      : null,
    guestToken: (await cookies()).get(GUEST_COOKIE)?.value,
    key: guestKey(),
  });
}

/** The read-only espace of one customer of the pro (null when the customer is not this pro's). */
export function getCustomerSpacePage(professionalId: string, customerId: string): Promise<CustomerSpace | null> {
  return getCustomerSpace(db, professionalId, customerId, new Date());
}
