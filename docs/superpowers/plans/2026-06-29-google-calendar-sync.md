# Google Calendar Sync (Skedul → Google) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a professional connect Google from Réglages so every Skedul session is mirrored as an event in a dedicated "Skedul" Google calendar (one-way export, best-effort).

**Architecture:** Better Auth's existing Google social-provider + `account` token storage gives us an auto-refreshed OAuth access token. A single server-only `syncSession(sessionId)` reconciler reads a session's current attendees and upserts/deletes one Google event per `class_session`, called best-effort from the booking-confirm path (`fulfillBooking`) and the back-office mutation paths. A thin `fetch` wrapper hits the Calendar REST API (no `googleapis` dependency).

**Tech Stack:** Next.js 16 App Router, Better Auth ^1.6.19, Drizzle (Neon HTTP), Google Calendar REST API v3, `node:test`.

## Global Constraints

- Next.js 16: `params`/`searchParams` are async (`await`).
- Server Actions in `src/server/*.ts` (`"use server"`); read-only queries in `queries.ts` (`import "server-only"`).
- DB: Drizzle + Neon HTTP — **no interactive transactions**.
- Sync is **best-effort**: a Google failure is caught + logged and MUST NEVER throw into a booking/cancel flow.
- Mock pattern: when credentials absent, `env.GOOGLE_CALENDAR_ENABLED` is false → connect button disabled, all sync calls no-op (mirrors `STRIPE_ENABLED`/`RESEND_ENABLED`).
- Export unit is `class_session` (one event per session, not per attendee). No Google attendee invites.
- `pnpm typecheck` and `pnpm build` must stay green. Schema change → `pnpm db:generate` then `pnpm db:migrate`.
- Tests use `node:test` + `node:assert/strict`, colocated as `src/lib/<name>.test.ts`, run with `pnpm test`.

---

## File Structure

- `src/lib/db/schema.ts` — add 2 columns (modify).
- `src/lib/env.ts` — add Google credentials + `GOOGLE_CALENDAR_ENABLED` (modify).
- `src/lib/auth.ts` — add Google social provider (modify).
- `src/lib/google-event.ts` — **pure** event-payload builder (create) + `.test.ts`.
- `src/lib/google-calendar.ts` — thin REST client over Calendar API (create).
- `src/lib/calendar-sync.ts` — `syncSession` / token+calendar resolution (create) + `.test.ts`.
- `src/lib/payments.ts` — trigger sync on booking confirm (modify).
- `src/server/pro.ts` — trigger sync on cancel / reschedule / capacity change (modify).
- `src/server/queries.ts` — `getGoogleConnection` read query (modify).
- `src/server/pro.ts` — `finalizeGoogleConnection` / `disconnectGoogleCalendar` actions (modify).
- `src/components/dashboard/google-calendar-card.tsx` — Réglages UI (create).
- `src/app/dashboard/settings/page.tsx` — render the card (modify).

---

## Task 1: Schema — session + professional calendar columns

**Files:**
- Modify: `src/lib/db/schema.ts` (`professional` table ~line 137, `classSession` table ~line 184)
- Generated: `drizzle/` migration

**Interfaces:**
- Produces: `professional.googleCalendarId: text | null`, `classSession.googleEventId: text | null`.

- [ ] **Step 1: Add the column to `professional`**

In `src/lib/db/schema.ts`, inside the `professional` table definition, after the `stripeAccountId` line:

```ts
    stripeAccountId: text("stripe_account_id"),
    googleCalendarId: text("google_calendar_id"),
```

- [ ] **Step 2: Add the column to `classSession`**

In the `classSession` table definition, after the `seatsRemaining` line:

```ts
    seatsRemaining: integer("seats_remaining").notNull(),
    googleEventId: text("google_event_id"),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `drizzle/` adding `google_calendar_id` and `google_event_id` columns.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: migration applies cleanly to `DATABASE_URL` (development branch).

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts drizzle
git commit -m "feat(db): add google_calendar_id and google_event_id columns"
```

---

## Task 2: Environment — Google credentials + enabled flag

**Files:**
- Modify: `src/lib/env.ts`

