import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ComponentProps } from "react";
import { Ticket } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { CheckoutReturn } from "@/components/public/checkout-return";
import { OfferCheckoutForm } from "@/components/public/offer-checkout-form";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { plural } from "@/lib/back-office/format";
import { COPY, acceptedByLine } from "@/lib/public/messages";
import { referenceForPage } from "@/lib/public/visibility";
import { boutiqueHref } from "@/lib/public-anchors";
import { paymentMode } from "@/lib/stripe";
import { formatMoney } from "@/lib/utils";
import { resolvePublicPro } from "@/server/public-context";
import { getOfferPage, getPurchaseReference } from "@/server/public-queries";
import { currentPublicVisitor } from "@/server/visitor";

type Props = {
  params: Promise<{ slug: string; offerId: string }>;
  searchParams: Promise<{ paiement?: string | string[]; p?: string | string[] }>;
};

/** A query value that is one string, else undefined. */
const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * One read of the pro and of the offer per request, shared by generateMetadata and the page, with the request's one
 * clock (G4a): the memoized call reads `new Date()` once and returns it, so every later read of the page agrees about « now ».
 */
const loadOffer = cache(async (slug: string, offerId: string) => {
  const resolved = await resolvePublicPro(slug);
  if (!resolved) return null;
  const now = new Date();
  const offer = await getOfferPage(resolved.pro.professionalId, offerId);
  return { ...resolved, offer, now };
});

/**
 * « {label} · {business} » for an offer on sale, the business name when it is no longer sold. The URL may carry `p`
 * (the cancel URL of a Checkout), so the referrer is not sent.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, offerId } = await params;
  const loaded = await loadOffer(slug, offerId);
  if (!loaded) return { title: "Page introuvable", referrer: "no-referrer", robots: { index: false } };
  const { pro, offer } = loaded;
  const title = offer?.kind === "on_sale" ? `${offer.label} · ${pro.businessName}` : pro.businessName;
  return { title, referrer: "no-referrer" };
}

/**
 * One offer of the Boutique and its checkout (spec § 13.4, E9, contract § 3.23 and § 5). Dynamic by construction: it reads
 * the fresh session. A render never writes. Another pro's or an unknown offer is a 404; an offer that is no longer sold
 * says so and leads back to the Boutique.
 */
export default async function OfferPage({ params, searchParams }: Props) {
  const { slug, offerId } = await params;
  const query = await searchParams;
  const loaded = await loadOffer(slug, offerId);
  if (!loaded) notFound();
  const { pro, branding, offer, now } = loaded;
  if (!offer) notFound();
  if (offer.kind === "unavailable") {
    return (
      <PublicShell branding={branding} backHref={`/${slug}`}>
        <EmptyState
          icon={Ticket}
          title={COPY.OFFER_GONE}
          action={
            <Button asChild>
              <Link href={boutiqueHref(slug)}>{COPY.SEE_SHOP}</Link>
            </Button>
          }
        />
      </PublicShell>
    );
  }

  const visitor = await currentPublicVisitor(pro.professionalId, pro.ownerUserId);

  // The `?p=` reference describes THAT purchase, never its customer (Decision 71): read only on the cancel URL of a shop
  // Checkout, through the slug's pro, and shown only when it is a shop purchase of this very offer.
  const referenceId = one(query.paiement) === "annule" ? one(query.p) : undefined;
  const reference = referenceId ? await getPurchaseReference(pro.professionalId, referenceId, now) : null;
  const refView = referenceForPage(reference, { kind: "offer", offerId }, visitor.owner);
  let checkout: ComponentProps<typeof CheckoutReturn> | null = null;
  if (refView !== null) {
    checkout = {
      slug,
      purchaseId: refView.purchaseId,
      kind: refView.kind,
      status: refView.status,
      processing: refView.processing,
      resumeUrl: refView.status === "pending" ? refView.resumeUrl : null,
      holdUntilLabel: null,
      merciHref: `/${slug}/merci?p=${encodeURIComponent(refView.purchaseId)}`,
    };
  }

  const priceLabel = formatMoney(offer.priceCents, pro.currency);
  const accepted = offer.acceptedBy.length > 0 ? acceptedByLine(offer.acceptedBy) : null;
  const payment = paymentMode();
  const testMode = payment === "live" ? null : payment;

  return (
    <PublicShell branding={branding} backHref={`/${slug}`}>
      {/* One instance for every signed-in visitor, at a stable position above the checkout the refresh may swap: it keeps its state across the unverified -> verified flip, so « Adresse confirmée. » is announced and takes the focus (WCAG 2.4.3). The form below is keyed on the state, so it starts over from the session's e-mail on that flip. */}
      {visitor.email !== null && <VerifyEmailBanner email={visitor.email} verified={visitor.state === "verified"} />}
      <div className="space-y-6">
        {checkout && <CheckoutReturn key={checkout.purchaseId} {...checkout} />}
        <Card>
          <CardContent className="space-y-4 p-6">
            <h1 className="text-2xl font-bold tracking-tight wrap-anywhere">{offer.label}</h1>
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: offer.color }} aria-hidden />
              <span className="min-w-0 font-medium wrap-anywhere">{offer.ticketTypeName}</span>
            </span>
            {offer.typeDescription && (
              <p className="text-sm text-zinc-600 wrap-anywhere whitespace-pre-line">{offer.typeDescription}</p>
            )}
            <p className="text-lg font-semibold">
              {offer.validityText ? `${priceLabel} · valable ${offer.validityText}` : priceLabel}
            </p>
            {accepted !== null && <p className="text-sm text-zinc-600 wrap-anywhere">{accepted}</p>}
            <p className="text-sm wrap-anywhere">
              {`Vous recevez ${plural(offer.quantity, "ticket", "tickets")} « ${offer.ticketTypeName} » après le paiement.`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <OfferCheckoutForm
              key={visitor.state}
              slug={slug}
              offerId={offerId}
              businessName={pro.businessName}
              priceLabel={priceLabel}
              visitor={{ state: visitor.state, email: visitor.state === "verified" ? visitor.email : null, name: visitor.name }}
              testMode={testMode}
            />
          </CardContent>
        </Card>
      </div>
    </PublicShell>
  );
}
