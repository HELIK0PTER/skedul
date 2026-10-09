import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { error } = await searchParams;

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
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
      </CardContent>
    </Card>
  );
}
