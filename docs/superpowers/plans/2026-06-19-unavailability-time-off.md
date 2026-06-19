# Indisponibilités (time-off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pro mark one-off unavailabilities (full-day ranges or single-day time ranges) from the back-office, which removes the matching slots from the public booking page.

**Architecture:** A new `timeOff` table stores `[startAt, endAt)` instant intervals per pro. The existing slot engine already subtracts a `busy[]` array in `loadBookableSlots`; we add the pro's future time-off rows to that array, so blocking applies both at display and at booking time (the booking guard `isSlotAvailable` uses the same path) with no change to `computeSlots`. A new `/dashboard/unavailability` page renders a month calendar + add-form + list.

**Tech Stack:** Next.js 16 (App Router, async params), Drizzle + Neon HTTP, `@date-fns/tz`, `date-fns` (v4) for the client calendar grid, bespoke Tailwind v4 UI primitives, `node:test` via `tsx` for pure-logic tests.

## Global Constraints

- **Next.js 16**: `params`/`searchParams` are async (`await params`). (Not directly hit here, but keep the convention.)
- **Server Actions**: live in `src/server/*.ts` with `"use server"`; pro back-office = `pro.ts`. Read-only queries in `queries.ts` (`import "server-only"`).
- **DB**: Drizzle + Neon HTTP driver — **no interactive transactions**.
- **Time**: wall-clock minutes-from-midnight in the pro's timezone (`pro.timezone`); convert to instants with `instantFromWallClock`.
- **Money/UI**: reuse bespoke primitives in `src/components/ui/` (`Button`, `Card`, `Input`, `Label`) and `cn`.
- **Action result shape** (mirror `public.ts`): `{ ok: true } | { ok: false; error: string }`.
- **Green gates**: `pnpm typecheck` and `pnpm build` must stay green.
- **Schema change workflow**: `pnpm db:generate` then `pnpm db:migrate` (targets `DATABASE_URL`, dev→Neon `development` branch).
- **Testing note**: the repo has **no test framework**. Pure logic (`src/lib/timeoff.ts`) is tested with Node's built-in runner via `tsx` (`npx tsx --test <file>`). DB/UI tasks are gated on `pnpm typecheck` / `pnpm build` (+ manual check for UI). `tsx` resolves the `@/*` tsconfig path alias.

---

## File Structure

- **Modify** `src/lib/db/schema.ts` — add `timeOff` table + relations.
- **Create** `drizzle/<generated>.sql` — via `pnpm db:generate` (do not hand-write).
- **Create** `src/lib/timeoff.ts` — pure helpers `buildTimeOffInterval`, `coveredDayKeys`.
- **Create** `src/lib/timeoff.test.ts` — tests for the pure helpers.
- **Modify** `src/lib/slots.ts` — merge future `timeOff` rows into `busy[]`.
- **Modify** `src/server/queries.ts` — add `getProTimeOff`.
- **Modify** `src/server/pro.ts` — add `createTimeOff`, `deleteTimeOff`.
- **Create** `src/app/dashboard/unavailability/page.tsx` — server page.
- **Create** `src/components/dashboard/unavailability-manager.tsx` — client UI (calendar + form + list).
- **Modify** `src/components/dashboard/sidebar.tsx` — add nav entry.
- **Modify** `package.json` — add a `test` script (convenience).

---

## Task 1: `timeOff` schema + migration

**Files:**
- Modify: `src/lib/db/schema.ts` (add table after the `booking` table ~line 283; add relations after `bookingRelations` ~line 363; add `timeOff` to `professionalRelations` ~lines 294-301)
- Create: `drizzle/<generated>.sql` (via `db:generate`)

**Interfaces:**
- Produces: Drizzle table `timeOff` with columns `id, professionalId, startAt: Date, endAt: Date, allDay: boolean, reason: string|null, createdAt, updatedAt`.

- [ ] **Step 1: Add the `timeOff` table** in `src/lib/db/schema.ts`, immediately after the `booking` table definition (after line 283, before the Relations comment block):

