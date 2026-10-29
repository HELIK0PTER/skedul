import { MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays } from "@/lib/civil-date";
import { CANCEL_LABEL, UPCOMING_TITLE } from "@/lib/public/space-view";
import { coverageLabelOf } from "@/lib/tickets-vocab";
import {
  DEMO_CLIENT,
  LEA_RDV,
  LEA_SEANCE_IDS,
  carnetExpiryLine,
  demoWeek,
  seanceById,
  ticketType,
  whenLong,
  whenShort,
} from "../demo-data";
import { leaTicketsLeft } from "../demo-script";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

/** The pro lets a client cancel online up to 24 hours before (a setting of the page). */
const CANCEL_HOURS = 24;

/** Léa's space (/altinha-paris/espace): her bookings ahead, then her tickets. */
export function ClientEspace({ state }: ScreenProps) {
  const week = demoWeek();
  const monday = seanceById(LEA_SEANCE_IDS.monday, week);
  const wednesday = seanceById(LEA_SEANCE_IDS.wednesday, week);
  const decouverte = ticketType(LEA_RDV.type);
  const collectif = ticketType("collectif");
  const left = leaTicketsLeft(state);

  const upcoming = [
    { ...monday, kind: "seance" as const, coverage: "ticket" as const, booked: state.mondayBooked },
    {
      id: LEA_RDV.id,
      dayIndex: LEA_RDV.dayIndex,
      startMinute: LEA_RDV.startMinute,
      durationMin: LEA_RDV.durationMin,
      title: decouverte.name,
      location: null,
      kind: "rdv" as const,
      coverage: "free" as const,
      booked: state.rdvBooked,
    },
    { ...wednesday, kind: "seance" as const, coverage: "ticket" as const, booked: state.wednesdayBooked },
  ].filter((b) => b.booked);

  return (
    <ClientShell>
      <div className="space-y-4">
        <div>
          <p className="text-xl font-bold tracking-tight">{`Bonjour ${DEMO_CLIENT.name}`}</p>
          <p className="mt-1 text-sm text-zinc-600">{DEMO_CLIENT.email}</p>
        </div>

        <Card data-demo="espace-upcoming">
          <CardHeader className="p-5 pb-3">
            <CardTitle>{UPCOMING_TITLE}</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <ul className="divide-y divide-border">
              {upcoming.map((b) => {
                const day = week[b.dayIndex];
                const deadline = addDays(day, -CANCEL_HOURS / 24);
                return (
                  <li key={b.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{b.title}</p>
                      <Badge variant="neutral">{coverageLabelOf(b.coverage, b.kind === "rdv")}</Badge>
                    </div>
                    <p className="text-sm text-zinc-600">{whenLong(day, b.startMinute, b.durationMin)}</p>
                    {b.location && (
                      <p className="flex items-center gap-1.5 text-sm text-zinc-600">
                        <MapPin className="size-3.5 shrink-0" aria-hidden /> {b.location}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-xs text-zinc-600">
                        {`Annulation en ligne possible jusqu'au ${whenShort(deadline, b.startMinute)}.`}
                      </p>
                      <Button variant="outline" size="sm">
                        {CANCEL_LABEL}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card data-demo="espace-tickets">
          <CardHeader className="p-5 pb-3">
            <CardTitle>Vos tickets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-5 pt-0">
            <p className="flex items-start gap-2 font-medium">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: collectif.color }} aria-hidden />
              {`${left} × ${collectif.name}`}
            </p>
            <p className="text-sm text-zinc-600">{carnetExpiryLine(left)}</p>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
