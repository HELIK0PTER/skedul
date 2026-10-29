import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Clock, Globe } from "lucide-react";

import { SignInStatus } from "@/components/auth/sign-in-status";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { CheckoutReturn } from "@/components/public/checkout-return";
import { OwnerPreviewBanner } from "@/components/public/owner-preview-banner";
import { PendingHolds } from "@/components/public/pending-holds";
import { PublicShell } from "@/components/public/public-shell";
import { RdvBooking } from "@/components/public/rdv-booking";
import { ReleaseStatus } from "@/components/public/release-status";
import { WalletPanel } from "@/components/public/wallet-panel";
import { WeekStepLink } from "@/components/public/week-step-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatWhenShort } from "@/lib/back-office/format";
import { formatTime } from "@/lib/datetime";
import { env } from "@/lib/env";
import { checkoutBlockOf } from "@/lib/public/checkout-return-view";
import { COPY, rdvTimeZoneLine } from "@/lib/public/messages";
import { rdvMetadata } from "@/lib/public/page-metadata";
import {
  RDV_PICK_TITLE,
  RDV_PREV_WEEK,
  lowestPriceCents,
  rdvDaysVM,
  rdvDurationLabel,
  rdvPriceLabel,
  rdvWeekKey,
  rdvWeekNav,
  type RdvWeekNav,
} from "@/lib/public/rdv-view";
import { referenceForPage } from "@/lib/public/visibility";
import { RDV_HEADING_ID } from "@/lib/public-anchors";
import { paymentMode } from "@/lib/stripe";
import { idSchema } from "@/lib/tickets";
import { timeZoneLabel } from "@/lib/timezones";
import { getCustomerSpacePage } from "@/server/client-queries";
import { resolvePublicPro } from "@/server/public-context";
import { getLivePendingHolds, getPurchaseReference, getRdvOwnerTickets, getRdvTypePage, getRdvWeek } from "@/server/public-queries";
import { currentPublicVisitor } from "@/server/visitor";

type Props = {
  params: Promise<{ slug: string; ticketTypeId: string }>;
  searchParams: Promise<{ semaine?: string | string[]; paiement?: string | string[]; p?: string | string[] }>;
};

/** A query value that is one string, else undefined. */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * One read of the pro and of the RDV type per request, shared by generateMetadata and the page, with the request's one
 * clock (G4a): the memoized call reads `new Date()` once and returns it, so the type's offers (their `coversUntil`), the
 * week, the slots and every later read of the page agree about « now ». A malformed id is refused before any read; it,
 * an unknown, another pro's, an archived, a not RDV-enabled and a duration-less type all come back as `type: null`
 * (or null for the id), the one path to notFound() (P5 § 3.11, no oracle).
 */
const loadRdv = cache(async (slug: string, ticketTypeId: string) => {
  if (!idSchema.safeParse(ticketTypeId).success) return null;
  const resolved = await resolvePublicPro(slug);
  if (!resolved) return null;
  const now = new Date();
  const type = await getRdvTypePage(resolved.pro, ticketTypeId, now);
  return { ...resolved, type, now };
});

/**
 * « {name} · {business} » for an RDV type this pro takes online, the 404's metadata for every case the page answers
 * notFound() for. It reads the type only, never the viewer (the SEC-M10 pattern); the referrer is never sent and a
 * payment return (`p`, `paiement`) is neither indexed nor followed (SEC-6): rdvMetadata of the type and the page's query.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug, ticketTypeId } = await params;
  const loaded = await loadRdv(slug, ticketTypeId);
  return rdvMetadata(loaded, await searchParams);
}

/**
 * The week navigation of the page: the same link for each step at every week, aria-disabled at either end (today's
 * week, the horizon), so the focus stays on it when a keyboard user reaches an end (P6 A44).
 */
