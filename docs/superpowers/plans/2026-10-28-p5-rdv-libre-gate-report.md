# P5 Group D, step D1: the final gate (T14 checks)

Verifier only: no source file changed, no commit. HEAD `cb1727e` (branch `feat/tickets-events`, worktree `tickets`) for every
check. Logs are in this folder (`d1-*.log`, git-ignored). The run was split by a session restart: tsc, eslint, the pure suite
and DB chunks 1 to 5 ran on 2026-10-28; chunk 6 was cut at 17:52 when the controller process exited (29 tests passed, 0
failed, log kept as `d1-db-chunk6-cut.log`); chunk 6 was rerun from scratch and chunks 7 to 14, the build, the greps and the
browser tour ran on 2026-10-29. HEAD did not move in between.

Tool note: the Bash tool failed on every command (« unexpected EOF … line 106 »), so everything ran through PowerShell. The
`tsx.cmd` shim breaks on the `!(` glob under cmd.exe, so the pure suite ran as `node .\node_modules\tsx\dist\cli.mjs`, which is
the same binary `./node_modules/.bin/tsx` starts.

## Verdict

GREEN for everything P5 changed. Two greps also hit inherited lines that P5 did not change (listed under check 6 and in
Notes). They are not counted as P5 failures, and the controller can overrule that.

## 1. tsc

- Command: `.\node_modules\.bin\tsc.cmd --noEmit` (log `d1-tsc.log`, empty).
- Exit 0, 20 s. Rerun after the dev server stopped (`d1-tsc-final.log`): exit 0, 12 s. Nothing under `.next/dev/types` needed
  to be deleted.
- PASS.

## 2. eslint

- Files: `git diff --name-only --diff-filter=d 052ab79..HEAD`. 118 files changed, 0 deleted. 113 of them are .ts/.tsx; the
  other 5 are the P4 doc files. List in `d1-eslint-files.txt`.
- Command: `.\node_modules\.bin\eslint.cmd --max-warnings=0 <113 files>`, exit 0. A JSON rerun (`d1-eslint.json`) shows 113
  files linted, 0 errors, 0 warnings, 0 « ignored file » messages.
- Inherited demo/hero/landing files in the list: none (none of them changed since 052ab79).
- PASS.

## 3. Pure suite under two host zones

| Zone | Command | Zone proof (first lines of the log) | Result |
|---|---|---|---|
| Europe/Paris | `$env:TZ = "Europe/Paris"; node .\node_modules\tsx\dist\cli.mjs --test "src/**/!(*.db).test.ts"` | `TZ=Europe/Paris`, `node zone: Europe/Paris offset(min) 2026-07-01: -120` | 1594 tests, 1594 pass, 0 fail, 0 skipped, 28 s (`d1-pure-paris.log`) |
| America/Los_Angeles | same with `$env:TZ = "America/Los_Angeles"` | `TZ=America/Los_Angeles`, `node zone: America/Los_Angeles offset(min) 2026-07-01: 420` | 1594 tests, 1594 pass, 0 fail, 0 skipped, 28 s (`d1-pure-la.log`) |

PASS.

## 4. Full DB suite on tickets-test

- Command per chunk (script `d1-run-chunk.ps1`, one process per chunk, in the foreground):
  `.\node_modules\.bin\tsx.cmd --env-file-if-exists=.env.test --test --test-concurrency=1 --test-isolation=none --test-timeout=300000 <files>`.
- Partition (`d1-chunks.txt`): all 63 tracked `*.db.test.ts` files, each exactly once (checked by script), at most 6 per chunk.
  No untracked DB test file exists.

