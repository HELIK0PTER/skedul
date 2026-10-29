# P6 inventory

Date 2026-10-29. Sources read: the P2 to P5 outcomes, ledgers, final reviews and P5 gate report, spec § 13.8 and § 15, and the code survey of the "texts" and "golive" readers. 277 raw items from 6 readers, each checked again against the worktree. HEAD 9b36d67 (clean).

## Open items by group

### A. Security and behaviour carries
Order of work: security first (A1 to A11), then engine behaviour, then UI behaviour, then a11y, then tests.

- [ ] **A1** Same-tenant guard on domain foreign keys and engine joins (M, security)
  - Detail: Every domain FK uses one column, and ELIGIBLE joins ticket_type and event with no professional predicate. A crossed row would be accepted, and a NO ACTION link would make deleteUser of the other pro fail with 23503. Add same-tenant checks to the nightly unscoped invariants (I2a, ticket to purchase, booking to occurrence and customer) or decide on composite (professional_id, id) keys. Make paidPurchaseOf refuse an empty professionalId. Add professional_id predicates to the planning, dashboard and payments joins on event and ticket_type (unsure part: no reachable path was found).
  - Files: src/lib/booking/invariants.ts, src/lib/booking/eligibility.ts, src/lib/booking/revenue.ts, src/lib/back-office/planning-reads.ts, dashboard-reads.ts, payments-reads.ts
  - Sources: p2 (Task 15 minor), p4 (final review ID recommendations, composite-key line), p3 (declined line 196)
  - Evidence: eligibility.ts:27-31 joins tt and e with no scope (only `t.professional_id = o.professional_id` at :31); revenue.ts:25 `if (opts.professionalId)`.
- [ ] **A2** Sign-up race can keep a password on a verified user (M, security)
  - Detail: In a one round-trip window, a code sign-in can verify the address between createUser and linkAccount of a /sign-up/email request. Run the password sign-in credential check on /sign-up/email, under the same locks.
  - Files: src/lib/auth-options.ts
  - Sources: p2 (Final minor, outcome line 137)
  - Evidence: auth-options.ts:46 `PASSWORD_SESSION_PATHS = [PASSWORD_SIGN_IN_PATH, CHANGE_PASSWORD_PATH]`, with no SIGN_UP_PATH.
- [ ] **A3** Password-reset timing enumeration and unmailed token rows (S, security)
  - Detail: /request-password-reset waits for the mail only when the account exists, so the response time reveals which addresses have accounts. Send the mail through advanced.backgroundTasks (or another equal-time path), and stop a capped request from leaving a 1 h verification row.
  - Files: src/lib/auth-options.ts, src/lib/auth.ts
  - Sources: p2 (Task 32 minor)
  - Evidence: grep backgroundTasks in src: no match.
- [ ] **A4** Admin user search moves off its GET form (M, security)
  - Detail: An e-mail or name typed by an admin lands in request logs and browser history. Move the search to a Server Action kept in component state (as Decision 73 did for the pro), then remove the GET_FORMS exemption.
  - Files: src/app/admin/users/page.tsx, src/test/form-method.test.ts:23-27
  - Sources: p4 (G4b ruling, residuals, P6 carry), golive
  - Evidence: admin/users/page.tsx:28-38 reads searchParams; :77 `name="q"`.
- [ ] **A5** Branding and onboarding actions: validate image URLs, move to cores (M, security)
  - Detail: updateBranding stores any external bannerUrl or avatarUrl, and the public page renders it. Restrict both to the project's Blob host or the avatar pack paths. In the same pass, make createProfessionalProfile one db.batch, move updateSlug and updateBranding from requirePro to runProAction cores, and catch the bare awaits in the two forms.
  - Files: src/server/pro.ts, src/components/dashboard/slug-editor.tsx:50, branding-form.tsx:195
  - Sources: p3 (declined line 191, UI-4, Task 1), p2 (Task 4 minor), golive
  - Evidence: pro.ts:176 `bannerUrl: input.bannerUrl ?? null`, :181-182 avatarUrl; pro.ts:68, :81 and :87 are three separate awaits.
- [ ] **A6** Refuse the Google Calendar link while an admin impersonates a pro (S, security)
  - Detail: As it stands, an admin could link their own Google account to a pro's calendar. Refuse it in the card and in finalizeGoogleConnection.
  - Files: src/components/dashboard/google-calendar-card.tsx, src/server/pro.ts
  - Sources: p3 (declined line 192)
  - Evidence: grep « imperson » in both files: no match.
- [ ] **A7** logSafeMessage misses percent-encoded addresses (S, security)
  - Detail: Mask addresses written with %40, and the domain of a second comma-joined address.
  - Files: src/lib/log-safe.ts
  - Sources: p3 (Task 5 minor)
  - Evidence: log-safe.ts:26 AT_WORD only matches a literal « @ ».
- [ ] **A8** Rate limit on /api/track (S, security)
  - Detail: The page-view beacon has no throttle. Add one before go-live traffic.
  - Files: src/app/api/track/route.ts
  - Sources: p4 (RND declined line, admin-space carry)
  - Evidence: grep throttle|rate in route.ts: no match.
- [ ] **A9** Server-side plain-name check on the e-mail code sign-in (S, security)
  - Detail: The name is checked in the browser only. Add the server check: it costs one call, and the name can reach a pro-visible customer row.
  - Files: src/lib/auth-options.ts, src/lib/public/plain-name.ts
  - Sources: p4 (residuals accepted)
  - Evidence: isPlainName appears only in sign-in-flow.ts, plain-name.ts and email-code-form.tsx; none in auth-options.ts.
- [ ] **A10** rel="noopener" on « Voir la page de réservation » (S, security)
  - Files: src/app/dashboard/tickets/[id]/page.tsx:131
  - Sources: p5 (D1 note 6)
  - Evidence: :131 `<Link href={publicPath} target="_blank">`, no rel in the file.
- [ ] **A11** Production-build check of the RDV page 404 (S, security)
  - Detail: Run next build and next start, fetch /altinha-paris/rdv/<unknown id> and /<archived id>, and diff the bodies to rule out an existence oracle. Record that both answer HTTP 200 with noindex (the accepted streamed-404 pattern).
  - Sources: p5 (carry 8, Group C minor), golive (test and go-live items)
  - Evidence: no P6 report exists; the P5 gate report (:177, :197-199) says the production HTML was not compared.
- [ ] **A12** One shared hold-lapse boundary (M, code-fix)
  - Detail: Pick one rule (live: `hold_expires_at > now`, elapsed: `<= now`). Route every inline copy through lapsedHold() or a shared SQL fragment that atomic.ts can import.
  - Files: src/lib/booking/holds.ts, src/lib/db/atomic.ts, booking/release.ts, booking/catalog.ts, back-office/{event-reads,client-reads,planning-view,planning-reads,payments-reads,dashboard-reads}.ts, public/{booking-actions,spendable,seance-reads}.ts
  - Sources: p3 (Tasks 21, 36), p4 (X recommendation LED:384), p5 (carry 5, T6 ruling), golive
  - Evidence: atomic.ts:158 `<`, release.ts:83 `<`, event-reads.ts:390 `<` but :530 `>`, catalog.ts:80 `>`, booking-actions.ts:118 `>` but :375 `<`, client-reads.ts:322 and planning-view.ts:126 `<=`, dashboard-reads.ts:143 and planning-reads.ts:587 gte, seance-reads.ts:251 lte.
- [ ] **A13** Lapsed but unswept holds count as registrants in cancels and series edits (M, code-fix)
  - Detail: A client whose hold already lapsed still gets a « séance annulée » mail and a cancelled/pro booking. Capacity cuts and « N inscrits prévenus » counts include lapsed holds. Expire the lapsed holds of the locked set first, then count only confirmed bookings or live pending ones. The mails already filter live holds at send time.
  - Files: src/lib/booking/cancel.ts, src/lib/booking/series.ts, src/lib/notify-core.ts
  - Sources: p2 (Task 26, Final CON1/CON2), p3 (Task 22, unsure part)
  - Evidence: expireElapsedHolds is called only at claims.ts:1097 and release.ts:94; series.ts:69 takes every pending booking; notify-core.ts:352 filters live holds.
- [ ] **A14** cancelOccurrence repeat path and the ticketReturned flag (S, code-fix)
  - Detail: Prepend lockRows to the repeat cancel and emit no google.sync on a no-op. Make cancelByClient report ticketReturned only when the returned ticket can still be used.
  - Files: src/lib/booking/cancel.ts
  - Sources: p2 (Task 25 minor)
  - Evidence: cancel.ts:275-284 (no lockRows), :31-36 countReturned counts every 'return', :191 `ticketReturned: returned > 0`.
- [ ] **A15** Series edge-case residuals (M, code-fix)
  - Detail: Six edge cases remain:
    - count-mode segments slip past the restore guard;
    - restore is not serialized with the archive;
    - a cancelled « à part » seance cannot be restored;
    - the TIM1 bound ignores kept isolated seances;
    - detached seances are selected by series_date (CON3);
    - the booked-branch UPDATE in deleteSeriesFrom lacks `archived_at is null`.
  - Files: src/lib/booking/cancel.ts, src/lib/booking/series.ts
  - Sources: p2 (Task 28, Final)
  - Evidence: cancel.ts:338 `e.until_date is not null and ...`; series.ts:944-947 has no archived_at predicate.
