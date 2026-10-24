/**
 * Source guard for the consumers of `getSeanceVisitorFacts` (Task 24 controller ruling, Decision 63, S35; G4a). For a
 * guest cookie the facts carry `bookingId` and `coverage` because the contract's type requires them; a page that hands
 * either to a client component would give a planted cookie a booking id to act on. `purchaseId` and `resumeUrl` are the
 * Owner's: null in a guest's facts by construction (seance-reads.db.test.ts), and the page reads them from the facts it
 * narrowed to the Owner (`ownerFacts`), never from the raw facts, which may be a guest's. The customer ids of the viewer
 * never become a prop. The séance pages (Tasks 26 to 28) read the facts server-side and pass picked values: a status, a
 * flag, never the booking object. This guard scans every source file that calls `getSeanceVisitorFacts`, wherever it
 * lives, so it needs no path; and it cannot pass forever by finding nobody: it checks that the wrapper still exists
 * under that name (a rename fails it) and that, once the séance page file exists, that page is among the consumers.
 * Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView, sourceFilesUnder } from "@/test/source-guards";

/** The one file that defines the wrapper: it is the server-side seam, not a consumer. */
const DEFINITION = "src/server/public-queries.ts";
/** The first consumer (Task 26 creates it): from the day this file exists, the scan must find it. */
const SEANCE_PAGE = "src/app/[slug]/seance/[occurrenceId]/page.tsx";

