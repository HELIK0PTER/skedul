/**
 * Wiring guards for the payment-return components (P4 Task 28). Both are client components that import a Server Action
 * (which imports server-only modules), and the node:test runner cannot load those, so what they must keep is pinned on
 * their source: the decisions behind the texts (who may release what, the state of a purchase) have their own tests in
 * release-actions.db.test.ts, visibility.test.ts and seance-reads.db.test.ts. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RETURN = readFileSync("src/components/public/checkout-return.tsx", "utf8");
const HOLDS = readFileSync("src/components/public/pending-holds.tsx", "utf8");
/** What the block says and derives (G4c): a pure module, tested by checkout-return-view.test.ts; its source is read for the contract's sentences. */
const VIEW = readFileSync("src/lib/public/checkout-return-view.ts", "utf8");
/** The page-level status region a release speaks through (G4c): always mounted on the séance page, so it survives the revalidation that removes the block. */
const STATUS = readFileSync("src/components/public/release-status.tsx", "utf8");

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("both components are client components that post a slug and a purchase id and nothing about an identity", () => {
  assert.match(RETURN, /^"use client";/);
  assert.match(HOLDS, /^"use client";/);
  assert.match(RETURN, /abandonCheckoutAction\(\{ slug, purchaseId \}\)/);
  assert.match(HOLDS, /abandonCheckoutAction\(\{ slug, purchaseId: hold\.purchaseId \}\)/);
  for (const source of [RETURN, HOLDS]) {
    assert.doesNotMatch(source, /customerId|ownerUserId|userId/, "no identity in a payment-return component");
  }
});

test("every sentence of the contract is in the source of the block or of its pure module", () => {
  for (const text of [
    "Libérer votre place ?",
    "La place est rendue aux autres clients et le paiement en cours est annulé.",
    "Libérer ma place",
    "Libérer votre créneau ?",
    "Le créneau est rendu aux autres clients et le paiement en cours est annulé.",
    "Libérer mon créneau",
    "Reprendre le paiement",
    "Voir la confirmation",
  ]) {
    assert.ok(RETURN.includes(text), `checkout-return.tsx lacks: ${text}`);
  }
  for (const text of [
    "Paiement interrompu",
    "Votre paiement",
    "Votre place est libérée.",
    "Cette réservation n'est plus en attente de paiement.",
    "Votre place a été libérée. Vous pouvez réserver à nouveau.",
    "Ce paiement n'a pas abouti.",
    "Votre achat n'est pas payé.",
    "La page de paiement a expiré. Vous pouvez libérer votre place maintenant.",
    "Votre place est gardée jusqu'à",
    "Votre créneau est libéré.",
    "Votre créneau a été libéré. Vous pouvez réserver à nouveau.",
    "La page de paiement a expiré. Vous pouvez libérer votre créneau maintenant.",
    "Votre créneau est gardé jusqu'à",
    "COPY.PAYMENT_RECEIVED",
    "COPY.PROCESSING",
  ]) {
    assert.ok(VIEW.includes(text), `checkout-return-view.ts lacks: ${text}`);
  }
  for (const text of [
    "COPY.PENDING_HOLDS_TITLE",
    "Place gardée jusqu'à",
    "Créneau gardé jusqu'à",
    "RELEASE_CONFIRM.confirm",
    "RDV_RELEASE_CONFIRM.confirm",
    "copy={target?.isRdv ? RDV_RELEASE_CONFIRM : RELEASE_CONFIRM}",
    "releaseOutcomeText(",
  ]) {
    assert.ok(HOLDS.includes(text), `pending-holds.tsx lacks: ${text}`);
  }
});

