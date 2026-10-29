import assert from "node:assert/strict";
import test from "node:test";

import { clientIpFrom, ipBucket, ipBuckets } from "./client-ip";

/** A header reader over a lower-case map, like the object a route handler or a test passes. */
function readerOf(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

test("clientIpFrom: x-vercel-forwarded-for wins, then the first x-forwarded-for entry, then x-real-ip", () => {
  const all = new Headers({
    "x-vercel-forwarded-for": "203.0.113.7",
    "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    "x-real-ip": "192.0.2.9",
  });
  assert.equal(clientIpFrom(all), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1", "x-real-ip": "192.0.2.9" })), "198.51.100.1");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "  192.0.2.9 " })), "192.0.2.9");
  assert.equal(clientIpFrom(new Headers()), null);
});

test("clientIpFrom: a list or a blank value never becomes the address", () => {
  assert.equal(clientIpFrom(new Headers({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-vercel-forwarded-for": "   ", "x-forwarded-for": "198.51.100.1" })), "198.51.100.1");
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": ", 10.0.0.1", "x-real-ip": "192.0.2.9" })), "192.0.2.9");
  assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "" })), null);
});

test("clientIpFrom reads any object with a get method", () => {
  assert.equal(clientIpFrom(readerOf({ "x-real-ip": "192.0.2.9" })), "192.0.2.9");
  assert.equal(clientIpFrom(readerOf({})), null);
});

test("ipBucket: an IPv4 address is its own bucket, also out of its IPv4-mapped IPv6 form", () => {
  assert.equal(ipBucket("203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("::FFFF:203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("::ffff:cb00:7107"), "203.0.113.7");
  assert.equal(ipBucket("  203.0.113.7 "), "203.0.113.7");
  // leading zeros are read as decimal, so one host has one bucket
  assert.equal(ipBucket("203.000.113.007"), "203.0.113.7");
});

test("ipBucket: an IPv6 address is cut to its /64, whatever its spelling", () => {
  const expected = "2001:db8:abcd:12::/64";
  assert.equal(ipBucket("2001:db8:abcd:12:1:2:3:4"), expected);
  assert.equal(ipBucket("2001:db8:abcd:12::99"), expected);
  assert.equal(ipBucket("[2001:db8:abcd:12::1]"), expected);
  assert.equal(ipBucket("2001:db8:abcd:12::1%eth0"), expected);
  assert.equal(ipBucket("2001:DB8:ABCD:0012:0000:0000:0000:0001"), expected);
  assert.equal(ipBucket("2001:db8:abcd:12::"), expected);
  assert.equal(ipBucket("::1"), "0:0:0:0::/64");
  assert.equal(ipBucket("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(ipBucket("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(ipBucket("64:ff9b::198.51.100.1"), "64:ff9b:0:0::/64");
});

test("ipBucket: the host part of an IPv6 address never appears in its bucket", () => {
  const bucket = ipBucket("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd");
  assert.equal(bucket, "2001:db8:abcd:12::/64");
  for (const host of ["aaaa", "bbbb", "cccc", "dddd"]) assert.equal(bucket.includes(host), false);
});

test("ipBucket: null and anything unparsable is « unknown »", () => {
  for (const bad of [
    null,
    "",
    "   ",
    "garbage",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "1.2.3.4:443",
    "1::2::3",
    ":::",
    "12345::1",
    "g::1",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6::7:8",
    ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:",
    "1.2.3.4::1",
    "::ffff:1.2.3.4.5",
    "[::1",
    "%eth0",
    "a".repeat(70),
  ]) {
    assert.equal(ipBucket(bad), "unknown", String(bad));
  }
});

test("ipBuckets: narrow is the /64 or the IPv4 address, wide is the IPv6 /48 (SEC-I1)", () => {
  assert.deepEqual(ipBuckets("2001:db8:abcd:12::1"), { narrow: "2001:db8:abcd:12::/64", wide: "2001:db8:abcd::/48" });
  assert.deepEqual(ipBuckets("2001:db8:abcd:99::1"), { narrow: "2001:db8:abcd:99::/64", wide: "2001:db8:abcd::/48" });
  assert.deepEqual(ipBuckets("2001:db8::1"), { narrow: "2001:db8:0:0::/64", wide: "2001:db8:0::/48" });
  assert.deepEqual(ipBuckets("203.0.113.7"), { narrow: "203.0.113.7", wide: null });
  assert.deepEqual(ipBuckets("::ffff:203.0.113.7"), { narrow: "203.0.113.7", wide: null });
  assert.deepEqual(ipBuckets(null), { narrow: "unknown", wide: null });
  assert.deepEqual(ipBuckets("garbage"), { narrow: "unknown", wide: null });
});
