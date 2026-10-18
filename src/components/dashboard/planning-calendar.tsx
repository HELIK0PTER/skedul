"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Plus, UserRound } from "lucide-react";

import { OccurrenceDialog } from "@/components/dashboard/occurrence-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/back-office/format";
import {
  blockLabel,
  dayLongLabel,
  dayShortLabel,
  hhmm,
  minuteFromOffset,
  tintOf,
  type PlanningItemVM,
  type TimeOffSegmentVM,
} from "@/lib/back-office/planning-view";
import type { DateKey } from "@/lib/civil-date";
import { dayKeyInTz, wallClockMinutes } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const HOUR_PX = 60;
const MINUTE_PX = HOUR_PX / 60;

/** Hatched block of a time off (planning grid, week preview, mobile list). */
export const OFF_PATTERN =
  "bg-muted/60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.05)_6px,rgba(0,0,0,0.05)_12px)]";

// The pure formatters live in planning-view.ts (tested there); week-preview.tsx imports them from this module.
export { dayLongLabel, dayShortLabel, hhmm, tintOf };

const seatsText = (item: PlanningItemVM): string =>
  `${plural(item.seatsTaken, "inscrit", "inscrits")} sur ${item.capacity}`;

/**
 * The status line the occurrence dialog hands over when its séance leaves the page data (an ended RDV, a séance
 * hidden by a time off). The live region is always on the page and only its text changes, so assistive technology
 * announces it; a new line also takes the focus, because the dialog and the block that opened it are gone.
 * Shared with the week preview.
 */
export function PlanningNotice({ notice }: { notice: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) box.current?.focus();
  }, [notice]);
  return (
    <div
      ref={box}
      role="status"
      tabIndex={-1}
      className={cn(
        notice &&
          "mb-3 flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {notice && (
        <>
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          {notice}
        </>
      )}
    </div>
  );
}

