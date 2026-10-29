import { ChevronLeft, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { plural } from "@/lib/back-office/format";
import { acceptedByText, emptyOffersText, offerLine, rdvBadgeLabel } from "@/lib/back-office/type-view";
import { formatMoney } from "@/lib/utils";
import { DEMO_EVENTS, DEMO_TICKET_TYPES, ticketType, type DemoOffer, type DemoTicketType } from "../demo-data";
import type { DemoState } from "../demo-script";
import { ProPageHeader, ProShell } from "./pro-shell";

const validityText = (o: DemoOffer) => (o.validityMonths === null ? null : `${o.validityMonths} mois`);
const acceptedBy = (t: DemoTicketType) => DEMO_EVENTS.filter((e) => e.accepts.includes(t.key));
const rdvBadge = (t: DemoTicketType) =>
  rdvBadgeLabel({ rdvEnabled: t.rdv !== null, rdvFree: t.rdv?.free ?? false, rdvDurationMin: t.rdv?.durationMin ?? null });

/** The « En vente » switch of an offer row, on. */
function OnSale() {
  return (
    <span className="flex items-center gap-2 text-sm font-medium">
      <span className="flex h-5 w-9 items-center rounded-full bg-primary p-0.5">
        <span className="size-4 translate-x-4 rounded-full bg-white shadow" />
      </span>
      En vente
    </span>
  );
}

function TypeCard({ type }: { type: DemoTicketType }) {
  const rdv = rdvBadge(type);
  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-2 p-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
          <h2 className="min-w-0 truncate text-base leading-tight font-semibold">{type.name}</h2>
        </div>
        {rdv && (
          <div>
            <Badge>{rdv}</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0">
        {type.offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyOffersText(type.rdv?.free ?? false)}</p>
        ) : (
          <ul className="space-y-1">
            {type.offers.map((o) => (
              <li key={o.id} className="text-sm">
                {offerLine({ label: o.label, priceCents: o.priceCents, validityText: validityText(o) }, "eur")}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-auto line-clamp-2 text-sm text-muted-foreground">{acceptedByText(acceptedBy(type))}</p>
      </CardContent>
      <CardFooter className="justify-between gap-3 border-t border-border p-4 pt-3">
        <span className="text-sm text-muted-foreground">
          {plural(type.inCirculation, "ticket en circulation", "tickets en circulation")}
        </span>
        <Button data-demo={`edit-${type.key}`} variant="secondary" size="sm">
          Modifier
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The page of « Cours collectif »: its offers, then the events that accept it. */
function TypeDetail() {
  const type = ticketType("collectif");
  return (
    <div className="demo-pop space-y-3">
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Tickets
      </p>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="size-3.5 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
        <h1 className="text-xl font-bold tracking-tight">{type.name}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{type.description}</p>
      <Card>
        <CardHeader className="flex-row items-center justify-between p-4 pb-3">
          <CardTitle>Offres</CardTitle>
          <Button variant="secondary" size="sm">
            <Plus aria-hidden /> Nouvelle offre
          </Button>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="space-y-2.5">
            {type.offers.map((o) => (
              <li
                key={o.id}
                data-demo={`pro-offer-${o.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="flex items-baseline gap-3">
                    <span className="font-medium">{o.label}</span>
                    <span className="text-sm font-medium tabular-nums">{formatMoney(o.priceCents)}</span>
                  </p>
                  <p className="flex gap-4 text-sm text-muted-foreground">
                    <span>{plural(o.quantity, "ticket", "tickets")}</span>
                    <span>{validityText(o) === null ? "Sans limite de validité" : `Validité : ${validityText(o)}`}</span>
                    <span>{plural(o.sold, "vendue", "vendues")}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <OnSale />
                  <Button variant="secondary" size="sm">
                    Modifier
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle>Accepté par</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-1.5 p-4 pt-0">
          {acceptedBy(type).map((e) => (
            <span key={e.key} className="inline-flex items-center gap-1.5 text-sm">
              <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: e.color }} />
              <span className="font-medium">{e.title}</span>
              {e.isPrivate && <Badge variant="neutral">Privé</Badge>}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** The ticket types of the pro and their offers; the cursor opens « Cours collectif ». */
export function ProTickets({ state }: { state: DemoState }) {
  return (
    <ProShell active="tickets">
      {state.ticketTypeOpen ? (
        <TypeDetail />
      ) : (
        <div className="space-y-4">
          <ProPageHeader
            title="Tickets"
            description="Vos types de ticket et les offres qui les vendent."
            action={
              <Button size="sm">
                <Plus aria-hidden /> Nouveau type de ticket
              </Button>
            }
          />
          <div className="grid grid-cols-2 gap-3">
            {DEMO_TICKET_TYPES.map((t) => (
              <TypeCard key={t.key} type={t} />
            ))}
          </div>
        </div>
      )}
    </ProShell>
  );
}