- [ ] **A16** Nightly sweepHolds is one all-pros batch (M, code-fix)
  - Detail: One drifted occurrence blocks the whole sweep, and the cron answers 500. Isolate per pro or per occurrence, and return google.sync effects like releasePurchase does.
  - Files: src/lib/booking/release.ts, src/lib/booking/nightly.ts
  - Sources: p2 (Task 22), p4 (residual OUT:118)
  - Evidence: release.ts:80-102 is a single atomic() that returns only `{ expiredBookings }`.
- [ ] **A17** editEventInPlace: an outdated version reads as « Question inconnue » (S, code-fix)
  - Detail: Check the version before the question ids. Also: an empty patch should not bump version, and « séance modifiée » recipients come from a plain post-commit read.
  - Files: src/lib/booking/series.ts:316-343
  - Sources: p2 (Task 27)
  - Evidence: series.ts:316-343 throws `PlanError("invalid", "Question inconnue.")` with no version read.
- [ ] **A18** mapDbError fallbacks hide engine bugs and race codes (S, code-fix)
  - Detail: Split occurrence_seats_chk, or log the fallbacks: today 23514 maps to invalid or full, 23503 maps to stale, and a second 40P01 is rethrown. moveAttendee should answer stale on a race.
  - Files: src/lib/db/map-db-error.ts, src/lib/db/schema.ts:495
  - Sources: p2 (Task 14, Final)
  - Evidence: map-db-error.ts:20 `occurrence_seats_chk: "full"`.
- [ ] **A19** generated_until can move backwards (S, code-fix)
  - Detail: Two ensureHorizon plans can commit out of order. Use `greatest(generated_until, $gu)`.
  - Files: src/lib/booking/occurrences.ts:312
  - Sources: p2 (Task 18)
  - Evidence: occurrences.ts:312 `update event set generated_until = ${w.generatedUntil}::date`.
- [ ] **A20** A half-set validity snapshot on ticket_purchase never expires (S, code-fix)
  - Detail: Add a pair CHECK in migration 0013 (D1), or make validityOf fail closed.
  - Files: src/lib/ticket-expiry.ts:23-26, src/lib/db/schema.ts:568-570
  - Sources: p2 (Task 10)
  - Evidence: ticket_offer_validity_chk exists at schema.ts:297; ticket_purchase has no such CHECK.
- [ ] **A21** spendTicket trusts the booking id it is given (S, code-fix)
  - Detail: Derive customerId and occurrenceId from the booking, or extend assertSpent, so a caller mistake cannot cross-link rows.
  - Files: src/lib/booking/eligibility.ts:56-78
  - Sources: p2 (Task 16)
  - Evidence: eligibility.ts:76-78 only checks that some ticket is booked on that booking.
- [ ] **A22** Id tie-breaks rely on collation; the series question copy has none (S, code-fix)
  - Detail: SQL `t.id` and JS `a.id < b.id` agree only under the C collation, so add `collate "C"` or document it. Add an id tie-break to the question copy.
  - Files: src/lib/booking/eligibility.ts:34, src/lib/wallet-rules.ts:68, src/lib/booking/series.ts:691
  - Sources: p2 (Tasks 12, 16, 17, 19)
  - Evidence: eligibility.ts:34 `order by t.expires_at asc nulls last, t.created_at, t.id`.
- [ ] **A23** Pure helper hardening: dates, recurrence, guest link (S, code-fix)
  - Detail: Several pure helpers accept bad input:
    - parseKey accepts years 0-99;
    - addDays and dayOfWeek do not validate keys;
    - the recurrence « skip » sentinel is typed as a string, and countDatesBefore is O(days);
    - signGuestLink signs inputs that verifyGuestLink rejects, with no length cap.
  - Files: src/lib/civil-date.ts:34-42, src/lib/recurrence.ts:103, src/lib/guest-link.ts:29-31
  - Sources: p2 (Tasks 7, 8, 11)
  - Evidence: as cited by p2; key strength is done (env-checks.ts:15).
- [ ] **A24** tickets.ts schema and message minors (S, code-fix)
  - Detail: Several schema and message gaps:
    - customerInputSchema runs z.email() before trim;
    - choice options can repeat;
    - too_many_holds hard-codes « deux »;
    - « 5 ans » duplicates BOUNDS.untilYears;
    - a stray occurrenceCount gets « Indiquez la date de fin. ».
  - Files: src/lib/tickets.ts:36, :67, :159, :164, src/lib/pro-messages.ts:36, src/lib/tickets-vocab.ts:257
  - Sources: p2 (Task 1)
  - Evidence: as cited.
- [ ] **A25** The orphan payment counter counts deliveries, not payments (S, code-fix)
  - Detail: Dedupe by event, session or payment intent id, so that a Stripe redelivery cannot inflate the admin alert.
  - Files: src/lib/booking/fulfillment.ts:100-103, src/lib/throttle.ts:151
  - Sources: p2 (Task 21), p4 (Task 13)
  - Evidence: bumpHealth(..., 1) runs on every call.
- [ ] **A26** Auth mails are HTML-only; subject redaction hard-codes 6 digits (S, code-fix)
  - Detail: Add a text part to sendEmail (deliverability of login codes). Drive the redactSubject regex from CODE_LENGTH.
  - Files: src/lib/email.ts, src/lib/emails/redact-subject.ts, src/lib/public/sign-in-flow.ts:13
  - Sources: p2 (Task 31), p4 (COV-M7)
  - Evidence: email.ts:18 and :32 take `html` only; redact-subject.ts:9 `/\b\d{6}\b/g`.
- [ ] **A27** writeAuthLog prints « unknown error » when Better Auth passes an Error as the message (S, code-fix)
  - Files: src/lib/auth-options.ts:212-213
  - Sources: p4 (ledger line 252)
  - Evidence: :213 `logSafeMessage({ message })` with no `instanceof Error` branch for the message.
- [ ] **A28** runProAction and runProQuery resolve the context outside the try (S, code-fix)
  - Detail: A DB or auth outage rejects the action instead of returning UNEXPECTED_ERROR. Add a runProActionWith(deps) core so the branches can be tested.
  - Files: src/server/pro-context.ts
  - Sources: p3 (Task 6)
  - Evidence: pro-context.ts:79 and :102 `await requireProContext()` run before `try {` at :81 and :103.
- [ ] **A29** moneyInputValue loses the sign; wrong-case IANA links pass (S, code-fix)
  - Detail: moneyInputValue(-5) gives « 0,05 » (latent, since prices are CHECK > 0). America/MONTREAL passes isValidTimeZone.
  - Files: src/lib/back-office/format.ts:157-161, src/lib/timezones.ts:35
  - Sources: p3 (Tasks 3, 7), p4 (LED:68)
  - Evidence: Math.trunc(-5/100) is -0.
- [ ] **A30** Lost update on concurrent ticket type or offer patches (M, code-fix)
  - Detail: Type and offer edits are read-modify-write with no version guard, so two tabs can overwrite each other.
  - Files: src/lib/back-office/catalog-actions.ts
  - Sources: p3 (Task 10)
  - Evidence: grep « version » in catalog-actions.ts: 0 hits.
- [ ] **A31** Accent-insensitive client and planning search (M, code-fix)
  - Detail: Searching « Elodie » does not find « Élodie ». Fix it with unaccent (a migration) or a JS fold, and stop listing abandoned-checkout customers.
  - Files: src/lib/back-office/client-reads.ts, planning search
  - Sources: p3 (Tasks 21, 31), p4 (LED:338)
  - Evidence: grep unaccent in src: 0.
- [ ] **A32** Google backfill beyond 200 booked occurrences (M, code-fix) (owner decides whether it ships in P6)
  - Detail: Add a « resync » button, or a nightly sweep with a per-pro « backfill pending » marker (needs a migration). Otherwise document the limit.
  - Files: src/lib/calendar-backfill.ts, src/app/api/cron/daily/route.ts
  - Sources: p3 ([P4] carry, COV-2), p4 (FR:COV-2), golive
  - Evidence: calendar-backfill.ts:20 `BACKFILL_MAX = 200`; nothing acts on `more`.
- [ ] **A33** Google reconnect: reuse or clean up the old « Skedul » calendar (M, code-fix) (after the owner decision)
  - Detail: Every connect creates a new calendar, and the old one keeps stale events.
  - Files: src/server/pro.ts (finalizeGoogleConnection, disconnectGoogleCalendar), src/lib/google-calendar.ts:31-41
  - Sources: p3 ([P6] line 120), p4, golive
  - Evidence: pro.ts:233 always calls createSkedulCalendar; pro.ts:249 « the Skedul calendar is left in place ».
