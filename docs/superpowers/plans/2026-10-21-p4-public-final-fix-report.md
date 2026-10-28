# P4 final fix pass: report

## Group SEC

Resumed group (workflow wf_f4fa6b21-324). The first SEC implementer was cut off by a usage limit after 281f64b (SEC-1), cac71fb
(SEC-2), 08e4799 (SEC-3), ef8dbf7 (SEC-4) and aed8306 (SEC-5), with SEC-6 left uncommitted in the tree and no report. This run
kept the five commits and checked each one against the brief with `git show`. It fixed in new commits only what was missing
(1d78834 SEC-1, cb9346a SEC-5), then finished and committed SEC-6 (dccd7af). It wrote this whole section from the commits and
from its own runs. Every result below comes from a command this run executed.

- Before: `git rev-parse --short HEAD` = `aed8306`. `git status --short` showed the five SEC-6 files modified (contract,
  séance page, page-metadata.ts / .test.ts, page-wiring.test.ts) and nothing else.
- After: HEAD `dccd7af`, `git status --short` empty.
- Commits of the group, oldest first: 281f64b, cac71fb, 08e4799, ef8dbf7, aed8306 (first implementer); 1d78834, cb9346a, dccd7af
  (this run).
- Mutation tooling: the scratchpad scripts `mutate.cjs` (an exact find/replace that fails when the text is absent) and
  `mut-run.sh` (back the file up, apply one mutation, run the named tests, restore). The mutation specs live in `sec1-mut.json`,
  `sec23-mut.json`, `sec4-mut.json` and `sec6-mut.json`, all in
  `C:\Users\Matheus\AppData\Local\Temp\claude\C--Users-Matheus-Documents-Codage-skedul\54ea5de0-72bd-470a-85e5-991d65fd29bc\scratchpad`.
  Each mutation was restored after its run. `git status` was checked after each batch. One restore did not hold: see SEC-6,
  « Incident ».

### SEC-1 (RND-1, Important): no query parameter, e-mail or token in a framework or library log line

**Kept: 281f64b.** It holds all three layers the brief asks for.

1. `src/lib/safe-read.ts` `safeReadWith(fn, rethrowIfControlFlow)`. On a throw it calls `rethrowIfControlFlow(err)` first, then
   throws `new Error("[read] " + logSafeMessage(err))`. The new error has no `cause` and nothing of the raw stack. An error it
   made itself (tracked in a WeakSet) goes through unchanged, so a nested read does not stack the prefix.
   - `src/server/safe-read.ts` (`server-only`) binds it to `unstable_rethrow` from `next/navigation`.
   - `return safeRead(() => core(db, ..., now))` wraps every export of `src/server/public-queries.ts` (`getPublicPage` inside its
     React `cache()` included), `src/server/client-queries.ts`, `src/server/visitor.ts` (`visitorIpHashes`,
     `currentSessionFacts`, the cached `currentPublicVisitor`) and `resolvePublicPro`.
   - The source guard `src/server/safe-read.test.ts` requires the whole body of each export to be the argument of the one
     `safeRead` it returns. Three guards were updated to the wrapped form without being loosened: `my-space-guards.test.ts`,
     `public-context.test.ts` and `public-queries.test.ts`.
2. `writeAuthLog` is the `logger: { log }` of `buildAuthOptions`. It prints « [auth] » + `logSafeMessage({ message })`, then
   `logSafeMessage` of each Error argument. It drops every other argument and adds no `level` of its own.
3. `src/instrumentation.ts` `register()`: under `process.env.NEXT_RUNTIME === "nodejs"`, it dynamically imports
   `@/lib/log-scrub` and calls `installLogScrub(console)`. The install is idempotent through a `Symbol.for` mark on the console.
   - `scrubLogArgs` replaces an Error whose message, stack, own string or array fields, or cause chain (depth 5) holds a secret.
     A secret is what `holdsLogSecret` names: a « params: » tail, an e-mail address in the strict sense, a `/api/c/` token or a
     `cs_` session id. The replacement Error carries `logSafeMessage(err)` with the same `name` and `digest`.
   - A string that holds a secret goes through `scrubLogText`, which cuts the tail and masks the rest, keeping lines intact.
   - Everything else is untouched.
   - Contract § 1 « URLs and logs » names the three layers.

**Checks of the brief's « check that » points (read in node_modules):**
- `unstable_rethrow` exists in Next 16.2.9 (`next/dist/client/components/unstable-rethrow.server.js`, re-exported by
  `navigation.react-server.js`). It rethrows `isNextRouterError` (notFound, redirect, forbidden, unauthorized),
  `isBailoutToCSRError`, `isDynamicServerError` (the cookies() / headers() bailout during a prerender), `isDynamicPostpone`,
  `isPostpone`, `isHangingPromiseRejectionError` and `isPrerenderInterruptedError`, and it recurses into `cause`.
- `safe-read.test.ts` runs the real `unstable_rethrow` against a real `DynamicServerError`, `notFound()` and `redirect()`.
- Better Auth 1.6.19 (`@better-auth/core/dist/env/logger.mjs`) defaults the level to `"warn"` and filters by level before it calls
  `options.log(level === "success" ? "info" : level, message, ...args)`. That is the shape `writeAuthLog` takes.
- Next's `Log.error` (`next/dist/build/output/log.js` `prefixedLog`) looks up `console[consoleMethod]` at each call.
  `base-server.js` `logError` goes through `_log.error`. Next's own console patches (`node-environment-extensions/console-dim`,
  `console-file`) redefine the method with `defineProperty({ value })`, which keeps it writable, so the wrap stays in the chain.
  The log-scrub test drives the real `Log.error` through an installed wrap.
- `instrumentation.md`: the file goes in `src/`, `register` runs once per server instance, and `NEXT_RUNTIME` selects the runtime.

**Gap found and fixed: 1d78834.** The scrub could throw. The brief puts the scrub inside every `console.error` / `console.warn`, so
it must never throw.
- A scratch probe (`src/lib/zz-scrub-probe.test.ts`, deleted right after) tried six inputs:
  1. an Error whose `message` is a number;
  2. a field array holding a Symbol;
  3. a field array holding an `Object.create(null)`;
  4. an enumerable getter that throws;
  5. a `stack` getter that throws;
  6. a revoked Proxy.
- Results: `scrubLogArgs` threw for all 6. The installed wrap threw back at the caller for all 6. `logSafeMessage` threw for (1)
  and (6) (`text.search is not a function` / `Cannot perform 'getPrototypeOf' on a proxy that has been revoked`).
- Fix:
  - `scrubLogArgs` scrubs each argument under a `try`. When reading the argument throws, the argument is printed as its safe Error
    (`safeErrorOf`: `logSafeMessage`, same name and digest). When even that throws, it is printed as « [unreadable log argument] ».
  - `messageOf` in `log-safe.ts` reads the message under a `try` and keeps a string message only, so `logSafeMessage` answers
    « unknown error » for a value it cannot read.
  - Contract § 1 says so.
- TDD:
  - RED: `./node_modules/.bin/tsx --test src/lib/log-scrub.test.ts src/lib/log-safe.test.ts` gave 17 tests, 15 pass, 2 fail. The
    two failures were « logSafeMessage never throws… » (`TypeError: text.search is not a function`) and « the scrub never
    throws… » (`Got unwanted exception: a message that is not a string`). That failure was expected: the code had no `try`.
  - GREEN: the same two files plus `safe-read.test.ts` and `auth-options.test.ts` gave 49/49.

**Mutation checks** (each RED, then restored):

| File | Mutation | Tests run | Result |
|---|---|---|---|
| `log-scrub.ts` | no inner fallback `try` | log-scrub.test | 1 fail (« never throws ») |
| `log-scrub.ts` | no outer `try` | log-scrub.test | 1 fail |
| `log-safe.ts` | `messageOf` without `try` | log-safe.test | 1 fail |
| `safe-read.ts` | `rethrowIfControlFlow` removed | safe-read.test | 2 fail (control flow, real `unstable_rethrow`) |
| `safe-read.ts` | `{ cause: err }` kept | safe-read.test | 1 fail |
| `safe-read.ts` | raw stack copied | safe-read.test | 1 fail |
| `public-queries.ts` | `getPlanningPage` unwrapped | server/safe-read.test + public-queries.test | 2 fail |
| `client-queries.ts` | `getMySpacePage` unwrapped | server/safe-read.test + my-space-guards.test | 2 fail |
| `visitor.ts` | `currentSessionFacts` unwrapped | server/safe-read.test | 1 fail |
| `public-context.ts` | `resolvePublicPro` unwrapped | server/safe-read.test + public-context.test | 2 fail |
| `auth-options.ts` | `logger:` line removed | auth-options.test | 2 fail |
| `auth-options.ts` | non-Error arguments kept (`String(arg)`) | auth-options.test | 1 fail |
| `auth-options.ts` | raw message (no `logSafeMessage`) | auth-options.test | 1 fail |
| `instrumentation.ts` | `NEXT_RUNTIME` gate removed | log-scrub.test | 1 fail |
| `log-scrub.ts` | install mark check removed | log-scrub.test | 1 fail (idempotence) |
| `log-scrub.ts` | Errors passed through | log-scrub.test | 4 fail |
| `log-scrub.ts` | digest dropped | log-scrub.test | 2 fail |
| `log-scrub.ts` | field and cause walk removed | log-scrub.test | 2 fail |

**Build:** `./node_modules/.bin/next build` exited 0 at dccd7af ("✓ Compiled successfully").
- Every P4 route is `ƒ`: `/[slug]`, `/[slug]/espace`, `/[slug]/merci`, `/[slug]/offre/[offerId]`,
  `/[slug]/seance/[occurrenceId]`, `/mon-espace`, `/api/c/[token]`, `/api/mock-checkout`, `/api/cron/daily`.
- The static set is the same as `task-G4c-build.log`: `/_not-found`, `/apple-icon.png`, `/forgot-password`, `/icon.png`. The log
  holds no prerender error, so the dynamic-usage bailout still propagates.
- `.next/server/chunks/…src_lib_log-scrub_ts….js` holds the scrub, and `.next/server/instrumentation.js` is emitted.

**DB:** `src/lib/auth.db.test.ts` runs through `buildAuthOptions`, so through the logger: 22/22, exit 0, 174 s, tickets-test,
foreground. No other DB test imports auth-options, log-safe, log-scrub or safe-read.

**Deviation:** the safeRead wrap also covers `visitorIpHashes`, which the brief did not name. It is harmless: it is a render read
of `visitor.ts`, and the guard covers every export of the module.

**Residual, as the brief states it:** a plain-object argument, and a plain-object field of an Error (not a string, not an array,
not an Error), reach the console as they came. « Everything else is untouched ». A library that logs `{ email }` as an object is
printed. Layers 1 and 2 cover the known paths.

### SEC-2 (X-1): src/server/public.ts gets its wiring guard

