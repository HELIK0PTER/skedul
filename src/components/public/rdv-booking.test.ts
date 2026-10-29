/**
 * Wiring guard for src/components/public/rdv-booking.tsx (P5 T12). The component is a client component that imports a
 * Server Action and the sign-in dialog, which the node:test runner cannot load, so the rules it must keep are pinned on
 * its source; the mode of a slot, the week and the copy have their own pure tests (rdv-view.test.ts, rdv-form.test.ts).
 * Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BUY_TITLE, OFFERS_LEGEND } from "@/lib/public/buy-and-book-form";
import { COPY, heldTicketButtonLabel } from "@/lib/public/messages";
import { SEE_MY_SPACE } from "@/lib/public/seance-copy";
import { codeView, openingTags } from "@/test/source-guards";

const SOURCE = readFileSync("src/components/public/rdv-booking.tsx", "utf8");
const CODE = codeView(SOURCE);

test("it is a client component that calls bookRdvAction and nothing else of the server", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /^import \{ bookRdvAction \} from "@\/server\/public";\r?$/m);
  assert.doesNotMatch(SOURCE, /from "@\/(lib\/booking\/|lib\/db|lib\/payments|server\/(?!public"))/);
  assert.doesNotMatch(SOURCE, /^import (?!type)[^;]*(?:-actions|-reads)";/m, "no core and no read is imported at run time");
  assert.match(SOURCE, /^import type \{ BookRdvActionInput \} from "@\/lib\/public\/rdv-actions";\r?$/m, "the input's type only");
});

test("the start posted is the chip's server ISO string, verbatim; the browser builds no instant (§ 3.3)", () => {
  assert.match(SOURCE, /const slotInput = \{ ticketTypeId: p\.ticketTypeId, startsAt: slot\.iso, answers \};/);
  assert.doesNotMatch(CODE, /new Date\(|Date\.now\(|getTimezoneOffset|toLocale/, "no clock and no wall time of the browser");
  assert.equal(CODE.split("bookRdvAction(").length - 1, 1, "one call site");
  assert.match(SOURCE, /bookRdvAction\(\{ slug: p\.slug, \.\.\.input \}\)/);
});

test("each mode sends its own shape: the held ticket sends no identity, free and buy the typed one, buy its offer (SEC-M15)", () => {
  assert.match(SOURCE, /: \{ \.\.\.slotInput, mode: "held_ticket" \};/);
  assert.match(SOURCE, /\{ \.\.\.slotInput, mode: "free", identity: identityToSend\(effective\), website \}/);
  assert.match(SOURCE, /\{ \.\.\.slotInput, mode: "buy", offerId: chosenOffer\.offerId, identity: identityToSend\(effective\), website \}/);
  assert.equal(inCodeCount(/rdvSlotMode\(/g), 1, "one derivation of the mode (§ 3.6)");
  assert.match(SOURCE, /rdvSlotMode\(\{ isFree: p\.isFree, startsAtIso: slot\.iso, ownerTickets: p\.ownerTickets, offers: p\.offers \}\)/);
  assert.doesNotMatch(SOURCE, /amountCents|priceCents: (?!number)/, "no amount and no price is ever sent");
  assert.doesNotMatch(CODE, /customerId|userId|professionalId|ownerUserId/);
});

/** Matches of `re` in the code only (a comment or a string that spells it does not count). */
function inCodeCount(re: RegExp): number {
  return [...SOURCE.matchAll(re)].filter((m) => CODE[m.index ?? 0] !== " ").length;
}

