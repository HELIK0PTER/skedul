import Link from "next/link";
import { MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomerSpace } from "@/lib/back-office/customer-space";
import { boutiqueHref } from "@/lib/public-anchors";

/**
 * Read-only espace of one customer (P3: nothing to click; P4 adds cancel and
 * spend). Every text of the client or of the pro (name, e-mail, titles,
 * places) can be long and unbroken, hence `wrap-anywhere` and `min-w-0`.
 */
export function CustomerSpaceView({
  businessName,
  slug,
  space,
}: {
  businessName: string;
  slug: string;
  space: CustomerSpace;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight wrap-anywhere">{`Bonjour ${space.customer.name}`}</h2>
        <p className="mt-1 text-sm text-zinc-600 wrap-anywhere">{space.customer.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vos prochaines inscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {space.upcoming.length === 0 ? (
            <p className="text-sm text-zinc-600">Aucune inscription à venir.</p>
          ) : (
            <ul className="divide-y divide-border">
              {space.upcoming.map((b) => (
                <li key={b.bookingId} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 font-medium wrap-anywhere">{b.title}</p>
                    <Badge variant="neutral">{b.coverageLabel}</Badge>
                  </div>
                  <p className="text-sm text-zinc-600">{b.whenLabel}</p>
                  {b.location && (
                    <p className="flex items-start gap-1.5 text-sm text-zinc-600">
                      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 wrap-anywhere">{b.location}</span>
                    </p>
                  )}
                  <p className="text-xs text-zinc-600">{b.cancelText}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vos tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {space.wallet.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">Aucun ticket</p>
              <Button asChild variant="secondary" size="sm">
                <Link href={boutiqueHref(slug)}>Voir la boutique</Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {space.wallet.map((w) => (
                <li key={w.ticketTypeId} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <p className="flex items-start gap-2 font-medium">
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: w.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 wrap-anywhere">{`${w.usable} × ${w.name}`}</span>
                  </p>
                  {w.expiries.map((text) => (
                    <p key={text} className="text-sm text-zinc-600">
                      {text}
                    </p>
                  ))}
                  {w.archived && (
                    <p className="text-xs text-zinc-600 wrap-anywhere">{`Ce type n'est plus proposé par ${businessName}.`}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
