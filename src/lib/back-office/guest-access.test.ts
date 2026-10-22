import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GUEST_COOKIE_MAX_AGE } from "../guest-link";
import { guestCookieOptions, guestLinkDecision, type GuestCustomerRow } from "./guest-access";

const ROW: GuestCustomerRow = {
  customerId: "c1",
  linkVersion: 3,
  slug: "altinha-paris",
  businessName: "Altinha Paris",
  proSuspended: false,
};
const LINK = { customerId: "c1", linkVersion: 3 };

test("guestLinkDecision: no link, no row or a suspended pro is not found", () => {
  assert.deepEqual(guestLinkDecision(null, ROW), { kind: "not_found" });
  assert.deepEqual(guestLinkDecision(LINK, null), { kind: "not_found" });
  assert.deepEqual(guestLinkDecision(null, null), { kind: "not_found" });
  assert.deepEqual(guestLinkDecision(LINK, { ...ROW, proSuspended: true }), { kind: "not_found" });
});

test("guestLinkDecision: a suspended pro wins over a stale version", () => {
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 1 }, { ...ROW, proSuspended: true }), { kind: "not_found" });
});

test("guestLinkDecision: a version different from the customer's current one is stale", () => {
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 2 }, ROW), {
    kind: "stale",
    slug: "altinha-paris",
    businessName: "Altinha Paris",
  });
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 9 }, ROW), {
    kind: "stale",
    slug: "altinha-paris",
    businessName: "Altinha Paris",
  });
});

test("guestLinkDecision: a link for another customer than the row is not found", () => {
  assert.deepEqual(guestLinkDecision({ customerId: "c2", linkVersion: 3 }, ROW), { kind: "not_found" });
});

test("guestLinkDecision: the current version of an existing customer is ok", () => {
  assert.deepEqual(guestLinkDecision(LINK, ROW), {
    kind: "ok",
    slug: "altinha-paris",
    customerId: "c1",
    businessName: "Altinha Paris",
  });
});

test("guestLinkDecision: a slug that is not a plain address segment is never a redirect target", () => {
  for (const slug of ["//evil.example", "/evil", "a/b", "A-b", "", "x y", "x?y", "x\\y", "https:evil"]) {
    assert.deepEqual(guestLinkDecision(LINK, { ...ROW, slug }), { kind: "not_found" }, slug);
    assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 1 }, { ...ROW, slug }), { kind: "not_found" }, slug);
  }
});

test("guestCookieOptions: httpOnly, lax, scoped to the pro's path, 30 days, secure in production only (SEC-7)", () => {
  assert.deepEqual(guestCookieOptions("altinha-paris", true), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/altinha-paris",
    maxAge: 2_592_000,
  });
  assert.deepEqual(guestCookieOptions("altinha-paris", false), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/altinha-paris",
    maxAge: 2_592_000,
  });
  // The path is the pro's own slug, so another pro's pages never receive this client's cookie.
  assert.equal(guestCookieOptions("autre-pro", true).path, "/autre-pro");
  assert.equal(guestCookieOptions("autre-pro", true).maxAge, GUEST_COOKIE_MAX_AGE);
});

test("the personal-link route builds its cookie with guestCookieOptions and the production flag", () => {
  // The route imports next/server and the process db, so it cannot be loaded here: guard its source instead.
  const route = readFileSync("src/app/api/c/[token]/route.ts", "utf8");
  assert.match(route, /res\.cookies\.set\(GUEST_COOKIE, token, guestCookieOptions\(decision\.slug, process\.env\.NODE_ENV === "production"\)\)/);
  assert.doesNotMatch(route, /httpOnly|sameSite|maxAge/, "no attribute is spelled out in the route any more");
});

test("guestLinkDecision hands the row's business name to the page as stored: escaping is the page's job", () => {
  const hostile = '<b>"Cie" & Fils</b>';
  assert.deepEqual(guestLinkDecision(LINK, { ...ROW, businessName: hostile }), {
    kind: "ok",
    slug: "altinha-paris",
    customerId: "c1",
    businessName: hostile,
  });
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 1 }, { ...ROW, businessName: hostile }), {
    kind: "stale",
    slug: "altinha-paris",
    businessName: hostile,
  });
});

const ROUTE = "src/app/api/c/[token]/route.ts";

/** The text of `export async function <name>(` up to the next doc comment or export, so a neighbouring handler's comment never leaks in. */
function handlerOf(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} is exported`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(?:\/\*\*|export )/);
  return end === -1 ? source.slice(start) : source.slice(start, start + 1 + end);
}

test("the personal-link GET only decides and shows the confirmation page: no cookie, no write (Decision 68, S41, S52)", () => {
  const get = handlerOf(readFileSync(ROUTE, "utf8"), "GET");
  assert.doesNotMatch(get, /cookies\.set|Set-Cookie|GUEST_COOKIE/i, "a GET never plants an identity");
  assert.match(get, /guestLinkPageHtml\(\{ businessName: decision\.businessName, actionPath: `\/api\/c\/\$\{encodeURIComponent\(token\)\}` \}\)/);
  assert.match(get, /headers: GUEST_LINK_PAGE_HEADERS/);
  assert.match(get, /decision\.kind === "stale"/, "a stale link redirects and touches no cookie");
});

test("the personal-link POST checks the origin first, re-checks the link, and sets the cookie on the ok branch only (S41)", () => {
  const route = readFileSync(ROUTE, "utf8");
  const post = handlerOf(route, "POST");
  const origin = post.indexOf('sameOrigin(request.headers.get("origin"), env.APP_URL)');
  const resolve = post.indexOf("resolveGuestLink(");
  const notFound = post.indexOf('decision.kind === "not_found"');
  const stale = post.indexOf('decision.kind === "stale"');
  const set = post.indexOf("cookies.set(");
  assert.ok(origin !== -1 && origin < resolve, "the same-origin check comes before the link is read");
  assert.match(post.slice(origin, resolve), /forbidden\(\)/, "a foreign or missing Origin is refused with 403");
  assert.ok(resolve < notFound && notFound < stale && stale < set, "not found, then stale, then the cookie");
  assert.equal((route.match(/cookies\.set\(/g) ?? []).length, 1, "the route writes one cookie, in the POST");
});

test("« Ce n'est pas moi » clears the cookie with the attributes of guestCookieOptions and writes nothing to the database (S52)", () => {
  const client = readFileSync("src/server/client.ts", "utf8");
  const action = handlerOf(client, "forgetGuestLinkAction");
  assert.match(action, /runPublicAction\(/);
  assert.match(action, /\(await cookies\(\)\)\.set\(GUEST_COOKIE, "", \{ \.\.\.guestCookieOptions\(pro\.slug, process\.env\.NODE_ENV === "production"\), maxAge: 0 \}\)/);
  assert.doesNotMatch(client, /httpOnly|sameSite/, "no attribute is spelled out in client.ts");
  assert.doesNotMatch(action, /\bdb\b/, "no database access");
});
