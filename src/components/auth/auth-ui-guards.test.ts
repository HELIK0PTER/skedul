/**
 * Wiring guards for the two auth components Task 16 edits (the P3 pattern of
 * src/components/dashboard/final-review-ui.test.ts): the components are client
 * components, which the node:test runner cannot render.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string): string => readFileSync(path, "utf8");

test("both error lines of the Google link form are always-mounted alert regions (LED:405, UI rule)", () => {
  const form = source("src/components/auth/link-google-form.tsx");
  // One region per step (the Google step and the password step), rendered from the first render with `{error}` as its
  // only child: a live region inserted together with its text is not reliably announced. Empty, it is visually hidden
  // (sr-only, out of the layout) rather than absent.
  const regions = form.match(/<p\b[^>]*role="alert"[^>]*>[\s\S]*?<\/p>/g) ?? [];
  assert.equal(regions.length, 2, "the Google step and the password step");
  for (const region of regions) {
    assert.match(region, /className=\{error \? ERROR_CLASS : "sr-only"\}/, region);
    assert.match(region, />\s*\{error\}\s*<\/p>$/, "the text is the region's only child");
  }
  assert.doesNotMatch(form, /\{error && \(/, "no conditionally mounted error line");
  assert.match(form, /const ERROR_CLASS = "rounded-lg bg-destructive\/10 px-3 py-2 text-sm text-destructive";/);
  // The French mapping of P3 444f102 stays: never the English message of Better Auth.
  assert.match(form, /authFormErrorMessage\(result\.error\)/);
});

test("the Google link round trip keeps the page to come back to: /sign-in and /sign-up forward next, the link page and its form hand it back (AUTH-2)", () => {
  for (const page of ["src/app/(auth)/sign-in/page.tsx", "src/app/(auth)/sign-up/page.tsx"]) {
    const text = source(page);
    assert.match(text, /import \{ linkGoogleHref \} from "@\/lib\/public\/sign-in-flow";/, page);
    assert.match(text, /if \(error === "account_not_linked"\) redirect\(linkGoogleHref\(rawNext\)\);/, `${page}: the raw parameter goes through safeNextPath inside the helper`);
    assert.doesNotMatch(text, /redirect\("\/link-google"\)/, `${page}: no bare /link-google left`);
  }
  const linkPage = source("src/app/(auth)/link-google/page.tsx");
  assert.match(linkPage, /searchParams: Promise<\{ error\?: string \| string\[\]; next\?: string \| string\[\] \}>;/);
  assert.match(linkPage, /next=\{linkReturnPath\(next\)\}/, "the form gets a checked path, never the raw parameter");
  const form = source("src/components/auth/link-google-form.tsx");
  assert.match(form, /next\?: string \| null;/);
  assert.match(form, /const \{ callbackURL, errorCallbackURL \} = linkGoogleCallbacks\(next\);/);
  assert.match(form, /authClient\.linkSocial\(\{\s*provider: "google",\s*callbackURL,\s*errorCallbackURL,\s*\}\)/);
  assert.doesNotMatch(form, /callbackURL: "/, "no literal callback left");
  assert.doesNotMatch(form, /href="\/sign-in"/, "« Annuler » and « Continuer sans Google » keep next as well");
  assert.equal((form.match(/href=\{callbackURL\}/g) ?? []).length, 2);
});

test("the confirmation banner takes the neutral sentence from auth-messages, one source (CODE_SENT)", () => {
  const banner = source("src/components/dashboard/verify-email-banner.tsx");
  assert.match(banner, /import \{[^}]*\bCODE_SENT\b[^}]*\} from "@\/lib\/auth-messages";/);
  assert.doesNotMatch(banner, /const SENT\b/, "the private copy is gone");
  assert.doesNotMatch(banner, /Si l'adresse est valide/, "the sentence is spelled once, in auth-messages.ts");
  assert.equal((banner.match(/\{CODE_SENT\}/g) ?? []).length, 2, "the banner line and the dialog line");
});

test("the confirmation banner says it is busy: pending labels on both send buttons and on « Confirmer », the dialog's failure line always mounted (AUTH-3)", () => {
  const banner = source("src/components/dashboard/verify-email-banner.tsx");
  assert.match(banner, /import \{ COPY \} from "@\/lib\/public\/messages";/, "the one source of the pending labels");
  assert.match(banner, /\{sending \? COPY\.PENDING_SEND : sent \? "Saisir le code" : "Recevoir un code"\}/, "the banner button");
  assert.match(banner, /\{sending \? COPY\.PENDING_SEND : "Renvoyer le code"\}/, "the dialog's resend");
  assert.match(banner, /\{verifying \? COPY\.PENDING_VERIFY : "Confirmer"\}/, "the dialog's submit");
  // A live region inserted together with its text is not reliably announced: the dialog's region exists from its first render.
  assert.match(banner, /<FormError alwaysMounted message=\{dialogError\} ref=\{dialogErrorBox\} tabIndex=\{-1\} \/>/);
  const spinners = banner.match(/<Loader2\b[^>]*>/g) ?? [];
  assert.equal(spinners.length, 3);
  for (const spinner of spinners) assert.match(spinner, /aria-hidden/, spinner);
});

test("the sign-in and sign-up form says it is busy and announces its failure: pending labels, an always-mounted alert, silent spinners, still method=post (AUTH-4)", () => {
  const form = source("src/components/auth/auth-form.tsx");
  assert.match(form, /import \{ FormError \} from "@\/components\/dashboard\/form-error";/);
  assert.match(form, /import \{ COPY \} from "@\/lib\/public\/messages";/, "the one source of the pending labels");
  // A live region inserted together with its text is not reliably announced: the line exists from the first render.
  assert.match(form, /<FormError alwaysMounted message=\{error\} \/>/);
  assert.doesNotMatch(form, /\{error && \(/, "no conditionally mounted error line");
  assert.doesNotMatch(form, /role="alert"/, "the alert is FormError's, one style");
  assert.match(
    form,
    /\{loading \? \(isSignUp \? COPY\.PENDING_SIGN_UP : COPY\.PENDING_SIGN_IN\) : isSignUp \? "Créer mon compte" : "Se connecter"\}/,
    "the submit button",
  );
  const spinners = form.match(/<Loader2\b[^>]*>/g) ?? [];
  assert.equal(spinners.length, 2, "the Google button and the submit button");
  for (const spinner of spinners) assert.match(spinner, /aria-hidden/, spinner);
  // G4b: a form that holds an e-mail or a password never falls back to GET (the values would land in the URL).
  assert.match(form, /<form method="post" onSubmit=\{onSubmit\}/);
});

test("the reset link is logged only by a dev build without Resend, never by a production build (no token in logs)", () => {
  const auth = source("src/lib/auth.ts");
  assert.match(auth, /logResetLink: !env\.RESEND_ENABLED && process\.env\.NODE_ENV !== "production",/);
  assert.doesNotMatch(auth, /logResetLink: !env\.RESEND_ENABLED,/, "the unguarded form is gone");
});
