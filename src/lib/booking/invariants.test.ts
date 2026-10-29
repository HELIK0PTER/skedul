import assert from "node:assert/strict";
import test from "node:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";

import { SAME_TENANT_LINKS } from "./invariants";

/** Every single-column foreign key between two tables that both carry professional_id (the domain links). */
function domainLinks(): string[] {
  const tables = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));
  const owned = new Set(
    tables.filter((t) => getTableConfig(t).columns.some((c) => c.name === "professional_id")).map((t) => getTableConfig(t).name),
  );
  const links: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    if (!owned.has(config.name)) continue;
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const parent = getTableConfig(ref.foreignTable).name;
      if (parent === "professional" || !owned.has(parent)) continue;
      assert.equal(ref.columns.length, 1, `${config.name}: a composite key needs its own I7 rule`);
      links.push(`${config.name}.${ref.columns[0].name} -> ${parent}`);
    }
  }
  return links.sort();
}

test("I7 covers every domain foreign key of the schema, and only those (P6 A1)", () => {
  const covered = SAME_TENANT_LINKS.map((l) => `${l.child}.${l.column} -> ${l.parent}`).sort();
  assert.deepEqual(covered, domainLinks());
});
