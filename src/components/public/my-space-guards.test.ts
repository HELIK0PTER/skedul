/**
 * Wiring guards for /mon-espace (the P3 pattern of src/components/dashboard/final-review-ui.test.ts): the page and its
 * client leaves import Server Actions, Better Auth's client and next/navigation, which the node:test runner cannot
 * load, so what they must keep is pinned on their source. The rules they call have their own tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string): string => readFileSync(path, "utf8");

const FILES = [
  "src/app/mon-espace/layout.tsx",
  "src/app/mon-espace/page.tsx",
  "src/app/mon-espace/loading.tsx",
  "src/app/mon-espace/error.tsx",
  "src/components/public/my-space.tsx",
  "src/components/public/my-name-form.tsx",
  "src/components/public/revoke-my-links-button.tsx",
  "src/components/public/client-sign-out-button.tsx",
];

test("/mon-espace reads the fresh session, never redirects, and mounts the code form for an anonymous visitor only", () => {
  const page = source("src/app/mon-espace/page.tsx");
  assert.match(page, /currentSessionFacts\(\)/);
  assert.doesNotMatch(page, /\bgetSession\(|\bgetCurrentUser\(|\bgetFreshSession\(|\bgetSpaceProfile\(/, "never the cached or ad hoc session");
  assert.doesNotMatch(page, /\bredirect\(|permanentRedirect|searchParams/, "signed out shows the form (L1376); no query is read");
  const gate = page.indexOf("canOfferCodeSignIn(");
  assert.notEqual(gate, -1, "the risk 7 gate");
  assert.ok(gate < page.indexOf("<EmailCodeForm"), "the gate comes before the code form");
  assert.ok(gate < page.indexOf("<ClientSignInChoices"), "and before the choices");
  assert.match(page, /returnTo="\/mon-espace"/);
  assert.match(page, /title: "Mon espace"/);
  assert.match(page, /robots: \{ index: false \}/);
  assert.match(page, /state === "verified" && session \? await getMySpacePage\(session\) : \[\]/, "the facts of the fresh session, nothing from the request, behind the page's own gate");
  const queries = source("src/server/client-queries.ts");
  assert.match(queries, /export function getMySpacePage\(session: SessionFacts \| null\)/);
  assert.match(queries, /return getMySpace\(db, session, new Date\(\)\);/, "the read gets the facts, which it checks itself (verified, not impersonated)");
  assert.match(page, /COPY\.CONFIRM_EMAIL_FIRST/);
  assert.match(page, /COPY\.IMPERSONATING/);
  assert.doesNotMatch(page, /unstable_cache|"use cache"|export const revalidate|export const dynamic/);
});

test("the confirmation banner stays mounted when a code is accepted (WCAG 2.4.3, the dashboard layout pattern)", () => {
  const page = source("src/app/mon-espace/page.tsx");
  assert.equal((page.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one banner, outside every state branch");
  assert.match(
    page,
    /\{banner && <VerifyEmailBanner email=\{banner\.email\} verified=\{banner\.verified\} \/>\}/,
    "mounted for every signed-in visitor that is not impersonated, `verified` from the state",
  );
  assert.match(page, /verified: state === "verified"/, "verified comes from the visitor state, never from a constant");
  // The condition itself, not « the word impersonating appears somewhere » (the page's impersonating branch matches that):
  // an admin impersonating a client must not be offered a confirmation code for the client's address.
  assert.match(
    page,
    /const banner = session && state !== "impersonating" \? \{ email: session\.email, verified: state === "verified" \} : null;/,
    "no banner while impersonating",
  );
  const banner = page.indexOf("<VerifyEmailBanner");
  assert.ok(banner < page.indexOf("canOfferCodeSignIn("), "the banner sits above the identity switch");
  assert.ok(banner < page.indexOf("<MySpaceView"), "so the flip to the space does not unmount it");
});

test("the client leaves of /mon-espace never refresh the router, and sign-out is a full navigation (SEC-M12)", () => {
  for (const file of ["my-name-form", "revoke-my-links-button", "client-sign-out-button"]) {
    assert.doesNotMatch(source(`src/components/public/${file}.tsx`), /router\.refresh|router\.push|useRouter/, file);
  }
  const out = source("src/components/public/client-sign-out-button.tsx");
  assert.match(out, /signOut\(\)/);
  assert.match(out, /window\.location\.replace\("\/mon-espace"\)/);
});

test("the leaves send the typed value only and answer a thrown call with the shared message", () => {
  const name = source("src/components/public/my-name-form.tsx");
  assert.match(name, /updateMyNameAction\(\{ name: parsed\.data\.name \}\)/);
  assert.match(name, /PUBLIC_UNEXPECTED/);
  assert.match(name, /<SavedStatus saved=\{saved\} message=\{COPY\.SAVED\} \/>/, "the always-mounted status line");
  assert.match(name, /<div role="alert">/, "the failure sits in an always-mounted alert region");
  assert.doesNotMatch(name, /<FormError\b/, "FormError mounts its alert together with the text");
  assert.match(name, /COPY\.PENDING_SAVE/);
  assert.match(source("src/components/public/client-sign-out-button.tsx"), /<div role="alert">/);
  const revoke = source("src/components/public/revoke-my-links-button.tsx");
  assert.match(revoke, /revokeMyLinksAction\(\)/);
  assert.match(revoke, /<ConfirmDialog/, "a destructive gesture states its consequences");
  assert.match(revoke, /Déconnecter vos liens personnels \?/);
  assert.match(revoke, /Les liens reçus par email cessent de fonctionner\. Les prochains emails contiendront un nouveau lien\./);
  assert.match(revoke, /COPY\.LINKS_REVOKED/);
  assert.match(revoke, /<div role="status"/, "the success line sits in an always-mounted status region");
});

test("MySpaceView takes no Date, no engine, database or payment module, wraps user text and keeps its empty states", () => {
  const view = source("src/components/public/my-space.tsx");
  assert.doesNotMatch(view, /new Date\(|Date\.now/);
  assert.doesNotMatch(view, /from "@\/lib\/(booking|db|payments)[\/"]/);
  assert.match(view, /wrap-anywhere/);
  for (const key of ["NO_RESERVATION", "NO_UPCOMING", "NO_TICKET", "SEE_SHOP", "CREATE_PAGE"]) {
    assert.match(view, new RegExp(`COPY\\.${key}\\b`), key);
  }
  assert.match(view, /boutiqueHref\(slug\)/);
  assert.match(view, /<MyNameForm initialName=\{name\} \/>/);
  assert.match(view, /<RevokeMyLinksButton \/>/);
  assert.match(view, /<ClientSignOutButton \/>/);
});

test("no dash and no console call in the files of Task 19 (S30, no raw error in a log)", () => {
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const file of FILES) {
    const text = source(file);
    assert.doesNotMatch(text, dash, file);
    assert.doesNotMatch(text, /console\./, file);
  }
});
