import { sql, type SQL } from "drizzle-orm";

import { user } from "@/lib/db/schema";

/**
 * A user is suspended while `banned` is set and the ban has no end or ends in
 * the future. A ban whose date has passed counts as lifted (Better Auth clears
 * the row lazily on the next sign-in).
 */
export function isSuspended(
  u: { banned: boolean | null; banExpires: Date | null },
  now: Date = new Date(),
): boolean {
  if (!u.banned) return false;
  return u.banExpires === null || u.banExpires.getTime() > now.getTime();
}

/** SQL twin of `isSuspended`, for queries that join the `user` table. */
export function userIsSuspended(): SQL {
  return sql`(${user.banned} and (${user.banExpires} is null or ${user.banExpires} > now()))`;
}

export function userNotSuspended(): SQL {
  return sql`not ${userIsSuspended()}`;
}
