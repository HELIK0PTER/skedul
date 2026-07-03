# Public Booking Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal day-pill strip on the public booking page with a month-grid calendar where days with availability show a blue dot, and clicking one reveals that day's slots.

**Architecture:** A new pure-logic module (`src/lib/calendar-grid.ts`) computes month-grid cells (date-fns based, no timezone conversion — pure calendar-day arithmetic). A new client component (`src/components/public/day-calendar.tsx`) renders that grid with prev/next month navigation and highlights/disables cells based on an `availableDays` set. `BookingFlow` swaps its pill strip for this component; all existing slot-selection state and logic are untouched.

**Tech Stack:** Next.js 16 App Router, React (client component), `date-fns` + `date-fns/locale` (already a dependency), Tailwind v4 (existing bespoke UI classes), Node's built-in test runner (`node:test`, run via `tsx --test`).

## Global Constraints

- `pnpm typecheck` and `pnpm build` must stay green (per project AGENTS.md).
- No server-side changes: `loadBookableSlots`, `groupSlotsByDay`, and the `days` prop shape passed into `BookingFlow` stay exactly as they are today.
- No new dependencies — use `date-fns`/`date-fns/locale`, already installed.
- Day availability must be derived from the server-computed `dayKey` string (`YYYY-MM-DD`, already timezone-correct per `dayKeyInTz`) — never from parsing `new Date(iso)` with browser-local calendar math, to avoid off-by-one-day bugs when the visitor's browser timezone differs from the professional's timezone.
- Follow existing code conventions: pure logic in `src/lib/*.ts` with colocated `*.test.ts` (see `src/lib/color.test.ts` for the exact `node:test`/`node:assert/strict` pattern), UI components use the existing `cn()` helper and Tailwind classes already used in `booking-flow.tsx` (e.g. `border-primary bg-accent text-accent-foreground` for selected state).
- No automated tests for the visual calendar component itself — verify manually in the browser (dev server) per the design spec's "Hors périmètre" section. Only the pure grid-computation helpers get unit tests.

---

### Task 1: Pure month-grid helper functions

**Files:**
- Create: `src/lib/calendar-grid.ts`
- Test: `src/lib/calendar-grid.test.ts`

**Interfaces:**
- Produces:
  - `toDayKey(date: Date): string` — formats a local `Date` as `"yyyy-MM-dd"`.
  - `parseDayKey(key: string): Date` — parses a `"yyyy-MM-dd"` string into a local `Date` at midnight (inverse of `toDayKey`).
  - `getMonthGridDays(viewMonth: Date): Date[]` — returns a flat array of `Date`s covering full weeks (Monday-start) spanning the month of `viewMonth`, including the leading/trailing days of adjacent months needed to fill the grid.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/calendar-grid.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { getMonthGridDays, parseDayKey, toDayKey } from "./calendar-grid";

test("toDayKey: formats a local date as yyyy-MM-dd", () => {
  assert.equal(toDayKey(new Date(2026, 6, 3)), "2026-07-03"); // month is 0-indexed (June=5, July=6)
});

test("toDayKey: pads single-digit month and day", () => {
  assert.equal(toDayKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("parseDayKey: round-trips with toDayKey", () => {
  const key = "2026-07-28";
  assert.equal(toDayKey(parseDayKey(key)), key);
});

test("getMonthGridDays: starts on a Monday and ends on a Sunday", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1)); // July 2026
  assert.equal(days[0].getDay(), 1); // Monday
  assert.equal(days[days.length - 1].getDay(), 0); // Sunday
});

test("getMonthGridDays: length is a multiple of 7", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1));
  assert.equal(days.length % 7, 0);
});

test("getMonthGridDays: includes every day of the target month", () => {
  const days = getMonthGridDays(new Date(2026, 6, 1)); // July 2026 has 31 days
  const julyDays = days.filter((d) => d.getMonth() === 6 && d.getFullYear() === 2026);
  assert.equal(julyDays.length, 31);
  assert.equal(toDayKey(julyDays[0]), "2026-07-01");
  assert.equal(toDayKey(julyDays[julyDays.length - 1]), "2026-07-31");
});

