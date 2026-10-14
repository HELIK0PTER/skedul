# P3 « Back-office pro » — Architecture contract

Status: binding for the six plan writers (G1 to G6). Copy names, types, paths, French copy and task
numbers verbatim. Where this contract and the spec disagree, the spec wins only if the controller
says so; where this contract and `rulings.md` disagree, `rulings.md` wins.

- Spec (binding): `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` (§§ 2, 7, 8, 9,
  11 E2, E6 to E8, E13, 12, 13.1, 13.4 to 13.9, 14, 15.1).
- P2 outcome (rulings, carry notes): `docs/superpowers/plans/2026-10-12-p2-domaine-outcome.md`.
- Engine API: `src/lib/booking/*` at `04f6667` (verified for this contract; signatures quoted below
  are the real ones).
- Plan format model: `docs/superpowers/plans/2026-10-12-p2-domaine.md` (header, Global Constraints,
  Review Focus, File map, then tasks with Files / Interfaces / checkbox Steps).

Notation: C = create, M = modify, D = delete. « … » = exact French UI copy. `DateKey` = "YYYY-MM-DD"
(`src/lib/civil-date.ts`). "pro tz" = `professional.timezone`.

---

## 1. Global Constraints

Put these lines verbatim at the top of every P3 plan file.

- **Spec (binding):** `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md`, §§ 2, 4, 7, 8, 9, 11 (E2, E6, E7, E8, E13), 12, 13.1, 13.4–13.9, 14, 15.1. **Rulings:** the P3 planning rulings (controller, 2026-10-14) and this contract.
- **Worktree:** `C:/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets`, branch `feat/tickets-events`. `node_modules` is a junction to the main checkout. Every Bash command starts with `cd /c/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets && ` (a multi-line block starts with `cd /c/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets || exit 1`). Read, Edit and Write use absolute worktree paths `C:/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets/<path>`, never the main checkout.
- **Never** run `pnpm install` or `pnpm <script>` inside the worktree. Call `./node_modules/.bin/{tsx,tsc,eslint,next,drizzle-kit}` directly.
- **Typecheck:** `./node_modules/.bin/tsc --noEmit`
- **Lint (touched files only):** `./node_modules/.bin/eslint <every file created or modified by the task>` → no error, no warning.
- **Pure tests:** `./node_modules/.bin/tsx --test 'src/**/!(*.db).test.ts'`
- **DB tests, one file:** `./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none <path>.db.test.ts`
- **DB tests, all (group ends and Task 43):** `./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none --test-timeout=300000 'src/**/*.db.test.ts'`, run in ONE process, in the background (`run_in_background`) or with a timeout ≥ 1 500 000 ms; never capped below its runtime.
- **Build:** `./node_modules/.bin/next build` (uses the worktree `.env.local` → tickets-dev).
- **Every task ends green:** tsc, eslint on its files, all pure tests, the DB test files the task creates or modifies, `next build`. Tasks 8, 13, 20, 29, 38 and 43 also run the full DB suite.
- **Neon:** only `tickets-dev` (worktree `.env.local`, demo data from seed v2) and `tickets-test` (`.env.test`). Never `main`, `development` or `preview`. Neon MCP calls always pass `project_id` AND `branch_id`; never print a connection string.
- **Migrations:** P3 needs **none** (every column it uses exists since 0011). Never run `db:migrate` or `db:push`. If a task proves a migration is required, it stops and reports to the controller: generation would be `./node_modules/.bin/drizzle-kit generate --name=<name>`, application `./node_modules/.bin/tsx scripts/apply-migration.ts drizzle/<file>.sql` on tickets-dev, then tickets-test.
- **Engine:** `src/lib/booking/*` keeps its rules (no `server-only`, `db` first, `now` last before test-only `opts`). P3 changes the engine only where this contract says so (Tasks 7, 9, 23).
- **Testable cores (ruling):** every action body and every read query lives in a module that takes `(db, ctx | professionalId, input, now)` and imports neither `server-only`, `next/*`, `@/lib/db` (index), `@/lib/env`, `@/lib/session` nor `@/lib/auth` (`src/lib/back-office/*`, `src/lib/notify-core.ts`, `src/lib/calendar-sync-load.ts`, `src/lib/admin-reads.ts`). The `"use server"` files (`src/server/pro*.ts`) and the `server-only` query files are thin wrappers: `requireProContext()` + core + revalidate + `after(runEffects)`.
- **Identity:** `professionalId` and `actorUserId` always come from `requireProContext()` (session), never from input. Every id in an input is checked against that pro, by the engine (its `professional_id` filters) or by the core's own query (`usableTickets`, `activeBookingOf` and `bookingsExpiringBefore` callers verify ownership first).
- **Validation:** every core validates its input with `parseFr(schema, input)` (`src/lib/zod-fr.ts`) BEFORE calling the engine, with the same schema the engine uses; no English zod message ever reaches the UI. Engine failures become French through `fromEngine(res, context)` (`src/lib/pro-messages.ts`).
- **Effects:** every engine `effects` array is executed after commit by `runEffects` (`src/server/notify.ts`), scheduled with `after()` by `runProAction`. A failing effect never fails the action and is logged without e-mail addresses, codes or tokens.
- **Revalidation:** every successful pro action (`runProAction`) calls `revalidatePath` for each target of `revalidationTargets(publicPage)` (Task 6): the `/dashboard` layout always, plus, for the actions that change what the public page shows (`publicPage: true`: catalog, event, time-off, settings and profile actions), the route pattern `/[slug]` with type `"layout"` (never the literal `/${ctx.slug}`: with a type it tags a path no page carries). Client components never call `router.refresh()` right after a Server Action (Next 16 updates the current page itself), and never `router.push(x)` followed by `router.refresh()`. Navigation after an action = `router.push(x)` alone.
- **Next.js 16.2.9:** read `node_modules/next/dist/docs/` before touching a page, route or Server Action. `params` and `searchParams` are `Promise`s (await them). A page that only redirects awaits a request API first (`await requireProContext()`), never a bare static `redirect()`.
- **Client/server boundary:** client components import labels from `@/lib/tickets-vocab` (never `@/lib/tickets` for labels), schemas from `@/lib/tickets` only when they validate a form, view helpers from `src/lib/back-office/{format,labels,notice,confirm-copy,recurrence-form,event-defaults,planning-view}.ts`, and actions from the `"use server"` files. They never import runtime values from `@/lib/booking/*`, `@/lib/db/*`, `*-reads.ts`, `*-actions.ts` or `src/server/*-queries.ts` (`import type` is fine: types are erased). Props of client components carry no `Date`: instants are ISO strings (`toISOString()`), calendar days are `DateKey`.
- **UI rules (rulings):** load the `design-taste-frontend` skill before writing UI. Keep the existing system: `src/components/ui/*` primitives, `globals.css` tokens, `lucide-react`, existing radius and spacing; no new dependency. Server Components by default, client leaves only for interaction. Label above the input, helper or error below, never a placeholder as label. Every page and dialog has a loading state (route `loading.tsx` or inline spinner), an empty state (spec § 13.9 copy + action) and an error state. Every destructive action opens a `ConfirmDialog` that states its consequences (texts in `src/lib/back-office/confirm-copy.ts`). WCAG AA contrast. Below 640 px: planning in day view, client record in stacked sections, no horizontal page scroll. **Zero em dash (U+2014) and zero en dash (U+2013)** in UI strings, e-mails and Google event bodies. French with vouvoiement, one label per intent, buttons never wrap at desktop width. No emoji in the UI: 🔴 / 🟠 are rendered by `StatusMark`.
- **SWC whitespace bug:** keep on ONE line any JSX text that contains an HTML entity (`&apos;`, `&nbsp;`…), or use a JS string.
- **Dashboard `<main>`:** never give it `overflow-auto`, `overflow-y-auto` or `overflow-hidden` (after Task 1 it is `min-w-0 flex-1 overflow-x-clip`); the window scrolls.
- **Browser checks:** dev server = the `skedul-tickets` entry of the MAIN checkout `.claude/launch.json` (port 3102; `pnpm -C .claude/worktrees/tickets --config.verify-deps-before-run=false dev --port 3102`), started with `preview_start` name `skedul-tickets`. Sign in at `http://localhost:3102/sign-in` with the « Pro · back-office » one-click demo login (seeded `pro@skedul.app`, page `altinha-paris`; the password is the demo one from AGENTS.md: never type it into UI copy, commits or logs). E-mails are mocked: the dev-server log shows `📧 [email:mock] → … subject: …`.
- **Files:** Windows, CRLF working copies. Whole files with Write, partial changes with Edit. Never bash heredocs for files containing an apostrophe.
- **Language:** code, comments and plan prose in English; user-facing strings in French.
- **Commits:** one per task: `git add <files>` then `git commit -m "<type>(<scope>): <summary>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Never `--no-verify`, never push.
- **No new dependencies.** zod 4.4.3, drizzle-orm 0.45.2, better-auth 1.6.19, stripe 22, lucide-react, @date-fns/tz are installed. tsconfig target ES2017: no regex `s` flag, no named groups.
- **Test naming:** pure `*.test.ts`, DB `*.db.test.ts` (use `dbTest` from `src/test/db.ts`, which checks I1–I6 after each test); helpers in `src/test/` are never `*.test.ts`.

---

## 2. Review Focus

The five failure modes P3 is most likely to ship that its automated tests would not catch. Reviewers
check them first on every task.

| # | Failure mode | Why the tests miss it | Owning task(s) and proof |
|---|---|---|---|
| 1 | **Tenancy through reads and previews.** A Server Action or a page passes an input id (occurrence, customer, booking, ticket, segment) to a query or to an engine read that does not filter `professional_id` (`usableTickets`, `activeBookingOf`, any new read), or `/api/c` and `/[slug]/espace` trust the token or cookie without checking the customer's pro. | Core DB tests use one pro unless they deliberately add a second; a missing filter returns correct data for the only pro present. | Every core and read DB test file has one cross-tenant case (`createTestPro` second pro → `null` / « introuvable »): Tasks 9, 10, 15, 16, 21, 22, 23, 28, 31, 32, 36, 37, 41, 42. Task 41 adds the cookie and token cases. Reviewer greps each new query for `professional_id`. |
| 2 | **Wall-clock and time zone done in the browser.** Dates or times typed in a form, a click on the planning grid, « today » in a calendar or a « valable jusqu'au » day converted with the browser's zone (`new Date(y, m, d)`, `toISOString().slice(0, 10)`, `getHours()`), instead of `instantAt(dateKey, minute, pro tz)` on the server and `todayKey(now, pro tz)`. | Tests and the dev machine both run in Europe/Paris, like the demo pro. | Pure modules take `tz` explicitly and their tests use a pro tz different from the host (`America/Los_Angeles` and `Europe/Paris` cases): Tasks 3, 14, 21, 30. Cores receive `DateKey` + minutes, never instants built by the client: Tasks 22, 26, 28, 32. Reviewer greps client components for `new Date(` with arguments other than an ISO string. |
| 3 | **Stale UI state after an action.** A dialog keeps the clicked object instead of its id (shows old seats or attendees), a form keeps the old `seenVersion` / `seenStartsAt` and every second save fails with « a changé », a client component calls `router.refresh()` after an action (Next 16 hang) or forgets that a failed action must leave the form filled. | No component test framework; DB tests call cores, not components. | `runProAction` revalidates the dashboard layout on every success (Task 6). Dialogs select by id (Tasks 24–27, 34–35). Forms read `seenVersion` / `seenStartsAt` from props at submit time (Tasks 20, 25, 26). Each UI task's browser check performs TWO consecutive actions on the same object. |
| 4 | **Effects pipeline.** Effects not run, run twice, run before commit, or a thrown e-mail / Google / Stripe error turning a committed write into a failed action; « séance annulée » mailed to lapsed holds; Google insert without the deterministic id; a P4 effect type crashing the switch. | `after()` and the external services are not exercised by tests; DB tests of `notify-core` only plan e-mails. | Task 5 (`planEffect` exhaustive switch with `never`, dedupe, lapsed-hold filter; DB tests per effect type), Task 4 (pure sync core tests: 409 → patch, 404 → insert, delete 404/410, no token when nothing to do), Task 6 (`runProAction` runs effects only on `ok`). Browser checks read the dev-server log: exactly one mock e-mail per expected recipient. |
| 5 | **Copy and destructive confirmations.** English zod text, a client-worded engine message (« Vous êtes déjà inscrit(e). ») or a dash reaching the UI; a destructive action without `ConfirmDialog`, or with wrong consequence counts (tickets rendus, inscrits prévenus, séances supprimées). | Copy is only partly unit-tested; counts come from previews the UI must pass through. | Task 2 (`zod-fr` and `pro-messages` tests), Task 6 (`ui-copy.test.ts` dash scan of P3 directories), Task 8 (`confirm-copy.test.ts`), Tasks 20, 25, 28, 35 (confirmations fed by `deleteFromPreview`, attendee counts, conflict lists). Browser checks open every confirmation and read its text. |

---

## 3. File map

All paths relative to the worktree. "Task" = the task that creates the file or makes the change.

### 3.1 Foundation (G1)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| M | (merge) `AGENTS.md`, `src/app/dashboard/layout.tsx`, `src/app/dashboard/settings/page.tsx`, `src/app/demo/page.tsx`, `src/app/page.tsx`, `src/components/dashboard/{branding-form,planning-calendar,sidebar}.tsx`, `src/components/demo/*`, `src/components/site-header.tsx`, `src/server/pro.ts` | Merge of `origin/main` 8bb3195 (PR #13 settings, PR #14 demo CTAs): clean merge (no conflict, no migration) | 1 |
| C | (merge) `src/components/dashboard/slug-editor.tsx`, `src/lib/slug.ts`, `src/lib/slug.test.ts`, `src/components/landing/demo-link.tsx` | Arrive with the merge | 1 |
| M | `C:/Users/Matheus/Documents/Codage/skedul/.claude/launch.json` (main checkout, untracked) | Add the `skedul-tickets` entry (port 3102); other entries untouched | 1 |
| C | `src/lib/tickets-vocab.ts` | Dependency-free vocabulary: enum arrays and types, labels, `BOUNDS`, constants, engine error codes and messages, `normalizeEmail`, `offerLabel`, `validityLabel` | 2 |
| M | `src/lib/tickets.ts` | `export * from "./tickets-vocab"` + the zod schemas only | 2 |
| M | `src/lib/tickets.test.ts` | Dash scan also covers `tickets-vocab.ts`; vocab has no `import` | 2 |
| M | `src/lib/admin-params.ts` | Imports runtime values from `@/lib/tickets-vocab` | 2 |
| C | `src/lib/zod-fr.ts`, `src/lib/zod-fr.test.ts` | French per-parse zod error map, field labels, `parseFr` | 2 |
| C | `src/lib/pro-messages.ts`, `src/lib/pro-messages.test.ts` | Pro-facing French message for every engine code, per action context | 2 |
| C | `src/lib/back-office/format.ts`, `src/lib/back-office/format.test.ts` | Dash-free date/time/expiry/plural formatters, planning deep link | 3 |
| C | `src/lib/emails/parts.ts` | Escaped HTML building blocks (paragraph, details table, button, personal-link block) | 3 |
| C | `src/lib/emails/booking-confirmed.ts` | « Inscription confirmée » (any coverage) | 3 |
| C | `src/lib/emails/booking-cancelled.ts` | « Inscription annulée » (by the pro; `by: "client"` ready for P4) | 3 |
| C | `src/lib/emails/occurrence-changed.ts` | « Séance modifiée » | 3 |
| C | `src/lib/emails/occurrence-cancelled.ts` | « Séance annulée » (tickets rendus) | 3 |
| C | `src/lib/emails/attendee-moved.ts` | « Inscription déplacée » | 3 |
| C | `src/lib/emails/tickets-offered.ts` | « Tickets offerts » | 3 |
| C | `src/lib/emails/client-emails.test.ts` | One test block per template: escaping, content, no dash, personal link | 3 |
| M | `src/lib/email-layout.ts` | Footer « Envoyé par Skedul · Réservations et tickets » | 3 |
| D | `src/lib/booking-emails.ts`, `src/lib/booking-emails.test.ts` | v1 dead code (hard-coded EUR) | 3 |
| M | `src/lib/guest-link.ts`, `src/lib/guest-link.test.ts` | + `personalLinkUrl(appUrl, customer, key)` | 4 |
| M | `src/lib/calendar-links.ts`, `src/lib/calendar-links.test.ts` | + optional `location` (Google, Outlook, ICS `LOCATION:`) | 4 |
| M | `src/lib/google-event.ts`, `src/lib/google-event.test.ts` | `googleEventId(occurrenceId)`, `buildOccurrenceEvent` (id, status, location); footer without dash | 4 |
| M | `src/lib/calendar-sync-core.ts`, `src/lib/calendar-sync.test.ts` | `syncOccurrenceWith` on the occurrence: deterministic id, insert → 409 → patch, patch 404 → insert, delete 404/410 = success | 4 |
| M | `src/lib/google-calendar.ts` | `insertEvent` → `"created" \| "exists"` (409), `patchEvent` → `"patched" \| "missing"` (404/410) | 4 |
| C | `src/lib/calendar-sync-load.ts`, `src/lib/calendar-sync-load.db.test.ts` | DB loader of one occurrence for the sync; save marker | 4 |
| C | `src/lib/calendar-sync.ts` | `server-only` best-effort `syncOccurrence(id)` with real deps | 4 |
| M | `src/server/pro.ts` | `disconnectGoogleCalendar` also clears `occurrence.google_event_id` of the pro (Q33) | 4 |
| C | `src/lib/notify-core.ts`, `src/lib/notify-core.test.ts`, `src/lib/notify-core.db.test.ts` | Effect dedupe and `planEffect` (exhaustive): e-mails built from DB reads, Google / Stripe / deferred plans | 5 |
| C | `src/server/guest-key.ts` | `server-only` memoised `guestKey()` = `guestLinkKey(env.BETTER_AUTH_SECRET)` | 5 |
| C | `src/server/notify.ts` | `server-only` `runEffects(effects)`: executes plans best effort | 5 |
| M | `src/lib/stripe.ts` | + `expireCheckoutSession(sessionId)` | 5 |
| C | `src/server/revenue.ts` | `server-only` re-export of `paidPurchaseOf`, `revenueByCurrency`, `RevenueScope` + `revenueLive()` | 5 |
| C | `src/lib/back-office/result.ts`, `src/lib/back-office/result.test.ts` | `ProCtx`, `ActionResult`, `CoreResult`, `fromEngine`, `withoutEffects`, `revalidationTargets` | 6 |
| C | `src/server/pro-context.ts` | `server-only` `requireProContext`, `runProAction`, `runProQuery` | 6 |
| C | `src/test/pro-ctx.ts` | `proCtx(pro: TestPro): ProCtx` for core DB tests | 6 |
| C | `src/lib/ui-copy.test.ts` | Dash scan of P3 UI directories | 6 |
| M | `src/components/dashboard/planning-calendar.tsx`, `src/components/dashboard/weekly-hours-editor.tsx`, `src/app/dashboard/layout.tsx`, `src/app/dashboard/unavailability/page.tsx`, `src/components/dashboard/branding-form.tsx` | Remove every U+2014 / U+2013 the scan reports (comments included) | 6 |
| C | `src/lib/timezones.ts`, `src/lib/timezones.test.ts` | `PRO_TIMEZONES` (Europe/Zurich replaces Europe/Geneva), `isValidTimeZone`, `timeZoneLabel` | 7 |
| M | `src/lib/booking/occurrences.ts`, `src/lib/booking/occurrences.db.test.ts` | `createEvent` locks `professional` and G-checks the planned tz (`stale`); test-only `opts.afterPlan` | 7 |
| C | `src/lib/back-office/settings-actions.ts`, `src/lib/back-office/settings-actions.db.test.ts` | `updateProfileCore` (tz lock in one batch), `isTimezoneLocked` (+ Task 29: booking settings, global hours) | 7, 29 |
| M | `src/server/pro.ts` | `updateProfile` → `ActionResult` via core; `createProfessionalProfile` validates tz | 7 |
| M | `src/components/dashboard/profile-form.tsx`, `src/components/onboarding-form.tsx` | `PRO_TIMEZONES`; lock display; error display | 7 |
| M | `src/app/dashboard/settings/page.tsx`, `src/server/queries.ts` | Pass `timezoneLocked`; `getSettingsExtras` | 7 |
| M | `src/components/dashboard/sidebar.tsx` | Spec § 13.1 order, « Événements » and « Tickets » entries | 8 |
| M | `src/app/dashboard/event-types/page.tsx`, `src/app/dashboard/packs/page.tsx` | `await requireProContext()` then `redirect("/dashboard/tickets")` | 8 |
| M | `src/components/ui/badge.tsx` | + variant `destructive` | 8 |
| C | `src/lib/back-office/labels.ts` | UI-only labels (modes, question types, weekdays, alert tones, origins) | 8 |
| C | `src/lib/back-office/notice.ts`, `src/lib/back-office/notice.test.ts` | Notice presets (Q13), `noticeLabel`, `noticeExceedsHorizon` | 8 |
| C | `src/lib/back-office/confirm-copy.ts`, `src/lib/back-office/confirm-copy.test.ts` | Every destructive confirmation text (Q35) | 8 |
| C | `src/components/dashboard/status-mark.tsx` | 🔴 / 🟠 semantic mark with `aria-label` + `title` | 8 |
| C | `src/components/dashboard/confirm-dialog.tsx` | Confirmation dialog on `Dialog` | 8 |
| C | `src/components/dashboard/empty-state.tsx` | Empty state block with action | 8 |
| C | `src/components/dashboard/form-field.tsx` | Label above, helper / error below | 8 |
| C | `src/components/dashboard/form-error.tsx` | `role="alert"` error box | 8 |
| C | `src/components/dashboard/switch.tsx` | Accessible switch (`role="switch"`) | 8 |
| C | `src/components/dashboard/skeleton.tsx` | `Skeleton`, `PageSkeleton`, `TableSkeleton` | 8 |
| C | `src/components/dashboard/coverage-badge.tsx` | « Ticket » / « Inscription libre » / « Invité » badge | 8 |
| C | `src/components/dashboard/booking-status-badge.tsx` | Booking status badge | 8 |
| C | `src/components/dashboard/type-chip.tsx` | Ticket type colour dot + name (+ « Archivé ») | 8 |
| C | `src/app/dashboard/loading.tsx`, `src/app/dashboard/error.tsx` | Overview skeleton; dashboard error boundary | 8 |

### 3.2 Tickets (G2)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/back-office/catalog-reads.ts`, `src/lib/back-office/catalog-reads.db.test.ts` | Ticket types with offers, « Accepté par », usage; type detail; active type options | 9 |
| M | `src/lib/booking/wallet.ts`, `src/lib/booking/wallet.db.test.ts` | `loadTypeFacts`: an `rdv_free` type counts as not RDV-enabled (Q16 orange) | 9 |
| C | `src/server/catalog-queries.ts` | `server-only` wrappers of catalog (+ Task 15: event) reads | 9, 15 |
| C | `src/lib/back-office/catalog-actions.ts`, `src/lib/back-office/catalog-actions.db.test.ts` | Cores: types (patch), archive, delete, offers, active toggle, type hours, type questions; `rdv_free` refusals | 10 |
| C | `src/server/pro-catalog.ts` | `"use server"` wrappers for catalog (+ Task 16: events) | 10, 16 |
| C | `src/app/dashboard/tickets/page.tsx`, `src/app/dashboard/tickets/loading.tsx` | Types and offers list, archived section, empty state | 11 |
| C | `src/components/dashboard/ticket-type-card.tsx` | One type: badges, offers, « Accepté par », orange mark | 11 |
| C | `src/components/dashboard/new-ticket-type-button.tsx` | « Nouveau type de ticket » dialog | 11 |
| C | `src/app/dashboard/tickets/[id]/page.tsx`, `src/app/dashboard/tickets/[id]/loading.tsx` | Type page: info, offers, « Accepté par », RDV libre, archive / delete | 12, 13 |
| C | `src/components/dashboard/ticket-type-editor.tsx` | `TicketTypeInfoForm` (12), `RdvSettingsForm`, `TypeQuestionsForm` (13) | 12, 13 |
| C | `src/components/dashboard/offer-list.tsx` | Offers: list, add / edit dialog, « En vente » toggle, delete | 12 |
| C | `src/components/dashboard/type-danger-zone.tsx` | Archive / unarchive / delete with confirmations | 12 |
| C | `src/components/dashboard/questions-editor.tsx` | Presentational questions editor (types and events) | 13 |
| C | `src/components/dashboard/type-hours-editor.tsx` | Per-type weekly hours on `WeeklyHoursEditor` | 13 |
| C | `src/components/dashboard/window-override-fields.tsx` | Horizon / notice / cancellation overrides (types and events) | 13 |

### 3.3 Événements (G3)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/back-office/recurrence-form.ts`, `.test.ts` | Form value ↔ rule, month-week choices (Q11), preview dates, DST note texts (Q12) | 14 |
| C | `src/lib/back-office/event-defaults.ts`, `.test.ts` | `EVENT_DEFAULTS`, `defaultEventStart` (Q10) | 14 |
| C | `src/lib/back-office/event-reads.ts`, `.db.test.ts` | Events list per series, editor data with current-segment resolution (Q9), RDV conflicts, delete preview | 15 |
| M | `src/server/catalog-queries.ts` | + event read wrappers | 15 |
| M | `src/lib/tickets.ts` | + `eventInfoSchema`, `EventInfoInput` (pick of `eventInputSchema`, shared by the info form and `editEventInfoCore`) | 16 |
| C | `src/lib/back-office/event-actions.ts`, `.db.test.ts` | Cores: create, edit info (in place), preview / apply schedule (cut), delete from, new-event preview | 16 |
| M | `src/server/pro-catalog.ts` | + event wrappers | 16 |
| C | `src/app/dashboard/events/page.tsx`, `loading.tsx` | Events list, « Terminés », empty state | 17 |
| C | `src/components/dashboard/event-list.tsx` | Rows (desktop table, mobile cards) | 17 |
| C | `src/components/dashboard/recurrence-editor.tsx` | `RecurrenceEditor`, `RecurrencePreview` | 18 |
| C | `src/app/dashboard/events/new/page.tsx`, `loading.tsx` | New event (defaults, planning click) | 19 |
| C | `src/components/dashboard/event-editor.tsx` | `EventInfoFields`, `EventCreateForm` (19), `EventInfoForm` (20) | 19, 20 |
| C | `src/app/dashboard/events/[id]/page.tsx`, `loading.tsx` | Event page: info, schedule, upcoming séances, segments, delete | 20 |
| C | `src/components/dashboard/event-schedule-form.tsx` | « Horaire et récurrence »: preview then « Appliquer à partir du » | 20 |
| C | `src/components/dashboard/event-delete-card.tsx` | « Supprimer l'événement » / « Supprimer à partir du… » | 20 |

### 3.4 Planning, indisponibilités, réglages (G4)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/back-office/planning-reads.ts`, `.db.test.ts` | Week range with attendees, one item, customer search, register options, move targets | 21 |
| C | `src/lib/back-office/planning-view.ts`, `.test.ts` | VM, hiding empty séances under time off, lanes, time-off day segments, grid hours, week title | 21 |
| C | `src/server/planning-queries.ts` | `server-only` `getPlanningPage` | 21 |
| C | `src/lib/back-office/planning-actions.ts`, `.db.test.ts` | Cores: this séance, capacity scope, cancel, restore, unenroll, following (time-only), expiring preview (22); register, move, customer search, register options, move targets (23) | 22, 23 |
| C | `src/server/pro-planning.ts` | `"use server"` planning wrappers (séance 22, attendees 23, time off 28) | 22, 23, 28 |
| M | `src/lib/booking/eligibility.ts`, `src/lib/booking/claims.ts`, `src/lib/booking/claims.db.test.ts` | `spendTicket` returns `ticket_id`; `registerPro` / `bookWithHeldTicket` read it from the batch (OUT L119) | 23 |
| C | `src/app/dashboard/planning/loading.tsx`; M `src/app/dashboard/planning/page.tsx` | Week page, `after(ensureHorizon)`, deep link | 24 |
| M | `src/components/dashboard/planning-calendar.tsx` | Lanes, RDV and cancelled styles, empty-cell click, time-off per day, mobile day view | 24 |
| C | `src/components/dashboard/occurrence-dialog.tsx` | Séance / RDV dialog (details 24, actions 25, edit and move 26, register 27) | 24–27 |
| M | `src/components/dashboard/week-preview.tsx` | Repointed to `PlanningItemVM` + `OccurrenceDialog` (24), dashboard wiring (37) | 24, 37 |
| D | `src/components/dashboard/session-detail-dialog.tsx`, `src/components/dashboard/manual-booking-form.tsx` | Replaced | 24 |
| M | `src/server/pro.ts` | Remove stubs `fetchManualDaySlots`, `createManualBooking` (24); `updateSessionCapacity`, `moveAttendee`, `cancelSession` (25); `createTimeOff`, `deleteTimeOff` (28); `saveAvailability` (29); `cancelBooking`, `COMING_SOON` (37) | 24, 25, 28, 29, 37 |
| M | `src/components/dashboard/session-capacity-control.tsx` | Capacity with a scope (Q19) | 25 |
| C | `src/components/dashboard/occurrence-edit-form.tsx` | « Modifier cette séance » + expiring-ticket choice + « et les suivantes » (time-only) | 26 |
| C | `src/components/dashboard/move-attendee-dialog.tsx` | « Déplacer » targets (Q18), conversion, force | 26 |
| C | `src/components/dashboard/register-attendee-dialog.tsx` | « Inscrire »: search / new client, coverage, specific ticket, « +1 place », answers | 27 |
| C | `src/lib/back-office/time-off-actions.ts`, `.db.test.ts` | Cores: preview, create with conflicts, delete | 28 |
| C | `src/components/dashboard/time-off-conflict-dialog.tsx` | E6c choice dialog | 28 |
| M | `src/components/dashboard/unavailability-manager.tsx`, `src/app/dashboard/unavailability/page.tsx`; C `src/app/dashboard/unavailability/loading.tsx` | Pro-tz today, preview → dialog → create, delete confirmation | 28 |
| C | `src/components/dashboard/booking-settings-form.tsx` | « Réservations » section | 29 |
| M | `src/app/dashboard/settings/page.tsx`; C `src/app/dashboard/settings/loading.tsx` | + « Réservations » card | 29 |
| M | `src/app/dashboard/availability/page.tsx`, `src/components/dashboard/availability-editor.tsx`; C `src/app/dashboard/availability/loading.tsx` | « Disponibilités (RDV libre) », engine `setAvailabilityRules` | 29 |

### 3.5 Clients and money (G5)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/back-office/wallet-view.ts`, `.test.ts` | Wallet grouping by type, tones, lines, actionable ids | 30 |
| C | `src/lib/back-office/history.ts`, `.test.ts` | History lines (Q27 amended) | 30 |
| C | `src/lib/back-office/client-filters.ts`, `.test.ts` | Filters (Q5), listing rule (Q4) | 30 |
| C | `src/lib/back-office/dashboard-view.ts`, `.test.ts` | KPI tiles (Q25), alerts (Q28), getting started (Q29), booking detail VM | 30 |
| C | `src/lib/back-office/client-reads.ts`, `.db.test.ts` | Client list with filters and counts, alert counts, client record | 31 |
| C | `src/server/client-queries.ts` | `server-only` client wrappers (+ Task 41: espace) | 31, 41 |
| C | `src/lib/back-office/client-actions.ts`, `.db.test.ts` | Cores: create, update, revoke links, offer, convert, close, retire, point, unpoint | 32 |
| C | `src/server/pro-clients.ts` | `"use server"` client wrappers | 32 |
| M | `src/app/dashboard/clients/page.tsx`; C `src/app/dashboard/clients/loading.tsx` | List, filters, search, « Nouveau client » | 33 |
| C | `src/components/dashboard/client-list.tsx`, `src/components/dashboard/new-client-button.tsx` | Table / cards; creation dialog | 33 |
| C | `src/app/dashboard/clients/[id]/page.tsx`, `loading.tsx` | Client record | 34, 35 |
| C | `src/components/dashboard/client-header.tsx` | Name / phone edit, linked account, « Déconnecter ses liens » | 34 |
| C | `src/components/dashboard/client-wallet.tsx` | Wallet groups (server) | 34, 35 |
| C | `src/components/dashboard/client-purchases.tsx`, `src/components/dashboard/ledger-list.tsx` | Purchases; history | 34 |
| C | `src/components/dashboard/wallet-actions.tsx` | Pointer, Annuler le pointage, Offrir, Convertir, Clore, Retirer | 35 |
| C | `src/components/dashboard/client-bookings.tsx` | Upcoming / past bookings, Déplacer, Désinscrire | 35 |
| C | `src/lib/back-office/payments-reads.ts`, `.db.test.ts` | Paid purchases with linked booking and closed notes; totals | 36 |
| M | `src/app/dashboard/payments/page.tsx`; C `loading.tsx`; C `src/components/dashboard/payments-table.tsx` | Payments page | 36 |
| C | `src/lib/back-office/dashboard-reads.ts`, `.db.test.ts` | KPIs, alerts, getting started, upcoming bookings | 37 |
| M | `src/server/queries.ts` | + `getPaymentsPage` (36), `getDashboardPage` (37) | 36, 37 |
| M | `src/app/dashboard/page.tsx` | Overview: banner card, KPIs, alerts, getting started, week, upcoming | 37 |
| C | `src/components/dashboard/kpi-grid.tsx`, `alerts-card.tsx`, `getting-started.tsx` | Overview cards | 37 |
| M | `src/components/dashboard/upcoming-bookings.tsx`, `src/components/dashboard/booking-detail-dialog.tsx` | New VM (coverage, purchase), « Désinscrire » on the engine | 37 |
| C | `src/components/dashboard/verify-email-banner.tsx` | « Confirmez votre adresse » + code dialog | 38 |
| M | `src/app/dashboard/layout.tsx`, `src/components/auth/auth-form.tsx` | Banner mount; French 429 | 38 |

### 3.6 Admin and read-only public (G6)

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/admin-reads.ts`, `src/lib/admin-reads.db.test.ts` | Overview counts, revenue, activity rows, recent lists, health metrics, pro stats, deletion impact | 39 |
| M | `src/server/admin-queries.ts` | Wrap `admin-reads` (stubs gone) | 39 |
| M | `src/app/admin/page.tsx`, `src/app/admin/activity/page.tsx`, `src/components/admin/app-health-card.tsx`, `src/app/admin/users/[id]/page.tsx`, `src/components/admin/delete-user-card.tsx`, `src/server/admin.ts` | Admin screens on the new domain; E13 Stripe expiry before delete | 40 |
| C | `src/lib/back-office/guest-access.ts`, `.test.ts`, `.db.test.ts` | `/api/c` decision (pure) and customer lookup | 41 |
| C | `src/lib/back-office/customer-space.ts`, `.db.test.ts` | `getCustomerSpace` (read-only espace, reused by P4) | 41 |
| C | `src/app/api/c/[token]/route.ts` | Personal link → cookie → 303 | 41 |
| C | `src/app/[slug]/espace/page.tsx`, `src/app/[slug]/espace/loading.tsx`, `src/components/public/customer-space.tsx` | Read-only client space | 41 |
| M | `src/lib/session.ts` | + `getFreshSession()` (`disableCookieCache: true`) | 41 |
| M | `src/server/client-queries.ts` | + `resolveSpaceCustomer`, `getCustomerSpacePage` | 41 |
| M | `src/lib/analytics.ts`, `src/lib/analytics.test.ts` | `mon-espace` reserved and untracked, `/<slug>/espace` untracked | 41 |
| C | `src/lib/back-office/ics.ts`, `src/lib/back-office/ics.db.test.ts` | ICS facts of a confirmed booking | 42 |
| M | `src/app/api/bookings/[id]/calendar.ics/route.ts` | ICS rebuilt on the occurrence | 42 |

No barrel files. Callers import each module directly.

---

## 4. Module contracts

Conventions for every module below:
- `Db` = `import type { Db } from "@/lib/db/atomic"`. `ProCtx`, `ActionResult`, `CoreResult` come from `src/lib/back-office/result.ts`.
- A **core** has the signature `(db: Db, ctx: ProCtx, input: X, now: Date) => Promise<CoreResult<T>>`; it validates `input` with `parseFr`, calls the engine with `ctx.professionalId` / `ctx.actorUserId`, maps a failure with `fromEngine(res, <context>)` and returns the engine `effects` untouched (`[]` when none).
- A **read** has the signature `(db: Db, professionalId: string, …, now: Date) => Promise<…>` and filters every table on `professional_id`. Reads return `Date`s unless the row type says ISO.
- A **read core** (preview, search) has the core signature but returns `ActionResult<T>` (no effects); wrappers run it through `runProQuery`.
- Every exported function has a one-line JSDoc; the one-liners below are the JSDoc to write.
- Schema shorthand: `export const x: z.ZodObject<{ a: /* expr */; b: /* expr */ }>` in this contract means `export const x = z.object({ a: expr, b: expr })` with exactly those zod expressions (imports from `@/lib/tickets`: `idSchema`, `dateKeySchema`, `BOUNDS`, `answersInputSchema`, …). Every `*Input` type next to a schema is `z.input<typeof schema>`.

### 4.1 Vocabulary, validation, messages (Task 2)

**`src/lib/tickets-vocab.ts`** (no `import` at all)
- Moves verbatim from `src/lib/tickets.ts` (lines 9–261 at 04f6667): `BOOKING_MODES`, `RECURRENCE_FREQS`, `MONTHLY_BY`, `RECURRENCE_ENDS`, `VALIDITY_UNITS`, `OCCURRENCE_STATUSES`, `BOOKING_STATUSES`, `BOOKING_COVERAGES`, `ACTORS`, `PURCHASE_STATUSES`, `TICKET_STATUSES`, `TICKET_CLOSE_REASONS`, `MOVEMENT_KINDS`, `QUESTION_TYPES` and their types; every `*_LABELS`; `BOUNDS`; `MATERIALIZE_DAYS`, `HORIZON_REFRESH_DAYS`, `MATERIALIZE_MAX_ROWS`, `HOLD_MINUTES`, `CHECKOUT_MINUTES`, `SHOP_CHECKOUT_HOURS`, `STALE_PURCHASE_GRACE_MINUTES`, `MAX_PENDING_HOLDS`, `THROTTLE_WINDOW_SEC`, `THROTTLE_ACTIONS`, `ThrottleAction`, `THROTTLE_LIMITS`, `OTP_EMAIL_LIMIT`, `THROTTLE_PURGE_DAYS`, `DEFAULT_COLOR`; `ENGINE_ERROR_CODES`, `EngineErrorCode`, `isEngineErrorCode`, `ENGINE_ERROR_MESSAGES`; `normalizeEmail`, `offerLabel`, `validityLabel`.
- Invariant: values and strings unchanged (no copy edit here; pro wording lives in `pro-messages.ts`).

**`src/lib/tickets.ts`**
- First statement after the header comment: `export * from "./tickets-vocab";` then `import { … } from "./tickets-vocab";` for what the schemas need (relative path: `schema.ts` and drizzle-kit load this file). Keeps every zod schema and type unchanged (`dateKeySchema` … `availabilityRuleInputSchema`). Still imports only `zod` and `./tickets-vocab`.

**`src/lib/admin-params.ts`**: `BOOKING_STATUSES`, `PURCHASE_STATUSES`, the types and the re-exported labels now come from `@/lib/tickets-vocab`.

**`src/lib/zod-fr.ts`**
```ts
import type { z } from "zod";

