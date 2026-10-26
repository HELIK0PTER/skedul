import assert from "node:assert/strict";
import test from "node:test";

import type { Db } from "@/lib/db/atomic";

import { readPublicPage } from "./profile-reads";

/** A database that fails the test on any use: what reaches it is a query. */
const NO_DB = new Proxy({} as Db, {
  get(_target, name) {
    throw new Error(`a query was started (db.${String(name)})`);
  },
});

test("readPublicPage: a segment that is no pro address (SLUG_PARAM_RE) is null without a query: a bot probe costs nothing (G4b)", async () => {
  // The layout checks the shape too, but Next resolves the page's generateMetadata alongside the layout: the read refuses
  // it as well, so neither runs a query for /.env or /wp-login.php.
  for (const slug of [".env", "wp-login.php", "", "A", "Altinha-Paris", "a b", "a/b", "%2F", "a".repeat(61)]) {
    assert.equal(await readPublicPage(NO_DB, slug), null, JSON.stringify(slug));
  }
});
