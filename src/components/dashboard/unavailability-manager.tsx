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

  const marked = useMemo(() => new Set(markedDays), [markedDays]);

  const grid = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  function pickDay(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    setStartDate(key);
    // keep the range coherent: bump endDate if it's now before startDate
    setEndDate((prev) => (prev < key ? key : prev));
    setError(null);
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

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {grid.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, viewMonth);
              const past = isBefore(day, today);
              const isMarked = marked.has(key);
              const selected = key === startDate;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={past}
                  onClick={() => pickDay(day)}
                  className={cn(
                    "aspect-square rounded-lg text-sm transition-colors",
                    !inMonth && "text-muted-foreground/40",
                    past && "cursor-not-allowed opacity-40",
                    isMarked && "bg-primary text-primary-foreground",
                    !isMarked && !past && "hover:bg-muted",
                    selected && !isMarked && "ring-2 ring-primary",
                  )}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block size-3 rounded bg-primary" />
            Jour avec indisponibilité
          </p>
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
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setEndDate((prev) =>
                      prev < e.target.value ? e.target.value : prev,
                    );
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
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAllDay((v) => !v)}
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
