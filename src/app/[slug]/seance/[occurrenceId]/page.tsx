import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { MapPin } from "lucide-react";

import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { OccurrenceBooking } from "@/components/public/occurrence-booking";
import { OwnerPreviewBanner } from "@/components/public/owner-preview-banner";
import { PublicShell } from "@/components/public/public-shell";
import { WalletPanel } from "@/components/public/wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatWhen } from "@/lib/back-office/format";
import { env } from "@/lib/env";
import { COPY, seatsLeftLabel } from "@/lib/public/messages";
import { seanceState, stateLabel } from "@/lib/public/planning-view";
import { BOOKED_CONFIRMED, BOOKED_PENDING, SEE_MY_SPACE, stateLine } from "@/lib/public/seance-copy";
import { canSeePrivateSeance, seancePageMode, seanceViewerOf, type PageBooking } from "@/lib/public/visibility";
import { getCustomerSpacePage } from "@/server/client-queries";
import { resolvePublicPro } from "@/server/public-context";
import { getSeancePage, getSeanceVisitorFacts } from "@/server/public-queries";
import { currentPublicVisitor } from "@/server/visitor";

type Props = { params: Promise<{ slug: string; occurrenceId: string }> };

/**
 * One read of the pro and of the séance per request, shared by generateMetadata and the page, with the request's one
 * clock (G4a): the memoized call reads `new Date()` once and returns it, so the metadata, the séance read, the state and
 * every later read of the page agree about « now ».
 */
const loadSeance = cache(async (slug: string, occurrenceId: string) => {
  const resolved = await resolvePublicPro(slug);
  if (!resolved) return null;
  const now = new Date();
  const detail = await getSeancePage(resolved.pro, occurrenceId, now);
  return { ...resolved, detail, now };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, occurrenceId } = await params;
  const loaded = await loadSeance(slug, occurrenceId);
  if (!loaded) return { title: "Page introuvable", referrer: "no-referrer", robots: { index: false } };
  const { pro, detail } = loaded;
  // The metadata never depends on the viewer: a private, archived, RDV, unknown or foreign séance carries the business name only.
  if (!detail || detail.kind === "rdv" || detail.isPrivate || detail.archived) {
    return { title: pro.businessName, referrer: "no-referrer", robots: { index: false } };
  }
  return { title: `${detail.title} · ${pro.businessName}`, referrer: "no-referrer" };
}

/** A sentence above the booking form (a guest cookie's booking, an ended booking). */
function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-zinc-700">{children}</p>;
}

/**
 * One séance of a pro (spec § 13.2, contract § 3.21 and § 5). Precedence (Decision 9): unknown or another pro's ->
 * 404; RDV -> the espace; private and not visible to this viewer -> 404; then the state, the booked block or the
 * booking form of the mode. Dynamic: it reads the fresh session and the personal-link cookie. Nothing is written.
 */
