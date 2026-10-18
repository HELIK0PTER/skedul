import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  dayOfWeek,
  diffDays,
  mondayOf,
  monthIndex,
  nthWeekdayOfMonth,
  parseKey,
  type DateKey,
} from "./civil-date";
import {
  countDatesBefore,
  describeRecurrence,
  dstNotes,
  expand,
  expandDates,
  expandWalk,
  EXPAND_MAX_DATES,
  lastSeriesDate,
  monthlyDayWarning,
  remainingCount,
  type RecurrenceRule,
} from "./recurrence";

const TZ = "Europe/Paris";

function rule(over: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    startDate: "2026-10-14",
    startMinute: 1140,
    durationMin: 60,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 4],
    monthlyBy: null,
    monthWeek: null,
    endMode: "never",
    untilDate: null,
    occurrenceCount: null,
    ...over,
  };
}

test("weekly Mon+Thu from a Wednesday: the start date itself is not a séance", () => {
  assert.deepEqual(expandDates(rule({}), "2026-10-14", "2026-10-29"), [
    "2026-10-15",
    "2026-10-19",
    "2026-10-22",
    "2026-10-26",
    "2026-10-29",
  ]);
});

test("weekly every 2 weeks counts weeks from the Monday of the start week", () => {
  assert.deepEqual(expandDates(rule({ interval: 2 }), "2026-10-01", "2026-11-12"), [
    "2026-10-15",
    "2026-10-26",
    "2026-10-29",
    "2026-11-09",
    "2026-11-12",
  ]);
});

test("weekly order inside a week is Monday..Sunday (Sunday comes last)", () => {
  assert.deepEqual(expandDates(rule({ startDate: "2026-10-12", weekdays: [0, 1] }), "2026-10-12", "2026-10-26"), [
    "2026-10-12",
    "2026-10-18",
    "2026-10-19",
    "2026-10-25",
    "2026-10-26",
  ]);
});

test("monthly on the 31st skips the months without a 31st", () => {
  const r = rule({ startDate: "2026-01-31", freq: "monthly", weekdays: null, monthlyBy: "day_of_month" });
  assert.deepEqual(expandDates(r, "2026-01-01", "2026-12-31"), [
    "2026-01-31",
    "2026-03-31",
    "2026-05-31",
    "2026-07-31",
    "2026-08-31",
    "2026-10-31",
    "2026-12-31",
  ]);
  assert.equal(monthlyDayWarning(r), "Certains mois n'ont pas de 31 : ils sont sautés.");
  assert.equal(monthlyDayWarning(rule({ startDate: "2026-01-15", freq: "monthly", weekdays: null, monthlyBy: "day_of_month" })), null);
  assert.equal(monthlyDayWarning(rule({})), null);
});

