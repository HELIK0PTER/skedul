import test from "node:test";
import assert from "node:assert/strict";

import { SLUG_PARAM_RE } from "@/lib/public/context";
import { slugify } from "@/lib/utils";

import { SLUG_MAX_LENGTH, checkSlug, typingSlug, uniqueSlugWith } from "./slug";

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

/** isTaken over a set, recording every address it was asked about. */
function takenSet(taken: Iterable<string>) {
  const set = new Set(taken);
  const asked: string[] = [];
  return {
    asked,
    isTaken: async (candidate: string) => {
      asked.push(candidate);
      return set.has(candidate);
    },
  };
}

test("uniqueSlugWith gives the address itself when it is free, and numbers it after a collision", async () => {
  const free = takenSet([]);
  assert.equal(await uniqueSlugWith("Altinha Paris", free.isTaken), "altinha-paris");
  assert.deepEqual(free.asked, ["altinha-paris"]);

  const one = takenSet(["altinha-paris"]);
  assert.equal(await uniqueSlugWith("Altinha Paris", one.isTaken), "altinha-paris-2");
  const two = takenSet(["altinha-paris", "altinha-paris-2"]);
  assert.equal(await uniqueSlugWith("Altinha Paris", two.isTaken), "altinha-paris-3");
});

test("uniqueSlugWith never asks about an app route and falls back to « pro » for a name without letters", async () => {
  const reserved = takenSet([]);
  assert.equal(await uniqueSlugWith("Admin", reserved.isTaken), "admin-2");
  assert.deepEqual(reserved.asked, ["admin-2"], "« admin » is skipped without a read");
  assert.equal(await uniqueSlugWith("***", takenSet([]).isTaken), "pro");
});

test("uniqueSlugWith keeps a numbered address within SLUG_MAX_LENGTH and SLUG_PARAM_RE (a 60-character name that collides)", async () => {
  const root = "a".repeat(SLUG_MAX_LENGTH);
  assert.equal(slugify(root.repeat(2)), root, "a very long name is cut to the 60 characters");
  const taken = new Set([root]);
  const seen: string[] = [];
  for (let i = 2; i <= 12; i++) {
    const slug = await uniqueSlugWith(root, async (candidate) => taken.has(candidate));
    assert.ok(slug.length <= SLUG_MAX_LENGTH, `${slug} is ${slug.length} characters`);
    assert.match(slug, SLUG_PARAM_RE, slug);
    assert.ok(slug.endsWith(`-${i}`), `${slug} carries the number ${i}`);
    assert.equal(taken.has(slug), false, "a taken address is never given twice");
    taken.add(slug);
    seen.push(slug);
  }
  assert.equal(seen[0], `${"a".repeat(SLUG_MAX_LENGTH - 2)}-2`);
  assert.equal(seen[8], `${"a".repeat(SLUG_MAX_LENGTH - 3)}-10`, "two digits take one more character from the name");
  assert.equal(new Set(seen).size, seen.length);
});

test("uniqueSlugWith never leaves a double or trailing hyphen where it cut the name", async () => {
  // slugify(...) is « a×57-bc »: the cut for « -2 » falls right after the hyphen
  const base = `${"a".repeat(57)} bcd`;
  const taken = takenSet([slugify(base)]);
  const slug = await uniqueSlugWith(base, taken.isTaken);
  assert.equal(slug, `${"a".repeat(57)}-2`);
  assert.doesNotMatch(slug, /--/);
});

test("SLUG_PARAM_RE (public actions) and SLUG_MAX_LENGTH (address rules) state the same length", () => {
  assert.match("a".repeat(SLUG_MAX_LENGTH), SLUG_PARAM_RE);
  assert.doesNotMatch("a".repeat(SLUG_MAX_LENGTH + 1), SLUG_PARAM_RE);
  // every address checkSlug and typingSlug can produce is one an action accepts
  assert.match(typingSlug("x".repeat(80)), SLUG_PARAM_RE);
  const checked = checkSlug("y".repeat(80));
  assert.ok(checked.ok);
  assert.match(checked.slug, SLUG_PARAM_RE);
});
