"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { weekTitle } from "@/lib/back-office/planning-view";
import { offerOptionLabel } from "@/lib/public/buy-and-book-form";
import { COPY, PUBLIC_STATE_LABELS, acceptedByLine, seatsLeftLabel } from "@/lib/public/messages";
import { RDV_CARDS_TITLE, rdvDurationLabel, rdvPriceLabel } from "@/lib/public/rdv-view";
import {
  DEMO_EVENTS,
  DEMO_TICKET_TYPES,
  carnetExpiryLine,
  demoWeek,
  offerChoice,
  rangeLabel,
  ticketType,
  weekDayLabel,
  weekSeances,
  type DemoSeance,
} from "../demo-data";
import { INITIAL_STATE, leaTicketsLeft, seatsLeft, type DemoState } from "../demo-script";
import { ClientShell } from "./client-shell";

/** The titles of the public events that accept a ticket type (a private event is never named on the public page). */
function acceptedBy(typeKey: string): string[] {
  return DEMO_EVENTS.filter((e) => !e.isPrivate && e.accepts.some((k) => k === typeKey)).map((e) => e.title);
}

function VisitorBar() {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <p className="min-w-0 text-sm text-zinc-600">{COPY.HAVE_TICKETS_HINT}</p>
      <Button data-demo="have-tickets" variant="secondary" className="shrink-0">
        {COPY.HAVE_TICKETS}
      </Button>
    </div>
  );
}

function WalletPanel({ state }: { state: DemoState }) {
  const n = leaTicketsLeft(state);
  const collectif = ticketType("collectif");
  return (
    <Card data-demo="wallet-panel" className="demo-pop mb-5">
      <CardHeader className="flex-row items-start justify-between p-4">
        <h2 className="text-base leading-tight font-semibold">Vos tickets</h2>
        <Button variant="secondary" size="sm">
          {COPY.MY_SPACE}
        </Button>
      </CardHeader>
      <CardContent className="space-y-1 p-4 pt-0">
        <p className="flex items-start gap-2 font-medium">
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: collectif.color }} aria-hidden />
          {`${n} × ${collectif.name}`}
        </p>
        <p className="text-sm text-zinc-600">{carnetExpiryLine(n)}</p>
      </CardContent>
    </Card>
  );
}

function SeanceChip({ seance, state }: { seance: DemoSeance; state: DemoState }) {
  const free = seance.mode === "free";
  return (
    <span
      data-demo={`seance-${seance.id}`}
      className="block rounded-xl border border-border bg-card p-2 text-xs"
      style={{ borderLeft: `4px solid ${seance.color}` }}
    >
      <span className="block tabular-nums text-zinc-600">{rangeLabel(seance.startMinute, seance.durationMin)}</span>
      <span className="mt-0.5 block text-sm leading-snug font-medium">{seance.title}</span>
      <span className="mt-1 block text-zinc-600">{free ? PUBLIC_STATE_LABELS.free : seatsLeftLabel(seatsLeft(seance, state))}</span>
    </span>
  );
}

