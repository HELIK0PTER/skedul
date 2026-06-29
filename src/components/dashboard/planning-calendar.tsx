"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TZDate } from "@date-fns/tz";

import { Button } from "@/components/ui/button";
import { SessionDetailDialog } from "@/components/dashboard/session-detail-dialog";
import { ManualBookingButton } from "@/components/dashboard/manual-booking-form";
import { DAYS_FR, dayKeyInTz, formatTime, minutesToLabel } from "@/lib/datetime";

export type PlanningAttendeeVM = {
  bookingId: string;
  name: string;
  email: string;
  status: string;
  paymentType: string;
  answers: { label: string; value: string }[];
};

export type PlanningSessionVM = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  seatsRemaining: number;
  eventTitle: string;
  eventColor: string;
  attendees: PlanningAttendeeVM[];
};

export type PlanningTimeOffVM = {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
};

const HOUR_PX = 60;

function localMidnightForKey(key: string, tz: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime();
}

export function PlanningCalendar(props: {
  tz: string;
  days: string[];
  startHour: number;
  endHour: number;
  sessions: PlanningSessionVM[];
  timeOff: PlanningTimeOffVM[];
  eventTypes: { id: string; title: string }[];
  nav: { prevParam: string; nextParam: string; todayParam: string };
}) {
  const { tz, startHour, endHour } = props;
  const [selected, setSelected] = useState<PlanningSessionVM | null>(null);
  const days = props.days.map((d) => new Date(d));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colHeight = hours.length * HOUR_PX;

  // Libellé de la semaine affichée, ex. « 22 – 28 juin 2026 ».
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: tz });
  const first = days[0];
  const last = days[6];
  const sameMonth =
    fmt({ month: "long", year: "numeric" }).format(first) ===
    fmt({ month: "long", year: "numeric" }).format(last);
  const sameYear =
    fmt({ year: "numeric" }).format(first) === fmt({ year: "numeric" }).format(last);
  const startLabel = sameMonth
    ? fmt({ day: "numeric" }).format(first)
    : sameYear
      ? fmt({ day: "numeric", month: "long" }).format(first)
      : fmt({ day: "numeric", month: "long", year: "numeric" }).format(first);
  const weekLabel = `${startLabel} – ${fmt({ day: "numeric", month: "long", year: "numeric" }).format(last)}`;

  const topPx = (iso: string, key: string) =>
    ((new Date(iso).getTime() - localMidnightForKey(key, tz)) / 60_000 -
      startHour * 60) *
    (HOUR_PX / 60);
  const heightPx = (a: string, b: string) =>
    Math.max(
      22,
      ((new Date(b).getTime() - new Date(a).getTime()) / 60_000) * (HOUR_PX / 60),
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/planning?week=${props.nav.prevParam}`} aria-label="Semaine précédente">
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <span className="min-w-[11rem] text-center text-sm font-medium">
              {weekLabel}
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/planning?week=${props.nav.nextParam}`} aria-label="Semaine suivante">
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/dashboard/planning?week=${props.nav.todayParam}`}>
              Aujourd&apos;hui
            </Link>
          </Button>
        </div>
        <ManualBookingButton eventTypes={props.eventTypes} />
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[760px]">
            <div className="w-12 shrink-0 pt-8">
              {hours.map((h) => (
                <div
                  key={h}
                  className="relative text-right text-[10px] text-muted-foreground"
                  style={{ height: HOUR_PX }}
                >
                  <span className="absolute -top-1.5 right-1">
                    {minutesToLabel(h * 60)}
                  </span>
                </div>
              ))}
            </div>

            {days.map((day) => {
              const key = dayKeyInTz(day, tz);
              const daySessions = props.sessions.filter(
                (s) => dayKeyInTz(new Date(s.startAt), tz) === key,
              );
              const dayOff = props.timeOff.filter(
                (t) => dayKeyInTz(new Date(t.startAt), tz) === key,
              );
              const dow = new TZDate(day.getTime(), tz).getDay();
              return (
                <div key={key} className="flex-1 border-l border-border">
                  <div className="flex h-8 items-center justify-center border-b border-border text-center text-xs font-medium">
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
                          onClick={() => setSelected(s)}
                          className="absolute inset-x-0.5 overflow-hidden rounded-lg border border-black/10 p-1 text-left text-[11px] leading-tight text-white shadow-sm transition-opacity hover:opacity-90"
                          style={{
                            top: topPx(s.startAt, key),
                            height: heightPx(s.startAt, s.endAt),
                            backgroundColor: s.eventColor,
                          }}
                        >
                          <span className="block font-medium">
                            {formatTime(new Date(s.startAt), tz)} {s.eventTitle}
                          </span>
                          <span className="block opacity-90">
                            {group ? `${booked}/${s.capacity}` : s.attendees[0]?.name ?? ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {selected && (
        <SessionDetailDialog
          session={selected}
          tz={tz}
          allSessions={props.sessions}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