```ts
/** A one-off block of unavailability (time off) for a professional. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    // instant range; endAt is an EXCLUSIVE bound
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").default(true).notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [index("time_off_pro_idx").on(t.professionalId, t.startAt)],
);
```

- [ ] **Step 2: Register the relation** — in `professionalRelations` (the `many(...)` block, ~lines 294-301) add a line alongside `bookings: many(booking),`:

```ts
  timeOff: many(timeOff),
```

- [ ] **Step 3: Add `timeOffRelations`** after `bookingRelations` (end of file):

```ts
export const timeOffRelations = relations(timeOff, ({ one }) => ({
  professional: one(professional, {
    fields: [timeOff.professionalId],
    references: [professional.id],
  }),
}));
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `drizzle/` creating table `time_off` with the index. Inspect the SQL — it should `CREATE TABLE "time_off"` with a FK to `professional(id) ON DELETE cascade` and `CREATE INDEX "time_off_pro_idx"`.

- [ ] **Step 5: Apply the migration** (requires `DATABASE_URL` reachable; targets the dev Neon branch)

Run: `pnpm db:migrate`
Expected: migration applies cleanly. If `DATABASE_URL` is not configured in this environment, skip this step — the committed migration file is enough for later environments; `typecheck`/`build` do not need the DB.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): time_off table for pro unavailability"
```

---

## Task 2: Pure interval helpers + tests (TDD)

**Files:**
- Create: `src/lib/timeoff.ts`
- Create: `src/lib/timeoff.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: `instantFromWallClock`, `dayKeyInTz` from `@/lib/datetime`.
- Produces:
  - `interface TimeOffInput { startDate: string; endDate: string; allDay: boolean; startMinute?: number; endMinute?: number }`
  - `interface TimeOffInterval { startAt: Date; endAt: Date }`
  - `buildTimeOffInterval(input: TimeOffInput, tz: string): TimeOffInterval` (throws `Error` on invalid input)
  - `coveredDayKeys(startAt: Date, endAt: Date, tz: string): string[]` (YYYY-MM-DD keys in `tz`)

- [ ] **Step 1: Add the `test` script** to `package.json` `scripts` (after `"db:seed"`):

```json
    "test": "tsx --test"
```

- [ ] **Step 2: Write the failing test** `src/lib/timeoff.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildTimeOffInterval, coveredDayKeys } from "./timeoff.ts";

const TZ = "Europe/Paris"; // UTC+2 in July

test("all-day single day → [00:00, next 00:00)", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-03", allDay: true },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-02T22:00:00.000Z");
  assert.equal(endAt.toISOString(), "2026-07-03T22:00:00.000Z");
});

test("all-day multi day → exclusive end is midnight after last day", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-05", allDay: true },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-02T22:00:00.000Z");
  // exclusive end = 2026-07-06 00:00 Paris = 2026-07-05 22:00 UTC
  assert.equal(endAt.toISOString(), "2026-07-05T22:00:00.000Z");
});

test("timed single day → wall-clock minutes mapped to instants", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    {
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      allDay: false,
      startMinute: 840, // 14:00
      endMinute: 960, // 16:00
    },
    TZ,
  );
  assert.equal(startAt.toISOString(), "2026-07-03T12:00:00.000Z");
  assert.equal(endAt.toISOString(), "2026-07-03T14:00:00.000Z");
});

test("timed range across two days is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      {
        startDate: "2026-07-03",
        endDate: "2026-07-04",
        allDay: false,
        startMinute: 840,
        endMinute: 960,
      },
      TZ,
    ),
  );
});

test("timed range with end <= start is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      {
        startDate: "2026-07-03",
        endDate: "2026-07-03",
        allDay: false,
        startMinute: 960,
        endMinute: 840,
      },
      TZ,
    ),
  );
});

test("all-day endDate before startDate is rejected", () => {
  assert.throws(() =>
    buildTimeOffInterval(
      { startDate: "2026-07-05", endDate: "2026-07-03", allDay: true },
      TZ,
    ),
  );
});

