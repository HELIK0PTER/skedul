import { test } from "node:test";
import assert from "node:assert/strict";

import { PlanError, tryAtomic, type Db } from "./atomic";

// A PlanError is thrown by plan() before any statement is built, so no
// database is ever touched: a stub that fails loudly proves it.
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be used");
    },
  },
) as Db;

test("tryAtomic: a PlanError without detail yields no message key", async () => {
  const res = await tryAtomic(noDb, async () => {
    throw new PlanError("stale");
  });
  assert.deepEqual(res, { ok: false, code: "stale" });
  assert.equal("message" in res, false);
});

test("tryAtomic: a PlanError with detail yields it as message", async () => {
  const res = await tryAtomic(noDb, async () => {
    throw new PlanError("not_found", "no such occurrence");
  });
  assert.deepEqual(res, { ok: false, code: "not_found", message: "no such occurrence" });
});
