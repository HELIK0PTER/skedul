/**
 * The page-level line a release leaves behind (G4c): one text, read by the always-mounted status region of the séance
 * page and written by the blocks that can release a seat. Pure: no React, no DOM. Run from the repository root.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createLineStore } from "./release-line";

test("the store starts empty and holds the last line that was set", () => {
  const store = createLineStore();
  assert.equal(store.get(), "");
  store.set("Votre place est libérée.");
  assert.equal(store.get(), "Votre place est libérée.");
  store.set("");
  assert.equal(store.get(), "");
});

test("a listener hears each change once, and not a line that did not change", () => {
  const store = createLineStore();
  let heard = 0;
  store.subscribe(() => {
    heard += 1;
  });
  store.set("a");
  store.set("a");
  assert.equal(heard, 1, "the same line is not a change");
  store.set("");
  store.set("a");
  assert.equal(heard, 3, "going through an empty line is: that is how a second release is announced again");
});

test("a listener that unsubscribed hears nothing, and one that unsubscribes while being told does not skip another", () => {
  const store = createLineStore();
  const heard: string[] = [];
  const stop = store.subscribe(() => heard.push("first"));
  store.subscribe(() => heard.push("second"));
  stop();
  store.set("a");
  assert.deepEqual(heard, ["second"]);

  const other = createLineStore();
  const order: string[] = [];
  const off = other.subscribe(() => {
    order.push("one");
    off();
  });
  other.subscribe(() => order.push("two"));
  other.set("x");
  other.set("y");
  assert.deepEqual(order, ["one", "two", "two"], "the second listener hears both changes, the first only the first");
});

test("two stores do not share their line", () => {
  const a = createLineStore();
  const b = createLineStore();
  a.set("a");
  assert.equal(b.get(), "");
});