- [ ] **A34** router.refresh() after a Server Action in nine inherited components (M, code-fix)
  - Detail: Drop each refresh where the action already revalidates. These refreshes risk a stale view and the Next 16.2.9 push-plus-refresh hang.
  - Files: src/components/admin/{admin-sidebar:106, support-admin-panel:63, support-faq-editor:52, dev-board-card:44, user-actions:60}.tsx, support/message-composer.tsx:73, dashboard/{slug-editor:58, branding-form:206, google-calendar-card:54}.tsx
  - Sources: p5 (carry 6, gate § 6c), golive
  - Evidence: grep router.refresh() in src/components: exactly these 9 lines, plus auth and merci ones that are pinned by guards.
- [ ] **A35** Show the « Test » badge on test-paid bookings in the pro planning (S, code-fix)
  - Detail: A seat paid in test mode looks real in /dashboard/planning. The badge exists only in the booking dialog, client purchases and payments table.
  - Files: src/lib/back-office/planning-reads.ts, src/components/dashboard/planning-*.tsx, occurrence-dialog.tsx
  - Sources: p4 (SEC-M14 second half), golive
  - Evidence: grep livemode in planning and occurrence files: 0 hits.
- [ ] **A36** Merge the two « Annuler le rendez-vous » controls of the RDV planning dialog (S, code-fix)
  - Files: src/components/dashboard/occurrence-dialog.tsx:546, src/lib/back-office/confirm-copy.ts:64
  - Sources: p5 (carry 9)
  - Evidence: occurrence-dialog.tsx:546 is the footer control; confirm-copy.ts:64 is the row label.
- [ ] **A37** The RDV type hours editor keeps its coarser range check (S, code-fix)
  - Detail: Use firstRangeProblem and the invalid prop, as the general availability editor does.
  - Files: src/components/dashboard/type-hours-editor.tsx
  - Sources: p5 (T13 ruling, LED:322)
  - Evidence: firstRangeProblem is used only in availability-editor.tsx and week-hours.ts.
- [ ] **A38** Draw RDV buffers in the pro planning (M, code-fix) (optional: not in the spec, O32)
  - Files: src/components/dashboard/planning-calendar.tsx
  - Sources: p5 (carry 3)
  - Evidence: grep buffer|marge in planning-calendar.tsx: 0.
- [ ] **A39** Accepted P5 RDV residuals: fix or document (S, code-fix) (unsure)
  - Detail: Three accepted residuals:
    - the Checkout product name is read at plan time (claims.ts:1079);
    - an Owner whose own hold is on another type gets no resume link (rdv-actions.ts:93);
    - coversUntil can disagree around local midnight (rdv-reads.ts:119).
  - Sources: p5 (Group A concern 3, Group B concerns 1 and midnight)
  - Evidence: as cited; all three were accepted as cosmetic or safe.
- [ ] **A40** Slug editor and branding « saved » status: check-mark glyph and no live region (S, a11y)
  - Detail: Use the shared SavedStatus pattern (role=status, no U+2713).
  - Files: src/components/dashboard/slug-editor.tsx:78, branding-form.tsx:569
  - Sources: p3 (Task 1, UI-3)
  - Evidence: slug-editor.tsx:78 `<span className="text-green-700">Adresse mise à jour ✓</span>`.
- [ ] **A41** Form group errors, repeated « Modifier » names, ConfirmDialog tab order (S, a11y)
  - Detail: Override and question group errors carry no aria-invalid. Every type card has the same « Modifier » link name. flex-col-reverse on mobile makes the tab order differ from the visual order.
  - Files: questions-editor.tsx, window-override-fields.tsx, ticket-type-card.tsx:79, confirm-dialog.tsx:81
  - Sources: p3 (Tasks 19, 11, 8)
  - Evidence: as cited.
- [ ] **A42** Admin success notices below AA contrast (S, a11y)
  - Detail: text-success on bg-success-muted gives about 3:1. Use the darker green, and extend the text-success guard of final-review-ui.test.ts:122 to src/app/admin and src/components/admin.
  - Files: src/app/admin/users/page.tsx:64, src/components/admin/user-actions.tsx:199
  - Sources: p3 (declined line 197), golive
  - Evidence: both lines use `bg-success-muted ... text-success`; globals.css:24-25.
- [ ] **A43** link-google-form keeps its own error class (S, a11y)
  - Detail: Move both alert regions onto FormError alwaysMounted.
  - Files: src/components/auth/link-google-form.tsx:78, :141
  - Sources: p4 (G4c deviation 6)
  - Evidence: `<p role="alert" className={error ? ERROR_CLASS : "sr-only"}>`.
- [ ] **A44** RDV week navigation drops keyboard focus at the first and horizon weeks (S, a11y)
  - Files: src/app/[slug]/rdv/[ticketTypeId]/page.tsx:93, :107
  - Sources: p5 (R4)
  - Evidence: both lines render `<Button ... disabled>` in place of the Link.
- [ ] **A45** P3 Task 12 UI polish wave never run (M, a11y) (unsure)
  - Detail: The wave covers:
    - the delete double-click window;
    - stale error and archived notices;
    - the « En vente » switch on an archived type;
    - OfferDialog initial focus;
    - destructive hover contrast (about 4.0:1);
    - the archived banner at 4.51:1.
  - Sources: p3 (Task 12, outcome line 167)
  - Evidence: not re-verified one by one; the destructive token itself is fixed (globals.css:26).
- [ ] **A46** P6 browser tour on tickets-dev (M, test)
  - Detail: G4c/G4b checks: the unverified name prefill on the offer page, two releases announced twice, the beacon body, and the read-only offer state.
  - Detail: P3 paths: a real « Déplacer » submit, the time-off « Annuler » branch with its mail, archiving a used type, ensureHorizon via after(), F1 « Segments suivants », and UI-1 refocus after delete.
  - Detail: Responsive checks at 375 and 768 px, RecurrencePreview aria-live, and Escape in the « Inscrire » search (unsure).
  - Sources: p4 (G4c/G4b undone), p3 (For the owner line 18, UI-1, F1, declined line 198, Tasks 33, 36, 37)
  - Evidence: no later ledger records these paths; P4 Task 19 only covered the verify-email banner.
- [ ] **A47** Engine DB test gaps from P2 Tasks 9 to 30 (L, test)
  - Detail: Missing cases: eligibility mutations, cross-tenant refusals, afterPlan RDV guards, notice and horizon with overrides, DST and buffers, release of a paid buy and book, E5/E6b corners, cancelEmpty and retime against capacity_override, convert keeping purchase_id and expires_at, a detached row on a vanishing date, and checkInvariants on T11 state.
  - Sources: p2 (Tasks 9-30 minors)
  - Evidence: docs/superpowers/plans/2026-10-12-p2-domaine-outcome.md:105-126; no later outcome closes them.
- [ ] **A48** Pure test gaps: constants, recurrence caps, guest link (M, test)
  - Detail: Missing: per-frequency interval caps and positive cases, HORIZON_REFRESH_DAYS > bookingHorizonDays.max, monthlyDayWarning beyond 31, the canonical base64url twin, and a health DB test beyond the happy path.
  - Sources: p2 (Tasks 1, 8, 11, 13)
  - Evidence: tickets.test.ts:115-121 only checks HORIZON_REFRESH_DAYS < MATERIALIZE_DAYS.
- [ ] **A49** DB harness robustness (S, test)
  - Detail: Five issues:
    - createTestPro uses two inserts (make it one db.batch);
    - a failing cleanup hides the real error;
    - the quota barrier hangs until 120 s;
    - the lock test depends on timing;
    - sweep tests use a future now on the shared branch.
  - Files: src/test/db.ts:58-72, :103-104
  - Sources: p2 (Tasks 6, 14, 20, 22)
  - Evidence: as cited.
- [ ] **A50** bootstrap-content guard and catalog values under-tested (S, test)
  - Detail: Test the customer clause of hasCatalogOrClients (insert a customer, expect has_data). Assert prices, validity and links, not counts only.
  - Files: src/lib/booking/content.db.test.ts
  - Sources: p2 (Task 34)
  - Evidence: content.db.test.ts:29 and :96 use hasDomainData, not the bootstrap guard.
- [ ] **A51** Deferred P3 test minors and the untested read caps (M, test)
  - Detail: Missing tests:
    - RECORD_BOOKINGS_MAX (300) and PAYMENTS_LIMIT (200);
    - the getPlanningPage helpers;
    - the Google 409/404/410 mapping;
    - feed ordering.
  - Detail: Two weak tests to fix: the tickets-vocab « imports nothing » test misses export-from, and two refusal tests assert only ok:false.
  - Files: src/lib/back-office/client-reads.ts:42, payments-reads.ts:34
  - Sources: p3 (Tasks 2, 10, 21, 29, 31, 36, 39), p4 (LED:338, LED:384)
  - Evidence: neither constant appears in any test file.
- [ ] **A52** Weak gateway tests (S, test)
  - Detail: The « shop session has the same shape » test skips expires_at, success_url and the customer fields.
  - Files: src/lib/payments/checkout.test.ts:76-87
  - Sources: p4 (Task 6)
  - Evidence: as cited.
