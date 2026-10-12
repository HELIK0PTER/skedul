import test from "node:test";
import assert from "node:assert/strict";

import { checkSlug, typingSlug } from "./slug";

test("checkSlug normalises what the pro typed", () => {
  assert.deepEqual(checkSlug("Altinha Paris"), { ok: true, slug: "altinha-paris" });
  assert.deepEqual(checkSlug("  Café-Crème  "), { ok: true, slug: "cafe-creme" });
  assert.deepEqual(checkSlug("yoga--studio-"), { ok: true, slug: "yoga-studio" });
});

test("checkSlug refuses addresses that are too short", () => {
  assert.equal(checkSlug("ab").ok, false);
  assert.equal(checkSlug("--").ok, false);
  assert.equal(checkSlug("").ok, false);
});

test("checkSlug refuses app routes", () => {
  for (const reserved of ["admin", "dashboard", "sign-in", "Aide"]) {
    assert.equal(checkSlug(reserved).ok, false, reserved);
  }
});

test("checkSlug never ends on a hyphen after truncation", () => {
  const res = checkSlug(`${"a".repeat(59)} b`);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.slug, "a".repeat(59));
  }
});

test("typingSlug keeps a trailing hyphen while typing", () => {
  assert.equal(typingSlug("Altinha "), "altinha-");
  assert.equal(typingSlug("Été  à Paris"), "ete-a-paris");
  assert.equal(typingSlug("-yoga"), "yoga");
  assert.equal(typingSlug("x".repeat(80)).length, 60);
});
