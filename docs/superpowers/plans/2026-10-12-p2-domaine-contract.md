> **Erratum (2026-10-12, after review).** The plan tasks supersede this contract where they differ. Known contract errors, already corrected in the tasks:
> - §5.8 / §5.23: `throttle.ts` (Task 13) and `src/test/db.ts` (Task 6) cannot import `Db` from `@/lib/db/atomic`, which only exists from Task 14. They declare a local `NeonHttpDatabase<typeof schema>` type.
> - §6 E4: the « buy » path also locks the customer (after the RDV occurrences), and `activeBookingOf` takes `now`.
> - §5.19 / §5.20 (E6c guard and `editSeriesFrom`):
>   - both id arrays are sorted in SQL (collation);
>   - an in-place edit keeps a planned-row-count guard;
>   - the old segment ends at `min(d − 1, lastSeriesDate(oldRule))`, and a once or count segment is never rewritten to `until`.
> - §5.22: `/send-verification-email` is also closed or capped, and `hooks.before` short-circuits `type: "forget-password"` on `/email-otp/send-verification-otp`.
> - §8 row 34: 6 offers, not 7.
> - `hasDomainData` counts `time_off`. `bootstrapCatalog` uses `hasCatalogOrClients` instead (Task 34).
> - §1 « Applying migrations »: the `→ <host>` line comes after dotenv's « injected env » line, and a `DATABASE_URL` already in the environment wins over `.env.local`.

# P2 Contract: Domaine (tickets & événements)

Binding for the 6 task-writers. Where this contract and the spec (`docs/superpowers/specs/2026-10-12-tickets-evenements-design.md`) disagree, the spec wins, except for items marked **Decision:**, which settle points the spec leaves open or makes contradictory. The code blocks marked *verified* were typechecked with `tsc` against the repo's `node_modules`. The schema was also run through `drizzle-kit generate` in a scratch copy of `drizzle/` and produced 0010, 0011 and 0012 with no prompt (see §4).

---

## 1. Global Constraints

Put these lines verbatim at the top of the plan.

- **Spec (binding):** `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md`, especially §§ 4, 6, 7, 8, 9, 10 (incl. « Résultat du spike P1 »), 11 (E1–E13), 12, 13.4, 14, 15.1–15.4.
- **Worktree:** `C:/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets`, branch `feat/tickets-events` (contains `main` 7feb70b). `node_modules` is a junction to the main checkout.
- **Never** run `pnpm install` or `pnpm <script>` in the worktree. Always call `./node_modules/.bin/{tsx,tsc,eslint,next,drizzle-kit}` directly.
- **Typecheck:** `./node_modules/.bin/tsc --noEmit`
- **Lint (changed files only):** `./node_modules/.bin/eslint <every file created or modified by the task>`. Expected: no error and no warning.
- **Pure tests:** `./node_modules/.bin/tsx --test 'src/**/!(*.db).test.ts'` (single quotes in Git Bash and PowerShell).
- **DB tests, all:** `./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 'src/**/*.db.test.ts'`
- **DB tests, one file:** `./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 src/lib/booking/claims.db.test.ts`
- **Build:** `./node_modules/.bin/next build`. It needs the worktree's `.env.local`, created in Task 2.
- **Every task ends green:** tsc, eslint on its changed files, all pure tests, all DB tests (once Task 5 is done), and `next build`.
- **Migrations:** generate with `./node_modules/.bin/drizzle-kit generate --name=<name>`, or `--custom --name=tickets_manual` for 0012.
- **Applying migrations:** `./node_modules/.bin/tsx scripts/apply-migration.ts drizzle/<file>.sql`. It reads `.env.local`, which points at **tickets-dev**. The first output line `→ <host>` must equal the tickets-dev host saved in Task 2. If it doesn't, stop.
- **Never** run `db:migrate` or `db:push`. Only P2 migrations 0010–0012 touch tickets-dev; tickets-test is re-created from it.
- **Neon project** `nameless-meadow-98376303`:
  - `development` = `br-bold-art-af8tpfm5`: only the parent of tickets-dev; never write to it.
  - `main` (prod) = `br-misty-thunder-af8c8bd9`: **never touch**.
  - `preview` = `br-autumn-tooth-afnthws9`: never touch in P2.
- **Neon MCP:** always pass `project_id` **and** `branch_id`. These tools fall back to PROD when `branch_id` is omitted. Never print a connection string.
- **Working branches:**
  - `tickets-dev` = child of `development` (Task 2). `.env.local` points at it.
  - `tickets-test` = child of `tickets-dev`, created after 0012 (Task 5). `.env.test` points at it.
- **Package is CommonJS:** scripts use `async function main()` plus `main().catch(...)`; no top-level await.
- **Files:** Windows, CRLF working copies (autocrlf). Write whole files with the Write tool and partial changes with Edit. Never use bash heredocs for files that contain an apostrophe (known parse trap).
- **Engine location:** `src/lib/booking/*` and `src/lib/db/atomic.ts`. They never import `server-only`, `@/lib/db` (index), `@/lib/env`, `next/*` or `@/lib/email`.
  - `db: Db` is the first parameter.
  - `now: Date = new Date()` is the last positional parameter (before an optional test-only `opts`).
  - `now` reaches SQL as a parameter (`ts(now)`), **never** as SQL `now()`. Every inserted or updated `created_at`, `updated_at`, `status_changed_at`, `ended_at`, `paid_at`, `confirmed_at` and `cancelled_at` comes from `now`.
- **Every multi-row write is one `tryAtomic(db, plan, opts)`** (§5 atomic.ts):
  - `plan()` does the reads, generates the ids (nanoid) and returns `(aid) => Query[]`.
  - Lock first, in the global order: professional → event → occurrence (id asc) → customer → booking → purchase → ticket.
  - Every guarded UPDATE is followed by `G(pred, code)`.
  - Guards target rows known by JS id or marked by `aid` (`booking.ended_action_id`, `ticket_purchase.fulfilled_action_id`, `event.last_action_id`, `ticket_movement.action_id`). Never "rows already in the target state".
- **SQL binding rules (from the spike):**
  - Dates: `ts(d)` (`::timestamptz`).
  - Id lists: `textArray(ids)` (`= any(${sql.param(ids)}::text[])`); never a bare JS array.
  - `tsArray`, `dateArray`; ints used in arithmetic: `${n}::int`.
  - Enum literals compared or inserted from parameters: `${v}::booking_mode` etc.
  - `count(*)::int`.
- **Raw `db.execute` rows return timestamps and dates as strings, and `count(*)` without a cast as a string.** Convert with `new Date()` / `Number()`. Prefer builder selects (Date-mapped) for plan reads and builder inserts for single-row inserts. Use raw SQL for CTEs, guards and set-based updates.
- **Engine results** are `EngineResult<T> = { ok: true; effects: Effect[] } & T | { ok: false; code: EngineErrorCode; message?: string }`.
  - The engine never throws for business outcomes. It rethrows unknown DB errors (programming errors).
  - It never sends e-mail and never calls Stripe or Google: it returns `Effect` descriptors (§5 types.ts).
- **Not in P2:**
  - UI beyond the `ComingSoon` placeholders, server actions for the new flows, `notify.ts`, Stripe calls, the Google sync rewrite.
  - Throttle and honeypot checks inside the engine. The P4 actions call `checkActionThrottle` before the engine.
- **Language:** code, comments and plan prose in English. User-facing strings in French, vouvoiement, **no em dash `—`** in UI strings (use « : » or a period).
- **Commit format:** `git add <files>` then `git commit -m "<type>(<scope>): <summary>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- **Test file naming:**
  - Pure tests: `*.test.ts`.
  - DB tests: `*.db.test.ts`.
  - Helpers in `src/test/` are never named `*.test.ts`, except the pure `src/test/db-guard.test.ts`.
- **No new dependencies.** zod v4 (`z.email()`, `z.iso.date()`), better-auth 1.6.19, drizzle-orm 0.45.2 and @date-fns/tz are already installed.
- **tsconfig target is ES2017:** no regex `s` flag and no named capture groups.
- **`src/lib/db/schema.ts` and `src/lib/tickets.ts` import only relative paths and npm packages** (drizzle-kit cannot resolve `@/`). `tickets.ts` imports only `zod`.
- **Do not modify** `scripts/spike/*` (they keep compiling; they only use the auth tables).
- **Next.js 16:** `params` and `searchParams` are async. Read `node_modules/next/dist/docs/` before touching a page. A page that redirects must `await params` first (static-redirect prerender trap).

---

## 2. Review Focus

These are the five classes of input and failure most likely to bite. Reviewers check them first.

| # | Failure mode | Why it bites | Owning task(s) / proof |
|---|---|---|---|
| 1 | **Seat and ticket accounting under concurrency.** Over-selling, double spend, double return, a seat counter that drifts. | `SEAT` must run once per occurrence per action, after every booking end in that batch. `rel(o)` is evaluated inside SEAT. `RET` runs once per action. `releaseEndedSeats` must never be combined with SEAT on the same occurrence. Picks use SKIP LOCKED plus UNIQUE `booking_id`. A 0-row guarded UPDATE does not abort a batch unless G follows. | Task 14 (fragments), Task 23 (T1, T2), Task 25 (T3, T7), Task 15 (I1, I2, I4 after every DB test) |
| 2 | **Civil time and DST.** | Expander jumps (never/until), count walking from `start_date`. 31st skipped, nth and last weekday. `until` inclusive. Paris 2026-03-29 (02:30 → 01:30Z) and 2026-10-25 (02:30 → 00:30Z). Month-end clamping in expiry. "Local today" computed the same way in JS (`booking-window.ts`) and SQL (`at time zone p.timezone`). | Tasks 7, 8, 10, 18 (horizon boundaries) |
| 3 | **Series split against concurrent writers.** | Version guard. Reparented-row-count guard (catches rows `ensureHorizon` inserted after the plan read). Guards on delete and cancelEmpty (catch a booking taken after the plan read). `until_date = d − 1` vs CHECK. Phantom rows from `ensureHorizon`. Re-plan once on stale. | Task 9 (planner), Task 28 (T8 a and b via the `afterPlan` hook) |
| 4 | **Payment lifecycle.** | Duplicate delivery must be a no-op (`already_paid`). Paid from `expired` still gives tickets. A booking is never resurrected. Hold expiry followed by a late payment. `processing_at`. Hold quota. `attachCheckoutSession` on a non-pending purchase. | Task 20 (E1), Task 21 (T4, T14), Task 22 (T5) |
| 5 | **Identity and deletion.** | The pre-account takeover purge must keep the new session. The per-e-mail code cap must not burn the live code. `disabledPaths` derived from the plugin. R2 (every domain table cascades **directly** from `professional`) with NO ACTION FKs inside the domain. | Task 4 (FK review), Task 30 (T11), Task 32 (disabledPaths test), Task 33 (T12, T13, T15) |

---

## 3. File map

C = create, M = modify, D = delete.

| Op | Path | Responsibility | Task |
|---|---|---|---|
| C | `src/lib/tickets.ts` | Enum value arrays (pgEnum sources), FR labels, bounds and constants, `EngineErrorCode` + messages, zod schemas, helpers | 1 |
| C | `src/lib/tickets.test.ts` | Pure: enums match spec § 6.2, constants (`365 + 30 < MATERIALIZE_DAYS`), labels, zod accept/reject, no em dash | 1 |
| C | `src/components/coming-soon.tsx` | `ComingSoon` placeholder card for pages rebuilt in P3–P5 | 2 |
| M | `src/lib/admin-params.ts` | Status types and labels from `tickets.ts`; `COVERAGE_LABELS` replaces `PAYMENT_TYPE_LABELS` | 2 |
| M | `src/server/queries.ts` | Keep profile, time off, Google, availability (stub); drop domain readers | 2 (stub), 4 (availability restored) |
| M | `src/server/pro.ts` | Keep profile, branding, time off, Google; stub the session/booking actions; drop event-type/pack/question actions | 2, 4 |
| M | `src/server/admin-queries.ts` | Domain-free stubs (same shapes); remove `listRecent*` and `ACTIVITY_LIMIT` | 2 |
| M | `src/app/[slug]/page.tsx` | PublicShell + bio + `ComingSoon` | 2 |
| M | `src/app/[slug]/book/[eventTypeId]/page.tsx` | `redirect(\`/${slug}\`)` after `await params` | 2 |
| M | `src/app/[slug]/pack/[packId]/page.tsx` | same redirect | 2 |
| M | `src/app/[slug]/merci/page.tsx` | Generic thanks card, no DB detail | 2 |
| M | `src/app/dashboard/page.tsx` | Header + public link card + `ComingSoon` | 2 |
| M | `src/app/dashboard/{planning,clients,payments,event-types,packs}/page.tsx` | `PageHeader` + `ComingSoon` | 2 |
| M | `src/app/admin/activity/page.tsx` | `requireAdmin` + `PageHeader` + `ComingSoon` | 2 |
| M | `src/app/api/bookings/[id]/calendar.ics/route.ts` | Always 404 (P3 rewrites) | 2 |
| M | `src/app/api/mock-checkout/route.ts` | Always 404 (P4 rewrites) | 2 |
| M | `src/app/api/stripe/webhook/route.ts` | Verify signature, log, 200; no DB (P4 rewrites) | 2 |
| M | `scripts/seed.ts` | Placeholder that exits 1 (Task 2); seed v2 (Task 35) | 2, 35 |
| D | `src/lib/sessions.ts`, `src/lib/sessions.test.ts`, `src/lib/payments.ts`, `src/lib/slots.ts`, `src/lib/calendar-sync.ts`, `src/server/booking-core.ts`, `src/server/public.ts` | Read or write the dropped tables; no consumer left | 2 |
| D | `src/components/public/{booking-flow,buy-pack-form,credit-lookup}.tsx`, `src/components/dashboard/{event-types-manager,packs-manager}.tsx` | Only used by neutralised pages (spec 13.5 deletes or replaces them) | 2 |
| D | `scripts/backfill-sessions.ts` | Spec § 6.1 | 2 |
| M | `src/lib/db/schema.ts` | 0010: drop 9 tables + 3 enums. 0011: new domain, professional columns, throttle, rate_limit, relations | 3, 4 |
| C | `drizzle/0010_domain_drop.sql` + `drizzle/meta/0010_snapshot.json`; M `drizzle/meta/_journal.json` | Generated | 3 |
| C | `drizzle/0011_tickets_schema.sql` + snapshot; M journal | Generated | 4 |
| C | `drizzle/0012_tickets_manual.sql` + snapshot; M journal | Custom: btree_gist, `occurrence_rdv_excl`, `skedul_assert` | 5 |
| M | `package.json` | Remove `db:push` (5); `test` glob + `test:db` (6); `db:bootstrap` (34) | 5, 6, 34 |
| C | `src/test/db.ts` | DB harness: guards, `getTestDb`, `createTestPro`, `deleteTestUser`, `dbTest`, `inParallel`, clock and e-mail/IP helpers | 6 (15 wires invariants) |
| C | `src/test/db-guard.test.ts` | Pure: `sameHost`, `DB_SKIP` message | 6 |
| C | `src/test/harness.db.test.ts` | Schema smoke: btree_gist, EXCLUDE, `skedul_assert`, R2 cascade of an empty pro | 6 |
| M | `.env.example` | Comment block for `.env.test` (6), `SEED_ALLOWED_HOSTS` (35) | 6, 35 |
| C | `src/lib/civil-date.ts` + `.test.ts` | Civil date arithmetic | 7 |
| C | `src/lib/recurrence.ts` + `.test.ts` | Expander, counts, labels, DST notes | 8 |
| C | `src/lib/series-plan.ts` + `.test.ts` | `planSeriesEdit`, `describeSeriesEdit` | 9 |
| C | `src/lib/ticket-expiry.ts`, `src/lib/booking-window.ts`, `src/lib/cancellation.ts` + tests | Expiry; online window and availability fit; client cancellation rule | 10 |
| C | `src/lib/guest-link.ts`, `src/lib/lanes.ts` + tests | Personal-link HMAC token; side-by-side lanes | 11 |
| C | `src/lib/wallet-rules.ts` + `.test.ts` | `classifyTypes`, alerts, usable predicate, consumption order | 12 |
| C | `src/lib/throttle.ts`, `src/lib/throttle.test.ts`, `src/lib/throttle.db.test.ts` | Fixed-window throttle (pure twin + DB upsert), health counters | 13 |
| M | `src/lib/visitor-hash.ts` + `.test.ts` | Add `ipHash(salt, ip)` | 13 |
| C | `src/lib/db/atomic.ts`, `src/lib/db/atomic.db.test.ts` | `atomic`, `tryAtomic`, `PlanError`, `G`, binders, `lockRows`, `R`, `rel`, `SEAT`, `RET`, `releaseEndedSeats` | 14 |
| C | `src/lib/db/map-db-error.ts` + `.test.ts` | Postgres error → engine outcome | 14 |
| C | `src/lib/booking/invariants.ts`, `src/lib/booking/revenue.ts`, `src/lib/booking/invariants.db.test.ts` | I1–I6; `paidPurchaseOf` | 15 |
| M | `src/test/db.ts` | `dbTest` asserts `checkInvariants({ proId }) == []` | 15 |
| C | `src/lib/booking/types.ts` | `Effect`, `EngineResult`, helpers | 16 |
| C | `src/lib/booking/answers.ts` + `answers.test.ts` | `loadQuestions`, `buildAnswers` (moved), `insertAnswers` | 16 |
| C | `src/lib/booking/eligibility.ts`, `src/lib/booking/holds.ts`, `src/lib/booking/eligibility.db.test.ts`, `src/lib/booking/holds.test.ts` | Eligibility fragment and spend; hold fragments and helpers | 16 |
| C | `src/lib/booking/catalog.ts` + `catalog.db.test.ts` | Types, offers, RDV hours and questions, settings | 17 |
| C | `src/lib/booking/occurrences.ts` + `occurrences.db.test.ts` | `createEvent`, `ensureHorizon`, horizon helpers | 18 |
| C | `src/lib/booking/wallet.ts` (part 1), `src/lib/booking/wallet-customers.db.test.ts`, `src/test/fixtures.ts` | Customers, Offrir, balance; shared fixtures | 19 |
| C | `src/lib/booking/claims.ts` (E1 part), `src/lib/booking/claims-buy.db.test.ts` | `startBuyAndBook`, `attachCheckoutSession`, `activeBookingOf` | 20 |
| C | `src/lib/booking/fulfillment.ts` + `fulfillment.db.test.ts` | E9, E10, `markProcessing` (T4, T14) | 21 |
| C | `src/lib/booking/release.ts` + `release.db.test.ts` | E11, sweep, stale purchases (T5) | 22 |
| M | `src/lib/booking/claims.ts`; C `src/lib/booking/claims.db.test.ts` | E2, E3 (T1, T2) | 23 |
| M | `src/lib/booking/claims.ts`; C `src/lib/booking/rdv.db.test.ts` | E4 `bookRdv` (T6 a and b) | 24 |
| C | `src/lib/booking/cancel.ts` (E5/E6a/E6b/rétablir + builders) + `cancel.db.test.ts` | T3, T7 | 25 |
| M | `src/lib/booking/cancel.ts`; C `src/lib/booking/time-off.db.test.ts` | E6c (T6c, T10) | 26 |
| C | `src/lib/booking/series.ts` (this séance + editor) + `series-occurrence.db.test.ts` | E7 part 1 | 27 |
| M | `src/lib/booking/series.ts`; C `src/lib/booking/series-split.db.test.ts` | E7 following and delete-from (T8) | 28 |
| M | `src/lib/booking/wallet.ts` (part 2); C `src/lib/booking/wallet.db.test.ts` | E8 actions + move (T9) | 29 |
| C | `src/lib/booking/nightly.ts`, `src/lib/booking/account.ts`, `src/lib/booking/nightly.db.test.ts`, `src/lib/booking/delete-user.db.test.ts` | E12, E13 (T11) | 30 |
| C | `src/lib/emails/{login-code,verify-email-code,password-disabled,password-reset}.ts`, `src/lib/emails/auth-emails.test.ts` | Auth e-mails | 31 |
| M | `src/lib/email.ts` | Re-export `passwordResetEmail` from `emails/password-reset` | 31 |
| C | `src/lib/auth-options.ts`, `src/lib/auth-options.test.ts` | `buildAuthOptions`, derived `disabledPaths`, rate limits | 32 |
| M | `src/lib/auth.ts`, `src/lib/auth-client.ts` | Rewired on `buildAuthOptions` + `nextCookies`; `emailOTPClient()` | 32 |
| C | `src/test/auth.ts`, `src/lib/auth.db.test.ts` | Auth test instance and browser; T12, T13, T15 | 33 |
| C | `scripts/content/altinha.ts`, `scripts/content/apply-catalog.ts`, `scripts/bootstrap-content.ts` | Shared catalog content; catalog-only bootstrap | 34 |
| M | `scripts/seed.ts` | Seed v2 through the engine with an injected clock | 35 |

No barrel file (`src/lib/booking/index.ts`). Callers import from each module.

---

## 4. Schema

### 4.1 What 0010 removes (Task 3)

From `src/lib/db/schema.ts`:

- **Tables:** `eventType`, `classSession`, `availabilityRule`, `pack`, `customer`, `packPurchase`, `booking`, `question`, `bookingAnswer`.
- **Enums:** `bookingStatus`, `paymentType`, `purchaseStatus`.
- **Relations:** `eventTypeRelations`, `availabilityRuleRelations`, `packRelations`, `customerRelations`, `packPurchaseRelations`, `bookingRelations`, `classSessionRelations`, `questionRelations`, `bookingAnswerRelations`.
- In `professionalRelations`, keep only `user` and `timeOff`.
- Remove the now-unused `unique` import.
- Keep `questionType` (still `pgEnum("question_type", ["text","choice","boolean"])` in 0010) and `userRole`.

`./node_modules/.bin/drizzle-kit generate --name=domain_drop` then produces exactly this (verified):

```sql
DROP TABLE "availability_rule" CASCADE;--> statement-breakpoint
DROP TABLE "booking" CASCADE;--> statement-breakpoint
DROP TABLE "booking_answer" CASCADE;--> statement-breakpoint
DROP TABLE "class_session" CASCADE;--> statement-breakpoint
DROP TABLE "customer" CASCADE;--> statement-breakpoint
DROP TABLE "event_type" CASCADE;--> statement-breakpoint
DROP TABLE "pack" CASCADE;--> statement-breakpoint
DROP TABLE "pack_purchase" CASCADE;--> statement-breakpoint
DROP TABLE "question" CASCADE;--> statement-breakpoint
DROP TYPE "public"."booking_status";--> statement-breakpoint
DROP TYPE "public"."payment_type";--> statement-breakpoint
DROP TYPE "public"."purchase_status";
```

### 4.2 New `schema.ts` (Task 4), verified

**Header** (replaces the import block; `id()` and `timestamps` are unchanged):

```ts
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import {
  SUPPORT_AUTHOR_ROLES,
  SUPPORT_MESSAGE_KINDS,
  SUPPORT_RESOLUTIONS,
  SUPPORT_STAGES,
  SUPPORT_TRACKS,
  SUPPORT_TYPES,
} from "../support";
import {
  ACTORS,
  BOOKING_COVERAGES,
  BOOKING_MODES,
  BOOKING_STATUSES,
  DEFAULT_COLOR,
  MONTHLY_BY,
  MOVEMENT_KINDS,
  OCCURRENCE_STATUSES,
  PURCHASE_STATUSES,
  QUESTION_TYPES,
  RECURRENCE_ENDS,
  RECURRENCE_FREQS,
  TICKET_CLOSE_REASONS,
  TICKET_STATUSES,
  VALIDITY_UNITS,
} from "../tickets";
```

**Enums** (replace the enum block; the support enums are unchanged):

```ts
export const userRole = pgEnum("user_role", ["client", "pro", "admin"]);
export const questionType = pgEnum("question_type", QUESTION_TYPES);
export const bookingMode = pgEnum("booking_mode", BOOKING_MODES);
export const recurrenceFreq = pgEnum("recurrence_freq", RECURRENCE_FREQS);
export const monthlyBy = pgEnum("monthly_by", MONTHLY_BY);
export const recurrenceEnd = pgEnum("recurrence_end", RECURRENCE_ENDS);
export const validityUnit = pgEnum("validity_unit", VALIDITY_UNITS);
export const occurrenceStatus = pgEnum("occurrence_status", OCCURRENCE_STATUSES);
export const bookingStatus = pgEnum("booking_status", BOOKING_STATUSES);
export const bookingCoverage = pgEnum("booking_coverage", BOOKING_COVERAGES);
export const actor = pgEnum("actor", ACTORS);
export const purchaseStatus = pgEnum("purchase_status", PURCHASE_STATUSES);
export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const ticketCloseReason = pgEnum("ticket_close_reason", TICKET_CLOSE_REASONS);
export const movementKind = pgEnum("movement_kind", MOVEMENT_KINDS);
// supportType … supportMessageKind unchanged
```

**`professional`:** add these columns before `...timestamps` and replace the extra-config array:

```ts
    // booking settings (spec § 2.13); events and RDV types may override each
    bookingHorizonDays: integer("booking_horizon_days").default(60).notNull(),
    minNoticeMinutes: integer("min_notice_minutes").default(60).notNull(),
    cancelDeadlineHours: integer("cancel_deadline_hours").default(24).notNull(),
    ...timestamps,
  },
  (t) => [
    index("professional_slug_idx").on(t.slug),
    check("professional_horizon_chk", sql`booking_horizon_days BETWEEN 1 AND 365`),
    check("professional_notice_chk", sql`min_notice_minutes BETWEEN 0 AND 10080`),
    check("professional_cancel_chk", sql`cancel_deadline_hours BETWEEN 0 AND 720`),
  ],
);

/** `professional_id → professional ON DELETE CASCADE`, on every domain table (R2). */
const proRef = () =>
  text("professional_id")
    .notNull()
    .references(() => professional.id, { onDelete: "cascade" });
