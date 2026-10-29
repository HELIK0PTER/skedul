import { Check, ChevronDown, ChevronLeft, Plus } from "lucide-react";

import { TypeChip } from "@/components/dashboard/type-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODE_SHORT_LABELS } from "@/lib/back-office/labels";
import { dayShortLabel } from "@/lib/back-office/planning-view";
import { addDays, formatDayMonthYear, parseKey } from "@/lib/civil-date";
import { BOOKING_MODE_LABELS } from "@/lib/tickets-vocab";
import { cn } from "@/lib/utils";
import {
  DEMO_EVENTS,
  DEMO_TICKET_TYPES,
  demoEvent,
  demoWeek,
  rangeLabel,
  ticketType,
  timeLabel,
  weekSeances,
  whenShort,
  type DemoEvent,
} from "../demo-data";
import type { DemoState } from "../demo-script";
import { ProPageHeader, ProShell } from "./pro-shell";

const COLORS = ["#16a34a", "#0d9488", "#0ea5e9", "#6d5cf6", "#f59e0b", "#dc2626"];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

/** « lun. 02/11 · 19:00 », the first séance of an event from the shown week on. */
function nextSeance(event: DemoEvent): string {
  const week = demoWeek();
  const first = weekSeances(week).find((s) => s.event === event.key);
  if (first) return whenShort(week[first.dayIndex], first.startMinute);
  // Only the atelier skips a week: it runs on the first Sunday of a month.
  let sunday = week[6];
  while (parseKey(sunday).d > 7) sunday = addDays(sunday, 7);
  return whenShort(sunday, event.startMinute);
}

function EventList() {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Événement</th>
            <th className="px-3 py-2.5 font-medium">Mode</th>
            <th className="px-3 py-2.5 font-medium">Tickets acceptés</th>
            <th className="px-4 py-2.5 font-medium">Prochaine séance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {DEMO_EVENTS.map((e) => (
            <tr key={e.key} className="align-top">
              <td className="px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                  <div className="min-w-0">
                    <span data-demo={`event-${e.key}`} className="font-medium underline-offset-4 hover:underline">
                      {e.title}
                    </span>
                    <p className="text-xs text-muted-foreground">{e.recurrenceLabel}</p>
                    {e.isPrivate && (
                      <Badge variant="neutral" className="mt-1">
                        Privé
                      </Badge>
                    )}
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-3">{MODE_SHORT_LABELS[e.mode]}</td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {e.accepts.length === 0 ? (
                    <span className="text-muted-foreground">Aucun</span>
                  ) : (
                    e.accepts.map((k) => <TypeChip key={k} name={ticketType(k).name} color={ticketType(k).color} />)
                  )}
                </div>
              </td>
              <td className="px-4 py-3">{nextSeance(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** The editor of « Altinha débutants »: what it is, then the séances its repetition creates. */
function EventEditor() {
  const event = demoEvent("debutants");
  const week = demoWeek();
  const next = [week[0], week[2], addDays(week[0], 7), addDays(week[2], 7), addDays(week[0], 14)];
  return (
    <div className="demo-pop space-y-3">
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Événements
      </p>
      <h1 className="text-xl font-bold tracking-tight">{event.title}</h1>
      <div className="grid grid-cols-2 items-start gap-3">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="space-y-1.5">
              <Label>Titre</Label>
              <Input readOnly value={event.title} />
            </div>
            <div className="space-y-1.5">
              <Label>Lieu</Label>
              <Input readOnly value={event.location} />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="space-y-1.5">
                <Label>Couleur</Label>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <span
                      key={c}
                      className={cn("size-6 rounded-full", c === event.color && "ring-2 ring-foreground ring-offset-2")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="w-20 space-y-1.5">
                <Label>Places</Label>
                <Input readOnly value={String(event.capacity)} />
              </div>
            </div>
            <p className="text-right text-xs text-muted-foreground">Par séance.</p>
            <div className="space-y-1.5">
              <Label>Mode de réservation</Label>
              <p className="rounded-xl border border-primary bg-primary-muted px-3 py-2 text-sm font-medium">
                {BOOKING_MODE_LABELS[event.mode]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tickets acceptés</Label>
              <div className="space-y-1">
                {DEMO_TICKET_TYPES.filter((t) => t.rdv === null || !t.rdv.free).map((t) => {
                  const on = event.accepts.includes(t.key);
                  return (
                    <span key={t.key} className="flex items-center gap-2 text-sm">
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-4 place-items-center rounded border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <TypeChip name={t.name} color={t.color} />
                    </span>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-demo="event-recurrence">
          <CardHeader className="p-4 pb-2">
            <CardTitle>Séances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date de début</Label>
                <Input readOnly value={formatDayMonthYear(addDays(week[0], -56))} />
              </div>
              <div className="space-y-1.5">
                <Label>Heure de début</Label>
                <Input readOnly value={timeLabel(event.startMinute)} />
              </div>
              <div className="space-y-1.5">
                <Label>Durée</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={String(event.durationMin)} className="w-20" />
                  <span className="text-sm text-zinc-600">min</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Répétition</Label>
                <span className="flex h-10 items-center justify-between rounded-xl border border-input bg-card px-3 text-sm">
                  Toutes les semaines <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                </span>
              </div>
            </div>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((d, i) => (
                <span
                  key={i}
                  className={cn(
                    "grid size-8 place-items-center rounded-full border text-xs font-semibold",
                    event.days.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {d}
                </span>
              ))}
            </div>
            <p className="text-sm font-medium">{event.recurrenceLabel}</p>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Prochaines séances</p>
              <ul className="space-y-0.5 text-sm">
                {next.map((key) => (
                  <li key={key} className="first-letter:uppercase">
                    {`${dayShortLabel(key)} · ${rangeLabel(event.startMinute, event.durationMin)}`}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** The events of the pro: a list, then the editor of the débutants course once the cursor opens it. */
export function ProEvents({ state }: { state: DemoState }) {
  return (
    <ProShell active="events">
      {state.eventEditorOpen ? (
        <EventEditor />
      ) : (
        <div className="space-y-4">
          <ProPageHeader
            title="Événements"
            description="Vos cours et vos ateliers, ponctuels ou récurrents."
            action={
              <Button size="sm">
                <Plus aria-hidden /> Nouvel événement
              </Button>
            }
          />
          <EventList />
        </div>
      )}
    </ProShell>
  );
}
