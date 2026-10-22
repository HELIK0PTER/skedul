/**
 * Wiring guards for the code sign-in components (the P3 pattern of
 * src/components/dashboard/final-review-ui.test.ts). The pure rules they call
 * have their own tests in src/lib/public/sign-in-flow.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string): string => readFileSync(path, "utf8");

const FILES = [
  "src/lib/public/sign-in-flow.ts",
  "src/components/auth/email-code-form.tsx",
  "src/components/auth/client-sign-in-choices.tsx",
  "src/components/auth/otp-dialog.tsx",
];

test("the code form reads a fresh session before it refreshes the page, and refreshes once (L1314-1315)", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  const fresh = form.indexOf("authClient.getSession({ query: { disableCookieCache: true } })");
  const refresh = form.indexOf("router.refresh()");
  assert.notEqual(fresh, -1, "the cookie cache is bypassed");
  assert.notEqual(refresh, -1);
  assert.ok(fresh < refresh, "the fresh read comes first");
  assert.equal(form.split("router.refresh()").length - 1, 1, "one refresh");
  assert.doesNotMatch(form, /router\.push/, "no navigation: the page re-renders as signed in");
});

test("the code form answers every send with the neutral sentence unless the send was limited or failed (S22)", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  assert.match(form, /import \{[^}]*\bCODE_SENT\b[^}]*\} from "@\/lib\/auth-messages"/);
  assert.match(form, /sendCodeFailure\(res\.error\)/);
  assert.match(form, /setStatus\(CODE_SENT\)/);
  assert.match(form, /verifyCodeFailure\(res\.error\)/);
  assert.match(form, /type: "sign-in"/, "the sign-in code, never a confirmation code");
  assert.doesNotMatch(form, /type: "email-verification"/);
});

test("the code form never prefills or locks the address (Decision 7)", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  assert.doesNotMatch(form, /defaultValue|useSearchParams|document\.cookie|localStorage|sessionStorage|readOnly/);
  assert.match(form, /useState\(""\)/, "the fields start empty");
});

test("the Google button and the password link both go through returnPathOf (SEC-M7)", () => {
  const choices = source("src/components/auth/client-sign-in-choices.tsx");
  assert.match(choices, /returnPathOf\(returnTo\)/);
  assert.match(choices, /googleCallbacks\(/);
  assert.match(choices, /passwordSignInHref\(/);
  assert.doesNotMatch(choices, /callbackURL:|newUserCallbackURL:|errorCallbackURL:/, "the callbacks have one source");
  assert.match(choices, /COPY\.PASSWORD_LINK/);
  assert.match(choices, /COPY\.GOOGLE/);
});

test("the dialog is « Retrouver mes tickets » with the shared intro, the name field and no focus override", () => {
  const dialog = source("src/components/auth/otp-dialog.tsx");
  assert.match(dialog, /title="Retrouver mes tickets"/);
  assert.match(dialog, /COPY\.CODE_INTRO/);
  assert.match(dialog, /<EmailCodeForm[^>]*\baskName\b/);
  assert.match(dialog, /onSignedIn=\{onClose\}/);
  assert.match(dialog, /<ClientSignInChoices/);
  assert.doesNotMatch(dialog, /returnFocusTo/, "the opener stays on the page and gets the focus back");
});

test("no dash and no console call in the files of Task 17 (S30, no raw error in a log)", () => {
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const file of FILES) {
    const text = source(file);
    assert.doesNotMatch(text, dash, file);
    assert.doesNotMatch(text, /console\./, file);
  }
});
