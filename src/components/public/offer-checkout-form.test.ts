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
  assert.match(SOURCE, /startShopPurchaseAction\(\{ slug, offerId, identity: identityToSend\(effective\), website \}\)/);
  assert.doesNotMatch(SOURCE, /customerId|ownerUserId|userId|priceCents|amountCents/, "no identity, no price from the browser");
  assert.doesNotMatch(SOURCE, /^import (?!type)[^;]*(?:-actions|-reads)";/m, "no core and no read is imported at run time");
});

test("an identity the server would refuse is said under its field before any call", () => {
  const check = SOURCE.indexOf("const local = identityErrors(effective);");
  assert.notEqual(check, -1);
  assert.ok(check < SOURCE.indexOf("startShopPurchaseAction({"), "the local check comes first");
  assert.match(SOURCE, /if \(Object\.keys\(local\)\.length > 0\) \{\s*refused\(\);\s*return;\s*\}/);
});

test("a success leaves for the Checkout URL with a full navigation and keeps the button disabled", () => {
  assert.match(SOURCE, /setRedirecting\(true\);\s*window\.location\.assign\(target\);\s*return;/);
  assert.doesNotMatch(SOURCE, /useRouter|router\.(refresh|push|replace)/, "navigation after a Server Action is window.location.assign alone");
  assert.match(SOURCE, /const busy = pending \|\| redirecting;/);
  assert.match(SOURCE, /disabled=\{busy\}/);
});

test("the browser leaves only for a Checkout URL safeCheckoutUrl accepts; any other URL gets the refusal of the séance page (P4 final review PAY-2)", () => {
  assert.match(SOURCE, /^import \{ safeCheckoutUrl \} from "@\/lib\/public\/buy-and-book-form";$/m, "the séance page's own check");
  assert.match(
    SOURCE,
    /const target = safeCheckoutUrl\(res\.checkoutUrl, window\.location\.origin\);\s*if \(target !== null\) \{\s*setRedirecting\(true\);\s*window\.location\.assign\(target\);\s*return;\s*\}\s*setFormError\(COPY\.CHECKOUT_FAILED\);\s*refused\(\);/,
    "an unsafe URL never leaves the page: the same COPY.CHECKOUT_FAILED as occurrence-booking.tsx, on the alert line",
  );
  assert.equal(SOURCE.split("window.location.assign(").length - 1, 1, "one navigation, to the checked URL");
  assert.equal(SOURCE.split("res.checkoutUrl").length - 1, 1, "the raw URL reaches the check only");
  assert.doesNotMatch(SOURCE, /location\.href\s*=|location\s*=|location\.replace\(|window\.open\(/, "no other way out");
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

test("the session's e-mail replaces whatever was typed once the session turns verified under the mounted form (review round 1)", () => {
  assert.match(
    SOURCE,
    /const effective: IdentityInput = emailLocked && visitor\.email !== null \? \{ \.\.\.identity, email: visitor\.email \} : identity;/,
    "the same override as the typed forms of the séance page",
  );
  assert.match(SOURCE, /value=\{effective\}/);
  assert.equal(SOURCE.split("useState<IdentityInput>").length - 1, 1, "one identity state");
  assert.equal(SOURCE.split("identityErrors(effective)").length - 1, 1, "one browser-side check of the identity");
  assert.doesNotMatch(
    SOURCE,
    /identityErrors\(identity\)|identityToSend\(identity\)|value=\{identity\}/,
    "the typed state alone reaches neither a check, nor a call, nor a field",
  );
});

test("the test-payments banner shows above the fields whenever a test mode runs, and the form posts (no identity in a URL before hydration) and lets the server speak French", () => {
  assert.match(SOURCE, /\{testMode && <TestPaymentsBanner mode=\{testMode\} \/>\}/);
  assert.match(SOURCE, /<form ref=\{root\} method="post" onSubmit=\{onSubmit\} noValidate /);
  assert.match(SOURCE, /<IdentityFields[\s\S]*?website=\{website\}[\s\S]*?onWebsite=\{setWebsite\}/);
});

test("a failure goes to an always-mounted alert line, unless an identity field owns the refusal, and the focus follows", () => {
  assert.match(SOURCE, /const \{ root, errorBox, refused \} = useRefusalFocus\(\);/);
  assert.match(SOURCE, /<FormError alwaysMounted message=\{formError\} ref=\{errorBox\} tabIndex=\{-1\} \/>/);
  assert.doesNotMatch(SOURCE, /ERROR_CLASS|role="alert"/, "the line is the shared primitive's: no class string and no alert of its own (G4c)");
  assert.match(SOURCE, /Object\.keys\(fields\)\.some\(\(key\) => key\.startsWith\("identity\."\)\)/);
  assert.match(SOURCE, /setFormError\(PUBLIC_UNEXPECTED\);\s*refused\(\);/);
  assert.equal(SOURCE.split("refused();").length - 1, 4, "the local check, a server refusal, an unsafe Checkout URL and a failed call");
});

test("no dash, no brand-coloured text and no address in the logs", () => {
  assert.doesNotMatch(SOURCE, DASH);
  assert.doesNotMatch(SOURCE, /text-primary([^-a-zA-Z]|$)/);
  assert.doesNotMatch(SOURCE, /console\./);
});
