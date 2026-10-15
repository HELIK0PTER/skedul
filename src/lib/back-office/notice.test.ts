import assert from "node:assert/strict";
import test from "node:test";

import { BOUNDS } from "@/lib/tickets-vocab";

import { NOTICE_PRESETS, NOTICE_TOO_LONG, noticeExceedsHorizon, noticeLabel } from "./notice";

test("the presets are the twelve of Q13, in order", () => {
  assert.deepEqual(NOTICE_PRESETS, [
    { minutes: 0, label: "Jusqu'au début" },
    { minutes: 15, label: "15 min avant" },
    { minutes: 30, label: "30 min avant" },
    { minutes: 60, label: "1 h avant" },
    { minutes: 120, label: "2 h avant" },
    { minutes: 180, label: "3 h avant" },
    { minutes: 360, label: "6 h avant" },
    { minutes: 720, label: "12 h avant" },
    { minutes: 1440, label: "24 h avant" },
    { minutes: 2880, label: "2 jours avant" },
    { minutes: 4320, label: "3 jours avant" },
    { minutes: 10080, label: "7 jours avant" },
  ]);
});

test("every preset is inside the notice bounds and the list is strictly increasing", () => {
  let last = -1;
  for (const preset of NOTICE_PRESETS) {
    assert.ok(preset.minutes >= BOUNDS.minNoticeMinutes.min && preset.minutes <= BOUNDS.minNoticeMinutes.max, preset.label);
    assert.ok(preset.minutes > last, preset.label);
    last = preset.minutes;
  }
});

test("noticeLabel returns the preset label, else a readable duration", () => {
  assert.equal(noticeLabel(0), "Jusqu'au début");
  assert.equal(noticeLabel(1440), "24 h avant");
  assert.equal(noticeLabel(45), "45 min avant");
  assert.equal(noticeLabel(1), "1 min avant");
  assert.equal(noticeLabel(90), "1 h 30 min avant");
  assert.equal(noticeLabel(61), "1 h 1 min avant");
  assert.equal(noticeLabel(240), "4 h avant");
  assert.equal(noticeLabel(1500), "25 h avant");
  assert.equal(noticeLabel(7200), "5 jours avant");
  assert.equal(noticeLabel(14400), "10 jours avant");
});

test("noticeExceedsHorizon is true only when the notice is longer than the horizon", () => {
  assert.equal(noticeExceedsHorizon(1440, 1), false);
  assert.equal(noticeExceedsHorizon(1441, 1), true);
  assert.equal(noticeExceedsHorizon(10080, 7), false);
  assert.equal(noticeExceedsHorizon(10080, 6), true);
  assert.equal(noticeExceedsHorizon(0, 1), false);
});

test("NOTICE_TOO_LONG is the exact French sentence", () => {
  assert.equal(NOTICE_TOO_LONG, "Le délai minimum dépasse l'horizon de réservation : réduisez-le ou allongez l'horizon.");
});
