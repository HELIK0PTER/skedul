import "server-only";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";

import type { PublicBranding } from "@/components/public/public-shell";
import type { Effect } from "@/lib/booking/types";
import { env } from "@/lib/env";
import {
  proOfPublicPage,
  publicPageProfileOfRow,
  type ActionVisitor,
  type PublicDeps,
  type PublicPro,
} from "@/lib/public/context";
import type { SessionFacts } from "@/lib/public/identity";
import { PUBLIC_REVALIDATE, type PublicCoreResult, type PublicResult } from "@/lib/public/result";
import { runClientActionWith, runPublicActionWith } from "@/lib/public/run-action";
import { checkoutGateway, mockCheckoutEnabled } from "@/lib/stripe";
import { runEffects } from "@/server/notify";
import { getPublicPage } from "@/server/public-queries";
import { getPublicProfile } from "@/server/queries";
import { safeRead } from "@/server/safe-read";
import { currentPublicVisitor, currentSessionFacts, visitorIpHashes } from "@/server/visitor";

/**
 * { pro, branding } of the projection the /[slug] page holds, from the request-cached `getPublicPage(slug)` the
 * `[slug]` layout already ran: a séance, offer or thank-you page (and its generateMetadata) runs no professional query
 * of its own (G4c). A suspended pro is null, unless includeSuspended (the thank-you page): the cached projection never
 * hands out a suspended pro's row, so that one case reads it through `getPublicProfile`, once. The decision is
 * `proOfPublicPage` (src/lib/public/context.ts, pure and tested); the Server Actions resolve their pro here too, in
 * their own request, so a suspended pro is refused by the very same rule. The whole read goes through `safeRead` (P4
 * final review RND-1): the sub-pages and their generateMetadata run it during the render.
 */
export async function resolvePublicPro(
  slug: string,
  opts: { includeSuspended?: boolean } = {},
): Promise<{ pro: PublicPro; branding: PublicBranding } | null> {
  return safeRead(async () =>
    proOfPublicPage(await getPublicPage(slug), opts, async () => {
      const profile = await getPublicProfile(slug, { includeSuspended: true });
      return profile ? publicPageProfileOfRow(profile.pro) : null;
    }),
  );
}

/** { appUrl: env.APP_URL, checkout: checkoutGateway, mockAllowed: mockCheckoutEnabled(), env: env.APP_ENV }. */
export function publicDeps(): PublicDeps {
  return {
    appUrl: env.APP_URL,
    checkout: checkoutGateway,
    mockAllowed: mockCheckoutEnabled(),
    env: env.APP_ENV,
  };
}

/**
 * The fresh session facts, the visitor of this pro (owner, guest cookie), both IP hashes (visitorIpHashes). It only
 * reads: the Owner it returns carries what linkCustomerUser needs, and the one core that links the account
 * (bookWithHeldTicketCore) does it after its parseFr and its throttle, never before (contract § 1 Validation).
 */
export async function actionVisitor(pro: PublicPro, now: Date): Promise<ActionVisitor> {
  const [session, visitor, hashes] = await Promise.all([
    currentSessionFacts(),
    currentPublicVisitor(pro.professionalId, pro.ownerUserId),
    visitorIpHashes(now),
  ]);
  return {
    session,
    owner: visitor.owner,
    guestCustomerId: visitor.guestCustomerId,
    ipHash: hashes.ipHash,
    wideIpHash: hashes.wideIpHash,
  };
}

/** Every client-initiated effect run uses the "none" budget: the client gets what they asked for, bounded by the throttle keys, never dropped because a pro's budget is spent (Decision 74). */
function scheduleEffects(effects: Effect[]): void {
  after(() => runEffects(effects, "none"));
}

/** revalidatePath for each PUBLIC_REVALIDATE target: the public pages of every pro and /mon-espace. */
function revalidatePublic(): void {
  for (const target of PUBLIC_REVALIDATE) revalidatePath(target.path, target.type);
}

/**
 * The wrapper of every public write: runPublicActionWith with the real deps (resolvePublicPro, actionVisitor,
 * after(() => runEffects(effects, "none")), revalidatePath, console.error, console.info, unstable_rethrow,
 * () => new Date()). No logic of its own; src/server/public-context.test.ts pins the "none" budget of both wrappers.
 */
export async function runPublicAction<T extends object>(
  name: string,
  slug: unknown,
  fn: (pro: PublicPro, visitor: ActionVisitor, now: Date) => Promise<PublicCoreResult<T>>,
): Promise<PublicResult<T>> {
  return runPublicActionWith<T>(
    {
      resolvePro: async (slug) => (await resolvePublicPro(slug))?.pro ?? null,
      visitor: (pro, now) => actionVisitor(pro, now),
      schedule: scheduleEffects,
      revalidate: revalidatePublic,
      log: (line) => console.error(line),
      info: (line) => console.info(line),
      rethrowIfControlFlow: unstable_rethrow,
      now: () => new Date(),
    },
    name,
    slug,
    fn,
  );
}

/** The same for the /mon-espace actions (no slug): runClientActionWith with the real deps, fn receives the fresh session facts. */
export async function runClientAction<T extends object>(
  name: string,
  fn: (session: SessionFacts | null, now: Date) => Promise<PublicCoreResult<T>>,
): Promise<PublicResult<T>> {
  return runClientActionWith<T>(
    {
      session: currentSessionFacts,
      schedule: scheduleEffects,
      revalidate: revalidatePublic,
      log: (line) => console.error(line),
      info: (line) => console.info(line),
      rethrowIfControlFlow: unstable_rethrow,
      now: () => new Date(),
    },
    name,
    fn,
  );
}
