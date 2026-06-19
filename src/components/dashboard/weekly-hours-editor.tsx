"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Range = { start: string; end: string };
export type ByDay = Record<number, Range[]>;
export type Rule = { dayOfWeek: number; startMinute: number; endMinute: number };

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  0: "Dimanche",
};

export const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function emptyByDay(): ByDay {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

export function byDayFromRules(rules: Rule[]): ByDay {
  const base = emptyByDay();
  for (const r of rules) {
    base[r.dayOfWeek].push({
      start: toHHMM(r.startMinute),
      end: toHHMM(r.endMinute),
    });
  }
  return base;
}

export function rulesFromByDay(byDay: ByDay): Rule[] {
  const rules: Rule[] = [];
  for (const day of DAY_ORDER) {
    for (const r of byDay[day]) {
      rules.push({
        dayOfWeek: day,
        startMinute: toMinutes(r.start),
        endMinute: toMinutes(r.end),
      });
    }
  }
  return rules;
}

/** Presentational weekly schedule grid. Owns no persistence. */
export function WeeklyHoursEditor({
  value,
  onChange,
}: {
  value: ByDay;
  onChange: (next: ByDay) => void;
}) {
  function update(day: number, ranges: Range[]) {
    onChange({ ...value, [day]: ranges });
  }

  return (
    <div className="space-y-3">
      {DAY_ORDER.map((day) => {
        const ranges = value[day];
        const enabled = ranges.length > 0;
        return (
          <Card key={day}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <button
                type="button"
                onClick={() =>
                  update(day, enabled ? [] : [{ start: "09:00", end: "17:00" }])
                }
                className={cn(
                  "flex w-32 shrink-0 items-center gap-2 text-sm font-medium",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                    enabled ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-4 rounded-full bg-white shadow transition-transform",
                      enabled && "translate-x-4",
                    )}
                  />
                </span>
                {DAY_LABELS[day]}
              </button>

              <div className="flex-1 space-y-2">
                {!enabled && (
                  <p className="text-sm text-muted-foreground">Indisponible</p>
                )}
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={r.start}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, start: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="time"
                      value={r.end}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, end: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        update(
                          day,
                          ranges.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {enabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      update(day, [...ranges, { start: "09:00", end: "17:00" }])
                    }
                  >
                    <Plus className="size-4" />
                    Ajouter une plage
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
