/**
 * Wiring guard for the « Voir la boutique » links (Task 25a, fix round 1). The public page streams behind loading.tsx:
 * on a client navigation to `/{slug}#boutique` the router scrolls when the loading skeleton commits, where the Boutique
 * is not yet in the document, and does not scroll again when the content arrives; on a fresh load the browser's own
 * fragment scroll can run before the streamed block is revealed. A client leaf inside the Boutique scrolls to the hash
 * once the block is there, on both paths. The leaf cannot run in node:test (it needs a browser), so what the Boutique and
 * the leaf must keep is pinned on their source; the scrolling rule itself has a pure test (public-anchors.test.ts).
 * Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const BOUTIQUE = readFileSync("src/components/public/boutique.tsx", "utf8");
const LEAF = readFileSync("src/components/public/scroll-to-anchor.tsx", "utf8");

test("the Boutique mounts the scroll leaf for its own anchor, inside the section, only when it renders", () => {
  assert.match(BOUTIQUE, /import \{ ScrollToAnchor \} from "@\/components\/public\/scroll-to-anchor";/);
  const none = BOUTIQUE.indexOf("if (types.length === 0) return null;");
  const section = BOUTIQUE.indexOf("<section id={BOUTIQUE_ANCHOR}");
  const leaf = BOUTIQUE.indexOf("<ScrollToAnchor anchor={BOUTIQUE_ANCHOR} />");
  const end = BOUTIQUE.indexOf("</section>");
  assert.ok(none !== -1 && section > none, "the empty Boutique renders nothing");
  assert.ok(leaf > section && leaf < end, "the leaf sits inside the section");
  assert.equal((BOUTIQUE.match(/<ScrollToAnchor /g) ?? []).length, 1);
});

test("the Boutique stays a server component: the browser code lives in the leaf", () => {
  assert.doesNotMatch(BOUTIQUE, /^"use client"/);
  assert.doesNotMatch(BOUTIQUE, /\buse(State|Effect|Router|Ref)\b|window\.|document\./);
});

test("the leaf scrolls once on mount from the real URL hash, and renders nothing", () => {
  assert.match(LEAF, /^"use client";/);
  assert.match(LEAF, /import \{ scrollToHashedAnchor \} from "@\/lib\/public-anchors";/);
  assert.match(LEAF, /useEffect\(\(\) => \{\s*scrollToHashedAnchor\(anchor, window\.location\.hash, document\);\s*\}, \[anchor\]\);/);
  assert.match(LEAF, /return null;/);
});
