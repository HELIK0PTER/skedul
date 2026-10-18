import test from "node:test";
import assert from "node:assert/strict";

import { HEALTH_KEYS, nextWindow, otpThrottleKey, resetThrottleKey, throttleKey } from "./throttle";

const T0 = new Date("2026-10-12T10:00:00Z");
const later = (sec: number) => new Date(T0.getTime() + sec * 1000);

test("nextWindow opens a window, counts inside it, and reopens once it has elapsed", () => {
  const first = nextWindow(null, T0, 3600);
  assert.deepEqual(first, { windowStart: T0, hits: 1 });
  const second = nextWindow(first, later(60), 3600);
  assert.deepEqual(second, { windowStart: T0, hits: 2 });
  assert.deepEqual(nextWindow(second, later(3599), 3600), { windowStart: T0, hits: 3 });
  // windowStart ≤ now − windowSec: exactly one window later is a new window
  assert.deepEqual(nextWindow(second, later(3600), 3600), { windowStart: later(3600), hits: 1 });
  assert.deepEqual(nextWindow(second, later(9000), 3600), { windowStart: later(9000), hits: 1 });
});

test("throttleKey: the IP hash is used as given, the e-mail is normalised and hashed", () => {
  assert.equal(throttleKey("free", "ip", "0123456789abcdef0123456789abcdef"), "t:free:ip:0123456789abcdef0123456789abcdef");
  const key = throttleKey("buybook", "email", "Lea@Example.com ");
  assert.match(key, /^t:buybook:e:[0-9a-f]{32}$/);
  assert.equal(key, throttleKey("buybook", "email", "lea@example.com"));
  assert.notEqual(key, throttleKey("buybook", "email", "leo@example.com"));
  assert.notEqual(key, throttleKey("shop", "email", "lea@example.com"));
  assert.ok(!key.includes("@") && !key.includes("lea"));
});

test("otpThrottleKey is the e-mail key of the « otp » action", () => {
  assert.equal(otpThrottleKey("Lea@Example.com"), throttleKey("otp", "email", "lea@example.com"));
  assert.match(otpThrottleKey("lea@example.com"), /^t:otp:e:[0-9a-f]{32}$/);
});

test("resetThrottleKey is the e-mail key of the « reset » action, apart from the sign-in code key", () => {
  assert.equal(resetThrottleKey("Lea@Example.com "), throttleKey("reset", "email", "lea@example.com"));
  assert.match(resetThrottleKey("lea@example.com"), /^t:reset:e:[0-9a-f]{32}$/);
  // Separate counters: reset requests can never use up the sign-in codes of the same address.
  assert.notEqual(resetThrottleKey("lea@example.com"), otpThrottleKey("lea@example.com"));
  assert.notEqual(resetThrottleKey("lea@example.com"), resetThrottleKey("leo@example.com"));
});

test("health keys live under the health: prefix", () => {
  assert.deepEqual(HEALTH_KEYS, {
    orphanPayments: "health:orphan_payments",
    invariantViolations: "health:invariant_violations",
  });
});