/** Generic French text for a zod issue that carries no message of its own (no field name in it). */
export function zodFrMessage(issue: z.core.$ZodRawIssue | z.core.$ZodIssue): string;
/** Per-parse error map: `schema.safeParse(value, { error: zodFr })`; schema-level messages (refine / superRefine) still win. */
export const zodFr: z.core.$ZodErrorMap;
/** French field names keyed by the LAST path segment of an issue. */
export const FIELD_LABELS: Readonly<Record<string, string>>;
export type ParseFrResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors: Record<string, string> };
/** safeParse with zodFr; `error` = first issue, prefixed « {label} : » when its text is the generic one; fieldErrors keyed by path.join("."). */
export function parseFr<S extends z.ZodType>(schema: S, value: unknown): ParseFrResult<z.output<S>>;
```
- `zodFrMessage` table (exact strings):
  - `too_small`, origin `string`: minimum 1 → « Ce champ est obligatoire. »; else « {n} caractères au minimum. »
  - `too_big`, origin `string`: « {n} caractères au maximum. »
  - `too_small`, origin `number` / `int`: « Minimum {n}. » (exclusive: « Doit être supérieur à {n}. »)
  - `too_big`, origin `number` / `int`: « Maximum {n}. » (exclusive: « Doit être inférieur à {n}. »)
  - `too_small`, origin `array`: minimum 1 → « Choisissez au moins un élément. »; else « {n} éléments au minimum. »
  - `too_big`, origin `array`: « {n} éléments au maximum. »
  - `not_multiple_of`: « Choisissez un multiple de {divisor}. »
  - `invalid_type`: expected `number` → « Indiquez un nombre. »; `int` → « Indiquez un nombre entier. »; `string` → « Ce champ est obligatoire. »; anything else → « Valeur invalide. »
  - `invalid_format`: format `email` → « Adresse email invalide. »; `date` → « Date invalide. »; `datetime` → « Date et heure invalides. »; `regex` → « Format invalide. »; else « Format invalide. »
  - `invalid_value` → « Choix invalide. »; `invalid_union` → « Valeur invalide. »; `unrecognized_keys` → « Champ inattendu. »; `custom` → its own message, else « Valeur invalide. »; default → « Valeur invalide. »
  - Numbers are printed with `toLocaleString("fr-FR")`.
- `FIELD_LABELS` (exact): `name` « Nom », `email` « Email », `phone` « Téléphone », `title` « Titre », `description` « Description », `location` « Lieu », `locationOverride` « Lieu », `color` « Couleur », `label` « Libellé », `quantity` « Quantité », `priceCents` « Prix », `validityCount` « Validité », `capacity` « Places », `durationMin` « Durée », `rdvDurationMin` « Durée du rendez-vous », `rdvBufferBeforeMin` « Marge avant », `rdvBufferAfterMin` « Marge après », `bookingHorizonDays` « Réservable jusqu'à », `minNoticeMinutes` « Délai minimum », `cancelDeadlineHours` « Annulation par le client », `startDate` « Date de début », `startMinute` « Heure de début », `interval` « Intervalle », `weekdays` « Jours », `untilDate` « Date de fin », `occurrenceCount` « Nombre de séances », `options` « Options », `questions` « Questions », `ticketTypeIds` « Types de ticket acceptés », `reason` « Motif », `note` « Note », `value` « Réponse », `businessName` « Nom de l'activité », `headline` « Accroche », `bio` « Présentation », `timezone` « Fuseau horaire », `endDate` « Date de fin », `startTime` « Heure de début », `endTime` « Heure de fin », `q` « Recherche ».
- `parseFr` invariant: `error` never contains English words and never contains U+2014 / U+2013. Label prefix format: `« Nom : ce champ est obligatoire. »` (label, space, colon, space, lower-cased first letter of the generic message). An issue whose final message differs from `zodFrMessage(issue)` (a refine message) is returned verbatim.
- No global `z.config`: Better Auth uses the same zod and its messages must not change.

**`src/lib/pro-messages.ts`** (imports only `@/lib/tickets-vocab`)
```ts
export type ProErrorContext =
  | "catalog" | "event" | "series" | "occurrence" | "cancel" | "restore" | "register"
  | "unenroll" | "move" | "timeOff" | "customer" | "wallet" | "settings" | "profile";
/** Pro-facing French message for every engine code (never the client wording). */
export const PRO_ERROR_MESSAGES: Record<EngineErrorCode, string>;
/** Per-context overrides of PRO_ERROR_MESSAGES. */
export const PRO_CONTEXT_MESSAGES: Readonly<Partial<Record<ProErrorContext, Partial<Record<EngineErrorCode, string>>>>>;
/** The engine's own `message` when it has one (always French and pro-facing after pre-validation), else the context override, else the general pro message. */
export function proErrorMessage(fail: { code: EngineErrorCode; message?: string }, context: ProErrorContext): string;
```
- `PRO_ERROR_MESSAGES` (exact):
  - `full` « Cette séance est complète. »
  - `unavailable` « Cette séance n'est plus disponible : rafraîchissez la page. »
  - `changed` « La séance a changé entre-temps : rafraîchissez la page. »
  - `stale` « Les données ont changé entre-temps : rafraîchissez la page. »
  - `already_booked` « Ce client est déjà inscrit à cette séance. »
  - `slot_taken` « Ce créneau vient d'être pris. »
  - `no_ticket` « Ce client n'a aucun ticket utilisable ici. »
  - `too_many_holds` « Ce client a déjà deux paiements en cours. »
  - `too_late_or_done` « Cette inscription est déjà terminée. »
  - `not_found` « Élément introuvable : il a peut-être été supprimé. »
  - `not_eligible` « Ce ticket n'est pas accepté pour cette séance. »
  - `in_use` « Cet élément a déjà servi : il a été archivé. »
  - `invalid` « Certaines valeurs sont invalides. »
  - `throttled` « Trop de demandes. Réessayez dans un moment. »
  - `offer_too_short` « La validité de cette offre ne couvre pas la date de la séance. »
  - `ticket_expires_before` « Ticket expiré à la date de cette séance : déplacer quand même ? »
  - `retire_paid` « Un ticket payé ne peut pas être retiré : utilisez « Clore ». »
  - `timezone_locked` « Fuseau verrouillé : vous avez des séances planifiées. »
- `PRO_CONTEXT_MESSAGES` (exact):
  - `register`: `full` « Complet : cochez « +1 place » pour l'inscrire quand même. »; `unavailable` « Cette séance est annulée : rétablissez-la pour inscrire quelqu'un. »; `not_eligible` « Ce ticket n'est pas utilisable sur cette séance. »; `no_ticket` « Ce client n'a aucun ticket utilisable ici : inscrivez-le comme invité, ou offrez-lui un ticket depuis sa fiche. »; `not_found` « Séance ou client introuvable. »
  - `move`: `full` « La séance choisie est complète. »; `not_eligible` « Cette séance n'accepte pas le ticket de ce client : choisissez un type vers lequel le convertir. »; `already_booked` « Ce client est déjà inscrit à la séance choisie. »; `stale` « Cette inscription a changé entre-temps : rafraîchissez la page. »; `not_found` « Inscription ou séance introuvable. »
  - `restore`: `not_found` « Seule une séance future d'un événement peut être rétablie. »
  - `unenroll`: `stale` « Une de ces inscriptions est déjà terminée : rafraîchissez la page. »; `not_found` « Inscription introuvable sur cette séance. »
  - `cancel`: `not_found` « Séance introuvable. »
  - `occurrence`: `invalid` « Modification invalide. »; `not_found` « Séance introuvable. »
  - `series`: `not_found` « Événement introuvable ou terminé. »; `invalid` « Modification invalide. »
  - `event`: `not_found` « Événement introuvable ou terminé. »; `invalid` « Un type de ticket choisi n'existe plus. »
  - `timeOff`: `stale` « Des inscriptions ont changé pendant la vérification : voici la liste à jour. »
  - `wallet`: `no_ticket` « Pas assez de tickets pour cette action : rafraîchissez la page. »; `not_found` « Ticket ou type introuvable. »; `invalid` « Choix invalide. »
  - `catalog`: `not_found` « Type ou offre introuvable. »
  - `customer`: `invalid` « Vérifiez le nom, l'email et le téléphone. »; `not_found` « Client introuvable. »
  - `settings`: `invalid` « Valeurs hors limites. »
  - `profile`: `not_found` « Profil introuvable. »
- Invariant: no message equals or contains « Vous êtes déjà inscrit(e). »; no dash; every override key is a real `EngineErrorCode`.

### 4.2 Formatting and e-mails (Task 3)

**`src/lib/back-office/format.ts`** (pure; imports `@/lib/civil-date`, `@/lib/ticket-expiry`)
```ts
/** « 19:00 à 20:00 » in tz. */
export function formatTimeRange(start: Date, end: Date, tz: string): string;
/** « lun. 12 octobre 2026 · 19:00 à 20:00 » in tz (the dash-free twin of datetime.formatSlot). */
export function formatWhen(start: Date, end: Date, tz: string): string;
/** « lun. 12/10 · 19:00 » in tz. */
export function formatWhenShort(start: Date, tz: string): string;
/** « 12/10 » (local day of an instant in tz). */
export function formatDayMonthOf(instant: Date, tz: string): string;
/** « 12/10 14:03 » in tz (history lines). */
export function formatDayMonthTime(instant: Date, tz: string): string;
/** « valable jusqu'au 12/01 inclus » (« 12/01/2027 » when that last day is not in now's local year), or « sans limite de validité ». */
export function expiryLabel(expiresAt: Date | null, tz: string, now: Date): string;
/** « 1 séance » / « 3 séances » (fr-FR thousands; 0 and 1 take the singular). */
export function plural(n: number, one: string, many: string): string;
/** /dashboard/planning?semaine=<Monday DateKey of the séance, tz>&seance=<id> (Q20). */
export function planningHref(args: { occurrenceId: string; startsAt: Date | string; tz: string }): string;
```
- Invariants: no output contains U+2014 or U+2013; every function takes `tz` explicitly (never the host zone); `expiryLabel` uses `lastValidDay(expiresAt, tz)`.

**`src/lib/emails/parts.ts`** (pure; uses `escapeHtml` from `@/lib/email-layout`)
```ts
/** <p> with escaped text. */
export function mailParagraph(text: string): string;
/** Two-column table of escaped label / value rows. */
export function mailDetails(rows: readonly { label: string; value: string }[]): string;
/** Button link; href and label escaped. */
export function mailButton(href: string, label: string): string;
/** « Voir mes réservations et mes tickets » button + « Ce lien est personnel : ne le transférez pas. » */
export function mailPersonalLink(url: string): string;
/** Subject-safe text: CR/LF and runs of spaces collapsed to one space. */
export function oneLine(text: string): string;
export type MailCalendarLinks = { googleUrl: string; outlookUrl: string; icsUrl: string };
```

Every template returns `{ subject: string; html: string }`, passes every interpolated value through `escapeHtml` (html) or `oneLine` (subject), builds the frame with `layout(escapeHtml(title), body)` and never contains a dash. Amounts: none in P3 templates (if one is ever added it goes through `formatMoney(cents, currency)`).

| File | Export | Args type | Subject | Body (exact copy, `{x}` = escaped arg) |
|---|---|---|---|---|
| `booking-confirmed.ts` | `bookingConfirmedEmail(a: BookingConfirmedArgs)` | `{ customerName: string; businessName: string; title: string; whenLabel: string; location: string \| null; coverageLabel: string; ticketTypeName: string \| null; ticketsLeft: readonly { typeName: string; count: number; expiryText: string }[]; cancelText: string; personalLinkUrl: string; calendar: MailCalendarLinks }` | `Inscription confirmée : {title}` | h1 « Inscription confirmée »; « Bonjour {customerName}, votre inscription chez {businessName} est confirmée. »; details « Séance » {title}, « Date » {whenLabel}, « Lieu » {location} (row omitted when null), « Couverture » {coverageLabel} (+ « ({ticketTypeName}) » when set); when `ticketsLeft` non-empty: « Vos tickets restants : » then one line per type « {count} × {typeName}, {expiryText} »; {cancelText}; buttons « Ajouter à Google Agenda », « Ajouter à Outlook », « Télécharger pour mon agenda (.ics) »; `mailPersonalLink` |
| `booking-cancelled.ts` | `bookingCancelledEmail(a: BookingCancelledArgs)` | `{ customerName; businessName; title; whenLabel; by: "pro" \| "client"; ticketReturned: boolean; reason: string \| null; personalLinkUrl: string }` (all strings) | `Inscription annulée : {title}` | h1 « Inscription annulée »; by pro: « Bonjour {customerName}, {businessName} a annulé votre inscription à « {title} » ({whenLabel}). »; by client: « Bonjour {customerName}, votre annulation pour « {title} » ({whenLabel}) est bien enregistrée. »; `reason` → « Motif : {reason} »; `ticketReturned` → « Votre ticket a été rendu à votre portefeuille. »; `mailPersonalLink` |
| `occurrence-changed.ts` | `occurrenceChangedEmail(a: OccurrenceChangedArgs)` | `{ customerName; businessName; title; whenLabel; location: string \| null; canCancelUntilStart: boolean; personalLinkUrl: string }` | `Séance modifiée : {title}` | h1 « Séance modifiée »; « Bonjour {customerName}, {businessName} a modifié une séance où vous êtes inscrit. Voici les informations à jour : »; details « Séance », « Date », « Lieu »; `canCancelUntilStart` → « Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance. »; `mailPersonalLink` |
| `occurrence-cancelled.ts` | `occurrenceCancelledEmail(a: OccurrenceCancelledArgs)` | `{ customerName; businessName; title; whenLabel; ticketReturned: boolean; personalLinkUrl: string }` | `Séance annulée : {title}` | h1 « Séance annulée »; « Bonjour {customerName}, {businessName} a annulé la séance « {title} » du {whenLabel}. Votre inscription est annulée. »; `ticketReturned` → « Votre ticket a été rendu à votre portefeuille. »; `mailPersonalLink` |
| `attendee-moved.ts` | `attendeeMovedEmail(a: AttendeeMovedArgs)` | `{ customerName; businessName; fromTitle; fromWhenLabel; toTitle; toWhenLabel; toLocation: string \| null; personalLinkUrl: string }` | `Inscription déplacée : {toTitle}` | h1 « Inscription déplacée »; « Bonjour {customerName}, {businessName} a déplacé votre inscription. »; details « Avant » « {fromTitle}, {fromWhenLabel} », « Maintenant » « {toTitle}, {toWhenLabel} », « Lieu » {toLocation}; « Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance. »; `mailPersonalLink` |
| `tickets-offered.ts` | `ticketsOfferedEmail(a: TicketsOfferedArgs)` | `{ customerName; businessName; typeName; count: number; expiryText: string; personalLinkUrl: string }` | `{businessName} vous offre {plural(count, "ticket", "tickets")}` | h1 « Tickets offerts »; « Bonjour {customerName}, {businessName} vous offre {plural} « {typeName} », {expiryText}. Ils sont déjà dans votre portefeuille. »; `mailPersonalLink` |

- Each `*Args` type is exported with its function. `src/lib/email-layout.ts` footer becomes « Envoyé par Skedul · Réservations et tickets ».
- Delete `src/lib/booking-emails.ts` and `src/lib/booking-emails.test.ts` (no runtime importer).

### 4.3 Personal link, calendar links, Google (Task 4)

**`src/lib/guest-link.ts`** (add)
```ts
/** `${appUrl}/api/c/${signGuestLink({ customerId: customer.id, linkVersion: customer.linkVersion }, key)}` (appUrl without trailing slash; the version comes from the row at send time). */
export function personalLinkUrl(appUrl: string, customer: { id: string; linkVersion: number }, key: Buffer): string;
```

**`src/lib/calendar-links.ts`** (change)
```ts
export interface CalendarLinkInput { title: string; description: string; startAt: Date; endAt: Date; location?: string | null }
```
- Google: `location` query param when set; Outlook: `location` param when set; `buildIcs`: `LOCATION:` line (escaped like other text) after `DESCRIPTION:` when set. Other output unchanged.

**`src/lib/google-event.ts`** (replace `SessionEventInput` / `buildSessionEvent`)
```ts
import { createHash } from "node:crypto";
export interface GoogleEventBody {
  id?: string; status: "confirmed"; summary: string; description: string; location?: string;
  start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string };
}
/** hex(sha256(occurrenceId)): 64 lowercase hex chars, a valid Google event id (base32hex). */
export function googleEventId(occurrenceId: string): string;
export interface OccurrenceEventInput {
  occurrenceId: string; title: string; isRdv: boolean; location: string | null; startAt: Date; endAt: Date;
  capacity: number; timezone: string; attendees: readonly { name: string; email: string }[];
}
/** Full body: deterministic id, status confirmed, summary (« {title} · {client} » for an RDV), « Places : n/cap » for a séance, one « • name (email) » line per attendee, footer « Géré par Skedul : ne pas modifier ici. », location when known. */
export function buildOccurrenceEvent(input: OccurrenceEventInput): GoogleEventBody & { id: string };
```

**`src/lib/google-calendar.ts`** (`server-only`, change)
```ts
/** POST the body (with its id); 409 (id already known, even a cancelled event) → "exists". */
export async function insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<"created" | "exists">;
/** PATCH the full body; 404 / 410 → "missing". */
export async function patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<"patched" | "missing">;
// createSkedulCalendar, deleteEvent unchanged (delete: 404 / 410 = success)
```

**`src/lib/calendar-sync-core.ts`** (pure, replace)
```ts
export interface LoadedOccurrence {
  occurrenceId: string; userId: string; googleCalendarId: string | null; googleEventId: string | null;
  status: OccurrenceStatus; isRdv: boolean; title: string; location: string | null; startAt: Date; endAt: Date;
  capacity: number; timezone: string; attendees: { name: string; email: string }[];
}
export interface SyncDeps {
  enabled: boolean;
  loadOccurrence: (occurrenceId: string) => Promise<LoadedOccurrence | null>;
  getAccessToken: (userId: string) => Promise<string>;
  insertEvent: (token: string, calendarId: string, body: GoogleEventBody) => Promise<"created" | "exists">;
  patchEvent: (token: string, calendarId: string, eventId: string, body: GoogleEventBody) => Promise<"patched" | "missing">;
  deleteEvent: (token: string, calendarId: string, eventId: string) => Promise<void>;
  saveEventId: (occurrenceId: string, eventId: string | null) => Promise<void>;
}
export type SyncOutcome = "disabled" | "skipped" | "noop" | "deleted" | "created" | "updated";
/** A Google event is wanted for a scheduled occurrence with ≥ 1 confirmed attendee (séance or RDV, spec § 13.7). */
export function wantsGoogleEvent(o: Pick<LoadedOccurrence, "status" | "attendees">): boolean;
/** Reconcile one occurrence with Google (algorithm below). */
export async function syncOccurrenceWith(occurrenceId: string, deps: SyncDeps): Promise<SyncOutcome>;
```
Algorithm (exact): `!enabled` → "disabled". Not found or no calendar → "skipped". Not wanted: marker null → "noop" (no token fetch, no API call); marker set → token, `deleteEvent(marker)`, `saveEventId(id, null)` → "deleted". Wanted: token, `body = buildOccurrenceEvent(o)`. Marker set → `patchEvent(marker)`; "patched" → "updated"; "missing" → insert path. Marker null or missing → `insertEvent(body)`; "exists" → `patchEvent(body.id, body)` (revives an event Google keeps cancelled); then `saveEventId(id, body.id)` → "created".

**`src/lib/calendar-sync-load.ts`** (DB, no `server-only`)
```ts
/** The occurrence as the sync needs it: pro user and calendar, title = event title or type name, location = COALESCE(location_override, event.location) (null for an RDV), confirmed attendees by created_at. */
export async function loadOccurrenceForSync(db: Db, occurrenceId: string): Promise<LoadedOccurrence | null>;
/** Stores (or clears) the Google marker of one occurrence. */
export async function saveGoogleEventId(db: Db, occurrenceId: string, eventId: string | null): Promise<void>;
```

**`src/lib/calendar-sync.ts`** (`server-only`)
```ts
/** Best effort, never throws: real deps (env.GOOGLE_CALENDAR_ENABLED, auth.api.getAccessToken({ body: { providerId: "google", userId } }), google-calendar.ts, calendar-sync-load.ts); logs « [calendar-sync] occurrence <id> failed: <message> ». */
export async function syncOccurrence(occurrenceId: string): Promise<void>;
```

**`src/server/pro.ts` `disconnectGoogleCalendar`**: after the unlink, ONE `db.batch` = `update professional set google_calendar_id = null` + `update occurrence set google_event_id = null where professional_id = pro.id` (Q33). No backfill on reconnect.

### 4.4 Effects (Task 5)

**`src/lib/notify-core.ts`** (DB, no `server-only`, no env)
```ts
export type OutgoingEmail = { to: string; subject: string; html: string };
export type NotifyDeps = { appUrl: string; guestKey: Buffer; now: Date };
export type EffectPlan =
  | { kind: "emails"; emails: OutgoingEmail[] }
  | { kind: "google"; occurrenceId: string }
  | { kind: "stripe"; purchaseId: string; checkoutSessionId: string }
  | { kind: "deferred"; type: Effect["type"] };