| Chunk | Files | Tests | Fail | Time |
|---|---|---|---|---|
| 1 | public/booking-actions, booking/delete-user, booking/content, test/harness | 66 | 0 | 306 s |
| 2 | back-office/event-actions, back-office/planning-actions | 70 | 0 | 391 s |
| 3 | notify-core, public/seance-reads, payments/webhook-core | 70 | 0 | 393 s |
| 4 | booking/series-split, auth, back-office/client-actions | 67 | 0 | 407 s |
| 5 | public/rdv-actions, booking/rdv, slots, public/rdv-reads | 54 | 0 | 283 s |
| 6 | back-office/planning-reads, db/atomic, booking/wallet, booking/claims-buy (rerun; the cut run had 29 pass, 0 fail) | 71 | 0 | 375 s |
| 7 | back-office/event-reads, back-office/guest-access, public/release-actions, admin-reads | 63 | 0 | 314 s |
| 8 | back-office/catalog-actions, back-office/time-off-actions, public/shop-actions, back-office/client-reads, booking/cancel | 73 | 0 | 363 s |
| 9 | booking/series-occurrence, booking/claims, public/planning-reads, back-office/catalog-reads, booking/catalog, booking/fulfillment | 76 | 0 | 336 s |
| 10 | throttle, back-office/customer-space, back-office/dashboard-reads, booking/occurrences, payments/mock-checkout, public/purchase-reads | 67 | 0 | 264 s |
| 11 | booking/nightly, booking/wallet-customers, back-office/booking-settings, back-office/payments-reads, booking/invariants, calendar-sync-load | 56 | 0 | 202 s |
| 12 | public/identity, back-office/ics, back-office/settings-actions, booking/time-off, public/boutique-reads, public/my-space | 49 | 0 | 176 s |
| 13 | public/space-actions, mail-budget, public/spendable, booking/eligibility, booking/release, public/offer-reads | 40 | 0 | 188 s |
| 14 | admin-deletion, public/client-actions, public/profile-reads, calendar-backfill | 16 | 0 | 67 s |
| **Total** | **63 files** | **838** | **0** | every chunk under 600 s, none killed |

Leftover counts on tickets-test (read-only SQL through MCP, branch `br-polished-rain-aftw8y9x`):

| When | `professional.slug like 't-%'` | `"user".email like 't-%@skedul.test'` | `"user".email like 'pro-%@skedul.test'` |
|---|---|---|---|
| Before chunk 1 (2026-10-28) | 0 | 0 | not counted then |
| Before the rerun of chunk 6 (2026-10-29) | 1 | 0 | 2 |
| After chunk 14 | 1 | 0 | 2 |

The one `t-%` pro belongs to user `-b9me3yJFQ9lgU-xfI6oL` (created 2026-10-28T16:52:20Z). Chunk 6 left it when it was cut
mid-test; it was not deleted (no destructive SQL outside the harness). The other `pro-%` user, `AcZEjdnVLwVtLkKrXg6Xa`
(2026-10-13, no pro row), is older. The nine remaining chunks left nothing behind, and no test failed because of the leftover
pro (admin-reads and the invariant checks passed). PASS.

## 5. next build

- Command: `.\node_modules\.bin\next.cmd build *> d1-build.log` with the dev server stopped. Exit 0, 91 s: « Compiled
  successfully in 28.6s », TypeScript 43 s, 39 static pages generated.
- The only warning is the known one about the inferred workspace root (two lockfiles).
- Route list: 58 entries. `ƒ /[slug]/rdv/[ticketTypeId]` is dynamic. Group C counted 59; the build log lists 58.
- The 4 static routes: `○ /_not-found`, `○ /apple-icon.png`, `○ /forgot-password`, `○ /icon.png`.
- The 54 dynamic routes: `/`, `/[slug]`, `/[slug]/book/[eventTypeId]`, `/[slug]/espace`, `/[slug]/merci`,
  `/[slug]/offre/[offerId]`, `/[slug]/pack/[packId]`, `/[slug]/rdv/[ticketTypeId]`, `/[slug]/seance/[occurrenceId]`,
  `/admin` and its 9 sub-routes, `/aide` and its 3 sub-routes, the 9 `/api/*` routes, `/dashboard` and its 14 sub-routes,
  `/demo`, `/link-google`, `/mon-espace`, `/onboarding`, `/reset-password`, `/sign-in`, `/sign-up`.
- PASS.

## 6. T14 greps over src/

### 6a. `computeSlots(` with a sessions argument: 0

There are 4 hits, none with a sessions argument:

- `src/lib/availability.ts:92`: the definition. Its arguments are rules, busy, durationMin, the two buffers, tz, fromKey,
  toKey, window and now.
- `src/lib/slots.ts:148`: the one call, in `loadRdvWeek`. Busy comes from `loadRdvBusy`.
- `src/lib/availability.test.ts:38` and `:378`: tests.

A wider grep for `sessions\s*[:,]` finds only admin and auth code. PASS.

### 6b. `new Date(` in the 107 « use client » files (and `getTimezoneOffset`)

