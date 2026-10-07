# Admin Space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin area (`/admin`) to monitor Skedul — overview, users (+ actions), traffic, activity, subscriptions stub — reached from the normal sign-in through an Admin/Client entry chooser.

**Architecture:** Better Auth's `admin` plugin provides role/ban/impersonation primitives; our `user_role` enum gains `admin`. A `requireAdmin()` guard re-reads the role from the database. Admin pages are dynamic Server Components backed by a dedicated `server-only` query module; user actions are server actions calling `auth.api.*`. Traffic is first-party and cookieless: a client beacon posts to `/api/track`, which stores anonymised rows in a new `page_view` table.

**Tech Stack:** Next.js 16.2 App Router (async `params`/`searchParams`/`cookies()`), React 19, Better Auth 1.6 (`admin` plugin), Drizzle ORM + Neon HTTP, Tailwind v4 bespoke primitives, lucide-react, `node:test` via `tsx`.

**Spec:** [`docs/superpowers/specs/2026-10-07-admin-space-design.md`](../specs/2026-10-07-admin-space-design.md)

## Global Constraints

- **Worktree:** all work happens in `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\admin` on branch `feat/admin`. Never `cd` to the main checkout.
- **pnpm 11:** always run scripts as `pnpm --config.verify-deps-before-run=false <script>`. **Never run `pnpm install`**: `node_modules` is a junction to the main checkout's, and install fails there on unresolved `allowBuilds` placeholders.
- **Dev server:** port **3100** (`.env.development.local` overrides the auth URLs). Start it with the Browser tool `preview_start` name `skedul-admin` (config lives in the main checkout's `.claude/launch.json`, untracked — never commit it).
- **Migrations:** `pnpm db:migrate` is broken on this Windows machine. Apply with `pnpm db:apply <file>` (created in Task 1). Vercel runs `db:migrate` on deploy.
- **Next.js 16:** `params`, `searchParams`, `cookies()`, `headers()` are async.
- **Neon HTTP:** no interactive transactions.
- **`"use server"` files** export only async functions (+ types). Shared non-action helpers go in `server-only` or pure modules.
- **Auth checks:** admin authorisation always goes through `getAdminUser()` / `requireAdmin()` (role re-read from the DB — the 5-min session cookie cache can be stale). Every admin page calls `requireAdmin()` itself (layouts and pages render in parallel).
- **Copy:** French UI strings; code comments in English. In JSX text, write apostrophes as `&apos;` (ESLint `react/no-unescaped-entities`).
- **UI:** reuse `src/components/ui/*` and the pro dashboard's visual language (sidebar, `PageHeader`, cards). No new dependencies. (The user's preferred `design-taste-frontend` skill is not installed here — match the existing UI.)
- **Charts:** single-series bars in theme primary `#6d5cf6` (validated: passes contrast and lightness checks on white), ≤24px wide, 4px rounded top, 2px gap, hairline grid, hover + keyboard tooltip, data-table fallback.
- **Money:** integer cents, summed **per currency**, displayed with `formatMoney`.
- **Days:** platform stats use `ADMIN_TZ = "Europe/Paris"`.
- **Green gates:** `pnpm test`, `pnpm typecheck`, `pnpm build` must pass at the end. `pnpm lint` already fails on `main` (baseline: 5 errors + 2 warnings in `event-types-manager.tsx`, `weekly-hours-editor.tsx`, `demo-tour.tsx`, `client-pack.tsx`, `client-profile.tsx`, `hero-cards.tsx` — leave those alone); it must report **no problem in any file this branch creates or modifies**.
- **Commits:** `git add` explicit paths only (never `-A`); end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test accounts (dev DB only):** demo seed accounts `pro@skedul.app` (pro) and `beatriz@example.com` (client) — password `password123`. A local admin `admin@skedul.test` is created in Task 4 with that same seed password.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/db/schema.ts` | modify | `admin` role, ban/last-login columns, `impersonated_by`, `page_view` table |
| `drizzle/0006_*.sql` + `drizzle/meta/*` | generated | migration |
| `scripts/apply-migration.ts` | create | apply one migration over Neon HTTP + journal it |
| `src/lib/auth.ts` | modify | `admin` plugin, `last_login_at` hook |
| `src/lib/suspension.ts` (+ test) | create | `isSuspended`, SQL twins |
| `src/lib/admin.ts` | create | `getAdminUser`, `requireAdmin` |
| `scripts/grant-admin.ts` | create | `pnpm admin:grant <email> [--revoke]` |
| `src/server/pro.ts` | modify | onboarding never demotes an admin |
| `src/lib/entry.ts` (+ test) | create | pure entry-choice logic |
| `src/server/entry.ts` | create | `resolvePostSignIn`, `chooseEntry`, `forgetEntryChoice` |
| `src/components/auth/entry-chooser.tsx` | create | the « Accéder au : » modal |
| `src/components/auth/auth-form.tsx`, `src/app/(auth)/sign-in/page.tsx` | modify | post-sign-in routing |
| `src/app/admin/layout.tsx`, `src/components/admin/admin-sidebar.tsx` | create | admin shell |
| `src/app/admin/page.tsx` | create (T4) → replace (T7) | overview |
| `src/app/admin/subscriptions/page.tsx` | create | empty state |
| `src/app/dashboard/layout.tsx`, `src/components/dashboard/sidebar.tsx`, `src/app/onboarding/page.tsx` | modify | switch links, impersonation banner |
| `src/lib/analytics.ts` (+ test) | create | tracking helpers (isomorphic) |
| `src/lib/visitor-hash.ts` (+ test) | create | daily visitor hash (node:crypto) |
| `src/app/api/track/route.ts` | create | page-view ingestion |
| `src/components/analytics/page-view-tracker.tsx`, `src/app/layout.tsx` | create / modify | beacon |
| `src/lib/admin-metrics.ts` (+ test) | create | day keys, series, money, labels |
| `src/lib/admin-params.ts` (+ test) | create | search-param parsing, labels, ban durations |
| `src/lib/datetime.ts`, `src/lib/env.ts` | modify | short date formats, webhook flag |
| `src/server/admin-queries.ts` | create (T7) + extend (T8, T10, T11) | all admin reads |
| `src/components/admin/{stat-card,bar-chart,activity-feed,app-health-card}.tsx` | create | overview widgets |
| `src/components/admin/{user-badges,filter-chips,pagination}.tsx` | create | list widgets |
| `src/app/admin/users/page.tsx`, `src/app/admin/users/[id]/page.tsx` | create | users |
| `src/server/admin.ts`, `src/components/admin/user-actions.tsx` | create | user actions |
| `src/components/dashboard/impersonation-banner.tsx` | create | « Revenir à l'admin » |
| `src/server/queries.ts`, `src/server/public.ts` | modify | suspended pros are offline |
| `src/app/admin/activity/page.tsx` | create | activity |
| `src/components/admin/top-list.tsx`, `src/app/admin/traffic/page.tsx` | create | traffic |
| `package.json` | modify | `db:apply`, `admin:grant` scripts |
| `AGENTS.md`, `README.md` | modify | docs |

---

### Task 1: Schema, migration & Better Auth admin plugin

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: `drizzle/0006_*.sql`, `drizzle/meta/0006_snapshot.json`, `drizzle/meta/_journal.json`
- Create: `scripts/apply-migration.ts`
- Modify: `package.json`
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Produces: `userRole` enum `"client" | "pro" | "admin"`; `user.banned: boolean`, `user.banReason: string | null`, `user.banExpires: Date | null`, `user.lastLoginAt: Date | null`; `session.impersonatedBy: string | null`; table export `pageView` with columns `id, createdAt, path, professionalId, referrerHost, source, entry, device, country, visitorHash`; `auth.api.banUser / unbanUser / revokeUserSessions / impersonateUser / stopImpersonating` available; `typeof auth.$Infer.Session` has `session.impersonatedBy`.

- [ ] **Step 1: Baseline check**

Run: `pnpm --config.verify-deps-before-run=false typecheck`
Expected: exits 0 (`tsc --noEmit` prints nothing).

- [ ] **Step 2: Extend the schema**

In `src/lib/db/schema.ts`, replace the `userRole` line:

```ts
export const userRole = pgEnum("user_role", ["client", "pro", "admin"]);
```

Replace the `user` table with:

```ts
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRole("role").default("client").notNull(),
  // Better Auth admin plugin (suspension)
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  // stamped on every real sign-in (see databaseHooks in src/lib/auth.ts)
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});
```

In the `session` table, add after `userAgent: text("user_agent"),`:

```ts
    // Better Auth admin plugin: id of the admin behind an impersonation session
    impersonatedBy: text("impersonated_by"),
```

After the `bookingAnswer` table (end of the "Domain tables" section, before "Relations"), add:

```ts
/** One public page view from the cookieless tracker (see src/app/api/track). Immutable. */
export const pageView = pgTable(
  "page_view",
  {
    id: id(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    path: text("path").notNull(),
    // resolved from the slug at visit time, so it survives a slug change
    professionalId: text("professional_id").references(() => professional.id, {
      onDelete: "set null",
    }),
    referrerHost: text("referrer_host"),
    source: text("source"),
    // first view of a visit (external or no referrer)
    entry: boolean("entry").default(false).notNull(),
    device: text("device").notNull(),
    country: text("country"),
    // daily-rotating anonymous hash — the IP is never stored
    visitorHash: text("visitor_hash").notNull(),
  },
  (t) => [
    index("page_view_created_idx").on(t.createdAt),
    index("page_view_pro_created_idx").on(t.professionalId, t.createdAt),
  ],
);
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --config.verify-deps-before-run=false db:generate`
Expected: a new file `drizzle/0006_<random>.sql` whose statements are exactly (order may differ):

```sql
ALTER TYPE "public"."user_role" ADD VALUE 'admin';
CREATE TABLE "page_view" ( "id" text PRIMARY KEY NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "path" text NOT NULL, "professional_id" text, "referrer_host" text, "source" text, "entry" boolean DEFAULT false NOT NULL, "device" text NOT NULL, "country" text, "visitor_hash" text NOT NULL );
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;
ALTER TABLE "user" ADD COLUMN "ban_reason" text;
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;
ALTER TABLE "user" ADD COLUMN "last_login_at" timestamp with time zone;
ALTER TABLE "page_view" ADD CONSTRAINT "page_view_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "page_view_created_idx" ON "page_view" USING btree ("created_at");
CREATE INDEX "page_view_pro_created_idx" ON "page_view" USING btree ("professional_id","created_at");
```

If the file contains any other statement, stop and report (schema drift).

- [ ] **Step 4: Write the migration applier**

Create `scripts/apply-migration.ts`:

```ts
import "./load-env";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { neon } from "@neondatabase/serverless";

/**
 * Applies one drizzle migration over Neon's HTTP driver — a stand-in for
 * `pnpm db:migrate`, whose connection fails on some Windows machines.
 * Statements run one by one (neon-http has no transactions), then the file is
 * recorded in drizzle's journal so a later `db:migrate` skips it.
 *
 *   pnpm db:apply drizzle/0006_xxx.sql
 */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: pnpm db:apply drizzle/<migration>.sql");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const sql = neon(process.env.DATABASE_URL);
  const content = readFileSync(file, "utf8");
  const tag = basename(file, ".sql");
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) throw new Error(`${tag} is not in drizzle/meta/_journal.json`);

  await sql.query(`create schema if not exists drizzle`);
  await sql.query(
    `create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
  );
  const applied = await sql.query(
    `select 1 from drizzle.__drizzle_migrations where created_at = $1`,
    [entry.when],
  );
  if (applied.length > 0) {
    console.info(`= ${tag} already applied, nothing to do.`);
    return;
  }

  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await sql.query(statement);
    console.info(`✓ ${statement.split("\n")[0]}`);
  }

  // drizzle only compares created_at with the latest row, so this also marks
  // every earlier migration as applied.
  const hash = createHash("sha256").update(content).digest("hex");
  await sql.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
    [hash, entry.when],
  );
  console.info(`✓ ${tag} applied and recorded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

In `package.json` `"scripts"`, add after `"db:seed"`:

```json
    "db:apply": "tsx scripts/apply-migration.ts",
```

- [ ] **Step 5: Apply the migration to the development branch**

Run: `pnpm --config.verify-deps-before-run=false db:apply "$(ls drizzle/0006_*.sql)"`
Expected: one `✓` line per statement, then `✓ 0006_<random> applied and recorded.`

Verify:

```bash
node --env-file=.env.local --input-type=module -e "import { neon } from '@neondatabase/serverless'; const sql = neon(process.env.DATABASE_URL); console.table(await sql.query(\"select table_name, column_name from information_schema.columns where (table_name = 'user' and column_name in ('banned','ban_reason','ban_expires','last_login_at')) or (table_name = 'session' and column_name = 'impersonated_by') or table_name = 'page_view' order by 1, 2\")); console.table(await sql.query(\"select unnest(enum_range(null::user_role)) as role\"));"
```

Expected: the 4 `user` columns, `session.impersonated_by`, the 10 `page_view` columns, and roles `client`, `pro`, `admin`.

- [ ] **Step 6: Enable the admin plugin and the last-login hook**

Replace `src/lib/auth.ts` with:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";

export const auth = betterAuth({
  appName: "Skedul",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
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
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "client",
        input: false,
      },
    },
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  databaseHooks: {
    session: {
      create: {
        // "Dernière connexion": real sign-ins only, not admin impersonation.
        after: async (session) => {
          if (session.impersonatedBy) return;
          try {
            await db
              .update(schema.user)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.user.id, session.userId));
          } catch (err) {
            console.error("[auth] could not stamp last_login_at", err);
          }
        },
      },
    },
  },
  plugins: [
    // Roles, suspension, impersonation. defaultRole must be a user_role enum
    // value — the plugin's own default ("user") would violate the enum.
    admin({
      defaultRole: "client",
      adminRoles: ["admin"],
      bannedUserMessage:
        "Votre compte a été suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
    }),
    // nextCookies() must be the last plugin so it can set cookies in actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck`
Expected: exits 0.

- [ ] **Step 8: Smoke-test sign-in still works**

Start the dev server (Browser tool `preview_start` name `skedul-admin`), open `http://localhost:3100/sign-in`, sign in as `pro@skedul.app` / `password123`.
Expected: lands on `/dashboard`. Then verify the hook:

```bash
node --env-file=.env.local --input-type=module -e "import { neon } from '@neondatabase/serverless'; const sql = neon(process.env.DATABASE_URL); console.table(await sql.query(\"select email, role, last_login_at from \\\"user\\\" order by email\"));"
```

Expected: `pro@skedul.app` has a `last_login_at` within the last minute. Sign out afterwards.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ scripts/apply-migration.ts package.json src/lib/auth.ts
git commit -m "feat(admin): admin role, ban and page_view schema + Better Auth admin plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Suspension helpers, admin guard & grant script

**Files:**
- Create: `src/lib/suspension.ts`, test `src/lib/suspension.test.ts`
- Create: `src/lib/admin.ts`
- Create: `scripts/grant-admin.ts`
- Modify: `package.json`
- Modify: `src/server/pro.ts` (`createProfessionalProfile`)

**Interfaces:**
- Consumes: `user` table columns from Task 1; `getSession()` from `src/lib/session.ts`.
- Produces:
  - `isSuspended(u: { banned: boolean | null; banExpires: Date | null }, now?: Date): boolean`
  - `userIsSuspended(): SQL` / `userNotSuspended(): SQL` — predicates on the joined `user` table.
  - `type AdminUser = { id: string; name: string; email: string }`
  - `getAdminUser(): Promise<AdminUser | null>` (request-memoised)
  - `requireAdmin(): Promise<AdminUser>` — redirect `/sign-in` when signed out, `notFound()` when not admin.

- [ ] **Step 1: Write the failing test**

Create `src/lib/suspension.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { isSuspended } from "./suspension";

const now = new Date("2026-10-07T12:00:00Z");

test("isSuspended is false when the user is not banned", () => {
  assert.equal(isSuspended({ banned: false, banExpires: null }, now), false);
  assert.equal(isSuspended({ banned: null, banExpires: null }, now), false);
});

test("isSuspended is true for an open-ended ban", () => {
  assert.equal(isSuspended({ banned: true, banExpires: null }, now), true);
});

test("isSuspended is true while the ban end is in the future", () => {
  const banExpires = new Date("2026-10-08T12:00:00Z");
  assert.equal(isSuspended({ banned: true, banExpires }, now), true);
});

test("isSuspended is false once the ban end has passed", () => {
  const banExpires = new Date("2026-10-06T12:00:00Z");
  assert.equal(isSuspended({ banned: true, banExpires }, now), false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/suspension.test.ts`
Expected: FAIL — cannot find module `./suspension`.

- [ ] **Step 3: Implement**

Create `src/lib/suspension.ts`:

```ts
import { sql, type SQL } from "drizzle-orm";

import { user } from "@/lib/db/schema";

/**
 * A user is suspended while `banned` is set and the ban has no end or ends in
 * the future. A ban whose date has passed counts as lifted (Better Auth clears
 * the row lazily on the next sign-in).
 */
export function isSuspended(
  u: { banned: boolean | null; banExpires: Date | null },
  now: Date = new Date(),
): boolean {
  if (!u.banned) return false;
  return u.banExpires === null || u.banExpires.getTime() > now.getTime();
}

/** SQL twin of `isSuspended`, for queries that join the `user` table. */
export function userIsSuspended(): SQL {
  return sql`(${user.banned} and (${user.banExpires} is null or ${user.banExpires} > now()))`;
}

export function userNotSuspended(): SQL {
  return sql`not ${userIsSuspended()}`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/suspension.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Admin guard**

Create `src/lib/admin.ts`:

```ts
import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { isSuspended } from "@/lib/suspension";

export type AdminUser = { id: string; name: string; email: string };

/**
 * The signed-in user when they are an active admin, else null. The role is
 * re-read from the database: the session cookie cache can lag by 5 minutes.
 */
export const getAdminUser = cache(async (): Promise<AdminUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!row || row.role !== "admin" || isSuspended(row)) return null;
  return { id: row.id, name: row.name, email: row.email };
});

