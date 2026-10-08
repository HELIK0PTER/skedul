import test from "node:test";
import assert from "node:assert/strict";

import { isSuspended } from "./suspension";

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
