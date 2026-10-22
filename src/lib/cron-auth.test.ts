import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rawErrorLogs } from "@/test/source-guards";

import { CRON_SECRET_MIN_LENGTH, cronAuthorized } from "./cron-auth";

/** 32 characters. */
const SECRET = "0123456789abcdef0123456789ABCDEF";

test("CRON_SECRET_MIN_LENGTH is 32 and the fixture secret has exactly that length", () => {
  assert.equal(CRON_SECRET_MIN_LENGTH, 32);
  assert.equal(SECRET.length, 32);
});

test("cronAuthorized: exactly `Bearer <secret>` of a secret of 32 characters or more is accepted", () => {
  assert.equal(cronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  const long = "k".repeat(64);
  assert.equal(cronAuthorized(`Bearer ${long}`, long), true);
});

test("cronAuthorized: a secret shorter than 32 characters never authorizes, even with the exact header (SEC-M5)", () => {
  const short = SECRET.slice(0, 31);
  assert.equal(cronAuthorized(`Bearer ${short}`, short), false);
  assert.equal(cronAuthorized("Bearer x", "x"), false);
});

test("cronAuthorized: a wrong secret, a missing header and every variant of the scheme are refused", () => {
  const other = "f".repeat(32);
  assert.equal(cronAuthorized(`Bearer ${other}`, SECRET), false, "wrong secret");
  assert.equal(cronAuthorized(`Bearer ${SECRET.slice(0, 31)}`, SECRET), false, "a prefix of the secret");
  assert.equal(cronAuthorized(`Bearer ${SECRET}x`, SECRET), false, "the secret and one more character");
  assert.equal(cronAuthorized(null, SECRET), false, "no header");
  assert.equal(cronAuthorized("", SECRET), false, "empty header");
  assert.equal(cronAuthorized(`bearer ${SECRET}`, SECRET), false, "lower-case scheme");
  assert.equal(cronAuthorized(`BEARER ${SECRET}`, SECRET), false, "upper-case scheme");
  assert.equal(cronAuthorized(`Bearer  ${SECRET}`, SECRET), false, "two spaces");
  assert.equal(cronAuthorized(` Bearer ${SECRET}`, SECRET), false, "leading space");
  assert.equal(cronAuthorized(`Bearer ${SECRET} `, SECRET), false, "trailing space");
  assert.equal(cronAuthorized(`Bearer\t${SECRET}`, SECRET), false, "a tab");
  assert.equal(cronAuthorized(SECRET, SECRET), false, "the secret without its scheme");
  assert.equal(cronAuthorized(`Basic ${SECRET}`, SECRET), false, "another scheme");
});

test("cronAuthorized: an unset, empty or blank secret authorizes nothing, not even an empty bearer", () => {
  assert.equal(cronAuthorized(`Bearer ${SECRET}`, undefined), false);
  assert.equal(cronAuthorized(`Bearer ${SECRET}`, ""), false);
  assert.equal(cronAuthorized("Bearer ", ""), false);
  assert.equal(cronAuthorized("Bearer ", undefined), false);
  assert.equal(cronAuthorized(null, undefined), false);
  const blank = " ".repeat(32);
  assert.equal(cronAuthorized(`Bearer ${blank}`, blank), false, "a blank secret of 32 spaces");
});

test("cronAuthorized: a header of any length is compared without throwing", () => {
  assert.equal(cronAuthorized("x".repeat(10_000), SECRET), false);
  assert.equal(cronAuthorized("é".repeat(40), SECRET), false);
  assert.equal(cronAuthorized(`Bearer ${SECRET}`, "é".repeat(40)), false);
});

test("cronAuthorized compares sha256 digests with timingSafeEqual, never the strings with ===", () => {
  const source = readFileSync("src/lib/cron-auth.ts", "utf8");
  assert.match(source, /timingSafeEqual\(/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.doesNotMatch(source, /[!=]==\s*`Bearer|`Bearer[^`]*`\s*[!=]==/, "the header is never compared as a string");
});

// The route handler imports the db and next, which node:test cannot load: its wiring is pinned on the source.
const ROUTE = readFileSync("src/app/api/cron/daily/route.ts", "utf8");

test("the cron route checks the bearer before it runs the job, with a secret that is configured", () => {
  const at = (needle: string) => {
    const index = ROUTE.indexOf(needle);
    assert.notEqual(index, -1, `${needle} is in the route`);
    return index;
  };
  assert.ok(at("cronAuthorized(") < at("runNightly("), "nothing runs for an unauthorized caller");
  assert.match(ROUTE, /env\.CRON_CONFIGURED \? env\.CRON_SECRET : undefined/, "a missing or placeholder secret leaves the route closed");
  assert.match(ROUTE, /new Response\("Unauthorized", \{ status: 401/);
  assert.match(ROUTE, /export const dynamic = "force-dynamic"/);
  assert.match(ROUTE, /export const maxDuration = 300/);
  assert.match(ROUTE, /"Cache-Control": "no-store"/);
});

test("the cron route answers counts only, 500 when the night had errors, and logs each error without an address (S31)", () => {
  for (const key of [
    "ok",
    "expiredBookings",
    "expiredPurchases",
    "expiredTickets",
    "horizonPros",
    "horizonInserted",
    "archivedEvents",
    "purgedThrottle",
    "invariantViolations",
    "errors: report.errors.length",
  ]) {
    assert.ok(ROUTE.includes(key), `${key} is in the JSON`);
  }
  assert.match(ROUTE, /status: ok \? 200 : 500/);
  assert.match(ROUTE, /logSafeMessage\(\{ message: error \}\)/, "each entry goes through the masking of logSafeMessage");
  assert.deepEqual(rawErrorLogs(ROUTE), [], "no console call receives a raw error object");
  assert.doesNotMatch(ROUTE, /runEffects/, "the nightly job sends nothing (OUT:118), so no mail budget is ever chosen here");
});