**Interfaces:**
- Produces: `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, `env.GOOGLE_CALENDAR_ENABLED: boolean`.

- [ ] **Step 1: Add the schema keys**

In `src/lib/env.ts`, inside the zod `schema` object (after `BLOB_READ_WRITE_TOKEN`):

```ts
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
```

- [ ] **Step 2: Add the derived flag**

In the exported `env` object, after the `BLOB_ENABLED` line:

```ts
  BLOB_ENABLED: !isPlaceholder(raw.BLOB_READ_WRITE_TOKEN),
  /** Google Calendar sync is live once an OAuth client is configured. */
  GOOGLE_CALENDAR_ENABLED:
    !isPlaceholder(raw.GOOGLE_CLIENT_ID) &&
    !isPlaceholder(raw.GOOGLE_CLIENT_SECRET),
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts
git commit -m "feat(env): add Google OAuth credentials and GOOGLE_CALENDAR_ENABLED flag"
```

---

## Task 3: Better Auth — Google social provider

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, `env.GOOGLE_CALENDAR_ENABLED`.
- Produces: a `google` social provider that issues a refresh token; enables `auth.api.getAccessToken({ providerId: "google" })` and `linkSocial`/`unlinkAccount` for Google.

- [ ] **Step 1: Configure the provider conditionally**

In `src/lib/auth.ts`, add the import line is not needed. Add a `socialProviders` block to the `betterAuth({...})` config, after the `emailAndPassword` block:

```ts
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  socialProviders: env.GOOGLE_CALENDAR_ENABLED
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          // Force Google to return a refresh_token even on re-consent.
          accessType: "offline",
          prompt: "select_account consent",
        },
      }
    : undefined,
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(auth): configure Google social provider with offline access"
```

---

## Task 4: Pure event-payload builder

A pure, DB-free function that turns session facts into a Google event body. This is the unit-testable core (timezone, title, seat/attendee description).

**Files:**
- Create: `src/lib/google-event.ts`
- Test: `src/lib/google-event.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GoogleEventBody {
    summary: string;
    description: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  }
  export interface SessionEventInput {
    eventTitle: string;
    startAt: Date;
    endAt: Date;
    capacity: number;
    timezone: string;
    attendees: { name: string; email: string }[];
  }
  export function buildSessionEvent(input: SessionEventInput): GoogleEventBody;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/google-event.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionEvent } from "./google-event";

const base = {
  startAt: new Date("2026-07-03T12:00:00.000Z"),
  endAt: new Date("2026-07-03T13:00:00.000Z"),
  timezone: "Europe/Paris",
};

test("1:1 session → summary appends the single attendee name", () => {
  const ev = buildSessionEvent({
    ...base,
    eventTitle: "Coaching 1h",
    capacity: 1,
    attendees: [{ name: "Alice", email: "alice@example.com" }],
  });
  assert.equal(ev.summary, "Coaching 1h · Alice");
  assert.equal(ev.start.dateTime, "2026-07-03T12:00:00.000Z");
  assert.equal(ev.start.timeZone, "Europe/Paris");
  assert.match(ev.description, /alice@example\.com/);
  assert.match(ev.description, /Géré par Skedul/);
});

