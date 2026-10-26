/**
 * Wiring guard for src/components/public/offer-checkout-form.tsx (P4 Task 29). The form is a client component that imports
 * a Server Action (which imports server-only modules), and the node:test runner cannot load those, so the rules it must
 * keep are pinned on its source: what the action accepts has its own DB tests (shop-actions.db.test.ts). Run from the
 * repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/public/offer-checkout-form.tsx", "utf8");

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("the form posts the slug, the offer id, the typed identity and the honeypot, and nothing else", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /startShopPurchaseAction\(\{ slug, offerId, identity: identityToSend\(identity\), website \}\)/);
  assert.doesNotMatch(SOURCE, /customerId|ownerUserId|userId|priceCents|amountCents/, "no identity, no price from the browser");
  assert.doesNotMatch(SOURCE, /^import (?!type)[^;]*(?:-actions|-reads)";/m, "no core and no read is imported at run time");
});

test("an identity the server would refuse is said under its field before any call", () => {
  const check = SOURCE.indexOf("const local = identityErrors(identity);");
  assert.notEqual(check, -1);
  assert.ok(check < SOURCE.indexOf("startShopPurchaseAction({"), "the local check comes first");
  assert.match(SOURCE, /if \(Object\.keys\(local\)\.length > 0\) \{\s*refused\(\);\s*return;\s*\}/);
});

test("a success leaves for the Checkout URL with a full navigation and keeps the button disabled", () => {
  assert.match(SOURCE, /setRedirecting\(true\);\s*window\.location\.assign\(res\.checkoutUrl\);/);
  assert.doesNotMatch(SOURCE, /useRouter|router\.(refresh|push|replace)/, "navigation after a Server Action is window.location.assign alone");
  assert.match(SOURCE, /const busy = pending \|\| redirecting;/);
  assert.match(SOURCE, /disabled=\{busy\}/);
});

test("a page restored from the back/forward cache leaves the redirecting state", () => {
  assert.match(SOURCE, /window\.addEventListener\("pageshow", onShow\)/);
  assert.match(SOURCE, /if \(event\.persisted\) setRedirecting\(false\);/);
  assert.match(SOURCE, /window\.removeEventListener\("pageshow", onShow\)/);
});

test("the submit shows the price, then the pending label", () => {
  assert.match(SOURCE, /\{busy \? COPY\.PENDING_PAY : `Payer \$\{priceLabel\}`\}/);
});

test("only a verified session locks the e-mail field and only the session e-mail fills it", () => {
  assert.match(SOURCE, /const emailLocked = visitor\.state === "verified" && visitor\.email !== null;/);
  assert.match(SOURCE, /email: emailLocked \? \(visitor\.email \?\? ""\) : ""/);
  assert.match(SOURCE, /emailLocked=\{emailLocked\}/);
});

test("the test-payments banner shows above the fields whenever a test mode runs, and the form posts (no identity in a URL before hydration) and lets the server speak French", () => {
  assert.match(SOURCE, /\{testMode && <TestPaymentsBanner mode=\{testMode\} \/>\}/);
  assert.match(SOURCE, /<form ref=\{root\} method="post" onSubmit=\{onSubmit\} noValidate /);
  assert.match(SOURCE, /<IdentityFields[\s\S]*?website=\{website\}[\s\S]*?onWebsite=\{setWebsite\}/);
});

test("a failure goes to an always-mounted alert line, unless an identity field owns the refusal, and the focus follows", () => {
  assert.match(SOURCE, /const \{ root, errorBox, refused \} = useRefusalFocus\(\);/);
  assert.match(SOURCE, /<p role="alert" ref=\{errorBox\} tabIndex=\{-1\} className=\{formError \? ERROR_CLASS : "sr-only"\}>/);
  assert.match(SOURCE, /Object\.keys\(fields\)\.some\(\(key\) => key\.startsWith\("identity\."\)\)/);
  assert.match(SOURCE, /setFormError\(PUBLIC_UNEXPECTED\);\s*refused\(\);/);
  assert.equal(SOURCE.split("refused();").length - 1, 3, "the local check, a server refusal and a failed call");
});

test("no dash, no brand-coloured text and no address in the logs", () => {
  assert.doesNotMatch(SOURCE, DASH);
  assert.doesNotMatch(SOURCE, /text-primary([^-a-zA-Z]|$)/);
  assert.doesNotMatch(SOURCE, /console\./);
});
