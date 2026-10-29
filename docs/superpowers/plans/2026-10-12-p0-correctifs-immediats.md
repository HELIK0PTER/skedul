# P0 — Correctifs immédiats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship to production, before the 2026-10-25 DST change, the fixes the tickets & événements redesign found in today's code. They cover DST-safe planning navigation and rendering, DST-safe slot computation, HTML-escaped booking e-mails, a gated mock checkout without open redirect, and no Git auto-deploys. The plan also opens the pending PR for `ab56600`.

**Architecture:** Small, independent fixes on a branch cut from `origin/main`, in their own worktree. Day arithmetic moves from `± n × 86 400 000 ms` to civil-date keys (`YYYY-MM-DD`) converted to instants with `instantFromWallClock`. The new pure helpers live in `src/lib/datetime.ts`. Booking e-mail templates move to a pure module so they can be unit-tested. No schema change, no migration.

**Tech Stack:** Next.js 16.2.9, React 19, `@date-fns/tz` 1.5 (`TZDate`), `node:test` via `tsx --test`, Vercel CLI, `gh`.

**Spec:** `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` (§ 15.1, plan P0).

## Global Constraints

- Work in the worktree `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\p0-fixes` on branch `fix/p0-dst-hardening`, created from `origin/main` (Task 1). Never work in the main checkout: another session keeps it on `preview`.
- `node_modules` is a **junction** to the main checkout. Never run `pnpm install` or `pnpm <script>` in the worktree. Call binaries directly: `./node_modules/.bin/tsx`, `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`, `./node_modules/.bin/next`.
- Next.js 16: `params`/`searchParams` are Promises.
- Never add `± n * 86_400_000` day arithmetic for calendar days. Use `addDaysToKey` + `startOfDayKey` (Task 2).
- Copy stays French, vouvoiement, no em/en dash in new visible strings.
- Commit after each task with a Conventional Commit message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks that must stay green: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint`, `./node_modules/.bin/tsx --test`, `./node_modules/.bin/next build`.
- Production deploy (Task 9) happens only after the owner says yes in chat.

## Review Focus

- **Week navigation across both DST changes.** From the week of 2026-10-19, « Semaine suivante » must reach 2026-10-26. From the week of 2026-03-30, « Semaine précédente » must reach 2026-03-23. Covered by tests in Task 3.
- **Block position on the two DST Sundays.** A 19:00 session on 2026-10-25 must render at the 19:00 line, not at 20:00. Covered by the `wallClockMinutes` test in Task 2 and the browser check in Task 8.
- **Slots right after midnight around DST.** Requests made at 23:30 on 2026-03-28, or at 00:30 on 2026-10-25, must not skip a day or lose one at the end of the horizon. Covered by tests in Task 5.
- **Customer-typed names in e-mails.** A name like `<img src=x onerror=alert(1)>` must arrive as text. Covered by tests in Task 6.
- **Mock checkout reached with Stripe live, or with a foreign `redirect`.** It must return 404 when Stripe is live, and never redirect outside `APP_URL`'s origin. Covered by tests in Task 7.

## File map

| File | Responsibility |
|---|---|
| `src/lib/datetime.ts` (+ new `datetime.test.ts`) | New civil-date helpers: `addDaysToKey`, `dayOfWeekForKey`, `startOfDayKey`, `wallClockMinutes` |
| `src/lib/planning.ts` (+ `.test.ts`) | DST-safe week start, bounds, days, adjacent-week param; `minutesIntoDay` removed |
| `src/app/dashboard/planning/page.tsx`, `src/app/dashboard/page.tsx` | Use the new signatures and `adjacentWeekParam` |
| `src/components/dashboard/planning-calendar.tsx`, `src/components/dashboard/week-preview.tsx` | Block `top` from wall-clock minutes |
| `src/lib/availability.ts` (+ `.test.ts`) | `computeSlots` iterates local dates; returns `[]` for a non-positive duration |
| `src/lib/booking-emails.ts` (new, + `.test.ts`) | The three booking/pack templates, escaped (moved out of `email.ts`) |
| `src/lib/email.ts`, `src/lib/payments.ts` | `email.ts` keeps `sendEmail` + `passwordResetEmail`; `payments.ts` imports templates from `booking-emails.ts` |
| `src/lib/mock-redirect.ts` (new, + `.test.ts`) | `safeMockRedirect` |
| `src/app/api/mock-checkout/route.ts` | 404 when Stripe is live; safe redirect |
| `vercel.ts` | `git.deploymentEnabled: false` |
| `.claude/launch.json` (main checkout) | `skedul-p0` dev server on port 3100 |

---

### Task 1: Worktree and branch

**Files:**
- Create: worktree `.claude/worktrees/p0-fixes` (branch `fix/p0-dst-hardening`)
- Create: `.claude/worktrees/p0-fixes/.env.local` (copy), `.claude/worktrees/p0-fixes/.env.development.local`
- Modify: `C:\Users\Matheus\Documents\Codage\skedul\.claude\launch.json`

**Interfaces:**
- Produces: a worktree where `./node_modules/.bin/tsx --test` runs, and a launch configuration named `skedul-p0` (port 3100).

- [ ] **Step 1: Create the worktree from an up-to-date `origin/main`**

Run in PowerShell, from `C:\Users\Matheus\Documents\Codage\skedul`:

```powershell
git fetch origin
git worktree add -b fix/p0-dst-hardening .claude/worktrees/p0-fixes origin/main
git branch --unset-upstream fix/p0-dst-hardening
New-Item -ItemType Junction -Path .claude\worktrees\p0-fixes\node_modules -Target C:\Users\Matheus\Documents\Codage\skedul\node_modules
Copy-Item .env.local .claude\worktrees\p0-fixes\.env.local
```

Expected: `git -C .claude/worktrees/p0-fixes log --oneline -1` shows the current `origin/main` head (at least `ff24dfd`).

- [ ] **Step 2: Point the worktree's app URL at port 3100**

Create `.claude/worktrees/p0-fixes/.env.development.local`:

```
BETTER_AUTH_URL=http://localhost:3100
NEXT_PUBLIC_APP_URL=http://localhost:3100
```

(`env.APP_URL` is derived from `NEXT_PUBLIC_APP_URL`, then `BETTER_AUTH_URL`; see `src/lib/env.ts`.)

- [ ] **Step 3: Add the launch configuration**

In `C:\Users\Matheus\Documents\Codage\skedul\.claude\launch.json`, add this object to `configurations` (keep the existing entries):

```json
{
  "name": "skedul-p0",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["-C", ".claude/worktrees/p0-fixes", "--config.verify-deps-before-run=false", "dev", "--port", "3100"],
  "port": 3100
}
```

- [ ] **Step 4: Check the baseline**

Run (in the worktree): `./node_modules/.bin/tsx --test`
Expected: all tests pass (one DB test skipped).

No commit: nothing in the repo changed (`.env*` files are git-ignored; `launch.json` is in the main checkout and is not committed here).

---

### Task 2: Civil-date helpers

**Files:**
- Modify: `src/lib/datetime.ts`
- Create: `src/lib/datetime.test.ts`

**Interfaces:**
- Produces:
  - `addDaysToKey(key: string, n: number): string` adds `n` calendar days to a `YYYY-MM-DD` key, with no time zone involved.
  - `dayOfWeekForKey(key: string): number` returns 0 = Sunday … 6 = Saturday.
  - `startOfDayKey(key: string, tz: string): Date` returns local 00:00 of `key` in `tz`.
  - `wallClockMinutes(instant: Date, tz: string): number` returns hours × 60 + minutes on the wall clock in `tz`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/datetime.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToKey,
  dayOfWeekForKey,
  startOfDayKey,
  wallClockMinutes,
} from "./datetime";

const TZ = "Europe/Paris";

test("addDaysToKey crosses months, years and leap days", () => {
  assert.equal(addDaysToKey("2026-10-24", 1), "2026-10-25");
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToKey("2028-03-01", -1), "2028-02-29");
  assert.equal(addDaysToKey("2026-10-19", 7), "2026-10-26");
});

test("dayOfWeekForKey: 2026-10-25 is a Sunday, 2026-10-19 a Monday", () => {
  assert.equal(dayOfWeekForKey("2026-10-25"), 0);
  assert.equal(dayOfWeekForKey("2026-10-19"), 1);
});

test("startOfDayKey gives local midnight on both sides of the fall-back change", () => {
  // 25 Oct 2026 starts in summer time (UTC+2), 26 Oct in winter time (UTC+1).
  assert.equal(startOfDayKey("2026-10-25", TZ).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(startOfDayKey("2026-10-26", TZ).toISOString(), "2026-10-25T23:00:00.000Z");
});

test("wallClockMinutes reads the wall clock, not time elapsed since midnight", () => {
  // 25 Oct 2026, 19:00 Paris (UTC+1) = 18:00Z. 20 hours have elapsed since local midnight.
  assert.equal(wallClockMinutes(new Date("2026-10-25T18:00:00Z"), TZ), 19 * 60);
  // 29 Mar 2026, 19:00 Paris (UTC+2) = 17:00Z. Only 18 hours have elapsed.
  assert.equal(wallClockMinutes(new Date("2026-03-29T17:00:00Z"), TZ), 19 * 60);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/datetime.test.ts`