```

**Domain tables** go right after `timeOff`, before `pageView`:

```ts
/* ─────────────────────── Tickets & événements ─────────────────────
 * Spec § 6. FK rules: every table cascades DIRECTLY from professional (R2,
 * required for deleteUser); references inside the domain are NO ACTION (R3,
 * drizzle's default) except parent → child compositions, which cascade;
 * references to user and booking_answer → question are SET NULL (R4).
 * Every CHECK is named: mapDbError (src/lib/db/map-db-error.ts) reads names.
 * CHECK bodies are literal SQL (no ${} params) so drizzle-kit writes them as-is.
 */

/** What an event accepts; may be bookable as an RDV libre. */
export const ticketType = pgTable(
  "ticket_type",
  {
    id: id(),
    professionalId: proRef(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").default(DEFAULT_COLOR).notNull(),
    position: integer("position").default(0).notNull(),
    rdvEnabled: boolean("rdv_enabled").default(false).notNull(),
    rdvFree: boolean("rdv_free").default(false).notNull(),
    rdvDurationMin: integer("rdv_duration_min"),
    rdvBufferBeforeMin: integer("rdv_buffer_before_min").default(0).notNull(),
    rdvBufferAfterMin: integer("rdv_buffer_after_min").default(0).notNull(),
    rdvBookingHorizonDays: integer("rdv_booking_horizon_days"),
    rdvMinNoticeMinutes: integer("rdv_min_notice_minutes"),
    rdvCancelDeadlineHours: integer("rdv_cancel_deadline_hours"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ticket_type_pro_idx").on(t.professionalId),
    check(
      "ticket_type_rdv_chk",
      sql`NOT rdv_enabled OR (rdv_duration_min IS NOT NULL AND rdv_duration_min BETWEEN 5 AND 480 AND rdv_duration_min % 5 = 0)`,
    ),
    check("ticket_type_rdv_free_chk", sql`NOT rdv_free OR rdv_enabled`),
    check(
      "ticket_type_buffers_chk",
      sql`rdv_buffer_before_min BETWEEN 0 AND 240 AND rdv_buffer_after_min BETWEEN 0 AND 240`,
    ),
    check(
      "ticket_type_overrides_chk",
      sql`(rdv_booking_horizon_days IS NULL OR rdv_booking_horizon_days BETWEEN 1 AND 365) AND (rdv_min_notice_minutes IS NULL OR rdv_min_notice_minutes BETWEEN 0 AND 10080) AND (rdv_cancel_deadline_hours IS NULL OR rdv_cancel_deadline_hours BETWEEN 0 AND 720)`,
    ),
  ],
);

/** N tickets of one type for a price (« À l'unité », « Carnet de 10 »). */
export const ticketOffer = pgTable(
  "ticket_offer",
  {
    id: id(),
    professionalId: proRef(),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id, { onDelete: "cascade" }),
    label: text("label"),
    quantity: integer("quantity").notNull(),
    priceCents: integer("price_cents").notNull(),
    validityCount: integer("validity_count"),
    validityUnit: validityUnit("validity_unit"),
    isActive: boolean("is_active").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ticket_offer_pro_idx").on(t.professionalId),
    index("ticket_offer_type_idx").on(t.ticketTypeId),
    check("ticket_offer_quantity_chk", sql`quantity BETWEEN 1 AND 100`),
    check("ticket_offer_price_chk", sql`price_cents > 0`),
    check("ticket_offer_validity_chk", sql`(validity_count IS NULL) = (validity_unit IS NULL)`),
    check(
      "ticket_offer_validity_count_chk",
      sql`validity_count IS NULL OR validity_count BETWEEN 1 AND 1000`,
    ),
  ],
);

/** Weekly hours for RDV libre: global (ticket_type_id NULL) or per type (replaces the global ones). */
export const availabilityRule = pgTable(
  "availability_rule",
  {
    id: id(),
    professionalId: proRef(),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id, {
      onDelete: "cascade",
    }),
    // 0 = Sunday … 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    // minutes from local midnight; endMinute is exclusive (1440 = midnight)
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    ...timestamps,
  },
  (t) => [
    index("availability_pro_idx").on(t.professionalId),
    index("availability_ticket_type_idx").on(t.ticketTypeId),
    check("availability_rule_dow_chk", sql`day_of_week BETWEEN 0 AND 6`),
    check(
      "availability_rule_range_chk",
      sql`start_minute >= 0 AND start_minute < end_minute AND end_minute <= 1440`,
    ),
  ],
);

/**
 * A series (one-off or recurring) with its booking mode and accepted types.
 * A « cette séance et les suivantes » edit ends a segment (until_date = d − 1)
 * and starts a new one with the same series_root_id.
 */
export const event = pgTable(
  "event",
  {
    id: id(),
    professionalId: proRef(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    color: text("color").default(DEFAULT_COLOR).notNull(),
    bookingMode: bookingMode("booking_mode").default("tickets").notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    capacity: integer("capacity").notNull(),
    durationMin: integer("duration_min").notNull(),
    // recurrence (spec § 8); dates are local calendar dates in the pro's tz
    startDate: date("start_date", { mode: "string" }).notNull(),
    startMinute: integer("start_minute").notNull(),
    freq: recurrenceFreq("freq").notNull(),
    interval: smallint("interval").default(1).notNull(),
    weekdays: smallint("weekdays").array(),
    monthlyBy: monthlyBy("monthly_by"),
    monthWeek: smallint("month_week"),
    endMode: recurrenceEnd("end_mode").notNull(),
    untilDate: date("until_date", { mode: "string" }),
    occurrenceCount: integer("occurrence_count"),
    // NULL = the pro's setting
    bookingHorizonDays: integer("booking_horizon_days"),
    minNoticeMinutes: integer("min_notice_minutes"),
    cancelDeadlineHours: integer("cancel_deadline_hours"),
    // occurrences exist for every rule date ≤ generated_until
    generatedUntil: date("generated_until", { mode: "string" }).notNull(),
    // lineage, no FK; the engine always sets it (= id on the first segment)
    seriesRootId: text("series_root_id"),
    version: integer("version").default(1).notNull(),
    lastActionId: text("last_action_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("event_pro_idx").on(t.professionalId),
    index("event_series_root_idx").on(t.seriesRootId),
    check("event_capacity_chk", sql`capacity BETWEEN 1 AND 500`),
    check("event_duration_chk", sql`duration_min BETWEEN 5 AND 720 AND duration_min % 5 = 0`),
    check("event_start_minute_chk", sql`start_minute BETWEEN 0 AND 1439`),
    check(
      "event_once_chk",
      sql`freq <> 'once' OR ("interval" = 1 AND end_mode = 'count' AND occurrence_count IS NOT NULL AND occurrence_count = 1 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL AND until_date IS NULL)`,
    ),
    check(
      "event_daily_chk",
      sql`freq <> 'daily' OR ("interval" BETWEEN 1 AND 31 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL)`,
    ),
    check(
      "event_weekly_chk",
      sql`freq <> 'weekly' OR ("interval" BETWEEN 1 AND 52 AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{0,1,2,3,4,5,6}'::smallint[] AND monthly_by IS NULL AND month_week IS NULL)`,
    ),
    check(
      "event_monthly_chk",
      sql`freq <> 'monthly' OR ("interval" BETWEEN 1 AND 12 AND weekdays IS NULL AND monthly_by IS NOT NULL AND ((monthly_by = 'day_of_month' AND month_week IS NULL) OR (monthly_by = 'weekday' AND month_week IS NOT NULL AND month_week IN (1, 2, 3, 4, -1))))`,
    ),
    check(
      "event_end_never_chk",
      sql`end_mode <> 'never' OR (until_date IS NULL AND occurrence_count IS NULL)`,
    ),
    check(
      "event_end_until_chk",
      sql`end_mode <> 'until' OR (until_date IS NOT NULL AND occurrence_count IS NULL AND until_date >= start_date)`,
    ),
    check(
      "event_end_count_chk",
      sql`end_mode <> 'count' OR (occurrence_count IS NOT NULL AND occurrence_count BETWEEN 1 AND 730 AND until_date IS NULL)`,
    ),
    check(
      "event_overrides_chk",
      sql`(booking_horizon_days IS NULL OR booking_horizon_days BETWEEN 1 AND 365) AND (min_notice_minutes IS NULL OR min_notice_minutes BETWEEN 0 AND 10080) AND (cancel_deadline_hours IS NULL OR cancel_deadline_hours BETWEEN 0 AND 720)`,
    ),
  ],
);

/** The ticket types an event in `tickets` mode accepts (read live; empty = nobody). */
export const eventTicketType = pgTable(
  "event_ticket_type",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id, { onDelete: "cascade" }),
    professionalId: proRef(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: "event_ticket_type_pk", columns: [t.eventId, t.ticketTypeId] }),
    index("event_ticket_type_type_idx").on(t.ticketTypeId),
    index("event_ticket_type_pro_idx").on(t.professionalId),
  ],
);

/** A registration question, on an event or on an RDV ticket type. */
export const question = pgTable(
  "question",
  {
    id: id(),
    professionalId: proRef(),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    type: questionType("type").notNull(),
    options: text("options").array(),
    required: boolean("required").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    index("question_pro_idx").on(t.professionalId),
    index("question_event_idx").on(t.eventId),
    index("question_ticket_type_idx").on(t.ticketTypeId),
    check("question_owner_chk", sql`num_nonnulls(event_id, ticket_type_id) = 1`),
  ],
);

/**
 * A séance of an event (event_id set, one per series_date) or a booked RDV
 * libre (event_id NULL, ticket_type_id set, capacity 1). Owns the seat counter.
 * EXCLUDE occurrence_rdv_excl lives in migration 0012 (drizzle-kit cannot express it).
 */
