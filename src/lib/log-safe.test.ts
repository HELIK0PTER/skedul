import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { rawErrorLogs, sourceFilesUnder } from "@/test/source-guards";

import { holdsLogSecret, logSafeMessage, scrubLogText } from "./log-safe";

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

test("logSafeMessage masks a percent-encoded address and every address of a joined list, domains included (P6 A7)", () => {
  // An address in a URL (a callback, a query string) is written with %40; the whole word goes, as with « @ ».
  assert.equal(logSafeMessage(new Error("GET /api/x?email=marie.dupont%40example.com&step=2 failed")), "GET [email] failed");
  assert.equal(logSafeMessage(new Error("to MARIE%40EXAMPLE.COM")), "to [email]");
  // A list joined by commas or semicolons, the second domain too.
  for (const list of ["a@b.com,c@d.org", "a@b.com;c@d.org", "a%40b.com,c%40d.org", "a@b.com,c%40d.org"]) {
    const line = logSafeMessage(new Error(`Invalid \`to\` field: ${list}`));
    assert.equal(line, "Invalid `to` field: [email]", list);
    for (const part of ["b.com", "d.org", "%40"]) assert.ok(!line.includes(part), `${list}: ${part}`);
  }
  assert.equal(scrubLogText("to a@b.com, c@d.org\n"), "to [email] [email]\n", "spacing and lines kept");
});

test("holdsLogSecret names a percent-encoded address, and still not a package path (P6 A7)", () => {
  assert.equal(holdsLogSecret("GET /callback?email=marie%40example.com"), true);
  assert.equal(holdsLogSecret("to MARIE%40EXAMPLE.COM"), true);
  assert.equal(holdsLogSecret("    at f (/var/task/node_modules/next%4016.2.9/dist/x.js:1:2)"), false, "a version is not a domain");
  assert.equal(holdsLogSecret("progress 40%40 done"), false);
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

test("logSafeMessage never throws: an Error whose message is not a string, or a value it cannot read, is « unknown error » (P4 final review RND-1)", () => {
  assert.equal(logSafeMessage(Object.assign(new Error("x"), { message: 42 })), "unknown error");
  assert.equal(logSafeMessage({ message: 42 }), "unknown error");
  const revoked = Proxy.revocable(new Error("marie@example.com"), {});
  revoked.revoke();
  assert.equal(logSafeMessage(revoked.proxy), "unknown error");
  const getter = {};
  Object.defineProperty(getter, "message", { get: () => assert.fail("a message that throws") });
  assert.equal(logSafeMessage(getter), "unknown error");
});

test("scrubLogText makes the same cut and masks as logSafeMessage, and keeps the lines and the spacing (P4 final review RND-1)", () => {
  const stack = "DrizzleQueryError: Failed query: select 1 where email = $1\nparams: marie@example.com,Marie\n    at x (a.js:1:2)";
  assert.equal(scrubLogText(stack), "DrizzleQueryError: Failed query: select 1 where email = $1\n");
  assert.equal(scrubLogText("to  marie@example.com\n  via /api/c/abc.1.def\tcs_live_9Z"), "to  [email]\n  via /api/c/[token]\t[session]");
  assert.equal(scrubLogText("nothing\n  here"), "nothing\n  here");
});

test("holdsLogSecret names a params tail, a real address, a personal link or a session id, and not a package path", () => {
  for (const text of [
    "Failed query: select 1\nparams: Marie",
    "x PARAMS: y",
    "mail to marie@example.com",
    "Key (email)=(marie@sub.example.co.uk) already exists.",
    "GET /api/c/abc.1.def",
    "cs_test_a1B2c3",
  ]) {
    assert.equal(holdsLogSecret(text), true, text);
  }
  for (const text of [
    "    at f (/var/task/node_modules/.pnpm/next@16.2.9_react-dom@19.2.0/node_modules/next/dist/x.js:1:2)",
    "node_modules/@better-auth+core@1.6.19_@b_55/node_modules/@better-auth/core/dist/env/logger.mjs",
    "queryparams: x",
    "plain line",
  ]) {
    assert.equal(holdsLogSecret(text), false, text);
  }
  // No state is kept between calls (the patterns are shared): the same text answers the same twice.
  assert.equal(holdsLogSecret("GET /api/c/abc"), true);
  assert.equal(holdsLogSecret("GET /api/c/abc"), true);
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
