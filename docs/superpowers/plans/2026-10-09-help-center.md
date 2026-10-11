# Centre d'aide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public help center (`/aide`: FAQ editable from the admin) and support requests with a message thread, a step progress bar (3 steps, or 6 once accepted for development), e-mails, private screenshots, and the matching admin screens (inbox, kanban, FAQ editor).

**Architecture:** Native to Skedul. Pure rules in `src/lib/support.ts` (client-safe, unit-tested, also the source of the DB enums). Five new Drizzle tables (migration 0008) plus a content migration (0009) for the starter FAQ. Server code split by role: `support-core.ts` (server-only shared writes, Blob, e-mail fan-out), `support-queries.ts` (reads), `support.ts` (user actions), `support-admin.ts` (admin actions). Pages under `/aide` (public, light-locked, landing header/footer) and `/admin/support`.

**Tech Stack:** Next.js 16 App Router (async `params`/`searchParams`), React 19, Drizzle + Neon HTTP (no interactive transactions), Better Auth, Vercel Blob `@vercel/blob` 2.4 (`access: "private"`), Resend via `sendEmail`, Tailwind v4, lucide-react 1.21, `node:test` through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-09-help-center-design.md`

## Global Constraints

- Work in the worktree `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\help-center` on branch `feat/help-center`. Its `node_modules` is a **junction** to the main checkout: never run `pnpm install`, and call binaries directly (`./node_modules/.bin/tsx`, `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`, `./node_modules/.bin/next`, `./node_modules/.bin/drizzle-kit`) — plain `pnpm <script>` triggers pnpm 11's deps check, which may try to purge the shared `node_modules`.
- Next.js 16: `params` and `searchParams` are Promises (`await params`). Read `node_modules/next/dist/docs/` before using an API you are unsure of.
- Neon HTTP driver: no interactive transactions. Each write is its own statement; follow the write orders given in each task.
- Authorization: user actions check the session owner; admin actions call `getAdminUser()` (re-reads the role from the DB). Never trust `session.user.role` for admin checks.
- Every user action refuses to write while `session.session.impersonatedBy` is set.
- New tables cascade from `user` (or SET NULL), so `deleteUser`'s single `DELETE FROM "user"` keeps working.
- Copy: French, **"vous"** (the app's register; the spec's "tu" examples are superseded), no em dash (`—`) or en dash (`–`) in any visible string, sentence case, verb-first button labels, the request CTA is always labelled **"Créer une demande"**.
- Shape rule for `/aide` pages: interactive buttons are full pills (`ctaPrimary`/`ctaSecondary`/`navPrimary`/`navQuiet` from `src/components/landing/cta.ts`), inputs `rounded-xl`, cards `rounded-2xl`. Admin pages keep the app's default primitives.
- `/aide` is light-locked (the app primitives are light-only): `src/app/aide/help.module.css` copies the landing's light `--lp-*` tokens; no dark-mode block.
- Icons: `lucide-react` only (already a dependency). Use `MessageCircleQuestionMark` (not `MessageCircleQuestion`, absent in 1.21).
- Limits (from the spec, in `src/lib/support.ts`): `MAX_REQUESTS_PER_DAY = 5`, `MAX_MESSAGES_PER_DAY = 30`, `MAX_SUBJECT = 140`, `MAX_BODY = 20_000`, `MAX_ATTACHMENTS = 3`, `MAX_ATTACHMENT_BYTES = 5_000_000`, types png/jpeg/webp.
- Blob pathnames: `support/<requesterUserId>/<nanoid>.<ext>`, `access: "private"`, served only through `GET /api/support/attachments/[id]`.
- Support images live in a **dedicated private Blob store** (`skedul-support`, created 2026-10-11, connected to production/preview/development with prefix `SUPPORT_BLOB`). Code reads `env.SUPPORT_BLOB_READ_WRITE_TOKEN` / `env.SUPPORT_BLOB_ENABLED`, never the public store's `BLOB_READ_WRITE_TOKEN` (branding images). The token is already in the worktree's `.env.local`.
- Server action body limit: `experimental.serverActions.bodySizeLimit = "16mb"` in `next.config.ts`.
- Next 16.2 router: after `await serverAction()`, use `router.push(...)` **or** `router.refresh()`, never both in a row. Do not call `redirect()` from these actions; return `{ ok, ... }` and navigate on the client.
- SWC JSX trap: a JSX text node containing an HTML entity (`&apos;`) and a line break loses its leading space. Write apostrophes as `’` or keep such text on one line / in a JS string.
- Commit after each task with a Conventional Commit message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks that must stay green: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint`, `./node_modules/.bin/tsx --test`, `./node_modules/.bin/next build`.

## File map

| File | Responsibility |
|---|---|
| `src/lib/support.ts` (+ `.test.ts`) | Vocabulary, labels, limits, track steps and transitions, inbox filters, attachment checks, ETA, FAQ search, answer parser |
| `src/lib/safe-next.ts` (+ `.test.ts`) | Validates the `?next=` redirect target |
| `src/lib/email-layout.ts` | `layout()` + `escapeHtml()` moved out of `email.ts` (pure, testable) |
| `src/lib/support-emails.ts` (+ `.test.ts`) | The 5 support e-mail templates |
| `src/lib/db/schema.ts` | 6 enums + 5 tables |
| `drizzle/0008_help_center.sql`, `drizzle/0009_help_faq_seed.sql` | Schema migration, starter FAQ content |
| `src/server/support-core.ts` | server-only: rate counts, message insert, Blob store/delete, read marks, admin e-mail fan-out |
| `src/server/support-queries.ts` | server-only reads for users and admins |
| `src/server/support.ts` | User Server Actions |
| `src/server/support-admin.ts` | Admin Server Actions (requests + FAQ) |
| `src/app/api/support/attachments/[id]/route.ts` | Streams a private image to its owner or an admin |
| `src/components/support/*` | Shared UI: progress, type chip, thread, composer, image input, FAQ answer/browser, request card, new-request form |
| `src/components/admin/support-*.tsx` | Admin UI: tabs, inbox row, panel, kanban card, FAQ editor |
| `src/app/aide/**` | Public help center and user request pages |
| `src/app/admin/support/**` | Admin inbox, detail, kanban, FAQ |

---

### Task 1: Preflight checks (private Blob, `aide` slug)

Nothing is committed in this task. If a check fails, **stop and ask the user** (the spec makes both blocking).

**Files:**
- Create (temporary, deleted at the end): `scripts/probe-private-blob.ts`

- [ ] **Step 1: Write the probe script**

```ts
import "./load-env";

import { del, get, put } from "@vercel/blob";

/** One-off check: does the configured Blob store accept private blobs? */
async function main() {
  const token = process.env.SUPPORT_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("SUPPORT_BLOB_READ_WRITE_TOKEN is not set");
  const blob = await put(`support/_probe/${Date.now()}.txt`, "probe", {
    access: "private",
    token,
    contentType: "text/plain",
  });
  console.info("put ok:", blob.pathname);
  const res = await get(blob.pathname, { access: "private", token });
  console.info("get status:", res?.statusCode);
  await del(blob.url, { token });
  console.info("deleted");
}

main().catch((err) => {
  console.error("PROBE FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `./node_modules/.bin/tsx scripts/probe-private-blob.ts`
Expected:
```
put ok: support/_probe/<digits>.txt
get status: 200
deleted
```
If it prints `PROBE FAILED` (e.g. the store refuses private access): stop, report the error to the user, and wait (a private store means a new env var).

- [ ] **Step 3: Delete the probe**

Run: `rm scripts/probe-private-blob.ts && git status --short`
Expected: no output (clean tree).

- [ ] **Step 4: Check that no pro owns the slug `aide`**

With the Neon MCP `run_sql` tool (project `nameless-meadow-98376303`), run the same read-only query on the development branch `br-bold-art-af8tpfm5` and on the production branch `br-misty-thunder-af8c8bd9`:

```sql
SELECT id, slug FROM professional WHERE slug = 'aide';
```

Expected: 0 rows on both. If a row exists: stop and ask the user (that pro's public page would be shadowed by `/aide`).

---

### Task 2: Pure support rules (`src/lib/support.ts`)

**Files:**
- Create: `src/lib/support.ts`
- Test: `src/lib/support.test.ts`

**Interfaces:**
- Produces (used by every later task): the `SUPPORT_*` arrays and their types (`SupportType`, `SupportTrack`, `SupportStage`, `SupportResolution`, `SupportAuthorRole`, `SupportMessageKind`), `HELP_ICONS`/`HelpIcon`/`isHelpIcon`, `TYPE_LABELS`, `TYPE_HINTS`, `STAGE_LABELS`, `RESOLUTION_LABELS`, the limits, `ATTACHMENT_EXTENSIONS`/`AttachmentType`, `TRACK_STEPS`, `RequestState`, `stepIndex`, `stepCount`, `progressRatio`, `isFinalStage`, `isOpen`, `statusLabel`, `canSetStage`, `canAcceptForDevelopment`, `canUserReply`, `stageAfterUserReply`, `stageAfterAdminReply`, `stageReachedAt`, `moveInList`, `INBOX_FILTERS`/`InboxFilter`/`INBOX_FILTER_LABELS`/`parseInboxFilter`, `parseSupportType`, `INBOX_PAGE_SIZE`, `checkAttachments`, `isValidEta`, `formatEta`, `normalizeSearch`, `matchArticles`, `AnswerSegment`/`AnswerBlock`/`parseAnswer`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/support.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_STEPS,
  canAcceptForDevelopment,
  canSetStage,
  canUserReply,
  checkAttachments,
  formatEta,
  isOpen,
  isValidEta,
  matchArticles,
  moveInList,
  normalizeSearch,
  parseAnswer,
  parseInboxFilter,
  parseSupportType,
  progressRatio,
  stageAfterAdminReply,
  stageAfterUserReply,
  stageReachedAt,
  statusLabel,
  stepCount,
  stepIndex,
  type RequestState,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
} from "./support";

const req = (
  track: SupportTrack,
  stage: SupportStage,
  resolution: SupportResolution | null = null,
): RequestState => ({ track, stage, resolution });

test("each track lists its steps in order", () => {
  assert.deepEqual(TRACK_STEPS.support, ["received", "in_progress", "resolved"]);
  assert.deepEqual(TRACK_STEPS.development, [
    "received",
    "accepted",
    "planned",
    "in_development",
    "testing",
    "delivered",
  ]);
});

test("stepIndex and progressRatio place a stage on its track", () => {
  assert.equal(stepIndex("development", "in_development"), 3);
  assert.equal(stepCount("development"), 6);
  assert.equal(stepCount("support"), 3);
  assert.equal(progressRatio("development", "in_development"), 0.6);
  assert.equal(progressRatio("support", "received"), 0);
  assert.equal(progressRatio("support", "resolved"), 1);
});

test("canSetStage only accepts steps of the current track", () => {
  assert.equal(canSetStage("development", "testing"), true);
  assert.equal(canSetStage("development", "accepted"), true);
  assert.equal(canSetStage("support", "received"), true);
  assert.equal(canSetStage("development", "in_progress"), false);
  assert.equal(canSetStage("support", "planned"), false);
});

test("a development request never goes back to received", () => {
  // the kanban has no "Reçue" column: accepted is the floor of that track
  assert.equal(canSetStage("development", "received"), false);
});

test("moveInList swaps an id with its neighbour", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInList(["a", "b", "c"], "b", "down"), ["a", "c", "b"]);
  assert.equal(moveInList(["a", "b", "c"], "a", "up"), null);
  assert.equal(moveInList(["a", "b", "c"], "c", "down"), null);
  assert.equal(moveInList(["a", "b", "c"], "x", "up"), null);
});

test("isOpen is false once resolved, delivered, declined or closed", () => {
  assert.equal(isOpen(req("support", "in_progress")), true);
  assert.equal(isOpen(req("development", "testing")), true);
  assert.equal(isOpen(req("support", "resolved")), false);
  assert.equal(isOpen(req("development", "delivered")), false);
  assert.equal(isOpen(req("development", "testing", "declined")), false);
  assert.equal(isOpen(req("support", "received", "closed")), false);
});

test("statusLabel prefers the resolution over the stage", () => {
  assert.equal(statusLabel(req("development", "planned")), "Planifiée");
  assert.equal(statusLabel(req("development", "planned", "declined")), "Non retenue");
  assert.equal(statusLabel(req("support", "received", "closed")), "Fermée");
});

test("canAcceptForDevelopment needs a live support request", () => {
  assert.equal(canAcceptForDevelopment(req("support", "received")), true);
  assert.equal(canAcceptForDevelopment(req("support", "in_progress")), true);
  assert.equal(canAcceptForDevelopment(req("support", "resolved")), false);
  assert.equal(canAcceptForDevelopment(req("support", "in_progress", "declined")), false);
  assert.equal(canAcceptForDevelopment(req("development", "accepted")), false);
});

test("canUserReply is false only on a closed request", () => {
  assert.equal(canUserReply(req("support", "resolved")), true);
  assert.equal(canUserReply(req("development", "testing", "declined")), true);
  assert.equal(canUserReply(req("support", "in_progress", "closed")), false);
});

test("a user reply reopens a resolved support request only", () => {
  assert.equal(stageAfterUserReply(req("support", "resolved")), "in_progress");
  assert.equal(stageAfterUserReply(req("support", "received")), "received");
  assert.equal(stageAfterUserReply(req("development", "delivered")), "delivered");
  assert.equal(stageAfterUserReply(req("support", "resolved", "declined")), "resolved");
});

test("the first admin reply moves a received support request forward", () => {
  assert.equal(stageAfterAdminReply(req("support", "received")), "in_progress");
  assert.equal(stageAfterAdminReply(req("support", "resolved")), "resolved");
  assert.equal(stageAfterAdminReply(req("development", "accepted")), "accepted");
  assert.equal(stageAfterAdminReply(req("support", "received", "closed")), "received");
});

test("stageReachedAt keeps the latest time each step was entered", () => {
  const created = new Date("2026-10-01T10:00:00Z");
  const day = (d: number) => new Date(`2026-10-0${d}T10:00:00Z`);
  const reached = stageReachedAt(created, [
    { kind: "message", stage: null, createdAt: day(2) },
    { kind: "stage_change", stage: "accepted", createdAt: day(3) },
    { kind: "stage_change", stage: "testing", createdAt: day(4) },
    { kind: "stage_change", stage: "in_development", createdAt: day(5) },
    { kind: "stage_change", stage: "testing", createdAt: day(6) },
  ]);
  assert.equal(reached.received?.toISOString(), created.toISOString());
  assert.equal(reached.accepted?.toISOString(), day(3).toISOString());
  assert.equal(reached.in_development?.toISOString(), day(5).toISOString());
  assert.equal(reached.testing?.toISOString(), day(6).toISOString());
  assert.equal(reached.planned, undefined);
});

test("parseInboxFilter defaults to todo", () => {
  assert.equal(parseInboxFilter(undefined), "todo");
  assert.equal(parseInboxFilter("nope"), "todo");
  assert.equal(parseInboxFilter("done"), "done");
});

test("parseSupportType accepts known types only", () => {
  assert.equal(parseSupportType("bug"), "bug");
  assert.equal(parseSupportType("BUG"), null);
  assert.equal(parseSupportType(undefined), null);
});

test("checkAttachments enforces count, type and size", () => {
  const png = { type: "image/png", size: 1000 };
  assert.deepEqual(checkAttachments([png, png, png]), { ok: true });
  assert.equal(checkAttachments([png, png, png, png]).ok, false);
  assert.equal(checkAttachments([{ type: "image/gif", size: 10 }]).ok, false);
  assert.equal(checkAttachments([{ type: "image/jpeg", size: 5_000_001 }]).ok, false);
  assert.deepEqual(checkAttachments([]), { ok: true });
});

test("isValidEta accepts real calendar dates only", () => {
  assert.equal(isValidEta("2026-10-31"), true);
  for (const bad of ["2026-02-30", "2026-1-5", "31/10/2026", ""]) {
    assert.equal(isValidEta(bad), false, bad);
  }
});

test("formatEta writes a French day and month", () => {
  assert.equal(formatEta("2026-10-31"), "31 octobre");
});

test("normalizeSearch drops accents, case and extra spaces", () => {
  assert.equal(normalizeSearch("  Réservation   ÉTÉ "), "reservation ete");
});

test("matchArticles needs every word and ranks question hits first", () => {
  const articles = [
    { id: "a", question: "Comment créer un pack ?", answer: "Depuis la page des packs prépayés." },
    { id: "b", question: "Mot de passe oublié", answer: "Le lien sert à créer un nouveau mot de passe." },
    { id: "c", question: "Synchroniser Google Agenda", answer: "Dans Réglages." },
  ];
  assert.deepEqual(matchArticles(articles, "creer").map((a) => a.id), ["a", "b"]);
  assert.deepEqual(matchArticles(articles, "créer pack").map((a) => a.id), ["a"]);
  assert.deepEqual(matchArticles(articles, "mot passe").map((a) => a.id), ["b"]);
  assert.deepEqual(matchArticles(articles, "agenda zzz"), []);
  assert.deepEqual(matchArticles(articles, "  "), []);
});

test("parseAnswer splits paragraphs and dash lists", () => {
  assert.deepEqual(parseAnswer("Premier paragraphe\nsur deux lignes.\n\n- un\n- deux\nFin."), [
    { kind: "paragraph", segments: [{ kind: "text", text: "Premier paragraphe sur deux lignes." }] },
    { kind: "list", items: [[{ kind: "text", text: "un" }], [{ kind: "text", text: "deux" }]] },
    { kind: "paragraph", segments: [{ kind: "text", text: "Fin." }] },
  ]);
});

test("parseAnswer links https URLs and app paths, trailing punctuation excluded", () => {
  assert.deepEqual(parseAnswer("Voir https://myskedul.com/aide. Ou /sign-up, ou 1/2."), [
    {
      kind: "paragraph",
      segments: [
        { kind: "text", text: "Voir " },
        { kind: "link", text: "https://myskedul.com/aide", href: "https://myskedul.com/aide" },
        { kind: "text", text: ". Ou " },
        { kind: "link", text: "/sign-up", href: "/sign-up" },
        { kind: "text", text: ", ou 1/2." },
      ],
    },
  ]);
});

test("parseAnswer never links javascript: or protocol-relative URLs", () => {
  const [block] = parseAnswer("javascript:alert(1) //evil.com http://plain.example");
  assert.ok(block.kind === "paragraph");
  assert.ok(block.segments.every((s) => s.kind === "text"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/support.test.ts`