export const occurrence = pgTable(
  "occurrence",
  {
    id: id(),
    professionalId: proRef(),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id),
    seriesDate: date("series_date", { mode: "string" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // RDV: widened by the type's buffers; event séance: equal to starts/ends
    blockStart: timestamp("block_start", { withTimezone: true }).notNull(),
    blockEnd: timestamp("block_end", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").default(0).notNull(),
    status: occurrenceStatus("status").default("scheduled").notNull(),
    locationOverride: text("location_override"),
    timeDetached: boolean("time_detached").default(false).notNull(),
    capacityOverride: boolean("capacity_override").default(false).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    googleEventId: text("google_event_id"),
    ...timestamps,
  },
  (t) => [
    unique("occurrence_event_series_uq").on(t.eventId, t.seriesDate),
    index("occurrence_pro_starts_idx").on(t.professionalId, t.startsAt),
    index("occurrence_ticket_type_idx").on(t.ticketTypeId),
    check("occurrence_kind_chk", sql`num_nonnulls(event_id, ticket_type_id) = 1`),
    check("occurrence_series_date_chk", sql`(event_id IS NULL) = (series_date IS NULL)`),
    check("occurrence_seats_chk", sql`seats_taken BETWEEN 0 AND capacity`),
    check("occurrence_capacity_chk", sql`capacity BETWEEN 1 AND 500`),
    check("occurrence_rdv_capacity_chk", sql`event_id IS NOT NULL OR capacity = 1`),
    check(
      "occurrence_time_chk",
      sql`ends_at > starts_at AND block_start <= starts_at AND block_end >= ends_at`,
    ),
    check(
      "occurrence_cancelled_chk",
      sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`,
    ),
  ],
);

/** A client of one pro, keyed by e-mail; may be linked to a verified account. */
export const customer = pgTable(
  "customer",
  {
    id: id(),
    professionalId: proRef(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    // bumping it revokes every personal link (/api/c/<token>)
    linkVersion: integer("link_version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("customer_pro_email_uq").on(t.professionalId, t.email),
    index("customer_user_idx").on(t.userId),
    index("customer_email_idx").on(t.email),
    check("customer_email_chk", sql`email = lower(email) AND email <> ''`),
  ],
);

/** One checkout: the ONLY row that carries money (snapshot of the offer). */
export const ticketPurchase = pgTable(
  "ticket_purchase",
  {
    id: id(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    offerId: text("offer_id")
      .notNull()
      .references(() => ticketOffer.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    validityCount: integer("validity_count"),
    validityUnit: validityUnit("validity_unit"),
    status: purchaseStatus("status").default("pending").notNull(),
    livemode: boolean("livemode").default(false).notNull(),
    checkoutSessionId: text("checkout_session_id"),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }).notNull(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    paymentIntentId: text("payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    fulfilledActionId: text("fulfilled_action_id"),
    ...timestamps,
  },
  (t) => [
    unique("ticket_purchase_checkout_session_uq").on(t.checkoutSessionId),
    index("ticket_purchase_pro_status_paid_idx").on(t.professionalId, t.status, t.paidAt),
    index("ticket_purchase_customer_idx").on(t.customerId),
    index("ticket_purchase_status_expires_idx").on(t.status, t.checkoutExpiresAt),
    check("ticket_purchase_quantity_chk", sql`quantity BETWEEN 1 AND 100`),
    check("ticket_purchase_amount_chk", sql`amount_cents > 0`),
    check("ticket_purchase_paid_chk", sql`(status = 'paid') = (paid_at IS NOT NULL)`),
  ],
);

/** 1 client = 1 seat = at most 1 ticket, on a séance or an RDV. */
export const booking = pgTable(
  "booking",
  {
    id: id(),
    professionalId: proRef(),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => occurrence.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    status: bookingStatus("status").notNull(),
    coverage: bookingCoverage("coverage").notNull(),
    // buy + book: the purchase paying for this seat
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    createdBy: actor("created_by").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    movedAt: timestamp("moved_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: actor("ended_by"),
    endedActionId: text("ended_action_id"),
    cancelReason: text("cancel_reason"),
    customerNotes: text("customer_notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("booking_active_uq")
      .on(t.occurrenceId, t.customerId)
      .where(sql`status IN ('pending', 'confirmed')`),
    unique("booking_purchase_uq").on(t.purchaseId),
    index("booking_occurrence_status_idx").on(t.occurrenceId, t.status),
    index("booking_customer_idx").on(t.customerId),
    index("booking_ended_action_idx").on(t.endedActionId),
    index("booking_hold_idx").on(t.holdExpiresAt).where(sql`status = 'pending'`),
    check(
      "booking_pending_chk",
      sql`status <> 'pending' OR (hold_expires_at IS NOT NULL AND purchase_id IS NOT NULL)`,
    ),
    check("booking_free_chk", sql`coverage <> 'free' OR purchase_id IS NULL`),
    check(
      "booking_ended_chk",
      sql`(status IN ('cancelled', 'expired')) = (ended_at IS NOT NULL)`,
    ),
  ],
);

/** An answer to a question, snapshotted (question_label) onto the booking. */
export const bookingAnswer = pgTable(
  "booking_answer",
  {
    id: id(),
    professionalId: proRef(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => question.id, {
      onDelete: "set null",
    }),
    questionLabel: text("question_label").notNull(),
    value: text("value").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("booking_answer_uq").on(t.bookingId, t.questionId),
    index("booking_answer_booking_idx").on(t.bookingId),
  ],
);

/** One ticket held by a client. The balance is a count(*): nothing can drift. */
export const ticket = pgTable(
  "ticket",
  {
    id: id(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    // NULL = offered by the pro
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    status: ticketStatus("status").notNull(),
    bookingId: text("booking_id").references(() => booking.id),
    // first instant the ticket is no longer valid (local midnight after its last day)
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    closedReason: ticketCloseReason("closed_reason"),
    closedNote: text("closed_note"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    unique("ticket_booking_uq").on(t.bookingId),
    index("ticket_customer_status_type_idx").on(t.customerId, t.status, t.ticketTypeId),
    index("ticket_by_purchase_idx").on(t.purchaseId),
    index("ticket_by_type_idx").on(t.ticketTypeId),
    index("ticket_expires_idx").on(t.expiresAt).where(sql`status = 'available'`),
    check("ticket_booked_chk", sql`(status = 'booked') = (booking_id IS NOT NULL)`),
    check("ticket_closed_chk", sql`(status = 'closed') = (closed_reason IS NOT NULL)`),
    check(
      "ticket_retire_paid_chk",
      sql`closed_reason IS DISTINCT FROM 'retire' OR purchase_id IS NULL`,
    ),
  ],
);

/**
 * Append-only ledger (convention, checked by invariant I4; no trigger). Order
 * by `seq`, never created_at. Rows are inserted by set-based CTEs, so `id`
 * has a database default.
 */
export const ticketMovement = pgTable(
  "ticket_movement",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id),
    actionId: text("action_id").notNull(),
    kind: movementKind("kind").notNull(),
    fromStatus: ticketStatus("from_status"),
    toStatus: ticketStatus("to_status").notNull(),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    fromTicketTypeId: text("from_ticket_type_id").references(() => ticketType.id),
    bookingId: text("booking_id").references(() => booking.id),
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    actor: actor("actor").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("ticket_movement_action_ticket_uq").on(t.actionId, t.ticketId),
    index("ticket_movement_customer_seq_idx").on(t.customerId, t.seq),
    index("ticket_movement_ticket_seq_idx").on(t.ticketId, t.seq),
    index("ticket_movement_action_idx").on(t.actionId),
    index("ticket_movement_pro_idx").on(t.professionalId),
  ],
);

/** Application rate limits (src/lib/throttle.ts) and `health:*` counters. No professional_id. */
export const throttle = pgTable("throttle", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull(),
});

/** Better Auth `rateLimit` model (rateLimit.storage = "database"). No professional_id. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
```

**Relations.** Replace `professionalRelations` and append the rest after `timeOffRelations`. `userRelations` and `timeOffRelations` are unchanged.

```ts
export const professionalRelations = relations(professional, ({ one, many }) => ({
  user: one(user, { fields: [professional.userId], references: [user.id] }),
  timeOff: many(timeOff),
  ticketTypes: many(ticketType),
  events: many(event),
  customers: many(customer),
  availability: many(availabilityRule),
}));

export const ticketTypeRelations = relations(ticketType, ({ one, many }) => ({
  professional: one(professional, { fields: [ticketType.professionalId], references: [professional.id] }),
  offers: many(ticketOffer),
  eventLinks: many(eventTicketType),
  questions: many(question),
  availabilityRules: many(availabilityRule),
}));
export const ticketOfferRelations = relations(ticketOffer, ({ one }) => ({
  ticketType: one(ticketType, { fields: [ticketOffer.ticketTypeId], references: [ticketType.id] }),
}));
export const availabilityRuleRelations = relations(availabilityRule, ({ one }) => ({
  professional: one(professional, { fields: [availabilityRule.professionalId], references: [professional.id] }),
  ticketType: one(ticketType, { fields: [availabilityRule.ticketTypeId], references: [ticketType.id] }),
}));
export const eventRelations = relations(event, ({ one, many }) => ({
  professional: one(professional, { fields: [event.professionalId], references: [professional.id] }),
  ticketTypeLinks: many(eventTicketType),
  questions: many(question),
  occurrences: many(occurrence),
}));
export const eventTicketTypeRelations = relations(eventTicketType, ({ one }) => ({
  event: one(event, { fields: [eventTicketType.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [eventTicketType.ticketTypeId], references: [ticketType.id] }),
}));
export const questionRelations = relations(question, ({ one, many }) => ({
  event: one(event, { fields: [question.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [question.ticketTypeId], references: [ticketType.id] }),
  answers: many(bookingAnswer),
}));
export const occurrenceRelations = relations(occurrence, ({ one, many }) => ({
  professional: one(professional, { fields: [occurrence.professionalId], references: [professional.id] }),
  event: one(event, { fields: [occurrence.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [occurrence.ticketTypeId], references: [ticketType.id] }),
  bookings: many(booking),
}));
export const customerRelations = relations(customer, ({ one, many }) => ({
  professional: one(professional, { fields: [customer.professionalId], references: [professional.id] }),
  user: one(user, { fields: [customer.userId], references: [user.id] }),
  bookings: many(booking),
  tickets: many(ticket),
  purchases: many(ticketPurchase),
}));
export const ticketPurchaseRelations = relations(ticketPurchase, ({ one, many }) => ({
  customer: one(customer, { fields: [ticketPurchase.customerId], references: [customer.id] }),
  offer: one(ticketOffer, { fields: [ticketPurchase.offerId], references: [ticketOffer.id] }),
  tickets: many(ticket),
}));
export const bookingRelations = relations(booking, ({ one, many }) => ({
  occurrence: one(occurrence, { fields: [booking.occurrenceId], references: [occurrence.id] }),
  customer: one(customer, { fields: [booking.customerId], references: [customer.id] }),
  purchase: one(ticketPurchase, { fields: [booking.purchaseId], references: [ticketPurchase.id] }),
  answers: many(bookingAnswer),
}));
export const bookingAnswerRelations = relations(bookingAnswer, ({ one }) => ({
  booking: one(booking, { fields: [bookingAnswer.bookingId], references: [booking.id] }),
  question: one(question, { fields: [bookingAnswer.questionId], references: [question.id] }),
}));
export const ticketRelations = relations(ticket, ({ one, many }) => ({
  customer: one(customer, { fields: [ticket.customerId], references: [customer.id] }),
  ticketType: one(ticketType, { fields: [ticket.ticketTypeId], references: [ticketType.id] }),
  purchase: one(ticketPurchase, { fields: [ticket.purchaseId], references: [ticketPurchase.id] }),
  booking: one(booking, { fields: [ticket.bookingId], references: [booking.id] }),
  movements: many(ticketMovement),
}));
export const ticketMovementRelations = relations(ticketMovement, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketMovement.ticketId], references: [ticket.id] }),
}));
```

**FK actions, as in the generated 0011.** NO ACTION is drizzle's default when no `onDelete` is given.

| FK | Action | Rule |
|---|---|---|
| every `professional_id` | CASCADE | R2 |
| `ticket_offer.ticket_type_id` | CASCADE | R3 composition |
| `availability_rule.ticket_type_id` | CASCADE | composition |
| `event_ticket_type.event_id`, `event_ticket_type.ticket_type_id` | CASCADE | composition |
| `question.event_id`, `question.ticket_type_id` | CASCADE | composition |
| `occurrence.event_id` | CASCADE | composition |
| `booking_answer.booking_id` | CASCADE | composition |
| `booking_answer.question_id` | SET NULL | R3 exception |
| `customer.user_id`, `ticket_movement.actor_user_id` | SET NULL | R4 |
| `occurrence.ticket_type_id` | NO ACTION | R3 |
| `ticket_purchase.{customer_id, offer_id, ticket_type_id}` | NO ACTION | R3 |
| `booking.{occurrence_id, customer_id, purchase_id}` | NO ACTION | R3 |
| `ticket.{customer_id, ticket_type_id, purchase_id, booking_id}` | NO ACTION | R3 |
| `ticket_movement.{customer_id, ticket_id, ticket_type_id, from_ticket_type_id, booking_id, purchase_id}` | NO ACTION | R3 |

**Expected 0011 output** (`drizzle-kit generate --name=tickets_schema`, verified):

- 13 `CREATE TYPE` statements: actor, booking_coverage, booking_mode, booking_status, monthly_by, movement_kind, occurrence_status, purchase_status, recurrence_end, recurrence_freq, ticket_close_reason, ticket_status, validity_unit. `question_type` is unchanged.
- 15 `CREATE TABLE` statements.
- 3 `ALTER TABLE "professional" ADD COLUMN … NOT NULL` statements.
- FKs as in the table above.
- The indexes, including `CREATE UNIQUE INDEX "booking_active_uq" … WHERE status IN ('pending', 'confirmed')` and the partial `booking_hold_idx` and `ticket_expires_idx`.
- Three `professional_*_chk` constraints.
- No prompt (creates only).

**Decisions on the schema:**

- **`event_end_until_chk` has no 5-year cap** (`until_date >= start_date` only). Splitting an old `never` series sets `until_date = d − 1`, which can be more than 5 years after `start_date`. The cap lives in `recurrenceRuleSchema` (user input).
- **`ticket_movement.id` defaults to `gen_random_uuid()::text`.** RET, expire, purchase and offer insert movements set-based from CTEs.
- **`generated_until` is NOT NULL.** It is set to the expansion end at creation.
- **`event_ticket_type` has `professional_id` and `created_at`.** R2 applies to every domain table. Spec § 6.4 only exempts it from having an `id`.
- Index names `ticket_by_purchase_idx` and `ticket_by_type_idx` avoid a clash in meaning with the table `ticket_purchase`.

### 4.3 Migration 0012 (Task 5)

Run `./node_modules/.bin/drizzle-kit generate --custom --name=tickets_manual`. It creates `drizzle/0012_tickets_manual.sql`, which contains one comment line. Replace the file content with:

```sql
-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE occurrence ADD CONSTRAINT occurrence_rdv_excl
  EXCLUDE USING gist (professional_id WITH =, tstzrange(block_start, block_end) WITH &&)
  WHERE (event_id IS NULL AND status = 'scheduled');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION skedul_assert(ok boolean, code text) RETURNS boolean LANGUAGE plpgsql AS
$$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'skedul:' || code; END IF; RETURN true; END$$;
```

`apply-migration.ts` splits on `--> statement-breakpoint`, which gives 3 statements in one transaction.

---

## 5. Module contracts

Notation: *full* means the writer copies the code as given (verified). *decl* means the exported declarations are binding; the writer writes the implementation and its tests.

### 5.1 `src/lib/tickets.ts` (Task 1), full, verified

```ts
/**
 * Tickets & événements: the vocabulary shared by the schema (pgEnums), the
 * booking engine, the server actions and the UI. Enum values, bounds, French
 * labels and messages, engine error codes and the zod input schemas.
 * No drizzle and no Node APIs, so client components may import it.
 */
import { z } from "zod";

/* ───────────────────────── Enum values (pgEnum sources) ───────────────────────── */

export const BOOKING_MODES = ["tickets", "free", "none"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const RECURRENCE_FREQS = ["once", "daily", "weekly", "monthly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const MONTHLY_BY = ["day_of_month", "weekday"] as const;
export type MonthlyBy = (typeof MONTHLY_BY)[number];

export const RECURRENCE_ENDS = ["never", "until", "count"] as const;
export type RecurrenceEnd = (typeof RECURRENCE_ENDS)[number];

export const VALIDITY_UNITS = ["day", "month"] as const;
export type ValidityUnit = (typeof VALIDITY_UNITS)[number];

export const OCCURRENCE_STATUSES = ["scheduled", "cancelled"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "expired"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_COVERAGES = ["ticket", "free", "guest"] as const;
export type BookingCoverage = (typeof BOOKING_COVERAGES)[number];

export const ACTORS = ["client", "pro", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const PURCHASE_STATUSES = ["pending", "paid", "expired"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const TICKET_STATUSES = ["available", "booked", "used", "expired", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CLOSE_REASONS = ["rembourse", "compense", "retire", "autre"] as const;
export type TicketCloseReason = (typeof TICKET_CLOSE_REASONS)[number];

export const MOVEMENT_KINDS = [
  "purchase",
  "offer",
  "spend",
  "return",
  "pointage",
  "unpoint",
  "convert",
  "expire",
  "close",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const QUESTION_TYPES = ["text", "choice", "boolean"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/* ───────────────────────────── Labels (FR) ───────────────────────────── */

export const BOOKING_MODE_LABELS: Record<BookingMode, string> = {
  tickets: "Sur tickets",
  free: "Inscription libre",
  none: "Sans réservation en ligne",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  expired: "Expirée",
};

export const COVERAGE_LABELS: Record<BookingCoverage, string> = {
  ticket: "Ticket",
  free: "Inscription libre",
  guest: "Invité",
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "En attente",
  paid: "Payé",
  expired: "Expiré",
};

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  scheduled: "Planifiée",
  cancelled: "Annulée",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  available: "Disponible",
  booked: "Réservé",
  used: "Utilisé",
  expired: "Expiré",
  closed: "Clos",
};

export const CLOSE_REASON_LABELS: Record<TicketCloseReason, string> = {
  rembourse: "Remboursé hors Skedul",
  compense: "Compensé",
  retire: "Retiré",
  autre: "Autre",
};

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  purchase: "Acheté",
  offer: "Offert",
  spend: "Utilisé pour une inscription",
  return: "Rendu",
  pointage: "Pointé",
  unpoint: "Pointage annulé",
  convert: "Converti",
  expire: "Expiré",
  close: "Clos",
};

export const ACTOR_LABELS: Record<Actor, string> = {
  client: "Client",
  pro: "Vous",
  system: "Skedul",
};

/* ───────────────────────────── Bounds ───────────────────────────── */

export const BOUNDS = {
  bookingHorizonDays: { min: 1, max: 365, default: 60 },
  minNoticeMinutes: { min: 0, max: 10_080, default: 60 },
  cancelDeadlineHours: { min: 0, max: 720, default: 24 },
  capacity: { min: 1, max: 500, default: 12 },
  eventDurationMin: { min: 5, max: 720, step: 5, default: 60 },
  rdvDurationMin: { min: 5, max: 480, step: 5, default: 60 },
  rdvBufferMin: { min: 0, max: 240 },
  offerQuantity: { min: 1, max: 100 },
  offerPriceCents: { min: 1, max: 1_000_000 },
  validityCount: { min: 1, max: 1000 },
  occurrenceCount: { min: 1, max: 730 },
  interval: { once: 1, daily: 31, weekly: 52, monthly: 12 },
  untilYears: 5,
  startMinute: { min: 0, max: 1439 },
  name: 80,
  title: 120,
  description: 2000,
  location: 200,
  offerLabel: 80,
  phone: 30,
  note: 500,
  questionLabel: 200,
  questionOptions: 20,
  answer: 2000,
  questions: 20,
  walletQuantity: 100,
} as const;

/** Event occurrences are materialised this many days ahead of local today. */
export const MATERIALIZE_DAYS = 400;
/** Renders call ensureHorizon only when min(generated_until) < today + this. */
export const HORIZON_REFRESH_DAYS = 393;
/** At most this many occurrence rows are inserted by one call. */
export const MATERIALIZE_MAX_ROWS = 450;

/** A buy+book booking holds its seat this long (`hold_expires_at`). */
export const HOLD_MINUTES = 45;
/** Stripe Checkout `expires_at` for a buy+book purchase (Stripe minimum: 30). */
export const CHECKOUT_MINUTES = 31;
/** Stripe Checkout `expires_at` for a shop purchase. */
export const SHOP_CHECKOUT_HOURS = 24;
/** A pending purchase this long past `checkout_expires_at` is expired by the nightly job. */
export const STALE_PURCHASE_GRACE_MINUTES = 60;
/** Live holds (pending bookings) one customer may have at once. */
export const MAX_PENDING_HOLDS = 2;

export const THROTTLE_WINDOW_SEC = 3600;
export const THROTTLE_ACTIONS = ["free", "buybook", "rdv", "shop"] as const;
export type ThrottleAction = (typeof THROTTLE_ACTIONS)[number];
export const THROTTLE_LIMITS: Record<ThrottleAction, { ip: number; email: number }> = {
  free: { ip: 20, email: 6 },
  buybook: { ip: 20, email: 6 },
  rdv: { ip: 20, email: 6 },
  shop: { ip: 20, email: 6 },
};
/** Sign-in / verification codes sent to one address per hour (auth hook). */
export const OTP_EMAIL_LIMIT = { limit: 5, windowSec: 3600 } as const;
/** `throttle` rows older than this are purged by the nightly job. */
export const THROTTLE_PURGE_DAYS = 2;

export const DEFAULT_COLOR = "#6366f1";

/* ───────────────────────── Engine error codes ───────────────────────── */

export const ENGINE_ERROR_CODES = [
  "full",
  "unavailable",
  "changed",
  "stale",
  "already_booked",
  "slot_taken",
  "no_ticket",
  "too_many_holds",
  "too_late_or_done",
  "not_found",
  "not_eligible",
  "in_use",
  "invalid",
  "throttled",
  "offer_too_short",
  "ticket_expires_before",
  "retire_paid",
  "timezone_locked",
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export function isEngineErrorCode(value: string): value is EngineErrorCode {
  return (ENGINE_ERROR_CODES as readonly string[]).includes(value);
}

export const ENGINE_ERROR_MESSAGES: Record<EngineErrorCode, string> = {
  full: "Complet",
  unavailable: "Cette séance n'est plus ouverte aux réservations.",
  changed: "La séance a changé, rafraîchissez la page.",
  stale: "Ceci a changé, rafraîchissez la page.",
  already_booked: "Vous êtes déjà inscrit(e).",
  slot_taken: "Ce créneau vient d'être pris.",
  no_ticket: "Aucun ticket utilisable pour cette séance.",
  too_many_holds: "Vous avez déjà deux paiements en cours. Terminez-les ou libérez une place.",
  too_late_or_done: "Cette inscription ne peut plus être annulée en ligne.",
  not_found: "Élément introuvable.",
  not_eligible: "Ce ticket n'est pas accepté pour cette séance.",
  in_use: "Cet élément a déjà servi : il a été archivé.",
  invalid: "Données invalides.",
  throttled: "Trop de demandes. Réessayez dans un moment.",
  offer_too_short: "La validité de cette offre ne couvre pas la date de la séance.",
  ticket_expires_before: "Ticket expiré à la date de cette séance. Déplacer quand même ?",
  retire_paid: "Un ticket payé ne peut pas être retiré.",
  timezone_locked: "Fuseau verrouillé : vous avez des séances planifiées.",
};

/* ───────────────────────────── Helpers ───────────────────────────── */

/** Trimmed, lower-cased e-mail: the `customer.email` key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** « À l'unité » / « Carnet de 10 » unless the pro typed a label. */
export function offerLabel(offer: { label: string | null; quantity: number }): string {
  const typed = offer.label?.trim();
  if (typed) return typed;
  return offer.quantity === 1 ? "À l'unité" : `Carnet de ${offer.quantity}`;
}

/** « 3 mois », « 30 jours », « 1 jour »; null without validity. */
export function validityLabel(count: number | null, unit: ValidityUnit | null): string | null {
  if (count == null || unit == null) return null;
  if (unit === "month") return `${count} mois`;
  return count > 1 ? `${count} jours` : "1 jour";
}

/* ───────────────────────────── zod schemas ───────────────────────────── */

const intIn = (min: number, max: number) => z.number().int().min(min).max(max);
const optionalOverride = (min: number, max: number) => intIn(min, max).nullable();

export const dateKeySchema = z.iso.date();
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const idSchema = z.string().min(1).max(64);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(BOUNDS.name),
  email: z.email().max(254).transform(normalizeEmail),
  phone: z.string().trim().max(BOUNDS.phone).optional(),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const answerInputSchema = z.object({
  questionId: idSchema,
  value: z.string().max(BOUNDS.answer),
});
export const answersInputSchema = z.array(answerInputSchema).max(BOUNDS.questions);
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const bookingSettingsSchema = z.object({
  bookingHorizonDays: intIn(BOUNDS.bookingHorizonDays.min, BOUNDS.bookingHorizonDays.max),
  minNoticeMinutes: intIn(BOUNDS.minNoticeMinutes.min, BOUNDS.minNoticeMinutes.max),
  cancelDeadlineHours: intIn(BOUNDS.cancelDeadlineHours.min, BOUNDS.cancelDeadlineHours.max),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;

export const windowOverridesSchema = z.object({
  bookingHorizonDays: optionalOverride(BOUNDS.bookingHorizonDays.min, BOUNDS.bookingHorizonDays.max),
  minNoticeMinutes: optionalOverride(BOUNDS.minNoticeMinutes.min, BOUNDS.minNoticeMinutes.max),
  cancelDeadlineHours: optionalOverride(BOUNDS.cancelDeadlineHours.min, BOUNDS.cancelDeadlineHours.max),
});
export type WindowOverrides = z.infer<typeof windowOverridesSchema>;

export const questionInputSchema = z
  .object({
    id: idSchema.optional(),
    label: z.string().trim().min(1).max(BOUNDS.questionLabel),
    type: z.enum(QUESTION_TYPES),
    options: z.array(z.string().trim().min(1).max(BOUNDS.questionLabel)).max(BOUNDS.questionOptions).default([]),
    required: z.boolean().default(false),
  })
  .refine((q) => q.type !== "choice" || q.options.length >= 2, {
    message: "Une question à choix demande au moins deux options.",
    path: ["options"],
  });
export type QuestionInput = z.input<typeof questionInputSchema>;

export const ticketTypeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(BOUNDS.name),
    description: z.string().trim().max(BOUNDS.description).nullable().default(null),
    color: hexColorSchema.default(DEFAULT_COLOR),
    rdvEnabled: z.boolean().default(false),
    rdvFree: z.boolean().default(false),
    rdvDurationMin: z
      .number()
      .int()
      .min(BOUNDS.rdvDurationMin.min)
      .max(BOUNDS.rdvDurationMin.max)
      .multipleOf(BOUNDS.rdvDurationMin.step)
      .nullable()
      .default(null),
    rdvBufferBeforeMin: intIn(BOUNDS.rdvBufferMin.min, BOUNDS.rdvBufferMin.max).default(0),
    rdvBufferAfterMin: intIn(BOUNDS.rdvBufferMin.min, BOUNDS.rdvBufferMin.max).default(0),
    rdvOverrides: windowOverridesSchema.default({
      bookingHorizonDays: null,
      minNoticeMinutes: null,
      cancelDeadlineHours: null,
    }),
  })
  .refine((t) => !t.rdvEnabled || t.rdvDurationMin !== null, {
    message: "Indiquez la durée du rendez-vous.",
    path: ["rdvDurationMin"],
  })
  .refine((t) => !t.rdvFree || t.rdvEnabled, {
    message: "Le rendez-vous gratuit demande le RDV libre.",
    path: ["rdvFree"],
  });
export type TicketTypeInput = z.input<typeof ticketTypeInputSchema>;

export const offerInputSchema = z
  .object({
    ticketTypeId: idSchema,
    label: z.string().trim().max(BOUNDS.offerLabel).nullable().default(null),
    quantity: intIn(BOUNDS.offerQuantity.min, BOUNDS.offerQuantity.max),
    priceCents: intIn(BOUNDS.offerPriceCents.min, BOUNDS.offerPriceCents.max),
    validityCount: intIn(BOUNDS.validityCount.min, BOUNDS.validityCount.max).nullable().default(null),
    validityUnit: z.enum(VALIDITY_UNITS).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .refine((o) => (o.validityCount === null) === (o.validityUnit === null), {
    message: "Indiquez une durée et une unité de validité, ou aucune.",
    path: ["validityCount"],
  });
export type OfferInput = z.input<typeof offerInputSchema>;

/** Recurrence columns of `event` (spec § 8); refinements mirror the DB CHECKs. */
export const recurrenceRuleSchema = z
  .object({
    startDate: dateKeySchema,
    startMinute: intIn(BOUNDS.startMinute.min, BOUNDS.startMinute.max),
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(52),
    weekdays: z.array(intIn(0, 6)).min(1).max(7).nullable(),
    monthlyBy: z.enum(MONTHLY_BY).nullable(),
    monthWeek: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).nullable(),
    endMode: z.enum(RECURRENCE_ENDS),
    untilDate: dateKeySchema.nullable(),
    occurrenceCount: intIn(BOUNDS.occurrenceCount.min, BOUNDS.occurrenceCount.max).nullable(),
  })
  .superRefine((r, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (r.interval > BOUNDS.interval[r.freq]) fail("interval", "Intervalle trop grand.");
    if (r.freq === "once") {
      if (r.interval !== 1 || r.endMode !== "count" || r.occurrenceCount !== 1) fail("freq", "Une séance unique se répète une fois.");
      if (r.weekdays !== null || r.monthlyBy !== null || r.monthWeek !== null || r.untilDate !== null) fail("freq", "Champs de récurrence inattendus.");
    }
    if (r.freq === "weekly") {
      const days = r.weekdays ?? [];
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      if (days.length === 0) fail("weekdays", "Choisissez au moins un jour.");
      if (sorted.length !== days.length || sorted.some((d, i) => d !== days[i])) fail("weekdays", "Jours en double ou non triés.");
    } else if (r.weekdays !== null) fail("weekdays", "Jours réservés aux séries hebdomadaires.");
    if (r.freq === "monthly") {
      if (r.monthlyBy === null) fail("monthlyBy", "Choisissez le jour du mois.");
      if (r.monthlyBy === "weekday" && r.monthWeek === null) fail("monthWeek", "Choisissez la semaine du mois.");
      if (r.monthlyBy === "day_of_month" && r.monthWeek !== null) fail("monthWeek", "Semaine inattendue.");
    } else if (r.monthlyBy !== null || r.monthWeek !== null) fail("monthlyBy", "Réservé aux séries mensuelles.");
    if (r.endMode === "never" && (r.untilDate !== null || r.occurrenceCount !== null)) fail("endMode", "Fin inattendue.");
    if (r.endMode === "until") {
      if (r.untilDate === null || r.occurrenceCount !== null) fail("untilDate", "Indiquez la date de fin.");
      else if (r.untilDate < r.startDate) fail("untilDate", "La fin précède le début.");
      else {
        const [y, m, d] = r.startDate.split("-").map(Number);
        const max = `${String(y + BOUNDS.untilYears).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (r.untilDate > max) fail("untilDate", "La série ne peut pas dépasser 5 ans.");
      }
    }
    if (r.endMode === "count" && (r.occurrenceCount === null || r.untilDate !== null)) fail("occurrenceCount", "Indiquez le nombre de séances.");
  });
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(BOUNDS.title),
  description: z.string().trim().max(BOUNDS.description).nullable().default(null),
  location: z.string().trim().max(BOUNDS.location).nullable().default(null),
  color: hexColorSchema.default(DEFAULT_COLOR),
  bookingMode: z.enum(BOOKING_MODES).default("tickets"),
  isPrivate: z.boolean().default(false),
  capacity: intIn(BOUNDS.capacity.min, BOUNDS.capacity.max).default(BOUNDS.capacity.default),
  durationMin: z
    .number()
    .int()
    .min(BOUNDS.eventDurationMin.min)
    .max(BOUNDS.eventDurationMin.max)
    .multipleOf(BOUNDS.eventDurationMin.step)
    .default(BOUNDS.eventDurationMin.default),
  rule: recurrenceRuleSchema,
  overrides: windowOverridesSchema.default({
    bookingHorizonDays: null,
    minNoticeMinutes: null,
    cancelDeadlineHours: null,
  }),
  ticketTypeIds: z.array(idSchema).max(50).default([]),
  questions: z.array(questionInputSchema).max(BOUNDS.questions).default([]),
});
export type EventInput = z.input<typeof eventInputSchema>;
export type EventInputParsed = z.infer<typeof eventInputSchema>;

export const availabilityRuleInputSchema = z
  .object({
    dayOfWeek: intIn(0, 6),
    startMinute: intIn(0, 1439),
    endMinute: intIn(1, 1440),
  })
  .refine((r) => r.startMinute < r.endMinute, { message: "Plage horaire invalide.", path: ["endMinute"] });
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleInputSchema>;
```

**Invariants:**

- The enum arrays equal spec § 6.2 exactly.
- `365 + 30 < MATERIALIZE_DAYS` and `HORIZON_REFRESH_DAYS < MATERIALIZE_DAYS`.
- No French string contains `—`.
- Every `EngineErrorCode` has a message (enforced by the `Record`).

### 5.2 `src/lib/civil-date.ts` (Task 7), decl

**Decision:** a new module for civil arithmetic on `YYYY-MM-DD` keys. It **reuses** `datetime.ts` (`addDaysToKey`, `dayOfWeekForKey`, `dayKeyInTz`, `instantFromWallClock`) instead of duplicating them. `datetime.ts` is unchanged.

```ts
/** Civil (calendar) dates as "YYYY-MM-DD" keys: integer arithmetic, no time zone. */
export type DateKey = string;
/** Parse a key; throws on a malformed one. */
export declare function parseKey(key: DateKey): { y: number; m: number; d: number };
/** Build a normalised key (2026-02-31 → 2026-03-03). */
export declare function makeKey(y: number, m: number, d: number): DateKey;
/** Days since 1970-01-01 (may be negative). */
export declare function dayNumber(key: DateKey): number;
export declare function fromDayNumber(n: number): DateKey;
/** = datetime.addDaysToKey. */
export declare function addDays(key: DateKey, n: number): DateKey;
/** b − a in days. */
export declare function diffDays(a: DateKey, b: DateKey): number;
/** 0 = Sunday … 6 = Saturday (= datetime.dayOfWeekForKey). */
export declare function dayOfWeek(key: DateKey): number;
/** Monday of the ISO week containing key. */
export declare function mondayOf(key: DateKey): DateKey;
export declare function daysInMonth(y: number, m: number): number;
/** y*12 + (m−1). */
export declare function monthIndex(key: DateKey): number;
/** Add months, clamping the day to the target month's length (2026-01-31 + 1 → 2026-02-28). */
export declare function addMonthsClamped(key: DateKey, n: number): DateKey;
/** nth (1..4) or last (−1) `weekday` (0..6) of month m of year y. */
export declare function nthWeekdayOfMonth(y: number, m: number, weekday: number, nth: 1 | 2 | 3 | 4 | -1): DateKey;
export declare function compareKeys(a: DateKey, b: DateKey): number;
export declare function minKey(a: DateKey, b: DateKey): DateKey;
export declare function maxKey(a: DateKey, b: DateKey): DateKey;
/** Local calendar date of `instant` in tz (= datetime.dayKeyInTz). */
export declare function todayKey(instant: Date, tz: string): DateKey;
/** Instant of `minute` (0..1440) on local date `key` in tz (= datetime.instantFromWallClock). */
export declare function instantAt(key: DateKey, minute: number, tz: string): Date;
/** "12/10" (dd/MM). */
export declare function formatDayMonth(key: DateKey): string;
/** "12/10/2026". */
export declare function formatDayMonthYear(key: DateKey): string;
```

**Test vectors (verified):**

- `instantAt("2026-03-29", 150, "Europe/Paris")` = `2026-03-29T01:30:00.000Z`
- `instantAt("2026-10-25", 150, …)` = `2026-10-25T00:30:00.000Z`
- `instantAt("2026-03-01", 0, …)` = `2026-02-28T23:00:00.000Z`
- `instantAt("2026-10-26", 0, …)` = `2026-10-25T23:00:00.000Z`
- `dayOfWeek("2026-10-14")` = 3, `"2026-11-01"` = 0, `"2026-10-30"` = 5, `"2026-10-12"` = 1
- `nthWeekdayOfMonth(2026, 11, 0, 1)` = `2026-11-01`
- `nthWeekdayOfMonth(2026, 12, 5, -1)` = `2026-12-25`

### 5.3 `src/lib/recurrence.ts` (Task 8), decl

```ts
import type { DateKey } from "@/lib/civil-date";
import type { MonthlyBy, RecurrenceEnd, RecurrenceFreq } from "@/lib/tickets";

