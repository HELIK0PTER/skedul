import Link from "next/link";
import { MapPin } from "lucide-react";

import { CancelBookingButton } from "@/components/public/cancel-booking-button";
import { SpaceStatusLine, SpaceStatusProvider } from "@/components/public/space-status";
import { SpendSeanceButton } from "@/components/public/spend-seance-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomerSpace } from "@/lib/back-office/customer-space";
import type { VisitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { SPEND_TITLE, UPCOMING_HEADING_ID, UPCOMING_TITLE } from "@/lib/public/space-view";
import type { SpendableSeance } from "@/lib/public/spendable";
import { boutiqueHref } from "@/lib/public-anchors";

/** What the « Utiliser vos tickets » section needs besides the space itself. Strings and booleans only. `canSpend` is canSpendIn(identity): the Owner only. */
export type SpaceSpend = {
  seances: SpendableSeance[];
  canSpend: boolean;
  visitorState: VisitorState;
  googleEnabled: boolean;
  returnTo: string;
};

/**
 * The espace of one customer (spec § 12): upcoming inscriptions with « Annuler » while the deadline allows, the wallet
 * with the notes on archived and orphan types, and « Utiliser vos tickets ». Every text of the client or of the pro
 * (name, e-mail, titles, places) can be long and unbroken, hence `wrap-anywhere` and `min-w-0`. The success line of
 * the actions lives in one shared region above the cards (SpaceStatusProvider): a booking or a séance leaves its list
 * when an action revalidates the page, so a line written in its row would vanish with it.
 */
export function CustomerSpaceView({
  businessName,
  slug,
  space,
  spend,
}: {
  businessName: string;
  slug: string;
  space: CustomerSpace;
  spend?: SpaceSpend;
}) {
  return (
    <SpaceStatusProvider>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight wrap-anywhere">{`Bonjour ${space.customer.name}`}</h2>
          <p className="mt-1 text-sm text-zinc-600 wrap-anywhere">{space.customer.email}</p>
        </div>

        <SpaceStatusLine />

        <Card>
          <CardHeader>
            <CardTitle
              id={UPCOMING_HEADING_ID}
              tabIndex={-1}
              className="w-fit rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {UPCOMING_TITLE}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {space.upcoming.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600">{COPY.NO_UPCOMING}</p>
                <Button asChild variant="secondary" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 wrap-anywhere">
                  <Link href={`/${slug}`}>{`Voir la page de ${businessName}`}</Link>
                </Button>
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
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <p className="min-w-0 text-xs text-zinc-600 wrap-anywhere">{b.cancelText}</p>
                      {b.cancellable && (
                        <CancelBookingButton
                          slug={slug}
                          bookingId={b.bookingId}
                          title={b.title}
                          whenLabel={b.whenLabel}
                          coverage={b.coverage}
                          businessName={businessName}
                        />
                      )}
                    </div>
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
          </CardContent>
        </Card>

        {spend && spend.seances.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{SPEND_TITLE}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {spend.seances.map((s) => (
                  <li
                    key={s.occurrenceId}
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium wrap-anywhere">{s.title}</p>
                      <p className="text-sm text-zinc-600">{s.whenLabel}</p>
                      <p className="text-xs text-zinc-600 wrap-anywhere">{`1 ticket « ${s.ticketTypeName} »`}</p>
                    </div>
                    <SpendSeanceButton
                      slug={slug}
                      seance={s}
                      canSpend={spend.canSpend}
                      visitorState={spend.visitorState}
                      googleEnabled={spend.googleEnabled}
                      returnTo={spend.returnTo}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </SpaceStatusProvider>
  );
}
