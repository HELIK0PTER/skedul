/**
 * Wiring guard of the unenrol wording on the two booking surfaces of the back office that are not the planning dialog
 * (occurrence-dialog.test.ts pins that one): the booking details of the dashboard and the bookings of a client. Both
 * import a Server Action, which the node:test runner cannot load, so the wiring is pinned on the source; the texts have
 * their own pure tests (confirm-copy.test.ts, planning-view.test.ts). An RDV booking reads « Annuler le rendez-vous »,
 * never « Désinscrire » (P5 D § 3.10). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const DETAIL = readFileSync("src/components/dashboard/booking-detail-dialog.tsx", "utf8");
const CLIENT = readFileSync("src/components/dashboard/client-bookings.tsx", "utf8");

test("the booking details name the action by the booking's kind, in the button, the confirmation and the status line", () => {
  assert.match(DETAIL, /\{unenrollLabel\(booking\.kind\)\}\s*<\/Button>/);
  assert.match(DETAIL, /copy=\{unenrollCopy\(\{\s*kind: booking\.kind,/);
  assert.match(DETAIL, /onClose\(unenrolledMessage\(\[booking\.customerName\], res\.cancelled, res\.ticketsReturned, booking\.kind\)\);/);
  assert.doesNotMatch(DETAIL, />\s*Désinscrire\s*</, "no literal « Désinscrire » label");
});

test("the bookings of a client name the action by each row's kind, in the button, the confirmation and the status line", () => {
  assert.match(CLIENT, /aria-label=\{`\$\{unenrollLabel\(row\.kind\)\} \$\{row\.title\}, \$\{row\.whenLabel\}`\}/);
  assert.match(CLIENT, /\{unenrollLabel\(row\.kind\)\}\s*<\/Button>/);
  assert.match(CLIENT, /const \{ occurrenceId, bookingId, kind \} = unenrolling;/);
  assert.match(CLIENT, /setNotice\(unenrolledMessage\(\[customerName\], res\.cancelled, res\.ticketsReturned, kind\)\);/);
  assert.match(CLIENT, /copy=\{unenrollCopy\(\{\s*kind: unenrolling\?\.kind \?\? "seance",/);
  assert.doesNotMatch(CLIENT, />\s*Désinscrire\s*</, "no literal « Désinscrire » label");
});
