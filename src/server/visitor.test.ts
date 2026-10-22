/**
 * Wiring guard for src/server/visitor.ts (contract § 1, Decision 75, S51). The module imports next/headers and
 * the process db, which the node:test runner cannot load, so the wiring is pinned on the source: the decisions
 * themselves have their own tests (identity.test.ts, identity.db.test.ts, suspension.test.ts). Pattern of
 * src/server/pro-context.test.ts. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/server/visitor.ts", "utf8");

/** The text from `marker` up to the next top-level doc comment. */
function sectionOf(marker: string): string {
  const start = SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `${marker} is declared`);
  const end = SOURCE.indexOf("\n/**", start);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

test("the file is server-only and is not a Server Functions file (every export of one is a public endpoint)", () => {
  assert.match(SOURCE, /^import "server-only";/m);
  assert.doesNotMatch(SOURCE, /^["']use server["']/m);
});

test("currentSessionFacts reads the session fresh through actingSession (S51: no cookie cache, a suspended user is no session)", () => {
  const body = sectionOf("export async function currentSessionFacts");
  assert.match(body, /sessionFactsOf\(\s*actingSession\(\s*await getFreshSession\(\)/);
  assert.doesNotMatch(body, /\bgetSession\b/);
});

test("the cached 5-minute session read is not used anywhere in the file", () => {
  assert.doesNotMatch(SOURCE, /\bgetSession\b/, "only getFreshSession may read a session here");
  assert.doesNotMatch(SOURCE, /disableCookieCache\s*:\s*false/);
});

test("visitorIpHashes hashes the bucket of the client address, never the raw address, with the daily salt", () => {
  const body = sectionOf("export async function visitorIpHashes");
  assert.match(body, /ipBuckets\(clientIpFrom\(await headers\(\)\)\)/);
  assert.match(body, /getDailySalt\(dayKeyInTz\(now, ADMIN_TZ\)\)/);
  assert.match(body, /ipHash\(salt, narrow\)/);
  assert.match(body, /wide === null \? null : ipHash\(salt, wide\)/);
  assert.doesNotMatch(SOURCE, /x-forwarded-for|x-real-ip/i, "the header names live in client-ip.ts only");
});

test("currentPublicVisitor is cached per request and builds the visitor from the fresh facts, the guest cookie and the guest key", () => {
  const body = sectionOf("export const currentPublicVisitor");
  assert.match(body, /=\s*cache\(/);
  assert.match(body, /currentSessionFacts\(\)/);
  assert.match(body, /\(await cookies\(\)\)\.get\(GUEST_COOKIE\)\?\.value/);
  assert.match(body, /guestKey\(\)/);
  assert.match(body, /resolveVisitor\(/);
});

test("the file declares no writer of the wallet Owner: the Owner is linked by its core, after parseFr and the throttle (Revision 3.2)", () => {
  assert.doesNotMatch(SOURCE, /linkCustomerUser/, "visitor.ts never writes customer.user_id");
  assert.doesNotMatch(SOURCE, /WalletOwner/, "no helper returns an Owner: it is the owner field of the visitor");
});

/** Every .ts and .tsx file under `dir`, test files excluded, with forward slashes. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("no file under src outside the test files names requireWalletOwner (a writer that wrappers could call before their core parses and throttles)", () => {
  const files = sourceFilesUnder("src");
  assert.ok(files.length > 200, `the scan found the sources (${files.length})`);
  assert.ok(files.includes("src/server/visitor.ts") && files.includes("src/lib/booking/claims.ts"), "the scan reaches the visitor and the engine claims");
  const offenders = files.filter((file) => /requireWalletOwner/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
