import assert from "node:assert/strict";
import test from "node:test";

import { isReferenceId } from "./purchase-reads";

test("isReferenceId accepts the nanoid alphabet, 1 to 64 characters", () => {
  for (const ok of ["a", "V1StGXR8_Z5jdHi6B-myT", "A_b-9", "a".repeat(64)]) {
    assert.equal(isReferenceId(ok), true, ok);
  }
});

test("isReferenceId refuses everything else before any query is built", () => {
  for (const bad of ["", " ", "a b", "../x", "x/y", "a".repeat(65), "%2e%2e", "p;q", "é", "a\n", "a\u0000"]) {
    assert.equal(isReferenceId(bad), false, JSON.stringify(bad));
  }
  for (const notAString of [null, undefined, 5, {}, ["a"]]) {
    assert.equal(isReferenceId(notAString), false, JSON.stringify(notAString));
  }
});