| Hit | Verdict |
|---|---|
| `src/components/dashboard/occurrence-dialog.tsx:403` `formatWhen(new Date(item.startsAt), new Date(item.endsAt), tz)` | Fine: displays server-given ISO strings in the pro tz |
| `src/components/dashboard/occurrence-edit-form.tsx:113` `todayKey(new Date(nowIso), tz)` | Fine: the server's now, turned into a DateKey in the pro tz (unchanged since 052ab79) |
| `src/components/dashboard/planning-calendar.tsx:293-294` `dayKeyInTz(new Date(nowMs), tz)`, `wallClockMinutes(new Date(nowMs), tz)` (with `setNowMs(Date.now())` at :290) | Fine: the « Maintenant » line. It starts from the server instant, then moves each minute; display only, tz explicit, no slot or week built (unchanged) |
| `src/components/dashboard/recurrence-editor.tsx:546` `new Date(nowIso)` | Fine: the server's now (unchanged) |
| `src/components/dashboard/unavailability-manager.tsx:316` `new Date(\`${viewMonth.slice(0, 7)}-01T12:00:00Z\`)` | Fine: a month label from a key (unchanged) |
| `src/components/public/day-calendar.tsx:24` `new Date()` | Fine: the first month shown when there is no available key. DayCalendar is the landing and demo widget; P5 does not use it (O15) and did not change it |
| `src/components/hero-cards.tsx:165`, `:239` `addDays(new Date(), d)` | Fine: decorative dates in the old landing hero, which nothing imports any more (already allowlisted) |

- `src/components/public/rdv-booking.tsx`: 0 `new Date(`, 0 `Date.now`, 0 `getTimezoneOffset`. It posts `slot.iso` verbatim. The
  `rdv-view` helpers it imports only compare server ISO strings with `Date.parse`.
- `getTimezoneOffset` in client components: 0.
- PASS.

### 6c. `router.refresh()` after an action

- In the files P5 changed: 0 hits. `rdv-booking.tsx` mentions refresh only in two comments.
- 15 hits in inherited files, all unchanged since 052ab79:

| Hit | Verdict |
|---|---|
| `admin/admin-sidebar.tsx:106` (forgetEntryChoice), `admin/support-admin-panel.tsx:63`, `admin/support-faq-editor.tsx:52`, `admin/dev-board-card.tsx:44`, `admin/user-actions.tsx:60`, `support/message-composer.tsx:73`, `dashboard/slug-editor.tsx:58`, `dashboard/branding-form.tsx:206`, `dashboard/google-calendar-card.tsx:54` | After a server action. Inherited code (admin, help center, settings, Google card) that predates the tickets redesign's rule. Literal miss, not P5 |
| `sign-out-button.tsx:31`, `auth/auth-form.tsx:86`, `auth/demo-quick-login.tsx:63`, `auth/email-code-form.tsx:157` (P4-pinned by `code-sign-in-guards.test.ts`), `dashboard/verify-email-banner.tsx:143` | Not after a server action: these follow Better Auth client calls |
| `public/merci-refresher.tsx:27` | Not after an action: a polling timer (P4-pinned by `merci-refresher.test.ts`) |

PASS for P5. The inherited « after a server action » hits are a literal miss.

### 6d. U+2014 and U+2013 in src/

- Scan: all 738 files under src/ (the .ts/.tsx files plus 6 others: 2 CSS modules, globals.css and 3 images), read as UTF-8.
- 30 lines hold a dash. 27 of them are inside the guard's allowlist: `src/components/demo` 16, `hero-cards.tsx` 6,
  `ticket-cta.tsx` 3, `src/app/demo` 2.
- In .ts/.tsx outside the allowlist: 0 U+2014 and 0 U+2013. That is exactly the guard's scope, and `ui-copy.test.ts` passed in
  both pure runs.
- 3 lines outside the guard's file types, all inherited CSS comments unchanged since 052ab79:
  - `src/app/globals.css:201` (U+2014, last commit d39c8d1);
  - `src/components/landing/landing.module.css:11` and `:13` (U+2013, last commit 64da325).
- PASS for P5; the 3 CSS lines are a literal miss.

## 7. Browser tour (dev server `skedul-tickets`, :3102, mock mode, tickets-dev)

Harness conditions:

