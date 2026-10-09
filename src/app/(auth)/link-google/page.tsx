import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LinkGoogleForm } from "@/components/auth/link-google-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Relier Google" };

/** Reached when "Continuer avec Google" finds an existing email/password account. */
export default async function LinkGooglePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  // Read the request first: redirecting before any dynamic API would let Next
  // prerender this page as a static redirect when the build has no Google env.
  const [user, { error }] = await Promise.all([getCurrentUser(), searchParams]);
  if (!env.GOOGLE_CALENDAR_ENABLED) redirect("/sign-in");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reliez votre compte Google</CardTitle>
        {!user && (
          <p className="text-sm text-muted-foreground">
            Un compte Skedul utilise déjà cette adresse email. Entrez son mot de passe une seule fois pour y relier Google. Ensuite, « Continuer avec Google » vous connectera directement.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <LinkGoogleForm
          signedInEmail={user?.email ?? null}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
      </CardContent>
    </Card>
  );
}
