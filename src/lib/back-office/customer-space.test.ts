import assert from "node:assert/strict";
import test from "node:test";

import { cancelTextOf } from "./customer-space";

const PARIS = "Europe/Paris";
const NOW = new Date("2026-10-12T10:00:00Z");
const HOUR = 3_600_000;

/** A booking made a week ago whose occurrence the pro changed since: cancellable until the start, whatever the deadline. */
const changed = (startsInHours: number) => ({
  startsAt: new Date(NOW.getTime() + startsInHours * HOUR),
  bookingCreatedAt: new Date(NOW.getTime() - 7 * 24 * HOUR),
  changedAt: new Date(NOW.getTime() - HOUR),
  movedAt: null,
});

test("cancelTextOf: the until-the-start hint names a séance or a rendez-vous (final review UI-14)", () => {
  assert.equal(cancelTextOf(changed(5), 24, NOW, PARIS, "seance"), "Annulation en ligne possible jusqu'au début de la séance.");
  assert.equal(cancelTextOf(changed(5), 24, NOW, PARIS, "rdv"), "Annulation en ligne possible jusqu'au début du rendez-vous.");
});

test("cancelTextOf: before the deadline it gives the date, and after the start or the deadline nothing", () => {
  const far = { ...changed(72), changedAt: null };
  assert.match(cancelTextOf(far, 24, NOW, PARIS, "rdv") ?? "", /^Annulation en ligne possible jusqu'au [a-z]{3}\. \d{2}\/\d{2} · \d{2}:\d{2}\.$/);
  assert.equal(cancelTextOf({ ...far, startsAt: new Date(NOW.getTime() + 5 * HOUR) }, 24, NOW, PARIS, "seance"), null);
  assert.equal(cancelTextOf({ ...far, startsAt: new Date(NOW.getTime() - HOUR) }, 24, NOW, PARIS, "rdv"), null);
});
