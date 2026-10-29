/**
 * Wiring guards for the Google Calendar connection while an admin impersonates a pro (P6 A6). The card imports Server
 * Actions and the settings page and src/server/pro.ts import next/*, which the node:test runner cannot load: what they
 * must keep is pinned on their source. The /link-social refusal itself is a DB test (src/lib/auth.db.test.ts, « A6 »).
 * Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf } from "../../test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

test("the settings page tells the card whether an admin impersonates, from the session", () => {
  const page = source("src/app/dashboard/settings/page.tsx");
  assert.match(page, /\bgetSession\(\),/, "the session read with the page's other reads");
  assert.match(page, /impersonating=\{Boolean\(session\?\.session\.impersonatedBy\)\}/);
});

test("while an admin impersonates, the card offers no connection and says why", () => {
  const card = source("src/components/dashboard/google-calendar-card.tsx");
  assert.match(card, /impersonating: boolean;/);
  assert.match(card, /<Button onClick=\{connect\} disabled=\{busy \|\| props\.impersonating\}>/);
  assert.match(card, /if \(props\.impersonating\) return;/, "connect itself refuses too");
  assert.match(card, /\{props\.impersonating && \(/);
  assert.match(card, /pendant que vous agissez au nom de ce pro/);
});

test("finalizeGoogleConnection refuses an impersonated session before it asks Google for a token", () => {
  const body = bodyOf(source("src/server/pro.ts"), "finalizeGoogleConnection");
  const refuse = body.indexOf("if (session?.session.impersonatedBy) return { ok: false, error: GOOGLE_REFUSED_WHILE_IMPERSONATING };");
  assert.ok(refuse !== -1, "the refusal");
  assert.ok(body.indexOf("const session = await getFreshSession();") < refuse, "read without the cookie cache");
  assert.ok(refuse < body.indexOf("getAccessToken"), "before any token or calendar call");
  assert.ok(refuse < body.indexOf(".update(professional)"), "and before any write");
});
