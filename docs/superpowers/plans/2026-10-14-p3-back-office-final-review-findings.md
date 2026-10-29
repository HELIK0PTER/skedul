# P3 final review: serious findings (confirmed by 3-lens verification)

## SEC-1 (security, reviewer Important, confirmed=true)
src/server/pro-context.ts:81  No cap or throttle on the client e-mails a pro's actions send to addresses the pro typed

Scenario: Anyone can sign up (3 sign-ups per 10 min per IP, no verified address needed to onboard, per spec § 12) and create a pro page. They create a one-off séance with capacity 500. Then they call registerAttendeeAction 500 times, each with a new client whose address they typed (planning-actions.ts:508, the `customer.kind = "new"` path, then createCustomer and registerPro). Each call sends one email.booking_confirmed. After that, each call to updateOccurrenceAction that changes only the location (planning-actions.ts:114, series.ts:230-233) sends email.occurrence_changed to all 500 registrants. 50 edits send 25,000 Skedul-branded mails, and the pro writes the text: business name, title (120 chars), location (200 chars). unenrollCore (planning-actions.ts:307) then adds a « Motif » of up to 500 chars to each booking_cancelled mail, and offerTicketsCore with notify (client-actions.ts:142) can repeat 1 mail per call without limit. Nothing applies a rate limit: runProAction runs every effect through after() → runEffects (notify.ts:60). sendPaced only spaces the mails out, it never caps them. emailVerified is never checked before a mail leaves. All of this goes out through the same Resend key and EMAIL_FROM as the sign-in codes and password resets (auth.ts passes the same sendEmail). So a spammer turns Skedul into a phishing relay, and exhausting the Resend quota or the domain's reputation stops login codes for every user. The spec itself protects that quota on the auth endpoints (§ 12, « trop courtes pour protéger le quota d'envoi »).

Proposed fix: Add a per-pro mail budget in the throttle table, e.g. consumeThrottle(db, `t:mail:p:${professionalId}`, N, now) per recipient. Check it when the e-mail plan is built: runEffects/planEffect gets the pro id from the booking or customer row. Past the budget, drop the mail and log a line without any address. Also require a verified pro address (session.user.emailVerified) before any client e-mail leaves. The dashboard already has the « Confirmez votre adresse » banner, so the action can say « Confirmez votre adresse pour prévenir vos clients ». A cap on new typed recipients per day would also limit the relay surface. Add a DB test that the N+1th mail of a pro is not planned.

Votes:
- real=true Important: SEC-1 is real. I traced every entry point in the scenario and nothing anywhere limits how many client e-mails a pro's actions send.

1. **Anyone can become a pro.** The sign-up rule is 3 per 600 s per IP (src/lib/auth-options.ts:101). `createProfessionalProfile` (src/server/pro.ts:61-104) never checks `emailVerified`, and spec § 12 says outright « Ce code ne bloque pas l'onboarding pro ». The only `emailVerified` uses in back-office code are the banner (dashboard/layout.tsx:48) and guest-access.ts:128. No action is gated on it.

2. **Typed recipient, one mail per call.** `registerAttendeeAction` (src/server/pro-planning.ts:85-88) calls runProAction, then `registerAttendeeCore`. With `customer.kind === "new"` (planning-actions.ts:508-521), `createCustomer` takes any address the pro typed, then `registerPro` runs. Its result carries `confirmedEffects(bookingId, occurrenceId, false)` (claims.ts:796-800, 544-548). That is `email.booking_confirmed`, and `planBookingConfirmed` (notify-core.ts:204-247) sends it to `customer.email`. Capacity can be 500 (tickets-vocab.ts:137). Guest coverage works in every mode, so a « none » mode séance needs no tickets.

3. **Fan-out to all registrants.** `updateOccurrenceAction` (pro-planning.ts:43-44) calls `updateOccurrenceCore`, then `updateOccurrence`. A location-only patch sets `locationChanged` (series.ts:163-165). It then pushes one `email.occurrence_changed` with every active booking id (series.ts:230-233). `planOccurrenceChanged` (notify-core.ts:292-319) mails each confirmed booking. Nothing limits how many edits a pro makes.

4. **Pro-written text in the mails.** `unenrollCore` accepts a `reason` of up to 500 chars (planning-actions.ts:298-302). It becomes `cancelReason`, which `cancelledMail` puts in as « Motif : … » (booking-cancelled.ts:25). Business name, title (120 chars) and location (200 chars) appear in every template. `offerTicketsCore` with `notify` sends `email.tickets_offered` on every call (wallet.ts:183, notify-core.ts:339-382). It is worse than described: a pro can loop register, unenroll, register on the same customer. Each round sends two mails to one address, with no per-recipient cap.

5. **No cap in the pipeline.** `runProAction` (pro-context.ts:81) schedules `after(() => runEffects(effects))`. `runEffects` (notify.ts:60-73) does dedupe, then `planEffect`, then `execute`. `sendPaced` (notify.ts:18-27) only spaces mails 550 ms apart per server instance, which is about 6,500 an hour. It never refuses one. No throttle key exists for pro-sent mail. The throttle table is used only for the public flows and the auth OTP/reset caps.

6. **Shared sender.** `sendEmail` (src/lib/email.ts:9, 28-40) uses one Resend client and `env.EMAIL_FROM`. auth.ts passes the same `sendEmail` to the OTP mailer and the reset mailer (auth-options.ts:111-115, 207). So burning the quota, or getting the domain suspended over bounces from made-up addresses, stops sign-in codes and password resets for every user. The P2 Task 32 ruling and spec § 12 protect exactly that quota on the auth endpoints, so leaving pro mail uncapped is inconsistent with a decision already taken.

No « Ruling: » line in progress.md, the P3 plan or contract, or the P2 outcome covers pro-sent e-mail volume. It is not a known deferred minor.

**Severity: Important, not Critical.** No tenancy breach, no data exposure, no corruption: templates escape the pro's text (escapeHtml), so this is text-only phishing. Abusing it takes deliberate effort. P3 is not in production (merge waits for P6, and Resend deliverability is a P4 go-live condition). It is still more than Minor: it is an open Skedul-branded relay for content the pro writes. It has no per-pro or per-recipient cap. It can knock out login codes for everyone.

**The proposed fix is sound:**
- A per-pro budget (`t:mail:p:<id>`), checked at plan time. Past it, drop the mail and log without the address.
- A verified-pro gate before any client mail leaves.
- Optionally, a per-recipient cap or a daily cap on new typed recipients, to stop mail-bombing one address.
- A DB test that the N+1th mail is not planned.
- real=true Important: I could not refute SEC-1. I looked for a guard in the middleware, the engine, the schema, the spec and the ledger, and found none: nothing limits or meters the client e-mails a pro's actions send.

What the code does:
1. **Every pro write goes straight to mail.** runProAction (src/server/pro-context.ts:81) calls after(() => runEffects(effects)) whenever effects are non-empty. runEffects (src/server/notify.ts:60) plans each effect and executes it. sendPaced (notify.ts:18) only spaces mails 550 ms apart, per instance (module-level nextMailAt); it never caps or drops one.
2. **No rate limit outside the auth flows.** consumeThrottle is used only in auth-options.ts:243 and :301 (reset and OTP) and in throttle.ts (the public free/buybook/rdv/shop limits). No proxy.ts or middleware exists. In src/server, emailVerified is read only by client-queries.ts, for the client espace; no pro action or notify step checks it.
3. **Unverified pros can onboard.** Spec § 12 says so on purpose: « Ce code ne bloque pas l'onboarding pro ».
4. **Typed addresses get mail.** registerAttendeeCore (src/lib/back-office/planning-actions.ts:508+) creates a customer from a typed address via createCustomer, then calls registerPro. confirmedEffects (src/lib/booking/claims.ts:545) always emits email.booking_confirmed to the client, and planBookingConfirmed sends it to b.customerEmail.
5. **Capacity allows 500.** BOUNDS.capacity.max is 500 (tickets-vocab.ts:137).
6. **One edit fans out to every registrant.** In updateOccurrence (src/lib/booking/series.ts:163-165, 230-233), a location-only change sets locationChanged. That emits email.occurrence_changed with all active bookingIds, and planOccurrenceChanged (notify-core.ts:292) sends one mail per active registrant. Each Server Action call is its own after() run, so the 300 s duration cap does not bound the total.
7. **More unmetered mail.** unenrollCore passes a reason of up to 500 characters (BOUNDS.note), which ends up in the cancellation mail (cancelledMail, reason: b.cancelReason). offerTicketsCore with notify emits email.tickets_offered on every call.
8. **Same sender as login codes.** sendEmail (src/lib/email.ts) uses the single Resend client and env.EMAIL_FROM, the same path as the sign-in codes and password resets.

**Scope.** On main, createManualBooking → fulfillBooking already sent one confirmation per manual booking. What P3 adds is the fan-out: one edit mails every registrant, plus offers and reasons, all through notify.ts and pro-context.ts, which P3 created (commit ea98daf). So the amplification is in scope.

**Ledger and rulings.** No Ruling covers this. The Task 5 deferred minor only mentions pacing and the after() duration. The P2 outcome (Task 32 Ruling) already graded the same harm as Important: « Resend quota exhaustion stops every login code ». So by the project's own standard this is Important, not Minor.

**Why not Critical.** It needs deliberate abuse from a signed-up account. Sign-ups are limited to 3 per 10 min per IP, and no data is exposed.

**On the proposed fix.** A per-pro mail budget is the real control. Requiring a verified pro address is weak on its own, since a throwaway mailbox can verify; it is also not required by the spec.
- real=true Important: I checked every link of the chain in the code, and the problem exists as described.

**The chain, as written**
- src/server/pro-context.ts:81 hands every effect to `after(() => runEffects(effects))`.
- src/server/notify.ts:18-27 (`sendPaced`) only spaces mails 550 ms apart, and only per server instance. Nothing caps them.
- Neither src/server/notify.ts nor src/lib/notify-core.ts (planEffect and its plan functions) reads `throttle` or `emailVerified`. The only `consumeThrottle` callers are the auth OTP/reset hooks (auth-options.ts:243, :301) and the P4 `checkActionThrottle`.
- Onboarding (src/server/pro.ts:61-85, createProfessionalProfile) needs no verified address, and spec § 12 says so on purpose: « Ce code ne bloque pas l'onboarding pro ».
- registerAttendeeCore (src/lib/back-office/planning-actions.ts:508-570) takes a typed address through `createCustomer` (wallet.ts:49), with no limit on customers per pro. `registerPro` then emits `email.booking_confirmed` (claims.ts:545). Capacity goes up to 500 (`BOUNDS.capacity.max`, tickets-vocab.ts:137).
- updateOccurrence (series.ts:228-233) emits `email.occurrence_changed` to every active booking when only the location changes, so flipping the location between two values repeats the fan-out with no limit. applyFollowing (series.ts:444, 459) and cancelOccurrence (cancel.ts:123) fan out the same way.
- unenroll / cancelBookingsByPro (cancel.ts:247) sends booking_cancelled with a pro-written « Motif » of up to 500 characters (`BOUNDS.note`). The pro also controls the subject, through the title.
- offerTickets with `notify` (wallet.ts:183) sends one mail per call.
- src/lib/auth.ts:6 passes the same `sendEmail` to Better Auth. src/lib/email.ts uses one Resend client and one `EMAIL_FROM`, so these mails share the auth codes' key, quota and reputation.

**What was already in production**
On main, `createManualBooking` → `fulfillBooking` already mails a confirmation to an address the pro typed. That was 1 mail per action. P3 adds two things:
- a 1:N fan-out (up to 500 mails per action, repeatable without limit);
- a 500-character free-text body.

**Real impact**
This is abuse, not a breach. It needs a self-registered pro account and exposes no client data and no money. But the platform-wide effects are real:
- Skedul-branded text goes to victims who never asked for it, which works as a phishing relay.
- Spam complaints can get the Resend account or the domain suspended.
- Exhausting the quota, or hitting Resend's account-wide 2 requests per second from several instances at once (pacing is per instance, ledger Task 5), makes sign-in code and password-reset mails fail. In P4, codes become the client's way to sign in, so this would stop a core flow.

Two things soften it: one after() run is bounded at about 545 mails by the 300 s limit, and an admin can ban the account. Neither stops repeated runs. P2 graded the same quota-exhaustion risk on the auth endpoints Important (outcome Task 32 ruling). By the same yardstick this is Important, not Critical. No ledger ruling accepted this risk. The only related deferred minor (Task 5) is about pacing reliability, not abuse.

**The proposed fix is right but incomplete**
1. **Several accounts multiply the budget.** Sign-up is limited by IP only (3 per 10 min), and changing IP is easy, so a per-pro budget alone can be bypassed. The fix also needs:
   - a global cap, or circuit breaker, on mails triggered by pros;
   - preferably a separate Resend key or sending subdomain for auth mails, so client notifications can never starve sign-in codes;
   - a global (DB-backed) pacer, so concurrent instances cannot trigger 429s that hit OTP mails.
2. **Dropping mails silently after the commit hurts honest pros.** Clients of a real 500-seat séance that was moved or cancelled would never hear about it. For fan-out actions, check the budget before committing, or at least tell the pro how many clients were not notified. Size the budget above the largest legitimate fan-out.
3. **The emailVerified gate is a cheap speed bump, not a control.** The attacker verifies their own throwaway inbox in one code. Keep it as an extra layer only, and note that the owner should decide on this product rule.
4. **A daily cap on new typed recipients is the best way to shrink the relay surface,** and it should be part of the fix.

Tests to add: the N+1th mail is not planned, and the per-pro budget does not affect auth OTP sending.

## F1 (engine, reviewer Important, confirmed=true)
src/lib/back-office/event-actions.ts:347  A series with a live later segment can only be half deleted or edited, and the page then says « Les séances à venir sont supprimées. »

Scenario: Weekly class with past séances. In the planning, the pro opens the 18/11 séance (the third one to come) and applies a new time to « Cette séance et les suivantes ». applyFollowingCore calls editSeriesFrom, which splits (series.ts:566, because rows exist before d): segment A ends on 17/11 and still owns the upcoming 21/10, 28/10, 04/11 and 11/11; segment B starts on 18/11. getEventEditor (event-reads.ts:324) picks A as the current segment and redirects /dashboard/events/<B> back to A, so B cannot be opened anywhere (the « Segments précédents » card at events/[id]/page.tsx:171 lists it with an « À venir » badge but no link). « Supprimer l'événement » previews and deletes A only (deleteEventPreviewCore and deleteEventFromCore, then deleteSeriesFrom, all scoped to event_id = A). EventDeleteCard then shows DONE « Les séances à venir sont supprimées. » (event-delete-card.tsx:21), but every B séance from 18/11 stays scheduled and bookable on the public page, and its registrants keep their seats. « Supprimer à partir du 25/11 » answers « Aucune séance à venir n'est concernée. » and returns a successful no-op. Edits from « Informations » (title, place, types, capacity) also stop at A, so a place change never reaches B's séances or B's registrants. No DB test covers two live segments.

Proposed fix: Make the event page work on the whole series. Either (a) have deleteEventFromCore, the delete preview and editEventInfoCore also act on every later non-archived segment of the same root, from fromDate on, each segment with its own version guard, inside one batch or with a clear partial result; or (b) at least stop redirecting a live later segment, give it a link, and make the delete copy and success line name the later segment that stays (« Les séances à partir du 18/11 continuent : ouvrez-les pour les supprimer. »). Add a DB test that sets up A and B, deletes from A's first séance and asserts on B.