test("getMonthGridDays: February in a leap year", () => {
  const days = getMonthGridDays(new Date(2028, 1, 15)); // Feb 2028, leap year
  const febDays = days.filter((d) => d.getMonth() === 1 && d.getFullYear() === 2028);
  assert.equal(febDays.length, 29);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './calendar-grid'` (or similar) since `calendar-grid.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/calendar-grid.ts
import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Formats a local Date as "yyyy-MM-dd" (no timezone conversion — reads local Y/M/D fields). */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses a "yyyy-MM-dd" string into a local Date at midnight. Inverse of toDayKey. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns every Date needed to render a Monday-start month grid for `viewMonth`,
 * including the leading/trailing days of adjacent months that fill out full weeks.
 */
export function getMonthGridDays(viewMonth: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all `calendar-grid.test.ts` tests green (other existing `*.test.ts` files unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-grid.ts src/lib/calendar-grid.test.ts
git commit -m "feat(calendar): pure month-grid helpers for the public booking calendar"
```

---

### Task 2: `DayCalendar` component

**Files:**
- Create: `src/components/public/day-calendar.tsx`

**Interfaces:**
- Consumes: `toDayKey`, `parseDayKey`, `getMonthGridDays` from `src/lib/calendar-grid.ts` (Task 1).
- Produces:
  ```ts
  interface DayCalendarProps {
    availableKeys: string[]; // "yyyy-MM-dd" dayKeys with at least one open slot
    selectedKey: string | null;
    onSelect: (key: string) => void;
  }
  export function DayCalendar(props: DayCalendarProps): JSX.Element;
  ```
  Consumed by `BookingFlow` in Task 3.

- [ ] **Step 1: Write the component**

```tsx
// src/components/public/day-calendar.tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors referencing `day-calendar.tsx` (the component isn't wired up yet, so this only checks it compiles standalone — Task 3 wires it in and re-typechecks the whole app).

- [ ] **Step 3: Commit**

```bash
git add src/components/public/day-calendar.tsx
git commit -m "feat(calendar): add DayCalendar month-grid component"
```

---

### Task 3: Wire `DayCalendar` into `BookingFlow`

**Files:**
- Modify: `src/components/public/booking-flow.tsx:1-13` (imports), `:42-51` (state derivations), `:133-152` (pill strip block)

**Interfaces:**
- Consumes: `DayCalendar` from `src/components/public/day-calendar.tsx` (Task 2).

- [ ] **Step 1: Add the import**

In `src/components/public/booking-flow.tsx`, add alongside the other local imports (after the `formatMoney`/`cn` import block, around line 12-13):

```tsx
import { DayCalendar } from "@/components/public/day-calendar";
```

- [ ] **Step 2: Derive `availableKeys` from the existing `days` prop**

In the component body, right after the existing `const day = days.find((d) => d.key === selectedDay);` line (around line 51), add:

```tsx
const availableKeys = days.map((d) => d.key);
```

- [ ] **Step 3: Replace the pill-strip block with `DayCalendar`**

Replace this existing block (lines ~133-152):

```tsx
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  setSelectedDay(d.key);
                  setSelectedIso(null);
                }}
                className={cn(
                  "shrink-0 rounded-xl border px-3 py-2 text-sm capitalize transition-colors",
                  selectedDay === d.key
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
```

with:

```tsx
          <DayCalendar
            availableKeys={availableKeys}
            selectedKey={selectedDay}
            onSelect={(key) => {
              setSelectedDay(key);
              setSelectedIso(null);
            }}
          />
```

- [ ] **Step 4: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed with no errors. Note: `d.label` (per-day formatted label, e.g. "Lundi 6 juillet") is no longer read anywhere in `booking-flow.tsx` after this change — this is fine, it's still produced by `page.tsx`'s `days` mapping and may be used elsewhere or simply becomes unused on this prop; do not remove it from `page.tsx`, it's out of scope for this task (server-side `days` shape is a global constraint, see header).

- [ ] **Step 5: Commit**

```bash
git add src/components/public/booking-flow.tsx
git commit -m "feat(calendar): swap day-pill strip for month-grid calendar in BookingFlow"
```

---

### Task 4: Manual verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Use the preview tool to start the `dev` server (per `.claude/launch.json` / `pnpm dev`), then navigate to `/altinha-paris` (demo pro) and open a bookable event type's `/book/[eventTypeId]` page.

- [ ] **Step 2: Verify the calendar renders correctly**

Check, via screenshot/snapshot:
- A month grid is visible with weekday headers (L M M J V S D).
- The month shown is the month of the first available day (not necessarily the current calendar month).
- Days with availability show a small blue dot; days without do not, and are visually greyed out / disabled.
- The first available day is pre-selected (highlighted) and its slots are already shown below the calendar, matching current behavior before this change.

- [ ] **Step 3: Verify interaction**

- Click a different day that has a blue dot: confirm the slot grid below updates to that day's slots, and the previously selected slot (`selectedIso`) is cleared (matches existing `setSelectedIso(null)` behavior).
- Click the "next month" arrow: confirm the grid advances a month and (if that month has no available days) shows an all-grey grid with no dots, but still lets you navigate back.
- Click the "previous month" arrow enough times to reach the current/starting month again: confirm the previously available days and dots reappear correctly.
- Attempt to click a greyed-out (unavailable) day: confirm nothing happens (button is disabled, no selection change).

- [ ] **Step 4: Check console for errors**

Use the preview console-log tool to confirm no runtime errors or warnings were introduced.

- [ ] **Step 5: Report result**

If any step fails, fix the root cause in the relevant task's file before proceeding — do not mark this task done with a failing check.

---
