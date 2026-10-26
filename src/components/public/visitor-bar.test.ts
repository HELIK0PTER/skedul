/**
 * Wiring guard for src/components/public/visitor-bar.tsx. The bar is a client component that imports the sign-in
 * dialog, which imports Better Auth's client and next/navigation, and the node:test runner cannot load those, so the
 * rules the bar must keep are pinned on its source (the rules themselves, canOfferCodeSignIn first, have their own
 * pure tests). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLANNING_HEADING_ID } from "@/lib/public-anchors";

const SOURCE = readFileSync("src/components/public/visitor-bar.tsx", "utf8");

test("the bar mounts the sign-in dialog only for a visitor canOfferCodeSignIn allows (risk 7)", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /canOfferCodeSignIn\(state\) && \(?\s*<OtpDialog/);
  assert.match(SOURCE, /returnTo=\{returnTo\}/);
  assert.match(SOURCE, /googleEnabled=\{googleEnabled\}/);
  assert.doesNotMatch(SOURCE, /EmailCodeForm|ClientSignInChoices|authClient|signIn\b/, "the bar never signs anybody in by itself");
});

test("an impersonating admin and an unverified user see nothing from the bar: no code form, and the confirmation banner is the page's", () => {
  assert.match(SOURCE, /if \(state === "impersonating"\) return null;/);
  assert.match(SOURCE, /if \(state === "unverified"\) return null;/);
  // Deviation from the brief (Task 25b report): a banner held by the bar was unmounted by the verified link row once
  // the code was accepted, so « Adresse confirmée. » was never announced. The page mounts it once, outside the swap.
  assert.doesNotMatch(SOURCE, /VerifyEmailBanner|verify-email-banner/);
  // Scoped to the props (G4b): what the bar takes is its parameter list and its type, so a comment that says « email »
  // fails nothing, and any new prop (an address, a name) fails this list.
  const props = /export function VisitorBar\(\{([^}]*)\}: \{([^}]*)\}\) \{/.exec(SOURCE);
  assert.ok(props, "the props are destructured with an inline type");
  const names = props[1].split(",").map((s) => s.trim()).filter(Boolean);
  const typed = [...props[2].matchAll(/(\w+)\??:/g)].map((m) => m[1]);
  const expected = ["state", "slug", "returnTo", "googleEnabled", "hasGuestSpace"];
  assert.deepEqual(names, expected, "the bar takes no address");
  assert.deepEqual(typed, expected, "and its type declares no other prop");
});

test("the labels come from the shared copy and « Mon espace » leads to the espace of this pro", () => {
  assert.match(SOURCE, /COPY\.HAVE_TICKETS_HINT/);
  assert.match(SOURCE, /COPY\.HAVE_TICKETS\b/);
  assert.match(SOURCE, /COPY\.MY_SPACE/);
  assert.match(SOURCE, /href=\{`\/\$\{slug\}\/espace`\}/);
});

test("a verified visitor without a record here gets the lone « Mon espace » link under no title: « Vos tickets » is the Owner's wallet card, and the bar owns no heading (G3b)", () => {
  const branch = /if \(state === "verified"\) \{\s*return \(([\s\S]*?)\);\s*\}/.exec(SOURCE);
  assert.ok(branch, "the verified branch is a plain return");
  assert.match(branch[1], /\{COPY\.MY_SPACE\}/);
  assert.match(branch[1], /href=\{`\/\$\{slug\}\/espace`\}/);
  assert.doesNotMatch(branch[1], /<h[1-6]\b|<p\b|Vos tickets/, "a lone link: no title above it, and never the wallet's own title");
  assert.doesNotMatch(SOURCE, /Vos tickets/, "that title belongs to WalletPanel, which only an Owner gets");
});

test("the bar never refreshes the router itself (the dialog does, after a fresh session read)", () => {
  assert.doesNotMatch(SOURCE, /router\.refresh|useRouter/);
});

test("the dialog hands the focus, once the visitor is signed in, to the « Planning » heading: the refresh swaps the bar, never that heading (WCAG 2.4.3)", () => {
  assert.equal(PLANNING_HEADING_ID, "planning-title");
  assert.match(SOURCE, /import \{ PLANNING_HEADING_ID \} from "@\/lib\/public-anchors";/);
  assert.match(SOURCE, /function planningHeading\(\): HTMLElement \| null \{\s*return document\.getElementById\(PLANNING_HEADING_ID\);\s*\}/);
  assert.match(SOURCE, /<OtpDialog[\s\S]*?\breturnFocusTo=\{planningHeading\}[\s\S]*?\/>/);
  assert.doesNotMatch(SOURCE, /useRef|<h2/, "the bar owns no heading and no ref: they would go with the bar when the page refreshes");
});

test("that heading exists in every state of the page: focusable, rendered whatever the week holds, and outside the bar and the wallet", () => {
  const planning = readFileSync("src/components/public/public-planning.tsx", "utf8");
  assert.match(planning, /<section aria-labelledby=\{PLANNING_HEADING_ID\}/);
  assert.match(planning, /<h2\s+id=\{PLANNING_HEADING_ID\}\s+tabIndex=\{-1\}/);
  assert.ok(planning.indexOf("<h2") < planning.indexOf('empty !== "all"'), "the heading comes before every branch on `empty`");
  const home = readFileSync("src/app/[slug]/page.tsx", "utf8");
  const at = home.indexOf("<PublicPlanning");
  assert.notEqual(at, -1);
  assert.match(home.slice(0, at), />\s*$/, "a plain child of the page, not behind a condition and not inside the bar or the wallet");
});
