/**
 * Wiring guards for the client espace page (src/app/[slug]/espace/page.tsx). The page reads the session and the cookie
 * and renders client leaves, which node:test cannot load, so what it must keep is pinned on its source. Task 22 of the
 * P4 plan extends this file with the guards of the espace leaves. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PAGE = readFileSync("src/app/[slug]/espace/page.tsx", "utf8");

test("« Confirmez votre adresse pour voir vos réservations. » is shown only when no space is rendered, never above the reservations of the personal link (Revision 3.2)", () => {
  assert.equal((PAGE.match(/\{COPY\.CONFIRM_EMAIL_FIRST\}/g) ?? []).length, 1, "one use of the line");
  // The line and the space are the two arms of one ternary on `space`: where the reservations are shown, the line is not.
  assert.match(
    PAGE,
    /\{space \? \(\s*<CustomerSpaceView[^>]*\/>\s*\) : \(\s*<p className="text-sm text-zinc-600">\{COPY\.CONFIRM_EMAIL_FIRST\}<\/p>\s*\)\}/,
  );
  // The unverified branch keeps its banner above both.
  assert.match(PAGE, /<VerifyEmailBanner email=\{identity\.email\} verified=\{false\} \/>/);
});