/** The recurrence columns of `event` + duration: everything the expander needs. */
export type RecurrenceRule = {
  startDate: DateKey;
  startMinute: number;
  durationMin: number;
  freq: RecurrenceFreq;
  interval: number;
  weekdays: number[] | null;
  monthlyBy: MonthlyBy | null;
  monthWeek: 1 | 2 | 3 | 4 | -1 | null;
  endMode: RecurrenceEnd;
  untilDate: DateKey | null;
  occurrenceCount: number | null;
};
export type ExpandedDate = { seriesDate: DateKey; startsAt: Date; endsAt: Date };
/** At most this many dates are produced by one call. */
export declare const EXPAND_MAX_DATES: 1000;
/**
 * The rule's local dates in [fromDate, toDate] (inclusive), ascending. Never a
 * date before startDate; until inclusive; count walks from startDate and
 * counts every produced date. never/until jump arithmetically to the first
 * aligned period containing fromDate. Caps: EXPAND_MAX_DATES produced, and
 * (days from walk start to toDate) + 31 loop steps.
 */
export declare function expandDates(rule: RecurrenceRule, fromDate: DateKey, toDate: DateKey): DateKey[];
/** expandDates + instants: startsAt = instantAt(date, startMinute, tz), endsAt = startsAt + durationMin. */
export declare function expand(rule: RecurrenceRule, tz: string, fromDate: DateKey, toDate: DateKey): ExpandedDate[];
/** Last date the rule can produce: once → startDate; until → untilDate (upper bound); count → exact; never → null. */
export declare function lastSeriesDate(rule: RecurrenceRule): DateKey | null;
/** How many dates the rule produces strictly before d (from startDate; capped by occurrenceCount). */
export declare function countDatesBefore(rule: RecurrenceRule, d: DateKey): number;
/** count mode: occurrenceCount − countDatesBefore(rule, d) (≥ 0); null otherwise (« Il reste K séances »). */
export declare function remainingCount(rule: RecurrenceRule, d: DateKey): number | null;
/** « Toutes les 2 semaines le lundi et le mercredi, jusqu'au 30/06 » (spec § 8). */
export declare function describeRecurrence(rule: RecurrenceRule): string;
/** Monthly-by-day on 29/30/31: « Certains mois n'ont pas de 31 : ils sont sautés. »; else null. */
export declare function monthlyDayWarning(rule: RecurrenceRule): string | null;
/** Editor preview: dates whose wall-clock start is shifted (nonexistent) or ambiguous (repeated) in tz. */
export declare function dstNotes(rule: RecurrenceRule, tz: string, dates: readonly DateKey[]): { seriesDate: DateKey; kind: "shifted" | "ambiguous" }[];
```

**Rules for writers:**

- **Weekly:** Monday-based week index from the week of `startDate`. Keep `weekIdx % interval == 0` and `dayOfWeek ∈ weekdays`. Order inside a week is Mon..Sun, so Sunday (0) comes last.
- **Monthly by day:** months without that day are skipped.
- **Monthly by weekday:** weekday = `dayOfWeek(startDate)`, nth = `monthWeek`.

**`describeRecurrence` labels:**

| Rule | Label |
|---|---|
| once | « Le 12/10/2026 » |
| daily | « Tous les jours », « Tous les 3 jours » |
| weekly | « Toutes les semaines le lundi et le jeudi », « Toutes les 2 semaines le samedi » |
| monthly by day | « Tous les mois le 15 » |
| monthly by weekday | « Tous les mois le 1er dimanche », « le 2e mardi », « le dernier vendredi », « Tous les 3 mois … » |
| until (suffix) | « , jusqu'au 30/06 » |
| count (suffix) | « , 10 séances » |

Lists are joined as « le lundi, le mercredi et le vendredi ».

**Test vectors:**

- Weekly from `2026-10-14` (Wed), `[1,4]`, interval 1 → `2026-10-15, 2026-10-19, 2026-10-22…`
- Same with interval 2 → `2026-10-15, 2026-10-26, 2026-10-29, 2026-11-09…`
- Monthly day 31 from `2026-01-31` → `01-31, 03-31, 05-31, 07-31, 08-31, 10-31, 12-31`.
- 1st Sunday from `2026-11-01` → `2026-11-01, 2026-12-06, 2027-01-03`.
- Last Friday from `2026-10-30` → `10-30, 11-27, 12-25`.
- A daily series that started 4 years ago still produces 400 dates for `[today, today+399]`, with loop steps ≤ 431.
- `count` = 5 weekly → exactly 5 dates in total, even when `fromDate` is after the 3rd.

### 5.4 `src/lib/series-plan.ts` (Task 9), decl

```ts
import type { DateKey } from "@/lib/civil-date";
import type { RecurrenceRule } from "@/lib/recurrence";
import type { OccurrenceStatus } from "@/lib/tickets";

/** An existing occurrence of the edited segment with seriesDate ≥ d. */
export type SeriesRow = {
  id: string; seriesDate: DateKey; startsAt: Date; endsAt: Date; status: OccurrenceStatus; timeDetached: boolean;
  /** pending + confirmed bookings */ activeBookings: number;
  /** confirmed bookings of coverage ticket */ ticketBookings: number;
  /** any booking ever, whatever its status */ hasHistory: boolean;
};
export type SeriesEditInput = {
  tz: string; /** d */ fromDate: DateKey; /** today + MATERIALIZE_DAYS */ horizonEnd: DateKey;
  oldRule: RecurrenceRule; newRule: RecurrenceRule; rows: readonly SeriesRow[];
};
export type SeriesEditSummary = {
  modified: number; notified: number; orphans: number; orphanTickets: number;
  deleted: number; cancelledEmpty: number; inserted: number;
};
export type SeriesEditPlan = {
  retime: { id: string; seriesDate: DateKey; startsAt: Date; endsAt: Date; timeChanged: boolean }[];
  reparentOnly: string[]; delete: string[]; cancelEmpty: string[]; orphanBooked: string[];
  insert: { seriesDate: DateKey; startsAt: Date; endsAt: Date }[];
  generatedUntil: DateKey; remainingCount: number | null; summary: SeriesEditSummary;
};
/** Pure planner of « cette séance et les suivantes » (spec § 11 E7). */
export declare function planSeriesEdit(input: SeriesEditInput): SeriesEditPlan;
/** « 12 séances modifiées, 3 inscrits prévenus, 1 séance annulée (2 tickets rendus) ». */
export declare function describeSeriesEdit(summary: SeriesEditSummary, orphans: "keep" | "cancel"): string;
```

**Invariants:** every input row lands in exactly one of retime / reparentOnly / delete / cancelEmpty / orphanBooked. The split is as follows.

- `newDates = expandDates(newRule, maxKey(d, newRule.startDate), horizonEnd)`.
- **retime:** non-detached rows whose `seriesDate ∈ newDates`, including cancelled rows; their status is kept. `timeChanged` = the start or end instant changed.
- **reparentOnly:** every `timeDetached` row.
- **delete:** non-detached rows not in `newDates` with `!hasHistory` and status scheduled.
- **cancelEmpty:** non-detached rows not in `newDates` with `activeBookings = 0` and (`hasHistory` or status cancelled).
- **orphanBooked:** non-detached rows not in `newDates` with `activeBookings > 0`.
- **insert:** `newDates` with no row (any status), capped at `MATERIALIZE_MAX_ROWS`. `generatedUntil` = the last inserted date when capped, else `horizonEnd`.
- **summary.modified** = scheduled retime rows with `timeChanged`; **notified** = their `activeBookings`.

### 5.5 `src/lib/ticket-expiry.ts`, `src/lib/booking-window.ts`, `src/lib/cancellation.ts` (Task 10), decl

```ts
// ticket-expiry.ts
import type { DateKey } from "@/lib/civil-date";
import type { ValidityUnit } from "@/lib/tickets";
export type Validity = { count: number; unit: ValidityUnit } | null;
/** First instant a ticket is no longer valid: local midnight after (local date of paidAt + N days or months, months clamped). null = no expiry. */
export declare function ticketExpiry(paidAt: Date, validity: Validity, tz: string): Date | null;
/** From an offer/purchase snapshot. */
export declare function validityOf(row: { validityCount: number | null; validityUnit: ValidityUnit | null }): Validity;
/** Last valid local day (« valable jusqu'au 12/01 inclus »): local date of (expiresAt − 1 ms). */
export declare function lastValidDay(expiresAt: Date, tz: string): DateKey;
/** expires_at for a pro-chosen last day (Offrir): local midnight after lastDay. */
export declare function expiryFromLastDay(lastDay: DateKey, tz: string): Date;
/** expiresAt null or expiresAt > startsAt. */
export declare function validAt(expiresAt: Date | null, startsAt: Date): boolean;
/** validAt(ticketExpiry(now, validity, tz), startsAt). */
export declare function offerCovers(now: Date, validity: Validity, tz: string, startsAt: Date): boolean;
```

Test vectors:

- Paid `2026-01-31T09:00Z` (Paris 10:00), 1 month → `2026-02-28T23:00:00.000Z`.
- Paid `2026-10-24T21:30Z` (Paris 23:30), 1 day → `2026-10-25T23:00:00.000Z`.

```ts
// booking-window.ts
import type { DateKey } from "@/lib/civil-date";
import type { WindowOverrides } from "@/lib/tickets";
export type BookingWindow = { bookingHorizonDays: number; minNoticeMinutes: number; cancelDeadlineHours: number };
/** Each field: the override when not null, else the pro's. */
export declare function effectiveWindow(pro: BookingWindow, override?: Partial<WindowOverrides> | null): BookingWindow;
/** today (local, tz) + horizonDays. */
export declare function lastBookableDate(now: Date, tz: string, horizonDays: number): DateKey;
export type Bookability = { ok: true } | { ok: false; reason: "past" | "notice" | "horizon" };
/** now + minNotice ≤ startsAt AND local date(startsAt) ≤ today + horizon; "past" when startsAt ≤ now. Mirrors ONLINE_OK (§6). */
export declare function onlineBookability(args: { startsAt: Date; now: Date; tz: string; window: BookingWindow }): Bookability;
/** RDV: [startsAt, endsAt) inside one rule window of the local day of startsAt (rules already resolved). */
export declare function fitsAvailability(rules: readonly { dayOfWeek: number; startMinute: number; endMinute: number }[], startsAt: Date, endsAt: Date, tz: string): boolean;

// cancellation.ts
export declare function clientCancelDeadline(startsAt: Date, deadlineHours: number): Date;
export type ClientCancelCheck =
  | { allowed: true; reason: "before_deadline" | "changed_by_pro" }
  | { allowed: false; reason: "started" | "too_late" };
/** startsAt > now AND (startsAt − deadline > now OR occurrenceChangedAt > bookingCreatedAt OR movedAt set). Mirrors cancelByClient's EXISTS. */
export declare function clientCanCancel(args: { startsAt: Date; now: Date; deadlineHours: number; bookingCreatedAt: Date; occurrenceChangedAt: Date | null; movedAt: Date | null }): ClientCancelCheck;
```

### 5.6 `src/lib/guest-link.ts`, `src/lib/lanes.ts` (Task 11), decl

```ts
// guest-link.ts (node:crypto createHmac + timingSafeEqual)
export declare const GUEST_COOKIE: "skedul_guest";
/** 30 days, in seconds (2_592_000). */
export declare const GUEST_COOKIE_MAX_AGE: number;
export type GuestLink = { customerId: string; linkVersion: number };
/** HMAC-SHA256(secret, "skedul-guest-link-v1"). */
export declare function guestLinkKey(secret: string): Buffer;
/** `${customerId}.${linkVersion}.${base64url(HMAC-SHA256(key, `${customerId}|${linkVersion}`))}`. */
export declare function signGuestLink(link: GuestLink, key: Buffer): string;
/** The link when the token has exactly 3 parts, an integer version ≥ 1 and a matching MAC (constant time); else null. */
export declare function verifyGuestLink(token: string, key: Buffer): GuestLink | null;

// lanes.ts
export type LaneItem = { id: string; start: number; end: number };
export type LaneSlot = { lane: number; lanes: number };
/** Sorted by (start, end desc, id); clusters of transitively overlapping items; greedy first free lane; every item gets its cluster's lane count; touching intervals do not overlap. */
export declare function layoutLanes(items: readonly LaneItem[]): Map<string, LaneSlot>;
```

### 5.7 `src/lib/wallet-rules.ts` (Task 12), decl

```ts
import type { TicketStatus } from "@/lib/tickets";
export type TypeFacts = { ticketTypeId: string; archived: boolean; rdvEnabled: boolean; /** linked to a non-archived tickets-mode event (private counts) with a future scheduled séance */ linkedToUpcomingEvent: boolean };
/** ok, 🔴 archived, 🟠 orphan (active, not rdv_enabled, not linked). */
export type TypeClass = "ok" | "archived" | "orphan";
export declare function classifyTypes(types: readonly TypeFacts[]): Map<string, TypeClass>;
export type Holding = { ticketTypeId: string; usable: number };
export declare function customerAlerts(holdings: readonly Holding[], classes: ReadonlyMap<string, TypeClass>): { red: boolean; orange: boolean };
/** status available AND (expiresAt null OR expiresAt > at). */
export declare function isUsable(t: { status: TicketStatus; expiresAt: Date | null }, at: Date): boolean;
/** expiresAt asc nulls last, createdAt, id; returns a new array. */
export declare function consumptionOrder<T extends { id: string; expiresAt: Date | null; createdAt: Date }>(tickets: readonly T[]): T[];
```

### 5.8 `src/lib/throttle.ts` (Task 13), decl. Also add `ipHash` to `visitor-hash.ts`.

```ts
import type { Db } from "@/lib/db/atomic";
import type { ThrottleAction } from "@/lib/tickets";
export type ThrottleState = { windowStart: Date; hits: number };
export type ThrottleLimit = { limit: number; windowSec: number };
/** Pure twin of the SQL upsert: a new window when prev is null or windowStart ≤ now − windowSec, else hits + 1. */
export declare function nextWindow(prev: ThrottleState | null, now: Date, windowSec: number): ThrottleState;
/** `t:<action>:ip:<ipHash>` / `t:<action>:e:<sha256(normalizedEmail) first 32 hex>`; action "otp" for the auth code cap. */
export declare function throttleKey(action: ThrottleAction | "otp", kind: "ip" | "email", value: string): string;
export declare function otpThrottleKey(email: string): string;
/** Atomic upsert on `throttle` (one statement); true while hits ≤ limit. */
export declare function consumeThrottle(db: Db, key: string, limit: ThrottleLimit, now: Date): Promise<boolean>;
/** P4 actions: consumes the IP key and the e-mail key (THROTTLE_LIMITS, THROTTLE_WINDOW_SEC); false if either is over. */
export declare function checkActionThrottle(db: Db, args: { action: ThrottleAction; ipHash: string; email: string }, now: Date): Promise<boolean>;
export declare const HEALTH_KEYS: { readonly orphanPayments: "health:orphan_payments"; readonly invariantViolations: "health:invariant_violations" };
export type HealthKey = (typeof HEALTH_KEYS)[keyof typeof HEALTH_KEYS];
export declare function bumpHealth(db: Db, key: HealthKey, by: number, now: Date): Promise<void>;
export declare function setHealth(db: Db, key: HealthKey, value: number, now: Date): Promise<void>;
export declare function readHealth(db: Db): Promise<Partial<Record<HealthKey, { value: number; at: Date }>>>;
```

The consume SQL is binding:

```sql
insert into throttle (key, window_start, hits) values ($key, $now::timestamptz, 1)
on conflict (key) do update set
  window_start = case when throttle.window_start <= $now::timestamptz - make_interval(secs => $w::int) then $now::timestamptz else throttle.window_start end,
  hits = case when throttle.window_start <= $now::timestamptz - make_interval(secs => $w::int) then 1 else throttle.hits + 1 end
returning hits
```

`visitor-hash.ts`: `export function ipHash(salt: string, ip: string): string` = `createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32)`.

**Decisions:**

- **Health counters** (orphan payments, invariant violations) are `throttle` rows keyed `health:*`, which the nightly purge never deletes. Spec § 6.4 lists no other table for them.
- **E-mail throttle keys** use an unsalted sha256 (stable across the daily salt rotation). The IP is hashed by the caller with the day's salt (`ipHash`).

### 5.9 `src/lib/db/atomic.ts` (Task 14), full, verified

```ts
/**
 * The one write mechanism of the booking domain (spec § 10). Every multi-row
 * write is ONE `db.batch` = one non-interactive READ COMMITTED transaction:
 * lock first, small statements, every guard followed by a raising assert, ids
 * made in JS, rows marked by the action id `aid`, the clock passed in as $now.
 * No server-only: the actions, the seed and the DB tests all use it.
 */
import { nanoid } from "nanoid";
import { sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import type { Actor, EngineErrorCode } from "@/lib/tickets";
import type * as schema from "./schema";
import { mapDbError } from "./map-db-error";

export type Db = NeonHttpDatabase<typeof schema>;
export type Query = BatchItem<"pg">;
/** What `plan()` returns once its reads are done: the batch for one action id. */
export type BuildBatch = (aid: string) => Query[];
/** Shared by every fragment builder of one batch. */
export type BatchCtx = { db: Db; aid: string; now: Date };
export type AtomicOk = { aid: string; results: unknown[] };
export type AssertCode = EngineErrorCode | "already_paid";
export type ActorRef = { actor: Actor; userId: string | null };

/** Thrown by a `plan()` read that already knows the answer (not found, invalid input…). */
export class PlanError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    readonly detail?: string,
  ) {
    super(detail ?? code);
    this.name = "PlanError";
  }
}

export function newActionId(): string {
  return nanoid();
}

/**
 * Runs `plan()` (reads + JS ids), then its batch in one transaction. A 40P01
 * replays the SAME statements once. Every other error is thrown as is.
 */
export async function atomic(
  db: Db,
  plan: () => Promise<BuildBatch>,
  opts: { aid?: string; afterPlan?: () => Promise<void> } = {},
): Promise<AtomicOk> {
  const build = await plan();
  if (opts.afterPlan) await opts.afterPlan();
  const aid = opts.aid ?? newActionId();
  const queries = build(aid);
  if (queries.length === 0) return { aid, results: [] };
  const run = () => db.batch(queries as [Query, ...Query[]]);
  try {
    return { aid, results: await run() };
  } catch (err) {
    if (mapDbError(err, "write").type !== "deadlock") throw err;
    return { aid, results: await run() };
  }
}

export type TryAtomicResult =
  | ({ ok: true } & AtomicOk)
  | { ok: false; code: EngineErrorCode; message?: string }
  | { ok: false; code: "duplicate" };

/**
 * `atomic` + mapping (src/lib/db/map-db-error.ts). PlanError → its code.
 * With `replanOnStale`, a `stale` re-runs `plan()` once: new reads, new ids,
 * new aid (E7 following, E8, ensureHorizon). `afterPlan` (tests only) runs
 * between the FIRST plan and its batch, to stage a deterministic race.
 * Unknown errors (programming errors, other 23505) are rethrown.
 */
export async function tryAtomic(
  db: Db,
  plan: () => Promise<BuildBatch>,
  opts: { ctx?: "write" | "delete"; replanOnStale?: boolean; afterPlan?: () => Promise<void> } = {},
): Promise<TryAtomicResult> {
  const ctx = opts.ctx ?? "write";
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await atomic(db, plan, { afterPlan: attempt === 0 ? opts.afterPlan : undefined });
      return { ok: true, ...done };
    } catch (err) {
      if (err instanceof PlanError) return { ok: false, code: err.code, message: err.detail };
      const mapped = mapDbError(err, ctx);
      if (mapped.type === "duplicate") return { ok: false, code: "duplicate" };
      if (mapped.type !== "code") throw err;
      if (mapped.code === "stale" && opts.replanOnStale && attempt === 0) continue;
      return { ok: false, code: mapped.code };
    }
  }
}

/* ───────────────────────── Parameter helpers ───────────────────────── */