test("monthly 1st Sunday and last Friday", () => {
  const firstSunday = rule({ startDate: "2026-11-01", freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: 1 });
  assert.deepEqual(expandDates(firstSunday, "2026-11-01", "2027-01-31"), ["2026-11-01", "2026-12-06", "2027-01-03"]);
  const lastFriday = rule({ startDate: "2026-10-30", freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: -1 });
  assert.deepEqual(expandDates(lastFriday, "2026-10-01", "2026-12-31"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
});

test("monthly every 3 months jumps to the aligned month containing fromDate", () => {
  const r = rule({ startDate: "2026-01-15", freq: "monthly", interval: 3, weekdays: null, monthlyBy: "day_of_month" });
  assert.deepEqual(expandDates(r, "2026-05-01", "2027-02-01"), ["2026-07-15", "2026-10-15", "2027-01-15"]);
  assert.deepEqual(expandDates(r, "2026-04-16", "2026-07-15"), ["2026-07-15"]);
});

test("a monthly nth weekday before startDate in its first month is skipped", () => {
  // 2026-11-15 is a Sunday; the 1st Sunday of November (the 1st) precedes it.
  const r = rule({ startDate: "2026-11-15", freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: 1 });
  assert.deepEqual(expandDates(r, "2026-11-01", "2027-01-31"), ["2026-12-06", "2027-01-03"]);
});

test("daily every 3 days, and once", () => {
  const r = rule({ startDate: "2026-10-12", freq: "daily", interval: 3, weekdays: null });
  assert.deepEqual(expandDates(r, "2026-10-13", "2026-10-22"), ["2026-10-15", "2026-10-18", "2026-10-21"]);
  const once = rule({ startDate: "2026-10-12", freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 });
  assert.deepEqual(expandDates(once, "2026-10-01", "2026-10-31"), ["2026-10-12"]);
  assert.deepEqual(expandDates(once, "2026-10-13", "2026-10-31"), []);
});

test("until is inclusive and nothing is produced before startDate", () => {
  const r = rule({ endMode: "until", untilDate: "2026-10-22" });
  assert.deepEqual(expandDates(r, "2026-01-01", "2027-01-01"), ["2026-10-15", "2026-10-19", "2026-10-22"]);
  assert.deepEqual(expandDates(r, "2026-10-23", "2027-01-01"), []);
  assert.deepEqual(expandDates(rule({}), "2026-10-20", "2026-10-19"), []);
});

test("count walks from startDate: 5 weekly dates in total, even from after the 3rd", () => {
  const r = rule({ endMode: "count", occurrenceCount: 5 });
  assert.deepEqual(expandDates(r, "2026-01-01", "2027-12-31"), [
    "2026-10-15",
    "2026-10-19",
    "2026-10-22",
    "2026-10-26",
    "2026-10-29",
  ]);
  assert.deepEqual(expandDates(r, "2026-10-23", "2027-12-31"), ["2026-10-26", "2026-10-29"]);
  assert.deepEqual(expandDates(r, "2026-10-30", "2027-12-31"), []);
});

test("a daily series started 4 years ago still produces 400 dates in a few steps", () => {
  const r = rule({ startDate: "2022-10-12", freq: "daily", weekdays: null });
  const walked = expandWalk(r, "2026-10-12", addDays("2026-10-12", 399));
  assert.equal(walked.dates.length, 400);
  assert.equal(walked.dates[0], "2026-10-12");
  assert.equal(walked.dates[399], addDays("2026-10-12", 399));
  assert.ok(walked.steps <= 431, `steps ${walked.steps}`);
  assert.equal(walked.capped, false);
});

test("an old weekly every-3-weeks series jumps without walking from its start", () => {
  const r = rule({ startDate: "2016-01-06", interval: 3, weekdays: [3] });
  const walked = expandWalk(r, "2026-10-12", "2026-12-31");
  assert.ok(walked.steps <= diffDays("2026-10-12", "2026-12-31") + 31, `steps ${walked.steps}`);
  for (const d of walked.dates) {
    assert.equal(dayOfWeek(d), 3);
    assert.equal((diffDays(mondayOf("2016-01-06"), mondayOf(d)) / 7) % 3, 0);
  }
  assert.ok(walked.dates.length >= 3);
});

test("EXPAND_MAX_DATES caps one call", () => {
  const r = rule({ startDate: "2020-01-01", freq: "daily", weekdays: null });
  const walked = expandWalk(r, "2020-01-01", "2026-01-01");
  assert.equal(EXPAND_MAX_DATES, 1000);
  assert.equal(walked.dates.length, EXPAND_MAX_DATES);
  assert.equal(walked.dates[999], addDays("2020-01-01", 999));
  assert.equal(walked.capped, true);
});

test("a rule that could loop forever is refused", () => {
  assert.throws(() => expandDates(rule({ interval: 0 }), "2026-10-12", "2026-12-31"), RangeError);
  assert.throws(() => expandDates(rule({ weekdays: [] }), "2026-10-12", "2026-12-31"), RangeError);
  assert.throws(() => expandDates(rule({ freq: "monthly", weekdays: null }), "2026-10-12", "2026-12-31"), RangeError);
});

/** Brute-force reference: test every local day from startDate. */
function reference(r: RecurrenceRule, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  let produced = 0;
  for (let d = r.startDate; d <= to; d = addDays(d, 1)) {
    if (r.endMode === "until" && r.untilDate && d > r.untilDate) break;
    let match: boolean;
    if (r.freq === "once") match = d === r.startDate;
    else if (r.freq === "daily") match = diffDays(r.startDate, d) % r.interval === 0;
    else if (r.freq === "weekly") {
      const week = diffDays(mondayOf(r.startDate), mondayOf(d)) / 7;
      match = week % r.interval === 0 && (r.weekdays ?? []).includes(dayOfWeek(d));
    } else {
      const aligned = (monthIndex(d) - monthIndex(r.startDate)) % r.interval === 0;
      const { y, m, d: day } = parseKey(d);
      match =
        aligned &&
        (r.monthlyBy === "day_of_month"
          ? day === parseKey(r.startDate).d
          : d === nthWeekdayOfMonth(y, m, dayOfWeek(r.startDate), r.monthWeek ?? 1));
    }
    if (!match) continue;
    produced++;
    if (d >= from) out.push(d);
    if (r.endMode === "count" && produced >= (r.occurrenceCount ?? 0)) break;
  }
  return out;
}

test("the jumping expander matches a day-by-day reference on 300 seeded random rules", () => {
  // Park-Miller: deterministic, exact in double precision.
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  };
  for (let i = 0; i < 300; i++) {
    const startDate = addDays("2024-01-01", rand(900));
    const freq = (["daily", "weekly", "monthly"] as const)[rand(3)];
    const interval = 1 + rand(freq === "daily" ? 31 : freq === "weekly" ? 6 : 12);
    const weekdays = freq === "weekly" ? [...new Set([rand(7), rand(7), rand(7)])].sort((a, b) => a - b) : null;
    const monthlyBy = freq === "monthly" ? (rand(2) === 0 ? "day_of_month" : "weekday") : null;
    const monthWeek = monthlyBy === "weekday" ? ([1, 2, 3, 4, -1] as const)[rand(5)] : null;
    const endMode = (["never", "until", "count"] as const)[rand(3)];
    const r = rule({
      startDate,
      freq,
      interval,
      weekdays,
      monthlyBy,
      monthWeek,
      endMode,
      untilDate: endMode === "until" ? addDays(startDate, rand(800)) : null,
      occurrenceCount: endMode === "count" ? 1 + rand(40) : null,
    });
    const from = addDays(startDate, rand(700) - 100);
    const to = addDays(from, rand(500));
    assert.deepEqual(expandDates(r, from, to), reference(r, from, to), JSON.stringify({ r, from, to }));
    const d = addDays(startDate, rand(600));
    assert.equal(countDatesBefore(r, d), reference(r, r.startDate, addDays(d, -1)).length, JSON.stringify({ r, d }));
  }
});

test("expand builds instants on the wall clock, DST included", () => {
  const sundays = rule({ startDate: "2026-03-22", startMinute: 150, weekdays: [0] });
  const out = expand(sundays, TZ, "2026-03-22", "2026-03-29");
  assert.deepEqual(
    out.map((o) => [o.seriesDate, o.startsAt.toISOString(), o.endsAt.toISOString()]),
    [
      ["2026-03-22", "2026-03-22T01:30:00.000Z", "2026-03-22T02:30:00.000Z"],
      // 02:30 does not exist on 29 March: shifted forward to 03:30 (01:30Z)
      ["2026-03-29", "2026-03-29T01:30:00.000Z", "2026-03-29T02:30:00.000Z"],
    ],
  );
  const autumn = expand(rule({ startDate: "2026-10-25", startMinute: 150, weekdays: [0] }), TZ, "2026-10-25", "2026-10-25");
  // 02:30 happens twice on 25 October: the first instant (summer time) wins.
  assert.equal(autumn[0].startsAt.toISOString(), "2026-10-25T00:30:00.000Z");
});

test("dstNotes flags the shifted and the ambiguous dates only", () => {
  const sundays = rule({ startDate: "2026-03-22", startMinute: 150, weekdays: [0] });
  const dates = ["2026-03-22", "2026-03-29", "2026-10-18", "2026-10-25"];
  assert.deepEqual(dstNotes(sundays, TZ, dates), [
    { seriesDate: "2026-03-29", kind: "shifted" },
    { seriesDate: "2026-10-25", kind: "ambiguous" },
  ]);
  assert.deepEqual(dstNotes(rule({ startMinute: 1140, weekdays: [0] }), TZ, dates), []);
});

test("lastSeriesDate", () => {
  assert.equal(lastSeriesDate(rule({ startDate: "2026-10-12", freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 })), "2026-10-12");
  assert.equal(lastSeriesDate(rule({ endMode: "until", untilDate: "2027-06-30" })), "2027-06-30");
  assert.equal(lastSeriesDate(rule({ endMode: "count", occurrenceCount: 3 })), "2026-10-22");
  assert.equal(lastSeriesDate(rule({})), null);
  const lastFriday = rule({ startDate: "2026-10-30", freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: -1, endMode: "count", occurrenceCount: 3 });
  assert.equal(lastSeriesDate(lastFriday), "2026-12-25");
  const yearly730 = rule({ startDate: "2026-01-31", freq: "monthly", interval: 12, weekdays: null, monthlyBy: "day_of_month", endMode: "count", occurrenceCount: 730 });
  assert.equal(lastSeriesDate(yearly730), "2755-01-31");
});

test("countDatesBefore and remainingCount (« Il reste K séances »)", () => {
  assert.equal(countDatesBefore(rule({}), "2026-10-22"), 2);
  assert.equal(countDatesBefore(rule({}), "2026-10-14"), 0);
  assert.equal(countDatesBefore(rule({ endMode: "count", occurrenceCount: 2 }), "2026-11-30"), 2);
  assert.equal(countDatesBefore(rule({ startDate: "2022-10-12", freq: "daily", weekdays: null }), "2026-10-12"), diffDays("2022-10-12", "2026-10-12"));
  const ten = rule({ endMode: "count", occurrenceCount: 10 });
  assert.equal(remainingCount(ten, "2026-10-22"), 8);
  assert.equal(remainingCount(ten, "2026-10-01"), 10);
  assert.equal(remainingCount(ten, "2027-06-01"), 0);
  assert.equal(remainingCount(rule({}), "2026-10-22"), null);
});

test("describeRecurrence produces the French labels of spec § 8", () => {
  const monthly = { freq: "monthly" as const, weekdays: null };
  const cases: [Partial<RecurrenceRule>, string][] = [
    [{ startDate: "2026-10-12", freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 }, "Le 12/10/2026"],
    [{ freq: "daily", weekdays: null }, "Tous les jours"],
    [{ freq: "daily", interval: 3, weekdays: null }, "Tous les 3 jours"],
    [{ weekdays: [1, 4] }, "Toutes les semaines le lundi et le jeudi"],
    [{ interval: 2, weekdays: [6] }, "Toutes les 2 semaines le samedi"],
    [{ weekdays: [1, 3, 5] }, "Toutes les semaines le lundi, le mercredi et le vendredi"],
    [{ weekdays: [0, 1] }, "Toutes les semaines le lundi et le dimanche"],
    [{ ...monthly, startDate: "2026-10-15", monthlyBy: "day_of_month" }, "Tous les mois le 15"],
    [{ ...monthly, startDate: "2026-10-01", monthlyBy: "day_of_month" }, "Tous les mois le 1er"],
    [{ ...monthly, startDate: "2026-11-01", monthlyBy: "weekday", monthWeek: 1 }, "Tous les mois le 1er dimanche"],
    [{ ...monthly, startDate: "2026-10-13", monthlyBy: "weekday", monthWeek: 2 }, "Tous les mois le 2e mardi"],
    [{ ...monthly, startDate: "2026-10-30", monthlyBy: "weekday", monthWeek: -1 }, "Tous les mois le dernier vendredi"],
    [{ ...monthly, interval: 3, startDate: "2026-10-15", monthlyBy: "weekday", monthWeek: 3 }, "Tous les 3 mois le 3e jeudi"],
    [{ interval: 2, weekdays: [1, 3], endMode: "until", untilDate: "2026-06-30", startDate: "2026-01-05" }, "Toutes les 2 semaines le lundi et le mercredi, jusqu'au 30/06"],
    [{ endMode: "until", untilDate: "2027-06-30" }, "Toutes les semaines le lundi et le jeudi, jusqu'au 30/06/2027"],
    [{ endMode: "count", occurrenceCount: 10 }, "Toutes les semaines le lundi et le jeudi, 10 séances"],
    [{ endMode: "count", occurrenceCount: 1 }, "Toutes les semaines le lundi et le jeudi, 1 séance"],
  ];
  for (const [over, label] of cases) {
    assert.equal(describeRecurrence(rule(over)), label);
    assert.ok(!describeRecurrence(rule(over)).includes("—"));
  }
});
