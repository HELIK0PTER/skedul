import test from "node:test";
import assert from "node:assert/strict";

import { actingSession, isSuspended } from "./suspension";

const now = new Date("2026-10-07T12:00:00Z");

test("isSuspended is false when the user is not banned", () => {
  assert.equal(isSuspended({ banned: false, banExpires: null }, now), false);
  assert.equal(isSuspended({ banned: null, banExpires: null }, now), false);
});

test("isSuspended is true for an open-ended ban", () => {
  assert.equal(isSuspended({ banned: true, banExpires: null }, now), true);
});

test("isSuspended is true while the ban end is in the future", () => {
  const banExpires = new Date("2026-10-08T12:00:00Z");
  assert.equal(isSuspended({ banned: true, banExpires }, now), true);
});

test("isSuspended is false once the ban end has passed", () => {
  const banExpires = new Date("2026-10-06T12:00:00Z");
  assert.equal(isSuspended({ banned: true, banExpires }, now), false);
});

test("actingSession: a session of a suspended user may not act, an active one may, no session is none", () => {
  const live = { user: { id: "u1", banned: false, banExpires: null } };
  assert.equal(actingSession(live, now), live);
  assert.equal(actingSession(null, now), null);
  assert.equal(actingSession({ user: { id: "u2", banned: true, banExpires: null } }, now), null);
  assert.equal(actingSession({ user: { id: "u3", banned: true, banExpires: new Date("2026-10-08T12:00:00Z") } }, now), null);
  // A ban whose end has passed counts as lifted, like isSuspended.
  const lifted = { user: { id: "u4", banned: true, banExpires: new Date("2026-10-06T12:00:00Z") } };
  assert.equal(actingSession(lifted, now), lifted);
  // The ban fields may be absent or null on a session read: not suspended.
  const bare = { user: { id: "u5" } };
  assert.equal(actingSession(bare, now), bare);
  const nulls = { user: { id: "u6", banned: null, banExpires: null } };
  assert.equal(actingSession(nulls, now), nulls);
});

test("actingSession reads a ban end that came back as an ISO string", () => {
  const future = { user: { id: "u7", banned: true, banExpires: "2026-10-08T12:00:00.000Z" } };
  assert.equal(actingSession(future, now), null);
  const past = { user: { id: "u8", banned: true, banExpires: "2026-10-06T12:00:00.000Z" } };
  assert.equal(actingSession(past, now), past);
});