/** A Date as a timestamptz parameter (`$n::timestamptz`). */
export function ts(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

/** Strings as ONE text[] parameter. A bare JS array would expand to ($1, $2…). */
export function textArray(values: readonly string[]): SQL {
  return sql`${sql.param([...values])}::text[]`;
}

/** Dates as ONE timestamptz[] parameter. */
export function tsArray(values: readonly Date[]): SQL {
  return sql`${sql.param(values.map((d) => d.toISOString()))}::timestamptz[]`;
}

/** YYYY-MM-DD keys as ONE date[] parameter. */
export function dateArray(keys: readonly string[]): SQL {
  return sql`${sql.param([...keys])}::date[]`;
}

/* ───────────────────────── Statements ───────────────────────── */

/** `select skedul_assert(pred, code)`: raises P0001 `skedul:<code>` unless pred IS TRUE. */
export function G(db: Db, pred: SQL, code: AssertCode): Query {
  return db.execute(sql`select skedul_assert((${pred})::boolean, ${code}::text)`);
}

export type LockTable = "professional" | "event" | "occurrence" | "customer" | "booking" | "ticket_purchase";

/**
 * `select id from <table> where id = any($ids) order by id for no key update`.
 * Global order (spec § 10): professional → event → occurrence → customer →
 * booking → purchase → ticket; ascending id inside a table.
 */
export function lockRows(db: Db, table: LockTable, ids: readonly string[]): Query {
  const sorted = [...new Set(ids)].sort();
  return db.execute(
    sql`select id from ${sql.identifier(table)} where id = any(${textArray(sorted)}) order by id for no key update`,
  );
}

/** R(o): lazy release of elapsed holds on an occurrence this batch already locked. */
export function R(c: BatchCtx, occurrenceId: string): Query {
  return c.db.execute(sql`
    update booking set status = 'expired', ended_at = ${ts(c.now)}, ended_by = 'system',
      ended_action_id = ${c.aid}, updated_at = ${ts(c.now)}
    where occurrence_id = ${occurrenceId} and status = 'pending' and hold_expires_at < ${ts(c.now)}`);
}

/** rel(o): bookings of o ended by this action, evaluated INSIDE the SEAT statement. */
export function rel(c: BatchCtx, occurrenceId: string): SQL {
  return sql`(select count(*)::int from booking where occurrence_id = ${occurrenceId} and ended_action_id = ${c.aid})`;
}

/**
 * SEAT(o, delta): seats_taken += delta − rel(o). Called ONCE per occurrence and
 * action, after every booking end on o in this batch. An RDV falling to 0 seats
 * is cancelled. occurrence_seats_chk raises `full`. `extraSeat` (pro « +1
 * place », event séances only) raises capacity to fit.
 */
export function SEAT(c: BatchCtx, occurrenceId: string, delta: -1 | 0 | 1, opts: { extraSeat?: boolean } = {}): Query {
  const next = sql`(seats_taken + ${delta}::int - ${rel(c, occurrenceId)})`;
  return c.db.execute(sql`
    update occurrence set
      seats_taken = ${next},
      capacity = ${opts.extraSeat ? sql`greatest(capacity, ${next})` : sql`capacity`},
      capacity_override = ${opts.extraSeat ? sql`(capacity_override or ${next} > capacity)` : sql`capacity_override`},
      status = case when event_id is null and ${next} <= 0 then 'cancelled'::occurrence_status else status end,
      cancelled_at = case when event_id is null and ${next} <= 0 then coalesce(cancelled_at, ${ts(c.now)}) else cancelled_at end,
      updated_at = ${ts(c.now)}
    where id = ${occurrenceId}`);
}

/**
 * RET(aid): ONCE per action, gives back the tickets of every booking ended by
 * this action (→ available, or expired if past expires_at), one `return`
 * movement per ticket, in one statement.
 */
export function RET(c: BatchCtx, by: ActorRef): Query {
  return c.db.execute(sql`
    with u as (
      update ticket t set
        status = case when t.expires_at is not null and t.expires_at <= ${ts(c.now)}
          then 'expired'::ticket_status else 'available'::ticket_status end,
        booking_id = null, status_changed_at = ${ts(c.now)}, updated_at = ${ts(c.now)}
      from booking b
      where t.booking_id = b.id and b.ended_action_id = ${c.aid}
      returning t.id, t.professional_id, t.customer_id, t.ticket_type_id, t.purchase_id, t.status, b.id as booking_id
    )
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status,
      to_status, ticket_type_id, booking_id, purchase_id, actor, actor_user_id, created_at)
    select professional_id, customer_id, id, ${c.aid}, 'return', 'booked', status,
      ticket_type_id, booking_id, purchase_id, ${by.actor}::actor, ${by.userId}, ${ts(c.now)}
    from u`);
}

/**
 * Aggregate seat release (E4 step 3, sweepHolds): for every occurrence with
 * bookings ended by this action, seats_taken −= N; an RDV at 0 is cancelled.
 * Never combine with SEAT on the same occurrence in one action.
 */
export function releaseEndedSeats(c: BatchCtx): Query {
  return c.db.execute(sql`
    update occurrence o set
      seats_taken = o.seats_taken - r.n,
      status = case when o.event_id is null and o.seats_taken - r.n <= 0 then 'cancelled'::occurrence_status else o.status end,
      cancelled_at = case when o.event_id is null and o.seats_taken - r.n <= 0 then coalesce(o.cancelled_at, ${ts(c.now)}) else o.cancelled_at end,
      updated_at = ${ts(c.now)}
    from (select occurrence_id, count(*)::int as n from booking where ended_action_id = ${c.aid} group by occurrence_id) r
    where o.id = r.occurrence_id`);
}
```

**Tests (`atomic.db.test.ts`):**

- G false rolls back an insert from earlier in the same batch.
- PlanError maps to its code.
- `replanOnStale` re-runs `plan` exactly once: count the plan calls.
- `afterPlan` runs once, before the first batch only.
- `textArray` binds one parameter: a row outside the array is untouched.
- R/SEAT/RET on hand-made rows: an RDV at 0 seats becomes `cancelled`; RET writes one `return` movement per ticket, and an expired ticket goes to `expired`.

### 5.10 `src/lib/db/map-db-error.ts` (Task 14), full, verified

```ts
/**
 * Postgres error → engine outcome (spec § 10 table). Pure; reads both error
 * shapes through pgErrorInfo (in batch: NeonDbError; outside: DrizzleQueryError.cause).
 */
import { isEngineErrorCode, type EngineErrorCode } from "@/lib/tickets";

import { pgErrorInfo, skedulCode } from "./pg-error";

export type MappedDbError =
  | { type: "code"; code: EngineErrorCode }
  /** skedul:already_paid: a duplicate fulfillment, a success without effect. */
  | { type: "duplicate" }
  /** 40P01: atomic() replays the same batch once. */
  | { type: "deadlock" }
  /** Anything else (incl. 23505 other than booking_active_uq): rethrow. */
  | { type: "unknown" };

/** Named CHECKs with their own code; every other named CHECK maps to `invalid`. */
export const CHECK_CODES: Readonly<Record<string, EngineErrorCode>> = {
  occurrence_seats_chk: "full",
  ticket_retire_paid_chk: "retire_paid",
};

export function mapDbError(err: unknown, ctx: "write" | "delete"): MappedDbError {
  const info = pgErrorInfo(err);
  switch (info.code) {
    case "P0001": {
      const code = skedulCode(err);
      if (code === "already_paid") return { type: "duplicate" };
      return code && isEngineErrorCode(code) ? { type: "code", code } : { type: "unknown" };
    }
    case "23514":
      return { type: "code", code: (info.constraint && CHECK_CODES[info.constraint]) || "invalid" };
    case "23505":
      return info.constraint === "booking_active_uq"
        ? { type: "code", code: "already_booked" }
        : { type: "unknown" };
    case "23P01":
      return info.constraint === "occurrence_rdv_excl"
        ? { type: "code", code: "slot_taken" }
        : { type: "unknown" };
    case "23503":
      return { type: "code", code: ctx === "delete" ? "in_use" : "stale" };
    case "40P01":
      return { type: "deadlock" };
    default:
      return { type: "unknown" };
  }
}
```

**Pure tests** use fake errors shaped like `{ code, constraint, message }` and also wrapped as `{ message, cause: {…} }`. They cover every row of the spec § 10 table, an unknown skedul code, and `ticket_movement_action_ticket_uq` → unknown.

### 5.11 `src/lib/booking/types.ts` (Task 16), decl plus two helpers

```ts
import type { EngineErrorCode } from "@/lib/tickets";
export type Effect =
  | { type: "email.booking_confirmed"; bookingId: string }
  | { type: "email.pro_new_booking"; bookingId: string }
  | { type: "email.booking_cancelled"; bookingId: string; by: "client" | "pro" }
  | { type: "email.pro_booking_cancelled"; bookingId: string }
  | { type: "email.occurrence_cancelled"; occurrenceId: string; bookingIds: string[] }
  | { type: "email.occurrence_changed"; occurrenceId: string; bookingIds: string[] }
  | { type: "email.attendee_moved"; bookingId: string; fromOccurrenceId: string }
  | { type: "email.purchase_receipt"; purchaseId: string }
  | { type: "email.late_payment"; purchaseId: string }
  | { type: "email.tickets_offered"; customerId: string; actionId: string; quantity: number }
  | { type: "google.sync_occurrence"; occurrenceId: string }
  | { type: "stripe.expire_session"; purchaseId: string; checkoutSessionId: string };
export type EngineOk<T extends object = object> = { ok: true; effects: Effect[] } & T;
export type EngineFail = { ok: false; code: EngineErrorCode; message?: string };
export type EngineResult<T extends object = object> = EngineOk<T> | EngineFail;
export type ProActor = { professionalId: string; userId: string };
/** Deduplicated google.sync_occurrence effects. */
export declare function syncEffects(occurrenceIds: readonly string[]): Effect[];
export declare function fail(code: EngineErrorCode, message?: string): EngineFail;
```

**Rule:** effects carry ids only. `notify.ts` (P3/P4) re-reads names, dates and amounts.

### 5.12 `src/lib/booking/answers.ts`, `eligibility.ts`, `holds.ts` (Task 16), decl

```ts
// answers.ts
import type { BatchCtx, Db, Query } from "@/lib/db/atomic";
import type { AnswerInput, QuestionType } from "@/lib/tickets";
export type QuestionRow = { id: string; label: string; type: QuestionType; options: string[] | null; required: boolean; position: number };
export type AnswerRow = { questionId: string; questionLabel: string; value: string };
export declare function loadQuestions(db: Db, owner: { eventId: string } | { ticketTypeId: string }): Promise<QuestionRow[]>;
/** trimmed; empty → skipped; required only when enforceRequired; choice ∈ options; boolean ∈ {"Oui","Non"}; unknown questionId → invalid ("Merci de répondre à : <label>" for a missing required one). */
export declare function buildAnswers(questions: readonly QuestionRow[], answers: readonly AnswerInput[] | undefined, opts: { enforceRequired: boolean }): { ok: true; rows: AnswerRow[] } | { ok: false; message: string };
/** One multi-row builder INSERT into booking_answer (nanoid ids, created_at/updated_at = now); [] when no rows. */
export declare function insertAnswers(c: BatchCtx, args: { professionalId: string; bookingId: string; rows: readonly AnswerRow[] }): Query[];

// eligibility.ts
import type { SQL } from "drizzle-orm";
import type { ActorRef, BatchCtx, Db, Query } from "@/lib/db/atomic";
/** Aliases t = ticket, tt = its ticket_type, o = occurrence, e = event LEFT JOINed on o.event_id. */
export declare const ELIGIBLE: SQL;
export declare function pickTicket(args: { customerId: string; occurrenceId: string; ticketId?: string | null }): SQL;
export declare function spendTicket(c: BatchCtx, args: { bookingId: string; customerId: string; occurrenceId: string; ticketId?: string | null; by: ActorRef }): Query;
export declare function assertSpent(c: BatchCtx, bookingId: string): Query;
export declare function usableTickets(db: Db, args: { customerId: string; occurrenceId: string }): Promise<{ id: string; ticketTypeId: string; expiresAt: Date | null; purchaseId: string | null }[]>;

// holds.ts
import type { SQL } from "drizzle-orm";
import type { BatchCtx, Query } from "@/lib/db/atomic";
export declare function holdExpiry(now: Date): Date;
export declare function checkoutExpiry(now: Date, kind: "buybook" | "shop"): Date;
export declare function assertHoldQuota(c: BatchCtx, customerId: string): Query;
export declare function expireElapsedHolds(c: BatchCtx, occurrenceIds: SQL): Query;
/** capacity − seatsTaken + elapsedHolds, never below 0. */
export declare function seatsShown(o: { capacity: number; seatsTaken: number; elapsedHolds: number }): number;
```

**Binding SQL.** `ELIGIBLE` is raw SQL with no parameters:

```sql
t.status = 'available' and tt.archived_at is null
and (t.expires_at is null or t.expires_at > o.starts_at)
and (
  (o.event_id is not null and e.booking_mode = 'tickets'
    and exists (select 1 from event_ticket_type l where l.event_id = o.event_id and l.ticket_type_id = t.ticket_type_id))
  or (o.event_id is null and o.ticket_type_id = t.ticket_type_id and tt.rdv_enabled and not tt.rdv_free)
)
```

`pickTicket`:

```sql
(select t.id from ticket t
  join ticket_type tt on tt.id = t.ticket_type_id
  join occurrence o on o.id = $occurrenceId
  left join event e on e.id = o.event_id
  where t.customer_id = $customerId and <ELIGIBLE> [and t.id = $ticketId]
  order by t.expires_at asc nulls last, t.created_at, t.id
  limit 1
  for no key update of t skip locked)
```

`spendTicket`:

```sql
with u as (
  update ticket set status = 'booked', booking_id = $bookingId, status_changed_at = $now, updated_at = $now
  where id = <pickTicket> and status = 'available'
  returning id, professional_id, customer_id, ticket_type_id, purchase_id
)
insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status,
  to_status, ticket_type_id, booking_id, purchase_id, actor, actor_user_id, created_at)
select professional_id, customer_id, id, $aid, 'spend', 'available', 'booked',
  ticket_type_id, $bookingId, purchase_id, $actor::actor, $userId, $now
from u
```

The booking INSERT must precede `spendTicket` in the batch (FK).

`assertSpent` = `G(exists(select 1 from ticket where booking_id = $bid), 'no_ticket')`.

`assertHoldQuota` = `G((select count(*)::int from booking where customer_id = $c and status = 'pending' and hold_expires_at > $now) < 2, 'too_many_holds')`.

**Decision:** the hold quota counts only live holds (`hold_expires_at > $now`). Elapsed but not yet swept holds don't block.

### 5.13 `src/lib/booking/catalog.ts` (Task 17), decl

**Decision:** this module is added because the seed, bootstrap-content (§ 15.4) and P3 must create catalog rows "through the engine".

```ts
import type { Db } from "@/lib/db/atomic";
import type { AvailabilityRuleInput, BookingSettings, OfferInput, QuestionInput, TicketTypeInput } from "@/lib/tickets";
import type { EngineResult } from "./types";
export declare function createTicketType(db: Db, input: { professionalId: string; type: TicketTypeInput }, now?: Date): Promise<EngineResult<{ ticketTypeId: string }>>;
export declare function updateTicketType(db: Db, input: { professionalId: string; ticketTypeId: string; type: TicketTypeInput }, now?: Date): Promise<EngineResult>;
export declare function setTicketTypeArchived(db: Db, input: { professionalId: string; ticketTypeId: string; archived: boolean }, now?: Date): Promise<EngineResult>;
/** DELETE; 23503 (ctx 'delete' → in_use) archives instead. */
export declare function deleteTicketType(db: Db, input: { professionalId: string; ticketTypeId: string }, now?: Date): Promise<EngineResult<{ outcome: "deleted" | "archived" }>>;
export declare function createOffer(db: Db, input: { professionalId: string; offer: OfferInput }, now?: Date): Promise<EngineResult<{ offerId: string }>>;
/** ticketTypeId immutable (ignored). */
export declare function updateOffer(db: Db, input: { professionalId: string; offerId: string; offer: OfferInput }, now?: Date): Promise<EngineResult>;
/** DELETE; 23503 (already bought) → archived_at. */
export declare function deleteOffer(db: Db, input: { professionalId: string; offerId: string }, now?: Date): Promise<EngineResult<{ outcome: "deleted" | "archived" }>>;
/** One batch: delete then insert the global (ticketTypeId null) or the type's rules. */
export declare function setAvailabilityRules(db: Db, input: { professionalId: string; ticketTypeId: string | null; rules: AvailabilityRuleInput[] }, now?: Date): Promise<EngineResult>;
/** One batch: update kept ids, delete missing, insert new; answers keep question_label (SET NULL FK). */
export declare function setTypeQuestions(db: Db, input: { professionalId: string; ticketTypeId: string; questions: QuestionInput[] }, now?: Date): Promise<EngineResult>;
export declare function updateBookingSettings(db: Db, input: { professionalId: string; settings: BookingSettings }, now?: Date): Promise<EngineResult>;
/** Any ticket_type, event, customer or time_off row for the pro. */
export declare function hasDomainData(db: Db, professionalId: string): Promise<boolean>;
```

**Invariants:**

- Every statement filters `professional_id`.
- zod failure → `{ ok:false, code:'invalid', message: issues[0].message }`.
- Offers on an archived type → `not_found`.

### 5.14 `src/lib/booking/occurrences.ts` (Task 18), decl

```ts
import type { DateKey } from "@/lib/civil-date";
import type { BatchCtx, Db, Query } from "@/lib/db/atomic";
import type { event } from "@/lib/db/schema";
import type { RecurrenceRule } from "@/lib/recurrence";
import type { EventInput } from "@/lib/tickets";
import type { EngineResult } from "./types";
export type EventRow = typeof event.$inferSelect;
export type OccurrenceDraft = { id: string; seriesDate: DateKey; startsAt: Date; endsAt: Date };
export declare function ruleOf(e: EventRow): RecurrenceRule;
export declare function horizonEnd(now: Date, tz: string): DateKey;
export declare function needsHorizon(minGeneratedUntil: DateKey | null, now: Date, tz: string): boolean;
export declare function draftOccurrences(rule: RecurrenceRule, tz: string, from: DateKey, to: DateKey, maxRows: number): { drafts: OccurrenceDraft[]; generatedUntil: DateKey };
export declare function insertOccurrences(c: BatchCtx, args: { professionalId: string; eventId: string; capacity: number; drafts: readonly OccurrenceDraft[]; guardVersion?: number }): Query;
export declare function createEvent(db: Db, input: { professionalId: string; event: EventInput }, now?: Date): Promise<EngineResult<{ eventId: string; occurrenceCount: number }>>;
export declare function ensureHorizon(db: Db, professionalId: string, now?: Date, opts?: { afterPlan?: () => Promise<void> }): Promise<EngineResult<{ inserted: number; complete: boolean }>>;
export declare function minGeneratedUntil(db: Db, professionalId: string, now?: Date): Promise<DateKey | null>;
```

`insertOccurrences` SQL (binding):

```sql
insert into occurrence (id, professional_id, event_id, series_date, starts_at, ends_at, block_start, block_end,
  capacity, seats_taken, status, created_at, updated_at)
select v.id, $pro, $event, v.d, v.s, v.e, v.s, v.e, $capacity::int, 0, 'scheduled', $now, $now
from unnest($ids::text[], $dates::date[], $starts::timestamptz[], $ends::timestamptz[]) as v(id, d, s, e)
[where exists (select 1 from event where id = $event and version = $v::int and archived_at is null
              and (until_date is null or v.d <= until_date))]
on conflict (event_id, series_date) do nothing
```

**`createEvent`:** one batch.

1. `INSERT event` (id, `series_root_id = id`, version 1, `last_action_id = aid`, `generated_until`).
2. `INSERT event_ticket_type … SELECT $e, id, $p, $now FROM ticket_type WHERE id = any($ids) AND professional_id = $p`.
3. `G((select count(*)::int from event_ticket_type where event_id = $e) = n, 'invalid')`.
4. Questions (builder insert, JS ids).
5. `insertOccurrences`.

The expansion runs from `start_date` to `min(lastSeriesDate, today + MATERIALIZE_DAYS)`, capped at `MATERIALIZE_MAX_ROWS`.

**`ensureHorizon`:** at most 450 rows in total per call, events in id order.

### 5.15 `src/lib/booking/wallet.ts` (part 1 in Task 19, part 2 in Task 29), decl

```ts
import type { Db } from "@/lib/db/atomic";
import type { TicketCloseReason } from "@/lib/tickets";
import type { TypeFacts } from "@/lib/wallet-rules";
import type { EngineResult } from "./types";
/* Task 19 */
export declare function upsertCustomer(db: Db, input: { professionalId: string; email: string; name: string; phone?: string | null; userId?: string | null }, now?: Date): Promise<{ customerId: string }>;
export declare function createCustomer(db: Db, input: { professionalId: string; name: string; email: string; phone?: string | null }, now?: Date): Promise<EngineResult<{ customerId: string; created: boolean }>>;
export declare function updateCustomer(db: Db, input: { professionalId: string; customerId: string; name: string; phone: string | null }, now?: Date): Promise<EngineResult>;
export declare function revokeLinks(db: Db, input: { professionalId: string; customerId: string }, now?: Date): Promise<EngineResult<{ linkVersion: number }>>;
export declare function offerTickets(db: Db, input: { professionalId: string; actorUserId: string; customerId: string; ticketTypeId: string; quantity: number; expiresAt: Date | null; reason?: string | null; notify: boolean }, now?: Date): Promise<EngineResult<{ ticketIds: string[] }>>;
export declare function walletBalance(db: Db, input: { professionalId: string; customerId: string }, now?: Date): Promise<{ ticketTypeId: string; usable: number; nextExpiry: Date | null }[]>;
/* Task 29 */
export type TicketSelection = { ticketIds: string[] } | { ticketTypeId: string; quantity: number };
export declare function convertTickets(db: Db, input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection; toTicketTypeId: string }, now?: Date, opts?: { afterPlan?: () => Promise<void> }): Promise<EngineResult<{ ticketIds: string[] }>>;
export declare function closeTickets(db: Db, input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection; reason: TicketCloseReason; note?: string | null }, now?: Date): Promise<EngineResult<{ ticketIds: string[] }>>;
export declare function pointTickets(db: Db, input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection; note?: string | null }, now?: Date): Promise<EngineResult<{ ticketIds: string[] }>>;
export declare function unpointTickets(db: Db, input: { professionalId: string; actorUserId: string; customerId: string; selection: TicketSelection }, now?: Date): Promise<EngineResult<{ ticketIds: string[] }>>;
export declare function moveAttendee(db: Db, input: { professionalId: string; actorUserId: string; bookingId: string; targetOccurrenceId: string; force: boolean }, now?: Date): Promise<EngineResult<{ fromOccurrenceId: string }>>;
export declare function loadTypeFacts(db: Db, professionalId: string, now?: Date): Promise<TypeFacts[]>;
```

**E8 pattern:**

- Pick ids in JS, in `consumptionOrder`. Unpoint picks the most recently used first.
- One statement: `WITH u AS (UPDATE ticket … WHERE professional_id = $p AND customer_id = $c AND id = any($ids) AND <expected state> RETURNING …) INSERT INTO ticket_movement (…) SELECT … FROM u`.
- Then `G((select count(*)::int from ticket_movement where action_id = $aid) = N, 'stale')`.
- The functions in Task 29 re-plan once on stale (`replanOnStale`). After the re-plan, if fewer than N tickets qualify, return `no_ticket`.
- `upsertCustomer` is a single statement, exactly as spec E1.

**Decisions:**

- **Unpoint** returns a ticket to `expired` when past `expires_at`, like RET. The movement `to_status` is the resulting status.
- **Close with reason `autre`** requires a note, else `invalid`.
- **Explicit-id selection with `retire`** does not filter `purchase_id`, so the CHECK fires (`retire_paid`, T9). Type selection only picks offered tickets.

### 5.16 `src/lib/booking/claims.ts` (Tasks 20, 23, 24), decl

```ts
import type { Db } from "@/lib/db/atomic";
import type { AnswerInput, BookingCoverage, BookingStatus } from "@/lib/tickets";
import type { EngineResult } from "./types";
type ClientClaimBase = { professionalId: string; occurrenceId: string; customerId: string; seenStartsAt: Date; answers?: AnswerInput[]; customerNotes?: string | null };
export type BuyAndBookInput = ClientClaimBase & { offerId: string };
export type BuyAndBookData = { purchaseId: string; bookingId: string; checkoutExpiresAt: Date; amountCents: number; currency: string; label: string; quantity: number; ticketTypeName: string };
/* Task 20 */
export declare function startBuyAndBook(db: Db, input: BuyAndBookInput, now?: Date): Promise<EngineResult<BuyAndBookData>>;
export declare function attachCheckoutSession(db: Db, input: { purchaseId: string; checkoutSessionId: string; checkoutUrl: string }, now?: Date): Promise<EngineResult>;
/** « Reprendre le paiement »: the customer's active booking on the occurrence, with its pending purchase if any. */
export declare function activeBookingOf(db: Db, input: { occurrenceId: string; customerId: string }): Promise<{ bookingId: string; status: BookingStatus; purchaseId: string | null; checkoutUrl: string | null } | null>;
/* Task 23 */
export declare function bookWithHeldTicket(db: Db, input: ClientClaimBase & { actorUserId: string | null }, now?: Date): Promise<EngineResult<{ bookingId: string; ticketId: string }>>;
export declare function registerFree(db: Db, input: ClientClaimBase, now?: Date): Promise<EngineResult<{ bookingId: string }>>;
export declare function registerPro(db: Db, input: { professionalId: string; actorUserId: string; occurrenceId: string; customerId: string; asGuest: boolean; ticketId?: string | null; extraSeat?: boolean; answers?: AnswerInput[] }, now?: Date): Promise<EngineResult<{ bookingId: string; coverage: BookingCoverage; ticketId: string | null }>>;
/* Task 24 */
export type BookRdvInput = { professionalId: string; ticketTypeId: string; startsAt: Date; customerId: string; answers?: AnswerInput[]; customerNotes?: string | null; actorUserId: string | null } & ({ mode: "held_ticket" } | { mode: "free" } | { mode: "buy"; offerId: string });
export declare function bookRdv(db: Db, input: BookRdvInput, now?: Date): Promise<EngineResult<{ occurrenceId: string; bookingId: string; purchaseId: string | null; checkoutExpiresAt: Date | null; amountCents: number | null }>>;
```

**`ONLINE_OK(mode)` predicate** (binding; internal to claims.ts). It is used in `G(…, 'unavailable')` by E1, E2-client and E3:

```sql
exists (
  select 1 from occurrence o
  join event e on e.id = o.event_id
  join professional p on p.id = o.professional_id
  where o.id = $o and o.professional_id = $p and o.status = 'scheduled'
    and e.booking_mode = $mode::booking_mode and not e.is_private and e.archived_at is null
    and o.starts_at >= $now::timestamptz + make_interval(mins => coalesce(e.min_notice_minutes, p.min_notice_minutes))
    and (o.starts_at at time zone p.timezone)::date
        <= ($now::timestamptz at time zone p.timezone)::date + coalesce(e.booking_horizon_days, p.booking_horizon_days)
    and not exists (select 1 from time_off t where t.professional_id = o.professional_id
                    and t.start_at < o.ends_at and t.end_at > o.starts_at)
)
```

**`CHANGED` predicate** = `(select starts_at from occurrence where id = $o) = $seen::timestamptz` → `'changed'`.

**E1 offer guard** (→ `'stale'`):

```sql
exists (
  select 1 from ticket_offer f
  join ticket_type tt on tt.id = f.ticket_type_id
  join occurrence o on o.id = $o
  join event_ticket_type l on l.event_id = o.event_id and l.ticket_type_id = f.ticket_type_id
  where f.id = $offer and f.professional_id = $p and f.is_active and f.archived_at is null and tt.archived_at is null
    and f.price_cents = $price::int and f.quantity = $qty::int
    and f.validity_count is not distinct from $vc::int
    and f.validity_unit is not distinct from $vu::validity_unit
)
```

**`registerPro` guard** (→ `'unavailable'`):

```sql
exists (select 1 from occurrence o join event e on e.id = o.event_id
  where o.id = $o and o.professional_id = $p and o.status = 'scheduled'
    and ($cov = 'guest'
         or ($cov = 'ticket' and e.booking_mode = 'tickets')
         or ($cov = 'free' and e.booking_mode = 'free')))