- [ ] **A53** profile-guard lists server-only modules by hand (S, test)
  - Detail: Glob src/server/* instead of keeping a fixed list.
  - Sources: p4 (G4b, ledger line 207)
  - Evidence: no src/server glob in the guard.
- [ ] **A54** Pure rdv-actions cases run only with the DB suite (S, test)
  - Detail: Split the schema, message, honeypot, held refusal and mock gateway cases into rdv-actions.test.ts.
  - Sources: p5 (Group B concern 2)
  - Evidence: glob src/lib/public/rdv-actions*: only rdv-actions.ts and rdv-actions.db.test.ts.
- [ ] **A55** Auth tests pinned to Better Auth 1.6.19 log counts (S, test)
  - Detail: This is an accepted residual. Move the console swap in auth-options.test.ts to the shared captureConsole helper, so an upgrade is easier to review.
  - Sources: p2 (Task 33)
  - Evidence: no later outcome closes it.

### B. Copy pass (in-app UI and e-mail wording, dashes)

- [ ] **B1** Mixed-list « inscription » strings over seance + RDV lists (S, copy)
  - Detail: Reword the empty states and headings that sit over lists mixing seances and RDVs, and update messages.test.ts:235.
  - Files: src/lib/public/messages.ts:143, src/components/dashboard/client-bookings.tsx:182, :196, :202, upcoming-bookings.tsx:26, :31, src/app/admin/activity/page.tsx:201
  - Sources: p5 (carry 10), texts
  - Evidence: messages.ts:143 `NO_UPCOMING: "Aucune inscription à venir."`; client-bookings.tsx:182 « Inscriptions ».
- [ ] **B2** Three RDV edge messages (S, copy)
  - Detail: RDV_TICKETS_ONLY tells an Owner whose tickets all end before the start that she already has a ticket. « Personne n'est inscrit pour le moment. » shows on an RDV. The unavailability label uses a right-arrow (use « au »).
  - Files: src/lib/public/rdv-view.ts:199, :208, messages.ts:161, src/components/dashboard/occurrence-dialog.tsx:489-491, src/app/dashboard/unavailability/page.tsx:36
  - Sources: p5 (D3 minors, Group C arrow), texts
  - Evidence: occurrence-dialog.tsx:491 does not depend on isSeance; unavailability/page.tsx:36 uses the arrow.
- [ ] **B3** « Une séance isolée avec inscrits reste avant cette date » fires for never-booked leftovers (S, copy)
  - Detail: Reword it, or split the case (a leftover with registrants or without).
  - Files: src/lib/booking/series.ts:914-932, src/lib/back-office/event-actions.ts:76
  - Sources: p2 (Task 28)
  - Evidence: series.ts:932 and event-actions.ts:76 carry the same sentence.
- [ ] **B4** Back-office copy minors (S, copy)
  - Detail: Four fixes:
    - EVENT_START_PAST says the date is past when only today's hour passed;
    - « N clients trouvés » can show the read cap 8;
    - duplicated e-mail sentences should become shared constants;
    - formatTimeRange prints times only for overnight or DST ranges.
  - Files: src/lib/back-office/event-actions.ts:59, src/lib/back-office/format.ts:30-33
  - Sources: p3 (Tasks 16, 27, 3), p4 (LED:68)
  - Evidence: as cited; « valables » and the CR/LF tests are done (format.ts:73).
- [ ] **B5** ACCOUNT_EXISTS reveals an existing account at sign-up (S, copy)
  - Detail: Decide on neutral wording (owner input) and apply it. This is pre-existing Better Auth behaviour.
  - Files: src/lib/auth-messages.ts:11, :31-33
  - Sources: p4 (ledger line 239)
  - Evidence: as cited.
- [ ] **B6** /mon-espace greets a code-sign-in user with « Bonjour » alone (S, copy)
  - Detail: Use the customer name when user.name is empty.
  - Files: src/components/public/my-space.tsx:28
  - Sources: p5 (D1 note 7)
  - Evidence: `name.trim() === "" ? "Bonjour" : ...`.
- [ ] **B7** v1 words outside the landing and the demo (S, copy)
  - Files: src/components/auth/demo-quick-login.tsx:34, src/components/support/faq-browser.tsx:81, src/lib/support.test.ts:210-215, src/components/onboarding-form.tsx:69 (low priority)
  - Sources: p3 (LED:66 copy carry), p4, texts
  - Evidence: « Cliente · packs & réservations »; placeholder « Packs, mot de passe, Google Agenda »; « Comment créer un pack ? ».
- [ ] **B8** Three dashes in CSS comments, outside the copy guard (S, copy)
  - Files: src/app/globals.css:201 (U+2014), src/components/landing/landing.module.css:11, :13 (U+2013)
  - Sources: p5 (carry 7), p3, p4, texts, golive
  - Evidence: dash grep: globals.css 1 hit, landing.module.css 2 hits.

### C. Docs and texts (landing, demo, metadata, FAQ, README, AGENTS.md)
Order of work, because the landing reuses the demo screens and data: demo data and script, then screens and tests, then landing, then header and metadata, then the allowlist and guard, then the docs.

- [ ] **C1** Rewrite the guided demo script and data for tickets and events (L, copy)
  - Detail: The tour still tells the v1 story (services, a 10 h pack, credits) with v1 states and redirect URLs. It should show events, ticket types and offers, Planning, Boutique, « J'ai déjà des tickets » and RDV libre from the real catalog (scripts/content/altinha.ts:111-148). Rename the step ids and the landing deep links to match.
  - Files: src/components/demo/demo-script.ts, demo-data.ts
  - Sources: texts (spec § 13.8, § 15.1)
  - Evidence: demo-script.ts:179 « Acheter un pack d'heures », :181 « carnets prépayés »; demo-data.ts:51-59 DEMO_PACK.
- [ ] **C2** Rewrite the demo screens that show packs, credits and prestations (L, copy)
  - Detail: Screens to rewrite: client-profile, client-pack, client-booking, client-confirmation, pro-event-types, pro-packs, pro-shell nav, pro-branding and pro-availability, plus the ScreenId names. This also fixes 2 of the 3 inherited eslint diagnostics (client-pack.tsx:40, client-profile.tsx:11).
  - Files: src/components/demo/screens/*, screens/index.tsx
  - Sources: texts, p3 ([P6] eslint), p4
  - Evidence: pro-packs.tsx:19 « Packs prépayés »; client-pack.tsx:40 `Finaliser l'achat`; client-profile.tsx:11 `ClientProfile(_: ScreenProps)`.
- [ ] **C3** Rewrite the two demo tests with the new tour (S, test)
  - Files: src/components/demo/demo-script.test.ts:14-57, demo-data.test.ts:26-33, :49 (a dash in a test name)
  - Sources: texts
  - Evidence: they pin creditsRemaining, hasCredits, packFormOpen and stepIndex("buy-pack").
- [ ] **C4** /demo page metadata and the tour dashes (S, copy)
  - Detail: The title combines with the root template « %s · Skedul » into a name ending « Skedul · Skedul », and contains a U+2014. The description promises « packs d'heures prépayées ». Remove the 17 dashes in src/app/demo and src/components/demo.
  - Files: src/app/demo/page.tsx:9-11, :33, demo-script.ts, demo-data.ts, demo-data.test.ts, screens/{pro-planning,pro-branding,outro}.tsx, demo-cursor.tsx, browser-frame.tsx
  - Sources: texts, p3 (copy pass), p4, p5 (allowlisted dashes)
  - Evidence: dash grep: demo/page.tsx 2, demo-data.ts 6, demo-script.ts 4, and 1 each in 6 more demo files.
- [ ] **C5** Rewrite the landing page copy and sections (M, copy)
  - Detail: Rewrite CLIENT_POINTS, PRO_POINTS, PACK_POINTS, STEPS, the hero sub-line, the #packs section with the ProPacks shot and its alt, the CTA blurb and `DemoLink step="buy-pack"`. Check the FAQ answer « un nom et une adresse e-mail suffisent » against the code sign-in.
  - Files: src/app/page.tsx (45-110, 198-199, 254, 273-307, 373, 115)
  - Sources: texts (spec § 13.8), p3
  - Evidence: page.tsx:283 « Chaque réservation retire un crédit. », :296 `<ProPacks ...>`, :302 `step="buy-pack"`.
- [ ] **C6** Rewrite the landing hero deck cards (S, copy)
  - Files: src/components/landing/hero-deck.tsx (241-291, 346-365, 424-439)
  - Sources: texts
  - Evidence: 4 « crédit » hits, e.g. :281 « crédit{plural} sur {credits} ».
- [ ] **C7** Header « Packs prépayés » link, the #packs anchor and the footer tagline (S, copy)
  - Detail: The link and the section id must change together.
  - Files: src/components/site-header.tsx:13, src/app/page.tsx:275, src/components/site-footer.tsx:21
  - Sources: texts, p3
  - Evidence: site-header.tsx:13 `{ href: "/#packs", label: "Packs prépayés" }`.
- [ ] **C8** Root title and description, and the landing title (S, copy)
  - Detail: These are the only social preview text: no openGraph block exists. The dash was removed in P4; the wording is still v1.
  - Files: src/app/layout.tsx:24, :28, src/app/page.tsx:23
  - Sources: p3 (LED:66/68), p4, texts
  - Evidence: layout.tsx:24 « Skedul · Réservations & packs prépayés »; :28 « packs d'heures prépayés ».
- [ ] **C9** Remove the demo entries from the ui-copy allowlist (S, test)
  - Detail: Once C1 to C4 leave no dash, drop the src/app/demo and src/components/demo entries and rewrite the allowedBy assertion at :127. The hero-cards and ticket-cta entries go with D3.
  - Files: src/lib/ui-copy.test.ts:34-51, :127
  - Sources: texts, p5 (T1 ruling)
  - Evidence: ALLOWLIST paths at :36, :40, :44, :48.
- [ ] **C10** Guard the marketing copy against the v1 vocabulary (S, test)
  - Detail: Scan page.tsx, site-header, site-footer, layout.tsx, components/landing and components/demo for « pack », « crédit » and « prestation », excluding the avatar « pack » kind and the redirect code.
  - Sources: texts
  - Evidence: only final-review-ui.test.ts:38 and client-emails.test.ts:277 pin old words.
- [ ] **C11** New FAQ texts for the starter articles (S, docs)
  - Detail: Draft new wording for category hc_packs and articles ha_packs, ha_credits and ha_creer_page, for the owner to paste in /admin/support/faq. If the owner prefers, ship it as a content migration like 0009 so preview and dev match prod.
  - Files: drizzle/0009_help_faq_seed.sql (applied history, never edit)
  - Sources: texts, golive, p3, p4
  - Evidence: 0009_help_faq_seed.sql: 5 lines match pack or crédit; no later migration or script touches help_article.
- [ ] **C12** Rewrite README.md for the tickets model (M, docs)
  - Detail: Rewrite the pitch, the auth section (Google and code too) and the business model. Fix the four-event webhook section, the « clés live » note and the route tree. Remove `pnpm db:push`. Add db:bootstrap, db:apply, test, test:db, CRON_SECRET, SEED_ALLOWED_HOSTS, the nightly cron, the new routes, src/lib/booking, the demo client, the tickets-dev and tickets-test branches, and the Preview branch scope (E7).
  - Files: README.md
  - Sources: p2 (Task 5), p3, texts, golive
  - Evidence: README.md:90 `pnpm db:push` (absent from package.json:11-21); :105-119 pack model and credits_remaining; only APP_ENV appears (:51).
- [ ] **C13** Rewrite the stale AGENTS.md lines (M, docs)
  - Detail: Rewrite :9-11 (packs) and :15-20 (credits_remaining; now atomic() and lock order). Update :45-48 (deleteUser cascades) and :53-54 (FAQ 0009 is v1). Update :67-69 for the P5 slot modules. Fix :72, which cites src/lib/payments.ts (now src/lib/payments/* and booking/fulfillment.ts), and :75, which puts isClient in queries.ts (now back-office/client-filters.ts:42). Add: the client space, the new routes, the cron and CRON_SECRET, the boot checks, the runPublicAction and logSafeMessage rules, the form-method guard, never db:push, .env.test and the work branches. Remove the dashes at :7, :18, :39, :44 if the no-dash rule covers docs.
  - Sources: p3, p4, p5 (carry 1), texts, golive
  - Evidence: AGENTS.md:20 credits_remaining, :69 slots.ts, :72 payments.ts, :75 isClient.
- [ ] **C14** .env.example: missing and dead variables (S, docs)
  - Detail: Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPPORT_BLOB_READ_WRITE_TOKEN and an active CRON_SECRET line. Drop NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, which env.ts:21 declares but nothing reads (remove it there too). Remove the 3 dashed comment lines.
  - Files: .env.example, src/lib/env.ts:21
  - Sources: texts, golive
  - Evidence: no GOOGLE or SUPPORT_BLOB in .env.example; :32 has the publishable key; :45 `# CRON_SECRET=`; dashes on :2, :4, :49.
- [ ] **C15** Refresh or retire TODO.md (S, docs)
  - Detail: The file still describes the 1:1 pack model and lists shipped items as open: capacity, offers, location, questions, pro notification, client space, validity and cancellation mails. It also holds 20 dashes.
  - Sources: texts, golive
  - Evidence: TODO.md:15 cites the `pack` model; 20 dash hits.
- [ ] **C16** Spec text: the movement constraint name now, the approved P4/P5 changes later (M, docs)
  - Detail: Replace ticket_movement_action_id_ticket_id_unique with ticket_movement_action_ticket_uq. After the owner approves (Owner item 10), fold in the P4 decisions, the P5 O6/O15/O22/O23 and the product calls.
  - Files: docs/superpowers/specs/2026-10-12-tickets-evenements-design.md:710
  - Sources: p2 (Task 4), golive
  - Evidence: spec:710 vs schema.ts:719.
- [ ] **C17** P3 contract drift (S, docs)
  - Detail: In docs/superpowers/plans/2026-10-14-p3-back-office-contract.md, fix:
    - :490 « No backfill on reconnect »;
    - :718 `reset()` (now unstable_retry);
    - :763 the old RDV_FREE_HAS_SALES text;
    - :820 canBecomeFree (now freeLockReasons);
    - :1170 `timeOffConflictCopy({ count })` (now seances, rdvs, tickets);
    - :1315 CONVERT_SAME_TYPE;
    - :1520 and :1665 the guest-cookie clear (`maxAge: 0`);
    - the FOLLOWING_MONTH_DAY mentions;
    - the RDV_FREE_NO_OFFER rows.
  - Sources: p3, p4, p5 (carry 2), texts
  - Evidence: grep confirms :490, :718, :763, :1170, :1520.
- [ ] **C18** Stale or imprecise code comments (S, docs)
  - Detail: Fix these comments:
    - invariants.ts:3-4 « six ... ONE statement »;
    - src/test/db.ts:86;
    - catalog.ts:2 « decision 13 »;
    - catalog.ts:520 « bootstrap-content guard »;
    - the fulfillPurchase JSDoc (afterPlan is test-only);
    - the walletBalance doc (archived types are included);
    - admin-metrics.ts:83 « no import »;
    - identity.ts:154 (goes with D6).
  - Sources: p2 (Tasks 15, 17, 19, 21, 34), p4 (X recommendations)
  - Evidence: as cited by p2 and p4.
- [ ] **C19** P5 dossier holds U+2014 dashes (S, docs)
  - Files: docs/superpowers/plans/2026-10-28-p5-rdv-libre-design.md
  - Sources: p5
  - Evidence: dash grep: 31 lines (45 characters per p5).

### D. Dead code, lint and indexes

- [ ] **D1** Additive index migration 0013 (M, perf-index)
  - Detail: Add FK support indexes:
    - ticket_movement: booking_id, purchase_id, ticket_type_id, from_ticket_type_id, actor_user_id;
    - ticket_purchase: offer_id, ticket_type_id;
    - booking_answer: question_id;
    - professional_id-leading indexes on booking, booking_answer and ticket (partial `where status = 'available'`).
  - Detail: Add read-path indexes `booking (created_at desc, id desc) where status = 'confirmed'` and `booking (professional_id, status)`. Drop the redundant booking_answer_booking_idx and ticket_movement_action_idx. Optionally add the A20 CHECK. Generate with db:generate and apply with `pnpm db:apply` on tickets-dev and tickets-test. booking(purchase_id) needs no index.
  - Files: src/lib/db/schema.ts, drizzle/
  - Sources: p2 (Task 4 parked), p3 (R11, R8/F6, R3), p4 (first carry), golive (two items, actor_user_id find)
  - Evidence: drizzle/ ends at 0012_tickets_manual.sql. schema.ts:565-567 has no offer or type index on ticket_purchase; :606-609 has no professional_id or created_at index on booking; :640 and :722 are covered by the uniques at :639 and :719; :714 actor_user_id has no index; :605 booking_purchase_uq.
- [ ] **D2** EXPLAIN the spendableSeances lateral join (S, perf-index)
  - Detail: Run it on tickets-test after D1. The Postgres 17 plan was a guess that nobody checked.
  - Files: src/lib/public/spendable.ts:97-100
  - Sources: p4 (ledger line 253)
  - Evidence: no EXPLAIN recorded.
- [ ] **D3** Delete hero-cards.tsx, ticket-cta.tsx and the legacy landing CSS (S, dead-code) (needs owner approval)
  - Detail: Neither file has an importer. Both are byte-identical to origin/main and hold v1 copy and 9 dashes. Deleting them clears the hero-cards.tsx:322 eslint error, two allowlist entries, and the legacy CSS block in globals.css (about 68-247: .carnet, .ticket-notch, .torn-edge-*, .tap-hint, .tear-hint, and .marquee with no user). Keep .stamp (tour-controls.tsx:79) and the /demo block.
  - Files: src/components/hero-cards.tsx, src/components/ticket-cta.tsx, src/app/globals.css, src/lib/ui-copy.test.ts:44, :48
  - Sources: p3 (eslint), p4, p5 (T1 ruling), texts (two items), golive
  - Evidence: grep HeroCards|TicketCta in src: only their own exports and ui-copy.test.ts:44, :48.
- [ ] **D4** pnpm lint green (S, code-fix)
  - Detail: Run this check after C2 and D3. If the owner keeps hero-cards.tsx, fix its setState in effect in place.
  - Sources: p3 ([P6], final ruling), p4, texts, golive
  - Evidence: client-pack.tsx:40, client-profile.tsx:11, hero-cards.tsx:322 `setCard(randomOf(CARD_IDS))`.
- [ ] **D5** Test-only exports and the duplicate Db type (S, dead-code)
  - Detail: Delete hasDomainData (or fix its comment) and TICKET_STATUS_LABELS, and declare Db once.
  - Files: src/lib/booking/catalog.ts:520-521, src/lib/tickets-vocab.ts:103, src/lib/db/atomic.ts:17, src/test/db.ts:20
  - Sources: p2 (Tasks 14, 34), golive
  - Evidence: hasDomainData is used only by catalog.db.test.ts and content.db.test.ts; TICKET_STATUS_LABELS only by tickets.test.ts:40.
- [ ] **D6** Delete the dead resolveSpaceIdentity (S, dead-code)
  - Detail: resolveSpaceCustomer uses spaceIdentityOf, and identity.ts:154 says otherwise. Delete the function or keep one twin, and move its DB tests.
  - Files: src/lib/back-office/guest-access.ts:170, src/lib/public/identity.ts:154
  - Sources: p4 (Task 5, X review)
  - Evidence: only guest-access.db.test.ts calls it.
- [ ] **D7** Small duplications (S, dead-code)
  - Detail: Five duplications:
    - ipBuckets parses the address twice;
    - startShopPurchaseCore repeats the buy-and-book prelude;
    - errorFocus is copied in 10 components;
    - isDateKey is in 3 files, and `7 * 24` in 2;
    - deleteRefusal duplicates the series predicates.
  - Files: src/lib/client-ip.ts:105-110, src/lib/public/shop-actions.ts:45-76, unavailability-manager.tsx:60, recurrence-form.ts:65, slots.ts:101, catalog.ts:356, catalog-actions.ts:69
  - Sources: p4 (Tasks 3, 11), p3 (Tasks 16, 18, 22, 29)
  - Evidence: as cited.
- [ ] **D8** notice_over_horizon is unreachable through the UI (S, dead-code)
  - Detail: Keep it as documented defensive code, or drop it along with its DB test.
  - Files: src/lib/back-office/type-view.ts:55, :62
  - Sources: p5 (Group C)
  - Evidence: every save refuses that state.
- [ ] **D9** actionVisitor reads the fresh session twice per public action (S, perf-index)
  - Files: src/server/public-context.ts:64-67, src/server/visitor.ts:54, src/lib/session.ts:19-21
  - Sources: p4 (Task 7)
  - Evidence: getFreshSession is not cached per request.
- [ ] **D10** previewDates expands 1830 days per call (S, perf-index)
  - Detail: About 11 ms per call. The defaults duplicate BOUNDS, and the spring-forward case has no test.
  - Files: src/lib/back-office/recurrence-form.ts:49
  - Sources: p3 (Task 14)
  - Evidence: `PREVIEW_HORIZON_DAYS = 1830`.
- [ ] **D11** DayCalendar after the demo rewrite (S, dead-code) (unsure)
  - Detail: Delete it if the new demo does not use it: the real public pages no longer do, and it builds browser-local dates.
  - Sources: texts
  - Evidence: imported only by demo/screens/client-booking.tsx:8 and the dead hero-cards.tsx:8.
- [ ] **D12** v1 redirect pages: keep or drop (S, dead-code) (unsure, owner call)
  - Detail: /dashboard/packs and /dashboard/event-types stream a 200 plus a client redirect. The two public pages repeat the 308 that next.config.ts:46-47 already applies.
  - Files: src/app/dashboard/{packs,event-types}/page.tsx, src/app/[slug]/{book,pack}/*/page.tsx
  - Sources: texts, golive
  - Evidence: packs/page.tsx:7 and event-types/page.tsx:7 `redirect("/dashboard/tickets")`.
