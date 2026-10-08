import "server-only";

import { randomBytes } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { analyticsSalt, pageView } from "@/lib/db/schema";

/** Per server instance, holding only the current day (see getDailySalt). */
const cache = new Map<string, string>();

/**
 * Housekeeping, run on a cache miss (~once a day per instance): salts are
 * deleted after 2 days — from then on that day's visitor hashes can no longer
 * be linked to an IP — and page views are kept 25 months. It never throws: a
 * failed purge must not break tracking, it simply runs again on the next miss.
 */
async function purgeExpired() {
  try {
    await Promise.all([
      db
        .delete(analyticsSalt)
        .where(lt(analyticsSalt.createdAt, sql`now() - interval '2 days'`)),
      db
        .delete(pageView)
        .where(lt(pageView.createdAt, sql`now() - interval '25 months'`)),
    ]);
  } catch (err) {
    console.error("[analytics] could not purge expired data", err);
  }
}

/**
 * The random salt of a Paris day (YYYY-MM-DD), created on first use. The row is
 * inserted with ON CONFLICT DO NOTHING and read back, so concurrent instances
 * all end up with the same salt.
 */
export async function getDailySalt(dayKey: string): Promise<string> {
  const cached = cache.get(dayKey);
  if (cached) return cached;

  await db
    .insert(analyticsSalt)
    .values({ day: dayKey, salt: randomBytes(32).toString("hex") })
    .onConflictDoNothing();
  const [row] = await db
    .select({ salt: analyticsSalt.salt })
    .from(analyticsSalt)
    .where(eq(analyticsSalt.day, dayKey))
    .limit(1);
  if (!row) throw new Error(`No analytics salt for ${dayKey}`);

  await purgeExpired();
  cache.clear();
  cache.set(dayKey, row.salt);
  return row.salt;
}
