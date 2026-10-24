import assert from "node:assert/strict";
import test from "node:test";

import { BOUTIQUE_ANCHOR, boutiqueHref, scrollToHashedAnchor } from "./public-anchors";

/** A document with the given ids; each element counts how many times it was scrolled into view. */
function fakeDocument(ids: string[]) {
  const scrolled: Record<string, number> = {};
  const lookups: string[] = [];
  const doc = {
    getElementById(id: string) {
      lookups.push(id);
      if (!ids.includes(id)) return null;
      return {
        scrollIntoView() {
          scrolled[id] = (scrolled[id] ?? 0) + 1;
        },
      };
    },
  };
  return { doc, scrolled, lookups };
}

test("boutiqueHref points at the Boutique anchor of the pro's page", () => {
  assert.equal(boutiqueHref("altinha-paris"), `/altinha-paris#${BOUTIQUE_ANCHOR}`);
});

test("the anchor named by the URL hash is scrolled into view, once (the Boutique streams in after the router's own scroll)", () => {
  const { doc, scrolled } = fakeDocument([BOUTIQUE_ANCHOR]);
  assert.equal(scrollToHashedAnchor(BOUTIQUE_ANCHOR, `#${BOUTIQUE_ANCHOR}`, doc), true);
  assert.deepEqual(scrolled, { [BOUTIQUE_ANCHOR]: 1 });
});

test("another hash, or none, never moves the page (a visitor who landed on a plain URL stays where they are)", () => {
  for (const hash of ["", "#", "#planning-title", "#Boutique", "#boutique2", "#boutique ", "boutique"]) {
    const { doc, scrolled, lookups } = fakeDocument([BOUTIQUE_ANCHOR]);
    assert.equal(scrollToHashedAnchor(BOUTIQUE_ANCHOR, hash, doc), false, JSON.stringify(hash));
    assert.deepEqual(scrolled, {}, JSON.stringify(hash));
    assert.deepEqual(lookups, [], `${JSON.stringify(hash)}: the document is not even read`);
  }
});

test("a hash whose element is not on the page is a no-op, not an error", () => {
  const { doc, scrolled } = fakeDocument([]);
  assert.equal(scrollToHashedAnchor(BOUTIQUE_ANCHOR, `#${BOUTIQUE_ANCHOR}`, doc), false);
  assert.deepEqual(scrolled, {});
});
