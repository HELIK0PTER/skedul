"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";

import { createTimeOff, deleteTimeOff } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export interface TimeOffEntry {
  id: string;
  label: string;
  allDay: boolean;
  reason: string | null;
}

export function UnavailabilityManager({
  markedDays,
  entries,
}: {
  markedDays: string[];
  entries: TimeOffEntry[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));

  const [startDate, setStartDate] = useState(format(today, "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(today, "yyyy-MM-dd"));
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  // which bound the next calendar click sets; "end" right after a start is picked
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const marked = useMemo(() => new Set(markedDays), [markedDays]);

  const grid = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const choosingEnd = allDay && picking === "end";
  // while choosing the end, hovering a later day previews the range
  const previewing = choosingEnd && hoverKey !== null && hoverKey >= startDate;
  const shownEnd = previewing ? hoverKey : allDay ? endDate : startDate;

  function pickDay(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    setError(null);
    if (!allDay) {
      setStartDate(key);
      setEndDate(key);
      return;
    }
    if (picking === "end" && key >= startDate) {
      setEndDate(key);
      setPicking("start");
      return;
    }
    // first click, or a day before the current start: the range restarts there
    setStartDate(key);
    setEndDate(key);
    setPicking("end");
  }

  function showMonthOf(key: string) {
    if (key) setViewMonth(startOfMonth(parseISO(key)));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTimeOff({
        startDate,
        endDate: allDay ? endDate : startDate,
        allDay,
        startMinute: allDay ? undefined : toMinutes(startTime),
        endMinute: allDay ? undefined : toMinutes(endTime),
        reason: reason || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReason("");
      setPicking("start");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteTimeOff(id);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Calendar */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-semibold capitalize">
              {format(viewMonth, "LLLL yyyy", { locale: fr })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <p className="mb-2 text-center text-xs text-muted-foreground" aria-live="polite">
            {!allDay
              ? "Choisissez le jour."
              : picking === "start"
                ? "Choisissez le premier jour."
                : "Choisissez le dernier jour, ou le même pour une seule journée."}
          </p>

          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div
            className="mt-1 grid grid-cols-7 gap-y-1"
            onMouseLeave={() => setHoverKey(null)}
          >
            {grid.map((day, i) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, viewMonth);
              const past = isBefore(day, today);
              const isMarked = marked.has(key);
              const isStart = key === startDate;
              const isEnd = key === shownEnd;
              const inBand =
                shownEnd > startDate && key >= startDate && key <= shownEnd;
              const solid = isStart || (isEnd && !previewing);
              const col = i % 7;
              return (
                <div key={key} className="relative">
                  {/* range band; half-width on the bounds so it tucks under them */}
                  {inBand && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 bg-primary-muted",
                        isStart ? "left-1/2" : "left-0",
                        isEnd ? "right-1/2" : "right-0",
                        col === 0 && "rounded-l-lg",
                        col === 6 && "rounded-r-lg",
                      )}
                    />
                  )}
                  <button
                    type="button"
                    disabled={past}
                    onClick={() => pickDay(day)}
                    onMouseEnter={() => setHoverKey(key)}
                    aria-label={`${format(day, "EEEE d MMMM yyyy", { locale: fr })}${
                      isMarked ? " (indisponibilité existante)" : ""
                    }`}
                    aria-pressed={isStart || isEnd}
                    className={cn(
                      "relative flex aspect-square w-full items-center justify-center rounded-lg text-sm transition-colors",
                      !inMonth && "text-muted-foreground/40",
                      past && "cursor-not-allowed opacity-40",
                      inBand && !solid && "text-accent-foreground",
                      !solid &&
                        !past &&
                        (inBand ? "hover:bg-primary/15" : "hover:bg-muted"),
                      solid && "bg-primary font-medium text-primary-foreground",
                      isEnd &&
                        previewing &&
                        !isStart &&
                        "ring-2 ring-inset ring-primary",
                    )}
                  >
                    {format(day, "d")}
                    {isMarked && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full",
                          solid ? "bg-primary-foreground" : "bg-primary",
                        )}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded bg-primary" />
              Période sélectionnée
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-flex size-3 items-center justify-center">
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
              Indisponibilité existante
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Add form + list */}
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">Ajouter une indisponibilité</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start">Du</Label>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onFocus={() => setPicking("start")}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartDate(v);
                    setEndDate((prev) => (prev < v ? v : prev));
                    showMonthOf(v);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">Au</Label>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  disabled={!allDay}
                  onFocus={() => setPicking("end")}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    showMonthOf(e.target.value);
                  }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setAllDay((v) => !v);
                setPicking("start");
              }}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <span
                className={cn(
                  "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                  allDay ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "size-4 rounded-full bg-white shadow transition-transform",
                    allDay && "translate-x-4",
                  )}
                />
              </span>
              Toute la journée
            </button>

            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="stime">Début</Label>
                  <Input
                    id="stime"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="etime">Fin</Label>
                  <Input
                    id="etime"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Motif (optionnel)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Congés, rendez-vous…"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button onClick={submit} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Ajouter
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">À venir</h2>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune indisponibilité programmée.
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium capitalize">
                        {e.label}
                      </p>
                      {e.reason && (
                        <p className="truncate text-xs text-muted-foreground">
                          {e.reason}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => remove(e.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