**Kept: cac71fb.** `src/server/public.test.ts`, modelled on `client.test.ts`, checks:
- the `"use server"` directive comes first, and the exact export list holds the five actions;
- each body is `const { slug, rest } = splitActionInput(input);` then one
  `return runPublicAction("<name>", slug, (pro, visitor, now) => <core>(db, pro, visitor, rest[, publicDeps()], now))`;
- no parameter names an identity;
- the exact runtime imports are the db, the five cores, `splitActionInput`, `publicDeps` and `runPublicAction`;
- there is no `getSession`, `cookies`, `headers`, `runEffects` or `revalidatePath`, and `db` is used once per action;
- a self-test proves the scanner can fail.

**Mutation checks** (`src/server/public.test.ts`, 5/5 at baseline):

| Mutation | Result |
|---|---|
| `registerFreeAction` calls its core without `runPublicAction` | 1 fail (wiring) |
| `startShopPurchaseAction` passes `input` instead of `rest` | 1 fail |
| `publicDeps()` dropped from `abandonCheckoutAction` | 1 fail |
| runtime `import { runEffects } from "@/server/notify"` added | 1 fail (imports) |
| an extra exported action added | 1 fail (export list) |

**Outcome carry:** the outcome has no line that lists guarded server files. Its only `src/server/public.ts` line is the P5
`bookRdv` carry (outcome line 95), so nothing was added. The guard's exact export list makes P5 add `bookRdv` to `ACTIONS`, as
the test header says.

### SEC-3 (G4c deferred minor): checkout-return-view.ts import-list guard

**Kept: 08e4799.** `checkout-return-view.test.ts` now holds the identity-schema pattern:
- the runtime imports are exactly `./visibility`, `@/lib/datetime` and `@/lib/public/messages`, and `@/lib/public/release-actions`
  is type-only;
- the source, comments stripped, does not match `server-only|next/|@/lib/db|@/lib/booking|@/lib/env`;
- `visibility.ts` has no runtime import at all.

Transitive check by this run: `@/lib/datetime` imports `@date-fns/tz` only. `@/lib/public/messages` imports `@/lib/tickets-vocab`
only. `visibility.ts` imports types only. All three are client-safe.

**Mutation checks** (32/32 at baseline):

| Mutation | Result |
|---|---|
| value import `abandonCheckoutCore` from release-actions | 1 fail (the guard) |
| `import type { Db } from "@/lib/db"` added | 1 fail (the guard) |
| runtime import of `spaceIdentityOf` into `visibility.ts` | 1 fail (the guard) |
| runtime `import { db } from "@/lib/db"` added | the whole file failed at load (the db module needs its env) |

The last mutation failed before the guard ran, so it proves less. The type-import mutation pins the same rule through the guard.

### SEC-4 (ID-1, ID-2): crossed-row joins scoped to the pro

**Kept: ef8dbf7.** The decision per query:

- **`spendableSeances` drops the crossed row** (inner joins, so the row is not listed and not named):
  - `join event se on se.id = so.event_id and se.professional_id = so.professional_id`;
  - `join ticket_type tt on tt.id = t.ticket_type_id and tt.professional_id = t.professional_id`.
  - « Utiliser vos tickets » offers a booking the engine must accept, so a séance whose event or ticket type belongs to another
    pro must not be offered at all.
- **`getCustomerSpace` blanks the crossed columns** (left-join conditions, so the booking stays listed):
  - `.leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, professionalId)))`;
  - the same for `ticketType`.
  - A crossed event or type shows no title or place: the booking is listed as « Séance » / « Rendez-vous », with this pro's own
    cancellation deadline.
  - The booking is the client's own (`booking.professional_id` and `customer_id` are checked), so it stays listed and cancellable.
- Both file headers were corrected to say what is true. spendable.ts states which engine reads still go by id alone: the holds,
  the questions, and ELIGIBLE's `event_ticket_type` link.

**Broader than the brief.** The same commit rewrote spendableSeances' name subquery and eligibility EXISTS into one
`join lateral (...) pick`. It added the test « each séance is named after the ticket its own accepted types would spend ».
- This run's RED shows the old query had a real naming bug: of three séances that accept different types, the second was listed
  with `ticket_type_name` null instead of « Carte Y ».
- The commit message's diagnosis (Postgres 17 kept a hashed form of the link EXISTS from one séance to the next) is the first
  implementer's. This run did not check it with EXPLAIN. The behaviour is confirmed by the RED below.

**DB runs** (tickets-test through `.env.test`, foreground, one file per process, `--test-concurrency=1 --test-isolation=none`):

| Step | spendable.db.test.ts | customer-space.db.test.ts |
|---|---|---|
| GREEN at HEAD | 7/7, 46 s | 9/9, 45 s |
| RED: the new tests against `git show ef8dbf7^:` sources, then restored | 5/7, 46 s: fails « … points at another pro's event or type is never listed nor named (ID-1) » (the actual result listed « Capoeira roda » and a séance named null) and the naming test | 8/9, 43 s: fails the ID-2 case (actual « Capoeira roda », « Quai Saint-Antoine », « Coaching de l'autre pro », and the other pro's 1 h deadline) |

**Each predicate removed alone, then restored** (each run about 45 s):

| Predicate removed | Result |
|---|---|
| spendable: event `se.professional_id` | 6/7, the ID-1 case fails |
| spendable: ticket_type `tt.professional_id` | 6/7, the ID-1 case fails |
| customer-space: `event.professionalId` | 8/9, the ID-2 case fails |
| customer-space: `ticketType.professionalId` | 8/9, the ID-2 case fails |

**Test pros:** `SELECT count(*) FROM professional WHERE slug LIKE 't-%'` on tickets-test (Neon MCP, project_id and branch_id
br-polished-rain-aftw8y9x) gave 0 before the first DB run, 0 after the SEC-4 runs, and 0 after the last run. No other DB test
imports spendable or customer-space (grep).

### SEC-5 (ID-3): comments say what the guest-cookie space allows

**Kept: aed8306.** The five comments the brief names now say « read and cancel, never spend (contract § 3.23) »:
`src/app/[slug]/espace/page.tsx` ~35 and ~57, `guest-access.ts` ~154 and ~166, `identity.ts` ~152.

**Follow-up: cb9346a.** `grep -rn "read-only" src` found three more lines that make the same claim, so they were reworded the
same way:
- the `guest-access.db.test.ts` comment « opens a read-only space next to the banner »;
- the `identity.db.test.ts` test name « (the banner, read-only) »;
- the `getCustomerSpacePage` doc in `client-queries.ts`, « The read-only espace ».

Comments and a test name only. The other « read-only » hits are about the impersonating admin's block or a locked e-mail field, so
they were left alone.

Runs: eslint on the 3 files gave exit 0. `server/safe-read.test.ts` + `my-space-guards.test.ts` gave 11/11.
`identity.db.test.ts` gave 9/9 (28 s). `guest-access.db.test.ts` gave 16/16 (35 s). Both ran on tickets-test, in the foreground.

### SEC-6 (promoted from RND declined): a payment-return séance URL is never indexed

**Committed: dccd7af.** The diff was reviewed from the tree and kept as the first implementer wrote it.
- `src/lib/public/page-metadata.ts` gains `isPaymentReturn(query)`, true when `p` or `paiement` is present, whatever the value,
  an empty one and a repeated one included.
- It also gains `seanceMetadata(loaded, query)`. That function holds the SEC-M10 rules the page used to hold inline:
  - a public séance is « title · business » and indexable;
  - a private, archived, RDV, unknown or foreign séance carries the business name only, with `robots { index: false }`;
  - an unknown slug gets `notFoundMetadata()`;
  - every case keeps `referrer: "no-referrer"`;
  - a payment return adds `robots: { index: false, follow: false }`, with every other field kept.
- The page's `generateMetadata({ params, searchParams })` is now
  `return seanceMetadata(await loadSeance(slug, occurrenceId), await searchParams);`. In 16.2.9, `searchParams` is a Promise
  (`generate-metadata.md` line 55), available to generateMetadata on `page.js` segments.
- page-wiring.test.ts pins that body exactly, the import, the absence of any viewer read, and the 404-metadata loop (offer and
  séance excluded).
- Contract § 5 séance row amended.

**TDD evidence, run by this run against the old metadata:**
- RED A: `seanceMetadata` given the old rule (the query ignored), on `page-metadata.test.ts`: 5 pass, 2 fail. The SEC-6
  payment-return test failed, and so did the fresh-object test, whose robots object is undefined twice. The SEC-M10 test stayed
  green, as expected: the old rules are kept.
- RED B: `page-wiring.test.ts` against the committed old séance page (`git show HEAD:…page.tsx`, then the new page restored):
  44 pass, 2 fail. The failing tests were the private-séance gate test, now pinned on the `seanceMetadata(…, await searchParams)`
  call, and « the séance metadata never reads the viewer and is seanceMetadata… ».
- GREEN: `page-metadata.test.ts` + `page-wiring.test.ts` gave 53/53.

**Mutation checks, each RED:**

| File | Mutation | Result |
|---|---|---|
| page-metadata.ts | `follow: false` dropped | 1 fail |
| page-metadata.ts | `isPaymentReturn` on `p` only | 1 fail |
| page-metadata.ts | truthiness (`Boolean(query.p) \|\| …`) | 1 fail (`p: ""` must still count) |
| séance page | `{}` passed instead of `await searchParams` | 2 fail |
| séance page | `currentPublicVisitor` read in generateMetadata | 1 fail |

**Runtime check.** The dev server `skedul-tickets` (preview_start, :3102, tickets-dev) was started. `curl` fetched `/altinha-paris`
and picked the séance `73GbtLWqRoHYsG8_pyNcP` from it, then fetched that séance with five queries:

| Query | robots meta | referrer | title |
|---|---|---|---|
| none | no robots meta | no-referrer | « Altinha intermédiaires · Altinha Paris · Skedul » |
| `?p=x` | `noindex, nofollow` | no-referrer | same |
| `?paiement=annule` | `noindex, nofollow` | no-referrer | same |
| `?paiement=annule&p=abc` | `noindex, nofollow` | no-referrer | same |
| `?semaine=2030-01-07` | no robots meta | no-referrer | same |

`preview_logs` at level error reported « No server errors found ». The server was then stopped.

**Incident (fixed before the report).**
1. After the mutation batch, the séance page was left with the `pageNoQuery` mutation (`void searchParams;` and
   `seanceMetadata(…, {})`) instead of the restored file.
2. The first SEC-6 commit, fa0d063, was made from that tree. tsc and eslint pass on that shape.
3. The full pure suite caught it: 1453/1455, the two page-wiring tests failing.
4. The page was restored from the copy saved before the mutations (`cmp`: identical to the reviewed SEC-6 page). The local,
   unpushed commit was amended into dccd7af (`git show dccd7af` shows `await searchParams`).
5. A scan of `git diff 08268de..HEAD` for every mutation marker of this run found 0. The other SEC-6 files hold none of the
   page-metadata mutations: grep found 0 in `HEAD:` of each.
