import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (await getCurrentProfessional()) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-aurora">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-12">
        <Logo className="mx-auto mb-8" />
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Bienvenue {user.name?.split(" ")[0]} 🎉
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Configurons votre page de réservation. Vous pourrez tout modifier
              ensuite.
            </p>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
        {user.role === "admin" && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/admin" className="font-medium text-primary hover:underline">
              Aller au Dashboard Admin
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