/** Drops exact duplicates (stable key, bookingIds sorted), keeps first-seen order, puts google.sync_occurrence effects last. */
export function dedupeEffects(effects: readonly Effect[]): Effect[];
/** What to do for one effect, from a fresh DB read (exhaustive switch on Effect["type"] ending in a `never` check). */
export async function planEffect(db: Db, effect: Effect, deps: NotifyDeps): Promise<EffectPlan>;
```
`planEffect` behaviour per type (recipients = `customer.email`; every e-mail carries `personalLinkUrl(deps.appUrl, customer, deps.guestKey)`; dates via `formatWhen` / `formatWhenShort` in the pro tz; title = `COALESCE(event.title, ticket_type.name)`; location = `COALESCE(o.location_override, event.location)`):
- `email.booking_confirmed {bookingId}`: only when the booking is `confirmed`; `coverageLabel = COVERAGE_LABELS[coverage]`; `ticketTypeName` = type of the ticket booked on it (coverage `ticket`); `ticketsLeft` = `walletBalance(db, { professionalId, customerId }, now)` joined to type names, `expiryText = expiryLabel(nextExpiry, tz, now)`; cancellation hours = `COALESCE(event.cancel_deadline_hours, ticket_type.rdv_cancel_deadline_hours, professional.cancel_deadline_hours)`, `deadline = clientCancelDeadline(startsAt, hours)`; `cancelText` = deadline > now ? « Vous pouvez annuler en ligne jusqu'au {formatWhenShort(deadline)}. » : « L'annulation en ligne n'est plus possible : contactez {businessName}. »; calendar links from `googleCalendarUrl` / `outlookCalendarUrl` with `{ title, description: "Avec {businessName}", location, startAt, endAt }` and `icsUrl = ${appUrl}/api/bookings/${bookingId}/calendar.ics`. → 1 e-mail.
- `email.booking_cancelled {bookingId, by}`: `ticketReturned` = a `ticket_movement` of kind `return` with this `booking_id` exists; `reason = booking.cancel_reason`. Skipped (no e-mail) for a **lapsed hold**: `confirmed_at IS NULL AND hold_expires_at < ended_at`. → 0 or 1 e-mail.
- `email.occurrence_cancelled {occurrenceId, bookingIds}`: one e-mail per listed booking of that occurrence, lapsed holds skipped, `ticketReturned` per booking.
- `email.occurrence_changed {occurrenceId, bookingIds}`: one e-mail per listed booking still active (`confirmed`, or `pending` with `hold_expires_at > now`); `canCancelUntilStart = occurrence.changed_at > booking.created_at OR booking.moved_at IS NOT NULL`.
- `email.attendee_moved {bookingId, fromOccurrenceId}`: booking `confirmed`; from = `fromOccurrenceId`, to = `booking.occurrence_id`. → 1 e-mail.
- `email.tickets_offered {customerId, actionId, quantity}`: movements `kind = 'offer'` of that action joined to their tickets (type name, `expires_at` of the first) → `count` = movement count. → 1 e-mail.
- `email.pro_new_booking`, `email.pro_booking_cancelled`, `email.purchase_receipt`, `email.late_payment` → `{ kind: "deferred", type }`.
- `google.sync_occurrence` → `{ kind: "google", occurrenceId }`; `stripe.expire_session` → `{ kind: "stripe", purchaseId, checkoutSessionId }`.
- A row that no longer exists → `{ kind: "emails", emails: [] }`.

**`src/server/guest-key.ts`** (`server-only`)
```ts
/** guestLinkKey(env.BETTER_AUTH_SECRET), computed once. */
export function guestKey(): Buffer;
```

**`src/server/notify.ts`** (`server-only`)
```ts
/** Runs effects after commit, best effort: dedupe, plan each (fresh read), then sendEmail / syncOccurrence / expireCheckoutSession; deferred P4 types log « [notify] <type> is wired in P4 ». Never throws; a failure logs « [notify] <type> failed: <message> » without addresses, codes or tokens. */
export async function runEffects(effects: readonly Effect[]): Promise<void>;
```

**`src/lib/stripe.ts`** (add)
```ts
/** Best effort: "mock" when Stripe is off; "not_open" when the session is no longer open (retrieve first); "expired" after sessions.expire; "failed" on any error (logged « [stripe] expire failed: <message> »). Never throws. */
export async function expireCheckoutSession(checkoutSessionId: string): Promise<"expired" | "not_open" | "mock" | "failed">;
```

**`src/server/revenue.ts`** (`server-only`)
```ts
export { paidPurchaseOf, revenueByCurrency, type RevenueScope } from "@/lib/booking/revenue";
/** True only with a live key (stripeMode(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED) === "live"): then only livemode purchases count (spec § 9, Q3). */
export function revenueLive(): boolean;
```

### 4.5 Action plumbing (Task 6)

**`src/lib/back-office/result.ts`** (pure)
```ts
/** Who acts: always built by requireProContext() from the session, never from input. */
export type ProCtx = { professionalId: string; actorUserId: string; timezone: string; currency: string; slug: string };
export type ActionFail = { ok: false; error: string; code?: EngineErrorCode };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFail;
export type CoreResult<T extends object = object> = ({ ok: true; effects: Effect[] } & T) | ActionFail;
export const UNEXPECTED_ERROR = "Une erreur inattendue est survenue. Réessayez dans un instant.";
/** { ok: false, error, code? }. */
export function actionFail(error: string, code?: EngineErrorCode): ActionFail;
/** An engine failure as a pro-facing failure: { ok: false, error: proErrorMessage(res, context), code: res.code }. */
export function fromEngine(res: EngineFail, context: ProErrorContext): ActionFail;
/** The same result without its effects (what reaches the browser). */
export function withoutEffects<T extends object>(res: CoreResult<T>): ActionResult<T>;
/** The revalidatePath calls of a successful action: [{ path: "/dashboard", type: "layout" }], + { path: "/[slug]", type: "layout" } (the route pattern, not the literal slug) when publicPage. */
export function revalidationTargets(publicPage: boolean): { path: string; type: "layout" }[];
```
(`Effect`, `EngineFail` are type imports from `@/lib/booking/types`; `EngineErrorCode` from `@/lib/tickets-vocab`.)

**`src/server/pro-context.ts`** (`server-only`; not a `"use server"` file)
```ts
/** getSession() → redirect("/sign-in") when absent; getCurrentProfessional() → redirect("/onboarding") when absent; returns { professionalId: pro.id, actorUserId: session.user.id, timezone, currency, slug }. */
export async function requireProContext(): Promise<ProCtx>;
/** The wrapper of every pro write: ctx, now = new Date(); core in try/catch (unstable_rethrow, then log « [pro] <name> failed: <message> » and return UNEXPECTED_ERROR); on ok: revalidatePath(target.path, target.type) for each target of revalidationTargets(opts.publicPage === true) (the "/dashboard" layout always, + the "/[slug]" route pattern with type "layout" when opts.publicPage), after(() => runEffects(res.effects)) when effects exist; returns withoutEffects(res). A failure is returned as is (no revalidation, no effect). */
export async function runProAction<T extends object>(
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<CoreResult<T>>,
  opts?: { publicPage?: boolean },
): Promise<ActionResult<T>>;
/** The wrapper of read cores (search, previews): ctx + try/catch like runProAction, no revalidation, no effect. */
export async function runProQuery<T extends object>(
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>>;
```

**`src/test/pro-ctx.ts`**
```ts
/** The ProCtx of a test pro (its user acts). */
export function proCtx(pro: TestPro): ProCtx;
```

**`src/lib/ui-copy.test.ts`**: walks `src/components/dashboard`, `src/app/dashboard`, `src/lib/back-office`, `src/lib/emails` (recursively, `.ts` / `.tsx`, excluding `*.test.ts`) plus, when they exist, `src/lib/pro-messages.ts`, `src/lib/zod-fr.ts`, `src/lib/google-event.ts`, `src/lib/email-layout.ts`, `src/components/public/customer-space.tsx`, `src/app/[slug]/espace`, `src/app/admin/activity/page.tsx`, `src/components/admin/app-health-card.tsx`, `src/components/admin/delete-user-card.tsx`; asserts no file contains U+2014 or U+2013 (comments included) and reports `file:line` of each hit.

Wrapper pattern (every `"use server"` export follows it exactly):
```ts
export async function createTicketTypeAction(input: TicketTypeInput): Promise<ActionResult<{ ticketTypeId: string }>> {
  return runProAction("createTicketType", (ctx, now) => createTicketTypeCore(db, ctx, input, now), { publicPage: true });
}
```

### 4.6 Time zone (Task 7)

**`src/lib/timezones.ts`** (pure)
```ts
/** Zones offered in forms (Europe/Geneva is not an IANA zone: Europe/Zurich replaces it). */
export const PRO_TIMEZONES: readonly { id: string; label: string }[];
// = [{ id: "Europe/Paris", label: "Paris (France)" }, { id: "Europe/Brussels", label: "Bruxelles (Belgique)" },
//    { id: "Europe/Zurich", label: "Genève, Zurich (Suisse)" }, { id: "Europe/London", label: "Londres (Royaume-Uni)" },
//    { id: "America/Montreal", label: "Montréal (Canada)" }, { id: "America/New_York", label: "New York (États-Unis)" }]
/** True when Intl accepts the zone (new Intl.DateTimeFormat("fr-FR", { timeZone }) does not throw); false for "". */
export function isValidTimeZone(tz: string): boolean;
/** The list label, else the zone id itself. */
export function timeZoneLabel(tz: string): string;
```

**`src/lib/booking/occurrences.ts` `createEvent`** (engine change, carry Task 18)
- New signature: `createEvent(db, input, now = new Date(), opts: { afterPlan?: () => Promise<void> } = {})` (`afterPlan` test-only, passed to `tryAtomic`).
- The batch starts with `lockRows(db, "professional", [professionalId])` then `G(db, sql\`(select timezone from professional where id = ${professionalId}) = ${pro.tz}\`, "stale")` (rank 1 of the lock order; the tz read at plan time must be the committed one). Everything else unchanged.

**`src/lib/back-office/settings-actions.ts`** (Task 7 part)
```ts
export const profileInputSchema: z.ZodObject<{
  businessName: /* z.string().trim().min(1).max(BOUNDS.name) */;
  headline: /* z.string().trim().max(160).nullable() */;
  bio: /* z.string().trim().max(BOUNDS.description).nullable() */;
  timezone: /* z.string().refine(isValidTimeZone, { message: "Fuseau horaire inconnu." }) */;
}>;
export type ProfileInput = z.input<typeof profileInputSchema>;
/** A non-archived event, or a future scheduled occurrence (séance or RDV), exists: the time zone cannot change (spec § 7). */
export async function isTimezoneLocked(db: Db, professionalId: string, now: Date): Promise<boolean>;
/** Profile in ONE batch: lockRows(professional), G(tz unchanged OR not locked, 'timezone_locked'), UPDATE. Context "profile". */
export async function updateProfileCore(db: Db, ctx: ProCtx, input: ProfileInput, now: Date): Promise<CoreResult>;
```
- G predicate (exact): `(select timezone from professional where id = $p) = $newTz or (not exists (select 1 from event where professional_id = $p and archived_at is null) and not exists (select 1 from occurrence where professional_id = $p and status = 'scheduled' and starts_at > $now))`.

**`src/server/pro.ts`**: `updateProfile(input: ProfileInput): Promise<ActionResult>` = `runProAction("updateProfile", …, { publicPage: true })` (the `brandColor` parameter is dropped: branding owns it). `createProfessionalProfile` stores `input.timezone` only when `isValidTimeZone`, else `"Europe/Paris"`.

**UI** — `ProfileForm` (`src/components/dashboard/profile-form.tsx`, client) props become `{ values: ProfileValues; timezoneLocked: boolean }`; options from `PRO_TIMEZONES` (+ the current zone when not listed); when `timezoneLocked` the select is `disabled` with helper « Fuseau verrouillé : vous avez des séances planifiées. »; shows `res.error` in `FormError`; success « Enregistré » (`text-sm text-success`). `OnboardingForm` uses `PRO_TIMEZONES`. `src/server/queries.ts` gains `getSettingsExtras(professionalId: string): Promise<{ timezoneLocked: boolean }>` (Task 29 adds `bookingSettings: BookingSettings`).

### 4.7 Navigation, labels, confirmations, primitives (Task 8)

**Sidebar** `NAV` (exact order, label, href, icon): « Vue d'ensemble » `/dashboard` `LayoutDashboard` (exact); « Planning » `/dashboard/planning` `CalendarRange`; « Événements » `/dashboard/events` `CalendarDays`; « Clients » `/dashboard/clients` `Users`; « Paiements » `/dashboard/payments` `Euro`; « Tickets » `/dashboard/tickets` `Ticket`; « Disponibilités » `/dashboard/availability` `Clock`; « Indisponibilités » `/dashboard/unavailability` `CalendarOff`; « Réglages » `/dashboard/settings` `Settings`; « Centre d’aide » `/aide` `LifeBuoy`. « Prestations » disappears.

**Redirect pages** `src/app/dashboard/event-types/page.tsx` and `src/app/dashboard/packs/page.tsx`: `export default async function Page() { await requireProContext(); redirect("/dashboard/tickets"); }` (no metadata).

**`src/components/ui/badge.tsx`**: variant `destructive: "bg-destructive/10 text-destructive"`.

**`src/lib/back-office/labels.ts`** (pure, imports `@/lib/tickets-vocab` types only)
```ts
export const MODE_SHORT_LABELS: Record<BookingMode, string>; // { tickets: "Sur tickets", free: "Inscription libre", none: "Sur place" }
export const MODE_HELP: Record<BookingMode, string>;
// tickets « Vos clients réservent avec un ticket d'un type accepté, ou l'achètent en réservant. »
// free « Inscription par email, gratuite, dans la limite des places. »
// none « Pas de réservation en ligne : la séance est affichée « Sur place » sur votre page. »
export const QUESTION_TYPE_LABELS: Record<QuestionType, string>; // { text: "Texte libre", choice: "Choix dans une liste", boolean: "Oui ou non" }
export const VALIDITY_UNIT_LABELS: Record<ValidityUnit, string>; // { day: "jours", month: "mois" }
export const WEEK_ORDER: readonly number[]; // [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_LETTERS: Readonly<Record<number, string>>; // 0 "D", 1 "L", 2 "M", 3 "M", 4 "J", 5 "V", 6 "S"
export const WEEKDAY_NAMES: Readonly<Record<number, string>>; // 0 "dimanche" … 6 "samedi"
export type AlertTone = "red" | "orange";
export const ALERT_LABELS: Record<AlertTone, string>; // red « Tickets d'un type archivé », orange « Type lié à aucun événement à venir »
export const ORIGIN_LABELS: { readonly purchased: "Acheté"; readonly offered: "Offert" };
```

**`src/lib/back-office/notice.ts`** (pure)
```ts
/** Q13 presets of « Au plus tard … avant le début ». */
export const NOTICE_PRESETS: readonly { minutes: number; label: string }[];
// 0 « Jusqu'au début », 15 « 15 min avant », 30 « 30 min avant », 60 « 1 h avant », 120 « 2 h avant », 180 « 3 h avant »,
// 360 « 6 h avant », 720 « 12 h avant », 1440 « 24 h avant », 2880 « 2 jours avant », 4320 « 3 jours avant », 10080 « 7 jours avant »
/** Preset label, else « 45 min avant », « 1 h 30 min avant », « 5 jours avant ». */
export function noticeLabel(minutes: number): string;
/** True when the notice is longer than the horizon (minutes > days × 1440): online booking would never open (OUT L106). */
export function noticeExceedsHorizon(minNoticeMinutes: number, bookingHorizonDays: number): boolean;
export const NOTICE_TOO_LONG = "Le délai minimum dépasse l'horizon de réservation : réduisez-le ou allongez l'horizon.";
```

**`src/lib/back-office/confirm-copy.ts`** (pure; uses `plural`)
```ts
export type ConfirmCopy = { title: string; body: string; confirm: string };
export function cancelOccurrenceCopy(a: { kind: "seance" | "rdv"; registrants: number; past: boolean }): ConfirmCopy;
export function restoreOccurrenceCopy(): ConfirmCopy;
export function unenrollCopy(a: { names: readonly string[]; ticketCount: number; pendingCount: number }): ConfirmCopy;
export function closeTicketsCopy(a: { count: number; reasonLabel: string }): ConfirmCopy;
export function retireTicketsCopy(a: { count: number }): ConfirmCopy;
export function revokeLinksCopy(a: { name: string }): ConfirmCopy;
export function archiveTypeCopy(a: { name: string }): ConfirmCopy;
export function deleteTypeCopy(a: { name: string; used: boolean; acceptedBy: readonly string[] }): ConfirmCopy;
export function deleteOfferCopy(a: { label: string; sold: boolean }): ConfirmCopy;
export function deleteEventCopy(a: { title: string; fromLabel: string | null; deleteWhole: boolean; deletedSeances: number; cancelledSeances: number; registrants: number; ticketsReturned: number }): ConfirmCopy;
export function deleteTimeOffCopy(): ConfirmCopy;
export function timeOffConflictCopy(a: { count: number }): { title: string; intro: string; cancelLabel: string; keepLabel: string; keepNote: string; rdvNote: string };
```
Exact texts (`{n}` printed with `plural` where a noun follows):
- `cancelOccurrenceCopy` séance: title « Annuler cette séance ? »; body registrants 0 → « Personne n'est inscrit : la séance est simplement annulée. »; 1 → « La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email. »; n > 1 → « Les {n} inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email. »; `past` appends « Cette séance est déjà passée : les tickets sont rendus quand même. »; confirm « Annuler la séance ». RDV: title « Annuler ce rendez-vous ? »; body « Le client est prévenu par email et son ticket lui est rendu. »; confirm « Annuler le rendez-vous ».
- `restoreOccurrenceCopy`: « Rétablir cette séance ? » / « La séance redevient réservable ; les anciens inscrits ne sont pas réinscrits. » / « Rétablir ».
- `unenrollCopy`: title one name → « Désinscrire {name} ? », else « Désinscrire {n} inscrits ? »; body: ticketCount > 0 → (one) « Le ticket est rendu au client, qui est prévenu par email. » / (several) « Les tickets sont rendus aux clients, qui sont prévenus par email. »; ticketCount 0 → (one) « Le client est prévenu par email. » / (several) « Les clients sont prévenus par email. »; pendingCount > 0 appends « Le paiement en cours est annulé. »; confirm « Désinscrire ».
- `closeTicketsCopy`: « Clore {plural(n,"ticket","tickets")} ? » / « Motif : {reasonLabel}. Les tickets restent visibles, barrés, dans son portefeuille. Rien n'est remboursé automatiquement. » / « Clore ».
- `retireTicketsCopy`: « Retirer {plural(n,"ticket offert","tickets offerts")} ? » / « Ils restent visibles, barrés, dans son portefeuille. » / « Retirer ».
- `revokeLinksCopy`: « Déconnecter les liens de {name} ? » / « Les liens personnels déjà envoyés par email cessent de fonctionner. Les prochains emails contiendront un nouveau lien. » / « Déconnecter les liens ».
- `archiveTypeCopy`: « Archiver « {name} » ? » / « Ses offres ne sont plus en vente et il disparaît de votre page. Les tickets déjà détenus restent dans les portefeuilles, signalés en rouge, et les événements gardent leur lien. Vous pourrez le désarchiver. » / « Archiver ».
- `deleteTypeCopy`: title « Supprimer « {name} » ? »; used → body « Ce type a déjà servi (tickets, achats ou rendez-vous) : il sera archivé, pas supprimé. », confirm « Archiver »; not used → body « Ses offres, ses horaires et ses questions sont supprimés. » + (acceptedBy non-empty) « Il est retiré de ces événements : {acceptedBy joined with ", "}. », confirm « Supprimer ».
- `deleteOfferCopy`: « Supprimer l'offre « {label} » ? » / sold → « Elle a déjà été achetée : elle sera archivée, pas supprimée. Les tickets achetés ne changent pas. », else « Elle disparaît de votre page. » / « Supprimer ».
- `deleteEventCopy`: title `deleteWhole` or `fromLabel === null` → « Supprimer « {title} » ? », else « Supprimer « {title} » à partir du {fromLabel} ? »; body: deleteWhole → « L'événement n'a jamais eu d'inscription : il est supprimé définitivement. »; else parts joined by a space: deletedSeances > 0 → « {plural(n,"séance sans inscrit sera supprimée","séances sans inscrit seront supprimées")}. »; cancelledSeances > 0 → « {plural(n,"séance avec inscrits sera annulée","séances avec inscrits seront annulées")} : {plural(r,"inscrit prévenu","inscrits prévenus")} par email, {plural(t,"ticket rendu","tickets rendus")}. »; both zero → « Aucune séance à venir n'est concernée. »; confirm « Supprimer ».
- `deleteTimeOffCopy`: « Supprimer cette indisponibilité ? » / « Les séances vides qu'elle masquait réapparaissent sur votre planning et votre page. » / « Supprimer ».
- `timeOffConflictCopy`: title « Des séances ont des inscrits »; intro « Cette indisponibilité chevauche {plural(n,"séance","séances")} avec des inscrits : »; cancelLabel « Annuler ces {plural(n,"séance","séances")} (tickets rendus, clients prévenus) »; keepLabel « Les garder »; keepNote « Gardées, elles restent pour leurs inscrits mais ne sont plus réservables en ligne. Vous pouvez encore y inscrire quelqu'un. »; rdvNote « Un rendez-vous compte avec ses marges avant et après. ».

**Dashboard primitives** (all in `src/components/dashboard/`)
| File | Kind | Export and props | Behaviour |
|---|---|---|---|
| `status-mark.tsx` | server-safe (no hooks) | `StatusMark({ tone, label, className }: { tone: AlertTone; label?: string; className?: string })` | `<span role="img" aria-label={label ?? ALERT_LABELS[tone]} title={…} className="inline-block size-2 shrink-0 rounded-full …">`; red = `bg-destructive`, orange = `bg-amber-500` |
| `confirm-dialog.tsx` | client | `ConfirmDialog({ open, copy, tone = "destructive", pending, error, onConfirm, onClose, children }: { open: boolean; copy: ConfirmCopy; tone?: "destructive" \| "primary"; pending: boolean; error: string \| null; onConfirm: () => void; onClose: () => void; children?: React.ReactNode })` | On `Dialog` with `title = copy.title`; body paragraph, optional `children` (extra fields such as a reason), `FormError`, footer ghost « Retour » + confirm button `copy.confirm` (`destructive` or `primary`, `Loader2` spinner when pending, both disabled while pending) |
| `empty-state.tsx` | server-safe | `EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode })` | Centered card block, icon `size-8 text-muted-foreground`, title `font-medium`, description muted, action below |
| `form-field.tsx` | server-safe | `FormField({ label, htmlFor, help, error, optional, children }: { label: string; htmlFor: string; help?: string; error?: string \| null; optional?: boolean; children: React.ReactNode })` | `Label` above (+ « (facultatif) » when optional), child, help `text-xs text-muted-foreground` (`id={htmlFor}-help`), error `text-xs text-destructive` (`id={htmlFor}-error`, `role="alert"`) |
| `form-error.tsx` | server-safe | `FormError({ message }: { message: string \| null \| undefined })` | null → nothing; else `role="alert"` box `rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive` |
| `switch.tsx` | client | `Switch({ id, checked, onCheckedChange, label, description, disabled }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean })` | `button role="switch" aria-checked` with the existing hand-rolled track/knob; label clickable |
| `skeleton.tsx` | server-safe | `Skeleton({ className })`, `PageSkeleton({ blocks = 3 }: { blocks?: number })`, `TableSkeleton({ rows = 6 }: { rows?: number })` | `animate-pulse rounded-xl bg-muted`; `aria-busy="true"` wrapper + sr-only « Chargement… » |
| `coverage-badge.tsx` | server-safe | `CoverageBadge({ coverage }: { coverage: BookingCoverage })` | `COVERAGE_LABELS`; ticket → `default`, free → `success`, guest → `neutral` |
| `booking-status-badge.tsx` | server-safe | `BookingStatusBadge({ status }: { status: BookingStatus })` | `BOOKING_STATUS_LABELS`; pending → `warning`, confirmed → `success`, cancelled / expired → `neutral` |
| `type-chip.tsx` | server-safe | `TypeChip({ name, color, archived, count }: { name: string; color: string; archived?: boolean; count?: number })` | dot in `color` + name (+ « · {count} ») + « Archivé » `neutral` badge when archived |

**`src/app/dashboard/loading.tsx`**: `PageSkeleton blocks={4}`. **`src/app/dashboard/error.tsx`** (client, `{ error, reset }`): title « Une erreur est survenue », text « Cette page n'a pas pu se charger. Réessayez dans un instant. », button « Réessayer » (`reset()`).

### 4.8 Tickets: reads, cores, wrappers (Tasks 9, 10)

**`src/lib/booking/wallet.ts` `loadTypeFacts`** (engine change, Q16): select `rdvFree` too and return `rdvEnabled: r.rdvEnabled && !r.rdvFree` (JSDoc: « an rdv_free type uses no ticket: classified like a non-RDV type, so its unusable tickets raise the orange alert »).

**`src/lib/back-office/catalog-reads.ts`**
```ts
export type OfferView = {
  id: string; ticketTypeId: string; label: string /* offerLabel() */; customLabel: string | null; quantity: number; priceCents: number;
  validityCount: number | null; validityUnit: ValidityUnit | null; validityText: string | null /* validityLabel() */;
  isActive: boolean; archived: boolean; sold: number /* paid purchases of this offer */;
};
export type AcceptedBy = { eventId: string; title: string; isPrivate: boolean };
export type TicketTypeSummary = {
  id: string; name: string; description: string | null; color: string; position: number; archived: boolean;
  rdvEnabled: boolean; rdvFree: boolean; rdvDurationMin: number | null;
  offers: OfferView[];        // non-archived offers (en vente or not), by position, createdAt, id
  acceptedBy: AcceptedBy[];   // non-archived events linking the type, one per series root (its latest segment), by title
  usableTickets: number;      // available and valid at now, every customer
  orphan: boolean;            // classifyTypes(loadTypeFacts()) === "orphan"
};
/** Every type of the pro split active / archived, by position, createdAt, id (id tie-break: concurrent creates share a position). */
export async function listTicketTypes(db: Db, professionalId: string, now: Date): Promise<{ active: TicketTypeSummary[]; archived: TicketTypeSummary[] }>;
export type TicketTypeDetail = TicketTypeSummary & {
  rdvBufferBeforeMin: number; rdvBufferAfterMin: number; rdvOverrides: WindowOverrides;
  questions: QuestionRow[]; ownHours: AvailabilityRuleInput[]; globalHours: AvailabilityRuleInput[];
  archivedOffers: OfferView[];
  usage: { tickets: number; purchases: number; rdvs: number };   // any > 0 ⇒ « Supprimer » archives
  proWindow: BookingWindow;
};
/** One type of the pro (null for another pro's or an unknown id). */
export async function getTicketTypeDetail(db: Db, professionalId: string, ticketTypeId: string, now: Date): Promise<TicketTypeDetail | null>;
export type TypeOption = { id: string; name: string; color: string; rdvFree: boolean };
/** Non-archived types, by position, createdAt, id. */
export async function listActiveTypeOptions(db: Db, professionalId: string): Promise<TypeOption[]>;
```
(`QuestionRow` from `@/lib/booking/answers`, `BookingWindow` from `@/lib/booking-window`, `WindowOverrides` / `AvailabilityRuleInput` from `@/lib/tickets`.)

**`src/server/catalog-queries.ts`** (`server-only`): `getTicketTypesPage(professionalId)`, `getTicketTypePage(professionalId, ticketTypeId)`, `getActiveTypeOptions(professionalId)` (Task 9); `getEventsPage(professionalId)`, `getEventEditorPage(professionalId, eventId)` (Task 15). Each = the read with `db` and `new Date()`.

**`src/lib/back-office/catalog-actions.ts`** (context `catalog` unless stated)
```ts
export type TicketTypePatch = Partial<TicketTypeInput>;
export const RDV_FREE_NO_OFFER = "Un rendez-vous gratuit ne se vend pas : retirez l'option « Gratuit » pour créer une offre.";
export const RDV_FREE_HAS_SALES = "Ce type a des offres en vente ou des tickets valides : il ne peut pas devenir gratuit.";
/** parseFr(ticketTypeInputSchema), RDV window check, createTicketType. */
export async function createTicketTypeCore(db: Db, ctx: ProCtx, input: TicketTypeInput, now: Date): Promise<CoreResult<{ ticketTypeId: string }>>;
/** Reads the type (pro), merges the patch over its current values, parseFr the full type, refuses rdvFree false → true while an offer en vente or a usable ticket exists (RDV_FREE_HAS_SALES), refuses an effective notice longer than the horizon (NOTICE_TOO_LONG), then updateTicketType. */
export async function updateTicketTypeCore(db: Db, ctx: ProCtx, input: { ticketTypeId: string; patch: TicketTypePatch }, now: Date): Promise<CoreResult>;
export async function setTicketTypeArchivedCore(db: Db, ctx: ProCtx, input: { ticketTypeId: string; archived: boolean }, now: Date): Promise<CoreResult>;
/** deleteTicketType: physical delete when unused, else archived (outcome). */
export async function deleteTicketTypeCore(db: Db, ctx: ProCtx, input: { ticketTypeId: string }, now: Date): Promise<CoreResult<{ outcome: "deleted" | "archived" }>>;
/** parseFr(offerInputSchema); the type must be the pro's, not archived, not rdv_free (RDV_FREE_NO_OFFER); createOffer. */
export async function createOfferCore(db: Db, ctx: ProCtx, input: OfferInput, now: Date): Promise<CoreResult<{ offerId: string }>>;
/** parseFr(offerInputSchema) with ticketTypeId forced to the offer's own type; updateOffer. */
export async function updateOfferCore(db: Db, ctx: ProCtx, input: { offerId: string; offer: OfferInput }, now: Date): Promise<CoreResult>;
/** « En vente » toggle: reads the offer (pro, not archived) and calls updateOffer with its fields and the new isActive. */
export async function setOfferActiveCore(db: Db, ctx: ProCtx, input: { offerId: string; isActive: boolean }, now: Date): Promise<CoreResult>;
export async function deleteOfferCore(db: Db, ctx: ProCtx, input: { offerId: string }, now: Date): Promise<CoreResult<{ outcome: "deleted" | "archived" }>>;
/** Per-type RDV hours (empty list = back to the global hours): parseFr(array of availabilityRuleInputSchema, max 168), setAvailabilityRules. */
export async function setTypeHoursCore(db: Db, ctx: ProCtx, input: { ticketTypeId: string; rules: AvailabilityRuleInput[] }, now: Date): Promise<CoreResult>;
/** RDV questions: parseFr(array of questionInputSchema, max 20), setTypeQuestions. */
export async function setTypeQuestionsCore(db: Db, ctx: ProCtx, input: { ticketTypeId: string; questions: QuestionInput[] }, now: Date): Promise<CoreResult>;
```
- Every id is checked with `idSchema` through `parseFr` (OUT L113: never `undefined` from an untyped caller).
- Row → `TicketTypeInput` mapping for the merge: `{ name, description, color, rdvEnabled, rdvFree, rdvDurationMin, rdvBufferBeforeMin, rdvBufferAfterMin, rdvOverrides: { bookingHorizonDays: rdvBookingHorizonDays, minNoticeMinutes: rdvMinNoticeMinutes, cancelDeadlineHours: rdvCancelDeadlineHours } }`.

**`src/server/pro-catalog.ts`** (`"use server"`; every export = `runProAction(name, core, { publicPage: true })`)
```ts
export async function createTicketTypeAction(input: TicketTypeInput): Promise<ActionResult<{ ticketTypeId: string }>>;
export async function updateTicketTypeAction(input: { ticketTypeId: string; patch: TicketTypePatch }): Promise<ActionResult>;
export async function setTicketTypeArchivedAction(input: { ticketTypeId: string; archived: boolean }): Promise<ActionResult>;
export async function deleteTicketTypeAction(input: { ticketTypeId: string }): Promise<ActionResult<{ outcome: "deleted" | "archived" }>>;
export async function createOfferAction(input: OfferInput): Promise<ActionResult<{ offerId: string }>>;
export async function updateOfferAction(input: { offerId: string; offer: OfferInput }): Promise<ActionResult>;
export async function setOfferActiveAction(input: { offerId: string; isActive: boolean }): Promise<ActionResult>;
export async function deleteOfferAction(input: { offerId: string }): Promise<ActionResult<{ outcome: "deleted" | "archived" }>>;
export async function setTypeHoursAction(input: { ticketTypeId: string; rules: AvailabilityRuleInput[] }): Promise<ActionResult>;
export async function setTypeQuestionsAction(input: { ticketTypeId: string; questions: QuestionInput[] }): Promise<ActionResult>;
```

### 4.9 Tickets: components (Tasks 11–13)

`src/lib/back-office/format.ts` also exports (Task 3) the money input helpers the offer form uses:
```ts
/** « 25 », « 25,50 », « 25.5 » → 2500 / 2550; anything else (≤ 0, more than 2 decimals, letters) → null. */
export function parseMoneyInput(text: string): number | null;
/** 2550 → « 25,50 », 2500 → « 25 ». */
export function moneyInputValue(cents: number): string;
/** « € » for eur (Intl narrow symbol of the currency). */
export function currencySymbol(currency: string): string;
```

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `ticket-type-card.tsx` `TicketTypeCard` | server | `{ type: TicketTypeSummary; currency: string }` | none | Colour dot + name (link `/dashboard/tickets/{id}`); badges « RDV libre · {d} min » or « RDV gratuit · {d} min », « Archivé »; orange `StatusMark` + « Lié à aucun événement à venir » when `orphan && !archived`; offer lines « {label} · {formatMoney(price, currency)} » (+ « · {validityText} »), badge « Pas en vente » when inactive; no offer → « Aucune offre » (rdvFree → « Gratuit, sans ticket »); « Accepté par : {titles} » or « Accepté par aucun événement »; footer `plural(usableTickets, "ticket en circulation", "tickets en circulation")` + `Button asChild variant="secondary" size="sm"` « Modifier » |
| `new-ticket-type-button.tsx` `NewTicketTypeButton` | client | `{ label?: string }` (default « Nouveau type de ticket ») | `createTicketTypeAction` | Dialog « Nouveau type de ticket »: « Nom » (help « Par exemple « Cours collectif ». »), « Couleur » (`input type="color"`, default `DEFAULT_COLOR`); submit « Créer » (spinner); ok → `router.push("/dashboard/tickets/{id}")`; error → `FormError` |
| `ticket-type-editor.tsx` `TicketTypeInfoForm` (Task 12) | client | `{ ticketTypeId: string; initial: { name: string; description: string; color: string } }` | `updateTicketTypeAction` (patch name, description or null, color) | « Nom », « Description » (facultatif, Textarea), « Couleur »; « Enregistrer »; success « Enregistré » |
| `offer-list.tsx` `OfferList` | client | `{ ticketTypeId: string; offers: OfferView[]; archivedOffers: OfferView[]; currency: string; rdvFree: boolean; typeArchived: boolean }` | `createOfferAction`, `updateOfferAction`, `setOfferActiveAction`, `deleteOfferAction` | Rows: label, `plural(quantity,"ticket","tickets")`, price, validity or « Sans limite de validité », `plural(sold,"vendue","vendues")`; `Switch` « En vente » (disabled when `typeArchived`, help « Type archivé : ses offres ne sont pas proposées. »); « Modifier »; « Supprimer » → `ConfirmDialog(deleteOfferCopy({ label, sold: sold > 0 }))`, outcome archived → « Offre archivée : elle avait déjà été achetée. »; « Ajouter une offre » (hidden when `rdvFree`, disabled when `typeArchived`); empty « Aucune offre : ajoutez-en une pour vendre ce type. »; rdvFree note « Un rendez-vous gratuit ne se vend pas : il n'a pas d'offre. »; `<details>` « Offres archivées ({n}) ». Offer dialog (« Nouvelle offre » / « Modifier l'offre »): « Quantité » (1..100, default 1, help « Nombre de tickets de l'offre : 1 pour « À l'unité ». »), « Prix ({currencySymbol}) » (`inputMode="decimal"`, help « Pas d'offre gratuite : pour donner des tickets, utilisez « Offrir » dans la fiche client. », invalid → « Prix invalide. »), « Libellé » (facultatif, help « Laissé vide : « À l'unité » ou « Carnet de N ». »), « Validité » Select « Sans limite » / « En jours » / « En mois » + number 1..1000 (help « Comptée à partir de l'achat ; le ticket reste valable jusqu'à la fin du dernier jour. »), `Switch` « En vente » (default on); submit « Ajouter l'offre » / « Enregistrer » |
| `type-danger-zone.tsx` `TypeDangerZone` | client | `{ ticketTypeId: string; name: string; archived: boolean; used: boolean; acceptedBy: readonly string[] }` | `setTicketTypeArchivedAction`, `deleteTicketTypeAction` | Archived: « Archivé : ce type n'est plus proposé. Ses tickets restent dans les portefeuilles. » + « Désarchiver » (primary, no confirmation). Not archived: « Archiver » (secondary) → `ConfirmDialog(archiveTypeCopy({ name }), tone primary)`. Both states: « Supprimer » (destructive) → `ConfirmDialog(deleteTypeCopy({ name, used, acceptedBy }))`; outcome deleted → `router.push("/dashboard/tickets")`; archived → « Ce type a déjà servi : il a été archivé. » |
| `questions-editor.tsx` `QuestionsEditor` (Task 13) | client, presentational | `{ idPrefix: string; value: QuestionDraft[]; onChange: (next: QuestionDraft[]) => void; disabled?: boolean }` | none | Per question: « Question » (max 200), « Type de réponse » (`QUESTION_TYPE_LABELS`), choice options (inputs + « Ajouter une option », max 20, « Retirer l'option »), checkbox « Obligatoire pour le client », buttons « Monter » / « Descendre » (aria-labels « Monter la question », « Descendre la question ») and « Retirer »; « Ajouter une question » (disabled at 20); empty « Aucune question. » |
| `ticket-type-editor.tsx` `RdvSettingsForm` (Task 13) | client | `{ ticketTypeId: string; initial: { rdvEnabled: boolean; rdvFree: boolean; rdvDurationMin: number \| null; rdvBufferBeforeMin: number; rdvBufferAfterMin: number; rdvOverrides: WindowOverrides }; proWindow: BookingWindow; canBecomeFree: boolean }` | `updateTicketTypeAction` | `Switch` « Réservable en RDV libre » (description « Vos clients choisissent un créneau dans vos disponibilités. »); when on: « Durée » (number, step 5, 5..480, « min », default 60), « Marge avant » / « Marge après » (0..240, step 5, help « Temps libre réservé avant ou après chaque rendez-vous. »), `Switch` « Gratuit » (description « Sans ticket ni paiement, par exemple un appel découverte. »; disabled when `!canBecomeFree && !initial.rdvFree`, help « Retirez d'abord ses offres en vente et ses tickets valides. »), `<details>` « Règles de réservation de ce type » with `WindowOverrideFields`; « Enregistrer le RDV libre »; turning RDV off sends `rdvFree: false, rdvDurationMin: null` |
| `ticket-type-editor.tsx` `TypeQuestionsForm` (Task 13) | client | `{ ticketTypeId: string; questions: QuestionRow[] }` | `setTypeQuestionsAction` | help « Posées au client quand il réserve un rendez-vous de ce type. Vous n'êtes jamais obligé d'y répondre. »; `QuestionsEditor`; « Enregistrer les questions » |
| `type-hours-editor.tsx` `TypeHoursEditor` (Task 13) | client | `{ ticketTypeId: string; ownHours: AvailabilityRuleInput[]; globalHours: AvailabilityRuleInput[] }` | `setTypeHoursAction` | `Switch` « Horaires propres à ce type » (on when `ownHours.length > 0`); off: « Ce type suit vos disponibilités générales. » + link « Voir mes disponibilités » (`/dashboard/availability`) + (when it had own hours) « Revenir aux disponibilités générales » (sends `[]`); on: `WeeklyHoursEditor` started from own hours or a copy of the global ones; « Enregistrer les horaires » |
| `window-override-fields.tsx` `WindowOverrideFields` (Task 13) | client, presentational | `{ idPrefix: string; value: WindowOverrides; onChange: (next: WindowOverrides) => void; proWindow: BookingWindow; disabled?: boolean }` | none | Three rows, each a Select whose first option is « Comme vos réglages ({pro value}) » (→ null) then a custom value: « Réservable jusqu'à » (number 1..365 « jours à l'avance »; pro label « {n} jours »), « Au plus tard » (`NOTICE_PRESETS`; pro label `noticeLabel`), « Annulation par le client jusqu'à » (number 0..720 « heures avant le début »; pro label « {n} h avant ») |

`QuestionsEditor` also exports:
```ts
export type QuestionDraft = { key: string; id?: string; label: string; type: QuestionType; options: string[]; required: boolean };
/** Drafts of saved questions (key = id). */
export function draftsFromRows(rows: readonly QuestionRow[]): QuestionDraft[];
/** Inputs for setTypeQuestions / editEventInPlace (trimmed; options only for choice; id kept for saved ones). */
export function inputsFromDrafts(drafts: readonly QuestionDraft[]): QuestionInput[];
```

### 4.10 Événements: pure modules (Task 14)

**`src/lib/back-office/recurrence-form.ts`** (pure)
```ts
export type MonthlyChoice = "day_of_month" | "weekday_nth" | "weekday_last";
export type RecurrenceFormValue = {
  startDate: DateKey; startTime: string /* "HH:MM" */; durationMin: number;
  freq: RecurrenceFreq; interval: number; weekdays: number[]; monthlyChoice: MonthlyChoice;
  endMode: RecurrenceEnd; untilDate: DateKey | ""; occurrenceCount: number;
};
/** 1140 → "19:00". */
export function minuteToTime(minute: number): string;
/** "19:00" → 1140; anything else → null. */
export function timeToMinute(time: string): number | null;
/** Defaults: freq once, interval 1, weekdays [weekday of startDate], monthly by day, end never, count 10, until = startDate + 3 months (clamped), duration 60 unless given. */
export function defaultRecurrenceForm(start: { startDate: DateKey; startMinute: number }, durationMin?: number): RecurrenceFormValue;
/** The form of a saved rule (monthWeek -1 → weekday_last, 1..4 → weekday_nth). */
export function formFromRule(rule: RecurrenceRuleInput, durationMin: number): RecurrenceFormValue;
/** The engine rule: nulls set per freq / endMode exactly as recurrenceRuleSchema wants (once ⇒ interval 1, count 1), weekdays deduped and sorted asc, monthWeek deduced from startDate (nth = ceil(day / 7); last = -1). Null when startTime is not "HH:MM". */
export function ruleFromForm(v: RecurrenceFormValue): { rule: RecurrenceRuleInput; durationMin: number } | null;
/** Q11 choices for a monthly series starting on startDate (day of month always; nth weekday when nth ≤ 4; last weekday when it is the month's last such weekday). */
export function monthlyChoices(startDate: DateKey): { value: MonthlyChoice; label: string }[];
/** The next `limit` séances from local today (pro tz) of the rule, for the preview. */
export function previewDates(rule: RecurrenceRuleInput, durationMin: number, tz: string, now: Date, limit: number): { seriesDate: DateKey; startsAt: Date; endsAt: Date }[];
/** Q12 notes for the dates whose start is shifted (spring) or repeated (autumn) in tz. */
export function dstNoteTexts(rule: RecurrenceRuleInput, durationMin: number, tz: string, dates: readonly DateKey[]): string[];
/** describeRecurrence and monthlyDayWarning of the form; null when the form is not a valid rule. */
export function recurrenceSummary(v: RecurrenceFormValue): { label: string; warning: string | null } | null;
```
- `monthlyChoices` labels: « Le 1er de chaque mois » / « Le {d} de chaque mois »; « Le {1er|2e|3e|4e} {lundi…dimanche} de chaque mois »; « Le dernier {lundi…dimanche} de chaque mois ».
- `dstNoteTexts` (exact): shifted « Le {JJ/MM}, {HH:MM} n'existe pas (heure d'été) : la séance commence à {HH:MM réel}. »; ambiguous « Le {JJ/MM}, {HH:MM} existe deux fois (heure d'hiver) : la séance a lieu à la première. »

**`src/lib/back-office/event-defaults.ts`** (pure)
```ts
export const EVENT_DEFAULTS: { readonly durationMin: 60; readonly capacity: 12; readonly bookingMode: "tickets"; readonly color: string /* DEFAULT_COLOR */ };
/** Q10: the clicked planning cell when its date ≥ local today (minute rounded down to 30), else the next full hour today when ≤ 23:00, else tomorrow 09:00. */
export function defaultEventStart(args: { now: Date; tz: string; clicked?: { date: DateKey; minute: number } | null }): { startDate: DateKey; startMinute: number };
/** ?date=YYYY-MM-DD&minute=0..1439 of /dashboard/events/new; anything malformed → null. */
export function parseClickedCell(params: { date?: string | string[]; minute?: string | string[] }): { date: DateKey; minute: number } | null;
```

### 4.11 Événements: reads, cores, wrappers (Tasks 15, 16)

**`src/lib/back-office/event-reads.ts`**
```ts
export type EventListRow = {
  eventId: string /* current segment */; seriesRootId: string; title: string; color: string; bookingMode: BookingMode; isPrivate: boolean;
  recurrenceLabel: string; acceptedTypes: { id: string; name: string; color: string; archived: boolean }[];
  nextOccurrence: { id: string; startsAt: Date } | null; noActiveType: boolean /* tickets mode and no non-archived linked type */;
};
/** One row per series root (current segment, Q9); live = has a non-archived segment, ended = the rest; live by next séance then title, ended by latest start_date desc. */
export async function listEvents(db: Db, professionalId: string, now: Date): Promise<{ live: EventListRow[]; ended: EventListRow[] }>;
export type EventSegmentView = { eventId: string; recurrenceLabel: string; firstDate: DateKey; lastDate: DateKey | null; archived: boolean };
export type DeletePreview = { fromDate: DateKey; deleteWhole: boolean; deletedSeances: number; cancelledSeances: number; registrants: number; ticketsReturned: number };
export type EventEditorData = {
  event: {
    id: string; seriesRootId: string; version: number; title: string; description: string | null; location: string | null; color: string;
    bookingMode: BookingMode; isPrivate: boolean; capacity: number; durationMin: number; overrides: WindowOverrides;
    ticketTypeIds: string[]; questions: QuestionRow[]; rule: RecurrenceRuleInput; recurrenceLabel: string; archived: boolean;
  };
  readOnly: boolean;                  // the segment is archived (every segment of the root is)
  fromDate: DateKey | null;           // series_date of the first séance of this segment with starts_at > now (the cut d)
  remainingCount: number | null;      // remainingCount(ruleOf(event), fromDate) in count mode
  upcoming: { id: string; startsAt: Date; endsAt: Date; status: OccurrenceStatus; seatsTaken: number; capacity: number }[]; // next 10 of this segment
  otherSegments: EventSegmentView[];  // same root, other segments, by firstDate
  typeOptions: TypeOption[];          // active and not rdv_free
  linkedArchivedTypes: { id: string; name: string }[];
  futureRegistrants: number;          // active bookings on this segment's future séances
  deletePreview: DeletePreview | null; // deleteFromPreview(fromDate) when fromDate is set
  proWindow: BookingWindow;
};
export type EventEditorLookup = { kind: "ok"; data: EventEditorData } | { kind: "redirect"; eventId: string } | null;
/** Q9: resolves the series' current segment (the non-archived one owning the next scheduled séance, else the non-archived one with the latest start_date, else the latest one); another id → redirect; unknown or other pro → null. */
export async function getEventEditor(db: Db, professionalId: string, eventId: string, now: Date): Promise<EventEditorLookup>;
/** Scheduled RDV (event_id null) whose block overlaps any of the ranges (« conflit avec N RDV »). */
export async function countRdvConflicts(db: Db, professionalId: string, ranges: readonly { startsAt: Date; endsAt: Date }[]): Promise<number>;
/** What deleteSeriesFrom(fromDate) would do on this segment (same rules as the engine); null for an unknown segment. */
export async function deleteFromPreview(db: Db, professionalId: string, eventId: string, fromDate: DateKey, now: Date): Promise<DeletePreview | null>;
```
- `deleteFromPreview` rules: rows of the segment with `series_date ≥ fromDate`; `deletedSeances` = rows without any booking; `cancelledSeances` = scheduled rows with a booking history; `registrants` = active (pending + confirmed) bookings on those; `ticketsReturned` = confirmed `ticket` bookings on those; `deleteWhole` = never booked AND no row before `fromDate` AND no other segment rooted on it.

**`src/lib/back-office/event-actions.ts`**
```ts
// eventInfoSchema and EventInfoInput are added to src/lib/tickets.ts by Task 16 (one schema for the client form and the server):
//   export const eventInfoSchema = eventInputSchema.pick({ title: true, description: true, location: true, color: true, bookingMode: true, isPrivate: true, capacity: true, overrides: true, ticketTypeIds: true, questions: true });
//   export type EventInfoInput = z.input<typeof eventInfoSchema>;
export type SchedulePreview = { summary: SeriesEditSummary; textKeep: string; textCancel: string; remainingCount: number | null; inPlace: boolean; rdvConflicts: number };
export const EVENT_START_PAST = "La date de début ne peut pas être passée.";
export const EVENT_START_TOO_FAR = "La date de début doit être dans les deux prochaines années.";
export const EVENT_TYPE_UNAVAILABLE = "Un type de ticket choisi est archivé ou introuvable.";
/** parseFr(eventInputSchema); startDate in [local today, today + 730] (OUT L114); ticketTypeIds deduped, each an active non-rdv_free type of the pro (OUT L92, L114); window check; createEvent. Context "event". */
export async function createEventCore(db: Db, ctx: ProCtx, input: EventInput, now: Date): Promise<CoreResult<{ eventId: string; occurrenceCount: number }>>;
/** « Informations » (in place, Q7): parseFr(eventInfoSchema); types deduped, each active non-rdv_free OR already linked to this event; window check; editEventInPlace with the full info patch. Context "event". */
export async function editEventInfoCore(db: Db, ctx: ProCtx, input: { eventId: string; seenVersion: number; info: EventInfoInput }, now: Date): Promise<CoreResult<{ version: number }>>;
/** parseFr(recurrenceRuleSchema) + duration bounds; previewSeriesEdit; describeSeriesEdit for both orphan choices; RDV conflicts of the new dates over [max(fromDate, today), today + MATERIALIZE_DAYS]. Context "series". */
export async function previewScheduleCore(db: Db, ctx: ProCtx, input: { eventId: string; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number }, now: Date): Promise<ActionResult<{ preview: SchedulePreview }>>;
/** editSeriesFrom; eventId = the new segment after a split. Context "series". */
export async function applyScheduleCore(db: Db, ctx: ProCtx, input: { eventId: string; seenVersion: number; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number; orphans: "keep" | "cancel" }, now: Date): Promise<CoreResult<{ eventId: string; summaryText: string }>>;
/** deleteFromPreview behind validation (unknown → « Événement introuvable ou terminé. »). */
export async function deleteEventPreviewCore(db: Db, ctx: ProCtx, input: { eventId: string; fromDate: DateKey }, now: Date): Promise<ActionResult<{ preview: DeletePreview }>>;
/** deleteSeriesFrom (Q32: « Supprimer l'événement » = from the first future séance). Context "series". */
export async function deleteEventFromCore(db: Db, ctx: ProCtx, input: { eventId: string; seenVersion: number; fromDate: DateKey }, now: Date): Promise<CoreResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number }>>;
/** Create-form preview: occurrences the rule would materialise (≤ MATERIALIZE_MAX_ROWS) and their RDV conflicts. */
export async function previewNewEventCore(db: Db, ctx: ProCtx, input: { rule: RecurrenceRuleInput; durationMin: number }, now: Date): Promise<ActionResult<{ rdvConflicts: number; occurrenceCount: number }>>;
```
- Window check (also in `createTicketTypeCore` / `updateTicketTypeCore`): `noticeExceedsHorizon(effectiveWindow(proWindow, overrides))` → `actionFail(NOTICE_TOO_LONG)`.

**`src/server/pro-catalog.ts`** (Task 16 adds)
```ts
export async function createEventAction(input: EventInput): Promise<ActionResult<{ eventId: string; occurrenceCount: number }>>;   // publicPage
export async function editEventInfoAction(input: { eventId: string; seenVersion: number; info: EventInfoInput }): Promise<ActionResult<{ version: number }>>; // publicPage
export async function previewScheduleAction(input: { eventId: string; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number }): Promise<ActionResult<{ preview: SchedulePreview }>>; // runProQuery
export async function applyScheduleAction(input: { eventId: string; seenVersion: number; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number; orphans: "keep" | "cancel" }): Promise<ActionResult<{ eventId: string; summaryText: string }>>; // publicPage
export async function deleteEventPreviewAction(input: { eventId: string; fromDate: DateKey }): Promise<ActionResult<{ preview: DeletePreview }>>; // runProQuery
export async function deleteEventFromAction(input: { eventId: string; seenVersion: number; fromDate: DateKey }): Promise<ActionResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number }>>; // publicPage
export async function previewNewEventAction(input: { rule: RecurrenceRuleInput; durationMin: number }): Promise<ActionResult<{ rdvConflicts: number; occurrenceCount: number }>>; // runProQuery
```

### 4.12 Événements: components (Tasks 17–20)

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `event-list.tsx` `EventList` | server | `{ live: EventListRow[]; ended: EventListRow[]; tz: string }` | none | ≥ 640 px table: « Événement » (dot + title link `/dashboard/events/{eventId}` + recurrence label + « Privé » badge), « Mode » (`MODE_SHORT_LABELS`), « Tickets acceptés » (`TypeChip`s, or « Aucun »; `noActiveType` → orange `StatusMark` label « Aucun ticket actif accepté » + that text), « Prochaine séance » (`formatWhenShort` or « Aucune séance à venir »); < 640 px: one card per row with the same facts; `<details>` « Terminés ({n}) » for `ended` |
| `recurrence-editor.tsx` `RecurrenceEditor` | client, presentational | `{ idPrefix: string; value: RecurrenceFormValue; onChange: (next: RecurrenceFormValue) => void; minDate: DateKey; disabled?: boolean; fieldErrors?: Record<string, string> }` | none | « Date de début » (`type="date"`, `min`), « Heure de début » (`type="time"`, `step=300`), « Durée » (number, step 5, 5..720, « min », help « Par pas de 5 minutes. »), « Répétition » Select: « Une seule fois », « Tous les jours », « Toutes les semaines », « Tous les mois »; interval « Tous les [N] jours / semaines / mois » (max 31 / 52 / 12); weekly toggles in `WEEK_ORDER` with `WEEKDAY_LETTERS`, `aria-pressed`, aria-label full day name, help « Choisissez au moins un jour. »; monthly radios from `monthlyChoices(startDate)`; « Fin » radios « Jamais », « Le » + date (≤ start + 5 ans), « Après » + number 1..730 + « séances »; field errors below each field |
| `recurrence-editor.tsx` `RecurrencePreview` | client | `{ value: RecurrenceFormValue; tz: string; nowIso: string; rdvConflicts: number \| null }` | none | Label of `recurrenceSummary` (bold) + its warning (amber); up to 3 `dstNoteTexts` + « et {n} autres changements d'heure »; « Prochaines séances » list of 5 `formatWhenShort`; `rdvConflicts > 0` → « Conflit avec {plural(n,"RDV déjà réservé","RDV déjà réservés")} : les deux apparaîtront dans votre planning. »; invalid → « Complétez la récurrence pour voir l'aperçu. » |
| `event-editor.tsx` `EventInfoFields` | client, presentational | `{ idPrefix: string; value: EventInfoValue; onChange: (next: EventInfoValue) => void; typeOptions: TypeOption[]; linkedArchivedTypes: { id: string; name: string }[]; proWindow: BookingWindow; fieldErrors: Record<string, string>; disabled?: boolean }` | none | « Titre », « Description » (facultatif), « Lieu » (facultatif, help « Le lieu peut aussi changer séance par séance, depuis le planning. »), « Couleur », « Mode de réservation » (3 radio cards: `BOOKING_MODE_LABELS` + `MODE_HELP`), « Tickets acceptés » (tickets mode only: one checkbox per option with `TypeChip`, archived linked ones checked with « Archivé »; help « Une liste vide n'accepte personne : l'événement sera signalé. »; no option → « Aucun type de ticket actif. » + link « Créer un type de ticket » `/dashboard/tickets`), `Switch` « Privé » (description « Masqué de votre page publique : vous y inscrivez vos clients vous-même. »), « Places » (1..500, help « Par séance. »), « Questions d'inscription » (`QuestionsEditor`, help « Posées au client quand il s'inscrit. Vous n'êtes jamais obligé d'y répondre. »), `<details>` « Règles de réservation » (`WindowOverrideFields`) |
| `event-editor.tsx` `EventCreateForm` (Task 19) | client | `{ tz: string; nowIso: string; todayKey: DateKey; initialStart: { startDate: DateKey; startMinute: number }; typeOptions: TypeOption[]; proWindow: BookingWindow }` | `previewNewEventAction` (debounced 600 ms when `ruleFromForm` is valid), `createEventAction` | Card « Informations » (`EventInfoFields`, defaults from `EVENT_DEFAULTS`), Card « Horaire » (`RecurrenceEditor` min = todayKey + `RecurrencePreview`); « Créer l'événement »; client `parseFr(eventInputSchema)` → field errors; ok → `router.push("/dashboard/events/{eventId}")` |
| `event-editor.tsx` `EventInfoForm` (Task 20) | client | `{ eventId: string; seenVersion: number; initial: EventInfoValue; typeOptions: TypeOption[]; linkedArchivedTypes: { id: string; name: string }[]; proWindow: BookingWindow; futureRegistrants: number; readOnly: boolean }` | `editEventInfoAction` (with `props.seenVersion` read at submit time) | `EventInfoFields` (disabled when readOnly); when the location differs from the saved one and `futureRegistrants > 0`: « {plural(n,"inscrit","inscrits")} des séances à venir seront prévenus du changement de lieu. »; « Enregistrer les informations »; success « Informations enregistrées. » |
| `event-schedule-form.tsx` `EventScheduleForm` | client | `{ eventId: string; seenVersion: number; fromDate: DateKey \| null; tz: string; nowIso: string; initial: RecurrenceFormValue; remainingCount: number \| null; readOnly: boolean }` | `previewScheduleAction`, `applyScheduleAction` | fromDate null → « Plus aucune séance à venir dans cette série : l'horaire ne se modifie plus. »; else « Les changements s'appliquent à partir du {JJ/MM/AAAA}, la première séance à venir. » + count mode « Il reste {K} séances. » (form pre-filled « après K séances »); `RecurrenceEditor` (min = fromDate) + `RecurrencePreview`; « Prévisualiser les changements » → summary text (`textKeep` / `textCancel` per choice), when `summary.orphans > 0` radios « Garder (séance isolée) » (default) / « Annuler (tickets rendus) », `inPlace` → « Aucune séance passée dans cette série : la modification s'applique directement. », RDV conflicts line; « Appliquer à partir du {JJ/MM} » enabled only after a preview of the current value (any edit clears it); ok → `router.push("/dashboard/events/{eventId}")` |
| `event-delete-card.tsx` `EventDeleteCard` | client | `{ eventId: string; seenVersion: number; title: string; todayKey: DateKey; fromDate: DateKey \| null; initialPreview: DeletePreview \| null }` | `deleteEventPreviewAction`, `deleteEventFromAction` | fromDate null → « Plus aucune séance à venir. »; « Supprimer l'événement » (destructive) → `ConfirmDialog(deleteEventCopy({ title, fromLabel: preview.deleteWhole ? null : JJ/MM(fromDate), …preview }))` → ok: `deletedEvent` → `router.push("/dashboard/events")`, else « Les séances à venir sont supprimées. »; « Supprimer à partir du… » (secondary) → date (min = max(todayKey, fromDate)) + « Voir les conséquences » → preview → `ConfirmDialog` |

`event-editor.tsx` also exports:
```ts
export type EventInfoValue = {
  title: string; description: string; location: string; color: string; bookingMode: BookingMode; isPrivate: boolean;
  capacity: number; overrides: WindowOverrides; ticketTypeIds: string[]; questions: QuestionDraft[];
};
/** The EventInfoInput of a form value ("" → null, questions via inputsFromDrafts). */
export function eventInfoInput(v: EventInfoValue): EventInfoInput;
```

### 4.13 Planning: reads, view model, query wrapper (Task 21)

**`src/lib/back-office/planning-reads.ts`**
```ts
export type PlanningAttendee = {
  bookingId: string; customerId: string; name: string; email: string; phone: string | null;
  status: "pending" | "confirmed"; coverage: BookingCoverage; createdBy: Actor;
  ticket: { id: string; typeName: string; expiresAt: Date | null; purchased: boolean } | null;
  holdExpiresAt: Date | null; answers: { label: string; value: string }[]; customerNotes: string | null; movedAt: Date | null; createdAt: Date;
};
export type PlanningQuestion = { id: string; label: string; type: QuestionType; options: string[] | null; required: boolean };
export type PlanningItem = {
  id: string; kind: "seance" | "rdv"; eventId: string | null; eventVersion: number | null; ticketTypeId: string | null;
  title: string; color: string; startsAt: Date; endsAt: Date; status: OccurrenceStatus;
  capacity: number; seatsTaken: number; elapsedHolds: number; seatsShown: number;
  location: string | null; eventLocation: string | null; locationOverride: string | null;
  bookingMode: BookingMode | null; isPrivate: boolean; acceptedTypes: { id: string; name: string; color: string }[];
  questions: PlanningQuestion[]; seriesDate: DateKey | null; recurring: boolean /* event freq ≠ once */;
  canRestore: boolean /* cancelled event séance, starts_at > now, segment not archived and series_date ≤ until_date (or no until) */;
  attendees: PlanningAttendee[]; // pending + confirmed, by createdAt
};
export type PlanningTimeOff = { id: string; startAt: Date; endAt: Date; allDay: boolean; reason: string | null };
/** Occurrences overlapping [start, end) (starts_at < end AND ends_at > start), cancelled RDVs excluded, cancelled séances kept; attendees, answers, ticket and accepted types loaded with inArray; overlapping time off. Never hides anything else (planning-view does). */
export async function getPlanningRange(db: Db, professionalId: string, range: { start: Date; end: Date }, now: Date): Promise<{ items: PlanningItem[]; timeOff: PlanningTimeOff[] }>;
/** One occurrence of the pro (null otherwise). */
export async function getPlanningItem(db: Db, professionalId: string, occurrenceId: string, now: Date): Promise<PlanningItem | null>;
export type CustomerHit = { id: string; name: string; email: string; phone: string | null };
/** q trimmed, < 2 chars → []; ILIKE on name or email with %, _ and \ escaped; by name; at most `limit` (default 8). */
export async function searchCustomers(db: Db, professionalId: string, q: string, limit?: number): Promise<CustomerHit[]>;
export type RegisterOptions = { mode: BookingMode; alreadyBooked: boolean; usable: { id: string; typeName: string; expiresAt: Date | null; purchased: boolean }[] };
/** Checks that the occurrence is an event séance of the pro and the customer is the pro's (else null), then usableTickets (« utilisable ici ») and an active booking check. */
export async function registerOptions(db: Db, professionalId: string, occurrenceId: string, customerId: string): Promise<RegisterOptions | null>;
export type MoveTarget = {
  occurrenceId: string; seriesRootId: string; title: string; startsAt: Date; endsAt: Date; seatsShown: number; capacity: number;
  full: boolean; accepted: boolean; conversionTypes: { id: string; name: string }[]; expiresBefore: boolean;
};
/** Q18: for a confirmed booking of the pro on an event séance, the scheduled event séances of the next `days` (default 60) other than the source; ticket coverage keeps only tickets-mode targets, `accepted` = the ticket's type is linked, else `conversionTypes` = active non-rdv_free linked types (target dropped when empty); `expiresBefore` = ticket expires_at ≤ target start; null when the booking is not the pro's or not movable. */
export async function moveTargets(db: Db, professionalId: string, bookingId: string, now: Date, opts?: { seriesRootId?: string | null; days?: number }): Promise<{ series: { seriesRootId: string; title: string }[]; targets: MoveTarget[] } | null>;
```

**`src/lib/back-office/planning-view.ts`** (pure)
```ts
export type PlanningAttendeeVM = {
  bookingId: string; customerId: string; name: string; email: string; phone: string | null;
  status: "pending" | "confirmed"; coverage: BookingCoverage;
  ticketLabel: string | null; // « Cours collectif · valable jusqu'au 12/01 inclus » (+ « · offert »)
  holdUntil: string | null;   // « 19:45 »
  answers: { label: string; value: string }[]; notes: string | null; moved: boolean;
};
export type PlanningItemVM = {
  id: string; kind: "seance" | "rdv"; eventId: string | null; eventVersion: number | null; title: string; color: string;
  startsAt: string; endsAt: string; dayKey: DateKey; startMinute: number; endMinute: number; lane: number; lanes: number;
  status: OccurrenceStatus; capacity: number; seatsTaken: number; seatsShown: number;
  location: string | null; eventLocation: string | null; locationOverride: string | null;
  bookingMode: BookingMode | null; isPrivate: boolean; acceptedTypes: { id: string; name: string; color: string }[];
  questions: PlanningQuestion[]; recurring: boolean; canRestore: boolean; started: boolean; past: boolean;
  attendees: PlanningAttendeeVM[];
};
export type TimeOffSegmentVM = { id: string; dayKey: DateKey; startMinute: number; endMinute: number; allDay: boolean; reason: string | null };
/** An empty scheduled event séance overlapping a time off is hidden (spec § 7); RDVs and booked or cancelled séances never. */
export function hiddenByTimeOff(item: Pick<PlanningItem, "kind" | "status" | "seatsTaken" | "startsAt" | "endsAt">, timeOff: readonly { startAt: Date; endAt: Date }[]): boolean;
/** Items → VMs in tz: hidden ones dropped, wall-clock minutes (endMinute 1440 when the end is on a later day), lanes per day via layoutLanes, ISO instants. */
export function toPlanningVM(items: readonly PlanningItem[], timeOff: readonly PlanningTimeOff[], tz: string, now: Date): PlanningItemVM[];
/** A time off cut into one segment per covered day of `days` (wall-clock minutes in tz). */
export function timeOffSegments(timeOff: readonly PlanningTimeOff[], days: readonly DateKey[], tz: string): TimeOffSegmentVM[];
/** Visible hours: 8..21 widened by the items (all-day time off does not widen). */
export function gridHours(items: readonly PlanningItemVM[]): { startHour: number; endHour: number };
/** « 12 au 18 octobre 2026 », « 28 septembre au 4 octobre 2026 », « 29 décembre 2026 au 4 janvier 2027 ». */
export function weekTitle(days: readonly DateKey[]): string;
/** Minute of a click offset in a day column, rounded down to 30, within 0..1410. */
export function minuteFromOffset(offsetPx: number, startHour: number, hourPx: number): number;
```

**`src/server/planning-queries.ts`** (`server-only`)
```ts
export type PlanningPageData = {
  tz: string; days: DateKey[]; todayKey: DateKey; title: string; nav: { prev: DateKey; next: DateKey; today: DateKey };
  items: PlanningItemVM[]; timeOff: TimeOffSegmentVM[]; startHour: number; endHour: number; nowIso: string; needsHorizon: boolean;
};
/** The week of `weekParam` (YYYY-MM-DD, any day; invalid → this week) in the pro tz: Monday 00:00 → next Monday 00:00 by local date (planning.ts), getPlanningRange, toPlanningVM, timeOffSegments, gridHours, weekTitle, needsHorizon(minGeneratedUntil). */
export async function getPlanningPage(pro: { id: string; timezone: string }, weekParam: string | undefined): Promise<PlanningPageData>;
```

### 4.14 Planning: cores and wrappers (Tasks 22, 23, 28)

Task 22 writes `planning-actions.ts` with `occurrenceEditSchema`, `TIME_PARTS_REQUIRED`, `updateOccurrenceCore`, `expiringBeforeCore`, `updateCapacityCore`, `cancelOccurrenceCore`, `restoreOccurrenceCore`, `unenrollCore`, `previewFollowingCore`, `applyFollowingCore`, and creates `pro-planning.ts` with their wrappers. Task 23 adds `registerInputSchema`, `REGISTER_*`, `CONVERSION_TYPE_UNAVAILABLE`, `registerAttendeeCore`, `moveAttendeeCore`, `searchCustomersCore`, `registerOptionsCore`, `MoveTargetVM`, `moveTargetsCore` and their wrappers, plus the engine fix below. Task 28 adds the time-off wrappers.

**Engine fix (Task 23, OUT L119)**: `spendTicket` (`src/lib/booking/eligibility.ts`) ends its `insert into ticket_movement … select … from u` with `returning ticket_id`; `registerPro` and `bookWithHeldTicket` remember the index of their `spendTicket` query in the batch and read `(res.results[i] as { rows: { ticket_id: string }[] }).rows[0].ticket_id`; `bookedTicketOf` is deleted. Return types unchanged.

**`src/lib/back-office/planning-actions.ts`**
```ts
export const occurrenceEditSchema: z.ZodObject<{
  occurrenceId: /* idSchema */; seenStartsAt: /* z.iso.datetime() */;
  date: /* dateKeySchema.optional() */; startMinute: /* z.number().int().min(0).max(1439).optional() */;
  durationMin: /* z.number().int().min(5).max(720).multipleOf(5).optional() */;
  locationOverride: /* z.string().trim().max(BOUNDS.location).nullable().optional() */;
  unenrollBookingIds: /* z.array(idSchema).max(500).default([]) */;
}>;
export type OccurrenceEditInput = z.input<typeof occurrenceEditSchema>;
export const registerInputSchema: z.ZodObject<{
  occurrenceId: /* idSchema */;
  customer: /* z.discriminatedUnion("kind", [z.object({ kind: z.literal("existing"), customerId: idSchema }), z.object({ kind: z.literal("new"), name: z.string(), email: z.string(), phone: z.string().nullable() })]) */;
  coverage: /* z.enum(["auto", "guest"]) */; ticketId: /* idSchema.nullable() */; extraSeat: /* z.boolean() */; answers: /* answersInputSchema */;
}>;
export type RegisterInput = z.input<typeof registerInputSchema>;
export const REGISTER_RDV = "Un rendez-vous ne s'inscrit pas depuis le planning.";
export const REGISTER_NONE_GUEST = "Séance sans réservation en ligne : inscrivez ce client comme invité.";
export const REGISTER_NO_TICKET_MODE = "Cette séance n'accepte pas de ticket : choisissez « Invité ».";
export const TIME_PARTS_REQUIRED = "Indiquez la date et l'heure.";
export const CONVERSION_TYPE_UNAVAILABLE = "Ce type ne peut pas recevoir de tickets.";

/** « Cette séance »: date + startMinute → instantAt(date, minute, ctx.timezone) (both or neither, else TIME_PARTS_REQUIRED); updateOccurrence with seenStartsAt = new Date(iso). Context "occurrence". */
export async function updateOccurrenceCore(db: Db, ctx: ProCtx, input: OccurrenceEditInput, now: Date): Promise<CoreResult<{ timeChanged: boolean }>>;
/** Preview of « Déplacement au-delà de la validité »: bookingsExpiringBefore at instantAt(date, minute, tz). */
export async function expiringBeforeCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; date: DateKey; startMinute: number }, now: Date): Promise<ActionResult<{ bookings: { bookingId: string; customerName: string; expiryText: string }[] }>>;
/** Q19: scope "occurrence" → updateOccurrence({ capacity }) (context occurrence); scope "event" → editEventInPlace({ capacity }) on the séance's event with seenVersion (context event). */
export async function updateCapacityCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; seenStartsAt: string; scope: "occurrence" | "event"; capacity: number; seenVersion: number | null }, now: Date): Promise<CoreResult>;
/** E6b. Context "cancel". */
export async function cancelOccurrenceCore(db: Db, ctx: ProCtx, input: { occurrenceId: string }, now: Date): Promise<CoreResult<{ bookingsCancelled: number; ticketsReturned: number }>>;
/** Rétablir. Context "restore". */
export async function restoreOccurrenceCore(db: Db, ctx: ProCtx, input: { occurrenceId: string }, now: Date): Promise<CoreResult>;
/** E6a « Désinscrire » (past séances too). Context "unenroll". */
export async function unenrollCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; bookingIds: string[]; reason: string | null }, now: Date): Promise<CoreResult<{ cancelled: number; ticketsReturned: number }>>;
/** E2 pro « Inscrire » (steps below). Context "register". */
export async function registerAttendeeCore(db: Db, ctx: ProCtx, input: RegisterInput, now: Date): Promise<CoreResult<{ bookingId: string; customerId: string; coverage: BookingCoverage; customerCreated: boolean }>>;
/** E8 « Déplacer »: convertToTicketTypeId must be an active non-rdv_free type of the pro (CONVERSION_TYPE_UNAVAILABLE); moveAttendee; ticket_expires_before comes back with code "ticket_expires_before" so the UI offers « Déplacer quand même ». Context "move". */
export async function moveAttendeeCore(db: Db, ctx: ProCtx, input: { bookingId: string; targetOccurrenceId: string; force: boolean; convertToTicketTypeId: string | null }, now: Date): Promise<CoreResult<{ converted: boolean }>>;
/** Q8 « Cette séance et les suivantes » from the dialog, time and duration only: rule = ruleOf(event) with startDate = this séance's series_date, startMinute = new, occurrenceCount = remainingCount(old rule, series_date) in count mode; previewSeriesEdit. Context "series". */
export async function previewFollowingCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; startMinute: number; durationMin: number }, now: Date): Promise<ActionResult<{ text: string; fromDate: DateKey }>>;
/** Same rule; editSeriesFrom with orphans "keep". Context "series". */
export async function applyFollowingCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; seenVersion: number; startMinute: number; durationMin: number }, now: Date): Promise<CoreResult<{ eventId: string; summaryText: string }>>;
/** searchCustomers behind validation. */
export async function searchCustomersCore(db: Db, ctx: ProCtx, input: { q: string }, now: Date): Promise<ActionResult<{ customers: CustomerHit[] }>>;
/** registerOptions as client data (expiryText via expiryLabel). Null read → « Séance ou client introuvable. ». */
export async function registerOptionsCore(db: Db, ctx: ProCtx, input: { occurrenceId: string; customerId: string }, now: Date): Promise<ActionResult<{ mode: BookingMode; alreadyBooked: boolean; usable: { id: string; label: string }[] }>>;
export type MoveTargetVM = {
  occurrenceId: string; seriesRootId: string; title: string; whenLabel: string; dayKey: DateKey;
  seatsShown: number; capacity: number; full: boolean; accepted: boolean; conversionTypes: { id: string; name: string }[]; expiresBefore: boolean;
};
/** moveTargets as client data. Null read → « Cette inscription ne peut pas être déplacée. ». */
export async function moveTargetsCore(db: Db, ctx: ProCtx, input: { bookingId: string; seriesRootId: string | null }, now: Date): Promise<ActionResult<{ series: { seriesRootId: string; title: string }[]; targets: MoveTargetVM[] }>>;
```
`registerAttendeeCore` steps (exact order): 1) `parseFr(registerInputSchema)`; 2) load the occurrence (pro): unknown → « Séance introuvable. »; RDV → `REGISTER_RDV`; cancelled → `PRO_CONTEXT_MESSAGES.register.unavailable`; 3) mode `none` and coverage `auto` → `REGISTER_NONE_GUEST`; `ticketId` set and (coverage `guest` or mode ≠ `tickets`) → `REGISTER_NO_TICKET_MODE`; 4) customer `existing` → its id; `new` → `parseFr(customerInputSchema, { name, email, phone: phone ?? undefined })` then engine `createCustomer` (`customerCreated = created`); 5) `registerPro({ professionalId, actorUserId, occurrenceId, customerId, asGuest: coverage === "guest", ticketId, extraSeat, answers })`; effects returned.
`registerOptionsCore` usable label: « {typeName} · {expiryLabel} » + « · offert » when not purchased.

