/**
 * Pure tests of `spaceActorOf` (spec § 12, contract § 3.19): who may act in the client espace, from the visitor the
 * server built. They sat in `space-actions.db.test.ts` until the G3b sweep, which `tsx --test "src/**\/!(*.db).test.ts"`
 * does not run: they need no database, so the pure suite runs them here (S10 and S42, the `spaceActorOf` halves).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { spaceActorOf } from "@/lib/public/space-actions";
import { sessionOf } from "@/test/public";

const OWNER = { professionalId: "p1", customerId: "c-owner", userId: "u1", email: "beatriz@example.com" };

test("spaceActorOf: the Owner acts through the session, a cookie of another customer is ignored (L1370)", () => {
  const session = sessionOf({ userId: "u1", email: "beatriz@example.com" });
  const expected = { customerId: "c-owner", actorUserId: "u1", via: "session" };
  assert.deepEqual(spaceActorOf({ session, owner: OWNER, guestCustomerId: "c-cookie" }), expected);
  assert.deepEqual(spaceActorOf({ session, owner: OWNER, guestCustomerId: null }), expected);
});

test("spaceActorOf: a verified session without a record at this pro acts as nobody, a valid cookie included (S10)", () => {
  const session = sessionOf({ userId: "u2", email: "nobody@example.com" });
  assert.equal(spaceActorOf({ session, owner: null, guestCustomerId: "c-cookie" }), null);
});

test("spaceActorOf: an impersonating session acts as nobody, a valid cookie or an owner included (SEC-M6, Decision 19, S42)", () => {
  const session = sessionOf({ userId: "u1", email: "beatriz@example.com" }, { impersonated: true });
  assert.equal(spaceActorOf({ session, owner: null, guestCustomerId: "c-cookie" }), null);
  assert.equal(spaceActorOf({ session, owner: OWNER, guestCustomerId: null }), null);
});

test("spaceActorOf: an unverified or a signed-out visitor acts through the cookie customer, read and cancel only", () => {
  const unverified = sessionOf({ userId: "u3", email: "new@example.com" }, { verified: false });
  const guest = { customerId: "c-cookie", actorUserId: null, via: "guest" };
  assert.deepEqual(spaceActorOf({ session: unverified, owner: null, guestCustomerId: "c-cookie" }), guest);
  assert.deepEqual(spaceActorOf({ session: null, owner: null, guestCustomerId: "c-cookie" }), guest);
  assert.equal(spaceActorOf({ session: null, owner: null, guestCustomerId: null }), null);
  assert.equal(spaceActorOf({ session: unverified, owner: null, guestCustomerId: null }), null);
});
