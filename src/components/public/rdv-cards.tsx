import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RDV_CARDS_TITLE, type RdvCardVM } from "@/lib/public/rdv-view";

/**
 * The RDV libre cards of `/[slug]` (P5 § 3.11, O8, P4OUT:94): one card per bookable RDV type, between the planning and
 * the Boutique, each with its name, its duration, « Gratuit » or « À partir de {prix} », a description of at most two
 * lines and the « Réserver un rendez-vous » link to the type's page. No next slot is computed here. Rendered only when
 * there is a card. Every text of the pro can be long and unbroken, hence `wrap-anywhere` and `min-w-0`; below 640 px the
 * cards stack and the link takes the full width.
 */
export function RdvCards({ cards }: { cards: RdvCardVM[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="rdv-cards-title" className="space-y-4">
      <h2 id="rdv-cards-title" className="text-xl font-bold tracking-tight">
        {RDV_CARDS_TITLE}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.ticketTypeId} className="min-w-0">
            <Card className="flex h-full flex-col">
              <CardHeader className="gap-2">
                <CardTitle className="min-w-0 wrap-anywhere">{card.name}</CardTitle>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    {card.durationLabel}
                  </span>
                  {card.priceLabel !== null &&
                    (card.isFree ? (
                      <Badge variant="success">{card.priceLabel}</Badge>
                    ) : (
                      <span className="font-medium text-foreground">{card.priceLabel}</span>
                    ))}
                </p>
              </CardHeader>
              {card.description && (
                <CardContent>
                  <p className="line-clamp-2 text-sm text-zinc-600 wrap-anywhere">{card.description}</p>
                </CardContent>
              )}
              <CardFooter className="mt-auto">
                <Button asChild className="w-full sm:w-auto">
                  <Link href={card.href} aria-label={card.ctaAriaLabel}>
                    {card.ctaLabel}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
