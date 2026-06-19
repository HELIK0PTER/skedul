import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const pro = (await getCurrentProfessional())!;

  return (
    <>
      <PageHeader
        title="Réglages"
        description="Votre profil public et vos préférences."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profil public</CardTitle>
          <p className="text-sm text-muted-foreground">
            Adresse :{" "}
            <span className="font-mono text-foreground">
              {env.APP_URL}/{pro.slug}
            </span>
          </p>
        </CardHeader>
        <CardContent>
          <ProfileForm
            values={{
              businessName: pro.businessName,
              headline: pro.headline,
              bio: pro.bio,
              brandColor: pro.brandColor,
              timezone: pro.timezone,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <SignOutButton variant="outline" size="md" />
        </CardContent>
      </Card>
    </>
  );
}