```

**E4 guards:**

- Type (→ `'unavailable'`): `exists (select 1 from ticket_type tt where tt.id = $tt and tt.professional_id = $p and tt.rdv_enabled and tt.archived_at is null and tt.rdv_free = $isFree::boolean)`.
- Slot (→ `'slot_taken'`):
  - no scheduled event séance with `tstzrange(block_start, block_end) && tstzrange($bs, $be)`;
  - no `time_off` with `start_at < $be and end_at > $bs`;
  - `$starts >= $now + notice` (`coalesce(tt.rdv_min_notice_minutes, p.min_notice_minutes)`);
  - local-date horizon (`coalesce(tt.rdv_booking_horizon_days, p.booking_horizon_days)`).
- The RDV occurrence row: `block_start = starts − buffer_before`, `block_end = ends + buffer_after`, `capacity 1`, `seats_taken 1`, `ticket_type_id`, `event_id NULL`, `series_date NULL`.

**Decisions:**

- **E4 slot-grid membership** (`startsAt ∈ computeSlots`) is the P5 action's job, since slot loading is P5. The engine re-asserts everything the DB can check, plus `fitsAvailability` (type rules, else global rules) in the plan.
- **`registerPro`** works on event séances only. A pro RDV is out of scope.
- **Effects:** E2-client, E3, and E4 held/free emit `email.booking_confirmed`, `email.pro_new_booking` and `google.sync_occurrence`. `registerPro` emits no `pro_new_booking`. E1 and E4-buy emit none.

### 5.17 `src/lib/booking/fulfillment.ts` (Task 21), decl

```ts
import type { Db } from "@/lib/db/atomic";
import type { EngineOk, EngineResult } from "./types";
export declare function startPurchase(db: Db, input: { professionalId: string; offerId: string; customerId: string }, now?: Date): Promise<EngineResult<{ purchaseId: string; checkoutExpiresAt: Date; amountCents: number; currency: string; label: string; quantity: number; ticketTypeName: string }>>;
export type PaymentFacts = { sessionId: string | null; paymentIntentId: string | null; livemode: boolean };
export type FulfillOutcome = "fulfilled" | "duplicate" | "orphan";
export declare function fulfillPurchase(db: Db, purchaseId: string, payment: PaymentFacts, now?: Date): Promise<EngineOk<{ outcome: FulfillOutcome; ticketIds: string[]; bookingConfirmed: boolean }>>;
export declare function markProcessing(db: Db, purchaseId: string, now?: Date): Promise<EngineResult>;
```

**E10 batch** (binding):

1. `lockRows(db, "booking", [bookingId])` (only when the plan found a booking).
2. `update ticket_purchase set status='paid', paid_at=$now, livemode=$lm::boolean, checkout_session_id=coalesce($sid, checkout_session_id), payment_intent_id=$pi, fulfilled_action_id=$aid, updated_at=$now where id=$p and status in ('pending','expired')`.
3. `G((select fulfilled_action_id from ticket_purchase where id=$p) = $aid, 'already_paid')`.
4. `update booking set status='confirmed', confirmed_at=$now, updated_at=$now where purchase_id=$p and status='pending'`.
5. The ticket CTE:

```sql
with b as (select id from booking where purchase_id = $p and status = 'confirmed'),
t as (
  insert into ticket (id, professional_id, customer_id, ticket_type_id, purchase_id, status, booking_id,
    expires_at, status_changed_at, created_at, updated_at)
  select x.id, p.professional_id, p.customer_id, p.ticket_type_id, p.id,
    case when x.n = 1 and exists (select 1 from b) then 'booked'::ticket_status else 'available'::ticket_status end,
    case when x.n = 1 then (select id from b) else null end,
    $expiresAt /* ts(…) or sql`null` */, $now, $now, $now
  from unnest($ids::text[]) with ordinality as x(id, n)
  join ticket_purchase p on p.id = $p
  returning id, professional_id, customer_id, ticket_type_id, purchase_id, status, booking_id
)
insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status, to_status,
  ticket_type_id, booking_id, purchase_id, actor, created_at)
select professional_id, customer_id, id, $aid, 'purchase', null, status, ticket_type_id, booking_id, purchase_id, 'system', $now
from t
```

### 5.18 `src/lib/booking/release.ts` (Task 22), decl

```ts
import type { Db } from "@/lib/db/atomic";
import type { EngineResult } from "./types";
export declare function releasePurchase(db: Db, purchaseId: string, now?: Date): Promise<EngineResult<{ released: boolean }>>;
export declare function sweepHolds(db: Db, now?: Date): Promise<{ expiredBookings: number }>;
export declare function expireStalePurchases(db: Db, now?: Date): Promise<{ expired: number }>;
```

**`sweepHolds` lock statement:**

```sql
select o.id from occurrence o
where exists (select 1 from booking b where b.occurrence_id = o.id and b.status = 'pending' and b.hold_expires_at < $now)
order by o.id
for no key update
```

Postgres refuses `FOR NO KEY UPDATE` with `DISTINCT`, hence the `EXISTS`. Then `expireElapsedHolds(c, <same id subquery>)` and `releaseEndedSeats(c)`.

### 5.19 `src/lib/booking/cancel.ts` (Tasks 25, 26), decl

```ts
import type { ActorRef, BatchCtx, Db, Query } from "@/lib/db/atomic";
import type { EngineResult } from "./types";
/* Task 25 */
export declare function cancelByClient(db: Db, input: { professionalId: string; customerId: string; bookingId: string; actorUserId: string | null }, now?: Date): Promise<EngineResult<{ occurrenceId: string; ticketReturned: boolean }>>;
export declare function cancelBookingsByPro(db: Db, input: { professionalId: string; actorUserId: string; occurrenceId: string; bookingIds: string[]; reason?: string | null }, now?: Date): Promise<EngineResult<{ cancelled: number; ticketsReturned: number }>>;
export declare function cancelOccurrence(db: Db, input: { professionalId: string; actorUserId: string; occurrenceId: string }, now?: Date): Promise<EngineResult<{ bookingsCancelled: number; ticketsReturned: number }>>;
export declare function restoreOccurrence(db: Db, input: { professionalId: string; occurrenceId: string }, now?: Date): Promise<EngineResult>;
export declare function endBookings(c: BatchCtx, args: { professionalId: string; scope: { occurrenceIds: readonly string[] } | { occurrenceId: string; bookingIds: readonly string[] }; by: ActorRef; reason?: string | null }): Query;
export declare function cancelOccurrencesQuery(c: BatchCtx, args: { professionalId: string; occurrenceIds: readonly string[] }): Query;
export declare function readEndedByAction(db: Db, aid: string): Promise<{ bookingId: string; occurrenceId: string; purchaseId: string | null; purchasePending: boolean; checkoutSessionId: string | null }[]>;
/* Task 26 */
export type TimeOffConflict = { occurrenceId: string; startsAt: Date; endsAt: Date; title: string; activeBookings: number };
export declare function previewTimeOffConflicts(db: Db, input: { professionalId: string; startAt: Date; endAt: Date }): Promise<TimeOffConflict[]>;
export declare function createTimeOffWithConflicts(db: Db, input: { professionalId: string; actorUserId: string; startAt: Date; endAt: Date; allDay: boolean; reason: string | null; seenOccurrenceIds: string[]; cancelBooked: boolean }, now?: Date, opts?: { afterPlan?: () => Promise<void> }): Promise<EngineResult<{ timeOffId: string; cancelledOccurrences: number }>>;
```

**E5 UPDATE** (binding):

```sql
update booking b set status = 'cancelled', ended_at = $now, ended_by = 'client', ended_action_id = $aid, updated_at = $now
where b.id = $b and b.customer_id = $c and b.occurrence_id = $o and b.status = 'confirmed'
  and exists (
    select 1 from occurrence o
    join professional p on p.id = o.professional_id
    left join event e on e.id = o.event_id
    left join ticket_type tt on tt.id = o.ticket_type_id
    where o.id = b.occurrence_id and o.starts_at > $now
      and (o.starts_at - make_interval(hours => coalesce(e.cancel_deadline_hours, tt.rdv_cancel_deadline_hours, p.cancel_deadline_hours)) > $now
           or o.changed_at > b.created_at
           or b.moved_at is not null))
```

**E6c staleness guard:**

```sql
G((select coalesce(array_agg(o.id order by o.id), '{}'::text[]) from occurrence o
   where o.professional_id = $p and o.status = 'scheduled' and o.seats_taken > 0
     and tstzrange(o.block_start, o.block_end) && tstzrange($start, $end)) = <textArray(sorted seen ids)>, 'stale')
```

**Decision:** time-off overlap uses the block range everywhere (`block = starts/ends` for event séances), the same as the E4 guard.

### 5.20 `src/lib/booking/series.ts` (Tasks 27, 28), decl

```ts
import type { DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import type { SeriesEditSummary } from "@/lib/series-plan";
import type { BookingMode, QuestionInput, RecurrenceRuleInput, WindowOverrides } from "@/lib/tickets";
import type { EngineResult } from "./types";
export type OccurrencePatch = { startsAt?: Date; durationMin?: number; capacity?: number; locationOverride?: string | null };
/* Task 27 */
export declare function updateOccurrence(db: Db, input: { professionalId: string; actorUserId: string; occurrenceId: string; seenStartsAt: Date; patch: OccurrencePatch; unenrollBookingIds?: string[] }, now?: Date): Promise<EngineResult<{ timeChanged: boolean }>>;
export declare function bookingsExpiringBefore(db: Db, input: { professionalId: string; occurrenceId: string; newStartsAt: Date }): Promise<{ bookingId: string; customerName: string; expiresAt: Date }[]>;
export type EventInPlacePatch = { title?: string; description?: string | null; location?: string | null; color?: string; isPrivate?: boolean; bookingMode?: BookingMode; ticketTypeIds?: string[]; questions?: QuestionInput[]; overrides?: WindowOverrides; capacity?: number };
export declare function editEventInPlace(db: Db, input: { professionalId: string; actorUserId: string; eventId: string; seenVersion: number; patch: EventInPlacePatch }, now?: Date): Promise<EngineResult<{ version: number }>>;
/* Task 28 */
export type SeriesEditInput = { professionalId: string; actorUserId: string; eventId: string; seenVersion: number; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number; orphans: "keep" | "cancel" };
export declare function previewSeriesEdit(db: Db, input: Omit<SeriesEditInput, "actorUserId" | "seenVersion" | "orphans">, now?: Date): Promise<EngineResult<{ summary: SeriesEditSummary; remainingCount: number | null; inPlace: boolean }>>;
export declare function editSeriesFrom(db: Db, input: SeriesEditInput, now?: Date, opts?: { afterPlan?: () => Promise<void> }): Promise<EngineResult<{ eventId: string; summary: SeriesEditSummary }>>;
export declare function deleteSeriesFrom(db: Db, input: { professionalId: string; actorUserId: string; eventId: string; seenVersion: number; fromDate: DateKey }, now?: Date): Promise<EngineResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number }>>;
```

**`editSeriesFrom` batch order** (binding; split case):

1. `update event set version = version + 1, last_action_id = $aid, end_mode = 'until', until_date = $dMinus1::date, occurrence_count = null, updated_at = $now where id = $e and version = $v::int` → `G((select last_action_id from event where id = $e) = $aid, 'stale')`.
2. `INSERT event` for the new segment (id `$ne`, same `series_root_id`, new rule, `generated_until = plan.generatedUntil`, version 1, `last_action_id = $aid`). Copy links with `INSERT … SELECT … FROM event_ticket_type WHERE event_id = $e`. Insert questions with JS ids read in the plan.
3. `lockRows`-style: `select id from occurrence where event_id = $e and series_date >= $d::date order by id for no key update`.
4. `update occurrence set event_id = $ne, updated_at = $now where event_id = $e and series_date >= $d::date` → `G((select count(*)::int from occurrence where event_id = $ne) = $plannedRowCount, 'stale')`.
5. Retime from `unnest($ids, $starts, $ends)`:
   - set `starts_at`, `ends_at`, `block_start`, `block_end`;
   - `changed_at = case when o.starts_at <> v.s or o.ends_at <> v.e then $now else o.changed_at end`;
   - `capacity = case when o.capacity_override then o.capacity else greatest($cap::int, o.seats_taken) end`.
6. `delete from occurrence where id = any($del) and seats_taken = 0 and not exists (select 1 from booking b where b.occurrence_id = occurrence.id)` → `G(not exists (select 1 from occurrence where id = any($del)), 'stale')`.
7. cancelEmpty: `update … set status='cancelled', cancelled_at = coalesce(cancelled_at, $now) where id = any($ce) and seats_taken = 0` → `G((select count(*)::int from occurrence where id = any($ce) and status = 'cancelled') = n, 'stale')`. Then orphans: keep → `time_detached = true`; cancel → `cancelOccurrencesQuery` + `endBookings` + G.
8. `insertOccurrences` (no `guardVersion`; the row-count guard already covers it), then `update event set generated_until = $gu where id = $ne`.
9. `RET(pro)` when orphans were cancelled.

**In place** (no row with `series_date < d`): step 1 updates the rule columns of `$e` itself, and steps 2 and 4 are skipped. `tryAtomic(…, { replanOnStale: true })`.

**`deleteSeriesFrom`:**

- If the event never had a booking: `DELETE FROM event WHERE id AND professional_id` (ctx `'write'`; a 23503 → stale → re-plan).
- Else: when `d ≤ start_date`, set `archived_at = $now` instead of `until_date`; otherwise set `until_date = d − 1`.

**Decisions:**

- **`fromDate`** must be ≥ local today, and no affected row may have `starts_at ≤ now`. Otherwise → `invalid`.
- **Orphans kept as isolated séances get no « séance modifiée » e-mail**, since their date, time and place do not change.

### 5.21 `src/lib/booking/nightly.ts`, `account.ts` (Task 30), `revenue.ts`, `invariants.ts` (Task 15), decl

```ts
// nightly.ts
import type { Db } from "@/lib/db/atomic";
export declare function expireTickets(db: Db, now?: Date): Promise<{ expired: number }>;
export declare function ensureAllHorizons(db: Db, now?: Date): Promise<{ pros: number; inserted: number }>;
export declare function archiveFinishedEvents(db: Db, now?: Date): Promise<{ archived: number }>;
export declare function purgeThrottle(db: Db, now?: Date): Promise<{ purged: number }>;
export type NightlyReport = { expiredBookings: number; expiredPurchases: number; expiredTickets: number; horizon: { pros: number; inserted: number }; archivedEvents: number; purgedThrottle: number; invariantViolations: number; errors: string[] };
export declare function runNightly(db: Db, now?: Date): Promise<NightlyReport>;

// account.ts
export declare function pendingCheckoutSessions(db: Db, professionalId: string): Promise<{ purchaseId: string; checkoutSessionId: string }[]>;
export declare function deletionImpact(db: Db, professionalId: string, now?: Date): Promise<{ ticketsInCirculation: number; pendingPayments: number }>;

// revenue.ts
import type { SQL } from "drizzle-orm";
/** status 'paid' AND livemode = live [AND professional_id] [AND paid_at ≥ since]; live = Stripe live keys (caller derives from env). */
export declare function paidPurchaseOf(opts: { live: boolean; professionalId?: string; since?: Date }): SQL;
export declare function revenueByCurrency(db: Db, opts: { live: boolean; professionalId?: string; since?: Date }): Promise<{ currency: string; cents: number }[]>;

// invariants.ts
export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6";
export type InvariantViolation = { invariant: InvariantId; rowId: string; detail: string };
export declare function checkInvariants(db: Db, opts?: { proId?: string }): Promise<InvariantViolation[]>;
```

**Invariant queries.** Each is filtered by `professional_id = $proId` when one is given.

- **I1:** `o.seats_taken <> (select count(*) from booking b where b.occurrence_id = o.id and b.status in ('pending','confirmed'))`.
- **I2a:** a ticket booked whose booking is missing, not confirmed, or not coverage `ticket`.
- **I2b:** a confirmed `ticket` booking with no booked ticket pointing at it.
- **I3:** paid with `count(tickets) <> quantity`, or not paid with any ticket.
- **I4:** a `lateral (… order by m.seq desc limit 1)` last movement whose `to_status <> t.status` or `ticket_type_id <> t.ticket_type_id`, or no movement at all.
- **I5a:** an active booking on a cancelled occurrence. **I5b:** an RDV with `(status = 'scheduled') <> (seats_taken = 1)`.
- **I6:** paid without `paid_at` or `fulfilled_action_id`, or `livemode` without `payment_intent_id`.

### 5.22 Auth (Tasks 31, 32)

**`src/lib/emails/*`**, decl. Every interpolated value goes through `escapeHtml` and `layout` from `@/lib/email-layout`.

```ts
// login-code.ts — subject: `${code} est votre code de connexion Skedul`; title « Votre code de connexion »; « Il est valable 5 minutes. »
export declare function loginCodeEmail(args: { code: string }): { subject: string; html: string };
// verify-email-code.ts — subject: `${code} est votre code de confirmation Skedul`; title « Confirmez votre adresse »
export declare function verifyEmailCodeEmail(args: { code: string }): { subject: string; html: string };
// password-disabled.ts — subject « Votre mot de passe Skedul a été désactivé »; body « Pour votre sécurité, le mot de passe associé à cette adresse a été désactivé ; utilisez « Mot de passe oublié » pour en choisir un. » + link button « Choisir un mot de passe » → forgotPasswordUrl
export declare function passwordDisabledEmail(args: { forgotPasswordUrl: string }): { subject: string; html: string };
// password-reset.ts — moved verbatim from src/lib/email.ts (same output); email.ts: `export { passwordResetEmail } from "@/lib/emails/password-reset";`
export declare function passwordResetEmail(args: { name: string; url: string }): string;
```

**Decision:** the 6-digit code leads the subject. Tests and the auth harness parse it with `/^(\d{6})\b/`.

**`src/lib/auth-options.ts` (Task 32), full, verified** (types precise: `auth.api.banUser` exists and `session.user.role` is `string | null | undefined`):

```ts
/**
 * Better Auth options WITHOUT server-only / env / next: src/lib/auth.ts wraps
 * them with nextCookies(); the seed and the DB tests build their own instance
 * with a `sendEmail` that captures codes (spec § 12).
 */
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { and, eq, isNull, ne } from "drizzle-orm";

import { ADMIN_HTTP_ENDPOINTS, adminPlugin } from "@/lib/auth-admin";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { loginCodeEmail } from "@/lib/emails/login-code";
import { passwordDisabledEmail } from "@/lib/emails/password-disabled";
import { passwordResetEmail } from "@/lib/emails/password-reset";
import { verifyEmailCodeEmail } from "@/lib/emails/verify-email-code";
import { consumeThrottle, otpThrottleKey } from "@/lib/throttle";
import { OTP_EMAIL_LIMIT } from "@/lib/tickets";

export type AuthMail = { to: string; subject: string; html: string };

export type AuthDeps = {
  db: Db;
  baseURL: string;
  secret: string;
  /** Never throws (src/lib/email.ts); tests capture instead of sending. */
  sendEmail: (mail: AuthMail) => Promise<unknown>;
  google?: { clientId: string; clientSecret: string } | null;
  /** Test clock for the per-e-mail code cap; defaults to the real time. */
  now?: () => Date;
  /** Mock e-mail mode: also print the password-reset link. */
  logResetLink?: boolean;
};

export const OTP_SEND_PATH = "/email-otp/send-verification-otp";
export const OTP_SIGN_IN_PATH = "/sign-in/email-otp";
export const OTP_VERIFY_EMAIL_PATH = "/email-otp/verify-email";
/** The only emailOTP endpoints served over HTTP. */
export const OTP_HTTP_PATHS = [OTP_SEND_PATH, OTP_SIGN_IN_PATH, OTP_VERIFY_EMAIL_PATH] as const;

export const OTP_PLUGIN_OPTIONS = {
  otpLength: 6,
  expiresIn: 300,
  allowedAttempts: 3,
  storeOTP: "encrypted",
  resendStrategy: "reuse",
  overrideDefaultEmailVerification: true,
} as const;

/** Every other emailOTP endpoint (reset, change e-mail, check…), derived from the plugin. */
export const OTP_DISABLED_PATHS: string[] = Object.values(
  emailOTP({ ...OTP_PLUGIN_OPTIONS, async sendVerificationOTP() {} }).endpoints,
)
  .map((endpoint) => (endpoint as { path?: string }).path)
  .filter((path): path is string => typeof path === "string")
  .filter((path) => !(OTP_HTTP_PATHS as readonly string[]).includes(path));

export const AUTH_DISABLED_PATHS: string[] = [...ADMIN_HTTP_ENDPOINTS, ...OTP_DISABLED_PATHS];

export const AUTH_RATE_LIMIT = {
  enabled: true,
  storage: "database",
  window: 600,
  max: 6000,
  customRules: {
    [OTP_SEND_PATH]: { window: 600, max: 5 },
    [OTP_SIGN_IN_PATH]: { window: 600, max: 10 },
    [OTP_VERIFY_EMAIL_PATH]: { window: 600, max: 10 },
  },
} as const;

export function buildAuthOptions(deps: AuthDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  const otpPlugin = emailOTP({
    ...OTP_PLUGIN_OPTIONS,
    async sendVerificationOTP({ email, otp, type }) {
      const mail = type === "sign-in" ? loginCodeEmail({ code: otp }) : verifyEmailCodeEmail({ code: otp });
      await deps.sendEmail({ to: email, ...mail });
    },
  });

  return {
    appName: "Skedul",
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendEmail({
          to: user.email,
          subject: "Réinitialisez votre mot de passe Skedul",
          html: passwordResetEmail({ name: user.name, url }),
        });
        if (deps.logResetLink) console.info(`   reset link: ${url}\n`);
      },
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        try {
          await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
        } catch (err) {
          console.error("[auth] could not mark the email verified after reset", err);
        }
      },
    },
    emailVerification: { sendOnSignUp: true },
    socialProviders: deps.google
      ? {
          google: {
            clientId: deps.google.clientId,
            clientSecret: deps.google.clientSecret,
            accessType: "offline",
            prompt: "select_account consent",
          },
        }
      : undefined,
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "client", input: false },
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    rateLimit: AUTH_RATE_LIMIT,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== OTP_SEND_PATH) return;
        const raw = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof raw !== "string") return;
        const allowed = await consumeThrottle(db, otpThrottleKey(raw), OTP_EMAIL_LIMIT, now());
        if (!allowed) return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            if (session.impersonatedBy) return;
            try {
              await db.update(schema.user).set({ lastLoginAt: new Date() }).where(eq(schema.user.id, session.userId));
              const [u] = await db
                .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId));
              if (u?.emailVerified) {
                await db
                  .update(schema.customer)
                  .set({ userId: session.userId })
                  .where(and(eq(schema.customer.email, u.email.toLowerCase()), isNull(schema.customer.userId)));
              }
            } catch (err) {
              console.error("[auth] session hook failed", err);
            }
          },
        },
      },
      user: {
        update: {
          after: async (user, ctx) => {
            if (ctx?.path !== OTP_SIGN_IN_PATH || !user.emailVerified) return;
            try {
              const credential = and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential"));
              const found = await db.select({ id: schema.account.id }).from(schema.account).where(credential);
              if (found.length === 0) return;
              const keep = ctx.context.newSession?.session.id ?? null;
              await db.delete(schema.account).where(credential);
              await db
                .delete(schema.session)
                .where(keep ? and(eq(schema.session.userId, user.id), ne(schema.session.id, keep)) : eq(schema.session.userId, user.id));
              await deps.sendEmail({ to: user.email, ...passwordDisabledEmail({ forgotPasswordUrl: `${deps.baseURL}/forgot-password` }) });
            } catch (err) {
              console.error("[auth] pre-account takeover purge failed", err);
            }
          },
        },
      },
    },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: [adminPlugin, otpPlugin],
  } satisfies BetterAuthOptions;
}
```

**`src/lib/auth.ts` after Task 32**, full:

```ts
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { buildAuthOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const options = buildAuthOptions({
  db,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  sendEmail,
  google: env.GOOGLE_CALENDAR_ENABLED
    ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
    : null,
  logResetLink: !env.RESEND_ENABLED,
});

// nextCookies() must stay the last plugin so it can set cookies in actions.
export const auth = betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] });

