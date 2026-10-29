/**
 * The answer of an /admin/users action that threw (P6 X2): the pure mapping, then its wiring in src/server/admin.ts
 * (a "use server" module that loads the database and Better Auth, so it is pinned on its source). Run from the
 * repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

import { ADMIN_FAILURE_MESSAGES, adminFailure, type AdminFailureKind } from "./admin-failures";
import { logSafeMessage } from "./log-safe";

const KINDS = Object.keys(ADMIN_FAILURE_MESSAGES) as AdminFailureKind[];

test("adminFailure: one fixed French sentence per kind, never the thrown message; the detail reaches the log only through logSafeMessage (P6 X2)", () => {
  assert.deepEqual([...KINDS].sort(), ["delete", "impersonate", "reactivate", "role", "signOut", "suspend"]);
  for (const kind of KINDS) assert.match(ADMIN_FAILURE_MESSAGES[kind], /^\S.* n'a pas abouti\. Réessayez\.$/, kind);
  assert.equal(new Set(Object.values(ADMIN_FAILURE_MESSAGES)).size, KINDS.length, "one sentence per kind");
  const thrown: unknown[] = [
    // A Drizzle failure: the query, then its values (an address, a phone number).
    new Error('Failed query: delete from "user" where "user"."id" = $1 params: marie@exemple.fr,0612345678'),
    // A Better Auth APIError: English.
    Object.assign(new Error("You cannot ban yourself"), { status: "BAD_REQUEST" }),
    "not an Error",
    null,
  ];
  for (const kind of KINDS) {
    for (const err of thrown) {
      const lines: string[] = [];
      const answer = adminFailure(kind, err, (line) => lines.push(line));
      assert.deepEqual(answer, { ok: false, error: ADMIN_FAILURE_MESSAGES[kind] });
      assert.deepEqual(lines, [`[admin] ${kind} failed: ${logSafeMessage(err)}`]);
      assert.doesNotMatch(lines[0], /marie@exemple\.fr|0612345678/);
    }
  }
});

test("every admin action that catches answers adminFailure of its kind, and nothing in src/server/admin.ts reads a thrown message (P6 X2)", () => {
  const actions = readFileSync("src/server/admin.ts", "utf8");
  assert.match(actions, /import \{ adminFailure \} from "@\/lib\/admin-failures";/);
  const code = codeView(actions);
  assert.doesNotMatch(code, /\bfunction failure\b/, "no local mapping left");
  assert.doesNotMatch(code, /\.message\b/, "no thrown message reaches an answer");
  const expected: [string, AdminFailureKind][] = [
    ["suspendUser", "suspend"],
    ["reactivateUser", "reactivate"],
    ["signOutEverywhere", "signOut"],
    ["startImpersonation", "impersonate"],
    ["setAdminRole", "role"],
    ["deleteUser", "delete"],
  ];
  for (const [name, kind] of expected) {
    const body = bodyOf(actions, name);
    assert.equal((body.match(/\} catch \(err\) \{\s*return adminFailure\("(\w+)", err\);/g) ?? []).length, 1, name);
    assert.match(body, new RegExp(`\\} catch \\(err\\) \\{\\s*return adminFailure\\("${kind}", err\\);`), name);
  }
  // The role change had no catch at all: a database failure went to the error boundary. Promotion and demotion (with
  // the end of the demoted admin's impersonations) are one write each, so a failure leaves the role as it was.
  const role = bodyOf(actions, "setAdminRole");
  assert.match(role, /try \{[\s\S]*db\.update\(user\)\.set\(\{ role \}\)\.where\(eq\(user\.id, target\.id\)\)[\s\S]*db\.batch\(\[setRole, db\.delete\(session\)\.where\(eq\(session\.impersonatedBy, target\.id\)\)\]\)[\s\S]*\} catch \(err\) \{/);
});
