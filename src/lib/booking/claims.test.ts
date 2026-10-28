/**
 * Source guard of E4 (P5 dossier § 3.15 point 1, OUT:120). The batch of `bookRdv` has one branch per mode and an
 * `else` that throws: a mode no branch handles can never commit an RDV occurrence without its booking (I5). The DB
 * suites cannot reach that `else` (every mode is planned), so its presence is pinned here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const body = codeView(bodyOf(readFileSync("src/lib/booking/claims.ts", "utf8"), "bookRdv"));

test("bookRdv: held ticket, free and buy branches, then an else that throws", () => {
  // codeView keeps the quotes of a string literal and blanks its text: "held_ticket" and "free" read as quoted spaces.
  const branches = /if \(input\.mode === " {11}"\) \{[\s\S]*?\} else if \(input\.mode === " {4}"\) \{[\s\S]*?\} else if \(buy && purchaseId && checkoutExpiresAt\) \{([\s\S]*?)\} else \{\s*throw new Error\(/;
  const match = branches.exec(body);
  assert.ok(match, "the buy branch is followed by `else { throw new Error(...) }`");
  assert.doesNotMatch(match[1], /\} else/, "the throwing else belongs to the buy branch, not to a branch nested in it");
});