test("coveredDayKeys lists each local day in an all-day range", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    { startDate: "2026-07-03", endDate: "2026-07-05", allDay: true },
    TZ,
  );
  assert.deepEqual(coveredDayKeys(startAt, endAt, TZ), [
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
  ]);
});

test("coveredDayKeys lists a single day for a timed range", () => {
  const { startAt, endAt } = buildTimeOffInterval(
    {
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      allDay: false,
      startMinute: 840,
      endMinute: 960,
    },
    TZ,
  );
  assert.deepEqual(coveredDayKeys(startAt, endAt, TZ), ["2026-07-03"]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/lib/timeoff.test.ts`
Expected: FAIL — cannot resolve `./timeoff.ts` / `buildTimeOffInterval is not a function`.

- [ ] **Step 4: Implement** `src/lib/timeoff.ts`:

```ts
import { dayKeyInTz, instantFromWallClock } from "@/lib/datetime";

export interface TimeOffInput {
  /** YYYY-MM-DD, interpreted in the pro's timezone */
  startDate: string;
  /** YYYY-MM-DD, interpreted in the pro's timezone */
  endDate: string;
  allDay: boolean;
  /** minutes from midnight; required when !allDay */
  startMinute?: number;
  /** minutes from midnight; required when !allDay */
  endMinute?: number;
}

export interface TimeOffInterval {
  startAt: Date;
  endAt: Date;
}

/** Next calendar day (UTC math, rollover-safe) for a Y/M/D triple. */
function nextDay(y: number, m1: number, d: number) {
  const dt = new Date(Date.UTC(y, m1 - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Maps a back-office time-off form input to a continuous instant interval
 * `[startAt, endAt)` in `tz`. Throws on invalid input.
 */
export function buildTimeOffInterval(
  input: TimeOffInput,
  tz: string,
): TimeOffInterval {
  const [sy, sm, sd] = input.startDate.split("-").map(Number);
  const [ey, em, ed] = input.endDate.split("-").map(Number);

  if (input.allDay) {
    const startAt = instantFromWallClock(sy, sm, sd, 0, tz);
    const end = nextDay(ey, em, ed); // exclusive bound = day after last day
    const endAt = instantFromWallClock(end.y, end.m, end.d, 0, tz);
    if (endAt.getTime() <= startAt.getTime()) {
      throw new Error("La date de fin doit être après la date de début.");
    }
    return { startAt, endAt };
  }

  if (input.startDate !== input.endDate) {
    throw new Error("Une plage horaire doit tenir sur une seule journée.");
  }
  const startMin = input.startMinute ?? 0;
  const endMin = input.endMinute ?? 0;
  if (endMin <= startMin) {
    throw new Error("L'heure de fin doit être après l'heure de début.");
  }
  return {
    startAt: instantFromWallClock(sy, sm, sd, startMin, tz),
    endAt: instantFromWallClock(sy, sm, sd, endMin, tz),
  };
}

/** The distinct local-day keys (YYYY-MM-DD in `tz`) an interval spans. */
export function coveredDayKeys(
  startAt: Date,
  endAt: Date,
  tz: string,
): string[] {
  const keys: string[] = [];
  let cursor = startAt.getTime();
  const end = endAt.getTime();
  let guard = 0; // backstop against pathological ranges
  while (cursor < end && guard < 400) {
    const key = dayKeyInTz(new Date(cursor), tz);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor += 86_400_000;
    guard++;
  }
  return keys;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test src/lib/timeoff.test.ts`
Expected: PASS — all 8 tests pass (`# pass 8`).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/timeoff.ts src/lib/timeoff.test.ts package.json
git commit -m "feat(lib): time-off interval + covered-days helpers"
```

---

## Task 3: Subtract time-off from bookable slots

**Files:**
- Modify: `src/lib/slots.ts` (imports; the `Promise.all` at lines 23-42; the `computeSlots` call)
- Create: `src/lib/availability.test.ts` (regression test for the blocking behavior — pure `computeSlots`)

**Interfaces:**
- Consumes: Drizzle `timeOff` table (Task 1); `computeSlots` `busy: BusyInterval[]` (existing).
- Produces: no new exports; `loadBookableSlots` now excludes time-off intervals.

- [ ] **Step 1: Write the failing regression test** `src/lib/availability.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { computeSlots } from "./availability.ts";

const TZ = "Europe/Paris";
// Fixed "now": Wed 2026-07-01 06:00 UTC (08:00 Paris)
const NOW = new Date("2026-07-01T06:00:00.000Z");

const rules = [
  { dayOfWeek: 5, startMinute: 540, endMinute: 660 }, // Friday 09:00–11:00
];

test("an all-day time-off interval removes that day's slots", () => {
  // Friday 2026-07-03 all day, in Paris (UTC+2)
  const busy = [
    {
      startAt: new Date("2026-07-02T22:00:00.000Z"),
      endAt: new Date("2026-07-03T22:00:00.000Z"),
    },
  ];
  const slots = computeSlots({
    rules,
    busy,
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
  });
  const onFriday = slots.filter(
    (s) => s.start >= busy[0].startAt && s.start < busy[0].endAt,
  );
  assert.equal(onFriday.length, 0);
});

test("without time-off, the Friday slots exist", () => {
  const slots = computeSlots({
    rules,
    busy: [],
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
  });
  // Friday 2026-07-03 should yield 09:00 and 10:00 starts
  const fri = slots.filter(
    (s) =>
      s.start >= new Date("2026-07-02T22:00:00.000Z") &&
      s.start < new Date("2026-07-03T22:00:00.000Z"),
  );
  assert.equal(fri.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it passes** (this exercises existing `computeSlots` — it should already pass, locking in the behavior the plumbing relies on)

Run: `npx tsx --test src/lib/availability.test.ts`
Expected: PASS — `# pass 2`. (If it fails, stop: the overlap assumption is wrong and Task 3 plumbing won't block correctly.)

- [ ] **Step 3: Update imports** in `src/lib/slots.ts` (line 5) to include `timeOff`:

```ts
import { availabilityRule, booking, timeOff } from "@/lib/db/schema";
```

- [ ] **Step 4: Add the time-off query and merge it into `busy`.** Replace the `Promise.all` destructuring + `computeSlots` call (lines 23-53) so it fetches three things and concatenates:

```ts
  const [rules, busyBookings, busyTimeOff] = await Promise.all([
    db
      .select({
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(eq(availabilityRule.professionalId, professionalId)),
    db
      .select({ startAt: booking.startAt, endAt: booking.endAt })
      .from(booking)
      .where(
        and(
          eq(booking.professionalId, professionalId),
          gte(booking.startAt, now),
          inArray(booking.status, ["pending", "confirmed"]),
        ),
      ),
    db
      .select({ startAt: timeOff.startAt, endAt: timeOff.endAt })
      .from(timeOff)
      .where(
        and(
          eq(timeOff.professionalId, professionalId),
          gte(timeOff.endAt, now),
        ),
      ),
  ]);

  return computeSlots({
    rules,
    busy: [...busyBookings, ...busyTimeOff],
    durationMinutes: evt.durationMinutes,
    bufferBeforeMinutes: evt.bufferBeforeMinutes,
    bufferAfterMinutes: evt.bufferAfterMinutes,
    timezone,
    daysAhead,
    now,
  });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/slots.ts src/lib/availability.test.ts
git commit -m "feat(booking): exclude time-off intervals from bookable slots"
```

---

## Task 4: Server query + actions

**Files:**
- Modify: `src/server/queries.ts` (import; add `getProTimeOff`)
- Modify: `src/server/pro.ts` (imports; add `createTimeOff`, `deleteTimeOff`)

**Interfaces:**
- Consumes: `timeOff` table; `buildTimeOffInterval` from `@/lib/timeoff`; `requirePro()` (existing in `pro.ts`).
- Produces:
  - `getProTimeOff(proId: string)` → rows `{ id, professionalId, startAt, endAt, allDay, reason, createdAt, updatedAt }` with `endAt >= now`, ordered by `startAt asc`.
  - `createTimeOff(input): Promise<{ ok: true } | { ok: false; error: string }>`
  - `deleteTimeOff(id: string): Promise<void>`

- [ ] **Step 1: Add the query import** in `src/server/queries.ts` — add `timeOff` to the schema import list (lines 5-13):

```ts
import {
  availabilityRule,
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  professional,
  timeOff,
} from "@/lib/db/schema";
```

- [ ] **Step 2: Add `getProTimeOff`** to `src/server/queries.ts` (after `getProAvailability`, ~line 104). `and`, `asc`, `gte` are already imported (line 2):

```ts
export function getProTimeOff(proId: string) {
  return db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.professionalId, proId), gte(timeOff.endAt, new Date())))
    .orderBy(asc(timeOff.startAt));
}
```

- [ ] **Step 3: Add imports** in `src/server/pro.ts` — add `timeOff` to the schema import (lines 8-14) and import the helper:

```ts
import {
  availabilityRule,
  eventType,
  pack,
  professional,
  timeOff,
  user as userTable,
} from "@/lib/db/schema";
import { buildTimeOffInterval } from "@/lib/timeoff";
```

- [ ] **Step 4: Add the actions** at the end of `src/server/pro.ts`:

```ts
/* ─────────────────────────── Indisponibilités ──────────────────── */

export async function createTimeOff(input: {
  startDate: string;
  endDate: string;
  allDay: boolean;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const pro = await requirePro();

  let interval;
  try {
    interval = buildTimeOffInterval(input, pro.timezone);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Entrée invalide." };
  }

  await db.insert(timeOff).values({
    professionalId: pro.id,
    startAt: interval.startAt,
    endAt: interval.endAt,
    allDay: input.allDay,
    reason: input.reason?.trim() || null,
  });

  revalidatePath("/dashboard/unavailability");
  revalidatePath(`/${pro.slug}`);
  return { ok: true };
}

export async function deleteTimeOff(id: string) {
  const pro = await requirePro();
  await db
    .delete(timeOff)
    .where(and(eq(timeOff.id, id), eq(timeOff.professionalId, pro.id)));
  revalidatePath("/dashboard/unavailability");
  revalidatePath(`/${pro.slug}`);
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/queries.ts src/server/pro.ts
git commit -m "feat(pro): create/delete/list time-off server actions"
```

---

## Task 5: Dashboard page, calendar UI, and nav

**Files:**
- Create: `src/app/dashboard/unavailability/page.tsx`
- Create: `src/components/dashboard/unavailability-manager.tsx`
- Modify: `src/components/dashboard/sidebar.tsx` (icon import; `NAV` array)

**Interfaces:**
- Consumes: `getProTimeOff`, `createTimeOff`, `deleteTimeOff`, `coveredDayKeys`, `getCurrentProfessional`, datetime formatters, UI primitives.
- Produces: the `/dashboard/unavailability` route and sidebar entry.

- [ ] **Step 1: Add the sidebar entry** in `src/components/dashboard/sidebar.tsx`. Add `CalendarOff` to the lucide import (lines 5-13):

```ts
import {
  CalendarDays,
  CalendarOff,
  Clock,
  ExternalLink,
  LayoutDashboard,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
```

Then insert a `NAV` entry directly after the `availability` line (line 22):

```ts
  { href: "/dashboard/unavailability", label: "Indisponibilités", icon: CalendarOff },
```

- [ ] **Step 2: Create the client component** `src/components/dashboard/unavailability-manager.tsx`:

```tsx
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
```

- [ ] **Step 3: Create the server page** `src/app/dashboard/unavailability/page.tsx`:

```tsx
import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  UnavailabilityManager,
  type TimeOffEntry,
} from "@/components/dashboard/unavailability-manager";
import { getCurrentProfessional } from "@/lib/session";
import { getProTimeOff } from "@/server/queries";
import { coveredDayKeys } from "@/lib/timeoff";
import { dayKeyInTz, formatDateLong, formatTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "Indisponibilités" };

export default async function UnavailabilityPage() {
  const pro = (await getCurrentProfessional())!;
  const tz = pro.timezone;
  const rows = await getProTimeOff(pro.id);

  const markedDays = [
    ...new Set(rows.flatMap((r) => coveredDayKeys(r.startAt, r.endAt, tz))),
  ];

  const entries: TimeOffEntry[] = rows.map((r) => {
    let label: string;
    if (r.allDay) {
      const last = new Date(r.endAt.getTime() - 1); // exclusive end → inclusive last day
      const startKey = dayKeyInTz(r.startAt, tz);
      const lastKey = dayKeyInTz(last, tz);
      label =
        startKey === lastKey
          ? formatDateLong(r.startAt, tz)
          : `${formatDateLong(r.startAt, tz)} → ${formatDateLong(last, tz)}`;
    } else {
      label = `${formatDateLong(r.startAt, tz)} · ${formatTime(
        r.startAt,
        tz,
      )} – ${formatTime(r.endAt, tz)}`;
    }
    return { id: r.id, label, allDay: r.allDay, reason: r.reason };
  });

  return (
    <>
      <PageHeader
        title="Indisponibilités"
        description={`Bloquez des journées ou des plages horaires (fuseau ${tz}). Ces créneaux n'apparaîtront pas pour vos clients.`}
      />
      <UnavailabilityManager markedDays={markedDays} entries={entries} />
    </>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: PASS — `/dashboard/unavailability` appears in the route list.

- [ ] **Step 6: Manual verification** (if a dev DB + `pnpm dev` are available)

1. Sign in as `pro@skedul.app` / `password123`.
2. Go to **Indisponibilités** in the sidebar.
3. Add an all-day range (e.g. tomorrow → +2 days); confirm the days highlight in the calendar and the entry appears under "À venir".
4. Add a timed unavailability (toggle "Toute la journée" off, pick a single day + 14:00–16:00).
5. Open the public page `/studio-camille`, start booking an event type, and confirm the blocked day/slots no longer appear.
6. Delete an entry; confirm the calendar/slots update after refresh.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/unavailability/page.tsx src/components/dashboard/unavailability-manager.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat(dashboard): unavailability page with month calendar"
```

---

## Self-Review

**Spec coverage:**
- Granularité journées + plages horaires → Task 2 (`buildTimeOffInterval` handles both) + Task 5 form (all-day toggle). ✓
- Modèle de données `timeOff` → Task 1. ✓
- Conversion mur-horloge → instant via `instantFromWallClock` → Task 2. ✓
- Intégration moteur (merge into `busy[]`, no `computeSlots` change, applies at display + booking) → Task 3 (+ booking path already uses `loadBookableSlots` via `isSlotAvailable`). ✓
- Server actions `createTimeOff`/`deleteTimeOff` + query `getProTimeOff` → Task 4. ✓
- UI: route, sidebar entry "Indisponibilités"/`CalendarOff`, month calendar, add form, list with delete → Task 5. ✓
- Edge cases: `endAt > startAt`, timed single-day, ownership on delete → Tasks 2 & 4. ✓
- Hors périmètre (récurrent, bookings-in-calendar, edit) → not implemented, as specified. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `buildTimeOffInterval(input, tz)` / `coveredDayKeys(startAt, endAt, tz)` signatures match across Tasks 2, 3, 4, 5. `TimeOffEntry` defined in the manager and imported by the page. Action result `{ ok: true } | { ok: false; error }` consumed in Task 5 `submit`. `timeOff` column names (`startAt`, `endAt`, `allDay`, `reason`) consistent across schema, query, action, page. ✓
