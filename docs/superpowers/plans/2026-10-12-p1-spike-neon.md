# P1 — Spike Neon (go / no-go) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, on a throwaway Neon branch, that the write mechanism P2 will be built on (`db.batch` + raising asserts + row locks + EXCLUDE + NO ACTION FKs) and the Better Auth e-mail-code setup behave as the spec assumes. Record the go / no-go in spec § 10 before P2 is planned.

**Architecture:** A small harness in `scripts/spike/` runs numbered checks S1–S8 against the Neon branch `spike-batch`, a child of `development`, through its own drizzle neon-http client. Each check encodes the expected behaviour as `node:assert` assertions and prints PASS/FAIL. A guard refuses to run unless the database has the marker table `public.spike_marker`, which only the spike branch has. The pure error helper `src/lib/db/pg-error.ts` is built test-first and reused by P2.

**Tech Stack:** drizzle-orm 0.45.2 (`drizzle-orm/neon-http`), `@neondatabase/serverless` 1.1.0, Postgres 17.11 (Neon), better-auth 1.6.19 (`emailOTP`), `node:test` + `node:assert` via `tsx`, Neon MCP tools.

**Spec:** `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` (§ 10 mechanism, § 12 auth, § 15.1 plan P1 and its checks S1–S8).

## Global Constraints

- Work in the worktree `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\tickets` on branch `feat/tickets-events`. That branch has no upstream, on purpose. Never push it to `main`.
- `node_modules` is a **junction** to the main checkout (Task 1). Never run `pnpm install` or `pnpm <script>` in the worktree. Call binaries directly: `./node_modules/.bin/tsx`, `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`.
- **Databases.**
  - The spike runs only against the Neon branch `spike-batch`, through `SPIKE_DATABASE_URL` in `.env.spike.local`. Nothing in this plan touches the `development`, `preview` or `main` Neon branches.
  - Every Neon MCP call passes an explicit `branch_id`. Without it the tools default to `main`, which is **prod**.
  - Neon project id: `nameless-meadow-98376303`. `development` branch id: `br-bold-art-af8tpfm5`. Database `neondb`, role `neondb_owner`.
- **Secrets.** Never print, log or commit a connection string. `.env*` files are git-ignored (`.gitignore` line 34).
- **Destructive actions.** `mcp__Neon__delete_branch` is destructive. Call it only after the owner says yes in chat (Task 7).
- The repo is CommonJS (no `"type"` in `package.json`). Scripts wrap their work in `async function main()`, with no top-level `await`.
- Spike checks are experiments. A check that FAILs is a **finding**, not a bug to "fix" by editing the assertion. Re-run it once to rule out network timing. If it still fails, record a `Ruling:` in the ledger with the plan-B consequence from spec § 15.1, and keep going.
- Commit after each task with a Conventional Commit message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks that must stay green: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/tsx --test`.

## Review Focus

- **Running against the wrong database.** If `.env.spike.local` points at `development` or prod, the scratch DDL and the auth sign-ups would land there. Every entry point calls `assertSpikeBranch()` first. Task 2 checks that the guard refuses a database without the marker, using a URL-less dry run (see Task 2, Step 6).
- **Timing-based checks on a slow network.** S2 and S3 depend on request latency. Their thresholds are generous: S2 waits at least 1.8 s, S3 waits at most 1.5 s. A FAIL is re-run once before it counts.
- **JS arrays bound as SQL parameters.** Drizzle's `sql` template expands a bare JS array into a list `($1, $2)`. The P2 pattern is `= any(${sql.param(ids)}::text[])`, which sends one array param that neon-http serializes. If that is not how it works, every P2 "set of ids" statement must change. S4 checks this explicitly.
- **The cookie cache masking a revoked session.** After the anti-takeover purge, a cached `session_data` cookie may still say "logged in" for up to 5 minutes. S8c checks both `get-session` with the cache and `get-session?disableCookieCache=true`, and records the difference.
- **Errors thrown inside vs outside `db.batch`.** Inside a batch, neon throws `NeonDbError` directly. Outside, drizzle wraps it in `DrizzleQueryError` (`.cause`). `pgErrorInfo` must read both shapes. This is unit-tested in Task 2 and checked live in S7.

## File map

| File | Responsibility |
|---|---|
| `src/lib/db/pg-error.ts` (+ `.test.ts`) | `pgErrorInfo(err)` (SQLSTATE, constraint, detail, message through `.cause`), `skedulCode(err)` (the `skedul:<code>` of a raised assert). Pure; reused by P2's `mapDbError` |
| `scripts/spike/db.ts` | Spike client from `.env.spike.local`, `assertSpikeBranch()`, `setupScratch()`, `runCheck()`, `sleep()` |
| `scripts/spike/checks.ts` | Registry `CHECKS: SpikeCheck[]` |
| `scripts/spike/run.ts` | Runner: guard, run the selected checks, print a Markdown table, exit 1 on any FAIL |
| `scripts/spike/batch-checks.ts` | S1–S7 |
| `scripts/spike/auth-checks.ts` | S8a–S8e (Better Auth emailOTP + takeover hook) |
| `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` | § 10: new "Résultat du spike P1"; § 12: corrected emailOTP options if S8 says so |

---

### Task 1: Workspace and the throwaway Neon branch

**Files:**
- Create: `.claude/worktrees/tickets/node_modules` (junction)
- Create: `.claude/worktrees/tickets/.env.spike.local` (git-ignored)

**Interfaces:**
- Produces: a `spike-batch` Neon branch (id recorded in the ledger as `SPIKE_BRANCH_ID`) holding the marker table `public.spike_marker`, and `.env.spike.local` with `SPIKE_DATABASE_URL=…`.

- [ ] **Step 1: Junction `node_modules`**

Run in PowerShell:

```powershell
New-Item -ItemType Junction -Path C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\tickets\node_modules -Target C:\Users\Matheus\Documents\Codage\skedul\node_modules
```

Then, in the worktree: `./node_modules/.bin/tsx --test`
Expected: all tests pass (one DB test skipped).

- [ ] **Step 2: Create the branch**

Call `mcp__Neon__create_branch` with:

```json
{ "project_id": "nameless-meadow-98376303", "parent_id": "br-bold-art-af8tpfm5", "name": "spike-batch",
  "compute": { "min_cu": 0.25, "max_cu": 1, "suspend_timeout_seconds": 300 } }