Expected: FAIL, `Cannot find module './support'` (or equivalent ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Implement `src/lib/support.ts`**

```ts
/**
 * Help center and support requests: the pure rules shared by the server
 * actions, the pages and the e-mails. No drizzle and no Node APIs, so client
 * components can import it; the schema builds its enums from the arrays below.
 */

/* ── Vocabulary ── */

export const SUPPORT_TYPES = ["question", "bug", "feature", "other"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];

export const SUPPORT_TRACKS = ["support", "development"] as const;
export type SupportTrack = (typeof SUPPORT_TRACKS)[number];

export const SUPPORT_STAGES = [
  "received",
  "in_progress",
  "resolved",
  "accepted",
  "planned",
  "in_development",
  "testing",
  "delivered",
] as const;
export type SupportStage = (typeof SUPPORT_STAGES)[number];

export const SUPPORT_RESOLUTIONS = ["declined", "closed"] as const;
export type SupportResolution = (typeof SUPPORT_RESOLUTIONS)[number];

export const SUPPORT_AUTHOR_ROLES = ["user", "admin", "system"] as const;
export type SupportAuthorRole = (typeof SUPPORT_AUTHOR_ROLES)[number];

export const SUPPORT_MESSAGE_KINDS = ["message", "stage_change", "resolution"] as const;
export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number];

/** Icons a FAQ category may use; the UI maps each name to a lucide icon. */
export const HELP_ICONS = [
  "rocket",
  "calendar",
  "ticket",
  "credit-card",
  "user",
  "settings",
  "help",
  "sparkles",
] as const;
export type HelpIcon = (typeof HELP_ICONS)[number];

export function isHelpIcon(value: string): value is HelpIcon {
  return (HELP_ICONS as readonly string[]).includes(value);
}

export const TYPE_LABELS: Record<SupportType, string> = {
  question: "Question",
  bug: "Problème",
  feature: "Idée de fonctionnalité",
  other: "Autre",
};

export const TYPE_HINTS: Record<SupportType, string> = {
  question: "Comment faire quelque chose avec Skedul",
  bug: "Quelque chose ne fonctionne pas comme prévu",
  feature: "Une fonctionnalité qui vous manque",
  other: "Compte, facturation ou autre sujet",
};

export const STAGE_LABELS: Record<SupportStage, string> = {
  received: "Reçue",
  in_progress: "Prise en charge",
  resolved: "Résolue",
  accepted: "Acceptée",
  planned: "Planifiée",
  in_development: "En développement",
  testing: "En test",
  delivered: "Livrée",
};

export const RESOLUTION_LABELS: Record<SupportResolution, string> = {
  declined: "Non retenue",
  closed: "Fermée",
};

/* ── Limits ── */

export const MAX_REQUESTS_PER_DAY = 5;
export const MAX_MESSAGES_PER_DAY = 30;
export const MAX_SUBJECT = 140;
export const MAX_BODY = 20_000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5_000_000;

export const ATTACHMENT_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type AttachmentType = keyof typeof ATTACHMENT_EXTENSIONS;

/* ── Progress ── */

export const TRACK_STEPS: Record<SupportTrack, readonly SupportStage[]> = {
  support: ["received", "in_progress", "resolved"],
  development: ["received", "accepted", "planned", "in_development", "testing", "delivered"],
};

export type RequestState = {
  track: SupportTrack;
  stage: SupportStage;
  resolution: SupportResolution | null;
};

/** Position of `stage` on its track (0-based); 0 when it is not on the track. */
export function stepIndex(track: SupportTrack, stage: SupportStage): number {
  return Math.max(0, TRACK_STEPS[track].indexOf(stage));
}

export function stepCount(track: SupportTrack): number {
  return TRACK_STEPS[track].length;
}

/** 0 on the first step, 1 on the last. */
export function progressRatio(track: SupportTrack, stage: SupportStage): number {
  return stepIndex(track, stage) / (stepCount(track) - 1);
}

export function isFinalStage(track: SupportTrack, stage: SupportStage): boolean {
  const steps = TRACK_STEPS[track];
  return steps[steps.length - 1] === stage;
}

/** Still being worked on: no resolution and not on the track's last step. */
export function isOpen(r: RequestState): boolean {
  return r.resolution === null && !isFinalStage(r.track, r.stage);
}

export function statusLabel(r: RequestState): string {
  return r.resolution ? RESOLUTION_LABELS[r.resolution] : STAGE_LABELS[r.stage];
}

/**
 * The admin may move a request to any step of its own track, backwards
 * included, except a development request back to "received" (the kanban
 * starts at "accepted").
 */
export function canSetStage(track: SupportTrack, stage: SupportStage): boolean {
  if (track === "development" && stage === "received") return false;
  return TRACK_STEPS[track].includes(stage);
}

export function canAcceptForDevelopment(r: RequestState): boolean {
  return r.track === "support" && r.resolution === null && r.stage !== "resolved";
}

/** A closed request is locked; declined or delivered ones still accept replies. */
export function canUserReply(r: RequestState): boolean {
  return r.resolution !== "closed";
}

/** A reply on a resolved support request reopens it; nothing else moves. */
export function stageAfterUserReply(r: RequestState): SupportStage {
  return r.track === "support" && r.stage === "resolved" && r.resolution === null
    ? "in_progress"
    : r.stage;
}

/** The first admin reply on a new support request means it is being handled. */
export function stageAfterAdminReply(r: RequestState): SupportStage {
  return r.track === "support" && r.stage === "received" && r.resolution === null
    ? "in_progress"
    : r.stage;
}

type ThreadEvent = {
  kind: SupportMessageKind;
  stage: SupportStage | null;
  createdAt: Date;
};

/**
 * When each step was last entered: "received" at creation, the others from
 * the `stage_change` events (expected in chronological order).
 */
export function stageReachedAt(
  createdAt: Date,
  events: readonly ThreadEvent[],
): Partial<Record<SupportStage, Date>> {
  const reached: Partial<Record<SupportStage, Date>> = { received: createdAt };
  for (const e of events) {
    if (e.kind === "stage_change" && e.stage) reached[e.stage] = e.createdAt;
  }
  return reached;
}

/* ── Admin inbox ── */

export const INBOX_FILTERS = ["todo", "open", "done", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  todo: "À traiter",
  open: "En cours",
  done: "Terminées",
  all: "Toutes",
};

export const INBOX_PAGE_SIZE = 25;

export function parseInboxFilter(value: string | undefined): InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as InboxFilter)
    : "todo";
}

export function parseSupportType(value: string | undefined): SupportType | null {
  return (SUPPORT_TYPES as readonly string[]).includes(value ?? "")
    ? (value as SupportType)
    : null;
}

/* ── Ordering (FAQ categories and articles) ── */

/** `ids` with `id` swapped with its neighbour, or null when it cannot move. */
export function moveInList(
  ids: readonly string[],
  id: string,
  direction: "up" | "down",
): string[] | null {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/* ── Attachments ── */

export type AttachmentCheck = { ok: true } | { ok: false; error: string };

export function checkAttachments(
  files: readonly { type: string; size: number }[],
): AttachmentCheck {
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `${MAX_ATTACHMENTS} images maximum par message.` };
  }
  for (const file of files) {
    if (!(file.type in ATTACHMENT_EXTENSIONS)) {
      return { ok: false, error: "Format d’image non pris en charge (png, jpg ou webp)." };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "Image trop lourde (5 Mo maximum)." };
    }
  }
  return { ok: true };
}

/* ── Estimated delivery date (YYYY-MM-DD) ── */

export function isValidEta(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** "2026-10-31" → "31 octobre". */
export function formatEta(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/* ── FAQ search ── */

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type SearchableArticle = { question: string; answer: string };

/**
 * Articles containing every word of `query` (accents and case ignored, one-letter
 * words skipped); articles matching more words in their question come first.
 */
export function matchArticles<T extends SearchableArticle>(
  articles: readonly T[],
  query: string,
): T[] {
  const words = normalizeSearch(query)
    .split(" ")
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const hits: { article: T; inQuestion: number; order: number }[] = [];
  articles.forEach((article, order) => {
    const question = normalizeSearch(article.question);
    const answer = normalizeSearch(article.answer);
    if (!words.every((w) => question.includes(w) || answer.includes(w))) return;
    const inQuestion = words.filter((w) => question.includes(w)).length;
    hits.push({ article, inQuestion, order });
  });
  return hits
    .sort((a, b) => b.inQuestion - a.inQuestion || a.order - b.order)
    .map((h) => h.article);
}

/* ── FAQ answers: plain text → paragraphs, "- " lists and links ── */

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

export type AnswerBlock =
  | { kind: "paragraph"; segments: AnswerSegment[] }
  | { kind: "list"; items: AnswerSegment[][] };

// https URLs, or app paths ("/sign-up") at the start of a line or after a space.
const LINK_RE = /https:\/\/[^\s<>()]+|(?:^|(?<=\s))\/[a-z0-9][^\s<>()]*/gi;

function linkify(line: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of line.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    const trailing = match[0].match(/[.,;:!?]+$/)?.[0] ?? "";
    const href = trailing ? match[0].slice(0, -trailing.length) : match[0];
    if (start > last) segments.push({ kind: "text", text: line.slice(last, start) });
    segments.push({ kind: "link", text: href, href });
    last = start + href.length;
  }
  if (last < line.length) segments.push({ kind: "text", text: line.slice(last) });
  return segments;
}

/** Rendered as React elements by <FaqAnswer />: never as raw HTML. */
export function parseAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let paragraph: string[] = [];
    let items: AnswerSegment[][] = [];
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", segments: linkify(paragraph.join(" ")) });
      paragraph = [];
    };
    const flushList = () => {
      if (items.length) blocks.push({ kind: "list", items });
      items = [];
    };
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("- ")) {
        flushParagraph();
        items.push(linkify(line.slice(2).trim()));
      } else {
        flushList();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./node_modules/.bin/tsx --test src/lib/support.test.ts`
Expected: PASS, all tests (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/support.ts src/lib/support.test.ts
git commit -m "feat(support): pure rules for requests, progress and FAQ search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schema, migration 0008 and starter FAQ (0009)

**Files:**
- Modify: `src/lib/db/schema.ts` (imports at the top, new enums after `questionType`, new tables after `analyticsSalt`)
- Create: `drizzle/0008_help_center.sql` (generated), `drizzle/0009_help_faq_seed.sql` (custom, filled by hand), plus the generated `drizzle/meta/*` files

**Interfaces:**
- Consumes: `SUPPORT_TYPES`, `SUPPORT_TRACKS`, `SUPPORT_STAGES`, `SUPPORT_RESOLUTIONS`, `SUPPORT_AUTHOR_ROLES`, `SUPPORT_MESSAGE_KINDS` from Task 2.
- Produces: tables `helpCategory`, `helpArticle`, `supportRequest`, `supportMessage`, `supportAttachment` (and their `$inferSelect` row types) exported from `@/lib/db/schema` (re-exported by `@/lib/db`).

- [ ] **Step 1: Add the imports**

In `src/lib/db/schema.ts`, change the `drizzle-orm/pg-core` import to include `date` and `serial`, and add a **relative** import of the support vocabulary (drizzle-kit bundles this file itself, so no `@/` alias here):

```ts
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
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
```

- [ ] **Step 2: Add the enums**

Right after `export const questionType = pgEnum(...)`:

```ts
export const supportType = pgEnum("support_type", SUPPORT_TYPES);
export const supportTrack = pgEnum("support_track", SUPPORT_TRACKS);
export const supportStage = pgEnum("support_stage", SUPPORT_STAGES);
export const supportResolution = pgEnum("support_resolution", SUPPORT_RESOLUTIONS);
export const supportAuthorRole = pgEnum("support_author_role", SUPPORT_AUTHOR_ROLES);
export const supportMessageKind = pgEnum("support_message_kind", SUPPORT_MESSAGE_KINDS);
```

- [ ] **Step 3: Add the tables**

Right after the `analyticsSalt` table (before the `/* ── Relations ── */` banner):

```ts
/* ─────────────────────────── Help center ──────────────────────── */

export const helpCategory = pgTable("help_category", {
  id: id(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  // one of HELP_ICONS (src/lib/support.ts)
  icon: text("icon").notNull().default("help"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const helpArticle = pgTable(
  "help_article",
  {
    id: id(),
    categoryId: text("category_id")
      .notNull()
      .references(() => helpCategory.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    // plain text: blank line = paragraph, "- " = list item (parseAnswer)
    answer: text("answer").notNull(),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("help_article_category_idx").on(t.categoryId, t.position)],
);

export const supportRequest = pgTable(
  "support_request",
  {
    id: id(),
    // human-facing "#42"
    number: serial("number").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: supportType("type").notNull(),
    subject: text("subject").notNull(),
    track: supportTrack("track").notNull().default("support"),
    // always a step of `track` (TRACK_STEPS)
    stage: supportStage("stage").notNull().default("received"),
    // set = the request ended off-track (declined / closed); the bar freezes on `stage`
    resolution: supportResolution("resolution"),
    // estimated delivery, development track only
    eta: date("eta", { mode: "string" }),
    unreadByUser: boolean("unread_by_user").notNull().default(false),
    unreadByAdmin: boolean("unread_by_admin").notNull().default(true),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("support_request_user_idx").on(t.userId, t.lastActivityAt),
    index("support_request_unread_idx").on(t.unreadByAdmin),
  ],
);

export const supportMessage = pgTable(
  "support_message",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => supportRequest.id, { onDelete: "cascade" }),
    // NULL once the author's account is deleted (an admin's messages stay)
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorRole: supportAuthorRole("author_role").notNull(),
    kind: supportMessageKind("kind").notNull().default("message"),
    body: text("body").notNull().default(""),
    // kind = stage_change: the step reached
    stage: supportStage("stage"),
    // kind = resolution: declined / closed, or NULL when the request was reopened
    resolution: supportResolution("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("support_message_request_idx").on(t.requestId, t.createdAt)],
);

export const supportAttachment = pgTable(
  "support_attachment",
  {
    id: id(),
    messageId: text("message_id")
      .notNull()
      .references(() => supportMessage.id, { onDelete: "cascade" }),
    // private Blob pathname: support/<requesterUserId>/<nanoid>.<ext>
    pathname: text("pathname").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("support_attachment_message_idx").on(t.messageId)],
);
```

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Generate migration 0008**

Run: `./node_modules/.bin/drizzle-kit generate --name help_center`
Expected: `drizzle/0008_help_center.sql` created; drizzle-kit lists 5 new tables and 6 enums, and asks no interactive question (if it prompts about renames, answer "create" for every item: nothing is renamed).

Open the file and check: `CREATE TYPE "public"."support_type" AS ENUM('question', 'bug', 'feature', 'other')` (and the 5 other types), the 5 `CREATE TABLE`, `"number" serial NOT NULL` with a `UNIQUE("number")` constraint, FKs `ON DELETE cascade` on `help_article.category_id`, `support_request.user_id`, `support_message.request_id`, `support_attachment.message_id`, and `ON DELETE set null` on `support_message.author_id`. No `DROP` and no `ALTER` of an existing table.

- [ ] **Step 6: Apply 0008 to the development branch**

Run: `./node_modules/.bin/tsx scripts/apply-migration.ts drizzle/0008_help_center.sql`
Expected: first line `→ <host>` is the **development** Neon host (`ep-…` of branch `br-bold-art-af8tpfm5`, the one in `.env.local`), then one `✓` per statement, no error.

- [ ] **Step 7: Generate the empty custom migration 0009**

Run: `./node_modules/.bin/drizzle-kit generate --custom --name help_faq_seed`
Expected: `drizzle/0009_help_faq_seed.sql` created (only a comment inside).

- [ ] **Step 8: Fill `drizzle/0009_help_faq_seed.sql`**

Replace its whole content with:

```sql
-- Starter FAQ (5 categories, 10 published articles). Runs once in every
-- environment; afterwards the FAQ is edited from /admin/support/faq.
-- Skipped entirely when the admin already created categories.
INSERT INTO "help_category" ("id", "title", "slug", "icon", "position")
SELECT * FROM (VALUES
  ('hc_demarrer', 'Bien démarrer', 'bien-demarrer', 'rocket', 0),
  ('hc_reservations', 'Réservations et planning', 'reservations-et-planning', 'calendar', 1),
  ('hc_packs', 'Packs prépayés', 'packs-prepayes', 'ticket', 2),
  ('hc_compte', 'Compte et connexion', 'compte-et-connexion', 'user', 3),
  ('hc_support', 'Vos demandes', 'vos-demandes', 'help', 4)
) AS v("id", "title", "slug", "icon", "position")
WHERE NOT EXISTS (SELECT 1 FROM "help_category");
--> statement-breakpoint
INSERT INTO "help_article" ("id", "category_id", "question", "answer", "position", "published")
SELECT * FROM (VALUES
  ('ha_creer_page', 'hc_demarrer', 'Comment créer ma page de réservation ?',
   E'Créez votre compte sur /sign-up, puis indiquez le nom de votre activité : Skedul génère votre page publique et son adresse.\n\nAjoutez ensuite depuis votre espace :\n- Prestations : la durée, le prix et la description de chaque rendez-vous\n- Disponibilités : vos horaires de la semaine\n\nVos clients peuvent réserver dès qu''une prestation a des horaires.', 0, true),
  ('ha_lien_page', 'hc_demarrer', 'Où trouver le lien de ma page publique ?',
   E'Le lien est affiché sur la vue d''ensemble de votre espace, avec un bouton pour le copier. Le menu propose aussi « Voir ma page publique ».\n\nPartagez-le sur vos réseaux, dans votre bio ou par message : vos clients réservent sans créer de compte.', 1, true),
  ('ha_conges', 'hc_reservations', 'Comment bloquer des jours de congé ?',
   E'Ouvrez Indisponibilités dans votre espace et ajoutez une journée entière ou une plage horaire. Ces créneaux disparaissent de votre page publique.\n\nVos horaires habituels ne changent pas : l''indisponibilité ne s''applique qu''aux dates choisies.', 0, true),
  ('ha_planning', 'hc_reservations', 'Où voir mes rendez-vous de la semaine ?',
   E'Le Planning affiche vos séances et rendez-vous semaine par semaine. Cliquez sur une séance pour voir ses participants et ses détails.', 1, true),
  ('ha_google', 'hc_reservations', 'Puis-je synchroniser Skedul avec Google Agenda ?',
   E'Oui. Dans Réglages, la carte Google Agenda permet de connecter votre compte Google et de synchroniser vos rendez-vous avec votre agenda.', 2, true),
  ('ha_packs', 'hc_packs', 'Comment fonctionnent les packs prépayés ?',
   E'Un pack est un lot de crédits (par exemple 4 séances) que vos clients achètent en une fois. Chaque réservation utilise ensuite un crédit, sans nouveau paiement.\n\nVous créez vos packs depuis la page Packs prépayés : nombre de crédits, prix, et prestation concernée si le pack ne vaut que pour l''une d''elles.', 0, true),
  ('ha_credits', 'hc_packs', 'Comment un client utilise-t-il ses crédits ?',
   E'Au moment de réserver sur votre page, un client qui a des crédits restants peut utiliser un crédit au lieu de payer le créneau. Il peut aussi retrouver son solde depuis votre page publique.', 1, true),
  ('ha_mot_de_passe', 'hc_compte', 'J''ai oublié mon mot de passe',
   E'Sur la page de connexion, cliquez sur « Mot de passe oublié ? » et saisissez votre e-mail. Vous recevez un lien valable 1 heure pour choisir un nouveau mot de passe.\n\nPar sécurité, toutes vos sessions ouvertes sont déconnectées après le changement.', 0, true),
  ('ha_google_connexion', 'hc_compte', 'Puis-je me connecter avec Google ?',
   E'Oui, avec « Continuer avec Google » sur la page de connexion. Si un compte Skedul existe déjà avec la même adresse e-mail, Skedul vous demande d''abord son mot de passe pour relier les deux.', 1, true),
  ('ha_suivi_demande', 'hc_support', 'Comment suivre une demande envoyée à l''équipe ?',
   E'Chaque demande a sa page dans le Centre d''aide, rubrique Mes demandes : la barre de progression montre où elle en est et l''équipe vous répond dans le fil de messages.\n\nVous recevez aussi un e-mail à chaque réponse ou changement d''étape.', 0, true)
) AS v("id", "category_id", "question", "answer", "position", "published")
WHERE EXISTS (SELECT 1 FROM "help_category" WHERE "id" = 'hc_demarrer')
  AND NOT EXISTS (SELECT 1 FROM "help_article");
```

- [ ] **Step 9: Apply 0009 and check the content**

Run: `./node_modules/.bin/tsx scripts/apply-migration.ts drizzle/0009_help_faq_seed.sql`
Expected: `→ <development host>`, two `✓ INSERT …` lines.

Then, with the Neon MCP `run_sql` on the development branch `br-bold-art-af8tpfm5`:
```sql
SELECT (SELECT count(*) FROM help_category) AS categories, (SELECT count(*) FROM help_article WHERE published) AS articles;
```
Expected: `categories = 5`, `articles = 10`.

- [ ] **Step 10: Run the unit tests and typecheck**

Run: `./node_modules/.bin/tsx --test && ./node_modules/.bin/tsc --noEmit`
Expected: all tests pass, typecheck exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0008_help_center.sql drizzle/0009_help_faq_seed.sql drizzle/meta
git commit -m "feat(support): help center and support request tables, starter FAQ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `?next=` after sign-in and sign-up

**Files:**
- Create: `src/lib/safe-next.ts`
- Test: `src/lib/safe-next.test.ts`
- Modify: `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/components/auth/auth-form.tsx`

**Interfaces:**
- Produces: `safeNextPath(value: unknown): string | null`. Pages later link to `/sign-in?next=<encoded path>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/safe-next.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { safeNextPath } from "./safe-next";

test("safeNextPath keeps same-site paths with their query and hash", () => {
  assert.equal(safeNextPath("/aide/demandes/nouvelle"), "/aide/demandes/nouvelle");
  assert.equal(safeNextPath("/aide?q=pack#a-1"), "/aide?q=pack#a-1");
});

test("safeNextPath rejects anything that could leave the site", () => {
  for (const bad of [
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "aide",
    "",
    "/\u0000x",
    undefined,
    null,
    42,
    ["/aide"],
  ]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/tsx --test src/lib/safe-next.test.ts`
Expected: FAIL, module `./safe-next` not found.

- [ ] **Step 3: Implement `src/lib/safe-next.ts`**

```ts
const BASE = "http://next.invalid";

/**
 * The `?next=` target after sign-in, or null when it is not a plain path on
 * this site ("//host", "/\\host", absolute URLs and control characters are
 * all refused, so the redirect can never leave Skedul).
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/tsx --test src/lib/safe-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `next` into the sign-in page**

Replace `src/app/(auth)/sign-in/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { DemoQuickLogin } from "@/components/auth/demo-quick-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentUser } from "@/lib/session";
import { resolvePostSignIn } from "@/server/entry";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next: rawNext } = await searchParams;
  // Google found an existing email/password account: offer to link it.
  if (error === "account_not_linked") redirect("/link-google");
  const next = safeNextPath(rawNext);

  // Already signed in: go back where the user was headed, else the usual
  // routing (admins may choose).
  let showChooser = false;
  if (await getCurrentUser()) {
    if (next) redirect(next);
    const target = await resolvePostSignIn();
    if (target.kind === "redirect") redirect(target.to);
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
        <AuthForm
          mode="sign-in"
          next={next}
          initialChooser={showChooser}
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
        {env.APP_ENV !== "production" && <DemoQuickLogin />}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Wire `next` into the sign-up page**

Replace `src/app/(auth)/sign-up/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext);
  if (await getCurrentUser()) redirect(next ?? "/dashboard");
  // Google found an existing email/password account: offer to link it.
  if (error === "account_not_linked") redirect("/link-google");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Créez votre compte</CardTitle>
        <p className="text-sm text-muted-foreground">
          Lancez votre page de réservation en quelques minutes.
        </p>
      </CardHeader>
      <CardContent>
        <AuthForm
          mode="sign-up"
          next={next}
          googleEnabled={env.GOOGLE_CALENDAR_ENABLED}
          initialError={oauthErrorMessage(typeof error === "string" ? error : null)}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Wire `next` into `AuthForm`**

In `src/components/auth/auth-form.tsx`:

1. Add the prop to the signature (after `mode`):

```tsx
export function AuthForm({
  mode,
  next = null,
  initialChooser = false,
  googleEnabled = false,
  initialError = null,
}: {
  mode: "sign-in" | "sign-up";
  /** Validated path to open after signing in (from `?next=`), else the usual routing. */
  next?: string | null;
  /** Open the admin entry chooser right away (an admin is already signed in). */
  initialChooser?: boolean;
  /** Show "Continuer avec Google" (a Google OAuth client is configured). */
  googleEnabled?: boolean;
  /** Error brought back in the URL by a failed Google sign-in. */
  initialError?: string | null;
}) {
```

2. Right after `const busy = loading || googleLoading;` add:

```tsx
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
```

3. In `onGoogle`, replace the `signIn.social` call with:

```tsx
      const result = await signIn.social({
        provider: "google",
        callbackURL: `/sign-in${nextQuery}`,
        newUserCallbackURL: next ?? "/onboarding",
        errorCallbackURL: isSignUp ? `/sign-up${nextQuery}` : `/sign-in${nextQuery}`,
      });
```

and update the comment above it to:

```tsx
      // Better Auth redirects the browser to Google. On return, /sign-in sends
      // the user to `next` or routes them (admins get the entry chooser);
      // brand-new users go to `next` or onboarding.
```

4. In `onSubmit`, replace the block from `if (isSignUp) {` down to the final `router.push(next.to);` with:

```tsx
    if (isSignUp) {
      router.push(next ?? "/onboarding");
      router.refresh();
      return;
    }

    if (next) {
      // Push only (see below): the target page reads the fresh session.
      router.push(next);
      return;
    }

    // Admins pick Admin vs Client (unless remembered); everyone else → /dashboard.
    let target: PostSignIn;
    try {
      target = await resolvePostSignIn();
    } catch {
      // Sign-in worked; only the routing lookup failed (network, DB, stale action).
      setLoading(false);
      setError("Connexion réussie, mais la redirection a échoué. Réessayez.");
      return;
    }
    if (target.kind === "choose") {
      setLoading(false);
      setChoosing(true);
      return;
    }
    // Push only: a router.refresh() queued right after a server action leaves the
    // navigation pending forever (Next 16 router queue). The target is fetched fresh.
    router.push(target.to);
```

5. Make the two cross links keep `next`:

```tsx
              <Link href={`/sign-in${nextQuery}`} className="font-medium text-primary hover:underline">
                Se connecter
              </Link>
```

```tsx
              <Link href={`/sign-up${nextQuery}`} className="font-medium text-primary hover:underline">
                Créer un compte
              </Link>
```

- [ ] **Step 8: Typecheck, lint, tests**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/auth src/app/\(auth\) src/lib/safe-next.ts && ./node_modules/.bin/tsx --test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/safe-next.ts src/lib/safe-next.test.ts "src/app/(auth)/sign-in/page.tsx" "src/app/(auth)/sign-up/page.tsx" src/components/auth/auth-form.tsx
git commit -m "feat(auth): return to ?next= after sign-in or sign-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Support e-mail templates

**Files:**
- Create: `src/lib/email-layout.ts`, `src/lib/support-emails.ts`
- Test: `src/lib/support-emails.test.ts`
- Modify: `src/lib/email.ts` (move `layout`, `HTML_ESCAPES`, `escapeHtml` out)

**Interfaces:**
- Consumes: `TYPE_LABELS`, `STAGE_LABELS`, `RESOLUTION_LABELS`, `stepIndex`, `stepCount`, `formatEta` and types from Task 2.
- Produces: `layout(title, body)`, `escapeHtml(s)` from `@/lib/email-layout`; from `@/lib/support-emails` (each returns `{ subject: string; html: string }`):
  - `supportNewRequestEmail({ number, subject, type, authorName, authorEmail, body, url })`
  - `supportUserReplyEmail({ number, subject, authorName, body, url })`
  - `supportAdminReplyEmail({ name, number, subject, body, url })`
  - `supportStageEmail({ name, number, subject, track, stage, eta, url })`
  - `supportResolutionEmail({ name, number, subject, resolution, reason, url })` (`resolution: SupportResolution | null`, null = reopened)

- [ ] **Step 1: Move the layout helpers out of `email.ts`**

Create `src/lib/email-layout.ts` by **cutting** (not copying) from `src/lib/email.ts` the `layout` function, the `HTML_ESCAPES` map and `escapeHtml`, unchanged except for the `export` keywords. The result must be:

```ts
/**
 * Shared HTML frame and escaping for transactional e-mails. Pure (no Resend,
 * no server-only), so the templates built on it can be unit-tested.
 */

export function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="font-weight:700;font-size:20px;color:#6366f1;margin-bottom:16px">Skedul</div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e4e4e7">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:20px">Envoyé par Skedul · Réservations & packs prépayés</p>
  </div></body></html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
```

If the `layout` body in `email.ts` differs from the block above, keep the **email.ts** version verbatim (the block above is what it contained on 2026-10-09).

Then in `src/lib/email.ts`, add after `import { env } from "@/lib/env";`:

```ts
import { escapeHtml, layout } from "@/lib/email-layout";
```

- [ ] **Step 2: Check nothing else broke**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0 (every template in `email.ts` still finds `layout`/`escapeHtml`).

- [ ] **Step 3: Write the failing tests**

Create `src/lib/support-emails.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  supportAdminReplyEmail,
  supportNewRequestEmail,
  supportResolutionEmail,
  supportStageEmail,
  supportUserReplyEmail,
} from "./support-emails";

test("support e-mails escape user content", () => {
  const mail = supportNewRequestEmail({
    number: 7,
    subject: "<b>Hi</b>",
    type: "bug",
    authorName: "Ana <x>",
    authorEmail: "ana@example.com",
    body: "<script>alert(1)</script>\nligne 2",
    url: "https://myskedul.com/admin/support/r1",
  });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("&lt;b&gt;Hi&lt;/b&gt;"));
  assert.ok(mail.html.includes("Ana &lt;x&gt;"));
  assert.ok(mail.html.includes("<br>ligne 2"));
  assert.equal(mail.subject, "Nouvelle demande #7 : <b>Hi</b>");
});

test("the stage e-mail spells out the step and the estimate", () => {
  const mail = supportStageEmail({
    name: "Ana Souza",
    number: 42,
    subject: "Export CSV",
    track: "development",
    stage: "in_development",
    eta: "2026-10-31",
    url: "https://myskedul.com/aide/demandes/r1",
  });
  assert.equal(mail.subject, "Votre demande #42 : En développement");
  assert.ok(mail.html.includes("Étape 4 sur 6 : En développement"));
  assert.ok(mail.html.includes("31 octobre"));
  assert.ok(mail.html.includes("Bonjour Ana,"));
});

test("the resolution e-mail carries the reason, or announces a reopening", () => {
  const declined = supportResolutionEmail({
    name: "Ana",
    number: 3,
    subject: "Mode sombre",
    resolution: "declined",
    reason: "Pas prévu cette année.",
    url: "u",
  });
  assert.equal(declined.subject, "Votre demande #3 : Non retenue");
  assert.ok(declined.html.includes("Pas prévu cette année."));
  const reopened = supportResolutionEmail({
    name: "Ana",
    number: 3,
    subject: "Mode sombre",
    resolution: null,
    reason: "",
    url: "u",
  });
  assert.equal(reopened.subject, "Votre demande #3 : Rouverte");
});

test("reply e-mails quote the message", () => {
  const toAdmin = supportUserReplyEmail({ number: 5, subject: "Bug", authorName: "Léo", body: "Merci !", url: "u" });
  assert.equal(toAdmin.subject, "Nouvelle réponse sur #5 : Bug");
  assert.ok(toAdmin.html.includes("Merci !"));
  const toUser = supportAdminReplyEmail({ name: "Léo Martin", number: 5, subject: "Bug", body: "C’est corrigé.", url: "u" });
  assert.equal(toUser.subject, "Votre demande #5 : nouvelle réponse");
  assert.ok(toUser.html.includes("C’est corrigé."));
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `./node_modules/.bin/tsx --test src/lib/support-emails.test.ts`
Expected: FAIL, module `./support-emails` not found.

- [ ] **Step 5: Implement `src/lib/support-emails.ts`**

```ts
import { escapeHtml, layout } from "@/lib/email-layout";
import {
  RESOLUTION_LABELS,
  STAGE_LABELS,
  TYPE_LABELS,
  formatEta,
  stepCount,
  stepIndex,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
  type SupportType,
} from "@/lib/support";

/** Templates for help-center notifications; every user-written string is escaped. */

type Mail = { subject: string; html: string };

const EXCERPT = 600;

function quote(body: string): string {
  const text = body.trim();
  if (!text) return "";
  const cut = text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;
  return `<blockquote style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:12px;color:#3f3f46;font-size:14px">${escapeHtml(cut).replace(/\n/g, "<br>")}</blockquote>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${label}</a></p>`;
}

function hello(name: string): string {
  const first = escapeHtml(name.trim().split(/\s+/)[0] ?? "");
  return `<p>Bonjour${first ? ` ${first}` : ""},</p>`;
}

/** To every admin: a user opened a request. */
export function supportNewRequestEmail(a: {
  number: number;
  subject: string;
  type: SupportType;
  authorName: string;
  authorEmail: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Nouvelle demande #${a.number} : ${a.subject}`,
    html: layout(`Nouvelle demande #${a.number}`, `
      <p><strong>${escapeHtml(a.subject)}</strong></p>
      <p style="color:#71717a;font-size:13px">${TYPE_LABELS[a.type]}, par ${escapeHtml(a.authorName)} (${escapeHtml(a.authorEmail)})</p>
      ${quote(a.body)}
      ${button(a.url, "Ouvrir la demande")}`),
  };
}

/** To every admin: the requester answered. */
export function supportUserReplyEmail(a: {
  number: number;
  subject: string;
  authorName: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Nouvelle réponse sur #${a.number} : ${a.subject}`,
    html: layout(`Nouvelle réponse sur #${a.number}`, `
      <p>${escapeHtml(a.authorName)} a répondu à <strong>${escapeHtml(a.subject)}</strong>.</p>
      ${quote(a.body)}
      ${button(a.url, "Ouvrir la demande")}`),
  };
}

/** To the requester: the team answered. */
export function supportAdminReplyEmail(a: {
  name: string;
  number: number;
  subject: string;
  body: string;
  url: string;
}): Mail {
  return {
    subject: `Votre demande #${a.number} : nouvelle réponse`,
    html: layout("L’équipe Skedul vous a répondu", `
      ${hello(a.name)}
      <p>Nouvelle réponse sur votre demande <strong>${escapeHtml(a.subject)}</strong> :</p>
      ${quote(a.body)}
      ${button(a.url, "Voir la conversation")}`),
  };
}

/** To the requester: the request moved to another step. */
export function supportStageEmail(a: {
  name: string;
  number: number;
  subject: string;
  track: SupportTrack;
  stage: SupportStage;
  eta: string | null;
  url: string;
}): Mail {
  const step = stepIndex(a.track, a.stage) + 1;
  const total = stepCount(a.track);
  const label = STAGE_LABELS[a.stage];
  return {
    subject: `Votre demande #${a.number} : ${label}`,
    html: layout("Votre demande avance", `
      ${hello(a.name)}
      <p>Votre demande <strong>${escapeHtml(a.subject)}</strong> a changé d’étape.</p>
      <p style="font-size:15px"><strong>Étape ${step} sur ${total} : ${label}</strong></p>
      ${a.eta ? `<p style="color:#71717a;font-size:13px">Livraison estimée : ${formatEta(a.eta)}</p>` : ""}
      ${button(a.url, "Suivre ma demande")}`),
  };
}

/** To the requester: declined, closed, or reopened (resolution = null). */
export function supportResolutionEmail(a: {
  name: string;
  number: number;
  subject: string;
  resolution: SupportResolution | null;
  reason: string;
  url: string;
}): Mail {
  const label = a.resolution ? RESOLUTION_LABELS[a.resolution] : "Rouverte";
  const intro =
    a.resolution === "declined"
      ? "Après étude, nous ne retiendrons pas cette demande pour le moment."
      : a.resolution === "closed"
        ? "Cette demande a été fermée."
        : "Cette demande a été rouverte : l’équipe s’en occupe à nouveau.";
  return {
    subject: `Votre demande #${a.number} : ${label}`,
    html: layout(`Demande ${label.toLowerCase()}`, `
      ${hello(a.name)}
      <p>${intro}</p>
      <p><strong>${escapeHtml(a.subject)}</strong></p>
      ${quote(a.reason)}
      ${button(a.url, "Voir la demande")}`),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `./node_modules/.bin/tsx --test src/lib/support-emails.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected: PASS and exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email-layout.ts src/lib/email.ts src/lib/support-emails.ts src/lib/support-emails.test.ts
git commit -m "feat(support): e-mail templates for requests, replies and steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server core, private image route, account deletion hook

**Files:**
- Create: `src/server/support-core.ts`, `src/app/api/support/attachments/[id]/route.ts`
- Modify: `next.config.ts`, `src/server/admin.ts` (`deleteUser`)

**Interfaces:**
- Consumes: tables from Task 3, `ATTACHMENT_EXTENSIONS`/`AttachmentType` and the support types from Task 2, `sendEmail` (`@/lib/email`), `isSuspended` (`@/lib/suspension`), `getAdminUser` (`@/lib/admin`), `getSession` (`@/lib/session`).
- Produces (server-only, `@/server/support-core`):
  - `imageFiles(formData: FormData): File[]`
  - `countRecentRequests(userId: string): Promise<number>`, `countRecentMessages(userId: string): Promise<number>`
  - `insertMessage(values: { requestId: string; authorId: string | null; authorRole: SupportAuthorRole; kind?: SupportMessageKind; body?: string; stage?: SupportStage | null; resolution?: SupportResolution | null }): Promise<string>` (returns the message id)
  - `storeAttachments(requesterId: string, messageId: string, files: readonly File[]): Promise<number>` (returns the number of failures)
  - `uploadWarning(failed: number): string | undefined`
  - `deleteSupportFiles(userId: string): Promise<void>`
  - `markReadByUser(userId: string, requestId: string): Promise<void>`, `markReadByAdmin(requestId: string): Promise<void>`
  - `emailAdmins(mail: { subject: string; html: string }): Promise<void>`
  - `requestUrl(id: string): string` (`/aide/demandes/<id>`), `adminRequestUrl(id: string): string` (`/admin/support/<id>`)
- Produces: `GET /api/support/attachments/<attachmentId>`.

- [ ] **Step 0: Declare the support Blob store in `src/lib/env.ts`**

In the zod `schema`, right after `BLOB_READ_WRITE_TOKEN: z.string().optional(),` add:

```ts
  // dedicated private store for support screenshots (Vercel prefix SUPPORT_BLOB)
  SUPPORT_BLOB_READ_WRITE_TOKEN: z.string().optional(),
```

In the exported `env` object, right after the `BLOB_ENABLED` entry add:

```ts
  /** Support screenshots: private Blob store, separate from the public branding one. */
  SUPPORT_BLOB_ENABLED: !isPlaceholder(raw.SUPPORT_BLOB_READ_WRITE_TOKEN),
```

- [ ] **Step 1: Raise the Server Action body limit**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Support requests send up to 3 images of 5 MB through Server Actions.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
```

- [ ] **Step 2: Create `src/server/support-core.ts`**

```ts
import "server-only";

import { del, list, put } from "@vercel/blob";
import { and, count, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { supportAttachment, supportMessage, supportRequest, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { isSuspended } from "@/lib/suspension";
import {
  ATTACHMENT_EXTENSIONS,
  type AttachmentType,
  type SupportAuthorRole,
  type SupportMessageKind,
  type SupportResolution,
  type SupportStage,
} from "@/lib/support";

/**
 * Server-only building blocks shared by the user and admin support actions:
 * rate counts, thread writes, private image storage, read marks and the
 * admin e-mail fan-out. Neon HTTP has no interactive transactions, so callers
 * write in an order where a partial failure leaves a readable thread.
 */

const DAY_MS = 86_400_000;

/** The non-empty files of the "images" field (an empty file input sends one empty File). */
export function imageFiles(formData: FormData): File[] {
  return formData
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

export async function countRecentRequests(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportRequest)
    .where(
      and(
        eq(supportRequest.userId, userId),
        gte(supportRequest.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return row?.value ?? 0;
}

export async function countRecentMessages(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportMessage)
    .where(
      and(
        eq(supportMessage.authorId, userId),
        eq(supportMessage.authorRole, "user"),
        gte(supportMessage.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return row?.value ?? 0;
}

export async function insertMessage(values: {
  requestId: string;
  authorId: string | null;
  authorRole: SupportAuthorRole;
  kind?: SupportMessageKind;
  body?: string;
  stage?: SupportStage | null;
  resolution?: SupportResolution | null;
}): Promise<string> {
  const [row] = await db
    .insert(supportMessage)
    .values({
      requestId: values.requestId,
      authorId: values.authorId,
      authorRole: values.authorRole,
      kind: values.kind ?? "message",
      body: values.body ?? "",
      stage: values.stage ?? null,
      resolution: values.resolution ?? null,
    })
    .returning({ id: supportMessage.id });
  return row.id;
}

/**
 * Uploads images as private blobs in the requester's folder (deleting the
 * account removes the folder), then records them. Best effort per file: the
 * message is already saved, so a failure is counted and logged, not thrown.
 */
export async function storeAttachments(
  requesterId: string,
  messageId: string,
  files: readonly File[],
): Promise<number> {
  if (!env.SUPPORT_BLOB_ENABLED) return files.length;
  let failed = 0;
  for (const file of files) {
    try {
      const ext = ATTACHMENT_EXTENSIONS[file.type as AttachmentType];
      const blob = await put(`support/${requesterId}/${nanoid()}.${ext}`, file, {
        access: "private",
        contentType: file.type,
        token: env.SUPPORT_BLOB_READ_WRITE_TOKEN,
      });
      await db.insert(supportAttachment).values({
        messageId,
        pathname: blob.pathname,
        contentType: file.type,
        size: file.size,
      });
    } catch (err) {
      failed += 1;
      console.error("[support] image upload failed", err);
    }
  }
  return failed;
}

export function uploadWarning(failed: number): string | undefined {
  if (failed === 0) return undefined;
  return failed === 1
    ? "1 image n’a pas pu être envoyée."
    : `${failed} images n’ont pas pu être envoyées.`;
}

/** Best effort, once the account is deleted: removes support/<userId>/. */
export async function deleteSupportFiles(userId: string): Promise<void> {
  if (!env.SUPPORT_BLOB_ENABLED) return;
  try {
    const prefix = `support/${userId}/`;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token: env.SUPPORT_BLOB_READ_WRITE_TOKEN });
      if (page.blobs.length) {
        await del(
          page.blobs.map((b) => b.url),
          { token: env.SUPPORT_BLOB_READ_WRITE_TOKEN },
        );
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`[support] could not delete the images of ${userId}`, err);
  }
}

export async function markReadByUser(userId: string, requestId: string): Promise<void> {
  await db
    .update(supportRequest)
    .set({ unreadByUser: false })
    .where(and(eq(supportRequest.id, requestId), eq(supportRequest.userId, userId)));
}

export async function markReadByAdmin(requestId: string): Promise<void> {
  await db
    .update(supportRequest)
    .set({ unreadByAdmin: false })
    .where(eq(supportRequest.id, requestId));
}

/** Sends `mail` to every active admin. Never throws. */
export async function emailAdmins(mail: { subject: string; html: string }): Promise<void> {
  try {
    const admins = await db
      .select({ email: user.email, banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(eq(user.role, "admin"));
    await Promise.all(
      admins.filter((a) => !isSuspended(a)).map((a) => sendEmail({ to: a.email, ...mail })),
    );
  } catch (err) {
    console.error("[support] admin notification failed", err);
  }
}

export function requestUrl(id: string): string {
  return `${env.APP_URL}/aide/demandes/${id}`;
}

export function adminRequestUrl(id: string): string {
  return `${env.APP_URL}/admin/support/${id}`;
}
```

- [ ] **Step 3: Create the private image route**

Create `src/app/api/support/attachments/[id]/route.ts`:

```ts
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { supportAttachment, supportMessage, supportRequest } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

/**
 * Streams a support screenshot (private Blob) to the request's owner or to an
 * admin. Anyone else gets the same 404 as a missing image.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const notFound = () => new Response("Not found", { status: 404 });

  const session = await getSession();
  if (!session || !env.SUPPORT_BLOB_ENABLED) return notFound();

  const [row] = await db
    .select({
      pathname: supportAttachment.pathname,
      contentType: supportAttachment.contentType,
      ownerId: supportRequest.userId,
    })
    .from(supportAttachment)
    .innerJoin(supportMessage, eq(supportMessage.id, supportAttachment.messageId))
    .innerJoin(supportRequest, eq(supportRequest.id, supportMessage.requestId))
    .where(eq(supportAttachment.id, id))
    .limit(1);
  if (!row) return notFound();
  if (row.ownerId !== session.user.id && !(await getAdminUser())) return notFound();

  const blob = await get(row.pathname, {
    access: "private",
    token: env.SUPPORT_BLOB_READ_WRITE_TOKEN,
  });
  if (!blob || blob.statusCode !== 200) return notFound();

  return new Response(blob.stream, {
    headers: {
      "Content-Type": row.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 4: Delete support images with the account**

In `src/server/admin.ts`:

1. Add the import (with the other `@/server` / `@/lib` imports):

```ts
import { deleteSupportFiles } from "@/server/support-core";
```

2. In `deleteUser`, right after `if (target.proId) await deleteBrandingImages(target.proId);`, add:

```ts
  await deleteSupportFiles(target.id);
```

3. Update the doc comment of `deleteUser` (the sentence listing what is removed) to mention support requests and their images: append `Support requests cascade too; their images (Blob support/<userId>/) are removed best effort.`

- [ ] **Step 5: Typecheck and lint**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/server/support-core.ts src/server/admin.ts "src/app/api/support" next.config.ts`
Expected: exit 0, no errors. (If `blob.stream` is reported as possibly null, the `statusCode !== 200` guard did not narrow the union: replace the guard with `if (!blob || blob.statusCode !== 200 || !blob.stream) return notFound();`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts next.config.ts src/server/support-core.ts "src/app/api/support/attachments/[id]/route.ts" src/server/admin.ts
git commit -m "feat(support): server core, private image route, cleanup on account deletion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Read queries

**Files:**
- Create: `src/server/support-queries.ts`

**Interfaces:**
- Consumes: tables (Task 3), `INBOX_PAGE_SIZE`, `InboxFilter`, `isHelpIcon`, types (Task 2).
- Produces (`@/server/support-queries`, server-only; client components may `import type` from it):
  - types `SupportRequestRow`, `ThreadMessage`, `FaqArticle`, `FaqCategory`, `InboxRow`, `AdminRequestDetail`
  - `getPublishedFaq(): Promise<FaqCategory[]>`, `getFaqForAdmin(): Promise<FaqCategory[]>`
  - `getMyRequests(userId): Promise<SupportRequestRow[]>`, `getMyRequest(userId, id): Promise<{ request: SupportRequestRow; thread: ThreadMessage[] } | null>`, `hasUnreadSupport(userId): Promise<boolean>`
  - `getSupportInbox({ filter, type, page }): Promise<{ rows: InboxRow[]; total: number }>`, `countSupportToHandle(): Promise<number>`, `getDevBoard(): Promise<InboxRow[]>`, `getSupportRequestForAdmin(id): Promise<AdminRequestDetail | null>`

- [ ] **Step 1: Create `src/server/support-queries.ts`**

```ts
import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  helpArticle,
  helpCategory,
  professional,
  supportAttachment,
  supportMessage,
  supportRequest,
  user,
} from "@/lib/db/schema";
import {
  INBOX_PAGE_SIZE,
  isHelpIcon,
  type HelpIcon,
  type InboxFilter,
  type SupportAuthorRole,
  type SupportMessageKind,
  type SupportResolution,
  type SupportStage,
  type SupportType,
} from "@/lib/support";

export type SupportRequestRow = typeof supportRequest.$inferSelect;

export type ThreadMessage = {
  id: string;
  authorRole: SupportAuthorRole;
  authorName: string | null;
  kind: SupportMessageKind;
  body: string;
  stage: SupportStage | null;
  resolution: SupportResolution | null;
  createdAt: Date;
  attachments: { id: string; contentType: string }[];
};

export type FaqArticle = {
  id: string;
  question: string;
  answer: string;
  position: number;
  published: boolean;
};

export type FaqCategory = {
  id: string;
  title: string;
  slug: string;
  icon: HelpIcon;
  position: number;
  articles: FaqArticle[];
};

export type InboxRow = SupportRequestRow & { authorName: string; authorEmail: string };

export type AdminRequestDetail = {
  request: SupportRequestRow;
  author: {
    id: string;
    name: string;
    email: string;
    proSlug: string | null;
    businessName: string | null;
  };
  thread: ThreadMessage[];
};

/* ── FAQ ── */

async function loadFaq(publishedOnly: boolean): Promise<FaqCategory[]> {
  const [categories, articles] = await Promise.all([
    db
      .select()
      .from(helpCategory)
      .orderBy(asc(helpCategory.position), asc(helpCategory.createdAt)),
    db
      .select()
      .from(helpArticle)
      .where(publishedOnly ? eq(helpArticle.published, true) : undefined)
      .orderBy(asc(helpArticle.position), asc(helpArticle.createdAt)),
  ]);
  return categories.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    icon: isHelpIcon(c.icon) ? c.icon : "help",
    position: c.position,
    articles: articles
      .filter((a) => a.categoryId === c.id)
      .map((a) => ({
        id: a.id,
        question: a.question,
        answer: a.answer,
        position: a.position,
        published: a.published,
      })),
  }));
}

/** Public FAQ: published articles only; empty categories are left out. */
export async function getPublishedFaq(): Promise<FaqCategory[]> {
  return (await loadFaq(true)).filter((c) => c.articles.length > 0);
}

export function getFaqForAdmin(): Promise<FaqCategory[]> {
  return loadFaq(false);
}

/* ── Requester side ── */

export async function getMyRequests(userId: string): Promise<SupportRequestRow[]> {
  return db
    .select()
    .from(supportRequest)
    .where(eq(supportRequest.userId, userId))
    .orderBy(desc(supportRequest.lastActivityAt), desc(supportRequest.id));
}

/** The request with its thread, or null when it does not exist or is someone else's. */
export async function getMyRequest(
  userId: string,
  id: string,
): Promise<{ request: SupportRequestRow; thread: ThreadMessage[] } | null> {
  const [request] = await db
    .select()
    .from(supportRequest)
    .where(and(eq(supportRequest.id, id), eq(supportRequest.userId, userId)))
    .limit(1);
  if (!request) return null;
  return { request, thread: await getThread(id) };
}

export async function hasUnreadSupport(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: supportRequest.id })
    .from(supportRequest)
    .where(and(eq(supportRequest.userId, userId), eq(supportRequest.unreadByUser, true)))
    .limit(1);
  return Boolean(row);
}

async function getThread(requestId: string): Promise<ThreadMessage[]> {
  const messages = await db
    .select({
      id: supportMessage.id,
      authorRole: supportMessage.authorRole,
      authorName: user.name,
      kind: supportMessage.kind,
      body: supportMessage.body,
      stage: supportMessage.stage,
      resolution: supportMessage.resolution,
      createdAt: supportMessage.createdAt,
    })
    .from(supportMessage)
    .leftJoin(user, eq(user.id, supportMessage.authorId))
    .where(eq(supportMessage.requestId, requestId))
    .orderBy(asc(supportMessage.createdAt), asc(supportMessage.id));
  if (messages.length === 0) return [];
  const attachments = await db
    .select({
      id: supportAttachment.id,
      messageId: supportAttachment.messageId,
      contentType: supportAttachment.contentType,
    })
    .from(supportAttachment)
    .where(inArray(supportAttachment.messageId, messages.map((m) => m.id)))
    .orderBy(asc(supportAttachment.createdAt));
  return messages.map((m) => ({
    ...m,
    attachments: attachments
      .filter((a) => a.messageId === m.id)
      .map(({ id, contentType }) => ({ id, contentType })),
  }));
}

/* ── Admin side ── */

const FINAL_STAGES: SupportStage[] = ["resolved", "delivered"];

function inboxCondition(filter: InboxFilter): SQL | undefined {
  switch (filter) {
    case "todo":
      return or(
        eq(supportRequest.unreadByAdmin, true),
        and(eq(supportRequest.stage, "received"), isNull(supportRequest.resolution)),
      );
    case "open":
      return and(isNull(supportRequest.resolution), notInArray(supportRequest.stage, FINAL_STAGES));
    case "done":
      return or(isNotNull(supportRequest.resolution), inArray(supportRequest.stage, FINAL_STAGES));
    case "all":
      return undefined;
  }
}

export async function getSupportInbox(opts: {
  filter: InboxFilter;
  type: SupportType | null;
  page: number;
}): Promise<{ rows: InboxRow[]; total: number }> {
  const where = and(
    inboxCondition(opts.filter),
    opts.type ? eq(supportRequest.type, opts.type) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db
      .select({ request: supportRequest, authorName: user.name, authorEmail: user.email })
      .from(supportRequest)
      .innerJoin(user, eq(user.id, supportRequest.userId))
      .where(where)
      // unread first; id breaks ties so offset paging never repeats a row
      .orderBy(
        desc(supportRequest.unreadByAdmin),
        desc(supportRequest.lastActivityAt),
        desc(supportRequest.id),
      )
      .limit(INBOX_PAGE_SIZE)
      .offset((opts.page - 1) * INBOX_PAGE_SIZE),
    db.select({ value: count() }).from(supportRequest).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.request, authorName: r.authorName, authorEmail: r.authorEmail })),
    total: totals[0]?.value ?? 0,
  };
}

/** Badge of the admin sidebar: what the "À traiter" filter lists. */
export async function countSupportToHandle(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(supportRequest)
    .where(inboxCondition("todo"));
  return row?.value ?? 0;
}

/** Live development requests; delivered ones stay on the board for 30 days. */
export async function getDevBoard(): Promise<InboxRow[]> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ request: supportRequest, authorName: user.name, authorEmail: user.email })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .where(
      and(
        eq(supportRequest.track, "development"),
        isNull(supportRequest.resolution),
        or(ne(supportRequest.stage, "delivered"), gt(supportRequest.lastActivityAt, monthAgo)),
      ),
    )
    .orderBy(asc(supportRequest.createdAt));
  return rows.map((r) => ({ ...r.request, authorName: r.authorName, authorEmail: r.authorEmail }));
}

export async function getSupportRequestForAdmin(id: string): Promise<AdminRequestDetail | null> {
  const [row] = await db
    .select({
      request: supportRequest,
      authorId: user.id,
      authorName: user.name,
      authorEmail: user.email,
      proSlug: professional.slug,
      businessName: professional.businessName,
    })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(eq(supportRequest.id, id))
    .limit(1);
  if (!row) return null;
  return {
    request: row.request,
    author: {
      id: row.authorId,
      name: row.authorName,
      email: row.authorEmail,
      proSlug: row.proSlug,
      businessName: row.businessName,
    },
    thread: await getThread(id),
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/server/support-queries.ts`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/server/support-queries.ts
git commit -m "feat(support): read queries for the help center and the admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: User actions (`src/server/support.ts`)

**Files:**
- Create: `src/server/support.ts`

**Interfaces:**
- Consumes: Task 2 rules, Task 5 templates, Task 6 core.
- Produces (`"use server"`, `@/server/support`):
  - `type SupportActionResult = { ok: true; warning?: string } | { ok: false; error: string }`
  - `type CreateRequestResult = { ok: true; id: string; warning?: string } | { ok: false; error: string }`
  - `createSupportRequest(formData: FormData): Promise<CreateRequestResult>` — fields `type`, `subject`, `body`, `images` (0..3 files)
  - `replyToSupportRequest(formData: FormData): Promise<SupportActionResult>` — fields `requestId`, `body`, `images`

- [ ] **Step 1: Create `src/server/support.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { supportRequest } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import {
  MAX_BODY,
  MAX_MESSAGES_PER_DAY,
  MAX_REQUESTS_PER_DAY,
  MAX_SUBJECT,
  SUPPORT_TYPES,
  canUserReply,
  checkAttachments,
  stageAfterUserReply,
} from "@/lib/support";
import { supportNewRequestEmail, supportUserReplyEmail } from "@/lib/support-emails";
import {
  adminRequestUrl,
  countRecentMessages,
  countRecentRequests,
  emailAdmins,
  imageFiles,
  insertMessage,
  storeAttachments,
  uploadWarning,
} from "@/server/support-core";

export type SupportActionResult = { ok: true; warning?: string } | { ok: false; error: string };
export type CreateRequestResult =
  | { ok: true; id: string; warning?: string }
  | { ok: false; error: string };

type Requester = { id: string; name: string; email: string };

/** The signed-in user, unless an admin is impersonating them (never write in someone's name). */
async function requester(): Promise<Requester | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Connectez-vous pour continuer." };
  if (session.session.impersonatedBy) {
    return { error: "Action désactivée pendant une connexion en tant que ce compte." };
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Données invalides.";

const createSchema = z.object({
  type: z.enum(SUPPORT_TYPES, { error: "Choisissez le type de demande." }),
  subject: z
    .string()
    .transform(oneLine)
    .pipe(
      z
        .string()
        .min(3, "Le sujet est trop court.")
        .max(MAX_SUBJECT, `Le sujet ne doit pas dépasser ${MAX_SUBJECT} caractères.`),
    ),
  body: z
    .string()
    .trim()
    .min(10, "Décrivez votre demande en quelques mots de plus.")
    .max(MAX_BODY, "Votre message est trop long."),
});

const replySchema = z.object({
  requestId: z.string().min(1, "Demande introuvable."),
  body: z.string().trim().max(MAX_BODY, "Votre message est trop long."),
});

export async function createSupportRequest(formData: FormData): Promise<CreateRequestResult> {
  const me = await requester();
  if ("error" in me) return { ok: false, error: me.error };

  const parsed = createSchema.safeParse({
    type: formData.get("type"),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const files = imageFiles(formData);
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  try {
    if ((await countRecentRequests(me.id)) >= MAX_REQUESTS_PER_DAY) {
      return {
        ok: false,
        error: `Vous avez atteint la limite de ${MAX_REQUESTS_PER_DAY} demandes par jour. Réessayez demain.`,
      };
    }
    const { type, subject, body } = parsed.data;
    // Request, then its first message, then the images: each step keeps a readable thread.
    const [created] = await db
      .insert(supportRequest)
      .values({ userId: me.id, type, subject })
      .returning({ id: supportRequest.id, number: supportRequest.number });
    const messageId = await insertMessage({
      requestId: created.id,
      authorId: me.id,
      authorRole: "user",
      body,
    });
    const failed = await storeAttachments(me.id, messageId, files);
    await emailAdmins(
      supportNewRequestEmail({
        number: created.number,
        subject,
        type,
        authorName: me.name,
        authorEmail: me.email,
        body,
        url: adminRequestUrl(created.id),
      }),
    );
    revalidatePath("/aide/demandes");
    revalidatePath("/admin/support");
    return { ok: true, id: created.id, warning: uploadWarning(failed) };
  } catch (err) {
    console.error("[support] request creation failed", err);
    return { ok: false, error: "Impossible d’envoyer la demande. Réessayez." };
  }
}

export async function replyToSupportRequest(formData: FormData): Promise<SupportActionResult> {
  const me = await requester();
  if ("error" in me) return { ok: false, error: me.error };

  const parsed = replySchema.safeParse({
    requestId: String(formData.get("requestId") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const files = imageFiles(formData);
  if (!parsed.data.body && files.length === 0) {
    return { ok: false, error: "Écrivez un message ou joignez une image." };
  }
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  try {
    const [request] = await db
      .select()
      .from(supportRequest)
      .where(and(eq(supportRequest.id, parsed.data.requestId), eq(supportRequest.userId, me.id)))
      .limit(1);
    if (!request) return { ok: false, error: "Demande introuvable." };
    if (!canUserReply(request)) return { ok: false, error: "Cette demande est fermée." };
    if ((await countRecentMessages(me.id)) >= MAX_MESSAGES_PER_DAY) {
      return { ok: false, error: "Vous avez envoyé beaucoup de messages aujourd’hui. Réessayez demain." };
    }

    const messageId = await insertMessage({
      requestId: request.id,
      authorId: me.id,
      authorRole: "user",
      body: parsed.data.body,
    });
    const failed = await storeAttachments(me.id, messageId, files);
    const stage = stageAfterUserReply(request);
    await db
      .update(supportRequest)
      .set({ stage, unreadByAdmin: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    if (stage !== request.stage) {
      // a reply on a resolved request reopens it: show it in the thread
      await insertMessage({
        requestId: request.id,
        authorId: null,
        authorRole: "system",
        kind: "stage_change",
        stage,
      });
    }
    await emailAdmins(
      supportUserReplyEmail({
        number: request.number,
        subject: request.subject,
        authorName: me.name,
        body: parsed.data.body || "(image jointe)",
        url: adminRequestUrl(request.id),
      }),
    );
    revalidatePath(`/aide/demandes/${request.id}`);
    revalidatePath("/aide/demandes");
    revalidatePath("/admin/support");
    return { ok: true, warning: uploadWarning(failed) };
  } catch (err) {
    console.error("[support] reply failed", err);
    return { ok: false, error: "Impossible d’envoyer le message. Réessayez." };
  }
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/server/support.ts`
Expected: exit 0. If zod reports that `z.enum(SUPPORT_TYPES, { error: … })` does not accept the readonly tuple or the `error` key, check `node_modules/zod/package.json` (the project uses zod 4: `z.flattenError` exists in `src/lib/env.ts`) and use `z.enum([...SUPPORT_TYPES] as [string, ...string[]])` only as a last resort, keeping the message.

- [ ] **Step 3: Commit**

```bash
git add src/server/support.ts
git commit -m "feat(support): user actions to open and answer a request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin actions (`src/server/support-admin.ts`)

**Files:**
- Create: `src/server/support-admin.ts`

**Interfaces:**
- Consumes: Task 2 rules (`canSetStage`, `canAcceptForDevelopment`, `stageAfterAdminReply`, `isValidEta`, `moveInList`, `HELP_ICONS`, `SUPPORT_STAGES`, `SUPPORT_RESOLUTIONS`, `MAX_BODY`, `checkAttachments`), Task 5 templates, Task 6 core, `getAdminUser`, `slugify` (`@/lib/utils`).
- Produces (`"use server"`, `@/server/support-admin`), all returning `Promise<AdminSupportResult>` where `type AdminSupportResult = { ok: true; warning?: string } | { ok: false; error: string }`:
  - `adminReply(formData: FormData)` — fields `requestId`, `body`, `images`
  - `setSupportStage(input: { id: string; stage: SupportStage })`
  - `acceptForDevelopment(input: { id: string; eta: string | null })`
  - `setSupportEta(input: { id: string; eta: string | null })`
  - `resolveSupportRequest(input: { id: string; resolution: SupportResolution; reason: string })`
  - `reopenSupportRequest(input: { id: string })`
  - `saveHelpCategory(input: { id?: string; title: string; icon: string })`, `deleteHelpCategory(input: { id: string })`, `moveHelpCategory(input: { id: string; direction: "up" | "down" })`
  - `saveHelpArticle(input: { id?: string; categoryId: string; question: string; answer: string; published: boolean })`, `deleteHelpArticle(input: { id: string })`, `setHelpArticlePublished(input: { id: string; published: boolean })`, `moveHelpArticle(input: { id: string; direction: "up" | "down" })`

- [ ] **Step 1: Create `src/server/support-admin.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";

import { getAdminUser, type AdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { helpArticle, helpCategory, supportRequest, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import {
  HELP_ICONS,
  MAX_BODY,
  SUPPORT_RESOLUTIONS,
  SUPPORT_STAGES,
  canAcceptForDevelopment,
  canSetStage,
  checkAttachments,
  isValidEta,
  moveInList,
  stageAfterAdminReply,
  type SupportResolution,
  type SupportStage,
} from "@/lib/support";
import {
  supportAdminReplyEmail,
  supportResolutionEmail,
  supportStageEmail,
} from "@/lib/support-emails";
import { slugify } from "@/lib/utils";
import {
  imageFiles,
  insertMessage,
  requestUrl,
  storeAttachments,
  uploadWarning,
} from "@/server/support-core";

export type AdminSupportResult = { ok: true; warning?: string } | { ok: false; error: string };

type Loaded = {
  admin: AdminUser;
  request: typeof supportRequest.$inferSelect;
  requester: { name: string; email: string };
};

/** The caller must be an active admin (re-read from the DB) and the request must exist. */
async function load(id: string): Promise<Loaded | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Accès refusé." };
  const [row] = await db
    .select({ request: supportRequest, name: user.name, email: user.email })
    .from(supportRequest)
    .innerJoin(user, eq(user.id, supportRequest.userId))
    .where(eq(supportRequest.id, id))
    .limit(1);
  if (!row) return { error: "Demande introuvable." };
  return { admin, request: row.request, requester: { name: row.name, email: row.email } };
}

function refresh(id: string) {
  revalidatePath("/admin/support");
  revalidatePath("/admin/support/developpements");
  revalidatePath(`/admin/support/${id}`);
  revalidatePath("/aide/demandes");
  revalidatePath(`/aide/demandes/${id}`);
}

function failure(err: unknown): AdminSupportResult {
  console.error("[support-admin] action failed", err);
  return { ok: false, error: "Action impossible. Réessayez." };
}

/* ── Requests ── */

export async function adminReply(formData: FormData): Promise<AdminSupportResult> {
  const id = String(formData.get("requestId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const files = imageFiles(formData);
  if (!body && files.length === 0) {
    return { ok: false, error: "Écrivez un message ou joignez une image." };
  }
  if (body.length > MAX_BODY) return { ok: false, error: "Message trop long." };
  const check = checkAttachments(files);
  if (!check.ok) return check;
  if (files.length && !env.SUPPORT_BLOB_ENABLED) {
    return { ok: false, error: "L’envoi d’images n’est pas disponible." };
  }

  const loaded = await load(id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  try {
    const stage = stageAfterAdminReply(request);
    if (stage !== request.stage) {
      // the first answer means the request is being handled
      await insertMessage({ requestId: id, authorId: admin.id, authorRole: "admin", kind: "stage_change", stage });
    }
    const messageId = await insertMessage({ requestId: id, authorId: admin.id, authorRole: "admin", body });
    const failed = await storeAttachments(request.userId, messageId, files);
    await db
      .update(supportRequest)
      .set({ stage, unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, id));
    await sendEmail({
      to: requester.email,
      ...supportAdminReplyEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        body: body || "(image jointe)",
        url: requestUrl(id),
      }),
    });
    refresh(id);
    return { ok: true, warning: uploadWarning(failed) };
  } catch (err) {
    return failure(err);
  }
}

export async function setSupportStage(input: {
  id: string;
  stage: SupportStage;
}): Promise<AdminSupportResult> {
  if (!(SUPPORT_STAGES as readonly string[]).includes(input.stage)) {
    return { ok: false, error: "Étape inconnue." };
  }
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (request.resolution) return { ok: false, error: "Rouvrez d’abord la demande." };
  if (!canSetStage(request.track, input.stage)) {
    return { ok: false, error: "Cette étape n’existe pas pour ce suivi." };
  }
  if (input.stage === request.stage) return { ok: true };
  try {
    // guarded on the track: a concurrent "accept for development" wins
    const updated = await db
      .update(supportRequest)
      .set({ stage: input.stage, unreadByUser: true, lastActivityAt: new Date() })
      .where(and(eq(supportRequest.id, request.id), eq(supportRequest.track, request.track)))
      .returning({ id: supportRequest.id });
    if (updated.length === 0) {
      return { ok: false, error: "La demande a changé entre-temps. Rechargez la page." };
    }
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "stage_change",
      stage: input.stage,
    });
    await sendEmail({
      to: requester.email,
      ...supportStageEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        track: request.track,
        stage: input.stage,
        eta: request.eta,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function acceptForDevelopment(input: {
  id: string;
  eta: string | null;
}): Promise<AdminSupportResult> {
  const eta = input.eta || null;
  if (eta && !isValidEta(eta)) return { ok: false, error: "Date de livraison invalide." };
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (!canAcceptForDevelopment(request)) {
    return { ok: false, error: "Cette demande ne peut plus passer en développement." };
  }
  try {
    const updated = await db
      .update(supportRequest)
      .set({
        track: "development",
        stage: "accepted",
        eta,
        unreadByUser: true,
        lastActivityAt: new Date(),
      })
      .where(and(eq(supportRequest.id, request.id), eq(supportRequest.track, "support")))
      .returning({ id: supportRequest.id });
    if (updated.length === 0) {
      return { ok: false, error: "La demande a changé entre-temps. Rechargez la page." };
    }
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "stage_change",
      stage: "accepted",
    });
    await sendEmail({
      to: requester.email,
      ...supportStageEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        track: "development",
        stage: "accepted",
        eta,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function setSupportEta(input: {
  id: string;
  eta: string | null;
}): Promise<AdminSupportResult> {
  const eta = input.eta || null;
  if (eta && !isValidEta(eta)) return { ok: false, error: "Date de livraison invalide." };
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (loaded.request.track !== "development") {
    return { ok: false, error: "La date de livraison concerne les développements." };
  }
  try {
    await db.update(supportRequest).set({ eta }).where(eq(supportRequest.id, input.id));
    refresh(input.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function resolveSupportRequest(input: {
  id: string;
  resolution: SupportResolution;
  reason: string;
}): Promise<AdminSupportResult> {
  if (!(SUPPORT_RESOLUTIONS as readonly string[]).includes(input.resolution)) {
    return { ok: false, error: "Action inconnue." };
  }
  const reason = input.reason.trim().slice(0, MAX_BODY);
  if (input.resolution === "declined" && reason.length < 3) {
    return { ok: false, error: "Expliquez en quelques mots pourquoi la demande n’est pas retenue." };
  }
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (request.resolution) return { ok: false, error: "Cette demande est déjà terminée." };
  try {
    await db
      .update(supportRequest)
      .set({ resolution: input.resolution, unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "resolution",
      resolution: input.resolution,
      body: reason,
    });
    await sendEmail({
      to: requester.email,
      ...supportResolutionEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        resolution: input.resolution,
        reason,
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function reopenSupportRequest(input: { id: string }): Promise<AdminSupportResult> {
  const loaded = await load(input.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { admin, request, requester } = loaded;
  if (!request.resolution) return { ok: true };
  try {
    await db
      .update(supportRequest)
      .set({ resolution: null, unreadByUser: true, lastActivityAt: new Date() })
      .where(eq(supportRequest.id, request.id));
    await insertMessage({
      requestId: request.id,
      authorId: admin.id,
      authorRole: "admin",
      kind: "resolution",
      resolution: null,
    });
    await sendEmail({
      to: requester.email,
      ...supportResolutionEmail({
        name: requester.name,
        number: request.number,
        subject: request.subject,
        resolution: null,
        reason: "",
        url: requestUrl(request.id),
      }),
    });
    refresh(request.id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/* ── FAQ ── */

function refreshFaq() {
  revalidatePath("/aide");
  revalidatePath("/admin/support/faq");
}

const categorySchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(2, "Titre trop court.").max(80, "Titre trop long."),
  icon: z.enum(HELP_ICONS, { error: "Icône inconnue." }),
});

const articleSchema = z.object({
  id: z.string().min(1).optional(),
  categoryId: z.string().min(1, "Choisissez une rubrique."),
  question: z.string().trim().min(5, "Question trop courte.").max(200, "Question trop longue."),
  answer: z.string().trim().min(10, "Réponse trop courte.").max(MAX_BODY, "Réponse trop longue."),
  published: z.boolean(),
});

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Données invalides.";

async function uniqueCategorySlug(title: string): Promise<string> {
  const root = slugify(title) || "rubrique";
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const [taken] = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .where(eq(helpCategory.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
}

export async function saveHelpCategory(input: {
  id?: string;
  title: string;
  icon: string;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, title, icon } = parsed.data;
  try {
    if (id) {
      // the slug (anchor) stays stable when the title changes
      await db.update(helpCategory).set({ title, icon }).where(eq(helpCategory.id, id));
    } else {
      const [{ value: position }] = await db.select({ value: count() }).from(helpCategory);
      await db
        .insert(helpCategory)
        .values({ title, icon, slug: await uniqueCategorySlug(title), position });
    }
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteHelpCategory(input: { id: string }): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(helpArticle)
      .where(eq(helpArticle.categoryId, input.id));
    if (value > 0) return { ok: false, error: "Déplacez ou supprimez d’abord ses articles." };
    await db.delete(helpCategory).where(eq(helpCategory.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function moveHelpCategory(input: {
  id: string;
  direction: "up" | "down";
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const rows = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .orderBy(asc(helpCategory.position), asc(helpCategory.createdAt));
    const order = moveInList(rows.map((r) => r.id), input.id, input.direction);
    if (!order) return { ok: true };
    // renumber everything: also repairs duplicate positions
    await Promise.all(
      order.map((id, position) =>
        db.update(helpCategory).set({ position }).where(eq(helpCategory.id, id)),
      ),
    );
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function saveHelpArticle(input: {
  id?: string;
  categoryId: string;
  question: string;
  answer: string;
  published: boolean;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  const parsed = articleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, categoryId, question, answer, published } = parsed.data;
  try {
    const [category] = await db
      .select({ id: helpCategory.id })
      .from(helpCategory)
      .where(eq(helpCategory.id, categoryId))
      .limit(1);
    if (!category) return { ok: false, error: "Rubrique introuvable." };
    const countIn = async () => {
      const [{ value }] = await db
        .select({ value: count() })
        .from(helpArticle)
        .where(eq(helpArticle.categoryId, categoryId));
      return value;
    };
    if (id) {
      const [current] = await db
        .select({ categoryId: helpArticle.categoryId })
        .from(helpArticle)
        .where(eq(helpArticle.id, id))
        .limit(1);
      if (!current) return { ok: false, error: "Article introuvable." };
      // moved to another category: append it there
      const position = current.categoryId === categoryId ? undefined : await countIn();
      await db
        .update(helpArticle)
        .set({ categoryId, question, answer, published, ...(position === undefined ? {} : { position }) })
        .where(eq(helpArticle.id, id));
    } else {
      await db
        .insert(helpArticle)
        .values({ categoryId, question, answer, published, position: await countIn() });
    }
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteHelpArticle(input: { id: string }): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    await db.delete(helpArticle).where(eq(helpArticle.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function setHelpArticlePublished(input: {
  id: string;
  published: boolean;
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    await db
      .update(helpArticle)
      .set({ published: input.published })
      .where(eq(helpArticle.id, input.id));
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function moveHelpArticle(input: {
  id: string;
  direction: "up" | "down";
}): Promise<AdminSupportResult> {
  if (!(await getAdminUser())) return { ok: false, error: "Accès refusé." };
  try {
    const [article] = await db
      .select({ categoryId: helpArticle.categoryId })
      .from(helpArticle)
      .where(eq(helpArticle.id, input.id))
      .limit(1);
    if (!article) return { ok: false, error: "Article introuvable." };
    const rows = await db
      .select({ id: helpArticle.id })
      .from(helpArticle)
      .where(eq(helpArticle.categoryId, article.categoryId))
      .orderBy(asc(helpArticle.position), asc(helpArticle.createdAt));
    const order = moveInList(rows.map((r) => r.id), input.id, input.direction);
    if (!order) return { ok: true };
    await Promise.all(
      order.map((id, position) =>
        db.update(helpArticle).set({ position }).where(eq(helpArticle.id, id)),
      ),
    );
    refreshFaq();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
```

- [ ] **Step 2: Typecheck, lint, tests**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/server/support-admin.ts && ./node_modules/.bin/tsx --test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/server/support-admin.ts
git commit -m "feat(support): admin actions for requests, steps and the FAQ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shared support UI components

Visual direction (from the `design-taste-frontend` pass, already applied in the code below): product UI in the existing Skedul language (Bricolage display for headings, Geist body, single violet accent `--color-primary`, `rounded-2xl` cards with `shadow-(--shadow-card)`), light only, CSS-only motion that carries meaning: the progress fill grows in once, the current step pulses (both behind `motion-safe`).

**Files:**
- Create: `src/components/support/support-type.tsx`, `src/components/support/help-icon.tsx`, `src/components/support/back-link.tsx`, `src/components/support/stage-progress.tsx`, `src/components/support/faq-answer.tsx`, `src/components/support/attachment-grid.tsx`, `src/components/support/image-attach-input.tsx`, `src/components/support/message-thread.tsx`, `src/components/support/message-composer.tsx`
- Modify: `src/app/globals.css` (append two keyframes)

**Interfaces:**
- Consumes: Task 2 rules/labels, `ThreadMessage` type (Task 7, `import type` only), `formatDateTimeShort` (`@/lib/datetime`), `ADMIN_TZ` (`@/lib/analytics`), `initials`/`cn` (`@/lib/utils`), `Button` (`@/components/ui/button`).
- Produces:
  - `SupportTypeChip({ type, className? })`, `TYPE_ICONS: Record<SupportType, LucideIcon>`
  - `HELP_ICON_COMPONENTS: Record<HelpIcon, LucideIcon>`, `HELP_ICON_LABELS: Record<HelpIcon, string>`
  - `BackLink({ href, children })`
  - `StageProgress({ track, stage, resolution, reachedAt?, eta?, size?: "full" | "mini", className? })`
  - `FaqAnswer({ text, className? })`
  - `AttachmentGrid({ attachments: { id: string }[], className? })`
  - `ImageAttachInput({ images, onChange, disabled?, compact? })`, `type PickedImage = { file: File; url: string }`
  - `MessageThread({ thread, viewer: "user" | "admin", className? })`
  - `MessageComposer({ requestId, action, imagesEnabled, disabledReason?, placeholder?, className? })` where `action: (data: FormData) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>`

- [ ] **Step 1: Append the keyframes to `src/app/globals.css`**

At the very end of the file:

```css
/* Help center: the progress fill grows in once; a revealed form step fades up. */
@keyframes progress-grow {
  from {
    transform: scaleX(0);
  }
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
```

- [ ] **Step 2: Create `src/components/support/support-type.tsx`**

```tsx
import {
  Bug,
  LifeBuoy,
  Lightbulb,
  MessageCircleQuestionMark,
  type LucideIcon,
} from "lucide-react";

import { TYPE_LABELS, type SupportType } from "@/lib/support";
import { cn } from "@/lib/utils";

export const TYPE_ICONS: Record<SupportType, LucideIcon> = {
  question: MessageCircleQuestionMark,
  bug: Bug,
  feature: Lightbulb,
  other: LifeBuoy,
};

export function SupportTypeChip({ type, className }: { type: SupportType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {TYPE_LABELS[type]}
    </span>
  );
}
```

- [ ] **Step 3: Create `src/components/support/help-icon.tsx`**

```tsx
import {
  CalendarDays,
  CreditCard,
  LifeBuoy,
  Rocket,
  Settings,
  Sparkles,
  Ticket,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { HelpIcon } from "@/lib/support";

export const HELP_ICON_COMPONENTS: Record<HelpIcon, LucideIcon> = {
  rocket: Rocket,
  calendar: CalendarDays,
  ticket: Ticket,
  "credit-card": CreditCard,
  user: UserRound,
  settings: Settings,
  help: LifeBuoy,
  sparkles: Sparkles,
};

export const HELP_ICON_LABELS: Record<HelpIcon, string> = {
  rocket: "Fusée",
  calendar: "Calendrier",
  ticket: "Ticket",
  "credit-card": "Carte bancaire",
  user: "Compte",
  settings: "Réglages",
  help: "Bouée",
  sparkles: "Nouveauté",
};
```

- [ ] **Step 4: Create `src/components/support/back-link.tsx`**

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}
```

- [ ] **Step 5: Create `src/components/support/stage-progress.tsx`**

```tsx
import type { CSSProperties } from "react";
import { Check, Lock, X } from "lucide-react";

import {
  STAGE_LABELS,
  TRACK_STEPS,
  formatEta,
  statusLabel,
  stepIndex,
  type RequestState,
  type SupportStage,
} from "@/lib/support";
import { cn } from "@/lib/utils";

const DAY = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});

type Props = RequestState & {
  /** When each step was reached (`stageReachedAt`); full size only. */
  reachedAt?: Partial<Record<SupportStage, Date>>;
  /** Estimated delivery (YYYY-MM-DD), development track only. */
  eta?: string | null;
  size?: "full" | "mini";
  className?: string;
};

/**
 * A request's progress: 3 steps (support) or 6 (development). A declined or
 * closed request keeps its bar where it stopped, greyed out.
 */
export function StageProgress({
  track,
  stage,
  resolution,
  reachedAt = {},
  eta = null,
  size = "full",
  className,
}: Props) {
  const steps = TRACK_STEPS[track];
  const current = stepIndex(track, stage);
  const last = steps.length - 1;
  const ended = resolution !== null;
  const label = statusLabel({ track, stage, resolution });

  if (size === "mini") {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i > current ? "bg-border" : ended ? "bg-muted-foreground/40" : "bg-primary",
              )}
            />
          ))}
        </div>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {!ended && current < last && `, étape ${current + 1} sur ${steps.length}`}
        </p>
      </div>
    );
  }

  const fill = last > 0 ? (current / last) * 100 : 0;
  // the rail runs from the centre of the first column to the centre of the last
  const inset = `calc(100% / ${steps.length * 2})`;

  return (
    <section
      aria-label="Avancement de la demande"
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) sm:p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          className={cn(
            "flex items-center gap-2 font-display text-lg font-bold tracking-tight",
            ended && "text-muted-foreground",
          )}
        >
          {resolution === "declined" && <X className="size-4" aria-hidden />}
          {resolution === "closed" && <Lock className="size-4" aria-hidden />}
          {label}
        </p>
        {eta && !ended && track === "development" && current < last && (
          <p className="text-sm text-muted-foreground">
            Livraison estimée :{" "}
            <span className="font-medium text-foreground">{formatEta(eta)}</span>
          </p>
        )}
      </div>

      <div className="relative mt-6">
        <div
          aria-hidden
          className="absolute top-[11px] hidden h-0.5 rounded-full bg-border sm:block"
          style={{ left: inset, right: inset }}
        >
          <div
            className={cn(
              "h-full origin-left rounded-full motion-safe:animate-[progress-grow_900ms_cubic-bezier(0.16,1,0.3,1)_both]",
              ended ? "bg-muted-foreground/40" : "bg-primary",
            )}
            style={{ width: `${fill}%` }}
          />
        </div>
        <ol
          className="relative grid gap-3 sm:grid-cols-[repeat(var(--steps),minmax(0,1fr))] sm:gap-2"
          style={{ "--steps": steps.length } as CSSProperties}
        >
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const complete = i < current || (isCurrent && i === last);
            const date = i <= current ? reachedAt[s] : undefined;
            return (
              <li
                key={s}
                aria-current={isCurrent ? "step" : undefined}
                className="flex items-center gap-3 sm:flex-col sm:gap-2 sm:text-center"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-card",
                    complete
                      ? ended
                        ? "border-transparent bg-muted-foreground/40 text-white"
                        : "border-primary bg-primary text-primary-foreground"
                      : isCurrent
                        ? ended
                          ? "border-muted-foreground/40 text-muted-foreground"
                          : "border-primary text-primary"
                        : "border-border",
                  )}
                >
                  {complete ? (
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  ) : isCurrent && !ended ? (
                    <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
                  ) : isCurrent && resolution === "declined" ? (
                    <X className="size-3.5" strokeWidth={3} aria-hidden />
                  ) : isCurrent && resolution === "closed" ? (
                    <Lock className="size-3" aria-hidden />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-sm leading-tight",
                      isCurrent ? "font-semibold" : !complete && "text-muted-foreground",
                    )}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                  {date && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {isCurrent && !complete ? `depuis le ${DAY.format(date)}` : DAY.format(date)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Create `src/components/support/faq-answer.tsx`**

```tsx
import Link from "next/link";

import { parseAnswer, type AnswerSegment } from "@/lib/support";
import { cn } from "@/lib/utils";

const LINK =
  "font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary";

function Segments({ segments }: { segments: AnswerSegment[] }) {
  return segments.map((s, i) =>
    s.kind === "text" ? (
      <span key={i}>{s.text}</span>
    ) : s.href.startsWith("/") ? (
      <Link key={i} href={s.href} className={LINK}>
        {s.text}
      </Link>
    ) : (
      <a key={i} href={s.href} target="_blank" rel="noreferrer" className={LINK}>
        {s.text}
      </a>
    ),
  );
}

/** A FAQ answer: plain text parsed into paragraphs, lists and links, never raw HTML. */
export function FaqAnswer({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[0.9375rem] leading-relaxed text-muted-foreground", className)}>
      {parseAnswer(text).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i} className="max-w-[65ch]">
            <Segments segments={block.segments} />
          </p>
        ) : (
          <ul key={i} className="max-w-[65ch] list-disc space-y-1 pl-5 marker:text-primary">
            {block.items.map((item, j) => (
              <li key={j}>
                <Segments segments={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create `src/components/support/attachment-grid.tsx`**

```tsx
import { cn } from "@/lib/utils";

/** Thumbnails of a message's screenshots; each opens full size in a new tab. */
export function AttachmentGrid({
  attachments,
  className,
}: {
  attachments: { id: string }[];
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("mt-2 flex flex-wrap gap-2", className)}>
      {attachments.map((a, i) => (
        <a
          key={a.id}
          href={`/api/support/attachments/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="block size-24 overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked route */}
          <img
            src={`/api/support/attachments/${a.id}`}
            alt={`Capture d’écran ${i + 1}`}
            loading="lazy"
            className="size-full object-cover"
          />
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Create `src/components/support/image-attach-input.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

import { MAX_ATTACHMENTS, checkAttachments } from "@/lib/support";
import { cn } from "@/lib/utils";

export type PickedImage = { file: File; url: string };

/**
 * Picks up to 3 screenshots with previews. The parent owns the list and sends
 * the files; previews are revoked when removed or sent (any left are freed by
 * the browser when the page unloads).
 */
export function ImageAttachInput({
  images,
  onChange,
  disabled = false,
  compact = false,
}: {
  images: PickedImage[];
  onChange: (images: PickedImage[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const tile = compact ? "size-14" : "size-20";

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    const check = checkAttachments([...images.map((i) => i.file), ...picked]);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    onChange([...images, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  function remove(index: number) {
    URL.revokeObjectURL(images[index].url);
    setError(null);
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {images.map((image, i) => (
          <div
            key={image.url}
            className={cn("relative overflow-hidden rounded-xl border border-border bg-muted", tile)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
            <img src={image.url} alt={`Capture d’écran ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              aria-label={`Retirer la capture d’écran ${i + 1}`}
              className="absolute right-1 top-1 rounded-full bg-foreground/70 p-0.5 text-white transition-colors hover:bg-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {images.length < MAX_ATTACHMENTS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            aria-label="Ajouter une capture d’écran"
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50",
              tile,
            )}
          >
            <ImagePlus className="size-4" aria-hidden />
            {!compact && "Ajouter"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => add(e.target.files)}
      />
      {(error || !compact) && (
        <p
          role={error ? "alert" : undefined}
          className={cn("mt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ?? `Jusqu’à ${MAX_ATTACHMENTS} captures d’écran (png, jpg ou webp, 5 Mo maximum).`}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Create `src/components/support/message-thread.tsx`**

```tsx
import { CircleCheck, LifeBuoy, Lock, RotateCcw, X } from "lucide-react";

import { AttachmentGrid } from "@/components/support/attachment-grid";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { STAGE_LABELS } from "@/lib/support";
import { cn, initials } from "@/lib/utils";
import type { ThreadMessage } from "@/server/support-queries";

type Viewer = "user" | "admin";

/** The conversation: messages as bubbles, step and status changes as centred events. */
export function MessageThread({
  thread,
  viewer,
  className,
}: {
  thread: ThreadMessage[];
  viewer: Viewer;
  className?: string;
}) {
  return (
    <ol aria-label="Fil de la demande" className={cn("space-y-5", className)}>
      {thread.map((m) => (
        <li key={m.id}>
          {m.kind === "message" ? (
            <Bubble message={m} viewer={viewer} />
          ) : (
            <ThreadEvent message={m} viewer={viewer} />
          )}
        </li>
      ))}
    </ol>
  );
}

function authorLabel(m: ThreadMessage, viewer: Viewer): string {
  if (m.authorRole === "admin") return viewer === "user" ? "Équipe Skedul" : (m.authorName ?? "Admin");
  if (m.authorRole === "user") return viewer === "user" ? "Vous" : (m.authorName ?? "Compte supprimé");
  return "Skedul";
}

function Bubble({ message: m, viewer }: { message: ThreadMessage; viewer: Viewer }) {
  const mine = m.authorRole === viewer;
  const team = m.authorRole === "admin";
  return (
    <article className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          team ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {team && viewer === "user" ? <LifeBuoy className="size-4" /> : initials(m.authorName ?? "?")}
      </span>
      <div className={cn("min-w-0 max-w-[min(36rem,85%)]", mine && "flex flex-col items-end")}>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{authorLabel(m, viewer)}</span>,{" "}
          {formatDateTimeShort(m.createdAt, ADMIN_TZ)}
        </p>
        {m.body && (
          <div
            className={cn(
              "mt-1.5 whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed",
              mine ? "rounded-tr-md bg-primary-muted" : "rounded-tl-md border border-border bg-card",
            )}
          >
            {m.body}
          </div>
        )}
        <AttachmentGrid attachments={m.attachments} className={cn(mine && "justify-end")} />
      </div>
    </article>
  );
}

function ThreadEvent({ message: m, viewer }: { message: ThreadMessage; viewer: Viewer }) {
  let icon = <CircleCheck className="size-3.5" aria-hidden />;
  let text = "";
  if (m.kind === "stage_change" && m.stage) {
    text = `Étape «\u00a0${STAGE_LABELS[m.stage]}\u00a0»`;
  } else if (m.resolution === "declined") {
    icon = <X className="size-3.5" aria-hidden />;
    text = "Demande non retenue";
  } else if (m.resolution === "closed") {
    icon = <Lock className="size-3.5" aria-hidden />;
    text = "Demande fermée";
  } else {
    icon = <RotateCcw className="size-3.5" aria-hidden />;
    text = "Demande rouverte";
  }
  const by = viewer === "admin" && m.authorRole === "admin" && m.authorName ? ` par ${m.authorName}` : "";
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {icon}
        <span>
          <span className="font-medium text-foreground">{text}</span>
          {by}, {formatDateTimeShort(m.createdAt, ADMIN_TZ)}
        </span>
      </p>
      {m.body && (
        <p className="max-w-lg whitespace-pre-wrap rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {m.body}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Create `src/components/support/message-composer.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";

import { ImageAttachInput, type PickedImage } from "@/components/support/image-attach-input";
import { Button } from "@/components/ui/button";
import { MAX_BODY } from "@/lib/support";
import { cn } from "@/lib/utils";

type Result = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Reply box shared by the requester and the admin; `action` is the Server
 * Action to call (replyToSupportRequest or adminReply).
 */
export function MessageComposer({
  requestId,
  action,
  imagesEnabled,
  disabledReason = null,
  placeholder = "Votre réponse",
  className,
}: {
  requestId: string;
  action: (data: FormData) => Promise<Result>;
  imagesEnabled: boolean;
  disabledReason?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [notice, setNotice] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (disabledReason) {
    return (
      <p
        className={cn(
          "rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground",
          className,
        )}
      >
        {disabledReason}
      </p>
    );
  }

  const empty = !body.trim() && images.length === 0;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (empty || pending) return;
    const data = new FormData();
    data.set("requestId", requestId);
    data.set("body", body);
    images.forEach((i) => data.append("images", i.file));
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await action(data);
        if (!res.ok) {
          setNotice({ tone: "error", text: res.error });
          return;
        }
        images.forEach((i) => URL.revokeObjectURL(i.url));
        setBody("");
        setImages([]);
        if (res.warning) setNotice({ tone: "warning", text: res.warning });
        router.refresh();
      } catch {
        setNotice({ tone: "error", text: "Connexion perdue. Réessayez." });
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "rounded-2xl border border-border bg-card p-3 shadow-(--shadow-card) transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10",
        className,
      )}
    >
      <label htmlFor={`reply-${requestId}`} className="sr-only">
        Votre message
      </label>
      <textarea
        id={`reply-${requestId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") e.currentTarget.form?.requestSubmit();
        }}
        maxLength={MAX_BODY}
        rows={4}
        placeholder={placeholder}
        className="block w-full resize-y bg-transparent px-2 py-1.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3 px-1">
        {imagesEnabled ? (
          <ImageAttachInput images={images} onChange={setImages} disabled={pending} compact />
        ) : (
          <span />
        )}
        <Button type="submit" className="rounded-full" disabled={empty || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Envoyer
        </Button>
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("mt-2 px-2 text-sm", notice.tone === "error" ? "text-destructive" : "text-warning")}
        >
          {notice.text}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 11: Typecheck and lint**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/support`
Expected: exit 0. If an icon import fails (lucide 1.21 renamed it), find the current name with `grep -o "declare const [A-Za-z]*Question[A-Za-z]*" node_modules/lucide-react/dist/lucide-react.d.ts` (same idea for other icons) and use it.

- [ ] **Step 12: Commit**

```bash
git add src/app/globals.css src/components/support
git commit -m "feat(support): shared UI for progress, thread, composer and FAQ answers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Public help center (`/aide`)

**Files:**
- Create: `src/app/aide/help.module.css`, `src/app/aide/layout.tsx`, `src/app/aide/page.tsx`, `src/components/support/faq-browser.tsx`, `src/components/support/help-aside.tsx`
- Modify: `src/lib/analytics.ts` (+ `src/lib/analytics.test.ts`), `src/components/site-footer.tsx`, main checkout `C:\Users\Matheus\Documents\Codage\skedul\.claude\launch.json`

**Interfaces:**
- Consumes: `getPublishedFaq`, `getMyRequests`, `FaqCategory`/`FaqArticle`/`SupportRequestRow` types (Task 7), `matchArticles`, `isOpen` (Task 2), Task 10 components, `ctaPrimary`/`navPrimary` (`@/components/landing/cta`), `SiteHeader`, `SiteFooter`, `getSession`.
- Produces: route `/aide` (`?q=` pre-fills the search); anchors `#a-<articleId>` (opens the article) and `#rubrique-<slug>`; `SiteFooter({ note?: string | null })`.

- [ ] **Step 1: Reserve the route in analytics (tests first)**

In `src/lib/analytics.test.ts`:
1. In `isTrackedPath keeps public pages…`, add `"/aide"` to the first (tracked) list and `"/aide/demandes", "/aide/demandes/abc"` to the second (untracked) list.
2. In `isReservedSegment flags app routes…`, add `"aide"` to the first list and `"aides"` to the second list.

Run: `./node_modules/.bin/tsx --test src/lib/analytics.test.ts`
Expected: FAIL on `aide` / `/aide/demandes`.

Then in `src/lib/analytics.ts`:
- `const UNTRACKED_PREFIXES = ["/dashboard", "/onboarding", "/admin", "/api", "/_next", "/aide/demandes"];`
- add `"aide",` as the first entry of `RESERVED_SEGMENTS`.

Run: `./node_modules/.bin/tsx --test src/lib/analytics.test.ts`
Expected: PASS.

- [ ] **Step 2: Create `src/app/aide/help.module.css`**

```css
/* The help center is product UI built on the app primitives, which are light
 * only, so the whole section (header and footer included) is locked to the
 * light theme: a light-only copy of the landing's --lp-* tokens, scoped to
 * this layout. Keep the values in sync with
 * src/components/landing/landing.module.css. */

:global(html):has(.root) {
  --lp-paper: oklch(98.6% 0.005 285);
  --lp-paper-2: oklch(96.3% 0.009 285);
  --lp-surface: oklch(99.6% 0.003 285);
  --lp-ink: oklch(21% 0.025 285);
  --lp-ink-2: oklch(44% 0.02 285);
  --lp-ink-3: oklch(52% 0.02 285);
  --lp-rule: oklch(91% 0.012 285);
  --lp-rule-2: oklch(78% 0.018 285);
  --lp-accent: var(--color-primary);
  --lp-accent-hover: oklch(51% 0.22 284);
  --lp-accent-soft: oklch(95% 0.03 285);
  --lp-on-accent: oklch(99.5% 0.004 285);
  --lp-focus: var(--color-ring);
  --lp-shadow: oklch(32% 0.09 285 / 0.2);
  --lp-shadow-soft: oklch(32% 0.05 285 / 0.08);
  --lp-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --lp-radius: 1.25rem;

  background-color: var(--lp-paper);
  color-scheme: light;
}

.root {
  background: var(--lp-paper);
  color: var(--lp-ink);
}
```

Before saving, open `src/components/landing/landing.module.css` and check every value above against its first (light) token block; copy any value that differs from the landing file.

- [ ] **Step 3: Let pages drop the footer's landing-only note**

In `src/components/site-footer.tsx`:
1. Add the link: `{ href: "/aide", label: "Centre d’aide" },` as the second entry of `LINKS` (after "Voir la démo").
2. Change the signature to `export function SiteFooter({ note = "Les exemples de cette page utilisent des données fictives." }: { note?: string | null } = {}) {`
3. Replace `<p>Les exemples de cette page utilisent des données fictives.</p>` with `{note && <p>{note}</p>}`.

- [ ] **Step 4: Create `src/app/aide/layout.tsx`**

```tsx
import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

import styles from "./help.module.css";

export const metadata: Metadata = {
  title: { default: "Centre d’aide", template: "%s · Centre d’aide · Skedul" },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(styles.root, "flex min-h-full flex-1 flex-col")}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter note={null} />
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/support/help-aside.tsx`**

```tsx
import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { StageProgress } from "@/components/support/stage-progress";
import { Button } from "@/components/ui/button";
import type { SupportRequestRow } from "@/server/support-queries";

/** Right column of the /aide hero: the user's open requests, or the way to write to the team. */
export function HelpAside({
  signedIn,
  requests,
}: {
  signedIn: boolean;
  requests: SupportRequestRow[];
}) {
  if (requests.length > 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) sm:p-6">
        <h2 className="font-display text-lg font-bold tracking-tight">Vos demandes en cours</h2>
        <ul className="mt-4 space-y-4">
          {requests.map((r) => (
            <li key={r.id}>
              <Link href={`/aide/demandes/${r.id}`} className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                  {r.subject}
                </p>
                <StageProgress
                  size="mini"
                  track={r.track}
                  stage={r.stage}
                  resolution={r.resolution}
                  className="mt-2"
                />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button asChild size="sm" className={navPrimary}>
            <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
          </Button>
          <Link href="/aide/demandes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Toutes mes demandes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-accent p-6 sm:p-7">
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <LifeBuoy className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-xl font-bold tracking-tight">Une question sans réponse ?</h2>
      <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-(--lp-ink-2)">
        L’équipe Skedul lit chaque demande et vous répond ici, avec le suivi de son avancement.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button asChild size="sm" className={navPrimary}>
          <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
        </Button>
        {signedIn && (
          <Link href="/aide/demandes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Mes demandes
          </Link>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/support/faq-browser.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { FaqAnswer } from "@/components/support/faq-answer";
import { HELP_ICON_COMPONENTS } from "@/components/support/help-icon";
import { Button } from "@/components/ui/button";
import { matchArticles } from "@/lib/support";
import { cn } from "@/lib/utils";
import type { FaqArticle, FaqCategory } from "@/server/support-queries";

type ListedArticle = FaqArticle & { categoryTitle?: string };

const NEW_REQUEST = "/aide/demandes/nouvelle";

/**
 * /aide body: the hero with the live search (`aside` fills its right column),
 * then the categories and the FAQ as native <details> accordions.
 */
export function FaqBrowser({
  categories,
  initialQuery,
  aside,
}: {
  categories: FaqCategory[];
  initialQuery: string;
  aside: React.ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<string | null>(null);

  const all = useMemo<ListedArticle[]>(
    () => categories.flatMap((c) => c.articles.map((a) => ({ ...a, categoryTitle: c.title }))),
    [categories],
  );
  const searching = query.trim().length > 1;
  const hits = useMemo(() => (searching ? matchArticles(all, query) : []), [all, query, searching]);
  const shown = active ? categories.filter((c) => c.slug === active) : categories;

  // Deep link /aide#a-<id>: open and reveal that article (DOM only, no state).
  useEffect(() => {
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: "center" });
    }
  }, []);

  return (
    <>
      <section className="mx-auto grid w-full max-w-[75rem] gap-10 px-5 pb-12 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(2.25rem,2.4vw+1.5rem,3.5rem)] font-bold leading-[1.04] tracking-[-0.03em] text-balance">
            Comment pouvons-nous vous aider ?
          </h1>
          <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-(--lp-ink-2)">
            Les réponses aux questions fréquentes sur Skedul, et l’équipe pour le reste.
          </p>
          <div role="search" className="relative mt-8 max-w-xl">
            <label htmlFor="faq-search" className="sr-only">
              Rechercher dans l’aide
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="faq-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Packs, mot de passe, Google Agenda"
              autoComplete="off"
              className="h-14 w-full rounded-full border border-border bg-card pl-12 pr-12 text-base shadow-(--shadow-card) outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-w-0">{aside}</div>
      </section>

      <section
        aria-label="Questions fréquentes"
        className="mx-auto grid w-full max-w-[75rem] gap-8 px-5 pb-24 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
      >
        <nav aria-label="Rubriques" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
            <li>
              <CategoryButton
                label="Toutes les rubriques"
                count={all.length}
                active={!active && !searching}
                onClick={() => {
                  setActive(null);
                  setQuery("");
                }}
              />
            </li>
            {categories.map((c) => {
              const Icon = HELP_ICON_COMPONENTS[c.icon];
              return (
                <li key={c.id}>
                  <CategoryButton
                    icon={<Icon className="size-4" aria-hidden />}
                    label={c.title}
                    count={c.articles.length}
                    active={active === c.slug && !searching}
                    onClick={() => {
                      setActive(c.slug);
                      setQuery("");
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {searching ? (
            hits.length > 0 ? (
              <>
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {hits.length} résultat{hits.length > 1 ? "s" : ""} pour «&nbsp;{query.trim()}&nbsp;»
                </p>
                <ArticleList articles={hits} />
              </>
            ) : (
              <div aria-live="polite" className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
                <p className="font-medium">Aucun article ne correspond à «&nbsp;{query.trim()}&nbsp;».</p>
                <p className="mt-1 text-sm text-muted-foreground">Posez la question à l’équipe : elle vous répond par écrit.</p>
                <Button asChild size="sm" className={cn(navPrimary, "mt-5")}>
                  <Link href={`${NEW_REQUEST}?sujet=${encodeURIComponent(query.trim())}`}>Créer une demande</Link>
                </Button>
              </div>
            )
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <p className="font-medium">La FAQ se remplit bientôt.</p>
              <p className="mt-1 text-sm text-muted-foreground">En attendant, l’équipe répond à toutes vos questions.</p>
              <Button asChild size="sm" className={cn(navPrimary, "mt-5")}>
                <Link href={NEW_REQUEST}>Créer une demande</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-12">
              {shown.map((c) => {
                const Icon = HELP_ICON_COMPONENTS[c.icon];
                return (
                  <section key={c.id} id={`rubrique-${c.slug}`} aria-labelledby={`rubrique-${c.slug}-titre`}>
                    <h2
                      id={`rubrique-${c.slug}-titre`}
                      className="flex items-center gap-3 font-display text-xl font-bold tracking-tight"
                    >
                      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      {c.title}
                    </h2>
                    <ArticleList articles={c.articles} />
                  </section>
                );
              })}
            </div>
          )}
          <p className="mt-12 text-sm text-(--lp-ink-2)">
            Vous n’avez pas trouvé votre réponse ?{" "}
            <Link href={NEW_REQUEST} className="font-medium text-primary underline-offset-4 hover:underline">
              Créer une demande
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function CategoryButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // pills on mobile (horizontal scroll), list items on desktop
        "flex w-full items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors lg:rounded-xl lg:border-transparent",
        active
          ? "border-primary bg-primary text-primary-foreground lg:bg-accent lg:text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground lg:bg-transparent lg:hover:bg-muted",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className={cn("text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function ArticleList({ articles }: { articles: ListedArticle[] }) {
  return (
    <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-(--shadow-card)">
      {articles.map((a) => (
        <details key={a.id} id={`a-${a.id}`} className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>
              {a.categoryTitle && (
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{a.categoryTitle}</span>
              )}
              <span className="font-medium leading-snug">{a.question}</span>
            </span>
            <ChevronDown
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5">
            <FaqAnswer text={a.answer} />
          </div>
        </details>
      ))}
    </div>
  );
}
```

Note: grouped lists pass `c.articles` (no `categoryTitle`), so the category label only appears in search results.

- [ ] **Step 7: Create `src/app/aide/page.tsx`**

```tsx
import type { Metadata } from "next";

import { FaqBrowser } from "@/components/support/faq-browser";
import { HelpAside } from "@/components/support/help-aside";
import { getSession } from "@/lib/session";
import { isOpen } from "@/lib/support";
import { getMyRequests, getPublishedFaq } from "@/server/support-queries";

export const metadata: Metadata = {
  title: { absolute: "Centre d’aide · Skedul" },
  description: "Les réponses aux questions fréquentes sur Skedul, et un espace pour écrire à l’équipe.",
};

export default async function HelpCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [{ q }, session, faq] = await Promise.all([searchParams, getSession(), getPublishedFaq()]);
  const openRequests = session
    ? (await getMyRequests(session.user.id)).filter(isOpen).slice(0, 3)
    : [];

  return (
    <FaqBrowser
      categories={faq}
      initialQuery={typeof q === "string" ? q.slice(0, 100) : ""}
      aside={<HelpAside signedIn={session !== null} requests={openRequests} />}
    />
  );
}
```

- [ ] **Step 8: Add the dev-server entry for this worktree**

Edit `C:\Users\Matheus\Documents\Codage\skedul\.claude\launch.json` (main checkout, not the worktree: the Browser tool reads it from there) and add to `configurations`:

```json
    {
      "name": "skedul-help-center",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["-C", ".claude/worktrees/help-center", "--config.verify-deps-before-run=false", "dev", "--port", "3100"],
      "port": 3100
    }
```

The worktree already has `.env.local` and `.env.development.local` (`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` = `http://localhost:3100`). This file is outside the worktree: do not commit it.

- [ ] **Step 9: Verify in the browser**

1. `preview_start` with `{ name: "skedul-help-center" }`; navigate to `http://localhost:3100/aide`.
2. `read_page`: the h1 "Comment pouvons-nous vous aider ?", 5 category buttons plus "Toutes les rubriques", 10 questions in 5 groups, the aside "Une question sans réponse ?" (signed out).
3. Type `mot passe` in the search (`form_input` on the search field): exactly 1 result "J’ai oublié mon mot de passe", with the category label above it. Type `zzz`: the empty state with "Créer une demande" pointing to `/aide/demandes/nouvelle?sujet=zzz`.
4. Click a category: only its group shows. Click "Toutes les rubriques": all groups.
5. Navigate to `http://localhost:3100/aide#a-ha_packs`: that article is open.
6. `read_console_messages` with `onlyErrors: true`: none. `resize_window` preset `mobile`, screenshot: hero stacks, category pills scroll horizontally, no horizontal page scroll (`javascript_tool`: `document.documentElement.scrollWidth <= window.innerWidth` → `true`). Reset with preset `desktop`.

- [ ] **Step 10: Typecheck, lint, tests, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/aide src/components/support src/components/site-footer.tsx src/lib/analytics.ts && ./node_modules/.bin/tsx --test`
Expected: all green.

```bash
git add src/app/aide src/components/support/faq-browser.tsx src/components/support/help-aside.tsx src/components/site-footer.tsx src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat(help-center): public /aide page with FAQ search and categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: User request pages (list, new, detail)

**Files:**
- Create: `src/components/support/request-card.tsx`, `src/components/support/new-request-form.tsx`, `src/app/aide/demandes/page.tsx`, `src/app/aide/demandes/nouvelle/page.tsx`, `src/app/aide/demandes/[id]/page.tsx`

**Interfaces:**
- Consumes: `createSupportRequest`, `replyToSupportRequest` (Task 8); `getMyRequests`, `getMyRequest`, `getPublishedFaq` (Task 7); `markReadByUser` (Task 6); `StageProgress`, `SupportTypeChip`, `TYPE_ICONS`, `MessageThread`, `MessageComposer`, `ImageAttachInput`, `BackLink` (Task 10); `isOpen`, `canUserReply`, `stageReachedAt`, `matchArticles`, `parseSupportType`, `TYPE_LABELS`, `TYPE_HINTS`, `SUPPORT_TYPES`, `MAX_SUBJECT`, `MAX_BODY` (Task 2).
- Produces: routes `/aide/demandes`, `/aide/demandes/nouvelle` (`?sujet=`, `?type=` pre-fill), `/aide/demandes/<id>` (`?images=partiel` shows a notice).

- [ ] **Step 1: Create `src/components/support/request-card.tsx`**

```tsx
import Link from "next/link";

import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import type { SupportRequestRow } from "@/server/support-queries";

export function RequestCard({ request }: { request: SupportRequestRow }) {
  return (
    <Link
      href={`/aide/demandes/${request.id}`}
      className="group block rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) transition-[border-color,translate] duration-150 hover:border-primary/40 motion-safe:hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SupportTypeChip type={request.type} />
            <span className="tabular-nums">#{request.number}</span>
          </div>
          <p className="mt-2 truncate font-semibold transition-colors group-hover:text-primary">
            {request.subject}
          </p>
        </div>
        {request.unreadByUser && (
          <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
            Nouvelle réponse
          </span>
        )}
      </div>
      <StageProgress
        size="mini"
        track={request.track}
        stage={request.stage}
        resolution={request.resolution}
        className="mt-4"
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Dernière activité le {formatDateShort(request.lastActivityAt, ADMIN_TZ)}
      </p>
    </Link>
  );
}
```

- [ ] **Step 2: Create `src/app/aide/demandes/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LifeBuoy, Plus } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { BackLink } from "@/components/support/back-link";
import { RequestCard } from "@/components/support/request-card";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { isOpen } from "@/lib/support";
import { getMyRequests } from "@/server/support-queries";

export const metadata: Metadata = { title: "Mes demandes" };

export default async function MyRequestsPage() {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent("/aide/demandes")}`);
  const requests = await getMyRequests(session.user.id);
  const open = requests.filter(isOpen);
  const done = requests.filter((r) => !isOpen(r));

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide">Centre d’aide</BackLink>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-bold tracking-[-0.03em]">Mes demandes</h1>
        {requests.length > 0 && (
          <Button asChild size="sm" className={navPrimary}>
            <Link href="/aide/demandes/nouvelle">
              <Plus aria-hidden />
              Créer une demande
            </Link>
          </Button>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <LifeBuoy className="size-6" aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-xl font-bold tracking-tight">Posez votre première question</h2>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted-foreground">
            Une question, un problème ou une idée : l’équipe Skedul vous répond ici et vous suivez l’avancement.
          </p>
          <Button asChild size="sm" className={`${navPrimary} mt-6`}>
            <Link href="/aide/demandes/nouvelle">Créer une demande</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {open.length > 0 && (
            <section aria-labelledby="en-cours">
              <h2 id="en-cours" className="text-sm font-semibold text-muted-foreground">
                En cours ({open.length})
              </h2>
              <ul className="mt-3 space-y-3">
                {open.map((r) => (
                  <li key={r.id}>
                    <RequestCard request={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="terminees">
              <h2 id="terminees" className="text-sm font-semibold text-muted-foreground">
                Terminées ({done.length})
              </h2>
              <ul className="mt-3 space-y-3">
                {done.map((r) => (
                  <li key={r.id}>
                    <RequestCard request={r} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/support/new-request-form.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { ctaPrimary } from "@/components/landing/cta";
import { ImageAttachInput, type PickedImage } from "@/components/support/image-attach-input";
import { TYPE_ICONS } from "@/components/support/support-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_BODY,
  MAX_SUBJECT,
  SUPPORT_TYPES,
  TYPE_HINTS,
  TYPE_LABELS,
  matchArticles,
  type SupportType,
} from "@/lib/support";
import { cn } from "@/lib/utils";
import { createSupportRequest } from "@/server/support";

type Article = { id: string; question: string; answer: string };

/** Step 1 picks the type; step 2 (revealed) asks for the subject, details and screenshots. */
export function NewRequestForm({
  articles,
  initialSubject,
  initialType,
  imagesEnabled,
}: {
  articles: Article[];
  initialSubject: string;
  initialType: SupportType | null;
  imagesEnabled: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<SupportType | null>(initialType);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const suggestions = useMemo(() => matchArticles(articles, subject).slice(0, 3), [articles, subject]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!type) {
      setError("Choisissez le type de demande.");
      return;
    }
    const data = new FormData();
    data.set("type", type);
    data.set("subject", subject);
    data.set("body", body);
    images.forEach((i) => data.append("images", i.file));
    setError(null);
    startTransition(async () => {
      try {
        const res = await createSupportRequest(data);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        images.forEach((i) => URL.revokeObjectURL(i.url));
        // push only (Next 16 router): the detail page is fetched fresh
        router.push(`/aide/demandes/${res.id}${res.warning ? "?images=partiel" : ""}`);
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-8">
      <fieldset>
        <legend className="font-display text-lg font-bold tracking-tight">De quoi s’agit-il ?</legend>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SUPPORT_TYPES.map((t) => {
            const Icon = TYPE_ICONS[t];
            return (
              <label
                key={t}
                className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-(--shadow-card) transition-colors hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={type === t}
                  onChange={() => setType(t)}
                  className="sr-only"
                />
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{TYPE_LABELS[t]}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{TYPE_HINTS[t]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {type && (
        <div className="space-y-6 motion-safe:animate-[fade-up_300ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <div className="space-y-2">
            <Label htmlFor="subject">Sujet</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={MAX_SUBJECT}
              placeholder={type === "feature" ? "Exporter mes réservations en CSV" : "Je ne vois pas mes créneaux du samedi"}
              required
            />
            {suggestions.length > 0 && (
              <div className="rounded-2xl bg-accent px-4 py-3">
                <p className="text-sm font-medium text-accent-foreground">Ces articles répondent peut-être à votre question :</p>
                <ul className="mt-2 space-y-1.5">
                  {suggestions.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/aide#a-${a.id}`}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {a.question}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Description</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              rows={7}
              required
            />
            <p className="text-xs text-muted-foreground">
              Plus vous donnez de détails (page concernée, étapes, message affiché), plus vite l’équipe peut vous aider.
            </p>
          </div>

          {imagesEnabled && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Captures d’écran</p>
              <ImageAttachInput images={images} onChange={setImages} disabled={pending} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {type && (
        <Button type="submit" className={cn(ctaPrimary, "w-full sm:w-auto")} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Envoyer la demande
        </Button>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Create `src/app/aide/demandes/nouvelle/page.tsx`**

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/support/back-link";
import { NewRequestForm } from "@/components/support/new-request-form";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { MAX_SUBJECT, parseSupportType } from "@/lib/support";
import { getPublishedFaq } from "@/server/support-queries";

export const metadata: Metadata = { title: "Nouvelle demande" };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sujet?: string | string[]; type?: string | string[] }>;
}) {
  const params = await searchParams;
  const subject = typeof params.sujet === "string" ? params.sujet.slice(0, MAX_SUBJECT) : "";
  const type = parseSupportType(typeof params.type === "string" ? params.type : undefined);

  const session = await getSession();
  if (!session) {
    const back = `/aide/demandes/nouvelle${subject ? `?sujet=${encodeURIComponent(subject)}` : ""}`;
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }

  const faq = await getPublishedFaq();
  const articles = faq.flatMap((c) =>
    c.articles.map((a) => ({ id: a.id, question: a.question, answer: a.answer })),
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide/demandes">Mes demandes</BackLink>
      <h1 className="mt-6 font-display text-4xl font-bold tracking-[-0.03em]">Nouvelle demande</h1>
      <p className="mt-3 max-w-[52ch] text-(--lp-ink-2)">
        L’équipe Skedul lit chaque demande et vous répond dans son fil. Vous suivez son avancement étape par étape.
      </p>
      {session.session.impersonatedBy ? (
        <p className="mt-8 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Vous consultez ce compte en tant qu’admin : la création de demande est désactivée.
        </p>
      ) : (
        <NewRequestForm
          articles={articles}
          initialSubject={subject}
          initialType={type}
          imagesEnabled={env.SUPPORT_BLOB_ENABLED}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/app/aide/demandes/[id]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BackLink } from "@/components/support/back-link";
import { MessageComposer } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { canUserReply, stageReachedAt } from "@/lib/support";
import { replyToSupportRequest } from "@/server/support";
import { markReadByUser } from "@/server/support-core";
import { getMyRequest } from "@/server/support-queries";

export const metadata: Metadata = { title: "Demande" };

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ images?: string | string[] }>;
}) {
  const [{ id }, { images }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/aide/demandes/${id}`)}`);
  const data = await getMyRequest(session.user.id, id);
  if (!data) notFound();
  const { request, thread } = data;
  const impersonating = Boolean(session.session.impersonatedBy);
  // an admin looking through the account must not clear the user's "new reply" flag
  if (request.unreadByUser && !impersonating) await markReadByUser(session.user.id, id);

  const disabledReason = impersonating
    ? "Vous consultez ce compte en tant qu’admin : la réponse est désactivée."
    : !canUserReply(request)
      ? "Cette demande est fermée. Créez une nouvelle demande si besoin."
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-12 sm:px-8">
      <BackLink href="/aide/demandes">Mes demandes</BackLink>
      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SupportTypeChip type={request.type} />
          <span>
            #{request.number}, ouverte le {formatDateShort(request.createdAt, ADMIN_TZ)}
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
          {request.subject}
        </h1>
      </header>

      {images === "partiel" && (
        <p role="status" className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warning">
          Votre demande est envoyée, mais une image n’a pas pu être jointe. Vous pouvez la renvoyer dans une réponse.
        </p>
      )}

      <StageProgress
        className="mt-6"
        track={request.track}
        stage={request.stage}
        resolution={request.resolution}
        reachedAt={stageReachedAt(request.createdAt, thread)}
        eta={request.eta}
      />

      <h2 className="sr-only">Conversation</h2>
      <MessageThread className="mt-10" thread={thread} viewer="user" />
      <MessageComposer
        className="mt-8"
        requestId={request.id}
        action={replyToSupportRequest}
        imagesEnabled={env.SUPPORT_BLOB_ENABLED}
        disabledReason={disabledReason}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify the requester flow in the browser**

Dev server from Task 11 (`skedul-help-center`, port 3100).

1. Signed out, open `http://localhost:3100/aide/demandes/nouvelle?sujet=pack`: redirected to `/sign-in?next=%2Faide%2Fdemandes%2Fnouvelle%3Fsujet%3Dpack`.
2. Sign in with the demo pro account from `scripts/seed.ts` (email `pro@skedul.app`; its password is the seed's demo password, read it from the seed file, do not type it in chat). Expected: you land back on `/aide/demandes/nouvelle?sujet=pack`, subject pre-filled with "pack", 4 type cards, no fields yet.
3. Pick "Idée de fonctionnalité": fields fade in, the suggestion box lists "Comment fonctionnent les packs prépayés ?".
4. Subject `Exporter mes réservations en CSV`, a 2-sentence description, no image (the Browser pane cannot fill file inputs; image upload is tested in Task 14 Step 7 with the chrome-devtools MCP). Submit.
5. Expected: redirected to `/aide/demandes/<id>`; the bar shows 3 steps with "Reçue" current and its date; the thread shows your message. The server log (`preview_logs`) shows `📧 [email:mock] → <admin email>` with subject `Nouvelle demande #<n> : Exporter mes réservations en CSV` (local Resend is mock).
6. Reply "Petite précision" in the composer: the message appears after the refresh, the composer is empty again.
7. `/aide/demandes`: the request is under "En cours" with its mini bar. `/aide`: the aside now lists it under "Vos demandes en cours".
8. `read_console_messages` with `onlyErrors: true`: none.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/aide src/components/support`
Expected: exit 0.

```bash
git add src/app/aide/demandes src/components/support/request-card.tsx src/components/support/new-request-form.tsx
git commit -m "feat(help-center): create, list and follow support requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: "Centre d’aide" entry in the pro dashboard

**Files:**
- Modify: `src/components/dashboard/sidebar.tsx`, `src/app/dashboard/layout.tsx`

**Interfaces:**
- Consumes: `hasUnreadSupport(userId)` (Task 7).
- Produces: `DashboardSidebar` prop `supportUnread?: boolean`.

- [ ] **Step 1: Add the link to the sidebar**

In `src/components/dashboard/sidebar.tsx`:
1. Add `LifeBuoy` to the lucide import.
2. Append to `NAV`: `{ href: "/aide", label: "Centre d’aide", icon: LifeBuoy },`
3. Add the prop: in the signature `supportUnread = false,` and in its type `supportUnread?: boolean;`.
4. In the `NAV.map` link, replace `{item.label}` with:

```tsx
              <span className="flex-1">{item.label}</span>
              {item.href === "/aide" && supportUnread && (
                <span className="rounded-full bg-primary px-1.5 py-px text-[0.625rem] font-semibold text-primary-foreground">
                  Nouveau
                  <span className="sr-only"> : une réponse vous attend</span>
                </span>
              )}
```

- [ ] **Step 2: Pass the flag from the layout**

In `src/app/dashboard/layout.tsx`:
1. Import `import { hasUnreadSupport } from "@/server/support-queries";`
2. After `if (!pro) redirect("/onboarding");` add `const supportUnread = await hasUnreadSupport(session.user.id);`
3. Pass `supportUnread={supportUnread}` to `<DashboardSidebar … />`.

- [ ] **Step 3: Verify**

Signed in as the demo pro, open `http://localhost:3100/dashboard`: the sidebar ends with "Centre d’aide" (no badge while nothing is unread). The badge is checked in Task 14 after an admin reply.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/components/dashboard/sidebar.tsx src/app/dashboard/layout.tsx`

```bash
git add src/components/dashboard/sidebar.tsx src/app/dashboard/layout.tsx
git commit -m "feat(help-center): link the help center from the pro dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Admin inbox and request detail

**Files:**
- Create: `src/components/admin/support-tabs.tsx`, `src/components/admin/support-inbox-row.tsx`, `src/components/admin/support-admin-panel.tsx`, `src/app/admin/support/page.tsx`, `src/app/admin/support/[id]/page.tsx`
- Modify: `src/components/admin/admin-sidebar.tsx`, `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `getSupportInbox`, `countSupportToHandle`, `getSupportRequestForAdmin`, `InboxRow` (Task 7); `markReadByAdmin` (Task 6); admin actions (Task 9); Task 10 components; `FilterChips`, `Pagination` (`@/components/admin/*`); `PageHeader` (`@/components/dashboard/page-header`); `parsePage` (`@/lib/admin-params`); `requireAdmin` (`@/lib/admin`).
- Produces: `SupportTabs({ active: "inbox" | "board" | "faq" })` (used by Tasks 15 and 16); routes `/admin/support` (`?filter=todo|open|done|all`, `?type=`, `?page=`) and `/admin/support/<id>`; `AdminSidebar` prop `supportToHandle: number`.

- [ ] **Step 1: Sidebar entry with the "to handle" count**

In `src/components/admin/admin-sidebar.tsx`:
1. Add `LifeBuoy` to the lucide import.
2. Insert in `NAV`, after the "Activité" entry: `{ href: "/admin/support", label: "Support", icon: LifeBuoy },`
3. Add the prop `supportToHandle,` to the destructured props and `supportToHandle: number;` to their type.
4. In the `NAV.map` link, replace `{item.label}` with:

```tsx
              <span className="flex-1">{item.label}</span>
              {item.href === "/admin/support" && supportToHandle > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-px text-[0.625rem] font-semibold tabular-nums text-primary-foreground">
                  {supportToHandle}
                  <span className="sr-only"> à traiter</span>
                </span>
              )}
```

In `src/app/admin/layout.tsx`:
1. Import `import { countSupportToHandle } from "@/server/support-queries";`
2. After the `remembered` line add `const supportToHandle = await countSupportToHandle();`
3. Pass `supportToHandle={supportToHandle}` to `<AdminSidebar … />`.

- [ ] **Step 2: Create `src/components/admin/support-tabs.tsx`**

```tsx
import Link from "next/link";
import { BookOpen, Inbox, SquareKanban } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "inbox", href: "/admin/support", label: "Boîte de réception", icon: Inbox },
  { key: "board", href: "/admin/support/developpements", label: "Développements", icon: SquareKanban },
  { key: "faq", href: "/admin/support/faq", label: "FAQ", icon: BookOpen },
] as const;

export function SupportTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Support" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab.key === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <tab.icon className="size-4" aria-hidden />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Create `src/components/admin/support-inbox-row.tsx`**

```tsx
import Link from "next/link";

import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { InboxRow } from "@/server/support-queries";

export function SupportInboxRow({ row }: { row: InboxRow }) {
  return (
    <Link
      href={`/admin/support/${row.id}`}
      className="grid gap-3 px-5 py-4 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center sm:gap-6"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {row.unreadByAdmin && (
            <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground">Nouveau</span>
          )}
          <span className="tabular-nums">#{row.number}</span>
          <SupportTypeChip type={row.type} />
        </div>
        <p className={cn("mt-1.5 truncate", row.unreadByAdmin ? "font-semibold" : "font-medium")}>{row.subject}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.authorName}, {formatDateTimeShort(row.lastActivityAt, ADMIN_TZ)}
        </p>
      </div>
      <StageProgress size="mini" track={row.track} stage={row.stage} resolution={row.resolution} />
    </Link>
  );
}
```

- [ ] **Step 4: Create `src/app/admin/support/page.tsx`**

```tsx
import type { Metadata } from "next";

import { FilterChips } from "@/components/admin/filter-chips";
import { Pagination } from "@/components/admin/pagination";
import { SupportInboxRow } from "@/components/admin/support-inbox-row";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { parsePage } from "@/lib/admin-params";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  INBOX_PAGE_SIZE,
  SUPPORT_TYPES,
  TYPE_LABELS,
  parseInboxFilter,
  parseSupportType,
  type InboxFilter,
  type SupportType,
} from "@/lib/support";
import { getSupportInbox } from "@/server/support-queries";

export const metadata: Metadata = { title: "Support" };

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; type?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseInboxFilter(params.filter);
  const type = parseSupportType(params.type);
  const page = parsePage(params.page);
  const { rows, total } = await getSupportInbox({ filter, type, page });
  const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));

  // `type: undefined` keeps the current type, `null` clears it
  const hrefFor = (next: { filter?: InboxFilter; type?: SupportType | null; page?: number }) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "todo") sp.set("filter", f);
    const t = next.type === undefined ? type : next.type;
    if (t) sp.set("type", t);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  };

  return (
    <>
      <PageHeader
        title="Support"
        description={`${total.toLocaleString("fr-FR")} demande${total > 1 ? "s" : ""}`}
      />
      <SupportTabs active="inbox" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Statut"
          active={filter}
          options={INBOX_FILTERS.map((f) => ({
            value: f,
            label: INBOX_FILTER_LABELS[f],
            href: hrefFor({ filter: f }),
          }))}
        />
        <FilterChips<SupportType | "all">
          label="Type"
          active={type ?? "all"}
          options={[
            { value: "all", label: "Tous les types", href: hrefFor({ type: null }) },
            ...SUPPORT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], href: hrefFor({ type: t }) })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-muted-foreground">
          {filter === "todo" ? "Rien à traiter pour l’instant." : "Aucune demande pour ce filtre."}
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((row) => (
            <SupportInboxRow key={row.id} row={row} />
          ))}
        </Card>
      )}
      <Pagination page={page} pageCount={pageCount} hrefFor={(p) => hrefFor({ page: p })} />
    </>
  );
}
```

- [ ] **Step 5: Create `src/components/admin/support-admin-panel.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Check, Hammer, Lock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RESOLUTION_LABELS,
  STAGE_LABELS,
  TRACK_STEPS,
  canAcceptForDevelopment,
  canSetStage,
  formatEta,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
} from "@/lib/support";
import { cn } from "@/lib/utils";
import {
  acceptForDevelopment,
  reopenSupportRequest,
  resolveSupportRequest,
  setSupportEta,
  setSupportStage,
  type AdminSupportResult,
} from "@/server/support-admin";

type PanelRequest = {
  id: string;
  track: SupportTrack;
  stage: SupportStage;
  resolution: SupportResolution | null;
  eta: string | null;
};

/** Right column of /admin/support/[id]: step, development switch, ETA, decline / close / reopen. */
export function SupportAdminPanel({ request }: { request: PanelRequest }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"accept" | SupportResolution | null>(null);
  const [eta, setEta] = useState(request.eta ?? "");
  const [reason, setReason] = useState("");
  const ended = request.resolution !== null;

  function run(action: () => Promise<AdminSupportResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDialog(null);
        setReason("");
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  const closeDialog = () => {
    if (!pending) setDialog(null);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Étape</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {TRACK_STEPS[request.track].map((s) => {
            const current = s === request.stage;
            return (
              <button
                key={s}
                type="button"
                disabled={ended || pending || current || !canSetStage(request.track, s)}
                onClick={() => run(() => setSupportStage({ id: request.id, stage: s }))}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
                  current
                    ? "border-primary bg-accent font-semibold text-accent-foreground"
                    : "border-border hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent",
                )}
              >
                {STAGE_LABELS[s]}
                {current && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
          {request.resolution && (
            <div className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              Demande {RESOLUTION_LABELS[request.resolution].toLowerCase()}. Rouvrez-la pour changer d’étape.
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 w-full"
                disabled={pending}
                onClick={() => run(() => reopenSupportRequest({ id: request.id }))}
              >
                <RotateCcw />
                Rouvrir
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {request.track === "development" && !ended && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Livraison estimée</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => setSupportEta({ id: request.id, eta: eta || null }));
              }}
              className="flex gap-2"
            >
              <Input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                aria-label="Date de livraison estimée"
              />
              <Button type="submit" variant="secondary" disabled={pending || eta === (request.eta ?? "")}>
                Enregistrer
              </Button>
            </form>
            {request.eta && (
              <p className="mt-2 text-xs text-muted-foreground">
                Affichée à l’utilisateur : {formatEta(request.eta)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!ended && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {canAcceptForDevelopment(request) && (
              <Button type="button" className="w-full" disabled={pending} onClick={() => setDialog("accept")}>
                <Hammer />
                Accepter en développement
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => setDialog("declined")}
            >
              <Ban />
              Ne pas retenir
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={pending}
              onClick={() => setDialog("closed")}
            >
              <Lock />
              Fermer la demande
            </Button>
          </CardContent>
        </Card>
      )}

      {error && !dialog && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={dialog === "accept"} onClose={closeDialog} title="Accepter en développement">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => acceptForDevelopment({ id: request.id, eta: eta || null }));
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            La demande passe sur le suivi en 6 étapes, à l’étape « Acceptée ». L’utilisateur est prévenu par e-mail.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="accept-eta">Livraison estimée (facultatif)</Label>
            <Input id="accept-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              Accepter
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "declined" || dialog === "closed"}
        onClose={closeDialog}
        title={dialog === "declined" ? "Ne pas retenir la demande" : "Fermer la demande"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog !== "declined" && dialog !== "closed") return;
            const resolution = dialog;
            run(() => resolveSupportRequest({ id: request.id, resolution, reason }));
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="resolution-reason">
              {dialog === "declined"
                ? "Raison (visible par l’utilisateur)"
                : "Message (facultatif, visible par l’utilisateur)"}
            </Label>
            <Textarea
              id="resolution-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={dialog === "declined"}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {dialog === "closed"
              ? "Une demande fermée ne peut plus recevoir de réponse de l’utilisateur."
              : "L’utilisateur pourra encore répondre dans le fil."}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              Annuler
            </Button>
            <Button type="submit" variant={dialog === "declined" ? "destructive" : "primary"} disabled={pending}>
              {dialog === "declined" ? "Ne pas retenir" : "Fermer"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 6: Create `src/app/admin/support/[id]/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, UserRound } from "lucide-react";

import { SupportAdminPanel } from "@/components/admin/support-admin-panel";
import { BackLink } from "@/components/support/back-link";
import { MessageComposer } from "@/components/support/message-composer";
import { MessageThread } from "@/components/support/message-thread";
import { StageProgress } from "@/components/support/stage-progress";
import { SupportTypeChip } from "@/components/support/support-type";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort } from "@/lib/datetime";
import { env } from "@/lib/env";
import { stageReachedAt } from "@/lib/support";
import { adminReply } from "@/server/support-admin";
import { markReadByAdmin } from "@/server/support-core";
import { getSupportRequestForAdmin } from "@/server/support-queries";

export const metadata: Metadata = { title: "Demande de support" };

export default async function AdminSupportRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const data = await getSupportRequestForAdmin(id);
  if (!data) notFound();
  const { request, author, thread } = data;
  if (request.unreadByAdmin) await markReadByAdmin(id);

  return (
    <>
      <BackLink href="/admin/support">Support</BackLink>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <SupportTypeChip type={request.type} />
        <span className="tabular-nums">#{request.number}</span>
        <span>ouverte le {formatDateTimeShort(request.createdAt, ADMIN_TZ)}</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance">{request.subject}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          <StageProgress
            track={request.track}
            stage={request.stage}
            resolution={request.resolution}
            reachedAt={stageReachedAt(request.createdAt, thread)}
            eta={request.eta}
          />
          <MessageThread thread={thread} viewer="admin" />
          <MessageComposer
            requestId={request.id}
            action={adminReply}
            imagesEnabled={env.SUPPORT_BLOB_ENABLED}
            placeholder={`Répondre à ${author.name}`}
          />
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="font-semibold">{author.name}</p>
              <a
                href={`mailto:${author.email}`}
                className="flex items-center gap-2 break-all text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="size-4 shrink-0" aria-hidden />
                {author.email}
              </a>
              {author.proSlug && (
                <a
                  href={`/${author.proSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                  {author.businessName ?? author.proSlug}
                </a>
              )}
              <Link
                href={`/admin/users/${author.id}`}
                className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <UserRound className="size-4 shrink-0" aria-hidden />
                Voir la fiche
              </Link>
            </CardContent>
          </Card>
          <SupportAdminPanel
            request={{
              id: request.id,
              track: request.track,
              stage: request.stage,
              resolution: request.resolution,
              eta: request.eta,
            }}
          />
        </aside>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Verify the admin flow in the browser**

Prerequisite: the request created in Task 12. Sign out, then sign in at `http://localhost:3100/sign-in` as the local admin `admin@skedul.test` (password: the seed's demo password, see `scripts/seed.ts`); in the entry chooser pick « Dashboard Admin ».

1. Sidebar shows "Support" with a count ≥ 1. `/admin/support`: the request is listed under "À traiter" with "Nouveau".
2. Open it: "Nouveau" disappears from the list on return; the badge count drops.
3. Reply with an image. The Browser pane cannot fill file inputs, so use the chrome-devtools MCP (its browser has its own cookies): `new_page` → `http://localhost:3100/sign-in`, sign in as `admin@skedul.test` and pick « Dashboard Admin », open `/admin/support/<id>`, `take_snapshot`, `upload_file` with the uid of the "Ajouter une capture d’écran" button and the absolute path `C:\Users\Matheus\Documents\Codage\skedul\.claude\worktrees\help-center\src\app\icon.png`, `fill` the textarea with "Bonne idée, on regarde.", click "Envoyer". Expected after sending: a centred event « Étape « Prise en charge » », then the admin bubble with the thumbnail; the full bar shows step 2 of 3. `preview_logs` shows `📧 [email:mock] → pro@skedul.app` with subject `Votre demande #<n> : nouvelle réponse`. Continue the next steps in the Browser pane (reload the page there).
4. "Accepter en développement" with a date 3 weeks ahead: the bar switches to 6 steps, "Acceptée" current, "Livraison estimée : <date>"; the Actions card no longer offers "Accepter en développement"; a stage e-mail is logged.
5. Click "Planifiée" then "En développement" in the Étape card: the bar follows, "Reçue" is not clickable on this track.
6. Signed out (new private context or `javascript_tool`: `await fetch("/api/support/attachments/<attachmentId>", { credentials: "omit" }).then(r => r.status)`): `404`. Signed in as admin: the thumbnail loads (status 200, `content-type: image/png` in `read_network_requests`).
7. Sign back in as the pro: `/dashboard` sidebar shows "Centre d’aide" with "Nouveau"; `/aide/demandes/<id>` shows 6 steps with dates, "Équipe Skedul" messages and the image; returning to `/dashboard`, the badge is gone.
8. `read_console_messages` with `onlyErrors: true` on each page: none.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/admin src/components/admin`
Expected: exit 0.

```bash
git add src/components/admin/support-tabs.tsx src/components/admin/support-inbox-row.tsx src/components/admin/support-admin-panel.tsx src/components/admin/admin-sidebar.tsx src/app/admin/layout.tsx src/app/admin/support/page.tsx "src/app/admin/support/[id]/page.tsx"
git commit -m "feat(admin): support inbox and request detail with step controls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Development kanban

**Files:**
- Create: `src/components/admin/dev-board-card.tsx`, `src/app/admin/support/developpements/page.tsx`

**Interfaces:**
- Consumes: `getDevBoard` (Task 7), `setSupportStage` (Task 9), `SupportTabs` (Task 14), `TRACK_STEPS`, `STAGE_LABELS`, `formatEta` (Task 2).
- Produces: route `/admin/support/developpements`.

- [ ] **Step 1: Create `src/components/admin/dev-board-card.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { STAGE_LABELS, formatEta, type SupportStage } from "@/lib/support";
import { setSupportStage } from "@/server/support-admin";

type BoardCard = {
  id: string;
  number: number;
  subject: string;
  authorName: string;
  eta: string | null;
};

/** A kanban card; the arrows move the request one column back or forward. */
export function DevBoardCard({
  card,
  prev,
  next,
}: {
  card: BoardCard;
  prev: SupportStage | null;
  next: SupportStage | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(stage: SupportStage) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setSupportStage({ id: card.id, stage });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  return (
    <article className="rounded-xl border border-border bg-card p-3 shadow-(--shadow-card)">
      <Link
        href={`/admin/support/${card.id}`}
        className="block text-sm font-medium leading-snug transition-colors hover:text-primary"
      >
        {card.subject}
      </Link>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        #{card.number}, {card.authorName}
      </p>
      {card.eta && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden />
          {formatEta(card.eta)}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2"
          disabled={!prev || pending}
          onClick={() => prev && move(prev)}
          aria-label={prev ? `Revenir à ${STAGE_LABELS[prev]}` : "Première colonne"}
        >
          <ArrowLeft />
        </Button>
        {next && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => move(next)}>
            {STAGE_LABELS[next]}
            <ArrowRight />
          </Button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </article>
  );
}
```

- [ ] **Step 2: Create `src/app/admin/support/developpements/page.tsx`**

```tsx
import type { Metadata } from "next";

import { DevBoardCard } from "@/components/admin/dev-board-card";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";
import { STAGE_LABELS, TRACK_STEPS } from "@/lib/support";
import { getDevBoard } from "@/server/support-queries";

export const metadata: Metadata = { title: "Développements" };

// "Reçue" is never a development column: accepting starts at "Acceptée".
const COLUMNS = TRACK_STEPS.development.filter((s) => s !== "received");

export default async function DevBoardPage() {
  await requireAdmin();
  const cards = await getDevBoard();

  return (
    <>
      <PageHeader title="Support" description="Les demandes acceptées en développement, par étape." />
      <SupportTabs active="board" />

      <div className="-mx-5 overflow-x-auto px-5 pb-2">
        <div className="grid min-w-[60rem] grid-cols-5 gap-3">
          {COLUMNS.map((stage, i) => {
            const items = cards.filter((c) => c.stage === stage);
            return (
              <section
                key={stage}
                aria-labelledby={`col-${stage}`}
                className="flex min-h-72 flex-col rounded-2xl bg-muted/70 p-3"
              >
                <h2 id={`col-${stage}`} className="flex items-center justify-between px-1 text-sm font-semibold">
                  {STAGE_LABELS[stage]}
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="mt-3 px-1 text-xs text-muted-foreground">Aucune demande</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {items.map((c) => (
                      <li key={c.id}>
                        <DevBoardCard
                          card={{
                            id: c.id,
                            number: c.number,
                            subject: c.subject,
                            authorName: c.authorName,
                            eta: c.eta,
                          }}
                          prev={COLUMNS[i - 1] ?? null}
                          next={COLUMNS[i + 1] ?? null}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Les demandes livrées restent affichées 30 jours. Chaque déplacement prévient l’utilisateur par e-mail.
      </p>
    </>
  );
}
```

- [ ] **Step 3: Verify in the browser**

As admin, open `http://localhost:3100/admin/support/developpements`: 5 columns; the request from Task 14 sits in "En développement" with its ETA. Click "En test": it moves one column and the user gets a mock e-mail (`preview_logs`). Click the left arrow: back to "En développement". On a 375px-wide window (`resize_window` preset `mobile`), the board scrolls horizontally inside its container and the page itself does not (`document.documentElement.scrollWidth <= window.innerWidth`). Reset with preset `desktop`.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/admin/support src/components/admin/dev-board-card.tsx`

```bash
git add src/components/admin/dev-board-card.tsx src/app/admin/support/developpements
git commit -m "feat(admin): kanban of support requests in development

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: FAQ editor

**Files:**
- Create: `src/components/admin/support-faq-editor.tsx`, `src/app/admin/support/faq/page.tsx`

**Interfaces:**
- Consumes: `getFaqForAdmin`, `FaqCategory`, `FaqArticle` (Task 7); FAQ actions (Task 9); `HELP_ICON_COMPONENTS`, `HELP_ICON_LABELS`, `FaqAnswer` (Task 10); `SupportTabs` (Task 14); `HELP_ICONS`, `HelpIcon`, `MAX_BODY` (Task 2).
- Produces: route `/admin/support/faq`.

- [ ] **Step 1: Create `src/components/admin/support-faq-editor.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

import { FaqAnswer } from "@/components/support/faq-answer";
import { HELP_ICON_COMPONENTS, HELP_ICON_LABELS } from "@/components/support/help-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HELP_ICONS, MAX_BODY, type HelpIcon } from "@/lib/support";
import {
  deleteHelpArticle,
  deleteHelpCategory,
  moveHelpArticle,
  moveHelpCategory,
  saveHelpArticle,
  saveHelpCategory,
  setHelpArticlePublished,
  type AdminSupportResult,
} from "@/server/support-admin";
import type { FaqArticle, FaqCategory } from "@/server/support-queries";

type Editing =
  | { kind: "category"; category: FaqCategory | null }
  | { kind: "article"; categoryId: string; article: FaqArticle | null };

export function FaqEditor({ categories }: { categories: FaqCategory[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const articleCount = categories.reduce((n, c) => n + c.articles.length, 0);
  const publishedCount = categories.reduce((n, c) => n + c.articles.filter((a) => a.published).length, 0);

  function run(action: () => Promise<AdminSupportResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onDone?.();
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  function open(next: Editing) {
    setError(null);
    setEditing(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {categories.length} rubrique{categories.length > 1 ? "s" : ""}, {articleCount} article
          {articleCount > 1 ? "s" : ""} dont {publishedCount} publié{publishedCount > 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => open({ kind: "category", category: null })}>
          <Plus />
          Nouvelle rubrique
        </Button>
      </div>

      {error && !editing && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {categories.length === 0 && (
        <Card className="px-6 py-12 text-center text-sm text-muted-foreground">
          Aucune rubrique. Créez-en une pour commencer la FAQ.
        </Card>
      )}

      {categories.map((c, ci) => {
        const Icon = HELP_ICON_COMPONENTS[c.icon];
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.title}</p>
                <p className="text-xs text-muted-foreground">/aide#rubrique-{c.slug}</p>
              </div>
              <div className="flex gap-1">
                <IconButton label="Monter la rubrique" disabled={pending || ci === 0} onClick={() => run(() => moveHelpCategory({ id: c.id, direction: "up" }))}>
                  <ArrowUp />
                </IconButton>
                <IconButton label="Descendre la rubrique" disabled={pending || ci === categories.length - 1} onClick={() => run(() => moveHelpCategory({ id: c.id, direction: "down" }))}>
                  <ArrowDown />
                </IconButton>
                <IconButton label="Modifier la rubrique" disabled={pending} onClick={() => open({ kind: "category", category: c })}>
                  <Pencil />
                </IconButton>
                <IconButton
                  label="Supprimer la rubrique"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Supprimer la rubrique « ${c.title} » ?`)) {
                      run(() => deleteHelpCategory({ id: c.id }));
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>

            {c.articles.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun article dans cette rubrique.</p>
            ) : (
              <ul className="divide-y divide-border">
                {c.articles.map((a, ai) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <p className="min-w-0 flex-1 text-sm font-medium">{a.question}</p>
                    <Badge variant={a.published ? "success" : "neutral"}>{a.published ? "Publié" : "Brouillon"}</Badge>
                    <div className="flex gap-1">
                      <IconButton label="Monter l’article" disabled={pending || ai === 0} onClick={() => run(() => moveHelpArticle({ id: a.id, direction: "up" }))}>
                        <ArrowUp />
                      </IconButton>
                      <IconButton label="Descendre l’article" disabled={pending || ai === c.articles.length - 1} onClick={() => run(() => moveHelpArticle({ id: a.id, direction: "down" }))}>
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        label={a.published ? "Dépublier" : "Publier"}
                        disabled={pending}
                        onClick={() => run(() => setHelpArticlePublished({ id: a.id, published: !a.published }))}
                      >
                        {a.published ? <EyeOff /> : <Eye />}
                      </IconButton>
                      <IconButton label="Modifier l’article" disabled={pending} onClick={() => open({ kind: "article", categoryId: c.id, article: a })}>
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label="Supprimer l’article"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm("Supprimer cet article ?")) run(() => deleteHelpArticle({ id: a.id }));
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => open({ kind: "article", categoryId: c.id, article: null })}>
                <Plus />
                Ajouter un article
              </Button>
            </div>
          </Card>
        );
      })}

      {editing?.kind === "category" && (
        <CategoryDialog
          category={editing.category}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(() => saveHelpCategory({ id: editing.category?.id, ...input }), () => setEditing(null))
          }
        />
      )}
      {editing?.kind === "article" && (
        <ArticleDialog
          categories={categories}
          categoryId={editing.categoryId}
          article={editing.article}
          pending={pending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            run(() => saveHelpArticle({ id: editing.article?.id, ...input }), () => setEditing(null))
          }
        />
      )}
    </div>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}

function CategoryDialog({
  category,
  pending,
  error,
  onClose,
  onSave,
}: {
  category: FaqCategory | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { title: string; icon: HelpIcon }) => void;
}) {
  const [title, setTitle] = useState(category?.title ?? "");
  const [icon, setIcon] = useState<HelpIcon>(category?.icon ?? "help");
  return (
    <Dialog open onClose={onClose} title={category ? "Modifier la rubrique" : "Nouvelle rubrique"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title, icon });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="category-title">Titre</Label>
          <Input id="category-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Icône</legend>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {HELP_ICONS.map((name) => {
              const Icon = HELP_ICON_COMPONENTS[name];
              return (
                <label
                  key={name}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border p-2 text-xs text-muted-foreground transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="icon"
                    value={name}
                    checked={icon === name}
                    onChange={() => setIcon(name)}
                    className="sr-only"
                  />
                  <Icon className="size-5" aria-hidden />
                  {HELP_ICON_LABELS[name]}
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArticleDialog({
  categories,
  categoryId,
  article,
  pending,
  error,
  onClose,
  onSave,
}: {
  categories: FaqCategory[];
  categoryId: string;
  article: FaqArticle | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: { categoryId: string; question: string; answer: string; published: boolean }) => void;
}) {
  const [category, setCategory] = useState(categoryId);
  const [question, setQuestion] = useState(article?.question ?? "");
  const [answer, setAnswer] = useState(article?.answer ?? "");
  const [published, setPublished] = useState(article?.published ?? true);
  return (
    <Dialog open onClose={onClose} title={article ? "Modifier l’article" : "Nouvel article"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ categoryId: category, question, answer, published });
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="article-category">Rubrique</Label>
          <Select id="article-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="article-question">Question</Label>
          <Input id="article-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="article-answer">Réponse</Label>
          <Textarea
            id="article-answer"
            rows={8}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={MAX_BODY}
            required
          />
          <p className="text-xs text-muted-foreground">
            Une ligne vide crée un paragraphe, « - » en début de ligne crée une liste, les liens https:// et /chemin
            deviennent cliquables.
          </p>
        </div>
        {answer.trim() && (
          <div className="rounded-xl border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Aperçu</p>
            <FaqAnswer text={answer} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="size-4 accent-(--color-primary)"
          />
          Publié sur le centre d’aide
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `src/app/admin/support/faq/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { FaqEditor } from "@/components/admin/support-faq-editor";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/admin";
import { getFaqForAdmin } from "@/server/support-queries";

export const metadata: Metadata = { title: "FAQ" };

export default async function AdminFaqPage() {
  await requireAdmin();
  const categories = await getFaqForAdmin();
  return (
    <>
      <PageHeader
        title="Support"
        description="La FAQ publique du centre d’aide."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/aide" target="_blank">
              <ExternalLink />
              Voir le centre d’aide
            </Link>
          </Button>
        }
      />
      <SupportTabs active="faq" />
      <FaqEditor categories={categories} />
    </>
  );
}
```

- [ ] **Step 3: Verify in the browser**

As admin on `http://localhost:3100/admin/support/faq`:
1. 5 categories with their articles, all "Publié".
2. "Nouvelle rubrique" → title `Facturation`, icon "Carte bancaire" → appears last. "Monter la rubrique" twice → it moves up two places; `/aide` shows the same order (only once it has a published article).
3. "Ajouter un article" in it: question `Comment changer ma carte ?`, answer with a blank line and a `- ` line → the preview shows a paragraph and a list. Save → listed as "Publié"; on `/aide` it appears under Facturation and the search `carte` finds it.
4. "Dépublier" it → badge "Brouillon"; it disappears from `/aide`; the Facturation category disappears from `/aide` too (no published article).
5. "Supprimer la rubrique" on Facturation while it has the draft → error "Déplacez ou supprimez d’abord ses articles."; delete the article, then the category → both gone.
6. No console errors.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint src/app/admin/support/faq src/components/admin/support-faq-editor.tsx`

```bash
git add src/components/admin/support-faq-editor.tsx src/app/admin/support/faq
git commit -m "feat(admin): FAQ editor for the help center

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Docs, full checks, end-to-end pass

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Document the feature in `AGENTS.md`**

In the `## Conventions` list, after the **Traffic** bullet, add:

```markdown
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
  (validated by `safeNextPath`). Server Actions accept 16 MB bodies (`next.config.ts`).
```

- [ ] **Step 2: Run every check**

Run, from the worktree:
```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint
./node_modules/.bin/tsx --test
./node_modules/.bin/next build
```
Expected: typecheck exit 0; eslint no errors; tests `# fail 0`; build succeeds and lists `ƒ /aide`, `ƒ /aide/demandes`, `ƒ /aide/demandes/[id]`, `ƒ /aide/demandes/nouvelle`, `ƒ /admin/support`, `ƒ /admin/support/[id]`, `ƒ /admin/support/developpements`, `ƒ /admin/support/faq`, `ƒ /api/support/attachments/[id]` (all dynamic: they read the session).

- [ ] **Step 3: Copy check**

Run: `grep -rn "—\|–" src/app/aide src/components/support src/components/admin/support-* src/components/admin/dev-board-card.tsx src/lib/support.ts src/lib/support-emails.ts`
Expected: matches only inside code comments, none inside a string or JSX text. Fix any visible one.

- [ ] **Step 4: Edge checks in the browser**

1. Signed in as the pro, `/aide/demandes/<id of a request owned by someone else>` (create one as admin@skedul.test via `/aide/demandes/nouvelle` first): 404 page.
2. Close a request as admin, then as the pro: the composer is replaced by "Cette demande est fermée…", and the bar is grey with a lock on the current step.
3. Decline another request with a reason: the user sees the reason in the thread, can still reply, and the reply puts it back in the admin "À traiter" list without changing its step.
4. Resolve a support-track request (admin clicks "Résolue"), then reply as the user: a « Étape « Prise en charge » » event appears and the bar goes back to step 2 of 3.
5. Rate limit: as a fresh user, create 5 requests, the 6th shows "Vous avez atteint la limite de 5 demandes par jour. Réessayez demain."
6. Stop the dev server (`preview_stop`).

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document the help center and support requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off**

Use `superpowers:finishing-a-development-branch`. PR vs merge and any deploy are the user's call. Remind them: preview/prod get migrations 0008 and 0009 on their next manual deploy (`pnpm db:migrate` runs in the Vercel build), the `aide` slug check of Task 1 passed on prod, and `SUPPORT_BLOB_READ_WRITE_TOKEN` is already set on Vercel for all three environments (private store `skedul-support`).
