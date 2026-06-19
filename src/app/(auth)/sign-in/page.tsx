import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Bon retour 👋</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour accéder à votre espace.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm mode="sign-in" />
      </CardContent>
    </Card>
  );
}
