# P4 final review: the six reports

Archived verbatim from the git-ignored P4 workspace. Workflow `wf_7750946c-a37`, six opus reviewers, one per dimension, on `8ac32eb..08268de`; Critical and Important findings were verified by three opus verifiers each (the outcome's « Final review and fix pass » section has the verdicts and the fix items).

---

## Dimension ID

### P4 final review, dimension ID (identity and capabilities, Review Focus rows 1 and 2)

Range `8ac32eb..08268de` (branch `feat/tickets-events`, worktree `tickets`). Read-only review. I read the code and ran pure tests and the typecheck. I ran no DB test, dev server or browser.

Evidence:
- `./node_modules/.bin/tsc --noEmit` is green.
- 13 pure test files pass 158/158: identity, visibility, space-view, space-actions, run-action, context, page-wiring, seance-facts-guard, profile-guard, server/client, public-context, visitor, public-queries.

## Strengths

- **Every Server Action takes ids only.** `src/server/public.ts` has 5 actions and `src/server/client.ts` has 4. Each one runs `splitActionInput` and then `runPublicAction` or `runClientAction`. Each core parses `rest` as `unknown` with a strict schema. No schema has a customer id, user id, e-mail-as-identity or `professionalId` field.
  - `heldTicketInputSchema` carries no identity at all.
  - The pro always comes from the slug (`resolvePublicPro`).
  - The client callers send only `{ slug, ...rowIds }`: `cancel-booking-button.tsx:54`, `checkout-return.tsx:102`, `forget-guest-link-button.tsx:23`, `occurrence-booking.tsx:253/369`, `offer-checkout-form.tsx`.
- **Identity comes from one place.** `currentSessionFacts` = `sessionFactsOf(actingSession(await getFreshSession()))`, so the session is fresh, a suspended user counts as no session, and impersonation is detected.
  - `resolveVisitor` gives an `owner` only when the visitor is verified and the Owner predicate holds (Decision 5). It reads the guest cookie only when the visitor is anonymous or unverified.
  - On the P4 surface (`src/app/[slug]/**`, `/mon-espace`, `/api/c`, `src/server/{public,client,client-queries,public-context}.ts`), the only session read is `getFreshSession` in `src/server/visitor.ts:30`. The range adds no server-side `getSession(` call. The remaining ones (`/aide`, dashboard layout, admin, support, pro-context) predate P4.
  - The two client calls added in the range use `authClient.getSession({ query: { disableCookieCache: true } })`.
  - While an admin is impersonating, `spaceActorOf`, `abandonCheckoutCore` (Revision 3.11 item 3), `bookWithHeldTicketCore` and the support writers all refuse.
- **`customer.user_id` has exactly two writers.**
  - `upsertCustomer`: CTE `u` keeps a verified user with `lower(email) = email`, and on conflict it uses `coalesce(customer.user_id, excluded.user_id)`, so it never overwrites.
  - `linkCustomerUser` (`src/lib/public/identity.ts:119-133`) filters id, pro, `user_id is null`, the same e-mail and an `exists` check on a verified user.
  - `bookWithHeldTicketCore` calls `linkCustomerUser` only after `parseFr`, the Owner check and its throttle.
  - The cross-pro link at sign-in is gone from `src/lib/auth-options.ts` (Decision 72).
- **Capabilities stay capabilities.**
  - `?p=` is read only on `paiement=annule`, and `referenceForPage` drops it when an Owner of another customer is signed in. It never unlocks a wallet, bookings or resume URLs (Decision 71).
  - The guest cookie is an HMAC token tied to `link_version`, with `Path=/<slug>`. It is set only by the same-origin POST of `/api/c/[token]` after a fresh `resolveGuestLink`; the GET sets no cookie (Decision 68).
  - Guest facts in `seanceVisitorFacts` carry no `purchaseId` and no `resumeUrl`. The séance page prefills e-mail and name only for a verified visitor and shows holds and wallet only to the Owner, so a cookie never hides a form or prefills an address (Decision 63).
- **IDOR answers are neutral.** `cancelByClient` filters booking id, pro and customer. The purchase, offer and occurrence reads all filter `professional_id`. Another customer's row, another pro's row and an unknown id get the same answer: `registerFreeCore` follows Decision 64, and the release, abandon and cancel cores return the same not-found or neutral result.
- **Private séances follow § 3.21.** `seanceViewerOf`, `canSeePrivateSeance` and `seatGoneOf` in `src/lib/public/visibility.ts` match the contract table. The 404 gate is at `src/app/[slug]/seance/[occurrenceId]/page.tsx:105`, and private-séance metadata carries only the business name. The planning, boutique and offer reads all exclude private events.
- **Tenancy in the public reads is pinned by tests.** `purchase-reads`, `seance-reads`, `planning-reads`, `boutique-reads`, `offer-reads` and `activeBookingOf` filter every join by `professional_id`, and since the G2b, G3b, G4a and Task 23/24 sweeps each filter is pinned by a hand-built crossed-row test.

## Issues

### Critical

None.

### Important

None.

### Minor

**ID-1. The joins in `spendableSeances` are not scoped to the pro**, although its header says they are. `src/lib/public/spendable.ts:65,69,71,88` (header at lines 4-5).

- What is wrong:
  - `join event e on e.id = o.event_id` has no `e.professional_id = o.professional_id`.
  - Both `ticket t join ticket_type tt on tt.id = t.ticket_type_id` (the name subquery at line 65 and the `exists` at line 88) have no `tt.professional_id = t.professional_id`.
  - `question q where q.event_id = e.id` (line 69) inherits the unscoped event.
  - So the event title, `booking_mode`, `is_private`, `archived_at`, the notice and horizon overrides, the « needs answers » flag and the type name all come from rows that are never checked against the pro.
  - The header (lines 4-5) says "Every table is reached through this pro's `professional_id`", which is not true.
- Why it matters: this is the same defence-in-depth class that P4 fixed everywhere else in its public reads. See the G2b `purchase-reads` ruling, G3b `simulatedPurchase`, G4a `activeBookingOf`, and the Task 23 Important fixed in 27b3c54 ("removing any one of eight of them ... passed every test", contract § 11 at line 1961). `spendable.db.test.ts:235` uses a consistent two-pro fixture, so no `professional_id` filter in this query is exercised.
- Scenario: an occurrence of pro A carries pro B's `event_id` (a crossed row; every domain foreign key is single-column). The Owner then sees pro B's event title, and B's booking-mode, privacy and archive flags decide the listing in « Utiliser vos tickets » on A's espace. No reachable writer creates such a row today, so this is not an exploit.
- Fix:
  - Add `and e.professional_id = o.professional_id` to the event join.
  - Add `and tt.professional_id = t.professional_id` to both ticket_type joins.
  - Either correct the header or make it true.
  - Add one hand-built crossed-row case to `spendable.db.test.ts` (built and deleted in `finally`, like `my-space.db.test.ts`) and check that it fails without the filter.
  - The `ELIGIBLE` link check (`event_ticket_type l`) is engine code shared with `claims.ts` and can stay as the engine has it.

**ID-2. The `getCustomerSpace` booking joins are not scoped to the pro**, and P4 now serves this read on public pages. `src/lib/back-office/customer-space.ts:119-120`.

- What is wrong: `.leftJoin(event, eq(event.id, occurrence.eventId)).leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))` has no `professionalId` predicate. The `where` clause scopes `booking` and `occurrence` but not these two joins. The joins come from P3 commit 2311421. P4 rewrote the file (4670158, +53/-25), and the read now feeds `/[slug]/espace`, the `/[slug]` wallet and `/mon-espace`.
- Why it matters: the bookings list shows a title, a location and `cancelHours` (`coalesce(event.cancelDeadlineHours, ticketType.rdvCancelDeadlineHours)`) taken from rows that are never checked against the pro. `cancelHours` drives whether the booking is shown as cancellable.
  - The P3 final review declined this class only for the "planning, dashboard and payments reads" (P3 outcome line 196). This read is not on that list, and P4 holds its public reads to the stricter, test-pinned standard.
  - `customer-space.db.test.ts:257,277` use consistent two-pro fixtures, so no filter here can fail a test.
- Scenario: a crossed occurrence of pro A points at pro B's event. A's client then sees B's event title and location in their espace, and B's cancellation deadline decides whether « Annuler » is offered. Same caveat as ID-1: defence in depth, no reachable writer.
- Fix:
  - Add `eq(event.professionalId, professionalId)` to the event join condition and `eq(ticketType.professionalId, professionalId)` to the ticket_type join condition. Put them in the join conditions, not the `where`, so a left join with a mismatched row yields nulls and not a dropped booking; or use `where` if dropping is the intended answer.
  - Add one crossed-row DB case.

**ID-3. The code comments call the unverified-plus-cookie espace "read-only", although that visitor can cancel.** `src/app/[slug]/espace/page.tsx:35,57`, `src/lib/back-office/guest-access.ts:154,166`, `src/lib/public/identity.ts:152`.

- What is wrong: these comments say the cookie customer is shown "read-only" to an unverified session. But `spaceActorOf` returns the guest cookie actor for that visitor, so « Annuler » is rendered and `cancelMyBookingCore` accepts it.
- The contract states the behaviour correctly at § 3.23 (line 1279: "the read-only space of `guestCustomerId` when set (cancel allowed, spend disabled)"). The code comments drop the qualifier.
- Why it matters: only maintainability. A later change that trusts these comments could remove a cancellation the contract grants, or could treat "read-only" as the rule for a new write.
- Fix: write "read and cancel, never spend" (or "cancel allowed, spend disabled", as in the contract) in those five comments.

## Recommendations

- Treat "every join of a public read filters `professional_id`, pinned by a crossed-row test" as one rule for the whole public surface. With ID-1 and ID-2 fixed, the reads the public pages reach would all meet it. The remaining unscoped engine joins (`ELIGIBLE`, the claims link checks) belong to the same-tenant invariant candidate of the P2 outcome (Task 15 minor) and to P6's composite-key question, not to P4.
- Optional, matching the pattern of `src/test/source-guards.ts`: a source guard that lists `join event` / `join ticket_type` / `leftJoin(event` without a `professional` predicate in `src/lib/public/**` and `src/lib/back-office/customer-space.ts`, so a new public read cannot regress silently.

## Declined to judge

- `actionVisitor` reading the session and the visitor in two `Promise.all` branches: deferred minor (Task 7), not re-reported.
- The two implementations of the espace identity mapping (`resolveSpaceCustomer` and `resolveSpaceIdentity`): deferred minor (Task 5).
- Guest cookie plus `?p=` on a private séance answering 404: accepted-as-is ruling.
- Unknown purchase ids that consume no throttle: deferred minor (Task 12).
- The E1 "already booked" oracle: Task 10 ruling.
- Unscoped `event` / `ticket_type` joins in the P3 planning, dashboard and payments reads: declined by the P3 final review (outcome line 196), and outside this range.
- Engine-level crossed-row tolerance in `ELIGIBLE` and `claims.ts`: P2 code; P2 outcome Task 15 minor and P6 index/composite-key work.
- Runtime behaviour that only a DB suite or a browser proves (cookie `Path` scoping in a real browser, the Better Auth cookie cache being bypassed at runtime): not run under the binding environment rules. Judged from the code and the pure tests only.
- Dimensions other than ID (payments, effects, UI and accessibility, docs-at-large, performance): left to the other five reviewers.

## Assessment

**Verdict: with fixes (Minor only).**

The identity model is sound end to end:
- Server Actions take only ids and a slug.
- Every identity comes from a fresh, acting, non-impersonated session or from a pro-scoped and link-version-scoped guest cookie.
- `customer.user_id` has exactly the two writers Decision 72 allows.
- `?p=` and the guest cookie never act as identities (Decisions 63 and 71).
- IDOR answers are neutral.
- Private séances follow § 3.21.

No Critical or Important finding. ID-1 and ID-2 are defence-in-depth tenancy gaps in two reads that the public pages reach; they are the class P4 itself pinned elsewhere. ID-3 is comment wording. Each fix is small and none blocks the P4 close.

---

## Dimension PAY

### P4 final review - PAY: payment state machine, effects and e-mails

Range 8ac32eb..08268de (105 commits), worktree `.claude/worktrees/tickets`, branch `feat/tickets-events`.
Dimension: Review Focus rows 3 (payment state machine) and 7 (effects and e-mails).
Scope read at HEAD:
- `src/lib/payments/**`
- `src/app/api/{stripe/webhook,mock-checkout,cron/daily}/route.ts`
- `src/lib/public/{release-actions,shop-actions,booking-actions}.ts`
- `src/lib/booking/{fulfillment,release,claims,nightly,wallet,cancel}.ts` (range changes)
- `src/lib/stripe.ts`, `src/server/notify.ts`, `src/lib/notify-core.ts`, `src/lib/notify-run.ts`
- `src/lib/emails/**`
- `src/lib/env.ts`, `src/lib/env-checks.ts`, `src/lib/cron-auth.ts`, `vercel.ts`

Inputs also read:
- the plan header
- the contract and the spec (grep only)
- the ledger: every Ruling, residual and deferred minor
- the outcome: its carries

Evidence run:
- Pure tests in scope, 9 files, all passing (103/103): webhook-core, mock-checkout, checkout, notify-run, public-emails, run-action, public-context, cron-auth, env-checks.
- No DB test, server or browser was run, as the rules require.

## Strengths

**The webhook follows contract § 3.12 exactly.**
- `src/app/api/stripe/webhook/route.ts` answers 404 when Stripe is off and 500 when the secret is missing.
- It checks the signature on the raw body (`request.text()` then `constructEvent`) and answers 400 on a failure.
- A throw is logged through `logSafeMessage` and answers 500, so Stripe retries.
- Every response carries no-store.
- `handleStripeEvent` (`src/lib/payments/webhook-core.ts`) runs its checks in a fixed order:
  1. livemode against the deployment's mode;
  2. sessionOrigin (own / other_env / foreign);
  3. purchaseOfSession (metadata, then session id, then a check that client_reference_id matches).
- `fulfil` checks the amount and the currency before it pays anything.
- A second payment, whether it comes with another payment intent or another session, is recorded as an orphan (`recordOrphanPayment`) and never applied to the purchase twice.
- `payment_intent` is stored as a string id.
- Foreign and other_env sessions are never counted as orphans.
- Of the session events, only the session's own purchase is marked processing (`unpaid`) or released (`expired` / `async_payment_failed`).

**fulfillPurchase is idempotent and correct under a race.**
- A replay hits G(already_paid).
- It pays from pending or from expired, and confirms only a booking that is still pending.
- A payment that lands after the release becomes a late payment (`email.late_payment`) and confirms no seat.
- The effects come from the batch's RETURNING rows, not from a separate re-read.
- The lock order prevents a double outcome when a release and a payment arrive together:
  - `releasePurchase` locks the occurrence first, so either the release or the payment wins.
  - The loser either sees an expired purchase (giving a late payment) or never touches a paid one.

**A release never frees what may already be paid.**
- `abandonCheckoutCore` (`src/lib/public/release-actions.ts`) runs in this order:
  1. refuse an impersonating session;
  2. find the purchase by reference and check the Owner;
  3. refuse a shop purchase (no booking) before any Stripe call;
  4. the throttle;
  5. the status checks.
- Only then does `closeForRelease` run. Its outcomes paid, processing and failed all release nothing.
- Stripe refuses to expire a paid session, and that answers "failed", which releases nothing.

**The mock checkout is gated three times.**
- `mockCheckoutAllowed` requires `!STRIPE_ENABLED`, and both `APP_ENV` and `VERCEL_ENV` different from production.
- Only a null or `mock_` session id is accepted.
- GET is read-only. POST checks the origin.
- Its page carries a strict CSP.
- `simulatedPurchase` joins only through the pro's own rows.

**createCheckoutAndAttach cleans up on every failure path** (`src/lib/public/booking-actions.ts:178-218`).
- A create failure releases the seat at once (CHECKOUT_FAILED, with the release effects).
- A refused attach expires the session and releases ("stale").
- Any other throw runs `abandonPurchase`, then rethrows.
- Create is bounded: CREATE_OPTIONS, 15 s, 1 retry, idempotency key `checkout:<purchaseId>` (G1b).

**Cron.**
- `cronAuthorized` compares SHA-256 digests with `timingSafeEqual` and requires a secret of at least 32 characters.
- Each `runNightly` step is isolated.
- `ensureAllHorizons` has a try block per pro and a 120 s deadline, under `maxDuration` 300.
- The cron emits no effects.

**Effects.**
- `runEffectsWith` never throws.
- The "none" budget is used on every public, client, webhook and mock path. Source guards pin this: `public-context.test.ts` S49, `webhook-core.test.ts:174`, `mock-checkout.test.ts:95`.
- "pro" is used only from pro-context.
- `dedupeEffects` removes duplicates.
- Every plan re-reads fresh rows and names its pro (`emails(professionalId, …)`, or `noEmail()`).

**E-mails.**
- One receipt per payment, and none for an unpaid purchase.
- The receipt's booking line appears only for the purchase's own pro and customer.
- The late-payment wording follows the ticket count.
- The pro notice goes out only when the client books. `confirmedEffects(byClient)` takes these values in `claims.ts`:
  - true for a held-ticket or a free booking (647, 707);
  - false for the pro's « Inscrire » (817);
  - true on the RDV path (1088).
- `pro_booking_cancelled` is sent only when `ended_by = 'client'`.
- Templates escape every value through `mailParagraph`, `mailDetails` and `mailButton`; subjects go through `oneLine`.

**Boot checks and logs.**
- `envBootErrors` refuses a VERCEL_ENV production deployment without APP_ENV production.
- It also refuses a BETTER_AUTH_SECRET shorter than 32 characters in production.
- `logSafeMessage` cuts the message at "params:" and masks e-mail addresses, `/api/c` tokens and `cs_` ids.

**Tests.**
- The DB suites cover the gateway failure, the refused attach and the throw paths (`booking-actions.db.test.ts:335-517`).
- They also cover the shop path, every webhook status and the mock route.
- The pure guards can fail: their source scans and regexes were re-checked in G2a.

## Issues

### Critical

None.

### Important

None.

### Minor

#### PAY-1. Two Stripe calls inside the visitor's Server Action run with the SDK default timeouts

`src/lib/stripe.ts:68-70`:

```ts
async expire(sessionId) {
  await expireCheckoutSession(sessionId);
},
```

`expireCheckoutSession` (`stripe.ts:109-117`) calls `retrieve`, then `expire`, each with the `options` it is given. The gateway passes none, so the Stripe client defaults apply to both calls: a timeout of 80000 ms and 2 retries (`node_modules/stripe/cjs/stripe.core.js:99`, `:171-172`).

The JSDoc of `expireCheckoutSession` says these defaults suit "a background effect". That holds for its caller in `src/server/notify.ts:51`, which runs after the response. The gateway's `expire`, however, runs in the foreground, inside the visitor's Server Action:
- `booking-actions.ts:205-209`, when the attach is refused;
- `booking-actions.ts:156-162`, in `abandonPurchase` (any throw after the seat is held).

These are the same foreground risks that G1b bounded for `create` (CREATE_OPTIONS) and that `closeForRelease` already bounds (RELEASE_OPTIONS at `stripe.ts:58` and `:61`).

Failure scenario:
1. `create` succeeds, then Stripe stalls.
2. The attach UPDATE throws (for example a Neon HTTP error), or it is refused.
3. The visitor's « Réserver et payer » spins for well over the 90 s in the outcome's carry: up to 3 attempts × 80 s for each of the 2 calls.
4. In `abandonPurchase` the expire runs *before* `releasePurchase`. If the function is killed at its duration limit, the release never runs:
   - the seat stays held until the 45-min hold lapses;
   - the same typed address gets COPY.BUYBOOK_NOT_POSSIBLE in the meantime.
   This is exactly what the G2a ruling added `abandonPurchase` to prevent.

The outcome's carry (« one Checkout create can take about 90 s in the worst stalled case ») also understates these two paths, which add an unbounded expire after the create.

Fix:
- Pass bounded options in the gateway's `expire`: `expireCheckoutSession(sessionId, RELEASE_OPTIONS)`, or `DELETION_STRIPE_OPTIONS`.
- In `abandonPurchase` and in the refused-attach branch, call `releasePurchase` *before* the expire.
  - This is safe: the client never received the Checkout URL, so nobody can pay that session.
  - Even if someone did, `fulfillPurchase` from expired turns it into a late payment.
- Add a source guard so that every gateway method passes per-request options.

Contests a ruling: no. G1b bounded `create` and G2a added the best-effort release, but neither ruled on the expire's options or on the order of expire and release.

## Recommendations

- Fix PAY-1 when convenient. It is small: one argument, and two reordered blocks with their DB test expectations.
- When the owner runs the Decision 26 Stripe test-mode step:
  - check the 90 s Server Action limit against the worst case after the PAY-1 fix;
  - with the fix, that worst case is create (about 90 s) plus a bounded expire (2 × 10 s × 2 attempts).

## Declined to judge, or already decided

- **v1 paid sessions without the `app` marker are ignored without a word (spec L1116).** Decision 69 covers this, with owner approval pending. It is a concern for the P6 switch, and the production data is wiped at P6.
- **Development deployments that share APP_ENV "development" and the same Stripe test account record each other's sessions as orphans.** This is development noise only; production and preview are separated by APP_ENV.
- **Offers under the Stripe minimum of 50 cents cannot be paid.** The offer bounds (minimum 1 cent) are P3 validation, outside this dimension.
- **Already carried to the owner's Decision 26 run:**
  - the margin on the shop `expires_at` for clock skew;
  - the 90 s Server Action;
  - Apple Pay and Google Pay (risk 10).
  PAY-1 only notes that the 90 s figure is low for the two expire paths.
- **A CRON_SECRET with a trailing newline in the Vercel environment.** Speculative: there is no evidence it is set that way.
- **After a committed release, revalidation runs only on success.** This is how the contract specifies it (effects are scheduled on failure as well, revalidation is not).
- **The mock paying an expired simulated purchase becomes a late payment.** Intended and tested.
- **Cross-environment livemode mismatches log a warning line.** Noise only; the behaviour (ignore and answer 200) is correct.

## Assessment

Within this dimension the payment state machine is sound:
- no path pays twice;
- no path pays the wrong purchase;
- no path frees a seat that may be paid;
- no path sends an e-mail to the wrong person or for an unpaid purchase.

Effects run with the right budget, and are scheduled even when an action fails after a committed write. The only finding is a Minor robustness gap in a rare cleanup path.

**Verdict: ready** (PAY-1 is a Minor and does not block).

---

## Dimension RND

### P4 final review: render-time writes, caches, client props, metadata, logs and abuse bounds (RND)

Range 8ac32eb..08268de (HEAD 08268de, branch feat/tickets-events). Review Focus rows 4 and 9. I read the code at HEAD in the worktree. Pure tests run: 119/119 pass. I ran no DB tests, no server and no browser.

## Strengths

- **Render-time writes.** A render writes one thing only: the keyed `ensureHorizon` inside `after()` on `/[slug]`, at `src/app/[slug]/page.tsx:95-106`. Its key is `t:horizon:p:<pro>`, limited to 1 per 300 s. Its failures are logged through `logSafeMessage`, and its refusals log a code only. `linkCustomerUser` and `consumeThrottle` run only inside actions or `after()`. `linkCustomerUser` is called from `bookWithHeldTicketCore` after the parse, the Owner check and the `held` throttle.
- **Caches.** There is no `unstable_cache`, `"use cache"`, `revalidate`, `generateStaticParams` or `force-static`. The only memoization is React `cache()`, per request: `getPublicPage`, `loadSeance`, `loadOffer` and `currentPublicVisitor`. A visitor's identity therefore cannot be served to someone else.
- **Client props.** Client components receive picked primitives, with dates as ISO strings (for example `seenStartsAt`), never a `Date` or a row. The professional row never reaches the client, and `src/lib/public/profile-guard.test.ts` pins this. Checkout `success_url` and `cancel_url` are built on the server from `env.APP_URL` and ids.
- **Metadata follows § 5.**
  - `notFoundMetadata()` is noindex and no-referrer, and never carries the business name.
  - `offerMetadata` lets only an offer on sale be indexed.
  - `merci`, `espace` and `mon-espace` are noindex, and the séance page is no-referrer in every case.
  - An unknown slug is a real 404 from the layout, which checks `SLUG_PARAM_RE` before any read.
- **Logs.**
  - Every `console.*` call in the changed files goes through `logSafeMessage`. It cuts the message at `params:` and masks e-mails, `/api/c/<token>` and `cs_` ids.
  - The error boundaries (the `[slug]` and espace boundaries, root `error.tsx` and `global-error.tsx`) log the digest only, through `PublicErrorCard`.
  - `/api/track`, the cron route, `mock-checkout` and `/api/c/[token]` catch their errors and log the safe message.
- **Abuse bounds.**
  - Each action core checks its throttle before any write or Stripe call. `checkActionThrottle` validates the hashes and builds every key before consuming anything.
  - The release core refuses an impersonated session before any read, throttle key or Stripe call.
  - Seat pressure (`holdCeiling`) applies to e-mail subjects.
  - A malformed `?p=` costs nothing: `isReferenceId` returns null before any query.
  - Next refuses an `Origin: null` Server Action (`action-handler.js`).

## Issues

### Critical

None.

### Important

**RND-1. Page-render DB failures are logged raw by Next.js, with the query parameters: signed-in visitors' e-mails and Better Auth session tokens.**

Where:
- Pages: `src/app/[slug]/page.tsx:78`, `src/app/[slug]/seance/[occurrenceId]/page.tsx:86,93`, `src/app/[slug]/offre/[offerId]/page.tsx:86,91`, `src/app/[slug]/merci/page.tsx:45`, `src/app/[slug]/espace/page.tsx:52`, `src/app/mon-espace/page.tsx:36`.
- Reads: `src/server/visitor.ts:38` and `src/lib/back-office/guest-access.ts:130-147`.
- `src/lib/auth-options.ts:211-371`, where no `logger` is set.

Contract § 1 Global Constraints, « URLs and logs » (contract line 83, Revision 3.11), says:

> Logs go through `logSafeMessage` and never print an e-mail, a code, a token, … or the parameters of a failed query.

The P4 pages run several reads during render with no wrapper:
- `currentPublicVisitor` → `ownedCustomerId` → `ownedCustomerRows`. This puts `normalizeEmail(session.email)` into the SQL parameters, at `guest-access.ts:131`.
- `getMySpacePage(session)`, on the session e-mail.
- `getPurchaseReference`, `getCustomerSpacePage` and others, on purchase and customer ids.

A failure in any of them goes through three steps:
1. Drizzle 0.45 wraps every failure, network errors included, in `DrizzleQueryError` (`node_modules/drizzle-orm/pg-core/session.js:38-66`). Its message is `Failed query: <sql>\nparams: <values>` (`node_modules/drizzle-orm/errors.js:10-20`).
2. The error propagates out of the server component.
3. In production, `NextNodeServer.instrumentationOnRequestError` calls `this.logError(err)` on the raw error (`node_modules/next/dist/server/next-server.js:1392-1401`). The digest-only client boundaries do not change this server log.

The codebase already knows this path. Two route handlers catch their errors for exactly this reason:
- `src/app/api/mock-checkout/route.ts:58`: "Next.js would log the raw error, which can carry SQL parameters".
- `src/app/api/c/[token]/route.ts:53`.

The pages got no such treatment. There is a second path. Every public page now calls `getFreshSession()` for every visitor that has a cookie. When the adapter query fails, Better Auth's `getSession` runs `ctx.context.logger.error("INTERNAL_SERVER_ERROR", error)` with the raw adapter error (`node_modules/better-auth/dist/api/routes/session.mjs:254-257`), and the session lookup's parameters include the session token. No custom logger is configured.

The repository guard `rawErrorLogs` only reads application `console.*` calls, so it cannot catch either path.

Scenario: Neon has a transient failure, such as a cold-start timeout, a quota stop or an HTTP fetch error, while signed-in clients browse `/altinha-paris` or open `/mon-espace`. Each failed render writes a function log line like `Failed query: select … where ("customer"."email" = $1 …) params: alice@example.com,…`. Each failed session lookup writes the raw adapter error with the session token. The e-mails of every affected signed-in visitor end up in the platform's runtime logs, which the contract says never happens.

Fix:
1. Give the public read wrappers one `server-only` helper, `safeRead(fn)`. It awaits `fn()`. On error it calls `unstable_rethrow(err)` so `notFound`, `redirect` and dynamic bail-outs still work, then throws `new Error(logSafeMessage(err))`. Apply it in `src/server/public-queries.ts`, `src/server/visitor.ts` and `src/server/client-queries.ts`, or at each page's top-level reads. The boundary then still renders and the digest still pairs with the log line, but the line carries only the SQL head.
2. Give Better Auth a `logger: { log(level, message, ...args) { console[level === "error" ? "error" : "warn"](`[auth] ${message} ${args.map(logSafeMessage).join(" ")}`) } }` in `auth-options.ts`.
3. Pin both with a pure test: a fake `DrizzleQueryError` whose params hold an e-mail comes out of `safeRead` and the logger without it.

### Minor

**RND-2. The IP and /48 throttle keys are shared across the whole platform, and refused attempts count, so one shared network can be locked out of every pro.**

Where:
- `src/lib/throttle.ts:117-118` (`t:<a>:ip:<ipHash>` and `t:<a>:ip48:<wideIpHash>`, neither carrying the professional id).
- `src/lib/throttle.ts:142-145`: every key is consumed in one `Promise.all`, whatever the outcome.
- `src/lib/tickets-vocab.ts:198-206`.

This contests the accepted residual at `docs/superpowers/plans/2026-10-21-p4-public-outcome.md:191`:

> On one IP, a third buy + book on the same séance within the hour answers « Trop de demandes. Réessayez dans un moment. » (`perOccurrenceIp` 2, Decision 65): a household sharing one connection meets it too.

The residual and the Decision 65 bullet (outcome:26) only weigh the per-séance key. Neither says that the IP key (20 per hour) and the /48 key (60 per hour) are global across all pros. Nor do they say that a refused attempt still increments every key.

Scenario: one client loops on « Réessayer », or one abuser sits behind a carrier-grade NAT IPv4 or in a carrier /48. After 20 (IP) or 60 (/48) attempts in the hour, every other subscriber on that network gets « Trop de demandes » for buy + book, free registration, shop and RDV at every pro until the window ends. Venue Wi-Fi after a class hits the per-séance key after two bookings. That is the use case of a group-class product, not just a household.

Fix:
- Either scope the `ip48` key, and possibly the IP key, by professional. Per-pro protection is unchanged, because a seat-hold attack targets one pro anyway.
- Or keep the global scope and add the platform-wide reach to the residual, so the owner accepts the real cost.

In both cases, consider letting a refused attempt stop incrementing the keys it has already exceeded.

## Recommendations

- Apply RND-1 before P5. P5 adds more render-time reads, and the helper is cheap to adopt now.
- I considered and left out one item. A séance URL that carries `?p=` stays indexable when the séance is on sale (`seance/[occurrenceId]/page.tsx:54-64`). § 5 rules on that metadata, the page is no-referrer, and discovery needs the URL to leak first. If a P5 page renders a capability URL, noindex on `searchParams.p` would cost one line.

## Declined to judge

- `updateMyName` and `revokeMyLinks` have no throttle. Contract § 4 rows 7-8 say none, and they touch the caller's own rows only.
- Vercel `<Analytics />` predates P4 (79841e9).
- Better Auth may refresh the session row during a render (session freshness update). This is pre-existing library behaviour outside P4's code.
- The `/api/track` rate limit is a carry from the admin space.
- Streamed `notFound()` answering HTTP 200: ruling after Task 30, in the accepted residuals.
- Throttling `?p=` probes is a deferred minor.
- The e-mail key lockout oracle is Decision 67.

## Assessment

Verdict: **with_fixes**. Nothing written during render escapes its key, no cache crosses visitors, client props are clean and metadata follows § 5. RND-1 is a real gap in the contract's log rule on render paths. The codebase already handles it in its route handlers but not in its pages or in Better Auth's logger. RND-2 is a documentation and scope fix to an abuse bound.

---

## Dimension AUTH

### P4 final review: AUTH dimension (Review Focus rows 5 and 8)

Branch `feat/tickets-events`, HEAD `08268de`, range `8ac32eb..HEAD`. Read-only review: code read at HEAD in the `tickets` worktree. The only tests run were the pure suites for this dimension (sign-in-flow, auth-ui-guards, auth-messages, auth-options pure parts, form-method, ui-copy, messages): 122/122 pass. No DB test, no server and no browser were used.

## Strengths

- **Risk 7 gate is single and correct.** Every code-form mount goes through `canOfferCodeSignIn(state)`, which is `state === "anonymous"` (`src/lib/public/sign-in-flow.ts`). That covers `/mon-espace` (page.tsx:46), `/[slug]/espace` (page.tsx:147), `VisitorBar`, `HaveTicketsPrompt` and `SpendSeanceButton`.
  - An unverified visitor gets `VerifyEmailBanner` plus `CONFIRM_EMAIL_FIRST` or `CONFIRM_EMAIL_TO_SPEND` instead.
  - An impersonating admin gets `COPY.IMPERSONATING`, or the bar renders null.
  - On the server, `purgeUnverifiedPassword` runs only on the `OTP_SIGN_IN_PATH` transition.
- **A fresh session read comes before every refresh.** `email-code-form.tsx:136-143` calls `authClient.getSession({ query: { disableCookieCache: true } })` before `router.refresh()`, and `verify-email-banner.tsx` does the same. No P4 component refreshes after a Server Action. `auth-ui-guards.test.ts` pins the order.
- **No enumeration.** `CODE_SENT` (« Si l'adresse est valide, un code a été envoyé. ») answers every address. Only a failed send (429 or 5xx) changes the answer. The sign-in OTP endpoint sends to any address. Email-verification sends are bound to the address of a fresh session (`auth-options.ts` hooks.before).
- **OTP parameters match the contract and the UI copy.**
  - Plugin: `otpLength` 6, `expiresIn` 300, `allowedAttempts` 3, encrypted storage.
  - Per address: a `consumeThrottle` cap.
  - Endpoint rate limits: send 5 per 600 s, sign-in and verify-email 10 per 600 s.
  - The help text reads « 6 chiffres, valable 5 minutes. ».
- **Google never reaches the pro onboarding.**
  - `googleCallbacks(returnTo)` sets callback = newUser = `returnTo`.
  - `authFormGoogleCallbacks` never yields `/onboarding` in sign-in mode.
  - Both are pinned by `sign-in-flow.test.ts`.
- **`returnTo` / `next` are safe.** `returnPathOf` runs `safeNextPath` and then drops the query and the fragment, so `p` never travels. `safeNextPath` refuses `//`, backslashes, control characters and normalised protocol-relative paths.
- **Sign-out leaves nothing in the router cache.** `ClientSignOutButton` and `OtherAddressButton` call `signOut()` and then `window.location.replace(...)`, a full document load. The client pages use only these two buttons, never the router-based `SignOutButton`.
- **Destructive gestures are confirmed.** These all sit behind `ConfirmDialog`, with `returnFocusTo` on a heading that outlives the row:
  - cancelling a booking
  - « Révoquer mes liens »
  - « Libérer ma place » (`RELEASE_CONFIRM` in `checkout-return.tsx`)
  - pending-hold release
- **The form guard is sound.** `src/test/form-method.test.ts` walks every `.tsx` under `src` with a brace-aware tag reader. It asserts at least 40 forms and cross-checks against a plain-text `<form` count, so it cannot pass vacuously. It also checks that each handler calls `preventDefault()` first. The only exemption is `/admin/users` (G4b ruling).
- **Copy.** P4 UI is French with vouvoiement and has no U+2014 / U+2013. The only hit in `src` is a pre-existing comment. Client errors go through `clientErrorMessage` (client context first, then engine messages). Money goes through `formatMoney`. `REQUEST_FAILED` / `GENERIC_ERROR` are neutral client-safe sentences.
- **Live regions and pending states.**
  - `EmailCodeForm`, the `OccurrenceBooking` feedback, `MyNameForm`, `OfferCheckoutForm` and `ClientSignInChoices` mount their status and alert regions from the first render.
  - Submits carry pending labels: `PENDING_SEND`, `PENDING_VERIFY`, `PENDING_SAVE`, `PENDING_PAY`, `PENDING_REGISTER`, `PENDING_BOOK`.
  - Field errors go through `FormField` (`aria-describedby` / `aria-invalid`), radios included.
- **Brand contrast.** `accentForeground` is darkened to 4.5:1. `INLINE_LINK_CLASS` uses `text-accent-foreground`. No P4 public component sets `text-primary` on brand surfaces.

## Issues

### Critical

None.

### Important

**AUTH-1. Inline code sign-in on `/mon-espace` and `/[slug]/espace` drops the focus and announces nothing.**

- **Where:**
  - `src/app/mon-espace/page.tsx:49` (`<EmailCodeForm idPrefix="my-space" askName />`)
  - `src/app/[slug]/espace/page.tsx:154` (`<EmailCodeForm idPrefix="espace-code" />`)
  - `src/components/auth/email-code-form.tsx:141-143`
- **What:** after a correct code, `setDone(true)` disables every button in the form, including the focused « Valider le code ». `onSignedIn` is undefined on both pages, so nothing takes the focus. `router.refresh()` then re-renders the page as signed in: `canOfferCodeSignIn` turns false and the whole card unmounts. The status region that unmounts with the form never said anything on success either.
- **Scenario:** a keyboard or screen-reader client on `/mon-espace` types the code and presses Enter.
  - The page swaps to `MySpaceView`.
  - The focus falls to `<body>` (the h1 « Mon espace client » has no `tabIndex`).
  - Nothing is announced, so the user hears nothing and Tab restarts from the top of the document.
  - The same happens on `/{slug}/espace`: the card is replaced by the Owner's space or by the other-address button.
  - This is the WCAG 2.4.3 / 4.1.3 class that the G3a ruling fixed for the dialog path (`returnFocusTo` = the Planning heading). The inline path was left out.
- **Fix:**
  - Give both pages a focus target: the page heading with an id and `tabIndex={-1}`, read through a module-level getter like `PLANNING_HEADING_ID`.
  - Pass `onSignedIn` to `EmailCodeForm`, or a `focusAfterSignIn` getter that it calls after the refresh commits, for example in an effect keyed on the identity, or through the existing `focusTargetOnClose` pattern.
  - Add a page-level live region that is always mounted and outside the form (« Vous êtes connecté(e). »), so the success is announced after the swap.
  - Pin it with a page-wiring guard, as `auth-ui-guards.test.ts` does for `OtpDialog`.

### Minor

**AUTH-2. A Google `account_not_linked` round-trip loses the client's way back.**

- **Where:**
  - `src/app/(auth)/sign-in/page.tsx:25`
  - `src/app/(auth)/sign-up/page.tsx:26` (`redirect("/link-google")`)
  - `src/components/auth/link-google-form.tsx:41` (`callbackURL: "/sign-in"`)
- **What:** P4's `googleCallbacks` makes Google errors land on `/sign-in?next=<returnTo>`, but the `account_not_linked` branch redirects to `/link-google` without `next`. After linking, the callback is a bare `/sign-in`, which `resolvePostSignIn` sends to `/mon-espace` for a non-pro.
- **Scenario:**
  - A client already has an unverified password account.
  - On `/altinha-paris/seance/<id>` they open « Retrouver mes tickets » and pick « Continuer avec Google ».
  - They link at `/link-google`, then land on `/mon-espace` instead of the séance they started from.
  - The flow is safe; only the destination is wrong.
- **Fix:** forward `safeNextPath(next)` as `/link-google?next=...`, and have `LinkGoogleForm` use `/sign-in?next=<it>` as its `callbackURL`. Use `errorCallbackURL` too.

**AUTH-3. `VerifyEmailBanner`, now shown to clients on public pages, has no pending text and an alert that is not always mounted.**

- **Where:** `src/components/dashboard/verify-email-banner.tsx:190-200` and `:242-251`.
- **What:**
  - « Recevoir un code » / « Saisir le code », « Renvoyer le code » and the dialog submit « Confirmer » only add a spinner. The label never changes to a pending wording.
  - The dialog's `<FormError message={dialogError} .../>` is not `alwaysMounted`.
  - The P4 components use `PENDING_*` labels and `FormError alwaysMounted`.
- **Scenario:** an unverified client on `/{slug}/espace` clicks « Confirmer ». A screen reader hears no pending state, because only an aria-hidden spinner appears. A refusal relies on the moved focus alone to be read, since the region did not exist before.
- **Fix:**
  - Add pending labels (`verifying ? COPY.PENDING_VERIFY : "Confirmer"`, and `PENDING_SEND` for the two send buttons).
  - Pass `alwaysMounted` to the dialog `FormError`.

**AUTH-4. `AuthForm`, the client's « mot de passe » path, has a conditionally mounted alert and a submit with no pending label.**

- **Where:** `src/components/auth/auth-form.tsx:180-189`. These lines are pre-existing, but P4's `ClientSignInChoices` / `passwordSignInHref` now send clients there.
- **What:**
  - `{error && <p role="alert">…}` inserts the region together with its text.
  - « Se connecter » / « Créer mon compte » keep their label while busy.
  - The `Loader2` has no `aria-hidden`.
- **Scenario:** a client comes from a séance and mistypes the password. Some screen-reader and browser pairs miss the inserted alert, and the pending state is not announced.
- **Fix:** an always-mounted `<div role="alert">` wrapper (or `FormError alwaysMounted`), a pending label (« Connexion… » / « Création… »), and `aria-hidden` on the spinner.

**AUTH-5. `MyNameForm` « Votre nom » has no `maxLength`.**

- **Where:** `src/components/public/my-name-form.tsx:72-84`.
- **What:** the same field is capped with `maxLength={BOUNDS.name}` in `EmailCodeForm` (line 202; G3a « Votre nom » maxLength 80) and in `IdentityFields` (line 42), but not here.
- **Scenario:** a client pastes a long name. Typing is not stopped at the limit; they get a field error on submit (`plainNameSchema`) and must trim it by hand.
- **Fix:** `maxLength={BOUNDS.name}` on the input.

## Recommendations

- Fold AUTH-1 into the same pattern as the dialog path: one getter-based focus target per page, plus one always-mounted page status. Give it a guard that fails if a page renders `EmailCodeForm` without a focus target.
- When the ui-copy scan widens (P5 carry), include `verify-email-banner.tsx` and `auth-form.tsx` in a pending-label check. Both are client-reachable now.

## Declined to judge

- `src/server/analytics-salt.ts:15-16` U+2014 in a comment: pre-existing (`4f7c59f7`), not UI, and the ui-copy scan widening is a known P5 carry (LED:457).
- `OfferCheckoutForm` assigns `checkoutUrl` without `safeCheckoutUrl`: PAY dimension.
- `brandTheme` `readableOn` on P3 surfaces, and the onboarding `text-primary` link: pre-existing P3, not P4 code.
- `AuthForm` sign-up `router.push(next ?? "/onboarding"); router.refresh()`: pre-existing, and it follows a Better Auth fetch, not a Server Action. The refresh check is scoped to P4-created components (ruling, Task 31).
- bfcache after sign-out: the pages are dynamic, and the task browser steps covered it. It cannot be proven read-only.
- Sign-up `ACCOUNT_EXISTS` reveals an existing account: pre-existing Better Auth / P1 behaviour, outside the P4 code-sign-in path, which is neutral.
- `SpendSeanceButton`'s `OtpDialog` without `returnFocusTo`: the contract accepts it (contract line 979).
- The full address under « Bonjour {name} » next to the masked guest note in the espace: plan Task 22 browser step 8 expects both, so this is by design.
- A suspended unverified user's code sign-in still purging the password: negligible, and it fails closed.
- With `resendStrategy: "reuse"`, « valable 5 minutes » on a resent code may overstate the time left: this depends on Better Auth's runtime reuse semantics, which I could not check read-only.
- The ui-copy scan list does not cover `(auth)/sign-up`, onboarding, `site-header`, `account-link`, `use-google-redirect` or `reset-password-form`: a known deferred minor / P5 carry.

## Assessment

**Ready to merge? With fixes.**

The sign-in security properties hold:
- the risk 7 gate
- a fresh session read before refresh
- a neutral answer for every address
- the OTP bounds
- Google callbacks that never reach onboarding
- `returnTo` without `p`
- full-load sign-outs
- the non-vacuous form guard

Copy and confirmations meet the contract. One Important accessibility gap remains (AUTH-1): the inline code sign-in on `/mon-espace` and `/{slug}/espace` loses the focus and stays silent on success. It is the same class G3a fixed for the dialog path. The Minors are polish on P3 or pre-existing components that P4 now puts in front of clients.

---

## Dimension TIME

### P4 final whole-branch review - TIME (time, money, data integrity)

Branch `feat/tickets-events`, HEAD `08268de`, range `8ac32eb..HEAD` (105 commits). Read-only review: code read at HEAD, the zone-sensitive pure suites run under three host zones through PowerShell `$env:TZ`. No DB suite, dev server or browser was run.

## Strengths

- **The séance instant goes out and comes back as an ISO string, unchanged.** `src/app/[slug]/seance/[occurrenceId]/page.tsx:241` renders `seenStartsAt={detail.startsAt.toISOString()}`. The client posts it back untouched (`occurrence-booking.tsx`, `spend-seance-button.tsx` sends `seance.startsAt`, which is the ISO from `spendable.ts`). `booking-actions.ts:45` validates it with `z.iso.datetime()`, and `:289/:434/:504` turn it back into a Date with `new Date(...)`. The engine then guards `starts_at = ts(seen)` inside the batch (`claims.ts:290` assertOnline plus the unchangedStart guard). No client clock or client zone is involved anywhere.
- **Every time helper takes the pro's zone explicitly.**
  - The helpers: `todayKey`, `formatTimeRange`, `dayLongLabel` (civil noon in UTC), `formatWhen`, `formatTime`, `planningNav` by DateKey, `planningEmptyState`, `weekStartFromParam` / `weekBounds` / `paramForWeek` (local Monday 00:00 to the next local Monday), and the e-mail `paidOn` / `expiryLabel`.
  - The SQL booking horizon compares `(starts_at at time zone p.timezone)::date` (`spendable.ts:77-78`, `planning-reads.ts`).
  - A grep found no `new Date(`, `toLocale*` or `getHours` in client components or in P4 lib code. The one exception is `toLocaleString("fr-FR")` on counts in `messages.ts`, which is harmless.
- **Each request uses one clock.** `src/app/[slug]/page.tsx:70` takes one `now` and passes it to the planning, the horizon need, the next-séance reads and the wallet. The séance page and its sub-reads do the same (59cb9ba). The planning and the labels it shows cannot disagree about « now ».
- **DST and host-zone independence are tested and pass.**
  - `planning-view.test.ts` covers Paris 2026-03-29 / 2026-10-25 and Los Angeles 2026-03-08 / 2026-11-01, including the empty-week « next séance » target.
  - The 7 zone-sensitive pure files pass 119/119 under Pacific/Kiritimati (UTC+14), Pacific/Pago_Pago (UTC-11) and Asia/Kolkata (half-hour offset).
- **Money is always integer cents with the currency beside it.**
  - Every public price label (`offerOptionLabel`, `payLabel`, Boutique, offer page, mock page) and the receipt go through `formatMoney(cents, currency)`. The currency is `pro.currency`, snapshotted on the purchase.
  - The webhook refuses a session whose `amount_total` or currency differs from the snapshot (`webhook-core.ts:133-139`) before it fulfils anything.
- **« il vous en restera N » counts the right type.** `seance-reads.ts:280` returns `walletBalance(type of the first eligible ticket).usable - 1`, floored at 0, with that type's name. A visitor holding two types never sees the other type's balance in N.
- **Fulfilment is idempotent and race-safe.** `fulfillment.ts:181` pays `where status in ('pending','expired')`. The `fulfilled_action_id = aid` guard ('already_paid', `:140`) turns a concurrent duplicate into a no-op. The booking is confirmed only while still pending, through RETURNING, and ticket #1 is booked only when that confirm ran. Every other case falls to `late_payment`, with the ticket in the wallet and no seat.
- **The races I traced end consistently in either order:**
  - fulfil vs `sweepHolds`
  - fulfil vs `releasePurchase` (mock)
  - `expireStalePurchases` vs `markProcessing`
  - the nightly job twice
  - « Libérer ma place » vs a payment completing: `closeForRelease` returns "failed" on any Stripe doubt, so nothing is released.
  - the last seat bought twice: lock the occurrence, `R(o)`, then `SEAT(+1)` behind the capacity guard in one batch.
  - a held ticket spent twice: the guarded `UPDATE`, plus `SKIP LOCKED` in `pickTicket`.
- **The engine keeps the capacity invariant itself.** `startBuyAndBook` locks the occurrence, releases elapsed holds before the claim (`R(o)`) and takes the seat with `SEAT(+1)` under `G(onlineOk)`, `G(unchangedStart)` and `G(offerUnchanged)`, which now also checks `not tt.rdv_free`. `releasePurchase` moves `SEAT(0)` with `rel(o)`, so a released or elapsed hold gives its seat back exactly once.
- **The deletion rules hold.** P4 adds no migration. The only user references it writes are SET NULL: `customer.user_id` (`schema.ts:515`) and `ticket_movement.actor_user_id` (`schema.ts:714`). The domain rows still cascade from `professional`, and the throttle table has no foreign key on purpose. `deleteUser` stays one `DELETE FROM "user"`.
- **The Stripe expiry is deliberate.**
  - Buy + book: `buybookCheckoutExpiry(Date.now())` is computed right before the Stripe call (`checkout.ts:94-95`, spec L808). Stripe therefore always sees at least 30 minutes, while the DB `checkout_expires_at` from the action-start `now` ends a few seconds earlier. The « Reprendre le paiement » link disappears first, which is the safe direction.
  - Hold: 45 min. Checkout: 31 min. Stale purchase: 60 min of grace. Each step leaves margin for the next.

## Issues

### Critical

None.

### Important

None.

### Minor

None kept. I looked at three candidates and dropped them after checking:

- `spendable.ts:87` treats `hold_expires_at >= now` as live, while the rest of the code uses `> now` for live and `< now` for elapsed. Within `spendable.ts` this is a clean split, since `:83` counts only `< now` as elapsed. The difference exists only at the exact millisecond of expiry and has no visible effect.
- The Date.now() vs action-start `now` gap on the buy + book `expires_at` (`booking-actions.ts:322`) is intended (spec L808) and errs on the safe side, as noted above.
- `merciStateOf` (`merci-view.ts:39`) returns « pending » for a pending purchase whatever its checkout expiry. `merci` is Stripe's success_url, so a pending row there means the webhook is still on its way. A purchase whose checkout expired reaches it only through a URL typed by hand, and the refresher stops after 20 refreshes 3 s apart. The paid-with-booking-pending case is a ledger ruling and is not re-reported.

## Recommendations

- If the hold rule is ever centralised, pick one boundary (`> now` live / `<= now` elapsed, matching `endedStatusOf`'s `lte`) for `spendable.ts:83/87` as well. This is only to keep the code consistent; nothing is wrong today.
- During the owner's Stripe test-mode run (already a carry in the outcome), also watch that the shop `expires_at` (action-start now + 24 h) is accepted. That item is in the outcome already and is not re-reported.

## Declined to judge

- Throttle key rotation (the IP hash follows the daily salt, the e-mail digest is unsalted): this belongs to the ABUSE / security dimension.
- `mockPay` fulfilling an expired simulated purchase: intentional and tested (mock-checkout DB test, line 199), and off with Stripe and in production. This is the payments-gateway dimension.
- The wording of « il vous en restera N » as per-type: consistent with spec L1353 and Decision 44. Copy belongs to the UX dimension. I only checked that the count itself is correct.
- The P5/P6 carries and the ledger residuals listed in the outcome (Decision 26 Stripe run, Apple Pay / Google Pay, the `maxDuration` of a stalled Checkout create).

## Assessment

**Ready to merge? Yes**, for this dimension.

On every point in the checklist, P4 keeps time, money and data integrity correct: instants travel as server ISO strings, wall-clock labels use the pro's zone and pass on DST days and under extreme host zones, money is integer cents with a currency, and the seat, ticket and payment races end the same in either order. I have no finding at any severity.

---

## Dimension X

### P4 final review X: spec coverage, tests, cross-cutting regressions, docs

Range `8ac32eb..08268de` (105 commits, 310 files), worktree `.claude/worktrees/tickets`, branch `feat/tickets-events`.
Reviewer X (spec coverage, the S1 to S52 tests, pro and admin regressions, hygiene, outcome accuracy). Read-only. I ran these
myself at HEAD: `tsc --noEmit` exit 0, and the pure suite 1422/1422. I did not run the DB suites, the build, a browser or curl,
because the task forbids them.

## Strengths

- **Spec coverage.** Every § 13.2 item that P4 owns is present at HEAD:
  - planning rows: title, time, effective location, seats left, accepted-type badges, five states (`src/lib/public/planning-view.ts`);
  - Boutique « Acheter » (`src/components/public/boutique.tsx:51`);
  - `/mon-espace`: name form, « Déconnecter mes liens », `COPY.CREATE_PAGE`;
  - espace `no_record` copy (`src/lib/public/messages.ts:161-163`);
  - the merci, offer and séance routes;
  - the cron route, `maxDuration = 300`, `force-dynamic` (`src/app/api/cron/daily/route.ts:7-8`).

  RDV libre cards were moved to P5 by Decision 48, which the outcome records.
- **Tenancy tests are broad and real (S6).** Every public core and read DB file has a cross-pro case. Each one checks that
  nothing was written at either pro, not only that a refusal came back. Examples:
  - `shop-actions.db.test.ts:190-206` checks « the typed address never reaches the other pro »;
  - `space-actions.db.test.ts:114-135` tries both the Owner and the other pro's cookie customer;
  - `webhook-core.db.test.ts:524` covers the webhook;
  - `spendable.db.test.ts:235` covers the spendable séances;
  - `offer-reads.db.test.ts:68-105` uses hand-built cross-pro rows.
- **Payment tests check state, not only return values.**
  - S12 (`webhook-core.db.test.ts:177-190`): two deliveries issue the tickets once, and the orphan counter is unchanged.
  - S39 (`:386-413`) tries five wrong amount and currency variants. Each must be an orphan, the counter must grow by exactly 5,
    the purchase must stay pending with no tickets, and a correct delivery in capital letters must then settle it.
  - S37 (`:430`) checks foreign sessions, S13 (`:307`) another session's `expired`, and S14 (`:484`) the expanded payment intent.
  - S15 and S16: the full `mockCheckoutAllowed` matrix (`checkout.test.ts:215-224`) and a hostile id (`:134-156`).
  - S40 (`mock-checkout.db.test.ts`).
- **Source guards are hard to fool.**
  - `payment-mode.test.ts` follows the runtime import closure of client files, including `import()`, `require()` and backtick
    specifiers, and stops at `"use server"` files.
  - `next-config.test.ts:105-113` scans the app routes and fails if a top-level segment is missing from `RESERVED_SEGMENTS`. A
    future route cannot be forgotten.
  - `form-method.test.ts` reads braces, cross-checks a text count, and allows exactly one GET form.
  - The `rawErrorLogs` guard now runs over the whole repo (`log-safe.test.ts`, 14 hits fixed in 08268de).
- **No pro or admin regressions found.**
  - `vercel.ts` keeps `git.deploymentEnabled: false`, and the cron is `0 3 * * *`.
  - `src/lib/auth-admin.ts` is untouched, so the admin plugin HTTP endpoints stay disabled.
  - P4 makes no schema change, so `deleteUser` is unaffected. Its E13 checkout expiry goes through the tested `expireOpenCheckoutsCore`.
  - The dashboard `<main>` stays `overflow-x-clip` (`src/app/dashboard/layout.tsx:45`).
  - `DemoQuickLogin` still shows only when `APP_ENV !== "production"`.
  - `/mon-espace` is in `RESERVED_SEGMENTS` and untracked.
  - `PageViewTracker` sends `usePathname()` only, so `?p=`, `paiement` and `lien` never reach `page_view`.
- **The P3 back-office changes are clean.**
  - The client search moved behind `searchClientsAction` → `runProQuery`, and its schema is `.strict()` (`client-actions.ts:57`).
  - A request counter drops stale answers.
  - The wiring is pinned (`client-search.test.ts:36-44`), and a cross-pro search is DB-tested (`client-actions.db.test.ts:779`).
  - `clientsHref` can no longer carry `q` (S50).
- **Boot and environment refusals are tested and wired.**
  - `envBootErrors` runs from `env.ts` at import time.
  - `mockCheckoutEnabled()` passes `VERCEL_ENV`.
  - `CRON_CONFIGURED` requires 32 characters or more.
  - `logResetLink` and the mock mail log are both cut in production builds.
- **The outcome is thorough and matches the code** on every owner check I verified: APP_ENV, BETTER_AUTH_SECRET, CRON_SECRET,
  Resend refusal at module load, the slug check, the webhook events, the Decision 27 and 28 mock rules, and Decision 73.

## Issues

### Critical

None.

### Important

None.

### Minor

**X-1. `src/server/public.ts` has no wiring guard, unlike every sibling server file**

- **Where:** `src/server/public.ts:22-69`.
- **Issue:** this file holds the five public write exports, including `bookWithHeldTicketAction`, the one action that spends
  tickets.
  - Its siblings all have a source guard: `src/server/client.ts` (`client.test.ts`), `src/server/public-context.ts`
    (`public-context.test.ts`), `src/server/public-queries.ts` (`public-queries.test.ts`) and `src/server/visitor.ts`
    (`visitor.test.ts`).
  - No test reads `public.ts`. A grep of the test files matches only `ui-copy.test.ts` (dash scan) and comments.
  - The P4 outcome carries the « server files with no automated test » to P6 (`outcome.md:140`), but names only `deleteUser`
    and the Google backfill, not this file.
  - P5 will add `bookRdv` to the same file (`outcome.md:95`).
- **Scenario:** an edit to one export, or the new P5 `bookRdv` export, could:
  - call its core directly instead of through `runPublicAction`;
  - or pass `input` instead of `rest`, or build a `pro` or visitor from input;
  - or pass something other than `publicDeps()`.

  For example, `startShopPurchaseCore(db, input.pro, …)`, or a missing `runPublicAction` call, would lose the slug check,
  `resolvePublicPro`, the fresh-session visitor, the `"none"` effects budget (S49) and the revalidation. The full pure and DB
  suites would still pass, because every core test calls the core with a hand-made `pro` and visitor, and `run-action.test.ts`
  tests `runPublicActionWith` directly.
- **Fix:** add `src/server/public.test.ts` modelled on `client.test.ts`. It should pin:
  - the `"use server"` directive and the export list;
  - for each export, `splitActionInput(input)`, then `runPublicAction("<name>", slug, (pro, visitor, now) => <core>(db, pro, visitor, rest[, publicDeps()], now))`;
  - that no other runtime import of `@/lib/db` writers or `@/server/notify` exists.

  Then list it in the outcome next to `outcome.md:140`.

## Recommendations (no finding)

- `src/lib/admin-metrics.ts:83`: the doc comment « the one rule of src/lib/payment-mode.ts (no import: …) » sits on a file that
  does import it. It means that `payment-mode.ts` has no import, so say « (payment-mode.ts has no import: … ) ». This is wording only.
- AGENTS.md is P6 work by spec L1701, but the P6 pass should bring in the P4 rules. AGENTS.md L71-72 still names
  `src/lib/payments.ts`, which no longer exists: fulfilment now lives in `src/lib/booking/fulfillment.ts` and `src/lib/payments/*`.
  The P4 rules to add:
  - the public action pattern (`splitActionInput` + `runPublicAction`, `"none"` budget);
  - `logSafeMessage` and the repo-wide raw-error guard;
  - the `method="post"` form guard;
  - the `APP_ENV` / `VERCEL_ENV` / `BETTER_AUTH_SECRET` boot refusals;
  - `CRON_SECRET` (32 characters or more);
  - the mock checkout rule.
- `resolveSpaceIdentity` (`src/lib/back-office/guest-access.ts:170`) is now dead in app code; only `guest-access.db.test.ts`
  uses it. The Task 5 deferred minor (« two implementations… kept by § 3.5 ») already covers this. P6 dead-code cleanup should
  delete it or make `spaceIdentityOf` its only twin.
- The hold-lapse boundary still differs between modules: `>` in `booking-actions.ts:350`, `>=` in `spendable.ts:87`, `gte` in
  `dashboard-reads.ts:143`. LED:384 already carries this to P6 (« one shared holdLapsed helper »). I mention it only because P4
  added three more call sites.

## S-row spot checks (test bodies read at HEAD)

| S-row | Checked in | Result |
|---|---|---|
| S1, S2 | `booking-actions.db.test.ts:1364-1407` | no booking, no throttle row, ticket still available |
| S6 | all 16 public and payment DB files (grep, then read: shop, space, offer, spendable, webhook) | tenancy case present in each |
| S7, S26 | `purchase-reads.db.test.ts`, `release-actions.db.test.ts` | |
| S11 | `webhook-core.test.ts` | |
| S12, S13, S14, S37, S39 | `webhook-core.db.test.ts:177, 307, 484, 430, 386` | |
| S15, S16 | `checkout.test.ts:134, 215` | |
| S17 | `cron-auth.test.ts` | |
| S23 | `sign-in-flow.test.ts` | |
| S40 | `mock-checkout.db.test.ts` | |
| S48 | `auth.db.test.ts:234-268` | |
| S49, S51 | `public-context.test.ts`, `visitor.test.ts` | |
| S50 | `client-filters.test.ts`, `client-search.test.ts` | |
| S52 | `guest-access.test.ts` | |
| S10, S24, S25, S32, S35 | `visibility.test.ts`, `space-actions.test.ts` | |

Every case asserts a real behaviour. None could pass with the rule removed.

## Declined to judge

- The DB suites (767 tests) were not run: the task forbids it. I read their bodies instead.
- `pnpm build` was not run (pnpm is forbidden), so the outcome's « every P4 route dynamic (ƒ) » claim is not re-verified.
- The curl and browser evidence was not re-run: S41 (GET without Set-Cookie, POST without Origin → 403), S47 (framing headers
  on live responses) and the Task 20a network check (`q=` empty). The static side of S47 is covered by `next-config.test.ts:65-80`.
- The Stripe test-mode run of Decision 26 is an owner step.
- Visual design, contrast and focus-trap quality are other reviewers' dimensions.

## Assessment

Verdict: **ready**. I found no Critical or Important issue in my dimension. Spec coverage for P4 is complete or carried, and
each carry is recorded in the outcome. The security tests assert state and fail when the rule is removed. The pro and admin
surfaces show no regression. The single Minor (X-1) is a missing wiring guard on `src/server/public.ts`. It should land before
P5 adds `bookRdv` to that file.

