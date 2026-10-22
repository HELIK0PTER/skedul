/**
 * Wiring guard for src/server/client.ts, the "use server" file of the client actions. It imports the action plumbing
 * (next/cache, next/server), which the node:test runner cannot load, so the wiring is pinned on the source; the
 * decisions themselves have their own tests (client-actions.db.test.ts, run-action.test.ts). Tasks 21 and 21a add
 * their actions to this file: every rule below holds for them too. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/server/client.ts", "utf8");

/** Every `export async function`: its name, its parameter list and its body (up to the next export). */
function exportedActions(): { name: string; params: string; body: string }[] {
  const starts = [...SOURCE.matchAll(/^export async function (\w+)\(([^)]*)\)/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    params: m[2],
    body: SOURCE.slice(m.index, starts[i + 1]?.index ?? SOURCE.length),
  }));
}

test("client.ts is a Server Actions file whose exports are async functions (types aside)", () => {
  assert.ok(SOURCE.trimStart().startsWith('"use server"'), "the directive comes first");
  const exports = SOURCE.split(/\r?\n/).filter((line) => line.startsWith("export "));
  assert.ok(exports.length > 0);
  for (const line of exports) {
    assert.match(line, /^export (async function|type|interface) /, `only async functions are exported: ${line}`);
  }
  assert.ok(exportedActions().some((a) => a.name === "updateMyNameAction"));
  assert.ok(exportedActions().some((a) => a.name === "revokeMyLinksAction"));
});

test("no action takes an identity from the browser: ids and e-mails come from the session or the slug", () => {
  for (const action of exportedActions()) {
    assert.doesNotMatch(action.params, /userId|email|customerId|professionalId|session|impersonat/i, `${action.name}(${action.params})`);
  }
  const rename = exportedActions().find((a) => a.name === "updateMyNameAction");
  assert.match(rename?.params ?? "", /^input: \{ name: string \}$/);
  const revoke = exportedActions().find((a) => a.name === "revokeMyLinksAction");
  assert.equal(revoke?.params.trim(), "", "« Déconnecter mes liens » takes nothing");
});

test("every action goes through the wrappers that read the fresh session, check the slug and schedule the effects", () => {
  for (const action of exportedActions()) {
    assert.match(action.body, /\brun(Client|Public)Action\(/, action.name);
  }
  assert.doesNotMatch(SOURCE, /\bgetSession\(|\bgetFreshSession\(|\bgetCurrentUser\(|auth\.api/, "the cached session is never the identity");
  assert.match(SOURCE, /updateMyNameCore\(db, session, input, now\)/);
  assert.match(SOURCE, /revokeMyLinksCore\(db, session, now\)/);
});