test("group session → summary stays the title, description shows seat count", () => {
  const ev = buildSessionEvent({
    ...base,
    eventTitle: "Yoga collectif",
    capacity: 10,
    attendees: [
      { name: "Alice", email: "a@x.com" },
      { name: "Bob", email: "b@x.com" },
    ],
  });
  assert.equal(ev.summary, "Yoga collectif");
  assert.match(ev.description, /2\/10/);
  assert.match(ev.description, /Alice/);
  assert.match(ev.description, /Bob/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./google-event`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/google-event.ts`:

```ts
export interface GoogleEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export interface SessionEventInput {
  eventTitle: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: { name: string; email: string }[];
}

const FOOTER = "Géré par Skedul — ne pas modifier ici.";

/** Builds the Google Calendar event body for a class session (pure). */
export function buildSessionEvent(input: SessionEventInput): GoogleEventBody {
  const oneToOne = input.capacity === 1;
  const summary =
    oneToOne && input.attendees[0]
      ? `${input.eventTitle} · ${input.attendees[0].name}`
      : input.eventTitle;

  const lines: string[] = [];
  if (!oneToOne) {
    lines.push(`Places : ${input.attendees.length}/${input.capacity}`);
  }
  for (const a of input.attendees) {
    lines.push(`• ${a.name} (${a.email})`);
  }
  lines.push("", FOOTER);

  return {
    summary,
    description: lines.join("\n"),
    start: {
      dateTime: input.startAt.toISOString(),
      timeZone: input.timezone,
    },
    end: {
      dateTime: input.endAt.toISOString(),
      timeZone: input.timezone,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (both `google-event` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-event.ts src/lib/google-event.test.ts
git commit -m "feat(calendar): pure Google event-body builder with tests"
```

---

## Task 5: Google Calendar REST client

Thin `fetch` wrapper. Network-only; verified manually in Task 10. No unit test (no live HTTP in CI).

**Files:**
- Create: `src/lib/google-calendar.ts`

**Interfaces:**
- Consumes: `GoogleEventBody` from `./google-event`.
- Produces:
  ```ts
  export function createSkedulCalendar(accessToken: string): Promise<string>; // returns calendarId
  export function insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<string>; // returns eventId
  export function patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<void>;
  export function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the implementation**

Create `src/lib/google-calendar.ts`:

```ts
import "server-only";

import type { GoogleEventBody } from "@/lib/google-event";

const API = "https://www.googleapis.com/calendar/v3";

async function call(
  accessToken: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return res;
}

async function ensureOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Calendar ${action} failed (${res.status}): ${text}`);
  }
}

/** Creates the dedicated "Skedul" secondary calendar; returns its id. */
export async function createSkedulCalendar(
  accessToken: string,
): Promise<string> {
  const res = await call(accessToken, "/calendars", {
    method: "POST",
    body: { summary: "Skedul" },
  });
  await ensureOk(res, "create calendar");
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEventBody,
): Promise<string> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body },
  );
  await ensureOk(res, "insert event");
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body },
  );
  await ensureOk(res, "patch event");
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // 404/410 = already gone → treat as success.
  if (res.status === 404 || res.status === 410) return;
  await ensureOk(res, "delete event");
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar.ts
git commit -m "feat(calendar): Google Calendar REST client (fetch wrapper)"
```

---

## Task 6: `syncSession` orchestration + guards

Single best-effort entry point. Loads session state, resolves token + calendar, and upserts or deletes the event. The guard logic (disabled / not-connected → no-op) is unit-tested by injecting a fake DB/loader; the network path is covered manually.

**Files:**
- Create: `src/lib/calendar-sync.ts`
- Test: `src/lib/calendar-sync.test.ts`

**Interfaces:**
- Consumes: `env.GOOGLE_CALENDAR_ENABLED`; `buildSessionEvent`; `insertEvent`/`patchEvent`/`deleteEvent`; `auth.api.getAccessToken`; Drizzle `db`.
- Produces:
  ```ts
  export interface SyncDeps { /* injectable for tests */ }
  export function syncSession(sessionId: string, deps?: Partial<SyncDeps>): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test (guards only — no network)**

Create `src/lib/calendar-sync.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { syncSessionWith } from "./calendar-sync";

// A session loader that returns a connected pro with one attendee.
const connectedSession = {
  sessionId: "s1",
  professionalId: "p1",
  userId: "u1",
  googleCalendarId: "cal1",
  googleEventId: null as string | null,
  eventTitle: "Coaching",
  startAt: new Date("2026-07-03T12:00:00Z"),
  endAt: new Date("2026-07-03T13:00:00Z"),
  capacity: 1,
  timezone: "Europe/Paris",
  attendees: [{ name: "Alice", email: "a@x.com" }],
};

function makeDeps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      enabled: true,
      loadSession: async () => connectedSession,
      getAccessToken: async () => "tok",
      insertEvent: async () => {
        calls.push("insert");
        return "ev1";
      },
      patchEvent: async () => {
        calls.push("patch");
      },
      deleteEvent: async () => {
        calls.push("delete");
      },
      saveEventId: async () => {
        calls.push("save");
      },
      ...over,
    },
  };
}

test("disabled → no network calls", async () => {
  const { calls, deps } = makeDeps({ enabled: false });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, []);
});

test("connected pro, no existing event → insert then save id", async () => {
  const { calls, deps } = makeDeps();
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["insert", "save"]);
});

