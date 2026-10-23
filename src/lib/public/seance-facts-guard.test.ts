/**
 * Source guard for the consumers of `getSeanceVisitorFacts` (Task 24 controller ruling, Decision 63, S35). For a guest
 * cookie the facts carry `bookingId` and `coverage` only because the contract's type requires them; a page that hands
 * either to a client component would give a planted cookie a booking id to act on. The séance pages (Tasks 25b to 28)
 * read the facts server-side and pass picked values: a status, a flag, never the booking object. This guard scans every
 * source file that calls `getSeanceVisitorFacts`, wherever it lives, so it needs no path and starts to bite with the
 * first page that does. Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView, sourceFilesUnder } from "@/test/source-guards";

/** The one file that defines the wrapper: it is the server-side seam, not a consumer. */
const DEFINITION = "src/server/public-queries.ts";

const BOOKING_ID = /\bbookingId\b/;
/** `{...facts}` or `{...facts.booking}` or `{...booking}`: a spread carries the id without naming it. */
const SPREAD = /\.\.\.\s*[\w.?]*(?:[fF]acts|booking)\b/;
/** `prop={facts}` or `prop={facts.booking}`: the whole object (id included) as a prop. */
const WHOLE_AS_PROP = /=\{\s*[\w.?]*[fF]acts(?:\??\.booking)?\s*\}/;

/** Why this source could hand a booking id of the facts to a client component; empty when it cannot. */
function leaksOf(source: string): string[] {
  const code = codeView(source);
  const leaks: string[] = [];
  if (BOOKING_ID.test(code)) leaks.push("names bookingId");
  if (SPREAD.test(code)) leaks.push("spreads the facts or their booking");
  if (WHOLE_AS_PROP.test(code)) leaks.push("passes the facts or their booking whole as a prop");
  return leaks;
}

test("the guard can fail: it names a booking id, a spread and a whole booking passed as a prop", () => {
  assert.deepEqual(leaksOf("const id = facts?.booking?.bookingId;"), ["names bookingId"]);
  assert.deepEqual(leaksOf("<Booked {...facts.booking} />"), ["spreads the facts or their booking"]);
  assert.deepEqual(leaksOf("<Booked {...facts} />"), ["spreads the facts or their booking"]);
  assert.deepEqual(leaksOf("<Booked booking={facts.booking} />"), ["passes the facts or their booking whole as a prop"]);
  assert.deepEqual(leaksOf("<Booked data={facts} />"), ["passes the facts or their booking whole as a prop"]);
  assert.deepEqual(leaksOf("<Booked data={ownerFacts?.booking} />"), ["passes the facts or their booking whole as a prop"]);
});

test("the guard lets picked values and prose through", () => {
  const picked = [
    "// The guest cookie's bookingId never reaches a prop.",
    "/* bookingId */",
    'const note = "bookingId";',
    "const booked = customerViewer?.source === 'owner' && facts?.booking ? { status: facts.booking.status, via: 'owner' } : null;",
    "const usable = facts?.usable ?? null;",
    "<OccurrenceBooking canSpend={usable !== null} leftAfter={usable?.leftAfter ?? 0} />",
    "<GuestNote show={guestBooked} />",
  ].join("\n");
  assert.deepEqual(leaksOf(picked), []);
});

test("no consumer of getSeanceVisitorFacts names a booking id, spreads the facts or passes them whole as a prop", () => {
  const consumers = sourceFilesUnder("src").filter(
    (path) => path !== DEFINITION && /\bgetSeanceVisitorFacts\b/.test(codeView(readFileSync(path, "utf8"))),
  );
  for (const path of consumers) {
    assert.deepEqual(leaksOf(readFileSync(path, "utf8")), [], `${path} hands a guest's booking id to a client component`);
  }
});
