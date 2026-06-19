import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock, Ticket } from "lucide-react";

import { PublicShell } from "@/components/public/public-shell";
import { CreditLookup } from "@/components/public/credit-lookup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
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

  const { pro, eventTypes, packs } = data;

  return (
    <PublicShell
      businessName={pro.businessName}
      headline={pro.headline}
      avatarUrl={pro.avatarUrl}
      brandColor={pro.brandColor}
    >
      {pro.bio && (
        <p className="mb-8 text-muted-foreground">{pro.bio}</p>
      )}

      {/* Prestations */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">Réserver une prestation</h2>
        <div className="space-y-3">
          {eventTypes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune prestation disponible pour le moment.
            </p>
          )}
          {eventTypes.map((e) => (
            <Card key={e.id} className="transition-shadow hover:shadow-(--shadow-pop)">
              <CardContent className="flex flex-wrap items-center gap-4 p-5">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: e.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{e.title}</p>
                  {e.description && (
                    <p className="text-sm text-muted-foreground">
                      {e.description}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {e.durationMinutes} min
                    </span>
                    <span className="font-medium text-foreground">
                      {e.priceCents > 0 ? formatMoney(e.priceCents) : "Gratuit"}
                    </span>
                  </p>
                </div>
                <Button asChild>
                  <Link href={`/${slug}/book/${e.id}`}>
                    Réserver
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Packs */}
      {packs.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold">Packs prépayés</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Payez une fois, réservez plusieurs créneaux quand vous voulez.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((p) => (
              <Card
                key={p.id}
                className="flex flex-col transition-shadow hover:shadow-(--shadow-pop)"
              >
                <CardContent className="flex flex-1 flex-col p-5">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <Ticket className="size-5" />
                  </span>
                  <p className="mt-3 font-semibold">{p.name}</p>
                  {p.description && (
                    <p className="mt-1 flex-1 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Badge>{p.credits} crédits</Badge>
                    <Badge variant="neutral">
                      {p.eventTitle ?? "Toutes prestations"}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xl font-bold">
                      {formatMoney(p.priceCents)}
                    </span>
                    <Button asChild size="sm">
                      <Link href={`/${slug}/pack/${p.id}`}>Acheter</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <CreditLookup professionalId={pro.id} />
    </PublicShell>
  );
}