**`src/server/pro-planning.ts`** (`"use server"`; writes `runProAction(…, { publicPage: true })`, reads `runProQuery`)
```ts
export async function updateOccurrenceAction(input: OccurrenceEditInput): Promise<ActionResult<{ timeChanged: boolean }>>;
export async function expiringBeforeAction(input: { occurrenceId: string; date: DateKey; startMinute: number }): Promise<ActionResult<{ bookings: { bookingId: string; customerName: string; expiryText: string }[] }>>; // query
export async function updateCapacityAction(input: { occurrenceId: string; seenStartsAt: string; scope: "occurrence" | "event"; capacity: number; seenVersion: number | null }): Promise<ActionResult>;
export async function cancelOccurrenceAction(input: { occurrenceId: string }): Promise<ActionResult<{ bookingsCancelled: number; ticketsReturned: number }>>;
export async function restoreOccurrenceAction(input: { occurrenceId: string }): Promise<ActionResult>;
export async function unenrollAction(input: { occurrenceId: string; bookingIds: string[]; reason: string | null }): Promise<ActionResult<{ cancelled: number; ticketsReturned: number }>>;
export async function registerAttendeeAction(input: RegisterInput): Promise<ActionResult<{ bookingId: string; customerId: string; coverage: BookingCoverage; customerCreated: boolean }>>;
export async function moveAttendeeAction(input: { bookingId: string; targetOccurrenceId: string; force: boolean; convertToTicketTypeId: string | null }): Promise<ActionResult<{ converted: boolean }>>;
export async function previewFollowingAction(input: { occurrenceId: string; startMinute: number; durationMin: number }): Promise<ActionResult<{ text: string; fromDate: DateKey }>>; // query
export async function applyFollowingAction(input: { occurrenceId: string; seenVersion: number; startMinute: number; durationMin: number }): Promise<ActionResult<{ eventId: string; summaryText: string }>>;
export async function searchCustomersAction(input: { q: string }): Promise<ActionResult<{ customers: CustomerHit[] }>>; // query
export async function registerOptionsAction(input: { occurrenceId: string; customerId: string }): Promise<ActionResult<{ mode: BookingMode; alreadyBooked: boolean; usable: { id: string; label: string }[] }>>; // query
export async function moveTargetsAction(input: { bookingId: string; seriesRootId: string | null }): Promise<ActionResult<{ series: { seriesRootId: string; title: string }[]; targets: MoveTargetVM[] }>>; // query
// Task 28:
export async function previewTimeOffAction(input: TimeOffForm): Promise<ActionResult<{ conflicts: TimeOffConflictVM[] }>>; // query
export async function createTimeOffAction(input: TimeOffForm & { seenOccurrenceIds: string[]; cancelBooked: boolean }): Promise<ActionResult<{ cancelledOccurrences: number }>>;
export async function deleteTimeOffAction(input: { timeOffId: string }): Promise<ActionResult>;
```

**`src/lib/back-office/time-off-actions.ts`** (Task 28)
```ts
export const timeOffFormSchema: z.ZodObject<{
  startDate: /* dateKeySchema */; endDate: /* dateKeySchema */; allDay: /* z.boolean() */;
  startMinute: /* z.number().int().min(0).max(1439).optional() */; endMinute: /* z.number().int().min(1).max(1440).optional() */;
  reason: /* z.string().trim().max(BOUNDS.note).optional() */;
}>;
export type TimeOffForm = z.input<typeof timeOffFormSchema>;
export type TimeOffConflictVM = { occurrenceId: string; kind: "seance" | "rdv"; title: string; whenLabel: string; activeBookings: number };
export const TIME_OFF_TOO_LONG = "Une indisponibilité dure au plus un an.";
/** parseFr; buildTimeOffInterval(input, ctx.timezone) (its French Error message is returned as is); > 366 days → TIME_OFF_TOO_LONG; previewTimeOffConflicts with the same `now`; kind read from occurrence.event_id. */
export async function previewTimeOffCore(db: Db, ctx: ProCtx, input: TimeOffForm, now: Date): Promise<ActionResult<{ conflicts: TimeOffConflictVM[] }>>;
/** Same interval; createTimeOffWithConflicts({ seenOccurrenceIds, cancelBooked, allDay, reason }); stale → code "stale" (the UI re-previews). Context "timeOff". */
export async function createTimeOffCore(db: Db, ctx: ProCtx, input: TimeOffForm & { seenOccurrenceIds: string[]; cancelBooked: boolean }, now: Date): Promise<CoreResult<{ cancelledOccurrences: number }>>;
/** One statement DELETE … WHERE id AND professional_id (ruling C4); nothing deleted → « Indisponibilité introuvable. ». */
export async function deleteTimeOffCore(db: Db, ctx: ProCtx, input: { timeOffId: string }, now: Date): Promise<CoreResult>;
```

