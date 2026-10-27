import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { Boutique } from "@/components/public/boutique";
import { OwnerPreviewBanner } from "@/components/public/owner-preview-banner";
import { PublicPlanning } from "@/components/public/public-planning";
import { PublicShell } from "@/components/public/public-shell";
import { TestPaymentsBanner } from "@/components/public/test-payments-banner";
import { VisitorBar } from "@/components/public/visitor-bar";
import { WalletPanel } from "@/components/public/wallet-panel";
import { ensureHorizon } from "@/lib/booking/occurrences";
import { addDays, todayKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";
import { paramForWeek, weekBounds, weekStartFromParam } from "@/lib/planning";
import { notFoundMetadata } from "@/lib/public/page-metadata";
import {
  groupByDay,
  parsePlanningParams,
  planningEmptyState,
  planningNav,
  toPublicSeanceVM,
} from "@/lib/public/planning-view";
import { BOUTIQUE_ANCHOR } from "@/lib/public-anchors";
import { paymentMode } from "@/lib/stripe";
import { consumeThrottle } from "@/lib/throttle";
import { getCustomerSpacePage } from "@/server/client-queries";
import {
  getBoutiquePage,
  getHorizonNeed,
  getNextSeanceStart,
  getPlanningPage,
  getPublicPage,
} from "@/server/public-queries";
import { currentPublicVisitor } from "@/server/visitor";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ semaine?: string | string[]; vue?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublicPage(slug);
  if (!page || page.suspended) return notFoundMetadata();
  return { title: page.pro.businessName, description: page.branding.headline ?? undefined };
}

/**
 * The public page of a pro: its planning (« Liste » or « Semaine », one week at a time), its Boutique, and what the
 * visitor is (the owner banner, the bar or the Owner's wallet, the test-payments note). Dynamic by construction: it
 * reads the search parameters, the fresh session and the personal-link cookie. A render never writes; the one write,
 * the horizon refresh, runs after the response (spec § 13.2, contract § 4 row 12 and § 5).
 */
export default async function PublicProfilePage({ params, searchParams }: Props) {
  const { slug } = await params;
  // The layout's read, from the request cache; a suspended pro is offline here (the layout lets it through for merci).
  const page = await getPublicPage(slug);
  if (!page || page.suspended) notFound();
  const { pro, branding, bio } = page;
  const { semaine, view } = parsePlanningParams(await searchParams);

  // The one clock of this request: every read and every view function that depends on the time takes it (the planning,
  // the horizon, the next séance, the wallet, the row labels), so that a séance the planning lists and the label it gets
  // never disagree about « now ». The Boutique read and `planningEmptyState` depend on no instant; the only other clock is
  // the one of the after() block.
  const now = new Date();
  const tz = pro.timezone;
  const weekStart = weekStartFromParam(semaine, tz, now);
  const range = weekBounds(weekStart, tz);
  const weekKey = paramForWeek(weekStart, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));

  // Who the visitor is: the fresh session (a suspended user counts as none) and the personal-link cookie, read only.
  const visitor = await currentPublicVisitor(pro.professionalId, pro.ownerUserId);
  const [seances, boutique, needsHorizon, space] = await Promise.all([
    getPlanningPage(pro, range, now),
    getBoutiquePage(pro.professionalId),
    getHorizonNeed(pro, now),
    // The wallet is the Owner's only: never a typed address, a purchase reference or a personal-link cookie (Decision 61).
    visitor.owner ? getCustomerSpacePage(pro.professionalId, visitor.owner.customerId, now) : Promise.resolve(null),
  ]);
  // Only an empty week asks where the next séance is, and only a week with nothing after it asks if there is any at all.
  const nextStart = seances.length === 0 ? await getNextSeanceStart(pro, range.end, now) : null;
  const anyStart = seances.length === 0 && nextStart === null ? await getNextSeanceStart(pro, now, now) : null;
  const { empty, nextWeekHref } = planningEmptyState({ slug: pro.slug, view, tz, shown: seances.length, nextStart, anyStart });
  const payment = paymentMode();
  const testMode = payment === "live" ? null : payment;

  // A render never writes: when a series is generated less than a few weeks ahead, the refresh runs after the response,
  // and its per-pro key (one run per 5 minutes) is consumed inside after(), never during the render (SEC-M13).
  if (needsHorizon) {
    after(async () => {
      try {
        if (await consumeThrottle(db, `t:horizon:p:${pro.professionalId}`, { limit: 1, windowSec: 300 }, new Date())) {
          const res = await ensureHorizon(db, pro.professionalId);
          if (!res.ok) console.error(`[public] ensureHorizon refused: ${res.code}`);
        }
      } catch (err) {
        console.error(`[public] ensureHorizon failed: ${logSafeMessage(err)}`);
      }
    });
  }

  return (
    <PublicShell branding={branding}>
      {visitor.isPageOwner && <OwnerPreviewBanner />}
      {/* One instance for every signed-in visitor (the address is only set for a verified or unverified session), above the wallet / bar switch the refresh may swap: it keeps its state across the unverified -> verified flip, so « Adresse confirmée. » is announced and takes the focus (WCAG 2.4.3). */}
      {visitor.email !== null && <VerifyEmailBanner email={visitor.email} verified={visitor.state === "verified"} />}
      {visitor.owner && space ? (
        <div className="mb-6">
          <WalletPanel slug={pro.slug} businessName={pro.businessName} wallet={space.wallet} variant="full" />
        </div>
      ) : (
        <VisitorBar
          state={visitor.state}
          slug={pro.slug}
          returnTo={`/${pro.slug}`}
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          hasGuestSpace={visitor.guestCustomerId !== null}
        />
      )}
      {bio && <p className="mb-8 whitespace-pre-line text-zinc-600 wrap-anywhere">{bio}</p>}
      <div className="space-y-10">
        <PublicPlanning
          nav={planningNav({ slug: pro.slug, weekKey, view, todayKey: todayKey(now, tz) })}
          view={view}
          days={groupByDay(
            seances.map((s) => toPublicSeanceVM(s, pro.slug, now, tz)),
            days,
          )}
          empty={empty}
          nextWeekHref={nextWeekHref}
          shopHref={boutique.length > 0 ? `#${BOUTIQUE_ANCHOR}` : null}
        />
        {boutique.length > 0 && (
          <div className="space-y-4">
            {testMode && <TestPaymentsBanner mode={testMode} />}
            <Boutique slug={pro.slug} currency={pro.currency} types={boutique} />
          </div>
        )}
      </div>
    </PublicShell>
  );
}