6. Cause not established. `mut-run.sh` restored every other file, and a traced rerun on this page restored correctly. The page's
   mtime (01:10:42.588, millisecond precision, unlike the MSYS `cp` writes) suggests another process, an editor's auto-save for
   example, wrote the mutated buffer back after the restore.

### Group runs

- `./node_modules/.bin/tsc --noEmit`: exit 0, at 1d78834 and again at dccd7af.
- eslint `--max-warnings 0` on the 33 `.ts`/`.tsx` files changed since 08268de (every file the group touched): exit 0, 0 errors,
  0 warnings.
- The pure suite `./node_modules/.bin/tsx --test "src/**/!(*.db).test.ts"` at dccd7af: 1455 tests, 1455 pass, 0 fail, 14.6 s.
- `./node_modules/.bin/next build`: exit 0, see SEC-1.
- DB on tickets-test, foreground, one file per process: spendable 7/7, customer-space 9/9, identity 9/9, guest-access 16/16,
  auth 22/22. Every RED and mutation run listed above was followed by a GREEN of the same file, or by a run at HEAD.
- Browser checks: no SEC item names one. SEC-6 was checked over HTTP with the dev server.

### Test data left

None.
- On tickets-dev: GET requests only (curl runs no JavaScript, so no page view was sent), and no account or row was created.
- On tickets-test: the DB tests delete their own rows, including the hand-built crossed rows of SEC-4 in their `finally`.
  `t-*` pros: 0 after the last run.

## Group PAY

Workflow wf_f4fa6b21-324. One implementer, no subagent. Every result below comes from a command this run executed.

- Before: `git rev-parse --short HEAD` = `dccd7af`, `git status --short` empty.
- After: HEAD `40995bf`, `git status --short` empty.
- Commits, oldest first: `3db8a9e` (PAY-1), `dc4df77` (PAY-2), `40995bf` (PAY-3). PAY-4 has no commit: Better Auth resets the
  expiry on reuse, and the brief says to change nothing in that case.
- Mutation tooling, all in
  `C:\Users\Matheus\AppData\Local\Temp\claude\C--Users-Matheus-Documents-Codage-skedul\54ea5de0-72bd-470a-85e5-991d65fd29bc\scratchpad\pay`:
  - `mut.sh` refuses to start on a dirty tree. It backs the committed file up and applies one mutation with `../mutate.cjs` (an
    exact find/replace that fails when the text is absent). It runs the named tests, restores the file from the backup with `cp`
    (not `git checkout`: `core.autocrlf=true` would rewrite an LF working copy), then checks `cmp` and an empty `git status`.
  - The specs are `pay1-mut.json`, `pay2-mut.json`, `pay3-mut.json` and `pay3-shop-mut.json`.
  - After the last batch, `no-mutation-left.cjs` checked the 23 mutations against `git show HEAD:<file>` and against the tree.
    Every original text is present, and no mutated text is. Its one hit was `setFormError(PUBLIC_UNEXPECTED);`, the catch
    branch of `offer-checkout-form.tsx`, which was already there at `dccd7af`. This check is a guard against the SEC-6 incident.

### PAY-1: the gateway's expire is bounded, and a session never handed out is expired after its seat is released

**Committed: 3db8a9e.**
- `src/lib/stripe.ts`: the gateway's `expire(sessionId)` now calls `expireCheckoutSession(sessionId, RELEASE_OPTIONS)`.
  - `RELEASE_OPTIONS` is `{ timeout: 10_000, maxNetworkRetries: 1 }`, the same options as the retrieve and expire of
    `closeForRelease`.
  - It used to run on the SDK defaults (80 s, 2 retries).
  - The create keeps `createRequestOptions(req.purchaseId)` (15 s, 1 retry, idempotency key).
  - The `RELEASE_OPTIONS` and `expireCheckoutSession` docs now say so.
- `src/lib/public/booking-actions.ts`, `createCheckoutAndAttach`:
  - On a refused attach, it runs `releasePurchase` first. It then clears `openSessionId` and expires the session in its own
    `try`, logged with `logSafeMessage`. It still returns `stale` with the release's effects.
  - `abandonPurchase` (after a throw past the create) releases first, then expires. Each step has its own `try`.
  - So a stalled Stripe call no longer holds the seat for its whole timeout.
- `src/lib/payments/checkout.ts`: the `CheckoutGateway.expire` doc says « best effort, run after the purchase is released,
  bounded (10 s, one retry), never throws ».
- Contract amended in the same commit:
  - the § 3.6 interface doc;
  - the closeForRelease / expire bullet;
  - § 3.9 step 11 (release, then expire) and step 13 (the abandonPurchase order and the late-payment argument);
  - § 3.10;
  - § 4 row 1.
- Outcome amended in the same commit: line 35, the 90 s carry.

**Why releasing before the expire is safe.** Every expire inside `createCheckoutAndAttach` is reached before any URL leaves the
server:
- A refused attach returns `stale` with no `checkoutUrl` key (S24).
- A throw is rethrown, and `runPublicActionWith` answers `PUBLIC_UNEXPECTED`.
- A `checkout_url` stored by an attach that committed and then threw is shown by purchase-reads only while the purchase is
  pending.

If a payment still lands, the webhook finds the purchase by its metadata `purchaseId` and checks amount and currency.
`fulfillPurchase` pays from `pending` or `expired`. A booking that is no longer pending is not confirmed: the tickets are issued
`available` and `email.late_payment` goes out (fulfillment.db.test « E10 late payment », release.db.test « T5 »). « Libérer ma
place » (`closeForRelease`) is unchanged and keeps expire-then-release, because its URL was handed out.

**Worst case.**
- Bounded call: one call under `RELEASE_OPTIONS` takes at most about 20.5 s when each try stalls (2 tries of 10 s plus a 0.5 s
  back-off). It takes about 70 s if Stripe answers with a 60 s Retry-After (the SDK caps the wait at 60 s,
  `MAX_RETRY_AFTER_WAIT`).
- Clean-up path: one DB release and one expire.
- « Libérer ma place »: a retrieve and an expire, so about 41 s when stalled. In theory it can reach about 140 s with two maximal
  Retry-After answers.
- The outcome's 90 s carry now gives these numbers.

**Tests.**
- `src/lib/payments/checkout.test.ts` gains a source guard, built on `bodyOf`/`codeView` and a balanced argument extractor
  `callArgsOf`. It checks that:
  - the `RELEASE_OPTIONS` literal is pinned;
  - the real gateway (from `function stripeGateway(` to `const mockGateway`) holds exactly 3 `client.` calls and 1
    `expireCheckoutSession(` call, and no `stripe.` call;
  - each of those calls ends with `RELEASE_OPTIONS` or `createRequestOptions(req.purchaseId)`;
  - both `stripe.` calls in `expireCheckoutSession` end with `options`.
- `src/lib/public/booking-actions.db.test.ts` gains the helper `seatWhileExpireStalls`. It stalls `fake.expire`, reads the
  booking status and `seats_taken` while the call is stalled, and unstalls in a `finally`. Two tests use it:
  - « a refused attachment frees the seat BEFORE it asks Stripe to expire the session… (PAY-1) »;
  - « a throw after the session was created frees the seat BEFORE… (PAY-1) ».

**RED, against the old code:**
- `tsx --test src/lib/payments/checkout.test.ts`: the new guard failed with « a gateway call ends with "sessionId", not bounded
  options ».
- `tsx --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none --test-name-pattern="PAY-1"
  src/lib/public/booking-actions.db.test.ts`: 2 tests, 0 pass, 2 fail. Both failed with « the seat is back while Stripe still
  hangs »: actual `{ seatsTaken: 1, status: 'pending' }`, expected `{ seatsTaken: 0, status: 'expired' }`.

**GREEN:** `checkout.test.ts` 19/19. The full pure suite at 3db8a9e gave 1456/1456. `booking-actions.db.test.ts` at HEAD gave
59/59 (256 s).

**Mutation checks, each RED:**

| File | Mutation | Tests | Result |
|---|---|---|---|
| stripe.ts | gateway `expireCheckoutSession(sessionId)` without options | checkout.test | 1 fail (« a gateway call ends with "sessionId" ») |
| stripe.ts | `closeForRelease` retrieve without options | checkout.test | 1 fail (same message) |
| stripe.ts | `expireCheckoutSession`'s `stripe…expire` drops `options` | checkout.test | 1 fail |
| stripe.ts | `RELEASE_OPTIONS` set to `{ timeout: 80_000, maxNetworkRetries: 2 }` | checkout.test | 1 fail (literal pinned) |
| stripe.ts | create without `createRequestOptions` | checkout.test | 2 fail |
| booking-actions.ts | refused attach: expire before release (the old order) | booking-actions.db, PAY-1 | 1 fail (« the seat is back while Stripe still hangs ») |
| booking-actions.ts | abandonPurchase: expire before release (the old order) | booking-actions.db, PAY-1 | 1 fail (same) |

Deviations: none.

### PAY-2: the offer checkout leaves only for a URL `safeCheckoutUrl` accepts

**Committed: dc4df77.**
- `src/components/public/offer-checkout-form.tsx`: on success, it computes
  `const target = safeCheckoutUrl(res.checkoutUrl, window.location.origin)` (imported from `@/lib/public/buy-and-book-form`).
  - When `target` is not null: `setRedirecting(true); window.location.assign(target); return;`.
  - When it is null: `setFormError(COPY.CHECKOUT_FAILED)` and `refused()`. That is the séance page's own answer
    (`occurrence-booking.tsx`), on the always-mounted alert line, with the focus following it.
- `src/components/public/offer-checkout-form.test.ts`:
  - the success regex now reads `assign(target); return;`;
  - the `refused()` count is now 4;
  - a new test pins the import, the whole flow, a single `window.location.assign(`, a single `res.checkoutUrl`, and no other way
    out (`location.href`, `replace`, `router`).
- The contract's § 3.23 `OfferCheckoutForm` row now names `safeCheckoutUrl` and `COPY.CHECKOUT_FAILED`.

**RED, against the old form:** `tsx --test src/components/public/offer-checkout-form.test.ts` gave 11 tests, 8 pass, 3 fail: the
new PAY-2 test, the success test and the alert-line test (whose `refused()` count rose to 4).

**GREEN:** `offer-checkout-form.test.ts` 11/11. The full pure suite at dc4df77 gave 1457/1457.

**Mutation checks, each RED:**

| Mutation | Result |
|---|---|
| `window.location.assign(res.checkoutUrl)` (the raw URL) | 2 fail |
| `const target = res.checkoutUrl` (no check) | 1 fail |
| a null target still leaves for `res.checkoutUrl` | 2 fail |
| `PUBLIC_UNEXPECTED` instead of `COPY.CHECKOUT_FAILED` | 1 fail |
| `window.location.href = target` | 2 fail |

Browser checks: the brief names none for PAY. Deviations: none.

### PAY-3: a paid offer is payable on Stripe (Change to spec, stricter)

