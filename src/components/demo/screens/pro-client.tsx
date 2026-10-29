import { ChevronDown, ChevronLeft, Gift } from "lucide-react";

import { TypeChip } from "@/components/dashboard/type-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/back-office/format";
import { PURCHASE_STATUS_LABELS, coverageLabelOf } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";
import {
  DEMO_CARNET,
  DEMO_CLIENT,
  LEA_RDV,
  LEA_SEANCE_IDS,
  carnetExpiryLine,
  dayMonth,
  demoToday,
  demoWeek,
  seanceById,
  ticketType,
  whenShort,
} from "../demo-data";
import { leaTicketsLeft, type DemoState } from "../demo-script";
import { ProShell } from "./pro-shell";

const WALLET_ACTIONS = ["Pointer", "Convertir", "Clore", "Retirer"];

/** « Offrir des tickets », drawn over the client file: one Cours collectif ticket, without limit. */
function GiveDialog() {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 p-6">
      <div className="demo-pop w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Offrir des tickets</h2>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <span className="flex h-10 items-center justify-between rounded-xl border border-input bg-card px-3 text-sm">
            {ticketType("collectif").name} <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </div>
        <div className="space-y-1.5">
          <Label>Quantité</Label>
          <Input readOnly value="1" className="w-24" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Validité</p>
          <span className="flex items-center gap-2 text-sm">
            <span className="grid size-4 place-items-center rounded-full border border-primary">
              <span className="size-2 rounded-full bg-primary" />
            </span>
            Sans limite
          </span>
        </div>
        <div className="space-y-1.5">
          <Label>Motif (facultatif)</Label>
          <Input readOnly value="Geste commercial" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost">Retour</Button>
          <Button data-demo="give-confirm">Offrir</Button>
        </div>
      </div>
    </div>
  );
}

/** Léa's file (/dashboard/clients/...): her tickets by type with their expiry, her bookings and her purchases. */
export function ProClient({ state }: { state: DemoState }) {
  const week = demoWeek();
  const collectif = ticketType("collectif");
  const left = leaTicketsLeft(state);
  const fromCarnet = left - (state.ticketGiven ? 1 : 0);
  const monday = seanceById(LEA_SEANCE_IDS.monday, week);
  const wednesday = seanceById(LEA_SEANCE_IDS.wednesday, week);
  const bookings = [
    { id: monday.id, title: monday.title, when: whenShort(week[monday.dayIndex], monday.startMinute), coverage: coverageLabelOf("ticket", false) },
    {
      id: LEA_RDV.id,
      title: ticketType(LEA_RDV.type).name,
      when: whenShort(week[LEA_RDV.dayIndex], LEA_RDV.startMinute),
      coverage: coverageLabelOf("free", true),
    },
    { id: wednesday.id, title: wednesday.title, when: whenShort(week[wednesday.dayIndex], wednesday.startMinute), coverage: coverageLabelOf("ticket", false) },
  ];

  return (
    <ProShell active="clients" overlay={state.giveOpen ? <GiveDialog /> : null}>
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Clients
      </p>
      <h1 className="mt-1 text-xl font-bold tracking-tight">{DEMO_CLIENT.name}</h1>
      <p className="text-sm text-muted-foreground">{DEMO_CLIENT.email}</p>

      <div className="mt-4 grid grid-cols-[1fr_1.1fr] items-start gap-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 p-4 pb-3">
            <CardTitle>Portefeuille</CardTitle>
            <div className="flex flex-col items-end gap-1">
              <Button data-demo="give-ticket" variant="secondary" size="sm">
                <Gift aria-hidden /> Offrir des tickets
              </Button>
              {state.ticketGiven && <p className="demo-pop text-xs font-medium text-green-700">1 ticket offert.</p>}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <section data-demo="wallet-collectif" className="space-y-3">
              <TypeChip name={collectif.name} color={collectif.color} />
              <div>
                <p className="text-sm font-medium">{plural(left, "ticket utilisable", "tickets utilisables")}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
                  {fromCarnet > 0 && <li>{carnetExpiryLine(fromCarnet)}</li>}
                  {state.ticketGiven && <li className="demo-pop">1 sans limite de validité</li>}
                </ul>
              </div>
              <p className="text-sm text-zinc-600">{`Utilisés et clos (${DEMO_CARNET.quantity - fromCarnet})`}</p>
              <div className="flex flex-wrap gap-1.5">
                {WALLET_ACTIONS.map((a) => (
                  <Button key={a} variant="outline" size="sm">
                    {a}
                  </Button>
                ))}
              </div>
            </section>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle>Inscriptions</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="divide-y divide-border">
                {bookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.title}</p>
                      <p className="text-xs text-zinc-600">{b.when}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="neutral">{b.coverage}</Badge>
                      <Button variant="ghost" size="sm">
                        Déplacer
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle>Achats</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{`${DEMO_CARNET.label} · ${collectif.name}`}</p>
                  <p className="text-xs text-zinc-600">
                    {`${dayMonth(demoToday())} · ${plural(DEMO_CARNET.quantity, "ticket", "tickets")}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium">{formatMoney(DEMO_CARNET.priceCents)}</span>
                  <Badge variant="success">{PURCHASE_STATUS_LABELS.paid}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ProShell>
  );
}