export type Session = typeof auth.$Infer.Session;
```

`auth-client.ts` adds `import { emailOTPClient } from "better-auth/client/plugins";` and `plugins: [emailOTPClient()]` in `createAuthClient`.

**`auth-options.test.ts` (pure):**

- `OTP_DISABLED_PATHS` contains `/email-otp/check-verification-otp`, `/email-otp/request-password-reset`, `/forget-password/email-otp`, `/email-otp/reset-password`, `/email-otp/request-email-change` and `/email-otp/change-email`.
- It contains none of `OTP_HTTP_PATHS`.
- `AUTH_DISABLED_PATHS` ⊇ `ADMIN_HTTP_ENDPOINTS`.
- `AUTH_RATE_LIMIT.customRules` values equal spec § 12.

### 5.23 Test harness

`src/test/db.ts` (Task 6), full, verified. Task 15 adds the invariant block marked below.

```ts
/**
 * DB test harness (spec § 14). Run with:
 *   ./node_modules/.bin/tsx --env-file-if-exists=.env.test --test --test-concurrency=1 'src/**\/*.db.test.ts'
 * Skips when DATABASE_URL_TEST is unset; refuses to run when DATABASE_URL and
 * DATABASE_URL_TEST point at different hosts; builds the client only after
 * those guards. Each dbTest creates its own pro and deletes its user at the end
 * (the deleteUser cascade, rule R2), after checking I1–I6 for that pro.
 */
import test, { type TestContext } from "node:test";
import { nanoid } from "nanoid";

import type { Db } from "../lib/db/atomic";

export const DB_SKIP: string | false = process.env.DATABASE_URL_TEST
  ? false
  : "DATABASE_URL_TEST is not set (.env.test)";

/** Pure guard, unit-tested in src/test/db-guard.test.ts. */
export function sameHost(a: string, b: string): boolean {
  return new URL(a).host === new URL(b).host;
}

let dbPromise: Promise<Db> | null = null;

export function getTestDb(): Promise<Db> {
  dbPromise ??= (async () => {
    const testUrl = process.env.DATABASE_URL_TEST;
    const url = process.env.DATABASE_URL;
    if (!testUrl) throw new Error("DATABASE_URL_TEST is not set");
    if (!url || !sameHost(url, testUrl)) {
      throw new Error("Refusing to run: DATABASE_URL and DATABASE_URL_TEST point at different hosts.");
    }
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const schema = await import("../lib/db/schema");
    return drizzle({ client: neon(testUrl), schema });
  })();
  return dbPromise;
}

export type TestPro = { userId: string; proId: string; slug: string; tz: string; currency: string };

/** A pro (user role pro, e-mail verified) with default booking settings, Europe/Paris, eur. */
export async function createTestPro(db: Db, opts: { tz?: string } = {}): Promise<TestPro> {
  const schema = await import("../lib/db/schema");
  const tag = nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const userId = nanoid();
  const proId = nanoid();
  const tz = opts.tz ?? "Europe/Paris";
  await db.insert(schema.user).values({
    id: userId,
    name: `Pro ${tag}`,
    email: `pro-${tag}@skedul.test`,
    emailVerified: true,
    role: "pro",
  });
  await db.insert(schema.professional).values({
    id: proId,
    userId,
    slug: `t-${tag}`,
    businessName: `Test ${tag}`,
    timezone: tz,
    currency: "eur",
  });
  return { userId, proId, slug: `t-${tag}`, tz, currency: "eur" };
}

/** The deleteUser path: one DELETE FROM "user" (everything cascades from professional). */
export async function deleteTestUser(db: Db, userId: string): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`delete from "user" where id = ${userId}`);
}

export type DbHarness = { db: Db; pro: TestPro };

/**
 * node:test wrapper: skip without DATABASE_URL_TEST; fresh pro per test;
 * after `fn`: checkInvariants({ proId }) must be [] (wired by Task 15), then
 * the user is deleted (even when fn threw).
 */
export function dbTest(
  name: string,
  fn: (h: DbHarness, t: TestContext) => Promise<void>,
  opts: { timeout?: number; invariants?: boolean } = {},
): void {
  test(name, { skip: DB_SKIP, timeout: opts.timeout ?? 120_000 }, async (t) => {
    const db = await getTestDb();
    const pro = await createTestPro(db);
    try {
      await fn({ db, pro }, t);
      // Task 15 inserts here:
      // if (opts.invariants !== false) {
      //   const { checkInvariants } = await import("../lib/booking/invariants");
      //   assert.deepEqual(await checkInvariants(db, { proId: pro.proId }), [], "invariants I1–I6");
      // }
    } finally {
      await deleteTestUser(db, pro.userId);
    }
  });
}

