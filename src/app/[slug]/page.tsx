import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComingSoon } from "@/components/coming-soon";
import { PublicShell } from "@/components/public/public-shell";
import { getPublicProfile } from "@/server/queries";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicProfile(slug);
  if (!data) return { title: "Page introuvable" };
  return {
    title: data.pro.businessName,
    description: data.pro.headline ?? undefined,
  };
}

export default async function PublicProfilePage({ params }: Params) {
  const { slug } = await params;
  const data = await getPublicProfile(slug);
  if (!data) notFound();

  const { pro } = data;

  return (
    <PublicShell branding={pro}>
      {pro.bio && (
        <p className="mb-8 text-muted-foreground">{pro.bio}</p>
      )}
      <ComingSoon
        title="Réservations"
        description="Les réservations en ligne reviennent très bientôt."
      />
    </PublicShell>
  );
}