export default async function SeancePage({ params }: Props) {
  const { slug, occurrenceId } = await params;
  const loaded = await loadSeance(slug, occurrenceId);
  if (!loaded) notFound();
  const { pro, branding, detail, now } = loaded;
  if (!detail) notFound();
  if (detail.kind === "rdv") redirect(`/${pro.slug}/espace`);

  const visitor = await currentPublicVisitor(pro.professionalId, pro.ownerUserId);
  const viewer = seanceViewerOf({ visitor, reference: null });
  const customerViewer = viewer?.kind === "customer" ? viewer : null;
  const [facts, space] = await Promise.all([
    customerViewer ? getSeanceVisitorFacts(pro.professionalId, detail.occurrenceId, customerViewer, now) : Promise.resolve(null),
    visitor.owner ? getCustomerSpacePage(pro.professionalId, visitor.owner.customerId) : Promise.resolve(null),
  ]);

  if (detail.isPrivate && !canSeePrivateSeance({ isPageOwner: visitor.isPageOwner, viewer, customerHasActiveBooking: facts?.booking != null })) notFound();

  const state = seanceState(detail, now, pro.timezone);
  const usable = customerViewer?.source === "owner" ? (facts?.usable ?? null) : null;
  // Only the Owner's own booking decides « booked »; a guest cookie's booking never hides the form (Decision 63).
  const booked: PageBooking =
    customerViewer?.source === "owner" && facts?.booking ? { status: facts.booking.status, via: "owner" } : null;
  const guestBooked = customerViewer?.source === "guest" && facts?.booking != null;
  const ended = customerViewer?.source === "owner" ? (facts?.ended ?? null) : null;
  const mode = seancePageMode({
    state,
    archived: detail.archived,
    isPrivate: detail.isPrivate,
    booked,
    mode: detail.bookingMode,
    canSpend: usable !== null,
    coveringOffers: detail.offers.filter((o) => o.covers).length,
  });

  const label = stateLabel(state);
  const when = formatWhen(detail.startsAt, detail.endsAt, pro.timezone);
  const showSeats = state.kind === "open" || state.kind === "free";

  return (
    <PublicShell branding={branding} backHref={`/${pro.slug}`}>
      {visitor.isPageOwner && <OwnerPreviewBanner />}
      {/* One instance for every signed-in visitor (the address is only set for a verified or unverified session), at a stable position above the booking card the refresh may swap: it keeps its state across the unverified -> verified flip, so « Adresse confirmée. » is announced and takes the focus (WCAG 2.4.3). */}
      {visitor.email !== null && <VerifyEmailBanner email={visitor.email} verified={visitor.state === "verified"} />}

      <section aria-labelledby="seance-title" className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* id = SEANCE_HEADING_ID: the booking form gives it the focus after a success that books the visitor. */}
          <h2
            id="seance-title"
            tabIndex={-1}
            className="min-w-0 rounded text-2xl font-bold tracking-tight wrap-anywhere focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {detail.title}
          </h2>
          {label && <Badge variant={state.kind === "cancelled" ? "destructive" : state.kind === "free" ? "default" : "neutral"}>{label}</Badge>}
        </div>
        <p className="mt-1 text-sm text-zinc-600">{when}</p>
        {detail.location && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-zinc-600">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-anywhere">{detail.location}</span>
          </p>
        )}
        {showSeats && <p className="mt-1 text-sm text-zinc-600">{seatsLeftLabel(detail.seatsLeft)}</p>}
        {detail.acceptedTypes.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Types de ticket acceptés">
            {detail.acceptedTypes.map((t) => (
              <li
                key={t.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="min-w-0 wrap-anywhere">{t.name}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.description && (
          <p className="mt-4 text-sm whitespace-pre-line text-zinc-700 wrap-anywhere">{detail.description}</p>
        )}
      </section>

      {space && space.wallet.length > 0 && (
        <div className="mb-6">
          <WalletPanel slug={pro.slug} businessName={pro.businessName} wallet={space.wallet} variant="compact" />
        </div>
      )}

      {mode.kind === "booked" ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-6">
            <p className="font-medium">{mode.status === "confirmed" ? BOOKED_CONFIRMED : BOOKED_PENDING}</p>
            {mode.status === "confirmed" && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/${pro.slug}/espace`}>{SEE_MY_SPACE}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : mode.kind === "state" ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm">{stateLine(mode.state.kind)}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {guestBooked && <Notice>{COPY.GUEST_BOOKING_EXISTS}</Notice>}
          {ended === "cancelled" && <Notice>{COPY.ENDED_CANCELLED}</Notice>}
          {ended === "expired" && <Notice>{COPY.ENDED_EXPIRED}</Notice>}
          <OccurrenceBooking
            key={`${visitor.state}:${usable !== null ? "spend" : "buy"}`}
            slug={pro.slug}
            occurrenceId={detail.occurrenceId}
            seenStartsAt={detail.startsAt.toISOString()}
            businessName={pro.businessName}
            currency={pro.currency}
            mode={mode.kind}
            questions={detail.questions.map((q) => ({
              id: q.id,
              label: q.label,
              type: q.type,
              options: q.options,
              required: q.required,
            }))}
            offers={[]}
            visitor={{
              state: visitor.state,
              email: visitor.state === "verified" ? visitor.email : null,
              name: visitor.state === "verified" ? visitor.name : null,
              canSpend: usable !== null,
              leftAfter: usable?.leftAfter ?? 0,
              typeName: usable?.typeName ?? null,
            }}
            googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
            returnTo={`/${pro.slug}/seance/${detail.occurrenceId}`}
            testMode={null}
          />
        </>
      )}
    </PublicShell>
  );
}
