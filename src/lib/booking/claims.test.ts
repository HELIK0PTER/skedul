/**
 * Source guard of E4 (P5 dossier § 3.15 point 1, OUT:120). The batch of `bookRdv` has one branch per mode and an
 * `else` that throws: a mode no branch handles can never commit an RDV occurrence without its booking (I5). The DB
 * suites cannot reach that `else` (every mode is planned), so its presence is pinned here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const SOURCE = readFileSync("src/lib/booking/claims.ts", "utf8");
const body = codeView(bodyOf(SOURCE, "bookRdv"));

test("bookRdv: held ticket, free and buy branches, then an else that throws", () => {
  // codeView keeps the quotes of a string literal and blanks its text: "held_ticket" and "free" read as quoted spaces.
  const branches = /if \(input\.mode === " {11}"\) \{[\s\S]*?\} else if \(input\.mode === " {4}"\) \{[\s\S]*?\} else if \(buy && purchaseId && checkoutExpiresAt\) \{([\s\S]*?)\} else \{\s*throw new Error\(/;
  const match = branches.exec(body);
  assert.ok(match, "the buy branch is followed by `else { throw new Error(...) }`");
  assert.doesNotMatch(match[1], /\} else/, "the throwing else belongs to the buy branch, not to a branch nested in it");
});

test("offerUnchanged reads the ticket type FOR SHARE, like typeNotFree: a checkout and a switch to « Gratuit » never both commit (FR:F9 client half, P5 T9)", () => {
  // The raw source: the SQL is template text, which codeView blanks.
  const offer = bodyOf(SOURCE, "offerUnchanged");
  const sub = /return sql`exists \(\s*select 1 from ticket_offer f\s+join ticket_type tt on tt\.id = f\.ticket_type_id([\s\S]*?)\)`;/.exec(offer);
  assert.ok(sub, "offerUnchanged is one exists over the offer and its type");
  assert.match(sub[1], /\bnot tt\.rdv_free\b/, "the type must not be « Gratuit »");
  assert.match(sub[1], /\n\s*for share of tt\s*$/, "the sub-select ends with `for share of tt`: the type row is locked, never the offer or the séance");
  assert.equal(sub[1].match(/\bfor (?:share|update|no key update|key share)\b/g)?.length, 1, "one lock clause");
  // The pattern it follows (T5): the batches of the pro half lock the same row the same way.
  const typeNotFree = bodyOf(readFileSync("src/lib/booking/catalog.ts", "utf8"), "typeNotFree");
  assert.match(typeNotFree, /\bfor share\b/);
  // The three client paths that sell an offer assert it in their batch: buy + book (event), RDV buy (rdv), shop.
  const code = codeView(SOURCE);
  assert.match(code, /G\(db, offerUnchanged\(offer, professionalId, \{ kind: " {5}", occurrenceId \}\), " {5}"\)/);
  assert.match(codeView(bodyOf(SOURCE, "bookRdv")), /G\(db, offerUnchanged\(buy, professionalId, \{ kind: " {3}", ticketTypeId \}\), " {5}"\)/);
  assert.match(
    codeView(readFileSync("src/lib/booking/fulfillment.ts", "utf8")),
    /G\(db, offerUnchanged\(offer, input\.professionalId, \{ kind: " {4}" \}\), " {5}"\)/,
  );
});
