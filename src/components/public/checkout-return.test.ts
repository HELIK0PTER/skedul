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

test("every sentence of the contract is in the source of the block", () => {
  for (const text of [
    "Paiement interrompu",
    "Libérer votre place ?",
    "La place est rendue aux autres clients et le paiement en cours est annulé.",
    "Libérer ma place",
    "Votre place est libérée.",
    "Cette réservation n'est plus en attente de paiement.",
    "Votre place a été libérée. Vous pouvez réserver à nouveau.",
    "Ce paiement n'a pas abouti.",
    "Votre achat n'est pas payé.",
    "La page de paiement a expiré. Vous pouvez libérer votre place maintenant.",
    "Votre place est gardée jusqu'à",
    "Reprendre le paiement",
    "Voir la confirmation",
    "COPY.PAYMENT_RECEIVED",
    "COPY.PROCESSING",
  ]) {
    assert.ok(RETURN.includes(text), `checkout-return.tsx lacks: ${text}`);
  }
  for (const text of ["COPY.PENDING_HOLDS_TITLE", "Place gardée jusqu'à", "Libérer ma place", "RELEASE_CONFIRM", "releaseOutcomeText("]) {
    assert.ok(HOLDS.includes(text), `pending-holds.tsx lacks: ${text}`);
  }
});

test("the release is confirmed first and a success ends on the block heading (WCAG 2.4.3)", () => {
  for (const source of [RETURN, HOLDS]) {
    assert.match(source, /<ConfirmDialog[\s\S]*?returnFocusTo=\{returnFocus\}/);
    assert.match(source, /tabIndex=\{-1\}/, "the heading can take the focus");
    assert.match(source, /opener\.current = heading\.current;/, "a success points the dialog's focus restore at the heading");
    assert.match(source, /opener\.current = /, "the opener is written in an event handler");
  }
  assert.match(RETURN, /RELEASE_CONFIRM/);
  assert.match(RETURN, /onConfirm=\{release\}/);
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

test("a shop purchase can only be resumed, never released (Decision 13)", () => {
  assert.match(RETURN, /const canRelease = kind === "buybook";/);
  assert.match(RETURN, /\{canRelease && \(/);
});

test("PendingHolds renders nothing without a hold and without a line, and keeps its heading while a line shows", () => {
  assert.match(HOLDS, /if \(rows\.length === 0 && notice === ""\) return null;/);
  assert.match(HOLDS, /const rows = holds\.filter\(\(h\) => !gone\.includes\(h\.purchaseId\)\);/);
  assert.match(HOLDS, /setNotice\(releaseOutcomeText\(res\.outcome\)\);/);
});

test("the live regions are always mounted", () => {
  assert.match(RETURN, /<div role="status" className="[^"]*">/);
  assert.match(HOLDS, /<p role="status" className=\{notice \? "[^"]*" : "sr-only"\}>/);
});

test("no dash and no brand-coloured text in the two components", () => {
  for (const source of [RETURN, HOLDS]) {
    assert.doesNotMatch(source, DASH);
    assert.doesNotMatch(source, /text-primary([^-a-zA-Z]|$)/);
  }
});
