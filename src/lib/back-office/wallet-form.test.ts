import assert from "node:assert/strict";
import test from "node:test";

import { BOUNDS } from "@/lib/tickets-vocab";

import { formatCount } from "./format";
import {
  checkClose,
  checkOffer,
  countCap,
  countMessage,
  LAST_CALENDAR_DAY,
  LAST_DAY_PAST,
  LAST_DAY_REQUIRED,
  LAST_DAY_TOO_FAR,
  NOTE_REQUIRED,
  parseCount,
} from "./wallet-form";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("parseCount: a whole number from 1 to max, trimmed; anything else names the bounds", () => {
  assert.deepEqual(parseCount("1", 100), { ok: true, count: 1 });
  assert.deepEqual(parseCount(" 3 ", 100), { ok: true, count: 3 });
  assert.deepEqual(parseCount("100", 100), { ok: true, count: 100 });
  const message = "Indiquez un nombre entier entre 1 et 100.";
  for (const raw of ["0", "101", "", "   ", "abc", "1.5", "-2", "1e999"]) {
    assert.deepEqual(parseCount(raw, 100), { ok: false, error: message }, `« ${raw} »`);
  }
});

test("parseCount: the maximum is the number of tickets the action can still take", () => {
  assert.deepEqual(parseCount("2", 2), { ok: true, count: 2 });
  assert.deepEqual(parseCount("3", 2), { ok: false, error: "Indiquez un nombre entier entre 1 et 2." });
  assert.deepEqual(parseCount("2", 1), { ok: false, error: "Indiquez 1." });
  assert.deepEqual(parseCount("1", 1), { ok: true, count: 1 });
  assert.equal(countMessage(1), "Indiquez 1.");
  assert.equal(countMessage(1500), `Indiquez un nombre entier entre 1 et ${formatCount(1500)}.`);
});

test("parseCount: with nothing left to act on, no count is valid and the message says so", () => {
  assert.deepEqual(parseCount("1", 0), { ok: false, error: "Aucun ticket disponible pour cette action." });
  assert.equal(countMessage(0), "Aucun ticket disponible pour cette action.");
  assert.equal(countMessage(-1), "Aucun ticket disponible pour cette action.");
});

test("countCap: the most one call can take is the tickets left, never more than the core's cap of one call", () => {
  assert.equal(BOUNDS.walletQuantity, 100);
  assert.equal(countCap(0), 0);
  assert.equal(countCap(3), 3);
  assert.equal(countCap(100), 100);
  assert.equal(countCap(101), 100);
  assert.equal(countCap(250), 100);
  // A group of 250 tickets: « Entre 1 et 100 », and 101 is refused in the browser instead of by the core.
  assert.deepEqual(parseCount("101", countCap(250)), { ok: false, error: "Indiquez un nombre entier entre 1 et 100." });
  assert.deepEqual(parseCount("100", countCap(250)), { ok: true, count: 100 });
});

test("checkOffer: quantity and validity are checked together, each error under its own field", () => {
  assert.deepEqual(checkOffer({ quantity: "3", validity: "none", until: "" }, "2026-10-20"), {
    ok: true,
    quantity: 3,
    lastValidDay: null,
  });
  assert.deepEqual(checkOffer({ quantity: "0", validity: "none", until: "" }, "2026-10-20"), {
    ok: false,
    errors: { quantity: "Indiquez un nombre entier entre 1 et 100." },
  });
  // The day typed under « Sans limite » is not sent.
  assert.deepEqual(checkOffer({ quantity: "1", validity: "none", until: "2020-01-01" }, "2026-10-20"), {
    ok: true,
    quantity: 1,
    lastValidDay: null,
  });
  assert.deepEqual(checkOffer({ quantity: "x", validity: "until", until: "" }, "2026-10-20"), {
    ok: false,
    errors: { quantity: "Indiquez un nombre entier entre 1 et 100.", until: LAST_DAY_REQUIRED },
  });
});

test("checkOffer: the last valid day is a calendar day, today or later, never the last day of the calendar", () => {
  const today = "2026-10-20";
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: "2026-10-20" }, today), {
    ok: true,
    quantity: 2,
    lastValidDay: "2026-10-20",
  });
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: "2026-11-19" }, today), {
    ok: true,
    quantity: 2,
    lastValidDay: "2026-11-19",
  });
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: "2026-10-19" }, today), {
    ok: false,
    errors: { until: LAST_DAY_PAST },
  });
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: LAST_CALENDAR_DAY }, today), {
    ok: false,
    errors: { until: LAST_DAY_TOO_FAR },
  });
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: "2026-02-30" }, today), {
    ok: false,
    errors: { until: "Date invalide." },
  });
  assert.deepEqual(checkOffer({ quantity: "2", validity: "until", until: "10000-01-01" }, today), {
    ok: false,
    errors: { until: "Date invalide." },
  });
});

test("checkClose: a quantity within the pool, and a note for the reason « Autre » only", () => {
  assert.deepEqual(checkClose({ quantity: "2", reason: "rembourse", note: "" }, 3), { ok: true, count: 2 });
  assert.deepEqual(checkClose({ quantity: "1", reason: "compense", note: "  " }, 1), { ok: true, count: 1 });
  assert.deepEqual(checkClose({ quantity: "1", reason: "autre", note: "Test" }, 4), { ok: true, count: 1 });
  assert.deepEqual(checkClose({ quantity: "1", reason: "autre", note: "   " }, 4), {
    ok: false,
    errors: { note: NOTE_REQUIRED },
  });
  assert.deepEqual(checkClose({ quantity: "5", reason: "autre", note: "" }, 4), {
    ok: false,
    errors: { quantity: "Indiquez un nombre entier entre 1 et 4.", note: NOTE_REQUIRED },
  });
});

test("the messages carry no em dash and no en dash", () => {
  for (const text of [LAST_DAY_PAST, LAST_DAY_REQUIRED, LAST_DAY_TOO_FAR, NOTE_REQUIRED, countMessage(1), countMessage(100)]) {
    assert.ok(!DASH.test(text), text);
  }
});
