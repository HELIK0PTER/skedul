import assert from "node:assert/strict";
import test from "node:test";

import { addDays } from "@/lib/civil-date";
import { expand } from "@/lib/recurrence";
import { recurrenceRuleSchema, type RecurrenceRuleInput } from "@/lib/tickets";

import {
  defaultRecurrenceForm,
  dstNoteTexts,
  formFromRule,
  intervalWords,
  minuteToTime,
  monthlyChoices,
  normalizeMonthlyChoice,
  previewDates,
  recurrenceSummary,
  ruleFromForm,
  timeToMinute,
  type RecurrenceFormValue,
} from "./recurrence-form";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

function rule(over: Partial<RecurrenceRuleInput>): RecurrenceRuleInput {
  return {
    startDate: "2026-10-14",
    startMinute: 1140,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "never",
    untilDate: null,
    occurrenceCount: null,
    ...over,
  };
}

function form(over: Partial<RecurrenceFormValue>): RecurrenceFormValue {
  return { ...defaultRecurrenceForm({ startDate: "2026-10-14", startMinute: 1140 }, 60), ...over };
}

const onceRule = rule({ freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 });
const dailyRule = rule({ freq: "daily", interval: 2, weekdays: null });
const weeklyUntilRule = rule({ weekdays: [1, 3, 5], interval: 2, endMode: "until", untilDate: "2027-06-30" });
const monthlyDayRule = rule({
  freq: "monthly",
  weekdays: null,
  monthlyBy: "day_of_month",
  endMode: "count",
  occurrenceCount: 6,
});
const monthlyNthRule = rule({
  freq: "monthly",
  weekdays: null,
  monthlyBy: "weekday",
  monthWeek: 2,
  endMode: "until",
  untilDate: "2027-03-31",
});
const monthlyLastRule = rule({
  startDate: "2026-10-28",
  freq: "monthly",
  weekdays: null,
  monthlyBy: "weekday",
  monthWeek: -1,
});

test("minuteToTime and timeToMinute", () => {
  assert.equal(minuteToTime(1140), "19:00");
  assert.equal(minuteToTime(0), "00:00");
  assert.equal(minuteToTime(615), "10:15");
  assert.equal(minuteToTime(1439), "23:59");
  assert.equal(minuteToTime(2000), "23:59");
  assert.equal(minuteToTime(Number.NaN), "00:00");
  assert.equal(timeToMinute("19:00"), 1140);
  assert.equal(timeToMinute("00:00"), 0);
  assert.equal(timeToMinute("23:59"), 1439);
  for (const bad of ["", "24:00", "7:00", "19:60", "19:00:00", "19h00", "abc"]) {
    assert.equal(timeToMinute(bad), null, bad);
  }
});

test("defaultRecurrenceForm: once, the weekday of the date, 3 months, count 10, 60 min", () => {
  assert.deepEqual(defaultRecurrenceForm({ startDate: "2026-10-14", startMinute: 1140 }), {
    startDate: "2026-10-14",
    startTime: "19:00",
    durationMin: 60,
    freq: "once",
    interval: 1,
    weekdays: [3],
    monthlyChoice: "day_of_month",
    endMode: "never",
    untilDate: "2027-01-14",
    occurrenceCount: 10,
  });
  const clamped = defaultRecurrenceForm({ startDate: "2026-11-30", startMinute: 600 }, 90);
  assert.equal(clamped.untilDate, "2027-02-28");
  assert.equal(clamped.durationMin, 90);
  assert.deepEqual(clamped.weekdays, [1]);
});

test("formFromRule then ruleFromForm gives the rule back (once, daily, weekly, monthly day / nth / last, until, count)", () => {
  for (const r of [onceRule, dailyRule, weeklyUntilRule, monthlyDayRule, monthlyNthRule, monthlyLastRule]) {
    const back = ruleFromForm(formFromRule(r, 75));
    assert.deepEqual(back, { rule: r, durationMin: 75 }, JSON.stringify(r));
    assert.ok(recurrenceRuleSchema.safeParse(back?.rule).success, JSON.stringify(r));
  }
});

