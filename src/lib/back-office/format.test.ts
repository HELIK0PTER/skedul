import assert from "node:assert/strict";
import test from "node:test";

import {
  currencySymbol,
  dayLabel,
  expiryGroups,
  expiryLabel,
  expirySummary,
  formatCount,
  formatDayMonthOf,
  formatDayMonthTime,
  formatTimeRange,
  formatWhen,
  formatWhenShort,
  moneyInputValue,
  parseMoneyInput,
  pastCutNote,
  pastHeading,
  planningHref,
  plural,
  pluralWord,
  yearOf,
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
    "dim. 29 mars 2026 · 01:30 à 03:30 (changement d'heure)",
  );
  assert.equal(
    formatWhen(at("2026-10-25T00:30:00Z"), at("2026-10-25T01:30:00Z"), PARIS),
    "dim. 25 octobre 2026 · 02:30 à 02:30 (changement d'heure)",
  );
  assert.equal(
    formatWhen(at("2026-03-08T09:30:00Z"), at("2026-03-08T10:30:00Z"), LA),
    "dim. 8 mars 2026 · 01:30 à 03:30 (changement d'heure)",
  );
  assert.equal(
    formatWhen(at("2026-11-01T08:30:00Z"), at("2026-11-01T09:30:00Z"), LA),
    "dim. 1er novembre 2026 · 01:30 à 01:30 (changement d'heure)",
  );
});

test("formatTimeRange names the end's day when it is not the start's, judged in the zone (P6 B4)", () => {
  // overnight: the end falls on the next local day
  assert.equal(formatTimeRange(at("2026-10-12T20:00:00Z"), at("2026-10-12T23:00:00Z"), PARIS), "22:00 à 01:00 le lendemain");
  assert.equal(
    formatWhen(at("2026-10-12T20:00:00Z"), at("2026-10-12T23:00:00Z"), PARIS),
    "lun. 12 octobre 2026 · 22:00 à 01:00 le lendemain",
  );
  // an end at midnight closes the same evening
  assert.equal(formatTimeRange(at("2026-10-12T21:00:00Z"), at("2026-10-12T22:00:00Z"), PARIS), "23:00 à 00:00");
  // a later day is named
  assert.equal(formatTimeRange(at("2026-10-12T12:00:00Z"), at("2026-10-14T08:00:00Z"), PARIS), "14:00 au 14/10 à 10:00");
  assert.equal(formatTimeRange(at("2026-10-12T12:00:00Z"), at("2026-10-13T22:00:00Z"), PARIS), "14:00 au 14/10 à 00:00");
  // the same instants stay on one day in Los Angeles
  assert.equal(formatTimeRange(at("2026-10-12T20:00:00Z"), at("2026-10-12T23:00:00Z"), LA), "13:00 à 16:00");
});

