/**
 * Wiring guards for the client espace (Task 22). The leaves import Server Actions, Better Auth's client and next/*,
 * which node:test cannot load, so what they must keep is pinned on their source; the rules they apply have their own
 * pure tests (space-view.test.ts, sign-in-flow.test.ts). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");
const CANCEL = read("src/components/public/cancel-booking-button.tsx");
const SPEND = read("src/components/public/spend-seance-button.tsx");
const OTHER = read("src/components/public/other-address-button.tsx");
const FORGET = read("src/components/public/forget-guest-link-button.tsx");
const STATUS = read("src/components/public/space-status.tsx");
const PAGE = read("src/app/[slug]/espace/page.tsx");
const MY_SPACE = read("src/components/public/my-space.tsx");

test("« Annuler » asks first, calls the action through callOrFail, announces the result and gives the focus to the section heading (WCAG 2.4.3)", () => {
  assert.match(CANCEL, /^"use client";/);
  assert.match(CANCEL, /import \{ cancelMyBookingAction \} from "@\/server\/client";/);
  assert.match(CANCEL, /callOrFail\(\(\) => cancelMyBookingAction\(\{ slug, bookingId \}\)\)/);
  assert.match(CANCEL, /<ConfirmDialog/);
  assert.match(CANCEL, /cancelBookingCopy\(coverage, businessName\)/);
  assert.match(CANCEL, /returnFocusTo=\{focusAfterClose\}/);
  assert.match(CANCEL, /useCallback\(\(\) => \(leaving\.current \? upcomingHeading\(\) : null\), \[\]\)/, "the heading after a confirmed cancellation, else the opener");
  const flag = CANCEL.indexOf("leaving.current = true;");
  assert.ok(flag !== -1 && flag < CANCEL.indexOf("await callOrFail("), "the flag is set before the answer is awaited");
  assert.match(refusalBranch(CANCEL), /leaving\.current = false;/, "a refusal keeps the focus in the dialog's own flow: the reset sits in the refusal branch itself (G3b)");
  assert.match(CANCEL, /announce\(COPY\.CANCELLED_OK\)/);
  assert.ok(CANCEL.indexOf("if (!res.ok)") < CANCEL.indexOf("announce(COPY.CANCELLED_OK)"), "announced on success only");
  assert.doesNotMatch(CANCEL, /router\.refresh|useRouter/, "the action revalidates the page itself");
});

test("« Réserver avec 1 ticket » posts the ISO start the server rendered and no answers, announces and focuses the heading", () => {
  assert.match(SPEND, /^"use client";/);
  assert.match(SPEND, /import \{ bookWithHeldTicketAction \} from "@\/server\/public";/);
  assert.match(
    SPEND,
    /callOrFail\(\(\) => bookWithHeldTicketAction\(\{ slug, occurrenceId: seance\.occurrenceId, seenStartsAt: seance\.startsAt, answers: \[\] \}\)\)/,
  );
  assert.match(SPEND, /spendControlOf\(\{ needsAnswers: seance\.needsAnswers, canSpend, visitorState \}\)/);
  assert.match(SPEND, /announce\(SPEND_DONE\)/);
  assert.match(SPEND, /upcomingHeading\(\)\?\.focus\(\)/);
  assert.ok(SPEND.indexOf("if (!res.ok)") < SPEND.indexOf("announce(SPEND_DONE)"), "announced on success only");
  assert.doesNotMatch(SPEND, /router\.refresh|useRouter|new Date\(/);
});

test("the spend button never prefills or locks the sign-in address, offers the dialog to an anonymous visitor only and describes the disabled state (Decision 7, risk 7, COV-C1)", () => {
  const dialog = /<OtpDialog[\s\S]*?\/>/.exec(SPEND);
  assert.ok(dialog, "the sign-in dialog is mounted");
  assert.doesNotMatch(dialog[0], /email|defaultValue|value=|readOnly/i, "the address field is the dialog's own, empty");
  assert.match(SPEND, /canOfferCodeSignIn\(visitorState\)/);
  assert.match(SPEND, /control === "disabled"/);
  assert.match(SPEND, /aria-describedby=\{hintId\}/);
  assert.match(SPEND, /\{COPY\.CONFIRM_EMAIL_TO_SPEND\}/);
  assert.match(SPEND, /<Link href=\{`\/\$\{slug\}\/seance\/\$\{seance\.occurrenceId\}`\}/);
});

test("« Utiliser une autre adresse » signs out, then leaves with a full navigation that drops the router cache (SEC-M12)", () => {
  assert.match(OTHER, /^"use client";/);
  const out = OTHER.indexOf("await signOut()");
  const leave = OTHER.indexOf("window.location.replace(returnPathOf(path))");
  assert.ok(out !== -1 && leave > out, "sign out first, then the full navigation");
  assert.match(OTHER, /\{COPY\.OTHER_ADDRESS\}/);
  assert.doesNotMatch(OTHER, /router\.(refresh|push|replace)/);
});

test("« Ce n'est pas moi » clears the cookie through the action, then navigates in full (Decision 63)", () => {
  assert.match(FORGET, /^"use client";/);
  assert.match(FORGET, /import \{ forgetGuestLinkAction \} from "@\/server\/client";/);
  const act = FORGET.indexOf("callOrFail(() => forgetGuestLinkAction({ slug }))");
  const leave = FORGET.indexOf("window.location.replace(`/${slug}/espace`)");
  assert.ok(act !== -1 && leave > act, "the action first, then the full navigation");
  assert.match(FORGET, /\{COPY\.NOT_ME\}/);
  assert.match(FORGET, /<div role="alert">/, "the failure sits in an always-mounted alert region");
  assert.doesNotMatch(FORGET, /router\./);
});

test("every failure of a leaf sits in an always-mounted role=\"alert\" region, never in FormError, which mounts its alert together with the text (§ 1 UI rules, COV-M11)", () => {
  for (const [name, source] of [["SPEND", SPEND], ["OTHER", OTHER], ["FORGET", FORGET]] as const) {
    assert.match(source, /<div role="alert">\{error && <p className="rounded-lg bg-destructive\/10 px-3 py-2 text-sm text-rose-700">\{error\}<\/p>\}<\/div>/, `${name}: the region stays mounted, only its text comes and goes`);
    assert.doesNotMatch(source, /<FormError\b/, `${name}: FormError mounts its alert together with the text`);
    assert.doesNotMatch(source, /dashboard\/form-error/, `${name}: no FormError import left`);
  }
});

test("the success line is one always-mounted status region shared by the leaves, so it outlives the row that triggered it", () => {
  assert.match(STATUS, /^"use client";/);
  assert.match(STATUS, /<p\s+role="status"/);
  assert.match(STATUS, /export function SpaceStatusProvider/);
  assert.match(STATUS, /export function useSpaceStatus/);
  assert.match(STATUS, /document\.getElementById\(UPCOMING_HEADING_ID\)/);
});

test("the page reads the identity from the request's visitor, never a session of its own, and hands no id or row to a client leaf", () => {
  assert.match(PAGE, /resolveSpaceCustomer\(pro\)/);
  assert.doesNotMatch(PAGE, /getSession\(|getFreshSession\(|cookies\(/);
  assert.doesNotMatch(PAGE, /\bcustomerId=\{|\buserId=\{|stripeAccountId|googleCalendarId/);
  assert.match(PAGE, /const returnTo = `\/\$\{pro\.slug\}\/espace`;/);
  assert.match(PAGE, /title: "Mon espace"/);
  assert.match(PAGE, /robots: \{ index: false \}/);
  assert.match(
    PAGE,
    /spend=\{\{ seances: spendable, canSpend: canSpendIn\(identity\), visitorState, googleEnabled: env\.GOOGLE_CALENDAR_ENABLED, returnTo \}\}/,
  );
});

test("the sign-in-by-code form is offered to an anonymous visitor only, after every signed-in state was handled (risk 7, COV-C1, S38)", () => {
  const steps = [
    'if (identity.kind === "impersonating") {',
    'if (identity.kind === "no_record") {',
    "if (space) {",
    'if (identity.kind === "unverified") {',
    "canOfferCodeSignIn(visitorState)",
    "<EmailCodeForm",
  ].map((text) => PAGE.indexOf(text));
  assert.ok(steps.every((at) => at !== -1), "every branch is there");
  assert.ok(steps.every((at, i) => i === 0 || at > steps[i - 1]), "in this order: the form is the last resort");
  assert.equal((PAGE.match(/<EmailCodeForm/g) ?? []).length, 1);
  assert.equal((PAGE.match(/<ClientSignInChoices/g) ?? []).length, 1);
});

test("the confirmation banner is rendered once, outside the identity switch, as the first child of the shell, so it stays mounted when a code is accepted (WCAG 2.4.3, Revision 3.2)", () => {
  assert.equal((PAGE.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one banner, in the shell");
  assert.match(PAGE, /const banner = bannerOfIdentity\(identity, space\?\.customer\.email \?\? null\);/);
  assert.match(
    PAGE,
    /<PublicShell branding=\{branding\} backHref=\{`\/\$\{slug\}`\}>\s*\{banner && <VerifyEmailBanner email=\{banner\.email\} verified=\{banner\.verified\} \/>\}\s*\{children\}\s*\{canSignOutIn\(identity\) && \([\s\S]*?\)\}\s*<\/PublicShell>/,
  );
  assert.ok(PAGE.indexOf("<VerifyEmailBanner") < PAGE.indexOf('if (identity.kind === "impersonating") {'), "defined before the branches, which all go through the shell");
});

test("the unverified visitor gets the sentence only when no space is shown; the link's customer gets the guest note and « Ce n'est pas moi »; the Owner without a record gets the other-address button", () => {
  // « Confirmez votre adresse pour voir vos réservations. » once, in the unverified branch that comes AFTER `if (space)`: never above reservations that are shown (G1b).
  assert.equal((PAGE.match(/\{COPY\.CONFIRM_EMAIL_FIRST\}/g) ?? []).length, 1);
  assert.ok(PAGE.indexOf("{COPY.CONFIRM_EMAIL_FIRST}") > PAGE.indexOf("if (space) {"));
  assert.ok(PAGE.indexOf("{COPY.CONFIRM_EMAIL_FIRST}") > PAGE.indexOf('if (identity.kind === "unverified") {'));
  assert.match(PAGE, /\{COPY\.IMPERSONATING\}/);
  assert.match(PAGE, /noRecordText\(pro\.businessName, identity\.email\)/);
  assert.match(PAGE, /<OtherAddressButton path=\{returnTo\} \/>/);
  assert.match(PAGE, /guestNote\(space\.customer\.email\)/);
  assert.match(PAGE, /<ForgetGuestLinkButton slug=\{pro\.slug\} \/>/);
  assert.match(PAGE, /Ce lien n'est plus valide\./);
});

test("the espace offers « Se déconnecter » once, in the shell, to the visitors canSignOutIn names, and returns to the espace itself (G3b)", () => {
  assert.equal((PAGE.match(/<ClientSignOutButton/g) ?? []).length, 1, "one control, in the shell");
  assert.match(PAGE, /import \{ ClientSignOutButton \} from "@\/components\/public\/client-sign-out-button";/);
  assert.match(
    PAGE,
    /\{children\}\s*\{canSignOutIn\(identity\) && \(\s*<div className="mt-8">\s*<ClientSignOutButton returnTo=\{returnTo\} \/>\s*<\/div>\s*\)\}\s*<\/PublicShell>/,
    "after the content of every branch, for the visitors with a session only",
  );
  assert.ok(PAGE.indexOf("<ClientSignOutButton") < PAGE.indexOf('if (identity.kind === "impersonating") {'), "defined in the shell all branches go through");
});

test("the /mon-espace cards carry the same wallet notes as the espace: an archived type and a type no upcoming séance accepts (§ 3.23 MySpaceView, COV-I2)", () => {
  assert.match(MY_SPACE, /w\.archived && /);
  assert.match(MY_SPACE, /\{w\.typeClass === "orphan" && <p className="text-xs text-zinc-600 wrap-anywhere">\{COPY\.ORPHAN_TYPE\}<\/p>\}/);
});

/** The statements of the `if (!res.ok) { ... }` branch of the leaf's transition (it closes at the indentation of the `if`). */
function refusalBranch(source: string): string {
  const match = /if \(!res\.ok\) \{\r?\n([\s\S]*?)\r?\n {6}\}/.exec(source);
  assert.ok(match, "the refusal branch is there");
  return match[1];
}

