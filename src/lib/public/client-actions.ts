/**
 * The client's own account actions of /mon-espace (spec L1371, L1384, Decisions 16 and 17): « Modifier mon nom » and
 * « Déconnecter mes liens ». These are the cores that src/server/client.ts wraps: a verified, non-impersonated, FRESH
 * session only, checked before anything is parsed or read (a stranger learns nothing), and the session's own rows
 * only. No `server-only`, no env, no process db: the wrapper passes `db`, the session facts and `now`.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/atomic";
import { customer, user } from "@/lib/db/schema";
import { visitorState, type SessionFacts } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { myCustomerRows } from "@/lib/public/my-space";
import { plainNameSchema } from "@/lib/public/plain-name";
import { fromParse, publicFail, publicOk, type PublicCoreResult } from "@/lib/public/result";
import { parseFr } from "@/lib/zod-fr";

/** z.object({ name: plainNameSchema }).strict() (SEC-M9, SEC-M15): this name reaches the pro's mails through the customer rows. */
export const myNameInputSchema = z.object({ name: plainNameSchema }).strict();

/** « Modifier mon nom » (L1384): a verified, non-impersonated session only; parseFr(myNameInputSchema, input); ONE db.batch = UPDATE "user" SET name WHERE id = uid + UPDATE customer SET name WHERE user_id = uid. */
export async function updateMyNameCore(db: Db, s: SessionFacts | null, input: unknown, now: Date): Promise<PublicCoreResult> {
  if (s === null || visitorState(s) !== "verified") return publicFail(COPY.SIGNED_IN_ONLY);
  const parsed = parseFr(myNameInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const { name } = parsed.data;
  // One batch, one transaction: the account and its linked rows change together or not at all.
  await db.batch([
    db.update(user).set({ name, updatedAt: now }).where(eq(user.id, s.userId)),
    db.update(customer).set({ name, updatedAt: now }).where(eq(customer.userId, s.userId)),
  ]);
  return publicOk({});
}

/** « Déconnecter mes liens » (L1371): verified, non-impersonated; ONE statement: link_version + 1 on every row of the getMySpace predicate; returns their number. */
export async function revokeMyLinksCore(
  db: Db,
  s: SessionFacts | null,
  now: Date,
): Promise<PublicCoreResult<{ customers: number }>> {
  if (s === null || visitorState(s) !== "verified") return publicFail(COPY.SIGNED_IN_ONLY);
  // No suspension filter, unlike the cards: a link of a suspended pro is dead today and must stay dead if the pro comes back.
  const rows = await db
    .update(customer)
    .set({ linkVersion: sql`${customer.linkVersion} + 1`, updatedAt: now })
    .where(myCustomerRows(s))
    .returning({ id: customer.id });
  return publicOk({ customers: rows.length });
}
