import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

import { paidPurchaseOf } from "./revenue";

const dialect = new PgDialect();

test("paidPurchaseOf refuses an empty professionalId instead of widening to every pro (P6 A1)", () => {
  assert.throws(() => paidPurchaseOf({ live: false, professionalId: "" }), /professionalId/);
});

test("paidPurchaseOf: a pro id scopes the predicate, no id leaves it platform-wide (the admin figure)", () => {
  const scoped = dialect.sqlToQuery(paidPurchaseOf({ live: true, professionalId: "pro_1" }));
  assert.match(scoped.sql, /"ticket_purchase"\."professional_id" = \$\d/);
  assert.ok(scoped.params.includes("pro_1"));
  const platform = dialect.sqlToQuery(paidPurchaseOf({ live: true }));
  assert.doesNotMatch(platform.sql, /professional_id/);
});