/** Named anywhere in a consumer: a guest's facts carry both, and no page needs either (the cancel control lives on the espace). */
const NEVER_NAMED = /\b(bookingId|coverage)\b/;
/** `facts.booking.purchaseId`, `facts?.booking?.resumeUrl`: read off the raw facts, which may be a guest's. `ownerFacts` is the narrowed name. */
const OWNER_ONLY_OFF_RAW_FACTS = /\bfacts\s*\??\.\s*booking\s*\??\.\s*(purchaseId|resumeUrl)\b/;
/** `{...facts}` or `{...facts.booking}` or `{...booking}`: a spread carries the id without naming it. */
const SPREAD = /\.\.\.\s*[\w.?]*(?:[fF]acts|booking)\b/;
/** `prop={facts}` or `prop={facts.booking}`: the whole object (id included) as a prop. */
const WHOLE_AS_PROP = /=\{\s*[\w.?]*[fF]acts(?:\??\.booking)?\s*\}/;
/** `customerId={...}`, `guestCustomerId={...}`: a customer id as a prop. */
const CUSTOMER_ID_PROP = /\b(customerId|guestCustomerId|ownerCustomerId)\s*=\s*\{/;
/** `{...customerViewer}` or `{...owner}`: a spread carries the customer id without naming it. */
const VIEWER_SPREAD = /\.\.\.\s*(?:customerViewer|viewer|owner|visitor)\b/;
/** `prop={customerViewer}` or `prop={owner}`: the viewer (customer id included) as a prop. */
const VIEWER_AS_PROP = /=\{\s*(?:customerViewer|viewer|owner|visitor)\s*\}/;

/** Why this source could hand a private field of a guest's facts (or the viewer's customer id) to a client component; empty when it cannot. */
function leaksOf(source: string): string[] {
  const code = codeView(source);
  const leaks: string[] = [];
  const never = NEVER_NAMED.exec(code);
  if (never) leaks.push(`names ${never[1]}`);
  const owned = OWNER_ONLY_OFF_RAW_FACTS.exec(code);
  if (owned) leaks.push(`reads ${owned[1]} off the raw facts (only the Owner's facts carry it)`);
  if (SPREAD.test(code)) leaks.push("spreads the facts or their booking");
  if (WHOLE_AS_PROP.test(code)) leaks.push("passes the facts or their booking whole as a prop");
  const customer = CUSTOMER_ID_PROP.exec(code);
  if (customer) leaks.push(`passes ${customer[1]} as a prop`);
  if (VIEWER_SPREAD.test(code)) leaks.push("spreads the viewer");
  if (VIEWER_AS_PROP.test(code)) leaks.push("passes the viewer whole as a prop");
  return leaks;
}

/** Why the consumer list cannot be trusted (null when it can): empty while the séance page exists means the wrapper is no longer found by its name. */
function emptyScanProblem(consumers: readonly string[], seancePageExists: boolean): string | null {
  if (seancePageExists && !consumers.includes(SEANCE_PAGE)) {
    return `${SEANCE_PAGE} exists but does not call getSeanceVisitorFacts (renamed, or the page stopped reading the facts): the scan would pass forever`;
  }
  return null;
}

/** The files, other than the definition, whose code calls the wrapper. */
function consumersOf(paths: readonly string[]): string[] {
  return paths.filter((path) => path !== DEFINITION && /\bgetSeanceVisitorFacts\b/.test(codeView(readFileSync(path, "utf8"))));
}

test("the guard can fail: it names a booking id, a coverage, an owner-only field off the raw facts, a spread and a whole booking passed as a prop", () => {
  assert.deepEqual(leaksOf("const id = facts?.booking?.bookingId;"), ["names bookingId"]);
  assert.deepEqual(leaksOf("const c = facts.booking.coverage;"), ["names coverage"]);
  assert.deepEqual(leaksOf("const p = facts?.booking?.purchaseId;"), ["reads purchaseId off the raw facts (only the Owner's facts carry it)"]);
  assert.deepEqual(leaksOf("const u = facts.booking.resumeUrl;"), ["reads resumeUrl off the raw facts (only the Owner's facts carry it)"]);
  assert.deepEqual(leaksOf("<Booked {...facts.booking} />"), ["spreads the facts or their booking"]);
  assert.deepEqual(leaksOf("<Booked {...facts} />"), ["spreads the facts or their booking"]);
  assert.deepEqual(leaksOf("<Booked booking={facts.booking} />"), ["passes the facts or their booking whole as a prop"]);
  assert.deepEqual(leaksOf("<Booked data={facts} />"), ["passes the facts or their booking whole as a prop"]);
  assert.deepEqual(leaksOf("<Booked data={ownerFacts?.booking} />"), ["passes the facts or their booking whole as a prop"]);
});

test("the guard can fail on the viewer's customer ids too: a prop, a spread, the viewer whole", () => {
  assert.deepEqual(leaksOf("<Leaf customerId={customerViewer.customerId} />"), ["passes customerId as a prop"]);
  assert.deepEqual(leaksOf("<Leaf guestCustomerId={visitor.guestCustomerId} />"), ["passes guestCustomerId as a prop"]);
  assert.deepEqual(leaksOf("<Leaf {...customerViewer} />"), ["spreads the viewer"]);
  assert.deepEqual(leaksOf("<Leaf {...owner} />"), ["spreads the viewer"]);
  assert.deepEqual(leaksOf("<Leaf viewer={customerViewer} />"), ["passes the viewer whole as a prop"]);
  assert.deepEqual(leaksOf("<Leaf who={owner} />"), ["passes the viewer whole as a prop"]);
});

test("the guard lets picked values, the Owner's narrowed facts and prose through", () => {
  const picked = [
    "// The guest cookie's bookingId and coverage never reach a prop, nor does anybody's customerId.",
    "/* bookingId */",
    'const note = "bookingId coverage";',
    "const booked = customerViewer?.source === 'owner' && facts?.booking ? { status: facts.booking.status, via: 'owner' } : null;",
    "const ownerFacts = customerViewer?.source === 'owner' ? facts : null;",
    "const ownerPurchaseId = ownerFacts?.booking?.status === 'pending' ? ownerFacts.booking.purchaseId : null;",
    "const usable = facts?.usable ?? null;",
    "const facts = customerViewer ? await getSeanceVisitorFacts(pro.professionalId, id, customerViewer) : null;",
    "<OccurrenceBooking canSpend={usable !== null} leftAfter={usable?.leftAfter ?? 0} />",
    "<GuestNote show={guestBooked} />",
    "<VisitorBar state={visitor.state} hasGuestSpace={visitor.guestCustomerId !== null} />",
  ].join("\n");
  assert.deepEqual(leaksOf(picked), []);
});

test("the guard cannot pass forever by finding nobody: once the séance page exists it must be a consumer", () => {
  assert.equal(emptyScanProblem([], false), null, "before Task 26 nobody consumes the facts yet");
  assert.match(emptyScanProblem([], true) ?? "", /exists but does not call getSeanceVisitorFacts/);
  assert.match(emptyScanProblem(["src/app/other/page.tsx"], true) ?? "", /exists but does not call/);
  assert.equal(emptyScanProblem([SEANCE_PAGE], true), null);
  assert.equal(emptyScanProblem([SEANCE_PAGE, "src/app/other/page.tsx"], true), null);
});

test("the wrapper still exists under the name the scan looks for, and nothing renamed it away (a rename would empty the scan)", () => {
  const definition = readFileSync(DEFINITION, "utf8");
  assert.ok(bodyOf(definition, "getSeanceVisitorFacts").length > 0, "bodyOf throws when the function is not exported under that name");
});

test("no consumer of getSeanceVisitorFacts names a booking id or a coverage, reads an owner-only field off the raw facts, spreads the facts or hands the facts or a customer id to a prop", () => {
  const consumers = consumersOf(sourceFilesUnder("src"));
  assert.equal(emptyScanProblem(consumers, existsSync(SEANCE_PAGE)), null);
  for (const path of consumers) {
    assert.deepEqual(leaksOf(readFileSync(path, "utf8")), [], `${path} hands a private field of a guest's facts to a client component`);
  }
});
