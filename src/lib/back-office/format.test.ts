import assert from "node:assert/strict";
import test from "node:test";

import {
  currencySymbol,
  expiryLabel,
  formatCount,
  formatDayMonthOf,
  formatDayMonthTime,
  formatTimeRange,
  formatWhen,
  formatWhenShort,
  moneyInputValue,
  parseMoneyInput,
  planningHref,
  plural,
  pluralWord,
} from "./format";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);
const DASH = /[\u2014\u2013]/;

test("formatTimeRange and formatWhen read in the given zone, host zone ignored", () => {
  const start = at("2026-10-12T17:00:00Z");
  const end = at("2026-10-12T18:00:00Z");
  assert.equal(formatTimeRange(start, end, PARIS), "19:00 à 20:00");
  assert.equal(formatWhen(start, end, PARIS), "lun. 12 octobre 2026 · 19:00 à 20:00");
  assert.equal(formatTimeRange(start, end, LA), "10:00 à 11:00");
  assert.equal(formatWhen(start, end, LA), "lun. 12 octobre 2026 · 10:00 à 11:00");
});

test("formatWhen crosses the day boundary per zone", () => {
  const start = at("2026-10-12T02:00:00Z");
  const end = at("2026-10-12T03:00:00Z");
  assert.equal(formatWhen(start, end, PARIS), "lun. 12 octobre 2026 · 04:00 à 05:00");
  assert.equal(formatWhen(start, end, LA), "dim. 11 octobre 2026 · 19:00 à 20:00");
});

test("formatWhen on the DST days of Paris and Los Angeles", () => {
  assert.equal(
    formatWhen(at("2026-03-29T00:30:00Z"), at("2026-03-29T01:30:00Z"), PARIS),
    "dim. 29 mars 2026 · 01:30 à 03:30",
  );
  assert.equal(
    formatWhen(at("2026-10-25T00:30:00Z"), at("2026-10-25T01:30:00Z"), PARIS),
    "dim. 25 octobre 2026 · 02:30 à 02:30",
  );
  assert.equal(
    formatWhen(at("2026-03-08T09:30:00Z"), at("2026-03-08T10:30:00Z"), LA),
    "dim. 8 mars 2026 · 01:30 à 03:30",
  );
  assert.equal(
    formatWhen(at("2026-11-01T08:30:00Z"), at("2026-11-01T09:30:00Z"), LA),
    "dim. 1er novembre 2026 · 01:30 à 01:30",
  );
});

test("formatWhen writes « 1er » on the first of a month and keeps 11, 21 and 31", () => {
  const hour = (iso: string) => [at(iso), at(new Date(Date.parse(iso) + 3_600_000).toISOString())] as const;
  assert.equal(formatWhen(...hour("2026-12-01T09:00:00Z"), PARIS), "mar. 1er décembre 2026 · 10:00 à 11:00");
  assert.equal(formatWhen(...hour("2026-10-11T09:00:00Z"), PARIS), "dim. 11 octobre 2026 · 11:00 à 12:00");
  assert.equal(formatWhen(...hour("2026-10-21T09:00:00Z"), PARIS), "mer. 21 octobre 2026 · 11:00 à 12:00");
  assert.equal(formatWhen(...hour("2026-10-31T09:00:00Z"), PARIS), "sam. 31 octobre 2026 · 10:00 à 11:00");
  // The 1 of a time or a count is not a day.
  assert.equal(formatWhen(...hour("2026-10-12T17:01:00Z"), PARIS), "lun. 12 octobre 2026 · 19:01 à 20:01");
});

test("formatWhenShort, formatDayMonthOf and formatDayMonthTime", () => {
  const start = at("2026-10-12T17:00:00Z");
  assert.equal(formatWhenShort(start, PARIS), "lun. 12/10 · 19:00");
  assert.equal(formatWhenShort(start, LA), "lun. 12/10 · 10:00");
  assert.equal(formatWhenShort(at("2026-03-29T01:30:00Z"), PARIS), "dim. 29/03 · 03:30");

  const late = at("2026-10-12T22:30:00Z");
  assert.equal(formatDayMonthOf(late, PARIS), "13/10");
  assert.equal(formatDayMonthOf(late, LA), "12/10");

  const history = at("2026-10-12T12:03:00Z");
  assert.equal(formatDayMonthTime(history, PARIS), "12/10 14:03");
  assert.equal(formatDayMonthTime(history, LA), "12/10 05:03");
});

test("expiryLabel: no expiry, same year, other year", () => {
  const now = at("2026-10-14T10:00:00Z");
  assert.equal(expiryLabel(null, PARIS, now), "sans limite de validité");
  // Expiry = local midnight after the last valid day (12/12 in Paris).
  assert.equal(expiryLabel(at("2026-12-12T23:00:00Z"), PARIS, now), "valable jusqu'au 12/12 inclus");
  assert.equal(expiryLabel(at("2026-12-31T23:00:00Z"), PARIS, now), "valable jusqu'au 31/12 inclus");
  assert.equal(expiryLabel(at("2027-01-12T23:00:00Z"), PARIS, now), "valable jusqu'au 12/01/2027 inclus");
});

