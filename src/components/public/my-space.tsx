import Link from "next/link";
import { CalendarCheck, MapPin } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { ClientSignOutButton } from "@/components/public/client-sign-out-button";
import { MyNameForm } from "@/components/public/my-name-form";
import { RevokeMyLinksButton } from "@/components/public/revoke-my-links-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import { COPY } from "@/lib/public/messages";
import type { MySpaceCard } from "@/lib/public/my-space";
import { boutiqueHref } from "@/lib/public-anchors";
import { cn } from "@/lib/utils";

/**
 * « Mon espace »: one card per pro (its next inscriptions, its tickets, a link to the pro's own space), then the
 * account section. A server component: the leaves below are the only client code, and only the name crosses to them.
 * Every text of a pro or of the client (business name, titles, places, names) can be long and unbroken, hence
 * `wrap-anywhere` and `min-w-0`. Cards stack.
 */
export function MySpaceView({ name, email, cards }: { name: string; email: string; cards: MySpaceCard[] }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xl font-bold tracking-tight wrap-anywhere">{name.trim() === "" ? "Bonjour" : `Bonjour ${name}`}</p>
        <p className="mt-1 text-sm text-zinc-600 wrap-anywhere">{email}</p>
      </div>

      {cards.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={COPY.NO_RESERVATION} />
      ) : (
        cards.map((card) => <ProCard key={card.slug} card={card} />)
      )}

      <section aria-labelledby="my-account">
        <Card>
          <CardHeader>
            <h2 id="my-account" className="text-base font-semibold leading-tight">
              Mon compte
            </h2>
          </CardHeader>
          <CardContent className="space-y-5">
            <MyNameForm initialName={name} />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
              <RevokeMyLinksButton />
              <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
                <Link href="/onboarding">{COPY.CREATE_PAGE}</Link>
              </Button>
              <ClientSignOutButton />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/** The card of one pro: next inscriptions, tickets, and the way into the pro's own space. */
function ProCard({ card }: { card: MySpaceCard }) {
  const { slug, businessName, space } = card;
  const headingId = `my-space-${slug}`;
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold leading-tight wrap-anywhere">
            {businessName}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Vos prochaines inscriptions</h3>
            {space.upcoming.length === 0 ? (
              <div className="space-y-1">
                <p className="text-sm text-zinc-600">{COPY.NO_UPCOMING}</p>
                <Link href={`/${slug}`} className={cn(INLINE_LINK_CLASS, "text-sm wrap-anywhere")}>
                  {`Voir la page de ${businessName}`}
                </Link>
              </div>
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
                    {b.cancelText && <p className="text-xs text-zinc-600">{b.cancelText}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Vos tickets</h3>
            {space.wallet.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600">{COPY.NO_TICKET}</p>
                <Button asChild variant="secondary" size="sm">
                  <Link href={boutiqueHref(slug)}>{COPY.SEE_SHOP}</Link>
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
                    {w.typeClass === "orphan" && <p className="text-xs text-zinc-600 wrap-anywhere">{COPY.ORPHAN_TYPE}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link href={`/${slug}/espace`} className={cn(INLINE_LINK_CLASS, "inline-block text-sm wrap-anywhere")}>
            {`Ouvrir l'espace chez ${businessName}`}
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