/** Settles every promise; the caller counts outcomes (concurrency tests). */
export function inParallel<T>(fns: readonly (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(fns.map((f) => f()));
}

export const addMinutes = (d: Date, n: number): Date => new Date(d.getTime() + n * 60_000);
export const addDaysMs = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** Unique lower-case test address (never collides across runs: rate limits and throttle rows persist). */
export function testEmail(tag = "c"): string {
  return `t-${tag}-${nanoid(8)}@skedul.test`.toLowerCase();
}

/** A random IP in 198.18.0.0/15 (benchmark range): one Better Auth rate-limit bucket per call. */
export function testIp(): string {
  const n = Math.floor(Math.random() * 131_072);
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
}
```

Task 15 also adds `import assert from "node:assert/strict";` at the top.

**`src/test/fixtures.ts` (Task 19), decl:**

```ts
import type { DateKey } from "../lib/civil-date";
import type { Db } from "../lib/db/atomic";
import type { booking, occurrence, ticket } from "../lib/db/schema";
import type { BookingMode, OfferInput, RecurrenceRuleInput, TicketTypeInput } from "../lib/tickets";
import type { TestPro } from "./db";
export type OccurrenceRow = typeof occurrence.$inferSelect;
export type BookingRow = typeof booking.$inferSelect;
export type TicketRow = typeof ticket.$inferSelect;
export declare function dayIn(pro: TestPro, days: number, now?: Date): DateKey;
/** createTicketType with { name: "Type <nanoid>" } + overrides; throws on failure. */
export declare function makeType(db: Db, pro: TestPro, over?: Partial<TicketTypeInput>): Promise<string>;
/** createOffer with { quantity 1, priceCents 2500 } + overrides; throws on failure. */
export declare function makeOffer(db: Db, pro: TestPro, ticketTypeId: string, over?: Partial<OfferInput>): Promise<string>;
/** createEvent: tickets mode, capacity 12, 60 min, once on dayIn(pro, 3) at 600 + overrides; occurrences by starts_at. */
export declare function makeEvent(db: Db, pro: TestPro, over?: { title?: string; bookingMode?: BookingMode; capacity?: number; durationMin?: number; isPrivate?: boolean; ticketTypeIds?: string[]; rule?: Partial<RecurrenceRuleInput> }, now?: Date): Promise<{ eventId: string; occurrences: OccurrenceRow[] }>;
export declare function makeCustomer(db: Db, pro: TestPro, over?: { name?: string; email?: string }): Promise<string>;
export declare function giveTickets(db: Db, pro: TestPro, customerId: string, ticketTypeId: string, quantity: number, opts?: { expiresAt?: Date | null; now?: Date }): Promise<string[]>;
export declare function occurrencesOf(db: Db, eventId: string): Promise<OccurrenceRow[]>;
export declare function getOccurrence(db: Db, id: string): Promise<OccurrenceRow>;
export declare function getBooking(db: Db, id: string): Promise<BookingRow>;
export declare function ticketsOf(db: Db, customerId: string): Promise<TicketRow[]>;
export declare function movementsOf(db: Db, ticketId: string): Promise<{ kind: string; fromStatus: string | null; toStatus: string; actionId: string }[]>;
```

**`src/test/auth.ts` (Task 33), decl:**

```ts
import type { betterAuth } from "better-auth";
import type { AuthMail } from "../lib/auth-options";
import type { Db } from "../lib/db/atomic";
export const TEST_BASE_URL = "http://localhost:3000";
export type TestAuth = { auth: ReturnType<typeof betterAuth>; mails: AuthMail[]; lastCode(email: string): string | undefined };
/** betterAuth(buildAuthOptions({ db, baseURL: TEST_BASE_URL, secret: BETTER_AUTH_SECRET ?? "test-secret-0123456789abcdefghijklmnop", sendEmail: capture })). */
export declare function makeTestAuth(db: Db): TestAuth;
export type BrowserCall = (path: string, body?: unknown) => Promise<{ status: number; json: Record<string, unknown> | null }>;
/** One cookie jar = one browser (spike pattern): origin TEST_BASE_URL, x-forwarded-for ip (default testIp()), GET when body is undefined. */
export declare function browser(t: TestAuth, ip?: string): BrowserCall;
export declare function deleteUsersByEmail(db: Db, emails: readonly string[]): Promise<void>;
```

### 5.24 Scripts (Tasks 34, 35)

**`scripts/content/altinha.ts`**, decl plus binding data:

```ts
import type { DateKey } from "@/lib/civil-date";
import type { AvailabilityRuleInput, BookingMode, BookingSettings, OfferInput, QuestionInput, RecurrenceRuleInput, TicketTypeInput } from "@/lib/tickets";
export type CatalogType = { key: "collectif" | "essai" | "particulier" | "decouverte"; type: TicketTypeInput; offers: Omit<OfferInput, "ticketTypeId">[]; availability?: AvailabilityRuleInput[]; questions?: QuestionInput[] };
export type CatalogEvent = { key: "debutants" | "intermediaires" | "roda" | "atelier" | "competition"; title: string; description: string; location: string; color: string; bookingMode: BookingMode; isPrivate: boolean; capacity: number; durationMin: number; rule: RecurrenceRuleInput; ticketTypeKeys: CatalogType["key"][]; questions?: QuestionInput[] };
export type CatalogContent = { settings: BookingSettings; availability: AvailabilityRuleInput[]; types: CatalogType[]; events: CatalogEvent[] };
/** The demo pro's profile, copied from today's seed. */
export declare const ALTINHA_PROFILE: { slug: string; businessName: string; headline: string; bio: string; brandColor: string; themePreset: string; headerLayout: string; avatarKind: string; avatarStyle: string; avatarSeed: string; timezone: string; currency: string };
/** Fixed demo client accounts (also wiped by seed --wipe). */
export declare const SEED_CLIENT_EMAILS: readonly ["beatriz@example.com"];
export declare function altinhaCatalog(startDate: DateKey): CatalogContent;
```

**Data** (spec § 15.4). All events use endMode `never`. Settings `{ bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 }`. Global availability: Mon–Sat 600–780 and 1050–1230.

Types:

| Key | Type | Offers |
|---|---|---|
| collectif | « Cours collectif », #16a34a | unit 2500 €c; 4 = 8500 (3 months); 10 = 19000 (6 months) |
| essai | « Cours d'essai », #f59e0b | unit 1500 |
| particulier | « Cours particulier », #0ea5e9, RDV 60 min; question « Quel est votre objectif ? » (text, required) | unit 5000; 5 = 22500 (6 months) |
| decouverte | « Appel découverte », #8b5cf6, RDV free 15 min, own hours Mon–Fri 720–840 | none |

Events:

| Key | Title | Schedule | Duration / places | Mode | Accepted types |
|---|---|---|---|---|---|
| debutants | « Altinha débutants » | weekly [1,3] at 1140 | 60 min / 12 | tickets | collectif, essai; question « Avez-vous déjà pratiqué un sport de ballon ? » (boolean) |
| intermediaires | « Altinha intermédiaires » | weekly [2,4] at 1140 | 90 / 12 | tickets | collectif |
| roda | « Roda libre » | weekly, interval 2, [6] at 900; start = first Saturday ≥ startDate | 120 / 30 | free | — |
| atelier | « Atelier technique » | monthly weekday, monthWeek 1, at 840; start = first Sunday ≥ startDate | 120 / 10 | tickets | collectif |
| competition | « Équipe compétition » | weekly [5] at 1200 | 90 / 8 | tickets, private | collectif |

Locations: Tuileries / Nation / Bercy / « Gymnase Japy, Paris 11e » / Nation.

**`scripts/content/apply-catalog.ts`**, decl:

```ts
import type { Db } from "@/lib/db/atomic";
import type { CatalogContent } from "./altinha";
export type AppliedCatalog = { typeIds: Record<string, string>; offerIds: Record<string, string[]>; eventIds: Record<string, string> };
/** updateBookingSettings, setAvailabilityRules (global + per type), createTicketType/createOffer/setTypeQuestions, createEvent; throws on the first failure. */
export declare function applyCatalog(db: Db, professionalId: string, content: CatalogContent, now: Date): Promise<AppliedCatalog>;
```

**`scripts/bootstrap-content.ts`:**

- Argument: `--pro <slug>`.
- Prints the target host.
- Refuses when the slug is unknown or `hasDomainData`.
- Runs `applyCatalog(db, proId, altinhaCatalog(todayKey(now, tz)), now)`.
- Creates no client, purchase, ticket, booking or time-off, and sends no e-mail.

**Decision:** the shared helper lives in `scripts/content/apply-catalog.ts`.

**`scripts/seed.ts` (Task 35).** Guards:

- Refuse if `APP_ENV=production`.
- Refuse if the `DATABASE_URL` host is not in `SEED_ALLOWED_HOSTS` (comma-separated).
- `--wipe` = `delete from "user" where email like '%@skedul.app' or email like '%@skedul.test' or email = any(SEED_CLIENT_EMAILS)`.
- Without `--wipe`, refuse if any demo user exists.
- **Never** `TRUNCATE`.

Scenario. `T = now`, `P = T − 56 days`; every engine call gets its own injected `now`.

1. Users via `betterAuth(buildAuthOptions({ …, sendEmail: async () => {} })).api.signUpEmail`: admin@skedul.test, pro@skedul.app, beatriz@example.com. All get `emailVerified = true` and their roles.
2. Pro with `ALTINHA_PROFILE`; `applyCatalog(content(P), now = P)`.
3. Customers:
   - `upsertCustomer` Beatriz with `userId`;
   - `createCustomer` Rafael, Thomas, Marina, Léa (`@example.com`).
4. Beatriz:
   - `startPurchase` + `fulfillPurchase` carnet 10 at P+1;
   - `bookWithHeldTicket` on 3 past débutants séances (now = start − 2 d);
   - `pointTickets` 1 at P+20 (note « Cours rattrapé au parc »);
   - `convertTickets` 1 collectif → particulier at P+30;
   - `bookRdv` held_ticket particulier at T+5 days 11:00, answering the required question;
   - `bookWithHeldTicket` on an upcoming intermédiaires séance, then `cancelOccurrence` of that séance (ticket returned).
5. Rafael: carnet 4 purchased at T−120 d (`fulfillPurchase` now = T−120 d), so it expires unused.
6. Thomas: essai unit at P+3 → booked on an upcoming débutants séance.
7. Marina:
   - `startBuyAndBook` carnet 4 on an upcoming débutants séance + `fulfillPurchase` (T14 shape);
   - `closeTickets` 1 collectif `rembourse` with note « Remboursé en espèces »;
   - `bookRdv` free « Appel découverte » at T+6 days 12:00.
8. Léa:
   - `offerTickets` 2 essai at P+5;
   - `registerPro` with a ticket on a past débutants séance (P+7);
   - `registerFree` on an upcoming Roda libre.
9. Alerts:
   - type « Stage d'été 2026 » + `offerTickets` 2 to Rafael, then `setTicketTypeArchived(true)` (red);
   - type « Cours en plein air », not linked, + `offerTickets` 1 to Thomas (orange).
10. `createTimeOffWithConflicts` all day at T+21 with `seenOccurrenceIds = []` and `cancelBooked: false`. Choose a day without bookings.
11. At T: `expireTickets`, `ensureHorizon(pro)`, then `checkInvariants({ proId })` must return `[]`, else throw.
12. Print accounts and URLs as today.

Add `SEED_ALLOWED_HOSTS=` to `.env.example`, and to the worktree `.env.local` (tickets-dev host, done in Task 2).

---

## 6. Engine API table

Locks are listed in the order they are taken inside the batch. "Plan" = reads before the batch.

| Path | Function (module) | Input | Success data | Error codes | Effects | Locks | Spec |
|---|---|---|---|---|---|---|---|
| E1 buy + book | `startBuyAndBook` (claims) | `BuyAndBookInput` | `BuyAndBookData` | not_found, unavailable, changed, stale, full, too_many_holds, already_booked, offer_too_short, invalid | none | occurrence → customer | § 11 E1 |
| E1 after Stripe | `attachCheckoutSession` (claims) | `{purchaseId, checkoutSessionId, checkoutUrl}` | — | stale | none | none (single UPDATE) | § 11 E1 |
| E2 client | `bookWithHeldTicket` (claims) | `ClientClaimBase & {actorUserId}` | `{bookingId, ticketId}` | not_found, unavailable, changed, full, no_ticket, already_booked, invalid | booking_confirmed, pro_new_booking, google | occurrence (ticket via SKIP LOCKED) | § 11 E2 |
| E2 pro « Inscrire » | `registerPro` (claims) | `{professionalId, actorUserId, occurrenceId, customerId, asGuest, ticketId?, extraSeat?, answers?}` | `{bookingId, coverage, ticketId}` | not_found, unavailable, not_eligible, full, no_ticket, already_booked, invalid | booking_confirmed, google | occurrence | § 11 E2 |
| E3 | `registerFree` (claims) | `ClientClaimBase` | `{bookingId}` | not_found, unavailable, changed, full, already_booked, invalid | booking_confirmed, pro_new_booking, google | occurrence | § 11 E3 |
| E4 | `bookRdv` (claims) | `BookRdvInput` | `{occurrenceId, bookingId, purchaseId, checkoutExpiresAt, amountCents}` | not_found, unavailable, slot_taken, no_ticket, stale, too_many_holds, offer_too_short, already_booked, invalid | held/free: booking_confirmed, pro_new_booking, google; buy: none | professional → overlapping RDV occurrences (id asc) | § 11 E4 |
| E5 | `cancelByClient` (cancel) | `{professionalId, customerId, bookingId, actorUserId}` | `{occurrenceId, ticketReturned}` | not_found, too_late_or_done | booking_cancelled(by client), pro_booking_cancelled, google | occurrence | § 11 E5 |
| E6a | `cancelBookingsByPro` (cancel) | `{professionalId, actorUserId, occurrenceId, bookingIds, reason?}` | `{cancelled, ticketsReturned}` | not_found, stale | booking_cancelled(by pro) ×n, stripe.expire_session for still-pending purchases, google | occurrence | § 11 E6a |
| E6b | `cancelOccurrence` (cancel) | `{professionalId, actorUserId, occurrenceId}` | `{bookingsCancelled, ticketsReturned}` | not_found | occurrence_cancelled, stripe.expire_session, google | occurrence (the guarded UPDATE locks) | § 11 E6b |
| Rétablir | `restoreOccurrence` (cancel) | `{professionalId, occurrenceId}` | — | not_found | none | occurrence (UPDATE) | § 11 E6b |
| E6c preview | `previewTimeOffConflicts` (cancel) | `{professionalId, startAt, endAt}` | `TimeOffConflict[]` | — | — | none (read) | § 11 E6c |
| E6c | `createTimeOffWithConflicts` (cancel) | see decl | `{timeOffId, cancelledOccurrences}` | invalid, stale | if cancelBooked: as E6b per séance | professional → overlapping scheduled occurrences (id asc) | § 11 E6c |
| E7 this séance | `updateOccurrence` (series) | see decl | `{timeChanged}` | not_found, changed, invalid, full | occurrence_changed (remaining active), booking_cancelled(by pro) for unenrolled, google | occurrence | § 11 E7 |
| E7 event editor | `editEventInPlace` (series) | `{…, eventId, seenVersion, patch}` | `{version}` | not_found, invalid, stale | occurrence_changed on location change (future, no location_override) | event (version-guarded UPDATE) | § 11 E7 |
| E7 following | `previewSeriesEdit`, `editSeriesFrom` (series) | `SeriesEditInput` | `{eventId, summary}` | not_found, invalid, stale (after one re-plan) | occurrence_changed per changed séance, E6b effects for cancelled orphans, google | event → occurrences ≥ d (id asc) | § 11 E7 |
| E7 delete from | `deleteSeriesFrom` (series) | `{…, eventId, seenVersion, fromDate}` | `{deletedEvent, cancelledOccurrences, deletedOccurrences}` | not_found, invalid, stale | E6b effects | event → occurrences ≥ d | § 11 E7 |
| E8 customers | `upsertCustomer`, `createCustomer`, `updateCustomer`, `revokeLinks` (wallet) | see decl | ids / linkVersion | invalid, not_found | none | none (single statements) | § 11 E1, E8 |
| E8 Offrir | `offerTickets` (wallet) | see decl | `{ticketIds}` | invalid, not_found, stale | tickets_offered if notify | none (insert) | § 11 E8 |
| E8 actions | `convertTickets`, `closeTickets`, `pointTickets`, `unpointTickets` (wallet) | `TicketSelection` + params | `{ticketIds}` | invalid, not_found, no_ticket, retire_paid, stale | none | ticket rows (row locks of the UPDATE) | § 11 E8, § 9 |
| E8 move | `moveAttendee` (wallet) | see decl | `{fromOccurrenceId}` | not_found, not_eligible, ticket_expires_before, full, already_booked, stale | attendee_moved, google ×2 | both occurrences (id asc) → booking (UPDATE) | § 11 E8 |
| E9 | `startPurchase` (fulfillment) | `{professionalId, offerId, customerId}` | `{purchaseId, checkoutExpiresAt, amountCents, currency, label, quantity, ticketTypeName}` | not_found, stale | none | none | § 11 E9 |
| E10 | `fulfillPurchase` (fulfillment) | `purchaseId, PaymentFacts` | `{outcome, ticketIds, bookingConfirmed}` | never fails (orphan / duplicate are outcomes) | purchase_receipt; + booking_confirmed, pro_new_booking, google, or late_payment | booking (by purchase_id) → purchase (UPDATE) | § 11 E10 |
| E10 processing | `markProcessing` (fulfillment) | `purchaseId` | — | stale | none | none | § 11 E10 |
| E11 | `releasePurchase` (release) | `purchaseId` | `{released}` | not_found | google if a booking ended | occurrence → booking | § 11 E11 |
| Sweep | `sweepHolds` (release) | — | `{expiredBookings}` | — | none | occurrences with elapsed holds (id asc) | § 11 E11 |
| Stale purchases | `expireStalePurchases` (release) | — | `{expired}` | — | none | none | § 11 E11, E12.2 |
| Event creation | `createEvent` (occurrences) | `{professionalId, event: EventInput}` | `{eventId, occurrenceCount}` | invalid, stale | none | none (inserts) | § 7 |
| Horizon | `ensureHorizon` (occurrences) | `professionalId` | `{inserted, complete}` | stale (after one re-plan) | none | events of the pro needing rows (id asc) | § 7 |
| E12 | `runNightly` + steps (nightly) | — | `NightlyReport` | — (errors listed in report) | none | per step | § 11 E12 |
| E13 | `pendingCheckoutSessions`, `deletionImpact` (account) | `professionalId` | lists / counts | — | — | none | § 11 E13 |
| Revenue | `paidPurchaseOf`, `revenueByCurrency` (revenue) | `{live, professionalId?, since?}` | SQL / totals | — | — | — | § 9 |
| Invariants | `checkInvariants` (invariants) | `{proId?}` | violations | — | — | — | § 14 |

---

## 7. Neutralisation (Task 2, before the drop)

**Strategy (Decision):** neutralise **before** 0010, while the old schema still exists. Then 0010 compiles because nothing references the dropped tables any more.

- Delete what has no consumer left.
- Keep the evolving components (planning-calendar, week-preview, upcoming-bookings, booking-detail-dialog, session-detail-dialog, session-capacity-control, manual-booking-form, availability-editor, unavailability-manager, weekly-hours-editor). They compile against **stubbed server actions with unchanged signatures**.
- Replace pages that read the domain with `ComingSoon`.

**Placeholder component**, `src/components/coming-soon.tsx`, full:

```tsx
import { Construction } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/** Temporary stand-in for pages rebuilt by the tickets & événements plans (P3–P5). */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Construction className="size-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
```

**Decision:** this is a temporary stub built from existing primitives. It is not new design work, so the design skill is not run for it.

### Step 0 of Task 2: Neon `tickets-dev` and `.env.local`

1. `mcp__Neon__create_branch {"project_id":"nameless-meadow-98376303","parent_id":"br-bold-art-af8tpfm5","name":"tickets-dev"}`. Record the returned `br-…` id; if it is lost, use `list_branches` with `search:"tickets-dev"`.
2. `mcp__Neon__get_connection_string {"project_id":"nameless-meadow-98376303","branch_id":"<tickets-dev id>","database_name":"neondb","role_name":"neondb_owner"}`.
3. Build `.env.local` from the main checkout's file without printing the URL:

```bash
URL='<tickets-dev url>' node -e "const fs=require('fs');const u=process.env.URL;const src=fs.readFileSync('C:/Users/Matheus/Documents/Codage/skedul/.env.local','utf8').split(/\r?\n/).filter(l=>l&&!/^DATABASE_URL=/.test(l)&&!/^SEED_ALLOWED_HOSTS=/.test(l));src.push('DATABASE_URL=\"'+u+'\"','SEED_ALLOWED_HOSTS='+new URL(u).host);fs.writeFileSync('.env.local',src.join('\n')+'\n');console.log('tickets-dev host: '+new URL(u).host)"
```

4. Baseline: `./node_modules/.bin/next build` green before any code change.

### Exact file list

| File | Action | Content after Task 2 | Rewritten in |
|---|---|---|---|
| `src/lib/admin-params.ts` | modify | `UserRole` still from `schema.userRole`. `BookingStatus`, `PurchaseStatus`, `BOOKING_STATUS_LABELS`, `PURCHASE_STATUS_LABELS` and `COVERAGE_LABELS` re-exported from `@/lib/tickets`. `parseBookingStatus`/`parsePurchaseStatus` use `pick(BOOKING_STATUSES…)`/`pick(PURCHASE_STATUSES…)`. `PAYMENT_TYPE_LABELS` removed. The existing test passes unchanged. | P3 |
| `src/server/queries.ts` | modify | Keeps `getProTimeOff`, `getGoogleConnection`, `getPublicProfile(slug, opts)` (returns `{ pro }` only) and `getProAvailability(proId): Promise<{dayOfWeek:number;startMinute:number;endMinute:number}[]>` (stub `return []`, restored in Task 4). Removes everything else and the imports of slots and dropped tables. | P3 (Task 4 restores availability) |
| `src/server/pro.ts` | modify | Keeps `createProfessionalProfile` (without default rules until Task 4), `updateProfile`, `updateBranding`, `saveAvailability(rules): Promise<void>` (stub: `await requirePro(); void rules;`, restored in Task 4), `createTimeOff`, `deleteTimeOff`, `finalizeGoogleConnection`, `disconnectGoogleCalendar` (minus the `class_session` update). See the stub list below. Removes `saveEventType`, `deleteEventType`, `savePack`, `deletePack`, `saveQuestion`, `deleteQuestion` and the imports of dropped modules. | P3 |
| `src/server/admin-queries.ts` | modify | `getOverviewStats` (`activePros30d: 0`, `bookings30d: 0`, `revenue30d` from `getRevenue`). `getRevenue(opts)` → `[]` (`void opts`). `getRecentActivity` → signups + pro pages only. `getAppHealth` → `pendingBookings: 0`, `pendingPurchases: 0` (`void now`). `getProStats` → all zeros. `getDeletionImpact` → `{ creditsOutstanding: 0, clientRecordsElsewhere: 0 }`. Removes `ACTIVITY_LIMIT`, `listRecentBookings`, `listRecentPurchases` and the imports of dropped tables, `BOOKING_STATUS_LABELS`, `BookingStatus`, `PurchaseStatus`, `formatMoney`, and the unused drizzle operators. All exported shapes are unchanged. | P3 |
| `src/app/admin/activity/page.tsx` | modify | `await requireAdmin()`; `PageHeader title="Activité"`; `ComingSoon title="Bientôt disponible" description="Les inscriptions et les achats de tickets s'afficheront ici."` | P3 |
| `src/app/dashboard/page.tsx` | modify | Keeps `PageHeader` and the public-link card. Replaces stats, `WeekPreview` and `UpcomingBookings` with `ComingSoon title="Bientôt disponible" description="Les indicateurs, le planning de la semaine et les prochaines inscriptions reviennent avec les tickets et les événements."` | P3 |
| `src/app/dashboard/planning/page.tsx` | modify | `PageHeader "Planning"` + `ComingSoon description="Le planning revient avec les séances et les rendez-vous."` | P3 |
| `src/app/dashboard/clients/page.tsx` | modify | `PageHeader "Clients"` + `ComingSoon description="La liste des clients et leurs portefeuilles de tickets reviennent bientôt."` | P3 |
| `src/app/dashboard/payments/page.tsx` | modify | `PageHeader "Paiements"` + `ComingSoon description="Les paiements reviennent avec les achats de tickets."` | P3 |
| `src/app/dashboard/event-types/page.tsx`, `src/app/dashboard/packs/page.tsx` | modify | `PageHeader "Tickets"` + `ComingSoon description="Les prestations et les packs deviennent des types de ticket et des offres. Cette page revient bientôt."` | P3 (redirect to `/dashboard/tickets`) |
| `src/app/[slug]/page.tsx` | modify | `getPublicProfile` → PublicShell, bio, `ComingSoon title="Réservations" description="Les réservations en ligne reviennent très bientôt."`. `CreditLookup` removed. `generateMetadata` kept. | P4 |
| `src/app/[slug]/book/[eventTypeId]/page.tsx`, `src/app/[slug]/pack/[packId]/page.tsx` | modify | `const { slug } = await params; redirect(\`/${slug}\`);` | P4 |
| `src/app/[slug]/merci/page.tsx` | modify | `getPublicProfile(slug, { includeSuspended: true })`. Card with `CheckCircle2`, « Merci ! », « Votre demande a bien été enregistrée. » and « Retour à la page ». No `searchParams`, no DB detail. | P4 |
| `src/app/api/bookings/[id]/calendar.ics/route.ts` | modify | `export async function GET() { return new Response("Not found", { status: 404 }); }` | P3 |
| `src/app/api/mock-checkout/route.ts` | modify | `GET` → `new NextResponse("Not found", { status: 404 })` | P4 |
| `src/app/api/stripe/webhook/route.ts` | modify | Keeps the not-configured early return and signature verification; then `console.warn(\`[stripe] ${event.type} ignored: payments are being rebuilt\`)` and `200 "ok"`. No DB import. | P4 |
| `scripts/seed.ts` | modify | `async function main() { console.error("Seed v2 is not written yet (P2 Task 35)."); process.exit(1); } main();` | Task 35 |
| `src/lib/sessions.ts`, `src/lib/sessions.test.ts` | delete | — | (spec 13.4) |
| `src/lib/payments.ts` | delete | replaced by `booking/fulfillment.ts` | Task 21 |
| `src/lib/slots.ts` | delete | no consumer left | P5 recreates |
| `src/lib/calendar-sync.ts` | delete | no consumer left; `calendar-sync-core.ts` and its test stay | P3 recreates (occurrence-indexed) |
| `src/server/booking-core.ts` | delete | `buildAnswers` moves to `booking/answers.ts` | Task 16 |
| `src/server/public.ts` | delete | no consumer left | P4 rewrites |
| `src/components/public/{booking-flow,buy-pack-form,credit-lookup}.tsx` | delete | only used by neutralised pages | P4 (occurrence-booking, offer-checkout-form) |
| `src/components/dashboard/{event-types-manager,packs-manager}.tsx` | delete | spec 13.5 | P3 |
| `scripts/backfill-sessions.ts` | delete | spec 6.1 | — |

**Stubbed `pro.ts` actions.** Signatures are unchanged. Each calls `await requirePro()` first, then `void` its params:

```ts
const COMING_SOON: Res = { ok: false, error: "Bientôt disponible : cette action revient avec les tickets et événements." };
export async function updateSessionCapacity(input: { sessionId: string; capacity: number }): Promise<void>
export async function cancelBooking(bookingId: string): Promise<Res>
export async function moveAttendee(input: { bookingId: string; targetSessionId: string }): Promise<Res>
export async function cancelSession(sessionId: string): Promise<Res>
export async function fetchManualDaySlots(eventTypeId: string, dayKey: string): Promise<{ startISO: string; label: string }[]>
export async function createManualBooking(input: { eventTypeId: string; startISO: string; customerName: string; customerEmail: string; answers?: { questionId: string; value: string }[] }): Promise<Res>
```

**Kept untouched, still compiling:** `src/lib/availability.ts` (+ test), `src/lib/booking-emails.ts` (+ test), `src/lib/mock-redirect.ts` (+ test), `src/lib/stripe.ts`, `src/lib/planning.ts` (+ test), demo components, admin components.

**Task 2 proof:** after the change, `grep -rnE "eventType|classSession|packPurchase|bookingAnswer|availabilityRule|from \"@/lib/(payments|sessions|slots|calendar-sync)\"|server/(public|booking-core)" src scripts --include=*.ts --include=*.tsx` returns only `src/lib/db/schema.ts`.

**Task 4 restores, on the new table:**

- `getProAvailability`: `where professional_id = pro and ticket_type_id is null`.
- `saveAvailability`: delete the global rules, insert valid ones.
- Default Mon–Fri 540–1020 rules in `createProfessionalProfile`.

---

## 8. Task breakdown

Every task follows TDD (failing test → implementation → green) and ends with tsc, eslint (changed files), pure tests, DB tests (from Task 5 on) and `next build`, then a commit. A task with no new test (2, 3, 4, 5) proves itself with the listed commands.

| # | Title | Group | Files (C/M/D) | Depends on | Proven by |
|---|---|---|---|---|---|
| 1 | Vocabulary: `tickets.ts` | G1 | C `src/lib/tickets.ts`, `src/lib/tickets.test.ts` | — | `tickets.test.ts` |
| 2 | Neon tickets-dev + `.env.local` + neutralise the domain readers | G1 | C `src/components/coming-soon.tsx`; M admin-params, queries, pro, admin-queries, 10 pages, 3 API routes, seed (placeholder); D 13 files (§7) | 1 | grep proof (§7) + admin-params test + build |
| 3 | Migration 0010 (drop) | G1 | M `schema.ts`; C `drizzle/0010_domain_drop.sql`, `meta/0010_snapshot.json`; M `meta/_journal.json` | 2 | generated SQL = §4.1; `apply-migration` on tickets-dev prints `✓ 0010_domain_drop applied and recorded.`; build |
| 4 | Migration 0011 (tickets schema) + availability restored | G1 | M `schema.ts` (§4.2), `src/server/queries.ts`, `src/server/pro.ts`; C `0011_tickets_schema.sql` + snapshot; M journal | 3 | generated SQL matches §4.2; applied on tickets-dev; build |
| 5 | Migration 0012 + tickets-test + `.env.test`; remove `db:push` | G1 | C `0012_tickets_manual.sql` + snapshot; M journal, `package.json` | 4 | applied on tickets-dev; `mcp__Neon__run_sql` on **tickets-test** (`branch_id`!) `select conname from pg_constraint where conname='occurrence_rdv_excl'` → 1 row |
| 6 | DB test harness + test scripts | G1 | C `src/test/db.ts`, `src/test/db-guard.test.ts`, `src/test/harness.db.test.ts`; M `package.json`, `.env.example` | 5 | `db-guard.test.ts` (pure); `harness.db.test.ts` (btree_gist, EXCLUDE 23P01, `skedul_assert` P0001 + `skedulCode`, pro cascade) |
| 7 | `civil-date.ts` | G2 | C `src/lib/civil-date.ts`, `.test.ts` | 1 | vectors in §5.2 |
| 8 | `recurrence.ts` | G2 | C `src/lib/recurrence.ts`, `.test.ts` | 7 | vectors in §5.3 (weekly interval, mid-week start, 31st, nth/last, until inclusive, count from start, DST, 4-year jump, caps, labels) |
| 9 | `series-plan.ts` | G2 | C `src/lib/series-plan.ts`, `.test.ts` | 8 | partition, cancelEmpty, orphans, insert cap, remainingCount, summary text |
| 10 | Expiry, booking window, cancellation rules | G2 | C `ticket-expiry.ts`, `booking-window.ts`, `cancellation.ts` + 3 tests | 7 | month-end, last-day display, notice/horizon/overrides, `fitsAvailability`, deadline + changed_at + moved_at |
| 11 | Guest link + lanes | G2 | C `guest-link.ts`, `lanes.ts` + 2 tests | — | tamper, version, malformed; overlap clusters |
| 12 | Wallet rules | G2 | C `wallet-rules.ts`, `.test.ts` | 1 | red/orange, usable, order |
| 13 | Throttle + `ipHash` | G2 | C `throttle.ts`, `throttle.test.ts`, `throttle.db.test.ts`; M `visitor-hash.ts`, `visitor-hash.test.ts` | 6 | `nextWindow` pure; DB: limit then reset after the window, health counters |
| 14 | `atomic.ts` + `map-db-error.ts` | G3 | C `src/lib/db/atomic.ts`, `atomic.db.test.ts`, `map-db-error.ts`, `map-db-error.test.ts` | 6 | §5.9 / §5.10 tests |
| 15 | Invariants + revenue + harness wiring | G3 | C `booking/invariants.ts`, `booking/revenue.ts`, `booking/invariants.db.test.ts`; M `src/test/db.ts` | 14 | every I1–I6 detected on hand-made bad rows; clean pro → `[]`; `paidPurchaseOf` live/test |
| 16 | Types, answers, eligibility, holds | G3 | C `booking/types.ts`, `answers.ts`, `answers.test.ts`, `eligibility.ts`, `holds.ts`, `holds.test.ts`, `eligibility.db.test.ts` | 15 | `buildAnswers` pure; eligibility matrix (mode, link, archived, expiry vs `starts_at`, RDV paid/free), consumption order |
| 17 | Catalog | G3 | C `booking/catalog.ts`, `catalog.db.test.ts` | 16 | delete → archive with history; rules replace; settings bounds |
| 18 | Occurrences: `createEvent`, `ensureHorizon` | G3 | C `booking/occurrences.ts`, `occurrences.db.test.ts` | 17, 8 | rows = expander output; 450 cap; version-skip; idempotent; archived skipped |
| 19 | Customers + Offrir + balance + fixtures | G3 | C `booking/wallet.ts` (part 1), `wallet-customers.db.test.ts`, `src/test/fixtures.ts` | 18 | upsert never overwrites name; createCustomer overwrites; offer N + movements; balance |
| 20 | E1 buy + book | G4 | C `booking/claims.ts` (E1 part), `claims-buy.db.test.ts` | 19, 10 | guards (private, archived, notice, horizon, time off, changed, stale offer, offer_too_short), hold quota, already_booked, `attachCheckoutSession` |
| 21 | E9 + E10 fulfillment | G4 | C `booking/fulfillment.ts`, `fulfillment.db.test.ts` | 20 | **T4**, **T14**; orphan; from expired; processing |
| 22 | E11 release + sweep | G4 | C `booking/release.ts`, `release.db.test.ts` | 21 | **T5**; idempotent release; RDV hold → cancelled; stale purchases |
| 23 | E2 + E3 claims | G4 | M `booking/claims.ts`; C `claims.db.test.ts` | 22 | **T1**, **T2**; registerPro guest / ticket / extraSeat / past séance; registerFree |
| 24 | E4 RDV libre | G4 | M `booking/claims.ts`; C `rdv.db.test.ts` | 23 | **T6a** (concurrent same slot), **T6b** (over an event séance); buffers; free; buy |
| 25 | E5, E6a, E6b, rétablir | G5 | C `booking/cancel.ts`, `cancel.db.test.ts` | 24 | **T3**, **T7**; deadline vs changed_at / moved_at; idempotent E6b; restore |
| 26 | E6c time off | G5 | M `booking/cancel.ts`; C `time-off.db.test.ts` | 25 | **T6c**, **T10** (using `afterPlan`) |
| 27 | E7 this séance + event editor | G5 | C `booking/series.ts` (part 1), `series-occurrence.db.test.ts` | 25 | move / capacity / location; unenroll; editor capacity propagation; version stale |
| 28 | E7 following + delete from | G5 | M `booking/series.ts`; C `series-split.db.test.ts` | 27, 9, 18 | **T8a**, **T8b** (afterPlan); in-place vs split; delete never-booked event |
| 29 | E8 ticket actions + move | G5 | M `booking/wallet.ts` (part 2); C `wallet.db.test.ts` | 25 | **T9**; close reasons; unpoint; move eligibility / force; `loadTypeFacts` |
| 30 | Nightly + account | G5 | C `booking/nightly.ts`, `booking/account.ts`, `nightly.db.test.ts`, `delete-user.db.test.ts` | 29, 22, 18 | expire / archive / purge / report; **T11** |
| 31 | Auth e-mails | G6 | C `src/lib/emails/{login-code,verify-email-code,password-disabled,password-reset}.ts`, `auth-emails.test.ts`; M `src/lib/email.ts` | 1 | escaping, code leads the subject, no em dash |
| 32 | `auth-options` + `auth.ts` rewire | G6 | C `src/lib/auth-options.ts`, `auth-options.test.ts`; M `src/lib/auth.ts`, `src/lib/auth-client.ts` | 31, 13, 4 | disabledPaths derivation; tsc proves `auth.api.*` types |
| 33 | Auth DB tests | G6 | C `src/test/auth.ts`, `src/lib/auth.db.test.ts` | 32 | **T12**, **T13**, **T15** |
| 34 | Content + bootstrap | G6 | C `scripts/content/altinha.ts`, `scripts/content/apply-catalog.ts`, `scripts/bootstrap-content.ts`; M `package.json` (`"db:bootstrap": "tsx scripts/bootstrap-content.ts"`) | 30 | `src/lib/booking/content.db.test.ts` (C): `applyCatalog` on a test pro → 4 types, 7 offers, 5 events, séances; refusal when domain data exists |
| 35 | Seed v2 | G6 | M `scripts/seed.ts`, `.env.example` | 34, 33 | `./node_modules/.bin/tsx scripts/seed.ts --wipe` on tickets-dev prints the host, ends with `checkInvariants → 0`; a second run without `--wipe` refuses |

---

## 9. Test strategy

**`package.json` after P2:**

```json
"test": "tsx --test \"src/**/!(*.db).test.ts\"",
"test:db": "tsx --env-file-if-exists=.env.test --test --test-concurrency=1 \"src/**/*.db.test.ts\"",
"db:bootstrap": "tsx scripts/bootstrap-content.ts",
```

`db:push` is removed. All other scripts are unchanged.

**Why the glob (verified in scratch):**

- A bare `tsx --test` also picks up `**/test/**/*.ts`. That would run `src/test/db.ts` as a test file.
- The extglob `src/**/!(*.db).test.ts` keeps every `*.test.ts` except `*.db.test.ts`, and never matches the helpers in `src/test/`.
- `--env-file-if-exists` is passed through tsx to node; without `.env.test`, the DB suite skips.
- An empty glob exits 0.

**`.env.test`** (not versioned; `.env*` is already ignored), written in Task 5:

```
DATABASE_URL="<tickets-test url>"
DATABASE_URL_TEST="<tickets-test url>"
BETTER_AUTH_SECRET="<random 48 chars>"
BETTER_AUTH_URL="http://localhost:3000"
APP_ENV=development
STRIPE_SECRET_KEY="sk_test_..."
RESEND_API_KEY="re_..."
```

Create `tickets-test` with `mcp__Neon__create_branch {"project_id":"nameless-meadow-98376303","parent_id":"<tickets-dev id>","name":"tickets-test"}` **after** 0012 is applied on tickets-dev. If P2 ever adds a migration, delete and re-create tickets-test (the user confirms the delete).

**Harness rules:**

- Every DB test uses `dbTest(name, fn)` from `src/test/db.ts`. The exceptions are the auth tests, which use node:test directly with `DB_SKIP`, `getTestDb`, unique `testEmail()` / `testIp()`, and `deleteUsersByEmail` in a `finally`.
- **Fresh pro per test**, deleted with `DELETE FROM "user"`. Every test therefore re-proves the R2 cascade.
- After Task 15, **`checkInvariants({ proId })` must return `[]` after every `dbTest`**. Pass `{ invariants: false }` only in `invariants.db.test.ts`, where the cases build bad rows on purpose.
- **Clock:** most tests use the real `new Date()` and séances 2–5 days ahead at 10:00 Paris (inside the default notice and horizon). History cases inject past instants, for example a purchase at T−120 d for expiry, or `sweepHolds(now + 46 min)` for T5.
- **Concurrency:** `inParallel([...])` fires real concurrent Neon HTTP batches. Assertions count `ok` results and error codes, then check DB state.
- **Deterministic races:** use the `afterPlan` hook of `editSeriesFrom`, `ensureHorizon`, `convertTickets` and `createTimeOffWithConflicts`. The hook runs exactly once, between the first plan and its batch.
- **Never** `TRUNCATE`; never touch rows of other pros.
- **Neon latency:** use per-test timeouts of 120 s.

**T1–T15 mapping:**

| # | Case | Task / file | Expected |
|---|---|---|---|
| T1 | 20 concurrent spends on 5 seats (20 customers, 1 ticket each) | 23 `claims.db.test.ts` | exactly 5 ok, 15 `full`; `seats_taken` 5 |
| T2 | 3 tickets, 10 concurrent bookings on 10 séances | 23 `claims.db.test.ts` | exactly 3 ok, 7 `no_ticket` |
| T3 | `cancelByClient` ∥ `cancelBookingsByPro` | 25 `cancel.db.test.ts` | one ok; exactly one `return` movement; ticket available |
| T4 | Double concurrent `fulfillPurchase` | 21 `fulfillment.db.test.ts` | outcomes {fulfilled, duplicate}; N tickets, N `purchase` movements |
| T5 | `sweepHolds` (now + 46 min), then `fulfillPurchase` (now + 50 min) | 22 `release.db.test.ts` | booking `expired`; N tickets all `available`; effect `email.late_payment` |
| T6 | a: same slot ∥; b: RDV over an event séance; c: RDV ∥ time off | 24 `rdv.db.test.ts` (a, b); 26 `time-off.db.test.ts` (c) | one wins, other `slot_taken`; `slot_taken`; exactly one of (time-off ok + RDV `slot_taken`) or (RDV ok + time-off `stale`) |
| T7 | `cancelOccurrence` during 8 parallel claims | 25 `cancel.db.test.ts` | I5 holds; every ticket returned; late claims `unavailable` |
| T8 | a: split vs claim (afterPlan books a row planned for delete → stale → re-plan → kept isolated); b: split vs `ensureHorizon` (both orders) | 28 `series-split.db.test.ts` | booking preserved and confirmed; no phantom séance (old segment has no row ≥ d; new segment rows = new-rule dates ∪ isolated) |
| T9 | convert ∥ spend on the last ticket; two identical converts ∥; retire a paid ticket by id | 29 `wallet.db.test.ts` | one effect each; second convert `no_ticket`; `retire_paid` |
| T10 | Time-off batch vs claim (afterPlan claim → `stale`; time off first → claim `unavailable`) | 26 `time-off.db.test.ts` | `stale` / `unavailable` |
| T11 | `deleteUser` on a fully populated pro (every table and status) | 30 `delete-user.db.test.ts` | DELETE passes; 0 rows left in each domain table for that pro; other pros' customers get `user_id` NULL |
| T12 | Password account + code sign-in via `auth.handler` | 33 `auth.db.test.ts` | credential deleted; attacker no-cache session null; victim session kept; password-disabled e-mail sent |
| T13 | 6 code requests in the hour (6 IPs) | 33 `auth.db.test.ts` | 5 e-mails; 6th answers 200 `{success:true}` with no e-mail; first code signs in |
| T14 | Buy + book paid | 21 `fulfillment.db.test.ts` | N tickets, ticket #1 `booked` to the confirmed booking, one `purchase` movement per ticket, no `spend` |
| T15 | Logged-in unverified user confirms the address | 33 `auth.db.test.ts` | `emailVerified = true`, credential kept |

**Additional DB tests per task** (non-T, binding minimums):

- 18: an event created 10 days in the past gets exactly the missing dates from `ensureHorizon`; a second call inserts 0 (`complete: true`).
- 20: a private event or an archived type → `unavailable`; an offer edited after the read → `stale`.
- 25: deadline 24 h — at 25 h ok, at 23 h `too_late_or_done`, at 23 h after a pro move ok.
- 27: capacity below `seats_taken` is clamped by `GREATEST`.
- 30: `runNightly` reports and stores `health:invariant_violations` = 0.