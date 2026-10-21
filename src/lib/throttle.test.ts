import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  HEALTH_KEYS,
  IP_HASH_RE,
  actionThrottleKeys,
  nextWindow,
  otpThrottleKey,
  resetThrottleKey,
  throttleKey,
  type ActionThrottleArgs,
} from "./throttle";
import { THROTTLE_ACTIONS, THROTTLE_LIMITS, type ThrottleAction } from "./tickets-vocab";

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

const IP = "0123456789abcdef0123456789abcdef";
const WIDE = "fedcba9876543210fedcba9876543210";
const PRO = "pro_1";
const digestOf = (normalizedEmail: string): string => createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 32);
const LEA = digestOf("lea@example.com");

/** The arguments of one call; the e-mail is typed with a capital and a trailing space on purpose. */
function argsOf(over: Partial<ActionThrottleArgs> & { action: ThrottleAction }): ActionThrottleArgs {
  return {
    professionalId: PRO,
    ipHash: IP,
    wideIpHash: null,
    subject: { kind: "email", email: "Lea@Example.com " },
    ...over,
  };
}

test("IP_HASH_RE accepts exactly 32 lower-case hex characters", () => {
  assert.equal(IP_HASH_RE.test(IP), true);
  assert.equal(IP_HASH_RE.test(WIDE), true);
  for (const bad of ["", "1.2.3.4", "2001:db8::/48", IP.toUpperCase(), IP.slice(1), `${IP}0`, ` ${IP}`, `${IP}\n`, "0123456789abcdef0123456789abcdeg"]) {
    assert.equal(IP_HASH_RE.test(bad), false, JSON.stringify(bad));
  }
});

test("actionThrottleKeys: an e-mail subject consumes the IP key, the global e-mail key and the per-pro e-mail key", () => {
  assert.deepEqual(actionThrottleKeys(argsOf({ action: "shop" })), [
    { key: `t:shop:ip:${IP}`, limit: 20 },
    { key: `t:shop:e:${LEA}`, limit: 20 },
    { key: `t:shop:e:${PRO}:${LEA}`, limit: 6 },
  ]);
  // the same address typed another way is the same key
  assert.deepEqual(
    actionThrottleKeys(argsOf({ action: "shop", subject: { kind: "email", email: "  LEA@example.COM" } })),
    actionThrottleKeys(argsOf({ action: "shop" })),
  );
  // and another pro has its own per-pro key but shares the global one
  const other = actionThrottleKeys(argsOf({ action: "shop", professionalId: "pro_2" }));
  assert.equal(other[1].key, `t:shop:e:${LEA}`);
  assert.equal(other[2].key, `t:shop:e:pro_2:${LEA}`);
});

test("actionThrottleKeys: the /48 key follows the IP key when there is one, none for IPv4 (null)", () => {
  const withWide = actionThrottleKeys(argsOf({ action: "shop", wideIpHash: WIDE }));
  assert.deepEqual(withWide[0], { key: `t:shop:ip:${IP}`, limit: 20 });
  assert.deepEqual(withWide[1], { key: `t:shop:ip48:${WIDE}`, limit: 60 });
  assert.equal(withWide.length, 4);
  assert.equal(actionThrottleKeys(argsOf({ action: "shop" })).some((k) => k.key.includes(":ip48:")), false);
});

test("actionThrottleKeys: a verified identity consumes its user key only, never an e-mail key (SEC-I6)", () => {
  const keys = actionThrottleKeys(argsOf({ action: "held", subject: { kind: "user", userId: "user-1" } }));
  assert.deepEqual(keys, [
    { key: `t:held:ip:${IP}`, limit: 20 },
    { key: "t:held:u:user-1", limit: 10 },
  ]);
  assert.equal(keys.some((k) => k.key.includes(":e:")), false);
});

test("actionThrottleKeys: the per-séance IP key exists for buybook and free only, and only with an occurrence id", () => {
  for (const action of ["buybook", "free"] as const) {
    const keys = actionThrottleKeys(argsOf({ action, occurrenceId: "occ_1" }));
    assert.ok(keys.some((k) => k.key === `t:${action}:o:occ_1:ip:${IP}` && k.limit === 2), action);
    assert.equal(actionThrottleKeys(argsOf({ action })).some((k) => k.key.includes(":o:")), false, `${action} without occurrence`);
  }
  for (const action of ["rdv", "shop", "held", "cancel", "release"] as const) {
    assert.equal(actionThrottleKeys(argsOf({ action, occurrenceId: "occ_1" })).some((k) => k.key.includes(":o:")), false, action);
  }
});

test("actionThrottleKeys: only free registrations add the per-pro IP key", () => {
  assert.ok(actionThrottleKeys(argsOf({ action: "free" })).some((k) => k.key === `t:free:p:${PRO}:ip:${IP}` && k.limit === 6));
  for (const action of ["buybook", "rdv", "shop", "held", "cancel", "release"] as const) {
    assert.equal(actionThrottleKeys(argsOf({ action })).some((k) => k.key.includes(":p:")), false, action);
  }
});

test("actionThrottleKeys: a free registration with everything set lists its six keys in order", () => {
  assert.deepEqual(actionThrottleKeys(argsOf({ action: "free", wideIpHash: WIDE, occurrenceId: "occ_1" })), [
    { key: `t:free:ip:${IP}`, limit: 20 },
    { key: `t:free:ip48:${WIDE}`, limit: 60 },
    { key: `t:free:e:${LEA}`, limit: 20 },
    { key: `t:free:e:${PRO}:${LEA}`, limit: 6 },
    { key: `t:free:o:occ_1:ip:${IP}`, limit: 2 },
    { key: `t:free:p:${PRO}:ip:${IP}`, limit: 6 },
  ]);
});

test("actionThrottleKeys: every action takes its limits from THROTTLE_LIMITS", () => {
  for (const action of THROTTLE_ACTIONS) {
    const limits = THROTTLE_LIMITS[action];
    const keys = actionThrottleKeys(argsOf({ action, wideIpHash: WIDE }));
    const limitOf = (needle: string): number | undefined => keys.find((k) => k.key.includes(needle))?.limit;
    assert.equal(limitOf(":ip:"), limits.ip, `${action} ip`);
    assert.equal(limitOf(":ip48:"), limits.ip48, `${action} ip48`);
    assert.equal(keys.find((k) => k.key === `t:${action}:e:${LEA}`)?.limit, limits.emailGlobal, `${action} emailGlobal`);
    assert.equal(keys.find((k) => k.key === `t:${action}:e:${PRO}:${LEA}`)?.limit, limits.email, `${action} email`);
  }
});

test("actionThrottleKeys: no key holds an address, and the key families never meet the mail or horizon counters", () => {
  for (const action of THROTTLE_ACTIONS) {
    const args = argsOf({ action, wideIpHash: WIDE, occurrenceId: "occ_1", subject: { kind: "email", email: "Zorglub@Example.com" } });
    for (const { key } of actionThrottleKeys(args)) {
      assert.equal(key.includes("@"), false, key);
      assert.equal(key.toLowerCase().includes("zorglub"), false, key);
      assert.equal(key.toLowerCase().includes("example"), false, key);
      assert.equal(key.startsWith(`t:${action}:`), true, key);
      assert.equal(key.startsWith("t:mail:") || key.startsWith("t:horizon:"), false, key);
    }
  }
});