function ItemBlock({
  item,
  tz,
  startHour,
  onOpen,
}: {
  item: PlanningItemVM;
  tz: string;
  startHour: number;
  onOpen: (id: string) => void;
}) {
  const cancelled = item.status === "cancelled";
  const top = (item.startMinute - startHour * 60) * MINUTE_PX;
  const height = Math.max(22, (item.endMinute - item.startMinute) * MINUTE_PX);
  const second = item.kind === "seance" ? `${item.seatsTaken}/${item.capacity}` : (item.attendees[0]?.name ?? "");
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={blockLabel(item, tz)}
      className={cn(
        "absolute overflow-hidden rounded-lg border border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight text-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
        cancelled && "opacity-75 line-through",
      )}
      style={{
        top,
        height,
        left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`,
        width: `calc(${100 / item.lanes}% - 4px)`,
        backgroundColor: tintOf(item.color),
        borderColor: `color-mix(in srgb, ${item.color} 35%, transparent)`,
        borderLeftColor: item.color,
      }}
    >
      <span className="flex items-center gap-1 truncate font-medium">
        {item.kind === "rdv" && <UserRound className="size-3 shrink-0" aria-hidden="true" />}
        <span className="truncate">{`${hhmm(item.startMinute)} ${item.title}`}</span>
      </span>
      <span className={cn("block truncate", !cancelled && "text-foreground/80")}>{second}</span>
      {cancelled && <span className="sr-only">annulée</span>}
    </button>
  );
}

function OffBlock({ segment, startHour, endHour }: { segment: TimeOffSegmentVM; startHour: number; endHour: number }) {
  const top = Math.max(0, (segment.startMinute - startHour * 60) * MINUTE_PX);
  const bottom = Math.min((endHour - startHour) * HOUR_PX, (segment.endMinute - startHour * 60) * MINUTE_PX);
  const height = bottom - top;
  if (height <= 0) return null;
  const label = segment.reason ?? "Indisponible";
  return (
    <div
      className={cn("absolute inset-x-0.5 overflow-hidden rounded-md border border-dashed border-border px-1 pt-0.5", OFF_PATTERN)}
      style={{ top, height }}
      title={label}
    >
      {height >= 20 ? (
        <span className="block truncate text-[11px] text-zinc-700">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

type DayEntry =
  | { kind: "item"; sort: number; item: PlanningItemVM }
  | { kind: "off"; sort: number; segment: TimeOffSegmentVM };

function MobileDay({
  day,
  todayKey,
  items,
  segments,
  onOpen,
}: {
  day: DateKey;
  todayKey: DateKey;
  items: PlanningItemVM[];
  segments: TimeOffSegmentVM[];
  onOpen: (id: string) => void;
}) {
  const entries: DayEntry[] = [
    ...segments.map((segment): DayEntry => ({ kind: "off", sort: segment.startMinute, segment })),
    ...items.map((item): DayEntry => ({ kind: "item", sort: item.startMinute, item })),
  ].sort((a, b) => a.sort - b.sort);

  if (entries.length === 0) {
    // The creation form reads a clicked cell only as a pair (?date + ?minute) and ignores a past day:
    // a future day opens at 10:00, today at the next full hour (no parameter), a past day has no button.
    const newEventHref = day === todayKey ? "/dashboard/events/new" : `/dashboard/events/new?date=${day}&minute=600`;
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">Rien de prévu ce jour-là.</p>
        {day >= todayKey && (
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href={newEventHref}>
              <Plus />
              Nouvel événement ce jour
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul className="grid gap-2">
      {entries.map((entry) => {
        if (entry.kind === "off") {
          const s = entry.segment;
          return (
            <li
              key={`off-${s.id}-${s.dayKey}`}
              className={cn("rounded-xl border border-dashed border-border px-3 py-2.5", OFF_PATTERN)}
            >
              <p className="text-sm font-medium wrap-anywhere">{s.reason ?? "Indisponible"}</p>
              <p className="text-xs text-zinc-700 tabular-nums">
                {s.startMinute === 0 && s.endMinute === 1440 ? "Toute la journée" : `${hhmm(s.startMinute)} à ${hhmm(s.endMinute)}`}
              </p>
            </li>
          );
        }
        const item = entry.item;
        const cancelled = item.status === "cancelled";
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full items-stretch gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
            >
              <span aria-hidden="true" className="w-1 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {`${hhmm(item.startMinute)} à ${hhmm(item.endMinute)}`}
                </span>
                <span className={cn("truncate text-sm font-medium", cancelled && "line-through")}>{item.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {item.kind === "seance" ? seatsText(item) : (item.attendees[0]?.name ?? "")}
                </span>
              </span>
              {cancelled && (
                <Badge variant="destructive" className="self-start">
                  Annulée
                </Badge>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanningCalendar({
  tz,
  days,
  todayKey,
  title,
  startHour,
  endHour,
  items,
  timeOff,
  nav,
  openOccurrenceId,
  nowIso,
}: {
  tz: string;
  days: DateKey[];
  todayKey: DateKey;
  title: string;
  startHour: number;
  endHour: number;
  items: PlanningItemVM[];
  timeOff: TimeOffSegmentVM[];
  nav: { prev: DateKey; next: DateKey; today: DateKey };
  openOccurrenceId: string | null;
  nowIso: string;
}) {
  const router = useRouter();

  // A status line left by the dialog when its occurrence leaves the page data after an action (a cancelled
  // RDV is not read any more, so the dialog unmounts and cannot show the line itself). Opening a block, a new
  // deep link or another week clears it.
  const [notice, setNotice] = useState<string | null>(null);
  const [seenWeek, setSeenWeek] = useState<DateKey>(days[0]);
  if (days[0] !== seenWeek) {
    setSeenWeek(days[0]);
    setNotice(null);
  }

  // The dialog is held by id: after an action the page data is refreshed and the
  // dialog shows the fresh séance. A new deep link (?seance=) opens its dialog
  // even though this component instance is reused between two navigations.
  // An id that is not in the week shown (another week, an unknown deep link, an RDV that an action ended)
  // is dropped, so that coming back to a week with Back and Forward never reopens a dialog by itself.
  const [selectedId, setSelectedId] = useState<string | null>(openOccurrenceId);
  const [seenOpenId, setSeenOpenId] = useState<string | null>(openOccurrenceId);
  let currentId = selectedId;
  if (openOccurrenceId !== seenOpenId) {
    setSeenOpenId(openOccurrenceId);
    setNotice(null);
    currentId = openOccurrenceId;
  }
  if (currentId !== null && !items.some((i) => i.id === currentId)) currentId = null;
  if (currentId !== selectedId) setSelectedId(currentId);
  const selected = items.find((i) => i.id === currentId) ?? null;
  const openItem = (id: string) => {
    setNotice(null);
    setSelectedId(id);
  };
  // Only a string is a notice: whatever else a caller hands over is dropped.
  const closeDialog = (text?: string) => {
    setSelectedId(null);
    if (typeof text === "string" && text !== "") setNotice(text);
  };

  // « Maintenant »: the server instant on first render (no hydration gap), then each minute.
  const [nowMs, setNowMs] = useState(() => Date.parse(nowIso));
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowDay = dayKeyInTz(new Date(nowMs), tz);
  const nowMinutes = wallClockMinutes(new Date(nowMs), tz);
  const showNow = nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;

  // Mobile: the day shown. Today when it is in the week, else the first day, else the day of the deep-linked séance.
  const deepLinkDay = openOccurrenceId ? items.find((i) => i.id === openOccurrenceId)?.dayKey : undefined;
  const [pickedDay, setPickedDay] = useState<DateKey | null>(null);
  const defaultDay = deepLinkDay ?? (days.includes(todayKey) ? todayKey : days[0]);
  const activeDay = pickedDay !== null && days.includes(pickedDay) ? pickedDay : defaultDay;

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colHeight = hours.length * HOUR_PX;
  const itemsOf = (day: DateKey) => items.filter((i) => i.dayKey === day);
  const segmentsOf = (day: DateKey) => timeOff.filter((s) => s.dayKey === day);
  const empty = items.length === 0 && timeOff.length === 0;

  // Empty space of a column from today on: a new event at that day and half hour (the pro zone is applied on the server).
  const onColumnClick = (day: DateKey) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || day < todayKey) return;
    const offset = e.clientY - e.currentTarget.getBoundingClientRect().top;
    router.push(`/dashboard/events/new?date=${day}&minute=${minuteFromOffset(offset, startHour, HOUR_PX)}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/planning?semaine=${nav.prev}`} aria-label="Semaine précédente">
                <ChevronLeft />
              </Link>
            </Button>
            <p className="min-w-[13rem] text-center text-sm font-medium">{title}</p>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/planning?semaine=${nav.next}`} aria-label="Semaine suivante">
                <ChevronRight />
              </Link>
            </Button>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/dashboard/planning?semaine=${nav.today}`}>
              <CalendarDays />
              {"Aujourd'hui"}
            </Link>
          </Button>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/events/new">
            <Plus />
            Nouvel événement
          </Link>
        </Button>
      </div>

      <PlanningNotice notice={notice} />

      {empty && <p className="mb-3 text-sm text-muted-foreground">Aucune séance cette semaine.</p>}

      {/* ≥ 640 px: the week grid */}
      <div className="hidden overflow-x-auto sm:block">
        <div className="flex min-w-[640px]">
          <div className="w-12 shrink-0 pt-9">
            {hours.map((h) => (
              <div key={h} className="relative text-right text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
                <span className="absolute -top-1.5 right-1 tabular-nums">{hhmm(h * 60)}</span>
              </div>
            ))}
          </div>
          {days.map((day) => {
            const isToday = day === todayKey;
            const future = day >= todayKey;
            return (
              <div key={day} className={cn("relative min-w-0 flex-1 border-l border-border", isToday && "rounded-md ring-2 ring-inset ring-primary")}>
                <div
                  className={cn(
                    "flex h-9 items-center justify-center border-b border-border text-xs font-medium",
                    isToday && "font-semibold text-accent-foreground",
                  )}
                >
                  {dayShortLabel(day)}
                </div>
                <div
                  onClick={onColumnClick(day)}
                  className={cn("relative", future && "cursor-cell")}
                  style={{
                    height: colHeight,
                    backgroundImage: "linear-gradient(to bottom, transparent calc(100% - 1px), var(--color-border) calc(100% - 1px))",
                    backgroundSize: `100% ${HOUR_PX}px`,
                  }}
                >
                  {segmentsOf(day).map((s) => (
                    <OffBlock key={`${s.id}-${s.dayKey}`} segment={s} startHour={startHour} endHour={endHour} />
                  ))}
                  {itemsOf(day).map((item) => (
                    <ItemBlock key={item.id} item={item} tz={tz} startHour={startHour} onOpen={openItem} />
                  ))}
                  {day === nowDay && showNow && (
                    <div
                      className="pointer-events-none absolute inset-x-0 h-0.5 bg-destructive"
                      style={{ top: (nowMinutes - startHour * 60) * MINUTE_PX }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* < 640 px: day chips and the list of the chosen day */}
      <div className="sm:hidden">
        <div className="mb-3 grid grid-cols-7 gap-1" role="group" aria-label="Jours de la semaine">
          {days.map((day) => {
            const [weekday, num] = dayShortLabel(day).split(" ");
            const active = day === activeDay;
            const count = itemsOf(day).length;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setPickedDay(day)}
                aria-pressed={active}
                aria-current={day === todayKey ? "date" : undefined}
                aria-label={`${dayShortLabel(day)}, ${plural(count, "séance", "séances")}`}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl border px-0 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
                  !active && day === todayKey && "border-primary text-accent-foreground",
                )}
              >
                <span>{weekday}</span>
                <span className="text-sm tabular-nums">{num}</span>
                <span
                  aria-hidden="true"
                  className={cn("h-0.5 w-4 rounded-full", count > 0 ? (active ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")}
                />
              </button>
            );
          })}
        </div>
        <p className="mb-2 text-sm font-medium first-letter:uppercase">{dayLongLabel(activeDay)}</p>
        <MobileDay
          day={activeDay}
          todayKey={todayKey}
          items={itemsOf(activeDay)}
          segments={segmentsOf(activeDay)}
          onOpen={openItem}
        />
      </div>

      {selected && <OccurrenceDialog item={selected} tz={tz} nowIso={nowIso} onClose={closeDialog} />}
    </div>
  );
}
