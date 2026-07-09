import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { toHHMM } from "@/components/dashboard/weekly-hours-editor";
import { cn } from "@/lib/utils";
import { DEMO_WEEK_SESSIONS, leaSession, planningWeekDays } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

const START_HOUR = 9;
const END_HOUR = 20;
const HOUR_PX = 52;

export function ProPlanning({ state }: ScreenProps) {
  const week = planningWeekDays();
  const sessions = state.planningHasLea
    ? [...DEMO_WEEK_SESSIONS, leaSession()]
    : DEMO_WEEK_SESSIONS;
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const weekLabel = `${format(week[0], "d", { locale: fr })} – ${format(week[6], "d MMMM yyyy", { locale: fr })}`;

  return (
    <ProShell active="planning">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Planning</h1>
          <p className="text-sm text-muted-foreground">
            Vos séances et rendez-vous de la semaine.
          </p>
        </div>
        <p className="text-sm font-medium">{weekLabel}</p>
      </div>

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
          <div key={di} className="flex-1 border-l border-border">
            <p className="flex h-7 items-center justify-center text-xs font-medium capitalize">
              {format(day, "EEE d", { locale: fr })}
            </p>
            <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
              {hours.slice(1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (h - START_HOUR) * HOUR_PX }}
                />
              ))}
              {sessions
                .filter((s) => s.dayIndex === di)
                .map((s) => (
                  <span
                    key={s.id}
                    data-demo={s.id === "lea" ? "session-lea" : undefined}
                    className={cn(
                      "absolute inset-x-0.5 block rounded-lg border border-black/10 p-1 text-left text-[11px] leading-tight text-white shadow-sm",
                      s.id === "lea" && "demo-pop",
                    )}
                    style={{
                      top: (s.startMinute - START_HOUR * 60) * (HOUR_PX / 60),
                      height: Math.max(s.durationMinutes * (HOUR_PX / 60), 22),
                      backgroundColor: s.color,
                    }}
                  >
                    <span className="font-medium">
                      {toHHMM(s.startMinute)} {s.title}
                    </span>
                    <span className="block opacity-90">{s.subtitle}</span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </ProShell>
  );
}