**Committed: 40995bf.**
- New file `src/lib/back-office/offer-price.ts`, pure and client-safe:
  - `STRIPE_MINIMUM_CENTS = { eur: 50 }`, with 50 minor units as the fallback for a currency without an entry;
  - `stripeMinimumCents(currency)`, case-insensitive, an own-property lookup (so `constructor` and `toString` get the fallback);
  - `offerPriceMinimumError(currency)` = « Prix : minimum 0,50 € », with the amount from `formatMoney`, in the style of the
    schema's « Prix : minimum 1. »;
  - `offerPriceRefusal(priceCents, currency)`: that message for a finite number under the minimum (0 and negatives included),
    and null otherwise. A non-number stays the schema's to refuse.
- `src/lib/back-office/catalog-actions.ts`:
  - `parseOffer(input, currency)` runs `parseFr(offerInputSchema, input)`, then the minimum.
  - `createOfferCore` calls `parseOffer(input, ctx.currency)`. `updateOfferCore` calls it with the offer's own `ticketTypeId`.
  - `setOfferActiveCore` refuses `isActive: true` on an offer priced under the minimum, with « Prix : minimum 0,50 €. Modifiez son
    prix pour la mettre en vente. ».
- `src/lib/back-office/offer-form.ts`: `offerInputFromForm(ticketTypeId, f, currency)` refuses the same price under the price
  field, with the server's own message, after the maximum check.
- `src/components/dashboard/offer-list.tsx`:
  - it passes the pro's `currency`;
  - `PRICE_HELP` becomes `priceHelp(currency)`: « Minimum 0,50 €. Pas d'offre gratuite : pour donner des tickets, utilisez
    « Offrir » dans la fiche client. ».
- Where `currency` comes from: the `professional.currency` column defaults to `"eur"`, and no code path writes another value
  (onboarding, settings, seed). Only the euro needs an entry.
  - Stripe's minimum for EUR is 0,50 € (docs.stripe.com/currencies, « Montant débité minimum par devise », read on 2026-10-28).
  - The `stripe docs` CLI plugin is not installed, and installing it would be a download, so the page was read with WebFetch.
  - `offer-price.test.ts` pins the schema default `"eur"`.
- No migration: the DB CHECK `ticket_offer_price_chk` and the engine's `offerInputSchema` keep `> 0`.
- Contract: new Decision 76, a « Change to spec » of L285, with its reason and its cost. Outcome: the matching line in « For the
  owner », in the Changes to the spec list.

**How the public checkout answers an offer written under the minimum before this commit:**
- With Stripe, the create throws (Stripe refuses the amount).
- `createCheckoutAndAttach` logs « [public] checkout create failed: » plus `logSafeMessage`, then releases the purchase
  (`expired`).
- The visitor gets `COPY.CHECKOUT_FAILED`: « Le paiement n'a pas pu démarrer. Réessayez dans un instant. ». That is neutral
  French and never Stripe's text.
- The new shop-actions DB test pins it. Its fake create throws a Stripe-like `amount_too_small` error. The test asserts:
  - the copy;
  - no `code`, and nothing about the amount in the result;
  - the purchase expired;
  - one log line.
- Such an offer stays listed in the Boutique. « Réessayez » cannot help the visitor (see Concerns).
- The pro can take the offer off sale, and cannot put it back on sale without raising its price.
- The mock gateway (dev only) has no minimum and would pay it.
- tickets-dev holds 0 such offers (a read-only query).

**Tests.**
- `offer-price.test.ts`, 4 tests:
  - the table and its fallback (`usd`, `constructor`, `toString`, `""`);
  - the schema default;
  - the message, which equals `formatMoney` and reads « Prix : minimum 0,50 €. » with no dash;
  - `offerPriceRefusal` over 49, 1, 0, -5 and 49.5 (refused), 50 and up (null), and non-numbers (null).
- `offer-form.test.ts`, 2 tests:
  - 0,49, 0.3 and 0,01 are refused under `price`, and 0,50 gives 50;
  - a wiring guard on `offer-list.tsx` (the currency passed, the help, the template).
- `catalog-actions.db.test.ts`:
  - the old « free offer » case now expects `offerPriceMinimumError("eur")`;
  - a new test covers create at 49 (refused) and 50 (accepted), update to 49 (refused) and at 50 (ok), an offer made at 30
    (off sale allowed, back on sale refused), and raising it to 500 while en vente (accepted).
- `shop-actions.db.test.ts`: the test above.

**RED:**
- Pure tests before the module existed: both files failed to load (« Cannot find module './offer-price' »).
- Then, with the module and before the wiring: 14 tests, 12 pass, 2 fail (the `offerInputFromForm` test and the dialog wiring
  guard).
- DB, `--test-name-pattern="PAY-3|createOfferCore: validation"` on `catalog-actions.db.test.ts`: 2/2 fail.
  - The « free offer » case got « Prix : minimum 1. ».
  - The create at 49 cents got `{"ok":true,…}`.

**GREEN:**
- `offer-price` + `offer-form` + `final-review-ui` gave 24/24.
- The full pure suite at 40995bf gave 1463/1463.
- `catalog-actions.db.test.ts` gave 14/14 (83 s), and `shop-actions.db.test.ts` 15/15 (54 s).

**Mutation checks, each RED:**

| File | Mutation | Tests | Result |
|---|---|---|---|
| catalog-actions.ts | `parseOffer` returns `parsed` (no minimum) | catalog-actions.db, PAY-3 | 1 fail (« create at 49 cents: expected a refusal ») |
| catalog-actions.ts | update parses with the bare schema | catalog-actions.db, PAY-3 | 1 fail (« update to 49 cents: expected a refusal ») |
| catalog-actions.ts | toggle refusal `if (false)` | catalog-actions.db, PAY-3 | 1 fail (« put the older offer back en vente: expected a refusal ») |
| offer-price.ts | `<=` instead of `<` | offer-price + offer-form | 2 fail |
| offer-price.ts | a fixed minimum of 1 | offer-price + offer-form | 2 fail |
| offer-price.ts | fallback 0 | offer-price + offer-form | 1 fail |
| offer-form.ts | form check dropped | offer-form | 1 fail |
| offer-list.tsx | `"eur"` instead of the pro's currency | offer-form | 1 fail |
| offer-list.tsx | help hard-coded « Minimum 0,50 €. » | offer-form | 1 fail |
| booking-actions.ts | the create failure returns `err.message` | shop-actions.db, the PAY-3 test | 1 fail |
| booking-actions.ts | the create failure does not release | shop-actions.db, the PAY-3 test | 1 fail (« the pending purchase is released at once ») |

**Deviations, with reasons:**
1. **The en-vente toggle is refused too.** The brief names create and update only. Without the toggle refusal, an offer under the
   minimum that is taken off sale could be put back on sale, the very state the brief rules out. Taking an offer off sale stays
   allowed, and so does an update that raises its price.
2. **The minimum wins over the schema.** In `parseOffer`, a finite price under the minimum is answered with the minimum message
   even when the schema also fails. A price of 0 now reads « Prix : minimum 0,50 € » instead of « Prix : minimum 1. ».
3. **No HTML `min` on the price input.** The brief says the form's input « carries the same min ». The price field is a decimal
   text input (`inputMode="decimal"`, French comma, parsed by `parseMoneyInput`), and an HTML `min` does nothing there. The same
   minimum is therefore enforced in `offerInputFromForm`, with the same message under the field, and named in the help.

### PAY-4: does a reused code keep its first expiry?

**No. No change, no commit, as the brief prescribes.**
- The source is Better Auth 1.6.19 (`node_modules/better-auth/package.json`).
- `src/lib/auth-options.ts` sets `resendStrategy: "reuse"`, `expiresIn: 300`, `storeOTP: "encrypted"` and
  `allowedAttempts: 3`.
- `node_modules/better-auth/dist/plugins/email-otp/otp-token.mjs`, `tryReuseOTP`, line 51:

  `await ctx.context.internalAdapter.updateVerificationByIdentifier(identifier, { expiresAt: getDate(opts.expiresIn, "sec") });`

  So a reused code gets a new 300 s expiry, counted from the resend.
- The guards before that line (45 to 50) return null for these codes:
  - an expired code;
  - a code at `allowedAttempts`;
  - a code whose plain text cannot be recovered (hashed). With `storeOTP: "encrypted"` it can be recovered, so reuse does happen
    in this app.
- With no `secondaryStorage`, `updateVerificationByIdentifier` updates the DB row by identifier
  (`dist/db/internal-adapter.mjs` lines 771 to 792).
- When no code is reused, `resolveOTP` (`routes.mjs` lines 28 to 51) stores a fresh one with `getDate(opts.expiresIn, "sec")`.
- So « Il est valable 5 minutes. » is true for the first send and for every resend.
- `auth.db.test.ts` T13 already shows that a resend within 5 minutes reuses the first code. No test pins the refreshed expiry
  (see Concerns).

### Group runs

- `./node_modules/.bin/tsc --noEmit`: exit 0 at 40995bf, and after each item.
- `./node_modules/.bin/eslint` on the 15 `.ts`/`.tsx` files changed since dccd7af: exit 0.
- The pure suite `./node_modules/.bin/tsx --test "src/**/!(*.db).test.ts"`:
  - 1456/1456 at 3db8a9e;
  - 1457/1457 at dc4df77;
  - 1463/1463 at 40995bf (14.6 s), 0 fail.
- DB tests on tickets-test at 40995bf, in the foreground, one file per process (`--test-concurrency=1 --test-isolation=none`).
  The last three import `payments/checkout.ts`, whose doc changed.

  | File | Result | Time |
  |---|---|---|
  | booking-actions | 59/59 | 256 s |
  | shop-actions | 15/15 | 54 s |
  | catalog-actions | 14/14 | 83 s |
  | release-actions | 16/16 | 105 s |
  | mock-checkout | 10/10 | 54 s |
  | webhook-core | 24/24 | 116 s |

- `./node_modules/.bin/next build`: exit 0 in 31 s. Its only warning is the inherited workspace-root one. Client components
  changed: `offer-checkout-form.tsx` and `offer-list.tsx`.
- Dash check (`dashcheck.cjs`): 0 U+2013 or U+2014 in the changed code files and in the doc lines the group added.
- Browser checks: the brief names none for PAY, and none was run.

### Test data left

None.
- tickets-dev: one read-only query (offers under 50 cents: 0). No row was written.
- tickets-test: the DB tests delete their own rows. Each mutation run ended on a failed assertion, not a kill, so the `dbTest`
  clean-up ran.
- A read-only check after the last run found 0 `t-%` pros and 0 `t-%@skedul.test` users.

## Group UI

Workflow wf_f4fa6b21-324. One implementer, no subagent. The run was resumed once after a context compaction, between UI-3 and
UI-4. Every result below comes from a command this run executed. The mutation batches of UI-1 to UI-3 were run again at
`5d64abc` for this report, and every mutation was caught again. The tables below give the failing tests of that rerun.

