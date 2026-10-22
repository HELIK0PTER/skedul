/**
 * Wiring guards for the client search (Decision 73, FR:UI-13): the pro's search terms are client names and e-mails,
 * so they never reach a URL, the browser history or the platform request log. The component imports a Server Action
 * and the page imports the database, which the node:test runner cannot load: what they must keep is pinned on their
 * source. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string): string => readFileSync(path, "utf8");

test("the client search keeps the typed term in component state and sends it through a Server Action, never through the URL", () => {
  const search = source("src/components/dashboard/client-search.tsx");
  assert.match(search, /^"use client";/, "a client leaf");
  assert.match(search, /callOrFail\(\(\) => searchClientsAction\(\{ q, filter \}\)\)/, "the call cannot throw into React");
  assert.doesNotMatch(search, /\bname="q"/, "no field named q: nothing to serialise");
  assert.doesNotMatch(search, /<form[^>]*\baction=/, "no GET form to /dashboard/clients");
  for (const forbidden of [/useSearchParams/, /useRouter/, /\brouter\./, /window\.location/, /\bhistory\./, /encodeURIComponent/]) {
    assert.doesNotMatch(search, forbidden, `the component never builds or navigates to a URL carrying the term (${forbidden})`);
  }
  assert.match(search, /maxLength=\{100\}/, "the limit of the schema");
  assert.match(search, /autoComplete="off"/, "the browser does not remember client names");
  assert.match(search, /<div role="status">/, "an always-mounted status region for the empty text and the capped line");
});

test("/dashboard/clients reads ?filter= only: no q in its search params, the chips link without a term", () => {
  const page = source("src/app/dashboard/clients/page.tsx");
  assert.doesNotMatch(page, /params\.q\b/, "the page never reads a search term");
  assert.doesNotMatch(page, /\bq\?\s*:/, "the type of searchParams has no q");
  assert.match(page, /getClientsPage\(ctx\.professionalId, \{ q: "", filter \}\)/);
  assert.match(page, /<ClientSearch key=\{filter\}/, "a filter change remounts the search, so no term follows a chip");
  assert.match(page, /href: clientsHref\(f\),/);
});

test("searchClientsAction is a read: runProQuery (fresh session, no revalidation, no effect)", () => {
  const actions = source("src/server/pro-clients.ts");
  const at = actions.indexOf("export async function searchClientsAction");
  assert.notEqual(at, -1, "exported");
  // The body ends at the first « } » alone on its line: the « }): » closing the parameter type is not it.
  const rest = actions.slice(at);
  const end = rest.search(/\n\}\r?\n/);
  const body = end === -1 ? rest : rest.slice(0, end);
  assert.match(body, /runProQuery\("searchClients", \(ctx, now\) => searchClientsCore\(db, ctx, input, now\)\)/);
  assert.doesNotMatch(body, /runProAction/);
});