Votes:
- real=true Important: I traced the scenario through the code and it happens as described, with one detail that works differently.

1) How the state arises. The planning dialog offers « Cette séance et les suivantes » on any recurring séance that has not started and was not moved alone (occurrence-edit-form.tsx:135-143). It is not limited to the first séance to come. followingTarget (planning-actions.ts:378-395) takes the séance's own event A and its series_date d=18/11. applyFollowingCore then calls editSeriesFrom. In loadSeriesContext, split = before_ > 0 && d > start_date (series.ts:566), so the call splits. Segment A ends at min(d-1, its last date) (endOldSegmentSets, series.ts:628-633). Only rows with series_date >= d move to the new segment B (series.ts:765). A keeps the upcoming 21/10 to 11/11. The DB test planning-actions.db.test.ts:440-469 builds exactly this state: `first` stays on A and the rest go to applied.eventId.

2) B cannot be opened. getEventEditor (event-reads.ts:316-324) calls pickCurrentSegment (event-reads.ts:162-173), which picks the live segment owning the earliest next séance. That is A (21/10), so /dashboard/events/B redirects to A (page.tsx:31). The « Segments précédents » card (page.tsx:171-199) lists B with an « À venir » badge but has no Link. The plan's assumption at plan.md:13732, « After a split the old segment keeps only past rows, so the new one is current », is false for a planning split. No ledger Ruling covers this. The Task 15 deferred minor only notes the missing test « pickCurrentSegment fallback with 2 live segments ».

3) « Supprimer à partir du 25/11 » on A:
- deleteEventPreviewCore runs deleteRefusal: nothing started, and archive is false because 25/11 > A.start_date. It then runs deleteFromPreview, which reads only A's rows >= 25/11. There are none, so the dialog says « Aucune séance à venir n'est concernée. » (confirm-copy.ts:156).
- deleteSeriesFrom then does no physical delete, because rowsBefore > 0 and root_in_use is true. endOldSegmentSets returns [] because A's last date 17/11 is before 25/11. So the batch only bumps the version. Every guard passes because each one is scoped to event_id = A (series.ts:923-958).
- The action succeeds and the card shows DONE « Les séances à venir sont supprimées. » (event-delete-card.tsx:21, 139-141).
- After the action the page is refreshed, and A is still current (it owns 21/10), so DONE stays on screen. Every B séance from 25/11 stays scheduled and bookable on the public page. This path is exactly as described.

4) « Supprimer l'événement » on A, fromDate 21/10:
- The preview and the delete touch only A's rows and set A's until to 20/10. B is untouched: its séances from 18/11 stay bookable and its registrants keep their seats.
- The dialog title « Supprimer « X » ? » and its counts cover A only.
- The detail that differs from the finding: runProAction revalidates /dashboard (pro-context.ts:79). The refreshed render of A now finds B as the current segment, because A owns no upcoming séance. getEventEditor therefore redirects to B, and the card remounts (key={event.id}). So the DONE line is probably lost and the pro lands on B's page, where the séances that remain are visible. This is a half-delete with a misleading confirmation that the pro must repeat, rather than a silent one. It is still wrong behaviour.

5) « Informations » on A: editEventInfoCore calls editEventInPlace, which updates only `event where id = A`. Capacity propagation, links and questions are all scoped to ev.id (series.ts:360-423). The « séance modifiée » e-mails go only to A's future séances (series.ts:432-447). A change of place, capacity, types or title never reaches B or B's registrants, and B cannot be opened to fix it until A's last séance has passed.

6) Tests: event-reads.db.test.ts:95 and :262, the only split tests, cut at the first future séance, so A keeps only past rows. No editor or delete test covers two live segments.

Severity Important: a pro will hit this in normal use (« from December the class moves to 19h »). « Supprimer à partir du » reports success while séances stay bookable, and edits in « Informations » silently miss most of the series. There is no security hole or data corruption, and the whole-event delete partly reveals the leftover B through the redirect, so I would not call it Critical.
- real=true Important: I read the code and the problem is real. Nothing elsewhere prevents it.

1. **Splitting while séances to come remain before the cut is allowed.** The planning dialog offers « Cette séance et les suivantes » on any recurring séance that has not started and was not moved alone (occurrence-edit-form.tsx:135-143). applyFollowingCore (planning-actions.ts:433-459) calls editSeriesFrom on the séance's own segment, from that séance's date. loadSeriesContext splits whenever rows exist before d and d > start_date (series.ts:566). Nothing checks that those earlier rows are in the past. The DB tests even build this state: planning-actions.db.test.ts:440 says "earlier ones stay", and event-actions.db.test.ts:538-546 cuts from future[3].

2. **The later segment B cannot be opened.**
   - pickCurrentSegment (event-reads.ts:162-173) picks the live segment owning the earliest next séance, which is A.
   - getEventEditor redirects any other id of the series to A (event-reads.ts:323-324), and page.tsx:31 follows that redirect.
   - The « Segments précédents » card (page.tsx:171-199) lists B with the « À venir » badge but has no link.
   - The plan assumed this state cannot happen: plan line 13732 says "After a split the old segment keeps only past rows, so the new one is current". The planning path breaks that assumption, and no Ruling covers it. The ledger's deferred minor at line 182 is about a different divergence.

3. **The delete covers A only.**
   - deleteRefusal, deleteFromPreview and deleteSeriesFrom all filter on event_id = A (event-actions.ts:149-160, event-reads.ts:460-505, series.ts:881-974). laterSegmentStart is loaded, but deleteSeriesFrom never uses it.
   - A is not physically deleted because root_in_use or rowsBefore is set. It ends at d − 1, and B's séances stay scheduled and bookable with their registrants.
   - The confirm dialog's counts (confirm-copy.ts:123-158) leave out B's séances, registrants and tickets.
   - « Supprimer à partir du 25/11 » finds no row in A. The copy says « Aucune séance à venir n'est concernée. » (confirm-copy.ts:156) and the call succeeds without changing any séance (only A's version goes up).

4. **One detail of the scenario is overstated.** runProAction calls revalidatePath (pro-context.ts:79). Re-rendering /dashboard/events/A then hits the redirect, because A has no next séance left and B becomes current. Next's RedirectBoundary (redirect-boundary.js:35-37) moves the pro to B's page. So the DONE line « Les séances à venir sont supprimées. » probably does not stay on screen. The pro lands on the same title with séances still listed, and a second delete finishes the job. That makes the half-delete visible, but it remains wrong behaviour: « Supprimer l'événement » does not delete the event, and the confirmation under-reports who is warned and what is cancelled.

5. **Edits from « Informations » also stop at A.** editEventInfoCore and editEventInPlace touch only ev.id: event_ticket_type, question and the occurrence propagation, all on event_id = ev.id (series.ts:302-450). A place or title change never reaches B's séances or B's registrants, and B's form cannot be opened while A has séances to come.

6. **The TIM1 refusal sends the pro to a page they cannot open.** It says « modifiez-la depuis cette date » (series.ts:588-591), but B's editor is unreachable.

7. **No test covers it.** No DB test checks the editor, the delete or the info edit with two live segments.

**Severity: Important, not Critical.** There is no data corruption, it is not a tenancy issue, and the redirect after the first delete shows the pro what is left. But a pro will hit this through a common planning action, and it is untested.
- real=true Important: I read the code myself and the problem is there as described. Two small errors in the scenario do not change it. First, 18/11 is the fifth upcoming séance, not the third. Second, past séances are not needed: any cut from a séance that is not the first upcoming one creates the state. The existing planning DB test sets it up exactly (planning-actions.db.test.ts:441-456: cut from `second`, so A keeps `first`, which is still to come). That test never goes on to open the editor or delete.

Code path:
- applyFollowingCore (planning-actions.ts:433) accepts any séance (followingTarget :378-395). editSeriesFrom splits when rows exist before d (series.ts:566), so segment A ends at d − 1 and still holds the upcoming séances, and segment B starts at d.
- pickCurrentSegment (event-reads.ts:162-173) chooses the segment that owns the next scheduled séance, which is A. getEventEditor (:324) therefore redirects B to A, including from the occurrence dialog link (occurrence-dialog.tsx:535). The plan's assumption (plan l.13732, « the old segment keeps only past rows ») is wrong for the planning path.
- The « Segments précédents » card (page.tsx:171-199) shows B with an « À venir » badge but gives no link, and its description talks about past séances.
- deleteRefusal, deleteFromPreview and deleteSeriesFrom (series.ts:881-974) are all scoped to `event_id = A`. The loaded laterSegmentStart is never used for a delete.
- « Supprimer à partir du 25/11 », with 25/11 after A's end: the preview counts nothing (« Aucune séance à venir n'est concernée. »). endOldSegmentSets returns [] because A's last date is before d, so only the version is bumped and the delete succeeds. DONE « Les séances à venir sont supprimées. » (event-delete-card.tsx:21, 141) is then shown. A still owns its upcoming séances, so no redirect happens either. B's séances stay scheduled and bookable on the public page. This is a false success on a destructive action, and clients can pay for séances the pro thinks are cancelled.
- « Supprimer l'événement »: the confirm counts and deletes A's séances only. Afterwards A has no upcoming séance, so the revalidated page probably redirects to B. I could not confirm this without running the app. If it does, an attentive pro sees B's séances and can delete again, which lowers this sub-case slightly. Even so, the dialog showed only part of the séances and the pro was told the event was deleted.
- editEventInPlace (series.ts:295-455) works on one segment only. A change of place, title, capacity, types or questions never reaches B. B's registrants get no « séance modifiée » email and see the old place.
- The recurrence of B cannot be edited from the editor either. A's schedule edit is refused with « La série change déjà à partir du … : modifiez-la depuis cette date » (series.ts:589), and the pro has no way to open that date's segment.

The state lasts until A's last upcoming séance has passed, which can be several weeks. Ledger line 177 says the two current-segment notions agree in every UI-reachable state, which is wrong for this state. Ledger line 182 defers « 2 live segments » only as a test gap. No test covers the editor or a delete with two live segments.

Grade: Important. Nothing leaks across tenants and no data is lost, but a pro will hit wrong behaviour through common flows (« from 18/11 the class moves to 19h », then ending or renaming it). It harms money and trust. It stops short of Critical because it needs a specific earlier cut and a time window, and the planning still shows B's séances.

