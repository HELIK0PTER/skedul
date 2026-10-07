import test from "node:test";
import assert from "node:assert/strict";

import { visitorHash } from "./visitor-hash";

const base = {
  secret: "s3cret",
  dayKey: "2026-10-07",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 Test",
};

test("visitorHash is stable for the same visitor on the same day", () => {
  assert.equal(visitorHash(base), visitorHash({ ...base }));
});

test("visitorHash rotates the next day", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, dayKey: "2026-10-08" }));
});

test("visitorHash differs between visitors", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, ip: "203.0.113.8" }));
});

test("visitorHash is 32 hex chars and does not leak the IP", () => {
  const hash = visitorHash(base);
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hash.includes(base.ip), false);
});