```

Expected: a branch id `br-…`. Write it to the ledger as `SPIKE_BRANCH_ID=br-…`. If the result does not show it, call `mcp__Neon__list_branches` with `{ "project_id": "nameless-meadow-98376303", "search": "spike-batch" }`.

Check that the id is **not** one of `br-misty-thunder-af8c8bd9` (main/prod), `br-bold-art-af8tpfm5` (development) or `br-autumn-tooth-afnthws9` (preview).

- [ ] **Step 3: Marker table and sanity query**

Call `mcp__Neon__run_sql` with the spike id. Never omit `branch_id`:

```json
{ "project_id": "nameless-meadow-98376303", "branch_id": "<SPIKE_BRANCH_ID>", "database_name": "neondb",
  "sql": "CREATE TABLE public.spike_marker (created_at timestamptz NOT NULL DEFAULT now())" }
```

Then the same call with `"sql": "SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations, to_regclass('public.spike_marker') AS marker"`.
Expected: `migrations = 9` and `marker = spike_marker`.

- [ ] **Step 4: Write `.env.spike.local` without printing the URL**

Call `mcp__Neon__get_connection_string` with:

```json
{ "project_id": "nameless-meadow-98376303", "branch_id": "<SPIKE_BRANCH_ID>", "database_name": "neondb", "role_name": "neondb_owner" }
```

Write the returned URL to `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\tickets\.env.spike.local` as one line, `SPIKE_DATABASE_URL=<url>`, with the Write tool. Do not echo it in any message or command.

Run: `git -C C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\tickets check-ignore .env.spike.local`
Expected: it prints `.env.spike.local`, which means the file is ignored.

No commit: nothing tracked changed.

---

### Task 2: Error helper and spike harness

**Files:**
- Create: `src/lib/db/pg-error.ts`
- Create: `src/lib/db/pg-error.test.ts`
- Create: `scripts/spike/db.ts`
- Create: `scripts/spike/checks.ts`
- Create: `scripts/spike/run.ts`

**Interfaces:**
- Produces:
  - `type PgErrorInfo = { code?: string; constraint?: string; detail?: string; message: string }`
  - `pgErrorInfo(err: unknown): PgErrorInfo`
  - `skedulCode(err: unknown): string | null`, which returns `"stale"` for a raised `skedul:stale`
  - from `scripts/spike/db.ts`: `client` (neon), `db` (drizzle, with the app schema), `assertSpikeBranch(): Promise<void>`, `setupScratch(): Promise<void>`, `sleep(ms: number): Promise<void>`, `type SpikeCheck = { id: string; title: string; run: () => Promise<string> }`, `runCheck(c: SpikeCheck): Promise<CheckResult>`, `type CheckResult = { id: string; title: string; ok: boolean; detail: string; ms: number }`
  - from `scripts/spike/checks.ts`: `CHECKS: SpikeCheck[]` (later tasks push into it)

- [ ] **Step 1: Write the failing tests for `pgErrorInfo` / `skedulCode`**

Create `src/lib/db/pg-error.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { pgErrorInfo, skedulCode } from "./pg-error";

test("reads a NeonDbError thrown directly (inside db.batch)", () => {
  const err = Object.assign(new Error("new row violates check constraint"), {
    code: "23514",
    constraint: "occurrence_seats_chk",
  });
  assert.deepEqual(pgErrorInfo(err), {
    code: "23514",
    constraint: "occurrence_seats_chk",
    detail: undefined,
    message: "new row violates check constraint",
  });
});

test("reads the cause of a DrizzleQueryError (outside db.batch)", () => {
  const cause = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "booking_active_uq",
    detail: "Key (occurrence_id, customer_id)=(o1, c1) already exists.",
  });
  const err = new Error("Failed query: insert …", { cause });
  const info = pgErrorInfo(err);
  assert.equal(info.code, "23505");
  assert.equal(info.constraint, "booking_active_uq");
  assert.match(info.detail ?? "", /already exists/);
});

