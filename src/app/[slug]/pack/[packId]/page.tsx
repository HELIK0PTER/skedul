import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ticket } from "lucide-react";

import { PublicShell } from "@/components/public/public-shell";
import { BuyPackForm } from "@/components/public/buy-pack-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { getPublicPack } from "@/server/queries";

type Params = { params: Promise<{ slug: string; packId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, packId } = await params;
  const data = await getPublicPack(slug, packId);
  if (!data) return { title: "Pack" };
  return { title: `Acheter — ${data.pack.name}` };
}

export default async function BuyPackPage({ params }: Params) {
  const { slug, packId } = await params;
  const data = await getPublicPack(slug, packId);
  if (!data) notFound();

  const { pack, professional, eventTitle } = data;
  const perCredit = Math.round(pack.priceCents / pack.credits);

  return (
    <PublicShell branding={professional} backHref={`/${slug}`}>
      <Card className="mb-6">
        <CardContent className="p-6">
          <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Ticket className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {pack.name}
          </h1>
          {pack.description && (
            <p className="mt-1 text-muted-foreground">{pack.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge>{pack.credits} crédits</Badge>
            <Badge variant="neutral">{eventTitle ?? "Toutes prestations"}</Badge>
            <Badge variant="success">
              {formatMoney(perCredit)} / séance
            </Badge>
          </div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {formatMoney(pack.priceCents)}
            </span>
            <span className="text-sm text-muted-foreground">
              payé une seule fois
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 font-semibold">Finaliser l&apos;achat</h2>
          <BuyPackForm packId={pack.id} priceCents={pack.priceCents} />
        </CardContent>
      </Card>
    </PublicShell>
  );
}