function WeekNav({ nav }: { nav: RdvWeekNav }) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <WeekStepLink href={nav.prevHref} fallbackHref={nav.selfHref} scroll={false}>
        <ChevronLeft aria-hidden />
        {RDV_PREV_WEEK}
      </WeekStepLink>
      <p className="order-first w-full text-center text-sm font-semibold sm:order-none sm:w-auto sm:flex-1">{nav.title}</p>
      <WeekStepLink href={nav.nextHref} fallbackHref={nav.selfHref} scroll={false}>
        {COPY.RDV_NEXT_WEEK}
        <ChevronRight aria-hidden />
      </WeekStepLink>
    </div>
  );
}

/**
 * One RDV libre type of a pro (P5 dossier § 3.3, § 3.6, § 3.11): its week of free slots (`?semaine=`, by default the
 * week of now + notice), the booking block of the chosen slot (free, held ticket or buy) and, on the cancel URL of its
 * Checkout, the payment return. Every notFound() case is decided before the visitor is read. Dynamic: it reads the fresh
 * session and the `?p=` reference. A render never writes.
 */
export default async function RdvPage({ params, searchParams }: Props) {
  const { slug, ticketTypeId } = await params;
  const query = await searchParams;
  const loaded = await loadRdv(slug, ticketTypeId);
  if (!loaded) notFound();
  const { pro, branding, type, now } = loaded;
  if (!type) notFound();
  const tz = pro.timezone;
  const weekKey = rdvWeekKey(one(query.semaine), now, tz, type.window);

  const visitor = await currentPublicVisitor(pro.professionalId, pro.ownerUserId);
  const owner = visitor.owner;

  // The `?p=` reference describes THAT purchase and its own booking, never its customer (Decision 71): read only on the
  // cancel URL of a Checkout, through the slug's pro, and shown only when it is an RDV of this very type (O6, § 3.8).
  const referenceId = one(query.paiement) === "annule" ? one(query.p) : undefined;
  const [week, reference, space, liveHolds, ownerTickets] = await Promise.all([
    getRdvWeek(pro, type.ticketTypeId, weekKey, now),
    referenceId ? getPurchaseReference(pro.professionalId, referenceId, now) : Promise.resolve(null),
    owner ? getCustomerSpacePage(pro.professionalId, owner.customerId, now) : Promise.resolve(null),
    // SEC-I6: the live holds of the Owner at this pro (strangers typing her address park slots on her row).
    owner ? getLivePendingHolds(pro.professionalId, owner.customerId, now) : Promise.resolve([]),
    // The tickets of THIS type only, and the Owner's only: a typed address, a guest cookie or an impersonating admin
    // (no Owner) never spends (Decisions 63, 71; P4 Review Focus 6).
    owner && !type.isFree ? getRdvOwnerTickets(pro.professionalId, owner.customerId, type.ticketTypeId) : Promise.resolve(null),
  ]);
  if (!week) notFound();

  const refView = referenceForPage(reference, { kind: "rdv", ticketTypeId: type.ticketTypeId }, owner);
  // An admin impersonating someone has no client identity (Decision 19): the block is read-only and the Checkout URL
  // stays on the server (G4b). The block's props come from the same pure module as the séance and offer pages' (G4c).
  const readOnly = visitor.state === "impersonating";
  const checkout = refView === null ? null : checkoutBlockOf(refView, { slug: pro.slug, tz, now, readOnly });
  // The purchase the payment block already shows is not listed twice.
  const holdRows = liveHolds
    .filter((h) => h.purchaseId !== checkout?.purchaseId)
    .map((h) => ({
      purchaseId: h.purchaseId,
      isRdv: h.isRdv,
      title: h.title,
      whenLabel: formatWhenShort(h.startsAt, tz, now),
      holdUntilLabel: formatTime(h.holdExpiresAt, tz),
    }));

  const days = rdvDaysVM(week.days, tz);
  const nav = rdvWeekNav({ slug: pro.slug, ticketTypeId: type.ticketTypeId, weekKey, now, tz, window: type.window });
  const closed = type.neverBookable || week.neverBookable;
  const price = rdvPriceLabel({ isFree: type.isFree, fromPriceCents: lowestPriceCents(type.offers) }, pro.currency);
  const payment = paymentMode();
  const testMode = payment === "live" ? null : payment;

  return (
    <PublicShell branding={branding} backHref={`/${pro.slug}`}>
      {visitor.isPageOwner && <OwnerPreviewBanner />}
      {/* One instance for every signed-in visitor, at a stable position above the booking block the refresh may swap: it keeps its state across the unverified -> verified flip, so « Adresse confirmée. » is announced and takes the focus (WCAG 2.4.3). */}
      {visitor.email !== null && <VerifyEmailBanner email={visitor.email} verified={visitor.state === "verified"} />}
      {/* The page's one sign-in line (UI-1): the code dialog of the booking block says « Connexion réussie. » here, outside the block its refresh remounts. */}
      <SignInStatus />

      <section aria-labelledby={RDV_HEADING_ID} className="mb-6">
        {/* The booking block gives this heading the focus after a sign-in (OtpDialog): every state of the page renders it. */}
        <h2
          id={RDV_HEADING_ID}
          tabIndex={-1}
          className="min-w-0 rounded text-2xl font-bold tracking-tight wrap-anywhere focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {type.name}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            {rdvDurationLabel(type.durationMin)}
          </span>
          {price !== null && (type.isFree ? <Badge variant="success">{price}</Badge> : <span className="font-medium text-foreground">{price}</span>)}
        </p>
        {type.description && (
          <p className="mt-4 text-sm whitespace-pre-line text-zinc-700 wrap-anywhere">{type.description}</p>
        )}
      </section>

      {space && space.wallet.length > 0 && (
        <div className="mb-6">
          <WalletPanel slug={pro.slug} businessName={pro.businessName} wallet={space.wallet} variant="compact" />
        </div>
      )}

      {/* Always rendered, whatever the page shows: what a release said survives the revalidation that removes the block below (G4c). */}
      <ReleaseStatus />
      {checkout && (
        <div className="mb-6">
          <CheckoutReturn key={checkout.purchaseId} {...checkout} />
        </div>
      )}
      {visitor.owner && (
        <div className="mb-6 empty:hidden">
          <PendingHolds slug={pro.slug} holds={holdRows} />
        </div>
      )}

      {closed ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <CalendarX2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{COPY.RDV_CLOSED}</p>
        </Card>
      ) : (
        <section aria-labelledby="rdv-pick-title" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id="rdv-pick-title" className="text-lg font-semibold tracking-tight">
              {RDV_PICK_TITLE}
            </h3>
            <p className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
              <Globe className="size-3.5 shrink-0" aria-hidden />
              {rdvTimeZoneLine(timeZoneLabel(tz))}
            </p>
          </div>
          <WeekNav nav={nav} />
          {/* Mounted for every week, an empty one included: it says the empty week itself, so a booking or a refusal whose refetch takes the last slot keeps its status, alert and resume link (R2). */}
          <RdvBooking
            key={`${nav.weekKey}:${visitor.state}:${refView?.purchaseId ?? ""}`}
            slug={pro.slug}
            ticketTypeId={type.ticketTypeId}
            businessName={pro.businessName}
            currency={pro.currency}
            isFree={type.isFree}
            days={days}
            nextWeekHref={nav.nextHref}
            questions={type.questions.map((q) => ({
              id: q.id,
              label: q.label,
              type: q.type,
              options: q.options,
              required: q.required,
            }))}
            offers={type.offers.map((o) => ({
              offerId: o.offerId,
              label: o.label,
              priceCents: o.priceCents,
              validityText: o.validityText,
              coversUntil: o.coversUntil,
            }))}
            ownerTickets={ownerTickets}
            visitor={{
              state: visitor.state,
              email: visitor.state === "verified" ? visitor.email : null,
              name: visitor.state === "verified" ? visitor.name : null,
            }}
            googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
            returnTo={`/${pro.slug}/rdv/${type.ticketTypeId}`}
            testMode={testMode}
          />
        </section>
      )}
    </PublicShell>
  );
}
