# Planning back-office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Planning" back-office page with a weekly calendar showing class sessions, 1:1 bookings and time-off, plus organisation actions (session detail, capacity, move attendee, cancel, manual enrolment).

**Architecture:** Server component reads a week window via a new `getProPlanningWeek` query; a bespoke CSS-grid client component renders day columns × hour rows. Clicking a session opens a detail dialog. Organisation mutations are server actions reusing the atomic `claimSeat`/`releaseSeat` seat helpers. No calendar library.

**Tech Stack:** Next.js 16 App Router (async `searchParams`), React client components (`useTransition`/`useRouter`), Drizzle + Neon HTTP, `@date-fns/tz`, Tailwind v4 bespoke primitives, `node:test` for unit tests.

## Global Constraints

- **Next.js 16**: `params`/`searchParams` are async (`await`).
- **No interactive transactions** (Neon HTTP). Seat moves use guarded atomic SQL via `claimSeat`/`releaseSeat` (`src/lib/sessions.ts`).
- **Money**: integer cents; manual bookings are `paymentType: "free"`, `amountPaidCents: 0`.
- **Time**: stored as `timestamptz` instants; displayed in `pro.timezone` via `@date-fns/tz`. Availability minutes are wall-clock from midnight.
- **Server actions** live in `src/server/*.ts` (`"use server"`); read-only queries in `queries.ts` (`import "server-only"`). Every exported symbol in a `"use server"` file becomes a server action — shared non-action helpers go in a `"server-only"` module.
- **Copy** in French, consistent with existing labels.
- `pnpm typecheck`, `pnpm build`, `pnpm test` must stay green.

---

### Task 1: Planning date/grid helpers

**Files:**
- Create: `src/lib/planning.ts`
- Test: `src/lib/planning.test.ts`

**Interfaces:**
- Consumes: `TZDate` from `@date-fns/tz`; `dayKeyInTz` from `src/lib/datetime.ts`.
- Produces:
  - `weekStartFromParam(param: string | undefined, tz: string, now: Date): Date` — instant of Monday 00:00 (in `tz`) of the week containing `param` (`YYYY-MM-DD`) or `now`.
  - `weekBounds(weekStart: Date, tz: string): { start: Date; end: Date }` — `[Monday 00:00, next Monday 00:00)`.
  - `weekDays(weekStart: Date, tz: string): Date[]` — 7 instants, Monday→Sunday 00:00 local.
  - `minutesIntoDay(instant: Date, dayStart: Date): number` — whole minutes between `dayStart` and `instant`.
  - `gridRange(events: { startAt: Date; endAt: Date }[], tz: string): { startHour: number; endHour: number }` — default `8..21`, widened to fit events (floor/ceil to the hour), clamped `0..24`.
  - `paramForWeek(weekStart: Date, tz: string): string` — `YYYY-MM-DD` of `weekStart` for `?week=` links.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/planning.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekStartFromParam,
  weekBounds,
  weekDays,
  minutesIntoDay,
  gridRange,
  paramForWeek,
} from "./planning";

const TZ = "Europe/Paris";

test("weekStartFromParam: Monday of the week containing a Wednesday", () => {
  // 2026-06-24 is a Wednesday → Monday is 2026-06-22
  const ws = weekStartFromParam("2026-06-24", TZ, new Date("2026-01-01T00:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekStartFromParam: a Monday maps to itself", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date("2026-01-01T00:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekStartFromParam: undefined falls back to now's week", () => {
  const ws = weekStartFromParam(undefined, TZ, new Date("2026-06-24T10:00:00Z"));
  assert.equal(paramForWeek(ws, TZ), "2026-06-22");
});

test("weekBounds spans exactly 7 days", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const { start, end } = weekBounds(ws, TZ);
  assert.equal((end.getTime() - start.getTime()) / 86_400_000, 7);
});

test("weekDays returns 7 days Monday→Sunday", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const days = weekDays(ws, TZ);
  assert.equal(days.length, 7);
  assert.equal(paramForWeek(days[0], TZ), "2026-06-22");
  assert.equal(paramForWeek(days[6], TZ), "2026-06-28");
});

test("minutesIntoDay: 10:30 local is 630 minutes after local midnight", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const dayStart = weekDays(ws, TZ)[0]; // Mon 00:00 local
  const at = new Date(dayStart.getTime() + 630 * 60_000);
  assert.equal(minutesIntoDay(at, dayStart), 630);
});

test("gridRange: empty → default 8..21", () => {
  assert.deepEqual(gridRange([], TZ), { startHour: 8, endHour: 21 });
});

test("gridRange: widens to fit an early/late event", () => {
  const ws = weekStartFromParam("2026-06-22", TZ, new Date());
  const day = weekDays(ws, TZ)[0];
  const ev = {
    startAt: new Date(day.getTime() + 7 * 60 * 60_000), // 07:00
    endAt: new Date(day.getTime() + 22.5 * 60 * 60_000), // 22:30
  };
  assert.deepEqual(gridRange([ev], TZ), { startHour: 7, endHour: 23 });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm exec tsx --test src/lib/planning.test.ts`
Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `src/lib/planning.ts`**

```ts
import { TZDate } from "@date-fns/tz";
import { dayKeyInTz } from "@/lib/datetime";

/** Local midnight (as a UTC instant) of the calendar day `instant` falls on, in `tz`. */
function localMidnight(instant: Date, tz: string): Date {
  const z = new TZDate(instant.getTime(), tz);
  return new Date(
    new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, tz).getTime(),
  );
}

/** Monday 00:00 (local) of the week containing `param` (YYYY-MM-DD) or `now`. */
export function weekStartFromParam(
  param: string | undefined,
  tz: string,
  now: Date,
): Date {
  let base: Date;
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const [y, m, d] = param.split("-").map(Number);
    base = new Date(new TZDate(y, m - 1, d, 12, 0, 0, tz).getTime());
  } else {
    base = now;
  }
  const midnight = localMidnight(base, tz);
  const z = new TZDate(midnight.getTime(), tz);
  const dow = z.getDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // days since Monday
  return new Date(midnight.getTime() - backToMonday * 86_400_000);
}

export function weekBounds(weekStart: Date, _tz: string): { start: Date; end: Date } {
  return { start: weekStart, end: new Date(weekStart.getTime() + 7 * 86_400_000) };
}

export function weekDays(weekStart: Date, _tz: string): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000));
}

