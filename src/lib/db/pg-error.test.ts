import { test } from "node:test";
import assert from "node:assert/strict";

import { pgErrorInfo, skedulCode } from "./pg-error";

test("reads a NeonDbError thrown directly (inside db.batch)", () => {
  const err = Object.assign(new Error("new row violates check constraint"), {
    code: "23514",
    constraint: "occurrence_seats_chk",
  });
  assert.deepEqual(pgErrorInfo(err), {
    code: "23514",
    constraint: "occurrence_seats_chk",
    detail: undefined,
    message: "new row violates check constraint",
  });
});

test("reads the cause of a DrizzleQueryError (outside db.batch)", () => {
  const cause = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "booking_active_uq",
    detail: "Key (occurrence_id, customer_id)=(o1, c1) already exists.",
  });
  const err = new Error("Failed query: insert …", { cause });
  const info = pgErrorInfo(err);
  assert.equal(info.code, "23505");
  assert.equal(info.constraint, "booking_active_uq");
  assert.match(info.detail ?? "", /already exists/);
});

test("ignores Node errno codes and keeps the innermost message", () => {
  const err = new Error("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
  assert.deepEqual(pgErrorInfo(err), { message: "socket hang up" });
});

test("terminates on a self-referencing cause chain", () => {
  const err = new Error("loop") as Error & { cause?: unknown };
  err.cause = err;
  assert.deepEqual(pgErrorInfo(err), { message: "loop" });
});

test("skedulCode extracts the code of a raised skedul_assert", () => {
  const raised = Object.assign(new Error("skedul:stale"), { code: "P0001" });
  assert.equal(skedulCode(raised), "stale");
  assert.equal(skedulCode(new Error("Failed query", { cause: raised })), "stale");
  assert.equal(skedulCode(Object.assign(new Error("x"), { code: "23514" })), null);
});