Proposed fix:
- Option (a) is the right direction for delete, but incomplete as written. The client has no seenVersion for B, so the preview must return one version per segment, or the guard must use last_action_id. One engine batch per segment needs either an engine change for one combined batch or an explicit partial-success result.
- Propagating info edits to B is not a simple loop. Questions are copied with new ids, so a patch keyed by id does not map to B (it would need mapping by position, or re-copying). Type links and capacity are per segment, and B's registrants need the place-change emails.
- Option (b) also needs: getEventEditor must not redirect a live later segment; the card title and description must change; B needs a link; and the delete dialog must say that the séances from B's start date continue. A custom delete date after A's end should either cascade into B or be refused with a pointer to B. It must never return a no-op success.
- The DB test must cover both delete paths (whole and after A's end) and one info edit, each asserting on B.

## F2 (engine, reviewer Important, confirmed=true)
src/lib/back-office/catalog-actions.ts:137  A type whose ticket was ever booked can never become « Gratuit »: booked tickets of past séances stay 'booked' forever

Scenario: hasSalesOrTickets blocks the switch on any ticket with status = 'booked'. The engine never moves a ticket from booked to used after its séance: spec § 7 says « Utilisé le JJ/MM » is derived at display time, and the only 'used' writes are pointTickets and unpointTickets (wallet.ts:478). Take an RDV type « Découverte » that was sold and used once months ago, with no offer on sale and no valid ticket left. The pro turns on « Gratuit ». canBecomeFree (rdv-form.ts:88) leaves the switch enabled, the save is refused with RDV_FREE_HAS_SALES (« … ou des tickets valides … »), and nothing the pro can do ever clears that refusal; the only way out is a new type. The Task 10 ruling put the cost at a 31 min wait for a stale pending purchase and did not see that a booked ticket blocks forever, so I think that ruling's cost is wrong. The DB test at catalog-actions.db.test.ts:203-212 only covers a booked ticket on a future séance.

Proposed fix: Count only bookings that can still return their ticket in a normal flow: booked tickets whose booking is confirmed on a scheduled occurrence with starts_at > now. Count pending purchases only while checkout_expires_at > now or processing_at is not null (the Task 39 stale rule). Mirror the same facts in canBecomeFree and FREE_LOCKED_HELP so the switch is disabled with the real reason. Add a DB test with a ticket booked on a past séance (the switch is accepted).

Votes:
- real=true Important: I traced the path and the refusal happens as described.

1. Entry point. The « Gratuit » save calls updateTicketTypeCore (src/lib/back-office/catalog-actions.ts:180-208). When the switch goes false → true it calls hasSalesOrTickets (lines 130-141). Line 137 blocks on ANY ticket of the type with status = 'booked'. It does not look at the booking or the séance date.

2. A booked ticket stays booked for good. The only writes that take a ticket out of 'booked' are:
   - RET (src/lib/db/atomic.ts:189-205), which runs only when a booking is ended by a cancel action;
   - the move/convert path in wallet.ts:649.
   pointTickets (wallet.ts:478) only moves available → used. The nightly job (nightly.ts) expires only 'available' tickets and never touches booked ones. The wallet shows « Utilisé le JJ/MM » for a past booked ticket only at display time (wallet-view.ts:125-136, doneAt at 139-140); its status stays 'booked'.

3. The form does not warn. canBecomeFree (rdv-form.ts:88-90) checks only usableTickets and active offers. readUsableCounts counts available tickets, so in the scenario the switch is enabled and FREE_LOCKED_HELP is not shown. The save then fails with RDV_FREE_HAS_SALES. That message names « tickets valides », which the pro cannot find: the wallet shows those tickets as used.

4. How the pro could clear it. cancelByClient refuses past séances (cancel.ts:176, o.starts_at > now). cancelBookingsByPro / cancelOccurrence (E6a/E6b, cancel.ts:197-303) accept past séances on purpose (« past too, to fix a mistake »). So the only way out is to cancel every past booking of the type. That emails each client a cancellation, rewrites history and turns the tickets back into available ones, which then still block until they are expired, closed or pointed. A reasonable pro has no path except creating a new type. So the block is permanent in practice, not the 31-minute wait the Task 10 ruling (progress.md:136) priced for a stale pending purchase. That ruling's cost is wrong for booked tickets.

5. Test gap. catalog-actions.db.test.ts:203-212 books a ticket only on a future event séance (makeEvent). No test covers a past séance.

One caveat on the proposed fix. Because E6a can still cancel a past booking after the type became free, filtering on starts_at > now leaves a corrective path that can put an available ticket back on a free type. The offer/convert rdv_free checks (Task 32 ruling) accept a similar gap, and the consequence is small (a ticket that cannot book an RDV), so the trade-off is acceptable but should be written down. The fix should also keep any booked ticket whose booking is pending or confirmed on a future scheduled occurrence. The rest of the fix is sound: pending purchases only while checkout is live or processing, the same facts in canBecomeFree and FREE_LOCKED_HELP, and a past-séance DB test.

Severity: Important, not Critical. No data is lost and there is no security issue. But a pro who has ever sold a paid RDV type hits this in a normal flow (making a « Découverte » free), and the refusal is misleading and can never be cleared.
- real=true Important: I could not refute it. The code shows the problem exactly as described, and in one way it is wider than described.

1. The guard has no time limit. In src/lib/back-office/catalog-actions.ts:136-137, hasSalesOrTickets blocks on any ticket of the type where `status = 'booked'`, whatever the séance date. updateTicketTypeCore (catalog-actions.ts:208-209) refuses rdvFree false → true with RDV_FREE_HAS_SALES whenever that check is true.

2. A booked ticket stays 'booked' after its séance. I listed every write to ticket.status:
   - eligibility.ts:62 sets 'booked'.
   - atomic.ts:190-205 (RET) moves booked back to available or expired, but only for bookings ended by a cancel action.
   - nightly.ts:28 expires only 'available' tickets.
   - wallet.ts:478 and :517 (point and unpoint) handle only available ↔ used.
   - booking_status has no 'completed' value (tickets-vocab.ts:29: pending/confirmed/cancelled/expired), and runNightly (nightly.ts:118-158) has no step that settles past bookings.
   - Invariant I2a (invariants.ts:32-42) even requires a booked ticket to keep pointing at a confirmed booking.
   - The wallet derives « Utilisé le … » at display time: wallet-view.ts:136 doneView, and doneAt :140.
   So a ticket that was ever booked and never cancelled keeps the type blocked forever.

3. It is wider than the RDV case. A ticket of the type booked months ago on a tickets-mode event séance blocks the switch in the same way.

4. The UI does not warn first. canBecomeFree (rdv-form.ts:88-90) looks only at offers en vente and usableTickets, which come from readUsableCounts (catalog-reads.ts:231/252), so the switch stays enabled. The save then fails with « Ce type a des offres en vente, un paiement en cours ou des tickets valides … » (catalog-actions.ts:50-51). That message names nothing the pro actually has: they have no offer en vente, no payment in progress and no valid ticket.

5. The only way out is destructive. cancelBookingsByPro allows cancelling past bookings (« any time (past too, to fix a mistake) », cancel.ts:198-199), and so does cancelOccurrence. But that rewrites history and sends cancellation emails (cancel.ts:247), and the returned tickets would then still need closing. A new type is the only reasonable route, so « never » is right in practice.

6. Nothing else covers it. The engine's updateTicketType (booking/catalog.ts) has no rdvFree rule. The DB test at catalog-actions.db.test.ts:214-225 only covers a ticket booked on a future séance.

7. The Task 10 ruling (progress.md:136) priced its cost as « a pro waits for a stale pending purchase to expire (31 min) ». That holds for pending purchases: expireStalePurchases runs every night (release.ts:106-119). It does not hold for booked tickets, which block permanently. The ruling misjudged that cost.

Severity is Important, not Critical. A pro will hit this on a common case (a paid « Découverte » turned free), the refusal is misleading and there is no reasonable way out. But no data is lost or corrupted, and creating a new type works around it.

One caveat on the proposed fix. Counting only booked tickets on séances with starts_at > now leaves a corner case: the pro can still cancel a past booking (cancel.ts:198-199, and cancelOccurrence has no time guard), which returns the ticket as available on a type that is now free. ELIGIBLE (eligibility.ts:19-21) refuses it for RDV, but it stays usable on linked tickets-mode events. That is the same class as the deferred P4 rdv_free carries and acceptable. Whoever fixes this should decide it on purpose rather than assume a past booking can never return its ticket.
- real=true Important: F2 is real, as described. Everything below was checked in the code.

**The defect**
- `hasSalesOrTickets` (src/lib/back-office/catalog-actions.ts:129-140) blocks the switch to « Gratuit » on any ticket of the type with `status = 'booked'`, with no condition on the séance.
- Nothing in normal use ever moves a ticket out of `booked`:
  - The only writes to `used` are pointTickets and unpointTickets, which go available -> used and back (wallet.ts:478-525).
  - The nightly `expireTickets` only touches `available` tickets (nightly.ts:27-29).
  - Spec § 7 (line 513) says « Utilisé le JJ/MM » is worked out when the page is shown, with no state change.
  - I2 (invariants.ts:33-41) requires a booked ticket to stay tied to its confirmed booking.
- So any type that ever had one ticket booked, on an RDV or an event séance, past or future, gets RDV_FREE_HAS_SALES forever.
- The page does not see it coming:
  - `canBecomeFree` (rdv-form.ts:88) only looks at active offers and `usableTickets` (available and unexpired, catalog-reads.ts:252). The switch stays enabled, the save is refused, and the form switches it back (ticket-type-editor.tsx:183).
  - The message (catalog-actions.ts:50-51, « …ou des tickets valides… ») and FREE_LOCKED_HELP (ticket-type-editor.tsx:29) point at things the pro does not have. Their wallet shows those tickets as « Utilisé le JJ/MM ».
- The DB test (catalog-actions.db.test.ts:203-212) only books a ticket on a future séance from makeEvent.
- I agree the Task 10 ruling (progress.md:136) underestimated the cost. It is not « a 31 min wait »: any type with a past booking can never become free.
- A related point: nothing in this branch calls `expireStalePurchases` or `releasePurchase` yet (runNightly has no caller; the webhook and cron arrive in P4). So today an abandoned checkout also blocks the switch with no end date, not 31 min.

**Small correction to the wording**
« Nothing the pro can do » is a little strong. E6a `cancelBookingsByPro` lets the pro cancel past bookings (cancel.ts:191-192, « past too, to fix a mistake »). That returns the ticket, which the pro can then close. But that rewrites history and emails clients a cancellation. In practice the only way out is to rebuild the type: hours, questions and overrides by hand.

**Impact**
- No security, money or data harm: the old type keeps its history.
- A pro hits it on the first « Gratuit » switch of any type already in use (for example a paid « Découverte » that becomes a free call). The refusal points at nothing they can act on, which leads to support requests and lost trust.
- This is wrong behaviour a pro will hit on a feature the spec calls for (§ 2, rdv_free). It is not Critical: there is a workaround and no harm is done. So Important.

**The proposed fix is right, with three notes**
1. Counting only tickets booked on a confirmed booking of a `scheduled` séance with `starts_at > now` keeps exactly the case the ruling meant: a client cancellation (E5 requires `starts_at > now`, cancel.ts:162) bringing the ticket back on a free type. Two actions the pro takes can still bring back or reuse a past booked ticket:
   - E6a past cancellation.
   - `moveAttendee`, which does not check the source séance's date (wallet.ts:569-590).
   
   Both are acceptable because the pro does them and the Q16 orange alert (rdv_free counts as not RDV-enabled) shows the ticket. The code comment should say so.
2. The pending rule (`checkout_expires_at > now or processing_at is not null`) is the same as `deletionImpact` (account.ts:41). It is consistent and also removes the current open-ended block.
3. `canBecomeFree`, FREE_LOCKED_HELP and the RDV_FREE_HAS_SALES text should name the real reasons: « réservations à venir », « paiement en cours ». `isFreeSalesRefusal` matches on the opening words, so rewording the message means updating that check and its unit test.

The tests to add:
- a ticket booked on a past séance: the switch is accepted;
- a future booked ticket: still refused;
- a pending purchase whose checkout has expired: accepted;
- a pending purchase being processed: refused.

## R1 (reads, reviewer Important, confirmed=true)
src/components/dashboard/occurrence-dialog.tsx:408  Planning shows « N inscrits » from raw seats_taken (pending holds counted, lapsed ones too), so it disagrees with its own seat count, the event page and the dashboard

Scenario: Take a séance with capacity 10, 2 confirmed bookings and 1 abandoned buy+book checkout whose 45-min hold has lapsed. In P3 nothing releases it before the next claim or the nightly sweep. The occurrence dialog reads « 3 inscrits sur 10 · 8 places en ligne » (3 + 8 = 11 > 10), and the same dialog lists that person as « Paiement non finalisé, place libérée ». The grid block shows « 3/10 » (planning-calendar.tsx:84), its aria-label says « 3 inscrits sur 10 » (planning-calendar.tsx:37 and planning-view.ts:318 blockLabel), and the dashboard week preview title shows « (3/10) » (week-preview.tsx:135). Meanwhile the event page shows « 2 / 10 places » (events/[id]/page.tsx:161 uses capacity - seatsShown) and the KPI says « dont 2 inscrits » (dashboard-reads.ts:63-65: confirmed only). A live hold (« Paiement en cours ») is also counted as « inscrit », although dashboard-reads documents that a pending booking is no registrant. Same root cause: hiddenByTimeOff (planning-view.ts:100) tests seatsTaken > 0, so an empty séance whose only seat is a lapsed hold stays visible under a time off and is counted in the 7-day KPI.

Proposed fix: Pick one meaning of « inscrits » for the back-office (confirmed, or confirmed + live holds) and expose it on PlanningItem/PlanningItemVM (for example liveSeats = seatsTaken - elapsedHolds, or a confirmed count from loadAttendees). Use it in seatsText, the block's second line, blockLabel, the week-preview title, the dialog line and hiddenByTimeOff. Add a pure test with a lapsed hold. SessionCapacityControl can keep seatsTaken as its minimum, because the engine's greatest(cap, seats_taken) does not release holds first.

Votes:
- real=true Important: I traced the scenario through the code and the wrong counts do appear as described. It sits at the low end of Important: it only shows numbers, it lasts until the hold is released, and nothing in P3 can create a hold yet.

**Code path**
- `getPlanningPage` reads items through `planning-reads.ts`. `selectOccurrences` (line 109) takes the raw `occurrence.seats_taken`. `loadItems` (lines 330-332) passes it through as `seatsTaken`. It also computes `elapsedHolds` (`elapsedHoldsOf`: pending bookings with `hold_expires_at < now`) and `seatsShown = max(0, cap - seatsTaken + elapsedHolds)` (`holds.ts:59-60`).
- No release runs on read. The planning page only calls `ensureHorizon`. `releasePurchase` and the `checkout.session.expired` webhook are listed as P4 callers (`release.ts:26`). So a lapsed hold stays in `seats_taken` until the next claim on that séance or the nightly sweep. The engine invariant I1 (`invariants.ts:21`) confirms that `seats_taken` = pending + confirmed bookings.
- `toPlanningVM` copies `seatsTaken` unchanged (`planning-view.ts:191`).

**The scenario's numbers** (capacity 10, 2 confirmed, 1 lapsed hold)
- Raw `seatsTaken` = 3 and `seatsShown` = 10 - 3 + 1 = 8.
- The occurrence dialog (`occurrence-dialog.tsx:408`) prints « 3 inscrits sur 10 · 8 places en ligne », so 3 + 8 = 11 on a capacity of 10.
- The same dialog's attendee list (pending and confirmed bookings, `planning-reads.ts:184`) shows that person with « Paiement non finalisé, place libérée » (line 82, `holdLapsed` from `planning-view.ts:120`).
- The dialog's own confirm copy already leaves lapsed holds out (lines 247-251), so the summary line contradicts it.
- Other places that use the raw count:
  - the grid block's second line `3/10` (`planning-calendar.tsx:84`)
  - its accessible name via `blockLabel`, « 3 inscrits sur 10 » (`planning-view.ts:318`; `seatsText` at `planning-calendar.tsx:37` is the same)
  - the week-preview title « (3/10) » (`week-preview.tsx:135`).
- The event page prints `capacity - seatsShown(occurrence)`, which is « 2 / 10 places » (`events/[id]/page.tsx:160-161`), with a comment that says to leave lapsed holds out.
- The KPI counts confirmed bookings only (`dashboard-reads.ts:64-65`, 130-139) and renders « dont N inscrits » (`dashboard-view.ts:53`).
- The ledger's Task 15 carry said exactly this: raw `seatsTaken` includes lapsed holds and must not be labelled « inscrits ». The event list follows it; the planning does not.

**Live hold**
- A live pending hold is also inside `seatsTaken`, so it is labelled « inscrit », while `dashboard-reads` says a pending booking is no registrant.
- This part is weaker. The event page also counts a live hold as a taken seat, and the dialog lists that person with « Paiement en cours ». It only disagrees with the KPI.

**Time off**
- `hiddenByTimeOff` (`planning-view.ts:100`) tests raw `seatsTaken > 0`, and `weekCounts` reuses it (`dashboard-reads.ts:118-121`).
- It can happen this way: the hold exists when the time off is created, the pro chooses `cancelBooked=false` (`cancel.ts:412-435`), then the hold lapses.
- Claims are refused under a time off (`claims.ts:309`), so no claim releases that seat. It stays until the nightly sweep: the séance remains visible and counts in the 7-day KPI.
- This is an edge case. The Task 21 review kept `seatsTaken > 0` on purpose to match the `cancel.ts:459` time-off guard, but that was not a « Ruling: » line, and this display mismatch was not weighed there.

**When it is reachable**
- Today nothing outside tests calls `startBuyAndBook` or `bookRdv`, so P3 alone cannot produce a pending hold.
- The branch ships as a whole, and P3's planning code is already written to handle these holds (`seatsShown`, `isPhantomRdv`, `holdLapsed`).
- Once P4 lands, lapsed but unreleased holds last for hours:
  - in mock checkout mode, until the nightly job (as `admin-reads.ts:221-226` documents)
  - for delayed payments
  - when the webhook fails.
- So a pro will see this wrong count on the planning grid, which is the main back-office view. The Task 21 reviewer graded the phantom-RDV form of the same problem (a lapsed hold left in raw `seats_taken`) as Important.

**On the proposed fix**
- It is sound: expose `seatsTaken - elapsedHolds`, or a confirmed count, and use it for every label and for `hiddenByTimeOff`.
- `SessionCapacityControl` can keep the raw minimum, because the engine's `greatest(cap, seats_taken)` does not release holds first. Its text « N personnes sont déjà inscrites » (`session-capacity-control.tsx:76`) shares the same wording issue.
- There is no pure test with a lapsed hold for any of these labels (`planning-view.test.ts` sets only `seatsTaken`).
- real=true Minor: The defect is real, but I grade it Minor, not Important. I found no guard that prevents it.

What the code does:
- `seatsTaken` is the raw `occurrence.seats_taken`. It comes from planning-reads.ts:109 into `PlanningItem` at :330, and toPlanningVM copies it unchanged (planning-view.ts:191).
- Nothing releases holds on read. getPlanningPage (src/server/planning-queries.ts) only reads. `expireElapsedHolds` is called only from claims.ts:1012 and release.ts:91.
- `seatsShown` is `capacity - seatsTaken + elapsedHolds` (holds.ts:59-60).

With capacity 10, 2 confirmed and 1 lapsed hold not yet released, occurrence-dialog.tsx:408 renders « 3 inscrits sur 10 · 8 places en ligne » (3 + 8 = 11). The same dialog marks that row « Paiement non finalisé, place libérée » (:81-82). Its own cancel and unenroll copy also leaves lapsed holds out (:251, :261).

The other display sites I checked all use the raw count:
- planning-calendar.tsx:84 (« 3/10 »)
- seatsText at :36-37, used in the mobile list at :209
- blockLabel at planning-view.ts:318
- week-preview.tsx:135
- the « personnes sont déjà inscrites » line in session-capacity-control.tsx:76

The event page (events/[id]/page.tsx:161, `capacity - seatsShown`) shows 2 / 10. The KPI counts confirmed bookings only (dashboard-reads.ts:63-65, :127-136). The ledger's own carry at progress.md:181 says raw seatsTaken must not be labelled « inscrits ». That was applied to the event page only, and no Ruling covers the planning.

Two sub-claims are weaker:
1. Live holds: the event page counts them too (`capacity - seatsShown` includes them), and the dialog's cancel copy treats them as registrants. With a live hold, the dialog line adds up (3 + 7 = 10). Only the KPI differs, and Q25 documents that on purpose. So the clear bug is lapsed holds only.
2. hiddenByTimeOff (planning-view.ts:100): the Task 21 review (progress.md:236) kept `seatsTaken > 0` on purpose, to match the engine's time-off rule (cancel.ts:389 and :459). I agree with keeping it.

Why Minor:
- Unreachable today: at the end of P3, no production code creates a pending hold. startBuyAndBook and bookRdv are called only from tests, and registerPro creates confirmed bookings.
- Rare in P4: with Stripe live, the Checkout session expires at 31 min and the `checkout.session.expired` webhook releases the hold (E11) before it lapses at 45 min. The state needs a delayed payment, a missed webhook or mock-mode abandonment.
- Short-lived: it lasts until the next claim on that séance or the nightly sweep.
- Display only: no data, money or tenancy effect, and the row itself says the seat is free.
- Precedent: the ledger deferred similar lapsed-hold miscounts as minor (Task 22 at :249, Task 39 at :414).

The proposed fix is cheap and matches the controller's own carry: expose `seatsTaken - elapsedHolds` on the VM and use it for the « inscrits » labels.
- real=true Minor: The main claim checks out in the code. The impact is smaller than "Important" once P4 ships.

What I verified:
- planning-reads.ts:315-332 builds every PlanningItem with `elapsedHolds` and `seatsShown = capacity - seatsTaken + elapsedHolds` (holds.ts:59-60). `toPlanningVM` (planning-view.ts:173-206) drops `elapsedHolds` and passes on the raw `seatsTaken`. That raw figure is then labelled « inscrits » in these places:
  - occurrence-dialog.tsx:408 (« N inscrits sur C · M places en ligne »). With capacity 10, 2 confirmed and 1 lapsed hold, it reads « 3 inscrits sur 10 · 8 places en ligne ».
  - planning-calendar.tsx:37 seatsText (the narrow-width list, line 209) and line 84 (« 3/10 » on the block).
  - planning-view.ts:318 blockLabel (the accessible name).
  - week-preview.tsx:135 (title « (3/10) »).
- The same dialog shows that person as « Paiement non finalisé, place libérée » (lines 81-82). Its own cancel confirmation already leaves lapsed holds out (line 251, `!a.holdLapsed`). The event page leaves them out on purpose (events/[id]/page.tsx:160-161, capacity - seatsShown, with an explicit comment). The KPI counts confirmed bookings only (dashboard-reads.ts:63-65, 136).
- In P3 nothing releases a lapsed hold except R(o) before a claim (claims.ts:1012) or the nightly sweepHolds (release.ts:76-91). releasePurchase has no caller yet.
- The ledger's Task 15 carry (progress.md:181) says raw seatsTaken "includes lapsed holds - do not label it « inscrits »". The planning breaks that carry on 5 surfaces. So this is a real defect against the plan's own rule, not a matter of taste.

Parts I do not accept as defects:
- (a) A live hold counted as « inscrit »: the dialog lists pending live holds under its « Inscrits » list (aria-label, line 470) and counts them as registrants in the cancel copy. "Confirmed + live holds" is already the dialog's own meaning, and the event page counts live holds as taken places too. Only the dashboard KPI uses confirmed-only, and it is a separate 7-day measure.
- (b) hiddenByTimeOff `seatsTaken > 0` (planning-view.ts:100) was kept on purpose in the Task 21 review (progress.md:236) to match the engine's time-off rule. That rule (cancel.ts:459) treats `seats_taken > 0` séances as booked in the time-off "seen" set. If only the view changed, the planning would hide a séance that the time-off step just listed as booked and the pro chose to keep. That part of the proposed fix should be dropped, or done together with the engine. The 7-day KPI séance count follows the same rule.

Impact:
- Display only. No tenancy, data, money or security effect. The online availability (`seatsShown`) is correct.
- The pro sees one extra registrant per unreleased lapsed hold. At worst « 10/10 » on a séance that is still bookable online, which could lead a pro to tell a walk-in it is full.
- The state is rare in the shipped product: CHECKOUT_MINUTES = 31 and HOLD_MINUTES = 45 (tickets-vocab.ts:170-172). The P4 `checkout.session.expired` webhook calls releasePurchase about 14 minutes before the hold lapses (spec E11; ledger line 414 calls it "the timely release"). Once Stripe is live, the bad state only appears when that webhook is more than 14 minutes late or fails, or in mock mode when a tab is closed. Even then it clears at the next claim or the nightly sweep.
- Inside the dialog, the lapsed row explains the gap.
- That is why I grade it Minor: a real, cheap-to-fix inconsistency that breaks a ledger carry.

The proposed fix:
- Right in substance. Carry `elapsedHolds`, or `liveSeats = seatsTaken - elapsedHolds`, into PlanningItemVM. Use it in seatsText, the block's second line, blockLabel, the week-preview title and the dialog line. Add a pure test with a lapsed hold.
- Keeping SessionCapacityControl's minimum at seatsTaken is correct.
- It is incomplete in one place: session-capacity-control.tsx:74-76 also says « Minimum N : N personnes sont déjà inscrites » from raw seatsTaken. The minimum must stay, but the copy should say "places prises" or use the live count.
- Drop the hiddenByTimeOff change (see (b) above).

## R2 (reads, reviewer Important, confirmed=true)
src/lib/back-office/client-reads.ts:529  Client record « Passées (N) » holds future cancelled or expired bookings and shows the capped count (50) as the total

Scenario: (a) Take a weekly client after 14 months, with about 60 past bookings. getClientRecord returns past.slice(0, PAST_BOOKINGS_MAX) (line 569), and client-bookings.tsx:201 prints « Passées (50) », the length of the slice, with no word about the cut. The 300-row RECORD_BOOKINGS_MAX read cuts silently too. (b) Any booking that is not live goes to « Passées », whatever its date: the one the client cancelled for next Tuesday, all the bookings of a séance the pro cancelled next week, and an abandoned checkout on a future séance (statusAt makes it « expired »). Because the list is ordered newest first, these future dates sit at the top of « Passées ».

Proposed fix: Put only rows whose séance has ended (endsAt <= now) in « Passées ». Show future cancelled or expired rows in their own group (« Annulées ») or under « À venir » with their badge. Read or compute the true past count before slicing, and say « les 50 plus récentes » when the list is cut. Add a DB test for a cancelled future booking and for more than 50 past bookings.

Votes:
- real=true Minor: I traced the path from /dashboard/clients/[id]/page.tsx:82-85 through getClientRecord to ClientBookings. Both halves of the finding happen as described. I grade it Minor, not Important, because it only affects how the list is displayed.

(a) The count is capped. The read in src/lib/back-office/client-reads.ts:446-471 orders by occurrence.startsAt desc and stops at 300 rows (RECORD_BOOKINGS_MAX). In the loop at :526-530, any row that is not live and not ended goes into `past`. Line :569 then returns past.slice(0, 50). src/components/dashboard/client-bookings.tsx:201 prints `Passées (${formatCount(past.length)})`. Nothing in the component or the page says the list was cut. A client with 60 past bookings therefore shows « Passées (50) » with no hint that 10 are missing. The DB test client-reads.db.test.ts:780-803 checks that the list is cut at 50 but not what count is shown, so the proposed « add a test for more than 50 » half-exists already. The silent 300-row cut is real in code, but it only matters if a client has 250 or more future-dated rows, which is unrealistic.

(b) Future rows land in « Passées ». The rule at :528-529 is `live && r.endsAt > now ? upcoming : past`. A cancelled row and an expired row are never live, so they go to `past` whatever their date. « Expired » here includes a pending booking whose hold has lapsed or is null (statusAt, :313-316), i.e. an abandoned checkout on a future séance. `past` keeps the query's newest-first order, so future dates come first. The DB test client-reads.db.test.ts:729-737 pins exactly this: a booking cancelled for now+7 days and a hold that lapsed for now+6 days sit above a booking from 2 days ago. The comment at client-bookings.tsx:114 (« a cancelled registration moves to « Passées » ») and the plan (« past = the rest », plan line 30727) show this was designed on purpose. There is no « Ruling: » line on it in progress.md; the Task 31 entry only records « lapsed hold → expired (past list) ». So the data is intended, but the label « Passées » does not match it. A new client whose only booking was cancelled for next week sees « Aucune inscription à venir » next to « Passées (1) ». Future cancelled rows also take up slots in the 50 cap.

Why Minor: each row still has its date and a status badge (« Annulée » or « Expirée »). Cancelled and expired rows offer no actions (canMove and canUnenroll are false), so the wrong grouping cannot cause a wrong action. « Upcoming » stays correct. The count was never an attendance figure, since it already mixes in cancelled rows. No data is lost and no flow is blocked.

The proposed fix is sound: put only ended rows in « Passées », group future cancelled or expired rows apart, and show the true total or « les 50 plus récentes » when the list is cut. Doing so means changing the test at :729-737 on purpose.
- real=true Minor: The behaviour is real as described. I looked for a guard in the read, the page, the component and the tests and found none.

(a) Cap shown as the total. src/lib/back-office/client-reads.ts:569 returns `past: past.slice(0, PAST_BOOKINGS_MAX)` (50, line 44). The record type at line 285 has no total and no truncation flag. src/app/dashboard/clients/[id]/page.tsx:84-85 passes the arrays through unchanged. src/components/dashboard/client-bookings.tsx:201 prints `Passées (${formatCount(past.length)})`. A client with 60 past bookings therefore reads « Passées (50) », with no note that the list was cut, and the 10 oldest bookings are missing from the record. The 50 also includes cancelled and expired rows, so even fewer real past sessions are shown. The DB test at client-reads.db.test.ts:780-803 checks the 50-row slice but not the total. The 300-row RECORD_BOOKINGS_MAX cut at line 474 is harmless in practice: past is capped at 50 anyway, and more than 250 future bookings is not realistic.

(b) Future non-live rows land in « Passées ». Line 529, `(live && r.endsAt > now ? upcoming : past)`, sends every cancelled or expired booking to past whatever its date. statusAt (lines 310-313) turns a lapsed hold into « expired ». cancel.ts:55/66 cancels the bookings of a cancelled séance, so all of them go to past too. The list is ordered newest first (line 472), so future dates sit at the top.

Why I grade it lower than Important:
- (b) was built on purpose and is tested. The plan's record type says `past = the rest`. The component comment at client-bookings.tsx:113-114 says a cancelled registration « moves to « Passées » ». client-reads.db.test.ts:729-737 asserts that a cancelled booking at +7 days and a lapsed hold at +6 days are in past, above a real past RDV. Each such row carries an « Annulée » or « Expirée » badge and offers no action. The proposed fix's « add a test for a cancelled future booking » is therefore already covered, and that test pins the current grouping. This is not a « Ruling: » line, but it is a deliberate plan choice. Only the heading « Passées » is a misnomer.
- (a) is a real wrong number that any long-term regular will trigger. Its impact is informational only: it sits in a collapsed `<details>`, the shown count matches the rows listed, no data is lost, no flow breaks, and the bookings stay reachable from the planning. The fix is small: return a total or a truncated flag and say « les 50 plus récentes ».

Overall I grade it Minor. If the owner treats the silent cap as « missing required behaviour » (spec §13.1: « Inscriptions à venir et passées », with no cap stated), part (a) alone could be pushed to Important.
- real=true Minor: The code does what the finding says. src/lib/back-office/client-reads.ts:528-529 puts a row in `upcoming` only when it is live (pending or confirmed after statusAt) AND `endsAt > now`. Every other row goes to `past`: a cancelled booking on a future séance, every booking of a séance the pro cancelled (cancelling unenrols them), and a lapsed hold on a future séance (statusAt at :313-316 turns it into « expired »). Because the read is ordered `desc(occurrence.startsAt)`, those future-dated rows come first in « Passées ». Line 569 returns `past.slice(0, PAST_BOOKINGS_MAX)`, and src/components/dashboard/client-bookings.tsx:201 prints `Passées (${formatCount(past.length)})`, which is the length of the slice. So a client with 60 non-live bookings shows « Passées (50) » and nothing says the list was cut.

Impact: this is a labelling and count problem, not a data or security one. Each row still shows its true date (whenLabel) and a BookingStatusBadge (« Annulée » or « Expirée »), and canMove/canUnenroll are false, so no wrong action is offered. No money, tenancy or data-integrity effect. The older bookings left out are still in the planning, and their ticket movements are in the history. The pro meets two small inconsistencies:
- A future date sits under « Passées » after any cancellation or abandoned checkout. Abandoned retries also add expired rows.
- After 50 rows the header stays at « (50) », and that number also counts cancelled and expired rows, so it is not « séances attended ».

This is mildly misleading and causes no wrong outcome, hence Minor rather than Important. The choice was also deliberate. The contract (docs/superpowers/plans/2026-10-14-p3-back-office-contract.md:1301) defines past as « the rest, by start desc, at most 50 ». The DB tests codify both behaviours: client-reads.db.test.ts:641-646 and :729-736 assert that a cancelled booking and a lapsed hold on a future séance land in `past`, and :780 tests the PAST_BOOKINGS_MAX cut. That is design intent, though it still clashes with the meaning of the word « Passées ».

On the proposed fix: splitting on `endsAt <= now` and putting future cancelled or expired rows in their own group is right. Putting them under « À venir » would clutter the actionable list, so a separate group is better. Showing the true count, or reading PAST_BOOKINGS_MAX+1 and adding « les 50 plus récentes », fixes the capped count. The fix is incomplete on tests: the tests it asks for already exist but assert the current behaviour, so they must be changed, not added. The RECORD_BOOKINGS_MAX=300 cut mentioned in the scenario barely matters here because past is capped at 50 anyway. A cheaper fix that is just as acceptable: rename the section « Historique » (or « Passées et annulées ») and add the « 50 plus récentes » note.

## R3 (reads, reviewer Important, confirmed=true)
src/lib/back-office/dashboard-reads.ts:144  Counts that filter ticket on professional_id alone scan every pro's tickets (no ticket.professional_id index) on each dashboard and /dashboard/tickets load

Scenario: ticketsInCirculation (dashboard-reads.ts:144-156) and readUsableCounts without a type id (catalog-reads.ts:168-182, the list page) read `ticket WHERE professional_id = p AND status = 'available' AND (expires_at IS NULL OR expires_at > now)`. The ticket table has no index that starts with professional_id (schema.ts:670-675: customer_id-first, purchase, type, and the partial ticket_expires_idx). So the planner can only read every available ticket of the whole platform, by a BitmapOr on ticket_expires_idx or a sequential scan, and then filter on professional_id. The cost grows with the platform, not with the pro (1 000 pros × 5 000 tickets in circulation = about 5 M rows per dashboard load). client-reads.ts:97-99 notes this missing index and works around it there only.

Proposed fix: Use the same workaround here: `ticket_type_id = any(<this pro's type ids>)` uses ticket_by_type_idx, or `customer_id in (select id from customer where professional_id = p)` uses the customer index. Or add a ticket(professional_id, status) index in a migration. Run EXPLAIN on a seeded branch.

Votes:
- real=true Minor: I traced both paths and the problem is there as described.

1. /dashboard: src/app/dashboard/page.tsx:26 calls getDashboardPage (src/server/queries.ts:23-24), which calls getDashboardData (dashboard-reads.ts:327), which calls ticketsInCirculation (dashboard-reads.ts:144-156). That runs `count(*) FROM ticket WHERE professional_id = p AND status = 'available' AND (expires_at IS NULL OR expires_at > now)`.
2. /dashboard/tickets: src/app/dashboard/tickets/page.tsx calls getTicketTypesPage (src/server/catalog-queries.ts:28), which calls listTicketTypes (catalog-reads.ts:264), which calls loadSummaries with onlyTypeId undefined, which calls readUsableCounts (catalog-reads.ts:168-182). With no type id, the `eq(ticket.ticketTypeId, ...)` term drops out and the same predicate remains, grouped by type.

The only ticket indexes are at src/lib/db/schema.ts:670-674 and drizzle/0011_tickets_schema.sql:367-370:
- ticket_booking_uq (booking_id)
- ticket_customer_status_type_idx (customer_id, status, ticket_type_id)
- ticket_by_purchase_idx
- ticket_by_type_idx
- the partial ticket_expires_idx (expires_at) WHERE status = 'available'

No later migration adds one, and none starts with professional_id. The planner is left with two choices: a BitmapOr on ticket_expires_idx (IS NULL plus > now), which reads every usable ticket on the platform, or a sequential scan. Either way it then filters on professional_id. So the cost of each dashboard and tickets-list load grows with the whole platform, not with the pro.

The code is also inconsistent:
- client-reads.ts:95-97 states that ticket has no professional_id index and limits its reads to the pro's customers for that reason (ledger Task 31 ruling: « the overview runs the scan on every load »).
- customerAlertCounts (client-reads.ts:239) adds `ticket_type_id = any(...)` and so uses ticket_by_type_idx. It runs on the same dashboard load.

Why Minor and not Important:
- The gap is already a binding carry. The P2 outcome (2026-10-12-p2-domaine-outcome.md:25, Task 4 parked) names « no professional_id-leading index on booking/ticket/booking_answer ». Its ruling is to ship additive migration 0013 fk_support_indexes before the P6 prod rollout, and says it must be in the P6 plan.
- Both queries follow the plan as written (plan lines 8935 and 35731).
- The results are correct. Nothing about security or tenancy is affected: the professional_id filter is present.
- At the current production scale, a few pros, the scan costs milliseconds. No pro or client sees wrong behaviour today.

One thing to act on: that P2 ruling was justified by « nothing in P2 builds on it ». That is no longer true now that P3 puts these scans on the two most visited back-office pages. The P6 carry should name a ticket(professional_id, status) index explicitly, or the two reads should take the customer_id / ticket_type_id workaround already used in client-reads.ts. I did not run EXPLAIN, because DB access was out of scope for this review.
- real=true Minor: The code matches the description. ticketsInCirculation (src/lib/back-office/dashboard-reads.ts:144-156, called once per dashboard load at :327) and readUsableCounts (src/lib/back-office/catalog-reads.ts:168-182) both filter ticket on professional_id = p AND status = 'available' AND (expires_at IS NULL OR expires_at > now). The /dashboard/tickets list page calls readUsableCounts through loadSummaries at :232 with onlyTypeId undefined, so no ticket_type_id predicate is added. The ticket table's only indexes (src/lib/db/schema.ts:669-674 and drizzle/0011_tickets_schema.sql:367-370) are ticket_booking_uq(booking_id), ticket_customer_status_type_idx(customer_id, status, ticket_type_id), ticket_by_purchase_idx, ticket_by_type_idx(ticket_type_id) and the partial ticket_expires_idx(expires_at) WHERE status = 'available'. drizzle/0012_tickets_manual.sql adds no ticket index, and proRef() adds none either. So no index can find one pro's tickets: the planner must either scan the table or read every available, valid ticket on the platform through ticket_expires_idx and then filter on professional_id. The cost grows with the whole platform, as claimed. client-reads.ts:97-99 notes the same missing index and works around it only there (the Task 31 ruling).

I downgraded it from Important to Minor for three reasons:
(1) The P2 outcome already parks this exact gap. Task 4 (docs/superpowers/plans/2026-10-12-p2-domaine-outcome.md:25) names « no professional_id-leading index on booking/ticket/booking_answer » and rules that an additive migration 0013 "fk_support_indexes" ships BEFORE the P6 prod rollout. The ruling says it « must be in the P6 plan ». feat/tickets-events never merges before P6, so no production pro runs these reads without that index if the carry is honoured.
(2) It is purely a performance cost that only shows at a scale Skedul does not have (the 1 000 pros × 5 000 tickets figure is hypothetical). Every result is correct, and no pro or client sees wrong behaviour today.
(3) The DB tests show the counts are correct.

The part that is still worth recording: P3 adds two hot, on-every-load reads that now depend on that parked index. The P2 ruling was motivated only by deleteUser and delete-else-archive. When the P6 plan writes 0013, it should give ticket an index that starts with professional_id, ideally (professional_id, status), and name these two reads as its consumers. A cheaper local workaround is to filter on customer_id in (select id from customer where professional_id = p), the same pattern as client-reads. Neither plan was measured with EXPLAIN (the test branch is too small, as Task 31's re-review notes), so the exact plan the planner picks is inferred from the schema, not observed.
- real=true Minor: The problem is real as described. My grade is Minor, not Important.

What I checked:
- The `ticket` table has no index that starts with `professional_id`. The indexes are listed in src/lib/db/schema.ts:670-674 and drizzle/0011_tickets_schema.sql:367-370:
  - `ticket_customer_status_type_idx` (customer_id, status, ticket_type_id)
  - `ticket_by_purchase_idx`
  - `ticket_by_type_idx`
  - the partial `ticket_expires_idx` (expires_at) WHERE status = 'available'
  - the unique on booking_id
- Migration 0012 adds no ticket index.
- `ticketsInCirculation` (src/lib/back-office/dashboard-reads.ts:144-156, called on every dashboard load at :327) filters on professional_id, status = 'available' and (expires_at IS NULL OR expires_at > now) only. The planner can only use a BitmapOr on `ticket_expires_idx`, which reads every valid available ticket of the whole platform, or a seq scan. It then filters on professional_id. The cost grows with the platform, not with the pro.
- `readUsableCounts` (src/lib/back-office/catalog-reads.ts:168-182) has the same plan when it is called without a type id, which is what the list page does through `listTicketTypes` and `loadSummaries`. The detail page passes a type id and uses `ticket_by_type_idx`, so it is fine.
- src/lib/back-office/client-reads.ts:97-99 notes the missing index and works around it with `customer_id in (select id from customer where professional_id = p)`. That workaround came from the Task 31 ruling. The dashboard and list reads did not get it.
- The other P3 ticket reads all pin customer_id, booking_id, purchase_id or ticket_type_id, so they are fine.

Why Minor and not Important:
- The effect is performance only. Tenancy is preserved because the professional_id filter is still applied. There is no wrong result and no effect on data or money.
- At today's volume, a demo pro plus a handful of real ones, the cost is a few milliseconds.
- The root cause is already a parked carry. P2 outcome Task 4 (docs/superpowers/plans/2026-10-12-p2-domaine-outcome.md:25) records "no professional_id-leading index on booking/ticket/booking_answer". Its ruling is to add migration 0013 "fk_support_indexes" before the P6 prod rollout, and to put it in the P6 plan.
- The branch is a draft that must not merge before P6, so nothing ships before that index can land.
- The real risk is only that 0013 is written narrowly for deleteUser cascades and leaves out a professional_id-leading index on ticket.

On the proposed fix:
- The index option is the right one, and it is the existing carry. A partial index `ticket(professional_id, ticket_type_id) WHERE status = 'available'` would serve both counts, including the group-by. A plain `ticket(professional_id)` or `(professional_id, status)` would also do.
- An index also fixes the same predicate in `deletionImpact` (src/lib/booking/account.ts:38, a P2 file on a rare admin path), which per-site workarounds would miss.
- Of the workarounds, the customer_id subquery beats the type-id list. `ticket_customer_status_type_idx` has status as its second column, so it reads only available tickets. `ticket_by_type_idx` reads every ticket of the pro's types in every state, then filters.
- "Run EXPLAIN on a seeded branch" proves nothing here. The test branch is too small (the Task 31 re-review already says index use was not measured for that reason), so the planner picks a seq scan either way. You need volume, or `enable_seqscan = off`, to see the plan.

Recommendation: do not add a P3 fix round for this. Make sure the P6 plan's migration 0013 explicitly includes a professional_id-leading (ideally partial, status = 'available') index on ticket.

## UI-1 (ui, reviewer Important, confirmed=true)
src/components/dashboard/event-delete-card.tsx:203  Closing the event delete confirmation drops keyboard focus on <body>, and « Retour » never gets the initial focus

Scenario: A keyboard user on /dashboard/events/[id] presses « Supprimer l'événement ». The dialog opens at once in the "wait" state, with « Retour » and the confirm button disabled. The first Dialog effect focuses the panel. When the fresh preview arrives, the key flips from "wait" to "ready" and the whole ConfirmDialog remounts. The new Dialog stores its opener while rendering (dialog.tsx:95-98), and at that moment document.activeElement is the OLD "wait" panel, which leaves the DOM in the same commit. Then the old Dialog's cleanup (dialog.tsx:148-151) focuses « Supprimer l'événement ». The new Dialog's first effect (dialog.tsx:103) sees focus outside its panel and focuses the panel, so the autoFocus that « Retour » got in the layout phase is undone. When the pro presses « Retour » or Escape, `opener.isConnected` is false, so no focus is restored and focus falls to <body> (WCAG 2.4.3). The same remount happens after a failed delete (deleting turns false), and that remount captures a null opener. The doc comments in event-delete-card.tsx:201 and confirm-dialog.tsx:18 promise behaviour the code no longer delivers since the Task 24 opener restore landed.

Proposed fix: Drop the `key` remount. Inside ConfirmDialog, add `useEffect(() => { if (open && !pending && !error) backRef.current?.focus(); }, [open, pending])` on a ref to « Retour », or let Dialog accept an explicit `returnFocusTo` ref and pass the « Supprimer l'événement » / « Voir les conséquences » button. unavailability-manager.tsx:595 already does the equivalent by hand.

Votes:
- real=true Important: I traced the path from « Supprimer l'événement » (event-delete-card.tsx:153). The bug happens as described. On this page `initialPreview` (`data.deletePreview`) is non-null whenever `fromDate` is non-null (event-reads.ts:329-420), so this path is the normal one.

What happens, step by step:
1. **The click.** `openWhole` sets the target synchronously, and `startWhole` turns `loadingWhole` on. That makes `dialogPending` true, so the key becomes "wait" and a fresh `Dialog` mounts with `open` already true.
   - While rendering, it stores `opener` = the delete button (dialog.tsx:95-98).
   - In the commit, « Retour » is disabled, so its `autoFocus` does nothing.
   - The first effect then focuses the "wait" panel (dialog.tsx:103).
2. **The fresh preview arrives.** `loadingWhole` turns false and the key flips to "ready". The new `Dialog` renders while the old "wait" panel still holds the focus, so `focusedElement()` returns that panel as the new opener. Then the commit runs:
   1. **Mutation phase:** the old panel leaves the DOM and the delete button is re-enabled (`busy` is false).
   2. **Layout phase:** React handles « Retour »'s `autoFocus`, which is now enabled, so « Retour » takes the focus.
   3. **Passive unmount cleanups of the deleted "wait" Dialog** (these run before new mount effects):
      - the focus-trap cleanup removes its listeners;
      - the opener cleanup (dialog.tsx:148-151) sees `el.isConnected` false and its opener (the delete button) connected and enabled, so it calls `opener.focus()`.
   4. **Passive mount effects of the new Dialog:** effect 1 finds `activeElement` (the delete button) outside the panel and focuses the panel. « Retour » loses its `autoFocus`.
3. **Closing.** Escape or « Retour » calls `close()`, which sets `open` to false. The opener cleanup finds that the stored opener (the old "wait" panel) is disconnected and does nothing. The removed panel took the focus with it, so focus lands on `<body>`. That fails WCAG 2.4.3.

The same remount happens on confirm (ready to wait) and again after a failed delete or a partial delete (wait to ready, or close). In each case the opener stored is an element of the panel that is being removed, so focus is never restored.

One detail in the finding is slightly off. The failed-delete remount usually stores the disconnected "wait" panel, not `null`. The outcome is the same.

Why it slipped through:
- The ledger's Task 20 re-review (progress.md:230) relied on the claim that "autoFocus controls unaffected since React focuses them before passive effects".
- That was true before Task 24 added the opener restore in a passive cleanup (progress.md:267-269). That restore now runs between `autoFocus` and the new instance's first effect, which breaks the `key` remount approach.
- The comments at event-delete-card.tsx:201 and confirm-dialog.tsx:18 are now stale.

The stray-Enter safeguard still holds, because focus rests on the panel and not on the confirm button. The real harm is keyboard focus lost to `<body>` after a destructive dialog closes, on a core back-office flow. I grade it Important.
- real=true Important: I traced the code and the problem is real. I found no guard against it: no DOM test (the ledger's Task 43 minor says "no DOM harness"), and nothing in the layout or the Dialog primitive that catches it.

What happens on the normal whole-delete path:
1. The page always passes a non-null `initialPreview` (event-reads.ts returns null only when `fromDate` is null, and then the card returns NO_FUTURE early). So `openWhole` sets `target` and `loadingWhole` in the same click, and the dialog mounts with key "wait", open=true and pending=true.
2. That "wait" Dialog stores its opener while rendering (dialog.tsx:95-98): the focused « Supprimer l'événement » button. « Retour »'s autoFocus does nothing because the button is disabled. Effect 1 (dialog.tsx:103) then focuses the "wait" panel.
3. When the fresh preview arrives, `dialogPending` turns false and the key flips to "ready", so a new Dialog instance mounts. It stores its opener during render (dialog.tsx:97), and `document.activeElement` at that moment is the OLD "wait" panel, which the same commit removes from the page.
4. During the commit, React's `commitMount` (react-dom 19.2.4, `newProps.autoFocus && domElement.focus()`, layout phase) focuses the now-enabled « Retour ».
5. Then the passive effects run. React runs every unmount cleanup before any mount effect (`commitPassiveUnmountOnFiber`, then `commitPassiveMountOnFiber`). So the old instance's restore cleanup (dialog.tsx:148-151) runs first: its panel is disconnected and its opener (the delete button, enabled again since `busy` is false) is still on the page, so it calls `opener.focus()`. The new instance's focus-trap listener is not registered yet, so nothing intercepts that.
6. The new instance's effect 1 then sees focus outside its panel and focuses the panel. « Retour » loses the initial focus. The stray-Enter safeguard still holds, because Enter on the panel does nothing.
7. On « Retour », Escape or the backdrop, `close()` sets `target` to null. The restore cleanup finds its opener (the old "wait" panel) disconnected, so it does nothing, and focus falls to `<body>` (WCAG 2.4.3).

After a failed delete the opener is actually the disconnected "wait" panel, not null as the finding says. The result is the same: no focus is restored when the dialog closes.

The comments at event-delete-card.tsx:201 (« Retour » takes the focus) and confirm-dialog.tsx:18 are therefore stale. This comes from an interaction between two rulings that were each fine on their own: the Task 20 key remount and the Task 24 opener restore. Task 24's re-review did not check them together.

I grade it Important, consistent with how Task 24 graded a missing focus restore. Every keyboard pro who opens the main delete confirmation and backs out loses their focus position.
- real=true Important: UI-1 is real. I traced it in event-delete-card.tsx, confirm-dialog.tsx, dialog.tsx and the git order. The remount key came in with 4dae326 (Task 20) and the opener restore with 68e24ec (Task 24). The comment at event-delete-card.tsx:201 was true when written and stopped being true at Task 24.

Trace. `initialPreview` is non-null whenever the card shows the buttons (page.tsx:214), so this is the main path.
1. The pro presses « Supprimer l'événement » (X). The render has `target` set and `loadingWhole` true, so the key is "wait" and the dialog is open. Dialog captures `opener = X` while rendering (dialog.tsx:95-98). « Retour » is disabled, so its autoFocus does nothing. Effect 1 (dialog.tsx:103) focuses the "wait" panel.
2. The transition ends, so the key flips to "ready" and the dialog remounts. The new Dialog captures `opener = document.activeElement`, which is the old "wait" panel, still in the DOM during render. In the commit, the old panel is removed and the new « Retour » is enabled, so autoFocus focuses it in the layout phase. Then the passive unmount effects of the deleted tree run before the new mount effects. The old trap cleanup runs first, so its focusin guard is gone. The old opener cleanup (dialog.tsx:148-151) sees its panel disconnected and calls `X.focus()`; X is enabled again because busy is false. The new Dialog's effect 1 then sees focus outside its panel and focuses the panel, which undoes the « Retour » autoFocus.
3. On « Retour », Escape or the backdrop, `target` becomes null and the key stays "ready". The cleanup's opener is the detached "wait" panel, so nothing is restored and focus falls to `<body>`.

After a failed delete the same thing happens through confirm → "wait" → "ready". One detail in the finding is wrong: the captured opener is the detached "wait" panel, not null. The outcome is the same: no restore on close. The error-box focus still works, because ConfirmDialog's effect runs after Dialog's.

Impact. There is no security, data or money effect. The initial focus landing on the panel instead of « Retour » is cosmetic: Enter on the panel does nothing, so the safeguard against a stray Enter still holds. The real defect is the lost focus on close (WCAG 2.4.3, level A), which a keyboard or screen-reader pro hits every time they cancel this delete, the most common path. There is also a brief stray focus on X behind the dialog. This defeats the Task 24 (a) ruling on this dialog, and the project graded the same symptom Important in Task 20 and Task 24. So I grade it Important, at the low end.

Fix. Dropping the `key` and adding a ConfirmDialog effect that focuses « Retour » when `pending` turns false with no error fully fixes the reported scenario. Without the remount the Dialog keeps `opener = X`, which is enabled again by close time, so the restore works, including after a failed delete. `error` should be in the effect's deps. That option does not cover the « Voir les conséquences » path: that button is disabled while the preview loads, so the captured opener can be body or null, and nothing is restored on close. The explicit `returnFocusTo` alternative covers both triggers and is the more complete fix. The successful from-date delete (custom panel collapses, focus falls to body, role=status announces) is a related but separate case.

## COV-1 (coverage, reviewer Important, confirmed=true)
src/lib/notify-core.ts:167  The « Inscription confirmée » e-mail gives one expiry date per type, so a client holding tickets with different expiries is told the wrong dates

Scenario: Spec § 13.6 asks for « tickets restants et leurs expirations ». ticketsLeftOf builds each line from walletBalance (src/lib/booking/wallet.ts:192-214), which keeps only min(expires_at) per type, and SQL min() skips NULLs. Case 1: a client holds 2 « Cours collectif » tickets, one valid until 12/01 and one with no limit. The pro registers them (or P4 confirms a booking) and the mail reads « 2 × Cours collectif, valable jusqu'au 12/01 inclus ». Case 2: two carnets bought at different dates are shown as all expiring on the earliest date. Grammar is wrong too: expiryLabel (src/lib/back-office/format.ts:56) is always singular, so the mail says « 3 × X, valable jusqu'au… » (booking-confirmed.ts:35) and tickets-offered.ts:26 says « vous offre 3 tickets « X », valable jusqu'au… ». The ledger left that last point « final review to triage ». notify-core.db.test.ts:47-84 only tests one expiry per type, so no test catches this.

Proposed fix: Build ticketsLeft from the per-day summary that groupWallet already computes (expirySummaryOf: « 2 valables jusqu'au 12/01 inclus », « 1 sans limite de validité »), or read count per (type, expires_at) and print one sub-line per date. Give expiryLabel a count, or use plural(n, "valable", "valables") in both templates. Add a DB test with a dated ticket plus an undated one of the same type, and a pure test for the plural.

Votes:
- real=true Important: I traced the path and the wrong dates do reach the client.

Path: the pro clicks « Inscrire », which calls registerPro (src/lib/booking/claims.ts:720). That emits confirmedEffects (claims.ts:544-548), which always includes { type: "email.booking_confirmed" }. P4 will reach the same point through fulfillment.ts:206. Next come planEffect, then planBookingConfirmed (src/lib/notify-core.ts:208), then ticketsLeftOf (notify-core.ts:167-182). ticketsLeftOf calls walletBalance (src/lib/booking/wallet.ts:192-214), which groups by ticket_type_id and returns only count(*) and min(expires_at). SQL min() skips NULLs. Each line is then built with expiryLabel(r.nextExpiry, …) (format.ts:56-61), and booking-confirmed.ts:35 renders it as « {count} × {typeName}, {expiryText} ».

Case 1 happens. Tickets are spent in the order of eligibility.ts:34, « expires_at asc nulls last », so registering spends the dated ticket first. Take a client with 2 tickets valid until 12/01 and 1 with no limit, all of the same type. After registration they hold one dated ticket and one undated ticket. walletBalance returns usable=2 with nextExpiry=12/01, and the mail reads « 2 × Cours collectif, valable jusqu'au 12/01 inclus ». The undated ticket gets a date it does not have.

Case 2 is the more common one, because validity starts at purchase (spec, offer-list VALIDITY_HELP). A client who buys a second carnet before the first one runs out is told that every remaining ticket expires on the first carnet's date.

The error always shows an earlier date than the real one, so no ticket is lost. But it misleads the client, it contradicts their own espace and the pro's wallet (both use expirySummaryOf in wallet-view.ts:144 and list each date), and it falls short of spec § 13.6, which asks for « tickets restants et leurs expirations ».

The implementation follows the contract word for word (contract line 509: « expiryText = expiryLabel(nextExpiry, tz, now) »). So this is a gap in the contract's design, not a slip by the implementer, and it is still a requirement miss against the spec. No ledger « Ruling: » covers it.

Test gap confirmed: in notify-core.db.test.ts:47-84 each type has a single expiry (2 undated « Cours collectif » tickets and 1 dated « Cours d'essai » ticket), so this case is never exercised.

The grammar point is also real: expiryLabel always says « valable », so the output reads « 3 × X, valable… » and, in tickets-offered.ts:26, « vous offre 3 tickets « X », valable jusqu'au… ». The ledger already lists it (progress.md:68, « final review to triage »). On its own it is Minor.

I grade the whole finding Important rather than Critical: the client gets wrong information in a common case, but there is no data loss and no security impact. The proposed fix holds up: reuse the expirySummaryOf wording, or count per (type, expires_at). The plural would go through plural(n, "valable", "valables") as the wallet already does.
- real=true Important: Confirmed by reading the code, and I found no guard anywhere that prevents it.

How the bug happens:
- src/lib/notify-core.ts:167-183 (ticketsLeftOf) builds each line from walletBalance, then sets expiryText to expiryLabel(r.nextExpiry, b.tz, now).
- walletBalance (src/lib/booking/wallet.ts:192-214) groups by ticket_type_id. It keeps count(*) and min(expires_at), and SQL min() ignores NULLs. A type holding one dated ticket and one undated ticket therefore gets nextExpiry = the dated value, with usable = 2.
- booking-confirmed.ts then writes one line per type: `${count} × ${typeName}, ${expiryText}`. With 2 tickets, one dated and one unlimited, the mail reads « 2 × Cours collectif, valable jusqu'au 12/01 inclus ».
- Two carnets of a type with a validity period, bought on different dates, are both shown with the earlier date. That is the normal case for any client who buys again before the first carnet is used up. Neither the schema nor the engine forces one expiry per type: offers take their own expiresAt, and purchases expire relative to their own purchase date.

Why I grade it Important:
- Spec § 13.6 asks for « tickets restants et leurs expirations ». The back-office already shows the accurate per-day breakdown (expirySummary, e.g. « 2 valables jusqu'au … inclus », « 1 sans limite de validité », checked in customer-space.db.test.ts:180). The client e-mail contradicts what the pro sees.
- The mail is triggered on every confirmed booking (claims.ts:545, fulfillment.ts:206), so clients will hit this.
- Mitigation: the date shown is never later than the real one, so it is misleading but causes no data loss.
- The plan and contract (contract.md:509) prescribed nextExpiry. Under « a reasonable user's expectation is a requirement », that does not excuse wrong information in a transactional e-mail.

Test gap:
- The only test of this path, notify-core.db.test.ts:47-84, puts one expiry class on each type: 2 undated « Cours collectif » and 1 dated « Cours d'essai ». Nothing exercises mixed expiries within one type.

Plural agreement:
- Real: expiryLabel is always singular, so a count of 2 or more gives « 3 × X, valable … » and « vous offre 3 tickets « X », valable … ».
- It is already a known deferred minor in the ledger (Task 3: plan-mandated copy, final review to triage). I would not grade it above Minor.
- tickets-offered's single expiryText is correct, because one offer action writes one expiresAt for all its tickets.

Proposed fix:
- Give the mail one sub-line per (type, expiry day), reusing the expirySummary logic.
- Add a count-aware label, and a DB test with a dated and an undated ticket of the same type.
- real=true Important: The bug is real. I checked it in the code.

- src/lib/notify-core.ts:167-182 (ticketsLeftOf) builds one line per type. It takes the date from walletBalance (src/lib/booking/wallet.ts:192-214), which returns `min(ticket.expires_at)` grouped by ticket_type_id only, and SQL min() skips NULLs.
- The engine's own test shows it: src/lib/booking/wallet-customers.db.test.ts:174-196 expects `{ usable: 3, nextExpiry: soon }` for 2 tickets with no limit plus 1 dated ticket. Fed into the mail, that becomes « 3 × X, valable jusqu'au <soon> inclus », although 2 of those tickets never expire.
- The design comes from the plan, not from a slip: contract.md:509 sets `expiryText = expiryLabel(nextExpiry, tz, now)`. That falls short of spec § 13.6 line 1536 (« tickets restants et leurs expirations »).
- The only DB test (notify-core.db.test.ts:47-84) uses one expiry per type, so nothing catches this.
- The mail goes out on every confirmed booking, including the pro's « Inscrire » in P3 (claims.ts:544-548, run via pro-context.ts:81).

One correction to Case 1. As written (2 tickets, one dated and one with no limit, booked with that type), it does not reproduce. Booking spends the soonest-expiring ticket first (eligibility.ts:34, `order by t.expires_at asc nulls last`), so only the ticket with no limit is left and the mail is right. The bug does show with 3 or more tickets (dated + dated + no limit, which leaves 1 dated and 1 with no limit), when the mixed wallet is of another type, or when the booking is a free, paid or guest place. Case 2 reproduces as described and is the common one: a client buys two carnets at different dates, books, and the mail says « 19 × Cours collectif, valable jusqu'au 12/01 inclus » when 10 of them last until April.

Impact:
- No security issue and no data or money loss.
- The error always runs the cautious way: it never says a ticket lasts longer than it does. The real dates still appear in the wallet views.
- But it is a wrong statement in the main client-facing mail after each booking, for any repeat buyer or anyone holding offered and paid tickets of the same type. It can make clients believe tickets will be lost, which hurts trust and sends support questions to the pro.
- The spec requires this information and a reasonable client expects it to be correct. That makes it Important, at the low end.

The plural part is the ledger's known deferred minor (progress.md:68). On its own it would only be Minor. It concerns « vous offre 3 tickets « X », valable… » in tickets-offered.ts:26 and the same singular wording in booking-confirmed.ts:35. In the « Tickets offerts » mail the date itself is right, because all offered tickets share one expiresAt (notify-core.ts:374).

The proposed fix is right in substance. Four details:
1. Group by lastValidDay(expiresAt, tz) in JS, as expirySummaryOf does. Grouping by the raw expires_at instant would split one calendar day into several lines.
2. expirySummaryOf (wallet-view.ts:144) is private and takes WalletTicketRow, so it has to be moved into a shared pure helper, fed by a per-ticket or per-(type, expires_at) query.
3. expiryLabel has many per-ticket callers where the singular is correct (wallet-view.ts:111, planning-view.ts:108, planning-actions.ts:197/674). The count should be an optional parameter or a separate helper, not a changed signature.
4. The mail line needs a format such as « 19 × Cours collectif : 9 valables jusqu'au 12/01 inclus, 10 valables jusqu'au 15/04 inclus ».

The proposed tests (a DB test with a dated plus an undated ticket of one type left after the booking, and a pure plural test) are the right ones.

## COV-2 (coverage, reviewer Important, confirmed=true)
src/server/pro.ts:219  Connecting Google Agenda never adds the séances and RDVs that are already booked

Scenario: Spec § 13.7 says a Google event exists for every scheduled séance with at least one confirmed booking, and for every RDV. The settings card (google-calendar-card.tsx:66) promises « Vos séances Skedul apparaissent dans un agenda « Skedul » dédié ». finalizeGoogleConnection only creates the calendar and stores its id, and contract § 4.3 (line 490) says « No backfill on reconnect ». Syncs only run as effects of later writes. Example: a pro with 20 booked séances over the next weeks connects Google and sees an empty « Skedul » calendar. Each séance only appears after something changes on it, so an untouched booked séance never appears. The same happens after a disconnect and reconnect (Q33 clears every marker). This is v1 behaviour that P3 kept, but P3 owns « Google indexé sur la séance » and its spec line.

Proposed fix: After a successful finalizeGoogleConnection, use after() to run a bounded and paced sync of the pro's future scheduled occurrences that have at least one confirmed booking (or every booked RDV): read their ids, then call syncOccurrence for each. These occurrences carry no marker, so the insert path with the deterministic id is safe and idempotent. Add a DB test of the id selection, with a tenancy case.

Votes:
- real=true Important: I traced the code and the problem happens as described.

1. Connecting. google-calendar-card.tsx:27-28 sees ?google=connected and calls finalizeGoogleConnection (src/server/pro.ts:219-248). That function reads professional.googleCalendarId and returns ok if it is already set. Otherwise it gets a token, calls createSkedulCalendar, saves the new calendar id and returns { ok: true }. Nothing reads the pro's occurrences, nothing calls syncOccurrence, and there is no after() hook.

2. What can trigger a sync. syncOccurrence (src/lib/calendar-sync.ts:16) has exactly one caller: the "google" effect in src/server/notify.ts:34-35. That effect is planned by notify-core.ts:405 as a side effect of a write (a booking, an edit, a cancellation). No cron job or API route does a sweep: there is no crons entry and no sync route under src/app/api.

3. Bookings made before the connection. syncOccurrenceWith (calendar-sync-core.ts:53-57) returns "skipped" when the pro has no googleCalendarId, and stores no marker. Once the pro connects, those occurrences only reach Google when a later write on that same occurrence plans a "google" effect. A booked séance or RDV that nobody touches again never appears. The card text at google-calendar-card.tsx:66 (« Vos séances Skedul apparaissent dans un agenda « Skedul » dédié. ») is therefore wrong for every booking that already exists.

4. Disconnect then reconnect is worse. clearGoogleLink (calendar-sync-load.ts:88-93) clears googleCalendarId and every occurrence marker. The old calendar is kept (pro.ts:250-252), so on reconnect finalizeGoogleConnection creates a second, empty « Skedul » calendar, while the old one keeps stale events that will never be updated.

This goes against the invariant in spec § 13.7 (« Un événement Google existe pour chaque séance scheduled avec au moins une inscription confirmée, et pour chaque RDV »), which P3 owns (« Google indexé sur la séance »). The gap is a deliberate contract choice, not an oversight: contract line 490 says « No backfill on reconnect », and the docstring at plan line 4170 / calendar-sync-load.ts:85-86 says the same. The progress ledger has no « Ruling: » line about it. I think that choice is wrong. The spec states an invariant here, it is not silent. Any pro who connects Google expects to see the bookings they already have. And the deterministic-id insert path makes a backfill safe and idempotent: no marker leads to an insert, and a 409 becomes a patch of the full body.

Grading. Important, not Critical. It is a broken promise in a secondary feature that a pro will hit on day one. It loses no data, opens no security or tenancy hole, and the booking flow itself still works. The proposed fix holds up: after the connection, use after() to run a bounded, paced sync of the pro's future scheduled occurrences that have at least one confirmed booking, plus every RDV. Scope the id selection by professional_id from the session and cover it with a DB test that includes a cross-tenant case.

Declined to judge: how the real Google API behaves with the same deterministic id in a newly created calendar. The ledger's Task 4 carry already lists this as unverified by hand.
- real=true Important: Confirmed. I looked for a guard elsewhere that would prevent this and found none.

- `finalizeGoogleConnection` (src/server/pro.ts:219-251) only fetches a token, calls `createSkedulCalendar` (line 240) and stores `googleCalendarId`. It never reads or syncs any occurrence.
- The only caller of `syncOccurrence` in src is `runEffects` in src/server/notify.ts:35, for a plan of kind `google`. Those plans come only from engine effects after a write. A grep for `syncOccurrence` / `resync` / `googleCalendarId` found no other sync path: no cron, no admin resync and no horizon job.
- When the pro is not yet connected, every earlier sync stops at `if (!o || !o.googleCalendarId) return "skipped"` in calendar-sync-core.ts. So no booked occurrence carries a marker, and none gets inserted until something changes on it. An untouched booked séance or confirmed RDV never reaches the calendar.
- Disconnect makes it worse. `clearGoogleLink` (calendar-sync-load.ts:88-93) clears `googleCalendarId` and every marker. The next `finalizeGoogleConnection` finds no id and creates a brand-new, empty « Skedul » calendar, while the old events stay in the old one.

The cited lines are right:
- Spec § 13.7 (lines 1549-1550): a Google event exists for every `scheduled` séance with at least one confirmed booking, and for every RDV.
- Spec line 120: Google gets the séances with at least one registrant, plus each RDV.
- google-calendar-card.tsx:66 promises « Vos séances Skedul apparaissent dans un agenda « Skedul » dédié ».
- Contract line 490 says « No backfill on reconnect », and calendar-sync-load.ts:85-86 repeats it.

This is v1 behaviour kept as is: `git show main:src/server/pro.ts` has the same `finalizeGoogleConnection`. But P3 owns « Google indexé sur la séance » (spec line 1698), and the spec states a standing guarantee that the connect path breaks.

The no-backfill choice is a contract decision (contract line 490 and decision 13 at line 1643), not a ledger « Ruling: » line. It is also worded only for reconnect, with no rationale for the first connection. I judge it wrong against the spec's guarantee and against what a reasonable pro expects: connect the calendar and see the séances already booked.

Why Important and not Critical: there is no security, tenancy or data-loss impact, and syncs still work for later writes. Still, a pro gets an incomplete calendar and can miss booked séances.

The proposed fix is sound:
- Use `after()` in the action, bounded and paced.
- Select the pro's future `scheduled` occurrences that have at least one confirmed booking, scoped by `professional_id`.
- Insert them by deterministic id. After Q33 they carry no marker, and a 409 becomes a full-body patch, so this is idempotent.
- `syncOccurrence` gets its token by `userId`, without request headers, so it works inside `after()`.
- Add a DB test of the id selection with a cross-tenant case.
- real=true Important: I read the code and the finding holds as described. In one case it is worse.

What the code does:
- finalizeGoogleConnection (src/server/pro.ts:219-248) gets a token, calls createSkedulCalendar (pro.ts:240), stores the calendar id and returns. It never touches occurrences.
- The only caller of syncOccurrence is the effects pipeline (src/server/notify.ts:35, scheduled by runProAction's after() in src/server/pro-context.ts:81). A sync therefore only runs after a write that emits google.sync_occurrence.
- clearGoogleLink (src/lib/calendar-sync-load.ts:85) clears every marker on disconnect. Its doc comment says outright « Nothing is backfilled when the pro connects again ».
- The contract (p3-back-office-contract.md:490) says « No backfill on reconnect » as a bare scope note. It is not a progress.md « Ruling: » line and gives no reason. Decision 13 (contract:1643) only justifies the marker logic. That note contradicts spec § 13.7 (design.md:1549): « Un événement Google existe pour chaque séance scheduled avec au moins une inscription confirmée, et pour chaque RDV ». It also contradicts the card's promise at google-calendar-card.tsx:66. I think that contract line is wrong against the spec.
- v1 on main also had no backfill, so this is not a regression. But P3 rewrote this sync and owns § 13.7.

Worse than described:
- A disconnect followed by a reconnect gets a second « Skedul » calendar. After Q33 googleCalendarId is null, so createSkedulCalendar runs again. The new calendar starts empty, and the old one keeps stale events that will never be updated or deleted.
- RDVs are the clearest case. A 1:1 RDV booked before the connection rarely changes, so it never appears.
- A full séance with no later change never appears either.
- The consent screen is in Google Testing mode (spec risk #4), so refresh tokens expire. Reconnecting is therefore likely to happen often.

Impact: there is no security, tenancy or money-integrity problem. The harm is to trust. A pro who uses Google Agenda as their day view can miss an RDV they already sold, and the client then has a no-show they paid for. The Skedul planning stays correct, which keeps this below Critical. Every pro who connects after taking bookings will hit it, which is the usual order, so Important fits.

The proposed fix is the right direction but incomplete:
1. Run it only on the branch that actually creates the calendar, not on the early `{ ok: true }` return at pro.ts:232.
2. Don't loop over syncOccurrence. It swallows every error (calendar-sync.ts:16-33), so the loop cannot stop when the token or Google fails, and it would log one error per séance. It would also call auth.api.getAccessToken once per occurrence. Instead, use syncOccurrenceWith with one shared token, and stop at the first failure.
3. Bound the run by count or window and by elapsed time. after() runs within the function's maxDuration, and Google has per-user quotas. Because nothing records how far the run got, decide and document what happens to the rest.
4. Selection: professional_id = pro, status scheduled, starts in the future (decide about séances already under way), EXISTS a confirmed booking. RDVs fall out of the same rule because wantsGoogleEvent applies to both.
5. Idempotency is fine. With the deterministic id, a 409 turns into a full-body PATCH. A Q33 that clears markers in the middle of a run heals itself, because a marker pointing at the old calendar gets "missing" from PATCH and falls back to insert.
6. The DB test should cover tenancy and exclusions: another pro's séance, a cancelled séance, a past séance, a séance with only pending bookings, and an RDV.
7. The duplicate calendar on reconnect is out of the fix's scope. Either reuse the old calendar or tell the pro the old one is left in place.


# Minors

- SEC-2 (security) src/server/pro-context.ts:42 Pro reads and writes trust the 5-minute session cookie cache and never check suspension | fix: In requireProContext (at least for runProAction, the writes), use getFreshSession() (session.ts) and refuse a suspended user with the same redirect. This costs one session read per action. For pages, use the fresh read on the ones that show client data (clients, client record, planning, payments, dashboard), or accept and document the 5-minute window.
- SEC-3 (security) src/lib/email.ts:34 Mock-mode mail log prints the recipient address and the raw subject even in a production build | fix: When NODE_ENV is production, log only `[email:mock] ${redactSubject(subject)}`, with no `to`. Better: refuse mock e-mail when APP_ENV is production, by failing at startup like a missing DATABASE_URL.
- SEC-4 (security) src/lib/calendar-sync-load.ts:84 Google attendee read and ICS read do not scope every join to the booking's pro | fix: Add `eq(customer.professionalId, row.professionalId)` to the attendee join, and `eq(occurrence.professionalId, booking.professionalId)` to the ICS join. Add a one-line DB test each, like the readBookings tenant test.
- SEC-5 (security) src/components/dashboard/client-header.tsx:204 « Compte client lié » lets a pro learn which typed addresses are Skedul users | fix: Show « lié » only when the link came from that client's own action at this pro (a booking or purchase made while signed in), or link automatically only the rows the user has interacted with. Otherwise drop the badge for records a pro created that have no activity. Owner decision, because the spec wording would change.
- SEC-6 (security) src/server/pro-context.ts:48 Writes made while an admin impersonates a pro leave no trace of the admin (contract Decision 10) | fix: Carry `impersonatedBy` in ProCtx. Log one line per successful action while impersonating (`[pro] <name> by admin <id> for pro <proId>`, with ids only), or store it with the action id. Decision 10 itself can stay.
- SEC-7 (security) src/app/api/c/[token]/route.ts:39 The guest cookie's security attributes are pinned by no test | fix: Move the options into a pure `guestCookieOptions(slug, production)` in guest-access.ts, use it in the route, and add a pure test of each attribute, path included.
- F3 (engine) src/lib/back-office/settings-actions.ts:41 The time-zone lock ignores future time offs and pro-chosen ticket expiries, which are stored as instants in the old zone | fix: Add `or exists (select 1 from time_off where professional_id = $p and end_at > $now)` to timezoneLockedSql, and warn about or lock on available tickets with an expiry. Alternatively, recompute all-day time offs from their local days when the zone changes, in the same batch.
- F4 (engine) src/lib/back-office/settings-actions.ts:104 Lowering the global horizon is not checked against the notice overrides of types and events (Decision 28 intent) | fix: In updateBookingSettingsCore, read the non-archived RDV types and the live events that carry a notice or horizon override, compute effectiveWindow(newSettings, overrides) for each, and refuse with NOTICE_TOO_LONG naming the first type or event that would close.
- F5 (engine) src/lib/notify-core.ts:279 A rendez-vous cancelled by the pro is announced to the client as « Séance annulée » | fix: Read occurrence.event_id in readBookings (isRdv), pass it to occurrenceCancelledEmail, and word that case « Rendez-vous annulé : … » / « … a annulé votre rendez-vous … ».
- F6 (engine) src/components/dashboard/offer-list.tsx:89 Deleting an offer that was only checked out (never paid) reports « elle avait déjà été achetée » | fix: Expose a count of every purchase (or a hasPurchases flag) for the delete copy and notice, or word the archived notice « un paiement a déjà été commencé avec cette offre ».
- F7 (engine) src/lib/back-office/event-actions.ts:190 createEventCore and editEventInfoCore keep ticket type links on a free or none event; the Task 19 ruling #2 fix lives only in the browser | fix: `const typeIds = draft.bookingMode === "tickets" ? [...new Set(draft.ticketTypeIds)] : []` in both cores (info.bookingMode for the edit), with a DB assertion.
- F8 (engine) src/lib/back-office/event-actions.ts:307 The schedule cut has no start-date ceiling, unlike creation (Decision 15's typo guard) | fix: Refuse rule.startDate > addDays(todayKey(now, ctx.timezone), 730) with EVENT_START_TOO_FAR in both previewScheduleCore and applyScheduleCore.
- F9 (engine) src/lib/back-office/catalog-actions.ts:208 The rdv_free rules are checked by reads outside the engine batch (the ledger left this to the final review) | fix: Add `G(not (select rdv_free from ticket_type where id = $t), 'stale')` to the engine statements that create offers en vente, offer or convert tickets and convert on move. For the switch, add the hasSalesOrTickets predicate (as narrowed in F2) as a G in updateTicketType when rdv_free goes from false to true.
- F10 (engine) src/lib/back-office/settings-actions.ts:112 Adjacent or overlapping hour ranges are saved as they are, but an RDV must fit inside a single range | fix: Merge each day's overlapping and touching ranges in the core before the engine call (or refuse overlaps with a French message that names the day and the range), and apply the same merge in firstRangeProblem.
- F11 (engine) src/components/dashboard/occurrence-dialog.tsx:556 The unenroll « Motif (facultatif) » is mailed to the client without the dialog saying so | fix: Label the field « Motif envoyé au client (facultatif) » or add a help line saying it appears in the e-mail.
- R4 (reads) src/lib/back-office/planning-reads.ts:415 « Inscrire » customer search sorts by the database collation before the limit of 8, so accented names drop out | fix: Fetch a wider set (for example 50), sort it with the fr Intl.Collator (sensitivity base, id tie-break), then slice to `limit`. Add a DB test with an accented initial.
- R5 (reads) src/lib/back-office/planning-view.ts:291 Short day labels still write « 1 » for the first of the month | fix: In dayShortLabel, build the label from the weekday plus dayOrdinal(d). In admin-metrics dayLabel, wrap the output in frenchFirst, which already handles « oct. ». Add pure tests.
- R6 (reads) src/lib/back-office/history.ts:90 Several labels drop the year: history lines, history séances, the payments row's séance and the next séance (ledger deferred this to the final review) | fix: Add a year-aware variant to format.ts (the dayLabel rule of wallet-view: « 12/10 » this year, « 12/10/2025 » otherwise). Use it in formatDayMonthTime and formatDayMonthOf for the history, and in the payments séance line. Add tests across a year boundary.
- R7 (reads) src/lib/back-office/planning-reads.ts:371 The week range read is bounded on starts_at from above only, so every planning and dashboard load reads the pro's whole occurrence history | fix: Add `gt(occurrence.startsAt, start - 12 h)`. A séance lasts at most 720 min (event_duration_chk) and an RDV at most 480 min, and starts_at/ends_at do not include the buffers. Do the same for time_off with its longest allowed range, or keep it as it is since that table is small.
- R8 (reads) src/lib/back-office/catalog-reads.ts:105 The « sold » count is a correlated subquery on ticket_purchase.offer_id, a column with no index | fix: Use one grouped read `select offer_id, count(*) … where professional_id = p and status = 'paid' group by offer_id` merged in JS, or add an index on (offer_id) where status = 'paid'.
- R9 (reads) src/lib/back-office/dashboard-view.ts:51 The « Séances à venir (7 j) » KPI also counts RDVs | fix: Name the tile « Séances et rendez-vous (7 j) », or count the two apart (« dont N rendez-vous »).
- R10 (reads) src/server/planning-queries.ts:34 Weeks past the 400-day materialisation show endless series as empty, with no notice | fix: When the shown week starts after min(generated_until), show a line such as « Les séances récurrentes sont affichées jusqu'au JJ/MM/AAAA. ». Or cap the « semaine suivante » navigation at the horizon.
- R11 (reads) src/lib/admin-reads.ts:319 Admin reads seq-scan and sort the whole booking table on every overview, activity and user page load | fix: Add `o.professional_id = p` to proStats.upcoming. Count confirmed bookings through the pro's customers (booking_customer_idx) or add a booking(professional_id) index. Add an index on booking(created_at) for the feed and the 30-day count.
- R12 (reads) src/lib/back-office/planning-reads.ts:386 getPlanningItem is exported and tested but nothing calls it | fix: Remove it and its tests, or wire it into the ?seance= deep link that it was meant for.
- UI-2 (ui) src/components/dashboard/register-attendee-dialog.tsx:401 Links in text-primary use the pro's raw brand colour: below AA for light presets, and the inline link relies on colour alone | fix: Reuse the LINK_CLASS of wallet-actions.tsx (text-accent-foreground, which brandTheme darkens to at least 4.5:1, plus underline underline-offset-4) for both links.
- UI-3 (ui) src/components/dashboard/profile-form.tsx:96 « Enregistré » in text-success (3.3:1), in a status region mounted only when it shows | fix: Use text-green-700, and keep the role=status span mounted and empty until saved (as booking-settings-form.tsx:212 does).
- UI-4 (ui) src/components/dashboard/ticket-type-editor.tsx:61 Catalog forms let a failed Server Action call escape the transition: the page is replaced by dashboard/error.tsx and typed values are lost | fix: Wrap each call in try/catch and show REQUEST_FAILED in the form's error box, as event-editor.tsx and wallet-actions.tsx do.
- UI-5 (ui) src/components/dashboard/offer-list.tsx:308 Offer and RDV-settings forms keep a field error after the field is fixed and do not move focus after a refusal | fix: Clear the error of the edited field in `set` (withoutErrorsUnder, as in the event forms), and focus the first [aria-invalid] element or the FormError box after a refusal.
- UI-6 (ui) src/components/dashboard/ticket-type-editor.tsx:110 Success lines inserted together with their own live region (« Enregistré », notices) are not reliably announced | fix: Render the role=status element at all times and change only its content (pattern of booking-settings-form.tsx:212 / availability-editor.tsx).
- UI-7 (ui) src/lib/back-office/confirm-copy.ts:23 Cancel-séance / cancel-RDV confirmation promises returned tickets that do not exist | fix: Pass the number of ticket-covered confirmed attendees (as unenrollCopy does) and drop the ticket clause when it is 0.
- UI-8 (ui) src/lib/back-office/confirm-copy.ts:61 Singular and plural disagree in confirmations for one item | fix: Make the bodies and titles follow the count (« Le ticket reste visible, barré… », « Il reste visible, barré… », « Une séance a des inscrits », « …sans que le client soit prévenu »), and add count = 1 assertions.
- UI-9 (ui) src/components/dashboard/recurrence-editor.tsx:286 Interval field reads « Tous les 2 semaines » and « Tous les 1 jours » | fix: Choose « Toutes les » for weekly, and take the unit from pluralWord(value.interval, …), with « mois » invariable.
- UI-10 (ui) src/app/dashboard/events/[id]/page.tsx:161 « 3 / 12 places » is ambiguous, and « 1 / 1 places » is plural | fix: Use the planning wording: `${plural(taken, "inscrit", "inscrits")} sur ${capacity}`.
- UI-11 (ui) src/components/dashboard/week-preview.tsx:118 Dashboard week-preview blocks have no day or seat count in their accessible name | fix: Set aria-label={blockLabel(i, tz)} on the preview buttons (tz is already a prop).
- UI-12 (ui) src/components/dashboard/planning-calendar.tsx:418 Mobile day chips count RDVs as « séances » | fix: Use a neutral noun (« 2 éléments ») or count séances and RDV separately (« 1 séance, 1 rendez-vous »).
- UI-13 (ui) src/app/dashboard/clients/page.tsx:64 Client search is a GET form: names and e-mails typed by the pro go into URLs, history and request logs | fix: Search through a Server Action, as register-attendee-dialog does, or keep q out of the URL (client state). At least document the trade-off with the owner.
- UI-14 (ui) src/components/public/customer-space.tsx:69 Espace: the empty-wallet CTA does not lead to the Boutique, and an RDV is called « séance » | fix: Link to the Boutique anchor of /[slug] with a « Voir la boutique » label (P5 can supply the anchor), and word the hint « jusqu'au début du rendez-vous » for RDV bookings, or use a neutral « jusqu'au début ».
- UI-15 (ui) src/app/dashboard/unavailability/page.tsx:46 « Indisponibilités » shows the raw IANA zone while its sibling page was fixed | fix: Use `(fuseau : ${timeZoneLabel(tz)})` as the availability page does.
- COV-3 (coverage) src/lib/booking/series.ts:431 The Google event shows the old capacity after « Toutes les séances à venir » or an event capacity edit | fix: In editEventInPlace, also push syncEffects for the future booked occurrences when p.capacity !== undefined. Optionally sync the client's booked future occurrences when the name changes. Add a DB test asserting the google.sync_occurrence effects of a capacity-only patch.
- COV-4 (coverage) src/lib/back-office/confirm-copy.ts:15 The cancellation confirmations say tickets are given back when the bookings hold none | fix: Pass the number of ticket-covered active bookings (from item.attendees, as unenrollCopy does) to cancelOccurrenceCopy and to the time-off conflict VM, and drop the ticket clause when it is 0. Extend confirm-copy.test.ts.
- COV-5 (coverage) src/lib/emails/occurrence-cancelled.ts:24 A cancelled RDV is announced to the client as a « Séance annulée » | fix: Read occurrence.event_id IS NULL in planOccurrenceCancelled and pass a kind to the template (« Rendez-vous annulé », « a annulé votre rendez-vous « X » du … »). Write « inscrit(e) » in occurrence-changed.ts. Extend client-emails.test.ts.
- COV-6 (coverage) src/lib/back-office/settings-actions.ts:95 Changing the global booking settings can silently close online booking on events and RDV types that have overrides | fix: In updateBookingSettingsCore, read the non-archived events and RDV-enabled types that have notice or horizon overrides, compute effectiveWindow(newSettings, overrides), and refuse with a French message naming the first one, or return a warning list the form shows. Add a DB test.
- COV-7 (coverage) src/lib/back-office/planning-reads.ts:386 P3 left dead code: getPlanningItem, VALIDITY_UNIT_LABELS, DAYS_FR and three planning.ts helpers | fix: Delete the four test-only exports and their test lines, or wire getPlanningItem if a deep link outside the fetched week is wanted. Update the queries.ts header comment.
- COV-8 (coverage) src/components/dashboard/branding-form.tsx:287 The branding preview in Réglages still shows the v1 « Pack 5 séances » button | fix: Replace it with tickets wording (for example « Carnet de 5 » or « Acheter des tickets »), or explicitly put it on the P6 copy list.
- COV-9 (coverage) src/app/globals.css:26 The --color-destructive contrast carry assigned to Task 43 or the final review was not done | fix: Darken the token once (for example rose-700 #be123c, white on the button stays about 6.3:1) as the ledger suggested, then re-check the destructive buttons.
- COV-10 (coverage) src/lib/emails/attendee-moved.ts:35 « Inscription déplacée » and « Séance modifiée » give no new calendar link | fix: Reuse mailButton with googleCalendarUrl, outlookCalendarUrl and the booking ICS URL in attendee-moved (one booking) and occurrence-changed (per booking), as planBookingConfirmed already does.

# Declined

- security: Login CSRF through GET /api/c (a cross-site navigation can plant the attacker's guest cookie): already carried to P4 by the Task 41 ruling; in P3 the espace is read-only, so the effect is only showing someone the attacker's own space.
- security: updateBranding stores bannerUrl / avatarUrl without validating them (any external image host): code from before P3, not touched by P3 commits.
- security: Linking a Google account through the Google Calendar card while an admin impersonates a pro: the card predates P3 and google-calendar-card.tsx is not in P3's own files.
- security: Sign-up « Un compte existe déjà avec cet email »: account existence was already revealed by Better Auth's USER_ALREADY_EXISTS; Ruling 38 only translates it, and the endpoint is limited to 3 per 10 min per IP.
- security: Client search terms (?q= name or e-mail) in /dashboard/clients URLs: v1 behaviour already live and mandated by the contract (GET search form).
- security: The guest token in Vercel request logs for /api/c/<token>, and the booking id as the ICS capability: deliberate spec decisions (§ 12, Q34), unchanged by P3.
- security: P2 engine internals (wallet.ts, cancel.ts, series.ts, claims.ts, catalog.ts) beyond the P3 diffs: I relied on their professional_id scoping after spot checks (moveAttendee, cancelBookingsByPro, updateOccurrence unenroll, registerPro, setTypeQuestions); I did not review them line by line.
- security: DB suites not run (instructed); only pure tests run: log-safe, guest-access, guest-link, 19/19.
- engine: Guest links, /api/c/[token], /[slug]/espace and ICS capability security: another dimension.
- engine: Admin account deletion (admin-deletion.ts, Stripe expiry deadline, Blob cleanup): reviewed on opus in Task 40, outside engine-integration writes.
- engine: Google Calendar sync API semantics (marker vs deterministic id, a sync still running while the pro disconnects): only the effect wiring was checked.
- engine: P2 engine internals that P3 did not change (CON1/CON2 lapsed holds in series counts and capacity floors, SKIP LOCKED picking, nightly sweeps), already deferred in the P2 outcome.
- engine: after() duration and per-instance Resend pacing for very large séances (ledger deferred).
- engine: updateBranding / updateSlug in pro.ts (unvalidated image URLs, no core/wrapper pattern): pre-existing code, security and UI dimension.
- engine: Accessibility and French copy of the dialogs, beyond the e-mail and notice texts tied to engine outcomes.
- engine: Time-off dialog counting a séance held only by a lapsed hold as « 1 inscrit »: deliberate preview/apply agreement (time-off-actions.db.test.ts:331), part of P2 CON1.
- reads: The clients search is a GET form, so ?q=<client name or e-mail> lands in the URL, Vercel request logs and browser history. The contract mandates it; it belongs to the security dimension, not to read-side correctness.
- reads: Decision 36 (spec § 12): a verified session with no record at this pro shows « Aucun ticket chez … » even when the browser holds a valid personal-link cookie for another address. The spec says this explicitly; this is a product call.
- reads: I could not check whether Postgres picks a BitmapOr on ticket_expires_idx or a sequential scan for R3, because EXPLAIN needs DB access, which this review excludes. The scan is platform-wide either way.
- reads: The lapsed-hold boundary differs between modules (< in elapsedHolds and payments, <= in planning-view and client-reads, > for live seats). The ledger deferred it; at one millisecond it is not worth re-grading.
- reads: Accent-insensitive search (unaccent) and search hits that include abandoned-checkout customers were deferred in the ledger; I agree with the grading.
- reads: The ICS route still serves the file of a confirmed booking at a suspended pro. That is a product or security call, not read correctness.
- reads: Joins on event and ticket_type in the planning, dashboard and payments reads carry no professional_id predicate. The ids are engine-written and there is no composite FK, so this is defense in depth only; I found no reachable cross-tenant path.
- reads: Clients list performance at 5 000 customers: loadSnapshots returns every customer row over Neon HTTP on each load or search, about 1 MB. This is acceptable now and was ruled on in Task 31, so I did not re-grade it.
- ui: Contrast of pre-existing admin lines that P3 did not touch: user-actions.tsx:194/199 and admin/users/page.tsx:64 (text-success on success-muted, about 3:1; text-destructive on destructive/10, about 4:1). This is production code outside the P3 diff.
- ui: Sign-up error « Un compte existe déjà avec cet email » (auth-messages.ts, Task 38 ruling) is an account-existence signal. Whether that is acceptable is for the security dimension.
- ui: Width of a WeeklyHoursEditor row (two time inputs and two icon buttons) at 375 px in AvailabilityEditor, which has no overflow-x wrapper. Native time-input widths vary by browser and this cannot be verified without a browser.
- ui: Em dashes in src/app/demo/page.tsx, components/demo/demo-script.ts and the layout.tsx site title: PR #14 / P6 scope, already listed in the ledger.
- ui: « Annulation en ligne possible jusqu'au … » in the read-only espace has no cancel control in P3 (P4 adds it). Not judged as a P3 defect.
- ui: Whether the whole-panel aria-live of RecurrencePreview, which re-reads the label and five dates after each recurrence edit, is too chatty needs screen-reader testing.
- ui: Escape pressed in the type=search field of the « Inscrire » dialog clears the field and also closes the dialog. This depends on the browser and was not verified.
- ui: Ruling Task 33 (« Nouveau client » with an existing e-mail silently renames that record, with a help text before and a notice after): weighed and accepted. It is spec E8 behaviour and is now visible.
- coverage: Security of log lines (raw err passed to console.error in the dashboard and planning ensureHorizon after() blocks, and in pro.ts:247/266 Google finalize and unlink): left to the security dimension.
- coverage: rdv_free pre-checks done as reads outside the engine batch (ledger Task 32, deferred to final review): left to the engine and security dimensions.
- coverage: Lapsed-hold boundary < vs <= across client-reads, planning-view and payments-reads (Task 36 deferred): left to the reads dimension.
- coverage: History lines without a year after 12 months (Task 34 deferred): spec Q27 gives JJ/MM; I keep it Minor, no regrade.
- coverage: « Revenir aux disponibilités générales » deleting a type's own hours with no ConfirmDialog (Task 13 deferred): an owner product call, not graded.
- coverage: The 409 → exists and 404/410 → missing status mapping in src/lib/google-calendar.ts has no automated test (server-only wrapper; the core is tested through fakes): accepted as a thin wrapper.
- coverage: Focus, keyboard and mobile-layout behaviour of the dialogs: not judged, code read only, no browser run.
- coverage: The espace hint « Annulation en ligne possible jusqu'au… » shown with no cancel button until P4: acceptable while nothing ships before P6.
- coverage: P4/P5/P6 scope (public pages, /mon-espace, cancel and spend, webhooks, the code form on /[slug]/espace, « Utiliser une autre adresse », the dashboard/layout redirect to /mon-espace, AGENTS.md isClient wording).
- coverage: Owner-pending browser clicks (Task 20 whole delete, Task 34 « Déconnecter ses liens »): not something code review can settle.