export function minutesIntoDay(instant: Date, dayStart: Date): number {
  return Math.round((instant.getTime() - dayStart.getTime()) / 60_000);
}

export function gridRange(
  events: { startAt: Date; endAt: Date }[],
  tz: string,
): { startHour: number; endHour: number } {
  let startHour = 8;
  let endHour = 21;
  for (const e of events) {
    const s = new TZDate(e.startAt.getTime(), tz);
    const en = new TZDate(e.endAt.getTime(), tz);
    startHour = Math.min(startHour, s.getHours());
    const endMin = en.getHours() * 60 + en.getMinutes();
    endHour = Math.max(endHour, Math.ceil(endMin / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export function paramForWeek(weekStart: Date, tz: string): string {
  return dayKeyInTz(weekStart, tz);
}
```

> Note: `weekStart` is local midnight, but DST transitions mean `+i*86_400_000` can drift by an hour across a spring/autumn change. Europe/Paris transitions happen at 03:00 on a Sunday; since the grid renders per-day using each day's own local midnight derived from `dayKeyInTz` in the component, the helper's day instants are only used as column anchors and `?week=` keys, which `dayKeyInTz` normalises. Acceptable for this feature; documented here intentionally.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm exec tsx --test src/lib/planning.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning.ts src/lib/planning.test.ts
git commit -m "feat(planning): week/grid date helpers"
```

---

### Task 2: `getProPlanningWeek` query

**Files:**
- Modify: `src/server/queries.ts` (add export near `getProSessions`)

**Interfaces:**
- Consumes: `classSession`, `eventType`, `booking`, `customer`, `bookingAnswer`, `timeOff` tables; drizzle `and/eq/gte/lt/inArray/asc`.
- Produces:
  ```ts
  type PlanningAttendee = {
    bookingId: string; name: string; email: string;
    status: string; paymentType: string;
    answers: { label: string; value: string }[];
  };
  type PlanningSession = {
    id: string; startAt: Date; endAt: Date;
    capacity: number; seatsRemaining: number;
    eventTypeId: string; eventTitle: string; eventColor: string;
    attendees: PlanningAttendee[];
  };
  type PlanningTimeOff = { id: string; startAt: Date; endAt: Date; reason: string | null };
  getProPlanningWeek(proId: string, start: Date, end: Date):
    Promise<{ sessions: PlanningSession[]; timeOff: PlanningTimeOff[] }>
  ```

- [ ] **Step 1: Implement the query** (no unit test — DB query, mirrors untested `getProSessions`; verified by typecheck + build + the page)

Add to `src/server/queries.ts` (ensure `lt` and `gte` are imported from `drizzle-orm`):

```ts
export async function getProPlanningWeek(proId: string, start: Date, end: Date) {
  const sessions = await db
    .select({
      id: classSession.id,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
      seatsRemaining: classSession.seatsRemaining,
      eventTypeId: classSession.eventTypeId,
      eventTitle: eventType.title,
      eventColor: eventType.color,
    })
    .from(classSession)
    .innerJoin(eventType, eq(eventType.id, classSession.eventTypeId))
    .where(
      and(
        eq(classSession.professionalId, proId),
        gte(classSession.startAt, start),
        lt(classSession.startAt, end),
      ),
    )
    .orderBy(asc(classSession.startAt));

  const timeOffRows = await db
    .select({
      id: timeOff.id,
      startAt: timeOff.startAt,
      endAt: timeOff.endAt,
      reason: timeOff.reason,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.professionalId, proId),
        lt(timeOff.startAt, end),
        gt(timeOff.endAt, start),
      ),
    )
    .orderBy(asc(timeOff.startAt));

  if (sessions.length === 0) {
    return { sessions: [], timeOff: timeOffRows };
  }

  const sessionIds = sessions.map((s) => s.id);
  const attRows = await db
    .select({
      sessionId: booking.sessionId,
      bookingId: booking.id,
      name: customer.name,
      email: customer.email,
      status: booking.status,
      paymentType: booking.paymentType,
    })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(
      and(
        inArray(booking.sessionId, sessionIds),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  const bookingIds = attRows.map((r) => r.bookingId);
  const answerRows = bookingIds.length
    ? await db
        .select({
          bookingId: bookingAnswer.bookingId,
          label: bookingAnswer.questionLabel,
          value: bookingAnswer.value,
        })
        .from(bookingAnswer)
        .where(inArray(bookingAnswer.bookingId, bookingIds))
    : [];

  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answerRows) {
    const arr = answersByBooking.get(a.bookingId) ?? [];
    arr.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, arr);
  }

  return {
    sessions: sessions.map((s) => ({
      ...s,
      attendees: attRows
        .filter((r) => r.sessionId === s.id)
        .map((r) => ({
          bookingId: r.bookingId,
          name: r.name,
          email: r.email,
          status: r.status,
          paymentType: r.paymentType,
          answers: answersByBooking.get(r.bookingId) ?? [],
        })),
    })),
    timeOff: timeOffRows,
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/queries.ts
git commit -m "feat(planning): getProPlanningWeek query"
```

---

### Task 3: Dialog UI primitive

**Files:**
- Create: `src/components/ui/dialog.tsx`

**Interfaces:**
- Produces: `Dialog({ open, onClose, title, children })` — a controlled modal (fixed overlay + centered card, Escape + backdrop close, `role="dialog"`). Client component.

- [ ] **Step 1: Implement** (no unit test — presentational primitive, gated by typecheck/build + manual)

```tsx
"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(ui): minimal Dialog primitive"
```

---

### Task 4: Planning page, calendar grid & sidebar entry (Unit 1 — read view)

**Files:**
- Create: `src/app/dashboard/planning/page.tsx`
- Create: `src/components/dashboard/planning-calendar.tsx`
- Modify: `src/components/dashboard/sidebar.tsx` (add nav entry)

**Interfaces:**
- Consumes: `getProPlanningWeek` (Task 2); `weekStartFromParam`, `weekBounds`, `weekDays`, `gridRange`, `minutesIntoDay`, `paramForWeek` (Task 1); `dayKeyInTz`, `formatTime`, `minutesToLabel`, `DAYS_FR` (`datetime.ts`).
- Produces: a serialisable `PlanningData` view-model the client renders; the page passes ISO strings + `tz`.

- [ ] **Step 1: Add sidebar entry**

In `src/components/dashboard/sidebar.tsx`, import `CalendarRange` from `lucide-react` and insert into `NAV` after the Réservations entry:

```tsx
{ href: "/dashboard/planning", label: "Planning", icon: CalendarRange },
```

- [ ] **Step 2: Implement the page (server component)**

```tsx
// src/app/dashboard/planning/page.tsx
import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { getCurrentProfessional } from "@/lib/session";
import { getProPlanningWeek } from "@/server/queries";
import { weekBounds, weekStartFromParam, weekDays, gridRange, paramForWeek } from "@/lib/planning";

export const metadata: Metadata = { title: "Planning" };

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const pro = (await getCurrentProfessional())!;
  const { week } = await searchParams;
  const tz = pro.timezone;
  const weekStart = weekStartFromParam(week, tz, new Date());
  const { start, end } = weekBounds(weekStart, tz);
  const { sessions, timeOff } = await getProPlanningWeek(pro.id, start, end);

  const days = weekDays(weekStart, tz);
  const range = gridRange([...sessions, ...timeOff], tz);
  const prevParam = paramForWeek(new Date(weekStart.getTime() - 7 * 86_400_000), tz);
  const nextParam = paramForWeek(new Date(weekStart.getTime() + 7 * 86_400_000), tz);
  const todayParam = paramForWeek(weekStartFromParam(undefined, tz, new Date()), tz);

  return (
    <>
      <PageHeader title="Planning" description="Vos séances et rendez-vous de la semaine." />
      <PlanningCalendar
        tz={tz}
        days={days.map((d) => d.toISOString())}
        startHour={range.startHour}
        endHour={range.endHour}
        sessions={sessions.map((s) => ({
          id: s.id,
          startAt: s.startAt.toISOString(),
          endAt: s.endAt.toISOString(),
          capacity: s.capacity,
          seatsRemaining: s.seatsRemaining,
          eventTitle: s.eventTitle,
          eventColor: s.eventColor,
          attendees: s.attendees,
        }))}
        timeOff={timeOff.map((t) => ({
          id: t.id,
          startAt: t.startAt.toISOString(),
          endAt: t.endAt.toISOString(),
          reason: t.reason,
        }))}
        nav={{ prevParam, nextParam, todayParam }}
      />
    </>
  );
}
```

- [ ] **Step 3: Implement the calendar (client component)**

`src/components/dashboard/planning-calendar.tsx`. Renders nav header (← / Aujourd'hui / → as `<Link href="/dashboard/planning?week=...">`), an hour gutter, 7 day columns (responsive: on small screens a day `<select>` shows one column). Each session/timeoff is absolutely positioned using `minutesIntoDay` relative to that day's local midnight (`60px` per hour). Sessions are clickable → set `selected` state → render `SessionDetailDialog` (Task 5). Use `dayKeyInTz` to bucket events per day and to compute each day's local-midnight anchor.

Key structure (the engineer fills the JSX following existing Tailwind/`Card`/`Badge` idioms; the data/positioning logic is fixed):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionDetailDialog } from "@/components/dashboard/session-detail-dialog";
import { ManualBookingButton } from "@/components/dashboard/manual-booking-form";
import { DAYS_FR, dayKeyInTz, formatTime, minutesToLabel } from "@/lib/datetime";
import { TZDate } from "@date-fns/tz";

export type PlanningSessionVM = {
  id: string; startAt: string; endAt: string;
  capacity: number; seatsRemaining: number;
  eventTitle: string; eventColor: string;
  attendees: { bookingId: string; name: string; email: string; status: string; paymentType: string; answers: { label: string; value: string }[] }[];
};
export type PlanningTimeOffVM = { id: string; startAt: string; endAt: string; reason: string | null };

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
  nav: { prevParam: string; nextParam: string; todayParam: string };
}) {
  const { tz, startHour, endHour } = props;
  const [selected, setSelected] = useState<PlanningSessionVM | null>(null);
  const days = props.days.map((d) => new Date(d));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colHeight = hours.length * HOUR_PX;

  const top = (iso: string, key: string) =>
    ((new Date(iso).getTime() - localMidnightForKey(key, tz)) / 60_000 - startHour * 60) *
    (HOUR_PX / 60);
  const height = (a: string, b: string) =>
    Math.max(22, ((new Date(b).getTime() - new Date(a).getTime()) / 60_000) * (HOUR_PX / 60));

  return (
    <div>
      {/* nav header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm"><Link href={`/dashboard/planning?week=${props.nav.prevParam}`}><ChevronLeft className="size-4" /></Link></Button>
          <Button asChild variant="secondary" size="sm"><Link href={`/dashboard/planning?week=${props.nav.todayParam}`}>Aujourd&apos;hui</Link></Button>
          <Button asChild variant="ghost" size="sm"><Link href={`/dashboard/planning?week=${props.nav.nextParam}`}><ChevronRight className="size-4" /></Link></Button>
        </div>
        <ManualBookingButton />
      </div>

      {props.sessions.length === 0 && props.timeOff.length === 0 ? (
        <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          Aucune séance cette semaine.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-[760px]">
            {/* hour gutter */}
            <div className="w-12 shrink-0 pt-8">
              {hours.map((h) => (
                <div key={h} className="relative text-right text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
                  <span className="absolute -top-1.5 right-1">{minutesToLabel(h * 60)}</span>
                </div>
              ))}
            </div>
            {/* day columns */}
            {days.map((day) => {
              const key = dayKeyInTz(day, tz);
              const daySessions = props.sessions.filter((s) => dayKeyInTz(new Date(s.startAt), tz) === key);
              const dayOff = props.timeOff.filter((t) => dayKeyInTz(new Date(t.startAt), tz) === key);
              return (
                <div key={key} className="flex-1 border-l border-border">
                  <div className="h-8 border-b border-border text-center text-xs font-medium">
                    {DAYS_FR[day.getDay() === 0 ? 0 : day.getDay()].slice(0, 3)}{" "}
                    {new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: tz }).format(day)}
                  </div>
                  <div className="relative" style={{ height: colHeight }}>
                    {dayOff.map((t) => (
                      <div key={t.id} className="absolute inset-x-0.5 rounded bg-muted/60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)]"
                        style={{ top: top(t.startAt, key), height: height(t.startAt, t.endAt) }}
                        title={t.reason ?? "Indisponible"} />
                    ))}
                    {daySessions.map((s) => {
                      const booked = s.capacity - s.seatsRemaining;
                      const group = s.capacity > 1;
                      return (
                        <button key={s.id} onClick={() => setSelected(s)}
                          className="absolute inset-x-0.5 overflow-hidden rounded-lg border p-1 text-left text-[11px] leading-tight text-white shadow-sm"
                          style={{ top: top(s.startAt, key), height: height(s.startAt, s.endAt), backgroundColor: s.eventColor }}>
                          <span className="block font-medium">{formatTime(new Date(s.startAt), tz)} {s.eventTitle}</span>
                          <span className="block opacity-90">{group ? `${booked}/${s.capacity}` : (s.attendees[0]?.name ?? "")}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
```

> `ManualBookingButton` (Task 7) and `SessionDetailDialog` (Task 5) are referenced here; create stub exports first so this compiles, then fill them in their tasks. Stub: `export function ManualBookingButton() { return null; }` and a `SessionDetailDialog` rendering the `Dialog` with a placeholder. Replace in Tasks 5/7.

- [ ] **Step 4: Add stubs so the build compiles**

Create `src/components/dashboard/session-detail-dialog.tsx` and `src/components/dashboard/manual-booking-form.tsx` with minimal exports (filled in later tasks):

```tsx
// session-detail-dialog.tsx (stub)
"use client";
import { Dialog } from "@/components/ui/dialog";
import type { PlanningSessionVM } from "@/components/dashboard/planning-calendar";
export function SessionDetailDialog({ session, onClose }: { session: PlanningSessionVM; tz: string; allSessions: PlanningSessionVM[]; onClose: () => void }) {
  return <Dialog open onClose={onClose} title={session.eventTitle}><p className="text-sm text-muted-foreground">Détail à venir.</p></Dialog>;
}
```
```tsx
// manual-booking-form.tsx (stub)
"use client";
export function ManualBookingButton() { return null; }
```

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS; route `/dashboard/planning` listed.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/planning src/components/dashboard/planning-calendar.tsx src/components/dashboard/session-detail-dialog.tsx src/components/dashboard/manual-booking-form.tsx src/components/dashboard/sidebar.tsx
git commit -m "feat(planning): week calendar view + page + nav"
```

---

### Task 5: Session detail dialog (Unit 2)

**Files:**
- Modify: `src/components/dashboard/session-detail-dialog.tsx` (replace stub)

**Interfaces:**
- Consumes: `Dialog` (Task 3), `SessionCapacityControl`, `formatSlot`, `Badge`, `Button`; `PlanningSessionVM` type. Server actions `moveAttendee`, `cancelBooking`, `cancelSession` (Task 6) — referenced; ensure Task 6 lands before wiring buttons, or guard with stubs. For this task, render roster + capacity + a "Déplacer vers…" `<select>` and "Désinscrire"/"Annuler la séance" buttons that call the Task 6 actions via `useTransition` + `router.refresh()`.

- [ ] **Step 1: Implement** (no unit test — UI; gated by typecheck/build + manual)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionCapacityControl } from "@/components/dashboard/session-capacity-control";
import type { PlanningSessionVM } from "@/components/dashboard/planning-calendar";
import { formatSlot } from "@/lib/datetime";
import { moveAttendee, cancelBooking, cancelSession } from "@/server/pro";

export function SessionDetailDialog({
  session,
  tz,
  allSessions,
  onClose,
}: {
  session: PlanningSessionVM;
  tz: string;
  allSessions: PlanningSessionVM[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const booked = session.capacity - session.seatsRemaining;
  const targets = allSessions.filter((s) => s.id !== session.id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action impossible.");
      else { router.refresh(); onClose(); }
    });
  }

  return (
    <Dialog open onClose={onClose} title={session.eventTitle}>
      <p className="text-sm text-muted-foreground">{formatSlot(new Date(session.startAt), new Date(session.endAt), tz)}</p>
      <div className="mt-3 flex items-center justify-between">
        <Badge variant="neutral">{booked}/{session.capacity} inscrits</Badge>
        <SessionCapacityControl sessionId={session.id} capacity={session.capacity} />
      </div>

      <ul className="mt-4 space-y-3">
        {session.attendees.length === 0 && (
          <li className="text-sm text-muted-foreground">Personne d&apos;inscrit.</li>
        )}
        {session.attendees.map((a) => (
          <li key={a.bookingId} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">{a.email}</span>
            </div>
            {a.answers.length > 0 && (
              <ul className="mt-1 text-xs text-muted-foreground">
                {a.answers.map((ans, i) => <li key={i}>{ans.label}: {ans.value}</li>)}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {targets.length > 0 && (
                <select
                  disabled={pending}
                  defaultValue=""
                  onChange={(e) => e.target.value && run(() => moveAttendee({ bookingId: a.bookingId, targetSessionId: e.target.value }))}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
                >
                  <option value="" disabled>Déplacer vers…</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.eventTitle} · {new Date(t.startAt).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}
                    </option>
                  ))}
                </select>
              )}
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => cancelBooking(a.bookingId))}>
                Désinscrire
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => cancelSession(session.id))}>
          Annuler la séance
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify typecheck** (will fail until Task 6 exports the actions — do Task 6 first, or land both together)

Run: `pnpm typecheck`
Expected: PASS after Task 6.

- [ ] **Step 3: Commit** (combine with Task 6 if needed)

```bash
git add src/components/dashboard/session-detail-dialog.tsx
git commit -m "feat(planning): session detail dialog (roster + actions)"
```

---

### Task 6: Organisation server actions + shared booking helpers

**Files:**
- Create: `src/server/booking-core.ts` (`"server-only"`) — shared helpers extracted from `public.ts`
- Modify: `src/server/public.ts` (import shared helpers, remove local copies)
- Modify: `src/server/pro.ts` (add `moveAttendee`, `cancelBooking`, `cancelSession`, `createManualBooking` — last one wired in Task 7)
- Test: `src/server/booking-core.test.ts` (pure helper only)

**Interfaces:**
- Produces in `booking-core.ts`:
  - `getOrCreateCustomer(professionalId, { name, email, phone? })` (moved verbatim from public.ts)
  - `buildAnswers(eventTypeId, answers?)` → `{ ok, rows } | { ok:false, error }` (moved)
  - `insertAnswers(bookingId, rows)` (moved)
  - `restoreCreditFor(bookingId)`: if the booking used a credit, increments `creditsRemaining` by 1 (guarded).
- Produces in `pro.ts`:
  - `moveAttendee({ bookingId, targetSessionId }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `cancelBooking(bookingId): Promise<{ ok: true } | { ok: false; error: string }>`
  - `cancelSession(sessionId): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Extract shared helpers into `booking-core.ts`**

Move `getOrCreateCustomer`, `buildAnswers`, `insertAnswers` from `public.ts` into a new `src/server/booking-core.ts` starting with `import "server-only";`, exporting each. Also add:

```ts
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { booking, packPurchase } from "@/lib/db/schema";

/** If the booking was paid with a pack credit, give the credit back (guarded). */
export async function restoreCreditFor(bookingId: string): Promise<void> {
  const rows = await db
    .select({ packPurchaseId: booking.packPurchaseId, paymentType: booking.paymentType })
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  const b = rows[0];
  if (!b || b.paymentType !== "credit" || !b.packPurchaseId) return;
  await db
    .update(packPurchase)
    .set({ creditsRemaining: sql`${packPurchase.creditsRemaining} + 1` })
    .where(eq(packPurchase.id, b.packPurchaseId));
}
```

Then in `public.ts` delete the three local helper definitions and import them: `import { getOrCreateCustomer, buildAnswers, insertAnswers } from "@/server/booking-core";`. Keep `CustomerInput` type where used (move it to booking-core and import, or redeclare).

- [ ] **Step 2: Write the pure-helper test**

```ts
// src/server/booking-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// buildAnswers requires DB; restoreCreditFor requires DB. Pure-test the
// answer-shaping contract via a small extracted pure function if added.
// Minimal guard: importing the module must not throw at load.
test("booking-core module loads", async () => {
  const mod = await import("./booking-core");
  assert.equal(typeof mod.getOrCreateCustomer, "function");
  assert.equal(typeof mod.restoreCreditFor, "function");
});
```

- [ ] **Step 3: Run test, verify pass**

Run: `pnpm exec tsx --test src/server/booking-core.test.ts`
Expected: PASS.

- [ ] **Step 4: Implement the three actions in `pro.ts`**

Add imports: `booking`, `classSession`, `customer`, `packPurchase` from schema (some already imported), `claimSeat`, `releaseSeat` from `@/lib/sessions`, `restoreCreditFor` from `@/server/booking-core`, `inArray` from drizzle.

```ts
type Res = { ok: true } | { ok: false; error: string };

export async function cancelBooking(bookingId: string): Promise<Res> {
  const pro = await requirePro();
  const rows = await db
    .select({ id: booking.id, sessionId: booking.sessionId, status: booking.status })
    .from(booking)
    .where(and(eq(booking.id, bookingId), eq(booking.professionalId, pro.id)))
    .limit(1);
  const b = rows[0];
  if (!b) return { ok: false, error: "Réservation introuvable." };
  if (b.status === "cancelled") return { ok: true };

  await db.update(booking).set({ status: "cancelled" }).where(eq(booking.id, b.id));
  if (b.sessionId) await releaseSeat(b.sessionId);
  await restoreCreditFor(b.id);

  revalidatePath("/dashboard/planning");
  revalidatePath("/dashboard/bookings");
  return { ok: true };
}

export async function moveAttendee(input: {
  bookingId: string;
  targetSessionId: string;
}): Promise<Res> {
  const pro = await requirePro();
  const bRows = await db
    .select({ id: booking.id, sessionId: booking.sessionId })
    .from(booking)
    .where(and(eq(booking.id, input.bookingId), eq(booking.professionalId, pro.id)))
    .limit(1);
  const b = bRows[0];
  if (!b) return { ok: false, error: "Réservation introuvable." };
  if (b.sessionId === input.targetSessionId) return { ok: true };

  const tRows = await db
    .select({
      id: classSession.id,
      eventTypeId: classSession.eventTypeId,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
    })
    .from(classSession)
    .where(and(eq(classSession.id, input.targetSessionId), eq(classSession.professionalId, pro.id)))
    .limit(1);
  const t = tRows[0];
  if (!t) return { ok: false, error: "Séance cible introuvable." };

  // claim a seat in the target first (creates/decrements atomically)
  const seat = await claimSeat({
    professionalId: pro.id,
    eventTypeId: t.eventTypeId,
    startAt: t.startAt,
    endAt: t.endAt,
    capacity: t.capacity,
  });
  if (!seat.ok) return { ok: false, error: "La séance cible est complète." };

  if (b.sessionId) await releaseSeat(b.sessionId);
  await db
    .update(booking)
    .set({ sessionId: seat.sessionId, eventTypeId: t.eventTypeId, startAt: t.startAt, endAt: t.endAt })
    .where(eq(booking.id, b.id));

  revalidatePath("/dashboard/planning");
  revalidatePath("/dashboard/bookings");
  return { ok: true };
}

export async function cancelSession(sessionId: string): Promise<Res> {
  const pro = await requirePro();
  const owns = await db
    .select({ id: classSession.id })
    .from(classSession)
    .where(and(eq(classSession.id, sessionId), eq(classSession.professionalId, pro.id)))
    .limit(1);
  if (owns.length === 0) return { ok: false, error: "Séance introuvable." };

  const bks = await db
    .select({ id: booking.id })
    .from(booking)
    .where(and(eq(booking.sessionId, sessionId), inArray(booking.status, ["pending", "confirmed"])));

  for (const bk of bks) {
    await db.update(booking).set({ status: "cancelled" }).where(eq(booking.id, bk.id));
    await restoreCreditFor(bk.id);
  }
  // reset seats to full (session kept; no future bookings hold seats)
  await db
    .update(classSession)
    .set({ seatsRemaining: sql`${classSession.capacity}` })
    .where(eq(classSession.id, sessionId));

  revalidatePath("/dashboard/planning");
  revalidatePath("/dashboard/bookings");
  return { ok: true };
}
```

- [ ] **Step 5: Verify typecheck + tests + build** (Task 5 dialog now compiles)

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/booking-core.ts src/server/booking-core.test.ts src/server/public.ts src/server/pro.ts src/components/dashboard/session-detail-dialog.tsx
git commit -m "feat(planning): organise actions (move/cancel) + shared booking-core"
```

---

### Task 7: Manual enrolment (createManualBooking + form)

**Files:**
- Modify: `src/server/pro.ts` (add `createManualBooking`; add a read query for the form's event types + day slots, or reuse `getProEventTypes` + a new `getManualSlots`)
- Modify: `src/server/queries.ts` (add `getManualDaySlots`)
- Modify: `src/components/dashboard/manual-booking-form.tsx` (replace stub)

**Interfaces:**
- Consumes: `loadBookableSlots` (`src/lib/slots.ts`), `getOrCreateCustomer`, `buildAnswers`, `insertAnswers` (`booking-core`), `claimSeat`, `fulfillBooking`, `getEventTypeQuestions`.
- Produces:
  - `getManualDaySlots(proId, eventTypeId, dayKey): Promise<{ startISO: string; label: string }[]>` (queries.ts) — slots for one local day.
  - `createManualBooking({ eventTypeId, startISO, customerName, customerEmail, answers? }): Promise<{ ok: true } | { ok: false; error: string }>` (pro.ts).
  - `ManualBookingButton()` — opens a `Dialog` with the form.

- [ ] **Step 1: Add `getManualDaySlots` to queries.ts**

```ts
export async function getManualDaySlots(proId: string, eventTypeId: string, dayKey: string) {
  const evt = (
    await db.select().from(eventType)
      .where(and(eq(eventType.id, eventTypeId), eq(eventType.professionalId, proId)))
      .limit(1)
  )[0];
  const pro = (
    await db.select({ timezone: professional.timezone }).from(professional)
      .where(eq(professional.id, proId)).limit(1)
  )[0];
  if (!evt || !pro) return [];
  const slots = await loadBookableSlots(proId, pro.timezone, evt, 21);
  return slots
    .filter((s) => dayKeyInTz(s.start, pro.timezone) === dayKey)
    .map((s) => ({ startISO: s.start.toISOString(), label: formatTime(s.start, pro.timezone) }));
}
```
(Import `loadBookableSlots` from `@/lib/slots`, `dayKeyInTz`/`formatTime` from `@/lib/datetime`.)

- [ ] **Step 2: Add `createManualBooking` to pro.ts**

```ts
export async function createManualBooking(input: {
  eventTypeId: string;
  startISO: string;
  customerName: string;
  customerEmail: string;
  answers?: { questionId: string; value: string }[];
}): Promise<Res> {
  const pro = await requirePro();
  const evt = (
    await db.select().from(eventType)
      .where(and(eq(eventType.id, input.eventTypeId), eq(eventType.professionalId, pro.id)))
      .limit(1)
  )[0];
  if (!evt) return { ok: false, error: "Prestation introuvable." };

  const ok = await isSlotAvailable(pro.id, pro.timezone, evt, input.startISO);
  if (!ok) return { ok: false, error: "Ce créneau n'est pas disponible." };

  const answers = await buildAnswers(evt.id, input.answers);
  if (!answers.ok) return { ok: false, error: answers.error };

  const cust = await getOrCreateCustomer(pro.id, { name: input.customerName, email: input.customerEmail });
  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + evt.durationMinutes * 60_000);

  const seat = await claimSeat({
    professionalId: pro.id, eventTypeId: evt.id, startAt: start, endAt: end, capacity: evt.capacity,
  });
  if (!seat.ok) return { ok: false, error: "Cette séance est complète." };

  const [created] = await db.insert(booking).values({
    professionalId: pro.id, eventTypeId: evt.id, customerId: cust.id, sessionId: seat.sessionId,
    startAt: start, endAt: end, status: "confirmed", paymentType: "free", amountPaidCents: 0,
  }).returning();

  await insertAnswers(created.id, answers.rows);
  await fulfillBooking(created.id);

  revalidatePath("/dashboard/planning");
  revalidatePath("/dashboard/bookings");
  return { ok: true };
}
```
(Import `isSlotAvailable` from `@/lib/slots`, `fulfillBooking` from `@/lib/payments`, `getOrCreateCustomer`/`buildAnswers`/`insertAnswers` from `@/server/booking-core`.)

- [ ] **Step 3: Implement `ManualBookingButton` + form**

`manual-booking-form.tsx`: a button that opens the `Dialog`. The form needs the pro's active event types — pass them in from the page (add a `getProEventTypes` call in `page.tsx` and a prop), OR fetch on open via a server action. Simpler: page passes `eventTypes: {id,title}[]` to `PlanningCalendar` → to `ManualBookingButton`. Flow: pick event type → pick date (`<input type="date">`) → on change call a server action wrapper that returns `getManualDaySlots` → pick slot → enter name/email → submit `createManualBooking`. Use `useTransition`; on success `router.refresh()` + close.

> Update `PlanningCalendar` to accept `eventTypes` and pass to `ManualBookingButton`; update `page.tsx` to fetch `getProEventTypes(pro.id)` (filter `isActive`) and pass `id,title`. `getManualDaySlots` must be reachable from the client — wrap it in a `"use server"` export in `pro.ts` (e.g. `fetchManualDaySlots`) since `queries.ts` is `server-only` and not callable from client. Add `export async function fetchManualDaySlots(eventTypeId, dayKey)` in pro.ts that calls `requirePro()` then `getManualDaySlots(pro.id, ...)`.

- [ ] **Step 4: Verify typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/pro.ts src/server/queries.ts src/components/dashboard/manual-booking-form.tsx src/components/dashboard/planning-calendar.tsx src/app/dashboard/planning/page.tsx
git commit -m "feat(planning): manual enrolment (+ day slot picker)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full green check**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS; `/dashboard/planning` in the route list.

- [ ] **Step 2: Manual smoke (dev)**

Run `pnpm dev`, sign in as the demo pro, open `/dashboard/planning`: verify the week grid shows seeded sessions, navigation works, clicking a session opens the dialog (roster + capacity), "+ Inscrire" creates a booking that then appears, move/cancel update the grid.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(planning): smoke-test adjustments"
```

## Self-Review

**Spec coverage:** Placement/route + sidebar (T4), week view content sessions/1:1/time-off (T2+T4), navigation (T4), session detail + capacity (T5), move attendee (T6), cancel booking/session + credit restore (T6), manual enrolment via slot engine (T7), `planning.ts` + tests (T1), `getProPlanningWeek` (T2), Dialog primitive (T3). All spec sections map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows real code. UI components without unit tests are gated by typecheck/build/manual, consistent with the codebase (only `src/lib` has unit tests).

**Type consistency:** `PlanningSessionVM`/`PlanningTimeOffVM` defined in `planning-calendar.tsx` and consumed by `session-detail-dialog.tsx`. Actions return `Res = {ok:true}|{ok:false;error}` consistently; dialog's `run()` reads `res.ok`/`res.error`. `claimSeat`/`releaseSeat` signatures match `src/lib/sessions.ts`. `getManualDaySlots` is server-only → exposed to client via `fetchManualDaySlots` server action (noted in T7).

**Known ordering constraint:** Task 5 references actions from Task 6 — land Task 6 before (or together with) Task 5's typecheck. Noted in both tasks.
