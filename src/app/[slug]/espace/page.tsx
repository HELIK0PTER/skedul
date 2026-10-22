import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientSignInChoices } from "@/components/auth/client-sign-in-choices";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { FormError } from "@/components/dashboard/form-error";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { CustomerSpaceView } from "@/components/public/customer-space";
import { ForgetGuestLinkButton } from "@/components/public/forget-guest-link-button";
import { OtherAddressButton } from "@/components/public/other-address-button";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { COPY, guestNote, noRecordText } from "@/lib/public/messages";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import { bannerOfIdentity, canSpendIn, visitorStateOfIdentity } from "@/lib/public/space-view";
import {
  getCustomerSpacePage,
  getSpaceProfile,
  getSpendableSeances,
  resolveSpaceCustomer,
} from "@/server/client-queries";

export const metadata: Metadata = { title: "Mon espace", robots: { index: false } };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lien?: string }>;
};

/**
 * The client espace of one pro (spec § 12, Q22). Identity comes only from the request's visitor (resolveSpaceCustomer:
 * fresh session, suspended user = no session, personal-link cookie checked against this pro and its current version):
 * an impersonating admin sees a notice; the Owner and the personal link's customer see their space; a verified session
 * without a record sees « Aucun ticket … » and can use another address; an unverified one sees the link's customer
 * read-only, or « Confirmez votre adresse pour voir vos réservations. » when there is none, never the code form; only
 * an anonymous visitor is offered the code form. Every signed-in, non-impersonated visitor gets the confirmation
 * banner, rendered once in the shell so that it stays mounted when a code is accepted. Never indexed, never counted
 * in the page-view stats (isTrackedPath), rendered per request. Client leaves get strings and booleans, never an id
 * of a row.
 */
export default async function EspacePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { lien } = await searchParams;

  // An unknown or suspended pro is offline. layout.tsx already answered the 404 before the loading boundary; the page
  // keeps its own check because it needs `pro` and a layout cannot hand props down (the two render in parallel).
  const profile = await getSpaceProfile(slug);
  if (!profile) notFound();
  const { pro } = profile;

  const identity = await resolveSpaceCustomer(pro);
  const visitorState = visitorStateOfIdentity(identity);
  const returnTo = `/${pro.slug}/espace`;

  // The customer whose space is shown: the Owner's or the personal link's. An unverified session shows the link's
  // customer read-only under the banner (COV-C1).
  const shownCustomerId =
    identity.kind === "customer"
      ? identity.customerId
      : identity.kind === "unverified"
        ? identity.guestCustomerId
        : null;
  const [space, spendable] = await Promise.all([
    shownCustomerId ? getCustomerSpacePage(pro.id, shownCustomerId) : Promise.resolve(null),
    shownCustomerId ? getSpendableSeances(pro.id, shownCustomerId) : Promise.resolve([]),
  ]);

  // The confirmation banner sits in ONE place of the tree, the first child of the shell, whatever the branch below:
  // it stays mounted when a code is accepted and the identity flips, so « Adresse confirmée. » is announced and takes
  // the focus (WCAG 2.4.3, the dashboard layout pattern). `verified` comes from the visitor state.
  const banner = bannerOfIdentity(identity, space?.customer.email ?? null);
  const shell = (children: React.ReactNode) => (
    <PublicShell branding={pro} backHref={`/${slug}`}>
      {banner && <VerifyEmailBanner email={banner.email} verified={banner.verified} />}
      {children}
    </PublicShell>
  );

  if (identity.kind === "impersonating") {
    return shell(
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-zinc-600">{COPY.IMPERSONATING}</p>
        </CardContent>
      </Card>,
    );
  }

  if (identity.kind === "no_record") {
    return shell(
      <Card>
        <CardContent className="flex flex-col items-start gap-4 py-8">
          <p className="text-sm wrap-anywhere">{noRecordText(pro.businessName, identity.email)}</p>
          <div className="flex flex-wrap items-start gap-2">
            <OtherAddressButton path={returnTo} />
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${slug}`}>{`Voir la page de ${pro.businessName}`}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>,
    );
  }

  if (space) {
    const viaLink = identity.kind === "unverified" || (identity.kind === "customer" && identity.via === "guest");
    return shell(
      <>
        {viaLink && (
          <div
            role="note"
            className="mb-6 flex flex-col gap-2 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="min-w-0 wrap-anywhere">{guestNote(space.customer.email)}</p>
            <ForgetGuestLinkButton slug={pro.slug} />
          </div>
        )}
        <CustomerSpaceView
          businessName={pro.businessName}
          slug={slug}
          space={space}
          spend={{ seances: spendable, canSpend: canSpendIn(identity), visitorState, googleEnabled: env.GOOGLE_CALENDAR_ENABLED, returnTo }}
        />
      </>,
    );
  }

  // Unverified and no space to show: the banner is above (in the shell), and the sentence says why nothing else is shown.
  if (identity.kind === "unverified") {
    return shell(<p className="text-sm text-zinc-600">{COPY.CONFIRM_EMAIL_FIRST}</p>);
  }

  // Left: an anonymous visitor, or a customer whose row vanished between the identity read and the space read.
  if (identity.kind !== "anonymous") notFound();

  return shell(
    <div className="space-y-4">
      {lien === "invalide" && <FormError message="Ce lien n'est plus valide." />}
      {canOfferCodeSignIn(visitorState) && (
        <Card>
          <CardHeader>
            <CardTitle>Accéder à mon espace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-600 wrap-anywhere">{`Recevez un code par email pour voir vos réservations chez ${pro.businessName}.`}</p>
            <EmailCodeForm idPrefix="espace-code" />
            <ClientSignInChoices returnTo={returnTo} googleEnabled={env.GOOGLE_CALENDAR_ENABLED} />
          </CardContent>
        </Card>
      )}
    </div>,
  );
}