test("formFromRule: the choice of a saved monthly rule, the end fields and the defaults of the unused ones", () => {
  assert.equal(formFromRule(monthlyDayRule, 60).monthlyChoice, "day_of_month");
  assert.equal(formFromRule(monthlyNthRule, 60).monthlyChoice, "weekday_nth");
  assert.equal(formFromRule(monthlyLastRule, 60).monthlyChoice, "weekday_last");
  const count = formFromRule(monthlyDayRule, 60);
  assert.equal(count.endMode, "count");
  assert.equal(count.occurrenceCount, 6);
  assert.equal(count.untilDate, "2027-01-14");
  const until = formFromRule(weeklyUntilRule, 60);
  assert.equal(until.endMode, "until");
  assert.equal(until.untilDate, "2027-06-30");
  assert.equal(until.occurrenceCount, 10);
  const once = formFromRule(onceRule, 45);
  assert.equal(once.freq, "once");
  assert.equal(once.endMode, "never");
  assert.equal(once.durationMin, 45);
});

test("ruleFromForm: weekdays deduped and sorted ascending", () => {
  const built = ruleFromForm(form({ freq: "weekly", weekdays: [5, 1, 3, 1, 0] }));
  assert.deepEqual(built?.rule.weekdays, [0, 1, 3, 5]);
  assert.ok(recurrenceRuleSchema.safeParse(built?.rule).success);
});

test("ruleFromForm: the fields foreign to the freq and to the end mode are nulled", () => {
  const daily = ruleFromForm(
    form({
      freq: "daily",
      interval: 3,
      weekdays: [1, 2],
      monthlyChoice: "weekday_nth",
      endMode: "never",
      untilDate: "2027-01-01",
      occurrenceCount: 8,
    }),
  );
  assert.deepEqual(daily?.rule, rule({ freq: "daily", interval: 3, weekdays: null }));
  const weeklyCount = ruleFromForm(
    form({ freq: "weekly", weekdays: [3], endMode: "count", occurrenceCount: 8, untilDate: "2027-01-01" }),
  );
  assert.equal(weeklyCount?.rule.occurrenceCount, 8);
  assert.equal(weeklyCount?.rule.untilDate, null);
  assert.equal(weeklyCount?.rule.monthlyBy, null);
  const monthlyDay = ruleFromForm(form({ freq: "monthly", weekdays: [1, 2], monthlyChoice: "day_of_month" }));
  assert.equal(monthlyDay?.rule.weekdays, null);
  assert.equal(monthlyDay?.rule.monthlyBy, "day_of_month");
  assert.equal(monthlyDay?.rule.monthWeek, null);
});

test("ruleFromForm: a once form ignores interval and end", () => {
  const built = ruleFromForm(
    form({ freq: "once", interval: 5, endMode: "until", untilDate: "2027-01-01", occurrenceCount: 4 }),
  );
  assert.deepEqual(built?.rule, onceRule);
});

test("ruleFromForm: monthWeek follows the start date (nth = ceil(day / 7), last = -1)", () => {
  const monthly = (startDate: string, monthlyChoice: RecurrenceFormValue["monthlyChoice"]) =>
    ruleFromForm(form({ startDate, freq: "monthly", monthlyChoice }))?.rule.monthWeek;
  assert.equal(monthly("2026-10-05", "weekday_nth"), 1);
  assert.equal(monthly("2026-10-14", "weekday_nth"), 2);
  assert.equal(monthly("2026-10-21", "weekday_nth"), 3);
  assert.equal(monthly("2026-10-26", "weekday_nth"), 4);
  assert.equal(monthly("2026-10-26", "weekday_last"), -1);
});

test("ruleFromForm: a monthly choice the start date no longer offers falls back to the day of the month", () => {
  const fifth = ruleFromForm(form({ startDate: "2026-10-29", freq: "monthly", monthlyChoice: "weekday_nth" }));
  assert.equal(fifth?.rule.monthlyBy, "day_of_month");
  assert.equal(fifth?.rule.monthWeek, null);
  const notLast = ruleFromForm(form({ startDate: "2026-10-05", freq: "monthly", monthlyChoice: "weekday_last" }));
  assert.equal(notLast?.rule.monthlyBy, "day_of_month");
  assert.ok(recurrenceRuleSchema.safeParse(fifth?.rule).success);
  assert.ok(recurrenceRuleSchema.safeParse(notLast?.rule).success);
  assert.equal(normalizeMonthlyChoice("2026-10-29", "weekday_nth"), "day_of_month");
  assert.equal(normalizeMonthlyChoice("2026-10-29", "weekday_last"), "weekday_last");
  assert.equal(normalizeMonthlyChoice("", "weekday_last"), "day_of_month");
});