### 4.15 Planning: components (Tasks 24–28)

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `planning-calendar.tsx` `PlanningCalendar` | client | `{ tz: string; days: DateKey[]; todayKey: DateKey; title: string; startHour: number; endHour: number; items: PlanningItemVM[]; timeOff: TimeOffSegmentVM[]; nav: { prev: DateKey; next: DateKey; today: DateKey }; openOccurrenceId: string \| null; nowIso: string }` | `router.push` only | Header: links `?semaine={prev}` (aria « Semaine précédente »), title, `?semaine={next}` (« Semaine suivante »), « Aujourd'hui »; `Button asChild` « Nouvel événement » (`/dashboard/events/new`). ≥ 640 px: hour grid × 7 day columns (`HOUR_PX = 60`), items placed by `startMinute` / `endMinute` and `lane` / `lanes` (left = lane / lanes, width = 1 / lanes), block = colour, time, title, « {seatsTaken}/{capacity} » (séance) or the client's name (RDV); cancelled → `opacity-60 line-through` + sr-only « annulée »; time-off segments hatched with `title` = reason or « Indisponible »; « now » line `bg-destructive`; today column `ring-primary`; click on empty space of a column whose day ≥ todayKey → `router.push("/dashboard/events/new?date={day}&minute={minuteFromOffset}")`; every block is a `button` with aria-label « {title}, {formatWhen}, {seatsTaken} inscrits sur {capacity} ». < 640 px: 7 day chips (« lun. 12 »), default today if in the week else Monday (or the day of `openOccurrenceId`), list of the day's items and time off, empty « Rien de prévu ce jour-là. » + link « Nouvel événement ce jour » (`?date={day}`). No item and no time off in the week → line « Aucune séance cette semaine. ». Selected occurrence held by id → `OccurrenceDialog` |
| `occurrence-dialog.tsx` `OccurrenceDialog` | client | `{ item: PlanningItemVM; tz: string; nowIso: string; onClose: () => void }` | Task 25: `updateCapacityAction` (via control), `cancelOccurrenceAction`, `restoreOccurrenceAction`, `unenrollAction`; Task 26: edit form, `MoveAttendeeDialog`; Task 27: `RegisterAttendeeDialog` | Title = item title. Task 24: `formatWhen`; « Lieu : {location} » (+ « (pour cette séance) » when overridden) or « Lieu non précisé »; `MODE_SHORT_LABELS` badge; accepted `TypeChip`s; « Privé »; « Annulée » badge; séance seats « {seatsTaken} inscrits sur {capacity} · {seatsShown} places en ligne »; attendee rows: name (link `/dashboard/clients/{customerId}`), email, `CoverageBadge`, `BookingStatusBadge`, ticketLabel, « Paiement en cours jusqu'à {holdUntil} », « Déplacé », answers « {label} : {value} », « Note : {notes} »; empty « Personne n'est inscrit pour le moment. »; séance link « Ouvrir l'événement » (`/dashboard/events/{eventId}`); success line `role="status"` at the top after an action. Task 25: `SessionCapacityControl` (scheduled séance); « Annuler la séance » / « Annuler le rendez-vous » (scheduled) → `ConfirmDialog(cancelOccurrenceCopy({ kind, registrants: attendees.length, past }))`, success « Séance annulée. Les inscrits sont prévenus par email. »; « Rétablir » (`canRestore`) → `ConfirmDialog(restoreOccurrenceCopy(), tone primary)`; checkboxes + per-row « Désinscrire » + bulk « Désinscrire la sélection ({n}) » → `ConfirmDialog(unenrollCopy({ names, ticketCount, pendingCount }))` with `Textarea` « Motif (facultatif) » (max 500); RDV: per-row « Désinscrire » only (Q31). Task 26: « Modifier cette séance » (scheduled séance) swaps the body for `OccurrenceEditForm`; per-row « Déplacer » (séance, confirmed). Task 27: « Inscrire » (scheduled séance) → `RegisterAttendeeDialog`; cancelled → disabled with help « Rétablissez la séance pour inscrire quelqu'un. » |
| `session-capacity-control.tsx` `SessionCapacityControl` (Task 25) | client | `{ occurrenceId: string; seenStartsAt: string; capacity: number; seatsTaken: number; seenVersion: number \| null; recurring: boolean }` | `updateCapacityAction` | « Places » number (min max(1, seatsTaken), max 500); when `recurring && seenVersion !== null` radios « Cette séance » (default) / « Toutes les séances à venir » (help « Sauf celles dont vous avez déjà changé la capacité. »); below min → « Minimum {seatsTaken} : {plural(seatsTaken,"personne est déjà inscrite","personnes sont déjà inscrites")}. »; « Enregistrer » |
| `occurrence-edit-form.tsx` `OccurrenceEditForm` (Task 26) | client | `{ item: PlanningItemVM; tz: string; nowIso: string; onDone: (message: string) => void; onCancel: () => void }` | `expiringBeforeAction`, `updateOccurrenceAction`, `previewFollowingAction`, `applyFollowingAction` | « Date », « Heure de début », « Durée » (disabled when `item.started`, note « Cette séance a commencé : seul le lieu se modifie ici. »), « Lieu de cette séance » (facultatif, help « Laissez vide pour le lieu de l'événement : {eventLocation ?? "aucun"}. »); when date or time changes, « Enregistrer pour cette séance » first calls `expiringBeforeAction`: non-empty → « Ces inscrits ont un ticket qui expire avant la nouvelle date : » + list « {customerName} ({expiryText}) » + radios « Les garder (le ticket reste utilisé) » (default) / « Les désinscrire (ticket rendu, client prévenu) », then « Confirmer »; registrants > 0 and time or place changes → « Les inscrits sont prévenus par email. »; when `item.recurring`, only time / duration changed and not started: « Appliquer aussi aux séances suivantes » → `previewFollowingAction` → « {text} » + « À partir du {JJ/MM}. » → « Confirmer pour cette séance et les suivantes » (`seenVersion = item.eventVersion` at submit); `onDone` messages « Séance modifiée. » / « Horaire modifié pour cette séance et les suivantes. » |
| `move-attendee-dialog.tsx` `MoveAttendeeDialog` (Task 26) | client | `{ bookingId: string; customerName: string; onClose: () => void; onDone: (message: string) => void }` | `moveTargetsAction`, `moveAttendeeAction` | Title « Déplacer {customerName} »; loading « Recherche des séances… »; Select « Événement » (« Tous les événements » + `series`); targets grouped by day, radio « {whenLabel} · {title} · {plural(seatsShown,"place","places")} », badges « Accepté » (`success`) / « Conversion nécessaire » (`warning`) / « Complet » (`neutral`, radio disabled); empty « Aucune séance disponible dans les 60 prochains jours. »; conversion → Select « Convertir le ticket en » (required); `expiresBefore` or code `ticket_expires_before` → `FormError` « Ticket expiré à la date de cette séance : déplacer quand même ? » and the button becomes « Déplacer quand même » (`force: true`); « Déplacer »; ok → `onDone("Inscription déplacée. Le client est prévenu par email.")` |
| `register-attendee-dialog.tsx` `RegisterAttendeeDialog` (Task 27) | client | `{ item: PlanningItemVM; onClose: () => void; onDone: (message: string) => void }` | `searchCustomersAction` (debounce 250 ms, ≥ 2 chars), `registerOptionsAction`, `registerAttendeeAction` | Title « Inscrire à « {title} » »; « Rechercher un client » (help « Nom ou email, 2 caractères minimum. »), results as buttons « {name} · {email} », no result « Aucun client trouvé. »; « Nouveau client » → « Nom », « Email », « Téléphone » (facultatif); chosen client chip + « Changer ». Coverage: tickets mode, existing client with usable tickets → radios « Avec un ticket (celui qui expire le plus tôt) » (default), « Un ticket précis » + Select of `usable` labels, « Sans ticket (invité) »; no usable ticket → « Ce client n'a aucun ticket utilisable ici. » + link « Ouvrir sa fiche » (`/dashboard/clients/{id}`, help « pour lui offrir ou convertir un ticket ») + only « Sans ticket (invité) »; new client in tickets mode → only « Sans ticket (invité) » (note « Un nouveau client n'a pas encore de ticket. »); free mode → « Inscription libre » (default) / « Invité »; none mode → fixed « Invité » with note « Séance sans réservation en ligne : le client est inscrit comme invité. » (literal: client components never import `planning-actions.ts`). `alreadyBooked` → `FormError` « Ce client est déjà inscrit à cette séance. » and submit disabled. Checkbox « +1 place » (help « Ajoute une place si la séance est complète. »); `seatsShown === 0` → « Séance complète. Cochez « +1 place » pour l'inscrire quand même. ». Questions → « Réponses (facultatif) »: text Input / Select « Sans réponse » + options / Select « Sans réponse », « Oui », « Non ». « Inscrire »; ok → `onDone(customerCreated ? "{name} est inscrit. Sa fiche client a été créée et un email de confirmation lui a été envoyé." : "{name} est inscrit. Un email de confirmation lui a été envoyé.")` |
| `week-preview.tsx` `WeekPreview` (Task 24 types, Task 37 mount) | client | `{ tz: string; days: DateKey[]; todayKey: DateKey; items: PlanningItemVM[]; timeOff: TimeOffSegmentVM[]; startHour: number; endHour: number; weekParam: DateKey; nowIso: string }` | none | Existing Jour / Semaine toggle and geometry (`HOUR_PX = 36`) on `PlanningItemVM`; click → `OccurrenceDialog`; title « Cette semaine » / « Aujourd'hui »; link « Voir le planning » (`/dashboard/planning?semaine={weekParam}`) |
| `time-off-conflict-dialog.tsx` `TimeOffConflictDialog` (Task 28) | client | `{ open: boolean; conflicts: TimeOffConflictVM[]; pending: boolean; error: string \| null; onCancelThem: () => void; onKeep: () => void; onClose: () => void }` | none | `timeOffConflictCopy({ count })`: title, intro, list « {whenLabel} · {title} · {plural(activeBookings,"inscrit","inscrits")} »; `rdvNote` when an RDV is listed; `keepNote`; buttons `cancelLabel` (destructive) and `keepLabel` (secondary); `FormError` |
| `unavailability-manager.tsx` `UnavailabilityManager` (Task 28) | client | `{ markedDays: DateKey[]; entries: TimeOffEntry[]; todayKey: DateKey }` | `previewTimeOffAction`, `createTimeOffAction`, `deleteTimeOffAction` | Month grid and defaults from `todayKey` (pro tz), never `new Date()`. « Ajouter » → preview → no conflict: create directly (`seenOccurrenceIds: []`, `cancelBooked: false`); conflicts → `TimeOffConflictDialog`; code `stale` → preview again, keep the dialog open with the new list and the error text. Delete → `ConfirmDialog(deleteTimeOffCopy())`. Existing copy kept (« Du », « Au », « Toute la journée », « Début », « Fin », « Motif (facultatif) », « Ajouter », « À venir », « Aucune indisponibilité programmée. »), placeholder text removed from the motif field (label is enough) |

### 4.16 Réglages and disponibilités (Task 29)

