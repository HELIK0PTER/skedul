import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FormError } from "@/components/dashboard/form-error";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { CustomerSpaceView } from "@/components/public/customer-space";
import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { COPY } from "@/lib/public/messages";
import { getCustomerSpacePage, getSpaceProfile, resolveSpaceCustomer } from "@/server/client-queries";

export const metadata: Metadata = { title: "Mon espace", robots: { index: false } };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lien?: string }>;
};

const ANONYMOUS_HINT = "Ouvrez le lien personnel reçu par email pour voir vos réservations.";

/**
 * Read-only client space (spec § 12, Q22). Identity: a verified fresh session
 * first, else the personal-link cookie, else a hint. Never indexed, never
 * counted in the page-view stats (isTrackedPath), and rendered per request:
 * it reads the session and the cookie, so it is never cached or prerendered.
 */
export default async function EspacePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { lien } = await searchParams;

  // An unknown or suspended pro is offline. layout.tsx already answered the 404 before the
  // loading boundary; the page keeps its own check because it needs `pro` and a layout cannot
  // hand props down (layout and page render in parallel, so the page may not rely on it).
  const profile = await getSpaceProfile(slug);
  if (!profile) notFound();
  const { pro } = profile;

  const identity = await resolveSpaceCustomer(pro);
  // The customer whose space is shown: the Owner's or the cookie's; an unverified session shows the cookie's, read-only, under the banner.
  const spaceCustomerId =
    identity.kind === "customer"
      ? identity.customerId
      : identity.kind === "unverified"
        ? identity.guestCustomerId
        : null;
  const space = spaceCustomerId ? await getCustomerSpacePage(pro.id, spaceCustomerId) : null;

  return (
    <PublicShell branding={pro} backHref={`/${slug}`}>
      {identity.kind === "impersonating" ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-zinc-600">{COPY.IMPERSONATING}</p>
          </CardContent>
        </Card>
      ) : identity.kind === "unverified" ? (
        <div className="space-y-6">
          <VerifyEmailBanner email={identity.email} verified={false} />
          <p className="text-sm text-zinc-600">{COPY.CONFIRM_EMAIL_FIRST}</p>
          {space && <CustomerSpaceView businessName={pro.businessName} slug={slug} space={space} />}
        </div>
      ) : space ? (
        <CustomerSpaceView businessName={pro.businessName} slug={slug} space={space} />
      ) : identity.kind === "no_record" ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-8">
            <p className="text-sm wrap-anywhere">{`Aucun ticket chez ${pro.businessName} pour ${identity.email}.`}</p>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${slug}`}>{`Voir la page de ${pro.businessName}`}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {lien === "invalide" && <FormError message="Ce lien n'est plus valide." />}
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-zinc-600">{ANONYMOUS_HINT}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </PublicShell>
  );
}
