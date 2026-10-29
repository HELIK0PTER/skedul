import assert from "node:assert/strict";
import test from "node:test";

import { likePattern } from "./search-sql";

test("likePattern wraps the text in % and leaves plain text alone", () => {
  assert.equal(likePattern("alice"), "%alice%");
  assert.equal(likePattern(""), "%%");
  assert.equal(likePattern("Élodie O'Neil"), "%Élodie O'Neil%");
});

test("likePattern escapes !, % and _ with ! (ILIKE ... ESCAPE '!')", () => {
  assert.equal(likePattern("100%"), "%100!%%");
  assert.equal(likePattern("a_b"), "%a!_b%");
  assert.equal(likePattern("hi!"), "%hi!!%");
  assert.equal(likePattern("!%_"), "%!!!%!_%");
  assert.equal(likePattern("\\"), "%\\%"); // the backslash is not special once ESCAPE is '!'
});
