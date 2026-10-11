import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  if (await getCurrentUser()) redirect(next ?? "/dashboard");
  // Google found an existing email/password account: offer to link it.
  if (error === "account_not_linked") redirect("/link-google");

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