test("ruleFromForm is null for a malformed time or date, and still builds a rule the schema refuses for other mistakes", () => {
  assert.equal(ruleFromForm(form({ startTime: "25:00" })), null);
  assert.equal(ruleFromForm(form({ startTime: "" })), null);
  assert.equal(ruleFromForm(form({ startDate: "" })), null);
  assert.equal(ruleFromForm(form({ startDate: "2026-02-30" })), null);
  const noDay = ruleFromForm(form({ freq: "weekly", weekdays: [] }));
  assert.deepEqual(noDay?.rule.weekdays, []);
  assert.equal(recurrenceRuleSchema.safeParse(noDay?.rule).success, false);
  const noEnd = ruleFromForm(form({ freq: "daily", endMode: "until", untilDate: "" }));
  assert.equal(noEnd?.rule.untilDate, null);
  assert.equal(recurrenceRuleSchema.safeParse(noEnd?.rule).success, false);
  const before = ruleFromForm(form({ freq: "daily", endMode: "until", untilDate: "2026-10-01" }));
  assert.equal(recurrenceRuleSchema.safeParse(before?.rule).success, false);
});

test("monthlyChoices (Q11): day of month, nth weekday up to 4, last weekday", () => {
  assert.deepEqual(monthlyChoices("2026-10-05"), [
    { value: "day_of_month", label: "Le 5 de chaque mois" },
    { value: "weekday_nth", label: "Le 1er lundi de chaque mois" },
  ]);
  assert.deepEqual(monthlyChoices("2026-10-29"), [
    { value: "day_of_month", label: "Le 29 de chaque mois" },
    { value: "weekday_last", label: "Le dernier jeudi de chaque mois" },
  ]);
  assert.deepEqual(monthlyChoices("2026-10-24"), [
    { value: "day_of_month", label: "Le 24 de chaque mois" },
    { value: "weekday_nth", label: "Le 4e samedi de chaque mois" },
  ]);
  assert.deepEqual(monthlyChoices("2026-10-26"), [
    { value: "day_of_month", label: "Le 26 de chaque mois" },
    { value: "weekday_nth", label: "Le 4e lundi de chaque mois" },
    { value: "weekday_last", label: "Le dernier lundi de chaque mois" },
  ]);
  assert.deepEqual(monthlyChoices("2026-11-01"), [
    { value: "day_of_month", label: "Le 1er de chaque mois" },
    { value: "weekday_nth", label: "Le 1er dimanche de chaque mois" },
  ]);
  assert.deepEqual(monthlyChoices(""), []);
});

