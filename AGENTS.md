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
- 3 envs map to Neon branches: dev→`development`, preview→`preview`, prod→`main`.
- **Deploys are manual, CLI-only** (`vercel.ts` sets `git.deploymentEnabled: false`):
  `pnpm deploy:preview` / `pnpm deploy:prod`. Never re-enable auto Git deploys.
- Demo: `pro@skedul.app` / `password123`, public page `/altinha-paris`.