- [ ] **D13** scripts/spike on the branch (S, dead-code) (unsure, owner call)
  - Detail: These are the P1 harness for the throwaway spike-batch branch. Their results are recorded in spec § 10, and no package.json script runs them.
  - Sources: texts, golive
  - Evidence: 5 files in scripts/spike/; db.ts:14 reads SPIKE_DATABASE_URL.
- [ ] **D14** /admin/subscriptions placeholder (S, dead-code) (unsure, owner call)
  - Detail: Keep it as roadmap (future pro billing, from main) or hide it from the admin nav.
  - Sources: golive
  - Evidence: src/app/admin/subscriptions/page.tsx:21-22.

### E. Go-live preparation (scripts, config, runbook; nothing deployed)

- [ ] **E1** Write the P6 go-live runbook (M, go-live)
  - Detail: One doc that follows spec § 15.5 steps 1 to 5 (the Owner items section gives the order). It covers the backup branch, the preview deploy from git branch preview plus the alias, the seed --wipe variables, mock then Stripe test, the production variable names, and confirming accounts before any code sign-in. It also covers deploy:prod, checking the cron is registered, and bootstrap-content: run it right after deploy and early in the day, since it overwrites hours and settings and creates today's past seances. Include the partial-failure recovery, checkInvariants (E4), the FAQ edit, the live-switch (E3) and the post-merge development steps (E9). Add a check that the function logs do not print Server Action arguments. State the production data wipe: 0010 drops nine v1 tables, and the webhook ignores v1 sessions without the skedul-tickets marker.
  - Files: docs/superpowers/plans/ (new P6 runbook), scripts/bootstrap-content.ts:15-18
  - Sources: p2 (bootstrap runbook), p4 (table rase, before-P6 list), p5 (before-P6 list, dev logs), golive
  - Evidence: no P6 plan or runbook file exists; 0010_domain_drop.sql drops the v1 tables.