test("expiryLabel reads the last valid day and the year in the given zone", () => {
  const now = at("2026-10-14T10:00:00Z");
  // 2027-01-13 00:00 in Los Angeles: the last valid day is 12/01/2027.
  assert.equal(expiryLabel(at("2027-01-13T08:00:00Z"), LA, now), "valable jusqu'au 12/01/2027 inclus");
  // The same last day (31/12/2026) shows its year once "now" is in 2027 in the zone.
  const expiry = at("2026-12-31T23:00:00Z");
  assert.equal(expiryLabel(expiry, PARIS, at("2027-01-01T03:00:00Z")), "valable jusqu'au 31/12/2026 inclus");
  assert.equal(expiryLabel(expiry, PARIS, at("2026-12-01T03:00:00Z")), "valable jusqu'au 31/12 inclus");
  // Still 31 December in Los Angeles at 03:00Z on 1 January: same year.
  assert.equal(expiryLabel(at("2027-01-01T08:00:00Z"), LA, at("2027-01-01T03:00:00Z")), "valable jusqu'au 31/12 inclus");
});

test("plural: 0 and 1 take the singular, fr-FR thousands", () => {
  assert.equal(plural(0, "séance", "séances"), "0 séance");
  assert.equal(plural(1, "séance", "séances"), "1 séance");
  assert.equal(plural(2, "séance", "séances"), "2 séances");
  assert.equal(plural(1000, "séance", "séances"), `${(1000).toLocaleString("fr-FR")} séances`);
});

test("formatCount: fr-FR thousands, the format every count shown to the pro uses (plural included)", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(7), "7");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1500), (1500).toLocaleString("fr-FR"));
  assert.notEqual(formatCount(1500), "1500");
  assert.equal(plural(1500, "séance", "séances"), `${formatCount(1500)} séances`);
});

test("pluralWord: the word alone, 0 and 1 singular, an empty field (NaN) plural", () => {
  assert.equal(pluralWord(0, "jour", "jours"), "jour");
  assert.equal(pluralWord(1, "jour", "jours"), "jour");
  assert.equal(pluralWord(2, "jour", "jours"), "jours");
  assert.equal(pluralWord(60, "heure", "heures"), "heures");
  assert.equal(pluralWord(Number.NaN, "jour", "jours"), "jours");
  assert.equal(plural(1, "jour", "jours"), `1 ${pluralWord(1, "jour", "jours")}`);
});

test("planningHref points at the Monday of the séance in the pro zone", () => {
  // Sunday 18 October 2026, 18:00 in Paris: the Monday before is the 12th.
  assert.equal(
    planningHref({ occurrenceId: "occ1", startsAt: at("2026-10-18T16:00:00Z"), tz: PARIS }),
    "/dashboard/planning?semaine=2026-10-12&seance=occ1",
  );
  // Monday 19 October: its own week.
  assert.equal(
    planningHref({ occurrenceId: "occ1", startsAt: at("2026-10-19T16:00:00Z"), tz: PARIS }),
    "/dashboard/planning?semaine=2026-10-19&seance=occ1",
  );
  // The same instant is Monday 12 in Paris and Sunday 11 in Los Angeles.
  const boundary = "2026-10-12T02:00:00.000Z";
  assert.equal(
    planningHref({ occurrenceId: "occ1", startsAt: boundary, tz: PARIS }),
    "/dashboard/planning?semaine=2026-10-12&seance=occ1",
  );
  assert.equal(
    planningHref({ occurrenceId: "occ1", startsAt: boundary, tz: LA }),
    "/dashboard/planning?semaine=2026-10-05&seance=occ1",
  );
  assert.equal(
    planningHref({ occurrenceId: "a b&c", startsAt: boundary, tz: PARIS }),
    "/dashboard/planning?semaine=2026-10-12&seance=a%20b%26c",
  );
});

test("parseMoneyInput accepts 25, 25,5 and 25.50 and refuses the rest", () => {
  assert.equal(parseMoneyInput("25"), 2500);
  assert.equal(parseMoneyInput("25,5"), 2550);
  assert.equal(parseMoneyInput("25.50"), 2550);
  assert.equal(parseMoneyInput(" 12 "), 1200);
  assert.equal(parseMoneyInput("0,01"), 1);
  for (const bad of ["0", "0,00", "-3", "2,555", "abc", "", "  ", "1 000", "25,", ",5", "12345678"]) {
    assert.equal(parseMoneyInput(bad), null, JSON.stringify(bad));
  }
});

test("moneyInputValue and parseMoneyInput round-trip", () => {
  assert.equal(moneyInputValue(2550), "25,50");
  assert.equal(moneyInputValue(2500), "25");
  assert.equal(moneyInputValue(5), "0,05");
  assert.equal(moneyInputValue(100000), "1000");
  for (const cents of [1, 5, 100, 2550, 99999, 1000000]) {
    assert.equal(parseMoneyInput(moneyInputValue(cents)), cents, String(cents));
  }
});

test("currencySymbol uses the narrow symbol of the currency", () => {
  assert.equal(currencySymbol("eur"), "€");
  assert.equal(currencySymbol("EUR"), "€");
  assert.equal(currencySymbol("zz"), "ZZ");
});

test("no output contains an em or en dash", () => {
  const start = at("2026-10-12T17:00:00Z");
  const end = at("2026-10-12T18:00:00Z");
  const outputs: string[] = [];
  for (const tz of [PARIS, LA]) {
    outputs.push(
      formatTimeRange(start, end, tz),
      formatWhen(start, end, tz),
      formatWhenShort(start, tz),
      formatDayMonthOf(start, tz),
      formatDayMonthTime(start, tz),
      expiryLabel(null, tz, start),
      expiryLabel(at("2027-01-13T08:00:00Z"), tz, start),
      planningHref({ occurrenceId: "occ1", startsAt: start, tz }),
    );
  }
  outputs.push(plural(0, "séance", "séances"), plural(3, "séance", "séances"), moneyInputValue(2550), currencySymbol("eur"));
  for (const text of outputs) assert.equal(DASH.test(text), false, text);
});
