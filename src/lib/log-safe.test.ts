import assert from "node:assert/strict";
import test from "node:test";

import { logSafeMessage } from "./log-safe";

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

test("logSafeMessage masks an address echoed in the body of a Google Calendar error", () => {
  const err = new Error('Google Calendar patch event failed (400): {"error":{"message":"Invalid attendee: marie@example.com"}}');
  assert.equal(
    logSafeMessage(err),
    'Google Calendar patch event failed (400): {"error":{"message":"Invalid attendee: [email]"}}',
  );
});

test("logSafeMessage reads the message of the plain error object Resend returns, and nothing else of it", () => {
  const resendError = { name: "validation_error", message: "Invalid `to` field: marie@example.com", statusCode: 422 };
  assert.equal(logSafeMessage(resendError), "Invalid `to` field: [email]");
  assert.equal(logSafeMessage({ message: 42 }), "unknown error");
  assert.equal(logSafeMessage({ name: "validation_error" }), "unknown error");
  assert.equal(logSafeMessage(null), "unknown error");
});