- [ ] **E2** bootstrap-content prints no recovery hint after a partial failure (S, code-fix)
  - Detail: After a mid-way failure, a re-run says « rien n'a été écrit », which is false (19 separate batches). In the catch, print the French recovery: delete the pro's event and ticket_type rows, which cascade, then re-run.
  - Files: scripts/bootstrap-content.ts:34-53, scripts/content/apply-catalog.ts:44, :147
  - Sources: p2 (Task 34), golive
  - Evidence: :37 « rien n'a été écrit »; :51 bare `console.error(err)`.
- [ ] **E3** Live-switch script for spec § 15.5 step 5 (M, go-live)
  - Detail: Close the tickets of livemode = false purchases (reason autre, note « mode test ») through closeTickets, and list per pro the future bookings those purchases cover. Dry run by default, with the host print and guards of scripts/seed.ts.
  - Files: scripts/ (new), src/lib/booking/wallet.ts
  - Sources: p3 ([P4] carry), p4 (SEC-M14), golive
  - Evidence: grep livemode in scripts/: only seed.ts:172 and :330.
- [ ] **E4** Standalone read-only checkInvariants command (S, go-live)
  - Detail: Add scripts/check-invariants.ts for a given DATABASE_URL, or document triggering the cron job and reading invariantViolations.
  - Sources: golive (spec § 15.5 step 4)
  - Evidence: checkInvariants is called outside tests only in invariants.ts, nightly.ts and scripts/seed.ts.
- [ ] **E5** Seed minors before the preview seed --wipe (S, code-fix)
  - Detail: Five fixes:
    - parenthesise the DEMO_USERS predicate;
    - fail loudly when the ensureHorizon loop never completes;
    - use the injected clock for the professional and user rows;
    - print « relancez avec --wipe » on every failure path;
    - extract isHostAllowed for a unit test.
  - Detail: Note in the runbook that old June rows outside DEMO_USERS survive the wipe.
  - Files: scripts/seed.ts:46, :476
  - Sources: p2 (Task 35), golive
  - Evidence: seed.ts:46 unparenthesised `or` chain.
- [ ] **E6** setup-vercel-env.mjs appends a newline to every value (S, go-live) (unsure)
  - Detail: Values are piped to `vercel env add` with "\n", which may store CRON_SECRET with a trailing newline and break the Bearer match. Drop the newline or verify the stored length.
  - Files: scripts/setup-vercel-env.mjs:49
  - Sources: p4 (notes, CRON_SECRET owner check)
  - Evidence: :49 `input: value + "\n"`.
- [ ] **E7** Deploy source and Preview variable scope (S, go-live) (unsure)
  - Detail: The worktree has no .vercel/project.json and no .vercelignore. Per the 2026-10-18 memory, Preview variables are scoped to git branch preview. Deploy from a clean checkout of branch preview holding the merged commit, then `vercel alias set` to preview.myskedul.com, or add a .vercelignore.
  - Sources: golive (two items)
  - Evidence: Test-Path for both files returns False; README.md:153-157 omits the branch scope.