/** Admin page guard: signed out → /sign-in; signed in but not admin → 404. */
export async function requireAdmin(): Promise<AdminUser> {
  if (!(await getSession())) redirect("/sign-in");
  const admin = await getAdminUser();
  if (!admin) notFound();
  return admin;
}
```

- [ ] **Step 6: Grant script**

Create `scripts/grant-admin.ts`:

```ts
import "./load-env";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { professional, user } from "@/lib/db/schema";

/**
 * Grants — or with --revoke removes — the admin role on the DATABASE_URL db.
 *   pnpm admin:grant you@example.com
 *   pnpm admin:grant you@example.com --revoke
 */
async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: pnpm admin:grant <email> [--revoke]");
    process.exit(1);
  }

  const [target] = await db
    .select({ id: user.id, proId: professional.id })
    .from(user)
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1);
  if (!target) {
    console.error(`✗ Aucun compte pour ${email}. Créez-le d'abord via /sign-up.`);
    process.exit(1);
  }

  const role = revoke ? (target.proId ? "pro" : "client") : "admin";
  await db.update(user).set({ role }).where(eq(user.id, target.id));
  console.info(
    `✓ ${email} → rôle "${role}". Reconnectez-vous pour que la session en tienne compte.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

In `package.json` `"scripts"`, add after `"db:apply"`:

```json
    "admin:grant": "tsx scripts/grant-admin.ts",
```

- [ ] **Step 7: Exercise the grant script both ways**

Run: `pnpm --config.verify-deps-before-run=false admin:grant pro@skedul.app`
Expected: `✓ pro@skedul.app → rôle "admin". …`
Run: `pnpm --config.verify-deps-before-run=false admin:grant pro@skedul.app --revoke`
Expected: `✓ pro@skedul.app → rôle "pro". …` (it has a pro page).
Run: `pnpm --config.verify-deps-before-run=false admin:grant nobody@skedul.test`
Expected: `✗ Aucun compte pour nobody@skedul.test…` and exit code 1.

- [ ] **Step 8: Onboarding must not demote an admin**

In `src/server/pro.ts`, inside `createProfessionalProfile`, replace:

```ts
  await db
    .update(userTable)
    .set({ role: "pro" })
    .where(eq(userTable.id, user.id));
```

with:

```ts
  // Promote plain clients to "pro" — never demote an admin.
  await db
    .update(userTable)
    .set({ role: "pro" })
    .where(and(eq(userTable.id, user.id), eq(userTable.role, "client")));
```

(`and` is already imported in this file.)

- [ ] **Step 9: Typecheck & commit**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

```bash
git add src/lib/suspension.ts src/lib/suspension.test.ts src/lib/admin.ts scripts/grant-admin.ts package.json src/server/pro.ts
git commit -m "feat(admin): suspension helpers, admin guard and admin:grant script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Entry chooser after sign-in

**Files:**
- Create: `src/lib/entry.ts`, test `src/lib/entry.test.ts`
- Create: `src/server/entry.ts`
- Create: `src/components/auth/entry-chooser.tsx`
- Modify: `src/components/auth/auth-form.tsx`
- Modify: `src/app/(auth)/sign-in/page.tsx`

**Interfaces:**
- Consumes: `getAdminUser()` (Task 2).
- Produces:
  - `type EntryChoice = "admin" | "client"`; `ENTRY_COOKIE = "skedul_entry"`; `ENTRY_COOKIE_MAX_AGE` (seconds); `ENTRY_LABELS: Record<EntryChoice, string>`
  - `parseEntryChoice(value: string | null | undefined): EntryChoice | null`
  - `entryPath(choice: EntryChoice): "/admin" | "/dashboard"`
  - `resolveEntry(input: { isAdmin: boolean; remembered: EntryChoice | null }): "/admin" | "/dashboard" | "choose"`
  - Server actions: `resolvePostSignIn(): Promise<PostSignIn>` where `type PostSignIn = { kind: "redirect"; to: string } | { kind: "choose" }`; `chooseEntry(choice: EntryChoice, remember: boolean): Promise<string>`; `forgetEntryChoice(): Promise<void>`
  - `<EntryChooser open: boolean />`; `<AuthForm mode initialChooser?: boolean />`

- [ ] **Step 1: Write the failing test**

Create `src/lib/entry.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { entryPath, parseEntryChoice, resolveEntry } from "./entry";

test("resolveEntry sends non-admins to /dashboard, whatever the cookie says", () => {
  assert.equal(resolveEntry({ isAdmin: false, remembered: null }), "/dashboard");
  assert.equal(resolveEntry({ isAdmin: false, remembered: "admin" }), "/dashboard");
});

test("resolveEntry asks an admin to choose when nothing is remembered", () => {
  assert.equal(resolveEntry({ isAdmin: true, remembered: null }), "choose");
});

test("resolveEntry follows an admin's remembered choice", () => {
  assert.equal(resolveEntry({ isAdmin: true, remembered: "admin" }), "/admin");
  assert.equal(resolveEntry({ isAdmin: true, remembered: "client" }), "/dashboard");
});

test("parseEntryChoice accepts only admin or client", () => {
  assert.equal(parseEntryChoice("admin"), "admin");
  assert.equal(parseEntryChoice("client"), "client");
  for (const bad of ["", "root", "ADMIN", undefined, null]) {
    assert.equal(parseEntryChoice(bad), null);
  }
});

test("entryPath maps each choice to its dashboard", () => {
  assert.equal(entryPath("admin"), "/admin");
  assert.equal(entryPath("client"), "/dashboard");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/entry.test.ts`
Expected: FAIL — cannot find module `./entry`.

- [ ] **Step 3: Implement the pure logic**

Create `src/lib/entry.ts`:

```ts
/** Where an admin lands after signing in: the admin area or their own dashboard. */
export type EntryChoice = "admin" | "client";

/** Remembers an admin's choice on this device; survives sign-out on purpose. */
export const ENTRY_COOKIE = "skedul_entry";
export const ENTRY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

export const ENTRY_LABELS: Record<EntryChoice, string> = {
  admin: "Dashboard Admin",
  client: "Dashboard Client",
};

export function parseEntryChoice(
  value: string | null | undefined,
): EntryChoice | null {
  return value === "admin" || value === "client" ? value : null;
}

export function entryPath(choice: EntryChoice): "/admin" | "/dashboard" {
  return choice === "admin" ? "/admin" : "/dashboard";
}

/** Destination right after sign-in, or "choose" to show the chooser. */
export function resolveEntry(input: {
  isAdmin: boolean;
  remembered: EntryChoice | null;
}): "/admin" | "/dashboard" | "choose" {
  if (!input.isAdmin) return "/dashboard";
  return input.remembered ? entryPath(input.remembered) : "choose";
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/entry.test.ts`
Expected: 5 passing tests.

- [ ] **Step 5: Server actions**

Create `src/server/entry.ts`:

```ts
"use server";

import { cookies } from "next/headers";

import { getAdminUser } from "@/lib/admin";
import {
  ENTRY_COOKIE,
  ENTRY_COOKIE_MAX_AGE,
  entryPath,
  parseEntryChoice,
  resolveEntry,
  type EntryChoice,
} from "@/lib/entry";

export type PostSignIn = { kind: "redirect"; to: string } | { kind: "choose" };

/** Where a signed-in user goes next; admins without a remembered choice must choose. */
export async function resolvePostSignIn(): Promise<PostSignIn> {
  const [admin, store] = await Promise.all([getAdminUser(), cookies()]);
  const target = resolveEntry({
    isAdmin: admin !== null,
    remembered: parseEntryChoice(store.get(ENTRY_COOKIE)?.value),
  });
  return target === "choose"
    ? { kind: "choose" }
    : { kind: "redirect", to: target };
}

/** Records an admin's choice (optionally remembered on this device) and returns the path. */
export async function chooseEntry(
  choice: EntryChoice,
  remember: boolean,
): Promise<string> {
  const valid = parseEntryChoice(choice);
  if (!valid || !(await getAdminUser())) return "/dashboard";
  if (remember) {
    (await cookies()).set(ENTRY_COOKIE, valid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ENTRY_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return entryPath(valid);
}

export async function forgetEntryChoice(): Promise<void> {
  (await cookies()).delete(ENTRY_COOKIE);
}
```

- [ ] **Step 6: The chooser modal**

Create `src/components/auth/entry-chooser.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Loader2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { ENTRY_LABELS, type EntryChoice } from "@/lib/entry";
import { chooseEntry } from "@/server/entry";

const OPTIONS: { choice: EntryChoice; description: string; icon: LucideIcon }[] = [
  {
    choice: "admin",
    description: "Monitoring de l'app, utilisateurs, trafic.",
    icon: ShieldCheck,
  },
  {
    choice: "client",
    description: "Votre back-office de réservation.",
    icon: LayoutDashboard,
  },
];

/** Shown to admins after sign-in. It cannot be dismissed without choosing. */
export function EntryChooser({ open }: { open: boolean }) {
  const router = useRouter();
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState<EntryChoice | null>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstOption.current?.focus();
  }, [open]);

  if (!open) return null;

  async function pick(choice: EntryChoice) {
    setPending(choice);
    const to = await chooseEntry(choice, remember);
    router.push(to);
    router.refresh();
  }

  // Keep Tab inside the dialog (it has no close button by design).
  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const items = e.currentTarget.querySelectorAll<HTMLElement>("button, input");
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-chooser-title"
        onKeyDown={trapFocus}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="entry-chooser-title" className="text-lg font-semibold">
          Accéder au :
        </h2>
        <div className="mt-4 grid gap-3">
          {OPTIONS.map(({ choice, description, icon: Icon }, i) => (
            <button
              key={choice}
              ref={i === 0 ? firstOption : undefined}
              type="button"
              disabled={pending !== null}
              onClick={() => pick(choice)}
              className="flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-muted text-accent-foreground">
                {pending === choice ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Icon className="size-5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{ENTRY_LABELS[choice]}</span>
                <span className="block text-sm text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-4 accent-primary"
          />
          Se souvenir de mon choix
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Route through the chooser after sign-in**

Replace `src/components/auth/auth-form.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { signIn, signUp } from "@/lib/auth-client";
import { resolvePostSignIn } from "@/server/entry";
import { EntryChooser } from "@/components/auth/entry-chooser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  initialChooser = false,
}: {
  mode: "sign-in" | "sign-up";
  /** Open the admin entry chooser right away (an admin is already signed in). */
  initialChooser?: boolean;
}) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(initialChooser);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "");

    const result = isSignUp
      ? await signUp.email({ email, password, name })
      : await signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Une erreur est survenue.");
      setLoading(false);
      return;
    }

    if (isSignUp) {
      router.push("/onboarding");
      router.refresh();
      return;
    }

    // Admins pick Admin vs Client (unless remembered); everyone else → /dashboard.
    const next = await resolvePostSignIn();
    if (next.kind === "choose") {
      setLoading(false);
      setChoosing(true);
      return;
    }
    router.push(next.to);
    router.refresh();
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        {isSignUp && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom complet</Label>
            <Input id="name" name="name" placeholder="Camille Laurent" required />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="vous@exemple.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Mot de passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {isSignUp ? "Créer mon compte" : "Se connecter"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <>
              Déjà un compte ?{" "}
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                Se connecter
              </Link>
            </>
          ) : (
            <>
              Pas encore de compte ?{" "}
              <Link href="/sign-up" className="font-medium text-primary hover:underline">
                Créer un compte
              </Link>
            </>
          )}
        </p>
      </form>
      <EntryChooser open={choosing} />
    </>
  );
}
```

Replace `src/app/(auth)/sign-in/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { DemoQuickLogin } from "@/components/auth/demo-quick-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { resolvePostSignIn } from "@/server/entry";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage() {
  // Already signed in: same routing as right after sign-in (admins may choose).
  let showChooser = false;
  if (await getCurrentUser()) {
    const next = await resolvePostSignIn();
    if (next.kind === "redirect") redirect(next.to);
    showChooser = true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Bon retour 👋</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour accéder à votre espace.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm mode="sign-in" initialChooser={showChooser} />
        {env.APP_ENV !== "production" && <DemoQuickLogin />}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Typecheck & non-admin smoke test**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.
In the browser (dev server on :3100): sign in as `pro@skedul.app` → expected: straight to `/dashboard`, no modal. Visit `/sign-in` again while signed in → expected: redirected to `/dashboard`. Sign out.
(The admin path is verified in Task 4, once `/admin` exists.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/entry.ts src/lib/entry.test.ts src/server/entry.ts src/components/auth/entry-chooser.tsx src/components/auth/auth-form.tsx "src/app/(auth)/sign-in/page.tsx"
git commit -m "feat(admin): Admin/Client entry chooser after sign-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin shell & dashboard switch links

**Files:**
- Create: `src/app/admin/layout.tsx`
- Create: `src/components/admin/admin-sidebar.tsx`
- Create: `src/app/admin/page.tsx` (minimal; replaced in Task 7)
- Create: `src/app/admin/subscriptions/page.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/components/dashboard/sidebar.tsx`
- Modify: `src/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin` (Task 2); `ENTRY_COOKIE`, `ENTRY_LABELS`, `parseEntryChoice`, `type EntryChoice` (Task 3); `forgetEntryChoice` (Task 3); `PageHeader` from `src/components/dashboard/page-header.tsx`.
- Produces: `<AdminSidebar adminName: string; remembered: EntryChoice | null />`; `<DashboardSidebar … isAdmin?: boolean />`.

- [ ] **Step 1: Admin layout**

Create `src/app/admin/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdmin } from "@/lib/admin";
import { ENTRY_COOKIE, parseEntryChoice } from "@/lib/entry";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Skedul" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  const remembered = parseEntryChoice((await cookies()).get(ENTRY_COOKIE)?.value);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar adminName={admin.name} remembered={remembered} />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Admin sidebar**

Create `src/components/admin/admin-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Activity,
  ArrowLeftRight,
  CreditCard,
  LayoutDashboard,
  LineChart,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { ENTRY_LABELS, type EntryChoice } from "@/lib/entry";
import { cn } from "@/lib/utils";
import { forgetEntryChoice } from "@/server/entry";

const NAV = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Utilisateurs", icon: Users },
  { href: "/admin/traffic", label: "Trafic", icon: LineChart },
  { href: "/admin/activity", label: "Activité", icon: Activity },
  { href: "/admin/subscriptions", label: "Abonnements", icon: CreditCard },
];

export function AdminSidebar({
  adminName,
  remembered,
}: {
  adminName: string;
  remembered: EntryChoice | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="sticky top-0 z-30 flex w-full shrink-0 flex-col border-b border-border bg-card md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between p-4 md:block">
        <Link href="/admin" className="inline-flex items-center gap-2">
          <Logo />
          <Badge>Admin</Badge>
        </Link>
        <p className="mt-3 hidden truncate text-sm text-muted-foreground md:block">
          {adminName}
        </p>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible md:px-3">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="hidden gap-2 border-t border-border p-3 md:flex md:flex-col">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
        >
          <ArrowLeftRight className="size-4" />
          {ENTRY_LABELS.client}
        </Link>
        {remembered && (
          <div className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Choix mémorisé :{" "}
            <span className="font-medium text-foreground">
              {ENTRY_LABELS[remembered]}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await forgetEntryChoice();
                  router.refresh();
                })
              }
              className="mt-1 block font-medium text-primary hover:underline disabled:opacity-50"
            >
              Oublier mon choix
            </button>
          </div>
        )}
        <SignOutButton variant="ghost" size="sm" />
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Minimal overview and the subscriptions empty state**

