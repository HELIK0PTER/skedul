import { CalendarDays, CheckCircle2, Loader2, Lock, MapPin, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayLongLabel } from "@/lib/back-office/planning-view";
import { BUY_TITLE, OFFERS_LEGEND, offerOptionLabel, payLabel } from "@/lib/public/buy-and-book-form";
import { COPY, dataUseLine, heldTicketButtonLabel, seatsLeftLabel } from "@/lib/public/messages";
import { BOOKED_CONFIRMED, SEE_MY_SPACE, TICKETS_BOOKING_TITLE, ticketUsedLine } from "@/lib/public/seance-copy";
import { cn } from "@/lib/utils";
import {
  DEMO_BRAND,
  LEA_SEANCE_IDS,
  demoEvent,
  demoWeek,
  holdUntilLabel,
  offerChoice,
  rangeLabel,
  seanceById,
  ticketType,
  type TypeKey,
} from "../demo-data";
import { leaTicketsLeft, seatsLeft } from "../demo-script";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

/** The offers of the ticket types a séance accepts, in the order of the Boutique. */
function seanceOffers(accepts: readonly TypeKey[]) {
  return accepts.flatMap((key) => ticketType(key).offers);
}

/** Monday: Léa has no ticket yet, she buys a carnet and books in one payment, her seat held meanwhile. */
function BuyAndBook({ state, accepts }: ScreenProps & { accepts: readonly TypeKey[] }) {
  const offers = seanceOffers(accepts);
  const picked = offers.find((o) => o.id === state.offerPicked) ?? offers[0];
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2.5">
        <p className="text-sm text-zinc-600">Vous avez déjà des tickets ?</p>
        <span className="shrink-0 text-sm font-medium text-primary underline underline-offset-4">{COPY.HAVE_TICKETS}</span>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">{BUY_TITLE}</h3>
        <p className="text-sm text-zinc-600">{OFFERS_LEGEND}</p>
        <div className="space-y-1.5">
          {offers.map((o) => {
            const on = o.id === picked.id;
            return (
              <span
                key={o.id}
                data-demo={`offer-${o.id}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                  on ? "border-primary bg-primary-muted" : "border-border",
                )}
              >
                <span
                  aria-hidden
                  className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-primary" : "border-input")}
                >
                  {on && <span className="size-2 rounded-full bg-primary" />}
                </span>
                {offerOptionLabel(offerChoice(o), "eur")}
              </span>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Prénom et nom</Label>
          <Input data-demo="field-name" readOnly value={state.formName} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input data-demo="field-email" readOnly value={state.formEmail} />
        </div>
      </div>
      <p className="text-xs text-zinc-600">{dataUseLine(DEMO_BRAND.businessName)}</p>
      <Button data-demo="pay-button" className="w-full">
        {state.paying && <Loader2 className="animate-spin" aria-hidden />}
        {state.paying ? COPY.PENDING_PAY : payLabel(offerChoice(picked), "eur")}
      </Button>
      {state.held && (
        <p className="demo-pop flex items-center gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-green-700">
          <Lock className="size-4 shrink-0" aria-hidden />
          {`Place gardée jusqu'à ${holdUntilLabel()}.`}
        </p>
      )}
    </>
  );
}

/** Wednesday: signed in with her code, Léa books with one ticket of her carnet. */
function SpendTicket({ state }: ScreenProps) {
  const collectif = ticketType("collectif");
  const left = leaTicketsLeft(state);
  if (state.wednesdayBooked) {
    return (
      <div className="demo-pop space-y-3">
        <p className="flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2.5 text-sm text-green-700">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {COPY.BOOKED_WITH_TICKET}
        </p>
        <p className="text-sm font-medium">{BOOKED_CONFIRMED}</p>
        <Button variant="secondary">{SEE_MY_SPACE}</Button>
      </div>
    );
  }
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        <p>{`Vos tickets : ${left} × ${collectif.name}`}</p>
        <span className="shrink-0 font-medium text-primary underline underline-offset-4">{COPY.MY_SPACE}</span>
      </div>
      <p className="text-sm text-zinc-600">{ticketUsedLine(collectif.name)}</p>
      <Button data-demo="spend-button" className="w-full">
        {state.paying ? <Loader2 className="animate-spin" aria-hidden /> : <Ticket aria-hidden />}
        {heldTicketButtonLabel(left - 1)}
      </Button>
    </>
  );
}

/** The page of one séance (/altinha-paris/seance/...): what it is on the left, how to book it on the right. */
export function ClientSeance({ state }: ScreenProps) {
  const week = demoWeek();
  const seance = seanceById(state.seance === "monday" ? LEA_SEANCE_IDS.monday : LEA_SEANCE_IDS.wednesday, week);
  const event = demoEvent(seance.event);
  const day = week[seance.dayIndex];
  return (
    <ClientShell>
      <div className="grid grid-cols-[1fr_1.15fr] items-start gap-5">
        <Card>
          <CardHeader className="gap-2 p-5">
            <h1 className="text-xl font-bold tracking-tight">{seance.title}</h1>
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="first-letter:uppercase">{`${dayLongLabel(day)} · ${rangeLabel(seance.startMinute, seance.durationMin)}`}</span>
            </p>
            <p className="flex items-center gap-2 text-sm text-zinc-600">
              <MapPin className="size-4 shrink-0" aria-hidden /> {seance.location}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-0">
            <Badge variant="neutral">{seatsLeftLabel(seatsLeft(seance, state))}</Badge>
            <p className="text-sm text-zinc-600">{event.description}</p>
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="text-xs font-medium text-zinc-600">Tickets acceptés</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {seance.accepts.map((key) => {
                  const t = ticketType(key);
                  return (
                    <span key={key} className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
                      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </span>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-5 pb-3">
            <CardTitle>{TICKETS_BOOKING_TITLE}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-0">
            {state.seance === "monday" ? (
              <BuyAndBook state={state} accepts={seance.accepts} />
            ) : (
              <SpendTicket state={state} />
            )}
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
