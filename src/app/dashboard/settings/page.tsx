import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { BrandingForm } from "@/components/dashboard/branding-form";
import { GoogleCalendarCard } from "@/components/dashboard/google-calendar-card";
import { SlugEditor } from "@/components/dashboard/slug-editor";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";
import { getGoogleConnection } from "@/server/queries";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const pro = (await getCurrentProfessional())!;
  const google = await getGoogleConnection({ id: pro.id, userId: pro.userId });

  return (
    <>
      <PageHeader
        title="Réglages"
        description="Votre profil public et vos préférences."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profil public</CardTitle>
          <SlugEditor appUrl={env.APP_URL} slug={pro.slug} />
        </CardHeader>
        <CardContent>
          <ProfileForm
            values={{
              businessName: pro.businessName,
              headline: pro.headline,
              bio: pro.bio,
              timezone: pro.timezone,
            }}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Identité visuelle</CardTitle>
          <p className="text-sm text-muted-foreground">
            Bannière, avatar, couleur et mise en page de votre page publique.
          </p>
        </CardHeader>
        <CardContent>
          <BrandingForm
            businessName={pro.businessName}
            headline={pro.headline}
            blobEnabled={env.BLOB_ENABLED}
            values={{
              themePreset: pro.themePreset,
              customColor: pro.customColor,
              bannerUrl: pro.bannerUrl,
              headerLayout: pro.headerLayout,
              avatarKind: pro.avatarKind,
              avatarStyle: pro.avatarStyle,
              avatarSeed: pro.avatarSeed,
              avatarUrl: pro.avatarUrl,
            }}
          />
        </CardContent>
      </Card>

      <GoogleCalendarCard
        configured={google.configured}
        connected={google.connected}
        accountEmail={google.accountEmail}
      />

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
