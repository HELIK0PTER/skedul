/**
 * Wiring guards for the admin user search (P6 A4, the pro's client search of Decision 73 as model): the term an admin
 * types is a name or an e-mail, so it never reaches a URL, the browser history or the platform request log. The
 * component imports a Server Action and the page imports the database, which the node:test runner cannot load: what
 * they must keep is pinned on their source. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, rawErrorLogs } from "../../test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

test("the admin user search keeps the typed term in component state and sends it through a Server Action, never through the URL", () => {
  const search = source("src/components/admin/user-search.tsx");
  assert.match(search, /^"use client";/, "a client leaf");
  assert.match(search, /callOrFail\(\(\) => searchUsersAction\(\{ q, filter, page \}\)\)/, "the call cannot throw into React");
  assert.doesNotMatch(search, /\bname="q"/, "no field named q: nothing to serialise");
  assert.match(search, /<form role="search" method="post" onSubmit=\{submit\}/, "a posted form handled in the browser");
  for (const forbidden of [/useSearchParams/, /useRouter/, /\brouter\./, /window\.location/, /\bhistory\./, /encodeURIComponent/, /URLSearchParams/]) {
    assert.doesNotMatch(search, forbidden, `the component never builds or navigates to a URL carrying the term (${forbidden})`);
  }
  assert.match(search, /maxLength=\{USER_SEARCH_MAX\}/, "the limit of the schema");
  assert.match(search, /autoComplete="off"/, "the browser does not remember the typed names");
  assert.match(search, /<div role="status">/, "an always-mounted status region for the empty text and the count");
  // No server module in the client bundle (a type import is erased): the rows arrive formatted, the badges are the
  // client-safe ones.
  for (const line of search.split("\n").filter((l) => l.startsWith("import ") && !l.startsWith("import type "))) {
    assert.doesNotMatch(line, /@\/lib\/(suspension|db|admin"|admin-users")|@\/server\/admin-queries|user-badges/, line);
  }
  assert.match(search, /^import type \{ AdminUserPage[\w, ]*\} from "@\/lib\/admin-users";/m, "types only from the view model");
});

test("a search answer older than the latest request is ignored, and the pages of a search are read through the action too", () => {
  const search = source("src/components/admin/user-search.tsx");
  assert.match(search, /const latest = useRef\(0\);/, "a request counter");
  const run = search.slice(search.indexOf("function run("), search.indexOf("function submit("));
  const issued = run.indexOf("const request = ++latest.current;");
  const awaited = run.indexOf("await callOrFail(");
  const stale = run.indexOf("if (request !== latest.current) return;");
  assert.ok(issued !== -1 && issued < awaited && awaited < stale, "each request takes its number before the call, compared after it");
  assert.ok(stale < run.indexOf("setError(res.error)") && stale < run.indexOf("setFound("), "a stale answer sets neither the rows nor the error");
  assert.match(search, /onClick=\{\(\) => run\(found\.q, found\.page - 1\)\}/, "« Précédent » of a search stays in state");
  assert.match(search, /onClick=\{\(\) => run\(found\.q, found\.page \+ 1\)\}/, "« Suivant » of a search stays in state");
});

test("/admin/users reads ?filter=, ?page= and ?deleted= only: no q in its search params, the chips and the pager link without a term", () => {
  const page = source("src/app/admin/users/page.tsx");
  assert.doesNotMatch(page, /params\.q\b/, "the page never reads a search term");
  assert.doesNotMatch(page, /\bq\?\s*:/, "the type of searchParams has no q");
  assert.doesNotMatch(page, /<form/, "the page renders no form of its own");
  assert.match(page, /listUsers\(\{ q: "", filter, page \}\)/);
  assert.match(page, /<AdminUserSearch\s+key=\{`\$\{filter\}:\$\{page\}`\}/, "a filter or page link remounts the search, so no term follows it");
  assert.doesNotMatch(page, /sp\.set\("q"/, "no term in a link");
});

test("searchUsersAction: an active admin from the session, the input parsed by a strict schema, no raw error in a log", () => {
  const actions = source("src/server/admin.ts");
  const body = bodyOf(actions, "searchUsersAction");
  const guard = body.indexOf("await getAdminUser()");
  const parse = body.indexOf("parseFr(userSearchSchema, input)");
  const read = body.indexOf("listUsers(");
  assert.ok(guard !== -1 && guard < parse && parse < read, "the admin first, then the input, then the read");
  assert.match(body, /if \(!admin\) return \{ ok: false, error: "Accès refusé\." \};/);
  assert.doesNotMatch(body, /revalidatePath|redirect\(/, "a read: no revalidation, no navigation");
  assert.deepEqual(rawErrorLogs(body), [], "logSafeMessage only");
});