test("ignores Node errno codes and keeps the innermost message", () => {
  const err = new Error("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
  assert.deepEqual(pgErrorInfo(err), { message: "socket hang up" });
});

test("skedulCode extracts the code of a raised skedul_assert", () => {
  const raised = Object.assign(new Error("skedul:stale"), { code: "P0001" });
  assert.equal(skedulCode(raised), "stale");
  assert.equal(skedulCode(new Error("Failed query", { cause: raised })), "stale");
  assert.equal(skedulCode(Object.assign(new Error("x"), { code: "23514" })), null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/db/pg-error.test.ts`
Expected: FAIL with `Cannot find module './pg-error'`.

- [ ] **Step 3: Implement**

Create `src/lib/db/pg-error.ts`:

```ts
/**
 * Postgres error details, whatever the path that threw them. Inside
 * `db.batch` neon-http throws its NeonDbError directly; outside, drizzle wraps
 * it in a DrizzleQueryError whose `.cause` is the NeonDbError. Duck-typed on
 * purpose: @neondatabase/serverless ships two builds (CJS/ESM), so there can
 * be two NeonDbError classes and `instanceof` is unreliable.
 */
export type PgErrorInfo = {
  code?: string;
  constraint?: string;
  detail?: string;
  message: string;
};

// A SQLSTATE: 5 chars, class first. Excludes Node errno codes ("ECONNRESET").
const SQLSTATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;

type ErrLike = {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
  message?: unknown;
  cause?: unknown;
};

export function pgErrorInfo(err: unknown): PgErrorInfo {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    const e = cur as ErrLike;
    if (typeof e.code === "string" && SQLSTATE.test(e.code)) {
      return {
        code: e.code,
        constraint: typeof e.constraint === "string" ? e.constraint : undefined,
        detail: typeof e.detail === "string" ? e.detail : undefined,
        message: typeof e.message === "string" ? e.message : String(cur),
      };
    }
    cur = typeof cur === "object" ? e.cause : undefined;
  }
  let inner: unknown = err;
  while (inner instanceof Error && inner.cause instanceof Error) inner = inner.cause;
  return { message: inner instanceof Error ? inner.message : String(inner) };
}

/** `stale` for an error raised by `skedul_assert(…, 'stale')`, else null. */
export function skedulCode(err: unknown): string | null {
  const info = pgErrorInfo(err);
  if (info.code !== "P0001") return null;
  const m = /skedul:([a-z_]+)/.exec(info.message);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/tsx --test src/lib/db/pg-error.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the harness**

Create `scripts/spike/db.ts`:

```ts
/**
 * Throwaway harness for the P1 spike. Talks ONLY to the Neon branch
 * `spike-batch` (SPIKE_DATABASE_URL in .env.spike.local) and refuses any
 * database without the marker table public.spike_marker.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";

config({ path: ".env.spike.local" });

const url = process.env.SPIKE_DATABASE_URL;
if (!url) throw new Error("SPIKE_DATABASE_URL is missing (.env.spike.local)");

export const client = neon(url);
export const db = drizzle({ client, schema });

export async function assertSpikeBranch(): Promise<void> {
  const rows = (await client.query(
    "select to_regclass('public.spike_marker')::text as marker",
  )) as { marker: string | null }[];
  if (!rows[0]?.marker) {
    throw new Error("Not the spike-batch branch (public.spike_marker missing): refusing to run.");
  }
}

const SCRATCH_DDL = [
  "create schema if not exists spike",
  "create table if not exists spike.parent (id text primary key, n int not null default 0, capacity int not null default 1, constraint parent_n_chk check (n between 0 and capacity))",
  "create table if not exists spike.child (id serial primary key, parent_id text not null)",
  "create table if not exists spike.ticket (id text primary key, status text not null)",
  "create table if not exists spike.movement (ticket_id text not null, action_id text not null, constraint movement_action_ticket_uq unique (action_id, ticket_id))",
  "create or replace function skedul_assert(ok boolean, code text) returns boolean language plpgsql as $$begin if ok is not true then raise exception using errcode = 'P0001', message = 'skedul:' || code; end if; return true; end$$",
];

/** Idempotent scratch schema `spike`, emptied before each check. */
export async function setupScratch(): Promise<void> {
  for (const stmt of SCRATCH_DDL) await client.query(stmt);
  await client.query("truncate spike.parent, spike.child, spike.ticket, spike.movement restart identity");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SpikeCheck = { id: string; title: string; run: () => Promise<string> };
export type CheckResult = { id: string; title: string; ok: boolean; detail: string; ms: number };

export async function runCheck(c: SpikeCheck): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const detail = await c.run();
    return { id: c.id, title: c.title, ok: true, detail, ms: Date.now() - t0 };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { id: c.id, title: c.title, ok: false, detail, ms: Date.now() - t0 };
  }
}
```

Create `scripts/spike/checks.ts`:

```ts
import type { SpikeCheck } from "./db";

/** Every spike check, in run order. Tasks 3–6 append to it. */
export const CHECKS: SpikeCheck[] = [];
```

Create `scripts/spike/run.ts`:

```ts
// Usage: ./node_modules/.bin/tsx scripts/spike/run.ts [S1 S4 …]  (no id = all)
import { assertSpikeBranch, runCheck, type CheckResult } from "./db";
import { CHECKS } from "./checks";

async function main() {
  await assertSpikeBranch();
  const wanted = process.argv.slice(2).map((s) => s.toUpperCase());
  const results: CheckResult[] = [];
  for (const c of CHECKS) {
    if (wanted.length && !wanted.some((w) => c.id === w || c.id.startsWith(w))) continue;
    results.push(await runCheck(c));
  }
  console.info("| Check | Résultat | Durée | Détail |");
  console.info("|---|---|---|---|");
  for (const r of results) {
    const detail = r.detail.replace(/\|/g, "/").replace(/\s+/g, " ");
    console.info(`| ${r.id} ${r.title} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms} ms | ${detail} |`);
  }
  if (results.length === 0) console.info("(no check selected)");
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 6: Check the guard on both sides**

1. Run: `./node_modules/.bin/tsx scripts/spike/run.ts`
   Expected: `(no check selected)`, exit 0. The guard passed, so the URL points at the spike branch.
2. Prove that the guard refuses a database without the marker, on the spike itself. Call `mcp__Neon__run_sql` with `branch_id: "<SPIKE_BRANCH_ID>"` and `"sql": "ALTER TABLE public.spike_marker RENAME TO spike_marker_off"`.
3. Run the runner again.
   Expected: `Not the spike-batch branch (public.spike_marker missing): refusing to run.`, exit 1.
4. Rename the table back: `ALTER TABLE public.spike_marker_off RENAME TO spike_marker`, again with `branch_id: "<SPIKE_BRANCH_ID>"`.

- [ ] **Step 7: Type check and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

```bash
git add src/lib/db/pg-error.ts src/lib/db/pg-error.test.ts scripts/spike/db.ts scripts/spike/checks.ts scripts/spike/run.ts
git commit -m "chore(spike): Postgres error helper and a guarded spike harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Batch semantics — S1, S4, S7

**Files:**
- Create: `scripts/spike/batch-checks.ts`
- Modify: `scripts/spike/checks.ts`

**Interfaces:**
- Consumes: `client`, `db`, `setupScratch`, `SpikeCheck` (Task 2); `pgErrorInfo`, `skedulCode` (`@/lib/db/pg-error`).
- Produces: `s1`, `s4`, `s7`, exported as `SpikeCheck` from `batch-checks.ts`.

- [ ] **Step 1: Write the checks**

Create `scripts/spike/batch-checks.ts`:

```ts
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { pgErrorInfo, skedulCode } from "@/lib/db/pg-error";

import { client, db, setupScratch, type SpikeCheck } from "./db";

async function count(text: string): Promise<number> {
  const rows = (await client.query(text)) as { c: number }[];
  return rows[0].c;
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  assert.fail("expected the statement to fail");
}

export const s1: SpikeCheck = {
  id: "S1",
  title: "a raising assert rolls back the whole batch",
  async run() {
    await setupScratch();
    const err = await failureOf(
      db.batch([
        db.execute(sql`insert into spike.parent (id) values ('p1')`),
        db.execute(sql`select skedul_assert(false, 'boom')`),
      ]),
    );
    assert.equal(pgErrorInfo(err).code, "P0001");
    assert.equal(skedulCode(err), "boom");
    assert.equal(await count("select count(*)::int as c from spike.parent where id = 'p1'"), 0);

    // Contrast: a guarded UPDATE that matches 0 rows does NOT abort a batch.
    await db.batch([
      db.execute(sql`update spike.parent set n = 1 where id = 'nope'`),
      db.execute(sql`insert into spike.parent (id) values ('p1b')`),
    ]);
    assert.equal(await count("select count(*)::int as c from spike.parent where id = 'p1b'"), 1);
    return "P0001 skedul:boom rolled back the insert; a 0-row UPDATE alone does not abort";
  },
};

export const s4: SpikeCheck = {
  id: "S4",
  title: "parameterised data-modifying CTE in a batch, aid-marked guard",
  async run() {
    await setupScratch();
    await client.query(
      "insert into spike.ticket (id, status) values ('t1','available'), ('t2','available'), ('t3','available')",
    );
    const ids = ["t1", "t2"];
    const act = (aid: string) =>
      db.batch([
        db.execute<{ ticket_id: string }>(sql`
          with u as (
            update spike.ticket set status = ${"booked"}
            where id = any(${sql.param(ids)}::text[]) and status = 'available'
            returning id
          )
          insert into spike.movement (ticket_id, action_id)
          select id, ${aid} from u
          returning ticket_id`),
        db.execute(sql`select skedul_assert(
          (select count(*) from spike.movement where action_id = ${aid}) = ${ids.length}, 'stale')`),
      ]);

    const [moved] = await act("aid-1");
    assert.deepEqual(moved.rows.map((r) => r.ticket_id).sort(), ids);

    // The same action replayed (double submit): its UPDATE matches 0 rows, so
    // its own movement count is 0 and the aid-marked assert raises `stale`.
    const err = await failureOf(act("aid-2"));
    assert.equal(skedulCode(err), "stale");
    assert.equal(await count("select count(*)::int as c from spike.movement"), 2);
    return "sql.param(array) binds one text[] param; RETURNING rows come back; replay raises stale";
  },
};

export const s7: SpikeCheck = {
  id: "S7",
  title: "SQLSTATE and constraint names reach the caller",
  async run() {
    await setupScratch();
    await client.query("insert into spike.parent (id, n, capacity) values ('p7', 1, 1)");
    await client.query("insert into spike.movement (ticket_id, action_id) values ('t1', 'a1')");

    const inBatchCheck = await failureOf(
      db.batch([db.execute(sql`update spike.parent set n = n + 1 where id = 'p7'`)]),
    );
    const a = pgErrorInfo(inBatchCheck);
    assert.equal(a.code, "23514");
    assert.equal(a.constraint, "parent_n_chk");

    const inBatchUnique = await failureOf(
      db.batch([db.execute(sql`insert into spike.movement (ticket_id, action_id) values ('t1', 'a1')`)]),
    );
    const b = pgErrorInfo(inBatchUnique);
    assert.equal(b.code, "23505");
    assert.equal(b.constraint, "movement_action_ticket_uq");

    const outside = await failureOf(db.execute(sql`update spike.parent set n = n + 1 where id = 'p7'`));
    const c = pgErrorInfo(outside);
    assert.equal(c.code, "23514");
    assert.equal(c.constraint, "parent_n_chk");

    const shape = (e: unknown) =>
      `${(e as Error).constructor?.name}${(e as Error).cause ? "+cause" : ""}`;
    return `in batch: ${shape(inBatchCheck)}; outside: ${shape(outside)}`;
  },
};
```

- [ ] **Step 2: Register them**

In `scripts/spike/checks.ts`, add `import { s1, s4, s7 } from "./batch-checks";` and change the array to `[s1, s4, s7]`.

- [ ] **Step 3: Run against the spike branch**

Run: `./node_modules/.bin/tsx scripts/spike/run.ts S1 S4 S7`
Expected: three PASS rows. Copy the printed table into the ledger.

A FAIL is a finding. Re-run once. If it still fails, record a `Ruling:` in the ledger:
- **S1 fail** means plan B (plpgsql functions) is needed for P2.
- **S4 fail on arrays** means a different array binding in every P2 set statement, e.g. `string_to_array(${ids.join(",")}, ',')`.
- **S7 fail** means `mapDbError` must parse messages instead.

- [ ] **Step 4: Type check and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

```bash
git add scripts/spike/batch-checks.ts scripts/spike/checks.ts
git commit -m "chore(spike): S1 rollback, S4 CTE + aid guard, S7 error metadata

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Locks across concurrent batches — S2, S3

**Files:**
- Modify: `scripts/spike/batch-checks.ts`
- Modify: `scripts/spike/checks.ts`

**Interfaces:**
- Consumes: `client`, `db`, `setupScratch`, `sleep` (Task 2).
- Produces: `s2`, `s3`.

- [ ] **Step 1: Write the checks**

Append to `scripts/spike/batch-checks.ts`. First extend the `./db` import to `import { client, db, setupScratch, sleep, type SpikeCheck } from "./db";`, then add:

```ts
export const s2: SpikeCheck = {
  id: "S2",
  title: "a statement after a lock wait sees rows committed during the wait",
  async run() {
    await setupScratch();
    await client.query("insert into spike.parent (id) values ('p2')");
    const t0 = Date.now();
    const holder = db.batch([
      db.execute(sql`select id from spike.parent where id = 'p2' for update`),
      db.execute(sql`select pg_sleep(2)`),
    ]);
    await sleep(300);
    const waiter = db.batch([
      db.execute(sql`select id from spike.parent where id = 'p2' for update`),
      db.execute<{ c: number }>(sql`select count(*)::int as c from spike.child where parent_id = 'p2'`),
    ]);
    await sleep(300);
    const tInsert = Date.now();
    await client.query("insert into spike.child (parent_id) values ('p2')"); // autocommit, no lock needed
    const insertMs = Date.now() - tInsert;
    const [, waited] = await Promise.all([holder, waiter]);
    const totalMs = Date.now() - t0;
    const seen = waited[1].rows[0].c;
    assert.ok(insertMs < 1500, `the concurrent insert should not queue behind the batches (${insertMs} ms)`);
    assert.ok(totalMs >= 1800, `the waiter should have blocked on the holder's lock (${totalMs} ms)`);
    assert.equal(seen, 1, "statement 2 of the waiter must see the row committed while it waited");
    return `waiter blocked ~${totalMs} ms, saw ${seen} row committed mid-wait (insert ${insertMs} ms)`;
  },
};

export const s3: SpikeCheck = {
  id: "S3",
  title: "FOR UPDATE SKIP LOCKED inside a batch",
  async run() {
    await setupScratch();
    await client.query("insert into spike.ticket (id, status) values ('t1','available'), ('t2','available')");
    const holder = db.batch([
      db.execute(sql`select id from spike.ticket where id = 't1' for update`),
      db.execute(sql`select pg_sleep(2)`),
    ]);
    await sleep(300);
    const t0 = Date.now();
    const [picked] = await db.batch([
      db.execute<{ id: string }>(sql`
        select id from spike.ticket where status = 'available'
        order by id limit 1 for update skip locked`),
    ]);
    const ms = Date.now() - t0;
    await holder;
    assert.equal(picked.rows[0]?.id, "t2");
    assert.ok(ms < 1500, `SKIP LOCKED must not wait for the holder (${ms} ms)`);
    return `picked t2 in ${ms} ms while t1 was locked`;
  },
};
```

- [ ] **Step 2: Register them**

In `scripts/spike/checks.ts`, import `s2, s3` too and make the array `[s1, s2, s3, s4, s7]`.

- [ ] **Step 3: Run against the spike branch**

Run: `./node_modules/.bin/tsx scripts/spike/run.ts S2 S3`
Expected: two PASS rows. Copy them into the ledger.

A FAIL is a finding. Re-run once. If it still fails, record a `Ruling:`:
- **S2 fail** means fan-out writes cannot rely on "lock, then re-read". P2 must use plan B for E6b/E6c/E7/E11.
- **S3 fail** means ticket picking needs `ORDER BY … FOR UPDATE` without SKIP LOCKED, and the T2 race accepts a `no_ticket` retry.

- [ ] **Step 4: Commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

```bash
git add scripts/spike/batch-checks.ts scripts/spike/checks.ts
git commit -m "chore(spike): S2 lock-wait visibility, S3 SKIP LOCKED

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Schema objects — S5 EXCLUDE, S6 FK ordering

**Files:**
- Modify: `scripts/spike/batch-checks.ts`
- Modify: `scripts/spike/checks.ts`

**Interfaces:**
- Consumes: `client`, `db`, `pgErrorInfo` (earlier tasks).
- Produces: `s5`, `s6`.

- [ ] **Step 1: Write the checks**

Append to `scripts/spike/batch-checks.ts`:

```ts
export const s5: SpikeCheck = {
  id: "S5",
  title: "btree_gist + partial EXCLUDE on (pro, tstzrange)",
  async run() {
    await client.query("create extension if not exists btree_gist");
    await client.query(
      "create table if not exists spike.rdv (id text primary key, pro text not null, s timestamptz not null, e timestamptz not null, status text not null default 'scheduled', constraint rdv_excl exclude using gist (pro with =, tstzrange(s, e) with &&) where (status = 'scheduled'))",
    );
    await client.query("truncate spike.rdv");
    await client.query("insert into spike.rdv (id, pro, s, e) values ('r1','pro1','2026-11-02T09:00Z','2026-11-02T10:00Z')");

    const err = await failureOf(
      db.batch([
        db.execute(sql`insert into spike.rdv (id, pro, s, e) values ('r2','pro1','2026-11-02T09:30Z','2026-11-02T10:30Z')`),
      ]),
    );
    const info = pgErrorInfo(err);
    assert.equal(info.code, "23P01");
    assert.equal(info.constraint, "rdv_excl");

    // allowed: another pro; back-to-back ([) ranges); a cancelled row no longer blocks
    await client.query("insert into spike.rdv (id, pro, s, e) values ('r3','pro2','2026-11-02T09:30Z','2026-11-02T10:30Z')");
    await client.query("insert into spike.rdv (id, pro, s, e) values ('r4','pro1','2026-11-02T10:00Z','2026-11-02T11:00Z')");
    await client.query("update spike.rdv set status = 'cancelled' where id = 'r1'");
    await client.query("insert into spike.rdv (id, pro, s, e) values ('r5','pro1','2026-11-02T09:00Z','2026-11-02T09:30Z')");
    return "23P01 rdv_excl on overlap; other pro, back-to-back and cancelled rows allowed";
  },
};

async function fkScenario(innerAction: "no action" | "restrict", innerFirst: boolean): Promise<string> {
  for (const stmt of [
    "drop table if exists spike.v_bk, spike.v_occ, spike.v_pro, spike.v_u cascade",
    "create table spike.v_u (id text primary key)",
    "create table spike.v_pro (id text primary key, u_id text not null)",
    "create table spike.v_occ (id text primary key, pro_id text not null)",
    "create table spike.v_bk (id text primary key, pro_id text not null, occ_id text not null)",
  ]) await client.query(stmt);
  const inner = `alter table spike.v_bk add constraint v_bk_occ_fk foreign key (occ_id) references spike.v_occ(id) on delete ${innerAction}`;
  const cascades = [
    "alter table spike.v_pro add constraint v_pro_u_fk foreign key (u_id) references spike.v_u(id) on delete cascade",
    "alter table spike.v_occ add constraint v_occ_pro_fk foreign key (pro_id) references spike.v_pro(id) on delete cascade",
    "alter table spike.v_bk add constraint v_bk_pro_fk foreign key (pro_id) references spike.v_pro(id) on delete cascade",
  ];
  for (const stmt of innerFirst ? [inner, ...cascades] : [...cascades, inner]) await client.query(stmt);
  await client.query("insert into spike.v_u values ('u1')");
  await client.query("insert into spike.v_pro values ('pro1','u1')");
  await client.query("insert into spike.v_occ values ('occ1','pro1')");
  await client.query("insert into spike.v_bk values ('bk1','pro1','occ1')");
  try {
    await client.query("delete from spike.v_u where id = 'u1'");
  } catch (err) {
    return `delete failed: ${pgErrorInfo(err).code}`;
  }
  const left = await count("select ((select count(*) from spike.v_pro) + (select count(*) from spike.v_occ) + (select count(*) from spike.v_bk))::int as c");
  return left === 0 ? "ok" : `ok but ${left} rows left`;
}

export const s6: SpikeCheck = {
  id: "S6",
  title: "NO ACTION FKs survive the deleteUser cascade",
  async run() {
    const after = await fkScenario("no action", false);
    const before = await fkScenario("no action", true);
    const restrictBefore = await fkScenario("restrict", true);
    assert.equal(after, "ok", "NO ACTION created after the cascades");
    assert.equal(before, "ok", "NO ACTION created before the cascades");

    // NO ACTION still protects history on a direct delete.
    await fkScenario("no action", false);
    await client.query("insert into spike.v_u values ('u2')");
    await client.query("insert into spike.v_pro values ('pro2','u2')");
    await client.query("insert into spike.v_occ values ('occ2','pro2')");
    await client.query("insert into spike.v_bk values ('bk2','pro2','occ2')");
    const direct = await failureOf(client.query("delete from spike.v_occ where id = 'occ2'"));
    assert.equal(pgErrorInfo(direct).code, "23503");
    return `no action after/before: ok/ok; restrict-before: ${restrictBefore}; direct delete: 23503`;
  },
};
```

- [ ] **Step 2: Register them**

In `scripts/spike/checks.ts`, import `s5, s6` and make the array `[s1, s2, s3, s4, s5, s6, s7]`.

- [ ] **Step 3: Run against the spike branch**

Run: `./node_modules/.bin/tsx scripts/spike/run.ts S5 S6`
Expected: two PASS rows. The S6 detail also records how `restrict` behaves when it is created first; this documents spec rule R1. Copy the rows into the ledger.

A FAIL is a finding. Record a `Ruling:`:
- **S5 fail** means RDV double-booking must be prevented by a pro-row lock (`professional` `FOR UPDATE` in E4) instead of the EXCLUDE.
- **S6 fail** means the domain FKs must use `ON DELETE CASCADE` towards the occurrence, and archive-only deletes are enforced in code.

- [ ] **Step 4: Commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.

```bash
git add scripts/spike/batch-checks.ts scripts/spike/checks.ts
git commit -m "chore(spike): S5 EXCLUDE with btree_gist, S6 FK actions under cascade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Better Auth e-mail codes and the takeover hook — S8

**Files:**
- Create: `scripts/spike/auth-checks.ts`
- Modify: `scripts/spike/checks.ts`

**Interfaces:**
- Consumes: `db` (Task 2, drizzle on the spike branch, app schema). On that branch the Better Auth tables exist, with `development`'s data.
- Produces: `s8a` … `s8e`.

- [ ] **Step 1: Write the auth instance and the checks**

Create `scripts/spike/auth-checks.ts`:

```ts
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";

import * as schema from "@/lib/db/schema";

import { db, type SpikeCheck } from "./db";

const BASE = "http://localhost:3000"; // nothing listens; http => cookies without __Secure-
const RUN = Date.now().toString(36); // unique e-mails per run: the branch keeps its users
const mail = (who: string) => `spike-${who}-${RUN}@skedul.test`;

const sent: { email: string; otp: string; type: string }[] = [];
const hookCalls: { path: string | undefined; emailVerified: boolean; newSessionId: string | null }[] = [];
const capped = new Set<string>();

const spikeAuth = betterAuth({
  appName: "Skedul spike",
  baseURL: BASE,
  secret: "spike-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
  // With overrideDefaultEmailVerification the plugin's own sendVerificationOnSignUp
  // is inert; the sign-up code comes from core sendOnSignUp (S8a checks this).
  emailVerification: { sendOnSignUp: true },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } }, // as in src/lib/auth.ts
  rateLimit: { enabled: false },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/email-otp/send-verification-otp") return;
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase();
      if (capped.has(email)) return ctx.json({ success: true }); // handler (and code generation) never runs
    }),
  },
  databaseHooks: {
    user: {
      update: {
        after: async (user, ctx) => {
          const newSessionId = ctx?.context.newSession?.session.id ?? null;
          hookCalls.push({ path: ctx?.path, emailVerified: user.emailVerified, newSessionId });
          if (ctx?.path !== "/sign-in/email-otp" || !user.emailVerified) return;
          try {
            const credential = and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential"));
            const found = await db.select({ id: schema.account.id }).from(schema.account).where(credential);
            if (found.length === 0) return;
            await db.delete(schema.account).where(credential);
            await db
              .delete(schema.session)
              .where(
                newSessionId
                  ? and(eq(schema.session.userId, user.id), ne(schema.session.id, newSessionId))
                  : eq(schema.session.userId, user.id),
              );
          } catch (err) {
            console.error("[spike] takeover purge failed", err);
          }
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: "encrypted",
      resendStrategy: "reuse",
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        sent.push({ email, otp, type });
      },
    }),
  ],
});

