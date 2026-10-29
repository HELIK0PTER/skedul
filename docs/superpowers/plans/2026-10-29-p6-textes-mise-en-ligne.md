# P6 « Textes et mise en ligne » Implementation Plan (short form)

> **For agentic workers:** a short plan with no code in it, on the owner's light method (2026-10-28, « option 1 »). The work
> list is the P6 inventory `docs/superpowers/plans/2026-10-29-p6-inventory.md` (cited « INV »): every item below is an INV id,
> and INV holds its detail, files, sources and evidence. Read the INV entries of your group; never re-derive them. The INV
> evidence lines were checked read-only on 2026-10-29 at `9b36d67`: re-check each one before you change code.

**Goal:** Ship the redesign: close the security and behaviour carries of P2 to P5, rewrite every text that still describes
the old model (demo, landing, FAQ, README, AGENTS.md, metadata), clean dead code, lint and indexes, and prepare the go-live
of spec § 15.5 so the owner only has to follow a runbook.

**Architecture:** unchanged. The P4 and P5 patterns hold (pure modules and `(db, …, now)` cores under `src/lib/*`, thin
`"use server"` wrappers pinned by source guards, `safeRead`, throttles before writes, effects with budget `"none"` on public
paths, `logSafeMessage`). P6 adds one additive migration (Group D) and one guarded FAQ content migration (Group C2).

