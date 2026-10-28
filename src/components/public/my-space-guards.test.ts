/**
 * Wiring guards for /mon-espace (the P3 pattern of src/components/dashboard/final-review-ui.test.ts): the page and its
 * client leaves import Server Actions, Better Auth's client and next/navigation, which the node:test runner cannot
 * load, so what they must keep is pinned on their source. The rules they call have their own tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView, openingTags } from "@/test/source-guards";

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
  assert.match(page, /state === "verified" && session \? await getMySpacePage\(session, new Date\(\)\) : \[\]/, "the facts of the fresh session, nothing from the request, behind the page's own gate");
  const queries = source("src/server/client-queries.ts");
  assert.match(queries, /export function getMySpacePage\(session: SessionFacts \| null, now: Date\)/);
  assert.match(
    queries,
    /return safeRead\(\(\) => getMySpace\(db, session, now\)\);/,
    "the read gets the facts, which it checks itself (verified, not impersonated), through safeRead (RND-1)",
  );
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

test("an inline code sign-in on /mon-espace lands on the page heading and is announced by a status line outside every branch (AUTH-1, WCAG 2.4.3, 4.1.3)", () => {
  const page = source("src/app/mon-espace/page.tsx");
  const anchors = source("src/lib/public-anchors.ts");
  assert.match(anchors, /export const MY_SPACE_HEADING_ID = "my-space-title";/);
  assert.match(page, /import \{ MY_SPACE_HEADING_ID \} from "@\/lib\/public-anchors";/);
  // The h1 is rendered by every state, so it outlives the swap of the code form for the space; tabIndex -1 lets the form
  // focus it, and the ring is the one the other focus-target headings use.
  assert.match(
    page,
    /<h1\s+id=\{MY_SPACE_HEADING_ID\}\s+tabIndex=\{-1\}\s+className="mb-6 w-fit rounded text-2xl font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"\s*>\s*Mon espace client\s*<\/h1>/,
  );
  assert.match(page, /<EmailCodeForm idPrefix="my-space" askName focusAfterSignIn=\{MY_SPACE_HEADING_ID\} \/>/);
  // One status line, a sibling of the h1, before the banner and the identity switch: never inside a state branch.
  assert.match(page, /<\/h1>\s*<SignInStatus \/>\s*\{banner && <VerifyEmailBanner/);
  assert.equal((page.match(/<SignInStatus \/>/g) ?? []).length, 1);
  assert.ok(page.indexOf("<SignInStatus />") < page.indexOf("canOfferCodeSignIn("), "above the identity switch");
});

test("the client leaves of /mon-espace never refresh the router, and sign-out is a full navigation (SEC-M12)", () => {
  for (const file of ["my-name-form", "revoke-my-links-button", "client-sign-out-button"]) {
    assert.doesNotMatch(source(`src/components/public/${file}.tsx`), /router\.refresh|router\.push|useRouter/, file);
  }
  const out = source("src/components/public/client-sign-out-button.tsx");
  assert.match(out, /signOut\(\)/);
  assert.match(out, /export function ClientSignOutButton\(\{ returnTo = "\/mon-espace" \}: \{ returnTo\?: string \}\)/, "the page to come back to defaults to /mon-espace");
  assert.match(out, /window\.location\.replace\(returnPathOf\(returnTo\)\)/, "a full navigation to the page the caller built, through returnPathOf");
  assert.ok(out.indexOf("await signOut()") < out.indexOf("window.location.replace("), "signed out first, then the navigation");
});

test("/mon-espace offers the sign-out to an unverified visitor too, and never while impersonating (G3b)", () => {
  const page = source("src/app/mon-espace/page.tsx");
  const unverified = page.indexOf('{state === "unverified" && (');
  const impersonating = page.indexOf('{state === "impersonating" && (');
  assert.ok(unverified !== -1 && impersonating > unverified);
  const branch = page.slice(unverified, impersonating);
  assert.match(branch, /COPY\.CONFIRM_EMAIL_FIRST/);
  assert.match(branch, /<ClientSignOutButton \/>/);
  assert.match(page, /import \{ ClientSignOutButton \} from "@\/components\/public\/client-sign-out-button";/);
  assert.equal((page.match(/<ClientSignOutButton/g) ?? []).length, 1, "one place, the unverified branch; the verified view carries its own");
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

test("« Votre nom » stops at the bound its schema checks, like every other name field of the client pages (AUTH-5)", () => {
  // plainNameSchema refuses a name over BOUNDS.name (80): the field stops there instead of letting the visitor type a
  // name that only the save then refuses.
  const fields = [
    { file: "src/components/public/my-name-form.tsx", id: 'id="my-name"' },
    { file: "src/components/public/identity-fields.tsx", id: "id={`${idPrefix}-name`}" },
    { file: "src/components/auth/email-code-form.tsx", id: 'name="name"' },
  ];
  for (const { file, id } of fields) {
    const text = source(file);
    assert.match(text, /import \{ BOUNDS \} from "@\/lib\/tickets-vocab";/, file);
    const inputs = openingTags(text, "Input").filter((tag) => tag.text.includes(id));
    assert.equal(inputs.length, 1, `${file}: one name input`);
    assert.match(inputs[0].text, /\smaxLength=\{BOUNDS\.name\}/, `${file}: ${inputs[0].text}`);
  }
  assert.match(
    codeView(source("src/lib/public/plain-name.ts")),
    /plainNameSchema: z\.ZodString = z\.string\(\)\.trim\(\)\.min\(1\)\.max\(BOUNDS\.name\)/,
    "the bound the field mirrors (the code, not its comment)",
  );
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