/** One cookie jar = one browser; calls go through auth.handler like real HTTP. */
function browser() {
  const jar = new Map<string, string>();
  return async function call(path: string, body?: unknown) {
    const method = body === undefined ? "GET" : "POST";
    const headers = new Headers({ origin: BASE, "x-forwarded-for": "203.0.113.7" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await spikeAuth.handler(
      new Request(`${BASE}/api/auth${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown> | null) : null };
  };
}

const lastCode = (email: string, type: string) =>
  [...sent].reverse().find((s) => s.email === email && s.type === type)?.otp;

async function userRow(email: string) {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  return u;
}

async function credentialCount(userId: string) {
  const rows = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")));
  return rows.length;
}

export const s8a: SpikeCheck = {
  id: "S8a",
  title: "password sign-up sends an e-mail-verification CODE (no link)",
  async run() {
    const email = mail("a");
    const res = await browser()("/sign-up/email", { email, password: "password123", name: "Spike A" });
    assert.equal(res.status, 200);
    const codes = sent.filter((s) => s.email === email);
    assert.equal(codes.length, 1, `expected exactly one code, got ${JSON.stringify(codes.map((c) => c.type))}`);
    assert.equal(codes[0].type, "email-verification");
    return "one email-verification code sent on sign-up";
  },
};

export const s8b: SpikeCheck = {
  id: "S8b",
  title: "a logged-in user verifies by code and keeps the password",
  async run() {
    const email = mail("b");
    const call = browser();
    assert.equal((await call("/sign-up/email", { email, password: "password123", name: "Spike B" })).status, 200);
    const otp = lastCode(email, "email-verification");
    assert.ok(otp, "no verification code captured");
    assert.equal((await call("/email-otp/verify-email", { email, otp })).status, 200);
    const u = await userRow(email);
    assert.equal(u.emailVerified, true);
    assert.equal(await credentialCount(u.id), 1, "the password must survive a verify-email");
    const session = await call("/get-session?disableCookieCache=true");
    assert.equal((session.json as { user?: { email?: string } } | null)?.user?.email, email);
    const hook = hookCalls.at(-1);
    return `verified; credential kept; hook path=${hook?.path}`;
  },
};

export const s8c: SpikeCheck = {
  id: "S8c",
  title: "OTP sign-in on an unverified password account purges it (takeover fix)",
  async run() {
    const email = mail("victim");
    const attacker = browser();
    assert.equal((await attacker("/sign-up/email", { email, password: "password123", name: "Attacker" })).status, 200);
    const victim = browser();
    assert.equal((await victim("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    const otp = lastCode(email, "sign-in");
    assert.ok(otp, "no sign-in code captured");
    assert.equal((await victim("/sign-in/email-otp", { email, otp })).status, 200);

    const hook = [...hookCalls].reverse().find((h) => h.path === "/sign-in/email-otp");
    assert.ok(hook, "user.update.after did not run for /sign-in/email-otp");
    assert.ok(hook.newSessionId, "ctx.context.newSession was not set when the hook ran");

    const u = await userRow(email);
    assert.equal(u.emailVerified, true);
    assert.equal(await credentialCount(u.id), 0, "the attacker's password must be gone");

    const attackerFresh = await attacker("/get-session?disableCookieCache=true");
    assert.equal(attackerFresh.json, null, "the attacker's session must be revoked");
    const victimFresh = await victim("/get-session?disableCookieCache=true");
    assert.equal((victimFresh.json as { user?: { email?: string } } | null)?.user?.email, email);

    const attackerCached = await attacker("/get-session");
    const cachedStillLoggedIn = attackerCached.json !== null;
    return `purged; victim session kept; attacker with cookie cache: ${cachedStillLoggedIn ? "STILL logged in (cache)" : "logged out"}`;
  },
};

export const s8d: SpikeCheck = {
  id: "S8d",
  title: "resend within expiry sends the SAME code (encrypted + reuse)",
  async run() {
    const email = mail("reuse");
    const call = browser();
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const first = lastCode(email, "sign-in");
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const second = lastCode(email, "sign-in");
    assert.ok(first && second);
    assert.equal(second, first);
    return "second send reused the first code";
  },
};

export const s8e: SpikeCheck = {
  id: "S8e",
  title: "a before-hook cap short-circuits without invalidating the live code",
  async run() {
    const email = mail("cap");
    const call = browser();
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const live = lastCode(email, "sign-in");
    assert.ok(live);
    const before = sent.length;
    capped.add(email);
    const blocked = await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    capped.delete(email);
    assert.equal(blocked.status, 200);
    assert.deepEqual(blocked.json, { success: true });
    assert.equal(sent.length, before, "no e-mail may be sent past the cap");
    assert.equal((await call("/sign-in/email-otp", { email, otp: live })).status, 200, "the live code must still work");
    return "capped send answered 200 {success:true}, nothing sent, live code still valid";
  },
};
```

- [ ] **Step 2: Register them**

In `scripts/spike/checks.ts`, add `import { s8a, s8b, s8c, s8d, s8e } from "./auth-checks";` and append them: `[s1, s2, s3, s4, s5, s6, s7, s8a, s8b, s8c, s8d, s8e]`.

- [ ] **Step 3: Type check, then run against the spike branch**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error. If `ctx.context.newSession` or `ctx.body` is typed differently in 1.6.19, adjust only the type access (for example with an `as` cast on the read), not the behaviour, and record a `Ruling:`.

Run: `./node_modules/.bin/tsx scripts/spike/run.ts S8`
Expected: five PASS rows. Copy them into the ledger, including S8c's note on the cookie cache.

A FAIL is a finding. Re-run once, then record a `Ruling:` with its spec consequence:
- **S8a**: sign-up sends nothing, or sends a link. The § 12 emailOTP options must change to the combination that sends exactly one code.
- **S8c, no `newSession`**: the hook cannot spare the new session. The purge moves to a `hooks.after` on `/sign-in/email-otp`, which reads `ctx.context.newSession` after `setSessionCookie`.
- **S8d**: the code is not reused. `resendStrategy` cannot be relied on, and the UI must say « le dernier code reçu est le seul valable ».
- **S8e**: the code is invalidated by a short-circuited send. The cap moves before the endpoint in another way.

- [ ] **Step 4: Commit**

```bash
git add scripts/spike/auth-checks.ts scripts/spike/checks.ts
git commit -m "chore(spike): S8 Better Auth e-mail codes and takeover purge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verdict in the spec, owner's go to delete the branch

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md` (§ 10 and, if S8 says so, § 12)

**Interfaces:**
- Consumes: the ledger rows from Tasks 3–6.

- [ ] **Step 1: Full run**

Run: `./node_modules/.bin/tsx scripts/spike/run.ts`
Expected: 12 rows (S1–S7, S8a–S8e). Keep the table.

- [ ] **Step 2: Write the verdict into the spec**

At the end of § 10 (after « Fragments partagés »), add a subsection `### Résultat du spike P1 (<date>)` containing:
- the run table from Step 1, verbatim;
- the line « **Verdict : GO** — le mécanisme `atomic()` est retenu tel quel » when S1–S7 all pass. Otherwise write « **Verdict : plan B pour <parcours> — <raison>** », one line per failed check, using the consequences listed in Tasks 3–5;
- one line per auth finding.

In § 12, under « Plugin `emailOTP` », make the options match what S8a actually needed. If S8a passed with the harness configuration, the options are `emailVerification: { sendOnSignUp: true }` **plus** the plugin options, and `sendVerificationOnSignUp` is noted as inert with `overrideDefaultEmailVerification`. If S8c showed that the cached `get-session` still reports the attacker as logged in, add to § 12 « Autorisation du portefeuille » that this is the reason `requireWalletOwner` reads without cache. The spec already says so; cite the observation.

- [ ] **Step 3: Checks and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no error.
Run: `./node_modules/.bin/tsx --test`
Expected: all pass. This includes `pg-error.test.ts`; the spike scripts are not tests.

```bash
git add docs/superpowers/specs/2026-10-12-tickets-evenements-design.md
git commit -m "docs(spec): P1 spike verdict

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Ask the owner before deleting the Neon branch**

Ask in chat: « Spike terminé (verdict : … ). Je supprime la branche Neon `spike-batch` (<SPIKE_BRANCH_ID>) ? » Wait for an explicit yes.

After the yes:
1. Call `mcp__Neon__list_branches` with `{ "project_id": "nameless-meadow-98376303", "search": "spike-batch" }` and confirm the id. It must not be `br-misty-thunder-af8c8bd9`, `br-bold-art-af8tpfm5` or `br-autumn-tooth-afnthws9`.
2. Call `mcp__Neon__delete_branch` with `{ "project_id": "nameless-meadow-98376303", "branch_id": "<SPIKE_BRANCH_ID>" }`.
3. Delete the local `.env.spike.local`.

The `scripts/spike/` files stay in the branch as a record. P2 reuses `src/lib/db/pg-error.ts`.
