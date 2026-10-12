"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TZDate } from "@date-fns/tz";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanningSessionVM } from "@/components/dashboard/planning-calendar";
import { SessionDetailDialog } from "@/components/dashboard/session-detail-dialog";
import { cn } from "@/lib/utils";
import { DAYS_FR, dayKeyInTz, formatTime } from "@/lib/datetime";

export type WeekPreviewTimeOffVM = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

const HOUR_PX = 36;

function localMidnightForKey(key: string, tz: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime();
}

/**
 * Compact week/day-at-a-glance grid for the dashboard overview. Mirrors the
 * geometry of {@link PlanningCalendar}; clicking a session opens the same
 * detail dialog as the planning. A Jour/Semaine toggle switches between a
 * single day (navigable within the current week) and the full week. The
 * header links to the full planning page.
 */
export function WeekPreview(props: {
  tz: string;
  days: string[];
  startHour: number;
  endHour: number;
  sessions: PlanningSessionVM[];
  timeOff: WeekPreviewTimeOffVM[];
  weekParam: string;
  todayKey: string;
}) {
  const { tz, startHour, endHour } = props;
  const days = props.days.map((d) => new Date(d));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colHeight = hours.length * HOUR_PX;

  const [view, setView] = useState<"day" | "week">("week");
  const todayIndex = days.findIndex((d) => dayKeyInTz(d, tz) === props.todayKey);
  const [dayIndex, setDayIndex] = useState(todayIndex >= 0 ? todayIndex : 0);
  // By id, so the dialog follows the refreshed data after an action.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = props.sessions.find((s) => s.id === selectedId) ?? null;

  const topPx = (iso: string, key: string) =>
    ((new Date(iso).getTime() - localMidnightForKey(key, tz)) / 60_000 -
      startHour * 60) *
    (HOUR_PX / 60);
  const heightPx = (a: string, b: string) =>
    Math.max(
      16,
      ((new Date(b).getTime() - new Date(a).getTime()) / 60_000) * (HOUR_PX / 60),
    );

  const dayColumn = (day: Date) => {
    const key = dayKeyInTz(day, tz);
    const daySessions = props.sessions.filter(
      (s) => dayKeyInTz(new Date(s.startAt), tz) === key,
    );
    const dayOff = props.timeOff.filter(
      (t) => dayKeyInTz(new Date(t.startAt), tz) === key,
    );
    const dow = new TZDate(day.getTime(), tz).getDay();
    const isToday = key === props.todayKey;
    return (
      <div key={key} className="flex-1 border-l border-border">
        <div
          className={cn(
            "flex h-7 items-center justify-center border-b border-border text-center text-[11px] font-medium",
            isToday && "text-primary",
          )}
        >
          {DAYS_FR[dow].slice(0, 3)}{" "}
          {new Intl.DateTimeFormat("fr-FR", {
            day: "numeric",
            timeZone: tz,
          }).format(day)}
        </div>
        <div className="relative" style={{ height: colHeight }}>
          {dayOff.map((t) => (
            <div
              key={t.id}
              className="absolute inset-x-0.5 rounded bg-muted/60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.05)_6px,rgba(0,0,0,0.05)_12px)]"
              style={{
                top: topPx(t.startAt, key),
                height: heightPx(t.startAt, t.endAt),
              }}
              title={t.reason ?? "Indisponible"}
            />
          ))}
          {daySessions.map((s) => {
            const booked = s.capacity - s.seatsRemaining;
            const group = s.capacity > 1;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className="absolute inset-x-0.5 overflow-hidden rounded-md border border-black/10 px-1 py-0.5 text-left text-[10px] leading-tight text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                style={{
                  top: topPx(s.startAt, key),
                  height: heightPx(s.startAt, s.endAt),
                  backgroundColor: s.eventColor,
                }}
                title={`${formatTime(new Date(s.startAt), tz)} · ${s.eventTitle}${
                  group ? ` (${booked}/${s.capacity})` : ""
                }`}
              >
                <span className="block truncate font-medium">
                  {formatTime(new Date(s.startAt), tz)} {s.eventTitle}
                </span>
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
        <div
          key={h}
          className="relative text-right text-[10px] text-muted-foreground"
          style={{ height: HOUR_PX }}
        >
          <span className="absolute -top-1.5 right-1">
            {String(h).padStart(2, "0")}h
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{view === "day" ? "Aujourd'hui" : "Cette semaine"}</CardTitle>
        <div className="flex items-center gap-2">
          {/* Jour / Semaine toggle */}
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["day", "week"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "day" ? "Jour" : "Semaine"}
              </button>
            ))}
          </div>
          <Link
            href={`/dashboard/planning?week=${props.weekParam}`}
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            Voir le planning
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {view === "day" && (
          <div className="mb-3 flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
              disabled={dayIndex === 0}
              aria-label="Jour précédent"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[10rem] text-center text-sm font-medium">
              {new Intl.DateTimeFormat("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: tz,
              }).format(days[dayIndex])}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
              disabled={dayIndex === days.length - 1}
              aria-label="Jour suivant"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        <div className="overflow-x-auto">
          <div className={cn("flex", view === "week" && "min-w-[640px]")}>
            {timeGutter}
            {view === "week"
              ? days.map((day) => dayColumn(day))
              : dayColumn(days[dayIndex])}
          </div>
        </div>
      </CardContent>

      {selected && (
        <SessionDetailDialog
          session={selected}
          tz={tz}
          allSessions={props.sessions}
          onClose={() => setSelectedId(null)}
        />
      )}
    </Card>
  );
}
