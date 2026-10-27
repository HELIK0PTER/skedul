/**
 * Source guard for the public read wrappers (G4a, Item 4; the Task 23 design note « one clock per request »). The
 * wrappers of `src/server/public-queries.ts` bind `db` to the testable cores and take the request's instant from the
 * page, which reads the clock once and hands it to every read and to `seanceState`, `toPublicSeanceVM` and
 * `planningEmptyState`: a wrapper that took its own `new Date()` could disagree with the page about « now » (a séance
 * the planning lists as open and the page states as past) around a minute boundary. The file imports `server-only` and
 * `@/lib/db`, which node:test cannot load, so it is pinned on its source (the pattern of src/server/visitor.test.ts).
 * Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const SOURCE = readFileSync("src/server/public-queries.ts", "utf8");

/**
 * Each wrapper that reads with the clock, and the core call that receives the instant it was given, as the one
 * statement of its body: `return safeRead(() => <core>(…, now));` (P4 final review RND-1, src/server/safe-read.test.ts).
 */
const WITH_CLOCK: readonly { name: string; passes: RegExp }[] = [
  { name: "getPlanningPage", passes: /return safeRead\(\(\) => listPublicSeances\(db, pro, range, now\)\);/ },
  { name: "getNextSeanceStart", passes: /return safeRead\(\(\) => nextPublicSeanceStart\(db, pro, after, now\)\);/ },
  {
    name: "getHorizonNeed",
    passes: /return safeRead\(async \(\) => needsHorizon\(await minGeneratedUntil\(db, pro\.professionalId, now\), now, pro\.timezone\)\);/,
  },
  { name: "getSeancePage", passes: /return safeRead\(\(\) => getPublicSeance\(db, pro, occurrenceId, now\)\);/ },
  { name: "getSeanceVisitorFacts", passes: /return safeRead\(\(\) => seanceVisitorFacts\(db, professionalId, occurrenceId, viewer, now\)\);/ },
  { name: "getLivePendingHolds", passes: /return safeRead\(\(\) => livePendingHoldsOf\(db, professionalId, customerId, now\)\);/ },
  { name: "getPurchaseReference", passes: /return safeRead\(\(\) => purchaseByReference\(db, professionalId, purchaseId, now\)\);/ },
];

/** The wrappers that read nothing time-dependent and take no instant. */
const WITHOUT_CLOCK = ["getBoutiquePage", "getOfferPage"] as const;

test("no wrapper takes its own clock: the file never reads new Date() or Date.now()", () => {
  assert.doesNotMatch(codeView(SOURCE), /new Date\(|Date\.now\(/);
});

test("every wrapper that reads with the clock takes `now: Date` as its last parameter and hands it to the core", () => {
  for (const { name, passes } of WITH_CLOCK) {
    const body = bodyOf(SOURCE, name);
    assert.match(body, /\bnow: Date,?\s*\)/, `${name} takes now: Date as its last parameter`);
    assert.match(body, passes, `${name} hands that instant to the core`);
  }
});

test("the wrappers without a clock stay without one: the Boutique and the offer read nothing time-dependent", () => {
  for (const name of WITHOUT_CLOCK) {
    const body = bodyOf(SOURCE, name);
    assert.doesNotMatch(body, /\bnow\b/, `${name} takes no instant`);
  }
});

test("the guard can fail: a wrapper without `now` or with its own clock is refused by the patterns above", () => {
  const signature = /\bnow: Date,?\s*\)/;
  assert.match("export function f(pro: PublicPro, range: R, now: Date): Promise<X> {", signature);
  assert.match("export function f(\n  a: string,\n  now: Date,\n): Promise<X> {", signature);
  assert.doesNotMatch("export function f(pro: PublicPro, range: R): Promise<X> {", signature);
  assert.match(codeView("const now = new Date();"), /new Date\(/);
  assert.doesNotMatch(codeView("// the request's new Date()\nconst s = 'Date.now()';"), /new Date\(|Date\.now\(/);
});
