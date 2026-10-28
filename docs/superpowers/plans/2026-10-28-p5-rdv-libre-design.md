# P5 « RDV libre »: scope dossier

Synthesis of the five research notes kept in the git-ignored P5 workspace `.superpowers/sdd/2026-10-28-p5-rdv-libre/research/` (`p5-spec.md`, `p5-engine.md`, `p5-backoffice.md`, `p5-public.md`,
`p5-slots.md`). The claims that matter were checked again against the spec and the code. This was a read-only pass.

- Worktree: `C:/Users/Matheus/Documents/Codage/skedul/.claude/worktrees/tickets`, branch `feat/tickets-events`.
- HEAD at the check: `281f64b` (« fix(logs): … safeRead … »). The research ran at `08268de`.
  - `281f64b` changed `src/server/public-context.ts`, `public-queries.ts`, `client-queries.ts` and `visitor.ts`, so line
    numbers in those four files are given at `281f64b`.
  - It also added the `safeRead` rule for every server read (`src/server/safe-read.ts:7-16`, pinned by
    `src/server/safe-read.test.ts:16-18, 91`).
  - Update 2026-10-28: `src/server/public.test.ts` (the `public.ts` wiring guard) is now committed (`cac71fb`), and the P4
    fix pass changed the four files above again: re-read them. The short plan `2026-10-28-p5-rdv-libre.md` lists the other
    adjustments.
  - At the check, an untracked `src/server/public.test.ts` (the `public.ts` wiring guard) was being written by another agent. Its header
    says « P5 adds `bookRdv` here: it goes in ACTIONS below, with its core » (`src/server/public.test.ts:9-10`).
- Spec: `docs/superpowers/specs/2026-10-12-tickets-evenements-design.md`, cited `L<n>`.

Citation prefixes:

| Prefix | Document (under `docs/superpowers/plans/`) |
|---|---|
| `OUT:<n>` | `2026-10-12-p2-domaine-outcome.md` |
| `CON:<n>` | `2026-10-12-p2-domaine-contract.md` |
| `P3OUT:<n>` | `2026-10-14-p3-back-office-outcome.md` |
| `LED:<n>` | `2026-10-14-p3-back-office-ledger.md` |
| `FR:<n>` | `2026-10-14-p3-back-office-final-review-findings.md` |
| `P3CON:<n>` | `2026-10-14-p3-back-office-contract.md` |
| `P4OUT:<n>` | `2026-10-21-p4-public-outcome.md` |
| `P4CON:<n>` | `2026-10-21-p4-public-contract.md` |
| `P4PLAN:<n>` | `2026-10-21-p4-public.md` |

Every other citation is `path:line` in the worktree.

---

## 0. Verdict in brief

1. **The engine half of P5 is done and correct.**
   - E4 is one exported function, `bookRdv`, in `src/lib/booking/claims.ts:961-1090`, with three modes: `held_ticket`,
     `free` and `buy` (`claims.ts:826-849`).
   - The DB guarantees "one RDV per instant per pro" with the partial EXCLUDE `occurrence_rdv_excl` on the buffered block
     (`drizzle/0012_tickets_manual.sql:4-6`).
   - The batch locks `professional` (`claims.ts:1023`) and guards the time zone (`claims.ts:1025`).
   - It reclaims lapsed holds before inserting (`claims.ts:1030-1031`), then re-asserts type, event séances, time off,
     notice and horizon under the lock (`claims.ts:1048-1049`, `rdvSlotFree` at `claims.ts:928-942`).
   - What the engine does not do: enforce the slot grid. That is P5's job (`claims.ts:949`, CON:2306, OUT:76).
2. **The back office is done.** P3 delivered:
   - RDV config: duration, buffers, « Gratuit », own hours, overrides and questions (`src/app/dashboard/tickets/[id]/page.tsx:109-140`);
   - the global hours page (`src/app/dashboard/availability/page.tsx:9-29`);
   - RDVs in the planning, with phantoms dropped (`src/lib/back-office/planning-reads.ts:308-310, 361`);
   - cancel and unenrol (`src/components/dashboard/occurrence-dialog.tsx:516-526`);
   - KPI, clients and payments (`src/lib/back-office/dashboard-reads.ts:99-133`);
   - the time-zone lock counting RDVs (`src/lib/back-office/settings-actions.ts:45-51`).
3. **The P4 money and identity plumbing is generic.** Webhook, `fulfillPurchase`, `releasePurchase`,
   `abandonCheckoutCore`, `merci`, the espace and `/mon-espace` all handle an RDV purchase or booking. Only two things are
   séance-shaped: the URLs (`cancelPathOf`, `mockCancelPath`, `returnHref`, the hold storage keys) and the wording.
4. **What P5 builds:**
   - the slot generator (pure) and the slot loader (DB);
   - the `bookRdv` public action, which re-runs the grid on the server;
   - the RDV page and its client component;
   - the RDV cards on `/[slug]`;
   - the RDV checkout target and the RDV wording;
   - the carries (engine `else throw`, Checkout facts, the FR:F9 pro half, the test gaps);
   - the « tests EXCLUDE dans l'UI ».
5. **No migration is needed.** Every column and index exists: `occurrence_pro_starts_idx` (`src/lib/db/schema.ts:491`),
   the EXCLUDE's partial gist index, `time_off_pro_idx` (`schema.ts:222`) and `ticket_type.position` (`schema.ts:243`).

---

## 1. Scope: every spec requirement P5 touches

The R-numbers are those of `p5-spec.md`. The « Exists » column is checked code. Risk classes are S (security or tenancy),
A (abuse), T (time zone or DST), M (money or holds) and C (copy or a11y). The task column points at § 5.

### 1.A Product decisions

