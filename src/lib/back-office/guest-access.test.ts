import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GUEST_COOKIE_MAX_AGE } from "../guest-link";
import { guestCookieOptions, guestLinkDecision, type GuestCustomerRow } from "./guest-access";

const ROW: GuestCustomerRow = { customerId: "c1", linkVersion: 3, slug: "altinha-paris", proSuspended: false };
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
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 2 }, ROW), { kind: "stale", slug: "altinha-paris" });
  assert.deepEqual(guestLinkDecision({ ...LINK, linkVersion: 9 }, ROW), { kind: "stale", slug: "altinha-paris" });
});

test("guestLinkDecision: a link for another customer than the row is not found", () => {
  assert.deepEqual(guestLinkDecision({ customerId: "c2", linkVersion: 3 }, ROW), { kind: "not_found" });
});

test("guestLinkDecision: the current version of an existing customer is ok", () => {
  assert.deepEqual(guestLinkDecision(LINK, ROW), { kind: "ok", slug: "altinha-paris", customerId: "c1" });
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
