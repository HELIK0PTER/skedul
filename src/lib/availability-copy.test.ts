import test from "node:test";
import assert from "node:assert/strict";

import { mergeRangeIntoDays, replaceDaysWith } from "./availability-copy";
import type { ByDay } from "@/components/dashboard/weekly-hours-editor";

function makeByDay(partial: Partial<ByDay>): ByDay {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], ...partial };
}

test("mergeRangeIntoDays appends the range to each target day", () => {
  const before = makeByDay({ 1: [{ start: "09:00", end: "10:00" }] });
  const after = mergeRangeIntoDays(
    before,
    { start: "09:00", end: "10:00" },
    [2, 3],
  );
  assert.deepEqual(after[2], [{ start: "09:00", end: "10:00" }]);
  assert.deepEqual(after[3], [{ start: "09:00", end: "10:00" }]);
});

test("mergeRangeIntoDays keeps existing ranges and appends after them", () => {
  const before = makeByDay({ 2: [{ start: "14:00", end: "15:00" }] });
  const after = mergeRangeIntoDays(
    before,
    { start: "09:00", end: "10:00" },
    [2],
  );
  assert.deepEqual(after[2], [
    { start: "14:00", end: "15:00" },
    { start: "09:00", end: "10:00" },
  ]);
});

test("mergeRangeIntoDays skips an exact duplicate already present", () => {
  const before = makeByDay({ 2: [{ start: "09:00", end: "10:00" }] });
  const after = mergeRangeIntoDays(
    before,
    { start: "09:00", end: "10:00" },
    [2],
  );
  assert.deepEqual(after[2], [{ start: "09:00", end: "10:00" }]);
});

test("mergeRangeIntoDays does not touch non-target days", () => {
  const before = makeByDay({ 1: [{ start: "09:00", end: "10:00" }] });
  const after = mergeRangeIntoDays(
    before,
    { start: "11:00", end: "12:00" },
    [2],
  );
  assert.deepEqual(after[1], [{ start: "09:00", end: "10:00" }]);
});

test("mergeRangeIntoDays does not mutate the input", () => {
  const before = makeByDay({ 2: [] });
  mergeRangeIntoDays(before, { start: "09:00", end: "10:00" }, [2]);
  assert.deepEqual(before[2], []);
});

test("replaceDaysWith overwrites each target day with the given ranges", () => {
  const before = makeByDay({
    1: [{ start: "09:00", end: "12:00" }],
    2: [{ start: "08:00", end: "08:30" }],
  });
  const after = replaceDaysWith(
    before,
    [
      { start: "09:00", end: "10:00" },
      { start: "10:00", end: "11:00" },
    ],
    [2],
  );
  assert.deepEqual(after[2], [
    { start: "09:00", end: "10:00" },
    { start: "10:00", end: "11:00" },
  ]);
});

test("replaceDaysWith leaves non-target days untouched", () => {
  const before = makeByDay({ 1: [{ start: "09:00", end: "12:00" }] });
  const after = replaceDaysWith(before, [{ start: "09:00", end: "10:00" }], [2]);
  assert.deepEqual(after[1], [{ start: "09:00", end: "12:00" }]);
});

test("replaceDaysWith deep-clones ranges so mutating the result does not affect the source day", () => {
  const before = makeByDay({ 1: [{ start: "09:00", end: "10:00" }] });
  const after = replaceDaysWith(before, before[1], [2]);
  after[2][0].start = "23:00";
  assert.equal(before[1][0].start, "09:00");
});

test("replaceDaysWith does not mutate the input", () => {
  const before = makeByDay({ 2: [{ start: "08:00", end: "09:00" }] });
  replaceDaysWith(before, [{ start: "09:00", end: "10:00" }], [2]);
  assert.deepEqual(before[2], [{ start: "08:00", end: "09:00" }]);
});
