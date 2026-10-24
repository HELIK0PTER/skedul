import Link from "next/link";

import { ScrollToAnchor } from "@/components/public/scroll-to-anchor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptedByLine } from "@/lib/public/messages";
import type { BoutiqueType } from "@/lib/public/boutique-reads";
import { BOUTIQUE_ANCHOR } from "@/lib/public-anchors";
import { formatMoney } from "@/lib/utils";

/**
 * The Boutique of `/[slug]` (spec L1443, E9): the offers on sale, by ticket type, each with its « Acheter » link to the
 * offer page. It carries the anchor every « Voir la boutique » link points to (BOUTIQUE_ANCHOR, FR:UI-14) and is not
 * rendered at all when nothing is on sale. Every text of the pro (type, description, labels) can be long and unbroken,
 * hence `wrap-anywhere` and `min-w-0`; below 640 px each offer takes a row and its button the full width. The page streams
 * behind loading.tsx, so a link to `/{slug}#boutique` (a client navigation) or a fresh load with the hash would not
 * reach the block by itself: the leaf `ScrollToAnchor` scrolls to it once the block has mounted.
 */
export function Boutique({ slug, currency, types }: { slug: string; currency: string; types: BoutiqueType[] }) {
  if (types.length === 0) return null;
  return (
    <section id={BOUTIQUE_ANCHOR} aria-labelledby="boutique-title" className="scroll-mt-6 space-y-4">
      <ScrollToAnchor anchor={BOUTIQUE_ANCHOR} />
      <h2 id="boutique-title" className="text-xl font-bold tracking-tight">
        Boutique
      </h2>
      <div className="space-y-4">
        {types.map((type) => (
          <Card key={type.ticketTypeId}>
            <CardHeader>
              <CardTitle className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
                <span className="min-w-0 wrap-anywhere">{type.name}</span>
              </CardTitle>
              {type.description && <p className="text-sm text-zinc-600 wrap-anywhere">{type.description}</p>}
              {type.acceptedBy.length > 0 && <p className="text-sm text-zinc-600 wrap-anywhere">{acceptedByLine(type.acceptedBy)}</p>}
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {type.offers.map((offer) => (
                  <li
                    key={offer.offerId}
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="min-w-0 text-sm wrap-anywhere">
                      <span className="font-medium">{offer.label}</span>
                      {` · ${formatMoney(offer.priceCents, currency)}`}
                      {offer.validityText !== null && ` · valable ${offer.validityText}`}
                    </p>
                    <Button asChild className="w-full shrink-0 sm:w-auto">
                      <Link href={`/${slug}/offre/${offer.offerId}`} aria-label={`Acheter : ${offer.label}, ${type.name}`}>
                        Acheter
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
