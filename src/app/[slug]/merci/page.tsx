import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicProfile } from "@/server/queries";

export const metadata: Metadata = { title: "Merci !" };

type Props = { params: Promise<{ slug: string }> };

/** Generic thanks; P4 rebuilds the detailed confirmation on bookings and purchases. */
export default async function MerciPage({ params }: Props) {
  const { slug } = await params;

  // A customer who paid just before the pro was suspended still sees this page.
  const profile = await getPublicProfile(slug, { includeSuspended: true });
  if (!profile) notFound();
  const { pro } = profile;

  return (
    <PublicShell branding={pro} backHref={`/${slug}`}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="size-14 text-success" />
          <h1 className="text-2xl font-bold tracking-tight">Merci !</h1>
          <p className="max-w-sm text-muted-foreground">
            Votre demande a bien été enregistrée.
          </p>
          <div className="mt-4 flex gap-2">
            <Button asChild variant="secondary">
              <Link href={`/${slug}`}>Retour à la page</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
