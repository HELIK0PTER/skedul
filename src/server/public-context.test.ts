/**
 * Wiring guard for src/server/public-context.ts (contract § 1 Effects, Decisions 3, 74 and 75, S49). The module
 * imports next/cache, next/navigation, next/server and the process db, which the node:test runner cannot load, so
 * the wiring is pinned on the source: the rules themselves are tested in src/lib/public/run-action.test.ts.
 * Pattern of src/server/pro-context.test.ts. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/server/public-context.ts", "utf8");
/** The source without comments: a sentence in a doc comment is never counted as a call. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The text of `marker` up to the next top-level doc comment. */
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

test("S49: every effect run of this file is runEffects(effects, \"none\"), never the pro's budget (Decision 74)", () => {
  const calls = [...CODE.matchAll(/runEffects\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(calls, ['effects, "none"'], 'one runEffects call, in the scheduler, with the "none" budget');
  assert.doesNotMatch(CODE, /["']pro["']/, 'no "pro" budget anywhere in the code');
  const scheduler = sectionOf("function scheduleEffects");
  assert.match(scheduler, /after\(\(\) => runEffects\(effects, "none"\)\)/);
});

test("S49: runPublicAction and runClientAction both schedule through the scheduler, and only through it", () => {
  assert.match(sectionOf("export async function runPublicAction"), /schedule: scheduleEffects/);
  assert.match(sectionOf("export async function runClientAction"), /schedule: scheduleEffects/);
  assert.equal(CODE.match(/schedule:/g)?.length, 2, "no other scheduler is wired");
});

test("both wrappers are thin: they hand the real dependencies to the tested bodies and add no logic", () => {
  const publicBody = sectionOf("export async function runPublicAction");
  assert.match(publicBody, /runPublicActionWith</);
  assert.match(publicBody, /resolvePro: async \(slug\) => \(await resolvePublicPro\(slug\)\)\?\.pro \?\? null/);
  assert.match(publicBody, /visitor: \(pro, now\) => actionVisitor\(pro, now\)/);
  const clientBody = sectionOf("export async function runClientAction");
  assert.match(clientBody, /runClientActionWith</);
  assert.match(clientBody, /session: currentSessionFacts/);
  for (const body of [publicBody, clientBody]) {
    assert.match(body, /revalidate: revalidatePublic/);
    assert.match(body, /rethrowIfControlFlow: unstable_rethrow/);
    assert.match(body, /log: \(line\) => console\.error\(line\)/);
    assert.match(body, /info: \(line\) => console\.info\(line\)/);
    assert.match(body, /now: \(\) => new Date\(\)/);
    assert.doesNotMatch(body, /\bif \(|\btry \{|\bcatch\b/, "no branching of its own");
  }
});

test("revalidation covers every PUBLIC_REVALIDATE target and nothing else", () => {
  const body = sectionOf("function revalidatePublic");
  assert.match(body, /for \(const target of PUBLIC_REVALIDATE\) revalidatePath\(target\.path, target\.type\)/);
});

test("actionVisitor builds the visitor on the server: fresh facts, cached visitor, IP hashes; the Owner is read, never linked", () => {
  const body = sectionOf("export async function actionVisitor");
  assert.match(body, /currentSessionFacts\(\)/);
  assert.match(body, /currentPublicVisitor\(pro\.professionalId, pro\.ownerUserId\)/);
  assert.match(body, /visitorIpHashes\(now\)/);
  assert.match(body, /owner: visitor\.owner,/);
  assert.doesNotMatch(CODE, /\bgetSession\b/, "only the fresh reads of visitor.ts may read a session");
});

test("no write happens before the core has validated and throttled: this file links no account (Revision 3.2)", () => {
  // linkCustomerUser runs inside bookWithHeldTicketCore, after parseFr and checkActionThrottle (Task 10): nothing here may write the link
  assert.doesNotMatch(CODE, /linkCustomerUser|requireWalletOwner|linkOwner/);
  assert.doesNotMatch(sectionOf("export async function actionVisitor"), /await\s+(?!Promise\.all)/, "actionVisitor only reads, through Promise.all");
  assert.doesNotMatch(sectionOf("export async function runPublicAction"), /\bopts\b/, "no per-action option can switch a write on in the wrapper");
});

test("publicDeps takes the app URL, the gateway, the one mock rule and APP_ENV from the server, never from input", () => {
  const body = sectionOf("export function publicDeps");
  assert.match(body, /appUrl: env\.APP_URL/);
  assert.match(body, /checkout: checkoutGateway/);
  assert.match(body, /mockAllowed: mockCheckoutEnabled\(\)/);
  assert.match(body, /env: env\.APP_ENV/);
});

test("resolvePublicPro hands a pro and its branding fields only: no user id, Stripe id or Google id reaches the branding", () => {
  const body = sectionOf("export async function resolvePublicPro");
  assert.match(body, /getPublicProfile\(slug, opts\)/);
  assert.match(body, /publicPageProfileOfRow\(profile\.pro\)/, "the same projection as the /[slug] page (G4a)");
  assert.doesNotMatch(body, /\b(userId|stripeAccountId|googleCalendarId)\b/, "the row's private fields are not named here at all");
});