- The pane was hidden throughout, so the streamed reveal was nudged by hand (`$RV($RB)`).
- Some coordinate clicks and some screenshots timed out (« the page did not draw »). Those clicks were done as JS clicks, or by
  following the link's own href, which is the same navigation.
- `document.hasFocus()` was false, so focus moves could not be judged in this run.
- Nobody else clicked in the pane.
- The tab started anonymous and was left anonymous: every sign-in of mine was signed out.
- Console: 0 errors over the whole tour. Two framework warnings appeared once each: an unused CSS preload, and
  `scroll-behavior: smooth` on `<html>`. « [Fast Refresh] rebuilding » appeared several times; no tracked file changed
  (`git status` stayed clean).
- `preview_logs` at level error: « No server errors found », checked mid-tour and at the end.

| Route | 1280 px | 375 px |
|---|---|---|
| `/altinha-paris` (anonymous) | Order Planning, « Prendre rendez-vous », Boutique. Two cards side by side (356 px each, 226 px high, buttons aligned at y 1401): « Cours particulier · 1 heure · À partir de 50 € » and « Appel découverte · 15 minutes · Gratuit » with the « Réserver un rendez-vous » link (aria-label names the type, href `/altinha-paris/rdv/<id>`). No robots meta. No element wider than the viewport. | One column (335 px each at x 20), scrollWidth 375, no element wider. Screenshot checked. |
| `/altinha-paris/rdv/EvtfIcW2lCiYuM7GZEbHh` (Cours particulier, anonymous) | Title « Cours particulier · Altinha Paris · Skedul », referrer no-referrer, no robots. Tz line « Heures de Paris (France) ». « Semaine précédente » is a disabled button; « Semaine suivante » links to `?semaine=2026-11-02`. Day chips with aria-pressed and full names (« vendredi 30 octobre, 5 créneaux »); the days with no slot (« lundi 26 octobre, aucun créneau » etc.) are disabled. Time chips have aria-labels with full date and time (« samedi 31 octobre 2026, 17:30 à 18:30 »). Picking Saturday moves aria-pressed and the computed styles. Fri 30: 10:00, 11:00, 12:00, 17:30, 18:30. 19:30 is absent because of the 20:00 « Équipe compétition » séance (SQL-checked), and the released 10:00 RDV is back. Buy mode: « J'ai déjà des tickets » prompt, « Acheter et réserver », TestPaymentsBanner, the two covering offers (À l'unité 50 €, Carnet de 5 225 €), identity fields, the required question, « Payer 50 € ». The honeypot sits off-screen (-9999 px). | List below 640 px: 0 day chips shown, one list per day (« Vendredi 30 octobre », « Samedi 31 octobre »), 11 time chips, scrollWidth 375. The buy panel at 375 was checked by screenshot. |
| Free mode `/altinha-paris/rdv/rVw7xcTF18I7jTs6tTbFn` (Appel découverte, signed in as test-p5-d-1) | Slot « jeudi 29 octobre 2026, 13:45 à 14:00 ». Free form: identity fields with the account e-mail (« Adresse de votre compte. »), « Réserver », no ticket prompt. | Two day lists (Thu 29, Fri 30), 9 chips, scrollWidth 375. |
| Held mode, the same Cours particulier page (Beatriz, one-click login) | « Réserver avec mon dernier ticket » with the required question; no buy form, no prompt. The Sat 17:30 slot, booked by test-p5-d-1 just before, is absent. | Same panel, scrollWidth 375, no element wider. |
| Mock buy end to end (anonymous, test-p5-d-1@skedul.test, Sat 31 Oct 17:30) | The action took 3.9 s (server log), then `/api/mock-checkout` (« Paiement simulé », Cours particulier · À l'unité, 50 €). « Annuler et revenir » goes to `/altinha-paris/rdv/EvtfIcW2lCiYuM7GZEbHh?paiement=annule&p=<purchase>`. « Reprendre le paiement » then « Payer (simulation) » (a POST form) leads to `/altinha-paris/merci?p=…`: « Rendez-vous confirmé / Paiement reçu. Votre rendez-vous « Cours particulier » (sam. 31 octobre 2026 · 17:30 à 18:30) est réservé. … », robots noindex. Mock mails: « Reçu : À l'unité chez Altinha Paris », « Rendez-vous confirmé : Cours particulier » (client), « Nouveau rendez-vous : Cours particulier » (pro). | Merci page: scrollWidth 375, no element wider, links « Voir mon espace » (`/altinha-paris/espace`) and « Retour à la page ». Screenshot checked. |
| Buy cancel return `…/rdv/EvtfIcW2lCiYuM7GZEbHh?paiement=annule&p=<purchase>` | robots « noindex, nofollow », referrer no-referrer. « Paiement interrompu / Votre créneau est gardé jusqu'à 13:16. », « Reprendre le paiement » (the buyer's own tab), « Libérer mon créneau ». The held 17:30 slot is missing from Saturday. | scrollWidth 375, no element wider. Screenshot checked. « Libérer mon créneau » was not clicked: the purchase was resumed and paid instead. |
| Offer page `/altinha-paris/offre/vIBiq0OW-WTvd84cmy8f9` | With `?paiement=annule&p=x`: robots « noindex, nofollow ». | With `?paiement=annule&p=x`: « noindex, nofollow ». Without the query: no robots meta, referrer no-referrer. |
| RDV page without the query | No robots meta, as expected (the dossier wants the type page indexable). | Same. |
| Espace `/altinha-paris/espace` (code sign-in as test-p5-d-1; the code was read from the mock mail and typed into the local form only) | « Envoi… », then the code step. « Vérification… » appeared while the code was checked. Then « Connexion réussie. » with focus on `h2#espace-title`. « Vos prochaines inscriptions »: « Cours particulier · Ticket · sam. 31 octobre 2026 · 17:30 à 18:30 · Annulation en ligne possible jusqu'au ven. 30/10 · 17:30. · Annuler ». Wallet « Aucun ticket » (the bought ticket is on the booking). | Same content, scrollWidth 375. Screenshot checked. |
| `/mon-espace` (test-p5-d-1) | The Altinha Paris card lists the same RDV; « Ouvrir l'espace chez Altinha Paris ». scrollWidth 1265 with a 1280 viewport (the scrollbar). | Same, scrollWidth 375. |
| Séance URL of an RDV occurrence (R47, P4CON:1593) | `/altinha-paris/seance/ZSkrHJR1nEMZ2ao7wmkgb` (test-p5-d-1's own RDV) goes to `/altinha-paris/espace`. | `/altinha-paris/seance/y-zRqxIqZAmidxzgstzEH` (another client's RDV) also goes to `/altinha-paris/espace`. |
| Unknown and archived ids | Unknown `AAAAAAAAAAAAAAAAAAAAA` and archived `_hYz1126dYiIuvGi1G5XQ` (« Stage d'été 2026 ») give the same answer: title « Page introuvable · Skedul », robots noindex, the same text « Page introuvable / Cette page n'existe pas ou a été déplacée. / Retour à l'accueil ». Fetched too: not-RDV (Cours collectif), foreign (another pro's RDV type) and malformed (`abc%20def`), all identical. Every one answers HTTP 200, the known streamed-404 behaviour (P4CON:1315). The visible text of the five responses is identical. Timing: a batch with the archived id first (1279, 466, 477, 477, 476, 476 ms) shows that the slow first request is a first-after-idle effect, not tied to the id, so there is no timing oracle. | The unknown and archived ids give the same « Page introuvable » page, scrollWidth 375. |
| Pro: type page `/dashboard/tickets/EvtfIcW2lCiYuM7GZEbHh` (pro one-click login) | « Page de réservation » row with `http://localhost:3102/altinha-paris/rdv/EvtfIcW2lCiYuM7GZEbHh`, « Copier », « Voir la page de réservation » (href `/altinha-paris/rdv/…`, target _blank). No note, because the type is bookable. | Same block, scrollWidth 375. The only elements wider than the viewport are the off-canvas sidebar links. |
| Pro: « Non réservable en ligne » reason (`/dashboard/tickets/auZh_u4MREHbGgmh56ISB`, pro « Test P5 C Sans horaires », code sign-in as test-p5-c-2 through its own espace) | The amber note « Non réservable en ligne / Ce type n'a pas d'horaires propres et vos disponibilités générales sont vides : ajoutez des horaires. », plus the booking-page row. | The note box is 285 px inside 375, its icons aria-hidden, scrollWidth 375. The public page `/test-p5-c-sans-horaires/rdv/auZh_u4MREHbGgmh56ISB` shows « Aucun créneau disponible pour le moment. » with the owner banner and no robots meta. |
| Pro: planning `?semaine=2026-10-26&seance=ZSkrHJR1nEMZ2ao7wmkgb` | The grid lists « 12:00 Appel découverte Test Rdv Un », « 17:30 Cours particulier Beatriz Almeida » and « 17:30 Cours particulier Test P5 D Un ». The deep link opens the dialog (aria-modal true, labelled « Cours particulier »): « sam. 31 octobre 2026 · 17:30 à 18:30 / Test P5 D Un / test-p5-d-1@skedul.test / Ticket / Confirmée / Cours particulier · sans limite de validité / Quel est votre objectif ? : Test P5 D paiement / Désinscrire / Annuler le rendez-vous ». No place row. Week of 2026-11-02: the phantom (test-p5-c-3's lapsed pending hold, Wed 4 Nov 10:00) and the cancelled RDV do not show; the séances do. | The dialog is 343 px wide at x 16, scrollWidth 375, same content. |

Not rerun in D1 (Group C covered them in T12 and T13, and the hidden pane rules out the first two): the two-tab race, the
OtpDialog Tab trap and focus return, « Libérer mon créneau », the free booking end to end, and the event-editor conflict count.

## 8. End state

- `preview_stop` before the build, and again at the end of the tour. preview_list was empty before the build.
- tsc rerun: 0.
- `git status --short`: empty. Only ignored paths exist (`.next/`, `.superpowers/`, env files, tsbuildinfo).
- HEAD `cb1727e`.

## Notes (not P5 failures, for the controller to rule on)

1. Inherited `router.refresh()` after a server action in 9 admin, help-center and settings files (6c). All unchanged since 052ab79.
2. Inherited dashes in 3 CSS comment lines (6d): `src/app/globals.css:201`, `src/components/landing/landing.module.css:11`
   and `:13`. They are outside the copy guard's .ts/.tsx scan.
3. Dev-mode only: the RSC payload of the unknown-id 404 has fewer React debug rows (`D` lines, hence different row ids) than
   the archived, not-RDV and foreign 404s. The visible text and status are identical, production strips those rows, and
   timing shows no difference. Production HTML was not compared (no `next start` in this brief).
4. The espace code form cleared the e-mail field and said « Adresse email invalide. » on the first submit after page load,
   twice (altinha-paris and test-p5-c-sans-horaires); the second submit worked. This is most likely a value set before
   hydration finished in the hidden pane. `email-code-form.tsx` is P4 code, unchanged in P5. A human check in a visible pane
   would settle it.
5. Known owner calls, seen again: « Vos prochaines inscriptions » heads RDVs too, and « Désinscrire » shows on an RDV attendee in
   the pro dialog.
6. Minor: « Voir la page de réservation » has target _blank with no rel. It is same-origin, and browsers imply noopener.
7. Minor, pre-existing: `/mon-espace` greets an OTP-created user with « Bonjour » alone, because the name lives on the customer
   row.
8. Focus moves could not be judged (`document.hasFocus()` false in the hidden pane).

## Test data left on tickets-dev by D1

1. User test-p5-d-1@skedul.test (id 1VCy0R4tYjfPDXdAJXpUedQdvdRzFht2, role client), created by the code sign-in on
   2026-10-29 at 11:35 UTC, with its e-mail OTP verification row. Its sessions were deleted on sign-out.
2. Customer DmG0sV83QVINFk_WOkvvI on altinha-paris (« Test P5 D Un »), not linked to the user row.
3. Paid mock purchase janGbWteW4FjWtFddouN_ (À l'unité 50 €, offer vIBiq0OW-WTvd84cmy8f9) and its 1 ticket, now booked; the
   receipt was logged.
4. Confirmed RDV booking nJKm_u1CuDfg2Ss9ig26i on occurrence ZSkrHJR1nEMZ2ao7wmkgb: Cours particulier, Sat 31 Oct 2026, 17:30
   to 18:30 Paris, answer « Test P5 D paiement ».
5. test-p5-c-2@skedul.test (Group C's user): one more code sign-in and its OTP verification row; the session was deleted on
   sign-out.
6. Sessions from the one-click logins (Beatriz, pro), both signed out.
7. page_view rows, rate-limit and throttle rows from the buy and the two code sends. Mock mails are in the server log only.

No account was deleted, no SQL write was made through MCP (only read-only SELECTs on tickets-dev and tickets-test), and no
source file was changed.
