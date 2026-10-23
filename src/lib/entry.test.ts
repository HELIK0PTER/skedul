import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { entryPath, parseEntryChoice, resolveEntry, signedInSignUpTarget } from "./entry";

test("resolveEntry sends a non-admin with a pro page to /dashboard, whatever the cookie says", () => {
  assert.equal(resolveEntry({ isAdmin: false, hasProfessional: true, remembered: null }), "/dashboard");
  assert.equal(resolveEntry({ isAdmin: false, hasProfessional: true, remembered: "admin" }), "/dashboard");
  assert.equal(resolveEntry({ isAdmin: false, hasProfessional: true, remembered: "client" }), "/dashboard");
});

test("resolveEntry sends a non-admin without a pro page to /mon-espace, never to the pro onboarding (L1394-1397)", () => {
  for (const remembered of [null, "admin", "client"] as const) {
    assert.equal(resolveEntry({ isAdmin: false, hasProfessional: false, remembered }), "/mon-espace");
  }
});

test("resolveEntry asks an admin to choose when nothing is remembered, with or without a pro page", () => {
  assert.equal(resolveEntry({ isAdmin: true, hasProfessional: true, remembered: null }), "choose");
  assert.equal(resolveEntry({ isAdmin: true, hasProfessional: false, remembered: null }), "choose");
});

test("resolveEntry follows an admin's remembered choice (the dashboard layout sends a pro-less admin on to /mon-espace)", () => {
  for (const hasProfessional of [true, false]) {
    assert.equal(resolveEntry({ isAdmin: true, hasProfessional, remembered: "admin" }), "/admin");
    assert.equal(resolveEntry({ isAdmin: true, hasProfessional, remembered: "client" }), "/dashboard");
  }
});

test("parseEntryChoice accepts only admin or client", () => {
  assert.equal(parseEntryChoice("admin"), "admin");
  assert.equal(parseEntryChoice("client"), "client");
  for (const bad of ["", "root", "ADMIN", undefined, null]) {
    assert.equal(parseEntryChoice(bad), null);
  }
});

test("entryPath maps each choice to its dashboard", () => {
  assert.equal(entryPath("admin"), "/admin");
  assert.equal(entryPath("client"), "/dashboard");
});

test("signedInSignUpTarget: a signed-in visitor of the pro funnel keeps a safe next, else a pro goes to the dashboard and anyone else to the onboarding (G3b)", () => {
  // Since Task 20 the dashboard sends a user without a pro page to /mon-espace, so /dashboard as the default would
  // keep a signed-in client from ever reaching the onboarding.
  assert.equal(signedInSignUpTarget({ next: null, hasProfessional: false }), "/onboarding");
  assert.equal(signedInSignUpTarget({ next: null, hasProfessional: true }), "/dashboard");
  for (const hasProfessional of [true, false]) {
    assert.equal(signedInSignUpTarget({ next: "/aide/demandes", hasProfessional }), "/aide/demandes");
  }
});

// The wrappers below import next/headers and a "use server" boundary, which the node:test runner cannot load:
// what they must keep is pinned on their source. Run from the repository root.

/** The text of `export async function <name>` up to the next top-level doc comment or the end of the file. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} is exported`);
  const end = source.indexOf("\n/**", start);
  return source.slice(start, end === -1 ? undefined : end);
}

test("resolvePostSignIn and chooseEntry read the pro page of the signed-in user: no path lands a client on the pro onboarding (L1394-1397)", () => {
  const source = readFileSync("src/server/entry.ts", "utf8");
  assert.match(source, /import \{ getCurrentProfessional \} from "@\/lib\/session";/);
  const resolve = bodyOf(source, "resolvePostSignIn");
  assert.match(resolve, /getCurrentProfessional\(\)/);
  assert.match(resolve, /hasProfessional: pro !== null/);
  const choose = bodyOf(source, "chooseEntry");
  assert.match(choose, /getCurrentProfessional\(\)/);
  assert.match(choose, /"\/mon-espace"/);
  assert.doesNotMatch(source, /\/onboarding/);
});

test("AuthForm builds its Google callbacks through authFormGoogleCallbacks: a sign-in never lands on the pro onboarding (COV-I3)", () => {
  const form = readFileSync("src/components/auth/auth-form.tsx", "utf8");
  assert.match(form, /\.\.\.authFormGoogleCallbacks\(isSignUp \? "sign-up" : "sign-in", next\)/);
  assert.doesNotMatch(form, /newUserCallbackURL/, "the callbacks have one source");
  // The password sign-up is the pro funnel (L1397): it keeps the onboarding.
  assert.match(form, /router\.push\(next \?\? "\/onboarding"\)/);
});

test("the sign-in page offers the client space under the form (L1391)", () => {
  const page = readFileSync("src/app/(auth)/sign-in/page.tsx", "utf8");
  assert.match(page, /Vous êtes client \?/);
  assert.match(page, /href="\/mon-espace"/);
  assert.match(page, /\{COPY\.CLIENT_SPACE_LINK\}/);
  assert.match(page, /INLINE_LINK_CLASS/);
});

test("the sign-in and sign-up pages carry no emoji (Global Constraints: no emoji)", () => {
  for (const file of ["src/app/(auth)/sign-in/page.tsx", "src/app/(auth)/sign-up/page.tsx"]) {
    const emoji = Array.from(readFileSync(file, "utf8")).filter((char) => (char.codePointAt(0) ?? 0) >= 0x1f000);
    assert.deepEqual(emoji, [], `${file} has no character above U+1F000`);
  }
  assert.match(readFileSync("src/app/(auth)/sign-in/page.tsx", "utf8"), /<CardTitle className="text-xl">Bon retour<\/CardTitle>/);
});

test("the sign-up page sends a signed-in visitor through signedInSignUpTarget, with the validated next and the pro page of the user (G3b)", () => {
  const page = readFileSync("src/app/(auth)/sign-up/page.tsx", "utf8");
  assert.match(page, /import \{ getCurrentProfessional, getCurrentUser \} from "@\/lib\/session";/);
  assert.match(page, /if \(await getCurrentUser\(\)\) \{\s*redirect\(signedInSignUpTarget\(\{ next, hasProfessional: \(await getCurrentProfessional\(\)\) !== null \}\)\);\s*\}/);
  assert.match(page, /const next = safeNextPath\(rawNext\);/, "next is validated before it is used");
  assert.doesNotMatch(page, /next \?\? "\/dashboard"/, "the dashboard is no longer the default of a signed-in visitor");
});
