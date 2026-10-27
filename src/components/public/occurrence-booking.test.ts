/**
 * Wiring guard for src/components/public/occurrence-booking.tsx. The component is a client component that imports
 * Server Actions and the sign-in dialog, which the node:test runner cannot load, so the rules it must keep are pinned
 * on its source (the form helpers and the copy have their own pure tests). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView, openingTags } from "@/test/source-guards";

const SOURCE = readFileSync("src/components/public/occurrence-booking.tsx", "utf8");

test("buy + book posts the slug, the séance, the chosen offer, the typed identity, the answers and the honeypot, never a price", () => {
  assert.match(
    SOURCE,
    /startBuyAndBookAction\(\{ slug: p\.slug, occurrenceId: p\.occurrenceId, offerId: offer\.offerId, seenStartsAt: p\.seenStartsAt, identity: identityToSend\(effective\), answers, website \}\)/,
  );
  assert.doesNotMatch(SOURCE, /amountCents|priceCents: (?!number)/, "no amount and no price is ever sent");
});

test("the browser leaves only for a Checkout URL safeCheckoutUrl accepts, after keeping the held id for the return link", () => {
  assert.match(SOURCE, /storeHoldId\(storage, p\.occurrenceId, res\.purchaseId\);/);
  assert.match(SOURCE, /safeCheckoutUrl\(res\.checkoutUrl, window\.location\.origin\)/);
  assert.equal(SOURCE.split("window.location.assign(").length - 1, 1, "one navigation, to the checked URL");
  assert.match(SOURCE, /window\.location\.assign\(target\);/);
  assert.doesNotMatch(SOURCE, /window\.location\.href\s*=|location\.replace\(/);
  assert.match(SOURCE, /setHeldId\(readHoldId\(browserSessionStorage\(\), p\.occurrenceId\)\);/);
  assert.match(SOURCE, /href=\{returnHref\(p\.slug, p\.occurrenceId, heldId\)\}[^>]*>\s*\{COPY\.RETURN_LINK\}/);
});

test("the offers are a fieldset with a legend; an offer that does not cover the séance is disabled and explained", () => {
  assert.match(SOURCE, /<legend className="text-sm font-medium">\{OFFERS_LEGEND\}<\/legend>/);
  assert.match(SOURCE, /disabled=\{!o\.covers\}/);
  assert.match(SOURCE, /aria-describedby=\{o\.covers \? undefined : shortId\}/);
  assert.match(SOURCE, /\{OFFER_TOO_SHORT\}/);
  assert.match(SOURCE, /<p className="text-sm text-zinc-600">\{COPY\.NO_COVERING_OFFER\}<\/p>/);
});

test("the pay button shows its price, then the pending label, and is disabled while pending", () => {
  assert.match(SOURCE, /\{pending \? COPY\.PENDING_PAY : payLabel\(offer, p\.currency\)\}/);
  // BuyForm is private (`bodyOf` reads exports only): its source runs from its declaration to the next top-level one (G4b).
  const start = SOURCE.indexOf("\nfunction BuyForm(");
  assert.notEqual(start, -1, "BuyForm is declared at the top level");
  const next = SOURCE.slice(start + 1).search(/\n(?:export |function |const |async function )/);
  const buy = next === -1 ? SOURCE.slice(start) : SOURCE.slice(start, start + 1 + next);
  const submits = openingTags(buy, "Button").filter((t) => /\stype="submit"/.test(t.topLevel));
  assert.equal(submits.length, 1, "one submit button in BuyForm");
  assert.match(submits[0].text, /\sdisabled=\{pending\}/, "a second click while the Checkout session starts does nothing");
  assert.match(buy, /\{pending \? COPY\.PENDING_PAY : payLabel\(offer, p\.currency\)\}/, "the label is BuyForm's own");
  assert.match(SOURCE, /<TestPaymentsBanner mode=\{p\.testMode\} \/>/);
  assert.match(SOURCE, /\{p\.testMode && <TestPaymentsBanner/);
});

test("a page restored from the back/forward cache leaves the pending state", () => {
  assert.match(SOURCE, /window\.addEventListener\("pageshow", onShow\)/);
  assert.match(SOURCE, /if \(event\.persisted\) setPending\(false\);/);
  assert.match(SOURCE, /window\.removeEventListener\("pageshow", onShow\)/);
});

test("the buy block is for a visitor who cannot spend a held ticket", () => {
  assert.match(SOURCE, /const canBuy = !visitor\.canSpend;/);
  assert.match(SOURCE, /\{canBuy && <BuyForm p=\{p\} \/>\}/);
  assert.doesNotMatch(SOURCE, /return null;\s*return \(\s*<Card>/, "the card is no longer hidden from a visitor who can only buy");
});

test("the identity rules of the two typed forms live in one hook: the lock of a verified visitor's e-mail is written once", () => {
  assert.equal(SOURCE.split("useTypedIdentityForm(p)").length - 1, 2, "the free form and the buy form both call it");
  assert.equal(SOURCE.match(/visitor\.state === "verified" && visitor\.email !== null/g)?.length, 1, "one definition of the lock");
  assert.equal(
    SOURCE.match(/emailLocked && visitor\.email !== null \? \{ \.\.\.identity, email: visitor\.email \} : identity/g)?.length,
    1,
    "one override of the typed e-mail by the session's",
  );
  assert.equal(SOURCE.split("useState<IdentityInput>").length - 1, 1, "one identity state");
  assert.equal(SOURCE.split("identityErrors(effective)").length - 1, 1, "one browser-side check of the identity");
  assert.equal(SOURCE.split("<IdentityFields").length - 1, 1, "one place renders the identity fields");
});

test("it is a client component that calls the Server Actions of the public booking and nothing else of the server", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /import \{ bookWithHeldTicketAction, registerFreeAction, startBuyAndBookAction \} from "@\/server\/public";/);
  assert.doesNotMatch(SOURCE, /from "@\/(lib\/booking|lib\/db|lib\/payments|server\/(?!public"))/);
  assert.doesNotMatch(SOURCE, /^import (?!type)[^;]*(?:-actions|-reads)";/m, "no core and no read is imported at run time");
});

test("it never refreshes the router after an action and never reads a session itself", () => {
  assert.doesNotMatch(SOURCE, /useRouter|router\.refresh|window\.location\.reload/);
  assert.doesNotMatch(SOURCE, /getSession|getFreshSession|authClient|useSession/);
});

test("the sign-in dialog is mounted only for a visitor canOfferCodeSignIn allows, and an unverified visitor gets the hint", () => {
  assert.match(SOURCE, /const canSignIn = canOfferCodeSignIn\(visitor\.state\);/);
  assert.match(SOURCE, /canSignIn && <HaveTicketsPrompt/);
  assert.equal(SOURCE.split("<OtpDialog").length - 1, 1, "the dialog is rendered in one place only");
  assert.match(SOURCE, /<OtpDialog open=\{open\} onClose=\{\(\) => setOpen\(false\)\} returnTo=\{p\.returnTo\} googleEnabled=\{p\.googleEnabled\} returnFocusTo=\{seanceHeading\} \/>/);
  assert.match(SOURCE, /unverified && <p[^>]*>\{COPY\.CONFIRM_EMAIL_TO_SPEND\}<\/p>/);
});

test("the actions receive the slug, the séance, the typed identity, the answers and the honeypot, never an identifier of a row", () => {
  assert.match(
    SOURCE,
    /registerFreeAction\(\{ slug: p\.slug, occurrenceId: p\.occurrenceId, seenStartsAt: p\.seenStartsAt, identity: identityToSend\(effective\), answers, website \}\)/,
  );
  assert.match(
    SOURCE,
    /bookWithHeldTicketAction\(\{ slug: p\.slug, occurrenceId: p\.occurrenceId, seenStartsAt: p\.seenStartsAt, answers \}\)/,
  );
  assert.doesNotMatch(SOURCE, /customerId|userId|professionalId|ownerUserId/);
});

test("every submit shows its pending label and is disabled while pending", () => {
  assert.match(SOURCE, /disabled=\{pending\}/);
  assert.match(SOURCE, /\{pending \? COPY\.PENDING_REGISTER : "S'inscrire"\}/);
  assert.match(SOURCE, /\{pending \? COPY\.PENDING_BOOK : heldTicketButtonLabel\(visitor\.leftAfter\)\}/);
  assert.match(SOURCE, /COPY\.REGISTERED/);
  assert.match(SOURCE, /COPY\.BOOKED_WITH_TICKET/);
});

test("success lines go to an always-mounted status region and failures to an always-mounted alert region", () => {
  assert.match(SOURCE, /<div role="status">\s*\{status && \(/);
  assert.match(SOURCE, /<FormError alwaysMounted message=\{error\} ref=\{errorBox\} tabIndex=\{-1\} \/>/, "the shared primitive, kept mounted (G4c)");
  assert.doesNotMatch(SOURCE, /role="alert"|bg-destructive/, "no alert and no class string of its own");
});

test("the three forms map a refusal through one hook: the line, the field errors of the fields and of the answers, the focus (G4c)", () => {
  const code = codeView(SOURCE);
  assert.equal(code.split("useRefusalFocus()").length - 1, 1, "the focus hook is called in one place");
  assert.equal(code.split("answerErrorsById(").length - 1, 1, "the mapping of the answers' errors is written once");
  assert.equal(code.split("= useRefusalState();").length - 1, 2, "the typed forms' hook and the held-ticket form call it");
  // The held-ticket form hands its refusal to it and keeps no state of its own for an error.
  const held = SOURCE.slice(SOURCE.indexOf("\nfunction HeldForm("), SOURCE.indexOf("\n/** Buy + book (E1)"));
  assert.match(held, /refuse\(res, answers\);/);
  assert.doesNotMatch(held, /useState<string \| null>|const \[errors?, setErrors?\]/, "no error state of its own");
});

test("a success that books the signed-in visitor gives the focus to the séance heading, which stays when the form goes (WCAG 2.4.3)", () => {
  assert.match(SOURCE, /return document\.getElementById\(SEANCE_HEADING_ID\);/);
  assert.match(SOURCE, /seanceHeading\(\)\?\.focus\(\);/);
  assert.match(SOURCE, /if \(emailLocked\) focusSeanceHeading\(\);\s*registered\.succeed\(!emailLocked\);/);
  assert.match(SOURCE, /focusSeanceHeading\(\);\s*booked\.succeed\(false\);/);
});

test("a failed call (network, deploy in between) becomes a message instead of an exception", () => {
  assert.match(SOURCE, /return \{ ok: false, error: PUBLIC_UNEXPECTED \};/);
  assert.match(SOURCE, /await call\(\(\) =>/);
});

test("it derives nothing from the browser clock: the séance start is the ISO string the server rendered", () => {
  assert.doesNotMatch(SOURCE, /new Date\(|Date\.now\(/);
  assert.match(SOURCE, /seenStartsAt: string;/);
});

test("every form posts, so a submit before hydration never writes the typed name, e-mail or phone into the URL", () => {
  // Server-rendered, a form with no method is a native GET of the current URL: the fields (name="name", "email",
  // "phone", "website") would land in the address bar, the history and the platform request logs.
  const forms = SOURCE.match(/<form\b[^>]*>/g) ?? [];
  assert.equal(forms.length, 3, "the free form, the held-ticket form and the buy form");
  for (const tag of forms) assert.match(tag, /^<form ref=\{root\} method="post" onSubmit=/, tag);
});
