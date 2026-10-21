/**
 * Wiring guard for src/server/pro-context.ts. The module imports next/cache and
 * next/navigation, which the node:test runner cannot load, so the wiring is
 * pinned on the source: the decisions themselves (actingSession, the log line)
 * have their own pure tests. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/server/pro-context.ts", "utf8");

/** The text of `export async function <name>` up to the next top-level doc comment. */
function bodyOf(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} is exported`);
  const end = SOURCE.indexOf("\n/**", start);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

test("requireProContext reads the session fresh and refuses a suspended user like no session (SEC-2)", () => {
  const body = bodyOf("requireProContext");
  assert.match(body, /getFreshSession\(\)/, "no 5-minute cookie cache on a pro write");
  assert.doesNotMatch(body, /\bgetSession\(\)/, "the cached read is not used to authorise");
  assert.match(body, /actingSession\(/, "a suspended user is refused");
  assert.match(body, /redirect\("\/sign-in"\)/, "with the redirect of no session");
});
