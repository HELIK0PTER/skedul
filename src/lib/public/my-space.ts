/**
 * « Mon espace » (spec L1377-1378): the cards of /mon-espace, one per pro, for a verified, non-impersonated session.
 * The read refuses anything else itself (no session, an unverified one, an impersonated one: nothing), whatever the
 * page checked before it. No `server-only`, no env, no process db: the caller passes `db` and the session facts.
 *
 * The rows are the ones the session OWNS (ownedCustomerRows, the wallet Owner's rule, Decision 5): the address of the
 * session AND user_id null or the session user's own. A row linked to ANOTHER user never matches, and neither does a
 * row linked to this user under another address (a change of the spec's L1377-1378, which also took every row linked
 * to the user: the card of a pro is the row its Owner is). A pro whose user is suspended is offline. Every statement of
 * getCustomerSpace filters professional_id AND customer_id, so a card holds that customer's data and nothing else.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { getCustomerSpace, type CustomerSpace } from "@/lib/back-office/customer-space";
import { ownedCustomerRows } from "@/lib/back-office/guest-access";
import type { Db } from "@/lib/db/atomic";
import { customer, professional, user } from "@/lib/db/schema";
import { visitorState, type SessionFacts } from "@/lib/public/identity";
import { userNotSuspended } from "@/lib/suspension";
import { normalizeEmail } from "@/lib/tickets";

export const MY_SPACE_MAX_PROS = 20;

export type MySpaceCard = { slug: string; businessName: string; space: CustomerSpace };

/**
 * Every customer row that is the session user's, for « Déconnecter mes liens » (L1371): linked to the user whatever its
 * address, or unlinked with the verified address; a row linked to another user never matches (Decision 5). Wider than
 * the cards on purpose (a row linked to the user under another address has no card but may still have a personal link
 * out there): revoking more links is always safe.
 */
export function myCustomerRows(s: { userId: string; email: string }): SQL {
  return sql`(${customer.userId} = ${s.userId} or (${customer.email} = ${normalizeEmail(s.email)} and ${customer.userId} is null))`;
}

/** L1377-1378 as Decision 5 changes it: the rows of the pros whose user is not suspended that the verified session OWNS (ownedCustomerRows), at most one per pro (customer_pro_email_uq), by business name (Intl.Collator fr), at most MY_SPACE_MAX_PROS; space = getCustomerSpace of that row. Nothing for a session that is missing, unverified or impersonated. */
export async function getMySpace(db: Db, session: SessionFacts | null, now: Date): Promise<MySpaceCard[]> {
  // The page checks the visitor state too; the read does not rely on it (fails closed like visitorState).
  if (!session || visitorState(session) !== "verified") return [];
  const rows = await db
    .select({
      customerId: customer.id,
      professionalId: customer.professionalId,
      slug: professional.slug,
      businessName: professional.businessName,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .innerJoin(user, eq(user.id, professional.userId))
    .where(and(ownedCustomerRows(session), userNotSuspended()))
    .orderBy(asc(customer.id));

  const collator = new Intl.Collator("fr");
  const picked = [...rows]
    .sort((a, b) => collator.compare(a.businessName, b.businessName) || collator.compare(a.slug, b.slug))
    .slice(0, MY_SPACE_MAX_PROS);

  const cards = await Promise.all(
    picked.map(async (row) => {
      const space = await getCustomerSpace(db, row.professionalId, row.customerId, now);
      return space ? { slug: row.slug, businessName: row.businessName, space } : null;
    }),
  );
  return cards.filter((card): card is MySpaceCard => card !== null);
}
