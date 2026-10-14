import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "./booking/types";
import { dedupeEffects, logSafeMessage } from "./notify-core";

const changed = (bookingIds: string[]): Effect => ({ type: "email.occurrence_changed", occurrenceId: "o1", bookingIds });
const sync = (occurrenceId: string): Effect => ({ type: "google.sync_occurrence", occurrenceId });
const confirmed: Effect = { type: "email.booking_confirmed", bookingId: "b1" };
const expire: Effect = { type: "stripe.expire_session", purchaseId: "p1", checkoutSessionId: "cs_test_1" };

test("dedupeEffects collapses e-mails whose bookingIds only differ by order and keeps the first one as it was", () => {
  const out = dedupeEffects([changed(["b2", "b1"]), changed(["b1", "b2"])]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], changed(["b2", "b1"]));
});

test("dedupeEffects puts the Google syncs last and keeps the first-seen order otherwise", () => {
  const out = dedupeEffects([sync("o1"), confirmed, sync("o2"), expire, sync("o1"), confirmed]);
  assert.deepEqual(out, [confirmed, expire, sync("o1"), sync("o2")]);
});

test("dedupeEffects keeps effects that differ by any field", () => {
  const effects: Effect[] = [
    { type: "email.booking_cancelled", bookingId: "b1", by: "pro" },
    { type: "email.booking_cancelled", bookingId: "b1", by: "client" },
    { type: "email.occurrence_changed", occurrenceId: "o1", bookingIds: ["b1"] },
    { type: "email.occurrence_changed", occurrenceId: "o2", bookingIds: ["b1"] },
    { type: "email.occurrence_cancelled", occurrenceId: "o1", bookingIds: ["b1"] },
    { type: "stripe.expire_session", purchaseId: "p1", checkoutSessionId: "cs_1" },
    { type: "stripe.expire_session", purchaseId: "p2", checkoutSessionId: "cs_2" },
  ];
  assert.deepEqual(dedupeEffects(effects), effects);
});

test("dedupeEffects does not touch its input and accepts an empty list", () => {
  const first = changed(["b2", "b1"]);
  const input = [first, changed(["b1", "b2"])];
  dedupeEffects(input);
  assert.equal(input.length, 2);
  assert.deepEqual(first, changed(["b2", "b1"]));
  assert.deepEqual(dedupeEffects([]), []);
});

test("logSafeMessage hides e-mail addresses, personal-link tokens and Checkout session ids", () => {
  assert.equal(logSafeMessage(new Error("boom for marie@example.com")), "boom for [email]");
  assert.equal(
    logSafeMessage(new Error("GET https://app.test/api/c/abc.1.def_ghi failed")),
    "GET https://app.test/api/c/[token] failed",
  );
  assert.equal(
    logSafeMessage(new Error("No such checkout.session: 'cs_test_a1B2c3'")),
    "No such checkout.session: '[session]'",
  );
});

test("logSafeMessage gives one short line and survives a non-Error", () => {
  assert.equal(logSafeMessage(new Error("a\n  b\tc")), "a b c");
  assert.equal(logSafeMessage(new Error("x".repeat(500))).length, 200);
  assert.equal(logSafeMessage("plain string"), "unknown error");
  assert.equal(logSafeMessage(undefined), "unknown error");
});