/** The source of the leaf's `submit()`: from its declaration to the `return (` of the component (LF or CRLF checkouts). */
function submitOf(source: string): string {
  const start = source.indexOf("function submit() {");
  assert.notEqual(start, -1, "submit() is there");
  const end = source.slice(start).search(/\r?\n {2}return \(\r?\n/);
  assert.notEqual(end, -1, "the component's return follows submit()");
  return source.slice(start, start + end);
}

test("the submit() slicer finds the end of the function in an LF and in a CRLF checkout, and refuses a source without one (G4a)", () => {
  const lf = "  function submit() {\n    setError(null);\n  }\n\n  return (\n    <>\n";
  for (const source of [lf, lf.replace(/\n/g, "\r\n")]) {
    const submit = submitOf(source);
    assert.match(submit, /setError\(null\);/);
    assert.doesNotMatch(submit, /return \(/, "the slice stops before the JSX");
  }
  assert.throws(() => submitOf("function submit() {\n  setError(null);\n}\n"), /the component's return follows submit/);
  assert.throws(() => submitOf("const x = 1;"), /submit\(\) is there/);
});

test("« Annuler » clears the status line when it starts, so two successes in a row are both announced; a refusal resets the flag in the refusal branch itself (G3b)", () => {
  const submit = submitOf(CANCEL);
  const cleared = submit.indexOf("announce(null);");
  assert.ok(cleared !== -1 && cleared < submit.indexOf("startTransition("), "announce(null) runs before the action starts (the useSpaceStatus contract)");
  // The same message twice is one state: without the reset the second « Inscription annulée. » would not be read out.
  assert.match(refusalBranch(CANCEL), /leaving\.current = false;/, "removing the reset from the refusal branch fails this test");
  assert.match(refusalBranch(CANCEL), /setError\(res\.error\);/);
});

test("« Réserver avec 1 ticket » keeps the focus on a refusal: aria-disabled while pending, never `disabled` on the clicked button (G3b)", () => {
  assert.doesNotMatch(SPEND, /disabled=\{pending\}/, "a focused button that becomes disabled drops the focus on <body>");
  const book = SPEND.slice(SPEND.indexOf("function book() {"), SPEND.indexOf("if (control === \"none\")"));
  assert.match(book, /if \(pending\) return;/, "a click or Enter while the answer is awaited does nothing");
  assert.match(SPEND, /aria-disabled=\{pending \|\| undefined\}/);
  assert.match(SPEND, /aria-disabled:pointer-events-none aria-disabled:opacity-50/, "it still looks disabled");
  // The refusal text reaches a screen reader through the always-mounted alert region, and the button keeps the focus.
  assert.match(refusalBranch(SPEND), /setError\(res\.error\);/);
  assert.doesNotMatch(refusalBranch(SPEND), /focus\(/, "nothing moves the focus away on a refusal");
});

test("the up-to-8 rows of « Utiliser vos tickets » have distinct accessible names that start with the visible label, on the link, the disabled and the enabled button (G3b)", () => {
  assert.match(SPEND, /import \{ SPEND_DONE, SPEND_LABEL, SPEND_LINK_LABEL, spendButtonName, spendControlOf \} from "@\/lib\/public\/space-view";/);
  assert.match(SPEND, /<Link href=\{`\/\$\{slug\}\/seance\/\$\{seance\.occurrenceId\}`\} aria-label=\{spendButtonName\(SPEND_LINK_LABEL, seance\.title, seance\.whenLabel\)\}>/);
  assert.equal((SPEND.match(/aria-label=\{spendButtonName\(/g) ?? []).length, 3, "the link and the two buttons");
  assert.match(SPEND, /aria-label=\{spendButtonName\(SPEND_LABEL, seance\.title, seance\.whenLabel\)\}/);
  assert.match(SPEND, /aria-label=\{spendButtonName\(pending \? COPY\.PENDING_BOOK : SPEND_LABEL, seance\.title, seance\.whenLabel\)\}/, "the pending label is the visible one");
});

test("the « Réserver » link of a séance with questions does not stretch full width on a phone (G3b)", () => {
  assert.match(SPEND, /<Button asChild variant="secondary" size="sm" className="self-start sm:self-auto">/);
});

test("the no_record « Voir la page de … » button wraps long business names like the espace's own (G3b)", () => {
  assert.match(PAGE, /<Button asChild variant="secondary" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1\.5 wrap-anywhere">\s*<Link href=\{`\/\$\{slug\}`\}>\{`Voir la page de \$\{pro\.businessName\}`\}<\/Link>/);
});
