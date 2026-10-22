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

test("the confirmation banner takes the neutral sentence from auth-messages, one source (CODE_SENT)", () => {
  const banner = source("src/components/dashboard/verify-email-banner.tsx");
  assert.match(banner, /import \{[^}]*\bCODE_SENT\b[^}]*\} from "@\/lib\/auth-messages";/);
  assert.doesNotMatch(banner, /const SENT\b/, "the private copy is gone");
  assert.doesNotMatch(banner, /Si l'adresse est valide/, "the sentence is spelled once, in auth-messages.ts");
  assert.equal((banner.match(/\{CODE_SENT\}/g) ?? []).length, 2, "the banner line and the dialog line");
});

test("the reset link is logged only by a dev build without Resend, never by a production build (no token in logs)", () => {
  const auth = source("src/lib/auth.ts");
  assert.match(auth, /logResetLink: !env\.RESEND_ENABLED && process\.env\.NODE_ENV !== "production",/);
  assert.doesNotMatch(auth, /logResetLink: !env\.RESEND_ENABLED,/, "the unguarded form is gone");
});
