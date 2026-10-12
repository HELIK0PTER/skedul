import Link from "next/link";
import { Copy } from "lucide-react";

import { ComingSoon } from "@/components/coming-soon";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";

export default async function DashboardPage() {
  const pro = (await getCurrentProfessional())!;
  const publicUrl = `${env.APP_URL}/${pro.slug}`;

  return (
    <>
      <PageHeader
        title={`Bonjour 👋`}
        description="Voici l'activité de votre page de réservation."
      />

      {/* Public link */}
      <Card className="mb-6 bg-accent">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-accent-foreground">
              Votre page publique
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {publicUrl}
            </p>
          </div>
          <div className="flex gap-2">
            <CopyLinkButton url={publicUrl} />
            <Button asChild size="sm">
              <Link href={`/${pro.slug}`} target="_blank">
                Ouvrir
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <ComingSoon
        title="Bientôt disponible"
        description="Les indicateurs, le planning de la semaine et les prochaines inscriptions reviennent avec les tickets et les événements."
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Copy className="mr-1 inline size-3" />
        Astuce : partagez votre page publique pour recevoir des réservations.
      </p>
    </>
  );
}
