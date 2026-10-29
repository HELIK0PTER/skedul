/**
 * Source guards of the event editor (P6 A17). Its « séance modifiée » recipients and its Google syncs come from a
 * select inside its own batch: a read after the commit could fail once the edit is saved, and the retry would then be
 * stale, so those mails would be lost for good (the rule fulfillment.ts already follows).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { bodyOf, codeView } from "@/test/source-guards";

const series = readFileSync("src/lib/booking/series.ts", "utf8");

test("editEventInPlace takes its recipients and its syncs from its batch, never from a read after the commit", () => {
  const body = codeView(bodyOf(series, "editEventInPlace"));
  const commit = body.indexOf("if (!res.ok) return failOf(res);");
  assert.notEqual(commit, -1, "the commit check is where the guard expects it");
  const afterCommit = body.slice(commit);
  assert.doesNotMatch(afterCommit, /\bawait\b/, "nothing is read once the edit is saved");
  assert.match(afterCommit, /res\.results\[futureAt\]/, "the future séances come from the batch result");
});

test("editEventInPlace reads the version before it checks a question id", () => {
  const body = codeView(bodyOf(series, "editEventInPlace"));
  const version = body.indexOf("ev.version !== input.seenVersion");
  assert.notEqual(version, -1);
  assert.ok(version < body.indexOf("existingIds.has("), "a stale editor hears « modifié entre-temps », not « Question inconnue »");
});
