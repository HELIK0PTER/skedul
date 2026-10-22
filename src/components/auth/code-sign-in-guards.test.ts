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
  "src/components/auth/use-google-redirect.ts",
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

test("the code form never prefills or locks the address, the name or the code (Decision 7)", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  assert.doesNotMatch(form, /defaultValue|useSearchParams|document\.cookie|localStorage|sessionStorage|readOnly/);
  // Per field: the typed address, the name, the address the code went to and the code each start empty.
  for (const field of ["email", "name", "address", "code"]) {
    const setter = `set${field[0].toUpperCase()}${field.slice(1)}`;
    assert.match(form, new RegExp(`const \\[${field}, ${setter}\\] = useState\\(""\\);`), `${field} starts empty`);
  }
  // And no state starts from a value the page, a prop or a cookie supplied.
  const starts = [...form.matchAll(/useState(?:<[^>]*>)?\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(starts.length >= 4);
  for (const start of starts) assert.match(start, /^(""|null|false|0|"email")$/, `useState(${start}) starts from a literal`);
});

test("the code form keeps its submit out of any enclosing form and lets Enter reach the format message", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  for (const handler of ["onSend", "onVerify"]) {
    assert.match(
      form,
      new RegExp(
        `async function ${handler}\\(e: React\\.FormEvent<HTMLFormElement>\\) \\{\\s*e\\.preventDefault\\(\\);\\s*e\\.stopPropagation\\(\\);`,
      ),
      `${handler} stops the event as well as the default`,
    );
  }
  // The button is enabled as soon as the field holds something, so Enter with fewer than 6 digits reaches onVerify.
  assert.match(form, /disabled=\{busy \|\| code === ""\}/);
  assert.doesNotMatch(form, /disabled=\{[^}]*isCompleteCode/, "a short code is answered, not ignored");
  assert.match(form, /if \(!isCompleteCode\(code\)\) \{\s*setCodeError\(CODE_FORMAT\);/);
});

test("the name field stops at the length the verify step keeps", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  assert.match(form, /import \{ BOUNDS \} from "@\/lib\/tickets-vocab";/);
  assert.match(form, /id=\{`\$\{idPrefix\}-name`\}[\s\S]*?maxLength=\{BOUNDS\.name\}/);
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

test("the dialog is « Retrouver mes tickets » with the shared intro and the name field", () => {
  const dialog = source("src/components/auth/otp-dialog.tsx");
  assert.match(dialog, /title="Retrouver mes tickets"/);
  assert.match(dialog, /COPY\.CODE_INTRO/);
  assert.match(dialog, /<EmailCodeForm[^>]*\baskName\b/);
  assert.match(dialog, /onSignedIn=\{onClose\}/);
  assert.match(dialog, /<ClientSignInChoices/);
});

test("the dialog forwards an optional returnFocusTo to Dialog (a caller whose opener goes after sign-in names a heading)", () => {
  const dialog = source("src/components/auth/otp-dialog.tsx");
  assert.match(dialog, /returnFocusTo\?: \(\) => HTMLElement \| null;/);
  assert.match(dialog, /<Dialog[^>]*\breturnFocusTo=\{returnFocusTo\}/);
  assert.doesNotMatch(dialog, /returnFocusTo=\{\(\)/, "the dialog never picks the target itself");
});

test("the field ids are unique per dialog instance: the séance page mounts two", () => {
  const dialog = source("src/components/auth/otp-dialog.tsx");
  assert.doesNotMatch(dialog, /otp-dialog/, "no fixed id prefix");
  assert.match(dialog, /const fieldPrefix = useId\(\);/);
  assert.match(dialog, /idPrefix=\{fieldPrefix\}/);
  assert.match(dialog, /document\.getElementById\(`\$\{fieldPrefix\}-email`\)/, "the focus effect uses the generated id");
});

test("the three Google buttons share one redirect helper; none keeps its own pageshow reset or failure sentence", () => {
  const hook = source("src/components/auth/use-google-redirect.ts");
  assert.match(hook, /^"use client";/);
  assert.match(hook, /addEventListener\("pageshow"/);
  assert.match(hook, /e\.persisted/);
  assert.match(hook, /removeEventListener\("pageshow"/);
  assert.match(hook, /GOOGLE_FAILED/);
  for (const file of [
    "src/components/auth/auth-form.tsx",
    "src/components/auth/client-sign-in-choices.tsx",
    "src/components/auth/link-google-form.tsx",
  ]) {
    const text = source(file);
    assert.match(text, /from "@\/components\/auth\/use-google-redirect"/, file);
    assert.match(text, /\bredirect\(/, file);
    assert.doesNotMatch(text, /pageshow|PageTransitionEvent/, `${file}: the reset lives in the helper`);
    assert.doesNotMatch(text, /La connexion avec Google a échoué/, `${file}: the sentence lives in oauth-errors.ts`);
  }
  assert.equal(
    (source("src/lib/oauth-errors.ts").match(/La connexion avec Google a échoué\. Réessayez\./g) ?? []).length,
    1,
    "the sentence is spelled once",
  );
});

test("no dash and no console call in the files of Task 17 (S30, no raw error in a log)", () => {
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const file of FILES) {
    const text = source(file);
    assert.doesNotMatch(text, dash, file);
    assert.doesNotMatch(text, /console\./, file);
  }
});
