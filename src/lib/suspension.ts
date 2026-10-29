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

/**
 * The session that may act on behalf of its user: the session itself, or null
 * when there is none or its user is suspended (so the caller answers it like no
 * session at all). Reads the ban fields as they come back from a session read;
 * a ban end that arrived as an ISO string (a serialized cookie cache) is read
 * as a date. Final review SEC-2: a pro write must not outlive the ban by the
 * 5 minutes of the session cookie cache.
 */
export function actingSession<S extends { user: { id: string; banned?: boolean | null; banExpires?: Date | string | null } }>(
  session: S | null,
  now: Date = new Date(),
): S | null {
  if (!session) return null;
  const { banned, banExpires } = session.user;
  const suspended = isSuspended(
    { banned: banned ?? null, banExpires: banExpires == null ? null : new Date(banExpires) },
    now,
  );
  return suspended ? null : session;
}
