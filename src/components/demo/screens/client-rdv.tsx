import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dayLongLabel, weekTitle } from "@/lib/back-office/planning-view";
import { COPY } from "@/lib/public/messages";
import {
  RDV_CHOSEN_LABEL,
  RDV_PICK_TITLE,
  rdvBookedLine,
  rdvDurationLabel,
  rdvSlotCountLabel,
} from "@/lib/public/rdv-view";
import { cn } from "@/lib/utils";
import { DEMO_CLIENT, LEA_RDV, demoWeek, rdvSlots, ticketType, weekDayLabel, whenLong } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

/** The page of a rendez-vous type (/altinha-paris/rdv/...): the free Appel découverte, its slots of the week. */
export function ClientRdv({ state }: ScreenProps) {
  const week = demoWeek();
  const type = ticketType(LEA_RDV.type);
  const durationMin = type.rdv?.durationMin ?? LEA_RDV.durationMin;
  const day = state.rdvDayIndex;
  const when = whenLong(week[LEA_RDV.dayIndex], LEA_RDV.startMinute, durationMin);

  return (
    <ClientShell>
      <div className="space-y-4">
        <Card>
          <CardHeader className="gap-2 p-5">
            <h1 className="text-xl font-bold tracking-tight">{type.name}</h1>
            <p className="flex items-center gap-3 text-sm text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden /> {rdvDurationLabel(durationMin)}
              </span>
              <Badge variant="success">{COPY.RDV_FREE_BADGE}</Badge>
            </p>
            <p className="text-sm text-zinc-600">{type.description}</p>
          </CardHeader>
        </Card>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">{RDV_PICK_TITLE}</h2>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-sm text-zinc-600">
              <ChevronLeft className="size-4" aria-hidden /> Semaine précédente
            </span>
            <p className="flex-1 text-center text-sm font-semibold">{weekTitle(week)}</p>
            <span className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-sm text-zinc-600">
              {COPY.RDV_NEXT_WEEK} <ChevronRight className="size-4" aria-hidden />
            </span>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {week.map((key, i) => {
              const n = rdvSlots(i).length;
              const pressed = day === i;
              return (
                <span
                  key={key}
                  data-demo={`rdv-day-${i}`}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center transition-colors",
                    pressed ? "border-primary bg-primary-muted text-accent-foreground" : "border-border bg-card",
                    n === 0 && "opacity-50",
                  )}
                >
                  <span className="text-sm font-semibold first-letter:uppercase">{weekDayLabel(i, week)}</span>
                  <span className={cn("text-xs", pressed ? "text-accent-foreground" : "text-zinc-600")}>{rdvSlotCountLabel(n)}</span>
                </span>
              );
            })}
          </div>
          {day !== null && (
            <div className="demo-pop space-y-2">
              <p className="text-sm font-medium text-zinc-700 first-letter:uppercase">{dayLongLabel(week[day])}</p>
              <div className="grid grid-cols-8 gap-1.5">
                {rdvSlots(day).map((t) => (
                  <span
                    key={t}
                    data-demo={`rdv-slot-${t}`}
                    className={cn(
                      "rounded-xl border px-2 py-1.5 text-center text-sm font-medium tabular-nums transition-colors",
                      state.rdvTime === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                    )}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {state.rdvTime !== null &&
          (state.rdvBooked ? (
            <p className="demo-pop flex items-start gap-2 rounded-2xl bg-success-muted px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              {rdvBookedLine(when, false)}
            </p>
          ) : (
            <div className="demo-pop space-y-4 rounded-2xl border border-border bg-background p-4">
              <p className="text-sm">
                <span className="font-semibold">{`${RDV_CHOSEN_LABEL} : `}</span>
                {when}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Prénom et nom</Label>
                  <Input readOnly value={DEMO_CLIENT.name} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input readOnly disabled value={DEMO_CLIENT.email} />
                  <p className="text-xs text-zinc-600">Adresse de votre compte.</p>
                </div>
              </div>
              <Button data-demo="rdv-book">
                {state.paying && <Loader2 className="animate-spin" aria-hidden />}
                {state.paying ? COPY.PENDING_BOOK : COPY.RDV_BOOK}
              </Button>
            </div>
          ))}
      </div>
    </ClientShell>
  );
}
