"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";

import { OccurrenceDialog } from "@/components/dashboard/occurrence-dialog";
import { OFF_PATTERN, dayLongLabel, dayShortLabel, hhmm, tintOf } from "@/components/dashboard/planning-calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanningItemVM, TimeOffSegmentVM } from "@/lib/back-office/planning-view";
import type { DateKey } from "@/lib/civil-date";
import { cn } from "@/lib/utils";

const HOUR_PX = 36;
const MINUTE_PX = HOUR_PX / 60;

/**
 * Compact day / week grid of the dashboard overview, on the same view model as
 * the planning page. A click opens the same occurrence dialog (held by id, so
 * it follows the refreshed data after an action). The Jour / Semaine toggle
 * switches between one day of the current week and the whole week; the header
 * links to the full planning on that week.
 */
export function WeekPreview({
  tz,
  days,
  todayKey,
  items,
  timeOff,
  startHour,
  endHour,
  weekParam,
  nowIso,
}: {
  tz: string;
  days: DateKey[];
  todayKey: DateKey;
  items: PlanningItemVM[];
  timeOff: TimeOffSegmentVM[];
  startHour: number;
  endHour: number;
  weekParam: DateKey;
  nowIso: string;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colHeight = hours.length * HOUR_PX;

  const [view, setView] = useState<"day" | "week">("week");
  const todayIndex = days.indexOf(todayKey);
  const [dayIndex, setDayIndex] = useState(todayIndex >= 0 ? todayIndex : 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  // The status line the dialog hands over when its occurrence leaves the data after an action (a cancelled RDV).
  const [notice, setNotice] = useState<string | null>(null);
  const openItem = (id: string) => {
    setNotice(null);
    setSelectedId(id);
  };
  // Only a string is a notice: whatever else a caller hands over is dropped.
  const closeDialog = (text?: string) => {
    setSelectedId(null);
    if (typeof text === "string" && text !== "") setNotice(text);
  };

  const dayColumn = (day: DateKey) => {
    const isToday = day === todayKey;
    return (
      <div key={day} className="min-w-0 flex-1 border-l border-border">
        <div
          className={cn(
            "flex h-7 items-center justify-center border-b border-border text-[11px] font-medium",
            isToday && "font-semibold text-accent-foreground",
          )}
        >
          {dayShortLabel(day)}
        </div>
        <div className="relative" style={{ height: colHeight }}>
          {timeOff
            .filter((s) => s.dayKey === day)
            .map((s) => {
              const top = Math.max(0, (s.startMinute - startHour * 60) * MINUTE_PX);
              const bottom = Math.min(colHeight, (s.endMinute - startHour * 60) * MINUTE_PX);
              if (bottom - top <= 0) return null;
              return (
                <div
                  key={`${s.id}-${s.dayKey}`}
                  className={cn("absolute inset-x-0.5 rounded", OFF_PATTERN)}
                  style={{ top, height: bottom - top }}
                  title={s.reason ?? "Indisponible"}
                />
              );
            })}
          {items
            .filter((i) => i.dayKey === day)
            .map((i) => {
              const cancelled = i.status === "cancelled";
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => openItem(i.id)}
                  className={cn(
                    "absolute overflow-hidden rounded-md border border-l-[3px] px-1 py-0.5 text-left text-[10px] leading-tight text-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    cancelled && "opacity-60 line-through",
                  )}
                  style={{
                    top: (i.startMinute - startHour * 60) * MINUTE_PX,
                    height: Math.max(16, (i.endMinute - i.startMinute) * MINUTE_PX),
                    left: `calc(${(i.lane / i.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / i.lanes}% - 4px)`,
                    backgroundColor: tintOf(i.color),
                    borderColor: `color-mix(in srgb, ${i.color} 35%, transparent)`,
                    borderLeftColor: i.color,
                  }}
                  title={`${hhmm(i.startMinute)} ${i.title}${i.kind === "seance" ? ` (${i.seatsTaken}/${i.capacity})` : ""}`}
                >
                  <span className="block truncate font-medium">{`${hhmm(i.startMinute)} ${i.title}`}</span>
                  {cancelled && <span className="sr-only">annulée</span>}
                </button>
              );
            })}
        </div>
      </div>
    );
  };

  const timeGutter = (
    <div className="w-9 shrink-0 pt-7">
      {hours.map((h) => (
        <div key={h} className="relative text-right text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
          <span className="absolute -top-1.5 right-1 tabular-nums">{String(h).padStart(2, "0")}h</span>
        </div>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{view === "day" ? "Aujourd'hui" : "Cette semaine"}</CardTitle>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "day" ? "Jour" : "Semaine"}
              </button>
            ))}
          </div>
          <Link
            href={`/dashboard/planning?semaine=${weekParam}`}
            className="inline-flex items-center rounded text-sm font-medium text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Voir le planning
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {notice && (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground"
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {notice}
          </p>
        )}
        {view === "day" && (
          <div className="mb-3 flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
              disabled={dayIndex === 0}
              aria-label="Jour précédent"
            >
              <ChevronLeft />
            </Button>
            <span className="block min-w-[10rem] text-center text-sm font-medium first-letter:uppercase">{dayLongLabel(days[dayIndex])}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
              disabled={dayIndex === days.length - 1}
              aria-label="Jour suivant"
            >
              <ChevronRight />
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <div className={cn("flex", view === "week" && "min-w-[640px]")}>
            {timeGutter}
            {view === "week" ? days.map((day) => dayColumn(day)) : dayColumn(days[dayIndex])}
          </div>
        </div>
      </CardContent>

      {selected && <OccurrenceDialog item={selected} tz={tz} nowIso={nowIso} onClose={closeDialog} />}
    </Card>
  );
}
