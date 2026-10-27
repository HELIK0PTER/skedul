import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { rawErrorLogs, sourceFilesUnder } from "@/test/source-guards";

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

test("logSafeMessage drops the query parameters of a Drizzle failure: names and phones are not masked, so nothing after « params: » is logged", () => {
  const drizzle = new Error(
    'Failed query: insert into "customer" ("id", "professional_id", "email", "name", "phone") values ($1, $2, $3, $4, $5)\n' +
      "params: c_1,p_1,marie.dupont@example.com,Marie Dupont,+33 6 12 34 56 78",
  );
  const line = logSafeMessage(drizzle);
  assert.equal(line, 'Failed query: insert into "customer" ("id", "professional_id", "email", "name", "phone") values ($1, $2, $3, $4, $5)');
  for (const secret of ["Marie", "Dupont", "+33", "12 34", "example.com", "[email]", "params"]) assert.ok(!line.includes(secret), secret);
  // The word in any case, wherever it sits; the SQL head before it is kept, and the 200-character cap still holds.
  assert.equal(logSafeMessage(new Error("Failed query: select 1 PARAMS: Marie,0612345678")), "Failed query: select 1");
  assert.equal(logSafeMessage(new Error(`Failed query: select ${"x, ".repeat(100)}\nparams: Marie`)).length, 200);
  // Only the word itself: a column or a word that merely contains it is not a cut.
  assert.equal(logSafeMessage(new Error("bad queryparams: value")), "bad queryparams: value");
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

// The whole app, not only the files a plan touched (Task 31 sweep, S31): a raw error object can carry an address, a
// token or the parameters of a failed query in its message, its stack or its cause, so every console call of src/
// logs `logSafeMessage(err)` and ids only (an error boundary logs its digest). scripts/ are developer commands that
// print to the developer's own terminal, not request logs: they are not read.
test("no console call of any source file under src/ prints a raw error object", () => {
  const hits = sourceFilesUnder("src").flatMap((file) =>
    rawErrorLogs(readFileSync(file, "utf8")).map((call) => `${file}: ${call.replace(/\s+/g, " ")}`),
  );
  assert.deepEqual(hits, []);
});
