import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signedInSignUpTarget } from "@/lib/entry";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { linkGoogleHref } from "@/lib/public/sign-in-flow";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  // A signed-in visitor of the pro funnel: their pro page, else the onboarding (a client has no page yet).
  if (await getCurrentUser()) {
    redirect(signedInSignUpTarget({ next, hasProfessional: (await getCurrentProfessional()) !== null }));
  }
  // Google found an existing email/password account: offer to link it, keeping the page to come back to (AUTH-2).
  if (error === "account_not_linked") redirect(linkGoogleHref(rawNext));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Créez votre compte</CardTitle>
        <p className="text-sm text-muted-foreground">
          Lancez votre page de réservation en quelques minutes.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="sign-up"
          next={next}
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
      </CardContent>
    </Card>
  );
}