test("the release is confirmed first and a success ends on a heading that stays (WCAG 2.4.3)", () => {
  for (const source of [RETURN, HOLDS]) {
    assert.match(source, /<ConfirmDialog[\s\S]*?returnFocusTo=\{returnFocus\}/);
    assert.match(source, /tabIndex=\{-1\}/, "the heading can take the focus");
    assert.equal(source.split("opener.current = ").length - 1, 2, "two writes: the button that opens the dialog, then the heading");
  }
  // PendingHolds stays mounted after a release, so its own heading is the target. The block may be removed by the
  // revalidation (the Owner's own pending purchase is gone once released): it hands the focus to the séance heading, which
  // the page always renders, and falls back to its own heading where the page has none (G4c).
  assert.match(HOLDS, /opener\.current = heading\.current;/, "a success points the dialog's focus restore at the heading");
  assert.match(RETURN, /opener\.current = afterReleaseTarget\(heading\.current\);/);
  assert.match(
    RETURN,
    /function afterReleaseTarget\(own: HTMLElement \| null\): HTMLElement \| null \{\s*return document\.getElementById\(SEANCE_HEADING_ID\) \?\? document\.getElementById\(RDV_HEADING_ID\) \?\? own;\s*\}/,
  );
  assert.match(RETURN, /import \{[^}]*\bSEANCE_HEADING_ID\b[^}]*\} from "@\/lib\/public\/seance-copy";/);
  assert.match(RETURN, /import \{ RDV_HEADING_ID \} from "@\/lib\/public-anchors";/, "the RDV page heading, P5");
  // The button that opened the dialog, written by the click handler itself (G4b: a bare « opener.current = » matched any write).
  assert.match(RETURN, /function ask\(e: React\.MouseEvent<HTMLButtonElement>\) \{\s*opener\.current = e\.currentTarget;/);
  assert.match(RETURN, /onClick=\{ask\}/);
  assert.match(HOLDS, /function ask\(hold: PendingHold, button: HTMLButtonElement\) \{\s*opener\.current = button;/);
  assert.match(HOLDS, /onClick=\{\(e\) => ask\(h, e\.currentTarget\)\}/);
  assert.match(RETURN, /RELEASE_CONFIRM/);
  assert.match(RETURN, /onConfirm=\{release\}/);
});

test("the block's heading follows its view, and its status line is the page's, not its own (G4c)", () => {
  assert.match(RETURN, /\{returnHeadingOf\(view\)\}\s*<\/h2>/);
  assert.doesNotMatch(RETURN, /Paiement interrompu/, "the heading text is the module's");
  assert.doesNotMatch(RETURN, /role="status"/, "one live region per release: the page-level one, which survives the block");
  assert.match(RETURN, /<div className="space-y-1 text-sm">\s*\{text !== null && <p>\{text\}<\/p>\}\s*<\/div>/);
});

