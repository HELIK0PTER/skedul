import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { ADMIN_TZ } from "@/lib/analytics";
import { clientIpFrom, ipBuckets } from "@/lib/client-ip";
import { dayKeyInTz } from "@/lib/datetime";
import { db } from "@/lib/db";
import { GUEST_COOKIE } from "@/lib/guest-link";
import { resolveVisitor, sessionFactsOf, type PublicVisitor, type SessionFacts } from "@/lib/public/identity";
import { getFreshSession } from "@/lib/session";
import { actingSession } from "@/lib/suspension";
import { ipHash } from "@/lib/visitor-hash";
import { getDailySalt } from "@/server/analytics-salt";
import { guestKey } from "@/server/guest-key";

/** ipHash(daily salt, bucket) of both ipBuckets(clientIpFrom(await headers())) entries; wideIpHash null when the wide bucket is null. */
export async function visitorIpHashes(now: Date): Promise<{ ipHash: string; wideIpHash: string | null }> {
  const { narrow, wide } = ipBuckets(clientIpFrom(await headers()));
  const salt = await getDailySalt(dayKeyInTz(now, ADMIN_TZ));
  return { ipHash: ipHash(salt, narrow), wideIpHash: wide === null ? null : ipHash(salt, wide) };
}

/**
 * sessionFactsOf(actingSession(await getFreshSession())): never the 5-minute cookie cache (L1321-1324), and a
 * suspended user is no session (FR:SEC-2, as requireProContext).
 */
export async function currentSessionFacts(): Promise<SessionFacts | null> {
  return sessionFactsOf(actingSession(await getFreshSession()));
}

/**
 * cache()d per request on (professionalId, ownerUserId): resolveVisitor with the fresh session, the skedul_guest cookie
 * and the guest key. It only reads. The wallet Owner is its `owner` field; the one write that depends on it (the
 * account link) is made by bookWithHeldTicketCore, after its parseFr and its throttle (contract Revision 3.2).
 */
export const currentPublicVisitor: (professionalId: string, ownerUserId: string) => Promise<PublicVisitor> = cache(
  async (professionalId: string, ownerUserId: string): Promise<PublicVisitor> =>
    resolveVisitor(
      db,
      {
        session: await currentSessionFacts(),
        guestToken: (await cookies()).get(GUEST_COOKIE)?.value,
        key: guestKey(),
      },
      { professionalId, ownerUserId },
    ),
);
