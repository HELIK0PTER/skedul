# Google Calendar sync (Skedul → Google) — design

**Date:** 2026-06-29
**Status:** approved (brainstorming)
**Branch:** work continues on `main` (feat/planning-back-office already merged)

## Goal

From the dashboard **Réglages**, a professional connects their Google account so
that **every Skedul session is mirrored as an event in a dedicated "Skedul"
Google calendar**. One-way export (Skedul → Google). Cancelling/emptying a
session removes the Google event.

Non-goals (explicitly out of scope for this iteration):

- Importing Google busy times into Skedul availability (Google → Skedul).
- Two-way sync / conflict resolution.
- Real-time push from Google (watch channels), recurring-event expansion.
- Inviting customers as Google event attendees (Skedul already emails them via
  Resend — avoids double-notification).

## Key product decisions

- **Unit of export = `class_session`.** Every booking (incl. 1:1) flows through
  `claimSeat`, which creates/joins a session. A 1:1 is a capacity-1 session; a
  group class is one session with N seats. Exporting per session means **one**
  Google event per class (not one per attendee), updated as seats change.
- **Target = a dedicated "Skedul" secondary calendar**, created on connect.
  Keeps Skedul events separate from the pro's personal calendar; can be hidden
  in Google and wiped cleanly on disconnect.
- **Best-effort, event-driven.** Sync runs inline after each session mutation,
  wrapped in try/catch: a Google API failure is logged and never blocks a
  booking/cancellation. (A reconciliation cron can be added later as a backstop.)
- **Mock pattern like Stripe/Resend.** When `GOOGLE_CLIENT_ID`/`SECRET` are
  absent, `env.GOOGLE_CALENDAR_ENABLED` is false: the Réglages card shows a
  disabled "Connecter" + hint, and all sync calls are no-ops.

## Architecture

### 1. OAuth / connection (Better Auth)

Better Auth (`^1.6.19`) already stores OAuth tokens in the `account` table — no
new token table.

- Configure the Google social provider in `src/lib/auth.ts`:
  ```ts
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      accessType: "offline",
      prompt: "select_account consent", // force a refresh_token
    },
  }
  ```
- The pro (already signed in via email/password) links Google from Réglages:
  ```ts
  authClient.linkSocial({
    provider: "google",
    scopes: ["https://www.googleapis.com/auth/calendar"],
    callbackURL: "/dashboard/settings?google=connected",
  });
  ```
- Server reads a fresh (auto-refreshed) token via
  `auth.api.getAccessToken({ body: { providerId: "google", userId }, headers })`.
- On first successful connect, ensure the dedicated calendar exists and store its
  id on `professional.google_calendar_id`.
- **Disconnect**: unlink the Google account and clear
  `professional.google_calendar_id` (leave the Google calendar itself in place by
  default; deleting it is a later option).

### 2. Schema changes (2 columns, 1 migration)

- `professional.google_calendar_id text` — null = not connected/synced.
- `class_session.google_event_id text` — null = not yet pushed.

`pnpm db:generate` → `pnpm db:migrate`.

### 3. Google Calendar client — `src/lib/google-calendar.ts`

Thin `fetch` wrapper over the Calendar REST API (no `googleapis` dependency):

- `ensureSkedulCalendar(accessToken): Promise<string>` — `POST /calendars`
  (summary "Skedul") if not already stored; returns calendar id.
- `upsertSessionEvent(accessToken, calendarId, event)` — `POST`/`PATCH`
  `/calendars/{calId}/events[/ {eventId}]`; returns the Google event id.
- `deleteSessionEvent(accessToken, calendarId, eventId)` — `DELETE` (treat
  404/410 as already-gone).

Each call surfaces Google API errors for the caller to catch.

### 4. Sync orchestration — `src/lib/calendar-sync.ts`

Server-only. Resolves the pro's token + calendar id, builds the event payload,
calls the client, and persists `google_event_id`. All entry points are
**best-effort** (`try/catch`, log on failure, never throw to the caller).

- `syncSession(sessionId)` — upsert the event from current session state
  (start/end, event-type title, seats, attendee names in the description).
- `removeSession({ googleEventId, professionalId })` — delete the event.
- Guard: if `!env.GOOGLE_CALENDAR_ENABLED` or the pro has no
  `google_calendar_id`, return immediately (no-op).

**Call sites (existing code):**

- `src/server/public.ts` — after a public booking creates/joins a session →
  `syncSession`; on public cancellation → `syncSession` (seats changed) or
  `removeSession` (session emptied).
- `src/server/pro.ts` — manual booking, manual enrolment, session create,
  reschedule, capacity change → `syncSession`; cancellation/removal →
  `syncSession`/`removeSession`.

`claimSeat`/`releaseSeat` in `src/lib/sessions.ts` stay pure (no Google calls);
the server actions that call them trigger the sync afterwards, so the seat
counter logic is unchanged.

### 5. Event content

- **Summary:** event-type title; for capacity-1, append `· {customerName}`.
- **Start/End:** session `startAt`/`endAt` with the pro's `timezone`.
- **Description:** seats `booked/capacity`, attendee names/emails, and a
  "Géré par Skedul — ne pas modifier ici" footer.
- **No `attendees`** field (no Google invites), per decision above.

### 6. Environment / mock

Add to `src/lib/env.ts`:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (both optional).
- `GOOGLE_CALENDAR_ENABLED = !isPlaceholder(GOOGLE_CLIENT_ID) && !isPlaceholder(GOOGLE_CLIENT_SECRET)`.

Requires a Google Cloud OAuth client (consent screen + redirect URI
`{APP_URL}/api/auth/callback/google`) — documented in the implementation notes.

### 7. Settings UI

New `GoogleCalendarCard` (client) in Réglages, three states:

1. **Not configured** (`!GOOGLE_CALENDAR_ENABLED`): disabled "Connecter Google
   Agenda" + hint to set credentials.
2. **Disconnected** (`!professional.google_calendar_id`): "Connecter Google
   Agenda" → `linkSocial`.
3. **Connected**: shows the linked Google account email, plus "Resynchroniser"
   (re-push upcoming sessions) and "Déconnecter".

A server query exposes connection state (`google_calendar_id` + linked Google
`account` email) to the page.

## Data flow (happy path)

```
client books slot
  → public.ts: claimSeat() creates/joins class_session, inserts booking
  → public.ts: syncSession(sessionId)        [best-effort]
       → getAccessToken(google) [auto-refresh]
       → upsertSessionEvent(...) → Google event id
       → UPDATE class_session.google_event_id
  → booking confirmed regardless of Google outcome
```

## Error handling

- Sync failures are caught, logged with the session id, and swallowed — booking
  flows never fail because Google is down or a token is stale.
- `getAccessToken` handles refresh; if it throws (revoked/expired refresh
  token), treat the pro as effectively disconnected for that call and log.
- Delete treats 404/410 as success (event already gone).

## Testing

- Unit-test the event payload builder (`tsx --test`): title/description/seat
  formatting for 1:1 vs group, timezone handling.
- Unit-test `calendar-sync` guards: no-op when disabled or not connected.
- Mock the Google client (no live HTTP) in `calendar-sync` tests.
- Manual: connect with a real Google Cloud client in `development`, book a slot,
  verify the event appears in the "Skedul" calendar; cancel, verify it is
  removed.

## Rollout

1. Schema migration (2 columns).
2. env + auth provider config.
3. Google client + sync lib (+ unit tests).
4. Wire call sites in public.ts / pro.ts.
5. Settings UI + connection-state query.
6. Manual end-to-end verification with real credentials.

`pnpm typecheck` and `pnpm build` stay green throughout.