test("a release speaks through the page-level region, even when the revalidation removed the block before the answer came back (G4c)", () => {
  // The line is emptied at the start of each release (the `announce(null)` rule of CancelBookingButton): two releases in a
  // row say the same sentence, and a region whose text did not change announces nothing.
  assert.match(RETURN, /setError\(null\);\s*announceRelease\(""\);\s*startTransition\(async \(\) => \{/);
  assert.match(RETURN, /announceRelease\(releaseOutcomeText\(res\.outcome, kind\)\);/);
  assert.match(RETURN, /import \{ announceRelease \} from "@\/components\/public\/release-status";/);
  // The answer can arrive after the block went (the Server Action applies the new page first): then nothing restores the
  // focus the dialog held, so the component does, once, and only then.
  assert.match(RETURN, /const alive = useRef\(true\);/);
  assert.match(RETURN, /useEffect\(\(\) => \{\s*alive\.current = true;\s*return \(\) => \{\s*alive\.current = false;\s*\};\s*\}, \[\]\);/);
  assert.match(RETURN, /if \(!alive\.current\) opener\.current\?\.focus\(\);/);
});

test("the release status region is one always-mounted status line that clears itself, and only the blocks speak through it (G4c)", () => {
  assert.match(STATUS, /^"use client";/);
  assert.match(STATUS, /<p role="status" className="sr-only">\{text\}<\/p>/, "always rendered, read by screen readers only (the notice above the form is the visible line)");
  // Always in the DOM, even for an empty text: a live region that is inserted together with its text is announced by few
  // screen readers (WCAG 4.1.3). The markup above is also found inside a `text === "" ? null : <p ...>`, so the component's
  // return is pinned on its own line and no early return or null branch may precede it.
  const regionAt = STATUS.indexOf("export function ReleaseStatus() {");
  assert.notEqual(regionAt, -1, "ReleaseStatus is found");
  const region = STATUS.slice(regionAt);
  assert.match(region, /^ {2}return <p role="status" className="sr-only">\{text\}<\/p>;\r?$/m, "the component's one return, with no condition around the region");
  assert.doesNotMatch(region, /\breturn (?:null|undefined)\b|\breturn;|\? null\b|&& <p\b/, "no early return, no null branch");
  assert.match(STATUS, /useSyncExternalStore\(store\.subscribe, store\.get, \(\) => ""\)/);
  assert.match(STATUS, /export function announceRelease\(text: string\): void \{\s*store\.set\(text\);\s*\}/);
  // A stale line from an earlier page never shows on the next: it is cleared when the region mounts and when it goes.
  assert.match(STATUS, /useEffect\(\(\) => \{\s*store\.set\(""\);\s*return \(\) => store\.set\(""\);\s*\}, \[\]\);/);
  for (const source of [STATUS]) {
    assert.doesNotMatch(source, DASH);
    assert.doesNotMatch(source, /console\./);
  }
});

test("the components never touch the router, never log and never mention an address", () => {
  for (const source of [RETURN, HOLDS]) {
    assert.doesNotMatch(source, /useRouter|router\.refresh|router\.push/);
    assert.doesNotMatch(source, /console\./);
    assert.doesNotMatch(source, /e-?mail/i);
  }
});

test("« Reprendre le paiement » is a plain link to the Checkout URL, never a prefetching Link", () => {
  assert.match(RETURN, /<a href=\{resumeUrl\}>Reprendre le paiement<\/a>/);
  assert.doesNotMatch(RETURN, /<Link href=\{resumeUrl\}/);
  assert.match(RETURN, /resumeUrl !== null && \(/, "only while the session is open (Decision 31)");
});

test("a shop purchase can only be resumed, never released (Decision 13); a séance or an RDV hold can, each in its own words (P5 T10)", () => {
  assert.match(RETURN, /const canRelease = kind !== "shop";/);
  assert.match(RETURN, /\{canRelease && \(/);
  assert.match(RETURN, /const confirmCopy = kind === "rdv" \? RDV_RELEASE_CONFIRM : RELEASE_CONFIRM;/);
  assert.match(RETURN, /onClick=\{ask\} disabled=\{pending\}>\s*\{confirmCopy\.confirm\}\s*<\/Button>/);
  assert.match(RETURN, /copy=\{confirmCopy\}/);
});

test("read-only (an impersonating admin, G4b): no « Reprendre le paiement », no « Libérer ma place », one sentence that says why", () => {
  assert.match(RETURN, /\}: CheckoutReturnProps\) \{/, "the props are the module's type (G4c)");
  const propsAt = VIEW.indexOf("export type CheckoutReturnProps = {");
  const props = VIEW.slice(propsAt, VIEW.indexOf("};", propsAt));
  assert.match(props, /^\s*readOnly: boolean;\r?$/m, "a required prop: every page decides it");
  assert.equal((RETURN.match(/\{view === "pending" && /g) ?? []).length, 2, "the two pending blocks: the buttons and the read-only line");
  assert.match(RETURN, /\{view === "pending" && !readOnly && \(\s*<div className="flex flex-col gap-2 sm:flex-row">/, "the buttons only when not read-only");
  assert.match(RETURN, /\{view === "pending" && readOnly && <p className="text-sm text-zinc-600">\{READ_ONLY_TEXT\}<\/p>\}/);
  assert.match(
    VIEW,
    /export const READ_ONLY_TEXT = "Ce paiement ne peut être ni repris ni libéré quand vous êtes connecté en tant que ce compte\.";/,
  );
  assert.match(RETURN, /READ_ONLY_TEXT/);
  // The page passes no resumeUrl when read-only: the sentence that invites a release must not show instead (a unit case in checkout-return-view.test.ts).
  assert.match(VIEW, /if \(a\.resumeUrl === null && !a\.readOnly\) \{\s*return rdv\s*\? "La page de paiement a expiré\. Vous pouvez libérer votre créneau maintenant\."\s*: "La page de paiement a expiré\. Vous pouvez libérer votre place maintenant\.";/);
  assert.match(RETURN, /returnTextOf\(\{ view, kind, resumeUrl, holdUntilLabel, readOnly \}\)/);
});

test("PendingHolds empties its line before each release, so two releases in a row are both announced (G4c)", () => {
  const at = HOLDS.indexOf("function release()");
  const run = HOLDS.indexOf("startTransition(async", at);
  assert.ok(at !== -1 && run > at, "release() is found");
  const start = HOLDS.slice(at, run);
  assert.match(start, /setNotice\(""\);/, "the previous line goes before the await");
  assert.ok(HOLDS.indexOf("setNotice(releaseOutcomeText(") > run, "and the new one is set after it");
});

test("PendingHolds renders nothing without a hold and without a line, and keeps its heading while a line shows", () => {
  assert.match(HOLDS, /if \(rows\.length === 0 && notice === ""\) return null;/);
  assert.match(HOLDS, /const rows = holds\.filter\(\(h\) => !gone\.includes\(h\.purchaseId\)\);/);
  assert.match(HOLDS, /setNotice\(releaseOutcomeText\(res\.outcome, hold\.isRdv \? "rdv" : "buybook"\)\);/);
});

test("the live regions are always mounted", () => {
  assert.match(HOLDS, /<p role="status" className=\{notice \? "[^"]*" : "sr-only"\}>/);
});

test("no dash and no brand-coloured text in the two components and their module", () => {
  for (const source of [RETURN, HOLDS, VIEW]) {
    assert.doesNotMatch(source, DASH);
    assert.doesNotMatch(source, /text-primary([^-a-zA-Z]|$)/);
  }
});
