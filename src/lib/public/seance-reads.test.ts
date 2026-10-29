/**
 * Source guard: the séance page and the planning list say the same thing about a séance. The planning hides an empty
 * séance under a time off while the séance page says « Réservations fermées », and both show the same seats, window,
 * place and accepted types, so the SQL rule (`UNDER_TIME_OFF`) and the row mapper (`publicSeanceOf`) live once, in
 * planning-reads.ts, and `getPublicSeance` calls them instead of spelling them again (Task 24 review, round 1).
 * Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const PLANNING = readFileSync("src/lib/public/planning-reads.ts", "utf8");
const SEANCE = readFileSync("src/lib/public/seance-reads.ts", "utf8");

test("planning-reads.ts exports the time-off rule and the row mapper that both reads share", () => {
  assert.match(codeView(PLANNING), /^export const UNDER_TIME_OFF\b/m);
  assert.ok(bodyOf(PLANNING, "publicSeanceOf").length > 0, "publicSeanceOf is exported");
  assert.match(PLANNING, /\btime_off\b/, "the one spelling of the rule is in planning-reads.ts");
});

test("getPublicSeance takes the time-off flag and the whole PublicSeance from the planning's rule and mapper", () => {
  const code = codeView(SEANCE);
  const body = codeView(bodyOf(SEANCE, "getPublicSeance"));
  // codeView keeps the expression of a template literal and blanks its delimiters: sql<boolean>`${UNDER_TIME_OFF}`.
  assert.match(body, /\bsql<boolean>\s*UNDER_TIME_OFF\b/, "underTimeOff is the planning's rule");
  assert.match(body, /\bpublicSeanceOf\(/, "the PublicSeance is the planning's mapper");
  assert.doesNotMatch(SEANCE, /\btime_off\b/, "the time-off SQL is not spelled again");
  for (const owned of ["effectiveWindow", "effectiveLocation", "seatsShown"]) {
    assert.doesNotMatch(code, new RegExp(`\\b${owned}\\b`), `${owned} belongs to publicSeanceOf`);
  }
});
