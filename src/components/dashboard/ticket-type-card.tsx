import Link from "next/link";

import { StatusMark } from "@/components/dashboard/status-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import type { TicketTypeSummary } from "@/lib/back-office/catalog-reads";
import { plural } from "@/lib/back-office/format";
import {
  RDV_NOT_BOOKABLE,
  acceptedByText,
  emptyOffersText,
  offerLine,
  rdvBadgeLabel,
  showOrphanMark,
} from "@/lib/back-office/type-view";

/** One ticket type: colour, badges, offers, who accepts it, tickets in circulation. */
export function TicketTypeCard({ type, currency }: { type: TicketTypeSummary; currency: string }) {
  const href = `/dashboard/tickets/${type.id}`;
  const rdv = rdvBadgeLabel(type);

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3 pb-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
          <h2 className="min-w-0 truncate text-base font-semibold leading-tight">
            <Link
              href={href}
              className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {type.name}
            </Link>
          </h2>
        </div>
        {(rdv !== null || type.archived) && (
          <div className="flex flex-wrap gap-2">
            {rdv !== null && <Badge>{rdv}</Badge>}
            {type.archived && <Badge variant="neutral">Archivé</Badge>}
          </div>
        )}
        {showOrphanMark(type) && (
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            <StatusMark tone="orange" />
            Lié à aucun événement à venir
          </p>
        )}
        {/* O14: a type its RDV page would show closed (no hours, a notice above its horizon); the reasons are on its page. */}
        {type.rdvIssues.some((issue) => issue !== "no_offer") && (
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            <StatusMark tone="orange" />
            {RDV_NOT_BOOKABLE}
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {type.offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyOffersText(type.rdvFree)}</p>
        ) : (
          <ul className="space-y-2">
            {type.offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span>{offerLine(offer, currency)}</span>
                {!offer.isActive && <Badge variant="neutral">Pas en vente</Badge>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-auto line-clamp-2 text-sm text-muted-foreground">{acceptedByText(type.acceptedBy)}</p>
      </CardContent>

      <CardFooter className="justify-between gap-3 border-t border-border pt-4">
        <span className="text-sm text-muted-foreground">
          {plural(type.usableTickets, "ticket en circulation", "tickets en circulation")}
        </span>
        <Button asChild variant="secondary" size="sm">
          <Link href={href}>Modifier</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
