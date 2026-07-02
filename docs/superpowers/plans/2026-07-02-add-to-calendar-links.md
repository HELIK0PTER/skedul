# « Ajouter à mon calendrier » (clients finaux) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After booking a slot, the end customer can add the appointment to Google Calendar, Outlook.com, or Apple Calendar (.ics) from the `/[slug]/merci` page and from the confirmation email.

**Architecture:** A pure link/ICS builder module (`src/lib/calendar-links.ts`) feeds three consumers: a public route handler that serves a generated `.ics` file (`/api/bookings/[id]/calendar.ics`), the server-rendered thank-you page, and the confirmation email template. No third-party library, no OAuth — plain web links and an RFC 5545 file.

**Tech Stack:** Next.js 16 App Router, Drizzle (Neon HTTP), `node:test` via `pnpm test` (tsx --test).

## Global Constraints

- Next.js 16: `params`/`searchParams` are **async** (`await params`).
- Tests: `node:test` + `node:assert/strict`, colocated `src/lib/<name>.test.ts`, run with `pnpm test`.
- All dates in links/ICS are UTC instants (`YYYYMMDDTHHMMSSZ`); never use the pro's timezone here.
- No customer data (name/email) in links or ICS — the route is unauthenticated (booking id = capability token, same model as `/merci?ref=`).
- Pack purchases (`type === "pack"`) get NO calendar buttons.
- UI: use `Button asChild` (custom `Slot`) for links, variant `secondary`, size `sm`.
- `pnpm typecheck` and `pnpm build` must stay green. No schema change, no migration.

---

## File Structure

- `src/lib/calendar-links.ts` — pure URL + ICS builders (create) + `.test.ts`.
- `src/app/api/bookings/[id]/calendar.ics/route.ts` — public ICS download (create).
- `src/app/[slug]/merci/page.tsx` — three calendar buttons for bookings (modify).
- `src/lib/email.ts` — optional `calendarLinks` block in `bookingConfirmationEmail` (modify).
- `src/lib/payments.ts` — build links in `fulfillBooking`, pass to the email (modify).

---

## Task 1: Pure calendar-link + ICS builders

**Files:**
- Create: `src/lib/calendar-links.ts`
- Test: `src/lib/calendar-links.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CalendarLinkInput {
    title: string;
    description: string;
    startAt: Date;
    endAt: Date;
  }
  export function googleCalendarUrl(input: CalendarLinkInput): string;
  export function outlookCalendarUrl(input: CalendarLinkInput): string;
  export function buildIcs(input: CalendarLinkInput & { uid: string }): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar-links.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
} from "./calendar-links";

const base = {
  title: "Coaching 1h",
  description: "Rendez-vous avec Altinha Paris",
  startAt: new Date("2026-07-03T12:00:00.000Z"),
  endAt: new Date("2026-07-03T13:00:00.000Z"),
};

test("googleCalendarUrl → render?action=TEMPLATE with UTC compact dates", () => {
  const url = new URL(googleCalendarUrl(base));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Coaching 1h");
  assert.equal(url.searchParams.get("details"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("dates"), "20260703T120000Z/20260703T130000Z");
});

test("outlookCalendarUrl → deeplink/compose with ISO dates", () => {
  const url = new URL(outlookCalendarUrl(base));
  assert.equal(
    url.origin + url.pathname,
    "https://outlook.live.com/calendar/0/deeplink/compose",
  );
  assert.equal(url.searchParams.get("rru"), "addevent");
  assert.equal(url.searchParams.get("subject"), "Coaching 1h");
  assert.equal(url.searchParams.get("body"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("startdt"), "2026-07-03T12:00:00.000Z");
  assert.equal(url.searchParams.get("enddt"), "2026-07-03T13:00:00.000Z");
});

test("buildIcs → valid VCALENDAR with CRLF lines and UID", () => {
  const ics = buildIcs({ ...base, uid: "bk_123@skedul.app" });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("UID:bk_123@skedul.app"));
  assert.ok(lines.includes("DTSTART:20260703T120000Z"));
  assert.ok(lines.includes("DTEND:20260703T130000Z"));
  assert.ok(lines.includes("SUMMARY:Coaching 1h"));
  assert.ok(lines.includes("END:VCALENDAR"));
  // file ends with a CRLF
  assert.ok(ics.endsWith("\r\n"));
});

test("buildIcs → escapes commas, semicolons and newlines in text", () => {
  const ics = buildIcs({
    ...base,
    uid: "bk_esc@skedul.app",
    title: "Yoga; doux, matin",
    description: "Ligne 1\nLigne 2",
  });
  assert.ok(ics.includes("SUMMARY:Yoga\\; doux\\, matin"));
  assert.ok(ics.includes("DESCRIPTION:Ligne 1\\nLigne 2"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `./calendar-links`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar-links.ts`:

```ts
export interface CalendarLinkInput {
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
}

/** 2026-07-03T12:00:00.000Z → 20260703T120000Z (RFC 5545 UTC form). */
function compactUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "Add to calendar" web link for Google Calendar. */
export function googleCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.description,
    dates: `${compactUtc(input.startAt)}/${compactUtc(input.endAt)}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** "Add to calendar" web link for Outlook.com. */
export function outlookCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    body: input.description,
    startdt: input.startAt.toISOString(),
    enddt: input.endAt.toISOString(),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Minimal RFC 5545 file for one event. DTSTAMP mirrors DTSTART to stay pure. */
export function buildIcs(input: CalendarLinkInput & { uid: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Skedul//Booking//FR",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${compactUtc(input.startAt)}`,
    `DTSTART:${compactUtc(input.startAt)}`,
    `DTEND:${compactUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
```

Note: no `import "server-only"` here — the module is pure and the merci page (a server component) plus the route both import it; keeping it environment-neutral also lets `tsx --test` load it directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS (4 new `calendar-links` tests + existing suites).

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar-links.ts src/lib/calendar-links.test.ts
git commit -m "feat(calendar): pure add-to-calendar link and ICS builders with tests"
```

---

## Task 2: Public ICS download route

**Files:**
- Create: `src/app/api/bookings/[id]/calendar.ics/route.ts`

**Interfaces:**
- Consumes: `buildIcs` from `@/lib/calendar-links` (Task 1); Drizzle `db`, `booking`/`eventType`/`professional` from `@/lib/db/schema`.
- Produces: `GET /api/bookings/:id/calendar.ics` → `200 text/calendar` attachment, or `404` when the booking is unknown or cancelled.

- [ ] **Step 1: Write the route handler**

Create `src/app/api/bookings/[id]/calendar.ics/route.ts`:

```ts
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, eventType, professional } from "@/lib/db/schema";
import { buildIcs } from "@/lib/calendar-links";

/**
 * Public ICS download for a booking. The booking id (unguessable) acts as
 * the capability token — same model as /merci?ref=. No customer data inside.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const rows = await db
    .select({
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      title: eventType.title,
      businessName: professional.businessName,
    })
    .from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .where(eq(booking.id, id))
    .limit(1);

  const b = rows[0];
  if (!b || b.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const ics = buildIcs({
    uid: `${id}@skedul.app`,
    title: b.title,
    description: `Rendez-vous avec ${b.businessName}`,
    startAt: b.startAt,
    endAt: b.endAt,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="rendez-vous.ics"',
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build succeeds; the route list includes `ƒ /api/bookings/[id]/calendar.ics`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/bookings/[id]/calendar.ics/route.ts"
git commit -m "feat(calendar): public ICS download route for a booking"
```

---

## Task 3: Buttons on the merci page

**Files:**
- Modify: `src/app/[slug]/merci/page.tsx`

**Interfaces:**
- Consumes: `googleCalendarUrl`/`outlookCalendarUrl` from `@/lib/calendar-links` (Task 1); the ICS route from Task 2; existing `Button` (`asChild`, `variant="secondary"`, `size="sm"`).

- [ ] **Step 1: Add the imports**

In `src/app/[slug]/merci/page.tsx`, extend the imports:

```ts
import { CalendarPlus, CheckCircle2, Ticket } from "lucide-react";

import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";
```

(Replace the existing `import { CheckCircle2, Ticket } from "lucide-react";` line.)

- [ ] **Step 2: Render the three links in the booking branch**

Inside `if (b) { detail = (...) }` (the `type === "booking"` branch), replace the JSX assigned to `detail` with:

```tsx
      const linkInput = {
        title: b.title,
        description: `Rendez-vous avec ${pro.businessName}`,
        startAt: b.booking.startAt,
        endAt: b.booking.endAt,
      };
      detail = (
        <>
          <p className="font-semibold">{b.title}</p>
          <p className="text-sm text-muted-foreground">
            {formatSlot(b.booking.startAt, b.booking.endAt, pro.timezone)}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarPlus className="size-3.5" />
              Ajouter à mon calendrier :
            </span>
            <Button asChild variant="secondary" size="sm">
              <a
                href={googleCalendarUrl(linkInput)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Agenda
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                href={outlookCalendarUrl(linkInput)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Outlook
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/bookings/${b.booking.id}/calendar.ics`}>
                Apple / .ics
              </a>
            </Button>
          </div>
        </>
      );
```

The pack branch (`type === "pack"`) stays untouched — no calendar buttons.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[slug]/merci/page.tsx"
git commit -m "feat(public): add-to-calendar buttons on the booking confirmation page"
```

---

## Task 4: Links in the confirmation email

**Files:**
- Modify: `src/lib/email.ts` (`bookingConfirmationEmail`)
- Modify: `src/lib/payments.ts` (`fulfillBooking`)

**Interfaces:**
- Consumes: `googleCalendarUrl`/`outlookCalendarUrl` from `@/lib/calendar-links` (Task 1); `env.APP_URL` (`@/lib/env`); the ICS route from Task 2.
- Produces: `bookingConfirmationEmail` gains an optional param
  `calendarLinks?: { google: string; outlook: string; ics: string }`.

- [ ] **Step 1: Extend the email template**

In `src/lib/email.ts`, change the `bookingConfirmationEmail` signature and body:

```ts
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
        <a href="${args.calendarLinks.google}" style="color:#6366f1">Google</a> ·
        <a href="${args.calendarLinks.outlook}" style="color:#6366f1">Outlook</a> ·
        <a href="${args.calendarLinks.ics}" style="color:#6366f1">Apple (.ics)</a></p>`
    : "";
  return layout("Réservation confirmée ✅", `
    <p>Bonjour ${args.customerName},</p>
    <p>Votre réservation <strong>${args.eventTitle}</strong> avec <strong>${args.businessName}</strong> est confirmée.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${args.whenLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${args.paidLabel}</td></tr>
    </table>
    ${calendarRow}
    <p style="color:#71717a;font-size:13px">À très bientôt !</p>
  `);
}
```

- [ ] **Step 2: Build the links in `fulfillBooking`**

In `src/lib/payments.ts`, add to the imports:

```ts
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";
import { env } from "@/lib/env";
```

Then in `fulfillBooking`, just before the customer `sendEmail` call, build the links and pass them:

```ts
  const linkInput = {
    title: row.eventType.title,
    description: `Rendez-vous avec ${row.professional.businessName}`,
    startAt: row.booking.startAt,
    endAt: row.booking.endAt,
  };
  const calendarLinks = {
    google: googleCalendarUrl(linkInput),
    outlook: outlookCalendarUrl(linkInput),
    ics: `${env.APP_URL}/api/bookings/${bookingId}/calendar.ics`,
  };
```

and in the existing `bookingConfirmationEmail({ ... })` call, add the property:

```ts
      paidLabel: /* unchanged */,
      calendarLinks,
```

The pro notification email (`proNewBookingEmail`) stays unchanged.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Manual end-to-end verification**

Run `pnpm dev`, book a free slot on `/altinha-paris`:
- On `/altinha-paris/merci?type=booking&ref=...`: the three buttons render; Google/Outlook open prefilled event forms in a new tab; « Apple / .ics » downloads `rendez-vous.ics` and it opens in a calendar app with the right title/times.
- Console shows the mock email log; re-trigger with `RESEND_API_KEY` unset confirms `calendarLinks` renders in the HTML (inspect the template output).
- `GET /api/bookings/does-not-exist/calendar.ics` → 404.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email.ts src/lib/payments.ts
git commit -m "feat(email): add-to-calendar links in the booking confirmation email"
```

---

## Self-Review

**Spec coverage:**
- Module pur + tests (spec §1) → Task 1.
- Route `.ics` publique, 404 si inconnu/annulé (spec §2) → Task 2.
- Page `/merci`, boutons booking uniquement (spec §3) → Task 3.
- Email avec `calendarLinks` optionnel, lien `.ics` absolu via `env.APP_URL` (spec §4) → Task 4.
- Vie privée : aucune donnée client dans liens/ICS → Tasks 1, 2 (description = « Rendez-vous avec {businessName} »).
- Non-objectifs respectés : pas de pack, pas de lib tierce, pas de champ lieu.

**Placeholder scan:** every code step shows the full code; the only "unchanged" marker (Task 4 Step 2 `paidLabel`) refers to a line explicitly shown in the current file and is a property-add instruction, not a placeholder.

**Type consistency:** `CalendarLinkInput` (Task 1) is the shape consumed in Tasks 2–4; `buildIcs` takes `& { uid: string }` and is only used in Task 2; `calendarLinks` prop shape in Task 4 matches the template param.
