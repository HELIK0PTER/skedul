<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Skedul — project guide

Calendly-like booking SaaS **with prepaid hour packs**. Pros configure
services/availability/packs in a back-office; their clients book slots
(pay-per-slot) or buy packs and spend prepaid credits, on a public page `/[slug]`.

## Conventions
- **Next.js 16 App Router**: `params`/`searchParams` are **async** (`await params`).
- **Server Actions** live in `src/server/*.ts` (`"use server"`); pro back-office =
  `pro.ts`, public booking/purchase = `public.ts`. Read-only queries in
  `queries.ts` (`import "server-only"`).
- **DB**: Drizzle + Neon HTTP driver (`drizzle-orm/neon-http`) — **no interactive
  transactions**. Credit spend is an atomic guarded UPDATE
  (`credits_remaining = credits_remaining - 1 WHERE credits_remaining > 0`), not a tx.
- **Auth**: Better Auth, tables `user/session/account/verification` (text ids).
  Server session helpers in `src/lib/session.ts`. Client uses `auth-client.ts`.
  The seed builds a plugin-free Better Auth instance to create users outside HTTP.
- **Google**: one Better Auth `google` provider serves both « Continuer avec Google »
  (sign-in/sign-up, `AuthForm`) and the Calendar sync (`linkSocial` + calendar scope);
  both show only when `env.GOOGLE_CALENDAR_ENABLED`. Implicit linking to an existing
  email/password account needs a verified local email (Better Auth default, kept on
  purpose against pre-account takeover) → `?error=account_not_linked`, which the
  sign-in/sign-up pages redirect to `/link-google`: the user enters the account's
  password (`signIn.email`), then `linkSocial` sends them back through Google (same
  email required). Error codes → `oauthErrorMessage`.
- **Password reset**: `/forgot-password` → `authClient.requestPasswordReset` → email
  (`sendResetPassword` in `auth.ts`, template `passwordResetEmail`; in mock mode the link
  is logged) → `/api/auth/reset-password/:token` → `/reset-password?token=…`. Token is
  single-use, 1 h; all sessions are revoked and `emailVerified` is set on reset. New
  top-level routes must be added to `RESERVED_SEGMENTS` in `src/lib/analytics.ts`.
- **Admin**: `/admin` (role `admin` on `user.role`, Better Auth `admin` plugin for
  ban/impersonation). Guard with `requireAdmin()` / `getAdminUser()` from
  `src/lib/admin.ts` — they re-read the role from the DB. Grant with
  `pnpm admin:grant <email>` (`--revoke` to remove). Admins get an Admin/Client
  chooser after sign-in (cookie `skedul_entry`). Reads in `src/server/admin-queries.ts`,
  actions in `src/server/admin.ts`. The admin plugin's HTTP endpoints are all
  disabled: `disabledPaths` is derived from the plugin's own endpoint list in
  `src/lib/auth-admin.ts` (covered by a test) — never re-enable them.
  `deleteUser` (/admin/users/[id], email retyped, admins must be demoted first) is a
  single `DELETE FROM "user"`: the FK cascades remove the pro page and all its data,
  while `customer.user_id` and `page_view.professional_id` are set to NULL. Keep new
  tables cascading from `professional` (or SET NULL) or deletion will break.
- **Traffic**: cookieless page views (`page_view`) sent by `<PageViewTracker />` to
  `/api/track`; public pages only (see `isTrackedPath` in `src/lib/analytics.ts`).
  Visitor hash = HMAC with a random per-day salt (`analytics_salt`, deleted after 2
  days); page views older than 25 months are purged (`src/server/analytics-salt.ts`).
- **Help center**: public `/aide` (FAQ from `help_category`/`help_article`, edited in
  `/admin/support/faq`; starter content = content migration 0009) and support requests
  (`support_request` / `support_message` / `support_attachment`). Rules, labels and limits live in
  `src/lib/support.ts`, which is also the source of the DB enums. A request follows the 3-step
  `support` track or, once « Accepter en développement », the 6-step `development` track (never back
  to `received`); `resolution` (declined/closed) ends it off-track with the bar frozen. Writes:
  `src/server/support.ts` (user, refused while impersonating), `src/server/support-admin.ts` (admin),
  shared `src/server/support-core.ts`; reads in `src/server/support-queries.ts`. Screenshots are
  **private** Blobs under `support/<requesterId>/` in a dedicated store (`skedul-support`, env
  `SUPPORT_BLOB_READ_WRITE_TOKEN`; the public `BLOB_*` store stays for branding), served only by
  `/api/support/attachments/[id]` (owner or admin); `deleteUser` removes that folder. `/sign-in` and `/sign-up` accept `?next=`
  (validated by `safeNextPath`). Server Actions accept 4.5 MB bodies (Vercel's request cap,
  `next.config.ts`): screenshots are shrunk in the browser (`src/lib/shrink-image.ts`) to ≤ 1.3 MB each.
- **Money**: integer cents + `currency` (default `eur`). Format via `formatMoney`.
- **Time**: availability is wall-clock minutes-from-midnight in the pro's tz.
  Convert to instants with `instantFromWallClock` (`@date-fns/tz`). Slot logic in
  `src/lib/availability.ts` + `src/lib/slots.ts`.
- **Payments/email**: `env.STRIPE_ENABLED` / `env.RESEND_ENABLED` flip between live
  and mock. Mock checkout = `/api/mock-checkout`; both it and the Stripe webhook
  call the shared idempotent fulfillment in `src/lib/payments.ts`.
- **UI**: bespoke primitives in `src/components/ui/` (Tailwind v4, violet theme in
  `globals.css`). Use `Button asChild` (custom `Slot`) for links.

## Workflow
- `pnpm typecheck` and `pnpm build` must stay green.
- Schema change → `pnpm db:generate` then `pnpm db:migrate` (targets `DATABASE_URL`).
  If `db:migrate` fails locally (Windows), use `pnpm db:apply drizzle/<file>.sql`.
- 3 envs map to Neon branches: dev→`development`, preview→`preview`, prod→`main`.
- **Deploys are manual, CLI-only** (`vercel.ts` sets `git.deploymentEnabled: false`):
  `pnpm deploy:preview` / `pnpm deploy:prod`. Never re-enable auto Git deploys.
- Demo: `pro@skedul.app` / `password123`, public page `/altinha-paris`; admin
  `admin@skedul.test` (same password, created by the seed). Off production,
  `/sign-in` shows one-click logins for admin/pro/client (`DemoQuickLogin`).
  Never display demo credentials in the site UI.
