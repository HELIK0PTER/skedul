import test from "node:test";
import assert from "node:assert/strict";

import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, guestLinkKey, signGuestLink, verifyGuestLink } from "./guest-link";

const KEY = guestLinkKey("test-secret-0123456789abcdefghijklmnop");
const LINK = { customerId: "V1StGXR8_Z5jdHi6B-myT", linkVersion: 3 };

test("constants", () => {
  assert.equal(GUEST_COOKIE, "skedul_guest");
  assert.equal(GUEST_COOKIE_MAX_AGE, 2_592_000);
});

test("a signed link verifies and round-trips", () => {
  const token = signGuestLink(LINK, KEY);
  assert.match(token, /^V1StGXR8_Z5jdHi6B-myT\.3\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(verifyGuestLink(token, KEY), LINK);
  assert.equal(signGuestLink(LINK, KEY), token);
});

test("the key depends on the secret", () => {
  assert.equal(guestLinkKey("a").length, 32);
  assert.notDeepEqual(guestLinkKey("a"), guestLinkKey("b"));
  const token = signGuestLink(LINK, guestLinkKey("other-secret"));
  assert.equal(verifyGuestLink(token, KEY), null);
});

test("tampering with any part is refused", () => {
  const token = signGuestLink(LINK, KEY);
  const [id, version, mac] = token.split(".");
  const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
  assert.equal(verifyGuestLink(`${id}.${version}.${flipped}`, KEY), null);
  assert.equal(verifyGuestLink(`${id}.4.${mac}`, KEY), null);
  assert.equal(verifyGuestLink(`${id}x.${version}.${mac}`, KEY), null);
  assert.equal(verifyGuestLink(`${id}.${version}.${mac}A`, KEY), null);
});

test("a bumped link_version yields a different token (revocation is the caller's comparison)", () => {
  const v3 = signGuestLink(LINK, KEY);
  const v4 = signGuestLink({ ...LINK, linkVersion: 4 }, KEY);
  assert.notEqual(v3, v4);
  assert.deepEqual(verifyGuestLink(v4, KEY), { ...LINK, linkVersion: 4 });
});

test("malformed tokens are refused", () => {
  const mac = signGuestLink(LINK, KEY).split(".")[2];
  for (const bad of [
    "",
    "abc",
    `${LINK.customerId}.${mac}`,
    `${LINK.customerId}.3.${mac}.x`,
    `${LINK.customerId}.0.${mac}`,
    `${LINK.customerId}.03.${mac}`,
    `${LINK.customerId}.-3.${mac}`,
    `${LINK.customerId}.3.5.${mac}`,
    `${LINK.customerId}.abc.${mac}`,
    `.3.${mac}`,
    `${LINK.customerId}.3.`,
    `${LINK.customerId}.3.${mac.slice(0, 20)}+/`,
  ]) {
    assert.equal(verifyGuestLink(bad, KEY), null, bad);
  }
});
