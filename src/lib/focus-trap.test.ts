import test from "node:test";
import assert from "node:assert/strict";

import { tabDestination, topmostOf, type TabRelation } from "./focus-trap";

const rel = (text: string): TabRelation[] =>
  [...text].map((c) => (c === "<" ? "before" : c === "=" ? "self" : "after"));

test("Tab moves to the next tab stop of the dialog", () => {
  assert.equal(tabDestination(rel("<=>>"), false), 2);
  assert.equal(tabDestination(rel("=>>"), false), 1);
  assert.equal(tabDestination(rel("<<=>"), false), 3);
});

test("Tab on the last tab stop wraps to the first one", () => {
  assert.equal(tabDestination(rel("<<="), false), 0);
  assert.equal(tabDestination(rel("="), false), 0);
});

test("Shift+Tab moves to the previous tab stop and wraps from the first one to the last", () => {
  assert.equal(tabDestination(rel("<<=>"), true), 1);
  assert.equal(tabDestination(rel("<="), true), 0);
  assert.equal(tabDestination(rel("=>>"), true), 2);
  assert.equal(tabDestination(rel("="), true), 0);
});

test("focus on the panel itself or on a control that is no tab stop: the neighbour in document order", () => {
  // Every tab stop is after the panel (it holds them): Tab enters at the first, Shift+Tab wraps to the last.
  assert.equal(tabDestination(rel(">>>"), false), 0);
  assert.equal(tabDestination(rel(">>>"), true), 2);
  // A control with tabindex -1 between two tab stops (the error text of a confirmation).
  assert.equal(tabDestination(rel("<<>>"), false), 2);
  assert.equal(tabDestination(rel("<<>>"), true), 1);
});

test("focus behind the dialog is brought back inside, whichever side it came from", () => {
  // The background is before the dialog in the document.
  assert.equal(tabDestination(rel(">>>"), false), 0);
  assert.equal(tabDestination(rel(">>>"), true), 2);
  // The background is after the dialog.
  assert.equal(tabDestination(rel("<<<"), false), 0);
  assert.equal(tabDestination(rel("<<<"), true), 2);
});

test("a dialog without any tab stop has no destination (the panel itself keeps the focus)", () => {
  assert.equal(tabDestination([], false), null);
  assert.equal(tabDestination([], true), null);
});

// A tree as parent links: a dialog shown inside another one is a descendant of its panel.
const PARENT: Record<string, string | undefined> = { outer: undefined, inner: "outer", other: undefined };
const inside = (inner: string, outer: string): boolean => {
  for (let node = PARENT[inner]; node !== undefined; node = PARENT[node]) if (node === outer) return true;
  return false;
};

test("topmostOf: the last opened dialog is on top", () => {
  assert.equal(topmostOf(["outer", "other"], inside), "other");
  assert.equal(topmostOf(["other", "outer"], inside), "outer");
  assert.equal(topmostOf(["outer"], inside), "outer");
});

test("topmostOf: a dialog nested in another one is on top of it, whichever effect ran first", () => {
  assert.equal(topmostOf(["outer", "inner"], inside), "inner");
  // The effects of a child run before those of its parent when both open in the same commit.
  assert.equal(topmostOf(["inner", "outer"], inside), "inner");
  assert.equal(topmostOf(["other", "inner", "outer"], inside), "inner");
});

test("topmostOf: no dialog open, no top", () => {
  assert.equal(topmostOf([], inside), null);
});
