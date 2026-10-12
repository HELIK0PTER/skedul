import test from "node:test";
import assert from "node:assert/strict";

import { ipHash, visitorHash } from "./visitor-hash";

const base = {
  salt: "a".repeat(64),
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 Test",
};

test("visitorHash is stable for the same salt, IP and user agent", () => {
  assert.equal(visitorHash(base), visitorHash({ ...base }));
});

test("visitorHash changes with the salt (daily rotation)", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, salt: "b".repeat(64) }));
});

test("visitorHash differs between IPs", () => {
  assert.notEqual(visitorHash(base), visitorHash({ ...base, ip: "203.0.113.8" }));
});

test("visitorHash differs between user agents", () => {
  assert.notEqual(
    visitorHash(base),
    visitorHash({ ...base, userAgent: "Mozilla/5.0 Other" }),
  );
});

test("visitorHash is 32 lowercase hex chars", () => {
  assert.match(visitorHash(base), /^[0-9a-f]{32}$/);
});

test("ipHash is stable for the same salt and IP, and 32 lowercase hex chars", () => {
  assert.equal(ipHash(base.salt, base.ip), ipHash(base.salt, base.ip));
  assert.match(ipHash(base.salt, base.ip), /^[0-9a-f]{32}$/);
});

test("ipHash changes with the salt and the IP, and differs from the visitor hash", () => {
  assert.notEqual(ipHash(base.salt, base.ip), ipHash("b".repeat(64), base.ip));
  assert.notEqual(ipHash(base.salt, base.ip), ipHash(base.salt, "203.0.113.8"));
  assert.notEqual(ipHash(base.salt, base.ip), visitorHash({ ...base, userAgent: "" }));
});
