import test from "node:test";
import assert from "node:assert/strict";

import { layoutLanes, type LaneItem } from "./lanes";

const slots = (items: LaneItem[]) => Object.fromEntries(layoutLanes(items));

test("no items, one item", () => {
  assert.equal(layoutLanes([]).size, 0);
  assert.deepEqual(slots([{ id: "a", start: 0, end: 60 }]), { a: { lane: 0, lanes: 1 } });
});

test("separate and touching intervals each take the full width", () => {
  assert.deepEqual(
    slots([
      { id: "a", start: 0, end: 60 },
      { id: "b", start: 60, end: 120 },
      { id: "c", start: 200, end: 260 },
    ]),
    { a: { lane: 0, lanes: 1 }, b: { lane: 0, lanes: 1 }, c: { lane: 0, lanes: 1 } },
  );
});

test("two overlapping intervals share the width", () => {
  assert.deepEqual(
    slots([
      { id: "a", start: 0, end: 60 },
      { id: "b", start: 30, end: 90 },
    ]),
    { a: { lane: 0, lanes: 2 }, b: { lane: 1, lanes: 2 } },
  );
});

test("a transitive cluster reuses a freed lane and shares its lane count", () => {
  // a overlaps b, b overlaps c, a and c only touch: c reuses a's lane.
  assert.deepEqual(
    slots([
      { id: "a", start: 0, end: 60 },
      { id: "b", start: 30, end: 90 },
      { id: "c", start: 60, end: 120 },
      { id: "d", start: 150, end: 180 },
    ]),
    {
      a: { lane: 0, lanes: 2 },
      b: { lane: 1, lanes: 2 },
      c: { lane: 0, lanes: 2 },
      d: { lane: 0, lanes: 1 },
    },
  );
});

test("same start: the longer interval comes first; identical intervals order by id", () => {
  assert.deepEqual(
    slots([
      { id: "short", start: 0, end: 30 },
      { id: "long", start: 0, end: 120 },
    ]),
    { long: { lane: 0, lanes: 2 }, short: { lane: 1, lanes: 2 } },
  );
  assert.deepEqual(
    slots([
      { id: "y", start: 0, end: 60 },
      { id: "x", start: 0, end: 60 },
      { id: "z", start: 0, end: 60 },
    ]),
    { x: { lane: 0, lanes: 3 }, y: { lane: 1, lanes: 3 }, z: { lane: 2, lanes: 3 } },
  );
});

test("the layout does not depend on the input order", () => {
  const items: LaneItem[] = [
    { id: "a", start: 0, end: 90 },
    { id: "b", start: 10, end: 40 },
    { id: "c", start: 45, end: 100 },
    { id: "d", start: 95, end: 130 },
    { id: "e", start: 140, end: 150 },
  ];
  const expected = slots(items);
  assert.deepEqual(slots([...items].reverse()), expected);
  assert.deepEqual(slots([items[2], items[4], items[0], items[3], items[1]]), expected);
  assert.deepEqual(expected, {
    a: { lane: 0, lanes: 2 },
    b: { lane: 1, lanes: 2 },
    c: { lane: 1, lanes: 2 },
    d: { lane: 0, lanes: 2 },
    e: { lane: 0, lanes: 1 },
  });
});
