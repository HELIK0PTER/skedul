import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Créez votre compte</CardTitle>
        <p className="text-sm text-muted-foreground">
          Lancez votre page de réservation en quelques minutes.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm mode="sign-up" />
      </CardContent>
    </Card>
  );
}
