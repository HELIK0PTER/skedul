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

/** The text of `function <name>(` up to the next function of the component (or the end of the file). */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is declared`);
  const next = src.indexOf("\n  function ", start + 1);
  const ret = src.indexOf("\n  return (", start + 1);
  const ends = [next, ret].filter((i) => i !== -1);
  return src.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
}

test("a search answer older than the latest request or reset is ignored: a late answer cannot undo « Voir tous les clients » (G3b)", () => {
  const search = source("src/components/dashboard/client-search.tsx");
  assert.match(search, /const latest = useRef\(0\);/, "a request counter");

  const submit = functionBody(search, "submit");
  const issued = submit.indexOf("const request = ++latest.current;");
  const awaited = submit.indexOf("await callOrFail(");
  const stale = submit.indexOf("if (request !== latest.current) return;");
  assert.ok(issued !== -1 && issued < awaited, "each request takes its number before the call");
  assert.ok(awaited < stale, "the answer is compared with the latest request after the await");
  assert.ok(stale < submit.indexOf("setError(res.error)") && stale < submit.indexOf("setFound({ q, rows: res.rows })"), "a stale answer sets neither the rows nor the error");

  // While a request is pending, submit returns first: an empty submit can only come when none is, and the reset button
  // is what invalidates a request in flight. Both forget the search and bump the counter.
  assert.ok(submit.indexOf("if (pending) return;") !== -1 && submit.indexOf("if (pending) return;") < submit.indexOf('if (q === "") {'), "a submit while a request is pending does nothing, before the empty term is read");
  const emptyTerm = submit.slice(submit.indexOf('if (q === "") {'), submit.indexOf("startTransition("));
  assert.match(emptyTerm, /latest\.current \+= 1;/, "an empty submit (no request is pending then) keeps the counter in step");
  assert.match(functionBody(search, "showAll"), /latest\.current \+= 1;/, "the reset button invalidates a request still in flight");
});

test("a search that returns clients announces how many in the always-mounted status region, with the plural of the codebase (G3b)", () => {
  const search = source("src/components/dashboard/client-search.tsx");
  const region = search.slice(search.indexOf('<div role="status">'));
  assert.match(search, /plural\(rows\.length, "client trouvé", "clients trouvés"\)/, "« 1 client trouvé » / « 3 clients trouvés » through plural()");
  assert.match(search, /import \{ formatCount, plural \} from "@\/lib\/back-office\/format";/);
  // Only a typed search is announced (the rows the page rendered are not an answer to anything), after the empty and capped cases.
  assert.match(
    region,
    /\) : capped \? \([\s\S]*?\) : searched !== "" \? \(\s*<p className="mt-3 text-sm text-zinc-600">\{plural\(rows\.length, "client trouvé", "clients trouvés"\)\}<\/p>\s*\) : null\}\s*<\/div>/,
    "the found line is the last branch of the status region",
  );
});