Create `src/app/admin/page.tsx`:

```tsx
import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default async function AdminOverviewPage() {
  await requireAdmin();
  return (
    <PageHeader
      title="Vue d'ensemble"
      description="L'activité de Skedul, toutes pages pro confondues."
    />
  );
}
```

Create `src/app/admin/subscriptions/page.tsx`:

```tsx
import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Abonnements" };

export default async function AdminSubscriptionsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Abonnements" description="Les plans payants des pros." />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary-muted text-accent-foreground">
            <CreditCard className="size-6" aria-hidden />
          </span>
          <h2 className="text-base font-semibold">
            La facturation des pros n&apos;est pas encore en place
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Skedul est gratuit pour les pros aujourd&apos;hui. Quand les plans
            payants arriveront, cette page affichera les plans, les abonnés
            actifs, le revenu mensuel récurrent (MRR) et les résiliations.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 4: "Dashboard Admin" link in the pro sidebar**

In `src/components/dashboard/sidebar.tsx`:
1. Add `ShieldCheck` to the `lucide-react` import list.
2. Change the props to:

```tsx
export function DashboardSidebar({
  businessName,
  slug,
  isAdmin = false,
}: {
  businessName: string;
  slug: string;
  isAdmin?: boolean;
}) {
```

3. In the footer `<div className="hidden gap-2 border-t …">`, insert before the "Voir ma page publique" `<Link>`:

```tsx
        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
          >
            <ShieldCheck className="size-4" />
            Dashboard Admin
          </Link>
        )}
```

Replace `src/app/dashboard/layout.tsx` with:

```tsx
import { redirect } from "next/navigation";

import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { brandThemeVars } from "@/lib/color";
import { getCurrentProfessional, getSession } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const pro = await getCurrentProfessional();
  if (!pro) redirect("/onboarding");

  return (
    <div
      className="flex min-h-screen flex-col md:flex-row"
      style={brandThemeVars(pro.brandColor)}
    >
      <DashboardSidebar
        businessName={pro.businessName}
        slug={pro.slug}
        // UI hint only — /admin re-checks the role in the database.
        isAdmin={session.user.role === "admin"}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Way back to the admin from onboarding**

In `src/app/onboarding/page.tsx`, add `import Link from "next/link";` and, right after the closing `</Card>`, insert:

```tsx
        {user.role === "admin" && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/admin" className="font-medium text-primary hover:underline">
              Aller au Dashboard Admin
            </Link>
          </p>
        )}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 7: Create the local test admin**

In the browser (dev server on :3100): `/sign-up` with name `Admin Skedul`, email `admin@skedul.test`, password `password123` → lands on `/onboarding`; do **not** create a pro page and stay signed in.
Run: `pnpm --config.verify-deps-before-run=false admin:grant admin@skedul.test`
Expected: `✓ admin@skedul.test → rôle "admin". …`

- [ ] **Step 8: Browser verification of the whole entry flow**

1. Still signed in from Step 7, open `/sign-in` → the page renders with the modal « Accéder au : » already open (signed-in admin, nothing remembered): **Dashboard Admin**, **Dashboard Client**, checkbox **Se souvenir de mon choix** (unchecked). Escape and clicking outside do nothing.
2. Choose **Dashboard Admin** (unchecked) → `/admin` with the admin sidebar (badge « Admin », 5 nav items, « Dashboard Client », no « Choix mémorisé »).
3. Click **Abonnements** → empty state renders.
4. Click **Dashboard Client** → `/onboarding` showing « Aller au Dashboard Admin » → click it → `/admin`.
5. **Se déconnecter** (sidebar), sign in again → modal (nothing remembered). Check **Se souvenir de mon choix**, choose **Dashboard Admin** → `/admin`, sidebar shows « Choix mémorisé : Dashboard Admin ».
6. Sign out, sign in → no modal, straight to `/admin`.
7. Click **Oublier mon choix** → the memo disappears. Sign out, sign in → modal again. Choose Dashboard Admin. Sign out.
8. Sign in as `pro@skedul.app` → `/dashboard` directly; the pro sidebar has **no** « Dashboard Admin » link; visiting `/admin` → 404 page. Sign out.
9. Signed out, visit `/admin` → redirected to `/sign-in`.

- [ ] **Step 9: Commit**

```bash
git add src/app/admin/layout.tsx src/components/admin/admin-sidebar.tsx src/app/admin/page.tsx src/app/admin/subscriptions/page.tsx src/components/dashboard/sidebar.tsx src/app/dashboard/layout.tsx src/app/onboarding/page.tsx
git commit -m "feat(admin): admin shell, subscriptions stub and dashboard switch links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cookieless traffic collection

**Files:**
- Create: `src/lib/analytics.ts`, test `src/lib/analytics.test.ts`
- Create: `src/lib/visitor-hash.ts`, test `src/lib/visitor-hash.test.ts`
- Create: `src/app/api/track/route.ts`
- Create: `src/components/analytics/page-view-tracker.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `pageView`, `professional` tables (Task 1); `dayKeyInTz` (`src/lib/datetime.ts`); `env.BETTER_AUTH_SECRET`.
- Produces (all pure, isomorphic, in `src/lib/analytics.ts`):
  - `ADMIN_TZ = "Europe/Paris"`
  - `type Device = "mobile" | "tablet" | "desktop"`
  - `type ReferrerKind = { kind: "none" } | { kind: "internal" } | { kind: "external"; host: string }`
  - `isTrackedPath(path: string): boolean`
  - `proSlugFromPath(path: string): string | null`
  - `isBot(userAgent: string): boolean`
  - `classifyDevice(userAgent: string): Device`
  - `browserName(userAgent: string | null | undefined): string`
  - `classifyReferrer(referrer: string | null | undefined, ownHost: string): ReferrerKind`
  - `normalizeSource(utmSource: string | null | undefined): string | null`
  - In `src/lib/visitor-hash.ts`: `visitorHash(input: { secret: string; dayKey: string; ip: string; userAgent: string }): string` (32 hex chars)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/analytics.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  browserName,
  classifyDevice,
  classifyReferrer,
  isBot,
  isTrackedPath,
  normalizeSource,
  proSlugFromPath,
} from "./analytics";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

test("isTrackedPath keeps public pages and drops back-office, admin and API", () => {
  for (const p of ["/", "/demo", "/sign-in", "/altinha-paris", "/altinha-paris/book/abc", "/dashboardx"]) {
    assert.equal(isTrackedPath(p), true, p);
  }
  for (const p of ["/dashboard", "/dashboard/planning", "/onboarding", "/admin", "/admin/users", "/api/track", "relative"]) {
    assert.equal(isTrackedPath(p), false, p);
  }
});

test("proSlugFromPath returns the pro slug of public pro pages only", () => {
  assert.equal(proSlugFromPath("/altinha-paris"), "altinha-paris");
  assert.equal(proSlugFromPath("/altinha-paris/book/abc"), "altinha-paris");
  for (const p of ["/", "/demo", "/sign-in", "/sign-up", "/Altinha"]) {
    assert.equal(proSlugFromPath(p), null, p);
  }
});

test("isBot flags crawlers and scripts, not browsers", () => {
  assert.equal(isBot(UA.googlebot), true);
  assert.equal(isBot("curl/8.5.0"), true);
  assert.equal(isBot("Mozilla/5.0 HeadlessChrome/126.0"), true);
  assert.equal(isBot(UA.chromeWindows), false);
  assert.equal(isBot(UA.iphone), false);
});

test("classifyDevice tells phones, tablets and desktops apart", () => {
  assert.equal(classifyDevice(UA.iphone), "mobile");
  assert.equal(classifyDevice(UA.androidPhone), "mobile");
  assert.equal(classifyDevice(UA.ipad), "tablet");
  assert.equal(classifyDevice(UA.androidTablet), "tablet");
  assert.equal(classifyDevice(UA.chromeWindows), "desktop");
});

test("browserName recognises the main browsers", () => {
  assert.equal(browserName(UA.edge), "Edge");
  assert.equal(browserName(UA.chromeWindows), "Chrome");
  assert.equal(browserName(UA.firefox), "Firefox");
  assert.equal(browserName(UA.iphone), "Safari");
  assert.equal(browserName(null), "Navigateur inconnu");
});

test("classifyReferrer separates none, internal and external referrers", () => {
  assert.deepEqual(classifyReferrer(undefined, "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("", "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("not a url", "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("http://localhost:3100/demo", "localhost:3100"), { kind: "internal" });
  assert.deepEqual(classifyReferrer("https://www.skedul.app/x", "skedul.app"), { kind: "internal" });
  assert.deepEqual(
    classifyReferrer("https://www.google.com/search?q=x", "skedul.app"),
    { kind: "external", host: "google.com" },
  );
});

test("normalizeSource trims, lowercases and caps utm_source", () => {
  assert.equal(normalizeSource(" Newsletter "), "newsletter");
  assert.equal(normalizeSource(""), null);
  assert.equal(normalizeSource(undefined), null);
  assert.equal(normalizeSource("x".repeat(100))?.length, 64);
});
```

Create `src/lib/visitor-hash.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { visitorHash } from "./visitor-hash";

const base = {
  secret: "s3cret",
  dayKey: "2026-10-07",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 Test",
};

test("visitorHash is stable for the same visitor on the same day", () => {
  assert.equal(visitorHash(base), visitorHash({ ...base }));
});

test("visitorHash rotates the next day", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, dayKey: "2026-10-08" }));
});

test("visitorHash differs between visitors", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, ip: "203.0.113.8" }));
});

test("visitorHash is 32 hex chars and does not leak the IP", () => {
  const hash = visitorHash(base);
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hash.includes(base.ip), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/analytics.test.ts src/lib/visitor-hash.test.ts`
Expected: FAIL — cannot find modules `./analytics` and `./visitor-hash`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/analytics.ts`:

```ts
/**
 * Pure helpers for the cookieless page-view tracker, shared by the browser
 * component (<PageViewTracker />) and the /api/track route. No Node APIs here.
 */

/** Day boundaries for platform stats: visitor-hash rotation and admin charts. */
export const ADMIN_TZ = "Europe/Paris";

export type Device = "mobile" | "tablet" | "desktop";

export type ReferrerKind =
  | { kind: "none" }
  | { kind: "internal" }
  | { kind: "external"; host: string };

const UNTRACKED_PREFIXES = ["/dashboard", "/onboarding", "/admin", "/api", "/_next"];

/** Top-level segments that are app routes, never a pro's public slug. */
const RESERVED_SEGMENTS = new Set([
  "admin",
  "api",
  "dashboard",
  "demo",
  "onboarding",
  "sign-in",
  "sign-up",
  "_next",
]);

/** Public pages only: never the back-office, onboarding, admin or API. */
export function isTrackedPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  return !UNTRACKED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** "/altinha-paris/book/x" → "altinha-paris"; null for app routes. */
export function proSlugFromPath(path: string): string | null {
  const segment = path.split("/")[1] ?? "";
  if (!/^[a-z0-9-]+$/.test(segment) || RESERVED_SEGMENTS.has(segment)) {
    return null;
  }
  return segment;
}

const BOT_RE =
  /bot|crawl|spider|slurp|preview|inspectiontool|facebookexternalhit|headless|lighthouse|pagespeed|pingdom|monitor|curl|wget|python|axios|node-fetch|go-http-client|okhttp|java\//i;

export function isBot(userAgent: string): boolean {
  return BOT_RE.test(userAgent);
}

export function classifyDevice(userAgent: string): Device {
  if (
    /ipad|tablet|kindle|silk|playbook/i.test(userAgent) ||
    (/android/i.test(userAgent) && !/mobile/i.test(userAgent))
  ) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone/i.test(userAgent)) {
    return "mobile";
  }
  return "desktop";
}

export function browserName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox\/|fxios/i.test(ua)) return "Firefox";
  if (/chrome\/|crios/i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "Navigateur inconnu";
}

/** Compares hostnames without port or leading "www.". */
export function classifyReferrer(
  referrer: string | null | undefined,
  ownHost: string,
): ReferrerKind {
  if (!referrer) return { kind: "none" };
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return { kind: "none" };
  }
  if (!host) return { kind: "none" };
  const own = ownHost.split(":")[0].replace(/^www\./, "");
  return host === own ? { kind: "internal" } : { kind: "external", host };
}

export function normalizeSource(utmSource: string | null | undefined): string | null {
  const value = utmSource?.trim().toLowerCase().slice(0, 64);
  return value ? value : null;
}
```

Create `src/lib/visitor-hash.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * Daily-rotating anonymous visitor id: no cookie, and the IP never leaves this
 * function. Same visitor + same day → same hash; the next day → a new one.
 */
export function visitorHash(input: {
  secret: string;
  dayKey: string;
  ip: string;
  userAgent: string;
}): string {
  return createHash("sha256")
    .update(`${input.secret}|${input.dayKey}|${input.ip}|${input.userAgent}`)
    .digest("hex")
    .slice(0, 32);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/analytics.test.ts src/lib/visitor-hash.test.ts`
Expected: 11 passing tests.

- [ ] **Step 5: Ingestion route**

Create `src/app/api/track/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  ADMIN_TZ,
  classifyDevice,
  classifyReferrer,
  isBot,
  isTrackedPath,
  normalizeSource,
  proSlugFromPath,
} from "@/lib/analytics";
import { dayKeyInTz } from "@/lib/datetime";
import { db } from "@/lib/db";
import { pageView, professional } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { visitorHash } from "@/lib/visitor-hash";

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  first: z.boolean().default(false),
  referrer: z.string().max(1024).optional(),
  source: z.string().max(256).optional(),
});

function noContent() {
  return new Response(null, { status: 204 });
}

/** Receives <PageViewTracker /> beacons. Always 204: tracking never breaks a page. */
export async function POST(request: Request) {
  try {
    const userAgent = request.headers.get("user-agent");
    if (!userAgent || isBot(userAgent)) return noContent();
    if (request.headers.get("sec-fetch-site") === "cross-site") return noContent();

    const parsed = bodySchema.safeParse(JSON.parse(await request.text()));
    if (!parsed.success || !isTrackedPath(parsed.data.path)) return noContent();
    const { path, first, referrer, source } = parsed.data;

    const ownHost = request.headers.get("host") ?? new URL(request.url).host;
    const ref = classifyReferrer(first ? referrer : undefined, ownHost);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "0.0.0.0";
    const country = request.headers.get("x-vercel-ip-country");

    const slug = proSlugFromPath(path);
    const [pro] = slug
      ? await db
          .select({ id: professional.id })
          .from(professional)
          .where(eq(professional.slug, slug))
          .limit(1)
      : [];

    await db.insert(pageView).values({
      path,
      professionalId: pro?.id ?? null,
      referrerHost: ref.kind === "external" ? ref.host : null,
      source: first ? normalizeSource(source) : null,
      entry: first && ref.kind !== "internal",
      device: classifyDevice(userAgent),
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      visitorHash: visitorHash({
        secret: env.BETTER_AUTH_SECRET,
        dayKey: dayKeyInTz(new Date(), ADMIN_TZ),
        ip,
        userAgent,
      }),
    });
  } catch (err) {
    console.error("[track] could not record page view", err);
  }
  return noContent();
}
```

- [ ] **Step 6: Browser beacon**

Create `src/components/analytics/page-view-tracker.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { isTrackedPath } from "@/lib/analytics";

/** One beacon per public page view — no cookie, no storage (see /api/track). */
export function PageViewTracker() {
  const pathname = usePathname();
  const isFirstView = useRef(true);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    // Dedupes React Strict Mode's double effect run in development.
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;

    const first = isFirstView.current;
    isFirstView.current = false;
    if (!isTrackedPath(pathname)) return;

    const payload = JSON.stringify({
      path: pathname,
      first,
      ...(first
        ? {
            referrer: document.referrer || undefined,
            source:
              new URLSearchParams(window.location.search).get("utm_source") ??
              undefined,
          }
        : {}),
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", payload);
    else void fetch("/api/track", { method: "POST", body: payload, keepalive: true });
  }, [pathname]);

  return null;
}
```

In `src/app/layout.tsx`, add the import

```tsx
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
```

and change the body to:

```tsx
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <PageViewTracker />
      </body>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 8: Verify ingestion end to end**