test("previewDates starts at local today in the pro's zone, whatever the host zone", () => {
  // 2026-10-14 22:30Z = Thursday 15 October 00:30 in Paris, Wednesday 14 October 15:30 in Los Angeles
  const now = new Date("2026-10-14T22:30:00.000Z");
  const daily = rule({ startDate: "2026-10-01", startMinute: 600, freq: "daily", interval: 1, weekdays: null });
  const paris = previewDates(daily, 90, PARIS, now, 3);
  assert.deepEqual(
    paris.map((d) => d.seriesDate),
    ["2026-10-15", "2026-10-16", "2026-10-17"],
  );
  assert.equal(paris[0].startsAt.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.equal(paris[0].endsAt.toISOString(), "2026-10-15T09:30:00.000Z");
  const la = previewDates(daily, 90, LA, now, 3);
  assert.deepEqual(
    la.map((d) => d.seriesDate),
    ["2026-10-14", "2026-10-15", "2026-10-16"],
  );
  assert.equal(la[0].startsAt.toISOString(), "2026-10-14T17:00:00.000Z");
});

test("previewDates: a future start, a short count, an ended rule, a refused rule and a zero limit", () => {
  const now = new Date("2026-10-14T10:00:00.000Z");
  const future = previewDates(rule({ startDate: "2026-11-02", weekdays: [1] }), 60, PARIS, now, 2);
  assert.deepEqual(
    future.map((d) => d.seriesDate),
    ["2026-11-02", "2026-11-09"],
  );
  const short = previewDates(rule({ weekdays: [1, 3], endMode: "count", occurrenceCount: 2 }), 60, PARIS, now, 5);
  assert.deepEqual(
    short.map((d) => d.seriesDate),
    ["2026-10-14", "2026-10-19"],
  );
  const ended = previewDates(rule({ startDate: "2026-09-01", endMode: "until", untilDate: "2026-09-30" }), 60, PARIS, now, 5);
  assert.deepEqual(ended, []);
  assert.deepEqual(previewDates(rule({ weekdays: [] }), 60, PARIS, now, 5), []);
  assert.deepEqual(previewDates(rule({}), 60, PARIS, now, 0), []);
  const yearly = previewDates(
    rule({ startDate: "2026-01-31", freq: "monthly", interval: 12, weekdays: null, monthlyBy: "day_of_month" }),
    60,
    PARIS,
    now,
    2,
  );
  assert.deepEqual(
    yearly.map((d) => d.seriesDate),
    ["2027-01-31", "2028-01-31"],
  );
});

test("previewDates across a spring-forward Sunday: the date stays, the start moves past the gap, the end follows (P6 D10)", () => {
  // Paris 2026-03-29: 02:00 CET jumps to 03:00 CEST, so 02:30 starts at 03:30 CEST (01:30Z)
  const paris = previewDates(rule({ startDate: "2026-03-22", startMinute: 150, weekdays: [0] }), 60, PARIS, new Date("2026-03-20T10:00:00Z"), 3);
  assert.deepEqual(
    paris.map((d) => [d.seriesDate, d.startsAt.toISOString(), d.endsAt.toISOString()]),
    [
      ["2026-03-22", "2026-03-22T01:30:00.000Z", "2026-03-22T02:30:00.000Z"],
      ["2026-03-29", "2026-03-29T01:30:00.000Z", "2026-03-29T02:30:00.000Z"],
      ["2026-04-05", "2026-04-05T00:30:00.000Z", "2026-04-05T01:30:00.000Z"],
    ],
  );
  // Los Angeles 2026-03-08: 02:00 PST jumps to 03:00 PDT, so 02:30 starts at 03:30 PDT (10:30Z)
  const la = previewDates(rule({ startDate: "2026-03-01", startMinute: 150, weekdays: [0] }), 45, LA, new Date("2026-02-27T20:00:00Z"), 3);
  assert.deepEqual(
    la.map((d) => [d.seriesDate, d.startsAt.toISOString(), d.endsAt.toISOString()]),
    [
      ["2026-03-01", "2026-03-01T10:30:00.000Z", "2026-03-01T11:15:00.000Z"],
      ["2026-03-08", "2026-03-08T10:30:00.000Z", "2026-03-08T11:15:00.000Z"],
      ["2026-03-15", "2026-03-15T09:30:00.000Z", "2026-03-15T10:15:00.000Z"],
    ],
  );
});

test("previewDates is the first `limit` dates of the full expansion over the preview horizon, for every kind of rule (P6 D10)", () => {
  const now = new Date("2026-10-14T10:00:00.000Z");
  const horizonEnd = addDays("2026-10-14", 1830); // local today + the preview horizon (BOUNDS.untilYears * 366)
  const rules = [onceRule, dailyRule, weeklyUntilRule, monthlyDayRule, monthlyNthRule, rule({}), rule({ startDate: "2026-01-31", freq: "monthly", interval: 12, weekdays: null, monthlyBy: "day_of_month" })];
  for (const r of rules) {
    const full = expand({ ...r, durationMin: 75 }, PARIS, "2026-10-14", horizonEnd);
    for (const limit of [1, 3, 12, 40]) {
      assert.deepEqual(previewDates(r, 75, PARIS, now, limit), full.slice(0, limit), `${r.freq} ${r.endMode} limit ${limit}`);
    }
  }
});

test("dstNoteTexts (Q12): Paris spring and autumn, Los Angeles spring and autumn, ordinary days", () => {
  const sundayNight = rule({ startDate: "2026-03-22", startMinute: 150, weekdays: [0] });
  assert.deepEqual(dstNoteTexts(sundayNight, 60, PARIS, ["2026-03-22", "2026-03-29"]), [
    "Le 29/03, 02:30 n'existe pas (heure d'été) : la séance commence à 03:30.",
  ]);
  const autumn = rule({ startDate: "2026-10-18", startMinute: 150, weekdays: [0] });
  assert.deepEqual(dstNoteTexts(autumn, 60, PARIS, ["2026-10-18", "2026-10-25"]), [
    "Le 25/10, 02:30 existe deux fois (heure d'hiver) : la séance a lieu à la première.",
  ]);
  const laSpring = rule({ startDate: "2026-03-01", startMinute: 150, weekdays: [0] });
  assert.deepEqual(dstNoteTexts(laSpring, 60, LA, ["2026-03-01", "2026-03-08"]), [
    "Le 08/03, 02:30 n'existe pas (heure d'été) : la séance commence à 03:30.",
  ]);
  const laAutumn = rule({ startDate: "2026-10-25", startMinute: 90, weekdays: [0] });
  assert.deepEqual(dstNoteTexts(laAutumn, 60, LA, ["2026-10-25", "2026-11-01"]), [
    "Le 01/11, 01:30 existe deux fois (heure d'hiver) : la séance a lieu à la première.",
  ]);
  const evening = rule({ startMinute: 1140 });
  assert.deepEqual(dstNoteTexts(evening, 60, PARIS, ["2026-03-29", "2026-10-25"]), []);
  assert.deepEqual(dstNoteTexts(evening, 60, PARIS, []), []);
});

test("dstNoteTexts never contain a dash", () => {
  const texts = [
    ...dstNoteTexts(rule({ startMinute: 150, weekdays: [0] }), 60, PARIS, ["2026-03-29", "2026-10-25"]),
    ...dstNoteTexts(rule({ startMinute: 150, weekdays: [0] }), 60, LA, ["2026-03-08"]),
  ];
  assert.equal(texts.length, 3);
  for (const t of texts) assert.doesNotMatch(t, DASHES);
});

test("recurrenceSummary: the label of describeRecurrence and the monthly warning", () => {
  assert.deepEqual(recurrenceSummary(form({ startDate: "2026-10-12", freq: "weekly", weekdays: [3, 1] })), {
    label: "Toutes les semaines le lundi et le mercredi",
    warning: null,
  });
  assert.deepEqual(recurrenceSummary(form({ startDate: "2026-10-12", freq: "once" })), {
    label: "Le 12/10/2026",
    warning: null,
  });
  assert.deepEqual(recurrenceSummary(form({ freq: "daily", endMode: "count", occurrenceCount: 4 })), {
    label: "Tous les jours, 4 séances",
    warning: null,
  });
  assert.deepEqual(recurrenceSummary(form({ startDate: "2026-10-31", freq: "monthly", monthlyChoice: "day_of_month" })), {
    label: "Tous les mois le 31",
    warning: "Certains mois n'ont pas de 31 : ils sont sautés.",
  });
  assert.deepEqual(recurrenceSummary(form({ startDate: "2026-10-05", freq: "monthly", monthlyChoice: "weekday_nth" })), {
    label: "Tous les mois le 1er lundi",
    warning: null,
  });
  assert.deepEqual(recurrenceSummary(form({ startDate: "2026-10-29", freq: "monthly", monthlyChoice: "weekday_last" })), {
    label: "Tous les mois le dernier jeudi",
    warning: null,
  });
});

test("recurrenceSummary is null while the form is not a valid rule", () => {
  assert.equal(recurrenceSummary(form({ freq: "weekly", weekdays: [] })), null);
  assert.equal(recurrenceSummary(form({ startTime: "" })), null);
  assert.equal(recurrenceSummary(form({ startDate: "" })), null);
  assert.equal(recurrenceSummary(form({ freq: "daily", endMode: "until", untilDate: "" })), null);
  assert.equal(recurrenceSummary(form({ freq: "daily", interval: 40 })), null);
});

test("intervalWords: the lead and the unit around the interval number agree with the frequency and the count (final review UI-9)", () => {
  assert.deepEqual(intervalWords("daily", 2), { lead: "Tous les", unit: "jours" });
  assert.deepEqual(intervalWords("daily", 1), { lead: "Tous les", unit: "jour" });
  assert.deepEqual(intervalWords("weekly", 2), { lead: "Toutes les", unit: "semaines" });
  assert.deepEqual(intervalWords("weekly", 1), { lead: "Toutes les", unit: "semaine" });
  assert.deepEqual(intervalWords("monthly", 3), { lead: "Tous les", unit: "mois" });
  assert.deepEqual(intervalWords("monthly", 1), { lead: "Tous les", unit: "mois" });
  // a cleared field (0) reads as a count to come: the plural
  assert.deepEqual(intervalWords("weekly", 0), { lead: "Toutes les", unit: "semaines" });
  assert.deepEqual(intervalWords("daily", 0), { lead: "Tous les", unit: "jours" });
  for (const freq of ["daily", "weekly", "monthly"] as const) {
    const w = intervalWords(freq, 2);
    assert.equal(DASHES.test(`${w.lead}${w.unit}`), false);
  }
});