test("existing event → patch (no insert)", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({ ...connectedSession, googleEventId: "ev1" }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["patch"]);
});

test("no active attendees + existing event → delete", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({
      ...connectedSession,
      googleEventId: "ev1",
      attendees: [],
    }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["delete", "save"]);
});

test("pro not connected (no calendar id) → no calls", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({ ...connectedSession, googleCalendarId: null }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./calendar-sync`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar-sync.ts`:

```ts
import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, classSession, customer, eventType, professional } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { buildSessionEvent } from "@/lib/google-event";
import {
  deleteEvent as gDeleteEvent,
  insertEvent as gInsertEvent,
  patchEvent as gPatchEvent,
} from "@/lib/google-calendar";

interface LoadedSession {
  sessionId: string;
  professionalId: string;
  userId: string;
  googleCalendarId: string | null;
  googleEventId: string | null;
  eventTitle: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: { name: string; email: string }[];
}

export interface SyncDeps {
  enabled: boolean;
  loadSession: (sessionId: string) => Promise<LoadedSession | null>;
  getAccessToken: (userId: string) => Promise<string>;
  insertEvent: (token: string, calId: string, body: ReturnType<typeof buildSessionEvent>) => Promise<string>;
  patchEvent: (token: string, calId: string, eventId: string, body: ReturnType<typeof buildSessionEvent>) => Promise<void>;
  deleteEvent: (token: string, calId: string, eventId: string) => Promise<void>;
  saveEventId: (sessionId: string, eventId: string | null) => Promise<void>;
}

/** Loads a session with its active attendees + the pro's Google connection. */
async function loadSession(sessionId: string): Promise<LoadedSession | null> {
  const rows = await db
    .select({
      sessionId: classSession.id,
      professionalId: classSession.professionalId,
      userId: professional.userId,
      googleCalendarId: professional.googleCalendarId,
      googleEventId: classSession.googleEventId,
      eventTitle: eventType.title,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
      timezone: professional.timezone,
    })
    .from(classSession)
    .innerJoin(professional, eq(professional.id, classSession.professionalId))
    .innerJoin(eventType, eq(eventType.id, classSession.eventTypeId))
    .where(eq(classSession.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const attendees = await db
    .select({ name: customer.name, email: customer.email, status: booking.status })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(eq(booking.sessionId, sessionId));

  return {
    ...row,
    attendees: attendees
      .filter((a) => a.status === "pending" || a.status === "confirmed")
      .map((a) => ({ name: a.name, email: a.email })),
  };
}

async function getAccessToken(userId: string): Promise<string> {
  const { accessToken } = await auth.api.getAccessToken({
    body: { providerId: "google", userId },
  });
  return accessToken;
}

async function saveEventId(sessionId: string, eventId: string | null): Promise<void> {
  await db
    .update(classSession)
    .set({ googleEventId: eventId })
    .where(eq(classSession.id, sessionId));
}

const defaultDeps: SyncDeps = {
  enabled: env.GOOGLE_CALENDAR_ENABLED,
  loadSession,
  getAccessToken,
  insertEvent: gInsertEvent,
  patchEvent: gPatchEvent,
  deleteEvent: gDeleteEvent,
  saveEventId,
};

/** Testable core: reconcile one session against Google with injected deps. */
export async function syncSessionWith(
  sessionId: string,
  deps: SyncDeps,
): Promise<void> {
  if (!deps.enabled) return;
  const s = await deps.loadSession(sessionId);
  if (!s || !s.googleCalendarId) return;

  const token = await deps.getAccessToken(s.userId);

  // No active attendees → remove the event if one exists.
  if (s.attendees.length === 0) {
    if (s.googleEventId) {
      await deps.deleteEvent(token, s.googleCalendarId, s.googleEventId);
      await deps.saveEventId(sessionId, null);
    }
    return;
  }

  const body = buildSessionEvent({
    eventTitle: s.eventTitle,
    startAt: s.startAt,
    endAt: s.endAt,
    capacity: s.capacity,
    timezone: s.timezone,
    attendees: s.attendees,
  });

  if (s.googleEventId) {
    await deps.patchEvent(token, s.googleCalendarId, s.googleEventId, body);
  } else {
    const eventId = await deps.insertEvent(token, s.googleCalendarId, body);
    await deps.saveEventId(sessionId, eventId);
  }
}

/** Best-effort public entry point — never throws into a booking flow. */
export async function syncSession(sessionId: string): Promise<void> {
  try {
    await syncSessionWith(sessionId, defaultDeps);
  } catch (err) {
    console.error(`[calendar-sync] session ${sessionId} failed:`, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (5 `calendar-sync` tests + existing suites).

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar-sync.ts src/lib/calendar-sync.test.ts
git commit -m "feat(calendar): syncSession reconciler with injectable deps + guard tests"
```

---

## Task 7: Trigger sync on booking confirmation

`fulfillBooking` is the single idempotent confirm path (paid via webhook/mock-checkout, free, and credit bookings all funnel here). Push the session after confirming.

**Files:**
- Modify: `src/lib/payments.ts` (`fulfillBooking`, after the confirmation update)

**Interfaces:**
- Consumes: `syncSession` from `@/lib/calendar-sync`.

- [ ] **Step 1: Import the reconciler**

At the top of `src/lib/payments.ts`, add to the imports:

```ts
import { syncSession } from "@/lib/calendar-sync";
```

- [ ] **Step 2: Call sync after the booking is confirmed**

In `fulfillBooking`, the function already early-returns when `row.booking.status === "confirmed"`. After the `db.update(booking).set({ status: "confirmed" })` call (around line 91), add:

```ts
  await db
    .update(booking)
    .set({ status: "confirmed" })
    .where(eq(booking.id, bookingId));

  if (row.booking.sessionId) await syncSession(row.booking.sessionId);
```

(`syncSession` is best-effort and never throws, so it is safe before the emails.)

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments.ts
git commit -m "feat(calendar): push session to Google when a booking is confirmed"
```

---

## Task 8: Trigger sync on cancel / reschedule / capacity change

Each back-office mutation that changes a session's attendees or timing must re-reconcile. After `releaseSeat`, the session still exists (seat returned); `syncSession` will patch the seat count or delete the event when the session empties.

**Files:**
- Modify: `src/server/pro.ts` (cancellation paths near lines 532 & 585; capacity change near line 499; any reschedule action)

**Interfaces:**
- Consumes: `syncSession` from `@/lib/calendar-sync`.

- [ ] **Step 1: Import the reconciler**

At the top of `src/server/pro.ts`, add:

```ts
import { syncSession } from "@/lib/calendar-sync";
```

- [ ] **Step 2: Sync after each cancellation**

At each cancellation site that currently does `if (b.sessionId) await releaseSeat(b.sessionId);`, append a sync of the same session:

```ts
  if (b.sessionId) {
    await releaseSeat(b.sessionId);
    await syncSession(b.sessionId);
  }
```

Apply to both occurrences (~line 532 and ~line 585).

- [ ] **Step 3: Sync after a capacity change**

After the `db.update(classSession).set({ seatsRemaining: ... })` capacity-change statement (~line 499), add a sync. Use the session id available in that action (the variable holding the session row id — e.g. `sessionId`):

```ts
  await syncSession(sessionId);
```

- [ ] **Step 4: Sync after a session reschedule (if such an action exists)**

If `pro.ts` has an action that updates `classSession.startAt`/`endAt` (reschedule), add `await syncSession(<sessionId>)` after the update. If no reschedule action exists, skip this step (no placeholder code to add).

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/server/pro.ts
git commit -m "feat(calendar): re-sync sessions on cancel and capacity change"
```

---

## Task 9: Connection state query + connect/disconnect actions

**Files:**
- Modify: `src/server/queries.ts` (add `getGoogleConnection`)
- Modify: `src/server/pro.ts` (add `finalizeGoogleConnection`, `disconnectGoogleCalendar`)

**Interfaces:**
- Produces:
  ```ts
  // queries.ts
  export function getGoogleConnection(pro: { id: string; userId: string }): Promise<{
    configured: boolean;     // env.GOOGLE_CALENDAR_ENABLED
    connected: boolean;      // professional.googleCalendarId != null
    accountEmail: string | null; // linked Google account email, if any
    linked: boolean;         // a google account row exists
  }>;
  // pro.ts
  export function finalizeGoogleConnection(): Promise<{ ok: boolean; error?: string }>;
  export function disconnectGoogleCalendar(): Promise<{ ok: boolean }>;
  ```

- [ ] **Step 1: Add `getGoogleConnection` to queries.ts**

In `src/server/queries.ts`, ensure `account`, `professional`, and `user` are imported from `@/lib/db/schema` (add any missing), and add:

```ts
export async function getGoogleConnection(pro: { id: string; userId: string }) {
  const proRows = await db
    .select({ googleCalendarId: professional.googleCalendarId })
    .from(professional)
    .where(eq(professional.id, pro.id))
    .limit(1);

  const acct = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.userId, pro.userId), eq(account.providerId, "google")),
    )
    .limit(1);

  const linkedEmail = acct.length
    ? (
        await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, pro.userId))
          .limit(1)
      )[0]?.email ?? null
    : null;

  return {
    configured: env.GOOGLE_CALENDAR_ENABLED,
    connected: !!proRows[0]?.googleCalendarId,
    linked: acct.length > 0,
    accountEmail: linkedEmail,
  };
}
```

Add `import { env } from "@/lib/env";` to `queries.ts` if not already present.

- [ ] **Step 2: Add the server actions to pro.ts**

In `src/server/pro.ts`, add (these are server actions in a `"use server"` file):

```ts
import { headers } from "next/headers";
import { createSkedulCalendar } from "@/lib/google-calendar";

/** After the Google OAuth redirect: create the Skedul calendar + store its id. */
export async function finalizeGoogleConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const pro = await getCurrentProfessional();
  if (!pro) return { ok: false, error: "Non authentifié." };
  if (!env.GOOGLE_CALENDAR_ENABLED) return { ok: false, error: "Désactivé." };

  // Already connected → idempotent success.
  const existing = await db
    .select({ id: professional.googleCalendarId })
    .from(professional)
    .where(eq(professional.id, pro.id))
    .limit(1);
  if (existing[0]?.id) return { ok: true };

  try {
    const { accessToken } = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers: await headers(),
    });
    const calendarId = await createSkedulCalendar(accessToken);
    await db
      .update(professional)
      .set({ googleCalendarId: calendarId })
      .where(eq(professional.id, pro.id));
    return { ok: true };
  } catch (err) {
    console.error("[google] finalize connection failed:", err);
    return { ok: false, error: "Connexion à Google impossible." };
  }
}

/** Unlink Google and stop syncing (the Skedul calendar is left in place). */
export async function disconnectGoogleCalendar(): Promise<{ ok: boolean }> {
  const pro = await getCurrentProfessional();
  if (!pro) return { ok: false };
  try {
    await auth.api.unlinkAccount({
      body: { providerId: "google" },
      headers: await headers(),
    });
  } catch (err) {
    console.error("[google] unlink failed:", err);
  }
  await db
    .update(professional)
    .set({ googleCalendarId: null })
    .where(eq(professional.id, pro.id));
  return { ok: true };
}
```

Ensure `pro.ts` already imports `auth` (`@/lib/auth`), `db`, `professional`, `env`, `getCurrentProfessional`, `eq` — add any that are missing.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries.ts src/server/pro.ts
git commit -m "feat(calendar): Google connection query + finalize/disconnect actions"
```

---

## Task 10: Réglages UI — Google Calendar card

**Files:**
- Create: `src/components/dashboard/google-calendar-card.tsx`
- Modify: `src/app/dashboard/settings/page.tsx`

**Interfaces:**
- Consumes: `getGoogleConnection` (queries.ts), `finalizeGoogleConnection`/`disconnectGoogleCalendar` (pro.ts), `authClient.linkSocial` (`@/lib/auth-client`).

- [ ] **Step 1: Create the client card**

Create `src/components/dashboard/google-calendar-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { CalendarCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { finalizeGoogleConnection, disconnectGoogleCalendar } from "@/server/pro";

export function GoogleCalendarCard(props: {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  // After the OAuth redirect, finalize (create the Skedul calendar) once.
  useEffect(() => {
    if (params.get("google") === "connected") {
      finalizeGoogleConnection().then(() => {
        router.replace("/dashboard/settings");
      });
    }
  }, [params, router]);

  const connect = async () => {
    setBusy(true);
    await authClient.linkSocial({
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar"],
      callbackURL: "/dashboard/settings?google=connected",
    });
  };

  const disconnect = async () => {
    setBusy(true);
    await disconnectGoogleCalendar();
    setBusy(false);
    router.refresh();
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="size-5 text-primary" />
          Google Agenda
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Vos séances Skedul apparaissent dans un agenda « Skedul » dédié.
        </p>
      </CardHeader>
      <CardContent>
        {!props.configured ? (
          <div className="space-y-2">
            <Button disabled>Connecter Google Agenda</Button>
            <p className="text-xs text-muted-foreground">
              La synchronisation n'est pas encore configurée sur ce déploiement.
            </p>
          </div>
        ) : props.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Connecté
              {props.accountEmail ? (
                <span className="text-muted-foreground"> · {props.accountEmail}</span>
              ) : null}
            </p>
            <Button variant="outline" onClick={disconnect} disabled={busy}>
              Déconnecter
            </Button>
          </div>
        ) : (
          <Button onClick={connect} disabled={busy}>
            Connecter Google Agenda
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render the card in Réglages**

In `src/app/dashboard/settings/page.tsx`, add the imports:

```ts
import { GoogleCalendarCard } from "@/components/dashboard/google-calendar-card";
import { getGoogleConnection } from "@/server/queries";
```

Load the connection state after `const pro = (await getCurrentProfessional())!;`:

```ts
  const pro = (await getCurrentProfessional())!;
  const google = await getGoogleConnection({ id: pro.id, userId: pro.userId });
```

And render the card after the "Identité visuelle" card and before the "Session" card:

```tsx
      <GoogleCalendarCard
        configured={google.configured}
        connected={google.connected}
        accountEmail={google.accountEmail}
      />
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors. (If `pro.userId` is not on the session-professional type, fetch it in `getGoogleConnection` by `professional.id` instead — adjust the signature to take only `{ id }` and read `userId` from the `professional` row.)

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Manual end-to-end verification**

Prereq: a Google Cloud OAuth client with redirect URI `http://localhost:3000/api/auth/callback/google`, Calendar API enabled, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`.

Run: `pnpm dev`, sign in as the demo pro, go to Réglages → "Connecter Google Agenda", approve consent. Then:
- Verify a "Skedul" calendar now exists in Google Calendar.
- Book a slot on the public page; verify an event appears in the "Skedul" calendar with the right time/title.
- Cancel the booking from the back-office; verify the event is removed (or seat count updated for a group session).
- Click "Déconnecter"; verify the card returns to the disconnected state.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/google-calendar-card.tsx src/app/dashboard/settings/page.tsx
git commit -m "feat(settings): Google Agenda connection card"
```

---

## Self-Review

**Spec coverage:**
- OAuth/connection (spec §1) → Tasks 3, 9, 10.
- Schema (spec §2) → Task 1.
- Google client (spec §3) → Task 5.
- Sync orchestration + call sites (spec §4) → Tasks 6, 7, 8.
- Event content (spec §5) → Task 4.
- Env/mock (spec §6) → Task 2.
- Settings UI (spec §7) → Task 10.
- Error handling (best-effort, 404/410, refresh) → Tasks 5, 6.
- Testing → Tasks 4, 6 (unit), Task 10 (manual e2e).

**Placeholder scan:** Task 8 Step 4 is conditional ("if such an action exists") because the reschedule action's existence must be confirmed in code — it instructs to skip rather than insert placeholder code. All other steps contain concrete code/commands.

**Type consistency:** `buildSessionEvent`/`GoogleEventBody`/`SessionEventInput` (Task 4) are reused verbatim in Tasks 5 & 6. `syncSession` (Tasks 6) is the symbol imported in Tasks 7 & 8. `getGoogleConnection` return shape (Task 9) matches the props consumed in Task 10. `finalizeGoogleConnection`/`disconnectGoogleCalendar` signatures (Task 9) match the calls in Task 10.

**Open verification during execution:** confirm `auth.api.unlinkAccount` is the correct Better Auth call for this version (Task 9); confirm whether `pro.userId` is exposed on the session-professional object or must be read from the DB row (Task 10 Step 3 notes the fallback).
```