test("formatTimeRange flags a range across a change of time, and only such a range (P6 B4)", () => {
  // Paris falls back on 25 October 2026: 02:30 summer time, then 02:30 winter time an hour later
  assert.equal(formatTimeRange(at("2026-10-25T00:30:00Z"), at("2026-10-25T01:30:00Z"), PARIS), "02:30 à 02:30 (changement d'heure)");
  // Paris springs forward on 29 March 2026
  assert.equal(formatTimeRange(at("2026-03-29T00:30:00Z"), at("2026-03-29T01:30:00Z"), PARIS), "01:30 à 03:30 (changement d'heure)");
  // the same day, later on: no change inside the range
  assert.equal(formatTimeRange(at("2026-10-25T09:00:00Z"), at("2026-10-25T10:00:00Z"), PARIS), "10:00 à 11:00");
  // overnight across the change: both notes
  assert.equal(
    formatTimeRange(at("2026-10-24T21:00:00Z"), at("2026-10-25T02:00:00Z"), PARIS),
    "23:00 à 03:00 le lendemain (changement d'heure)",
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

test("expiryLabel agrees with the count it names: one ticket valable, several valables", () => {
  const now = at("2026-10-14T10:00:00Z");
  const expiry = at("2026-12-12T23:00:00Z");
  assert.equal(expiryLabel(expiry, PARIS, now, 1), "valable jusqu'au 12/12 inclus");
  assert.equal(expiryLabel(expiry, PARIS, now, 2), "valables jusqu'au 12/12 inclus");
  assert.equal(expiryLabel(expiry, PARIS, now, 3), "valables jusqu'au 12/12 inclus");
  assert.equal(expiryLabel(expiry, PARIS, now), "valable jusqu'au 12/12 inclus", "no count: a single ticket");
  assert.equal(expiryLabel(null, PARIS, now, 3), "sans limite de validité", "no limit has no agreement");
});

test("expiryGroups: one group per last valid day, soonest first, no limit last; the year only when it is not this one", () => {
  const now = at("2026-10-14T10:00:00Z");
  const groups = expiryGroups(
    [
      { expiresAt: null, count: 1 },
      { expiresAt: at("2027-04-15T22:00:00Z"), count: 10 },
      // two instants of the same local last day (12/12 in Paris) make one group
      { expiresAt: at("2026-12-12T23:00:00Z"), count: 1 },
      { expiresAt: at("2026-12-12T22:30:00Z"), count: 1 },
    ],
    PARIS,
    now,
  );
  assert.deepEqual(groups, [
    { count: 2, text: "valables jusqu'au 12/12 inclus" },
    { count: 10, text: "valables jusqu'au 15/04/2027 inclus" },
    { count: 1, text: "sans limite de validité" },
  ]);
  assert.deepEqual(expiryGroups([{ expiresAt: at("2026-12-12T23:00:00Z"), count: 1 }], PARIS, now), [
    { count: 1, text: "valable jusqu'au 12/12 inclus" },
  ]);
  assert.deepEqual(expiryGroups([], PARIS, now), []);
});

test("expirySummary: « N valables jusqu'au JJ/MM inclus » then « N sans limite de validité », fr-FR thousands", () => {
  const now = at("2026-10-14T10:00:00Z");
  assert.deepEqual(
    expirySummary(
      [
        { expiresAt: at("2026-12-12T23:00:00Z"), count: 1 },
        { expiresAt: at("2027-01-12T23:00:00Z"), count: 1500 },
        { expiresAt: null, count: 2 },
      ],
      PARIS,
      now,
    ),
    [
      "1 valable jusqu'au 12/12 inclus",
      `${(1500).toLocaleString("fr-FR")} valables jusqu'au 12/01/2027 inclus`,
      "2 sans limite de validité",
    ],
  );
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

test("pastHeading counts every booking of an ended séance, fr-FR thousands", () => {
  assert.equal(pastHeading(1), "Passées (1)");
  assert.equal(pastHeading(52), "Passées (52)");
  assert.equal(pastHeading(1234), `Passées (${(1234).toLocaleString("fr-FR")})`);
});

test("pastCutNote says the list was cut, only when it was", () => {
  assert.equal(pastCutNote(50, 50), null);
  assert.equal(pastCutNote(3, 3), null);
  assert.equal(pastCutNote(0, 0), null);
  assert.equal(pastCutNote(50, 63), "Les 50 plus récentes sur 63.");
  assert.equal(pastCutNote(50, 1234), `Les 50 plus récentes sur ${(1234).toLocaleString("fr-FR")}.`);
  assert.equal(pastCutNote(1, 3), "La plus récente sur 3.");
  assert.doesNotMatch(pastCutNote(50, 63) ?? "", DASH);
});

test("yearOf and dayLabel: the year is the local one, and only a day outside it names its year", () => {
  assert.equal(yearOf(at("2026-12-31T23:30:00Z"), PARIS), 2027, "Paris is already in 2027");
  assert.equal(yearOf(at("2026-12-31T23:30:00Z"), LA), 2026);
  assert.equal(dayLabel("2026-10-12", 2026), "12/10");
  assert.equal(dayLabel("2025-10-12", 2026), "12/10/2025");
  assert.equal(dayLabel("2027-01-03", 2026), "03/01/2027");
});

// R6: the history lines, the payments row's séance and the next séance used to drop the year: « 12/10 » could be
// last October. The year rule is the one of expiryLabel and of the wallet: written when the day is not in now's year.
test("formatDayMonthOf, formatDayMonthTime and formatWhenShort name the year only when now is given and the year differs", () => {
  const now = at("2026-10-20T10:00:00Z");
  const sameYear = at("2026-10-12T17:00:00Z");
  const lastYear = at("2025-10-12T17:00:00Z");
  const nextYear = at("2027-01-12T17:00:00Z");
  assert.equal(formatDayMonthOf(sameYear, PARIS, now), "12/10");
  assert.equal(formatDayMonthOf(lastYear, PARIS, now), "12/10/2025");
  assert.equal(formatDayMonthOf(nextYear, PARIS, now), "12/01/2027");
  assert.equal(formatDayMonthOf(lastYear, PARIS), "12/10", "without now the year is never named (the previous behaviour)");
  assert.equal(formatDayMonthTime(sameYear, PARIS, now), "12/10 19:00");
  assert.equal(formatDayMonthTime(lastYear, PARIS, now), "12/10/2025 19:00");
  assert.equal(formatWhenShort(sameYear, PARIS, now), "lun. 12/10 · 19:00");
  assert.equal(formatWhenShort(nextYear, PARIS, now), "mar. 12/01/2027 · 18:00");
  assert.equal(formatWhenShort(nextYear, PARIS), "mar. 12/01 · 18:00");
});

test("the year rule reads both instants in the given zone", () => {
  // 31 December 23:30 UTC is already 2027 in Paris and still 2026 in Los Angeles.
  const lateDecember = at("2026-12-31T23:30:00Z");
  const now = at("2026-12-31T12:00:00Z");
  assert.equal(formatDayMonthOf(lateDecember, PARIS, now), "01/01/2027");
  assert.equal(formatDayMonthOf(lateDecember, LA, now), "31/12");
  // now itself is judged in the zone: 1 January 00:10 in Paris is still 31 December in Los Angeles
  const newYear = at("2026-12-31T23:10:00Z");
  const before = at("2026-12-31T12:00:00Z");
  assert.equal(formatDayMonthOf(before, PARIS, newYear), "31/12/2026");
  assert.equal(formatDayMonthOf(before, LA, newYear), "31/12");
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
      formatDayMonthOf(at("2025-10-12T17:00:00Z"), tz, start),
      formatWhenShort(at("2027-01-12T17:00:00Z"), tz, start),
      expiryLabel(null, tz, start),
      expiryLabel(at("2027-01-13T08:00:00Z"), tz, start),
      planningHref({ occurrenceId: "occ1", startsAt: start, tz }),
    );
  }
  outputs.push(plural(0, "séance", "séances"), plural(3, "séance", "séances"), moneyInputValue(2550), currencySymbol("eur"));
  for (const text of outputs) assert.equal(DASH.test(text), false, text);
});
