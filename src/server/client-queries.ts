import "server-only";

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
import { spaceIdentityOf, type SessionFacts } from "@/lib/public/identity";
import { getMySpace, type MySpaceCard } from "@/lib/public/my-space";
import { spendableSeances, type SpendableSeance } from "@/lib/public/spendable";
import { safeRead } from "@/server/safe-read";
import { currentPublicVisitor } from "@/server/visitor";

export type { SpaceIdentity };

/*
 * Every export's whole body goes through `safeRead` (P4 final review RND-1, src/server/safe-read.test.ts): a query that
 * fails during a render reaches Next's log as its SQL head only, never with the e-mail or the ids it was bound to.
 */

/** The clients page: listed clients matching the filter and the search, plus the count of every filter. */
export async function getClientsPage(
  professionalId: string,
  opts: { q: string; filter: ClientFilter },
): Promise<{ rows: ClientListRow[]; counts: Record<ClientFilter, number> }> {
  return safeRead(() => listClients(db, professionalId, new Date(), opts));
}

/** The client record page (null for another pro's or an unknown customer: the page answers notFound()). */
export async function getClientRecordPage(
  professionalId: string,
  customerId: string,
): Promise<ClientRecordData | null> {
  return safeRead(() => getClientRecord(db, professionalId, customerId, new Date()));
}

/* ───────────────────────────── Client space (/[slug]/espace) ───────────────────────────── */

/**
 * Who is looking at this pro's espace (spec § 12, Decision 36): the request's visitor (fresh session, not
 * suspended, personal-link cookie, guest key; currentPublicVisitor, shared with the other public pages of the
 * request) mapped by the tested spaceIdentityOf. An impersonating admin first; the Owner; a verified session
 * without a record; an unverified session (the confirmation banner, never the code form); the cookie's customer;
 * else anonymous. A signed-in visitor never maps to anonymous (COV-C1).
 */
export async function resolveSpaceCustomer(pro: { professionalId: string; ownerUserId: string }): Promise<SpaceIdentity> {
  return safeRead(async () => spaceIdentityOf(await currentPublicVisitor(pro.professionalId, pro.ownerUserId)));
}

/**
 * The espace read of one customer of the pro (null when the customer is not this pro's). `now` is the page's one
 * instant (contract Revision 3.9): the wallet, the cards and the séances a page draws agree about « now », and the
 * wrapper reads no clock of its own.
 */
export function getCustomerSpacePage(professionalId: string, customerId: string, now: Date): Promise<CustomerSpace | null> {
  return safeRead(() => getCustomerSpace(db, professionalId, customerId, now));
}

/**
 * « Utiliser vos tickets »: the séances a held ticket can book now (Task 21). The caller passes the id of the customer
 * whose espace it renders (`resolveSpaceCustomer`): the Owner's, or the personal link's customer for the read-only list
 * (the cookie proves nothing about who holds the browser, so for it the list is information only). Never an id from
 * the request. What books is the control `canSpendIn` offers to the Owner alone, and the engine reads the Owner's own
 * customer again when the booking is made. `now` is the page's one instant, like `getCustomerSpacePage`'s.
 */
export function getSpendableSeances(professionalId: string, customerId: string, now: Date): Promise<SpendableSeance[]> {
  return safeRead(() => spendableSeances(db, professionalId, customerId, now));
}

/**
 * The cards of /mon-espace (L1377-1378, Decision 5): one per pro, the row the session OWNS. It takes the session facts
 * (the fresh, not suspended session of `currentSessionFacts`, or null) and the read itself answers nothing unless they
 * are verified and not impersonated: the page checks the visitor state too, but a data read does not rely on a caller.
 * `now` is the page's instant.
 */
export function getMySpacePage(session: SessionFacts | null, now: Date): Promise<MySpaceCard[]> {
  return safeRead(() => getMySpace(db, session, now));
}
