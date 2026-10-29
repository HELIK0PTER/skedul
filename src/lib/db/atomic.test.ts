import { test } from "node:test";
import assert from "node:assert/strict";

import { PlanError, tryAtomic, type Db, type Query } from "./atomic";

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

/** A db whose batch always throws `err`, counting the calls. */
function failingDb(err: Error): { db: Db; calls: () => number } {
  let calls = 0;
  const db = {
    batch: async () => {
      calls++;
      throw err;
    },
  } as unknown as Db;
  return { db, calls: () => calls };
}

/** Runs `fn` with console.warn captured. */
async function warnsOf<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { value: await fn(), lines };
  } finally {
    console.warn = original;
  }
}

const oneStatement = async () => () => [{} as Query];

// P6 A18: a deadlock that comes back after the one replay is a race the caller can retry, not a crash.
test("tryAtomic: a second 40P01 answers stale (no third run) and logs one line without the error", async () => {
  const deadlock = Object.assign(new Error("deadlock detected params: x@skedul.test"), { code: "40P01" });
  const { db, calls } = failingDb(deadlock);
  const { value, lines } = await warnsOf(() => tryAtomic(db, oneStatement, { replanOnStale: true }));
  assert.deepEqual(value, { ok: false, code: "stale" });
  assert.equal(calls(), 2, "atomic replayed the batch once, and nothing ran a third time");
  assert.deepEqual(lines, ["[db] 40P01 after one replay -> stale"]);
});

test("tryAtomic: a CHECK or a foreign key answer is logged as a fallback, without the error", async () => {
  const seats = Object.assign(new Error("violates check params: x@skedul.test"), { code: "23514", constraint: "occurrence_seats_chk" });
  const full = await warnsOf(() => tryAtomic(failingDb(seats).db, oneStatement));
  assert.deepEqual(full.value, { ok: false, code: "full" });
  assert.deepEqual(full.lines, ["[db] 23514 occurrence_seats_chk -> full"]);

  const fk = Object.assign(new Error("violates foreign key"), { code: "23503", constraint: "booking_occurrence_id_occurrence_id_fk" });
  const stale = await warnsOf(() => tryAtomic(failingDb(fk).db, oneStatement));
  assert.deepEqual(stale.value, { ok: false, code: "stale" });
  assert.deepEqual(stale.lines, ["[db] 23503 booking_occurrence_id_occurrence_id_fk -> stale"]);

  const assertion = Object.assign(new Error("skedul:full"), { code: "P0001" });
  const precise = await warnsOf(() => tryAtomic(failingDb(assertion).db, oneStatement));
  assert.deepEqual(precise.value, { ok: false, code: "full" });
  assert.deepEqual(precise.lines, [], "an engine assertion is a precise answer: nothing to note");
});