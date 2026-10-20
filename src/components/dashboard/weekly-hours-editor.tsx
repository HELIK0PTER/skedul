"use client";

import { useState, type ReactNode } from "react";
import { Copy, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { mergeRangeIntoDays, replaceDaysWith } from "@/lib/availability-copy";
import { DAY_LABELS, DAY_ORDER } from "@/lib/back-office/week-hours";
import { cn } from "@/lib/utils";

export type Range = { start: string; end: string };
export type ByDay = Record<number, Range[]>;
export type Rule = { dayOfWeek: number; startMinute: number; endMinute: number };

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

/**
 * Day picker shown when duplicating/copying ranges. Owns only the day selection;
 * the parent decides what "apply" does with the chosen days.
 */
function CopyToDaysPopover({
  sourceDay,
  open,
  onOpenChange,
  onApply,
  trigger,
  align = "start",
}: {
  sourceDay: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (targetDays: number[]) => void;
  trigger: ReactNode;
  align?: "start" | "end";
}) {
  const days = DAY_ORDER.filter((d) => d !== sourceDay);
  const [selected, setSelected] = useState<number[]>([]);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts with no day selected (adjusted during render, not in an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected([]);
  }

  const allSelected = selected.length === days.length;

  function toggleDay(day: number) {
    setSelected((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      align={align}
    >
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
        Copier vers
      </p>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium hover:bg-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? [] : [...days])}
          className="size-4 accent-primary"
        />
        Tous les jours
      </label>
      <div className="my-1 h-px bg-border" />
      {days.map((day) => (
        <label
          key={day}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-muted"
        >
          <input
            type="checkbox"
            checked={selected.includes(day)}
            onChange={() => toggleDay(day)}
            className="size-4 accent-primary"
          />
          {DAY_LABELS[day]}
        </label>
      ))}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          Annuler
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={selected.length === 0}
          onClick={() => {
            onApply(selected);
            onOpenChange(false);
          }}
        >
          Appliquer
        </Button>
      </div>
    </Popover>
  );
}

type PopoverKey = { day: number; slot: number | "all" };

/** A time input a parent flagged (aria-invalid): the day, the range position from 0 and which of the two. */
export type InvalidTime = { day: number; index: number; field: "start" | "end" };

/** Presentational weekly schedule grid. Owns no persistence. */
export function WeeklyHoursEditor({
  value,
  onChange,
  invalid = null,
}: {
  value: ByDay;
  onChange: (next: ByDay) => void;
  invalid?: InvalidTime | null;
}) {
  const [openPopover, setOpenPopover] = useState<PopoverKey | null>(null);

  const isOpen = (day: number, slot: number | "all") =>
    openPopover?.day === day && openPopover?.slot === slot;
  const setOpen = (day: number, slot: number | "all", open: boolean) =>
    setOpenPopover(open ? { day, slot } : null);
  const toggleOpen = (day: number, slot: number | "all") =>
    setOpen(day, slot, !isOpen(day, slot));

  function update(day: number, ranges: Range[]) {
    onChange({ ...value, [day]: ranges });
  }

  const isInvalid = (day: number, index: number, field: "start" | "end") =>
    invalid !== null && invalid.day === day && invalid.index === index && invalid.field === field;

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
                role="switch"
                aria-checked={enabled}
                onClick={() =>
                  update(day, enabled ? [] : [{ start: "09:00", end: "17:00" }])
                }
                className={cn(
                  "flex w-32 shrink-0 items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                    enabled ? "bg-primary" : "bg-muted-foreground",
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
                      aria-label={`${DAY_LABELS[day]}, plage ${i + 1}, début`}
                      aria-invalid={isInvalid(day, i, "start") || undefined}
                      value={r.start}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, start: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30"
                    />
                    <span className="text-muted-foreground">à</span>
                    <input
                      type="time"
                      aria-label={`${DAY_LABELS[day]}, plage ${i + 1}, fin`}
                      aria-invalid={isInvalid(day, i, "end") || undefined}
                      value={r.end}
                      onChange={(e) => {
                        const next = [...ranges];
                        next[i] = { ...r, end: e.target.value };
                        update(day, next);
                      }}
                      className="h-9 rounded-lg border border-input bg-card px-2 text-sm aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30"
                    />
                    <CopyToDaysPopover
                      sourceDay={day}
                      open={isOpen(day, i)}
                      onOpenChange={(open) => setOpen(day, i, open)}
                      onApply={(targetDays) =>
                        onChange(mergeRangeIntoDays(value, r, targetDays))
                      }
                      trigger={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Dupliquer ce créneau vers d'autres jours"
                          aria-label={`Copier la plage ${i + 1} du ${DAY_LABELS[day].toLowerCase()} vers d'autres jours`}
                          onClick={() => toggleOpen(day, i)}
                        >
                          <Copy className="size-4" />
                        </Button>
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Supprimer ce créneau"
                      aria-label={`Supprimer la plage ${i + 1} du ${DAY_LABELS[day].toLowerCase()}`}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Ajouter une plage le ${DAY_LABELS[day].toLowerCase()}`}
                      onClick={() =>
                        update(day, [
                          ...ranges,
                          { start: "09:00", end: "17:00" },
                        ])
                      }
                    >
                      <Plus className="size-4" />
                      Ajouter une plage
                    </Button>
                    <CopyToDaysPopover
                      sourceDay={day}
                      open={isOpen(day, "all")}
                      onOpenChange={(open) => setOpen(day, "all", open)}
                      onApply={(targetDays) =>
                        onChange(replaceDaysWith(value, ranges, targetDays))
                      }
                      align="end"
                      trigger={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Copier tous les créneaux de ce jour vers d'autres jours"
                          onClick={() => toggleOpen(day, "all")}
                        >
                          <Copy className="size-4" />
                          Tout copier
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