**`src/lib/back-office/settings-actions.ts`** (adds)
```ts
/** parseFr(bookingSettingsSchema); noticeExceedsHorizon → NOTICE_TOO_LONG; updateBookingSettings. Context "settings". */
export async function updateBookingSettingsCore(db: Db, ctx: ProCtx, input: BookingSettings, now: Date): Promise<CoreResult>;
/** Global RDV hours: parseFr(array of availabilityRuleInputSchema, max 168); setAvailabilityRules({ ticketTypeId: null }). Context "settings". */
export async function saveAvailabilityCore(db: Db, ctx: ProCtx, input: { rules: AvailabilityRuleInput[] }, now: Date): Promise<CoreResult>;
```
**`src/server/pro.ts`** (adds, removes `saveAvailability`)
```ts
export async function updateBookingSettingsAction(input: BookingSettings): Promise<ActionResult>; // publicPage
export async function saveAvailabilityAction(rules: AvailabilityRuleInput[]): Promise<ActionResult>; // publicPage
```
`getSettingsExtras` returns `{ timezoneLocked: boolean; bookingSettings: BookingSettings }`.

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `booking-settings-form.tsx` `BookingSettingsForm` | client | `{ initial: BookingSettings }` | `updateBookingSettingsAction` | « Réservable jusqu'à » (number 1..365 + « jours à l'avance », help « Au-delà, vos séances ne sont pas encore ouvertes aux réservations. »); « Au plus tard » (`NOTICE_PRESETS`, + the current value with `noticeLabel` when not a preset; help « Passé ce délai, la séance affiche « Réservations fermées » en ligne. Vous pouvez toujours inscrire quelqu'un vous-même. »); « Annulation par le client jusqu'à » (number 0..720 + « heures avant le début », help « Passé ce délai, vous seul pouvez annuler. Un client garde ce droit jusqu'au début si vous avez changé l'horaire ou l'avez déplacé. »); note « Chaque événement et chaque type en RDV libre peut avoir ses propres règles. »; « Enregistrer les réglages »; success « Enregistré » |
| `availability-editor.tsx` `AvailabilityEditor` | client | `{ initial: { dayOfWeek: number; startMinute: number; endMinute: number }[] }` (unchanged) | `saveAvailabilityAction` | Button « Enregistrer les disponibilités »; error `FormError`; success « Enregistré » (no `router.refresh()`) |

### 4.17 Clients: pure view models (Task 30)

**`src/lib/back-office/wallet-view.ts`** (pure)
```ts
export type WalletTicketRow = {
  id: string; ticketTypeId: string; status: TicketStatus; expiresAt: Date | null; purchaseId: string | null;
  closedReason: TicketCloseReason | null; closedNote: string | null; statusChangedAt: Date; createdAt: Date;
  bookingStartsAt: Date | null; // starts_at of the occurrence of a booked ticket
};
export type WalletTypeRow = { id: string; name: string; color: string; archived: boolean };
export type WalletTicketView = { id: string; origin: "Acheté" | "Offert"; line: string; tone: "ok" | "red" | "muted"; struck: boolean };
export type WalletGroup = {
  ticketTypeId: string; name: string; color: string; archived: boolean; alert: AlertTone | null;
  usableCount: number; expirySummary: string[];
  usable: WalletTicketView[]; booked: WalletTicketView[]; expired: WalletTicketView[]; done: WalletTicketView[];
  ids: { point: string[]; convert: string[]; closePaid: string[]; closeAny: string[]; retire: string[]; unpoint: string[] };
};
/** Spec § 13.1 wallet: one group per type holding tickets (types order), red = archived type, orange = orphan class; lines and actionable ids (explicit ids, consumption order). */
export function groupWallet(tickets: readonly WalletTicketRow[], types: readonly WalletTypeRow[], classes: ReadonlyMap<string, TypeClass>, now: Date, tz: string): WalletGroup[];
```
- Buckets and lines (exact): available and valid at now → `usable`, « Disponible · {expiryLabel} », tone ok; booked with `bookingStartsAt > now` → `booked`, « Réservé pour le {JJ/MM} »; booked with a past séance → `done`, « Utilisé le {JJ/MM} » (§ 7, derived, no state change), muted struck; available past expiry or status `expired` → `expired`, « Expiré (valable jusqu'au {JJ/MM} inclus) », tone red; `used` → `done`, « Pointé le {JJ/MM} » (statusChangedAt), muted struck; `closed` with `retire` → `done`, « Retiré le {JJ/MM} » + « ({note}) »; other `closed` → `done`, « Clos le {JJ/MM} : {CLOSE_REASON_LABELS[reason]} » + « ({note}) », muted struck. `origin` = purchaseId ? « Acheté » : « Offert ».
- `expirySummary` (usable only, by last valid day asc, no-limit last): « {plural(n,"valable","valables")} jusqu'au {JJ/MM} inclus », « {n} sans limite de validité ».
- `ids.point` = `ids.convert` = `ids.closeAny` = usable ids in consumption order; `closePaid` = usable with a purchase; `retire` = usable without purchase; `unpoint` = used ids by statusChangedAt desc then id desc.

**`src/lib/back-office/history.ts`** (pure)
```ts
export type LedgerMovementRow = {
  seq: number; actionId: string; kind: MovementKind; ticketTypeId: string; fromTicketTypeId: string | null; actor: Actor;
  reason: string | null; createdAt: Date; closedReason: TicketCloseReason | null; // the ticket's closed_reason, for close movements
  occurrence: { title: string; startsAt: Date } | null;                           // through booking_id, for spend / return
};
export type HistoryLine = { key: string; text: string };
/** Q27 as amended: grouped by (action, kind, type, from type, closed reason, note, séance); newest action first; « JJ/MM HH:mm · {acteur} · {libellé} {n} {type}[ → {type B}][ ({motif ou note})][ · {séance}] ». */
export function historyLines(rows: readonly LedgerMovementRow[], typeNames: ReadonlyMap<string, string>, tz: string): HistoryLine[];
```
- Fields (exact): date = `formatDayMonthTime(createdAt, tz)`; acteur = `ACTOR_LABELS[actor]`; libellé = `MOVEMENT_KIND_LABELS[kind]`, except a close with closedReason `retire` → « Retiré »; type = the moved-from type name for `convert` (then « → {new type} »), else the type name; unknown id → « type supprimé »; motif: close (not retire) = `CLOSE_REASON_LABELS[closedReason]` + (« , {note} » when a note exists); retire, pointage, offer = the note; séance = « {title} du {JJ/MM} ». Example: « 12/10 14:03 · Vous · Converti 3 Cours collectif → Cours débutants ». At most one middle dot between two fields; no dash.

**`src/lib/back-office/client-filters.ts`** (pure)
```ts
export const CLIENT_FILTERS = ["tous", "tickets", "a-venir", "alertes"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];
export const CLIENT_FILTER_LABELS: Record<ClientFilter, string>; // « Tous », « Avec tickets », « Inscriptions à venir », « Alertes »
/** ?filter= value; "credits" (v1) → "tickets"; unknown → "tous". */
export function parseClientFilter(value: unknown): ClientFilter;
export type ClientFacts = {
  usableTickets: number; upcomingConfirmed: number; red: boolean; orange: boolean;
  confirmedBookings: number; ticketsAny: number; bookingsAny: number; purchasesAny: number;
};
/** Spec § 9: a confirmed booking ever, or at least one ticket in any state. */
export function isClient(f: Pick<ClientFacts, "confirmedBookings" | "ticketsAny">): boolean;
/** Q4: shown in the list = isClient, or never booked nor bought anything (a « Nouveau client »). */
export function isListedClient(f: ClientFacts): boolean;
/** Q5: tickets = usable > 0 (archived types included); a-venir = a confirmed booking on a future séance or RDV; alertes = red or orange. */
export function matchesClientFilter(f: ClientFacts, filter: ClientFilter): boolean;
/** /dashboard/clients?filter=…&q=… (empty parts omitted). */
export function clientsHref(filter: ClientFilter, q: string): string;
```

**`src/lib/back-office/dashboard-view.ts`** (pure)
```ts
export type KpiInput = {
  upcomingSeances7d: number; upcomingRegistrants7d: number; ticketsInCirculation: number; clients: number;
  revenue: readonly { currency: string; cents: number }[]; currency: string;
};
export type KpiTile = { key: "seances" | "tickets" | "clients" | "revenue"; label: string; value: string; hint: string | null; href: string };
/** Q25: the pro currency first (0 when absent), the other currencies after, biggest first. */
export function revenueDisplay(revenue: readonly { currency: string; cents: number }[], currency: string): { main: string; others: string[] };
/** The 4 tiles (exact labels below). */
export function kpiTiles(input: KpiInput): KpiTile[];
export type DashboardAlert = { key: string; tone: AlertTone; text: string; href: string };
/** Q28 alert lines, red first. */
export function dashboardAlerts(input: { redClients: number; orangeClients: number; eventsWithoutActiveType: readonly { eventId: string; title: string }[] }): DashboardAlert[];
export type GettingStartedStep = { key: "type" | "offer" | "event"; label: string; done: boolean; href: string };
/** Q29: the 3 steps, or null once all are done. */
export function gettingStartedSteps(input: { hasType: boolean; hasOffer: boolean; hasEvent: boolean; firstTypeId: string | null }): GettingStartedStep[] | null;
```
- Tiles (exact): « Séances à venir (7 j) » value n, hint « dont {plural(m,"inscrit","inscrits")} », href `/dashboard/planning`; « Tickets en circulation », hint null, `/dashboard/clients?filter=tickets`; « Clients », `/dashboard/clients`; « Encaissé », value `main`, hint `others.join(" · ")` or null, `/dashboard/payments`.
- Alerts (exact): red « {plural(n,"client a","clients ont")} des tickets d'un type archivé. » → `/dashboard/clients?filter=alertes`; orange « {plural(n,"client a","clients ont")} des tickets d'un type lié à aucun événement à venir. » → same; per event, orange « « {title} » n'accepte aucun ticket actif. » → `/dashboard/events/{eventId}`.
- Steps (exact): « Créer un type de ticket » → `/dashboard/tickets`; « Créer une offre » → `/dashboard/tickets/{firstTypeId}` (else `/dashboard/tickets`); « Créer un événement » → `/dashboard/events/new`.

### 4.18 Clients: reads, cores, wrappers (Tasks 31, 32)

**`src/lib/back-office/client-reads.ts`**
```ts
export type ClientListRow = {
  id: string; name: string; email: string; phone: string | null; linkedAccount: boolean;
  holdings: { ticketTypeId: string; name: string; color: string; archived: boolean; usable: number }[];
  usableTickets: number; upcomingConfirmed: number; red: boolean; orange: boolean;
};
/** Listed clients (isListedClient) matching the filter and q (ILIKE name or email, escaped), by lower(name), id, at most 500; counts per filter over every listed client (q ignored). */
export async function listClients(db: Db, professionalId: string, now: Date, opts: { q: string; filter: ClientFilter }): Promise<{ rows: ClientListRow[]; counts: Record<ClientFilter, number> }>;
/** Listed clients with a red / orange alert (dashboard card). */
export async function customerAlertCounts(db: Db, professionalId: string, now: Date): Promise<{ red: number; orange: number }>;
export type ClientBookingRow = {
  bookingId: string; occurrenceId: string; kind: "seance" | "rdv"; title: string; startsAt: string; endsAt: string; whenLabel: string;
  status: BookingStatus; coverage: BookingCoverage; ticketTypeName: string | null; occurrenceStatus: OccurrenceStatus;
  canMove: boolean;     // confirmed, event séance, scheduled, starts_at > now
  canUnenroll: boolean; // pending or confirmed (past séances too, E6a)
  moved: boolean; hasTicket: boolean; pending: boolean; planningHref: string;
};
export type ClientPurchaseRow = {
  id: string; label: string; quantity: number; amountCents: number; currency: string; status: PurchaseStatus; livemode: boolean;
  createdAt: Date; paidAt: Date | null;
};
export type ClientRecordData = {
  customer: { id: string; name: string; email: string; phone: string | null; linkedAccount: boolean; createdAt: Date };
  wallet: WalletGroup[]; typeOptions: TypeOption[];
  bookings: { upcoming: ClientBookingRow[]; past: ClientBookingRow[] }; // upcoming = active and not ended, by start asc; past = the rest, by start desc, at most 50
  purchases: ClientPurchaseRow[]; // by created_at desc
  history: HistoryLine[];
};
/** The client record (null for another pro's or an unknown customer): wallet via groupWallet(loadTypeFacts → classifyTypes), history via historyLines. */
export async function getClientRecord(db: Db, professionalId: string, customerId: string, now: Date): Promise<ClientRecordData | null>;
```

**`src/server/client-queries.ts`** (`server-only`): `getClientsPage(professionalId, opts)`, `getClientRecordPage(professionalId, customerId)` (Task 31); `resolveSpaceCustomer`, `getCustomerSpacePage` (Task 41).

**`src/lib/back-office/client-actions.ts`** (context `customer` for the first three, `wallet` for the others)
```ts
export const OFFER_RDV_FREE = "Un type « Gratuit » n'utilise pas de tickets : choisissez un autre type.";
export const CONVERT_TARGET_UNAVAILABLE = "Ce type ne peut pas recevoir de tickets.";
export const CONVERT_SAME_TYPE = "Choisissez un autre type de ticket.";
export const EXPIRY_IN_PAST = "La date de fin de validité doit être aujourd'hui ou plus tard.";
export const ticketIdsSchema: z.ZodArray</* idSchema */>; // .min(1).max(BOUNDS.walletQuantity)
/** « Nouveau client »: parseFr(customerInputSchema); createCustomer (the pro's name and phone win on an existing e-mail). */
export async function createCustomerCore(db: Db, ctx: ProCtx, input: { name: string; email: string; phone: string | null }, now: Date): Promise<CoreResult<{ customerId: string; created: boolean }>>;
/** Name and phone only (Q6: the e-mail is the record's key). */
export async function updateCustomerCore(db: Db, ctx: ProCtx, input: { customerId: string; name: string; phone: string | null }, now: Date): Promise<CoreResult>;
/** « Déconnecter ses liens »: link_version + 1. */
export async function revokeLinksCore(db: Db, ctx: ProCtx, input: { customerId: string }, now: Date): Promise<CoreResult>;
/** « Offrir N »: active non-rdv_free type (OFFER_RDV_FREE); expiresAt = expiryFromLastDay(lastValidDay, ctx.timezone) must be > now (EXPIRY_IN_PAST); offerTickets with notify (effect tickets_offered). */
export async function offerTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketTypeId: string; quantity: number; lastValidDay: DateKey | null; reason: string | null; notify: boolean }, now: Date): Promise<CoreResult<{ count: number }>>;
/** « Convertir »: explicit ids; target active and not rdv_free (CONVERT_TARGET_UNAVAILABLE); a selected ticket already of the target type → CONVERT_SAME_TYPE; convertTickets. */
export async function convertTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketIds: string[]; toTicketTypeId: string }, now: Date): Promise<CoreResult<{ count: number }>>;
/** « Clore » (rembourse / compense: paid tickets; autre: any, note required); closeTickets. */
export async function closeTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketIds: string[]; reason: "rembourse" | "compense" | "autre"; note: string | null }, now: Date): Promise<CoreResult<{ count: number }>>;
/** « Retirer » (offered tickets): closeTickets with reason retire. */
export async function retireTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketIds: string[]; note: string | null }, now: Date): Promise<CoreResult<{ count: number }>>;
/** « Pointer »: explicit ids (OUT L125: never a quantity), note in reason. */
export async function pointTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketIds: string[]; note: string | null }, now: Date): Promise<CoreResult<{ count: number }>>;
/** « Annuler le pointage »: explicit ids. */
export async function unpointTicketsCore(db: Db, ctx: ProCtx, input: { customerId: string; ticketIds: string[] }, now: Date): Promise<CoreResult<{ count: number }>>;
```

**`src/server/pro-clients.ts`** (`"use server"`; `runProAction`, no public page)
```ts
export async function createCustomerAction(input: { name: string; email: string; phone: string | null }): Promise<ActionResult<{ customerId: string; created: boolean }>>;
export async function updateCustomerAction(input: { customerId: string; name: string; phone: string | null }): Promise<ActionResult>;
export async function revokeLinksAction(input: { customerId: string }): Promise<ActionResult>;
export async function offerTicketsAction(input: { customerId: string; ticketTypeId: string; quantity: number; lastValidDay: DateKey | null; reason: string | null; notify: boolean }): Promise<ActionResult<{ count: number }>>;
export async function convertTicketsAction(input: { customerId: string; ticketIds: string[]; toTicketTypeId: string }): Promise<ActionResult<{ count: number }>>;
export async function closeTicketsAction(input: { customerId: string; ticketIds: string[]; reason: "rembourse" | "compense" | "autre"; note: string | null }): Promise<ActionResult<{ count: number }>>;
export async function retireTicketsAction(input: { customerId: string; ticketIds: string[]; note: string | null }): Promise<ActionResult<{ count: number }>>;
export async function pointTicketsAction(input: { customerId: string; ticketIds: string[]; note: string | null }): Promise<ActionResult<{ count: number }>>;
export async function unpointTicketsAction(input: { customerId: string; ticketIds: string[] }): Promise<ActionResult<{ count: number }>>;
```

### 4.19 Clients: components (Tasks 33–35)

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `client-list.tsx` `ClientList` | server | `{ rows: ClientListRow[] }` | none | ≥ 640 px table: « Client » (name link `/dashboard/clients/{id}` + email), « Tickets » (`TypeChip` per holding with `count = usable`, archived ones flagged), « À venir » (`plural(n,"inscription","inscriptions")` or « Aucune »), « Alertes » (`StatusMark` red / orange); < 640 px cards |
| `new-client-button.tsx` `NewClientButton` | client | `{}` | `createCustomerAction` | Dialog « Nouveau client »: « Nom », « Email », « Téléphone » (facultatif); « Créer la fiche »; ok → `router.push("/dashboard/clients/{customerId}")` |
| `client-header.tsx` `ClientHeader` | client | `{ customer: { id: string; name: string; email: string; phone: string \| null; linkedAccount: boolean } }` | `updateCustomerAction`, `revokeLinksAction` | Name, email, phone or « Pas de téléphone »; badge « Compte client lié » (success) / « Pas de compte client » (neutral); « Modifier » → « Nom », « Téléphone » (facultatif) + help « L'email identifie la fiche : il ne se modifie pas. », « Enregistrer » / « Annuler »; « Déconnecter ses liens » → `ConfirmDialog(revokeLinksCopy({ name }))`, success « Liens déconnectés. » |
| `client-wallet.tsx` `ClientWallet` | server | `{ customerId: string; groups: WalletGroup[]; typeOptions: TypeOption[]; todayKey: DateKey }` | (Task 35 mounts client leaves) | Card « Portefeuille »; Task 35: header `OfferTicketsButton`. Per group: dot + name, `StatusMark` + red text « Type archivé : ces tickets ne servent plus. Proposez « Convertir ». » or orange « Lié à aucun événement à venir. »; « {plural(n,"ticket utilisable","tickets utilisables")} » + `expirySummary` lines; lists `usable`, `booked`, `expired` (red), `done` in `<details>` « Utilisés et clos ({n}) » (struck, muted); each line « {origin} · {line} »; Task 35: `WalletGroupActions`. Empty: `EmptyState(Ticket, "Aucun ticket")` with action `OfferTicketsButton` (Task 35; Task 34 renders no action) |
| `client-purchases.tsx` `ClientPurchases` | server | `{ purchases: ClientPurchaseRow[]; tz: string }` | none | Card « Achats »; rows label, `formatMoney`, `formatDateShort(paidAt ?? createdAt, tz)`, `PURCHASE_STATUS_LABELS` badge (paid success, pending warning, expired neutral), « Test » badge when `!livemode`; empty « Aucun achat. » |
| `ledger-list.tsx` `LedgerList` | server | `{ lines: HistoryLine[] }` | none | Card « Historique »; first 30 in an `<ol>`, the rest under `<details>` « Afficher tout l'historique ({n}) »; empty « Aucun mouvement. » |
| `wallet-actions.tsx` `OfferTicketsButton` (Task 35) | client | `{ customerId: string; typeOptions: TypeOption[]; todayKey: DateKey }` | `offerTicketsAction` | Dialog « Offrir des tickets »: « Type » (options without rdvFree; none → « Aucun type actif : créez-en un dans Tickets. »), « Quantité » (1..100, default 1), « Validité » radios « Sans limite » / « Jusqu'au » + date (min todayKey), « Motif (facultatif) », checkbox « Prévenir le client par email »; « Offrir »; ok « {plural(n,"ticket offert","tickets offerts")}. » |
| `wallet-actions.tsx` `WalletGroupActions` (Task 35) | client | `{ customerId: string; group: { ticketTypeId: string; name: string; ids: WalletGroup["ids"] }; typeOptions: TypeOption[] }` | `pointTicketsAction`, `unpointTicketsAction`, `convertTicketsAction`, `closeTicketsAction`, `retireTicketsAction` | Buttons when their id list is non-empty: « Pointer », « Annuler le pointage », « Convertir », « Clore », « Retirer »; every dialog has « Nombre » (1..list length, default 1) and sends `ids.<list>.slice(0, n)`. Pointer: title « Pointer des tickets « {name} » », « Note (facultatif) », text « Le ticket est consommé sur place, sans inscription. », button « Pointer ». Annuler le pointage: text « Les derniers tickets pointés redeviennent disponibles, ou expirés si leur date est passée. », button « Annuler le pointage ». Convertir: « Vers le type » (options minus this type and rdvFree), text « Ils gardent leur statut (payé ou offert) et leur date de validité. », button « Convertir ». Clore: « Motif » radios « Remboursé hors Skedul » / « Compensé » (only with `closePaid`) / « Autre », « Note » (required for Autre: « Précisez le motif. »), then `ConfirmDialog(closeTicketsCopy({ count, reasonLabel }))`, ids from `closePaid` (paid reasons) or `closeAny`. Retirer: « Note (facultatif) », `ConfirmDialog(retireTicketsCopy({ count }))`. Buttons disabled while pending |
| `client-bookings.tsx` `ClientBookings` (Task 35) | client | `{ customerName: string; upcoming: ClientBookingRow[]; past: ClientBookingRow[] }` | `unenrollAction`, `MoveAttendeeDialog` | Card « Inscriptions »: « À venir » then `<details>` « Passées ({n}) »; rows whenLabel, title, `CoverageBadge`, `BookingStatusBadge`, ticket type, « Déplacé »; actions « Déplacer » (`canMove`), « Désinscrire » (`canUnenroll`) → `ConfirmDialog(unenrollCopy({ names: [customerName], ticketCount: hasTicket ? 1 : 0, pendingCount: pending ? 1 : 0 }))`, link « Voir dans le planning »; empty « Aucune inscription. » |

### 4.20 Payments and overview (Tasks 36, 37)

**`src/lib/back-office/payments-reads.ts`**
```ts
export const PAYMENTS_PERIODS = ["tout", "30j"] as const;
export type PaymentsPeriod = (typeof PAYMENTS_PERIODS)[number];
/** ?periode= value; unknown → "tout". */
export function parsePaymentsPeriod(value: unknown): PaymentsPeriod;
export type PaymentRow = {
  purchaseId: string; paidAt: Date; customerId: string; customerName: string; customerEmail: string;
  label: string; quantity: number; amountCents: number; currency: string; livemode: boolean;
  booking: { occurrenceId: string; title: string; startsAt: Date; status: BookingStatus } | null; // booking.purchase_id = purchase.id
  closedNotes: { reason: TicketCloseReason; note: string | null; count: number }[];             // closed tickets of the purchase
};
/** Paid purchases (live and test, « Test » shown by the UI) by paid_at desc, at most 200, period 30j = paid_at ≥ now − 30 d; totals = revenueByCurrency({ live, professionalId, since }) (the « Encaissé » predicate, spec § 9). */
export async function getPayments(db: Db, professionalId: string, now: Date, opts: { period: PaymentsPeriod; live: boolean }): Promise<{ rows: PaymentRow[]; totals: { currency: string; cents: number }[] }>;
```

**`src/lib/back-office/dashboard-reads.ts`**
```ts
export type BookingDetailVM = {
  bookingId: string; occurrenceId: string; kind: "seance" | "rdv"; title: string; color: string; startsAt: string; endsAt: string; whenLabel: string;
  status: BookingStatus; coverage: BookingCoverage; ticketTypeName: string | null;
  purchase: { status: PurchaseStatus; amountLabel: string; livemode: boolean } | null;
  customerId: string; customerName: string; customerEmail: string; customerPhone: string | null;
  notes: string | null; answers: { label: string; value: string }[]; planningHref: string;
};
export type DashboardData = {
  kpis: KpiInput;
  alerts: { redClients: number; orangeClients: number; eventsWithoutActiveType: { eventId: string; title: string }[] };
  gettingStarted: { hasType: boolean; hasOffer: boolean; hasEvent: boolean; firstTypeId: string | null };
  upcomingBookings: BookingDetailVM[]; // next 8 confirmed bookings with starts_at > now
};
/** Q25 KPIs, Q28 alerts (customerAlertCounts + listEvents noActiveType), Q29 steps, upcoming bookings. */
export async function getDashboardData(db: Db, pro: { id: string; timezone: string; currency: string }, now: Date, live: boolean): Promise<DashboardData>;
```
- KPI definitions (exact): séances = occurrences with `starts_at` in [now, now + 7 d): scheduled event séances not hidden by a time off (`hiddenByTimeOff`) + scheduled RDVs with a confirmed booking; registrants = confirmed bookings on those; tickets = `available` and (`expires_at` null or > now), archived types included; clients = `isClient` count; revenue = `revenueByCurrency({ live, professionalId })` all time.
- `src/server/queries.ts` adds `getPaymentsPage(pro: { id: string }, period: PaymentsPeriod)` (Task 36, `live = revenueLive()`) and `getDashboardPage(pro: { id: string; timezone: string; currency: string })` (Task 37).

| Component | Kind | Props | Calls | Content and copy (exact) |
|---|---|---|---|---|
| `payments-table.tsx` `PaymentsTable` (Task 36) | server | `{ rows: PaymentRow[]; tz: string }` | none | ≥ 640 px table « Date » (`formatDateShort`), « Client » (link + email), « Achat » (label), « Inscription liée » (title + `formatWhenShort`, or « Aucune »), « Montant » (`formatMoney` + « Test » badge when `!livemode`); under a row with closed tickets: « {plural(count,"ticket clos","tickets clos")} : {CLOSE_REASON_LABELS[reason]} » + « ({note}) »; < 640 px cards |
| `kpi-grid.tsx` `KpiGrid` (Task 37) | server | `{ tiles: KpiTile[] }` | none | `grid grid-cols-2 gap-4 lg:grid-cols-4`; each tile a `Link` → `Card` with icon (`CalendarRange`, `Ticket`, `Users`, `Euro`), value `text-2xl font-bold`, label, hint |
| `alerts-card.tsx` `AlertsCard` (Task 37) | server | `{ alerts: DashboardAlert[] }` | none | Card « Alertes »; one link per alert with `StatusMark`; empty « Aucune alerte : tout est en ordre. » |
| `getting-started.tsx` `GettingStarted` (Task 37) | server | `{ steps: GettingStartedStep[] }` | none | Card « Premiers pas », description « Trois étapes pour ouvrir les réservations. »; each step `CheckCircle2` (`text-success`) when done, `Circle` otherwise; label is a link when not done |
| `upcoming-bookings.tsx` `UpcomingBookings` (Task 37) | client | `{ bookings: BookingDetailVM[] }` | none | Card « Prochaines inscriptions »; rows whenLabel, title, customer, `CoverageBadge`; click → `BookingDetailDialog` (selection by id); empty « Aucune inscription à venir pour le moment. » |
| `booking-detail-dialog.tsx` `BookingDetailDialog` (Task 37) | client | `{ booking: BookingDetailVM; onClose: () => void }` | `unenrollAction` | Title = title; whenLabel; customer name (link `/dashboard/clients/{customerId}`), email, phone; `CoverageBadge` (+ ticket type); purchase « Payé {amountLabel} » (+ « Test ») or « Paiement en attente »; notes; answers; link « Voir dans le planning »; « Désinscrire » → `ConfirmDialog(unenrollCopy({ names: [customerName], ticketCount: coverage === "ticket" ? 1 : 0, pendingCount: status === "pending" ? 1 : 0 }))`. `paymentBadge` and the v1 VM fields (`paymentType`, `packName`, `amountPaidCents`) are deleted |
| `verify-email-banner.tsx` `VerifyEmailBanner` (Task 38) | client | `{ email: string }` | `authClient.emailOtp.sendVerificationOtp`, `authClient.emailOtp.verifyEmail`, `authClient.getSession` | Banner `role="status"` « Confirmez votre adresse {email} pour sécuriser votre compte. » + « Recevoir un code »; after a send (any outcome except 429) « Si l'adresse est valide, un code a été envoyé. » and a Dialog « Confirmer votre adresse »: « Code reçu par email » (6 digits, `inputMode="numeric"`, `autoComplete="one-time-code"`), « Confirmer », « Renvoyer le code »; wrong code « Code incorrect ou expiré. »; 429 « Trop de demandes. Réessayez dans quelques minutes. »; success → `await authClient.getSession({ query: { disableCookieCache: true } })` then `router.refresh()` (not a Server Action: allowed) |

### 4.21 Admin (Tasks 39, 40)

**`src/lib/admin-reads.ts`** (DB, no `server-only`)
```ts
export type ActivityEvent = { id: string; kind: "signup" | "pro" | "booking" | "purchase"; at: Date; userId: string; title: string; detail: string };
export const ACTIVITY_LIMIT = 50;
/** Q (spec § 13.8): pros with a confirmed booking created or a paid purchase (any livemode) in the last 30 days; confirmed bookings created in 30 days. */
export async function activityCounts30d(db: Db, now: Date): Promise<{ activePros30d: number; bookings30d: number }>;
/** « Encaissé » for admin: mergeMoney(revenueByCurrency(opts)) (biggest first, zeros dropped). Never pass professionalId "" (paidPurchaseOf widens on a falsy id). */
export async function platformRevenue(db: Db, opts: { live: boolean; since?: Date; professionalId?: string }): Promise<MoneyTotal[]>;
/** Latest confirmed bookings as feed events: title « Réservation · {businessName} », detail « {customerName} · {title} · {BOOKING_STATUS_LABELS[status]} », userId = the pro's user. */
export async function recentBookingEvents(db: Db, limit: number): Promise<ActivityEvent[]>;
/** Latest paid purchases as feed events: « Achat · {businessName} », « {customerName} · {label} · {formatMoney(amount, currency)} ». */
export async function recentPurchaseEvents(db: Db, limit: number): Promise<ActivityEvent[]>;
export type AdminBookingRow = {
  id: string; createdAt: Date; startsAt: Date; endsAt: Date; status: BookingStatus; coverage: BookingCoverage;
  proUserId: string; businessName: string; timezone: string; customerName: string; customerEmail: string; title: string;
};
/** /admin/activity « Inscriptions »: by created_at desc, ACTIVITY_LIMIT, optional status. */
export async function listRecentBookings(db: Db, status: BookingStatus | null): Promise<AdminBookingRow[]>;
export type AdminPurchaseRow = {
  id: string; createdAt: Date; paidAt: Date | null; status: PurchaseStatus; amountCents: number; currency: string; livemode: boolean;
  label: string; quantity: number; proUserId: string; businessName: string; customerName: string; customerEmail: string;
};
/** /admin/activity « Achats ». */
export async function listRecentPurchases(db: Db, status: PurchaseStatus | null): Promise<AdminPurchaseRow[]>;
export type HealthCounts = {
  pendingHolds: number;      // Q24: pending bookings created more than 1 h ago
  pendingPurchases: number;  // Q24: pending purchases with checkout_expires_at < now
  horizonLag: number;        // Q24: live segments still producing dates whose generated_until < local today + HORIZON_REFRESH_DAYS (pro tz)
  orphanPayments: { value: number; at: Date } | null;     // readHealth
  invariantViolations: { value: number; at: Date } | null; // readHealth (null = nightly never ran)
};
export async function healthCounts(db: Db, now: Date): Promise<HealthCounts>;
export type ProStats = { events: number; ticketTypes: number; confirmedBookings: number; upcoming: number; clients: number; paidPurchases: number };
/** events = non-archived series roots; ticketTypes non-archived; upcoming = pending + confirmed bookings on future occurrences; clients = isClient. */
export async function proStats(db: Db, professionalId: string, now: Date): Promise<ProStats>;
/** deletionImpact (tickets in circulation, payments in progress) + client records of this user at other pros. */
export async function deletionImpactFor(db: Db, userId: string, professionalId: string | null, now: Date): Promise<{ ticketsInCirculation: number; pendingPayments: number; clientRecordsElsewhere: number }>;
```

**`src/server/admin-queries.ts`** (`server-only`, kept shapes where pages use them):
- `getOverviewStats(now)` → `activePros30d` / `bookings30d` from `activityCounts30d`, `revenue30d = platformRevenue({ live: revenueLive(), since: since30 })`.
- `getRevenue(opts)` → `platformRevenue({ live: revenueLive(), ...opts })`.
- `getRecentActivity(limit)` merges sign-ups, pro pages, `recentBookingEvents`, `recentPurchaseEvents`; `export type { ActivityEvent } from "@/lib/admin-reads"` (local type deleted).
- `getAppHealth(now)` returns the existing fields minus `pendingBookings`, plus `...await healthCounts(db, now)`.
- `getUserDetail` uses `proStats` and `deletionImpactFor`; `export { ACTIVITY_LIMIT }`, `listRecentBookings(status)`, `listRecentPurchases(status)` wrappers.

**Admin UI (Task 40)** (exact copy)
- `app-health-card.tsx` alerts (JS strings, never JSX text with an entity + line break): pendingHolds → « {plural(n,"place en attente de paiement","places en attente de paiement")} depuis plus d'1 h » → `/admin/activity?tab=bookings&status=pending`; pendingPurchases → « {plural(n,"achat en attente","achats en attente")} après l'expiration du paiement » → `?tab=purchases&status=pending`; orphanPayments > 0 → « {plural(n,"paiement orphelin","paiements orphelins")} à rembourser dans Stripe (dernier le {formatDateShort(at, ADMIN_TZ)}) »; horizonLag > 0 → « {plural(n,"série en retard d'horizon","séries en retard d'horizon")} »; rows « Contrôle nocturne » = « Jamais exécuté » (neutral) / « OK le {date} » (success) / « {plural(n,"violation","violations")} le {date} » (warning). `PENDING_NOTE` removed.
- `/admin/activity`: rebuilt from `git show 0552fef:src/app/admin/activity/page.tsx`: tabs « Inscriptions » / « Achats »; status `FilterChips` (`BOOKING_STATUS_LABELS` / `PURCHASE_STATUS_LABELS`); Inscriptions columns « Séance » (`formatWhen(startsAt, endsAt, timezone)`), « Pro » (`/admin/users/{proUserId}`), « Client », « Titre », « Couverture » (`COVERAGE_LABELS`), « Statut » (pending warning, confirmed success, cancelled / expired neutral); Achats columns « Date », « Pro », « Client », « Libellé », « Montant », « Statut » + « Test » when `!livemode`; description `Les ${ACTIVITY_LIMIT} dernières opérations, toutes pages pro confondues.`; empty « Aucune opération pour ce filtre. ».
- `/admin/users/[id]` tiles: « Événements », « Types de ticket », « Inscriptions confirmées », « À venir », « Clients », « Achats payés », « Encaissé (total) ».
- `delete-user-card.tsx` props `stats: ProStats | null; deletion: { ticketsInCirculation: number; pendingPayments: number; clientRecordsElsewhere: number }`; content line « La page /{slug} et tout son contenu : {plural(events,"événement","événements")}, {plural(ticketTypes,"type de ticket","types de ticket")}, {plural(confirmedBookings,"inscription confirmée","inscriptions confirmées")}, {plural(clients,"client","clients")}, {plural(paidPurchases,"achat payé","achats payés")}. »; warnings « {plural(upcoming,"inscription à venir disparaîtra","inscriptions à venir disparaîtront")} sans que les clients soient prévenus. », « {plural(t,"ticket en circulation sera perdu","tickets en circulation seront perdus")} pour ses clients, sans remboursement automatique. », « {plural(p,"paiement en cours","paiements en cours")} : leurs sessions Stripe seront expirées avant la suppression. »; « fiche client » line unchanged.
- `src/server/admin.ts` `deleteUser` (E13): after the checks, before `db.delete(user)`: `if (target.proId) for (const s of await pendingCheckoutSessions(db, target.proId)) await expireCheckoutSession(s.checkoutSessionId);` (never throws); doc comment rewritten for the tickets domain.

### 4.22 Personal link and read-only espace (Task 41)

**`src/lib/back-office/guest-access.ts`**
```ts
export type GuestCustomerRow = { customerId: string; linkVersion: number; slug: string; proSuspended: boolean };
/** The customer, its pro's slug and whether that pro's user is suspended (userIsSuspended). */
export async function findGuestCustomer(db: Db, customerId: string): Promise<GuestCustomerRow | null>;
export type GuestLinkDecision = { kind: "not_found" } | { kind: "stale"; slug: string } | { kind: "ok"; slug: string; customerId: string };
/** Q21 (pure): no link, no row or suspended pro → not_found; version ≠ customer.link_version → stale; else ok. */
export function guestLinkDecision(link: GuestLink | null, row: GuestCustomerRow | null): GuestLinkDecision;
/** Espace by cookie: verified token whose customer belongs to professionalId at its current link_version (carry Task 11), else null. */
export async function customerFromGuestCookie(db: Db, professionalId: string, token: string | undefined, key: Buffer): Promise<string | null>;
/** Espace by verified session: the customer of this pro with e-mail = normalizeEmail(email) (customer_pro_email_uq), else null. */
export async function customerFromVerifiedEmail(db: Db, professionalId: string, email: string): Promise<string | null>;
```

**`src/lib/back-office/customer-space.ts`**
```ts
export type CustomerSpace = {
  customer: { id: string; name: string; email: string };
  upcoming: { bookingId: string; title: string; whenLabel: string; location: string | null; coverageLabel: string; cancelText: string | null }[];
  wallet: { ticketTypeId: string; name: string; color: string; archived: boolean; usable: number; expiries: string[] }[];
};
/** Read-only espace of one customer at one pro (P3; P4 adds cancel and spend, Q22): confirmed future bookings and usable tickets by type with expiries; null when the customer is not this pro's. */
export async function getCustomerSpace(db: Db, professionalId: string, customerId: string, now: Date): Promise<CustomerSpace | null>;
```
- `cancelText` from `clientCanCancel`: before_deadline → « Annulation en ligne possible jusqu'au {formatWhenShort(deadline)}. »; changed_by_pro → « Annulation en ligne possible jusqu'au début de la séance. »; not allowed → null. `expiries` = `expirySummary` wording of `wallet-view`.

**`src/lib/session.ts`** (add)
```ts
/** The session read WITHOUT the 5-minute cookie cache (spec § 12: every read that shows client data). */
export async function getFreshSession(): Promise<Session | null>; // auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true } })
```

**`src/server/client-queries.ts`** (adds)
```ts
export type SpaceIdentity =
  | { kind: "customer"; customerId: string; via: "session" | "guest" }
  | { kind: "no_record"; email: string }
  | { kind: "anonymous" };
/** § 12 order: a verified, non-impersonated fresh session wins (its customer, or no_record); else the skedul_guest cookie (customerFromGuestCookie with guestKey()); else anonymous. */
export async function resolveSpaceCustomer(pro: { id: string }): Promise<SpaceIdentity>;
export function getCustomerSpacePage(professionalId: string, customerId: string): Promise<CustomerSpace | null>;
```

**`src/app/api/c/[token]/route.ts`**
```ts
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response>;
```
- token longer than 200 → 404. `link = verifyGuestLink(token, guestKey())`; `row = link ? await findGuestCustomer(db, link.customerId) : null`; `guestLinkDecision`.
- `not_found` → `new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })`.
- `stale` → `NextResponse.redirect(new URL(\`/${slug}/espace?lien=invalide\`, request.url), 303)` + `cookies.set(GUEST_COOKIE, "", { path: \`/${slug}\`, maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" })`.
- `ok` → `NextResponse.redirect(new URL(\`/${slug}/espace\`, request.url), 303)` + `cookies.set(GUEST_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: \`/${slug}\`, maxAge: GUEST_COOKIE_MAX_AGE })`; header `Cache-Control: no-store`.

**`src/app/[slug]/espace/page.tsx`** (server)
- `params: Promise<{ slug: string }>`, `searchParams: Promise<{ lien?: string }>`; `metadata = { title: "Mon espace", robots: { index: false } }`.
- `getPublicProfile(slug)` → null (unknown or suspended) → `notFound()`. `resolveSpaceCustomer(pro)`.
- customer → `getCustomerSpacePage` → `CustomerSpaceView`; `no_record` → « Aucun ticket chez {businessName} pour {email}. »; `anonymous` → « Ouvrez le lien personnel reçu par email pour voir vos réservations. » (preceded by `FormError`-styled « Ce lien n'est plus valide. » when `lien=invalide`). Wrapped in `PublicShell branding={pro} backHref={\`/${slug}\`}`. `loading.tsx` = skeleton.

**`src/components/public/customer-space.tsx`** `CustomerSpaceView` (server) props `{ businessName: string; slug: string; space: CustomerSpace }`: « Bonjour {name} »; section « Vos prochaines inscriptions » (title, whenLabel, location, coverageLabel, cancelText) or « Aucune inscription à venir. »; section « Vos tickets » (« {usable} × {name} », expiries, archived → « Ce type n'est plus proposé par {businessName}. ») or « Aucun ticket » + link « Voir la page de {businessName} » (`/{slug}`).

**`src/lib/analytics.ts`**: `RESERVED_SEGMENTS` gains `"mon-espace"`; `UNTRACKED_PREFIXES` gains `"/mon-espace"`; `isTrackedPath` returns false when `path.split("/")[2] === "espace"` (so `/x/espace` and `/x/espace/…` are untracked, `/espace` and `/x/espacex` stay tracked).

### 4.23 ICS (Task 42)

**`src/lib/back-office/ics.ts`**
```ts
export type IcsFacts = { bookingId: string; title: string; location: string | null; startAt: Date; endAt: Date; businessName: string };
/** A confirmed booking on a scheduled occurrence (the unguessable booking id is the capability, as before P2): title = event title or type name, location = COALESCE(location_override, event.location); null otherwise (Q34). */
export async function loadIcsFacts(db: Db, bookingId: string): Promise<IcsFacts | null>;
```
Route `GET(_request: Request, { params }: { params: Promise<{ id: string }> })`: id > 64 chars or `loadIcsFacts` null → 404; body `buildIcs({ uid: \`${bookingId}@skedul.app\`, title, description: \`Avec ${businessName}\`, location, startAt, endAt })`; headers `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="seance.ics"`, `Cache-Control: no-store`.

---

## 5. Engine call table

Every wrapper derives `professionalId = ctx.professionalId` and `actorUserId = ctx.actorUserId` (from `requireProContext()`), passes one `now` to every engine call of the action, and on success runs the engine `effects` through `runEffects` (after commit, `after()`). « Rev » = revalidation: every write revalidates the dashboard layout; « + public » also `/{slug}` (layout). « Q » = read wrapper (`runProQuery`): no revalidation, no effect. Error column: the `fromEngine` context, then the core's own refusals.

| # | Wrapper (file) | Core | Engine call(s) and input mapping | Success data | Errors → French | Effects executed | Rev |
|---|---|---|---|---|---|---|---|
| 1 | `createTicketTypeAction` (pro-catalog) | `createTicketTypeCore` | `createTicketType(db, { professionalId, type })` | `{ ticketTypeId }` | `catalog`; `NOTICE_TOO_LONG` | none | + public |
| 2 | `updateTicketTypeAction` | `updateTicketTypeCore` | read type → merge patch → `updateTicketType(db, { professionalId, ticketTypeId, type })` | — | `catalog`; `RDV_FREE_HAS_SALES`, `NOTICE_TOO_LONG`, « Type ou offre introuvable. » | none | + public |
| 3 | `setTicketTypeArchivedAction` | `setTicketTypeArchivedCore` | `setTicketTypeArchived(db, { professionalId, ticketTypeId, archived })` | — | `catalog` | none | + public |
| 4 | `deleteTicketTypeAction` | `deleteTicketTypeCore` | `deleteTicketType(db, { professionalId, ticketTypeId })` | `{ outcome }` | `catalog` | none | + public |
| 5 | `createOfferAction` | `createOfferCore` | read type (pro, active, rdvFree) → `createOffer(db, { professionalId, offer })` | `{ offerId }` | `catalog`; `RDV_FREE_NO_OFFER` | none | + public |
| 6 | `updateOfferAction` | `updateOfferCore` | read offer → `updateOffer(db, { professionalId, offerId, offer: { ...offer, ticketTypeId: row.ticketTypeId } })` | — | `catalog` | none | + public |
| 7 | `setOfferActiveAction` | `setOfferActiveCore` | read offer → `updateOffer(db, { professionalId, offerId, offer: { ticketTypeId, label, quantity, priceCents, validityCount, validityUnit, isActive } })` | — | `catalog` | none | + public |
| 8 | `deleteOfferAction` | `deleteOfferCore` | `deleteOffer(db, { professionalId, offerId })` | `{ outcome }` | `catalog` | none | + public |
| 9 | `setTypeHoursAction` | `setTypeHoursCore` | `setAvailabilityRules(db, { professionalId, ticketTypeId, rules })` | — | `catalog` | none | + public |
| 10 | `setTypeQuestionsAction` | `setTypeQuestionsCore` | `setTypeQuestions(db, { professionalId, ticketTypeId, questions })` | — | `catalog` | none | + public |
| 11 | `createEventAction` | `createEventCore` | `createEvent(db, { professionalId, event: { ...parsed, ticketTypeIds: deduped } }, now)` | `{ eventId, occurrenceCount }` | `event`; `EVENT_START_PAST`, `EVENT_START_TOO_FAR`, `EVENT_TYPE_UNAVAILABLE`, `NOTICE_TOO_LONG`; `stale` = tz changed meanwhile | none | + public |
| 12 | `editEventInfoAction` | `editEventInfoCore` | `editEventInPlace(db, { professionalId, actorUserId, eventId, seenVersion, patch: { title, description, location, color, isPrivate, bookingMode, ticketTypeIds, questions, overrides, capacity } })` | `{ version }` | `event`; `EVENT_TYPE_UNAVAILABLE`, `NOTICE_TOO_LONG` | `email.occurrence_changed` (location), `google.sync_occurrence` | + public |
| 13 | `previewScheduleAction` | `previewScheduleCore` | `previewSeriesEdit(db, { professionalId, eventId, fromDate, rule, durationMin }, now)` + `countRdvConflicts` over `expand(rule, tz, max(fromDate, today), today + 400)` | `{ preview }` | `series` | — | Q |
| 14 | `applyScheduleAction` | `applyScheduleCore` | `editSeriesFrom(db, { professionalId, actorUserId, eventId, seenVersion, fromDate, rule, durationMin, orphans }, now)` | `{ eventId, summaryText }` | `series` (TIM1 « La série change déjà à partir du … » passes through) | `email.occurrence_changed`, `google.sync_occurrence`; with « Annuler »: `email.occurrence_cancelled`, `stripe.expire_session` | + public |
| 15 | `deleteEventPreviewAction` | `deleteEventPreviewCore` | read `deleteFromPreview` | `{ preview }` | « Événement introuvable ou terminé. » | — | Q |
| 16 | `deleteEventFromAction` | `deleteEventFromCore` | `deleteSeriesFrom(db, { professionalId, actorUserId, eventId, seenVersion, fromDate }, now)` | `{ deletedEvent, cancelledOccurrences, deletedOccurrences }` | `series` | `email.occurrence_cancelled`, `stripe.expire_session`, `google.sync_occurrence` | + public |
| 17 | `previewNewEventAction` | `previewNewEventCore` | reads: `expand` + `countRdvConflicts` | `{ rdvConflicts, occurrenceCount }` | parseFr messages | — | Q |
| 18 | `updateOccurrenceAction` (pro-planning) | `updateOccurrenceCore` | `updateOccurrence(db, { professionalId, actorUserId, occurrenceId, seenStartsAt: new Date(seenStartsAt), patch: { startsAt: instantAt(date, startMinute, ctx.timezone)?, durationMin?, locationOverride? }, unenrollBookingIds }, now)` | `{ timeChanged }` | `occurrence` (« Une séance concernée a déjà commencé. », « La nouvelle date serait déjà passée. », « Un rendez-vous se déplace … » pass through); `TIME_PARTS_REQUIRED` | `email.booking_cancelled {by: "pro"}` (unenrolled), `stripe.expire_session`, `email.occurrence_changed`, `google.sync_occurrence` | + public |
| 19 | `expiringBeforeAction` | `expiringBeforeCore` | `bookingsExpiringBefore(db, { professionalId, occurrenceId, newStartsAt: instantAt(date, startMinute, tz) })` | `{ bookings }` | — | — | Q |
| 20 | `updateCapacityAction` | `updateCapacityCore` | scope occurrence: `updateOccurrence(… patch: { capacity })`; scope event: read the séance's `event_id` (pro) → `editEventInPlace(… { eventId, seenVersion, patch: { capacity } })` | — | `occurrence` / `event` | occurrence scope: `google.sync_occurrence` | + public |
| 21 | `cancelOccurrenceAction` | `cancelOccurrenceCore` | `cancelOccurrence(db, { professionalId, actorUserId, occurrenceId }, now)` | `{ bookingsCancelled, ticketsReturned }` | `cancel` | `email.occurrence_cancelled`, `stripe.expire_session`, `google.sync_occurrence` | + public |
| 22 | `restoreOccurrenceAction` | `restoreOccurrenceCore` | `restoreOccurrence(db, { professionalId, occurrenceId }, now)` | — | `restore` (« Cette série est terminée : recréez la séance si besoin. » passes through; `not_found` → « Seule une séance future d'un événement peut être rétablie. ») | none | + public |
| 23 | `unenrollAction` | `unenrollCore` | `cancelBookingsByPro(db, { professionalId, actorUserId, occurrenceId, bookingIds, reason }, now)` | `{ cancelled, ticketsReturned }` | `unenroll` | `email.booking_cancelled {by: "pro"}` per booking, `stripe.expire_session`, `google.sync_occurrence` | + public |
| 24 | `registerAttendeeAction` | `registerAttendeeCore` | optional `createCustomer(db, { professionalId, name, email, phone })` then `registerPro(db, { professionalId, actorUserId, occurrenceId, customerId, asGuest, ticketId, extraSeat, answers }, now)` | `{ bookingId, customerId, coverage, customerCreated }` | `customer` for the creation, `register` for the booking; `REGISTER_RDV`, `REGISTER_NONE_GUEST`, `REGISTER_NO_TICKET_MODE` | `email.booking_confirmed`, `google.sync_occurrence` (never `pro_new_booking`) | + public |
| 25 | `moveAttendeeAction` | `moveAttendeeCore` | `moveAttendee(db, { professionalId, actorUserId, bookingId, targetOccurrenceId, force, convertToTicketTypeId: value ?? undefined }, now)` | `{ converted }` | `move`; `CONVERSION_TYPE_UNAVAILABLE`; code `ticket_expires_before` kept for the UI | `email.attendee_moved`, `google.sync_occurrence` × 2 | + public |
| 26 | `previewFollowingAction` | `previewFollowingCore` | `previewSeriesEdit(db, { professionalId, eventId: occurrence.event_id, fromDate: series_date, rule: built, durationMin }, now)` | `{ text, fromDate }` | `series` | — | Q |
| 27 | `applyFollowingAction` | `applyFollowingCore` | `editSeriesFrom(db, { …same, actorUserId, seenVersion, orphans: "keep" }, now)` | `{ eventId, summaryText }` | `series` | `email.occurrence_changed`, `google.sync_occurrence` | + public |
| 28 | `searchCustomersAction` | `searchCustomersCore` | read `searchCustomers` | `{ customers }` | — | — | Q |
| 29 | `registerOptionsAction` | `registerOptionsCore` | read `registerOptions` (ownership checked, then `usableTickets`) | `{ mode, alreadyBooked, usable }` | « Séance ou client introuvable. » | — | Q |
| 30 | `moveTargetsAction` | `moveTargetsCore` | read `moveTargets` | `{ series, targets }` | « Cette inscription ne peut pas être déplacée. » | — | Q |
| 31 | `previewTimeOffAction` | `previewTimeOffCore` | `buildTimeOffInterval(input, tz)` + `previewTimeOffConflicts(db, { professionalId, startAt, endAt }, now)` | `{ conflicts }` | `buildTimeOffInterval` messages, `TIME_OFF_TOO_LONG` | — | Q |
| 32 | `createTimeOffAction` | `createTimeOffCore` | `createTimeOffWithConflicts(db, { professionalId, actorUserId, startAt, endAt, allDay, reason, seenOccurrenceIds, cancelBooked }, now)` | `{ cancelledOccurrences }` | `timeOff` (`stale` → the UI previews again) | with `cancelBooked`: `email.occurrence_cancelled`, `stripe.expire_session`, `google.sync_occurrence` | + public |
| 33 | `deleteTimeOffAction` | `deleteTimeOffCore` | one `DELETE FROM time_off WHERE id AND professional_id` | — | « Indisponibilité introuvable. » | none | + public |
| 34 | `createCustomerAction` (pro-clients) | `createCustomerCore` | `createCustomer(db, { professionalId, name, email, phone })` | `{ customerId, created }` | `customer` | none | dashboard |
| 35 | `updateCustomerAction` | `updateCustomerCore` | `updateCustomer(db, { professionalId, customerId, name, phone })` | — | `customer` | none | dashboard |
| 36 | `revokeLinksAction` | `revokeLinksCore` | `revokeLinks(db, { professionalId, customerId })` | — | `customer` | none | dashboard |
| 37 | `offerTicketsAction` | `offerTicketsCore` | `offerTickets(db, { professionalId, actorUserId, customerId, ticketTypeId, quantity, expiresAt: lastValidDay ? expiryFromLastDay(lastValidDay, tz) : null, reason, notify })` | `{ count }` | `wallet`; `OFFER_RDV_FREE`, `EXPIRY_IN_PAST` | `email.tickets_offered` (when notify) | dashboard |
| 38 | `convertTicketsAction` | `convertTicketsCore` | `convertTickets(db, { professionalId, actorUserId, customerId, selection: { ticketIds }, toTicketTypeId })` | `{ count }` | `wallet`; `CONVERT_TARGET_UNAVAILABLE`, `CONVERT_SAME_TYPE` | none | dashboard |
| 39 | `closeTicketsAction` | `closeTicketsCore` | `closeTickets(db, { professionalId, actorUserId, customerId, selection: { ticketIds }, reason, note })` | `{ count }` | `wallet` (« Précisez le motif. », « Un ticket offert se retire. » pass through) | none | dashboard |
| 40 | `retireTicketsAction` | `retireTicketsCore` | `closeTickets(… reason: "retire", note)` | `{ count }` | `wallet` (`retire_paid` → « Un ticket payé ne peut pas être retiré : utilisez « Clore ». ») | none | dashboard |
| 41 | `pointTicketsAction` | `pointTicketsCore` | `pointTickets(db, { professionalId, actorUserId, customerId, selection: { ticketIds }, note })` | `{ count }` | `wallet` | none | dashboard |
| 42 | `unpointTicketsAction` | `unpointTicketsCore` | `unpointTickets(db, { professionalId, actorUserId, customerId, selection: { ticketIds } })` | `{ count }` | `wallet` | none | dashboard |
| 43 | `updateProfile` (pro) | `updateProfileCore` | own batch: `lockRows(professional)`, `G(…, 'timezone_locked')`, `UPDATE professional` | — | `profile` (`timezone_locked` → « Fuseau verrouillé : vous avez des séances planifiées. ») | none | + public |
| 44 | `updateBookingSettingsAction` (pro) | `updateBookingSettingsCore` | `updateBookingSettings(db, { professionalId, settings })` | — | `settings`; `NOTICE_TOO_LONG` | none | + public |
| 45 | `saveAvailabilityAction` (pro) | `saveAvailabilityCore` | `setAvailabilityRules(db, { professionalId, ticketTypeId: null, rules })` | — | `settings` | none | + public |
| 46 | `disconnectGoogleCalendar` (pro, existing) | — | unlink, then one `db.batch` (professional calendar null + occurrence google_event_id null) | `{ ok }` | — | none | (existing) |
| 47 | `deleteUser` (admin, existing) | — | `pendingCheckoutSessions(db, proId)` → `expireCheckoutSession` each (best effort) → `DELETE FROM "user"` | redirect | existing messages | — | (existing) |

---

## 6. Routes

All dashboard routes render inside `src/app/dashboard/layout.tsx` (session and pro guaranteed; `const pro = (await getCurrentProfessional())!`). Every route below has a `loading.tsx` (`PageSkeleton` / `TableSkeleton`) and is covered by `src/app/dashboard/error.tsx`.

| Route | Files | Data | Components | Empty / error | Mobile (< 640 px) | Deep links |
|---|---|---|---|---|---|---|
| `/dashboard` | `page.tsx` (M, Task 37), `loading.tsx` (Task 8) | `getDashboardPage(pro)`, `getPlanningPage(pro, undefined)`, `env.APP_URL` | `PageHeader` « Bonjour » + « Voici l'activité de votre page de réservation. »; `GettingStarted` (when not null), `KpiGrid`, `AlertsCard`, public link card (kept), `WeekPreview`, `UpcomingBookings` | Each card has its empty copy; `metadata.title = "Vue d'ensemble"` | KPI 2 columns; week preview in its Jour mode | tiles and alerts link to planning / clients filters / payments / events |
| `/dashboard/planning` | `page.tsx` (M), `loading.tsx` (C) — Task 24 | `searchParams: Promise<{ semaine?: string; week?: string; seance?: string }>`; `getPlanningPage(pro, semaine ?? week)`; `after(() => ensureHorizon(db, pro.id))` when `needsHorizon` (render never writes) | `PageHeader` « Planning » + « Vos séances, rendez-vous et indisponibilités de la semaine. »; `PlanningCalendar` | « Aucune séance cette semaine. »; unknown `seance` id ignored | Day view (chips + list) | `?semaine=YYYY-MM-DD&seance=<occurrenceId>` (Q20) opens the dialog; empty cell → `/dashboard/events/new?date=&minute=` |
| `/dashboard/events` | `page.tsx`, `loading.tsx` — Task 17 | `getEventsPage(pro.id)` | `PageHeader` « Événements » + « Vos cours et vos ateliers, ponctuels ou récurrents. » + « Nouvel événement »; `EventList` | `EmptyState(CalendarDays, "Créez votre premier événement", "Un cours ponctuel ou récurrent, avec ses places et les tickets qu'il accepte.", action « Nouvel événement »)` | Cards | rows → `/dashboard/events/{currentEventId}` |
| `/dashboard/events/new` | `page.tsx`, `loading.tsx` — Task 19 | `searchParams: Promise<{ date?: string; minute?: string }>`; `defaultEventStart({ now, tz, clicked: parseClickedCell(sp) })`; `getActiveTypeOptions` (rdvFree removed); pro window | `PageHeader` « Nouvel événement » + « Un cours ponctuel ou récurrent. Vous pourrez tout modifier ensuite. » + back « Tous les événements »; `EventCreateForm` | Action errors in `FormError` | Single column | — |
| `/dashboard/events/[id]` | `page.tsx`, `loading.tsx` — Task 20 | `params: Promise<{ id: string }>`; `getEventEditorPage` → null → `notFound()`; `redirect` kind → `redirect("/dashboard/events/{eventId}")` (Q9) | `PageHeader` title + recurrence label + back; badges (mode, « Privé », « Aucun ticket actif accepté », « Terminé »); cards « Informations » (`EventInfoForm`), « Horaire et récurrence » (`EventScheduleForm`), « Prochaines séances » (links `planningHref`), « Segments précédents » (read-only, help « Une série modifiée « à partir du » garde ses séances passées dans un segment précédent. »), « Supprimer » (`EventDeleteCard`) | readOnly banner « Cet événement est terminé : il ne se modifie plus. »; « Aucune séance à venir. » | Cards stacked | upcoming séances → planning deep link |
| `/dashboard/tickets` | `page.tsx`, `loading.tsx` — Task 11 | `getTicketTypesPage(pro.id)` | `PageHeader` « Tickets » + « Vos types de ticket et les offres qui les vendent. » + `NewTicketTypeButton`; `TicketTypeCard` grid; `<details>` « Types archivés ({n}) » | `EmptyState(Ticket, "Créez un type de ticket, puis une offre", "Un type de ticket, c'est ce qu'un événement accepte. Une offre le vend à l'unité ou en carnet.", action NewTicketTypeButton)` | One column | cards → `/dashboard/tickets/{id}` |
| `/dashboard/tickets/[id]` | `page.tsx`, `loading.tsx` — Tasks 12, 13 | `params`; `getTicketTypePage` → null → `notFound()` | `PageHeader` name + « Type de ticket » + back « Tous les tickets »; cards « Informations » (`TicketTypeInfoForm`), « Offres » (`OfferList`), « Accepté par » (links or « Aucun événement n'accepte ce type. » + « Créer un événement »; help « Les événements choisissent leurs tickets acceptés dans leur page. »), « RDV libre » (`RdvSettingsForm`, then when enabled `TypeHoursEditor` and `TypeQuestionsForm`), « Archiver ou supprimer » (`TypeDangerZone`) | Archived banner « Ce type est archivé : ses offres ne sont plus en vente. » | Stacked | « Accepté par » → `/dashboard/events/{id}` |
| `/dashboard/clients` | `page.tsx` (M), `loading.tsx` (C) — Task 33 | `searchParams: Promise<{ filter?: string; q?: string }>`; `parseClientFilter`; q trimmed (≤ 100); `getClientsPage` | `PageHeader` « Clients » + « Les personnes qui réservent chez vous et leurs tickets. » + `NewClientButton`; `FilterChips` label « Filtrer », options « {label} ({count}) » with `clientsHref`; GET search form (`FormField` « Rechercher », hidden `filter`, button « Rechercher »); `ClientList` | No client at all → `EmptyState(Users, "Vos clients apparaîtront ici", "Ils sont créés à leur première réservation ou à leur premier achat. Vous pouvez aussi en ajouter un.", action NewClientButton)`; search empty « Aucun client ne correspond à « {q} ». »; filter empty « Aucun client dans ce filtre. » | Cards; chips scroll horizontally inside their own row | `?filter=tickets\|a-venir\|alertes` (+ `credits` alias), `?q=` |
| `/dashboard/clients/[id]` | `page.tsx`, `loading.tsx` — Tasks 34, 35 | `params`; `getClientRecordPage` → null → `notFound()` | `PageHeader` name + email + back « Tous les clients »; `ClientHeader` (card « Fiche »), `ClientWallet`, `ClientBookings` (Task 35), `ClientPurchases`, `LedgerList`; desktop `lg:grid-cols-3` (main column wallet, inscriptions, history; side column fiche, achats) | Each section's empty copy | Stacked in this order: Fiche, Portefeuille, Inscriptions, Achats, Historique | bookings → planning deep link |
| `/dashboard/payments` | `page.tsx` (M), `loading.tsx` (C) — Task 36 | `searchParams: Promise<{ periode?: string }>`; `getPaymentsPage(pro, parsePaymentsPeriod(periode))` | `PageHeader` « Paiements » + « Les achats de tickets payés par vos clients. »; `FilterChips` « Période »: « Tout » / « 30 derniers jours »; Card « Encaissé » (`revenueDisplay`) + note `revenueLive()` ? « Seuls les paiements réels comptent. » : « Paiements de test : ces montants ne sont pas réels. »; note « Les tickets clos « Remboursé hors Skedul » ne diminuent pas l'encaissé. » when a row has such a note; `PaymentsTable` | `EmptyState(Euro, "Aucun paiement pour le moment", "Les achats de tickets de vos clients apparaîtront ici.")` | Cards | client → record |
| `/dashboard/settings` | `page.tsx` (M Tasks 7, 29), `loading.tsx` (C Task 29) | `getGoogleConnection`, `getSettingsExtras(pro.id)` | Cards: « Profil public » (`SlugEditor` from main + `ProfileForm` with `timezoneLocked`), « Réservations » (`BookingSettingsForm`), « Identité visuelle », `GoogleCalendarCard`, « Session » | Form errors | Stacked | — |
| `/dashboard/availability` | `page.tsx` (M), `loading.tsx` (C) — Task 29 | `getProAvailability(pro.id)` | `PageHeader` « Disponibilités (RDV libre) » + « Vos horaires pour les rendez-vous libres (fuseau {timeZoneLabel(tz)}). Un type de ticket peut avoir ses propres horaires. »; `AvailabilityEditor` | `FormError` | existing | — |
| `/dashboard/unavailability` | `page.tsx` (M), `loading.tsx` (C) — Task 28 | `getProTimeOff`, `todayKey(new Date(), tz)`; entry labels with `formatTimeRange` (no en dash) | `PageHeader` unchanged copy; `UnavailabilityManager` (+ `TimeOffConflictDialog`) | « Aucune indisponibilité programmée. » | existing grid stacks | — |
| `/dashboard/event-types`, `/dashboard/packs` | `page.tsx` (M) — Task 8 | `await requireProContext()` | `redirect("/dashboard/tickets")` | — | — | — |
| `/admin`, `/admin/activity`, `/admin/users/[id]` | M — Task 40 | `admin-queries.ts` | see § 4.21 | « Aucune opération pour ce filtre. » | existing | `?tab=bookings\|purchases&status=` |
| `/api/c/[token]` | `route.ts` (C) — Task 41 | token | — | 404 / 303 `?lien=invalide` (Q21) | — | → `/{slug}/espace` |
| `/[slug]/espace` | `page.tsx`, `loading.tsx` (C) — Task 41 | `params`, `searchParams { lien? }`, `getPublicProfile`, `resolveSpaceCustomer`, `getCustomerSpacePage` | `PublicShell`, `CustomerSpaceView` | Q22 placeholder, « Aucun ticket chez {businessName} pour {email}. », « Ce lien n'est plus valide. »; suspended or unknown pro → `notFound()` | `PublicShell` responsive | — |
| `/api/bookings/[id]/calendar.ics` | `route.ts` (M) — Task 42 | booking id | — | 404 unless confirmed + scheduled (Q34) | — | linked from the confirmation e-mail |

---

## 7. Decisions

Each settles a point the spec and the rulings leave open. Writers apply them verbatim.

1. Decision: **Task 1 merges `origin/main` (8bb3195) into `feat/tickets-events`** before any UI — why: the branch lacks PR #13 / #14 (`slug.ts`, `updateSlug`, `SlugEditor`, `<main className="min-w-0 flex-1 overflow-x-clip">`, sidebar `relative`); `git merge-tree` shows a clean merge and main added no migration, so doing it first avoids conflicts in five files P3 edits.
2. Decision: **P3 adds no migration** — why: every column P3 reads or writes exists since 0011 (`professional` booking settings, `occurrence.google_event_id`, `customer.link_version`, `ticket.closed_*`, `booking.cancel_reason`); indexes for the new reads exist (`occurrence_pro_starts_idx`, `customer_pro_email_uq`, `ticket_purchase_pro_status_paid_idx`).
3. Decision: **cores live in `src/lib/back-office/`** (reads `*-reads.ts`, writes `*-actions.ts`, pure view models next to them), plus `src/lib/notify-core.ts`, `src/lib/calendar-sync-load.ts`, `src/lib/admin-reads.ts` — why: ruling 13 (tsx tests cannot load `server-only` / `next/*`), one place for writers to find them.
4. Decision: **the pro message map is a new `src/lib/pro-messages.ts`**, not `tickets.ts` — why: `tickets.ts` keeps the client-facing engine wording the P4 public pages need; the pro wording is per action context (register, move, …), which a flat `Record` in `tickets.ts` cannot express.
5. Decision: **French zod through a per-parse error map (`parseFr`)**, never `z.config()` — why: a global locale would also rewrite Better Auth's zod messages (same zod instance) and its tests; per-parse keeps refine messages (schema-level) and translates only the built-in checks.
6. Decision: **every core pre-validates with the engine's own schema before calling the engine** — why: the engine returns `issues[0].message` from a plain `safeParse` (English for built-in checks, OUT carry Task 17); a pre-validated input can only fail the engine on French refine messages or on non-zod checks.
7. Decision: **`ActionResult` = `{ ok: true, ...data } | { ok: false, error, code? }`**; `code` is kept for the cases the UI branches on (`ticket_expires_before` → « Déplacer quand même », `stale` on time off → new preview) — why: one shape for every Server Action, consistent with `support.ts` and main's `updateSlug`.
8. Decision: **effects run in `after()` from `runProAction`; revalidation is synchronous and global** (`revalidationTargets(publicPage)`: the `/dashboard` layout always, + the `/[slug]` route pattern with type `"layout"` for public data) — why: e-mails and Google never delay the response or fail a committed write; a per-action path list is a source of stale screens (Review Focus 3) and the whole dashboard is dynamic anyway.
9. Decision: **client components never call `router.refresh()` after a Server Action** — why: Next 16 `revalidatePath` in a Server Function refreshes the current page (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md); `push` + `refresh` hangs on 16.2.9.
10. Decision: **pro actions stay allowed while an admin impersonates** (unlike `support.ts`) — why: impersonation exists to help a pro operate their page; `actorUserId` is the impersonated pro user, exactly as the existing `pro.ts` actions behave.
11. Decision: **lapsed holds (`confirmed_at` null and `hold_expires_at < ended_at`) receive neither « séance annulée » nor « inscription annulée »** — why: CON1 / P2 Task 26 minor: the client abandoned the payment; the e-mail would announce the cancellation of a seat they no longer held.
12. Decision: **e-mail footer « Envoyé par Skedul · Réservations et tickets », Google footer « Géré par Skedul : ne pas modifier ici. »** — why: the v1 footer names packs, and the dash ban covers every client-facing text.
13. Decision: **Google sync is marker-based with the deterministic id**: no marker → insert (409 → full-body patch); marker → patch (404/410 → insert); not wanted + no marker → no API call at all — why: spec § 13.7, reconnect safety (disconnect clears markers, Q33) and no token fetch for empty séances.
14. Decision: **`createEvent` locks the professional row and G-checks the planned tz (`stale`)**; `updateProfile` locks the same row in its batch — why: carry Task 18; with both locks the second writer waits and then either sees the event (`timezone_locked`) or the new tz (`stale`).
15. Decision: **a new event's start date must be in [local today, today + 730 days]** — why: OUT L114 (a 1926 typo materialises decades of rows); two years covers every real planning need; past dates are refused because the engine would create already-past séances.
16. Decision: **rdv_free types are excluded from event type options, offers, « Offrir » and conversion targets**, and `rdvFree` cannot be switched on while the type has an offer en vente or usable tickets — why: Q16; their tickets are usable nowhere (eligibility excludes them).
17. Decision: **type edits are patches merged on the current row in the core** — why: the info form and the RDV form are separate (spec § 13.1 sections) but the engine takes a full `TicketTypeInput`.
18. Decision: **the offer « En vente » switch calls `updateOffer` with the row's own fields** — why: the engine has no toggle function; `isActive` is part of `OfferInput` (§ 9 « en vente / pas en vente »).
19. Decision: **the history shows the newest action first; lines inside an action follow `seq`**; a close line takes its motif from `ticket.closed_reason`, and a `retire` close reads « Retiré » — why: a client record is read from the latest change; the movement row stores only the note (`reason`), the reason enum lives on the ticket (closed is final, so it is still the value of that movement).
20. Decision: **planning deep link = `/dashboard/planning?semaine=<Monday>&seance=<id>`**, `week` accepted as an alias — why: Q20; the alias keeps old links working.
21. Decision: **the mobile planning day view is client state inside the fetched week** (no `?jour=`) — why: the week is already loaded; the chosen day defaults to today, or to the day of `seance`.
22. Decision: **« Déplacer » targets = scheduled event séances of the next 60 days; ticket coverage keeps only tickets-mode targets; conversion candidates = active non-rdv_free types linked to the target; full targets are disabled** — why: Q18 and the engine guards (`not_eligible` for other modes, no « +1 place » on a move).
23. Decision: **« Inscrire » creates a new client inside `registerAttendeeCore`** (no call to the G5 client cores) and **RDV occurrences cannot be registered from the planning** — why: keeps G4 independent of G5; Q31.
24. Decision: **register coverage choice = `auto | guest` + optional `ticketId`** — why: `auto` maps to the engine's mode-driven coverage (ticket in tickets mode, free in free mode); `none` mode requires `guest` (pre-checked with the Q17 wording).
25. Decision: **capacity scope « Toutes les séances à venir » = `editEventInPlace({ capacity })` and is offered only for recurring séances** — why: Q19; for a one-off event both scopes are the same séance.
26. Decision: **« Cette séance et les suivantes » from the dialog changes time and duration only, with `orphans: "keep"`** — why: Q8; a time-only change never removes a date, so there is no orphan to choose about.
27. Decision: **a time off without conflicts is created at once; the dialog opens only when conflicts exist; time offs are capped at 366 days** — why: E6c only asks when there is something to choose; OUT L122 notes the missing cap.
28. Decision: **notice presets (Q13) and a refusal of notice > horizon** in settings, type overrides and event overrides (effective window) — why: OUT L106 (« Réservations fermées » shown for séances the horizon should hide).
29. Decision: **`PRO_TIMEZONES` keeps the six existing zones with `Europe/Zurich` instead of `Europe/Geneva`; the server accepts any zone `Intl` accepts** — why: ruling; an existing pro on another valid zone keeps it. P6 must check production rows for `Europe/Geneva` (out of P3).
30. Decision: **the client list sorts by name, caps at 500 rows, search is ILIKE on name or email; filter counts ignore the search** — why: pros have hundreds of clients at most; counts tell the pro the size of each filter.
31. Decision: **payments list every paid purchase (live and test, « Test » badge) with period chips « Tout » / « 30 derniers jours »; the total is the `paidPurchaseOf(live)` sum** — why: spec § 9 (badge « Test ») and the admin precedent; the list is history, the total is « Encaissé ».
32. Decision: **KPIs per Q25; the alerts card is always shown (« Aucune alerte : tout est en ordre. »); « Premiers pas » disappears once complete (Q29)** — why: the alerts card is the place the pro learns that alerts exist.
33. Decision: **admin « pros actifs 30 j » counts paid purchases whatever their `livemode`** — why: it measures activity, not revenue; test-mode purchases are real usage on preview / tickets-dev.
34. Decision: **health metrics per Q24; « Contrôle nocturne : jamais exécuté » when no invariant check was ever stored** — why: `readHealth` returns undefined before the first nightly run (P4).
35. Decision: **`/api/c`: bad MAC, unknown customer or suspended pro → 404; stale version → 303 to `/{slug}/espace?lien=invalide` and the cookie is cleared** (Q21) — why: same answer for every unauthorised case (attachments-route pattern); a suspended pro's espace is offline like its page.
36. Decision: **`/[slug]/espace` identity: verified fresh session first (its customer or « Aucun ticket chez … pour … »), else guest cookie, else the Q22 placeholder; suspended pro → 404** — why: spec § 12 (« Une session vérifiée l'emporte sur le cookie »); P4 adds the code form.
37. Decision: **ICS = confirmed booking on a scheduled occurrence only; the booking id stays the capability** (Q34) — why: pre-P2 behaviour, linked from the confirmation e-mail.
38. Decision: **`ui-copy.test.ts` scans whole P3 directories (comments included) for U+2014 / U+2013** — why: a source scan catches strings built anywhere; Task 6 fixes the five existing hits once.
39. Decision: **UI and e-mail time ranges read « 19:00 à 20:00 » (`formatWhen`); `datetime.formatSlot` stays for the untouched admin pages only** — why: the dash ban; `formatSlot` uses an en dash.
40. Decision: **`/dashboard/event-types` and `/dashboard/packs` redirect after `await requireProContext()`** — why: Q15 and the Next 16 static-redirect prerender trap.
41. Decision: **the « Confirmez votre adresse » banner sits in the dashboard layout, hidden while impersonating** (Q23) — why: every pro page needs it; an admin impersonating must not verify the pro's address.
42. Decision: **an event whose every segment is archived opens read-only; past segments are listed read-only in « Segments précédents »** — why: Q9; editing a dead segment would be refused by the engine anyway.
43. Decision: **the events list has one row per series root linking to the current segment; « Terminés » holds series without a live segment** — why: spec § 13.1 and OUT L126 (never address a series by its root).
44. Decision: **v1 `src/lib/booking-emails.ts` and its test are deleted** — why: no runtime importer, hard-coded EUR (§ 13.6), replaced by `src/lib/emails/*`.
45. Decision: **the client record e-mail is read-only** (Q6) — why: it is the record's key (`customer_pro_email_uq`) and E8 only edits name and phone.
46. Decision: **the history list shows 30 lines and the rest under « Afficher tout l'historique »** — why: a wallet with years of movements must not make the record page unusable.
47. Decision: **wallet and point / unpoint / convert / close / retire always send explicit ticket ids chosen in `groupWallet` order** — why: OUT L125 (quantities are not idempotent on a double submit).
48. Decision: **`ticket_expires_before` pro wording « Ticket expiré à la date de cette séance : déplacer quand même ? » lives in `pro-messages.ts`; `tickets.ts` keeps its text** — why: Q18 asks for the spec text, whose dash is banned; the engine text stays for P4.
49. Decision: **client components may `import type` from engine modules (e.g. `QuestionRow`) but never import runtime values from `@/lib/booking/*`, `@/lib/db/*` or server modules** — why: types are erased; runtime imports would ship drizzle or `server-only` to the browser.
50. Decision: **`spendTicket` returns `ticket_id`; `registerPro` and `bookWithHeldTicket` read it from the batch result** — why: OUT L119 (a post-commit read throws a 500 on a committed booking when the pro cancels in between).
51. Decision: **`/[slug]/espace` shows, read-only, a client-facing cancellation hint (`cancelText`) but no button** — why: Q22 scope (no cancel in P3); P4 reuses `getCustomerSpace` and adds the POST.
52. Decision: **`isTimezoneLocked` counts future scheduled RDVs as well as non-archived events** — why: spec § 7 says « une séance future scheduled », and an RDV is an occurrence with instants in the old tz.
53. Decision: **the occurrence dialog allows « Annuler la séance » on a past séance with an extra warning** — why: E6b has no time filter and the pro uses it to fix a séance that did not happen; the copy says the tickets come back.

---

## 8. Task breakdown

43 tasks, executed in this order. Each ends green (Global Constraints). "Interfaces" points to § 4; the writer copies those declarations into the task's Interfaces block. Browser steps follow § 9.3. Commit scopes in parentheses.

### G1 — Foundation (Tasks 1–8)

**Task 1: Merge `main` into the branch; the `skedul-tickets` dev server** (G1)
- Files: merge commit (see § 3.1 rows of Task 1); M `C:/Users/Matheus/Documents/Codage/skedul/.claude/launch.json` (main checkout, untracked).
- Depends on: none.
- Steps: `git status --short` empty; `git rev-parse origin/main` = `8bb3195…` (else stop and report); `git merge --no-ff origin/main -m "merge(main): settings page (PR #13) and demo CTAs (PR #14)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; a conflict = stop and report (the dry run with `git merge-tree` showed none). Then add the launch entry `{ "name": "skedul-tickets", "runtimeExecutable": "pnpm", "runtimeArgs": ["-C", ".claude/worktrees/tickets", "--config.verify-deps-before-run=false", "dev", "--port", "3102"], "port": 3102 }` with Edit, other entries untouched.
- Tests: pure suite (includes `src/lib/slug.test.ts` from main); tsc; build.
- Browser: `preview_start` `skedul-tickets`; `http://localhost:3102/sign-in` → « Pro · back-office » → `/dashboard`; `/dashboard/settings` shows the public address editor (slug `altinha-paris`) from PR #13; at 375 px no horizontal page scroll; console clean.

**Task 2: Vocabulary split, French zod messages, pro error messages** (G1)
- Files: § 3.1 rows of Task 2.
- Depends on: 1. Interfaces: § 4.1.
- Tests (pure): `tickets.test.ts` (vocab file has no `import`; neither file contains U+2014 / U+2013; existing cases unchanged); `zod-fr.test.ts`: every issue kind of the table gives its exact text; `parseFr(ticketTypeInputSchema, { name: "" })` → « Nom : ce champ est obligatoire. »; `parseFr(eventInputSchema, …capacity 501)` → « Places : maximum 500. »; durationMin 62 → « Durée : choisissez un multiple de 5. »; `customerInputSchema` email "x" → « Email : adresse email invalide. »; rdvEnabled without duration → « Indiquez la durée du rendez-vous. » (refine kept verbatim); a battery of invalid inputs over `ticketTypeInputSchema`, `offerInputSchema`, `eventInputSchema`, `recurrenceRuleSchema`, `customerInputSchema`, `bookingSettingsSchema`, `questionInputSchema`, `availabilityRuleInputSchema`, `answersInputSchema` never yields a message matching `/\b(Too|Invalid|expected|must|received|string|number)\b/` nor a dash; `fieldErrors` keys are dotted paths. `pro-messages.test.ts`: every code has a non-empty pro message; no dash anywhere; overrides use real codes; `already_booked` in `register` → « Ce client est déjà inscrit à cette séance. »; an engine `message` wins; a context override beats the general text; no message equals « Vous êtes déjà inscrit(e). ».
- Commit: `feat(vocab): tickets-vocab split, French zod messages and pro error messages`.

**Task 3: Formatting helpers and client e-mail templates** (G1)
- Files: § 3.1 rows of Task 3 (`format.ts` includes `parseMoneyInput`, `moneyInputValue`, `currencySymbol` from § 4.9).
- Depends on: 2. Interfaces: § 4.2, § 4.9 (money helpers).
- Tests (pure): `format.test.ts`: `formatWhen` in Europe/Paris and America/Los_Angeles (« lun. 12 octobre 2026 · 19:00 à 20:00 » for Paris), DST days 2026-03-29 and 2026-10-25, `expiryLabel` year rule and « sans limite de validité », `plural` for 0 / 1 / 2 / 1000, `planningHref` (a Sunday séance → the Monday before; LA vs Paris day boundary), `parseMoneyInput` (« 25 » 2500, « 25,5 » 2550, « 25.50 » 2550, « 0 » / « -3 » / « 2,555 » / « abc » / « » → null), `moneyInputValue`, `currencySymbol("eur") === "€"`, no output contains a dash. `client-emails.test.ts`: per template, every string arg set to `<script>&"'` appears escaped (`&lt;script&gt;`), never raw; subject has no CR/LF and contains the title; no dash in subject or html; the personal link is an `href`; template-specific content (booking-confirmed: « Couverture », one line per ticket type left, the three calendar buttons; booking-cancelled: pro vs client sentences, ticket line only when `ticketReturned`; occurrence-changed: cancel line only when `canCancelUntilStart`; occurrence-cancelled: ticket line toggles; attendee-moved: « Avant » / « Maintenant »; tickets-offered: singular / plural subject).
- Commit: `feat(emails): client templates for registrations, changes and cancellations`.

**Task 4: Personal link, calendar links and Google sync on the occurrence** (G1)
- Files: § 3.1 rows of Task 4.
- Depends on: 3. Interfaces: § 4.3.
- Tests: pure — `guest-link.test.ts` (`personalLinkUrl` verifies back with `verifyGuestLink`, trailing slash handled), `calendar-links.test.ts` (location in Google, Outlook and ICS, ICS escaping of `,;\n`), `google-event.test.ts` (64-hex deterministic id, same input → same id; RDV summary « Cours particulier · Beatriz »; « Places : 2/12 »; location present / absent; `status: "confirmed"`; no dash), `calendar-sync.test.ts` (fake deps recording calls: disabled; no calendar → skipped; not wanted + no marker → "noop" and `getAccessToken` never called; not wanted + marker → delete then `saveEventId(null)`; wanted + no marker → insert "created" then save id; insert "exists" → patch with `body.id` then save; marker + patch "patched" → "updated", no insert; marker + patch "missing" → insert then save; cancelled occurrence with a marker → deleted). DB — `calendar-sync-load.db.test.ts`: a séance with 2 confirmed and 1 pending booking → 2 attendees by createdAt; title from the event; `location_override` wins over the event location; an RDV (fixture `bookRdv` or `rowRdv` + booking) → type name, `isRdv`, location null; `saveGoogleEventId` sets then clears.
- Commit: `feat(google): sync keyed on the occurrence with a deterministic event id`.

**Task 5: Effects: planning, executor, Stripe expiry, revenue** (G1)
- Files: § 3.1 rows of Task 5.
- Depends on: 4. Interfaces: § 4.4.
- Tests: pure — `notify-core.test.ts` (`dedupeEffects`: duplicate e-mails with bookingIds in another order collapse, google effects last, order otherwise kept). DB — `notify-core.db.test.ts` with `guestKey = guestLinkKey("test-secret")`, `appUrl = "https://app.test"`: `registerPro` → `booking_confirmed` plan = 1 e-mail to the customer, subject « Inscription confirmée : … », html contains `https://app.test/api/c/`, the ICS URL and the tickets-left line; `cancelBookingsByPro` → `booking_cancelled` with the ticket line; a séance with one confirmed booking and one lapsed hold (`startBuyAndBook` at now − 60 min, then `cancelOccurrence` at now) → `occurrence_cancelled` mails the confirmed client only; `updateOccurrence` time change → `occurrence_changed` with the cancel line; `moveAttendee` → `attendee_moved`; `offerTickets` with notify → `tickets_offered` (count, type); each P4 type → `deferred`; google / stripe effects pass through; an unknown booking id → `{ kind: "emails", emails: [] }`.
- Commit: `feat(notify): post-commit effects (e-mails, Google, Stripe expiry)`.

**Task 6: Action plumbing and the dash scan** (G1)
- Files: § 3.1 rows of Task 6.
- Depends on: 5. Interfaces: § 4.5.
- Tests (pure): `result.test.ts` (`fromEngine` keeps the code and uses the context wording; `withoutEffects` drops only `effects`; `actionFail`); `ui-copy.test.ts` green after removing every reported dash (rewrite comments; `planning-calendar` week label becomes « {a} au {b} »; `weekly-hours-editor` separator « à »; `unavailability/page.tsx` range « {a} à {b} »).
- Commit: `feat(back-office): action context, results and the dash-free copy guard`.

**Task 7: Time zone: valid zones, the lock and the createEvent guard** (G1)
- Files: § 3.1 rows of Task 7.
- Depends on: 6. Interfaces: § 4.6.
- Tests: pure — `timezones.test.ts` (Zurich valid, Geneva invalid, "" invalid, label lookup and fallback). DB — `settings-actions.db.test.ts`: change allowed with no event and no occurrence; refused with a non-archived event → `{ ok: false, code: "timezone_locked", error: "Fuseau verrouillé : vous avez des séances planifiées." }` and the row unchanged; refused with only a future scheduled RDV; allowed when the only event is archived and has no future scheduled séance; same zone + other fields → allowed while locked; invalid zone → « Fuseau horaire inconnu. »; `isTimezoneLocked` true / false. `occurrences.db.test.ts` addition: `createEvent` whose `afterPlan` updates `professional.timezone` → `{ ok: false, code: "stale" }` and no event row.
- Browser: `/dashboard/settings`: the time-zone select is disabled with « Fuseau verrouillé : vous avez des séances planifiées. »; its options show « Genève, Zurich (Suisse) »; change the activity name → « Enregistré », change it back → « Enregistré » again (two actions); reload keeps the value.
- Commit: `feat(settings): time-zone lock, valid zones, createEvent tz guard`.

**Task 8: Navigation, redirects and dashboard primitives** (G1)
- Files: § 3.1 rows of Task 8.
- Depends on: 7. Interfaces: § 4.7.
- Tests: pure — `notice.test.ts` (preset labels; 45 → « 45 min avant »; 90 → « 1 h 30 min avant »; 7200 → « 5 jours avant »; `noticeExceedsHorizon(1440, 1)` false, `(1441, 1)` true); `confirm-copy.test.ts` (each function non-empty for 0 / 1 / 2, no dash, `deleteTypeCopy` lists `acceptedBy`, `unenrollCopy` adds the payment sentence only with pending, `cancelOccurrenceCopy` past sentence). Full DB suite (end of G1).
- Browser: sidebar order and labels exactly as § 4.7 (desktop and 375 px); `/dashboard/event-types` and `/dashboard/packs` land on `/dashboard/tickets` (a 404 there is expected until Task 11); `/dashboard` shows the skeleton briefly then the page; console clean.
- Commit: `feat(dashboard): navigation, redirects and shared primitives`.

### G2 — Tickets (Tasks 9–13)

**Task 9: Catalog reads and the rdv_free alert** (G2)
- Files: § 3.2 rows of Task 9.
- Depends on: 8. Interfaces: § 4.8 (reads), `loadTypeFacts` change.
- Tests (DB) — `catalog-reads.db.test.ts`: order by position then createdAt then id; offers with `label`, `validityText`, `sold` (a paid purchase through `startPurchase` + `fulfillPurchase`); `acceptedBy` lists one entry per series root after an `editSeriesFrom` split; archived types in `archived`; `usableTickets` ignores expired tickets; `orphan` true for an unlinked non-RDV type, false once linked to a future tickets-mode event (private too), true for an unlinked `rdv_free` type; `getTicketTypeDetail` null for another pro's id; `usage` counts; own vs global hours; `listActiveTypeOptions` without archived. `wallet.db.test.ts` addition: `loadTypeFacts` reports `rdvEnabled: false` for an `rdv_free` type.
- Commit: `feat(tickets): catalog reads; rdv_free types raise the orange alert`.

**Task 10: Catalog cores and wrappers** (G2)
- Files: § 3.2 rows of Task 10.
- Depends on: 9. Interfaces: § 4.8 (cores, wrappers), § 5 rows 1–10.
- Tests (DB) — `catalog-actions.db.test.ts` (with `proCtx`): empty name → « Nom : ce champ est obligatoire. »; a name-only patch keeps the RDV fields; `rdvFree` on refused with an offer en vente (`RDV_FREE_HAS_SALES`) and with a usable ticket, accepted once the offer is off and no ticket is held; override notice 10080 with horizon 1 → `NOTICE_TOO_LONG`; archive / unarchive; delete unused → `deleted`, used → `archived`; offer on an `rdv_free` type → `RDV_FREE_NO_OFFER`; offer on an archived type → « Type ou offre introuvable. »; `setOfferActive` flips `is_active` and keeps the other columns; delete a bought offer → `archived`; hours set then cleared; questions saved; another pro's ctx on these ids → the not-found wording; every result has `effects: []`.
- Commit: `feat(tickets): catalog actions`.

**Task 11: Tickets list page** (G2)
- Files: § 3.2 rows of Task 11.
- Depends on: 10. Interfaces: § 4.9 (`TicketTypeCard`, `NewTicketTypeButton`), § 6 `/dashboard/tickets`.
- Browser: `http://localhost:3102/dashboard/tickets`: cards « Cours collectif » (« À l'unité · 25 € », « Carnet de 4 · 85 € · 3 mois », « Carnet de 10 · 190 € · 6 mois »), « Cours d'essai », « Cours particulier » (« RDV libre · 60 min »), « Appel découverte » (« RDV gratuit · 15 min », « Gratuit, sans ticket »), « Cours en plein air » with the orange mark and « Lié à aucun événement à venir »; « Types archivés (1) » holds « Stage d'été 2026 ». « Nouveau type de ticket » with an empty name → « Nom : ce champ est obligatoire. » under the field; « Test P3 » → navigates to `/dashboard/tickets/<id>` (404 expected until Task 12); back to the list: the card exists. 375 px: one column, no horizontal scroll.
- Commit: `feat(tickets): types and offers list`.

**Task 12: Ticket type page: information, offers, « Accepté par », archive and delete** (G2)
- Files: § 3.2 rows of Task 12.
- Depends on: 11. Interfaces: § 4.9, § 6 `/dashboard/tickets/[id]`.
- Browser: open « Cours collectif »: offers with sold counts; « Accepté par » lists « Altinha débutants », « Altinha intermédiaires », « Atelier technique », « Équipe compétition » (« Privé »). « En vente » off on « À l'unité », then on again. « Ajouter une offre »: quantity 2, price « 40 », validity 2 « En mois » → « Carnet de 2 · 40 € · 2 mois »; « Supprimer » it → confirmation « Elle disparaît de votre page. » → gone. On « Cours d'essai » edit the description, save, save again. Open « Test P3 » (Task 11) → « Supprimer » → « Ses offres, ses horaires et ses questions sont supprimés. » → back on the list without it. On « Cours en plein air » « Supprimer » shows « Ce type a déjà servi … il sera archivé, pas supprimé. » → « Retour » (seed kept).
- Commit: `feat(tickets): type page with offers, accepted-by and archive`.

**Task 13: RDV libre settings, per-type hours and questions** (G2)
- Files: § 3.2 rows of Task 13.
- Depends on: 12. Interfaces: § 4.9 (`QuestionsEditor`, `RdvSettingsForm`, `TypeQuestionsForm`, `TypeHoursEditor`, `WindowOverrideFields`).
- Tests: full DB suite (end of G2).
- Browser: « Cours particulier »: RDV section shows 60 min and the seeded question; « Marge après » 10 → save, save again; « Horaires propres à ce type » on, edit one range, save; then « Revenir aux disponibilités générales ». Override « Au plus tard » « 7 jours avant » with « Réservable jusqu'à » 1 → the `NOTICE_TOO_LONG` text. « Cours collectif »: turning RDV on shows « Gratuit » disabled with « Retirez d'abord ses offres en vente et ses tickets valides. » (do not save; turn RDV off). « Appel découverte »: add a question « Votre objectif ? » (Texte libre), save, remove it, save.
- Commit: `feat(tickets): RDV libre settings, type hours and questions`.

### G3 — Événements (Tasks 14–20)

**Task 14: Recurrence form and event defaults** (G3)
- Files: § 3.3 rows of Task 14.
- Depends on: 8. Interfaces: § 4.10.
- Tests (pure): round trips `formFromRule` / `ruleFromForm` for once, daily, weekly (several days, unsorted input → sorted), monthly by day, nth weekday, last weekday, until and count; every `ruleFromForm` output passes `recurrenceRuleSchema`; `monthlyChoices` for 2026-10-05 (day + « Le 1er lundi »), 2026-10-29 (day + last only, since n = 5), 2026-10-24 (day + « Le 4e samedi », not last), 2026-10-26 (day + « Le 4e lundi » + « Le dernier lundi »); `dstNoteTexts` Paris 02:30 on 2026-03-29 → « Le 29/03, 02:30 n'existe pas (heure d'été) : la séance commence à 03:30. », 2026-10-25 02:30 → the « existe deux fois » text, Los Angeles 2026-03-08 02:30; `previewDates` start at local today in tz; `recurrenceSummary`. `event-defaults.test.ts`: clicked future date minute 615 → 600; clicked past date → default; now 22:10 Paris → 23:00 today; now 23:10 → tomorrow 09:00; LA pro at a Paris-midnight instant; `parseClickedCell` rejects bad values.
- Commit: `feat(events): recurrence form model and event defaults`.

**Task 15: Event reads** (G3)
- Files: § 3.3 rows of Task 15.
- Depends on: 9. Interfaces: § 4.11 (reads).
- Tests (DB) — `event-reads.db.test.ts`: one row per root after a split, linking the segment with the next séance; `noActiveType` with no or only archived linked types (tickets mode), false in free mode; an archived series in `ended`; `getEventEditor` on the current id → ok with `fromDate` = first future séance date and `remainingCount` in count mode; the old segment id after a split → `redirect` to the new id; another pro → null; archived → `readOnly`; `typeOptions` without archived and rdv_free, `linkedArchivedTypes`; `countRdvConflicts` counts an overlapping scheduled RDV and ignores a cancelled one; `deleteFromPreview` equals what `deleteSeriesFrom` then reports (whole-event case and booked case: cancelled séances, registrants, tickets returned).
- Commit: `feat(events): event reads (list, editor, conflicts, delete preview)`.

**Task 16: Event cores and wrappers** (G3)
- Files: § 3.3 rows of Task 16 (+ `eventInfoSchema` in `src/lib/tickets.ts`).
- Depends on: 15. Interfaces: § 4.11 (cores, wrappers), § 5 rows 11–17.
- Tests (DB) — `event-actions.db.test.ts`: past start → `EVENT_START_PAST`; start > today + 730 → `EVENT_START_TOO_FAR`; duplicate type ids accepted once (no 500); archived, rdv_free or other-pro type → `EVENT_TYPE_UNAVAILABLE`; empty title → « Titre : ce champ est obligatoire. »; ok returns `occurrenceCount`; `NOTICE_TOO_LONG`; `editEventInfoCore`: stale `seenVersion` → the stale wording; a location change with a confirmed booking returns an `email.occurrence_changed` effect; a linked archived type can stay; capacity propagates; `previewScheduleCore` returns both texts and `rdvConflicts`; `applyScheduleCore` on a series with past séances returns a new `eventId`; the TIM1 refusal text passes through; `deleteEventFromCore` whole → `deletedEvent: true`; other pro's event → « Événement introuvable ou terminé. ».
- Commit: `feat(events): event actions (create, edit, schedule cut, delete)`.

**Task 17: Events list page** (G3)
- Files: § 3.3 rows of Task 17.
- Depends on: 16. Interfaces: § 4.12 (`EventList`), § 6 `/dashboard/events`.
- Browser: `/dashboard/events`: « Altinha débutants » (« Toutes les semaines le lundi et le mercredi », « Sur tickets », chips « Cours collectif » and « Cours d'essai », next séance), « Roda libre » (« Inscription libre »), « Équipe compétition » (« Privé »); « Nouvel événement » → `/dashboard/events/new` (404 expected until Task 19). 375 px: cards.
- Commit: `feat(events): events list`.

**Task 18: Recurrence editor and preview components** (G3)
- Files: § 3.3 rows of Task 18.
- Depends on: 14, 17. Interfaces: § 4.12 (`RecurrenceEditor`, `RecurrencePreview`).
- Tests: tsc, eslint, build (the components are exercised in the browser by Task 19).
- Commit: `feat(events): recurrence editor and preview`.

**Task 19: New event page** (G3)
- Files: § 3.3 rows of Task 19.
- Depends on: 18, 13. Interfaces: § 4.12 (`EventInfoFields`, `EventCreateForm`, `EventInfoValue`, `eventInfoInput`), § 6 `/dashboard/events/new`.
- Browser: `/dashboard/events/new?date=<today + 10 days>&minute=1110` → start prefilled at 18:30. Submit with an empty title → « Titre : ce champ est obligatoire. ». « Test P3 », « Toutes les semaines », mardi + jeudi, « Après » 4 séances → preview « Toutes les semaines le mardi et le jeudi, 4 séances » and 4 dates. Set the date to 2027-03-28, 02:30, « Une seule fois » → the DST note « Le 28/03, 02:30 n'existe pas (heure d'été) : la séance commence à 03:30. »; set back. Start 2026-10-26 + « Tous les mois » → choices include « Le 4e lundi de chaque mois » and « Le dernier lundi de chaque mois ». « Créer l'événement » → navigates to `/dashboard/events/<id>` (404 expected until Task 20); `/dashboard/events` lists « Test P3 ». 375 px: no horizontal scroll.
- Commit: `feat(events): new event page`.

**Task 20: Event page: information, schedule, séances, segments, delete** (G3)
- Files: § 3.3 rows of Task 20.
- Depends on: 19. Interfaces: § 4.12 (`EventInfoForm`, `EventScheduleForm`, `EventDeleteCard`), § 6 `/dashboard/events/[id]`.
- Tests: full DB suite (end of G3).
- Browser: open « Test P3 »: change the title, save, save again (fresh `seenVersion`); schedule 19:00 → « Prévisualiser les changements » → « 4 séances modifiées » and the in-place note → « Appliquer à partir du … » → back on the page with 19:00; « Supprimer l'événement » → « L'événement n'a jamais eu d'inscription : il est supprimé définitivement. » → on `/dashboard/events` without it. Open « Altinha débutants »: types checked, « Prochaines séances » listed; preview a change to « lundi » only → summary text renders (orphan radios when a Wednesday séance has registrants); do NOT apply.
- Commit: `feat(events): event page with in-place info, schedule cut and delete`.

### G4 — Planning, indisponibilités, réglages (Tasks 21–29)

**Task 21: Planning reads and view model** (G4)
- Files: § 3.4 rows of Task 21.
- Depends on: 8. Interfaces: § 4.13.
- Tests: pure — `planning-view.test.ts` (`hiddenByTimeOff`: empty scheduled séance under time off hidden; booked, cancelled and RDV never; `toPlanningVM` lanes for two overlapping séances, a third non-overlapping one alone; `endMinute` 1440 across midnight; Paris vs LA; `timeOffSegments` for a 3-day all-day time off → 3 full-day segments, a partial day; `gridHours` default and widened; `weekTitle` 3 cases; `minuteFromOffset` rounding and clamp). DB — `planning-reads.db.test.ts`: the range keeps séances and RDVs, drops cancelled RDVs, keeps cancelled séances; attendees pending + confirmed with answers and ticket; `seatsShown` with an elapsed hold; bounds are half-open; another pro's rows excluded; overlapping time off; `searchCustomers` escapes `%` and `_` (customer « 100% Yoga ») and needs 2 chars; `registerOptions` null for another pro's customer or occurrence and for an RDV, lists usable tickets, `alreadyBooked`; `moveTargets` excludes the source, past séances, RDVs, other-mode targets for ticket coverage, marks `accepted` / `conversionTypes` / `full` / `expiresBefore`, honours 60 days, null for another pro's booking.
- Commit: `feat(planning): week reads and view model`.

**Task 22: Séance cores and wrappers** (G4)
- Files: `src/lib/back-office/planning-actions.ts` (séance part), `.db.test.ts`; C `src/server/pro-planning.ts` (séance wrappers).
- Depends on: 21. Interfaces: § 4.14 (Task 22 list), § 5 rows 18–23, 26, 27.
- Tests (DB): time change from `date` + `startMinute` lands on `instantAt(date, minute, tz)` for a Paris pro and for a pro created with `createTestPro(db, { tz: "America/Los_Angeles" })`; `TIME_PARTS_REQUIRED`; started séance → « Une séance concernée a déjà commencé. »; old `seenStartsAt` → « La séance a changé entre-temps : rafraîchissez la page. »; unenroll ids on a move; capacity scope occurrence vs event (event scope leaves a `capacity_override` séance unchanged); cancel → `occurrence_cancelled` effect; restore future ok, past → « Seule une séance future d'un événement peut être rétablie. »; unenroll two bookings → counts; `previewFollowingCore` / `applyFollowingCore` on a weekly series move this and later séances to the new minute, earlier ones untouched; every core refuses another pro's ids with the not-found wording.
- Commit: `feat(planning): séance actions (edit, capacity, cancel, restore, unenroll, following)`.

**Task 23: Attendee cores, wrappers and the registerPro ticket read** (G4)
- Files: M `planning-actions.ts` (+ attendee part), M its `.db.test.ts`; M `src/server/pro-planning.ts`; M `src/lib/booking/eligibility.ts`, `src/lib/booking/claims.ts`, `src/lib/booking/claims.db.test.ts`.
- Depends on: 22. Interfaces: § 4.14 (Task 23 list, engine fix), § 5 rows 24, 25, 28–30.
- Tests (DB): register with a ticket (auto) → coverage ticket and the ticket spent; a specific ticket; guest; none mode + auto → `REGISTER_NONE_GUEST`; `ticketId` in free mode → `REGISTER_NO_TICKET_MODE`; RDV → `REGISTER_RDV`; cancelled séance → the register `unavailable` wording; new client → `customerCreated: true`, existing e-mail → false; registered twice → « Ce client est déjà inscrit à cette séance. »; full without `extraSeat` → « Complet : cochez « +1 place » pour l'inscrire quand même. », with it ok; move to an accepting target with effects; not accepted without conversion → the move `not_eligible` wording; with conversion ok; rdv_free conversion → `CONVERSION_TYPE_UNAVAILABLE`; expiring ticket → `code: "ticket_expires_before"`, then `force` ok; search / options / targets cores; cross-tenant on each. `claims.db.test.ts`: `registerPro` returns the id of the ticket actually booked on the booking; `bookWithHeldTicket` too.
- Commit: `feat(planning): register and move attendees; registerPro reads its ticket from the batch`.

**Task 24: Planning page and calendar** (G4)
- Files: § 3.4 rows of Task 24.
- Depends on: 23. Interfaces: § 4.13 (`getPlanningPage`), § 4.15 (`PlanningCalendar`, `OccurrenceDialog` details, `WeekPreview` types), § 6 `/dashboard/planning`.
- Browser: `/dashboard/planning`: this week's « Altinha débutants » (lundi, mercredi 19:00), « Altinha intermédiaires », a struck « Annulée » séance when in view, Roda when its Saturday is in view, the RDV « Cours particulier · Beatriz Almeida » (use « Semaine suivante » if needed). Click a débutants séance → dialog with attendees (Thomas « Ticket »; Marina with ticket label and her answer). Go to the week of the « Vacances » time off (≈ 3 weeks ahead): hatched full-day block, that day's empty séances hidden. Click an empty future cell around 10:00 → `/dashboard/events/new?date=…&minute=600` prefilled. Deep link: from an event page « Prochaines séances » link → the planning opens with that séance's dialog. 375 px: day chips, list, dialog usable; console clean.
- Commit: `feat(planning): week page with lanes, time off, deep links and day view`.

**Task 25: Occurrence dialog actions: capacity, cancel, restore, unenroll** (G4)
- Files: § 3.4 rows of Task 25.
- Depends on: 24. Interfaces: § 4.15 (`OccurrenceDialog` Task 25 part, `SessionCapacityControl`).
- Browser: on a future débutants séance with Thomas: places 12 → 13 « Cette séance » → the seats line updates; back to 12 (second action). « Désinscrire » Thomas → « Désinscrire Thomas Leroy ? » / « Le ticket est rendu au client, qui est prévenu par email. » → removed; the dev log shows ONE mock e-mail « Inscription annulée : Altinha débutants » to thomas@example.com. On an empty future séance: « Annuler la séance » → « Personne n'est inscrit : la séance est simplement annulée. » → struck; « Rétablir » → « La séance redevient réservable ; les anciens inscrits ne sont pas réinscrits. » → scheduled again.
- Commit: `feat(planning): capacity scope, cancel, restore and unenroll from the dialog`.

**Task 26: Edit this séance, the following séances, « Déplacer »** (G4)
- Files: § 3.4 rows of Task 26.
- Depends on: 25. Interfaces: § 4.15 (`OccurrenceEditForm`, `MoveAttendeeDialog`).
- Browser: Marina's débutants séance: « Modifier cette séance » 19:30 → saved, mock « Séance modifiée » e-mails in the log; edit again back to 19:00 (fresh `seenStartsAt`). « Appliquer aussi aux séances suivantes » 19:15 → preview text → confirm → later séances at 19:15; repeat with 19:00. « Déplacer » Marina → targets with « Accepté » → move to the next débutants séance → « Inscription déplacée. Le client est prévenu par email. »; move her back.
- Commit: `feat(planning): edit a séance and its followers; move an attendee`.

**Task 27: Register attendee dialog** (G4)
- Files: § 3.4 rows of Task 27.
- Depends on: 26. Interfaces: § 4.15 (`RegisterAttendeeDialog`).
- Browser: future débutants séance → « Inscrire » → search « bea » → Beatriz → « Avec un ticket… » → « Inscrire » → success text, Beatriz listed « Ticket », log « Inscription confirmée » with a `/api/c/` link; « lea » → « Un ticket précis » lists her « Cours d'essai … · offert » tickets; « Nouveau client » « Test P3 » / `test-p3@skedul.test` → only « Sans ticket (invité) » → listed « Invité »; Beatriz again → « Ce client est déjà inscrit à cette séance. »; Roda libre → « Inscription libre » default. Unenroll the three test registrations afterwards.
- Commit: `feat(planning): register an attendee from the séance dialog`.

**Task 28: Time off with conflicts** (G4)
- Files: § 3.4 rows of Task 28.
- Depends on: 23. Interfaces: § 4.14 (time off), § 4.15 (`TimeOffConflictDialog`, `UnavailabilityManager`).
- Tests (DB) — `time-off-actions.db.test.ts`: interval built in the pro tz (Paris and LA); > 366 days → `TIME_OFF_TOO_LONG`; the `buildTimeOffInterval` message passes through; conflicts list séances and RDVs with `kind`; create without conflict; create with `cancelBooked` → `cancelledOccurrences` and the cancel effects; a booking taken after the preview → `code: "stale"`; delete own; delete another pro's → « Indisponibilité introuvable. » and nothing deleted.
- Browser: `/dashboard/unavailability`: an all-day time off on a day without bookings → added at once (no dialog), listed under « À venir », that day's empty séances hidden in the planning; a time off covering the next débutants séance with registrants → the dialog lists « … · Altinha débutants · {n} inscrits » + the keep note → « Les garder » → added; delete both through the confirmation « Les séances vides qu'elle masquait réapparaissent… ».
- Commit: `feat(unavailability): time off with E6c conflict choice`.

**Task 29: Settings « Réservations » and availability** (G4)
- Files: § 3.4 rows of Task 29.
- Depends on: 28. Interfaces: § 4.16.
- Tests: DB — `settings-actions.db.test.ts` additions: settings saved; notice > horizon → `NOTICE_TOO_LONG`; horizon 400 → « Réservable jusqu'à : maximum 365. »; `saveAvailabilityCore` replaces the global rules and leaves a type's rules untouched; an inverted range → « Plage horaire invalide. ». Full DB suite (end of G4).
- Browser: `/dashboard/settings` « Réservations » shows 60 / « 1 h avant » / 24; horizon 1 + « 7 jours avant » → `NOTICE_TOO_LONG`; 90 → « Enregistré »; back to 60 → « Enregistré » (two actions). `/dashboard/availability` titled « Disponibilités (RDV libre) »; edit a day, save twice.
- Commit: `feat(settings): booking settings and RDV hours on the engine`.

### G5 — Clients and money (Tasks 30–38)

**Task 30: Wallet, history, filters and dashboard view models** (G5)
- Files: § 3.5 rows of Task 30.
- Depends on: 8. Interfaces: § 4.17.
- Tests (pure): `history.test.ts` exact « 12/10 14:03 · Vous · Converti 3 Cours collectif → Cours débutants » (three convert movements of one action), close line with motif and note, retire « Retiré », spend with « · Altinha débutants du 14/10 », grouping by action and newest first, unknown type « type supprimé », Paris vs LA dates; `wallet-view.test.ts` buckets (usable, booked future, booked past « Utilisé le », expired red, used « Pointé le », closed, retired), `expirySummary`, ids order (consumption order, unpoint most recent first), red / orange group alert; `client-filters.test.ts` (`credits` alias, `isClient`, `isListedClient`, each filter); `dashboard-view.test.ts` (tile labels and hrefs, `revenueDisplay` with the pro currency absent, alert plurals 1 / 2, steps null when done).
- Commit: `feat(clients): wallet, history, filter and overview view models`.

**Task 31: Client reads** (G5)
- Files: § 3.5 rows of Task 31.
- Depends on: 30. Interfaces: § 4.18 (reads).
- Tests (DB) — `client-reads.db.test.ts`: a customer with only a pending purchase is not listed, a new customer is, a ticket holder is; filters and counts; search escaping; red for an archived-type holder, orange for an unlinked type and for an rdv_free type; `getClientRecord` wallet groups (a booked ticket on a past séance in `done`), bookings upcoming / past with `canMove` / `canUnenroll`, purchases newest first, history lines with the séance suffix; another pro's customer → null.
- Commit: `feat(clients): client list and record reads`.

**Task 32: Client cores and wrappers** (G5)
- Files: § 3.5 rows of Task 32.
- Depends on: 31. Interfaces: § 4.18 (cores, wrappers), § 5 rows 34–42.
- Tests (DB) — `client-actions.db.test.ts`: bad e-mail → « Email : adresse email invalide. »; an existing e-mail updates the name (`created: false`); update name / phone; revoke bumps `link_version`; offer: rdv_free → `OFFER_RDV_FREE`, archived type → the wallet not-found wording, yesterday → `EXPIRY_IN_PAST`, today → `expires_at` = next local midnight (Paris and LA pros), notify → a `tickets_offered` effect; convert: same type → `CONVERT_SAME_TYPE`, rdv_free target → `CONVERT_TARGET_UNAVAILABLE`, ok keeps purchase and expiry; close rembourse on an offered id → « Un ticket offert se retire. »; autre without note → « Précisez le motif. »; retire a paid ticket → « Un ticket payé ne peut pas être retiré : utilisez « Clore ». »; point then the same ids again → the wallet `no_ticket` wording and nothing changed twice; unpoint; cross-tenant.
- Commit: `feat(clients): client and wallet actions`.

**Task 33: Clients list page** (G5)
- Files: § 3.5 rows of Task 33.
- Depends on: 32. Interfaces: § 4.19 (`ClientList`, `NewClientButton`), § 6 `/dashboard/clients`.
- Browser: `/dashboard/clients`: Beatriz, Léa, Marina, Rafael (red mark), Thomas (orange mark); chip counts; « Alertes » → Rafael and Thomas; `?filter=credits` behaves like « Avec tickets »; search « mar » → Marina; « Nouveau client » « Test P3 bis » / `test-p3-bis@skedul.test` → `/dashboard/clients/<id>` (404 expected until Task 34). 375 px: cards, chips row scrolls inside itself.
- Commit: `feat(clients): clients list with filters, search and new client`.

**Task 34: Client record: header, wallet, purchases, history** (G5)
- Files: § 3.5 rows of Task 34.
- Depends on: 33. Interfaces: § 4.19 (`ClientHeader`, `ClientWallet` read-only, `ClientPurchases`, `LedgerList`), § 6 `/dashboard/clients/[id]`.
- Browser: Beatriz: « Cours collectif » usable count and « valable jusqu'au … inclus », « Utilisé le … » lines for her 3 past classes, « Pointé le … » struck; « Cours particulier » converted ticket « Réservé pour le … »; history « … · Vous · Converti 1 Cours collectif → Cours particulier »; purchase « Carnet de 10 » 190 € with « Test »; « Compte client lié ». Rafael: red « Stage d'été 2026 » group with « Type archivé : ces tickets ne servent plus. Proposez « Convertir ». » and his expired carnet in red. Edit Beatriz's phone, save, edit again; « Déconnecter ses liens » → confirmation → « Liens déconnectés. ». 375 px: Fiche, Portefeuille, Inscriptions (Task 35), Achats, Historique stacked.
- Commit: `feat(clients): client record with wallet, purchases and history`.

**Task 35: Client record: wallet actions and bookings** (G5)
- Files: § 3.5 rows of Task 35.
- Depends on: 34, 26. Interfaces: § 4.19 (`OfferTicketsButton`, `WalletGroupActions`, `ClientBookings`).
- Browser: « Test P3 bis »: « Offrir des tickets » 3 × « Cours collectif », « Jusqu'au » today + 30, « Prévenir le client par email » → « 3 tickets offerts. » and a mock « Altinha Paris vous offre 3 tickets » e-mail; « Pointer » 1 → struck « Pointé le … »; « Annuler le pointage » 1; « Convertir » 1 → « Cours d'essai »; « Retirer » 1 → confirmation → « Retiré le … »; « Clore » « Autre » without note → « Précisez le motif. », with a note → confirmation → « Clos le … : Autre ». The history lists each action. Thomas: « Déplacer » opens the move dialog (close it), « Désinscrire » shows its confirmation (« Retour »).
- Commit: `feat(clients): wallet actions and bookings on the client record`.

**Task 36: Payments** (G5)
- Files: § 3.5 rows of Task 36.
- Depends on: 30. Interfaces: § 4.20 (payments), § 6 `/dashboard/payments`.
- Tests (DB) — `payments-reads.db.test.ts`: only paid purchases, newest first; `30j` filter; linked booking of a buy + book purchase; `closedNotes` grouped by reason and note; totals equal `revenueByCurrency({ live: false, professionalId })`; another pro's purchases excluded.
- Browser: `/dashboard/payments`: Marina's « Carnet de 4 » with « Inscription liée » débutants and « 1 ticket clos : Remboursé hors Skedul (Remboursé en espèces) », Beatriz's « Carnet de 10 », Rafael's « Carnet de 4 », Thomas's « À l'unité » (essai); every row « Test »; « Encaissé » total; « 30 derniers jours » hides Rafael's and Beatriz's purchases.
- Commit: `feat(payments): payments page with linked bookings and closed-ticket notes`.

**Task 37: Overview: KPIs, alerts, first steps, week, upcoming bookings** (G5)
- Files: § 3.5 rows of Task 37.
- Depends on: 36, 31, 15, 24. Interfaces: § 4.17 (`dashboard-view`), § 4.20 (`getDashboardData`, components), § 6 `/dashboard`.
- Tests (DB) — `dashboard-reads.db.test.ts`: séances (7 j) exclude an empty séance under a time off, include a booked RDV, exclude a cancelled one; registrants count confirmed only; tickets in circulation include an archived type's; clients = isClient; alert counts; `eventsWithoutActiveType`; getting-started flags and `firstTypeId`; upcoming bookings ordered, at most 8.
- Browser: `/dashboard`: 4 tiles with values and links; « Alertes » shows « 1 client a des tickets d'un type archivé. » and « 1 client a des tickets d'un type lié à aucun événement à venir. »; « Premiers pas » absent (seed complete); the week preview opens the occurrence dialog; an upcoming booking opens its dialog; « Désinscrire » shows its confirmation (« Retour »). 375 px: KPI 2 columns.
- Commit: `feat(dashboard): overview with KPIs, alerts, first steps and upcoming bookings`.

**Task 38: « Confirmez votre adresse » banner and the French 429** (G5)
- Files: § 3.5 rows of Task 38.
- Depends on: 37. Interfaces: § 4.20 (`VerifyEmailBanner`).
- Tests: full DB suite (end of G5).
- Browser: sign out; `/sign-up` with a fresh test address `p3-banner-<4 random digits>@skedul.test` and a generated test password (local dev host, test values only; record nothing in chat) → onboarding → `/dashboard` shows « Confirmez votre adresse … » → « Recevoir un code » → the dev log shows the mock code e-mail → enter the code → the banner disappears. Sign out; « Pro · back-office » → no banner.
- Commit: `feat(dashboard): e-mail verification banner; French rate-limit message`.

### G6 — Admin and read-only public (Tasks 39–43)

**Task 39: Admin reads** (G6)
- Files: § 3.6 rows of Task 39.
- Depends on: 8, 5. Interfaces: § 4.21 (`admin-reads`, `admin-queries` changes).
- Tests (DB) — `admin-reads.db.test.ts` (tickets-test is shared: assert deltas before / after, never absolute platform counts): a confirmed booking makes the test pro count in `activePros30d` and `bookings30d`; a paid test-mode purchase counts too; `platformRevenue` scoped by `professionalId`; feed titles « Réservation · Test … » / « Achat · Test … »; `listRecentBookings` status filter and title from event or type; `listRecentPurchases` livemode; `healthCounts` pending holds (a pending booking created 2 h ago), pending purchases (checkout expired), horizon lag (an event with an old `generated_until`), `readHealth` values; `proStats`; `deletionImpactFor` client records elsewhere.
- Commit: `feat(admin): admin reads on the tickets domain`.

**Task 40: Admin screens and account deletion (E13)** (G6)
- Files: § 3.6 rows of Task 40.
- Depends on: 39. Interfaces: § 4.21 (Admin UI).
- Browser (« Admin · espace Skedul » quick login): `/admin` tiles « Réservations (30 j) » and active pros non-zero; feed « Réservation · Altinha Paris »; `/admin/activity` « Inscriptions » with « Couverture » and « Statut », « Achats » with « Test »; status chips filter; the app health card rows; `/admin/users/<pro user id>` new tiles; the delete card shows tickets in circulation and payments in progress (do not delete).
- Commit: `feat(admin): activity, health and deletion impact on tickets; expire checkouts before deletion`.

**Task 41: Personal link and the read-only client space** (G6)
- Files: § 3.6 rows of Task 41.
- Depends on: 32, 5, 30. Interfaces: § 4.22.
- Tests: pure — `guest-access.test.ts` (decision matrix: null link, null row, suspended, stale, ok); `analytics.test.ts` (`/altinha-paris/espace` and `/x/espace/y` untracked, `/mon-espace` untracked, `mon-espace` reserved, `/espace` and `/x/espacex` tracked). DB — `guest-access.db.test.ts` (`findGuestCustomer` with the suspension flag; `customerFromGuestCookie`: valid → id, another pro → null, after `revokeLinks` → null, tampered → null; `customerFromVerifiedEmail` normalises case); `customer-space.db.test.ts` (confirmed future bookings only, wallet expiries, archived type flagged, another pro → null).
- Browser: produce a mock e-mail with a personal link (« Offrir » with notify on Beatriz, Task 35 UI); signed in as the pro, open `http://localhost:3102/api/c/<token>` → « Aucun ticket chez Altinha Paris pour pro@skedul.app. » (the session wins); sign out and open it again → `/altinha-paris/espace` lists Beatriz's upcoming bookings and tickets; « Déconnecter ses liens » on her record, reopen the old link → « Ce lien n'est plus valide. ». A fresh tab without cookie on `/altinha-paris/espace` → « Ouvrez le lien personnel reçu par email pour voir vos réservations. ».
- Commit: `feat(espace): personal link route and read-only client space`.

**Task 42: Calendar file (ICS) on the occurrence** (G6)
- Files: § 3.6 rows of Task 42.
- Depends on: 4. Interfaces: § 4.23.
- Tests (DB) — `ics.db.test.ts`: confirmed booking on a scheduled séance → event title and effective location; RDV → type name; cancelled booking → null; cancelled occurrence → null; unknown id → null.
- Browser: from a mock « Inscription confirmée » e-mail, open `/api/bookings/<id>/calendar.ics` → a `text/calendar` response with `SUMMARY:` and `LOCATION:`; after unenrolling that booking the same URL → 404.
- Commit: `feat(ics): calendar file rebuilt on the occurrence`.

**Task 43: Final sweep** (G6)
- Files: whatever the checks below require (no new feature); M `src/lib/series-plan.ts`, `src/lib/series-plan.test.ts`, `src/lib/booking/series.ts` (type rename), `src/lib/booking/wallet.ts` (JSDoc).
- Depends on: 1–42.
- Steps: tsc; eslint on every file changed since the P3 base (`git diff --name-only <Task 1 merge>..HEAD -- '*.ts' '*.tsx'`); pure suite; full DB suite; build. Greps that must return nothing in `src/` (outside tests and P4/P5 code): `COMING_SOON`, `ComingSoon` in `src/app/dashboard`, `session-detail-dialog`, `manual-booking-form`, `paymentType`, `packName`, `Prestations`, `saveAvailability(`, `getProBookings`. Orphan check: `planning.ts`, `calendar-links.ts`, `calendar-sync-core.ts`, `week-preview`, `planning-calendar`, `mergeMoney` each have a runtime importer; `availability.ts` and `mock-redirect.ts` stay for P4 / P5 (note it). Browser tour of every § 6 route at 1280 px and 375 px, console clean, no horizontal page scroll. Optional reset of tickets-dev: `pwd` check, then `./node_modules/.bin/tsx scripts/seed.ts --wipe`. Two P2 minors on code P3 touched: rename the pure planner type `SeriesEditInput` of `src/lib/series-plan.ts` to `SeriesPlanInput` (and its importers; `series.ts` keeps its own `SeriesEditInput`, OUT L124), and make the `offerTickets` JSDoc point to `expiryFromLastDay(lastDay, tz)` for `expiresAt` (OUT carry Task 19).
- Commit: `chore(p3): final sweep`.

---

## 9. Test strategy

### 9.1 Pure tests (`*.test.ts`, no DB, no env)
- Every pure module of § 4 has a test file next to it: `zod-fr`, `pro-messages`, `tickets` (vocab), `format`, `emails/client-emails`, `guest-link`, `calendar-links`, `google-event`, `calendar-sync` (core with fake deps), `notify-core` (dedupe), `result`, `ui-copy`, `timezones`, `notice`, `confirm-copy`, `recurrence-form`, `event-defaults`, `planning-view`, `wallet-view`, `history`, `client-filters`, `dashboard-view`, `guest-access` (decision), `analytics`.
- Time-zone discipline: every pure test that formats or converts a date runs it for `Europe/Paris` AND `America/Los_Angeles` (explicit `tz` argument), and includes one DST day (2026-03-29 / 2026-10-25 for Paris, 2026-03-08 / 2026-11-01 for LA). The host zone never matters.
- Copy discipline: tests compare exact French strings from this contract (copy them, do not paraphrase) and assert the absence of U+2014 / U+2013.

### 9.2 DB tests (`*.db.test.ts`, tickets-test via `.env.test`)
- Harness (`src/test/db.ts`): `dbTest(name, async ({ db, pro }) => …)` creates a fresh pro (Europe/Paris, eur), checks `checkInvariants(db, { proId })` = [] after the test, deletes the user; `createTestPro(db, { tz })` for a second pro (cross-tenant cases, LA pro), always deleted in `finally` with `deleteTestUser(db, other.userId)` (and checked with `checkInvariants(db, { proId: other.proId })` when the test wrote bookings or tickets for it); `inParallel`, `addMinutes`, `addDaysMs`, `testEmail(tag)`.
- Fixtures (`src/test/fixtures.ts`): `dayIn`, `makeType`, `makeOffer`, `makeEvent` (once at dayIn(3) 10:00 unless overridden), `makeCustomer`, `giveTickets`, `occurrencesOf`, `getOccurrence`, `getBooking`, `ticketsOf`, `movementsOf`. Row helpers (`src/test/rows.ts`) for states the engine cannot reach quickly (old pending booking, stale `generated_until`): `rowEvent`, `rowSeance`, `rowRdv`, `rowPurchase`, `rowBooking`, `rowTicket`, `rowMovement`. Paid purchases: `startPurchase` + `fulfillPurchase` (engine). New helper `proCtx(pro)` (`src/test/pro-ctx.ts`) builds the `ProCtx` of a test pro.
- What is DB-tested: every core (`*-actions.ts`) and every read (`*-reads.ts`, `notify-core`, `calendar-sync-load`, `customer-space`, `guest-access`, `ics`, `admin-reads`), plus the engine changes (Tasks 7, 9, 23). Each file has at least one cross-tenant case and asserts French messages verbatim. Platform-wide admin counts assert deltas.
- Running: implementers run their own DB files (one-file command); group ends and Task 43 run the whole suite in one process (Global Constraints). Expected tail: `ℹ fail 0`.

### 9.3 Browser checks (no component test framework; ruling 14)
- Server: `preview_start` with name `skedul-tickets` (port 3102, launch entry from Task 1); if it is already running, reuse it. Sign in at `http://localhost:3102/sign-in` with the « Pro · back-office » one-click demo login (seed v2 pro `pro@skedul.app`, page `altinha-paris`; the password is the demo one documented in AGENTS.md and is never typed into chat, commits or UI). Admin checks use « Admin · espace Skedul ».
- Data: seed v2 on tickets-dev (types « Cours collectif », « Cours d'essai », « Cours particulier », « Appel découverte », archived « Stage d'été 2026 », « Cours en plein air »; events « Altinha débutants », « Altinha intermédiaires », « Roda libre », « Atelier technique », « Équipe compétition » (privé); clients Beatriz Almeida, Rafael Souza (🔴), Thomas Leroy (🟠), Léa Martin, Marina Costa; a « Vacances » time off ≈ 3 weeks ahead). Dates are relative to the seed run: steps name objects, never fixed dates. Objects created by a check are named « Test P3… » and removed by the same check when it says so.
- Phrasing (every UI task ends with this block):
  ```
  - [ ] **Step N: Browser check** (dev server `skedul-tickets`, signed in with « Pro · back-office »)
    1. Open http://localhost:3102/<route>. Expect: <exact visible copy and data>.
    2. Do: <interaction>. Expect: <result, exact copy>; dev log: <mock e-mails, if any>.
    3. Repeat the action on the same object (fresh seen tokens). Expect: success again.
    4. Resize to 375×812 (`resize_window` preset mobile), reload. Expect: <mobile layout>, no horizontal page scroll.
    5. `read_console_messages` (onlyErrors) → empty. Reset the viewport (`resize_window` preset desktop).
  ```
- Mock e-mails: read the dev-server output (`preview_logs` with `search: "[email:mock]"`); count one line per expected recipient.

---

## Appendix: P3 planning rulings (controller, 2026-10-14)

The spec (docs/superpowers/specs/2026-10-12-tickets-evenements-design.md) is binding. These rulings settle what it leaves open. They resolve the open ambiguities Q1–Q35 listed at the end of map-spec.md: every recommended decision there is ACCEPTED, with the amendments below.

- Q27 (history line): no em dash or en dash in any UI string. Format: `JJ/MM HH:mm · {acteur} · {libellé} {n} {type}[ → {type B}][ ({motif ou note})][ · {séance}]`. At most one middle dot between two fields; the arrow is allowed.
- Q28 (alerts): 🔴 / 🟠 are SEMANTIC states, rendered as a small coloured status mark (lucide icon or 8 px rounded mark) with visible text or an `aria-label` + `title` (« Tickets d'un type archivé », « Type lié à aucun événement à venir »). No emoji in the UI.
- Q17/Q18 and all engine error codes: one pro-facing French message map in ONE module (decide which: extend src/lib/tickets.ts or add src/lib/pro-messages.ts), used by every P3 action; no English zod message ever reaches the UI (carry note Task 17): build zod error maps / French messages for the schemas P3 uses.
- Q16 (rdv_free): P3 action-level refusals as recommended, with French messages, plus `loadTypeFacts` treating rdv_free as not RDV-enabled for the orange alert (small engine change allowed, test it).
- Q23: the « Confirmez votre adresse » banner is in P3 (dashboard layout), using the emailOTP verify flow already wired (authClient.emailOtp.sendVerificationOtp + verifyEmail), with the OTP code entry in a small dialog.
- Q33: on Google disconnect, clear `occurrence.google_event_id` for the pro.
- Timezone: replace the invalid `Europe/Geneva` with `Europe/Zurich`, validate the zone server-side (Intl), and lock it once the pro has séances (`timezone_locked`, French message), locking the professional row in the same batch (carry note Task 18).
- Tenancy/security (carry notes): every P3 action derives `professionalId` and `actorUserId` from the session (`requirePro()`), never from input; every id in an input is checked against that pro by the engine (already) or by the query; `/api/c` compares `linkVersion` with `customer.link_version` AND checks the customer belongs to the pro of `<slug>`; `releasePurchase` is P4.
- Testability: Next server modules that import `server-only` or `next/headers` cannot be loaded by tsx tests. Put every read query and every action body in a testable module that takes `(db, pro, input, now)` (no `server-only`, no `next/*` import), DB-tested with the existing harness (src/test/db.ts, src/test/fixtures.ts); the `"use server"` files and the `server-only` query files are thin wrappers (auth + revalidate + notify). Pure view-model logic (formatting, grouping, alert classification, filters, recurrence preview text, DST notes) lives in pure modules with pure tests.
- UI verification: there is no component test framework and none is added. Each UI task ends with tsc + eslint + build green AND a browser check of the page against the seeded demo data on tickets-dev (seed v2: pro@skedul.app, page altinha-paris), through a dev server on port 3102 started from the main checkout with `pnpm -C .claude/worktrees/tickets --config.verify-deps-before-run=false dev --port 3102` (add a `skedul-tickets` entry to the MAIN checkout's .claude/launch.json, never edit other entries). Steps list the exact URL, what must be visible, and the interaction to try.
- Design rules for every UI string and component (from the design-taste review, adapted to an existing back-office): keep the existing visual system (src/components/ui primitives, globals.css tokens, lucide-react icons, existing radius/spacing scale); no new UI dependency; Server Components by default, client leaves only for interaction; label above input, helper/error below, never placeholder-as-label; every page and dialog has loading (skeleton via loading.tsx or inline), empty (spec § 13.9 copy + CTA) and error states; destructive actions open a confirmation that states consequences (spec § 13.9, Q35 texts); WCAG AA contrast; mobile < 640 px per spec § 13.9 (planning day view, client record stacked); ZERO em/en dashes in UI strings; French with vouvoiement; one label per intent; buttons never wrap at desktop.
- Effects: every engine call's `effects` are executed after commit by `src/server/notify.ts` (exhaustive switch). P3 implements: booking_confirmed (pro registration), booking_cancelled, occurrence_cancelled, occurrence_changed, attendee_moved, tickets_offered (when the pro ticks « Prévenir le client »), google.sync_occurrence, stripe.expire_session (best effort `expireCheckoutSession`, no-op when Stripe is off). P4 effects (pro_new_booking, pro_booking_cancelled, purchase_receipt, late_payment) log a warning and do nothing until P4. A failing effect never fails the action (logged, without addresses/codes).
- Out of scope for P3 (P4/P5/P6): public planning/boutique/offer/séance pages, checkout/webhooks/mock checkout, nightly cron route, OTP dialog for clients, /mon-espace, cancel/spend from /[slug]/espace, RDV slot booking UI, demo/landing/FAQ/README/AGENTS rewrite.