- [ ] **E8** Recheck main for new migrations right before the merge (S, go-live)
  - Detail: Fetch first. If main gained a migration after 0009, regenerate 0010 to 0013.
  - Sources: golive (spec § 15.2 step 5), p4 (LED:293)
  - Evidence: `git rev-list --count HEAD..origin/main` = 0 today (local origin/main 52e343b).
- [ ] **E9** Post-merge steps for the Neon development branch and git preview (S, go-live)
  - Detail: Apply 0010 to 0013 to development with `pnpm db:apply drizzle/<file>.sql`, then run seed --wipe; otherwise local dev on main breaks. Move git branch preview to the merged commit.
  - Sources: golive
  - Evidence: drizzle/meta/_journal.json idx 10-12 are applied on tickets-dev and tickets-test only.
- [ ] **E10** Separate sending identity for sign-in codes (M, go-live) (after the owner decision)
  - Detail: Today one key, one quota and one sender serve both pro mail and login codes. Build what the owner picks: a separate key or subdomain, a circuit breaker across pro accounts, a cross-instance pacer.
  - Files: src/lib/env.ts:22-23, src/lib/email.ts
  - Sources: p3 (SEC-1 residual c), p4, golive
  - Evidence: one RESEND_API_KEY and one EMAIL_FROM in env.ts.

## Owner items

In go-live order.