Expected: FAIL, because `addDaysToKey` (and the others) is not exported from `./datetime`.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/datetime.ts` (it already imports `TZDate` and defines `instantFromWallClock`):

```ts
/** Adds `n` calendar days to a YYYY-MM-DD key (civil arithmetic, no time zone). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD key. */
export function dayOfWeekForKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Local midnight of the calendar day `key` in `tz`, as an instant. */
export function startOfDayKey(key: string, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return instantFromWallClock(y, m, d, 0, tz);
}

/**
 * Minutes on the wall clock (hours × 60 + minutes) of `instant` in `tz`.
 * Unlike "time elapsed since local midnight", 19:00 is 1140 even on a
 * 23- or 25-hour DST day.
 */
export function wallClockMinutes(instant: Date, tz: string): number {
  const z = new TZDate(instant.getTime(), tz);
  return z.getHours() * 60 + z.getMinutes();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/tsx --test src/lib/datetime.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime.ts src/lib/datetime.test.ts
git commit -m "feat(datetime): civil-date helpers for DST-safe day arithmetic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DST-safe week math and planning navigation

**Files:**
- Modify: `src/lib/planning.ts`
- Modify: `src/lib/planning.test.ts`
- Modify: `src/app/dashboard/planning/page.tsx:27-35,68-78`
- Modify: `src/app/dashboard/page.tsx:32-40`

**Interfaces:**
- Consumes: `addDaysToKey`, `dayOfWeekForKey`, `startOfDayKey`, `dayKeyInTz` from `@/lib/datetime`.
- Produces (new signatures):
  - `weekStartFromParam(param: string | undefined, tz: string, now: Date): Date`. The signature is unchanged; the result is local Monday 00:00.
  - `weekBounds(weekStart: Date, tz: string): { start: Date; end: Date }`, where `end` is the next local Monday 00:00.
  - `weekDays(weekStart: Date, tz: string): Date[]` returns 7 local midnights.
  - `adjacentWeekParam(weekStart: Date, tz: string, deltaWeeks: number): string` returns a `YYYY-MM-DD` key.
  - `minutesIntoDay` is **removed**. Its only caller was its test; use `wallClockMinutes`.

- [ ] **Step 1: Update the tests (new signatures + DST cases)**

In `src/lib/planning.test.ts`:
- Change the import list to `weekStartFromParam, weekBounds, weekDays, adjacentWeekParam, gridRange, paramForWeek` (drop `minutesIntoDay`).
- Delete the test `"minutesIntoDay: 10:30 local is 630 minutes after local midnight"`.
- Replace `weekBounds(ws)` with `weekBounds(ws, TZ)`, and every `weekDays(ws)` with `weekDays(ws, TZ)`.
- Append:

```ts
test("adjacentWeekParam: next week across the fall-back change (25 Oct 2026)", () => {
  const ws = weekStartFromParam("2026-10-19", TZ, new Date());
  assert.equal(adjacentWeekParam(ws, TZ, 1), "2026-10-26");
  const next = weekStartFromParam(adjacentWeekParam(ws, TZ, 1), TZ, new Date());
  assert.equal(paramForWeek(next, TZ), "2026-10-26");
});

test("adjacentWeekParam: previous week across the spring-forward change (29 Mar 2026)", () => {
  const ws = weekStartFromParam("2026-03-30", TZ, new Date());
  assert.equal(adjacentWeekParam(ws, TZ, -1), "2026-03-23");
});

test("weekBounds: a fall-back week ends at the next local Monday midnight", () => {
  const ws = weekStartFromParam("2026-10-21", TZ, new Date());
  const { start, end } = weekBounds(ws, TZ);
  assert.equal(start.toISOString(), "2026-10-18T22:00:00.000Z"); // Mon 19 Oct 00:00 CEST
  assert.equal(end.toISOString(), "2026-10-25T23:00:00.000Z"); // Mon 26 Oct 00:00 CET
});

test("weekDays: a fall-back week lists Monday 19 to Sunday 25 October", () => {
  const ws = weekStartFromParam("2026-10-25", TZ, new Date());
  const keys = weekDays(ws, TZ).map((d) => paramForWeek(d, TZ));
  assert.deepEqual(keys, [
    "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
    "2026-10-23", "2026-10-24", "2026-10-25",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/planning.test.ts`
Expected: FAIL. `adjacentWeekParam` is not exported, and the fall-back `weekBounds` end is `2026-10-25T22:00:00.000Z` instead of `…23:00…`.

- [ ] **Step 3: Rewrite the week helpers**

In `src/lib/planning.ts`, replace everything from the top of the file down to the end of `minutesIntoDay` (the imports, `localMidnight`, `weekStartFromParam`, `weekBounds`, `weekDays` and `minutesIntoDay`) with:

```ts
import { TZDate } from "@date-fns/tz";

import {
  addDaysToKey,
  dayKeyInTz,
  dayOfWeekForKey,
  startOfDayKey,
} from "@/lib/datetime";

/** The Monday (YYYY-MM-DD) of the week that contains `key`. */
function mondayKeyOf(key: string): string {
  return addDaysToKey(key, -((dayOfWeekForKey(key) + 6) % 7));
}

/** Monday 00:00 (local) of the week containing `param` (YYYY-MM-DD) or `now`. */
export function weekStartFromParam(
  param: string | undefined,
  tz: string,
  now: Date,
): Date {
  const key =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param)
      ? addDaysToKey(param, 0) // normalizes an overflowing date like 2026-02-31
      : dayKeyInTz(now, tz);
  return startOfDayKey(mondayKeyOf(key), tz);
}

/** [Monday 00:00, next Monday 00:00) in local time — 167 h or 169 h on DST weeks. */
export function weekBounds(weekStart: Date, tz: string): { start: Date; end: Date } {
  const monday = dayKeyInTz(weekStart, tz);
  return { start: weekStart, end: startOfDayKey(addDaysToKey(monday, 7), tz) };
}

/** The 7 local midnights Monday → Sunday. */
export function weekDays(weekStart: Date, tz: string): Date[] {
  const monday = dayKeyInTz(weekStart, tz);
  return Array.from({ length: 7 }, (_, i) =>
    startOfDayKey(addDaysToKey(monday, i), tz),
  );
}

/** The `?week=` param of the week `deltaWeeks` away from `weekStart`. */
export function adjacentWeekParam(
  weekStart: Date,
  tz: string,
  deltaWeeks: number,
): string {
  return addDaysToKey(dayKeyInTz(weekStart, tz), 7 * deltaWeeks);
}
```

Keep `gridRange` and `paramForWeek` unchanged below it. `gridRange` still uses `TZDate`, so the import stays.

- [ ] **Step 4: Update the planning page**

In `src/app/dashboard/planning/page.tsx`:
- Import `adjacentWeekParam` alongside the other `@/lib/planning` helpers.
- `const { start, end } = weekBounds(weekStart);` → `const { start, end } = weekBounds(weekStart, tz);`
- `const days = weekDays(weekStart);` → `const days = weekDays(weekStart, tz);`
- Replace the `nav` prop with:

```tsx
        nav={{
          prevParam: adjacentWeekParam(weekStart, tz, -1),
          nextParam: adjacentWeekParam(weekStart, tz, 1),
          todayParam: paramForWeek(weekStartFromParam(undefined, tz, new Date()), tz),
        }}
```

- [ ] **Step 5: Update the dashboard page**

In `src/app/dashboard/page.tsx`:
- `weekBounds(weekStart)` → `weekBounds(weekStart, tz)`.
- `weekDays(weekStart)` → `weekDays(weekStart, tz)`.

- [ ] **Step 6: Run the tests and the type check**

Run: `./node_modules/.bin/tsx --test src/lib/planning.test.ts`
Expected: PASS.
Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error. A leftover `minutesIntoDay` import or a one-argument `weekBounds`/`weekDays` call would fail here.

- [ ] **Step 7: Commit**

```bash
git add src/lib/planning.ts src/lib/planning.test.ts src/app/dashboard/planning/page.tsx src/app/dashboard/page.tsx
git commit -m "fix(planning): DST-safe week bounds and navigation

From the week of 2026-10-19, 'Semaine suivante' added 7x24h and landed
back on the same week, so the planning could not move past 25 Oct.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Calendar blocks positioned on the wall clock

**Files:**
- Modify: `src/components/dashboard/planning-calendar.tsx:43-46,109-112,210,225`
- Modify: `src/components/dashboard/week-preview.tsx:24-27,58-61,98,114`

**Interfaces:**
- Consumes: `wallClockMinutes(instant: Date, tz: string): number` (Task 2).

- [ ] **Step 1: Planning calendar**

In `src/components/dashboard/planning-calendar.tsx`:
- Delete the function `localMidnightForKey`.
- Add `wallClockMinutes` to the existing `@/lib/datetime` import.
- Replace the `topPx` definition with:

```tsx
  // Wall-clock minutes, not time elapsed since midnight: on a DST Sunday a
  // 19:00 session must sit on the 19:00 line.
  const topPx = (iso: string) =>
    (wallClockMinutes(new Date(iso), tz) - startHour * 60) * (HOUR_PX / 60);
```

- Change both call sites `topPx(t.startAt, key)` → `topPx(t.startAt)` and `topPx(s.startAt, key)` → `topPx(s.startAt)`.
- `TZDate` is still used (now indicator, `dow`), so keep its import.

- [ ] **Step 2: Week preview**

Make the same three edits in `src/components/dashboard/week-preview.tsx`: delete `localMidnightForKey`, import `wallClockMinutes`, use the same `topPx` definition, and fix both call sites.

- [ ] **Step 3: Type check and lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.
Run: `./node_modules/.bin/eslint src/components/dashboard/planning-calendar.tsx src/components/dashboard/week-preview.tsx`
Expected: no error. An unused `key` variable may now be reported in a `.map` callback. If it is, keep `key` only where it is still used (React `key` props and the `dayKeyInTz` filters use it), and remove nothing else.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/planning-calendar.tsx src/components/dashboard/week-preview.tsx
git commit -m "fix(planning): place blocks on the wall clock on DST days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Slot computation walks local dates

**Files:**
- Modify: `src/lib/availability.ts:46-76`
- Modify: `src/lib/availability.test.ts`

**Interfaces:**
- Consumes: `addDaysToKey`, `dayOfWeekForKey`, `dayKeyInTz` from `@/lib/datetime`.
- Produces: `computeSlots` keeps its signature. It returns `[]` when `durationMinutes <= 0`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/availability.test.ts` (it already defines `TZ`, `EVT` and `base`):

```ts
test("computeSlots: at 23:30 the night before spring-forward, Sunday is not skipped", () => {
  const slots = computeSlots(
    base({
      rules: [{ dayOfWeek: 0, startMinute: 540, endMinute: 600 }], // Sunday 09:00–10:00
      now: new Date("2026-03-28T22:30:00.000Z"), // Sat 28 Mar, 23:30 Paris (UTC+1)
      daysAhead: 2,
      minNoticeMinutes: 0,
    }),
  );
  // Sun 29 Mar 2026, 09:00 Paris (UTC+2) = 07:00Z
  assert.deepEqual(slots.map((s) => s.start.toISOString()), ["2026-03-29T07:00:00.000Z"]);
});

test("computeSlots: just after midnight on fall-back Sunday, Monday is still in the horizon", () => {
  const slots = computeSlots(
    base({
      rules: [
        { dayOfWeek: 0, startMinute: 540, endMinute: 600 }, // Sunday 09:00
        { dayOfWeek: 1, startMinute: 540, endMinute: 600 }, // Monday 09:00
      ],
      now: new Date("2026-10-24T22:30:00.000Z"), // Sun 25 Oct, 00:30 Paris (UTC+2)
      daysAhead: 2,
      minNoticeMinutes: 0,
    }),
  );
  assert.deepEqual(slots.map((s) => s.start.toISOString()), [
    "2026-10-25T08:00:00.000Z", // Sun 09:00 UTC+1
    "2026-10-26T08:00:00.000Z", // Mon 09:00 UTC+1
  ]);
});

test("computeSlots: a non-positive duration yields no slot (no infinite loop)", () => {
  assert.deepEqual(computeSlots(base({ durationMinutes: 0 })), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/availability.test.ts`
Expected: the first two new tests FAIL (Sunday missing; Monday missing). Run with a 10 s timeout, because the third one hangs with the current code: `./node_modules/.bin/tsx --test --test-timeout=10000 src/lib/availability.test.ts`.

- [ ] **Step 3: Iterate over local date keys**

In `src/lib/availability.ts`:
- Extend the `@/lib/datetime` import with `addDaysToKey` and `dayOfWeekForKey` (it already imports `dayKeyInTz` and `instantFromWallClock`).
- At the top of `computeSlots`'s body, before `const slots`, add:

```ts
  if (durationMinutes <= 0) return [];
```

- Replace the head of the day loop:

```ts
  for (let offset = 0; offset < daysAhead; offset++) {
    const baseDate = new Date(now.getTime() + offset * 86_400_000);
    const ymd = dayKeyInTz(baseDate, timezone); // YYYY-MM-DD (local to tz)
    const [year, month, day] = ymd.split("-").map(Number);
    const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
```

with:

```ts
  // Walk calendar days in the pro's zone. Stepping 24 h from `now` skips or
  // repeats a day when a DST change falls inside the horizon.
  const firstKey = dayKeyInTz(now, timezone);
  for (let offset = 0; offset < daysAhead; offset++) {
    const ymd = addDaysToKey(firstKey, offset);
    const [year, month, day] = ymd.split("-").map(Number);
    const dow = dayOfWeekForKey(ymd);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/tsx --test src/lib/availability.test.ts`
Expected: PASS (all old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "fix(availability): walk local dates so DST never skips a day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Escaped booking e-mails

**Files:**
- Create: `src/lib/booking-emails.ts`
- Create: `src/lib/booking-emails.test.ts`
- Modify: `src/lib/email.ts` (remove the three templates and the `euro` helper)
- Modify: `src/lib/payments.ts:19-24` (import source)

**Interfaces:**
- Consumes: `layout`, `escapeHtml` from `@/lib/email-layout` (pure).
- Produces: `bookingConfirmationEmail`, `proNewBookingEmail`, `packReceiptEmail` keep **exactly** their current argument types and return a string. They now live in `src/lib/booking-emails.ts` and escape every interpolated value, including `href`s.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/booking-emails.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bookingConfirmationEmail,
  packReceiptEmail,
  proNewBookingEmail,
} from "./booking-emails";

const EVIL = `<img src=x onerror="alert(1)">`;

test("bookingConfirmationEmail escapes names, titles and calendar links", () => {
  const html = bookingConfirmationEmail({
    customerName: EVIL,
    businessName: "Altinha & Co",
    eventTitle: "Cours <débutants>",
    whenLabel: "lun. 19 oct.",
    paidLabel: "25,00 €",
    calendarLinks: { google: `https://g.example/?a=1&b="x"`, outlook: "https://o.example", ics: "https://i.example" },
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("Altinha &amp; Co"));
  assert.ok(html.includes("Cours &lt;débutants&gt;"));
  assert.ok(html.includes(`href="https://g.example/?a=1&amp;b=&quot;x&quot;"`));
});

test("proNewBookingEmail escapes the customer's name and e-mail", () => {
  const html = proNewBookingEmail({
    businessName: "Studio",
    eventTitle: "Cours",
    whenLabel: "lun.",
    customerName: EVIL,
    customerEmail: `a"b@example.com`,
    fillLabel: "3/6 inscrits",
    paidLabel: "Crédit de pack",
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("a&quot;b@example.com"));
});

test("packReceiptEmail escapes the pack name and keeps the amount", () => {
  const html = packReceiptEmail({
    customerName: "Léa",
    businessName: "Studio",
    packName: EVIL,
    credits: 4,
    amountCents: 8500,
  });
  assert.ok(!html.includes("<img"));
  assert.match(html, /85,00\s€/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/booking-emails.test.ts`
Expected: FAIL, because the module `./booking-emails` is not found.

- [ ] **Step 3: Create the pure template module**

Create `src/lib/booking-emails.ts`. It holds the three templates moved from `email.ts`, with every interpolation escaped:

```ts
/**
 * Booking and pack e-mail templates. Pure (no Resend, no server-only) so they
 * can be unit-tested; every interpolated value is HTML-escaped because names
 * and titles are typed by customers and pros.
 */
import { escapeHtml as e, layout } from "@/lib/email-layout";

const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

export function bookingConfirmationEmail(args: {
  customerName: string;
  businessName: string;
  eventTitle: string;
  whenLabel: string;
  paidLabel: string;
  calendarLinks?: { google: string; outlook: string; ics: string };
}) {
  const calendarRow = args.calendarLinks
    ? `<p style="font-size:13px;margin:16px 0 0">Ajouter à mon calendrier :
        <a href="${e(args.calendarLinks.google)}" style="color:#6366f1">Google</a> ·
        <a href="${e(args.calendarLinks.outlook)}" style="color:#6366f1">Outlook</a> ·
        <a href="${e(args.calendarLinks.ics)}" style="color:#6366f1">Apple (.ics)</a></p>`
    : "";
  return layout("Réservation confirmée ✅", `
    <p>Bonjour ${e(args.customerName)},</p>
    <p>Votre réservation <strong>${e(args.eventTitle)}</strong> avec <strong>${e(args.businessName)}</strong> est confirmée.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${e(args.whenLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${e(args.paidLabel)}</td></tr>
    </table>
    ${calendarRow}
    <p style="color:#71717a;font-size:13px">À très bientôt !</p>
  `);
}

export function proNewBookingEmail(args: {
  businessName: string;
  eventTitle: string;
  whenLabel: string;
  customerName: string;
  customerEmail: string;
  fillLabel: string; // ex. "3/6 inscrits"
  paidLabel: string;
}) {
  return layout("Nouvelle réservation 📅", `
    <p>Bonjour ${e(args.businessName)},</p>
    <p>Nouvelle réservation pour <strong>${e(args.eventTitle)}</strong>.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${e(args.whenLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Client</td><td style="text-align:right">${e(args.customerName)} (${e(args.customerEmail)})</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Remplissage</td><td style="text-align:right">${e(args.fillLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${e(args.paidLabel)}</td></tr>
    </table>
  `);
}

export function packReceiptEmail(args: {
  customerName: string;
  businessName: string;
  packName: string;
  credits: number;
  amountCents: number;
}) {
  return layout("Merci pour votre achat 🎟️", `
    <p>Bonjour ${e(args.customerName)},</p>
    <p>Votre pack <strong>${e(args.packName)}</strong> auprès de <strong>${e(args.businessName)}</strong> est actif.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Crédits</td><td style="text-align:right">${args.credits} séance(s)</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Montant</td><td style="text-align:right">${euro(args.amountCents)}</td></tr>
    </table>
    <p style="color:#71717a;font-size:13px">Vous pouvez maintenant réserver vos créneaux sans repayer, dans la limite de vos crédits.</p>
  `);
}
```

- [ ] **Step 4: Remove the old templates and repoint the import**

In `src/lib/email.ts`, delete the `euro` constant and the functions `bookingConfirmationEmail`, `proNewBookingEmail` and `packReceiptEmail`. Keep `sendEmail` and `passwordResetEmail`, and keep the `/* Templates */` banner above `passwordResetEmail`.

In `src/lib/payments.ts`, the import block at lines 19-24 becomes:

```ts
import { sendEmail } from "@/lib/email";
import {
  bookingConfirmationEmail,
  packReceiptEmail,
  proNewBookingEmail,
} from "@/lib/booking-emails";
```

Keep any other name that the original block imported from `@/lib/email` in the first import.

- [ ] **Step 5: Run the tests and the type check**

Run: `./node_modules/.bin/tsx --test src/lib/booking-emails.test.ts`
Expected: PASS (3 tests).
Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

- [ ] **Step 6: Commit**

```bash
git add src/lib/booking-emails.ts src/lib/booking-emails.test.ts src/lib/email.ts src/lib/payments.ts
git commit -m "fix(email): escape customer and pro text in booking e-mails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gated mock checkout without open redirect

**Files:**
- Create: `src/lib/mock-redirect.ts`
- Create: `src/lib/mock-redirect.test.ts`
- Modify: `src/app/api/mock-checkout/route.ts`

**Interfaces:**
- Consumes: `env.STRIPE_ENABLED`, `env.APP_URL` from `@/lib/env`.
- Produces: `safeMockRedirect(value: string | null, appUrl: string): string`. It returns `value`, resolved against `appUrl`, when its origin equals `appUrl`'s origin, and `appUrl` otherwise.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mock-redirect.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { safeMockRedirect } from "./mock-redirect";

const APP = "https://myskedul.com";

test("keeps a same-origin success URL", () => {
  const ok = "https://myskedul.com/altinha-paris/merci?type=pack&ref=abc";
  assert.equal(safeMockRedirect(ok, APP), ok);
});

test("resolves a same-origin path", () => {
  assert.equal(safeMockRedirect("/altinha-paris/merci", APP), "https://myskedul.com/altinha-paris/merci");
});

test("refuses other origins, protocol-relative and script URLs", () => {
  assert.equal(safeMockRedirect("https://evil.example/x", APP), APP);
  assert.equal(safeMockRedirect("//evil.example/x", APP), APP);
  assert.equal(safeMockRedirect("javascript:alert(1)", APP), APP);
  assert.equal(safeMockRedirect(null, APP), APP);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/mock-redirect.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/mock-redirect.ts`:

```ts
/**
 * Where the mock checkout may send the browser once it has fulfilled an
 * order: the given success URL only when it stays on the app's own origin,
 * otherwise the app's home page (no open redirect).
 */
export function safeMockRedirect(value: string | null, appUrl: string): string {
  if (!value) return appUrl;
  try {
    const target = new URL(value, appUrl);
    return target.origin === new URL(appUrl).origin ? target.toString() : appUrl;
  } catch {
    return appUrl;
  }
}
```

- [ ] **Step 4: Gate the route and use the helper**

Replace the body of `src/app/api/mock-checkout/route.ts` with:

```ts
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { safeMockRedirect } from "@/lib/mock-redirect";
import { fulfillBooking, fulfillPackPurchase } from "@/lib/payments";

/**
 * Local stand-in for Stripe Checkout used when no live Stripe key is set.
 * Fulfills the order immediately, then redirects to the success page.
 * Disabled as soon as Stripe is configured: it would otherwise let anyone
 * mark a pending order as paid.
 */
export async function GET(request: Request) {
  if (env.STRIPE_ENABLED) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const ref = searchParams.get("ref");
  const redirectTo = safeMockRedirect(searchParams.get("redirect"), env.APP_URL);

  if (ref) {
    if (kind === "pack") await fulfillPackPurchase(ref);
    else if (kind === "booking") await fulfillBooking(ref);
  }

  return NextResponse.redirect(redirectTo);
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `./node_modules/.bin/tsx --test src/lib/mock-redirect.test.ts`
Expected: PASS (3 tests).
Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mock-redirect.ts src/lib/mock-redirect.test.ts src/app/api/mock-checkout/route.ts
git commit -m "fix(payments): mock checkout off when Stripe is live, no open redirect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: No Git auto-deploys, full verification, PR

**Files:**
- Modify: `vercel.ts`

**Interfaces:**
- None.

- [ ] **Step 1: Disable Git deployments for every branch**

In `vercel.ts`, replace the comment paragraph that starts with `` `git.deploymentEnabled: { main: false }` `` with:

```ts
 * `git.deploymentEnabled: false` disables Git auto-deploys on EVERY branch:
 * pushing never deploys (preview included). Deploy with the CLI only.
```

Then replace the `git` block with:

```ts
  git: {
    deploymentEnabled: false,
  },
```

AGENTS.md already says `vercel.ts` sets `git.deploymentEnabled: false`; leave it unchanged.

- [ ] **Step 2: Full checks**

Run, in order:
- `./node_modules/.bin/tsc --noEmit`, expecting no error;
- `./node_modules/.bin/eslint`, expecting no error;
- `./node_modules/.bin/tsx --test`, expecting all pass (one DB test skipped);
- `./node_modules/.bin/next build`, expecting a successful build.

- [ ] **Step 3: Browser check of the planning across DST**

1. Start the dev server: `preview_start` with name `skedul-p0`.
2. Sign in with the « Pro » one-click button on `/sign-in`.
3. Open `http://localhost:3100/dashboard/planning?week=2026-10-19` and click « Semaine suivante ».

Expected: the URL ends with `week=2026-10-26` and the header reads « 26 octobre – 1 novembre 2026 ».

Then open `?week=2026-03-30`, click « Semaine précédente », and expect `week=2026-03-23`. Take a screenshot of each.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add vercel.ts
git commit -m "chore(vercel): no Git auto-deploys on any branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin fix/p0-dst-hardening
gh pr create --base main --head fix/p0-dst-hardening --title "fix: DST-safe planning and slots, escaped e-mails, gated mock checkout" --body "$(cat <<'EOF'
Urgent fixes found while designing the tickets & events redesign (spec docs/superpowers/specs/2026-10-12-tickets-evenements-design.md, plan P0). Must be live before the 25 Oct 2026 DST change.

- Planning: "Semaine suivante" from the week of 19 Oct 2026 stayed on the same week (7x24h arithmetic). Weeks are now computed on local calendar dates; blocks sit on the wall clock on DST days.
- Slots: computeSlots walked now + n x 24h and skipped or repeated a day around DST; it now walks local dates. A 0-minute duration no longer loops forever.
- E-mails: customer names, titles and links are HTML-escaped in booking and pack e-mails.
- Mock checkout: 404 as soon as Stripe is live; redirects only to the app's own origin.
- vercel.ts: Git auto-deploys disabled on every branch (matches AGENTS.md).

Tests: new datetime, planning (DST weeks), availability (DST days), booking-emails and mock-redirect tests. tsc, eslint, tsx --test and next build are green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh` prints the PR URL. If `gh` is not authenticated, push succeeds anyway; report the compare URL `https://github.com/HELIK0PTER/skedul/compare/main...fix/p0-dst-hardening` to the owner.

---

### Task 9: PR for `ab56600`, merge, deploy (owner's go)

**Files:**
- None in this worktree. A temporary worktree is used for the cherry-pick.

**Interfaces:**
- None.

- [ ] **Step 1: PR for the admin quick-login commit**

From `C:\Users\Matheus\Documents\Codage\skedul`:

```powershell
git fetch origin
git worktree add -b chore/admin-quick-login .claude/worktrees/admin-quick-login origin/main
git -C .claude/worktrees/admin-quick-login cherry-pick ab56600
git -C .claude/worktrees/admin-quick-login push -u origin chore/admin-quick-login
gh pr create --repo HELIK0PTER/skedul --base main --head chore/admin-quick-login --title "feat(auth): one-click admin login off production, no demo credentials shown" --body "Cherry-pick of ab56600, which has only lived on the preview branch since 2026-10-11.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: the cherry-pick applies cleanly. It touches `AGENTS.md`, `README.md`, `scripts/seed.ts` and `src/components/auth/demo-quick-login.tsx`, none of which P0 changes. If it conflicts, stop and report.

Then remove the temporary worktree: `git worktree remove .claude/worktrees/admin-quick-login`. It has no `node_modules` junction, so a plain remove is safe.

- [ ] **Step 2: Ask the owner to merge, then deploy**

Ask in chat: « Les PR P0 et login admin sont prêtes. Je les merge et je déploie en prod ? » Wait for an explicit yes.

After the yes:

```powershell
gh pr merge fix/p0-dst-hardening --repo HELIK0PTER/skedul --merge
gh pr merge chore/admin-quick-login --repo HELIK0PTER/skedul --merge
```

Deploy from a clean worktree of the new `origin/main`. The main checkout is busy on `preview`. Copy `.vercel/project.json` into the worktree first:

```powershell
git fetch origin
git worktree add .claude/worktrees/deploy-main origin/main --detach
New-Item -ItemType Directory -Force .claude\worktrees\deploy-main\.vercel
Copy-Item .vercel\project.json .claude\worktrees\deploy-main\.vercel\project.json
cd .claude\worktrees\deploy-main
vercel --prod --yes
```

Expected: Vercel prints the production URL. Then check `https://myskedul.com/dashboard/planning?week=2026-10-19` with the owner's account, and confirm that « Semaine suivante » reaches `2026-10-26`. Remove the `deploy-main` worktree afterwards (`git worktree remove --force .claude/worktrees/deploy-main`).

- [ ] **Step 3: Sync the redesign branch**

In `.claude/worktrees/tickets`, rebase `feat/tickets-events` on the new `origin/main`:

```bash
git fetch origin && git rebase origin/main
```

Expected: no conflict, because the branch only adds docs at this point.