- Before: `40995bf`, and `git status --short` was empty.
- After: HEAD `5d64abc`, and `git status --short` is empty.
- Commits, oldest first:
  - `dbd4625` (UI-1)
  - `2831e95` (UI-2)
  - `f6a2344` (UI-3)
  - `1bc91b7` (UI-4)
  - `5d64abc` (UI-5)
- Mutation tooling is in
  `C:\Users\Matheus\AppData\Local\Temp\claude\C--Users-Matheus-Documents-Codage-skedul\54ea5de0-72bd-470a-85e5-991d65fd29bc\scratchpad`.
  - `mutate.sh <label> <file> <perl -0 substitution> <test file>` does one mutation. It backs the file up and applies the
    substitution. It stops when nothing changed (« MUTATION DID NOT APPLY »). It runs the named test file, restores the file
    with `cp`, checks `cmp`, and prints the failing tests.
  - The batches are `mut-ui1.sh` to `mut-ui5.sh`, plus `mut-ui2-n7.sh` and `mut-ui5-r6.sh`.
  - `git status --short` was empty after every batch.
- The `design-taste-frontend` skill was loaded before the visible change of UI-1 (the brief asks for it).

### UI-1 (AUTH-1, Important): the inline code sign-in lands on the page heading and says so

**Committed: dbd4625.**

- `src/components/auth/email-code-form.tsx` gets a new serializable prop, `focusAfterSignIn?: string` (an element id).
  - In `onVerify` the order is: the fresh `getSession` (errors swallowed, unchanged), then
    `document.getElementById(focusAfterSignIn)?.focus()` and `announceSignIn(COPY.SIGNED_IN)`, then
    `setDone(true); onSignedIn?.(); router.refresh();`.
  - The focus and the announcement both come before the refresh that unmounts the form.
  - `onSignedIn` is unchanged for `OtpDialog`.
- New file `src/components/auth/sign-in-status.tsx`, on the `ReleaseStatus` pattern.
  - It holds a `createLineStore()` module store and exports `announceSignIn(text)`.
  - `SignInStatus` reads the store with `useSyncExternalStore` and renders an always-mounted
    `<p role="status" className="sr-only">`.
  - The store is emptied on mount and on unmount, so an old line is never read on another page.
- `COPY.SIGNED_IN` is « Connexion réussie. » (gender-neutral).
- `src/lib/public-anchors.ts` adds `MY_SPACE_HEADING_ID = "my-space-title"` and `ESPACE_HEADING_ID = "espace-title"`.
- `/mon-espace`:
  - The existing h1 « Mon espace client » gets the id, `tabIndex={-1}` and the focus-visible ring (`w-fit rounded`).
  - `<SignInStatus />` comes right after the h1, before the banner and outside every state branch.
  - The form gets `focusAfterSignIn={MY_SPACE_HEADING_ID}`.
- `/[slug]/espace`:
  - A new h2 `COPY.MY_SPACE` « Mon espace » sits inside `PublicShell`, before the banner and the identity switch. It is
    therefore present in the anonymous, customer and no_record branches.
  - It gets the id, `tabIndex={-1}` and the same ring. `PublicShell`'s linked h1 is untouched.
  - `<SignInStatus />` comes after the h2.
  - The form gets `focusAfterSignIn={ESPACE_HEADING_ID}`.
- `src/components/public/customer-space.tsx`: the greeting « Bonjour {name} » is now a `<p>`, no longer an h2 (see the
  deviations).
- Guards:
  - `code-sign-in-guards.test.ts`, 3 new tests:
    - the form focuses and announces before `router.refresh()`;
    - the `SignInStatus` pattern;
    - every `<EmailCodeForm` names its focus target, either `onSignedIn` or `focusAfterSignIn`. A `focusAfterSignIn` id must
      be an `id={X} tabIndex={-1}` target, with exactly one `<SignInStatus />` on its page, and the set of such pages must be
      exactly espace and mon-espace.
  - `my-space-guards.test.ts`: 1 new test.
  - `espace-ui.test.ts`: 1 new test. The banner test now expects the h2 and the status line first.
  - `ui-copy.test.ts`: `OPTIONAL` gains `sign-in-status.tsx`.
  - `messages.test.ts`: the deepEqual is updated.
- Contract:
  - § 2.3: the `email-code-form.tsx` row is updated, and there is a new `sign-in-status.tsx` row.
  - § 3.16: the three new signatures, and the `EmailCodeForm` row (props, success sequence, mounting rule).
  - § 3.23: the espace additions and the `/mon-espace` copy.
  - The `COPY` key list (§ 3.x, « exact keys and strings ») only got `SIGNED_IN` in UI-4's amendment. It was missed here and
    fixed there.

**RED:** 8 failing tests. **GREEN:** 56/56 on the touched test files. The pure suite at `dbd4625` gave 1468/1468.

**Mutation checks.** All were caught. The « b » runs apply the same mutation against the other guard file.

| Mutation | Failing test |
|---|---|
| M1: the focus block moved after `router.refresh()` | code-sign-in-guards: « …before the refresh unmounts it » |
| M2: no `announceSignIn` | same |
| M3: no `.focus()` | same |
| M4: the store is not emptied on mount/unmount | code-sign-in-guards: « the sign-in status line is one always-mounted… » |
| M5: the status line is not `sr-only` | same |
| M6: no `role="status"` | same |
| M7 / M7b: no `tabIndex` on the /mon-espace h1 | code-sign-in-guards « every EmailCodeForm says where the focus goes » / my-space-guards AUTH-1 |
| M8 / M8b: /mon-espace does not pass `focusAfterSignIn` | same pair |
| M9: /mon-espace `SignInStatus` moved into the anonymous branch | my-space-guards AUTH-1 |
| M10 / M10b: no `tabIndex` on the espace h2 | espace-ui AUTH-1 / code-sign-in-guards |
| M11: espace `SignInStatus` moved into a branch | espace-ui: 2 tests (the banner placement and AUTH-1) |
| M12 / M12b: espace does not pass `focusAfterSignIn` | espace-ui AUTH-1 / code-sign-in-guards |
| M13: two `SignInStatus` on the espace page | code-sign-in-guards |

**Browser.** The dev server was `skedul-tickets` (port 3102), with e-mail in mock mode. These were real inline code sign-ins.
Each code was read from the dev log with `preview_logs` and typed into the form, and no code is written here.

- `/mon-espace` at 1280 px, with the new account `test-p4-final-1@skedul.test` (created by this sign-in):
  - `document.activeElement` was `H1#my-space-title`.
  - The status line read « Connexion réussie. ».
  - A `focusin` log showed only `my-space-title`, never `body`.
  - The form was gone and `MySpaceView` was shown.
- `/mon-espace` at 375 px, with the same account (a returning sign-in, after a sign-out): the same results.
- `/altinha-paris/espace` at 1280 px, with the new account `test-p4-final-2@skedul.test`, then at 375 px (a returning sign-in):
  - the active element was `H2#espace-title`;
  - the status line was present;
  - the page showed the no_record branch.
- At both widths there was no horizontal scroll (`scrollWidth` equal to the viewport width).
- The customer branch, checked with the demo client quick login:
  - the headings are h1 « Altinha Paris » (`PublicShell`), h2 « Mon espace », then the h3 of the cards;
  - the greeting is a paragraph.

**Deviations.**

1. `CustomerSpaceView`'s greeting is a `<p>`, no longer an h2. The new h2 « Mon espace » now names the section. Keeping the
   greeting as an h2 would put two h2 one under the other with nothing between them. `MySpaceView` already shows its greeting
   the same way.
2. None other. `PublicShell` is untouched, as the brief asks.

### UI-2 (AUTH-2): the Google link round trip keeps the return path

**Committed: 2831e95.**

- `src/lib/public/sign-in-flow.ts`, all pure:
  - `linkReturnPath(next)`: `safeNextPath(next)`, then the path only (query and hash dropped), else null.
  - `linkGoogleHref(next)`: `/link-google?next=<path>`, or a bare `/link-google`.
  - `linkGoogleCallbacks(next)`: `callbackURL` is `/sign-in[?next=]`, `errorCallbackURL` is `/link-google[?next=]`.
- `/sign-in` and `/sign-up`: `if (error === "account_not_linked") redirect(linkGoogleHref(rawNext));`.
- `/link-google` reads `next` and hands `linkReturnPath(next)` to `LinkGoogleForm`, never the raw parameter.
- `LinkGoogleForm`:
  - it takes a new `next?: string | null`;
  - it calls `authClient.linkSocial({ provider: "google", callbackURL, errorCallbackURL })` from `linkGoogleCallbacks(next)`;
  - « Continuer sans Google » and « Annuler » use `href={callbackURL}`.
- Tests: 3 pure tests in `sign-in-flow.test.ts` and 1 guard in `auth-ui-guards.test.ts`.
- Contract: the § 3.15 `link-google-form` bullet and the § 3.16 signatures.

**RED:** 4 failing tests. **GREEN:** 35/35.

**Mutation checks.** All were caught.

| Mutation | Result |
|---|---|
| N1: `linkReturnPath` keeps the query | 3 fail (the three pure tests) |
| N2: no `safeNextPath` (any string accepted) | 3 fail |
| N3: `errorCallbackURL` back to `/sign-in` | 1 fail (`linkGoogleCallbacks`) |
| N4: `/sign-in` redirects to a bare `/link-google` | 1 fail (the guard) |
| N5: the same on `/sign-up` | 1 fail |
| N6: the link page passes the raw `next` | 1 fail |
| N7: a literal `callbackURL: "/sign-in"` in the form | 1 fail. The first run did not apply (a CRLF file); it was rerun with `\r?\n` |
| N8: « Annuler » back to a bare `/sign-in` | 1 fail |

**curl** against the dev server (status, then redirect):

- `/sign-in?error=account_not_linked&next=%2Faltinha-paris%2Fespace%3Fp%3Dref_1` gave `307 /link-google?next=%2Faltinha-paris%2Fespace`.
  The `p` is dropped.
- `/sign-up?error=account_not_linked&next=%2Faltinha-paris` gave `307 /link-google?next=%2Faltinha-paris`.
- `/sign-in?error=account_not_linked&next=%2F%2Fevil.example` gave `307 /link-google`.
- `/sign-in?error=account_not_linked` gave `307 /link-google`.

**Browser:** not possible. Google is not configured on tickets-dev, so `/link-google` itself redirects to `/sign-in` and the form
never renders.

**Deviations.**

1. `next` is reduced to its path. `safeNextPath` accepts a query, and a query can carry `p`, which must never travel into an
   OAuth state (SEC-M7). The cost: a `?sujet=` prefill of `/aide/demandes/nouvelle` is lost on this rare round trip.
