import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { ADMIN_TZ } from "@/lib/analytics";
import { clientIpFrom, ipBuckets } from "@/lib/client-ip";
import { dayKeyInTz } from "@/lib/datetime";
import { db } from "@/lib/db";
import { GUEST_COOKIE } from "@/lib/guest-link";
import {
  linkCustomerUser,
  resolveVisitor,
  sessionFactsOf,
  type PublicVisitor,
  type SessionFacts,
  type WalletOwner,
} from "@/lib/public/identity";
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

/** cache()d per request on (professionalId, ownerUserId): resolveVisitor with the fresh session, the skedul_guest cookie and the guest key. */
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

/**
 * The wallet owner of this pro (L1341-1346), or null: fresh session, not impersonated, verified, owned customer;
 * then linkCustomerUser. Actions only (it writes). The cookie is never read here: it can be planted by another
 * site and never makes an Owner.
 */
export async function requireWalletOwner(
  pro: { professionalId: string; ownerUserId: string },
  now: Date,
): Promise<WalletOwner | null> {
  const session = await currentSessionFacts();
  const { owner } = await resolveVisitor(db, { session, guestToken: undefined, key: guestKey() }, pro);
  if (!owner) return null;
  await linkCustomerUser(db, owner, now);
  return owner;
}