**Now, before the P6 work**
1. Push feat/tickets-events, which is 291 commits ahead of origin/feat/tickets-events and has not been pushed since P3. It stays a draft (PR #15) and must not merge before P6 is done.
2. Rotate the Neon neondb_owner password (open since P2; child branches inherit it). Then update the Vercel variables, .env.vercel-reference and the local .env files.
3. Unenrol the G4c booking before Sunday 1 November (see Test data, time-sensitive).

**Decisions that unblock P6 groups**

4. Approve deleting hero-cards.tsx and ticket-cta.tsx (D3).
5. Approve the new pitch lines: the landing h1 « La carte de 10 séances passe en ligne. », the root title and description, and the footer tagline. Choose which address the marketing shows: skedul.app (page.tsx:51, demo-script.ts:61-62) or myskedul.com.
6. Keep or drop the v1 redirect pages, scripts/spike and /admin/subscriptions (D12 to D14).
7. Google decisions:
   - what a reconnect does with the old calendar (A33);
   - whether the 200-occurrence backfill limit is lifted in P6 or documented (A32);
   - whether go-live waits for Google verification of the Calendar scope, needed to move the consent screen out of Testing (refresh tokens expire after 7 days).
8. Build or not:
   - O8 « Prochain créneau » on the RDV cards (one read per card);
   - O32 RDV buffers in the planning (A38);
   - an optimistic update for the 3 s seance header lag after « Réserver avec 1 ticket ».
9. The ACCOUNT_EXISTS sign-up wording (B5).
10. Approve or reject the spec changes, so that C16 can fold them in:
    - P4 Decisions 4, 5, 6, 7, 9, 27, 28, 32, 40, 64 to 69, 72, 73, 76;
    - P5 O6, O15, O22, and O23 (withdrawn).
11. Product calls to confirm:
    - P4: D44 held-ticket button, D46 chip-only « Semaine » view and list-only below 640 px, the contract § 11 additions.
    - P5: O2, O9, O12, O28, O30.
    - The D3 RDV copy: RDV_TICKETS_ONLY and its hint, « Vos prochaines réservations », the late-payment subject, « Annuler le rendez-vous ».
    - P3 fix-pass calls: F10, F4/COV-6, R5, F3, F2, SEC-2.
    - « Revenir aux disponibilités générales » runs with no confirm (type-hours-editor.tsx:124).
    - The ICS file is still served while the pro is suspended (no suspension check in src/app/api/bookings).
    - Decision 36, which may be moot.
12. The retro-spend window for expired tickets: keep it, accept tickets valid at the seance, or require expires_at > now (eligibility.ts:17).
13. Mail limits:
    - the mail budget of 50/2000 per 24 h, plus the SEC-1 residuals (mail-budget.ts:19);
    - the Resend sending identity for sign-in codes (E10).
14. The sign-up and reset rule of 3 per 10 min per IP: keep or relax (auth-options.ts:102-103).
15. Commit trailers: 122 of the 355 branch commits carry Sonnet. Keep them, rewrite the messages, or squash.
16. The FAQ: hand edit on each environment, or a content migration (C11).

**Checks during P6 (need OAuth, Stripe or a visible browser)**

17. Google against the real API, on tickets-dev:
    - book, cancel and rebook one seance (the 409-revive path);
    - connect a fresh calendar (backfill on connect).
18. Run deleteUser and finalizeGoogleConnection with after() once by hand, on tickets-dev or preview.
19. On tickets-dev, delete the « Test P3 » event (/dashboard/events/cluyHYonJJn42xaHEoBr5) and watch for a « Page introuvable » flash. type-danger-zone.tsx:64 uses the same pattern.
20. Confirm one unenrolment, checking both the seance and the RDV wording (unsure: no click is recorded).
21. In a visible browser:
    - check whether the espace code form clears the e-mail on its first submit;
    - check RDV page focus after a booking, a refusal, a code sign-in and a week change, including the R2 last-slot case.
22. Say whether you were the other actor who clicked in the browser pane during T13.
23. Stripe test-mode run (Decision 26), locally with stripe listen to localhost:3102:
    - pay one buy and book, and release another;
    - check Apple Pay and Google Pay on Checkout;
    - check that Stripe accepts the shop expires_at (now + 24 h);
    - check that a Server Action of about 90 s fits the plan.
24. Click the P3 browser paths yourself, if you do not trust the agent tour (A46) for them.

**Read-only data checks before the merge**

25. Data checks on the three branches:
    - On Neon main, count professional rows whose slug fails `^[a-z0-9-]{1,60}$` or equals a RESERVED_SEGMENTS name (mon-espace is new). The count must be 0.
    - On prod, preview and dev, find the `Europe/Geneva` timezones and set them to `Europe/Zurich`; otherwise profile save refuses those pros.

**Production configuration before deploy:prod** (names only)

26. Set:
    - APP_ENV=production;
    - BETTER_AUTH_SECRET of 32+ characters (rotating it voids the personal links);
    - CRON_SECRET of 32+ characters, checking the stored length (E6);
    - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, with the production webhook enabled for checkout.session.completed, async_payment_succeeded, async_payment_failed and expired;
    - a real RESEND_API_KEY (the production build fails without it), with myskedul.com verified in Resend and EMAIL_FROM on that domain;
    - NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL.

    Also publish the Google consent screen.

**Runbook, spec § 15.5**

27. Step 1: create the Neon backup branch pre-tickets from main, right before deploy:prod.
28. Step 2: run deploy:preview from a checkout on git branch preview (E7), then alias preview.myskedul.com. Then run seed --wipe with DATABASE_URL and SEED_ALLOWED_HOSTS set to the preview host for that one command.
29. Step 3: test in mock mode, then in Stripe test mode. preview.myskedul.com sits behind SSO, so Stripe webhooks need a protection bypass, or run the test locally (unsure). Vercel crons do not run on preview.
30. Step 4, in order:
    1. Confirm every existing prod admin and pro address before anyone uses a code sign-in: a code sign-in on an unverified account purges its password.
    2. deploy:prod. The prod v1 data is dropped by 0010.
    3. Check that the cron is registered.
    4. Confirm that the owner's page is altinha-paris in Europe/Paris, then run `bootstrap-content --pro altinha-paris` early in the day.
    5. Run checkInvariants.
    6. Edit the FAQ.
    7. Check that the function logs do not print action arguments.
31. Step 5: switch to the live Stripe keys and run the live-switch script (E3). The test banner then disappears.

**After the merge and go-live**

32. Migrate and reseed the Neon development branch, and move git branch preview to the merged commit (E9).
33. Once P6 is live, delete the Neon work branches tickets-dev, tickets-test and spike-batch (if it still exists), or clean them (next section).
34. Review on real traffic:
    - THROTTLE_LIMITS (tickets-vocab.ts:205) and the sign-up rule;
    - the accepted residuals: unknown purchase-id probes cost no throttle, the /mon-espace fan-out, bot slug probes, post-commit effect reads keyed on the action id (cancel.ts:31-36, :288-289), and the orphan counter if A25 is skipped.

## Test data to clean

**tickets-dev**
- Urgent: confirmed booking aCu6TNiimoyj6cwAlsR8t (« Test G4c », paid « À l'unité ») on « Atelier technique », Sunday 1 November 14:00 Paris. Unenrol it from the pro planning before that seance is used.
- P3 rows:
  - customers « Test P3 », « Test P3 bis », « Test P3 ter »;
  - events « Test P3 » and « Test P3 libre »;
  - the Task 38 test user and account p3-banner-4392@skedul.test;
  - seed rows changed in Task 25: the cancelled RDV of 19 Oct, capacity override 12, Thomas Leroy unenrolled.
- P4 accounts: test-p4-confirm, test-p4-25b (with 2 expired verification rows), test-p4-25c, test-p4-final-1, test-p4-final-2 (@skedul.test).
- P4 customers « Test P4 »: test-p4, -26, -link, -retour, -merci, -g4b, -g4c, -sweep (@skedul.test). Also Beatriz's 2 pending shop purchases, which the nightly job expires.
- P5 Group C:
  - free RDV booking SqkGf0TV-2zOqakhWGImW of test-p5-c-1;
  - time_off 14 to 20 Dec 2026 « Test P5 C semaine vide » on altinha-paris;
  - Beatriz's RDV bookings tlwwel_s3I0-SglWKiDwa, zl9Gc-fGsmhdpkElrHM2A, dppWGbhYmvxwWhz7MU3cy and a cancelled 2 Nov Appel découverte;
  - pro page test-p5-c-sans-horaires with type auZh_u4MREHbGgmh56ISB;
  - test-p5-c-3's abandoned buy (occurrence Q328txV8Zxrp4CSug1fUA, booking 7ZWTtFzTGWEOUHJnNCCSF);
  - one-click login sessions.
- P5 D1:
  - user test-p5-d-1@skedul.test with its OTP row;
  - customer DmG0sV83QVINFk_WOkvvI;
  - mock paid purchase janGbWteW4FjWtFddouN_ and its ticket;
  - confirmed RDV booking nJKm_u1CuDfg2Ss9ig26i on occurrence ZSkrHJR1nEMZ2ao7wmkgb;
  - the OTP row of test-p5-c-2;
  - page_view, rate-limit and throttle rows.
- P5 accounts to delete: test-p5-c-2@skedul.test (with its pro page) and test-p5-d-1@skedul.test, from /admin/users (retype the e-mail; deleteUser cascades).
- Alternative to all of the above: re-seed tickets-dev. Thomas's verified customer link (G1a) and fresh demo bookings appear only after a re-seed.

**tickets-test** (br-polished-rain-aftw8y9x)
- The t-% pro left by the cut D1 chunk 6 (user -b9me3yJFQ9lgU-xfI6oL, 2026-10-28T16:52:20Z).
- The pro-%@skedul.test user AcZEjdnVLwVtLkKrXg6Xa (2026-10-13, no pro row).
- Throttle and rate-limit rows stay by design.

**preview**
- Old June seed rows outside DEMO_USERS (studio-camille, a client at example.com) survive seed --wipe. Delete them by hand, or accept them.

**main (production)**
- No test data. The v1 data is dropped by 0010 at deploy (the « table rase »); the backup branch of step 1 keeps a copy.

**Not a Neon branch**
- The untracked skedul-tickets entry in the main checkout's .claude/launch.json.

None of these were checked against a database: they come from the outcomes, and agents ran no destructive SQL.

## Already done or obsolete

- CRON_SECRET and the nightly cron: done (P4 Task 15). vercel.ts:27 declares /api/cron/daily; src/lib/cron-auth.ts answers 401 under 32 characters. Setting the secret remains an owner item.
- Widen the ui-copy dash scan: done (P5 T1). ui-copy.test.ts walks src plus vercel.ts and next.config.ts; .css and .sql stay out on purpose.
- Copy guard covers src/server and lib: done. ui-copy.test.ts:6-12, :131-162.
- ui-copy scan coverage (LED:457, OPTIONAL minor): done. ui-copy.test.ts:34 ALLOWLIST.
- Owner click « Déconnecter ses liens »: done (P4 Task 21a, ledger line 155, link_version 3). The « Le compte client reste lié. » branch may still be unexercised.
- Branding preview « Pack 5 séances »: done. branding-form.tsx:287 « Acheter des tickets »; guarded by final-review-ui.test.ts:38-42.
- Google Agenda card wording: done. google-calendar-card.tsx:66.
- E-mail templates and footer in the tickets vocabulary: done. email-layout.ts:14; client-emails.test.ts:262-278.
- public.ts wiring guard X-1: done. cac71fb; src/server/public.test.ts:134.
- Offer page payment-return noindex: done (P5 T11). src/lib/public/page-metadata.ts:19, :28, :38.
- RDV libre cards (Decision 48): obsolete. src/components/public/rdv-cards.tsx:12.
- P3 final-review leftovers: done. The destructive token is darkened (globals.css:26), formatSlot is gone, and confirm-copy.ts:254 counts tickets.
- P4 Task 31 outcome doc minors: done. P4 outcome :34, :90-93, :132.
- /[slug]/espace page doc comment: done. espace/page.tsx:32-42 (aed8306).
- resolvePublicPro literal-name branding guard: obsolete. Replaced by publicPageProfileOfRow and the type guard (public-context.ts:43, public-context.test.ts:89-93).
- Rejected deferrals COV-M4 (c) and COV-M15: obsolete. P4 outcome :206, :208.
- origin/main merged into the branch: done. `HEAD..origin/main` = 0 (the E8 recheck remains).
- Early delete of .next/dev/types and the T13 RED run: obsolete. D1 suite 838/838 and pure 1604/1604 at 5e90699.
- « Désinscrire » on an RDV attendee: done (5e90699). confirm-copy.ts:64.
- Espace heading « Vos prochaines réservations »: done (5e90699). space-view.ts:16.
- Root title dash: done (P4 Task 31). The wording remains (C8).
- LED:68 « valables » plural and the CR/LF subject tests: done. format.ts:73; public-emails.test.ts:291; client-emails.test.ts:251.
- Retired public URLs answer 308: done. [slug]/pack/[packId]/page.tsx:1 permanentRedirect; next.config.ts:46-47.
- Modules neutralised in P2: done. All are rewritten and no placeholder is left; the only orphans are hero-cards and ticket-cta.
- bootstrap-content matches spec § 15.4: done. apply-catalog.ts:127-134 guard; content.db.test.ts.
- Stripe webhook handles the four events: done. webhook-core.ts:40-43; webhook route.ts:35-37.
- « Paiements en mode test » banner wired: done. [slug]/page.tsx:147, occurrence-booking.tsx:397, offer-checkout-form.tsx:110, rdv-booking.tsx:411; payment-mode.ts:10-13.
- vercel.ts buildCommand and Git deploys off: done. vercel.ts:20-23; package.json:20-21.
- saveAvailability half of the P2 Task 4 minor: done (saveAvailabilityCore).
- Guest-link key strength: done. env-checks.ts:15 requires 32 characters in production.
- Mock-mode gating of auth mails (point 1 of P2 Task 31): done. mock-log.ts:13.
- runEffects executor test gap: done. notify-run.ts runEffectsWith, with notify-run.test.ts.
- Verify-email banner browser path: done (P4 Task 19, ledger line 142).

## Reader notes

- No P6 plan or report file exists yet (glob docs/superpowers/plans/*p6*: none).
- Branch counts:
  - 355 commits in origin/main..HEAD (readers saying 357 compared with the stale local main at 8bb3195);
  - 122 commits carry a Sonnet trailer, not only 4670158;
  - 291 commits ahead of origin/feat/tickets-events.
- Fetch before the merge: origin/main is 52e343b, the merge base.
- golive found one FK the P2 index list missed: ticket_movement.actor_user_id (SET NULL to user) has no index (schema.ts:714). It is added to D1.
- p4 flagged scripts/setup-vercel-env.mjs:49 piping value plus a newline, which matches the declined CRON_SECRET trailing-newline line (E6).
- The texts reader set the dependency order for the text pass: demo data and script, then screens and tests, then landing, header and metadata, then the allowlist. ui-copy.test.ts:127 hard-codes the demo entry. hero-cards.tsx, ticket-cta.tsx and the landing files come from main's landing work (PR #14), so coordinate with main to avoid merge conflicts.
- The FAQ is database content: 0009 is applied history and must not be edited. The new texts need a hand edit or a new content migration (C11).
- README.md and AGENTS.md hold the demo password as existing docs content. The P6 rewrite should keep the AGENTS rule that demo credentials never appear in the site UI.
- These rest on the 2026-10-18 project memory, not on code: the Preview variables scoped to git branch preview, SSO on preview blocking Stripe webhooks, and whether the Vercel CLI uploads untracked files when there is no .vercelignore. They are marked unsure.
- Several statuses could not be checked read-only and come from the outcomes: everything that depends on database state or a browser click (test data, the Europe/Geneva rows, the production slug check, owner clicks).
- p5 found that src/lib/public/booking-actions.ts:118 and :358 count a live hold with `> now`, while some engine reads use `>= now`. This is part of A12.
- These were rulings with nothing left to do, so they are not items: the FOR SHARE vs FOR NO KEY UPDATE interleaving (rests on Postgres semantics) and the two-tab EXCLUDE browser check (covered by D1).
- p2 and p3 listed many earlier carries already closed by P3 to P5 (tickets-vocab split, guest link version, upsertCustomer guard, 429 translation, the 308 redirects, IP bucketing, runEffects « none », SEC-5, F9 rdv_free guards, client search off the URL, and others), with file:line evidence in their notes. None of them reappear above.