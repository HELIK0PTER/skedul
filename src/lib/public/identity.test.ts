import assert from "node:assert/strict";
import test from "node:test";

import { IP_HASH_RE } from "@/lib/throttle";
import { sessionOf, testIpHash } from "@/test/public";

import {
  sessionFactsOf,
  spaceIdentityOf,
  upsertUserIdFor,
  visitorState,
  type PublicVisitor,
  type SessionFacts,
} from "./identity";

test("sessionFactsOf: no session gives null", () => {
  assert.equal(sessionFactsOf(null), null);
  assert.equal(sessionFactsOf(undefined), null);
});

test("sessionFactsOf copies the fields P4 relies on; impersonated is true exactly when impersonatedBy is set", () => {
  const plain = sessionFactsOf({
    user: { id: "u1", email: "beatriz@example.com", name: "Beatriz Almeida", emailVerified: true },
    session: { impersonatedBy: null },
  });
  assert.deepEqual(plain, {
    userId: "u1",
    email: "beatriz@example.com",
    name: "Beatriz Almeida",
    emailVerified: true,
    impersonated: false,
    impersonatedBy: null,
  });
  const impersonated = sessionFactsOf({
    user: { id: "u1", email: "beatriz@example.com", name: "Beatriz Almeida", emailVerified: true },
    session: { impersonatedBy: "admin-1" },
  });
  assert.equal(impersonated?.impersonated, true);
  assert.equal(impersonated?.impersonatedBy, "admin-1");
});

test("sessionFactsOf: a missing name, flag or impersonatedBy reads as empty, unverified and not impersonated", () => {
  assert.deepEqual(sessionFactsOf({ user: { id: "u2", email: "x@example.com" }, session: {} }), {
    userId: "u2",
    email: "x@example.com",
    name: "",
    emailVerified: false,
    impersonated: false,
    impersonatedBy: null,
  });
  const nulls = sessionFactsOf({ user: { id: "u2", email: "x@example.com", name: null, emailVerified: null }, session: { impersonatedBy: undefined } });
  assert.equal(nulls?.name, "");
  assert.equal(nulls?.emailVerified, false);
  assert.equal(nulls?.impersonated, false);
});

test("sessionFactsOf fails closed: an empty impersonatedBy still counts as an impersonation", () => {
  const facts = sessionFactsOf({ user: { id: "u3", email: "x@example.com", emailVerified: true }, session: { impersonatedBy: "" } });
  assert.equal(facts?.impersonated, true);
  assert.equal(visitorState(facts), "impersonating");
});

test("visitorState: impersonation first, then verification", () => {
  const user = { userId: "u1", email: "a@example.com" };
  assert.equal(visitorState(null), "anonymous");
  assert.equal(visitorState(sessionOf(user)), "verified");
  assert.equal(visitorState(sessionOf(user, { verified: false })), "unverified");
  assert.equal(visitorState(sessionOf(user, { impersonated: true })), "impersonating");
  assert.equal(visitorState(sessionOf(user, { verified: false, impersonated: true })), "impersonating", "impersonated + unverified is impersonating");
});

test("upsertUserIdFor (S4): the session user only for a verified, non-impersonated session of the SAME address, case and spaces ignored", () => {
  const me = { userId: "u1", email: "beatriz@example.com" };
  assert.equal(upsertUserIdFor(sessionOf(me), "beatriz@example.com"), "u1");
  assert.equal(upsertUserIdFor(sessionOf(me), "  Beatriz@Example.COM "), "u1");
  assert.equal(upsertUserIdFor(sessionOf({ ...me, email: "Beatriz@Example.com" }), "beatriz@example.com"), "u1", "the session side is normalised too");
});

test("upsertUserIdFor (S4): unverified, impersonated, another address and no session give null", () => {
  const me = { userId: "u1", email: "beatriz@example.com" };
  assert.equal(upsertUserIdFor(sessionOf(me, { verified: false }), "beatriz@example.com"), null);
  assert.equal(upsertUserIdFor(sessionOf(me, { impersonated: true }), "beatriz@example.com"), null);
  assert.equal(upsertUserIdFor(sessionOf(me), "thomas@example.com"), null);
  assert.equal(upsertUserIdFor(sessionOf(me), ""), null);
  assert.equal(upsertUserIdFor(null, "beatriz@example.com"), null);
});

function visitor(over: Partial<PublicVisitor>): PublicVisitor {
  return { state: "anonymous", email: null, name: null, isPageOwner: false, owner: null, guestCustomerId: null, ...over };
}
const OWNER = { professionalId: "p1", customerId: "c1", userId: "u1", email: "beatriz@example.com" };

test("spaceIdentityOf: the espace identity of a visitor, in the order of the contract (COV-C1)", () => {
  // impersonation first, whatever else the visitor object says
  assert.deepEqual(spaceIdentityOf(visitor({ state: "impersonating", owner: OWNER, guestCustomerId: "c9" })), { kind: "impersonating" });
  // the Owner
  assert.deepEqual(spaceIdentityOf(visitor({ state: "verified", email: OWNER.email, owner: OWNER })), {
    kind: "customer",
    customerId: "c1",
    via: "session",
  });
  // verified without a record: no_record, and a cookie that should not be there is not used (L1370)
  assert.deepEqual(spaceIdentityOf(visitor({ state: "verified", email: "x@example.com", guestCustomerId: "c9" })), {
    kind: "no_record",
    email: "x@example.com",
  });
  // unverified: the banner kind, with or without the cookie's customer, never anonymous
  assert.deepEqual(spaceIdentityOf(visitor({ state: "unverified", email: "x@example.com" })), {
    kind: "unverified",
    email: "x@example.com",
    guestCustomerId: null,
  });
  assert.deepEqual(spaceIdentityOf(visitor({ state: "unverified", email: "x@example.com", guestCustomerId: "c9" })), {
    kind: "unverified",
    email: "x@example.com",
    guestCustomerId: "c9",
  });
  // signed out
  assert.deepEqual(spaceIdentityOf(visitor({ guestCustomerId: "c9" })), { kind: "customer", customerId: "c9", via: "guest" });
  assert.deepEqual(spaceIdentityOf(visitor({})), { kind: "anonymous" });
});

test("test helpers: sessionOf builds the facts of a signed-in client, testIpHash a valid ipHash", () => {
  const facts: SessionFacts = sessionOf({ userId: "u1", email: "a@example.com" });
  assert.deepEqual(facts, {
    userId: "u1",
    email: "a@example.com",
    name: "Client test",
    emailVerified: true,
    impersonated: false,
    impersonatedBy: null,
  });
  assert.deepEqual(sessionOf({ userId: "u1", email: "a@example.com", name: "Léa" }, { verified: false, impersonated: true }), {
    userId: "u1",
    email: "a@example.com",
    name: "Léa",
    emailVerified: false,
    impersonated: true,
    impersonatedBy: "admin-test",
  });
  const a = testIpHash();
  assert.match(a, IP_HASH_RE);
  assert.notEqual(a, testIpHash(), "a fresh value each call");
});