| R | Spec | Exists | Gap P5 fills | Risk | Task |
|---|---|---|---|---|---|
| R1 | L44-49: a ticket's use (b) is « un RDV libre de son type » | `ELIGIBLE` RDV clause, `src/lib/booking/eligibility.ts:21` | An RDV-type read of the Owner's usable tickets at a future start: `usableTickets` needs an occurrence (`eligibility.ts:81-99`), and `walletBalance` counts "valid at now" (`src/lib/booking/wallet.ts:213`) | S: Owner only. T: expiry vs `startsAt`, not vs `now` | T7, T12 |
| R2 | L86-91: the « Disponibilités » page is kept; « calculés comme aujourd'hui »; only booked RDVs show in the planning; séances **bloquent** RDV slots | Hours: P3 (`src/app/dashboard/availability/page.tsx:9-29`). Planning: P3 (`planning-reads.ts:361`). Séance blocking: engine (`claims.ts:932-934`) | The slot generator (`src/lib/availability.ts:51-134` is the dead v1) and the loader (`src/lib/slots.ts` is missing, deleted in `c1ad386`) | T, S | T3, T6 |
| R3 | L92-94: Planning block = séances + RDV cards; automatic detection | `/[slug]` renders the planning and the Boutique only (`src/app/[slug]/page.tsx:127-145`) | RDV cards, deferred by P4 Decision 48 (P4CON:1391) | C | T13 |
| R4 | L63-66, L892: buy and book in one step; the place is held during payment, with an expiry | Engine `buy` branch (`claims.ts:1065-1077`): 45 min hold (`src/lib/tickets-vocab.ts:170`), 31 min Checkout (`:172`) | The action core with Checkout create and attach (P4 pattern `src/lib/public/booking-actions.ts:178-218`) and the RDV cancel URL | M, A | T8, T9 |
| R5 | L67-76: no account; spending needs e-mail proof; auto-detection; personal link | `resolveVisitor` `owner` (`src/lib/public/identity.ts:72-112`); P4 Decision 4 replaced `requireWalletOwner` | `held_ticket` for an Owner of this pro only, like `bookWithHeldTicketCore` (`booking-actions.ts:476-477`) | S (OUT:75) | T9 |
| R6 | L77-83: client cancels until X h before; no money refund | E5 handles RDV: `SEAT(o, 0)` cancels the RDV (`src/lib/booking/cancel.ts:138-193`; `src/lib/db/atomic.ts:179-180`); deadline coalesce with `rdv_cancel_deadline_hours` (`src/lib/notify-core.ts:117`) | None (generic). Missing test: the RDV-type override coalesce (OUT:121) | M | T4 |
| R7 | L84-85, L893-894: valid « à la date de la séance » = the slot start | Eligibility: `expires_at > o.starts_at` (`eligibility.ts:17`). Buy: `offerCovers(now, validity, tz, startsAt)` (`claims.ts:997`) | Per-slot « utilisable ici » and the covering offers on the page, computed without the browser clock | T | T7, T12 |
| R8, R77 | L99-100, L627-629: an RDV-enabled type is never orange | `loadTypeFacts` gives `rdvEnabled && !rdvFree` (`src/lib/booking/wallet.ts:761`) | Any new SQL (cards, owner tickets) uses `rdv_enabled and not rdv_free` (P3OUT:108) | C | T7, T13 |
| R9, R14 | L105-109, L208-211: horizon, notice and cancel deadline, overridable per RDV type | Columns (`schema.ts:187-197, 249-251`); `effectiveWindow` (`src/lib/booking-window.ts:14-20`) | The loader uses the effective window (type override, else the pro's) | T | T3, T6 |
| R10 | L113-122: 1 booking = 1 place = 1 ticket; consumption order; RDV questions on the type; one e-mail per booking; Google gets each RDV; no 0 € offer | Engine and P3 (`claims.ts:1052-1062`; `src/lib/booking/answers.ts:25`; `src/lib/calendar-sync-core.ts:40-42`) | Render the type's questions on the RDV page (reuse `src/components/public/question-fields.tsx`) | C | T12 |
| R11 | L124-126: free RDV = « Gratuit » on an RDV type; no ticket, no payment | Engine `free` branch (`claims.ts:1063-1064`); P3 « Gratuit » switch (`src/components/dashboard/ticket-type-editor.tsx:245-255`) | The `free` mode on the page and in the action | A: calendar filling by typed addresses | T9, T12 |
| R12 | L191, L198-199, L185-187: vocabulary; labels live in `tickets.ts` / `tickets-vocab.ts` | `ENGINE_ERROR_MESSAGES` is worded for a séance (`tickets-vocab.ts:242-261` area: « Cette séance n'est plus ouverte… ») | An `rdv` client context (`src/lib/public/messages.ts:9` has none) | C | T2 |
| R13 | L128-144: out of scope: several places, staff, reminders, ticket choice, tz change while planned | — | Nothing; keep these out | — | — |

### 1.B Data model and engine (P2, consumed)

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R15 | L269-279: RDV columns and CHECKs | `schema.ts:244-269`; zod `src/lib/tickets.ts:76-106` | None | — | — |
| R16 | L288-292: per-type rules REPLACE the global ones | `rdvRules` (`claims.ts:897-914`, not exported); the P3 cores merge ranges (`src/lib/back-office/week-hours.ts:55-67`); the engine and seed writers do not merge (`src/lib/booking/catalog.ts:270-305`; `scripts/content/apply-catalog.ts:54, 76`) | The loader must use the SAME resolution. Export the reader, never re-implement it | Drift: loader and plan disagree → `unavailable` | T4, T6 |
| R17 | L307-310, L896: RDV questions; required answers enforced for the client | `loadQuestions({ticketTypeId})` and `buildAnswers(..., {enforceRequired: true})` (`claims.ts:989, 1000-1001`) | `parseFr` the answers' shape first (P3OUT:106); import `BOOLEAN_ANSWERS` (P3OUT:116) | C | T9, T12 |
| R18-R19 | L312-329, L394-412: RDV = an `occurrence` row; EXCLUDE on `tstzrange(block_start, block_end)` | `schema.ts:465-507`; `drizzle/0012_tickets_manual.sql:2-6`; S5 PASS (L747) | Prove it in the UI (R86) | S | T9 |
| R20 | L471-478: a booking inserts the RDV; cancel or expiry → `cancelled`; slots per requested window (shown week); occupied iff confirmed, or pending with `hold_expires_at > now` | Engine insert (`claims.ts:1032-1047`); `releaseEndedSeats` (`atomic.ts:213-222`); the lapse test is `hold_expires_at < now` (`src/lib/booking/holds.ts:55`) | The loader's occupancy predicate. Use the ENGINE boundary (`< now` = lapsed), not the spec's `> now`: at exact equality the batch would still see the hold and raise `slot_taken` (1 ms window; P3OUT:151 notes the same split) | M | T6 |
| R21-R22 | L716-733, L672-677: SEAT, RET, lock order; only E4 and E6c take the pro lock | `atomic.ts:172-183`; `claims.ts:1023`; `cancel.ts:456` | None | — | — |
| R23 | L667-670: one injected `now` | Engine `now` parameter; `runPublicActionWith` takes one `now` (`src/lib/public/run-action.ts:87-95`) | The loader re-run and the engine call must share the action's `now` | T | T9 |
| R24 | L700-714: error mapping; 23P01 `occurrence_rdv_excl` → `slot_taken` | `src/lib/db/map-db-error.ts:38-41` | Not reachable from E4: `already_booked`, `full`, `changed` (new occurrence id; no SEAT); the contract still lists `already_booked` for E4 (CON:3041). `stale` = tz changed, offer changed, or FK 23503 | C | T2, T9 |
| R25 | L587-600: eligibility for an RDV, consumption order, SKIP LOCKED | `eligibility.ts:15-23`; `assertSpent` → `no_ticket` (`eligibility.ts:76-78`) | Mutation tests for the RDV clause (OUT:112) | S | T4 |
| R26 | L602-607, L893-894: an offer is proposed only if `ticketExpiry(now, offre) > starts_at` | Engine plan `offer_too_short` (`claims.ts:997`) | Per-slot offer list on the page. The server passes each offer's `coversUntil` (`ticketExpiry(now, …)`); the client compares ISO strings, so no browser clock is involved | T, M | T7, T12 |
| R27 | L841-844, L355: coverage `ticket` / `free` / `guest` (pro only) | `booking_free_chk` (`schema.ts:614`) | None (`guest` needs a pro path, O9) | — | — |
| R28 | L1626-1636: I1, I5 (RDV `scheduled` ⇔ `seats_taken = 1`) after every DB test | `src/test/db.ts:89-101`; I5b (`src/lib/booking/invariants.ts:79-83`) | Keep every P5 DB test inside `dbTest`; create RDVs through `bookRdv`, never through `rowRdv` (OUT:110: `rowRdv` sets `seatsTaken` 1 without a booking) | — | T4, T6, T9 |

### 1.C Slot computation (the core of P5)

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R29 | L455-462: effective window; bookable when `now + préavis ≤ starts_at` and local date ≤ today + horizon | `onlineBookability` checks notice BEFORE horizon (`booking-window.ts:30-40`); SQL twin `claims.ts:939-941` | The loader bounds its dates by the horizon first (structural), so OUT:106 never shows on RDV | T | T3 |
| R30 | L869-877: E4 pre-read: `startAt` is one of `computeSlots`' slots (type rules else global; occupied = time off, every scheduled event séance incl. private, `none` and empty ones, occupied RDVs; type buffers; window) | Engine plan: `fitsAvailability` + `onlineBookability` only (`claims.ts:984-992`). No grid | Grid membership in the action, exact ms, same generator (G1 of `p5-engine.md`) | **S**: an off-grid start (10:07, 19:00:30) passes `fitsAvailability` because `wallClockMinutes` floors seconds (`src/lib/datetime.ts:206-209`; OUT:76) and steals the next grid slot through the EXCLUDE | T3, T9 |
| R31 | L559, L1498-1499: `computeSlots` moves to the local-date loop, adds séance blocking, buffers, notice and horizon, and drops the seat logic | `availability.ts:51-134` has the P0 local-date loop but a **wall-clock end** (`:91-97`), raw session start/end with no blocks (`:110-116`), seat logic (`:118-124`), `daysAhead = 21` and no horizon (`:61`). No runtime importer (OUT:94) | Rewrite in place (the spec name is kept). End = start + duration in elapsed ms (L501-502; `claims.ts:981`) | T: the wall-clock end is 2 h on 2026-10-25 and 0 min on 2026-03-29 (§ 3.4) | T3 |
| R32 | L161-164, L500-507: `instantFromWallClock`; iterate by local date; gap → forward; overlap → first instant | `src/lib/datetime.ts:106-125`; `src/lib/civil-date.ts:134-137` (`instantAt`) | Keep the `seen` dedupe (gap duplicates, `availability.ts:89`) and filter by `fitsAvailability` (drops gap slots that overrun the rule) | T | T3 |
| R33 | L475-482: per requested window (shown week), capped by the horizon; week bounds by local dates | `src/lib/planning.ts:15-44` (`weekStartFromParam`, `weekBounds`, `paramForWeek`); `src/lib/public/planning-view.ts:151-155` (`parsePlanningParams`) | A week window for the RDV page with a `?semaine=` parameter (O15) | T, A (render cost bounded by 7 days) | T6, T11 |
| R34 | L1501, L1745: `slots.ts` = the RDV slot loader, P5 rewrites it | Missing (P2 deleted it, CON:3139) | `src/lib/slots.ts` (DB core, takes `db`) | S (pro-scoped reads) | T6 |
| R35 | L1268-1273: `rdv` 20/h per IP, 6/h per e-mail, hashed IP | `THROTTLE_LIMITS.rdv` = `{ ip: 20, ip48: 60, email: 6, emailGlobal: 20, perOccurrenceIp: null, perProIp: null }` (`tickets-vocab.ts:201`). « P5 decides its seat key » (P4CON:370; P4PLAN:2372) | Decide the seat key (O22) and update the pins | A | T2 |

### 1.D Write path E4

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R36 | L879-896: the E4 batch and its three branches | `claims.ts:1016-1081`. **No `else throw`** after `else if (buy && purchaseId && checkoutExpiresAt)` (`claims.ts:1065`) | Add `else throw` (OUT:120) | M: a fall-through would commit an RDV with no booking (I5 then fails) | T4 |
| R37 | L799-804: buy = G(offer), `too_many_holds` (< 2), purchase pending 31 min, booking pending 45 min | `claims.ts:1066-1077`; `assertHoldQuota` (`holds.ts:34-42`) | `BookRdvData` lacks currency, label, quantity and type name for the Checkout request (`claims.ts:843-849`; OUT:76) | M | T4 |
| R38 | L780-792: `buildAnswers`, throttle, honeypot, then `upsertCustomer` (name never overwritten; `user_id` only for a verified same e-mail) | P4 core order (`booking-actions.ts:229-278`); the SQL guard in `upsertCustomer` (P4 Decision 6, P4OUT:21) | Same order in `bookRdvCore`, plus the grid read before the first write | S | T9 |
| R39-R40 | L898-902, L1840: same slot = EXCLUDE; RDV vs time off = pro lock; event created at the same instant = tolerated and warned | T6a/T6b (`src/lib/booking/rdv.db.test.ts:92-111`); T6c (`src/lib/booking/time-off.db.test.ts:26`); `countRdvConflicts` (`src/lib/back-office/event-reads.ts:471-490`) | `countRdvConflicts` counts phantom RDVs (no hold filter, `event-reads.ts:483-488`) | C (a false « conflit ») | T13 |

### 1.E Public pages and flows

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R41 | L1438-1444: `/[slug]` = Planning, RDV cards, Boutique, wallet | `src/app/[slug]/page.tsx:127-145` | Cards (Decision 48 deferred them) | C | T13 |
| R42 | L1456-1457: `/[slug]/rdv/[ticketTypeId]` reuses `day-calendar` and the identity form; archived or not `rdv_enabled` → `notFound()` | `IdentityFields` (`src/components/public/identity-fields.tsx:16-90`); `DayCalendar` (month grid, used only by the landing hero and the demo: `src/components/hero-cards.tsx:8`, `src/components/demo/screens/client-booking.tsx:8`) | The page, `loading.tsx` and the `rdv-booking` component (L1519). Ruling on `day-calendar` in O15 | S (404 parity), C | T11, T12 |
| R43 | L1700, L867: three modes, « ticket, achat, gratuit » | Engine | Page modes mirror `TicketsBooking` (`src/components/public/occurrence-booking.tsx:468-487`): Owner who can spend → held form; else « J'ai déjà des tickets » (anonymous) or the confirm hint (unverified), plus the buy form | S | T12 |
| R44 | L1348-1360: detection on RDV pages; owner banner; « Réserver avec 1 ticket (il vous en restera N) »; `OtpDialog` | `heldTicketLabel` (`messages.ts:151-153`); `OtpDialog` (`src/components/auth/otp-dialog.tsx:24-36`); `canOfferCodeSignIn` (`src/lib/public/sign-in-flow.ts:71`) | Wire them on the RDV page with `returnTo=/{slug}/rdv/{id}` | S (`returnTo` never carries `p`) | T11, T12 |
| R45 | L1341-1346, L827: authorisation to spend | `owner` rule (`identity.ts:95-99`); `linkCustomerUser` (`identity.ts:119-133`) | `held_ticket` → `owner.customerId` and `owner.userId` only | **S** | T9 |
| R46 | L1362-1372: personal link | P4 (cookie via a same-origin confirmation page, P4 Decision 68) | None. A guest cookie never spends (P4 Decision 63) | S | T9 |
| R47 | L1453: séance URL of an RDV occurrence → `/<slug>/espace` | `src/app/[slug]/seance/[occurrenceId]/page.tsx:84`; proven only by a read until now (P4CON:1593) | A browser check once RDVs exist | — | T14 |
| R48 | L1460-1461, L811: `merci` real states; reference belongs to the slug | `src/app/[slug]/merci/page.tsx:37-78`; `merciStateOf` is generic | RDV copy: `merciCopy` says « Inscription confirmée » / « inscrit(e) » (`src/lib/public/merci-view.ts:46-50`) | C | T10 |
| R49 | L1374-1390: `/mon-espace` and `/[slug]/espace` list RDVs; cancel (E5) and spend (E2) | `getCustomerSpace` renders RDV rows (`src/lib/back-office/customer-space.ts:72, 113-115`). Spend list = event séances only (`src/lib/public/spendable.ts:70-71`) | Espace: a ticket of an RDV type links to its RDV page. Defence in depth: the `event` and `ticketType` joins of `customer-space.ts:119-120` are not pro-filtered (the P4CON:1906 fix of `purchase-reads` is not applied here) | S | T7, T13 |
| R50 | L490-496: the public planning shows event séances only | `innerJoin(event, …)` (`src/lib/public/planning-reads.ts:201, 220`) | None: other people's RDVs never list | S (residual: busy times, private séances included, are visible as missing slots; accepted, L873-874) | — |
| R51 | L1615: « Aucun créneau cette semaine » + semaine suivante | — | Empty state and next-week link, capped by the horizon | C | T11 |
| R52 | L1618: below 640 px the public planning is a list per day | P4 Decision 46 (P4OUT:33) | The RDV week becomes a list per day below 640 px | C | T12 |
| R53 | L1793-1794: « Paiements en mode test » on purchase pages | `TestPaymentsBanner` (`src/app/[slug]/page.tsx:141`) | Show it on the RDV page when the buy mode can appear | C | T11 |
| R54 | L1463: `/book/[id]` and `/pack/[id]` → `/[slug]` | `next.config.ts:42-48`; the pages call `permanentRedirect` | None (O29) | — | — |

### 1.F Payments

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R55 | L806-815, L1846: Checkout after commit, 31 min, card only, `success_url = /[slug]/merci?p=`, `cancel_url = /[slug]/seance/[o]?…`; release at once on a Stripe failure; mock route | `checkoutUrls`/`cancelPathOf` with kinds `buybook \| shop` (`src/lib/payments/checkout.ts:17, 71-92`); `createCheckoutAndAttach` (`booking-actions.ts:178-218`); `mockCancelPath` (`src/lib/payments/mock-checkout.ts:31-42`) | An `rdv` target: cancel → `/{slug}/rdv/{ticketTypeId}?paiement=annule&p=…`. A séance cancel URL for an RDV redirects to `/espace` and **loses `?p=`** (seance page `:84`). `mockCancelPath` sends every occurrence to `seance/` | M | T8 |
| R56 | L1106-1137: fulfilment; never resurrect; ticket no. 1 booked; late payment | `fulfillPurchase` confirms a still-pending booking, including an elapsed but unswept RDV hold (`src/lib/booking/fulfillment.ts:186-189`); effects `fulfillment.ts:206-216` | Late-payment wording « La séance … » (`src/lib/emails/late-payment.ts:33-34`) | M, C | T10 |
| R57 | L1151-1179: `releasePurchase`, abandon page, « Libérer ma place », `sweepHolds` | `src/lib/booking/release.ts:36-72, 74-102`; `abandonCheckoutCore` is generic (`src/lib/public/release-actions.ts:36-97`) | No RDV release DB test (OUT:118). `referenceForPage` lacks an `rdv` page kind (`src/lib/public/visibility.ts:31-53`) | M | T4, T7 |
| R58 | L285-286, L1853: no 0 € offer; free RDV only through `rdv_free` | `ticket_offer_price_chk`; `offerUnchanged` refuses a free type (`claims.ts:189`) | The FR:F9 pro half (P4OUT:96) | M | T5 |

### 1.G Cancellation and pro actions

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R59 | L904-924: E5 on an RDV | `cancel.ts:138-193`; test `src/lib/booking/cancel.db.test.ts:204-224` | DB test of the `rdv_cancel_deadline_hours` coalesce (OUT:121) | — | T4 |
| R60 | L928-934: E6a | `cancel.ts:202-252` | None | — | — |
| R61-R62 | L947, L977, L1086: no restore, no move of an RDV; « annuler et réinscrire » | `cancel.ts:330-334`; `RDV_NOT_MOVABLE` (`src/lib/back-office/planning-actions.ts:56`; engine twin `src/lib/booking/series.ts:141`) | The copy promises « en le réservant à nouveau », but no pro path books an RDV (`REGISTER_RDV`, `planning-actions.ts:464`). Reword (O9) | C | T10 |
| R63 | L957-968, L1673: E6c covers RDVs, serialised | `cancel.ts:361-364, 453-456`; P3 conflict copy (`src/lib/back-office/confirm-copy.ts:227-279`) | « ticket rendu » even for a free RDV (LED:309) | C | T10 |
| R64 | L825-853: the pro path ignores notice and horizon; « +1 place » for event séances only | `registerPro` handles event séances only (CON:2307) | No pro RDV creation (O9) | — | — |

### 1.H E-mails, Google, ICS

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R65 | L1528-1545: confirmation for every booking (date, lieu, couverture, tickets left, deadline, link, ICS, Google, Outlook); pro notice only when the client books | `confirmedEffects` (`claims.ts:556-561, 1088`); templates are worded for a séance: label « Séance » (`src/lib/emails/booking-confirmed.ts:55`), « Nouvelle inscription » (`src/lib/emails/pro-new-booking.ts:23-31`) | RDV wording through an `isRdv` fact from `notify-core` (title coalesce at `notify-core.ts:112`) | C; S (`escapeHtml` on every value) | T10 |
| R66 | L1546-1556: a Google event for each RDV | `calendar-sync-core.ts:40-42`; RDV title and summary (`src/lib/calendar-sync-load.ts:62-71`) | None | — | — |
| R67 | L1471: ICS « titre de l'événement ou du type, lieu effectif » | `src/app/api/bookings/[id]/calendar.ics/route.ts:20-38` (RDV-aware) | None (filename `seance.ics` is a constant, `:36`; optional) | — | — |
| R68 | L696-698: side effects after commit, best effort | `runPublicAction` with budget `"none"` (P4OUT:95) | Keep it (`bookRdvAction` through `runPublicAction`) | A (mail quota) | T9 |

### 1.I Back office (mostly P3)

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R69-R71 | L1408, L1412-1413, L1599 | P3 (see `p5-backoffice.md` § 1.1-1.6) | The type page has no link to the public RDV page and no « non réservable » state (`tickets/[id]/page.tsx:109-140`) | C | T13 |
| R72 | L1406, L483-489: the planning shows booked RDVs | `planning-reads.ts:312-362` (phantoms dropped); buffers not drawn (`src/components/dashboard/planning-calendar.tsx:80-111`); « Lieu non précisé » on every RDV (`occurrence-dialog.tsx:239-241`) | Hide the place row for an RDV | C | T10 |
| R73 | L1407, L902: « conflit avec N RDV » | Schedule and new-event previews only (`src/lib/back-office/event-actions.ts:335, 490`); copy at `src/components/dashboard/recurrence-editor.tsx:527` | Phantom filter in `countRdvConflicts` | C | T13 |
| R74-R76, R79-R80 | L1419-1431, L635-637, L1565-1572, L513-514 | Client rows (`src/lib/back-office/client-reads.ts:326-351`); KPI « Séances et rendez-vous (7 j) » (`src/lib/back-office/dashboard-view.ts:52`); admin title coalesce (`src/lib/admin-reads.ts:119`); « Utilisé le » (`src/lib/back-office/wallet-view.ts:121`) | None | — | — |
| R78 | L509-511: time-zone lock | `timezoneLockedSql` counts future scheduled occurrences, RDVs included (`settings-actions.ts:45-51`) | None (O13 answered by code) | T | — |

### 1.J-M Nightly job, tests, seed, UI rules

| R | Spec | Exists | Gap | Risk | Task |
|---|---|---|---|---|---|
| R81 | L1181-1199: `sweepHolds` cancels RDVs at 0; invariants | `release.ts:74-102`; `src/lib/booking/nightly.ts:166-168, 187` | None. Correctness never waits for the job (`claims.ts:1030`) | — | — |
| R82 | L1638-1651: pure tests, including « `computeSlots` : heure d'été, blocage par les séances, marges, RDV occupés » (L1646) | Old tests `src/lib/availability.test.ts:112-141` (DST) and `:57-110` (seat model, obsolete) | Rewrite them; Paris AND Los Angeles; host-zone independence through PowerShell `$env:TZ` (P4PLAN:48) | T | T3 |
| R83-R85 | L1673, L1811, L747: T6, and « T6 échoue si l'EXCLUDE disparaît » | `rdv.db.test.ts:92-111`; `time-off.db.test.ts:26` | Test gaps of OUT:120 | — | T4 |
| R86 | L1700: « tests EXCLUDE dans l'UI » | — | Defined in O1 | S | T9, T14 |
| R87 | L1758-1762, L1777: seed with RDV types | `scripts/content/altinha.ts:131-158`; RDV bookings `scripts/seed.ts:254-268` (held, 11:00 on the 10:00 grid) and `:351-365` (free, 12:00) | None (both on the grid; O19) | — | — |
| R88-R90 | L1601-1605, L1621-1622, L175-181, L148-150 | P4 rules (P4PLAN:14-50) | Same `parseFr` schema client and server; the cancel `ConfirmDialog` is generic (espace); `design-taste-frontend` before UI; `router.push` alone after an action | C | T12 |

---

## 2. Carries to P5, verbatim, with their absorber

Status is at `281f64b`. « → » names the requirement and the task (§ 5) that absorbs the carry.

### 2.1 P2 outcome and contract

- **OUT:76** « - Task 24: carry to P5 (RDV slot loader + action): the engine doesn't enforce the slot grid (P5 action must re-run the server slot loader for the submitted start; fitsAvailability floors seconds, so 19:00:30 + 60 min passes a 20:00 limit); the old computeSlots computes ends on the wall clock and compares raw start/end - the P5 loader must use elapsed ms and block_start/block_end (buffers add up) or it offers slots the engine refuses (slot_taken); BookRdvData lacks currency/label/quantity/ticketTypeName (extra read for Checkout); a same-customer double submit gets slot_taken - treat slot_taken on a slot where this customer holds a live hold as « Reprendre le paiement ». »
  - Grid → R30, T9.
  - Elapsed ms and blocks → R31, T3 and T6.
  - Checkout facts → R37, T4 (taken from the planned offer row, not from an extra read; see § 3.15).
  - Resume → O6, T9 and T12, narrowed by P4 Decisions 64 and 71.
- **OUT:120** « - Task 24: minor (deferred): rdv tests don't cover notice/horizon (incl. type overrides), afterPlan staging of G(rdvTypeOk)/G(rdvSlotFree) under the lock, per-type hours (rdvRules), DST day, buffers vs time off / event seance, buy-mode too_many_holds/offer_too_short/stale; buy branch `else if (buy && purchaseId && checkoutExpiresAt)` should end with else throw (a fall-through would commit an RDV with no booking). »
  - → R36 and R83, T4. Still open: `claims.ts:1065-1078` has no `else`.
- **OUT:106** « - Task 10: minor (deferred): onlineBookability checks notice before horizon, so with notice > horizon a séance beyond the horizon shows "Réservations fermées" instead of hidden (check horizon first or reject notice > horizon in settings); doc comments imprecise; untested boundaries (changed_at == created_at, notice 0 at now, expiry across spring change, moved_at before deadline); validityOf treats a half-set snapshot as never-expiring (fail closed instead). »
  - → R29. On RDV, T3 iterates dates only up to the horizon, so the RDV path is structurally horizon-first.
  - The séance listing already obeys P4 Decision 10 (P4CON:1353). `onlineBookability` stays as is (Q-O14).
  - The untested boundary « notice 0 at now » goes to the T3 tests.
- **OUT:94** « - Task 2: minor (deferred): modules left with no runtime importer (availability.ts, planning.ts, calendar-links.ts, calendar-sync-core.ts, mock-redirect.ts, mergeMoney, planning-calendar, week-preview) — P3-P5 reconnect or delete each. »
  - → T3 rewrites `availability.ts` and T6 imports it.
  - `groupSlotsByDay` (`availability.ts:137-149`) and the seat types go away. P3 kept the file « for P4 / P5 » (P3CON:1970).
- **OUT:75** « - Task 23: carry to P4 (SECURITY): bookWithHeldTicket's customerId/actorUserId must come from requireWalletOwner(proId) (OTP / Google / password session), NEVER from upsertCustomer - a P4 action wired like E1 would let anyone spend anyone's tickets by typing their e-mail; ClientClaimBase.customerId doc says « from upsertCustomer (or the verified wallet owner) » - fix that doc and consider actorUserId: string; registerPro's professionalId/actorUserId from requirePro (engine doesn't check actor belongs to pro); remap registerPro's client-worded errors (not_eligible on a none-mode seance, already_booked « Vous êtes déjà inscrit(e) ») in the pro UI. »
  - → R45, T9. The same rule is written on `BookRdvInput.customerId` (`claims.ts:831-836`); `actorUserId` stays `string | null` there (`claims.ts:840`).
- **OUT:108** « - Task 12: minor (deferred): rdv_free types are rdv_enabled (CHECK) so classifyTypes never flags them orange, yet tickets of an rdv_free type are usable nowhere (eligibility excludes rdv_free) - P3 UI should not offer "Offrir"/offers on rdv_free types (or classify them orange); JS id tie-break vs SQL collation order may differ (interchangeable tickets, no impact); no test for expiry strictly in the past. »
  - → R58. P3 and P4 took the UI and client halves. The engine pro half is T5.
- **OUT:110** (excerpt, the RDV part) « rows.ts footguns (rowRdv seatsTaken 1 w/o booking, rowSeance seriesDate from UTC date, rowTicket booked w/o bookingId, rowRdvType no now) »
  - → R28. A P5 rule for T4, T6 and T9: RDV fixtures go through `bookRdv`.
- **OUT:112** (excerpt) « eligibility mutation gaps (o.ticket_type_id = t.ticket_type_id for paid RDV types, tt.rdv_enabled, t.professional_id = o.professional_id, past seance with expiry between seance and now, created_at tie-break ~50%, quota/expire tests single customer/event) »
  - → R25, T4: the RDV-clause mutations, i.e. a ticket of another type, of a type no longer `rdv_enabled`, of an `rdv_free` type, and of another pro.
- **OUT:118** (excerpt) « no test releases a paid buy+book purchase (confirmed booking keeps its seat, released false) nor stages release-vs-payment (no afterPlan); no RDV release test; … sweepHolds returns no google.sync effects unlike releasePurchase; … »
  - → R57: T4 (RDV release) and T9 (a Stripe failure releases the RDV).
- **OUT:121** (excerpt) « tests: no DB test of the event / RDV-type cancel-deadline overrides (coalesce order), boundary at +-1 h not +-1 min, restore of a cancelled RDV, E5 on a pending buy+book, cross-pro professionalId, E6b on an RDV or with a pending purchase »
  - → R59 and R61, T4.
- **OUT:122** (tail) « … preview lists RDVs by starts/ends but matches on the buffered block (UI should explain). »
  - Done by P3: « Un rendez-vous compte avec ses marges avant et après. » (`confirm-copy.ts:227-279`). No P5 work.
- **OUT:27** (tail) « … cost if wrong: none for correctness (no engine action relies on FK checks blocking; the EXCLUDE stays the RDV backstop). »
  - Informational. T9's EXCLUDE-in-the-UI test is the proof.
- **CON:3** (erratum) « §6 E4: the « buy » path also locks the customer (after the RDV occurrences), and `activeBookingOf` takes `now`. »
  - Informational for T4: lock order at `claims.ts:1023-1028`.
- **CON:2306** « **E4 slot-grid membership** (`startsAt ∈ computeSlots`) is the P5 action's job, since slot loading is P5. The engine re-asserts everything the DB can check, plus `fitsAvailability` (type rules, else global rules) in the plan. »
  - → R30, T9.
- **CON:3139** « | `src/lib/slots.ts` | delete | no consumer left | P5 recreates | »
  - → R34, T6.

### 2.2 P3 outcome, ledger, final review and contract

- **P3OUT:23** (excerpt) « F10 merges overlapping and touching hour ranges of a day into one (instead of refusing them) so an RDV can span them »
  - → R16, done by P3. T3 keeps the dedupe, because the seed and the engine writers do not merge. T6 tests touching rules stored unmerged.
- **P3OUT:90** « - **[P4]** F9 and the other rdv_free guards that are reads outside the engine batch: `catalog-actions.ts` checks `rdv_free` before the batch for the offer create, offer-tickets and convert paths (Task 32: a type switched to « Gratuit » in another tab in the same milliseconds could receive tickets; the engine never checks `rdv_free`), and Task 10 asks to add `not tt.rdv_free` to the shop branch of `offerUnchanged` (`claims.ts`) so a concurrent create-offer and switch-to-free cannot sell tickets on a free type. Fix as the review proposed: `G(not (select rdv_free from ticket_type where id = $t), 'stale')` on the engine statements that create offers en vente, offer or convert tickets and convert on move, and the F2-narrowed `readFreeBlockers` predicate as a G in `updateTicketType` when `rdv_free` goes from false to true. Race window of milliseconds between two tabs of the same pro. Related, accepted in F2: the pro can still cancel a past booking (E6a) or move an attendee, which hands a ticket back as available on a free type. »
  - → T5. P4 took the `offerUnchanged` half (`claims.ts:189`). The rest is open: `updateTicketType` has no such guard (`src/lib/booking/catalog.ts:94-109`).
- **P3OUT:106** « - **[P4, P5]** Every new core (public actions, RDV libre) must pre-validate with `parseFr` before calling the engine: `proErrorMessage` returns the engine's own message verbatim and the engine builds some from a plain `safeParse`, which is English for built-in zod checks (Task 2, contract Decision 6). »
  - → R38, T9.
- **P3OUT:107** « - **[P4, P5]** A per-event or per-type notice override that exceeds a horizon lowered later makes that séance or type never bookable online with no warning (Task 29 deferred it to P4/P5). The final pass (F4, COV-6) now refuses a global-settings change that would close a type or event window, but that check is a read before the batch (a type edited in the same instant could slip) and `onlineBookability` still checks the notice before the horizon (P2 Task 10 minor). »
  - → O14. T6 flags `neverBookable`; T13 shows the back-office warning and hides the card.
- **P3OUT:108** « - **[P4, P5]** Any new SQL orange-alert computation must treat `rdv_free` as NOT rdv-enabled (`loadTypeFacts`; eligibility uses `rdv_enabled and not rdv_free`), as the P3 reads do (Task 9). »
  - → T7 and T13: owner tickets and cards. P5 adds no orange-alert SQL.
- **P3OUT:114** « - **[P5]** `bookRdv`'s new `stale` (the time-zone guard added in Task 7) goes straight back with no `replanOnStale`: the P5 booking action must surface or retry it. »
  - → O25, T9: surface it, no retry.
- **P3OUT:115** « - **[P5]** Widen the ui-copy scan (it checks for dashes and similar copy rules) with an allowlist: it does not cover `components/{ui,auth,support}`, `lib/*` generally, `layout.tsx`, `.sql` and `.css`, and its line 28 comment is stale (Task 43). Em dashes may still hide there (see the P6 copy pass). »
  - → T1. P4 already covers `src/app/layout.tsx` and the P4 files (`src/lib/ui-copy.test.ts:34-98`).
- **P3OUT:116** « - **[P5]** `BOOLEAN_ANSWERS` now lives in `src/lib/tickets-vocab.ts` and is imported by `answers.ts` and the register dialog; P5 must import it rather than add a third copy (Task 27). »
  - → T12: reuse `question-fields.tsx`, which already imports it (`:7, :42`).
- **P3OUT:151** (excerpt) « `holdLapsed` uses `<= now` while `elapsedHolds` uses `< now` (a one-millisecond disagreement); … the elapsed-hold rule is written 3 times (`holds.ts`, `event-reads.ts`, `planning-reads.ts`). »
  - → R20, T6: the loader uses one exported SQL fragment with the engine's `<` and adds no fourth copy.
- **LED:100** « Task 7: Ruling: extend the tz guard to bookRdv (G(tz = planned, 'stale') after its professional lock, DB test) - why: same race as createEvent (an RDV fitted to the old zone if the zone changes between plan and batch); Task 7 owns the tz guard - cost if wrong: one extra statement per RDV booking. »
  - Done (`claims.ts:1025`; test `rdv.db.test.ts:226-242`). Informational.
- **LED:106** « Task 7: minor (deferred): wrong-case IANA links (America/MONTREAL, US/EASTERN) still pass isValidTimeZone (docblock/test title overstate case-exactness; low impact); carry (P5): bookRdv's new 'stale' goes straight back (no replanOnStale) - the P5 booking action must surface or retry it. »
  - → T9 (same as P3OUT:114).
- **LED:124** « Task 9: carry (Tasks 31, 37 and any SQL orange-alert computation): rdv_free counts as NOT rdv-enabled (loadTypeFacts; eligibility uses rdv_enabled and not rdv_free) - mirror it in SQL. »
  - → T7 and T13.
- **LED:296** « Task 27: Ruling: fix round 1 = « est inscrit(e) » (codebase habit), BOOLEAN_ANSWERS moved to tickets-vocab.ts and imported by answers.ts and the dialog (one source before P5 adds a third copy), neutral loading text, aria-describedby from the disabled « Inscrire » to its help, an always-mounted search status region, newClientProblems extracted to a pure module with a test - why: one-liners plus a testability gap - cost if wrong: one round. Deferred: a « new » client whose email matches an existing customer is offered guest only (core reuses the customer; search matches emails, rare); « Ouvrir sa fiche » links to /dashboard/clients/[id], which Tasks 34-35 build. »
  - → T12 (`BOOLEAN_ANSWERS`).
- **LED:309** « Task 28: carry (Task 43 / final): timeOffConflictCopy now takes { seances, rdvs } (contract docs still show { count }); the RDV cancel label says « ticket rendu » even for a free RDV (the conflict VM does not carry coverage). »
  - → R63, T10. Free RDVs become common with P5.
- **LED:316** « Task 29: Ruling: fix round 1 (UI only, no DB test while the G4 suite runs) = booking settings validated client-side with parseFr(bookingSettingsSchema) + noticeExceedsHorizon so errors sit on their field (aria-invalid) like the event forms; availability errors name the day and range (client-side end > start), an emptied time reads « Indiquez l'heure de début. »; singular/plural units from the value; aria-labels on WeeklyHoursEditor time inputs and icon buttons (shared with type-hours-editor); « (fuseau : Paris (France)) » - why: cheap a11y/copy on pages shipped now - cost if wrong: one round. Deferred: a per-event / per-type notice override can exceed a horizon lowered later, making that séance/type never bookable online with no warning (decide in P4/P5 or the final review); errorFocus counter duplicated in 3 components; the 168 duplicates the engine's 7*24; getSettingsExtras re-reads 3 columns. »
  - → O14, T13.
- **LED:322** « Task 29: minor (deferred): type-hours-editor.tsx (RDV type hours) keeps its coarser range check (firstRangeProblem + invalid prop would fit); a client-side refusal shows under its field only, not also in the FormError box (avoids a double announcement). »
  - → T13, optional. It touches the RDV hours editor P5 relies on.
- **LED:457** « Task 43: minor (deferred): Dialog DOM filtering untested (no DOM harness); a radio group with no checked radio gives one stop per radio; inModalDialog exempts covered sibling panels for scripted focus; duplicated >>> assertions in focus-trap.test; ui-copy scan does not cover components/{ui,auth,support}, lib/* generally, layout.tsx, .sql / .css (widen at P5 with an allowlist) and its line 28 comment is stale; unreachable "0" branch in admin traffic page. »
  - → T1 (the ui-copy part).
- **FR:707 (F9)** « F9 (engine) src/lib/back-office/catalog-actions.ts:208 The rdv_free rules are checked by reads outside the engine batch (the ledger left this to the final review) | fix: Add `G(not (select rdv_free from ticket_type where id = $t), 'stale')` to the engine statements that create offers en vente, offer or convert tickets and convert on move. For the switch, add the hasSalesOrTickets predicate (as narrowed in F2) as a G in updateTicketType when rdv_free goes from false to true. »
  - → T5.
- **FR:708 (F10)** « F10 (engine) src/lib/back-office/settings-actions.ts:112 Adjacent or overlapping hour ranges are saved as they are, but an RDV must fit inside a single range | fix: Merge each day's overlapping and touching ranges in the core before the engine call (or refuse overlaps with a French message that names the day and the range), and apply the same merge in firstRangeProblem. »
  - Done by P3 (`week-hours.ts:55-67`). T6 relies on it.
- **FR:731 (UI-14)** « UI-14 (ui) src/components/public/customer-space.tsx:69 Espace: the empty-wallet CTA does not lead to the Boutique, and an RDV is called « séance » | fix: Link to the Boutique anchor of /[slug] with a « Voir la boutique » label (P5 can supply the anchor), and word the hint « jusqu'au début du rendez-vous » for RDV bookings, or use a neutral « jusqu'au début ». »
  - Done by P4 (`customer-space.ts:72`). T10 checks the remaining RDV wording.
- **P3CON:763 and P3CON:820** (drift, not a carry)
  - L763 still shows the old `RDV_FREE_HAS_SALES` text; the code has it at `src/lib/back-office/catalog-actions.ts:51-52`.
  - L820 gives `RdvSettingsForm` a `canBecomeFree` prop; the code passes `freeLockReasons` (`src/app/dashboard/tickets/[id]/page.tsx:114-126`).
  - → T14, in the outcome's P6 list (doc drift).

### 2.3 P4 outcome, contract and plan

- **P4OUT:94** « - `/[slug]` RDV libre cards (spec L1441, Decision 48): « Réserver un rendez-vous » cards linking to `/[slug]/rdv/[ticketTypeId]`; ask the owner whether he wants link-less cards earlier (COV-I10). »
  - → R41, T13. The owner question is moot once the route ships in the same plan.
- **P4OUT:95** « - `bookRdv` in `src/server/public.ts` through `runPublicAction`, with the `rdv` throttle action (spec L1273, L1482); its effects run with the budget `"none"` like every other public action (Decision 74); pre-validate with `parseFr` before the engine (P3 Decision 6). »
  - → T9.
- **P4OUT:96** « - The pro half of the `rdv_free` race (FR:F9): engine guards `G(not rdv_free, 'stale')` on the offer create, offer-tickets, convert and convert-on-move statements, and the `readFreeBlockers` predicate as a guard of `updateTicketType` when it switches to « Gratuit ». P4 took the client half (`offerUnchanged` refuses a sale on a free type inside the batch); what is left is a pro racing two of their own tabs within milliseconds. »
  - → T5.
- **P4OUT:97-111** relay OUT:76, OUT:106, OUT:120, LED:106, LED:296, LED:316, LED:457 and P3OUT:106-111 verbatim (listed above).
  - P4OUT:97 records two settled items: « the pre-hydration GET of `auth-form.tsx` (Task 26 carry) was fixed by G4b », and « the ui-copy scan was widened to the files P4 touches by Task 1 (COV-I13, its OPTIONAL list) and by Task 31 (`src/app/layout.tsx`) ».
- **P4OUT:112** « - P4 ledger: | LED:462, OUT3:90 F9 `rdv_free` guards | Task 4 (`offerUnchanged`); pro half in § 10 (FR:F9) and the outcome P5 section (Task 31) | yes | » → T5.
- **P4OUT:113** « - P4 ledger: | OUT3:107 notice override above a lowered horizon | Decision 10; P5 carry in the outcome (Task 31) | yes | » → O14, T13.
- **P4OUT:114** « - P4 ledger: | OUT3:108 orange alerts treat `rdv_free` as not RDV-enabled | contract § 3.19 (`loadTypeFacts`); P5 carry (Task 31) | yes | » → T7 and T13.
- **P4OUT:115** « - P4 ledger: Task 26: carry (Task 31 or P5): the same pre-hydration GET pattern exists in src/components/auth/auth-form.tsx:138 (a named password input): fix it in the Task 31 sweep (method="post"). »
  - Settled by G4b (P4OUT:97). For P5 it is a rule: every new form is `method="post"` or uses `action={…}` (P4PLAN:39).
- **P4CON:370** « … `rdv` { 20, 60, 6, 20, null, null } (P5 decides its seat key); … `src/lib/tickets.test.ts`: the key list and the exact table. » → R35, O22, T2.
- **P4PLAN:2372** « (`rdv` keeps the shop-like shape: P5 decides its seat key. The vocabulary file imports nothing and stays that way: a test pins it.) » → T2.
- **P4CON:1309** « Engine functions P4 does NOT call: `registerPro`, `bookRdv` (P5), `revokeLinks` (pro side only), `cancelBookingsByPro`, `cancelOccurrence` (P3). » → T9.
- **P4CON:1391 (Decision 48)** « **No RDV libre cards in P4; P5 adds them with `/[slug]/rdv/[ticketTypeId]`.** **Change to spec** (L1441-1442, L1699 list them in P4; owner validation): a card would link to a route that does not exist until P5 (A18, L1700). The outcome carries « `/[slug]` RDV libre cards (L1441) » to P5 and asks the owner whether he wants link-less cards earlier (COV-I10). » → T13.
- **P4CON:1353 (Decision 10)**, excerpt: « A notice override longer than a horizon lowered later shows every listed séance of that event « Réservations fermées » (LED:316): correct for the visitor; the warning stays a back-office matter (P5 carry in the outcome). » → T13.
- **P4CON:1409 (Decision 66)** « **Booking with a held ticket, client cancellation and « Libérer ma place » are throttled (`held`, `cancel`, `release`)** (SEC-I2): the ticket comes back on every cancellation, so the wallet bounds nothing; each loop sends four e-mails and two calendar syncs. **Change to spec** (L1268-1273 lists `free`, `buybook`, `rdv`, `shop` only; stricter). » → O22, T9.
- **P4CON:1740 and P4CON:1853**: the FR:F9 pro half belongs to P5 (« P5 owns `rdv_free` (RDV libre) and rewrites those statements »). → T5.
- **P4CON:1906**: pro-filtered `event` and `ticketType` joins in `purchaseByReference`.
  - → T7 applies the same defence to `customer-space.ts:119-120`; R49 gives the reason.
- **P4CON:1593** (excerpt) « The RDV redirect is proven by `seance-reads.db.test.ts` (`{ kind: "rdv" }`) and by reading the page branch (no RDV occurrence exists before P5, COV-M14b). » → T14 (browser check).
- **P4OUT deferred minor, G4b** « profile-guard refuses a fixed list of server-only specifiers, not « anything under src/server/* » … a new src/server read module must be added to the list by hand. »
  - → T7. Ruling: the new reads go into the existing `src/server/public-queries.ts`, so the list is unchanged.
  - If a new server module is created anyway, add it to `src/lib/public/profile-guard.test.ts:17-23`.
- **P4OUT deferred minor, Task 11** « shop-actions steps 1-4 and 7 repeat startBuyAndBook's (a shared prelude would remove the duplication). »
  - → T9 may extract a shared prelude. Optional; the step order is binding either way.
- **New since `08268de`:**
  - `src/server/public.test.ts:9-10` (untracked): « P5 adds `bookRdv` here: it goes in ACTIONS below, with its core. » → T9.
  - `src/server/safe-read.test.ts:91` pins the exact export list of `public-queries.ts`. → T7 extends it.

---

## 3. Architecture (P4 patterns, unchanged)

### 3.1 Principles carried over

The binding rules are P4PLAN:14-50, all kept:

1. **Testable cores.** Every action and every read lives in a module that takes `(db, …, now)` and imports neither
   `server-only`, `next/*`, `@/lib/db`, `@/lib/env`, the session nor Stripe.
2. **Thin wrappers.**
   - `src/server/public.ts` wraps an action as `splitActionInput` + `runPublicAction(name, slug, (pro, visitor, now) => core(...))`
     (`src/server/public.ts:23-69`; `src/server/public-context.ts:93`).
   - `src/server/public-queries.ts` wraps every read in `safeRead(() => core(db, …, now))` (`src/server/public-queries.ts:60-106`).
3. **Identity on the server.** The pro comes from the slug (`resolvePublicPro`, `public-context.ts:36`) and the visitor from
   the fresh session (`actionVisitor`, `:63`). Nothing that identifies a person comes from input.
4. **One `now` per request.**
   - Pages: `cache(...)` loaders (the séance page pattern, `src/app/[slug]/seance/[occurrenceId]/page.tsx:46-52`).
   - Actions: `run-action.ts:88`.
5. **`parseFr` on the whole input first.** Then the honeypot, identity, throttle (before any write), reads, writes, the
   engine, and Stripe last.
6. **Effects** run with the `"none"` budget through `runPublicAction`. **Revalidation** uses `PUBLIC_REVALIDATE`
   (`src/lib/public/result.ts:63-66`).
7. **Client components** never call `router.refresh()` after a Server Action. They use `router.push(x)` or
   `window.location.assign(checkoutUrl)` (P4PLAN:38).

### 3.2 Module list

**New, pure:**

| Module | Exports (proposed) | Notes |
|---|---|---|
| `src/lib/availability.ts` (rewritten in place: spec L1498, L1646) | `RdvRule`, `BusyInterval = { start: Date; end: Date }` (`[start, end)`), `RdvSlot = { start: Date; end: Date }`, `computeSlots(a: { rules; busy; durationMin; bufferBeforeMin; bufferAfterMin; tz; fromKey: DateKey; toKey: DateKey; window: BookingWindow; now: Date }): RdvSlot[]`, `gridStartsOfDay(a: { rules; durationMin; tz; key: DateKey }): Date[]`, `isGridStart(a: { rules; durationMin; tz; startsAt: Date }): boolean` | Imports only `civil-date`, `datetime` and `booking-window`. Drop `SessionInfo`, `Slot.seatsRemaining`, `capacity`, `defaultCapacity`, `eventTypeId`, `groupSlotsByDay` |
| `src/lib/public/rdv-view.ts` (client-safe) | `rdvWeekKey(param, now, tz, window): DateKey`; `rdvWeekNav(...)`; `rdvDaysVM(days, tz)` (labels from DateKeys; each chip `{ iso, time, ariaLabel }` in the pro tz); `canSpendAt(tickets: { expiresAt: string \| null }[], startsAtIso)` → `{ canSpend, leftAfter }`; `offersCoveringAt(offers: { coversUntil: string \| null }[], startsAtIso)`; `rdvCardVM(card, currency)` | No clock. Compares ISO instants only |
| `src/lib/public/rdv-form.ts` (client-safe) | `rdvHoldStorageKey(ticketTypeId, startsAtIso)`; `storeRdvHoldId` / `readRdvHoldId` (reuse `HOLD_ID_RE` and `browserSessionStorage` from `src/lib/public/buy-and-book-form.ts:41-63`); `rdvReturnHref(slug, ticketTypeId, holdId)` | The resume link of the buyer's OWN tab |

**New, DB cores (no `server-only`):**

| Module | Exports (proposed) |
|---|---|
| `src/lib/slots.ts` (spec L1501) | `loadRdvBusy(db, professionalId, range: { start: Date; end: Date }, now): Promise<BusyInterval[]>`; `loadRdvWeek(db, professionalId, ticketTypeId, weekKey: DateKey, now): Promise<{ type: RdvTypeFacts; days: { key: DateKey; slots: RdvSlot[] }[]; neverBookable: boolean } \| null>`; `checkRdvStart(db, professionalId, ticketTypeId, startsAt: Date, now): Promise<"ok" \| "not_found" \| "off_grid">` |
| `src/lib/public/rdv-reads.ts` | `getPublicRdvType(db, pro: PublicPro, ticketTypeId)` → `{ ticketTypeId, name, description, durationMin, isFree, hasHours, neverBookable, offers: { offerId, label, quantity, priceCents, coversUntil: string \| null }[], questions } \| null`; `listRdvCards(db, professionalId)` → `{ ticketTypeId, name, description, durationMin, isFree, fromPriceCents }[]`, ordered by `position, created_at, id` like `src/lib/public/boutique-reads.ts:99-106`; `rdvOwnerTickets(db, professionalId, customerId, ticketTypeId)` → `{ expiresAt: string \| null }[]` (status `available`, type `rdv_enabled and not rdv_free`, not archived, consumption order) |
| `src/lib/public/rdv-actions.ts` | `bookRdvInputSchema` (a strict discriminated union on `mode`); `type BookRdvActionInput`; `rdvHoldPressureOf(db, professionalId, now): Promise<number>`; `bookRdvCore(db, pro, visitor, input: unknown, deps: PublicDeps, now): Promise<PublicCoreResult<{ kind: "booked"; bookingId: string } \| { kind: "checkout"; purchaseId: string; checkoutUrl: string }>>` |

**New, wrappers, pages and components:**

| File | Role |
|---|---|
| `src/server/public.ts` | `bookRdvAction(input: { slug } & BookRdvActionInput)` → `runPublicAction("bookRdv", slug, (pro, visitor, now) => bookRdvCore(db, pro, visitor, rest, publicDeps(), now))` |
| `src/server/public-queries.ts` | `getRdvTypePage`, `getRdvWeek`, `getRdvCards` and `getRdvOwnerTickets`, each `safeRead(() => core(db, …))` |
| `src/app/[slug]/rdv/[ticketTypeId]/page.tsx`, `loading.tsx` | Server page (§ 3.11) |
| `src/components/public/rdv-booking.tsx` (client, L1519) | Week day picker, time chips, the three mode forms, identity, questions, resume, sign-in prompt |
| `src/components/public/rdv-cards.tsx` (server) | Cards on `/[slug]` |

**Modified:**

- **Engine:**
  - `src/lib/booking/claims.ts`:
    - export `loadRdvType` (non-throwing) and `rdvRules`, with `readRdvType` wrapping the former;
    - add `BookRdvData.checkout`;
    - add `else throw`;
    - extend `rdvTypeOk` with duration and buffers.
  - `src/lib/booking/holds.ts`: an exported `lapsedHold(now)` SQL fragment, if it is the cleanest single source.
  - `src/lib/booking/catalog.ts` and `wallet.ts`: the FR:F9 guards.
- **Vocabulary and copy:** `src/lib/tickets-vocab.ts` (`THROTTLE_LIMITS.rdv.perProIp`, `RDV_HOLD_CEILING`) and
  `src/lib/public/messages.ts` (`"rdv"` context and `COPY.RDV_*`).
- **Payments and references:**
  - `src/lib/payments/checkout.ts` (`CheckoutTarget` kind `rdv`);
  - `src/lib/payments/mock-checkout.ts` (`mockCancelPath`);
  - `src/lib/public/booking-actions.ts` (the `createCheckoutAndAttach` context union adds `"rdv"`);
  - `src/lib/public/purchase-reads.ts` (`booking.ticketTypeId` and `booking.isRdv`);
  - `src/lib/public/visibility.ts` (`referenceForPage` page kind `rdv`).
- **Wording:**
  - `src/lib/public/merci-view.ts` and `src/lib/public/checkout-return-view.ts` (RDV copy);
  - the e-mails `booking-confirmed.ts`, `pro-new-booking.ts` and `late-payment.ts`, plus `src/lib/notify-core.ts` (the `isRdv` fact).
- **Hardening:** `src/lib/back-office/customer-space.ts` (pro-filtered joins).
- **Back office:**
  - `src/lib/back-office/event-reads.ts` (phantom filter);
  - `planning-actions.ts` and `src/lib/booking/series.ts` (`RDV_NOT_MOVABLE` wording);
  - `confirm-copy.ts` (LED:309);
  - `src/components/dashboard/occurrence-dialog.tsx` (no place row for an RDV);
  - `src/app/dashboard/tickets/[id]/page.tsx` and `src/components/dashboard/ticket-type-card.tsx` (public link, « non réservable »).
- **Public pages:** `src/app/[slug]/page.tsx` (cards) and the espace wallet (RDV link).
- **Guards and pins:**
  - `src/lib/ui-copy.test.ts`;
  - `src/lib/public/page-wiring.test.ts` (`:487-492`, `:544`, `:551-556`);
  - `src/lib/public/messages.test.ts:39-40`;
  - `src/lib/tickets.test.ts:121-129`;
  - `src/lib/throttle.test.ts:130, 135, 165`;
  - `src/server/public.test.ts`;
  - `src/server/safe-read.test.ts:91`.

### 3.3 Data flow

```
GET /{slug}/rdv/{ticketTypeId}?semaine=YYYY-MM-DD[&paiement=annule&p=…]
  layout: SLUG_PARAM_RE + getPublicPage → real 404 for an unknown slug (src/app/[slug]/layout.tsx:15-26)
  page: one() on params / query; ticketTypeId shape check BEFORE any read → notFound()
  loadRdv = cache(resolvePublicPro(slug) → getRdvTypePage(pro, id) → now = new Date())
     null (unknown, foreign, archived, !rdv_enabled, duration null) → notFound(); metadata notFoundMetadata()
  weekKey = rdvWeekKey(query.semaine, now, tz, type.window)   (default: the week of now + notice)
  visitor = currentPublicVisitor(pro.professionalId, pro.ownerUserId)   (src/server/visitor.ts:48)
  in parallel:
     getRdvWeek(pro, id, weekKey, now)          → loader (§ 3.4)
     ref = paiement==="annule" ? getPurchaseReference(p) : null → referenceForPage(ref, {kind:"rdv", ticketTypeId}, owner)
     owner ? getCustomerSpacePage (compact wallet) + getLivePendingHolds + getRdvOwnerTickets : null
  render: OwnerPreviewBanner | VerifyEmailBanner | WalletPanel(compact) or VisitorBar(returnTo=/slug/rdv/id)
          h2#rdv-title tabIndex=-1, tz line « Heures de {timeZoneLabel(tz)} » (src/lib/timezones.ts:42)
          ReleaseStatus, CheckoutReturn (reference), PendingHolds (Owner), TestPaymentsBanner (paid type)
          <RdvBooking key={weekKey} days chips, modes, offers(coversUntil), ownerTickets, identity prefill />

POST bookRdvAction({ slug, ticketTypeId, startsAt(ISO from the server), mode, offerId?, identity?, answers, website? })
  runPublicAction: slug check → resolvePublicPro → one now → actionVisitor (fresh session) → bookRdvCore
  bookRdvCore (§ 3.5) → engine bookRdv(db, …, now) → [buy] Checkout create + attach (31 min, card)
  ok booked  → stay on the page; show the confirmation line, then router.push(same URL) to reload slots
  ok checkout→ storeRdvHoldId(tab) → window.location.assign(checkoutUrl)
  fail slot_taken → message « Ce créneau vient d'être pris. » + router.push(same URL) (fresh slots); resume link if this tab
                    holds a purchase id for (type, startsAt), or the Owner's server-side resumeHref

Stripe → /api/stripe/webhook → webhook-core → fulfillPurchase (generic): pending RDV booking → confirmed; ticket no. 1
  booked, the rest available; effects receipt + booking_confirmed + pro_new_booking + google sync; an ended booking
  → tickets to the wallet + late_payment (fulfillment.ts:206-216)
Cancel URL → /{slug}/rdv/{id}?paiement=annule&p=… → CheckoutReturn « Reprendre le paiement » / « Libérer ma place »
  (abandonCheckoutAction → releasePurchase → SEAT(o,0) → RDV cancelled → slot free)
Client cancel → /{slug}/espace (E5, generic) → RDV cancelled → slot free; Google delete
Nightly → sweepHolds cancels unpaid RDV holds; invariants I1, I5b
```

The `ok booked` line is the only open UX choice. Ruling: stay on the page with an inline success line. The line names the
day and the time, and links « Voir mon espace » (`/{slug}/espace`). Then the component calls
`router.push(<same URL>)` so the slot list drops the booked slot. That is P4's séance pattern: inline confirmation, no
refresh call.

### 3.4 Slot loader: the predicates it must mirror

The slot loader must never offer a slot the engine refuses, and must never hide one the engine accepts.

1. **Type** (`loadRdvType`, exported from `claims.ts` so the engine and the loader share ONE SQL statement):
   `rdv_enabled`, not archived and `rdv_duration_min` not null, joined with the pro for `timezone` and the effective
   window (`claims.ts:852-894`). `rdv_free` sets `isFree`; it never hides the type.
2. **Rules:** `rdvRules` (`claims.ts:897-914`). The type's own rules if it has ANY, else the global ones.
3. **Dates:** from `max(weekMonday, todayKey(now, tz))` to `min(weekMonday + 6, lastBookableDate(now, tz, horizon))`.
   - Step with `addDays` on DateKeys (`civil-date.ts`), never with `+ 86 400 000` (L161-164).
   - The horizon is inclusive (`booking-window.ts:23-25`).
4. **Grid** (`gridStartsOfDay`):
   - For each rule of the key's weekday (`dayOfWeek(key)`):
     `for (t = rule.startMinute; t + dur <= rule.endMinute; t += dur)`. Step = duration, anchored at the rule start: « comme aujourd'hui », L89 (`availability.ts:69, 81-85`).
   - Then `start = instantAt(key, t, tz)` and `end = start + dur × 60 000` (elapsed).
   - Dedupe on `start` ms (DST gap duplicates, overlapping stored rules).
   - Keep only `fitsAvailability(rules, start, end, tz)` (`booking-window.ts:43-62`).
   - Sort.
5. **Window:** `onlineBookability({ startsAt, now, tz, window }).ok`, the same call as the plan (`claims.ts:984`). This
   includes `start > now` (`booking-window.ts:32`).
6. **Busy:** candidate block = `[start − before, end + after)` (`claims.ts:982-983`). A slot is busy when any busy
   interval `b` has `b.start < blockEnd && b.end > blockStart`. That is the `[)` overlap of `tstzrange &&`, so blocks that
   only touch are allowed (`rdv.db.test.ts:113-125`). Busy intervals, all `professional_id = $p`:
   - every `scheduled` EVENT séance, private, `none` and empty ones included, archived event or not. Interval = its
     `block_start`/`block_end` (= its times, `schema.ts:475`). Predicate: `block_start < $rangeEnd and block_end > $rangeStart`,
     plus `starts_at > $rangeStart − 720 min` so `occurrence_pro_starts_idx` is usable (séances last at most 720 min:
     `planning-actions.ts:64-66`, `series.ts:58-60`). No filter beyond `rdvSlotFree`'s own (`claims.ts:932-934`).
   - every `scheduled` RDV of ANY type of this pro, by its STORED block (its own buffers). Predicate
     `event_id is null and status = 'scheduled' and tstzrange(block_start, block_end) && tstzrange($rangeStart, $rangeEnd)`,
     the EXCLUDE's partial-index shape. **Except** when it is a phantom, i.e. it has no confirmed booking and no pending
     booking with `hold_expires_at >= now` (the complement of `expireElapsedHolds`' `hold_expires_at < now`, `holds.ts:55`).
   - every `time_off` with `start_at < $rangeEnd and end_at > $rangeStart` (`claims.ts:935-936`; `end_at` is exclusive, `schema.ts:215`).
   - Read range: `$rangeStart = instantAt(firstKey, 0) − before` and `$rangeEnd = instantAt(addDays(lastKey, 1), 0) + after`.
     A candidate never crosses midnight, since `t + dur <= endMinute <= 1440`.
7. **`neverBookable`** (O14): true when there are no rules at all, or when `noticeExceedsHorizon(effectiveWindow)`
   (`src/lib/back-office/notice.ts:38-40`).
8. **Grid check in the action** (`checkRdvStart`):
   - Re-read the type and the rules.
   - Return `isGridStart({ rules, durationMin, tz, startsAt })`, meaning `startsAt.getTime()` is in
     `gridStartsOfDay(todayKey(startsAt, tz))`.
   - Busy, notice and horizon are left to the engine: plan at `claims.ts:984, 992`, batch at `:1048-1049` plus the EXCLUDE.
     A real conflict then comes back as `slot_taken` and not as a generic refusal.
   - Never test `(minute − ruleStart) % dur === 0`: on a gap day the shifted instants are not on that modulus (`p5-slots.md` § 3.4).

**Worked DST cases (Paris).**

- Fall-back, Sun 2026-10-25. Rule 01:00-04:00, duration 60.
  - Elapsed ends give starts at 23:00Z (Sat), 00:00Z and 02:00Z.
  - The second 02:xx hour (01:00Z-02:00Z) gets no start; that matches the engine, since `instantAt` takes the first instant.
  - The old wall-clock end made the 00:00Z slot 2 h long, so a séance at 01:30Z wrongly hid it.
- Spring-forward, Sun 2026-03-29.
  - Rule 01:00-04:00: starts at 00:00Z and 01:00Z. `t = 120` shifts to 03:00 CEST = 01:00Z; `t = 180` is the same
    instant and is deduped.
  - Rule 01:00-03:30: only 00:00Z, because 01:00Z + 60 min ends at 04:00 CEST and `fitsAvailability` refuses it. The old
    generator produced a zero-length slot there.

**Los Angeles twins:** 2026-03-08 (02:00 PST → 03:00 PDT) and 2026-11-01 (02:00 PDT → 01:00 PST; the repeated hour is 01:xx).

### 3.5 `bookRdvCore`: step order (binding)

1. `parseFr(bookRdvInputSchema, input)`. A strict union on `mode`, with fields:
   - `ticketTypeId`: the nanoid shape;
   - `startsAt`: `z.iso.datetime()`, refined to whole seconds and milliseconds of zero (the ISO the server rendered);
   - `answers`: the P4 answer shape;
   - `free` and `buy` add `identity` (`identityInputSchema`) and `website` (`z.unknown().optional()`);
   - `buy` adds `offerId`;
   - `held_ticket` has NO identity field (`booking-actions.ts:60, 469`).
   A malformed call reads and writes nothing.
2. Honeypot (`free`, `buy`): `honeypotFilled` → `COPY.HONEYPOT_REFUSED` (`booking-actions.ts:80`).
3. Identity:
   - `held_ticket`: `owner = visitor.owner`; it must be non-null with `owner.professionalId === pro.professionalId`, else
     `COPY.CONFIRM_EMAIL_TO_SPEND` (`booking-actions.ts:476-477`). Subject = `{ kind: "user", userId: owner.userId }`.
   - `free` and `buy`: `identity = identityOf(data.identity, visitor)` and
     `subject = throttleSubjectOf(visitor.session, identity.email)` (`booking-actions.ts:85-100`).
4. `buy` with the mock gateway outside its allowance → `COPY.PAYMENT_UNAVAILABLE` (`booking-actions.ts:243`).
5. `checkActionThrottle(db, { action: "rdv", professionalId, ipHash, wideIpHash, subject }, now)` for EVERY mode
   (`src/lib/throttle.ts:136`; spec L1273; O22). Throttled → `ENGINE_ERROR_MESSAGES.throttled`, nothing written.
6. Grid: `checkRdvStart(db, pro.professionalId, data.ticketTypeId, startsAt, now)`. This is a read.
   - `not_found` → the RDV `not_found` copy.
   - `off_grid` → `COPY.RDV_SLOT_GONE` with code `unavailable`.
   - Either way, still nothing is written (no customer row).
7. `buy` with a typed subject: `rdvHoldPressureOf(db, proId, now) >= RDV_HOLD_CEILING` → `COPY.TOO_MANY_PAYMENTS`
   (the SEC-I1 analogue, `booking-actions.ts:260-264`; O23).
8. Writes before the engine:
   - `held_ticket`: `linkCustomerUser(db, owner, now)` (`booking-actions.ts:495`).
   - `free` and `buy`: `upsertCustomer(db, { professionalId, email, name, phone, userId: subject.kind === "user" ? subject.userId : null }, now)`.
9. Engine: `bookRdv(db, { professionalId: pro.professionalId, ticketTypeId, startsAt, customerId, answers, actorUserId, mode[, offerId] }, now)`.
   - `customerId` is `owner.customerId` for `held_ticket` and the upserted id otherwise.
   - `actorUserId` is `owner.userId`, or the subject's user id, or null.
10. Failures:
    - A typed subject with `too_many_holds` → `COPY.BUYBOOK_NOT_POSSIBLE` (P4 Decision 64, `booking-actions.ts:295-297`).
    - `slot_taken` for an Owner: if `livePendingHoldsOf(db, proId, owner.customerId, now)` (`src/lib/public/seance-reads.ts:296-334`)
      holds an RDV of this type at this `startsAt`, the failure carries
      `resumeHref = rdvReturnHref(slug, ticketTypeId, purchaseId)`. That reference is hers, so `referenceForPage` accepts it.
    - `slot_taken` for anyone else: the plain message. Never a purchase id derived from a typed address (P4 Decisions 64 and 71).
    - Everything else → `fromEngineClient(res, "rdv", vars)`. `stale` is surfaced, not retried (O25).
11. `held_ticket` and `free` ok → `publicOk({ kind: "booked", bookingId }, res.effects)`.
12. `buy` ok, inside a try that calls `abandonPurchase` on a throw (`booking-actions.ts:149-168, 304-327`):
    - `request = { kind: "buybook", purchaseId, amountCents: res.amountCents, currency: res.checkout.currency, productName: \`${res.checkout.ticketTypeName} · ${res.checkout.label}\`, customerEmail: identity.email, env, ...checkoutUrls(deps.appUrl, { kind: "rdv", slug, purchaseId, ticketTypeId }), expiresAt: buybookCheckoutExpiry(Date.now()) }`.
      `kind: "buybook"` keeps card only and 31 minutes (`checkout.ts:152`).
    - Then `createCheckoutAndAttach(db, deps, request, "rdv", pro.businessName, now)`.

### 3.6 The three modes for a slot

| Mode | Who | Engine | Hold / expiry | Release | Copy hooks |
|---|---|---|---|---|---|
| `held_ticket` | Owner of THIS pro, verified, not impersonating | Booking `confirmed`, spend in consumption order with SKIP LOCKED, `assertSpent` → `no_ticket` (`claims.ts:1052-1062`) | None | E5 from the espace (ticket back, generic) | `heldTicketLabel(leftAfter)` (`messages.ts:151-153`). `leftAfter` = the Owner's tickets of THIS type eligible at this start, minus 1 (P4 Review Focus 6: never over every type) |
| `free` | Anyone (typed address), `rdv_free` types only | Booking `confirmed`, coverage `free` (`claims.ts:1063-1064`) | None | E5 | « Réserver » + confirmation line |
| `buy` | Anyone, paid types; an offer of THIS type, active, whose `coversUntil > startsAt` | Pending purchase + pending booking, quota 2 per customer under the customer lock (`claims.ts:1065-1077`) | Hold 45 min (`tickets-vocab.ts:170`), Checkout 31 min (`:172`); an elapsed hold is reclaimed by the next `bookRdv` overlapping it (`claims.ts:1030-1031`) or by `sweepHolds` | Stripe failure or refused attach → `releasePurchase` at once (`booking-actions.ts:190-212`); « Libérer ma place » (`release-actions.ts:36-97`); nightly | `TestPaymentsBanner`; « Payer {prix} » (`buy-and-book-form.ts:36-38`) |

Page mode per selected slot, mirroring `TicketsBooking` (`occurrence-booking.tsx:468-487`):

- A free type shows the free form.
- A paid type where `canSpendAt(ownerTickets, startsAt)` holds shows the held form only.
- A paid type otherwise shows:
  - `HaveTicketsPrompt` (anonymous, with `OtpDialog`), or the `CONFIRM_EMAIL_TO_SPEND` hint (unverified);
  - and the buy form with the offers covering that start.
  - With no covering offer, it shows `COPY.RDV_NO_OFFER`.

### 3.7 Webhook fulfilment of an RDV purchase

No code change; it is generic:

- `webhook-core` → `fulfillPurchase` confirms the still-pending booking (`fulfillment.ts:186-189`) and issues the tickets,
  ticket no. 1 booked on the RDV.
- Effects: `fulfillment.ts:206-212`.
- If the booking ended (released, swept, or reclaimed by another `bookRdv` after the hold lapsed), the tickets land in
  the wallet with `email.late_payment` (`fulfillment.ts:213-216`). The RDV is never resurrected (L1110).

Edge accepted:

- A paid-late RDV hold that nobody reclaimed is confirmed after its 45 minutes. It still owned the EXCLUDE, so no double
  booking is possible.
- Only a pro-made event or time off placed over it in that window could overlap. That is the tolerated L901-902 class,
  and the pro sees both in the planning.

Mock mode: `/api/mock-checkout` uses the same fulfilment. Only `mockCancelPath` needs the RDV branch: `eventId === null`
→ the `rdv` path with `occurrence.ticket_type_id`.

### 3.8 Identity

- The P4 rules apply unchanged (`src/lib/public/identity.ts:72-139`). A typed e-mail authorises nothing. The wallet,
  spending, the server-side resume URL and the per-slot ticket count are for the Owner only. The guest cookie never
  spends and never prefills (P4 Decisions 7 and 63). A `?p=` reference shows THAT purchase only (Decision 71).
- `referenceForPage(ref, { kind: "rdv", ticketTypeId }, owner)` accepts a reference only when all of these hold:
  - `ref.booking !== null`;
  - `ref.booking.isRdv`;
  - `ref.booking.ticketTypeId === ticketTypeId`;
  - and, when an Owner is signed in, the reference is hers (OUT:74).
- An impersonating admin has no Owner (`owner` is null): `held_ticket` is refused. `free` and `buy` run on a typed
  identity with `userId` null, as in P4.

### 3.9 Throttles and abuse bounds

| Bound | Value | Source |
|---|---|---|
| `rdv` per IP, /48, per-pro e-mail, global e-mail, user key | 20, 60, 6, 20 per hour; the user key gets 6 | `tickets-vocab.ts:201`; L1273; P4 Decision 67 |
| `rdv` seat key (new) | `perProIp: 6`: per pro and IP, like `free` (`tickets-vocab.ts:199`). No per-occurrence key, since there is no occurrence before booking | O22 |
| Live holds per customer | 2, séances and RDVs together, in the batch | `holds.ts:34-42` |
| Live RDV holds per pro, for a typed address (new, a read) | `RDV_HOLD_CEILING = 3`. Verified identities bypass it | O23 |
| Render cost | At most 7 local days × at most 288 candidates; a `?semaine=` beyond the horizon reads the type only and generates nothing | § 3.4 |

Residual accepted (owner list): free RDVs from typed addresses fill the calendar at most 6 per hour per IP per pro. Each
one is confirmed, and the pro gets one « nouveau rendez-vous » e-mail per booking (R65) and can cancel. Spec decision 6
forbids requiring proof to book.

### 3.10 Copy (all French, vouvoiement, no dash)

`PublicErrorContext` gains `"rdv"` (`messages.ts:9`), and `CLIENT_CONTEXT_MESSAGES.rdv` gets:

| Code | Copy |
|---|---|
| `unavailable` | « Ce créneau n'est plus disponible : choisissez-en un autre. » |
| `slot_taken` | « Ce créneau vient d'être pris. » (L711, the engine default) |
| `stale` | « Les horaires ou l'offre ont changé : rafraîchissez la page. » |
| `not_found` | « Ce rendez-vous ou cette offre n'existe plus : rafraîchissez la page. » |
| `no_ticket` | « Aucun ticket utilisable pour ce rendez-vous. » |
| `offer_too_short` | « La validité de cette offre ne couvre pas la date du rendez-vous. » |
| `too_many_holds` | Default for a verified identity; neutral (`COPY.BUYBOOK_NOT_POSSIBLE`) for a typed one |

New `COPY` entries:

- `RDV_SLOT_GONE` (= the `unavailable` sentence);
- `RDV_NO_OFFER` « Aucune offre ne couvre cette date. Choisissez un créneau plus proche. »;
- `RDV_EMPTY_WEEK` « Aucun créneau cette semaine » (L1615) and `RDV_NEXT_WEEK` « Semaine suivante »;
- `RDV_CLOSED` « Aucun créneau disponible pour le moment. » (never bookable);
- `RDV_BOOK` « Réserver »;
- `RDV_CARD_CTA` « Réserver un rendez-vous » (P4OUT:94);
- `RDV_FREE_BADGE` « Gratuit »;
- `RDV_TZ_LINE` « Heures de {zone} ».

The pin goes in `messages.test.ts:39-40`.

### 3.11 Pages, metadata, loading, notFound

- **`generateMetadata`** reads the type only, never the viewer (P4 SEC-M10 pattern, seance page `:54-64`):
  - an active RDV type of this pro → title `« {name} · {businessName} »`, indexable, `referrer: "no-referrer"` (the URL may carry `p`);
  - anything else → `notFoundMetadata()` (`src/lib/public/page-metadata.ts:9-11`).
- **notFound cases**, all through one identical path decided before the visitor is read (no oracle): malformed id, unknown,
  another pro's type, archived, not `rdv_enabled`, duration null. `rdv_free` is a mode, not a 404.
- **Loading and errors:** own `loading.tsx` (`PageSkeleton`). The `[slug]` `error.tsx` covers the route. A `notFound()`
  streamed behind `loading.tsx` answers 200 with noindex (P4CON:1315), hence the noindex metadata.
- **Dynamic page:** fresh session, cookie, `?p=`. No cache directive. A render never writes.
- **Tracking:** by path (`src/lib/analytics.ts:48-56`; there is no personal data in the path). `rdv` is not a top-level
  segment, so `RESERVED_SEGMENTS` is unchanged.
- **Page-wiring lists:** `page-wiring.test.ts:487-492`, `:544` (one `resolvePublicPro`, no `includeSuspended`) and
  `:551-556` (`notFoundMetadata`).
- **`/[slug]` cards:** a section between `PublicPlanning` and the Boutique (`src/app/[slug]/page.tsx:127-145`). It reads
  `getRdvCards`, which hides types with no hours at all or `neverBookable`, ordered like the Boutique. A card shows name,
  duration, « Gratuit » or « À partir de {prix} » (the lowest active offer price, `formatMoney`),
  a description of at most 2 lines, and the « Réserver un rendez-vous » link. There is no next-slot computation on
  `/[slug]` (O8).

### 3.12 E-mails, Google, ICS

- `notify-core` passes `isRdv: eventId === null` to the templates that need it.
- `booking-confirmed`: row label « Rendez-vous » and heading « Rendez-vous confirmé ». The « Lieu » row is already
  omitted when there is no location (`booking-confirmed.ts:57`).
- `pro-new-booking`: subject « Nouveau rendez-vous : {title} » and the body sentence.
- `late-payment`: « Le rendez-vous « {title} » ({when}) n'est pas réservé pour vous. Vous pouvez utiliser … sur un autre
  créneau. » The headline stays the spec's L1136-1137 sentence.
- One test per template, including `escapeHtml` of a hostile type name.
- Google and ICS: no change (`calendar-sync-load.ts:62-71`; `src/app/api/bookings/[id]/calendar.ics/route.ts:20-38`).

### 3.13 Espace, mon-espace, merci

- Espace and `/mon-espace` already list RDV bookings and cancel them (generic E5, `customer-space.ts:72, 113-115`).
  - P5 adds: a ticket of an RDV-enabled paid type offers « Réserver un rendez-vous » → `/{slug}/rdv/{typeId}`. The spend
    list `spendable.ts` is for séances (`:70-71`).
  - The joins at `customer-space.ts:119-120` become pro-filtered.
- `merci`: `merciCopy` gets RDV variants, keyed on `ref.booking.isRdv`:
  - `booked` → « Rendez-vous confirmé » / « Paiement reçu. Votre rendez-vous « {title} » ({when}) est réservé. … »;
  - `paid_cancelled` → « … Ce rendez-vous a été annulé. »
- `returnTextOf` (`checkout-return-view.ts:173-197`) gets « créneau » wording for an RDV reference.

### 3.14 Pro side

- **Planning:** no data change. P5 checks in a browser that a public RDV appears with the client name, the coverage and
  the answers, that a buy in progress shows as pending, and that phantoms disappear.
  - `occurrence-dialog` hides the place row for an RDV (`:239-241`).
  - Buffers stay undrawn (deferred).
- **Type page:**
  - « Voir la page de réservation » link plus copy-link to `/{slug}/rdv/{id}`.
  - A « Non réservable en ligne » note naming the reason: no hours (no own and no global rules); notice above horizon
    (effective window, `noticeExceedsHorizon`); or, for a paid type with no offer on sale, « Seuls les clients qui ont
    déjà des tickets de ce type peuvent réserver ».
- **`countRdvConflicts`:** add the phantom filter (`event-reads.ts:483-488`).
- **`RDV_NOT_MOVABLE`** (both copies): « Un rendez-vous ne se déplace pas : annulez-le, votre client pourra en réserver un
  autre depuis votre page. »
- **LED:309:** the time-off conflict VM carries the coverage, and a free RDV reads « aucun ticket à rendre ».

### 3.15 Engine changes (additive, each with a DB test)

Precedent: P3 Task 7 added the tz guard (LED:100) and P4 Task 4 changed `offerUnchanged` (P4CON:419).

1. **`else throw`** after the `buy` branch (`claims.ts:1065-1078`; OUT:120).
2. **`BookRdvData.checkout`:** `{ currency, label, quantity, ticketTypeName } | null`, taken from the planned `OfferRow`
   (`claims.ts:993-998`; `readOffer` returns these fields, `claims.ts:121-160`).
   - This is the snapshot `offerUnchanged` guards in the batch (`claims.ts:1067`), so it is race-free.
   - OUT:76 suggests a separate read instead; that read could disagree with the guarded snapshot.
3. **Shared readers:** export `loadRdvType(db, professionalId, ticketTypeId): Promise<RdvTypeFacts | null>` and
   `rdvRules`. `readRdvType` becomes a thin wrapper that throws `PlanError("not_found")`.
4. **`rdvTypeOk`** also asserts `tt.rdv_duration_min = $plannedDuration and tt.rdv_buffer_before_min = $b and tt.rdv_buffer_after_min = $a`.
   - Code `stale`, mapped to « Les horaires ou l'offre ont changé ».
   - It closes G4 of `p5-engine.md`: a duration or buffer edit between plan and batch.
   - Cost: none on the hot path (same row).
5. **FR:F9 pro half** (T5): `G(not (select rdv_free from ticket_type where id = $t), 'stale')`, added to:
   - `createOffer`, and `updateOffer` when it activates an offer;
   - `offerTickets` and `convertTickets` (target type);
   - `moveAttendee` convert-on-move;
   - `updateTicketType` when `rdv_free` goes false → true, as the `readFreeBlockers` predicate
     (`src/lib/back-office/catalog-reads.ts:245-266`) turned into a G.

   The engine entry points are `src/lib/booking/catalog.ts:94, 156, 198` and `src/lib/booking/wallet.ts:137, 370, 589`.
6. **Not changed:**
   - `onlineBookability` order (O14).
   - Hours are not re-guarded in the batch (G3 of `p5-engine.md`): a pro narrowing hours in the same milliseconds is the
     pro's own race, and the RDV still lands inside the hours that were valid when it was planned.

---

## 4. Open questions and rulings (the controller rules)

| # | Question | Ruling | Why | Cost if wrong |
|---|---|---|---|---|
| O1 | What are « tests EXCLUDE dans l'UI » (L1700)? | Both. (a) DB tests that drive `bookRdvCore` (the action body) into the EXCLUDE: two typed addresses, two Owners, a buyer against a free booker, all on one slot in `inParallel` → exactly one `ok` and one `slot_taken` with « Ce créneau vient d'être pris. », one scheduled RDV, I1/I5 clean; plus the same customer double-submitting. (b) A browser check: two tabs book one slot; the second shows the sentence and its refreshed week no longer offers the chip | T6 already covers the engine; the UI layer is where a wrong mapping or a missing refresh would hide | One more test file |
| O2 | Slot grid step | Step = duration, anchored at each rule's start; buffers only widen the block (`availability.ts:69, 81-85`) | Decision 9 « calculés comme aujourd'hui » (L89) | With buffers, a booked 10:00 also removes 11:00 (blocks overlap). If the owner prefers `step = duration + buffers` or a 15-min grid: one formula in `gridStartsOfDay` and its tests, no data impact. **Owner product call** |
| O3, O4 | Which range the overlap checks use | The candidate's buffered block, against RDV blocks (their own buffers), séance blocks (= their times) and time off | It is the engine's code (`claims.ts:932-936`; EXCLUDE 0012:4-6) | None |
| O5 | Cancel URL of an RDV purchase | `/{slug}/rdv/{ticketTypeId}?paiement=annule&p=…` through a new `CheckoutTarget` kind `rdv`; `mockCancelPath` branches on `eventId === null` | The séance page redirects an RDV to `/espace` and loses `p` (`seance/[occurrenceId]/page.tsx:84`) | None |
| O6 | Double submit → `slot_taken` | Same `slot_taken` sentence for everyone. « Reprendre le paiement » comes from (a) the tab's own sessionStorage purchase id keyed by (type, startsAt), and (b) for a verified Owner only, a server `resumeHref` to her own live hold | A resume answer to a typed address would leak another customer's purchase and its Checkout URL (P4 Decisions 64 and 71). Narrows OUT:76 | A typed buyer who lost the tab waits out the hold (≤ 45 min) or signs in |
| O7 | Which mode shows when | § 3.6, mirroring `TicketsBooking`. A free type needs a typed identity only (no proof). A paid type with no covering offer and no usable ticket → `COPY.RDV_NO_OFFER` plus the sign-in prompt | Spec decision 6; P4 parity | Copy only |
| O8 | What a card shows | Name, duration, « Gratuit » or « À partir de {prix} », description, CTA. No « next slot ». Types with no hours or `neverBookable` are hidden | A next-slot scan per card per render could walk up to 365 days | One read if the owner wants « Prochain créneau » |
| O9 | Pro creates an RDV for a client | Not in P5. Reword `RDV_NOT_MOVABLE`. The type page gets the public link the pro can send | No pro route in the spec; E2 pro is séance-only (CON:2307); `REGISTER_RDV` (`planning-actions.ts:464`) | One task (an E4 pro path: notice and horizon ignored, coverage ticket / free / guest, `createdBy: "pro"`, no pro e-mail) if the owner asks. **Owner product call** |
| O10 | E6b on an RDV | Keep P3's « Annuler le rendez-vous » (`occurrence-dialog.tsx:516-526`) | Already shipped and E6b-correct | None |
| O11 | E6c over a booked RDV | Answered by code: RDVs are in the conflict set by block (`cancel.ts:361-364`) | — | — |
| O12 | Where an RDV takes place | No location in v1. E-mail, ICS and Google omit it; the dialog hides « Lieu non précisé » | No column (L270); the effective location is `coalesce(location_override, event.location)` (L451) | A `ticket_type.location` column (migration) later. **Owner product call** |
| O13 | Does a future RDV lock the time zone | Yes, already (`settings-actions.ts:47`) | P3 Decision 52 | — |
| O14 | Notice above a lowered horizon | Loader: dates are bounded by the horizon first, so the type shows `RDV_CLOSED` with no week navigation. `neverBookable` hides the card. The type page warns. `onlineBookability` stays as is | Closes P3OUT:107 and LED:316 for RDV without changing P4's séance states | A URL-only séance page keeps « Réservations fermées » instead of « pas encore ouvertes » in that edge (P4 Decision 10 already accepted it) |
| O15 | Week window vs `day-calendar` (L475, L1615 vs L1456) | A week page (`?semaine=`, Monday-based, horizon-capped) with a 7-day picker (weekday, date, number of slots, disabled at 0) and the selected day's time chips; below 640 px a list per day. `DayCalendar` is NOT used and NOT modified (the landing hero and the demo depend on its DOM, `hero-cards.tsx:179-181`) | The spec's computation and empty-state rules are week-based; a month grid would show three dead weeks; P4 Decision 46 made the public « Semaine » a chip view; `DayCalendar` builds browser-local `Date`s (`src/lib/calendar-grid.ts:10-36`), a DST and zone hazard | **Change to spec** (owner validation). If the owner insists, swap the picker for `DayCalendar` and widen the window to the month (the loader takes any `fromKey..toKey`; ≤ 42 days is cheap) |
| O16 | Google free/busy blocks slots | No | Export-only by design (`docs/superpowers/specs/2026-06-29-google-calendar-sync-design.md` L11, L16) | Scope change |
| O17 | Per-client caps | None beyond `too_many_holds` and throttles | Spec has none; a per-address cap needs Decision 64 neutral wording and rotating addresses defeat it | Residual in § 3.9 |
| O18 | Owner self-booking | Forms stay active under `OwnerPreviewBanner` (L1350, L1861) | Spec | — |
| O19 | Seed RDV data | Keep the two seeded RDVs (`scripts/seed.ts:254-268, 351-365`, both on the grid). No new seed | Enough for the browser tour | — |
| O20 | `rdv_free` switching races | T5 (FR:F9) | Carry | — |
| O21 | Questions placement | After the slot pick, with the identity block (séance parity), through `QuestionFields` | — | Layout only |
| O22 | Throttle action and seat key | `rdv` for every mode (spec L1273), with the user key for an Owner, plus `perProIp: 6` | `held` (P4 Decision 66) exists for the séance spend loop; `rdv`'s user limit (6) is stricter than `held` (10); the per-pro IP key bounds calendar filling | A household booking 7 RDVs at one pro within an hour from one IP |
| O23 | Hold ceiling for typed buyers | `RDV_HOLD_CEILING = 3` live RDV holds per pro (a read, like `seatPressureOf`); verified identities bypass it | Without it, N IPs park about 4.5 N slots for 45 min | A 4th concurrent typed buyer at that pro is asked to sign in or wait |
| O24 | Is the RDV page indexable | Yes for an active type; metadata viewer-independent; always `no-referrer` | It is a public booking page like a public séance | One metadata line |
| O25 | `stale` (tz changed) | Surface it with the RDV `stale` copy and refresh; no retry | The visitor chose a wall time in the old zone; a silent replan could book a different meaning; the tz is locked while any future RDV exists | One extra click in a near-impossible race |
| O26 | May P5 touch the engine | Yes, the six additive changes of § 3.15, each with a DB test | P3 and P4 precedents; the carries require it | — |
| O27 | Re-guard hours in the batch | No | § 3.15 point 6 | An RDV inside hours narrowed in the same milliseconds; the pro cancels |
| O28 | Default week | The week containing `now + notice` (not always the current week) | Avoids an empty first view under a long notice | One function |
| O29 | Legacy `/book/[eventTypeId]` | Keep the 308 to `/[slug]` | No eventType → ticketType map exists (table rase, L102) | — |
| O30 | Time zone shown to visitors | Always a static « Heures de {zone} » line (`timeZoneLabel`) | An RDV is a precise time; visitors in other zones misread | One line of copy (additive) |
| O31 | Module names | Keep the spec names `src/lib/availability.ts` (pure) and `src/lib/slots.ts` (loader); public cores in `src/lib/public/rdv-*.ts` | L1498, L1501, L1745 | — |
| O32 | Draw buffers in the pro planning | No (deferred minor) | Not in the spec | — |

**Changes to spec for the owner list:**

- O15: the week picker instead of `day-calendar`.
- O22 and O23: `perProIp` and the hold ceiling. These are stricter than L1268-1273.
- O6: resume narrowed to the Owner and the buyer's own tab.

**Product calls:** O2, O8, O9, O12, O28, O30.

---

## 5. Proposed task list

Global rules come from P4PLAN:14-50 and are unchanged:

- worktree commands;
- `./node_modules/.bin/*`, never `pnpm <script>`;
- every task ends with tsc, eslint on its files, all pure tests, the DB files it touches, and `next build`;
- DB tests in foreground chunks of at most 6 files (one process each);
- time-sensitive pure tests in `Europe/Paris` AND `America/Los_Angeles`, with host-zone independence through PowerShell
  `$env:TZ`;
- `design-taste-frontend` before UI;
- one commit per task;
- no push, no migration.

DST days used throughout:

| Zone | Spring | Fall |
|---|---|---|
| Paris | 2026-03-29 (next: 2027-03-28) | 2026-10-25 |
| Los Angeles | 2026-03-08 (next: 2027-03-14) | **2026-11-01, 5 days after today** |

DB tests inject a `now` a few days before each DST day.

### G1: foundations

**T1. Preflight, contract tracking and the copy guard (P3OUT:115, LED:457)**

- Files: `src/lib/ui-copy.test.ts` (`DIRECTORIES` `:18-27`, `OPTIONAL` `:34-98`).
- Work:
  - Verify HEAD and that the P5 contract is tracked.
  - Widen the scan to every `src/**/*.{ts,tsx}` minus a short, justified allowlist (tests and fixtures with legit dashes):
    this covers the rest of `src/components/{ui,auth,support}` and `src/lib/*`.
  - Add the P5 paths to it.
  - Fix the stale header comment.
- Tests: the guard itself, plus its hygiene test (`:186-192`). `.sql` and `.css` stay out with a written reason.

**T2. Vocabulary, client copy and the `rdv` seat key**

- Files: `src/lib/tickets-vocab.ts` (`THROTTLE_LIMITS.rdv` → `perProIp: 6`, its doc comment, `RDV_HOLD_CEILING = 3`) and
  `src/lib/public/messages.ts` (`"rdv"` context, `COPY.RDV_*`).
- Produces: `CLIENT_CONTEXT_MESSAGES.rdv` and the `COPY.RDV_*` keys (§ 3.10).
- Tests:
  - `src/lib/tickets.test.ts:121-129` (the exact table);
  - `src/lib/throttle.test.ts:130, 135, 165`: `rdv` now has `perProIp` and still no `perOccurrenceIp`, so
    `SeatTakingThrottleAction` is unchanged;
  - `messages.test.ts:39-40` (the pin);
  - the ui-copy guard.

**T3. Pure slot generator (rewrite `src/lib/availability.ts`)**

- Produces `computeSlots`, `gridStartsOfDay` and `isGridStart` (§ 3.2). Consumes `civil-date`, `datetime` and `booking-window`.
- Delete the seat model and `groupSlotsByDay`. Rewrite `src/lib/availability.test.ts`: keep the intent of `:33-55` and
  `:112-145`, drop `:57-110`.
- Pure tests, Paris and LA:
  - each of the four DST days: the elapsed end; a gap start that overruns its rule is refused; fall-back starts on the
    first instant; a séance in the repeated hour does not hide the first-instant slot;
  - the 7 local days of a DST week (167 h and 169 h);
  - horizon inclusive, by local date (a slot at 23:30 on the last day is in, 00:00 the next day is out; LA 17:00 PDT =
    00:00Z next day stays in);
  - notice 0 at `now` (OUT:106), and `start <= now` excluded;
  - buffers: touching blocks allowed, a 1-min overlap refused; asymmetric RDV blocks against the candidate's buffers;
  - overlapping stored rules deduped; `endMinute` 1440; duration not dividing the rule.
- Property test (seeded): every slot passes `fitsAvailability` and `onlineBookability`, its block misses every busy
  interval, and slots are sorted, unique and whole-minute.
- `isGridStart`: refuses 10:07, 10:00:30, 10:00:00.001 and an instant outside the hours.
- Host zones: run under `$env:TZ = "America/Los_Angeles"`, `"Europe/Paris"` and `"Asia/Tokyo"`.

**T4. Engine E4 carries and the RDV test gaps (OUT:76, 112, 118, 120, 121)**

- Files: `src/lib/booking/claims.ts` (§ 3.15 points 1-4), `src/lib/booking/rdv.db.test.ts`, `cancel.db.test.ts`,
  `release.db.test.ts`, `eligibility.db.test.ts`.
- Produces: `loadRdvType`, `rdvRules` (exported) and `BookRdvData.checkout`.
- DB tests:
  - notice and horizon with type overrides (plan and batch);
  - `afterPlan` staging of `rdvTypeOk` (type archived, made free, duration or buffer changed → `unavailable` or `stale`)
    and of `rdvSlotFree` (time off, event séance, notice crossed);
  - per-type hours replace the global ones;
  - one DST day per zone;
  - buffers vs time off and vs a séance;
  - buy-mode `too_many_holds`, `offer_too_short` and `stale` (offer price changed); offer switched to free → `unavailable`
    before `stale` (`claims.ts:1048` then `:1067`);
  - `checkout` facts equal the guarded snapshot;
  - RDV `releasePurchase` → occurrence cancelled and the slot rebookable;
  - E5 with `rdv_cancel_deadline_hours` (coalesce order);
  - E6b on an RDV with a pending purchase;
  - ELIGIBLE RDV-clause mutations (OUT:112).
- Second-pro cases: a foreign type → `not_found`; a foreign customer → `not_found`; another pro's RDV, séance or time off
  at the same instant does not block.
- Gate: the full DB suite in chunks.

**T5. FR:F9 pro half (P3OUT:90, P4OUT:96)**

- Files: `src/lib/booking/catalog.ts` and `src/lib/booking/wallet.ts` (§ 3.15 point 5),
  `src/lib/back-office/catalog-actions.ts` (map the new `stale` into the pro message).
- DB tests with `afterPlan`:
  - switch to « Gratuit » racing `createOffer` and `updateOffer` (activate);
  - racing `offerTickets` and `convertTickets` onto that type;
  - racing `moveAttendee` convert-on-move;
  - the free switch racing a live hold or a sale → `stale` and nothing written;
  - a second pro's type id → `not_found`.

**T6. Slot loader `src/lib/slots.ts`**

- Consumes T3 and T4. Produces `loadRdvBusy`, `loadRdvWeek` and `checkRdvStart` (§ 3.2, § 3.4). Uses one lapsed-hold
  fragment shared with `holds.ts` (P3OUT:151).
- DB tests (`src/lib/slots.db.test.ts`):
  - séance blocking: private, `none`, empty, archived event, a séance that started before the window, one crossing midnight;
  - all-day and timed time off;
  - another RDV type of the same pro with 15/15 buffers (block against block);
  - a live hold blocks, a lapsed hold frees the slot at `hold_expires_at + 1 ms`;
  - the boundary at `hold_expires_at == now` matches the engine (`slot_taken`, so not offered);
  - a cancelled RDV is ignored;
  - type override window; per-type rules; touching rules stored unmerged (written through `setAvailabilityRules`);
  - `neverBookable` (no rules; notice above horizon);
  - a far-future `?semaine=` → no candidates;
  - DST weeks in Paris and LA with an injected `now`.
- Agreement tests: book (through the engine) the first, the last and one DST-day slot the loader offers → `ok`; an
  off-grid neighbour → `checkRdvStart` = `off_grid`; after each booking the loader no longer offers that slot nor any
  slot whose block overlaps it.
- Second pro: its séances, RDVs, time off and rules never touch this pro's slots; a foreign type id → `null` and `not_found`.

**T7. Public RDV reads, the reference kind and the join hardening**

- Files:
  - `src/lib/public/rdv-reads.ts` (new);
  - `src/lib/public/purchase-reads.ts` (`booking.ticketTypeId`, `booking.isRdv`);
  - `src/lib/public/visibility.ts` (page kind `rdv`);
  - `src/lib/back-office/customer-space.ts:119-120` (pro-filtered joins);
  - `src/server/public-queries.ts` (wrappers through `safeRead`);
  - `src/server/safe-read.test.ts:91` (names).
- DB tests:
  - `getPublicRdvType`: archived, not RDV, foreign → null; offers of another type and inactive or archived offers left
    out; `coversUntil` per validity;
  - `listRdvCards`: order; hides no-hours and never-bookable types; `rdv_free` → « Gratuit »;
  - `rdvOwnerTickets`: this type only, `available` only, `rdv_free` and archived types excluded (P3OUT:108);
  - `purchaseByReference` on an RDV of another pro's type → empty title (P4CON:1906 pattern);
  - `customer-space` with a hand-built crossed row shows no foreign text.
- Pure tests: `referenceForPage` for kind `rdv` (another type, a séance reference, a shop reference, an Owner's foreign
  reference → null).

**T8. Checkout plumbing for RDV**

- Files:
  - `src/lib/payments/checkout.ts` (target `rdv`, `cancelPathOf`);
  - `src/lib/payments/mock-checkout.ts` (`mockCancelPath`);
  - `src/lib/public/booking-actions.ts` (the context union);
  - `src/lib/public/rdv-form.ts` (new: storage key, return href).
- Pure tests: the paths are URL-encoded and built from the trusted app URL only; the storage key round-trip ignores
  malformed ids (`HOLD_ID_RE`).
- DB test: `mockCancelPath` for an RDV purchase → the `rdv/` path; for a séance → unchanged.

**T9. `bookRdvCore` and `bookRdvAction` (the EXCLUDE in the UI)**

- Files: `src/lib/public/rdv-actions.ts`, `src/server/public.ts`, `src/server/public.test.ts` (`ACTIONS`,
  `RUNTIME_IMPORTS`), `src/lib/public/rdv-actions.db.test.ts`. Consumes T2, T4, T6, T7, T8. Step order: § 3.5.
- DB tests, the three modes:
  - free success (effects: confirmation, pro notice, sync);
  - held success (Owner; « il vous en restera N » count source);
  - buy success with a fake gateway (request fields: card, 31 min, `rdv` cancel URL, product name);
  - Stripe create failure → RDV cancelled, slot bookable again, effects returned;
  - refused attach → `stale` plus release;
  - a throw after the purchase → `abandonPurchase`.
- EXCLUDE in the UI (O1): parallel cores on one slot (typed + typed, Owner + typed, buy + free) → one `ok`, one
  `slot_taken` with the exact French sentence; the same customer double-submitting; the Owner's `resumeHref` present
  only for her own hold.
- Security:
  - `held_ticket` by an anonymous visitor, a typed address, a guest cookie, an unverified session, an impersonating
    admin, or an Owner of another pro → `CONFIRM_EMAIL_TO_SPEND` and nothing written;
  - off-grid starts (10:07, :30 s, +1 ms, outside the hours, a DST gap instant) → `RDV_SLOT_GONE` and NO customer row;
  - throttled → nothing written (keys include `t:rdv:p:<pro>:ip:<hash>`);
  - the hold ceiling for a typed address (and none for a verified one);
  - typed `too_many_holds` → neutral sentence;
  - `stale` (tz switched by `afterPlan`) surfaced;
  - notice crossed between render and submit → RDV `unavailable` copy;
  - honeypot;
  - an English zod message never surfaces (malformed `startsAt`, answers).
- Second pro: pro A's slug with pro B's type, offer or start → `not_found` copy; no customer created at either pro; B's
  calendar unchanged.
- Gate: the full DB suite in chunks.

**T10. RDV wording: e-mails, merci, return block, pro UI**

- Files:
  - `src/lib/notify-core.ts` and `src/lib/emails/{booking-confirmed,pro-new-booking,late-payment}.ts`, with their tests;
  - `src/lib/public/merci-view.ts` and `checkout-return-view.ts`;
  - `src/lib/back-office/planning-actions.ts:56` and `src/lib/booking/series.ts:141`;
  - `src/lib/back-office/confirm-copy.ts` (LED:309);
  - `src/components/dashboard/occurrence-dialog.tsx:239-241`.
- Tests:
  - each template, RDV and séance variants, with `escapeHtml` of a hostile type name;
  - `merciCopy` RDV states;
  - the conflict copy for a free RDV;
  - `notify-core.db.test.ts`: `isRdv` for an RDV booking.

### G2: pages and UI

**T11. The RDV page (server)**

- Files: `src/app/[slug]/rdv/[ticketTypeId]/page.tsx`, `loading.tsx`, `src/lib/public/rdv-view.ts` (pure),
  `page-wiring.test.ts` lists. Consumes T6, T7 and T8. See § 3.3 and § 3.11.
- Pure tests (Paris and LA):
  - `rdvWeekKey` (default week from `now + notice`; garbage parameter; beyond the horizon);
  - `rdvWeekNav` (no previous before the current week, no next past the horizon week);
  - day labels from DateKeys across both DST weeks;
  - chip `ariaLabel` with the full date and time in the pro tz;
  - `canSpendAt` (expiry equal to the start → not usable; `leftAfter` counts this type only);
  - `offersCoveringAt`.
- Source guards: the metadata reads no viewer; one `resolvePublicPro`; `notFoundMetadata`; `no-referrer`.
- Browser (1280 and 375):
  - 404 parity for malformed, unknown, archived, not-RDV and foreign ids (« Page introuvable », noindex);
  - the empty week and the next-week link;
  - the time-zone line;
  - an RDV occurrence URL `/seance/{rdvId}` redirects to `/espace` (P4CON:1593).

**T12. `rdv-booking` client component**

- Files: `src/components/public/rdv-booking.tsx` (+ a small `rdv-week-picker.tsx` if it helps). Reuses `IdentityFields`,
  `QuestionFields` (`BOOLEAN_ANSWERS`), `OtpDialog`, `heldTicketLabel`, `payLabel` and `safeCheckoutUrl`. Load
  `design-taste-frontend` first.
- Behaviour:
  - `startsAt` posted is the server ISO verbatim (never rebuilt from wall time);
  - submit disabled while pending;
  - `router.push` alone after an action; `window.location.assign` for Checkout;
  - focus to the result line or to the first field error;
  - `aria-pressed` on day and time chips;
  - list per day below 640 px.
- Pure tests: the mode derivation per slot (§ 3.6).
- Browser:
  - the free booking on « Appel découverte »: mock mail logged, the espace shows it, the pro planning shows it, cancel
    from the espace frees the slot;
  - held with the Beatriz quick login (« Réserver avec 1 ticket (il vous en restera N) »);
  - buy in mock mode → merci with RDV copy; « Libérer ma place » from `/rdv/…?paiement=annule&p=` frees the slot;
  - two tabs on one slot → the second shows « Ce créneau vient d'être pris. » and the chip vanishes;
  - `OtpDialog` Tab trap and focus return;
  - the 18:30 and 19:30 « Cours particulier » slots are absent on days with the 19:00 séance (demo hours 17:30-20:30,
    `scripts/content/altinha.ts:103-107`);
  - clean console, no horizontal scroll at 375.

**T13. Cards on `/[slug]`, the espace link and the back-office touches**

- Files:
  - `src/components/public/rdv-cards.tsx` and `src/app/[slug]/page.tsx` (cards);
  - the espace wallet component (RDV-type ticket → RDV page link);
  - `src/app/dashboard/tickets/[id]/page.tsx` and `ticket-type-card.tsx` (public link, « Non réservable en ligne »
    reasons; O14 and P4CON:1353);
  - `src/lib/back-office/event-reads.ts` (phantom filter in `countRdvConflicts`);
  - optional LED:322 in `type-hours-editor.tsx`.
- DB tests: `countRdvConflicts` ignores a phantom RDV and counts a live hold.
- Pure tests: card VM (« Gratuit », « À partir de », `formatMoney`, plural).
- Browser:
  - cards at 1280 and 375;
  - the back-office link opens the page;
  - the warning shows for a type with no hours;
  - the event editor's conflict count ignores an abandoned checkout;
  - the landing hero and `/demo` are unchanged (`DayCalendar` untouched).

**T14. Final sweep and the P5 outcome**

- Steps:
  - full DB suite in chunks; pure suite under the two host zones; tsc; eslint on every file changed since the P5 base;
    `next build` (the RDV route `ƒ`);
  - greps: no `computeSlots(` with `sessions`; no `new Date(` building an instant in client components; no
    `router.refresh()` after an action; no dash;
  - a browser tour of every P5 route at 1280 and 375.
- Write `docs/superpowers/plans/<date>-p5-rdv-libre-outcome.md` in the P2-P4 format:
  - Rulings;
  - the « For the owner » list (the Changes to spec of § 4 and the product calls);
  - P6 carries (AGENTS.md `slots.ts` lines; P3CON:763 and :820 drift; buffers in the planning; the « Prochain créneau »
    option);
  - deferred minors;
  - test data left on tickets-dev.

---

## 6. Review Focus (the failure modes most likely to bite)

| # | Failure mode | Why the tests miss it | Owning tasks and proof |
|---|---|---|---|
| 1 | **Identity from input.** `held_ticket` spends with an `upsertCustomer` id, a guest cookie or an impersonated session. A `resumeHref` or a purchase id is returned to a typed address. `ticketTypeId`, `offerId` or a customer id is accepted without the slug's pro. The per-slot ticket count is shown to a non-Owner | Core tests hand the core a visitor they built; a wrapper or page that builds it wrongly passes them | T9 (security cases), T11 (page reads `owner` only), T12 (no wallet props for non-Owners). `src/server/public.test.ts` pins the wrapper; reviewers grep `customerId:` in `rdv-actions.ts` |
| 2 | **Slot grid not enforced, or loader/engine drift.** An off-grid or sub-minute start is accepted (`fitsAvailability` floors seconds). The loader uses wall-clock ends, starts/ends instead of stored blocks, the candidate's buffers on other RDVs, the spec's `> now` hold boundary, its own rules resolution, or filters séances (private, archived) the engine does not | Each side is tested alone; a mismatch only shows as a refused slot (`unavailable` or `slot_taken`) in a real booking | T3 (property test), T6 (agreement tests against the real engine), T9 (off-grid cases write nothing). Reviewer: `loadRdvType` and `rdvRules` are imported from `claims.ts`, never re-implemented |
| 3 | **Double booking and races.** The EXCLUDE dropped or its predicate changed; the same-customer double submit mis-handled; a hold not counted as busy; a lapsed hold shown busy forever; the `buy` fall-through committing an RDV without a booking | Sequential tests never collide; T6 lives in the engine suite | T4 (`else throw` + I5), T9 (O1 parallel tests through the core), T12 (two-tab browser check). Spec risk 2: T6 must fail if the EXCLUDE disappears (L1811) |
| 4 | **Time zones and DST.** Instants built in the browser or host zone; `+ 86 400 000` day steps; the wall-clock end; gap starts not refused; a duplicated fall-back hour; week bounds from instants; the horizon compared in UTC; « today » from the host clock; a `stale` tz change silently retried | The dev machine runs Europe/Paris; DST days are rare | T3 (four DST days, three host zones), T6 (DB DST weeks with an injected `now`), T11 (labels from DateKeys). Reviewer greps client components for `new Date(` and `getTimezoneOffset` |
| 5 | **Payments and holds.** The cancel URL still pointing at `/seance/` (it loses `p`); the mock path not branched; Checkout facts from a second read that disagrees with the guarded snapshot; no release on a Stripe failure; a resume URL to someone else's purchase; RDV copy missing on merci and late payment | Mock mode hides Stripe; the RDV branch of shared helpers is easy to skip | T4 (`checkout` facts test), T8 (paths), T9 (failure releases), T10 (copy), T12 (mock buy and release in the browser) |
| 6 | **Abuse.** The throttle consumed after `upsertCustomer` or Stripe; no `perProIp`; the hold ceiling skipped; a free RDV unbounded; a slot render scanning the whole horizon; a typed address learning another customer's state (`too_many_holds`, resume) | Each bound is tested once; a new path that forgets a call passes everything else | T2 (pins), T9 (step order: throttled → zero rows; keys asserted), T6 (far-week returns nothing) |
| 7 | **Tenancy.** A busy read without `professional_id`; another pro's séances, time off or RDVs blocking or freeing slots; foreign type or offer ids; the `customer-space` joins; reference pages | Most DB tests use one pro | T6, T7 and T9 second-pro cases; reviewer checks every new SQL `where` for `professional_id = $p` |
| 8 | **Copy, accessibility and 404 parity.** Séance wording on an RDV (« Séance », « inscription », « place »); a dash; chips without full date and time names; focus lost after `router.push`; different responses for archived vs unknown types (an oracle) | Copy is partly tested; focus and parity only show in a browser | T2, T10 (copy pins), T11 (404 parity), T12 (a11y tour) |

---

## 7. Residuals accepted (to restate in the P5 contract)

- Busy times are visible as missing slots, private séances included (L873-874).
- A free RDV can be booked by any typed address within the throttles (§ 3.9).
- A pro may create an event or time off over a live RDV hold, which payment then confirms (L901-902).
- Hours narrowed in the same milliseconds as a booking are not re-guarded (O27).
- The fall-back repeated hour offers no slot start (identical to the engine).
- `p5-public.md` was written while another agent edited the public server files. Line numbers in
  `public-context.ts`, `public-queries.ts`, `visitor.ts` and `client-queries.ts` are given at `281f64b`; the plan must
  re-check them.
