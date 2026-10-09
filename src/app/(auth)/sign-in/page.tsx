import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { DemoQuickLogin } from "@/components/auth/demo-quick-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { getCurrentUser } from "@/lib/session";
import { resolvePostSignIn } from "@/server/entry";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  // Google found an existing email/password account: offer to link it.
  if (error === "account_not_linked") redirect("/link-google");

  // Already signed in: same routing as right after sign-in (admins may choose).
  let showChooser = false;
  if (await getCurrentUser()) {
    const next = await resolvePostSignIn();
    if (next.kind === "redirect") redirect(next.to);
    showChooser = true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Bon retour 👋</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour accéder à votre espace.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="sign-in"
          initialChooser={showChooser}
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
        {env.APP_ENV !== "production" && <DemoQuickLogin />}
      </CardContent>
    </Card>
  );
}