With the dev server on :3100:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/track -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" -H "content-type: text/plain" --data '{"path":"/altinha-paris","first":true,"referrer":"https://www.google.com/","source":"Newsletter"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/track -H "user-agent: Googlebot/2.1" --data '{"path":"/","first":true}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/track -H "user-agent: Mozilla/5.0 Chrome/126.0" --data '{"path":"/dashboard","first":false}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/track -H "user-agent: Mozilla/5.0 Chrome/126.0" --data 'not json'
```

Expected: `204` four times. Then:

```bash
node --env-file=.env.local --input-type=module -e "import { neon } from '@neondatabase/serverless'; const sql = neon(process.env.DATABASE_URL); console.table(await sql.query('select path, professional_id is not null as has_pro, referrer_host, source, entry, device from page_view order by created_at desc limit 5'));"
```

Expected: exactly one new row — `/altinha-paris`, `has_pro = true`, `google.com`, `newsletter`, `entry = true`, `desktop`. No row for the bot, `/dashboard` or the invalid body.

Then in the browser: open `/`, click through to `/demo`, then sign in as `pro@skedul.app` and open `/dashboard`. Re-run the query: expected new rows for `/` (`entry = true`) and `/demo` (`entry = false`); none for `/dashboard`. Sign out.

- [ ] **Step 9: Commit**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts src/lib/visitor-hash.ts src/lib/visitor-hash.test.ts src/app/api/track/route.ts src/components/analytics/page-view-tracker.tsx src/app/layout.tsx
git commit -m "feat(admin): cookieless page-view tracking for public pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin pure helpers (metrics, params, date formats)

**Files:**
- Modify: `src/lib/datetime.ts`
- Modify: `src/lib/env.ts`
- Create: `src/lib/admin-metrics.ts`, test `src/lib/admin-metrics.test.ts`
- Create: `src/lib/admin-params.ts`, test `src/lib/admin-params.test.ts`

**Interfaces:**
- Consumes: `ADMIN_TZ` (Task 5); `dayKeyInTz`, `instantFromWallClock` (`src/lib/datetime.ts`); schema enum **types** only.
- Produces:
  - `formatDateShort(d: Date, tz: string): string` ("7 oct. 2026"), `formatDateTimeShort(d: Date, tz: string): string`
  - `env.STRIPE_WEBHOOK_CONFIGURED: boolean`
  - `admin-metrics.ts`: `type DailyPoint = { day: string; value: number }`, `type MoneyTotal = { currency: string; cents: number }`, `type IntegrationMode = "live" | "test" | "mock"`, `lastDayKeys(days: number, now: Date, tz?: string): string[]`, `startOfDayKey(key: string, tz?: string): Date`, `fillDailySeries(rows: { day: string; value: number | string }[], keys: string[]): DailyPoint[]`, `dayLabel(key: string): string`, `niceCeil(n: number): number`, `mergeMoney(rows: { currency: string; cents: number | string }[]): MoneyTotal[]`, `stripeMode(secretKey: string | undefined, enabled: boolean): IntegrationMode`, `timeAgo(date: Date, now?: Date): string`, `countryName(code: string | null): string`
  - `admin-params.ts`: `USER_FILTERS`, `type UserFilter`, `USER_FILTER_LABELS`, `USERS_PAGE_SIZE = 25`, `type UserRole`, `ROLE_LABELS`, `ACTIVITY_TABS`, `type ActivityTab`, `type BookingStatus`, `type PurchaseStatus`, `BOOKING_STATUS_LABELS`, `PURCHASE_STATUS_LABELS`, `PAYMENT_TYPE_LABELS`, `TRAFFIC_RANGES`, `type TrafficRange`, `BAN_DURATIONS`, `type BanDuration`, `BAN_DURATION_LABELS`, `parseUserFilter`, `parsePage`, `parseRange`, `parseActivityTab`, `parseBookingStatus`, `parsePurchaseStatus`, `parseBanDuration`

- [ ] **Step 1: Date formats and webhook flag**

Append to `src/lib/datetime.ts`:

```ts
/** "7 oct. 2026" */
export function formatDateShort(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

/** "7 oct. 2026, 14:32" */
export function formatDateTimeShort(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}
```

In `src/lib/env.ts`, inside the exported `env` object, add after `STRIPE_ENABLED`:

```ts
  /** Webhook signing secret present (needed to confirm live Stripe payments). */
  STRIPE_WEBHOOK_CONFIGURED: !isPlaceholder(raw.STRIPE_WEBHOOK_SECRET),
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/admin-metrics.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  countryName,
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  mergeMoney,
  niceCeil,
  startOfDayKey,
  stripeMode,
  timeAgo,
} from "./admin-metrics";

// Intl output may use (narrow) no-break spaces.
const plain = (s: string) => s.replace(/\s/g, " ");

test("lastDayKeys lists the last N Paris days, oldest first", () => {
  assert.deepEqual(lastDayKeys(3, new Date("2026-10-07T10:00:00Z")), [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ]);
});

test("lastDayKeys uses the Paris date, not the UTC one", () => {
  // 23:30 UTC on Oct 6 is already 01:30 on Oct 7 in Paris.
  assert.deepEqual(lastDayKeys(1, new Date("2026-10-06T23:30:00Z")), ["2026-10-07"]);
});

test("lastDayKeys does not skip the short spring-forward day", () => {
  // 2026-03-29 has 23 hours in Paris; 00:30 CEST on Mar 30 = 22:30 UTC Mar 29.
  assert.deepEqual(lastDayKeys(3, new Date("2026-03-29T22:30:00Z")), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
});

test("startOfDayKey is local midnight in Paris", () => {
  assert.equal(startOfDayKey("2026-10-07").toISOString(), "2026-10-06T22:00:00.000Z");
  assert.equal(startOfDayKey("2026-12-01").toISOString(), "2026-11-30T23:00:00.000Z");
});

test("fillDailySeries fills missing days with 0 and coerces strings", () => {
  assert.deepEqual(
    fillDailySeries([{ day: "2026-10-06", value: "3" }], ["2026-10-05", "2026-10-06"]),
    [
      { day: "2026-10-05", value: 0 },
      { day: "2026-10-06", value: 3 },
    ],
  );
});

test("dayLabel formats a day key in French", () => {
  assert.equal(plain(dayLabel("2026-10-06")), "mar. 6 oct.");
});

test("niceCeil rounds up to 1, 2 or 5 × 10^n", () => {
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(3), 5);
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(12), 20);
  assert.equal(niceCeil(45), 50);
  assert.equal(niceCeil(100), 100);
  assert.equal(niceCeil(101), 200);
});

test("mergeMoney sums per currency, drops zeros, biggest first", () => {
  assert.deepEqual(
    mergeMoney([
      { currency: "eur", cents: "1000" },
      { currency: "EUR", cents: 500 },
      { currency: "usd", cents: "0" },
      { currency: "usd", cents: "200" },
      { currency: "chf", cents: 0 },
    ]),
    [
      { currency: "eur", cents: 1500 },
      { currency: "usd", cents: 200 },
    ],
  );
});

test("stripeMode reads the key prefix", () => {
  assert.equal(stripeMode(undefined, false), "mock");
  assert.equal(stripeMode("sk_live_x", false), "mock");
  assert.equal(stripeMode("sk_test_x", true), "test");
  assert.equal(stripeMode("sk_live_x", true), "live");
  assert.equal(stripeMode("rk_live_x", true), "live");
});

test("timeAgo speaks French relative time", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const ago = (ms: number) => plain(timeAgo(new Date(now.getTime() - ms), now));
  assert.equal(ago(30_000), "à l'instant");
  assert.equal(ago(5 * 60_000), "il y a 5 minutes");
  assert.equal(ago(3 * 3_600_000), "il y a 3 heures");
  assert.equal(ago(24 * 3_600_000), "hier");
  assert.equal(ago(3 * 24 * 3_600_000), "il y a 3 jours");
  assert.equal(ago(40 * 24 * 3_600_000), "28 août 2026");
});

test("countryName gives the French country name", () => {
  assert.equal(countryName("FR"), "France");
  assert.equal(countryName(null), "Inconnu");
});
```

Create `src/lib/admin-params.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseActivityTab,
  parseBanDuration,
  parseBookingStatus,
  parsePage,
  parsePurchaseStatus,
  parseRange,
  parseUserFilter,
} from "./admin-params";

test("parseUserFilter defaults to all", () => {
  assert.equal(parseUserFilter(undefined), "all");
  assert.equal(parseUserFilter("nope"), "all");
  assert.equal(parseUserFilter("suspended"), "suspended");
});

test("parsePage accepts positive integers only", () => {
  assert.equal(parsePage("3"), 3);
  for (const bad of [undefined, "0", "-2", "2.5", "abc", "99999"]) {
    assert.equal(parsePage(bad), 1, String(bad));
  }
});

test("parseRange accepts 7, 30 or 90 and defaults to 30", () => {
  assert.equal(parseRange("7"), 7);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange("14"), 30);
  assert.equal(parseRange(undefined), 30);
});

test("parseActivityTab defaults to bookings", () => {
  assert.equal(parseActivityTab("purchases"), "purchases");
  assert.equal(parseActivityTab("other"), "bookings");
});

test("status parsers return null for unknown values", () => {
  assert.equal(parseBookingStatus("pending"), "pending");
  assert.equal(parseBookingStatus("paid"), null);
  assert.equal(parsePurchaseStatus("paid"), "paid");
  assert.equal(parsePurchaseStatus(undefined), null);
});

