/**
 * P6 A12: one hold-lapse rule. A pending booking holds its seat while hold_expires_at > now; from hold_expires_at on
 * (<= now) its hold has lapsed. The JS predicates (hold-rule.ts) and the SQL fragments (db/hold-sql.ts) say it once,
 * and no other file of src compares hold_expires_at with a clock, so a read can never count a hold the engine releases.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { holdsSeat, lapsedHold, liveHold } from "@/lib/db/hold-sql";
import { sourceFilesUnder } from "@/test/source-guards";

import { holdEndedBy, holdsSeatAt, isLapsedHold, isLiveHold } from "./hold-rule";

const NOW = new Date("2026-10-29T10:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

test("JS: a hold runs strictly before hold_expires_at and has lapsed from that instant on", () => {
  const pending = (holdExpiresAt: Date | null) => ({ status: "pending", holdExpiresAt });
  assert.equal(isLiveHold(pending(at(1)), NOW), true);
  assert.equal(isLapsedHold(pending(at(1)), NOW), false);
  assert.equal(isLiveHold(pending(NOW), NOW), false, "at hold_expires_at the hold is over");
  assert.equal(isLapsedHold(pending(NOW), NOW), true);
  assert.equal(isLapsedHold(pending(at(-1)), NOW), true);
  assert.equal(isLapsedHold(pending(null), NOW), true, "no readable end holds nothing");
  assert.equal(holdsSeatAt(pending(at(1)), NOW), true);
  assert.equal(holdsSeatAt(pending(NOW), NOW), false);
  assert.equal(holdsSeatAt({ status: "confirmed", holdExpiresAt: at(-1) }, NOW), true);
  for (const status of ["confirmed", "cancelled", "expired"]) {
    assert.equal(isLapsedHold({ status, holdExpiresAt: at(-1) }, NOW), false, status);
    assert.equal(isLiveHold({ status, holdExpiresAt: at(1) }, NOW), false, status);
  }
  assert.equal(holdEndedBy(NOW, NOW), true);
  assert.equal(holdEndedBy(at(1), NOW), false);
});

test("SQL: the fragments say the same rule, unqualified or on an alias", () => {
  const dialect = new PgDialect();
  const lapsed = dialect.sqlToQuery(lapsedHold(NOW));
  assert.equal(lapsed.sql, `("status" = 'pending' and "hold_expires_at" <= $1::timestamptz)`);
  assert.deepEqual(lapsed.params, [NOW.toISOString()]);
  assert.equal(
    dialect.sqlToQuery(liveHold(NOW, sql`b`)).sql,
    `(b."status" = 'pending' and b."hold_expires_at" > $1::timestamptz)`,
  );
  assert.equal(
    dialect.sqlToQuery(holdsSeat(NOW, sql`b`)).sql,
    `(b."status" = 'confirmed' or (b."status" = 'pending' and b."hold_expires_at" > $1::timestamptz))`,
  );
});

/** Comparisons of a hold end with a clock, SQL or drizzle or JS: the shapes the inline copies had. */
const COPIES: { name: string; re: RegExp }[] = [
  { name: "SQL comparison", re: /hold_expires_at\s*(?:<=|>=|<|>)|(?:<=|>=|<|>)\s*[\w.]*hold_expires_at/ },
  { name: "drizzle operator", re: /\b(?:lt|gt|lte|gte)\(\s*[\w.]*holdExpiresAt\b/ },
  { name: "JS comparison", re: /holdExpiresAt\??\.getTime\(\)\s*(?:<=|>=|<|>)|(?:<=|>=|<|>)\s*[\w.]*holdExpiresAt\??\.getTime\(\)/ },
];
const RULE_MODULES = new Set(["src/lib/hold-rule.ts", "src/lib/db/hold-sql.ts"]);

test("no file of src compares a hold end with a clock outside the two rule modules", () => {
  const offenders: string[] = [];
  for (const path of sourceFilesUnder("src")) {
    if (RULE_MODULES.has(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(?:\/\*|\*|\/\/)/.test(line)) return; // comments describe the rule, they do not apply it
      for (const { name, re } of COPIES) if (re.test(line)) offenders.push(`${path}:${i + 1} (${name}): ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("the engine's releases use the shared fragment: R, expireElapsedHolds and the sweep", () => {
  const atomic = readFileSync("src/lib/db/atomic.ts", "utf8");
  assert.match(atomic, /import \{ lapsedHold \} from "\.\/hold-sql";/);
  assert.match(atomic, /and \$\{lapsedHold\(c\.now\)\}/);
  const holds = readFileSync("src/lib/booking/holds.ts", "utf8");
  assert.match(holds, /from "@\/lib\/db\/hold-sql";/);
  assert.match(holds, /and \$\{lapsedHold\(c\.now\)\}/);
  const release = readFileSync("src/lib/booking/release.ts", "utf8");
  assert.match(release, /lapsedHold\(now, sql`b`\)/);
});