**Tech Stack:** Next.js 16.2.9 App Router, React 19, Drizzle 0.45.2 + Neon HTTP, Better Auth 1.6.19, Stripe 22, zod 4,
Tailwind v4, node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` (§ 15.1 row P6, § 15.4, § 15.5). Earlier outcomes:
P2 `2026-10-12-p2-domaine-outcome.md`, P3 `2026-10-14-p3-back-office-outcome.md`, P4 `2026-10-21-p4-public-outcome.md`,
P5 `2026-10-28-p5-rdv-libre-outcome.md`.

## Global Constraints

- Every Global Constraint of the P4 plan applies verbatim (`docs/superpowers/plans/2026-10-21-p4-public.md` lines 14 to 50),
  and so does the shared P6 brief `.superpowers/sdd/2026-10-29-p6-textes-mise-en-ligne/common-brief.md`.
- **Migrations:** Group D writes ONE additive migration `0013` (indexes, CHECKs, extensions); Group C2 writes ONE content
  migration `0014` (FAQ), guarded so it never overwrites an article the owner edited. Generate with
  `./node_modules/.bin/drizzle-kit generate` (`--custom` for hand SQL), apply with `./node_modules/.bin/tsx
  scripts/apply-migration.ts drizzle/<file>.sql` to tickets-dev (`.env.local`) and tickets-test (`.env.test`, through
  `--env-file`). Never `db:migrate`, never `db:push`, never any other Neon branch. Migrations 0010 to 0012 stay untouched.
- **No deploy, no push, no merge, no Neon write outside tickets-dev and tickets-test.** The go-live itself is the owner's
  (Group E prepares it).
- **Copy:** French, vouvoiement, zero U+2014 and zero U+2013 anywhere written; the vocabulary of the redesign (tickets,
  offres, carnets, séances, événements, rendez-vous); never « pack », « crédit », « prestation » in UI copy.
- **UI work** (Groups B, C1, C2) loads the `design-taste-frontend` skill first and checks its pages at 1280 and 375 px.
- **Light method:** TDD for behaviour, one commit per item or per coherent chunk, each implementer runs tsc, eslint on its
  files, the pure suite, the DB files it touches and `next build` at the end of its group. No per-task review, no sweep. One
  security review and one full test pass at the end (Group F).

## Decisions (controller rulings on the INV owner items, standing order of 2026-10-20)

- **Scope.** Every security item is in. Behaviour items are in when a person using Skedul meets them; the rest go to the
  « after go-live » backlog of the outcome (listed below), not to P6.
- **D3:** delete `hero-cards.tsx` and `ticket-cta.tsx` if nothing imports them (git keeps them).
- **Marketing address:** `myskedul.com` everywhere (the production domain).
- **Pitch lines** (landing h1, root title and description, footer tagline): the C2 implementer writes them; the owner may
  rewrite them later, copy is cheap to change.
- **D12 to D14:** keep the v1 redirect pages (they answer 308), `scripts/spike` (P1 evidence) and `/admin/subscriptions`
  (project 2, pros' SaaS billing).
- **A32, A33 (Google):** document the 200-occurrence backfill limit and the reconnect behaviour in the README; no new
  feature. Go-live does not wait for Google's verification of the Calendar scope (owner item in the runbook).
- **Not built:** O8 « Prochain créneau », O32 RDV buffers (A38), the optimistic séance header update.
- **B5 ACCOUNT_EXISTS:** kept (sign-up is throttled 3 per 10 min per IP); accepted residual in the outcome.
- **C16 spec text:** a dated « Amendements P4 et P5 » section at the end of the spec lists the approved changes as
  controller rulings awaiting the owner's yes; the body is not rewritten.
- **C11 FAQ:** a content migration (above), so every environment gets the new texts at deploy.
- **Retro-spend window, mail budget, sign-up rule, Sonnet commit trailers:** kept as they are (no history rewrite).

## Task groups (sequential, one implementer each)

### Group A: security (opus)

A1 (nightly same-tenant invariants, `paidPurchaseOf` refuses an empty id, professional predicates on the named joins; no
composite keys), A2, A3, A4, A5, A6, A7, A8, A9, A10, A21, A26, A27, A28. Each with its failing test first.

### Group B: behaviour and accessibility (opus)

A12, A13, A14, A16, A17, A18, A19, A20 (the fail-closed half; the CHECK goes to D1), A25, A34, A35, A36, A40, A42, A43, A44.

### Group D: migration 0013, dead code, lint, indexes (sonnet or opus)

D1 (indexes from the P2 list plus `ticket_movement.actor_user_id`, the A20 pair CHECK, and `unaccent` for A31), A31
(accent-insensitive client and planning search), D2 (EXPLAIN on tickets-dev, read-only, recorded), D3, D4 (`eslint` on the
whole repo green), D5, D6, D7, D8, D9, D10, D11.

### Group C1: the guided demo (opus, design-taste-frontend)

C1, C2, C3, C4, and the demo half of C9. The tour shows tickets, offres, séances, RDV libre and the client espace.

### Group C2: landing, copy pass, texts and docs (opus, design-taste-frontend)

C5, C6, C7, C8, the rest of C9, C10, B1 to B8 (B5 per the ruling), C11 (content migration 0014), C12 (README, with the
Google limits of A32 and A33), C13 (AGENTS.md: the tickets model, `slots.ts`, `isClient`, money and time notes; keep the rule
that demo credentials never appear in the UI), C14, C15, C16, C17, C18, C19.

### Group E: go-live preparation (opus)

E1 (the runbook `docs/superpowers/plans/2026-10-29-p6-runbook.md`, in French for the owner: INV « Owner items » 25 to 34 in
order, with each command, what to check and how to roll back), E2, E3 (live-switch script with `--dry-run`, tested on
tickets-test), E4 (read-only `checkInvariants` command), E5, E6, E7, E8 and E9 (as runbook steps).

### Group F: final

1. The full DB suite in chunks, the pure suite under the two host zones, tsc, eslint on the whole repo, `next build`, A11
   (production build: diff the RDV 404 bodies of an unknown and an archived id), and the browser tour A46 at 1280 and 375
   px (landing, demo, `/[slug]`, séance, offre, RDV, merci, espace, `/mon-espace`, `/aide`, sign-in, back office, admin).
2. ONE security review of `9b36d67..HEAD` on the most capable model.
3. ONE fix pass: Critical and Important only, each RED then GREEN, then the suite again.
4. The outcome `docs/superpowers/plans/2026-10-29-p6-textes-mise-en-ligne-outcome.md`: rulings, the owner list (INV « Owner
   items », updated), the after-go-live backlog, deferred minors, test data (INV « Test data to clean »).

## After go-live backlog (not in P6)

A15, A22, A23, A24, A29, A30, A32 and A33 (features), A37, A38, A39, A41, A45, A47 to A55 (test debt). The outcome lists
them with their INV ids so a later plan can pick them up.

## Review Focus

1. A tenancy crossing in a join or a nightly read once A1 lands, and any new action that reads identity from input (A4, A5).
2. Enumeration by timing or wording on the auth paths (A2, A3, A9, B5).
3. A hold counted live by one path and lapsed by another after A12 and A13 (mails, seats, the planning).
4. Migration 0013 or 0014 breaking a deploy: non-additive SQL, a lock on a large table, an FAQ article overwritten.
5. A text that still sells packs or credits, a dash, or a demo credential shown in the UI after C1 and C2.
