import { Lock, MapPin, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { dayLongLabel, weekTitle } from "@/lib/back-office/planning-view";
import { COVERAGE_LABELS } from "@/lib/tickets-vocab";
import { cn } from "@/lib/utils";
import {
  DEMO_CLIENT,
  LEA_RDV,
  LEA_SEANCE_IDS,
  MONDAY_ATTENDEES,
  PLANNING_HOURS,
  WEEK_RDVS,
  demoWeek,
  rangeLabel,
  seanceById,
  ticketType,
  timeLabel,
  weekDayLabel,
  weekSeances,
} from "../demo-data";
import { seatsLeft, type DemoState } from "../demo-script";
import { ProPageHeader, ProShell } from "./pro-shell";

const HOUR_PX = 56;
const HOURS = PLANNING_HOURS.end - PLANNING_HOURS.start;
const top = (minute: number) => (minute - PLANNING_HOURS.start * 60) * (HOUR_PX / 60);
const height = (durationMin: number) => Math.max(durationMin * (HOUR_PX / 60), 22);

/** The registrants of Monday's débutants séance, Léa last once she booked. */
function SeancePanel({ state }: { state: DemoState }) {
  const week = demoWeek();
  const seance = seanceById(LEA_SEANCE_IDS.monday, week);
  const attendees = [
    ...MONDAY_ATTENDEES,
    ...(state.mondayBooked ? [{ name: DEMO_CLIENT.name, coverage: "ticket" as const, ticket: ticketType("collectif").name }] : []),
  ];
  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-[340px] flex-col border-l border-border bg-card shadow-xl demo-pop">
      <div className="flex items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{seance.title}</h2>
          <p className="text-sm font-medium first-letter:uppercase">
            {`${dayLongLabel(week[seance.dayIndex])} · ${rangeLabel(seance.startMinute, seance.durationMin)}`}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-600">
            <MapPin className="size-3.5" aria-hidden /> {seance.location}
          </p>
        </div>
        <X className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div data-demo="seance-attendees" className="space-y-3 p-5">
        <p className="text-sm font-semibold">{`${attendees.length} inscrits sur ${seance.capacity}`}</p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {attendees.map((a) => (
            <li
              key={a.name}
              className={cn(
                "flex items-center justify-between gap-2 px-3 py-2 text-sm",
                a.name === DEMO_CLIENT.name && "bg-primary-muted",
              )}
            >
              <span className="min-w-0 truncate font-medium">{a.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {a.ticket && <span className="text-xs text-zinc-600">{a.ticket}</span>}
                <Badge variant={a.coverage === "guest" ? "outline" : "neutral"}>{COVERAGE_LABELS[a.coverage]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The pro's week: séances in their event's colour, rendez-vous in a light tint of their ticket type's. */
export function ProPlanning({ state }: { state: DemoState }) {
  const week = demoWeek();
  const seances = weekSeances(week);
  const rdvs = [
    ...WEEK_RDVS,
    ...(state.planningHasLea ? [{ ...LEA_RDV, who: DEMO_CLIENT.name }] : []),
  ];
  const hours = Array.from({ length: HOURS + 1 }, (_, i) => PLANNING_HOURS.start + i);

  return (
    <ProShell active="planning" overlay={state.planningSeanceOpen ? <SeancePanel state={state} /> : null}>
      <ProPageHeader
        title="Planning"
        description="Vos séances, rendez-vous et indisponibilités de la semaine."
        action={<p className="shrink-0 pt-1 text-sm font-semibold">{weekTitle(week)}</p>}
      />

      <div className="mt-3 flex">
        <div className="relative w-10 shrink-0 pt-7">
          {hours.slice(0, -1).map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_PX }}>
              <span className="absolute -top-1.5 right-1.5 text-[10px] text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>
        {week.map((day, di) => (
          <div key={day} className="min-w-0 flex-1 border-l border-border">
            <p className="flex h-7 items-center justify-center text-xs font-medium first-letter:uppercase">
              {weekDayLabel(di, week)}
            </p>
            <div className="relative" style={{ height: HOURS * HOUR_PX }}>
              {hours.slice(1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (h - PLANNING_HOURS.start) * HOUR_PX }}
                />
              ))}
              {seances
                .filter((s) => s.dayIndex === di)
                .map((s) => (
                  <span
                    key={s.id}
                    data-demo={`pro-seance-${s.id}`}
                    className="absolute inset-x-0.5 block overflow-hidden rounded-lg border border-black/10 p-1 text-left text-[11px] leading-tight text-white shadow-sm"
                    style={{ top: top(s.startMinute), height: height(s.durationMin), backgroundColor: s.color }}
                  >
                    <span className="flex items-center gap-1 font-medium">
                      {s.isPrivate && <Lock className="size-3 shrink-0" aria-hidden />}
                      {timeLabel(s.startMinute)} {s.title}
                    </span>
                    <span className="block opacity-90">{`${s.capacity - seatsLeft(s, state)}/${s.capacity}`}</span>
                  </span>
                ))}
              {rdvs
                .filter((r) => r.dayIndex === di)
                .map((r) => {
                  const type = ticketType(r.type);
                  const lea = r.id === LEA_RDV.id;
                  return (
                    <span
                      key={r.id}
                      data-demo={lea ? "rdv-lea" : undefined}
                      className={cn(
                        "absolute inset-x-0.5 block overflow-hidden rounded-md px-1 py-0.5 text-left text-[10px] leading-tight text-foreground",
                        lea && "demo-pop",
                      )}
                      style={{
                        top: top(r.startMinute),
                        height: height(r.durationMin),
                        backgroundColor: `${type.color}26`,
                        borderLeft: `3px solid ${type.color}`,
                      }}
                    >
                      <span className="block truncate font-medium">{`${timeLabel(r.startMinute)} ${r.who}`}</span>
                      {r.durationMin >= 45 && <span className="block truncate text-zinc-600">{type.name}</span>}
                    </span>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </ProShell>
  );
}