function Planning({ state }: { state: DemoState }) {
  const week = demoWeek();
  const seances = weekSeances(week).filter((s) => !s.isPrivate);
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Planning</h2>
        <span className="inline-flex rounded-xl border border-border bg-card p-0.5 text-sm">
          <span className="rounded-lg px-3 py-1.5 font-medium text-zinc-600">Liste</span>
          <span className="rounded-lg bg-primary-muted px-3 py-1.5 font-medium text-accent-foreground">Semaine</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-sm text-zinc-600">
          <ChevronLeft className="size-4" aria-hidden /> Semaine précédente
        </span>
        <p className="flex-1 text-center text-sm font-semibold">{weekTitle(week)}</p>
        <span className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-sm text-zinc-600">
          Semaine suivante <ChevronRight className="size-4" aria-hidden />
        </span>
      </div>
      <div data-demo="week-grid" className="grid grid-cols-7 items-start gap-2">
        {week.map((day, i) => (
          <div key={day} className="min-w-0 space-y-2">
            <p className="rounded-lg bg-muted px-1.5 py-1.5 text-center text-xs font-semibold text-zinc-700 first-letter:uppercase">
              {weekDayLabel(i, week)}
            </p>
            {seances
              .filter((s) => s.dayIndex === i)
              .map((s) => (
                <SeanceChip key={s.id} seance={s} state={state} />
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function RdvCards() {
  const types = DEMO_TICKET_TYPES.filter((t) => t.rdv !== null);
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold tracking-tight">{RDV_CARDS_TITLE}</h2>
      <div className="grid grid-cols-2 gap-3">
        {types.map((t) => {
          const rdv = t.rdv;
          if (!rdv) return null;
          // The cheapest offer of the type, as the real card reads it (rdv-reads.ts).
          const fromPrice = t.offers.length > 0 ? Math.min(...t.offers.map((o) => o.priceCents)) : null;
          const price = rdvPriceLabel({ isFree: rdv.free, fromPriceCents: fromPrice }, "eur");
          return (
            <Card key={t.key} className="flex flex-col">
              <CardHeader className="gap-2 p-4">
                <CardTitle>{t.name}</CardTitle>
                <p className="flex items-center gap-3 text-sm text-zinc-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" aria-hidden /> {rdvDurationLabel(rdv.durationMin)}
                  </span>
                  {rdv.free ? <Badge variant="success">{price}</Badge> : <span className="font-medium text-foreground">{price}</span>}
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="line-clamp-2 text-sm text-zinc-600">{t.description}</p>
              </CardContent>
              <div className="mt-auto p-4 pt-0">
                <Button data-demo={`rdv-card-${t.key}`} size="sm">
                  Réserver un rendez-vous <ArrowRight aria-hidden />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Boutique() {
  const types = DEMO_TICKET_TYPES.filter((t) => t.offers.length > 0);
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold tracking-tight">Boutique</h2>
      {types.map((t) => {
        const events = acceptedBy(t.key);
        return (
          <Card key={t.key} data-demo={`boutique-${t.key}`}>
            <CardHeader className="p-4">
              <CardTitle className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </CardTitle>
              <p className="text-sm text-zinc-600">{t.description}</p>
              {events.length > 0 && <p className="text-sm text-zinc-600">{acceptedByLine(events)}</p>}
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="divide-y divide-border">
                {t.offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <p className="text-sm">
                      <span className="font-medium">{o.label}</span>
                      {offerOptionLabel(offerChoice(o), "eur").slice(o.label.length)}
                    </p>
                    <Button size="sm">Acheter</Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

/** « J'ai déjà des tickets »: the code sign-in dialog, drawn (nothing is sent, nobody is signed in). */
function CodeDialog({ state }: { state: DemoState }) {
  if (state.signIn === "closed") return null;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 p-6">
      <div className="demo-pop w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">Retrouver mes tickets</h2>
          <X className="size-5 text-muted-foreground" aria-hidden />
        </div>
        <p className="mt-1 text-sm text-zinc-600">{COPY.CODE_INTRO}</p>
        {state.signIn === "email" ? (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input data-demo="code-email" readOnly value={state.formEmail} />
            </div>
            <div className="space-y-1.5">
              <Label>Votre nom</Label>
              <Input readOnly value="" />
              <p className="text-xs text-zinc-600">{COPY.CODE_NAME_HELP}</p>
            </div>
            <Button data-demo="send-code">Recevoir un code</Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-zinc-600">{`Saisissez le code à 6 chiffres envoyé à ${state.formEmail}.`}</p>
            <div className="space-y-1.5">
              <Label>Code reçu par email</Label>
              <Input data-demo="code-field" readOnly value={state.formCode} className="text-center text-lg tracking-[0.4em]" />
            </div>
            <div className="flex items-center gap-2">
              <Button data-demo="check-code">Valider le code</Button>
              <Button variant="ghost">Modifier l&apos;adresse</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The public page of the demo pro (/altinha-paris): the « J'ai déjà des tickets » bar (or Léa's tickets once she is
 * signed in), the week's planning, then the rendez-vous cards and the Boutique. The page is taller than the frame:
 * `pageSection` slides it up to its lower part, the offset measured on the page itself.
 */
export function ClientPage({ state = INITIAL_STATE }: { state?: DemoState }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const lowerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const lower = lowerRef.current;
    if (!page || !lower) return;
    // Only a move down within the screen slides; the first render and a return to the top jump.
    const slide =
      mounted.current &&
      state.pageSection === "lower" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mounted.current = true;
    page.style.transition = slide ? "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    page.style.transform = state.pageSection === "lower" ? `translateY(${-(lower.offsetTop - 4)}px)` : "";
  }, [state.pageSection, state.signedIn]);

  return (
    <ClientShell overlay={<CodeDialog state={state} />}>
      <div ref={pageRef} className="relative">
        {state.signedIn ? <WalletPanel state={state} /> : <VisitorBar />}
        <Planning state={state} />
        <div ref={lowerRef} className="space-y-6 pt-8">
          <RdvCards />
          <Boutique />
        </div>
      </div>
    </ClientShell>
  );
}
