/**
 * Wiring guard for src/components/dashboard/occurrence-dialog.tsx. The dialog is a client component that imports
 * Server Actions, which the node:test runner cannot load, so the wiring is pinned on the source: the texts have their
 * own pure tests (confirm-copy.test.ts). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/dashboard/occurrence-dialog.tsx", "utf8");

test("the unenrol « Motif » field says the reason is sent to the client (final review F11)", () => {
  const start = SOURCE.indexOf('confirm.kind === "unenroll" && (');
  assert.notEqual(start, -1, "the unenrol reason field is in the confirmation");
  const field = SOURCE.slice(start, SOURCE.indexOf("</ConfirmDialog>", start));
  assert.match(field, /<FormField[^>]*\boptional\b/, "a labelled optional field");
  assert.match(field, /help=\{unenrollReasonHelp\(/, "with the help line telling who reads the reason");
  assert.match(field, /<Textarea/, "the textarea stays the control");
});
