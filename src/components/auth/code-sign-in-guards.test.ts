/**
 * Wiring guards for the code sign-in components (the P3 pattern of
 * src/components/dashboard/final-review-ui.test.ts). The pure rules they call
 * have their own tests in src/lib/public/sign-in-flow.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openingTags, sourceFilesUnder } from "@/test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

const FILES = [
  "src/lib/public/sign-in-flow.ts",
  "src/components/auth/email-code-form.tsx",
  "src/components/auth/client-sign-in-choices.tsx",
  "src/components/auth/otp-dialog.tsx",
  "src/components/auth/use-google-redirect.ts",
  "src/components/auth/sign-in-status.tsx",
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

test("after a good code the inline form gives the focus to the page's heading and announces the sign-in, before the refresh unmounts it (AUTH-1, WCAG 2.4.3, 4.1.3)", () => {
  const form = source("src/components/auth/email-code-form.tsx");
  // An element id, not a function: the two pages that mount the form inline are Server Components.
  assert.match(form, /\n {2}focusAfterSignIn\?: string;/, "a serializable prop");
  assert.match(form, /import \{ announceSignIn \} from "@\/components\/auth\/sign-in-status";/);
  assert.match(
    form,
    /if \(focusAfterSignIn\) \{\s*document\.getElementById\(focusAfterSignIn\)\?\.focus\(\);\s*announceSignIn\(COPY\.SIGNED_IN\);\s*\}/,
    "the heading takes the focus and the page's status line says so, both only when the page names its heading",
  );
  const fresh = form.indexOf("authClient.getSession({ query: { disableCookieCache: true } })");
  const focus = form.indexOf("document.getElementById(focusAfterSignIn)?.focus();");
  const announce = form.indexOf("announceSignIn(COPY.SIGNED_IN);");
  const refresh = form.indexOf("router.refresh()");
  assert.ok(fresh !== -1 && focus > fresh && announce > fresh, "after the fresh session read");
  assert.ok(focus < refresh && announce < refresh, "before the refresh that swaps the form for the space");
  // The dialog path keeps its own focus rule (OtpDialog's onSignedIn and returnFocusTo).
  assert.ok(form.indexOf("onSignedIn?.();") > announce && form.indexOf("onSignedIn?.();") < refresh, "the dialog's callback stays where it was");
});

test("the sign-in status line is one always-mounted, screen-reader-only region fed by a module store (the ReleaseStatus pattern)", () => {
  const status = source("src/components/auth/sign-in-status.tsx");
  assert.match(status, /^"use client";/);
  assert.match(status, /import \{ createLineStore \} from "@\/lib\/public\/release-line";/);
  assert.match(status, /\nconst store = createLineStore\(\);/, "module state: it outlives the form that writes it");
  assert.match(status, /export function announceSignIn\(text: string\): void \{\s*store\.set\(text\);\s*\}/);
  assert.match(status, /useSyncExternalStore\(store\.subscribe, store\.get, \(\) => ""\)/);
  assert.match(status, /useEffect\(\(\) => \{\s*store\.set\(""\);\s*return \(\) => store\.set\(""\);\s*\}, \[\]\);/, "it starts and ends empty");
  assert.match(status, /return <p role="status" className="sr-only">\{text\}<\/p>;/);
});

test("every EmailCodeForm says where the focus goes after a sign-in: the dialog's callback, or a page heading with tabIndex -1 and the page's one status line (AUTH-1)", () => {
  const tsx = sourceFilesUnder("src").filter((file) => file.endsWith(".tsx"));
  const mounts = tsx.flatMap((file) => openingTags(source(file), "EmailCodeForm").map((tag) => ({ file, tag })));
  assert.ok(mounts.length >= 3, "the dialog and the two inline pages");
  const pages = new Set<string>();
  for (const { file, tag } of mounts) {
    // The attribute is read at the top level of the tag (topLevel keeps its braces, not what they hold), its value from the text.
    const target = /\sfocusAfterSignIn=\{\}/.test(tag.topLevel) ? /\sfocusAfterSignIn=\{([A-Z_]+)\}/.exec(tag.text) : null;
    assert.ok(target || /\sonSignedIn=\{\}/.test(tag.topLevel), `${file}: <EmailCodeForm> names no focus target`);
    if (!target) continue;
    pages.add(file);
    const page = source(file);
    assert.match(page, new RegExp(`\\sid=\\{${target[1]}\\}\\s+tabIndex=\\{-1\\}`), `${file}: the target is focusable from script only`);
    assert.equal((page.match(/<SignInStatus \/>/g) ?? []).length, 1, `${file}: one status line`);
    assert.match(page, /import \{ SignInStatus \} from "@\/components\/auth\/sign-in-status";/, file);
  }
  assert.deepEqual([...pages].sort(), ["src/app/[slug]/espace/page.tsx", "src/app/mon-espace/page.tsx"]);
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
  assert.match(dialog, /<EmailCodeForm[^>]*\bonSignedIn=\{signedInThenClose\}/);
  assert.match(dialog, /<ClientSignInChoices/);
});

test("the dialog hands the focus to the caller's target after a sign-in only, to the opener otherwise (WCAG 2.4.3)", () => {
  const dialog = source("src/components/auth/otp-dialog.tsx");
  assert.match(dialog, /returnFocusTo\?: \(\) => HTMLElement \| null;/);
  // The sign-in is recorded in a ref, before the dialog closes: Dialog reads the target in the cleanup of the render
  // that closes it, a closure that would still hold a state value of the render before.
  assert.match(dialog, /const signedIn = useRef\(false\);/);
  assert.match(dialog, /function signedInThenClose\(\) \{\s*signedIn\.current = true;\s*onClose\(\);\s*\}/);
  assert.match(dialog, /useEffect\(\(\) => \{\s*if \(open\) signedIn\.current = false;\s*\}, \[open\]\);/, "a new opening starts without a sign-in");
  assert.match(dialog, /const focusAfterClose = useCallback\(\(\) => focusTargetOnClose\(signedIn\.current, returnFocusTo\), \[returnFocusTo\]\);/);
  assert.match(dialog, /<Dialog[^>]*\breturnFocusTo=\{focusAfterClose\}/);
  assert.doesNotMatch(dialog, /returnFocusTo=\{returnFocusTo\}/, "the caller's target is never handed over unconditionally");
  assert.doesNotMatch(dialog, /useState\(.*signedIn|setSignedIn/, "a state would be read stale by the closing render");
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