test("the browser leaves only for a Checkout URL safeCheckoutUrl accepts, after keeping the held id of this slot", () => {
  const store = SOURCE.indexOf("storeRdvHoldId(storage, p.ticketTypeId, slot.iso, res.purchaseId);");
  const check = SOURCE.indexOf("safeCheckoutUrl(res.checkoutUrl, window.location.origin)");
  assert.ok(store !== -1 && check > store, "the id is kept first");
  assert.equal(SOURCE.split("window.location.assign(").length - 1, 1, "one navigation, to the checked URL");
  assert.match(SOURCE, /window\.location\.assign\(target\);/);
  assert.doesNotMatch(SOURCE, /window\.location\.href\s*=|location\.replace\(/);
  assert.match(SOURCE, /setError\(COPY\.CHECKOUT_FAILED\);/, "an unsafe URL never leaves the page");
});

test("the resume link is the Owner's server link of this page, else the purchase this tab started for this slot (O6)", () => {
  assert.match(SOURCE, /const own = `\/\$\{encodeURIComponent\(p\.slug\)\}\/rdv\/`;/);
  assert.match(SOURCE, /if \(res\.resumeHref !== undefined && res\.resumeHref\.startsWith\(own\)\) return res\.resumeHref;/);
  assert.match(SOURCE, /readRdvHoldId\(browserSessionStorage\(\), p\.ticketTypeId, startsAtIso\)/);
  assert.match(SOURCE, /rdvReturnHref\(p\.slug, p\.ticketTypeId, held\)/);
  assert.match(SOURCE, /<Link href=\{resumeHref\} className=\{INLINE_LINK_CLASS\}>\s*\{COPY\.RETURN_LINK\}/);
});

test("it never refreshes the router: a refusal of a taken or vanished slot fetches the same URL again, a success relies on the revalidation", () => {
  assert.doesNotMatch(CODE, /router\.refresh|window\.location\.reload|router\.push/);
  assert.equal(inCodeCount(/router\.replace\(/g), 1);
  assert.match(
    SOURCE,
    /if \(res\.code === "slot_taken" \|\| res\.code === "unavailable"\) \{\s*router\.replace\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`, \{ scroll: false \}\);\s*\}/,
  );
  assert.doesNotMatch(CODE, /getSession|getFreshSession|authClient|useSession/);
});

test("every submit is disabled while pending and shows its pending label", () => {
  const submits = openingTags(SOURCE, "Button").filter((t) => /\stype="submit"/.test(t.topLevel));
  assert.equal(submits.length, 1, "one submit, whatever the mode");
  assert.match(submits[0].text, /\sdisabled=\{pending\}/);
  assert.match(SOURCE, /\{pending \? pendingLabel : submitLabel\}/);
  assert.match(SOURCE, /const pendingLabel = mode\?\.kind === "buy" \? COPY\.PENDING_PAY : COPY\.PENDING_BOOK;/);
  assert.match(SOURCE, /heldTicketButtonLabel\(mode\.leftAfter\)/);
  assert.match(SOURCE, /payLabel\(\{ \.\.\.offer, covers: true \}, p\.currency\)/);
  assert.match(SOURCE, /if \(pending \|\| slot === null \|\| mode === null\) return;/, "a second click while the call runs does nothing");
  assert.match(SOURCE, /if \(event\.persisted\) setPending\(false\);/, "a page back from the bfcache leaves the pending state");
});

test("the status and alert regions are always mounted, outside the slot form, so they outlive the slot they name (G4c)", () => {
  const formEnd = SOURCE.lastIndexOf("</form>");
  const status = SOURCE.indexOf('<div role="status">');
  const alert = SOURCE.indexOf("<FormError alwaysMounted message={error} ref={errorBox} tabIndex={-1} />");
  assert.ok(formEnd !== -1 && status > formEnd && alert > formEnd, "after the form, at the block's level");
  assert.equal(SOURCE.split('role="status"').length - 1, 1);
  assert.match(SOURCE, /if \(statusTick > 0\) statusBox\.current\?\.focus\(\);/, "the success line takes the focus");
  assert.match(SOURCE, /const \{ root, errorBox, refused \} = useRefusalFocus\(\);/, "a refusal focuses the first invalid field, else the alert");
  assert.match(SOURCE, /<form ref=\{root\} method="post" onSubmit=\{submit\} noValidate/);
});

test("the block says an empty week itself, so a booking or a refusal that takes the last slot keeps its status, alert and resume link (R2, G4c)", () => {
  assert.match(SOURCE, /\n {2}\/\*\* The next week's address while it is within the horizon, else null[^\n]*\*\/\r?\n {2}nextWeekHref: string \| null;\r?\n/);
  assert.match(SOURCE, /const emptyWeek = withSlots\.length === 0;/, "an empty week is decided by the block, from the days it was given");
  const empty = SOURCE.indexOf("{emptyWeek ? (");
  const sentence = SOURCE.indexOf("{COPY.RDV_EMPTY_WEEK}");
  const slotsEnd = SOURCE.lastIndexOf("</>");
  const formEnd = SOURCE.lastIndexOf("</form>");
  const status = SOURCE.indexOf('<div role="status">');
  const alert = SOURCE.indexOf("<FormError alwaysMounted message={error} ref={errorBox} tabIndex={-1} />");
  const resume = SOURCE.indexOf("{resumeHref !== null && (");
  assert.ok(empty !== -1 && sentence > empty, "the empty-week sentence is the first branch of the switch");
  assert.ok(formEnd > sentence && slotsEnd > formEnd, "the week, its chips and the slot form are the other branch");
  assert.ok(status > slotsEnd && alert > status && resume > alert, "the regions come after the switch: they are mounted in both branches");
  assert.match(SOURCE, /\{p\.nextWeekHref && \(\s*<p className="text-sm">\s*<Link href=\{p\.nextWeekHref\} scroll=\{false\} className=\{INLINE_LINK_CLASS\}>\s*\{COPY\.RDV_NEXT_WEEK\}/, "the next week while it is within the horizon");
});

test("the day and time chips are toggles named by their full date and time; below 640 px the week is a list per day (R52)", () => {
  assert.match(SOURCE, /aria-pressed=\{pressed\}\s+aria-label=\{slot\.ariaLabel\}/, "a time chip");
  assert.match(SOURCE, /aria-pressed=\{pressed\}\s+aria-label=\{rdvDayChipLabel\(day\)\}/, "a day chip");
  assert.match(SOURCE, /role="group" aria-label=\{RDV_DAYS_LABEL\}/);
  assert.match(SOURCE, /role="group" aria-label=\{rdvTimesLabel\(day\.label\)\}/);
  assert.match(SOURCE, /<div className="hidden space-y-4 sm:block">/);
  assert.match(SOURCE, /<div className="space-y-5 sm:hidden">/);
  assert.equal(openingTags(SOURCE, "button").filter((t) => /\stype="button"/.test(t.topLevel)).length, 2, "the two chip kinds are plain buttons, never submits");
});

test("the code sign-in is the dialog for an anonymous visitor of a paid type, and hands the focus to the RDV heading with « Connexion réussie. » (UI-1)", () => {
  assert.match(SOURCE, /const hint = rdvSignInHint\(\{ isFree: p\.isFree, state: visitor\.state \}\);/);
  assert.match(SOURCE, /\{hint === "prompt" && <HaveTicketsPrompt p=\{p\} \/>\}/);
  assert.match(SOURCE, /\{hint === "confirm" && <p[^>]*>\{COPY\.CONFIRM_EMAIL_TO_SPEND\}<\/p>\}/);
  assert.equal(SOURCE.split("<OtpDialog").length - 1, 1, "the dialog is rendered in one place only");
  assert.match(
    SOURCE,
    /<OtpDialog open=\{open\} onClose=\{\(\) => setOpen\(false\)\} returnTo=\{p\.returnTo\} googleEnabled=\{p\.googleEnabled\} returnFocusTo=\{rdvHeadingAfterSignIn\} \/>/,
  );
  assert.match(
    SOURCE,
    /\nfunction rdvHeadingAfterSignIn\(\): HTMLElement \| null \{\s*announceSignIn\(COPY\.SIGNED_IN\);\s*return document\.getElementById\(RDV_HEADING_ID\);\s*\}/,
    "a module-level target, asked after a sign-in only (focusTargetOnClose)",
  );
});

test("the identity is typed once, the verified visitor's e-mail is the session's, and the held ticket asks for the answers only", () => {
  assert.equal(SOURCE.split("useState<IdentityInput>").length - 1, 1, "one identity state");
  assert.equal(SOURCE.match(/visitor\.state === "verified" && visitor\.email !== null/g)?.length, 1, "one definition of the lock");
  assert.equal(SOURCE.split("<IdentityFields").length - 1, 1, "one place renders the identity fields");
  assert.match(SOURCE, /\{mode\.kind !== "held" && \(\s*<IdentityFields/);
  assert.match(SOURCE, /const local = \{ \.\.\.\(typed \? identityErrors\(effective\) : \{\}\), \.\.\.requiredAnswerErrors\(p\.questions, values\) \};/);
  assert.match(SOURCE, /<QuestionFields idPrefix=\{uid\} questions=\{p\.questions\}/, "the type's questions (R10, R17)");
});

test("the buy form lists the offers covering the chosen start only, with the test-payments note; none says so (§ 3.6, R53)", () => {
  assert.match(SOURCE, /const covering = mode\?\.kind === "buy" \? mode\.offers : \[\];/);
  assert.match(SOURCE, /\{covering\.map\(\(o\) => \{/);
  assert.match(SOURCE, /<legend className="text-sm font-medium">\{OFFERS_LEGEND\}<\/legend>/);
  assert.match(SOURCE, /\{p\.testMode && <TestPaymentsBanner mode=\{p\.testMode\} \/>\}/);
  assert.match(SOURCE, /<p className="text-sm text-zinc-600">\{COPY\.RDV_NO_OFFER\}<\/p>/);
});

test("every sentence the block shows is RDV wording: no séance, inscription or place, and no dash (P5 copy rule)", () => {
  const SEANCE_WORDS = /[Ss][ée]ance|[Ii]nscri|(^|[^a-zà-ÿ])place([^a-zà-ÿ]|$)/;
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  const keys = [...new Set([...SOURCE.matchAll(/\bCOPY\.([A-Z_]+)\b/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 8, `the block reads its copy from COPY (${keys.join(", ")})`);
  const copy = COPY as Record<string, string>;
  const texts = [...keys.map((key) => copy[key]), BUY_TITLE, OFFERS_LEGEND, SEE_MY_SPACE, heldTicketButtonLabel(0), heldTicketButtonLabel(3)];
  for (const text of texts) {
    assert.equal(typeof text, "string");
    assert.doesNotMatch(text, SEANCE_WORDS, text);
    assert.doesNotMatch(text, dash, text);
  }
  // The séance block's own sentences never appear here.
  assert.doesNotMatch(CODE, /COPY\.(?:REGISTERED|BOOKED_WITH_TICKET|NO_COVERING_OFFER|PENDING_REGISTER|TOO_MANY_PAYMENTS|GUEST_BOOKING_EXISTS)\b|OFFER_TOO_SHORT|ticketUsedLine|TICKETS_BOOKING_TITLE|FREE_BOOKING_TITLE/);
  assert.doesNotMatch(CODE, /console\./, "no log, no raw error");
});
