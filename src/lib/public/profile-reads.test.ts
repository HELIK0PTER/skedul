import assert from "node:assert/strict";
import test from "node:test";

import type { Db } from "@/lib/db/atomic";

import { readPublicPage, readPublicProfile } from "./profile-reads";

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

test("readPublicProfile: a segment that is no pro address is null without a query either, so the metadata of the sub-pages and the espace cost a bot nothing (G4c)", async () => {
  // resolvePublicPro and getSpaceProfile read through it: /.env/merci and /x.php/seance/y reach generateMetadata before the
  // layout's 404 is known, and each used to run one professional query. A segment of a valid shape (/wp-admin/offre/z)
  // does need one query to be known as no pro: the layout's, which generateMetadata and the page now share (getPublicPage).
  for (const slug of [".env", "wp-login.php", "x.php", "", "A", "Altinha-Paris", "a b", "a/b", "%2F", "a".repeat(61)]) {
    assert.equal(await readPublicProfile(NO_DB, slug), null, JSON.stringify(slug));
    assert.equal(await readPublicProfile(NO_DB, slug, { includeSuspended: true }), null, `${JSON.stringify(slug)} with includeSuspended`);
  }
});