test("parseBanDuration ignores inherited object keys", () => {
  assert.equal(parseBanDuration("7d"), "7d");
  assert.equal(parseBanDuration("forever"), "forever");
  assert.equal(parseBanDuration("toString"), null);
  assert.equal(parseBanDuration(42), null);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/admin-metrics.test.ts src/lib/admin-params.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 4: Implement `admin-metrics.ts`**

Create `src/lib/admin-metrics.ts`:

```ts
import { ADMIN_TZ } from "@/lib/analytics";
import { dayKeyInTz, formatDateShort, instantFromWallClock } from "@/lib/datetime";

export type DailyPoint = { day: string; value: number };
export type MoneyTotal = { currency: string; cents: number };
export type IntegrationMode = "live" | "test" | "mock";

/**
 * The last `days` calendar days in `tz` as YYYY-MM-DD keys, oldest first.
 * Steps on the calendar date (UTC arithmetic on the key), so DST days are
 * never skipped or doubled.
 */
export function lastDayKeys(days: number, now: Date, tz: string = ADMIN_TZ): string[] {
  const [y, m, d] = dayKeyInTz(now, tz).split("-").map(Number);
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10),
  );
}

/** The instant a YYYY-MM-DD day starts in `tz`. */
export function startOfDayKey(key: string, tz: string = ADMIN_TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  return instantFromWallClock(y, m, d, 0, tz);
}

/** One point per key, 0 where the query returned no row for that day. */
export function fillDailySeries(
  rows: { day: string; value: number | string }[],
  keys: string[],
): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.value)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** "mar. 6 oct." for a YYYY-MM-DD key. */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Rounds up to 1, 2 or 5 × 10ⁿ — a clean top for a chart's y-axis. */
export function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const f = n / magnitude;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * magnitude;
}

/** Sums amounts per currency (never across currencies), biggest first, zeros dropped. */
export function mergeMoney(
  rows: { currency: string; cents: number | string }[],
): MoneyTotal[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const currency = r.currency.toLowerCase();
    totals.set(currency, (totals.get(currency) ?? 0) + Number(r.cents));
  }
  return [...totals]
    .filter(([, cents]) => cents > 0)
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => b.cents - a.cents);
}

export function stripeMode(
  secretKey: string | undefined,
  enabled: boolean,
): IntegrationMode {
  if (!enabled || !secretKey) return "mock";
  return /^(sk|rk)_live_/.test(secretKey) ? "live" : "test";
}

/** "à l'instant", "il y a 5 minutes", "hier"… then a short date after 30 days. */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "à l'instant";
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return formatDateShort(date, ADMIN_TZ);
}

export function countryName(code: string | null): string {
  if (!code) return "Inconnu";
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
```

- [ ] **Step 5: Implement `admin-params.ts`**

Create `src/lib/admin-params.ts`:

```ts
// Types only: keeps drizzle out of client bundles that import these labels.
import type { bookingStatus, purchaseStatus, userRole } from "@/lib/db/schema";

export type UserRole = (typeof userRole.enumValues)[number];
export type BookingStatus = (typeof bookingStatus.enumValues)[number];
export type PurchaseStatus = (typeof purchaseStatus.enumValues)[number];

/* ── Users ── */

export const USER_FILTERS = ["all", "client", "pro", "admin", "suspended"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export const USER_FILTER_LABELS: Record<UserFilter, string> = {
  all: "Tous",
  client: "Clients",
  pro: "Pros",
  admin: "Admins",
  suspended: "Suspendus",
};
export const USERS_PAGE_SIZE = 25;

export const ROLE_LABELS: Record<UserRole, string> = {
  client: "Client",
  pro: "Pro",
  admin: "Admin",
};

/* ── Activity ── */

export const ACTIVITY_TABS = ["bookings", "purchases"] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

// Record<…> keeps these in sync with the schema enums at compile time.
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  completed: "Terminée",
};
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "En attente",
  paid: "Payé",
  refunded: "Remboursé",
};
export const PAYMENT_TYPE_LABELS = {
  direct: "Payé",
  credit: "Crédit",
  free: "Offert",
} as const;

/* ── Traffic ── */

export const TRAFFIC_RANGES = [7, 30, 90] as const;
export type TrafficRange = (typeof TRAFFIC_RANGES)[number];

/* ── Suspension ── */

/** Ban length in seconds; null = no end date. */
export const BAN_DURATIONS = {
  "1d": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  forever: null,
} as const;
export type BanDuration = keyof typeof BAN_DURATIONS;
export const BAN_DURATION_LABELS: Record<BanDuration, string> = {
  "1d": "1 jour",
  "7d": "7 jours",
  "30d": "30 jours",
  forever: "Sans limite",
};

/* ── Parsers (search params & action inputs) ── */

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function parseUserFilter(value: unknown): UserFilter {
  return pick(USER_FILTERS, value) ?? "all";
}

export function parseActivityTab(value: unknown): ActivityTab {
  return pick(ACTIVITY_TABS, value) ?? "bookings";
}

export function parseBookingStatus(value: unknown): BookingStatus | null {
  return pick(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[], value);
}

export function parsePurchaseStatus(value: unknown): PurchaseStatus | null {
  return pick(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[], value);
}

export function parseBanDuration(value: unknown): BanDuration | null {
  return pick(Object.keys(BAN_DURATIONS) as BanDuration[], value);
}

export function parseRange(value: unknown): TrafficRange {
  const n = typeof value === "string" ? Number(value) : NaN;
  return (TRAFFIC_RANGES as readonly number[]).includes(n) ? (n as TrafficRange) : 30;
}

/** 1-based page number from a search param; anything invalid → 1. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --config.verify-deps-before-run=false test src/lib/admin-metrics.test.ts src/lib/admin-params.test.ts`
Expected: 17 passing tests. If only the `dayLabel` or `timeAgo` French strings differ by punctuation produced by this Node's ICU, print the actual value (`node -e "console.log(JSON.stringify(new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,9,6)))))"`) and align the expectation to it — the implementation must not change.

- [ ] **Step 7: Typecheck & commit**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

```bash
git add src/lib/datetime.ts src/lib/env.ts src/lib/admin-metrics.ts src/lib/admin-metrics.test.ts src/lib/admin-params.ts src/lib/admin-params.test.ts
git commit -m "feat(admin): pure helpers for admin metrics, params and dates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Overview page

**Files:**
- Create: `src/server/admin-queries.ts`
- Create: `src/components/admin/stat-card.tsx`
- Create: `src/components/admin/bar-chart.tsx`
- Create: `src/components/admin/activity-feed.tsx`
- Create: `src/components/admin/app-health-card.tsx`
- Replace: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: Task 6 helpers; `formatMoney` (`src/lib/utils.ts`); `env`.
- Produces (in `src/server/admin-queries.ts`, `server-only`):
  - `getOverviewStats(now?: Date): Promise<{ users: number; newUsers7d: number; pros: number; activePros30d: number; bookings30d: number; revenue30d: MoneyTotal[] }>`
  - `getRevenue(opts?: { since?: Date; professionalId?: string }): Promise<MoneyTotal[]>`
  - `getDailySignups(since: Date): Promise<{ day: string; value: number }[]>`
  - `getDailyTraffic(since: Date): Promise<{ day: string; views: number; visitors: string }[]>`
  - `type ActivityEvent = { id: string; kind: "signup" | "pro" | "booking" | "purchase"; at: Date; userId: string; title: string; detail: string }`; `getRecentActivity(limit?: number): Promise<ActivityEvent[]>`
  - `type AppHealth`; `getAppHealth(now?: Date): Promise<AppHealth>`
  - Internal helpers reused by later tasks: `DAY_MS`, `CONFIRMED`, `dayOf(column)`.
  - Components: `<StatCard icon label value hint? />`, `<BarChart data unit emptyLabel? />` with `type BarDatum = { key: string; label: string; value: number; detail?: string }`, `<ActivityFeed events now />`, `<AppHealthCard health />`

- [ ] **Step 1: Overview queries**

Create `src/server/admin-queries.ts`:

```ts
import "server-only";

import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  pageView,
  professional,
  user,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { ADMIN_TZ } from "@/lib/analytics";
import { mergeMoney, stripeMode, type MoneyTotal } from "@/lib/admin-metrics";
import { BOOKING_STATUS_LABELS } from "@/lib/admin-params";
import { formatMoney } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bookings that actually happened or will (counted as activity / revenue). */
const CONFIRMED = ["confirmed", "completed"] as const;

/**
 * YYYY-MM-DD of a timestamp in ADMIN_TZ. The zone is inlined as a literal
 * (it is a constant) so SELECT and GROUP BY render the exact same SQL.
 */
function dayOf(column: AnyPgColumn) {
  return sql<string>`to_char(${column} at time zone ${sql.raw(`'${ADMIN_TZ}'`)}, 'YYYY-MM-DD')`;
}

/* ───────────────────────────── Overview ───────────────────────────── */

export async function getOverviewStats(now: Date = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const confirmedRecently = and(
    gte(booking.createdAt, since30),
    inArray(booking.status, [...CONFIRMED]),
  );

  const [users, newUsers, pros, activePros, bookings, revenue30d] =
    await Promise.all([
      db.select({ value: count() }).from(user),
      db.select({ value: count() }).from(user).where(gte(user.createdAt, since7)),
      db.select({ value: count() }).from(professional),
      db
        .select({ value: sql<string>`count(distinct ${booking.professionalId})` })
        .from(booking)
        .where(confirmedRecently),
      db.select({ value: count() }).from(booking).where(confirmedRecently),
      getRevenue({ since: since30 }),
    ]);

  return {
    users: users[0]?.value ?? 0,
    newUsers7d: newUsers[0]?.value ?? 0,
    pros: pros[0]?.value ?? 0,
    activePros30d: Number(activePros[0]?.value ?? 0),
    bookings30d: bookings[0]?.value ?? 0,
    revenue30d,
  };
}

/** Paid bookings + paid packs, summed per currency (optionally since a date / for one pro). */
export async function getRevenue(
  opts: { since?: Date; professionalId?: string } = {},
): Promise<MoneyTotal[]> {
  const [bookingRows, purchaseRows] = await Promise.all([
    db
      .select({
        currency: professional.currency,
        cents: sql<string>`coalesce(sum(${booking.amountPaidCents}), 0)`,
      })
      .from(booking)
      .innerJoin(professional, eq(professional.id, booking.professionalId))
      .where(
        and(
          eq(booking.paymentType, "direct"),
          inArray(booking.status, [...CONFIRMED]),
          opts.since ? gte(booking.createdAt, opts.since) : undefined,
          opts.professionalId
            ? eq(booking.professionalId, opts.professionalId)
            : undefined,
        ),
      )
      .groupBy(professional.currency),
    db
      .select({
        currency: packPurchase.currency,
        cents: sql<string>`coalesce(sum(${packPurchase.amountPaidCents}), 0)`,
      })
      .from(packPurchase)
      .where(
        and(
          eq(packPurchase.status, "paid"),
          opts.since ? gte(packPurchase.createdAt, opts.since) : undefined,
          opts.professionalId
            ? eq(packPurchase.professionalId, opts.professionalId)
            : undefined,
        ),
      )
      .groupBy(packPurchase.currency),
  ]);
  return mergeMoney([...bookingRows, ...purchaseRows]);
}

export function getDailySignups(since: Date) {
  const day = dayOf(user.createdAt);
  return db
    .select({ day, value: count() })
    .from(user)
    .where(gte(user.createdAt, since))
    .groupBy(day);
}

export function getDailyTraffic(since: Date) {
  const day = dayOf(pageView.createdAt);
  return db
    .select({
      day,
      views: count(),
      visitors: sql<string>`count(distinct ${pageView.visitorHash})`,
    })
    .from(pageView)
    .where(gte(pageView.createdAt, since))
    .groupBy(day);
}

export type ActivityEvent = {
  id: string;
  kind: "signup" | "pro" | "booking" | "purchase";
  at: Date;
  /** The account the event belongs to (links to /admin/users/[id]). */
  userId: string;
  title: string;
  detail: string;
};

/** The latest sign-ups, pro pages, bookings and paid packs, merged by date. */
export async function getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
  const [signups, pros, bookings, purchases] = await Promise.all([
    db
      .select({ id: user.id, at: user.createdAt, name: user.name, email: user.email })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(limit),
    db
      .select({
        id: professional.id,
        at: professional.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        slug: professional.slug,
      })
      .from(professional)
      .orderBy(desc(professional.createdAt))
      .limit(limit),
    db
      .select({
        id: booking.id,
        at: booking.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        customerName: customer.name,
        eventTitle: eventType.title,
        status: booking.status,
      })
      .from(booking)
      .innerJoin(professional, eq(professional.id, booking.professionalId))
      .innerJoin(customer, eq(customer.id, booking.customerId))
      .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
      .orderBy(desc(booking.createdAt))
      .limit(limit),
    db
      .select({
        id: packPurchase.id,
        at: packPurchase.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        customerName: customer.name,
        packName: pack.name,
        cents: packPurchase.amountPaidCents,
        currency: packPurchase.currency,
      })
      .from(packPurchase)
      .innerJoin(professional, eq(professional.id, packPurchase.professionalId))
      .innerJoin(customer, eq(customer.id, packPurchase.customerId))
      .innerJoin(pack, eq(pack.id, packPurchase.packId))
      .where(eq(packPurchase.status, "paid"))
      .orderBy(desc(packPurchase.createdAt))
      .limit(limit),
  ]);

  const events: ActivityEvent[] = [
    ...signups.map((r) => ({
      id: `signup-${r.id}`,
      kind: "signup" as const,
      at: r.at,
      userId: r.id,
      title: `Inscription · ${r.name}`,
      detail: r.email,
    })),
    ...pros.map((r) => ({
      id: `pro-${r.id}`,
      kind: "pro" as const,
      at: r.at,
      userId: r.userId,
      title: `Page pro créée · ${r.businessName}`,
      detail: `/${r.slug}`,
    })),
    ...bookings.map((r) => ({
      id: `booking-${r.id}`,
      kind: "booking" as const,
      at: r.at,
      userId: r.userId,
      title: `Réservation · ${r.businessName}`,
      detail: `${r.customerName} · ${r.eventTitle} · ${BOOKING_STATUS_LABELS[r.status]}`,
    })),
    ...purchases.map((r) => ({
      id: `purchase-${r.id}`,
      kind: "purchase" as const,
      at: r.at,
      userId: r.userId,
      title: `Pack vendu · ${r.businessName}`,
      detail: `${r.customerName} · ${r.packName} · ${formatMoney(r.cents, r.currency)}`,
    })),
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type AppHealth = Awaited<ReturnType<typeof getAppHealth>>;

/** Integration modes, DB latency and recent payments still pending after 1 h. */
export async function getAppHealth(now: Date = new Date()) {
  const started = performance.now();
  await db.execute(sql`select 1`);
  const dbLatencyMs = Math.round(performance.now() - started);

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [pendingBookings, pendingPurchases] = await Promise.all([
    db
      .select({ value: count() })
      .from(booking)
      .where(
        and(
          eq(booking.status, "pending"),
          lt(booking.createdAt, hourAgo),
          gte(booking.createdAt, weekAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(packPurchase)
      .where(
        and(
          eq(packPurchase.status, "pending"),
          lt(packPurchase.createdAt, hourAgo),
          gte(packPurchase.createdAt, weekAgo),
        ),
      ),
  ]);

  return {
    appEnv: env.APP_ENV,
    appUrl: env.APP_URL,
    stripe: stripeMode(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED),
    stripeWebhook: env.STRIPE_WEBHOOK_CONFIGURED,
    resend: env.RESEND_ENABLED,
    blob: env.BLOB_ENABLED,
    google: env.GOOGLE_CALENDAR_ENABLED,
    dbLatencyMs,
    pendingBookings: pendingBookings[0]?.value ?? 0,
    pendingPurchases: pendingPurchases[0]?.value ?? 0,
  };
}
```

- [ ] **Step 2: Stat card**

Create `src/components/admin/stat-card.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <Icon className="size-5 text-primary" aria-hidden />
        <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Bar chart**

Create `src/components/admin/bar-chart.tsx`:

```tsx
"use client";

import { useState } from "react";

import { niceCeil } from "@/lib/admin-metrics";
import { cn } from "@/lib/utils";

export type BarDatum = {
  key: string;
  /** Axis + tooltip label, e.g. "mar. 6 oct.". */
  label: string;
  value: number;
  /** Secondary tooltip line, e.g. "42 pages vues". */
  detail?: string;
};

const fmt = (n: number) => n.toLocaleString("fr-FR");

/**
 * Single-series column chart (one bar per day): ≤24px bars with a 4px rounded
 * top and a 2px gap, hairline grid, hover/arrow-key tooltip, data-table
 * fallback. One series → no legend; the card title names it.
 */
export function BarChart({
  data,
  unit,
  emptyLabel = "Aucune donnée sur la période.",
}: {
  data: BarDatum[];
  /** Singular / plural unit, e.g. { one: "visiteur", other: "visiteurs" }. */
  unit: { one: string; other: string };
  emptyLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const unitFor = (n: number) => (n > 1 ? unit.other : unit.one);
  const current = active === null ? null : data[active];
  const align =
    active === null
      ? ""
      : active < data.length * 0.15
        ? "translate-x-0"
        : active > data.length * 0.85
          ? "-translate-x-full"
          : "-translate-x-1/2";

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) =>
      i === null
        ? step === 1
          ? 0
          : data.length - 1
        : Math.min(data.length - 1, Math.max(0, i + step)),
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{fmt(max)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-40 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="group"
            aria-label={`${fmt(total)} ${unitFor(total)} au total. Flèches gauche et droite pour parcourir les jours.`}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border" />
            <div className="absolute inset-0 flex items-end gap-0.5">
              {data.map((d, i) => (
                <div
                  key={d.key}
                  className="flex h-full flex-1 items-end justify-center"
                  onPointerEnter={() => setActive(i)}
                >
                  <div
                    className={cn(
                      "w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity",
                      active !== null && active !== i && "opacity-40",
                    )}
                    style={{ height: `${(d.value / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            {current && active !== null && (
              <div
                role="status"
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-(--shadow-card)",
                  align,
                )}
                style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
              >
                <p className="font-semibold tabular-nums text-foreground">
                  {fmt(current.value)} {unitFor(current.value)}
                </p>
                {current.detail && <p className="text-muted-foreground">{current.detail}</p>}
                <p className="text-muted-foreground">{current.label}</p>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{data[0].label}</span>
            {data.length > 2 && <span>{data[Math.floor(data.length / 2)].label}</span>}
            <span>{data[data.length - 1].label}</span>
          </div>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Voir les données
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Jour</th>
              <th className="py-1 text-right font-medium">{unit.other}</th>
              {data.some((d) => d.detail) && (
                <th className="py-1 text-right font-medium">Détail</th>
              )}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right">{fmt(d.value)}</td>
                {d.detail !== undefined && <td className="py-1 text-right">{d.detail}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Activity feed**

Create `src/components/admin/activity-feed.tsx`:

```tsx
import Link from "next/link";
import { CalendarCheck, Store, Ticket, UserPlus } from "lucide-react";

import { timeAgo } from "@/lib/admin-metrics";
import type { ActivityEvent } from "@/server/admin-queries";

const ICONS = {
  signup: UserPlus,
  pro: Store,
  booking: CalendarCheck,
  purchase: Ticket,
} as const;

export function ActivityFeed({ events, now }: { events: ActivityEvent[]; now: Date }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Aucune activité pour le moment.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const Icon = ICONS[e.kind];
        return (
          <li key={e.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-muted text-accent-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/admin/users/${e.userId}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {e.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
            </div>
            <time
              dateTime={e.at.toISOString()}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {timeAgo(e.at, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: App health card**

Create `src/components/admin/app-health-card.tsx`:

```tsx
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrationMode } from "@/lib/admin-metrics";
import type { AppHealth } from "@/server/admin-queries";

const MODE: Record<
  IntegrationMode,
  { label: string; variant: "success" | "warning" | "neutral" }
> = {
  live: { label: "Réel", variant: "success" },
  test: { label: "Test", variant: "warning" },
  mock: { label: "Simulé", variant: "neutral" },
};

function onOff(on: boolean, yes: string, no: string) {
  return <Badge variant={on ? "success" : "neutral"}>{on ? yes : no}</Badge>;
}

export function AppHealthCard({ health }: { health: AppHealth }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Environnement", value: <Badge variant="outline">{health.appEnv}</Badge> },
    {
      label: "Paiements (Stripe)",
      value: <Badge variant={MODE[health.stripe].variant}>{MODE[health.stripe].label}</Badge>,
    },
    ...(health.stripe === "mock"
      ? []
      : [
          {
            label: "Webhook Stripe",
            value: health.stripeWebhook ? (
              <Badge variant="success">Configuré</Badge>
            ) : (
              <Badge variant="warning">Manquant</Badge>
            ),
          },
        ]),
    { label: "E-mails (Resend)", value: onOff(health.resend, "Réel", "Simulé") },
    { label: "Images (Blob)", value: onOff(health.blob, "Réel", "Simulé") },
    { label: "Google Agenda", value: onOff(health.google, "Configuré", "Non configuré") },
    {
      label: "Base de données",
      value: <span className="text-sm tabular-nums">{health.dbLatencyMs} ms</span>,
    },
  ];

  const alerts = [
    { count: health.pendingBookings, noun: "réservation", tab: "bookings" },
    { count: health.pendingPurchases, noun: "achat de pack", tab: "purchases" },
  ].filter((a) => a.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>État de l&apos;app</CardTitle>
        <p className="truncate text-xs text-muted-foreground">{health.appUrl}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3">
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        {alerts.map((a) => (
          <Link
            key={a.tab}
            href={`/admin/activity?tab=${a.tab}&status=pending`}
            className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-warning hover:bg-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {a.count} {a.noun}
              {a.count > 1 ? "s" : ""} en attente de paiement depuis plus d&apos;1 h
              (7 derniers jours)
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Overview page**

Replace `src/app/admin/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { CalendarCheck, Euro, Eye, Store, Users } from "lucide-react";

import { ActivityFeed } from "@/components/admin/activity-feed";
import { AppHealthCard } from "@/components/admin/app-health-card";
import { BarChart } from "@/components/admin/bar-chart";
import { StatCard } from "@/components/admin/stat-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  startOfDayKey,
} from "@/lib/admin-metrics";
import { formatMoney } from "@/lib/utils";
import {
  getAppHealth,
  getDailySignups,
  getDailyTraffic,
  getOverviewStats,
  getRecentActivity,
} from "@/server/admin-queries";

export const metadata: Metadata = { title: "Vue d'ensemble" };

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default async function AdminOverviewPage() {
  await requireAdmin();
  const now = new Date();
  const keys = lastDayKeys(30, now);
  const since = startOfDayKey(keys[0]);

  const [stats, signupRows, trafficRows, activity, health] = await Promise.all([
    getOverviewStats(now),
    getDailySignups(since),
    getDailyTraffic(since),
    getRecentActivity(10),
    getAppHealth(now),
  ]);

  const signups = fillDailySeries(signupRows, keys);
  const visitors = fillDailySeries(
    trafficRows.map((r) => ({ day: r.day, value: r.visitors })),
    keys,
  );
  const views = fillDailySeries(
    trafficRows.map((r) => ({ day: r.day, value: r.views })),
    keys,
  );
  const visitors7d = visitors.slice(-7).reduce((sum, d) => sum + d.value, 0);
  const [mainRevenue, ...otherRevenue] = stats.revenue30d;

  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        description="L'activité de Skedul, toutes pages pro confondues."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          icon={Users}
          label="Utilisateurs"
          value={fmt(stats.users)}
          hint={`+${fmt(stats.newUsers7d)} sur 7 jours`}
        />
        <StatCard
          icon={Store}
          label="Pros"
          value={fmt(stats.pros)}
          hint={`${fmt(stats.activePros30d)} actifs sur 30 jours`}
        />
        <StatCard
          icon={CalendarCheck}
          label="Réservations (30 j)"
          value={fmt(stats.bookings30d)}
        />
        <StatCard
          icon={Euro}
          label="Volume encaissé (30 j)"
          value={
            mainRevenue
              ? formatMoney(mainRevenue.cents, mainRevenue.currency)
              : formatMoney(0)
          }
          hint={
            otherRevenue.length
              ? `+ ${otherRevenue.map((r) => formatMoney(r.cents, r.currency)).join(" · ")}`
              : undefined
          }
        />
        <StatCard icon={Eye} label="Visiteurs (7 j)" value={fmt(visitors7d)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inscriptions par jour</CardTitle>
            <p className="text-sm text-muted-foreground">30 derniers jours</p>
          </CardHeader>
          <CardContent>
            <BarChart
              unit={{ one: "inscription", other: "inscriptions" }}
              data={signups.map((d) => ({
                key: d.day,
                label: dayLabel(d.day),
                value: d.value,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Visiteurs par jour</CardTitle>
            <p className="text-sm text-muted-foreground">
              30 derniers jours · pages publiques
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              unit={{ one: "visiteur", other: "visiteurs" }}
              data={visitors.map((d, i) => ({
                key: d.day,
                label: dayLabel(d.day),
                value: d.value,
                detail: `${fmt(views[i].value)} pages vues`,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed events={activity} now={now} />
          </CardContent>
        </Card>
        <AppHealthCard health={health} />
      </div>
    </>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 8: Browser verification**

Sign in as `admin@skedul.test` (choose Dashboard Admin). On `/admin` expect:
- 5 cards; « Utilisateurs » ≥ 3 (pro, beatriz, admin), « Pros » ≥ 1, « Volume encaissé » shows euros (seed has a paid pack), « Visiteurs (7 j) » ≥ 1 (Task 5 visits).
- Both charts render 30 bars; hovering a bar shows a tooltip (value first, then label); with keyboard focus on a chart, ← / → move the tooltip; « Voir les données » reveals a 30-row table.
- « Activité récente » lists events with relative times; clicking one opens `/admin/users/<id>` (404 until Task 8 — expected for now).
- « État de l'app » shows the environment `development`, integration badges and a DB latency in ms.

Check the dev server logs (`preview_logs`, level error) — expected: no SQL errors (e.g. no "must appear in the GROUP BY clause").

- [ ] **Step 9: Commit**

```bash
git add src/server/admin-queries.ts src/components/admin/stat-card.tsx src/components/admin/bar-chart.tsx src/components/admin/activity-feed.tsx src/components/admin/app-health-card.tsx src/app/admin/page.tsx
git commit -m "feat(admin): overview with KPIs, daily charts, activity feed and app health

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Users list & user detail

**Files:**
- Modify: `src/server/admin-queries.ts`
- Create: `src/components/admin/user-badges.tsx`
- Create: `src/components/admin/filter-chips.tsx`
- Create: `src/components/admin/pagination.tsx`
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/admin/users/[id]/page.tsx`

**Interfaces:**
- Consumes: `CONFIRMED`, `getRevenue` (Task 7); `userIsSuspended`, `isSuspended` (Task 2); `USERS_PAGE_SIZE`, `UserFilter`, `ROLE_LABELS`, `UserRole`, `USER_FILTERS`, `USER_FILTER_LABELS`, `parseUserFilter`, `parsePage` (Task 6); `browserName`, `classifyDevice`, `ADMIN_TZ` (Task 5); `formatDateShort`, `formatDateTimeShort` (Task 6).
- Produces:
  - `listUsers(opts: { q: string; filter: UserFilter; page: number }): Promise<{ rows: UserRow[]; total: number }>`
  - `getUserDetail(userId: string, now?: Date): Promise<UserDetail | null>` — `{ user, pro, providers: string[], sessions, stats, revenue: MoneyTotal[] }`
  - `<RoleBadge role: UserRole />`, `<SuspensionBadge banned: boolean; banExpires: Date | null />`
  - `<FilterChips<T> label: string; active: T; options: { value: T; label: string; href: string }[] />`
  - `<Pagination page pageCount hrefFor: (page: number) => string />` (server component)

- [ ] **Step 1: User queries**

In `src/server/admin-queries.ts`:
1. Replace the `drizzle-orm` import line with:

```ts
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
```

2. Add `account` and `session` to the `@/lib/db/schema` import list.
3. Replace the line `import { BOOKING_STATUS_LABELS } from "@/lib/admin-params";` with:

```ts
import {
  BOOKING_STATUS_LABELS,
  USERS_PAGE_SIZE,
  type UserFilter,
} from "@/lib/admin-params";
import { userIsSuspended } from "@/lib/suspension";
```

4. Append:

```ts
/* ───────────────────────────── Users ───────────────────────────── */

export async function listUsers(opts: {
  q: string;
  filter: UserFilter;
  page: number;
}) {
  const conditions: (SQL | undefined)[] = [];
  if (opts.q) {
    const pattern = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(professional.businessName, pattern),
      ),
    );
  }
  if (opts.filter === "client") conditions.push(eq(user.role, "client"));
  if (opts.filter === "admin") conditions.push(eq(user.role, "admin"));
  if (opts.filter === "pro") conditions.push(isNotNull(professional.id));
  if (opts.filter === "suspended") conditions.push(userIsSuspended());
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        banned: user.banned,
        banExpires: user.banExpires,
        slug: professional.slug,
      })
      .from(user)
      .leftJoin(professional, eq(professional.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(USERS_PAGE_SIZE)
      .offset((opts.page - 1) * USERS_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(user)
      .leftJoin(professional, eq(professional.userId, user.id))
      .where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

async function getProStats(professionalId: string, now: Date) {
  const [eventTypes, confirmed, upcoming, customers, packsSold] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(eventType)
        .where(eq(eventType.professionalId, professionalId)),
      db
        .select({ value: count() })
        .from(booking)
        .where(
          and(
            eq(booking.professionalId, professionalId),
            inArray(booking.status, [...CONFIRMED]),
          ),
        ),
      db
        .select({ value: count() })
        .from(booking)
        .where(
          and(
            eq(booking.professionalId, professionalId),
            inArray(booking.status, ["pending", "confirmed"]),
            gte(booking.startAt, now),
          ),
        ),
      db
        .select({ value: count() })
        .from(customer)
        .where(eq(customer.professionalId, professionalId)),
      db
        .select({ value: count() })
        .from(packPurchase)
        .where(
          and(
            eq(packPurchase.professionalId, professionalId),
            eq(packPurchase.status, "paid"),
          ),
        ),
    ]);
  return {
    eventTypes: eventTypes[0]?.value ?? 0,
    bookings: confirmed[0]?.value ?? 0,
    upcoming: upcoming[0]?.value ?? 0,
    customers: customers[0]?.value ?? 0,
    packsSold: packsSold[0]?.value ?? 0,
  };
}

export async function getUserDetail(userId: string, now: Date = new Date()) {
  const [found] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!found) return null;

  const [proRows, providers, sessions] = await Promise.all([
    db.select().from(professional).where(eq(professional.userId, userId)).limit(1),
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId)),
    db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        impersonatedBy: session.impersonatedBy,
      })
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
      .orderBy(desc(session.createdAt)),
  ]);
  const pro = proRows[0] ?? null;
  const [stats, revenue] = pro
    ? await Promise.all([
        getProStats(pro.id, now),
        getRevenue({ professionalId: pro.id }),
      ])
    : [null, []];

  return {
    user: found,
    pro,
    providers: providers.map((p) => p.providerId),
    sessions,
    stats,
    revenue,
  };
}
```

- [ ] **Step 2: Badges, chips, pagination**

Create `src/components/admin/user-badges.tsx`:

```tsx
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type UserRole } from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { isSuspended } from "@/lib/suspension";

export function RoleBadge({ role }: { role: UserRole }) {
  if (role === "admin") {
    return (
      <Badge>
        <ShieldCheck className="size-3" aria-hidden />
        {ROLE_LABELS.admin}
      </Badge>
    );
  }
  return (
    <Badge variant={role === "pro" ? "outline" : "neutral"}>{ROLE_LABELS[role]}</Badge>
  );
}

export function SuspensionBadge({
  banned,
  banExpires,
}: {
  banned: boolean;
  banExpires: Date | null;
}) {
  if (!isSuspended({ banned, banExpires })) {
    return <span className="text-sm text-muted-foreground">Actif</span>;
  }
  return (
    <Badge variant="warning">
      {banExpires
        ? `Suspendu jusqu'au ${formatDateShort(banExpires, ADMIN_TZ)}`
        : "Suspendu"}
    </Badge>
  );
}
```

Create `src/components/admin/filter-chips.tsx`:

```tsx
import Link from "next/link";

import { cn } from "@/lib/utils";

/** A row of link "chips" for one search-param filter (no client JS). */
export function FilterChips<T extends string | number>({
  label,
  active,
  options,
}: {
  label: string;
  active: T;
  options: { value: T; label: string; href: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={String(o.value)}
            href={o.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

Create `src/components/admin/pagination.tsx`:

```tsx
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={hrefFor(page - 1)}>
            <ChevronLeft />
            Précédent
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} sur {pageCount}
      </span>
      {page < pageCount ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={hrefFor(page + 1)}>
            Suivant
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
```

- [ ] **Step 3: Users list page**

Create `src/app/admin/users/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { Pagination } from "@/components/admin/pagination";
import { RoleBadge, SuspensionBadge } from "@/components/admin/user-badges";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/admin";
import {
  USER_FILTERS,
  USER_FILTER_LABELS,
  USERS_PAGE_SIZE,
  parsePage,
  parseUserFilter,
  type UserFilter,
} from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { listUsers } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const filter = parseUserFilter(params.filter);
  const page = parsePage(params.page);
  const { rows, total } = await listUsers({ q, filter, page });
  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  const hrefFor = (next: { filter?: UserFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const f = next.filter ?? filter;
    if (f !== "all") sp.set("filter", f);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        description={`${total.toLocaleString("fr-FR")} compte${total > 1 ? "s" : ""}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          action="/admin/users"
          role="search"
          className="flex min-w-0 flex-1 gap-2 sm:max-w-sm"
        >
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Nom, e-mail ou activité"
            aria-label="Rechercher un utilisateur"
          />
          <Button type="submit" variant="secondary" size="icon" aria-label="Rechercher">
            <Search />
          </Button>
        </form>
        <FilterChips
          label="Filtrer par type de compte"
          active={filter}
          options={USER_FILTERS.map((f) => ({
            value: f,
            label: USER_FILTER_LABELS[f],
            href: hrefFor({ filter: f }),
          }))}
        />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Aucun utilisateur ne correspond.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Utilisateur</th>
                  <th className="px-4 py-2.5 font-medium">Rôle</th>
                  <th className="px-4 py-2.5 font-medium">Page pro</th>
                  <th className="px-4 py-2.5 font-medium">Inscription</th>
                  <th className="px-4 py-2.5 font-medium">Dernière connexion</th>
                  <th className="px-4 py-2.5 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-medium hover:underline"
                      >
                        {u.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      {u.slug ? (
                        <Link
                          href={`/${u.slug}`}
                          target="_blank"
                          className="text-primary hover:underline"
                        >
                          /{u.slug}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateShort(u.createdAt, ADMIN_TZ)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {u.lastLoginAt ? formatDateShort(u.lastLoginAt, ADMIN_TZ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <SuspensionBadge banned={u.banned} banExpires={u.banExpires} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pagination
        page={page}
        pageCount={pageCount}
        hrefFor={(p) => hrefFor({ page: p })}
      />
    </>
  );
}
```

- [ ] **Step 4: User detail page**

Create `src/app/admin/users/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { RoleBadge, SuspensionBadge } from "@/components/admin/user-badges";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_TZ, browserName, classifyDevice } from "@/lib/analytics";
import { formatDateShort, formatDateTimeShort } from "@/lib/datetime";
import { isSuspended } from "@/lib/suspension";
import { formatMoney } from "@/lib/utils";
import { getUserDetail } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Utilisateur" };

const DEVICE_LABELS = { mobile: "Mobile", tablet: "Tablette", desktop: "Ordinateur" } as const;
const PROVIDER_LABELS: Record<string, string> = {
  credential: "Mot de passe",
  google: "Google",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user: u, pro, providers, sessions, stats, revenue } = detail;
  const suspended = isSuspended(u);

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Utilisateurs
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={u.name} src={u.image} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{u.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{u.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <RoleBadge role={u.role} />
          <SuspensionBadge banned={u.banned} banExpires={u.banExpires} />
        </div>
      </div>

      {suspended && u.banReason && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
          Motif de la suspension : {u.banReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Compte</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <Field label="Inscription">{formatDateShort(u.createdAt, ADMIN_TZ)}</Field>
                <Field label="Dernière connexion">
                  {u.lastLoginAt ? formatDateTimeShort(u.lastLoginAt, ADMIN_TZ) : "—"}
                </Field>
                <Field label="E-mail vérifié">{u.emailVerified ? "Oui" : "Non"}</Field>
                <Field label="Connexions">
                  {providers.length
                    ? providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")
                    : "—"}
                </Field>
              </dl>
            </CardContent>
          </Card>

          {pro && stats && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Page pro</CardTitle>
                <Link
                  href={`/${pro.slug}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  /{pro.slug}
                  <ExternalLink className="size-3.5" />
                </Link>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="divide-y divide-border">
                  <Field label="Activité">{pro.businessName}</Field>
                  <Field label="Créée le">{formatDateShort(pro.createdAt, ADMIN_TZ)}</Field>
                  <Field label="Fuseau · devise">
                    {pro.timezone} · {pro.currency.toUpperCase()}
                  </Field>
                  <Field label="Google Agenda">
                    {pro.googleCalendarId ? "Connecté" : "Non connecté"}
                  </Field>
                </dl>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Prestations", value: stats.eventTypes },
                    { label: "Réservations confirmées", value: stats.bookings },
                    { label: "À venir", value: stats.upcoming },
                    { label: "Clients", value: stats.customers },
                    { label: "Packs vendus", value: stats.packsSold },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-muted/60 p-3">
                      <p className="text-lg font-semibold">
                        {s.value.toLocaleString("fr-FR")}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-lg font-semibold">
                      {revenue.length
                        ? revenue.map((r) => formatMoney(r.cents, r.currency)).join(" · ")
                        : formatMoney(0, pro.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">Encaissé (total)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Sessions actives</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune session active.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {DEVICE_LABELS[classifyDevice(s.userAgent ?? "")]} ·{" "}
                          {browserName(s.userAgent)}
                          {s.impersonatedBy && (
                            <Badge variant="warning" className="ml-2">
                              En tant que
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.ipAddress || "IP inconnue"} · ouverte le{" "}
                          {formatDateTimeShort(s.createdAt, ADMIN_TZ)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        expire le {formatDateShort(s.expiresAt, ADMIN_TZ)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 6: Browser verification**

As `admin@skedul.test` on `/admin/users`:
- 3 rows (newest first); `pro@skedul.app` shows « Pro » + `/altinha-paris`; `admin@skedul.test` shows « Admin »; « Dernière connexion » filled for accounts that signed in since Task 1.
- Search `altinha` → only the pro; search `beatriz` → only Beatriz; search `%` → no rows (escaped, not a wildcard).
- Chips: « Pros » → only the pro; « Admins » → only the admin; « Suspendus » → empty state.
- Open the pro → « Compte », « Page pro » (Altinha Paris, stats, encaissé in €), « Sessions actives ». Open Beatriz → no « Page pro » card. `/admin/users/does-not-exist` → 404.
- The feed links on `/admin` now open the right user.

- [ ] **Step 7: Commit**

```bash
git add src/server/admin-queries.ts src/components/admin/user-badges.tsx src/components/admin/filter-chips.tsx src/components/admin/pagination.tsx src/app/admin/users/page.tsx "src/app/admin/users/[id]/page.tsx"
git commit -m "feat(admin): users list with search, filters and user detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: User actions, impersonation banner & suspended pros offline

**Files:**
- Create: `src/server/admin.ts`
- Create: `src/components/admin/user-actions.tsx`
- Modify: `src/app/admin/users/[id]/page.tsx`
- Create: `src/components/dashboard/impersonation-banner.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/server/queries.ts` (`getPublicEventType`, `getPublicPack`, `getPublicProfile`)
- Modify: `src/server/public.ts` (`purchasePack`, `loadEventType`)

**Interfaces:**
- Consumes: `getAdminUser` (Task 2), `isSuspended` / `userNotSuspended` (Task 2), `BAN_DURATIONS`, `BAN_DURATION_LABELS`, `parseBanDuration`, `type BanDuration`, `type UserRole` (Task 6), `getSession` (`src/lib/session.ts`).
- Produces:
  - Server actions (`src/server/admin.ts`): `type AdminActionResult = { ok: true } | { ok: false; error: string }`; `suspendUser(input: { userId: string; reason: string; duration: string }): Promise<AdminActionResult>`; `reactivateUser(userId: string)`; `signOutEverywhere(userId: string)`; `startImpersonation(userId: string)` (redirects to `/dashboard` on success); `setAdminRole(input: { userId: string; admin: boolean })`; `stopImpersonation(): Promise<void>` (redirects)
  - `<UserActions userId isSelf role isPro suspended />`, `<ImpersonationBanner name email />`

- [ ] **Step 1: Server actions**

Create `src/server/admin.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { professional, user } from "@/lib/db/schema";
import { getAdminUser } from "@/lib/admin";
import { BAN_DURATIONS, parseBanDuration, type UserRole } from "@/lib/admin-params";
import { getSession } from "@/lib/session";
import { isSuspended } from "@/lib/suspension";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

type Target = { id: string; role: UserRole; isPro: boolean; suspended: boolean };

/** The caller must be an active admin acting on someone else who exists. */
async function authorize(
  userId: string,
): Promise<{ target: Target } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Accès refusé." };
  if (userId === admin.id) {
    return { error: "Vous ne pouvez pas agir sur votre propre compte." };
  }
  const [row] = await db
    .select({
      id: user.id,
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
      proId: professional.id,
    })
    .from(user)
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return { error: "Utilisateur introuvable." };
  return {
    target: {
      id: row.id,
      role: row.role,
      isPro: row.proId !== null,
      suspended: isSuspended(row),
    },
  };
}

function refresh(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

function failure(err: unknown): AdminActionResult {
  console.error("[admin] action failed", err);
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Action impossible.",
  };
}

export async function suspendUser(input: {
  userId: string;
  reason: string;
  duration: string;
}): Promise<AdminActionResult> {
  const check = await authorize(input.userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (target.role === "admin") {
    return { ok: false, error: "Retirez d'abord le rôle admin." };
  }
  const duration = parseBanDuration(input.duration);
  if (!duration) return { ok: false, error: "Durée invalide." };
  const seconds = BAN_DURATIONS[duration];
  try {
    await auth.api.banUser({
      headers: await headers(),
      body: {
        userId: target.id,
        banReason: input.reason.trim().slice(0, 500) || "Aucun motif précisé",
        ...(seconds ? { banExpiresIn: seconds } : {}),
      },
    });
  } catch (err) {
    return failure(err);
  }
  refresh(target.id);
  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  if (!check.target.suspended) {
    return { ok: false, error: "Ce compte n'est pas suspendu." };
  }
  try {
    await auth.api.unbanUser({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  refresh(userId);
  return { ok: true };
}

export async function signOutEverywhere(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  if (check.target.role === "admin") {
    return { ok: false, error: "Action impossible sur un admin." };
  }
  try {
    await auth.api.revokeUserSessions({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  refresh(userId);
  return { ok: true };
}

/** "Se connecter en tant que": opens a 1-hour session as the pro, then /dashboard. */
export async function startImpersonation(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (target.role === "admin") {
    return { ok: false, error: "Impossible d'ouvrir le compte d'un admin." };
  }
  if (!target.isPro) {
    return { ok: false, error: "Seuls les comptes pro peuvent être ouverts." };
  }
  if (target.suspended) return { ok: false, error: "Ce compte est suspendu." };
  try {
    await auth.api.impersonateUser({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  redirect("/dashboard");
}

export async function setAdminRole(input: {
  userId: string;
  admin: boolean;
}): Promise<AdminActionResult> {
  const check = await authorize(input.userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (input.admin) {
    if (target.role === "admin") return { ok: false, error: "Ce compte est déjà admin." };
    if (target.suspended) return { ok: false, error: "Réactivez d'abord ce compte." };
  } else if (target.role !== "admin") {
    return { ok: false, error: "Ce compte n'est pas admin." };
  }
  // role is our user_role enum: write it directly (the plugin's setRole would
  // only re-check the admin permission verified above).
  const role: UserRole = input.admin ? "admin" : target.isPro ? "pro" : "client";
  await db.update(user).set({ role }).where(eq(user.id, target.id));
  refresh(target.id);
  return { ok: true };
}

/**
 * Ends an impersonation. Runs in the impersonated (pro) session, so there is
 * no admin check here: Better Auth verifies the signed admin_session cookie.
 */
export async function stopImpersonation(): Promise<void> {
  const current = await getSession();
  if (!current?.session.impersonatedBy) redirect("/dashboard");
  const impersonatedId = current.user.id;
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
  } catch (err) {
    // Admin session gone (expired or signed out elsewhere): sign out cleanly.
    console.error("[admin] could not stop impersonation", err);
    await auth.api.signOut({ headers: await headers() });
    redirect("/sign-in");
  }
  redirect(`/admin/users/${impersonatedId}`);
}
```

- [ ] **Step 2: Actions panel**

Create `src/components/admin/user-actions.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, LogIn, LogOut, ShieldCheck, ShieldOff, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BAN_DURATION_LABELS,
  type BanDuration,
  type UserRole,
} from "@/lib/admin-params";
import {
  reactivateUser,
  setAdminRole,
  signOutEverywhere,
  startImpersonation,
  suspendUser,
  type AdminActionResult,
} from "@/server/admin";

type ActionId = "suspend" | "reactivate" | "signout" | "impersonate" | "grant" | "revoke";

export function UserActions({
  userId,
  isSelf,
  role,
  isPro,
  suspended,
}: {
  userId: string;
  isSelf: boolean;
  role: UserRole;
  isPro: boolean;
  suspended: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<BanDuration>("7d");

  function run(action: () => Promise<AdminActionResult>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      setConfirming(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(success);
      router.refresh();
    });
  }

  /** First click asks for confirmation; "Confirmer" runs the action. */
  function confirmable(
    id: ActionId,
    label: string,
    icon: React.ReactNode,
    variant: "secondary" | "outline" | "destructive",
    onConfirm: () => void,
  ) {
    if (confirming === id) {
      return (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={variant === "destructive" ? "destructive" : "primary"}
            className="flex-1"
            disabled={pending}
            onClick={onConfirm}
          >
            Confirmer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            Annuler
          </Button>
        </div>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        className="w-full justify-start"
        disabled={pending}
        onClick={() => setConfirming(id)}
      >
        {icon}
        {label}
      </Button>
    );
  }

  if (isSelf) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            C&apos;est votre compte : aucune action disponible ici.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {role === "admin" ? (
          confirmable("revoke", "Retirer le rôle admin", <ShieldOff />, "outline", () =>
            run(() => setAdminRole({ userId, admin: false }), "Rôle admin retiré."),
          )
        ) : (
          <>
            {suspended ? (
              confirmable("reactivate", "Réactiver le compte", <Undo2 />, "secondary", () =>
                run(() => reactivateUser(userId), "Compte réactivé."),
              )
            ) : (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">Suspendre le compte</p>
                <div className="space-y-1.5">
                  <Label htmlFor="ban-reason">Motif (optionnel)</Label>
                  <Textarea
                    id="ban-reason"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    className="min-h-16"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ban-duration">Durée</Label>
                  <Select
                    id="ban-duration"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value as BanDuration)}
                  >
                    {(Object.keys(BAN_DURATION_LABELS) as BanDuration[]).map((d) => (
                      <option key={d} value={d}>
                        {BAN_DURATION_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                </div>
                {confirmable("suspend", "Suspendre", <Ban />, "destructive", () =>
                  run(() => suspendUser({ userId, reason, duration }), "Compte suspendu."),
                )}
                <p className="text-xs text-muted-foreground">
                  Connexion bloquée et sessions coupées
                  {isPro ? ", page publique hors ligne" : ""}.
                </p>
              </div>
            )}
            {confirmable("signout", "Déconnecter partout", <LogOut />, "secondary", () =>
              run(() => signOutEverywhere(userId), "Toutes ses sessions sont fermées."),
            )}
            {isPro &&
              !suspended &&
              confirmable("impersonate", "Se connecter en tant que", <LogIn />, "secondary", () =>
                run(() => startImpersonation(userId), "Ouverture du compte…"),
              )}
            {!suspended &&
              confirmable("grant", "Nommer admin", <ShieldCheck />, "outline", () =>
                run(() => setAdminRole({ userId, admin: true }), "Rôle admin attribué."),
              )}
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-success-muted px-3 py-2 text-sm text-success">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

In `src/app/admin/users/[id]/page.tsx`:
1. Add `import { UserActions } from "@/components/admin/user-actions";`
2. Replace `await requireAdmin();` with `const admin = await requireAdmin();`
3. After the closing `</div>` of the `lg:col-span-2` column (still inside the `grid` div), add:

```tsx
        <div>
          <UserActions
            userId={u.id}
            isSelf={u.id === admin.id}
            role={u.role}
            isPro={pro !== null}
            suspended={suspended}
          />
        </div>
```

- [ ] **Step 3: Impersonation banner**

Create `src/components/dashboard/impersonation-banner.tsx`:

```tsx
import { stopImpersonation } from "@/server/admin";

/** Shown in the pro back-office while an admin is "connecté en tant que". */
export function ImpersonationBanner({ name, email }: { name: string; email: string }) {
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ink px-4 py-2 text-sm text-ink-foreground">
      <span>
        Vous êtes connecté en tant que <strong>{name}</strong> ({email})
      </span>
      <form action={stopImpersonation}>
        <button
          type="submit"
          className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25"
        >
          Revenir à l&apos;admin
        </button>
      </form>
    </div>
  );
}
```

In `src/app/dashboard/layout.tsx`, add `import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";` and replace the `return (…)` with:

```tsx
  return (
    <>
      {session.session.impersonatedBy && (
        <ImpersonationBanner name={session.user.name} email={session.user.email} />
      )}
      <div
        className="flex min-h-screen flex-col md:flex-row"
        style={brandThemeVars(pro.brandColor)}
      >
        <DashboardSidebar
          businessName={pro.businessName}
          slug={pro.slug}
          // UI hint only — /admin re-checks the role in the database.
          isAdmin={session.user.role === "admin"}
        />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-5xl px-5 py-8">{children}</div>
        </main>
      </div>
    </>
  );
```

- [ ] **Step 4: Suspended pros are offline**

In `src/server/queries.ts`, add `import { userNotSuspended } from "@/lib/suspension";` (`user` is already imported from the schema).

In `getPublicEventType`, add the join and the condition:

```ts
    .innerJoin(professional, eq(professional.id, eventType.professionalId))
    .innerJoin(user, eq(user.id, professional.userId))
    .where(
      and(
        eq(professional.slug, slug),
        eq(eventType.id, eventTypeId),
        eq(eventType.isActive, true),
        userNotSuspended(),
      ),
    )
```

In `getPublicPack`, add after `.innerJoin(professional, eq(professional.id, pack.professionalId))`:

```ts
    .innerJoin(user, eq(user.id, professional.userId))
```

and add `userNotSuspended(),` as the last argument of its `and(…)`.

In `getPublicProfile`, replace the first query and the `pro` line with:

```ts
  const rows = await db
    .select({ pro: professional })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(and(eq(professional.slug, slug), userNotSuspended()))
    .limit(1);
  const pro = rows[0]?.pro;
```

In `src/server/public.ts`: add `user` to the `@/lib/db/schema` import, add `import { userNotSuspended } from "@/lib/suspension";`, then in **both** `purchasePack` and `loadEventType` add `.innerJoin(user, eq(user.id, professional.userId))` right after the `.innerJoin(professional, …)` line and `userNotSuspended()` as the last argument of the `and(…)` in `.where(…)`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 6: Browser verification**

As `admin@skedul.test`:
1. Own detail page (`/admin/users/<admin id>`, from the list) → « C'est votre compte : aucune action disponible ici. »
2. Pro detail → panel shows Suspendre (motif + durée), Déconnecter partout, Se connecter en tant que, Nommer admin. Each needs « Confirmer ».
3. **Se connecter en tant que** → `/dashboard` of Altinha Paris with the dark banner « Vous êtes connecté en tant que … ». `/admin` → 404 while impersonating. Back on `/dashboard`, **Revenir à l'admin** → back on the pro's detail page as admin; « Sessions actives » no longer lists the impersonation session.
4. Suspend the pro (motif « test », 1 jour) → badge « Suspendu jusqu'au … », motif shown, sessions list empty. `/admin/users?filter=suspended` lists the pro. Open `/altinha-paris` in a new tab → 404 page. Sign out, sign in as `pro@skedul.app` → error « Votre compte a été suspendu. Contactez le support… ». Sign back in as the admin.
5. **Réactiver le compte** → « Actif »; `/altinha-paris` loads again. Sign out, sign in as the pro → `/dashboard`. Sign out, sign back in as the admin.
6. Beatriz (client) → no « Se connecter en tant que »; **Nommer admin** → badge « Admin », panel shows only « Retirer le rôle admin » → retire → back to « Client ».
7. Open a pro session outside the browser:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/auth/sign-in/email -H "content-type: application/json" -H "origin: http://localhost:3100" --data '{"email":"pro@skedul.app","password":"password123"}'
```

Expected `200`; reload the pro's detail page → « Sessions actives » shows a session (browser « Navigateur inconnu », since curl). **Déconnecter partout** → the list becomes « Aucune session active. »

- [ ] **Step 7: Commit**

```bash
git add src/server/admin.ts src/components/admin/user-actions.tsx "src/app/admin/users/[id]/page.tsx" src/components/dashboard/impersonation-banner.tsx src/app/dashboard/layout.tsx src/server/queries.ts src/server/public.ts
git commit -m "feat(admin): suspend, sign-out, impersonate and admin-role actions

Suspended pros' public pages go offline and their booking/purchase
actions are refused.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Activity page

**Files:**
- Modify: `src/server/admin-queries.ts`
- Create: `src/app/admin/activity/page.tsx`

**Interfaces:**
- Consumes: `BookingStatus`, `PurchaseStatus`, `ActivityTab`, labels and parsers (Task 6); `FilterChips` (Task 8); `formatSlot` (`src/lib/datetime.ts`).
- Produces: `ACTIVITY_LIMIT = 50`; `listRecentBookings(status: BookingStatus | null)`; `listRecentPurchases(status: PurchaseStatus | null)`.

- [ ] **Step 1: Queries**

In `src/server/admin-queries.ts`, replace the `@/lib/admin-params` import with:

```ts
import {
  BOOKING_STATUS_LABELS,
  USERS_PAGE_SIZE,
  type BookingStatus,
  type PurchaseStatus,
  type UserFilter,
} from "@/lib/admin-params";
```

then append:

```ts
/* ───────────────────────────── Activity ───────────────────────────── */

export const ACTIVITY_LIMIT = 50;

export function listRecentBookings(status: BookingStatus | null) {
  return db
    .select({
      id: booking.id,
      createdAt: booking.createdAt,
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      paymentType: booking.paymentType,
      amountCents: booking.amountPaidCents,
      proUserId: professional.userId,
      businessName: professional.businessName,
      timezone: professional.timezone,
      currency: professional.currency,
      customerName: customer.name,
      customerEmail: customer.email,
      eventTitle: eventType.title,
    })
    .from(booking)
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .where(status ? eq(booking.status, status) : undefined)
    .orderBy(desc(booking.createdAt))
    .limit(ACTIVITY_LIMIT);
}

export function listRecentPurchases(status: PurchaseStatus | null) {
  return db
    .select({
      id: packPurchase.id,
      createdAt: packPurchase.createdAt,
      status: packPurchase.status,
      amountCents: packPurchase.amountPaidCents,
      currency: packPurchase.currency,
      creditsTotal: packPurchase.creditsTotal,
      creditsRemaining: packPurchase.creditsRemaining,
      proUserId: professional.userId,
      businessName: professional.businessName,
      customerName: customer.name,
      customerEmail: customer.email,
      packName: pack.name,
    })
    .from(packPurchase)
    .innerJoin(professional, eq(professional.id, packPurchase.professionalId))
    .innerJoin(customer, eq(customer.id, packPurchase.customerId))
    .innerJoin(pack, eq(pack.id, packPurchase.packId))
    .where(status ? eq(packPurchase.status, status) : undefined)
    .orderBy(desc(packPurchase.createdAt))
    .limit(ACTIVITY_LIMIT);
}
```

- [ ] **Step 2: Page**

Create `src/app/admin/activity/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
  PURCHASE_STATUS_LABELS,
  parseActivityTab,
  parseBookingStatus,
  parsePurchaseStatus,
  type ActivityTab,
  type BookingStatus,
  type PurchaseStatus,
} from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort, formatSlot } from "@/lib/datetime";
import { formatMoney } from "@/lib/utils";
import {
  ACTIVITY_LIMIT,
  listRecentBookings,
  listRecentPurchases,
} from "@/server/admin-queries";

export const metadata: Metadata = { title: "Activité" };

const BOOKING_VARIANT: Record<BookingStatus, "success" | "warning" | "neutral"> = {
  pending: "warning",
  confirmed: "success",
  completed: "success",
  cancelled: "neutral",
};
const PURCHASE_VARIANT: Record<PurchaseStatus, "success" | "warning" | "neutral"> = {
  pending: "warning",
  paid: "success",
  refunded: "neutral",
};

const th = "px-4 py-2.5 font-medium";
const td = "px-4 py-3";

function Empty() {
  return (
    <p className="p-10 text-center text-sm text-muted-foreground">
      Aucune opération pour ce filtre.
    </p>
  );
}

function ProLink({ userId, name }: { userId: string; name: string }) {
  return (
    <Link href={`/admin/users/${userId}`} className="font-medium hover:underline">
      {name}
    </Link>
  );
}

async function BookingsTable({ status }: { status: BookingStatus | null }) {
  const rows = await listRecentBookings(status);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className={th}>Créée le</th>
            <th className={th}>Pro</th>
            <th className={th}>Client</th>
            <th className={th}>Prestation</th>
            <th className={th}>Créneau</th>
            <th className={th}>Paiement</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={th}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatDateTimeShort(r.createdAt, ADMIN_TZ)}
              </td>
              <td className={td}>
                <ProLink userId={r.proUserId} name={r.businessName} />
              </td>
              <td className={td}>
                {r.customerName}
                <p className="text-xs text-muted-foreground">{r.customerEmail}</p>
              </td>
              <td className={td}>{r.eventTitle}</td>
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatSlot(r.startAt, r.endAt, r.timezone)}
              </td>
              <td className={td}>{PAYMENT_TYPE_LABELS[r.paymentType]}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {r.amountCents ? formatMoney(r.amountCents, r.currency) : "—"}
              </td>
              <td className={td}>
                <Badge variant={BOOKING_VARIANT[r.status]}>
                  {BOOKING_STATUS_LABELS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function PurchasesTable({ status }: { status: PurchaseStatus | null }) {
  const rows = await listRecentPurchases(status);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className={th}>Créé le</th>
            <th className={th}>Pro</th>
            <th className={th}>Client</th>
            <th className={th}>Pack</th>
            <th className={th}>Crédits restants</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={th}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatDateTimeShort(r.createdAt, ADMIN_TZ)}
              </td>
              <td className={td}>
                <ProLink userId={r.proUserId} name={r.businessName} />
              </td>
              <td className={td}>
                {r.customerName}
                <p className="text-xs text-muted-foreground">{r.customerEmail}</p>
              </td>
              <td className={td}>{r.packName}</td>
              <td className={`${td} tabular-nums`}>
                {r.creditsRemaining} / {r.creditsTotal}
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {formatMoney(r.amountCents, r.currency)}
              </td>
              <td className={td}>
                <Badge variant={PURCHASE_VARIANT[r.status]}>
                  {PURCHASE_STATUS_LABELS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tab = parseActivityTab(params.tab);
  const bookingStatus = tab === "bookings" ? parseBookingStatus(params.status) : null;
  const purchaseStatus = tab === "purchases" ? parsePurchaseStatus(params.status) : null;
  const status: string | null = bookingStatus ?? purchaseStatus;

  const href = (next: { tab?: ActivityTab; status?: string | null }) => {
    const sp = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== "bookings") sp.set("tab", t);
    const s = next.status === undefined ? status : next.status;
    if (s) sp.set("status", s);
    const qs = sp.toString();
    return qs ? `/admin/activity?${qs}` : "/admin/activity";
  };

  const statusLabels: Record<string, string> =
    tab === "bookings" ? BOOKING_STATUS_LABELS : PURCHASE_STATUS_LABELS;

  return (
    <>
      <PageHeader
        title="Activité"
        description={`Les ${ACTIVITY_LIMIT} dernières opérations, toutes pages pro confondues.`}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Type d'opération"
          active={tab}
          options={[
            { value: "bookings", label: "Réservations", href: href({ tab: "bookings", status: null }) },
            { value: "purchases", label: "Achats de packs", href: href({ tab: "purchases", status: null }) },
          ]}
        />
        <FilterChips
          label="Statut"
          active={status ?? "all"}
          options={[
            { value: "all", label: "Tous", href: href({ status: null }) },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
              href: href({ status: value }),
            })),
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        {tab === "bookings" ? (
          <BookingsTable status={bookingStatus} />
        ) : (
          <PurchasesTable status={purchaseStatus} />
        )}
      </Card>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 4: Browser verification**

`/admin/activity` → seed bookings listed with pro link, client, créneau in Paris time, mode « Crédit »/« Payé », status badges. « Achats de packs » → Beatriz's paid pack with « x / 4 » credits. Status chips filter (« En attente » usually empty → « Aucune opération pour ce filtre. »). Pro links open the pro's detail page. The overview alert links (if any) land on the filtered view.

- [ ] **Step 5: Commit**

```bash
git add src/server/admin-queries.ts src/app/admin/activity/page.tsx
git commit -m "feat(admin): activity page for bookings and pack purchases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Traffic page

**Files:**
- Modify: `src/server/admin-queries.ts`
- Create: `src/components/admin/top-list.tsx`
- Create: `src/app/admin/traffic/page.tsx`

**Interfaces:**
- Consumes: `dayOf`, `pageView`, `professional` (Task 7 module); `lastDayKeys`, `startOfDayKey`, `fillDailySeries`, `dayLabel`, `countryName` (Task 6); `TRAFFIC_RANGES`, `parseRange` (Task 6); `BarChart`, `StatCard` (Task 7); `FilterChips` (Task 8).
- Produces: `getTrafficReport(since: Date): Promise<{ daily; devices; pages; pros; sources; countries }>`; `<TopList title unit rows empty? />` with rows `{ key: string; label: React.ReactNode; sublabel?: string; value: number }[]`.

- [ ] **Step 1: Query**

Append to `src/server/admin-queries.ts`:

```ts
/* ───────────────────────────── Traffic ───────────────────────────── */

export async function getTrafficReport(since: Date) {
  const day = dayOf(pageView.createdAt);
  const visitors = () => sql<string>`count(distinct ${pageView.visitorHash})`;
  const source = sql<string>`coalesce(${pageView.source}, ${pageView.referrerHost}, 'Direct')`;
  const inRange = gte(pageView.createdAt, since);

  const [daily, devices, pages, pros, sources, countries] = await Promise.all([
    db
      .select({ day, views: count(), visitors: visitors() })
      .from(pageView)
      .where(inRange)
      .groupBy(day),
    db
      .select({ device: pageView.device, views: count() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.device)
      .orderBy(desc(count())),
    db
      .select({ path: pageView.path, views: count(), visitors: visitors() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.path)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({
        userId: professional.userId,
        businessName: professional.businessName,
        slug: professional.slug,
        views: count(),
      })
      .from(pageView)
      .innerJoin(professional, eq(professional.id, pageView.professionalId))
      .where(inRange)
      .groupBy(professional.id)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({ source, visits: count() })
      .from(pageView)
      .where(and(inRange, eq(pageView.entry, true)))
      .groupBy(source)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({ country: pageView.country, views: count() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.country)
      .orderBy(desc(count()))
      .limit(10),
  ]);
  return { daily, devices, pages, pros, sources, countries };
}
```

- [ ] **Step 2: Top list widget**

Create `src/components/admin/top-list.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type TopRow = {
  key: string;
  label: React.ReactNode;
  sublabel?: string;
  value: number;
};

/** A ranked list with a thin single-hue meter per row (track = lighter step). */
export function TopList({
  title,
  unit,
  rows,
  empty = "Aucune donnée sur la période.",
}: {
  title: string;
  /** Read by screen readers after each value, e.g. "vues". */
  unit: string;
  rows: TopRow[];
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.label}
                    {r.sublabel && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{r.sublabel}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.value.toLocaleString("fr-FR")}
                    <span className="sr-only"> {unit}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-primary-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(r.value / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Page**

Create `src/app/admin/traffic/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Layers, Smartphone, Users } from "lucide-react";

import { BarChart } from "@/components/admin/bar-chart";
import { FilterChips } from "@/components/admin/filter-chips";
import { StatCard } from "@/components/admin/stat-card";
import { TopList } from "@/components/admin/top-list";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  countryName,
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  startOfDayKey,
} from "@/lib/admin-metrics";
import { TRAFFIC_RANGES, parseRange } from "@/lib/admin-params";
import { getTrafficReport } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Trafic" };

const DEVICE_LABELS: Record<string, string> = {
  mobile: "Mobile",
  tablet: "Tablette",
  desktop: "Ordinateur",
};
const fmt = (n: number) => n.toLocaleString("fr-FR");

export default async function AdminTrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const range = parseRange((await searchParams).range);
  const keys = lastDayKeys(range, new Date());
  const report = await getTrafficReport(startOfDayKey(keys[0]));

  const viewsByDay = fillDailySeries(
    report.daily.map((d) => ({ day: d.day, value: d.views })),
    keys,
  );
  const visitorsByDay = fillDailySeries(
    report.daily.map((d) => ({ day: d.day, value: d.visitors })),
    keys,
  );
  const views = viewsByDay.reduce((sum, d) => sum + d.value, 0);
  const visitors = visitorsByDay.reduce((sum, d) => sum + d.value, 0);
  const mobile = report.devices.find((d) => d.device === "mobile")?.views ?? 0;

  return (
    <>
      <PageHeader
        title="Trafic"
        description="Pages publiques uniquement, sans cookie. Les visiteurs sont comptés jour par jour."
      />
      <div className="mb-6">
        <FilterChips
          label="Période"
          active={range}
          options={TRAFFIC_RANGES.map((r) => ({
            value: r,
            label: `${r} jours`,
            href: r === 30 ? "/admin/traffic" : `/admin/traffic?range=${r}`,
          }))}
        />
      </div>

      {views === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Aucune visite enregistrée sur cette période. Les pages publiques sont
            mesurées dès qu&apos;elles sont consultées.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={Eye} label="Pages vues" value={fmt(views)} />
            <StatCard icon={Users} label="Visiteurs" value={fmt(visitors)} />
            <StatCard
              icon={Layers}
              label="Pages par visiteur"
              value={visitors ? (views / visitors).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}
            />
            <StatCard
              icon={Smartphone}
              label="Part mobile"
              value={`${Math.round((mobile / views) * 100)} %`}
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Visiteurs par jour</CardTitle>
              <p className="text-sm text-muted-foreground">{range} derniers jours</p>
            </CardHeader>
            <CardContent>
              <BarChart
                unit={{ one: "visiteur", other: "visiteurs" }}
                data={visitorsByDay.map((d, i) => ({
                  key: d.day,
                  label: dayLabel(d.day),
                  value: d.value,
                  detail: `${fmt(viewsByDay[i].value)} pages vues`,
                }))}
              />
            </CardContent>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <TopList
              title="Pages les plus vues"
              unit="vues"
              rows={report.pages.map((p) => ({
                key: p.path,
                label: p.path,
                sublabel: `${fmt(Number(p.visitors))} visiteurs`,
                value: p.views,
              }))}
            />
            <TopList
              title="Pages pro les plus vues"
              unit="vues"
              rows={report.pros.map((p) => ({
                key: p.slug,
                label: (
                  <Link href={`/admin/users/${p.userId}`} className="hover:underline">
                    {p.businessName}
                  </Link>
                ),
                sublabel: `/${p.slug}`,
                value: p.views,
              }))}
            />
            <TopList
              title="Sources"
              unit="entrées"
              rows={report.sources.map((s) => ({ key: s.source, label: s.source, value: s.visits }))}
            />
            <TopList
              title="Appareils"
              unit="vues"
              rows={report.devices.map((d) => ({
                key: d.device,
                label: DEVICE_LABELS[d.device] ?? d.device,
                sublabel: `${Math.round((d.views / views) * 100)} %`,
                value: d.views,
              }))}
            />
            <TopList
              title="Pays"
              unit="vues"
              empty="Le pays n'est connu qu'en production (Vercel)."
              rows={report.countries.map((c) => ({
                key: c.country ?? "unknown",
                label: countryName(c.country),
                value: c.views,
              }))}
            />
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --config.verify-deps-before-run=false typecheck` — expected exit 0.

- [ ] **Step 5: Browser verification**

`/admin/traffic` → period chips (30 jours active), 4 cards consistent with Task 5 rows, chart with tooltip, top lists: `/altinha-paris` and `/` in pages, « Altinha Paris » in pro pages (link opens its detail), « google.com » / « newsletter » / « Direct » in sources, « Ordinateur » in devices, « Inconnu » in countries (dev has no Vercel geo header). `?range=7` and `?range=90` work; `?range=abc` falls back to 30. Check `preview_logs` (level error): no SQL errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin-queries.ts src/components/admin/top-list.tsx src/app/admin/traffic/page.tsx
git commit -m "feat(admin): traffic page with daily visitors, top pages, sources, devices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification & docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Docs**

In `AGENTS.md`, under `## Conventions`, add after the **Auth** bullet:

```markdown
- **Admin**: `/admin` (role `admin` on `user.role`, Better Auth `admin` plugin for
  ban/impersonation). Guard with `requireAdmin()` / `getAdminUser()` from
  `src/lib/admin.ts` — they re-read the role from the DB. Grant with
  `pnpm admin:grant <email>` (`--revoke` to remove). Admins get an Admin/Client
  chooser after sign-in (cookie `skedul_entry`). Reads in `src/server/admin-queries.ts`,
  actions in `src/server/admin.ts`.
- **Traffic**: cookieless page views (`page_view`) sent by `<PageViewTracker />` to
  `/api/track`; public pages only (see `isTrackedPath` in `src/lib/analytics.ts`).
```

and under `## Workflow`, replace the migration bullet with:

```markdown
- Schema change → `pnpm db:generate` then `pnpm db:migrate` (targets `DATABASE_URL`).
  If `db:migrate` fails locally (Windows), use `pnpm db:apply drizzle/<file>.sql`.
```

In `README.md`, in the « Scripts » table add two rows after `pnpm db:seed`:

```markdown
| `pnpm db:apply <fichier>` | applique une migration via HTTP (repli si `db:migrate` échoue) |
| `pnpm admin:grant <email>` | donne le rôle admin (`--revoke` pour le retirer) |
```

and after the demo accounts table add:

```markdown
Espace admin : **`/admin`**. Aucun compte admin n'est créé par le seed — créez un
compte puis `pnpm admin:grant <email>`.
```

- [ ] **Step 2: Full gates**

Run each and expect success:
- `pnpm --config.verify-deps-before-run=false test` → 111 tests (74 pre-existing + 37 new), 0 failures (1 pre-existing skip).
- `pnpm --config.verify-deps-before-run=false typecheck` → exit 0.
- `pnpm --config.verify-deps-before-run=false lint` → only the 7 baseline problems listed in Global Constraints; none in a file listed by `git diff --name-only main...HEAD`.
- Stop the dev server (`preview_stop`), then `pnpm --config.verify-deps-before-run=false build` → completes; the route list includes `/admin`, `/admin/users`, `/admin/users/[id]`, `/admin/traffic`, `/admin/activity`, `/admin/subscriptions`, `/api/track` (all dynamic `ƒ`).

- [ ] **Step 3: End-to-end pass (spec §9)**

Restart the dev server and re-run, in order: Task 4 step 8 (entry flow), Task 7 step 8 (overview), Task 8 step 6 (users), Task 9 step 6 (actions), Task 10 step 4 (activity), Task 11 step 5 (traffic). Also check at mobile width (`resize_window` preset `mobile`) that `/admin` and `/admin/users` have no horizontal page scroll (tables scroll inside their card), then reset with preset `desktop`.

- [ ] **Step 4: Leave dev data clean**

Ensure `pro@skedul.app` is active with role `pro` and `beatriz@example.com` has role `client` (re-run `pnpm --config.verify-deps-before-run=false admin:grant <email> --revoke` if needed). Keep `admin@skedul.test` as the local admin.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md README.md
git commit -m "docs(admin): document the admin space, tracking and new scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
