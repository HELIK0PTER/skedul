import test from "node:test";
import assert from "node:assert/strict";

import {
  deletionConfirmed,
  parseActivityTab,
  parseBanDuration,
  parseBookingStatus,
  parsePage,
  parsePurchaseStatus,
  parseRange,
  parseUserFilter,
} from "./admin-params";

test("parseUserFilter defaults to all", () => {
  assert.equal(parseUserFilter(undefined), "all");
  assert.equal(parseUserFilter("nope"), "all");
  assert.equal(parseUserFilter("suspended"), "suspended");
});

test("parsePage accepts positive integers only", () => {
  assert.equal(parsePage("3"), 3);
  for (const bad of [undefined, "0", "-2", "2.5", "abc", "99999"]) {
    assert.equal(parsePage(bad), 1, String(bad));
  }
});

test("parseRange accepts 7, 30 or 90 and defaults to 30", () => {
  assert.equal(parseRange("7"), 7);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange("14"), 30);
  assert.equal(parseRange(undefined), 30);
});

test("parseActivityTab defaults to bookings", () => {
  assert.equal(parseActivityTab("purchases"), "purchases");
  assert.equal(parseActivityTab("other"), "bookings");
});

test("status parsers return null for unknown values", () => {
  assert.equal(parseBookingStatus("pending"), "pending");
  assert.equal(parseBookingStatus("paid"), null);
  assert.equal(parsePurchaseStatus("paid"), "paid");
  assert.equal(parsePurchaseStatus(undefined), null);
});

test("status parsers follow the tickets vocabulary", () => {
  assert.equal(parseBookingStatus("expired"), "expired");
  assert.equal(parseBookingStatus("completed"), null);
  assert.equal(parsePurchaseStatus("expired"), "expired");
  assert.equal(parsePurchaseStatus("refunded"), null);
  assert.equal(parseBookingStatus("toString"), null);
});

test("parseBanDuration ignores inherited object keys", () => {
  assert.equal(parseBanDuration("7d"), "7d");
  assert.equal(parseBanDuration("forever"), "forever");
  assert.equal(parseBanDuration("toString"), null);
  assert.equal(parseBanDuration(42), null);
});

test("deletionConfirmed needs the exact email, ignoring case and outer spaces", () => {
  assert.equal(deletionConfirmed("pro@skedul.app", "pro@skedul.app"), true);
  assert.equal(deletionConfirmed("  PRO@Skedul.app ", "pro@skedul.app"), true);
  assert.equal(deletionConfirmed("pro@skedul.ap", "pro@skedul.app"), false);
  assert.equal(deletionConfirmed("", ""), false);
  assert.equal(deletionConfirmed("   ", "pro@skedul.app"), false);
});
