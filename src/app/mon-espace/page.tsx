import type { Metadata } from "next";
import Link from "next/link";

import { ClientSignInChoices } from "@/components/auth/client-sign-in-choices";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { ClientSignOutButton } from "@/components/public/client-sign-out-button";
import { MySpaceView } from "@/components/public/my-space";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { visitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import { getMySpacePage } from "@/server/client-queries";
import { currentSessionFacts } from "@/server/visitor";

export const metadata: Metadata = { title: "Mon espace", robots: { index: false } };

/**
 * « Mon espace » (spec L1376-1391): the client's own space across every pro. The visitor comes from the FRESH session
 * (never the 5-minute cookie cache). Signed out: the code form, never a redirect. Signed in but unverified: the
 * confirmation banner, never the code form (a code sign-in would purge the password, risk 7). Impersonating: a
 * sentence (an admin never reads a client's data through a pro's session). Verified: one card per pro. Rendered per
 * request (it reads the session), never indexed, never counted in the page-view stats.
 *
 * The confirmation banner sits in ONE place of the tree, above every state branch, for every signed-in visitor that
 * is not impersonated, with `verified` from the visitor state (the dashboard layout pattern). That keeps it mounted
 * when a code is accepted and the page re-renders verified, so « Adresse confirmée. » is announced and takes the
 * focus (WCAG 2.4.3); a banner inside the unverified branch would be unmounted by that flip.
 */
export default async function MySpacePage() {
  const session = await currentSessionFacts();
  const state = visitorState(session);
  // The page keeps its own gate; the read refuses a session that is not verified or is impersonated by itself as well.
  const cards = state === "verified" && session ? await getMySpacePage(session, new Date()) : [];
  const banner = session && state !== "impersonating" ? { email: session.email, verified: state === "verified" } : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Mon espace client</h1>

      {banner && <VerifyEmailBanner email={banner.email} verified={banner.verified} />}

      <div className="space-y-6">
        {canOfferCodeSignIn(state) && (
          <Card className="space-y-5 p-6">
            <p className="text-sm text-zinc-600">Accédez à vos réservations et à vos tickets chez tous vos professionnels.</p>
            <EmailCodeForm idPrefix="my-space" askName />
            <ClientSignInChoices returnTo="/mon-espace" googleEnabled={env.GOOGLE_CALENDAR_ENABLED} />
          </Card>
        )}

        {state === "unverified" && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">{COPY.CONFIRM_EMAIL_FIRST}</p>
            <ClientSignOutButton />
          </div>
        )}

        {state === "impersonating" && (
          <Card className="p-6">
            <p className="text-sm text-zinc-600">{COPY.IMPERSONATING}</p>
          </Card>
        )}

        {state === "verified" && session && <MySpaceView name={session.name} email={session.email} cards={cards} />}

        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">{"Retour à l'accueil"}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
