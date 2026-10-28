/**
 * Wiring guard for src/components/dashboard/occurrence-dialog.tsx. The dialog is a client component that imports
 * Server Actions, which the node:test runner cannot load, so the wiring is pinned on the source: the texts have their
 * own pure tests (confirm-copy.test.ts). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/dashboard/occurrence-dialog.tsx", "utf8");

test("an RDV shows no place row, and its lapsed hold freed a « créneau » (P5 T10, D § 3.14)", () => {
  // The place row is computed for a séance only and rendered only when there is one.
  assert.match(SOURCE, /const place = !isSeance\s*\? null\s*: item\.location/);
  assert.match(SOURCE, /\{place !== null && \(\s*<p className="flex items-start gap-1\.5 text-sm text-muted-foreground">\s*<MapPin/);
  assert.equal(SOURCE.split("{place}").length - 1, 1, "one place row, inside the guard");
  assert.match(SOURCE, /\{isRdv \? "Paiement non finalisé, créneau libéré" : "Paiement non finalisé, place libérée"\}/);
  assert.match(SOURCE, /isRdv=\{!isSeance\}/);
  assert.match(SOURCE, /<Badge variant="destructive">\{isSeance \? "Annulée" : "Annulé"\}<\/Badge>/);
  assert.match(SOURCE, /aria-label=\{isSeance \? "Inscrits" : "Client"\}/);
});

test("the unenrol « Motif » field says the reason is sent to the client (final review F11)", () => {
  const start = SOURCE.indexOf('confirm.kind === "unenroll" && (');
  assert.notEqual(start, -1, "the unenrol reason field is in the confirmation");
  const field = SOURCE.slice(start, SOURCE.indexOf("</ConfirmDialog>", start));
  assert.match(field, /<FormField[^>]*\boptional\b/, "a labelled optional field");
  assert.match(field, /help=\{unenrollReasonHelp\(/, "with the help line telling who reads the reason");
  assert.match(field, /<Textarea/, "the textarea stays the control");
});
