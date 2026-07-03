"use client";

import { useState } from "react";
import { addMonths, format, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { getMonthGridDays, parseDayKey, toDayKey } from "@/lib/calendar-grid";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

interface DayCalendarProps {
  availableKeys: string[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function DayCalendar({ availableKeys, selectedKey, onSelect }: DayCalendarProps) {
  const availableSet = new Set(availableKeys);

  const [viewMonth, setViewMonth] = useState(() => {
    const firstKey = availableKeys[0];
    return firstKey ? parseDayKey(firstKey) : new Date();
  });

  const gridDays = getMonthGridDays(viewMonth);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mois précédent"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-sm font-semibold capitalize">
          {format(viewMonth, "MMMM yyyy", { locale: fr })}
        </p>
        <button
          type="button"
          aria-label="Mois suivant"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {gridDays.map((date) => {
          const key = toDayKey(date);
          const inViewMonth = date.getMonth() === viewMonth.getMonth();
          const available = availableSet.has(key);
          const selected = selectedKey === key;

          return (
            <button
              key={key}
              type="button"
              disabled={!available}
              onClick={() => onSelect(key)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg py-2 text-sm transition-colors",
                !inViewMonth && "text-muted-foreground/40",
                !available && "cursor-not-allowed text-muted-foreground opacity-40",
                available &&
                  !selected &&
                  "text-foreground hover:border-primary hover:bg-accent",
                selected && "border-primary bg-accent text-accent-foreground",
              )}
            >
              {date.getDate()}
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  available ? "bg-primary" : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
