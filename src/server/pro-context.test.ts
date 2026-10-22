/**
 * Wiring guard for src/server/pro-context.ts. The module imports next/cache and
 * next/navigation, which the node:test runner cannot load, so the wiring is
 * pinned on the source: the decisions themselves (actingSession, the log line)
 * have their own pure tests. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rawErrorLogs } from "@/test/source-guards";

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

test("requireProContext carries the impersonating admin in the context, runProAction logs each successful action of one (SEC-6)", () => {
  assert.match(bodyOf("requireProContext"), /impersonatedBy: session\.session\.impersonatedBy \?\? null/);
  const run = bodyOf("runProAction");
  assert.match(run, /impersonationLogLine\(name, ctx\)/);
  // After the failure return: a refused or failed action leaves no « done » line.
  assert.ok(run.indexOf("if (!res.ok) return res;") < run.indexOf("impersonationLogLine"), "logged on success only");
});

test("a signed-in user without a pro page goes to /mon-espace, never to the pro onboarding (L1396)", () => {
  for (const name of ["requireProfessional", "requireProContext"]) {
    const body = bodyOf(name);
    assert.match(body, /if \(!pro\) redirect\("\/mon-espace"\);/, `${name}: no pro page sends to the client space`);
    assert.match(body, /redirect\("\/sign-in"\)/, `${name}: no session still sends to /sign-in`);
    assert.doesNotMatch(body, /\/onboarding/, `${name}: the onboarding is reached through « Vous êtes pro ? » and the sign-up funnel only`);
  }
  // The dashboard layout and the private guard of the pro actions follow the same rule.
  const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
  assert.match(layout, /if \(!pro\) redirect\("\/mon-espace"\);/);
  assert.doesNotMatch(layout, /\/onboarding/);
  const pro = readFileSync("src/server/pro.ts", "utf8");
  assert.match(pro, /async function requirePro\(\) \{[^}]*redirect\("\/mon-espace"\)/);
  assert.doesNotMatch(pro, /redirect\("\/onboarding"\)/);
});

test("runProAction is the one caller that spends the pro's mail budget: runEffects(effects, \"pro\") (Decision 74, FR:SEC-1)", () => {
  assert.match(bodyOf("runProAction"), /after\(\(\) => runEffects\(effects, "pro"\)\)/);
  assert.doesNotMatch(SOURCE, /runEffects\(effects, "none"\)/, "the client-initiated paths live in public-context.ts");
});

// The raw-error detector is the shared `rawErrorLogs` of `src/test/source-guards.ts` (G2b sweep): it reads every
// `console.log|info|warn|error(...)` call and reports an identifier bound to a caught error, `.stack`, `String(err)` or a
// template interpolation outside `logSafeMessage(...)`; its own positive and negative cases are tested there.
const PRO_SIDE_FILES = [
  "src/server/pro-context.ts",
  "src/server/pro.ts",
  "src/app/dashboard/layout.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/planning/page.tsx",
];

test("no console call of the pro-side files prints a raw error object: a stack can carry an address or a token (P3 carry, S31)", () => {
  const hits = PRO_SIDE_FILES.flatMap((file) =>
    rawErrorLogs(readFileSync(file, "utf8")).map((call) => `${file}: ${call.replace(/\s+/g, " ")}`),
  );
  assert.deepEqual(hits, []);
});
