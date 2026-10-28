/**
 * Source guard of the RDV slot loader (P5 dossier § 3.4, § 5 T6). The loader must read what the engine reads and
 * generate with the one pure generator, so it can never drift from `bookRdv`:
 *
 * - the type and the hours come from the engine's own readers (`loadRdvType`, `rdvRules`, claims.ts);
 * - the slots and the grid check come from `computeSlots` and `isGridStart` (availability.ts), never from a second
 *   grid loop;
 * - the lapsed-hold rule is the one fragment of holds.ts (`lapsedHold`, P3OUT:151), also behind expireElapsedHolds;
 * - a testable core: no `server-only`, no `next/*`, no `@/lib/db`, no env, no session.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const slots = readFileSync("src/lib/slots.ts", "utf8");
const holds = readFileSync("src/lib/booking/holds.ts", "utf8");

/** The source without its comments (the SQL text of the template literals is kept). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("slots.ts reads the type and the hours through the engine's readers", () => {
  assert.match(slots, /import \{[^}]*\bloadRdvType\b[^}]*\brdvRules\b[^}]*\} from "@\/lib\/booking\/claims";/);
  assert.doesNotMatch(withoutComments(slots), /availabilityRule|from\(ticketType\)/, "no reader of its own for the hours or the type");
});

test("slots.ts generates with computeSlots and checks with isGridStart, never with a grid loop of its own", () => {
  assert.match(slots, /import \{[^}]*\bcomputeSlots\b[^}]*\bisGridStart\b[^}]*\} from "@\/lib\/availability";/);
  const code = codeView(slots);
  assert.match(code, /computeSlots\(\{/);
  assert.match(code, /isGridStart\(\{/);
  assert.doesNotMatch(code, /for \(let /, "no minute loop");
  assert.doesNotMatch(code, /fitsAvailability|onlineBookability/, "the hours and the window are the generator's");
});

test("the lapsed-hold rule lives in holds.ts only: slots.ts and expireElapsedHolds both use lapsedHold", () => {
  assert.match(slots, /import \{ lapsedHold \} from "@\/lib\/booking\/holds";/);
  assert.match(slots, /not \$\{lapsedHold\(now, sql`b`\)\}/);
  assert.doesNotMatch(withoutComments(slots), /hold_expires_at/, "no copy of the rule");
  const expire = bodyOf(holds, "expireElapsedHolds");
  assert.match(expire, /\$\{lapsedHold\(c\.now\)\}/);
  assert.doesNotMatch(withoutComments(expire), /hold_expires_at/);
  assert.match(bodyOf(holds, "lapsedHold"), /= 'pending' and \$\{col\("hold_expires_at"\)\} < \$\{ts\(now\)\}/);
});

test("slots.ts is a testable core", () => {
  for (const banned of [/"server-only"/, /from "next\//, /from "@\/lib\/db"/, /from "@\/lib\/env"/, /from "@\/lib\/session"/]) {
    assert.doesNotMatch(slots, banned);
  }
});