2. `errorCallbackURL` is `/link-google?next=`, not the `/sign-in?next=` the brief names. At that point the user has just signed
   in with their password (the link page's step 2). On `/sign-in`, a signed-in user is redirected on to `next` or to the entry
   chooser, so Better Auth's `?error=` would be dropped without a word. The link page reads `error`, shows it and offers to retry.
3. « Annuler » and « Continuer sans Google » keep `next` too. Without that, the page to come back to would be lost on these two
   ways out.

### UI-3 (AUTH-3): VerifyEmailBanner says it is busy

**Committed: f6a2344.**

- `src/components/dashboard/verify-email-banner.tsx` imports `COPY`. The banner is shown to clients too, and `COPY` is where
  the pending labels live.
  - Banner button: `{sending ? COPY.PENDING_SEND : sent ? "Saisir le code" : "Recevoir un code"}`.
  - The dialog's « Renvoyer le code »: `{sending ? COPY.PENDING_SEND : "Renvoyer le code"}`.
  - The dialog's « Confirmer »: `{verifying ? COPY.PENDING_VERIFY : "Confirmer"}`.
  - The dialog's failure line is `<FormError alwaysMounted message={dialogError} ref={dialogErrorBox} tabIndex={-1} />`.
  - `Dialog` renders nothing while it is closed, so `dialogErrorBox.current` stays null then, and the banner-error focus effect
    behaves as before.
  - The doc comment says so.
- Guard: one test in `auth-ui-guards.test.ts`. It pins the three labels and the always-mounted line, and it checks that all 3
  `Loader2` are `aria-hidden`.
- Contract: the § 3.15 `VerifyEmailBanner` bullet.

**RED:** 1 failing test. **GREEN:** 5/5.

**Mutations, each caught by the AUTH-3 test:**

- P1: no pending label on the banner button.
- P2: no pending label on « Renvoyer le code ».
- P3: no pending label on « Confirmer ».
- P4: `FormError` without `alwaysMounted`.
- P5: a visible spinner.

**Browser:** the brief names none, and none was run.

**Deviations:** none.

### UI-4 (AUTH-4): AuthForm's error and pending state are announced

**Committed: 1bc91b7.**

- `src/components/auth/auth-form.tsx`:
  - The `{error && <p role="alert">…}` line is replaced by `<FormError alwaysMounted message={error} />`. While empty it is a
    screen-reader-only alert from the first render. With a text it has the same classes as before, plus the focus-visible ring
    (it has no `tabIndex`, so it is not focusable).
  - The submit reads
    `{loading ? (isSignUp ? COPY.PENDING_SIGN_UP : COPY.PENDING_SIGN_IN) : isSignUp ? "Créer mon compte" : "Se connecter"}`.
  - Both `Loader2` spinners (the Google button and the submit) get `aria-hidden`.
  - The form stays `method="post"` (G4b).
- `COPY` had no « Connexion… » or « Création… » key, so `PENDING_SIGN_IN` « Connexion… » and `PENDING_SIGN_UP` « Création… »
  were added next to the other pending labels. `AuthForm` serves clients too, and the sign-in page already reads `COPY`.
- Guard: one test in `auth-ui-guards.test.ts`. It checks:
  - both imports;
  - the always-mounted line;
  - that no `{error && (` and no local `role="alert"` remain;
  - the label expression;
  - 2 spinners, both `aria-hidden`;
  - `<form method="post" onSubmit={onSubmit}`.
  `messages.test.ts` has the two new keys.
- Contract:
  - the § 2.3 `auth-form.tsx` row;
  - the § 3.18 `auth-form.tsx` paragraph;
  - the `COPY` key list, which gains `SIGNED_IN` (from UI-1), `PENDING_SIGN_IN` and `PENDING_SIGN_UP`.

**RED:** 2 failing tests, the new guard and the `COPY` deepEqual. **GREEN:** 51/51 over `auth-ui-guards`, `messages`, `entry`,
`ui-copy` and `code-sign-in-guards`.

**Mutation checks.** All were caught.

| Mutation | Failing test |
|---|---|
| Q1: a conditionally mounted `<p role="alert">` again | AUTH-4 guard |
| Q2: `FormError` without `alwaysMounted` | AUTH-4 guard |
| Q3: no pending label | AUTH-4 guard |
| Q4: the sign-in and sign-up labels swapped | AUTH-4 guard |
| Q5: a visible submit spinner | AUTH-4 guard |
| Q6: a visible Google spinner | AUTH-4 guard |
| Q7: `<form onSubmit>` without `method="post"` | AUTH-4 guard |
| Q8: `PENDING_SIGN_IN` spelled « Connexion... » | messages: « COPY holds every fixed client sentence » |
| Q9: a third, unhidden `Loader2` | AUTH-4 guard |

**Browser.** The brief names none. This one was run because the change is visible.

- `/sign-in` at 1280 px: the form holds one alert, empty and `sr-only`. `method="post"`.
- `/sign-in?error=BANNED_USER`: the suspended-account sentence shows in the same red box as before.
- A submit with the address `nobody-p4-ui4@skedul.test`, which has no account, and a random junk password generated in the page:
  - the button read « Connexion… », was disabled, and its spinner had `aria-hidden="true"`;
  - then « Email ou mot de passe incorrect. » appeared in the same alert node, the one mounted before the submit;
  - the button went back to « Se connecter ».
- `/sign-up` at 375 px, with the existing test address `test-p4-final-1@skedul.test` and a junk password:
  - the button read « Création… »;
  - then « Un compte existe déjà avec cet email… » appeared in the same node;
  - there was no horizontal scroll, and the screenshot was checked.
- tickets-dev afterwards: `test-p4-final-1` was unchanged (name empty, `updated_at` from the UI-1 run), and there is no
  `nobody-p4-ui4` row.

**Deviations.**

1. The two pending labels are new `COPY` keys. The brief says to use existing keys « if any », and there were none.
2. The Google button keeps its label while it redirects, since the page is left right away. Only its spinner changed.

### UI-5 (AUTH-5): the name field stops at its bound

**Committed: 5d64abc.**

- `src/components/public/my-name-form.tsx`: `maxLength={BOUNDS.name}` (80, the bound of `plainNameSchema`), with `BOUNDS`
  imported from `@/lib/tickets-vocab`. The doc comment says so.
- Guard: one test in `my-space-guards.test.ts`.
  - It reads the name `Input` of `MyNameForm`, `IdentityFields` and `EmailCodeForm` with `openingTags`. Each must be one tag
    with `maxLength={BOUNDS.name}`, and each file must import `BOUNDS`.
  - It reads `plainNameSchema` in `codeView` of `plain-name.ts`, so the code is checked and not its comment, and it must still
    be `….min(1).max(BOUNDS.name)`.
- Contract: the § 3.23 `MyNameForm` row.

**RED:** 1 failing test (`my-name-form.tsx`). **GREEN:** 9/9.

**Mutation checks.**

| Mutation | Result |
|---|---|
| R1: no `maxLength` | fail |
| R2: `maxLength={80}` (a literal) | fail |
| R3: `maxLength={BOUNDS.label}` | fail |
| R4: the bound moved onto the submit button | fail |
| R5: `IdentityFields` loses its bound | fail |
| R6: `plainNameSchema` without `.max` | fail, after tightening the guard (see below) |
| R7: `plainNameSchema` with `.max(200)` | fail |

R6 first survived. The mutation removed the first `.max(BOUNDS.name)` in `plain-name.ts`, which is in the doc comment. The guard
still passed, because it read the whole file and the code kept its `.max`. The same guard would also have passed with the
`.max` gone from the code and still in the comment. The guard now reads `codeView(...)` and the `plainNameSchema` declaration
itself. R6, aimed at the code, and R7 then fail it.

**Browser:** `/mon-espace` at 375 px, as the demo client (one-click login).
- `#my-name` has `maxlength="80"`, in a `method="post"` form.
- 98 characters typed into it left a value of 80.
- Nothing was saved: the page was reloaded. The demo client was then signed out with « Se déconnecter ».

**Deviations:** none.

### Group runs

- `./node_modules/.bin/tsc --noEmit`: exit 0 after each item, and at `5d64abc`.
- `./node_modules/.bin/eslint` on the 22 `.ts`/`.tsx` files changed since `40995bf`: exit 0.
- The pure suite `./node_modules/.bin/tsx --test "src/**/!(*.db).test.ts"`:
  - 1468/1468 at `dbd4625`;
  - 1475/1475 at `5d64abc`, 0 fail.
- DB tests: the group touches no DB-coupled file, and none was run.
- `./node_modules/.bin/next build` at `5d64abc`, with the dev server stopped first:
  - exit 0, « Compiled successfully in 8.3s »;
  - its only warning is the inherited workspace-root one;
  - every P4 route is `ƒ`, among them `/[slug]`, `/[slug]/espace`, `/[slug]/merci`, `/[slug]/offre/[offerId]`,
    `/[slug]/seance/[occurrenceId]`, `/mon-espace`, `/link-google`, `/sign-in`, `/sign-up`, `/api/c/[token]`,
    `/api/cron/daily`, `/api/mock-checkout`, `/api/stripe/webhook`, `/dashboard/tickets` and `/dashboard/events`;
  - the static routes are `/_not-found`, `/forgot-password` (unchanged since `40995bf`), `/icon.png` and `/apple-icon.png`.
- Dash check: 0 U+2013 or U+2014 in the 387 lines added over `40995bf..5d64abc` (code, tests and contract).

### Test data left

tickets-dev:
- Two accounts, kept as the brief rules:
  - `test-p4-final-1@skedul.test`, created by UI-1's real code sign-in on `/mon-espace`;
  - `test-p4-final-2@skedul.test`, created by the same on `/altinha-paris/espace`.
  - Both have their e-mail verified and an empty name.
  - A read-only check at the end found 0 sessions, 0 customer rows (linked or by e-mail), 0 account rows and 0 verification
    rows for them.
- The Better Auth rate-limit and OTP throttle rows written by the code sends and the two password attempts of UI-4, if that
  storage keeps them.
- No row for `nobody-p4-ui4@skedul.test`.
- The demo client's name is unchanged: UI-5 typed into the field and never saved.

tickets-test: nothing was written (no DB test run).

Browser: the viewport is back to desktop and the session is signed out. The dev server was stopped for the build, then
started again (`skedul-tickets`, port 3102) once the build was done.


## Group DOC

Written by the controller from the DOC agent's structured result (workflow `wf_f4fa6b21-324`): the agent's own Write of this section was refused by the tool (« Subagents should return findings as text »), and it did not work around the refusal. The mutation outputs are the agent's `mut-<name>.txt` files (session `54ea5de0` scratchpad, `doc/`).

### Commits

- `dd634d3` test(p4): the release status guard pins the region's one unconditional return (DOC-2)
- `601a528` docs(p4): plan Task 28's design note says G4c closed the Owner-release corner (DOC-3)
- `0c0d24c` docs(p4): the outcome says what the ledger says, owns the platform-wide reach of the IP throttle keys, and records the final review and its fix pass (DOC-1)

### Fixed

- DOC-1 (0c0d24c, docs/superpowers/plans/2026-10-21-p4-public-outcome.md): (a) P6 title bullet now cites LED:68 for the removed dash and LED:66 for the wording. (b) The Task 15 line and the 'Ruling (after Task 22)' line lost their bracketed 'cost if wrong (added by Task 31)'; a node check strips the bullet marker of all 35 Ruling bullets and finds each as an exact ledger line in progress.md: 35 checked, 0 differ. The two costs sit in a note under the Rulings list, and the section intro was reworded (byte for byte, note below). (c) The owner's product-calls bullet also points at the 'accept the plan additions the reviews kept' ruling (contract § 11). (d) New 'Residuals accepted' bullet after the Decision 65 one: the IP key (20/h) and the /48 key (60/h) carry no pro, a refused attempt still counts, carrier-grade NAT / a venue's Wi-Fi after a class / one client looping on 'Réessayer' burns the hour for everyone on the address at every pro; why the keys stay (scoping by pro multiplies an attacker's budget); the cost; plus an 'After go-live, on your side' owner bullet 'review THROTTLE_LIMITS against real traffic' and a pointer from the Decision 65 bullet. (e) New section 'Final review and fix pass': workflow and verifiers, the six dimensions in a table with verdicts (12 findings: 2 Important, 10 Minor), the two confirmed Important findings (RND-1, AUTH-1), a table of every fix item (SEC-1..6, PAY-1..4, UI-1..5, DOC-1..3) with commits and what changed, and the 9 distinct 'Final:' lines of progress.md verbatim. verify script: all 9 found as exact lines, all 18 commits of 08268de..HEAD (before 0c0d24c) are mentioned, every cited SHA is in range, dashes 3 before and 3 after (quoted ledger text only). Extras in the same commit: line 5 points at the new section; the Test data list gets test-p4-final-1/2@skedul.test left by UI-1.
- DOC-2 (dd634d3): mutation pass of the G4c guards. 32 mutations applied to committed files, each restored byte for byte from a cp backup and checked with cmp and git status. 31 failed the guard they target. One survived: release-status.tsx 'return text === "" ? null : <p role="status" ...>' passed checkout-return.test.ts (18/18) because the guard regex also matched the markup inside the conditional return. Fixed with a test(p4) commit: the test now pins the component's one return on its own line and refuses an early return null / return; / ? null / && <p. RED = the surviving run (exit 0, pass 18 fail 0); GREEN = checkout-return.test.ts 14/14, and the conditional, early-return and && variants each fail 1 against the new guard (RS1, RS4, RS5; RS2 and RS3 fail under both guards).
- DOC-3 (601a528): plan Task 28 design note (line 31368, brief said ~31346) now says G4c closed the Owner-release corner: focus to #seance-title (SEANCE_HEADING_ID) with fallback to the block's own heading, the always-mounted page-level ReleaseStatus, the neutral COPY.ENDED_EXPIRED, and that the Task 31 outcome records it as closed. Facts checked against checkout-return.tsx, seance-copy.ts and messages.ts; no dash added.

### Commands and results

- ["Commands: ./node_modules/.bin/tsc --noEmit exit 0 (at dd634d3 and 0c0d24c). ./node_modules/.bin/eslint --max-warnings 0 src/components/public/checkout-return.test.ts exit 0 (the only code file touched). Pure suite ./node_modules/.bin/tsx --test \"src/**/!(*.db).test.ts\" at 0c0d24c: 1475 tests, 1475 pass, 0 fail (14.4 s). No DB test (no code or DB-coupled test changed), no next build (no route/page/layout/instrumentation/config changed), no browser check (none named for DOC). git status --short empty at the end.", "Baseline before mutations: page-wiring.test.ts + checkout-return.test.ts + merci-view.test.ts 70/70.", "Mutations (mut.sh: refuses a dirty tree, cp backup, apply, run, cp restore, cmp, git status). page-wiring.test.ts on the séance page: PW1 'now: new Date()' in the paymentReturnOf call -> 4 fail (impersonating admin / payment block / seat gone / one clock); PW1 second paymentReturnOf call -> 1 fail (payment block one-call count); PW2 '{visitor.owner && <ReleaseStatus />}' -> 1 fail ('mounts the release status once, outside every condition'); PW2 ReleaseStatus moved under CheckoutReturn -> same 1 fail; PW3 ':${refView?.purchaseId ?? \"\"}' dropped from the OccurrenceBooking key -> 1 fail ('booking form starts over when the page's reference changes'); PW4 ownerFacts = customerViewer ? facts : null -> 2 fail (guest cookie never makes a booking booked; personal-link cookie); PW4 'facts' passed to paymentReturnOf -> 3 fail. checkout-return-view.ts booked derivation: a 4th 'booked = {' -> 1 fail (guest cookie / booked test); else if ((a.reference ?? a.ownerPending)?.booking) -> same 1 fail. checkout-return.test.ts (14 tests): alive restore line dropped / alive never false / announceRelease('') after the await / announce outcome dropped -> each 1 fail ('a release speaks through the page-level region...'); PendingHolds setNotice('') after the await / removed -> each 1 fail ('PendingHolds empties its line before each release'). merci: page 'paid' without paid_cancelled -> 1 fail (page-wiring 'counts every paid state as paid'); merci-view.ts cancelled line dropped -> 1 fail ('a paid purchase whose booking was CANCELLED is paid_cancelled'); another paid_cancelled body -> 1 fail ('merciCopy: every title and body, exact'). now guards (page-wiring 'the espace wrappers take the page's clock...'): new Date() in getCustomerSpacePage / getSpendableSeances / getMySpacePage bodies, signature default 'now: Date = new Date()', espace page second clock (2 fail), espace spendable second clock, /mon-espace getMySpacePage(session, new Date(Date.now())), /[slug] second clock (2 fail), séance page second clock (3 fail) -> every one fails. release-status.tsx (extra, last G4c guard without evidence): RS1 conditional null return SURVIVED the old guard (exit 0, 18/18) -> fixed in dd634d3; against the new guard RS1, RS4 (early return null), RS5 (<>{text !== \"\" && <p>}</>) fail 1 each (pass 13 fail 1); RS2 (cleanup removed) and RS3 (announceRelease writes nothing) fail 1 under both guards.", "Outcome checks (verify-outcome.cjs): Final: lines 9 distinct, 0 missing; Ruling bullets 35, 0 differ from the ledger; 'added by Task 31' brackets left 0; commits in range 18, all mentioned; cited SHAs 19, none unknown; dashes 3 before, 3 after."]

### G4c guard mutations (32; the last run of each, after `dd634d3`)

Each mutation was applied to a committed file, run, then restored byte for byte from a `cp` backup and checked with `cmp` and `git status`. RS1 survived the old release-status guard (exit 0, 18/18) and is the one that led to `dd634d3`; the table shows the run against the tightened guard.

| Mutation | Failing tests | First failing test |
|---|---|---|
| `CR1_alive_never_false` | 1 | a release speaks through the page-level region, even when the revalidation removed the block before the answer came back (G4c) |
| `CR1_alive_restore_dropped` | 1 | a release speaks through the page-level region, even when the revalidation removed the block before the answer came back (G4c) |
| `CR2_announce_empty_after_await` | 1 | a release speaks through the page-level region, even when the revalidation removed the block before the answer came back (G4c) |
| `CR2_announce_outcome_dropped` | 1 | a release speaks through the page-level region, even when the revalidation removed the block before the answer came back (G4c) |
| `CR3_setnotice_after_await` | 1 | PendingHolds empties its line before each release, so two releases in a row are both announced (G4c) |
| `CR3_setnotice_dropped` | 1 | PendingHolds empties its line before each release, so two releases in a row are both announced (G4c) |
| `MC1_page_paid_without_cancelled` | 1 | the merci page counts every paid state as paid: the green icon and the test-payment line, the cancelled booking included (G4c) |
| `MC2_view_drops_paid_cancelled` | 1 | a paid purchase whose booking was CANCELLED is « paid_cancelled »: it cannot tell a late payment from a booking cancelled after it was confirmed, so it gives no reason (G4c) |
| `MC3_copy_gives_a_reason` | 1 | merciCopy: every title and body, exact |
| `NW1_customerspace_reads_clock` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW2_spendable_reads_clock` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW3_signature_loses_now` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW4_espace_page_second_clock` | 2 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW5_espace_spendable_second_clock` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW6_monespace_other_instant` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `NW7_home_second_clock` | 2 | /[slug] takes one clock per request and hands it to every read and every view function (G4a) |
| `NW8_seance_second_clock` | 3 | the séance page never promises a seat that is gone: seatGoneOf decides, in the pure module, for the block AND the line above the form (Task 28 review, G4c) |
| `NW9_myspace_reads_clock` | 1 | the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c) |
| `PW1_clock` | 4 | the séance page mounts the payment block for the reference or the Owner's pending purchase, and the holds for an Owner only |
| `PW1_second_derivation` | 1 | the séance page mounts the payment block for the reference or the Owner's pending purchase, and the holds for an Owner only |
| `PW2_releasestatus_below_block` | 1 | the séance page mounts the release status once, outside every condition, above the payment block (G4c) |
| `PW2_releasestatus_conditional` | 1 | the séance page mounts the release status once, outside every condition, above the payment block (G4c) |
| `PW3_key_without_reference` | 1 | the booking form starts over when the page's reference changes, so an old refusal never sits beside a new payment block (G4c) |
| `PW4_booked_from_other_source` | 1 | a guest cookie never makes a booking « booked » and never hides the form: a notice shows above it instead (Decision 63) |
| `PW4_facts_reach_derivation` | 3 | the séance page mounts the payment block for the reference or the Owner's pending purchase, and the holds for an Owner only |
| `PW4_fourth_booked_assignment` | 1 | a guest cookie never makes a booking « booked » and never hides the form: a notice shows above it instead (Decision 63) |
| `PW4_guest_facts_are_owner_facts` | 2 | the séance page never lets a personal-link cookie hide the form or receive a purchase |
| `RS1_status_not_always_mounted` | 1 | the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c) |
| `RS2_status_not_cleared_on_unmount` | 1 | the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c) |
| `RS3_announce_does_not_write` | 1 | the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c) |
| `RS4_status_early_return` | 1 | the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c) |
| `RS5_status_wrapped` | 1 | the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c) |

### Not fixed and concerns

- Step 5 of the task: the 'Group DOC' section was NOT appended to .superpowers/sdd/2026-10-21-p4-public/final-fix-report.md. My Write of the section (to a scratchpad file named report-doc.md, meant to be appended with cat) was refused by the tool with 'Subagents should return findings as text, not write report files', which matches the standing rule of this environment not to write report .md files. I did not work around the refusal (no Bash redirect, no Edit of the report). The full content of the section is carried by this structured result (fixed, tests, concerns) for the controller to append. Mutation scratch files are in C:/Users/Matheus/AppData/Local/Temp/claude/C--Users-Matheus-Documents-Codage-skedul/54ea5de0-72bd-470a-85e5-991d65fd29bc/scratchpad/doc (g4c-mut.json, mut.sh, mut-<name>.txt outputs).
- Nothing else judged wrong or impossible.
- The 'Group DOC' section of final-fix-report.md is missing (the tool refused to write a report file; see not_fixed). The controller must append it from this result, or tell me to retry with another route.
- Deviation on order: I did DOC-2, DOC-3, then DOC-1, because DOC-1 (e) lists every commit of the pass and DOC-2 can produce a test(p4) commit. The DOC-1 commit cannot cite its own SHA: its row says 'the commit of this section' and the text says it is the last commit before the gate.
- Deviation on 'verbatim': progress.md has 10 'Final:' lines, the last two are identical (the usage-limit cut-off); the outcome copies that one once and says so. Any 'Final:' line appended to progress.md after this commit (gate, review) is not in the outcome.
- The outcome section is written before the gate, so it holds no gate numbers and says so. The fix-item table is written from commit subjects and the SEC/PAY/UI report sections, not re-derived from code.
- Beyond the brief: 5 extra release-status mutations (RS1..RS5) because that guard was the last G4c guard without mutation evidence (and it was the one that did not fail); the Test data bullet for test-p4-final-1/2@skedul.test in the outcome; a line-5 pointer to the new section.
- The brief's DOC-3 line (~31346) is now 31368 in the plan; I edited the note at its real position. Plan CRLF/LF warnings from git are the inherited autocrlf notices; I restored every mutated file with cp, never git checkout.
- Test data left: none. No database row written, no browser run, no account created.

## Gate

Final gate agent (workflow wf_f4fa6b21-324), no subagent. HEAD `0c0d24c` (`git rev-parse --short HEAD`), `git status --short` empty before and
after. 19 commits since 08268de, 72 files, 69 of them `.ts` / `.tsx`. No source file was edited by the gate, so there is no
fix commit. Every result below comes from a command this run executed. Scratch files (session scratchpad, `gate/`): `run-chunk.sh`,
`titles.sh`, `db-files.txt`, `build.txt`, `chunk-<first>-<last>.log` (one raw log per DB chunk).

Observation: this report has the SEC, PAY and UI group sections and no DOC section. DOC-1 to DOC-3 are three commits (`dd634d3`
test guard, `601a528` plan note, `0c0d24c` outcome); the gate ran on top of them, so the pure suite below includes the `dd634d3` guard.

### Typecheck, lint

- `./node_modules/.bin/tsc --noEmit`: exit 0, no output.
- `git diff -z --name-only --diff-filter=d 08268de..HEAD -- '*.ts' '*.tsx' | xargs -0 ./node_modules/.bin/eslint --max-warnings=0`:
  69 files, exit 0, 0 errors, 0 warnings. None of the 3 inherited files (`client-pack.tsx`, `client-profile.tsx`, `hero-cards.tsx`)
  is in the range. `--diff-filter=D` lists no deleted file.

### Pure suite and zone matrix

- `./node_modules/.bin/tsx --test "src/**/!(*.db).test.ts"`: `ℹ tests 1475`, `ℹ pass 1475`, `ℹ fail 0` (Task 31 had 1422; the four
  groups added 53).
- Zone matrix, PowerShell with `$env:TZ`, the command of Task 31 Step 4 (`planning-view`, `merci-view`, `public-emails`, `checkout`):
  - `America/Los_Angeles` (printed by `Intl.DateTimeFormat().resolvedOptions().timeZone`): `ℹ tests 61`, `ℹ pass 61`, `ℹ fail 0`.
  - `Europe/Paris` (printed likewise): `ℹ tests 61`, `ℹ pass 61`, `ℹ fail 0`.
  - Task 31 had 60 in each zone: the one new test is PAY-1's « every Stripe call of the real gateway passes bounded per-request
    options » in `checkout.test.ts` (the only one of the four files that changed since 08268de, +50 lines).

### Build

The dev server `skedul-tickets` (serverId `cf998ac8-...`, running since 02:11) was stopped first, as the UI group did, so the build
and the dev server do not share `.next`.

- `./node_modules/.bin/next build`: exit 0 in 45 s, « Compiled successfully in 12.7s ». The only warning is the inherited
  « inferred your workspace root » one.
- Dynamic `ƒ`: `/[slug]`, `/[slug]/book/[eventTypeId]`, `/[slug]/espace`, `/[slug]/merci`, `/[slug]/offre/[offerId]`,
  `/[slug]/pack/[packId]`, `/[slug]/seance/[occurrenceId]`, `/api/c/[token]`, `/api/cron/daily`, `/api/mock-checkout`,
  `/api/stripe/webhook`, `/mon-espace`, plus `/link-google`, `/sign-in`, `/sign-up`, `/dashboard/tickets`, `/dashboard/tickets/[id]`,
  `/dashboard/events`, `/dashboard/events/[id]` and `/dashboard/events/new`.
- Static `○`: only `/_not-found`, `/apple-icon.png`, `/icon.png` and `/forgot-password` (the same four as Task 31). No `●`.

### Full DB suite on tickets-test

- Before: read-only `select count(*) from professional where slug like 't-%'` on tickets-test
  (project `nameless-meadow-98376303`, branch `br-polished-rain-aftw8y9x`): `0` pros, and `0` users with `t-%@skedul.test`.
  Nothing deleted.
- `git ls-files | grep '[.]db[.]test[.]ts$'`: 60 files, in `git ls-files` order. Each chunk is one foreground command,
  `tsx --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none --test-timeout=300000 <files>`, under 600 s.
  The chunks are smaller than Task 31's where it had come close to the cap (chunks 1, 2 and 11 there took 427, 575 and 554 s), so
  the heaviest chunk here is 373 s.

| Chunk | Files | Pass / fail | Seconds |
|---|---|---|---|
| 1 | 1-3 (admin-deletion, admin-reads, auth) | 41 / 0 | 275 |
| 2 | 4-6 (booking-settings, catalog-actions, catalog-reads) | 34 / 0 | 159 |
| 3 | 7-9 (client-actions, client-reads, customer-space) | 45 / 0 | 243 |
| 4 | 10-12 (dashboard-reads, event-actions, event-reads) | 62 / 0 | 336 |
| 5 | 13-15 (guest-access, ics, payments-reads) | 33 / 0 | 99 |
| 6 | 16-18 (planning-actions, planning-reads, settings-actions) | 62 / 0 | 355 |
| 7 | 19-21 (time-off-actions, cancel, catalog) | 36 / 0 | 142 |
| 8 | 22-24 (claims-buy, claims, content) | 31 / 0 | 173 |
| 9 | 25-27 (delete-user, eligibility, fulfillment) | 18 / 0 | 97 |
| 10 | 28-31 (invariants, nightly, occurrences, rdv) | 38 / 0 | 113 |
| 11 | 32-36 (release, series-occurrence, series-split, time-off, wallet-customers) | 60 / 0 | 293 |
| 12 | 37-41 (wallet, calendar-backfill, calendar-sync-load, atomic, mail-budget) | 53 / 0 | 173 |
| 13 | 42-43 (notify-core, mock-checkout) | 34 / 0 | 194 |
| 14 | 44-45 (webhook-core, booking-actions) | 83 / 0 | 373 |
| 15 | 46-47 (boutique-reads, client-actions) | 12 / 0 | 54 |
| 16 | 48-51 (identity, my-space, offer-reads, planning-reads) | 36 / 0 | 142 |
| 17 | 52-55 (profile-reads, purchase-reads, release-actions, seance-reads) | 50 / 0 | 290 |
| 18 | 56-57 (shop-actions, space-actions) | 23 / 0 | 110 |
| 19 | 58-60 (spendable, throttle, harness) | 23 / 0 | 85 |

- Every chunk exited 0 with `ℹ fail 0`, `ℹ cancelled 0`, `ℹ skipped 0`. Total: 774 tests, 774 pass, 0 fail, over 60 files
  (3706 s of test time). Task 31 had 767/767: the 7 new tests match the `*.db.test.ts` diff since 08268de (catalog-actions +1,
  customer-space +1, booking-actions +2, shop-actions +1, spendable +2; identity.db.test.ts swaps one test for another).
- After: the same read-only query on tickets-test: `0` `t-%` pros and `0` `t-%@skedul.test` users. No test was killed, so
  no clean-up and no DELETE ran.

### The seven P4 titles

Dev server `skedul-tickets` started again with `preview_start` (serverId `49c10e3a-...`, port 3102), then
`titles.sh` (the loop of Task 31 Step 7, `curl -s ... | grep -o '<title>[^<]*</title>'`). `$SEANCE` and `$OFFER` are the first
séance and offer links of `/altinha-paris`. For `merci` the paid « Carnet de 4 » purchase left by Task 31 on tickets-dev was used as
`p` (read-only GET, no purchase created); a made-up `p` was recorded too.

| Path | `<title>` | Expected | dash lines |
|---|---|---|---|
| `/altinha-paris` | `Altinha Paris · Skedul` | `Altinha Paris · Skedul` | 0 |
| `/altinha-paris/seance/<first>` | `Test P3 libre · Altinha Paris · Skedul` | `{séance title} · Altinha Paris · Skedul` | 0 |
| `/altinha-paris/offre/<first>` | `À l&#x27;unité · Altinha Paris · Skedul` (the HTML entity for `'`: « À l'unité ») | `{offer label} · Altinha Paris · Skedul` | 0 |
| `/altinha-paris/merci?p=<paid purchase>` | `Confirmation · Altinha Paris · Skedul` | `Confirmation · Altinha Paris · Skedul` | 0 |
| `/altinha-paris/merci?p=nope` (extra) | `Confirmation · Altinha Paris · Skedul` | same (the title never depends on `p`) | 0 |
| `/altinha-paris/espace` | `Mon espace · Skedul` | `Mon espace · Skedul` | 0 |
| `/mon-espace` | `Mon espace · Skedul` | `Mon espace · Skedul` | 0 |
| `/sign-in` | `Connexion · Skedul` | `Connexion · Skedul` | 0 |

All seven match. `preview_logs` at error level after the curls: « No server errors found. »

### Tree

- `git status --short`: empty (0 lines), HEAD `0c0d24c`. `.superpowers/` (this report included) is git-ignored. The ignored
  `tsconfig.fix1.tmp.tsbuildinfo` at the worktree root dates from 22 October, not from this pass; the gate left it alone.
- The stash stack holds one entry (`On main: epitaxy: pre-switch from main`), not mine.
- No account created or deleted, no row written on tickets-dev, no SQL write on tickets-test. The dev server `skedul-tickets`
  (port 3102) is left running, as it was found.

### Verdict

Green. tsc, eslint (69 files), pure 1475/1475, the zone matrix 61/61 in both zones, the build with every P4 route `ƒ`, the full DB suite
774/774 over 60 files with no leftover `t-%` pro before or after, the seven titles, and a clean tree. Nothing failed, so nothing was
fixed in the gate.
