/**
 * « Mon espace » (spec L1377-1378): the cards of /mon-espace, one per pro, for a verified, non-impersonated session
 * (the page checks the visitor state before calling it). No `server-only`, no env, no process db: the caller passes
 * `db` and the session's user id and e-mail.
 *
 * The rows are the session user's: the customers linked to the user, plus the unlinked rows of the verified address
 * (a client who never signed in before was recorded by e-mail only). A row linked to ANOTHER user never matches,
 * whatever its address (Decision 5), and a pro whose user is suspended is offline. Every statement of
 * getCustomerSpace filters professional_id AND customer_id, so a card holds that customer's data and nothing else.
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { getCustomerSpace, type CustomerSpace } from "@/lib/back-office/customer-space";
import type { Db } from "@/lib/db/atomic";
import { customer, professional, user } from "@/lib/db/schema";
import { userNotSuspended } from "@/lib/suspension";
import { normalizeEmail } from "@/lib/tickets";

export const MY_SPACE_MAX_PROS = 20;

export type MySpaceCard = { slug: string; businessName: string; space: CustomerSpace };

/** The customer rows of a verified session (L1377-1378): user_id = the user, or the verified address with user_id NULL; a row linked to another user never matches (Decision 5). */
export function myCustomerRows(s: { userId: string; email: string }): SQL {
  return sql`(${customer.userId} = ${s.userId} or (${customer.email} = ${normalizeEmail(s.email)} and ${customer.userId} is null))`;
}

/** L1377-1378: customer rows WHERE user_id = uid OR (email = normalizeEmail(verified e-mail) AND user_id IS NULL), of pros whose user is not suspended; one card per pro, by business name (Intl.Collator fr), at most MY_SPACE_MAX_PROS; space = getCustomerSpace of that row. */
export async function getMySpace(db: Db, s: { userId: string; email: string }, now: Date): Promise<MySpaceCard[]> {
  const rows = await db
    .select({
      customerId: customer.id,
      professionalId: customer.professionalId,
      linked: sql<boolean>`(${customer.userId} is not null)`,
      slug: professional.slug,
      businessName: professional.businessName,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .innerJoin(user, eq(user.id, professional.userId))
    .where(and(myCustomerRows(s), userNotSuspended()))
    .orderBy(asc(customer.id));

  // One card per pro. A client whose address changed can match twice at one pro: the row linked to her wins.
  const byPro = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const kept = byPro.get(row.professionalId);
    if (!kept || (row.linked && !kept.linked)) byPro.set(row.professionalId, row);
  }

  const collator = new Intl.Collator("fr");
  const picked = [...byPro.values()]
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
