/**
 * Recurrence form model (pure, client-safe). The editor works on a flat
 * `RecurrenceFormValue`; this module converts it to and from the engine rule
 * (`recurrenceRuleSchema`), offers the monthly choices (Q11), the preview dates
 * and the daylight-saving notes (Q12). Every function that reads a clock or a
 * calendar day takes `tz` explicitly: the host zone never matters.
 */
import {
  addDays,
  addMonthsClamped,
  dayOfWeek,
  daysInMonth,
  formatDayMonth,
  instantAt,
  isDateKey,
  parseKey,
  todayKey,
  type DateKey,
} from "@/lib/civil-date";
import { wallClockMinutes } from "@/lib/datetime";
import { pluralWord } from "@/lib/back-office/format";
import { describeRecurrence, dstNotes, expand, expandDates, monthlyDayWarning, type RecurrenceRule } from "@/lib/recurrence";
import { BOUNDS, recurrenceRuleSchema, type RecurrenceRuleInput } from "@/lib/tickets";
import type { RecurrenceEnd, RecurrenceFreq } from "@/lib/tickets-vocab";

import { WEEKDAY_NAMES } from "./labels";

export type MonthlyChoice = "day_of_month" | "weekday_nth" | "weekday_last";

export type RecurrenceFormValue = {
  startDate: DateKey;
  /** "HH:MM" */
  startTime: string;
  durationMin: number;
  freq: RecurrenceFreq;
  interval: number;
  weekdays: number[];
  monthlyChoice: MonthlyChoice;
  endMode: RecurrenceEnd;
  /** "" while the date field is empty */
  untilDate: DateKey | "";
  occurrenceCount: number;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_DURATION_MIN = BOUNDS.eventDurationMin.default;
const DEFAULT_OCCURRENCE_COUNT = 10;
const DEFAULT_UNTIL_MONTHS = 3;
/** previewDates looks this far ahead of local today, the farthest « jusqu'au » a rule may name (a yearly rule still shows its next dates). */
const PREVIEW_HORIZON_DAYS = BOUNDS.untilYears * 366;

const NTH_LABELS: Readonly<Record<number, string>> = { 1: "1er", 2: "2e", 3: "3e", 4: "4e" };

/** 1140 → "19:00" (clamped to 00:00..23:59). */
export function minuteToTime(minute: number): string {
  const m = Number.isFinite(minute) ? Math.min(1439, Math.max(0, Math.trunc(minute))) : 0;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "19:00" → 1140; anything else → null. */
export function timeToMinute(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** ceil(day / 7) of a valid date: 1..5. */
function nthOfDate(startDate: DateKey): number {
  return Math.ceil(parseKey(startDate).d / 7);
}

/** True when no later date of the month falls on the same weekday. */
function isLastWeekdayOfMonth(startDate: DateKey): boolean {
  const { y, m, d } = parseKey(startDate);
  return d + 7 > daysInMonth(y, m);
}

/**
 * Defaults: freq once, interval 1, weekdays [weekday of startDate], monthly by
 * day, end never, count 10, until = startDate + 3 months (clamped), duration 60
 * unless given.
 */
export function defaultRecurrenceForm(
  start: { startDate: DateKey; startMinute: number },
  durationMin: number = DEFAULT_DURATION_MIN,
): RecurrenceFormValue {
  return {
    startDate: start.startDate,
    startTime: minuteToTime(start.startMinute),
    durationMin,
    freq: "once",
    interval: 1,
    weekdays: [dayOfWeek(start.startDate)],
    monthlyChoice: "day_of_month",
    endMode: "never",
    untilDate: addMonthsClamped(start.startDate, DEFAULT_UNTIL_MONTHS),
    occurrenceCount: DEFAULT_OCCURRENCE_COUNT,
  };
}

/**
 * The form of a saved rule (monthWeek -1 → weekday_last, 1..4 → weekday_nth).
 * A once rule gives the defaults of the other fields (end never, count 10), so
 * that switching the editor to « Toutes les semaines » starts from sensible values.
 */
export function formFromRule(rule: RecurrenceRuleInput, durationMin: number): RecurrenceFormValue {
  const base = defaultRecurrenceForm({ startDate: rule.startDate, startMinute: rule.startMinute }, durationMin);
  if (rule.freq === "once") return base;
  let monthlyChoice: MonthlyChoice = "day_of_month";
  if (rule.freq === "monthly" && rule.monthlyBy === "weekday") {
    if (rule.monthWeek === -1) monthlyChoice = "weekday_last";
    else if (rule.monthWeek !== null) monthlyChoice = "weekday_nth";
  }
  return {
    ...base,
    freq: rule.freq,
    interval: rule.interval,
    weekdays: rule.weekdays && rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : base.weekdays,
    monthlyChoice,
    endMode: rule.endMode,
    untilDate: rule.untilDate ?? base.untilDate,
    occurrenceCount: rule.occurrenceCount ?? base.occurrenceCount,
  };
}

/**
 * Q11 choices for a monthly series starting on startDate: the day of the month
 * always; the nth weekday when nth ≤ 4; the last weekday when no later date of
 * the month falls on that weekday. `[]` when startDate is not a valid date (the
 * date field shows its own error).
 */
export function monthlyChoices(startDate: DateKey): { value: MonthlyChoice; label: string }[] {
  if (!isDateKey(startDate)) return [];
  const { d } = parseKey(startDate);
  const weekday = WEEKDAY_NAMES[dayOfWeek(startDate)];
  const choices: { value: MonthlyChoice; label: string }[] = [
    { value: "day_of_month", label: d === 1 ? "Le 1er de chaque mois" : `Le ${d} de chaque mois` },
  ];
  const nth = nthOfDate(startDate);
  if (nth <= 4) choices.push({ value: "weekday_nth", label: `Le ${NTH_LABELS[nth]} ${weekday} de chaque mois` });
  if (isLastWeekdayOfMonth(startDate)) {
    choices.push({ value: "weekday_last", label: `Le dernier ${weekday} de chaque mois` });
  }
  return choices;
}

/** The choice itself when startDate offers it, else "day_of_month" (a start date changed under a stale choice). */
export function normalizeMonthlyChoice(startDate: DateKey, choice: MonthlyChoice): MonthlyChoice {
  return monthlyChoices(startDate).some((c) => c.value === choice) ? choice : "day_of_month";
}

/**
 * The engine rule: nulls set per freq / endMode exactly as recurrenceRuleSchema
 * wants (once ⇒ interval 1, count 1), weekdays deduped and sorted ascending,
 * monthWeek deduced from startDate (nth = ceil(day / 7); last = -1). Null only
 * when startTime is not "HH:MM" or startDate is not a date: any other mistake
 * (no weekday, until before the start...) still yields a rule, so that the
 * caller gets the French field message from `parseFr(recurrenceRuleSchema, rule)`.
 */
export function ruleFromForm(v: RecurrenceFormValue): { rule: RecurrenceRuleInput; durationMin: number } | null {
  const startMinute = timeToMinute(v.startTime);
  if (startMinute === null || !isDateKey(v.startDate)) return null;
  const base = { startDate: v.startDate, startMinute };

  if (v.freq === "once") {
    return {
      rule: {
        ...base,
        freq: "once",
        interval: 1,
        weekdays: null,
        monthlyBy: null,
        monthWeek: null,
        endMode: "count",
        untilDate: null,
        occurrenceCount: 1,
      },
      durationMin: v.durationMin,
    };
  }

  const choice = normalizeMonthlyChoice(v.startDate, v.monthlyChoice);
  const nth = nthOfDate(v.startDate);
  let monthWeek: RecurrenceRuleInput["monthWeek"] = null;
  if (v.freq === "monthly" && choice === "weekday_last") monthWeek = -1;
  else if (v.freq === "monthly" && choice === "weekday_nth" && (nth === 1 || nth === 2 || nth === 3 || nth === 4)) {
    monthWeek = nth;
  }

  return {
    rule: {
      ...base,
      freq: v.freq,
      interval: v.interval,
      weekdays: v.freq === "weekly" ? [...new Set(v.weekdays)].sort((a, b) => a - b) : null,
      monthlyBy: v.freq === "monthly" ? (choice === "day_of_month" ? "day_of_month" : "weekday") : null,
      monthWeek,
      endMode: v.endMode,
      untilDate: v.endMode === "until" && v.untilDate !== "" ? v.untilDate : null,
      occurrenceCount: v.endMode === "count" ? v.occurrenceCount : null,
    },
    durationMin: v.durationMin,
  };
}

/** The next `limit` séances from local today (pro tz) of the rule, for the preview. `[]` for a rule the schema refuses. */
export function previewDates(
  rule: RecurrenceRuleInput,
  durationMin: number,
  tz: string,
  now: Date,
  limit: number,
): { seriesDate: DateKey; startsAt: Date; endsAt: Date }[] {
  if (limit <= 0 || !recurrenceRuleSchema.safeParse(rule).success) return [];
  const from = todayKey(now, tz);
  const full: RecurrenceRule = { ...rule, durationMin };
  // The walk over the whole horizon is cheap; the instants (Intl) are what costs, so only the dates shown get one (P6 D10).
  const dates = expandDates(full, from, addDays(from, PREVIEW_HORIZON_DAYS));
  if (dates.length === 0) return [];
  return expand(full, tz, from, dates[Math.min(limit, dates.length) - 1]).slice(0, limit);
}

/** Q12 notes for the dates whose start is shifted (spring) or repeated (autumn) in tz. */
export function dstNoteTexts(
  rule: RecurrenceRuleInput,
  durationMin: number,
  tz: string,
  dates: readonly DateKey[],
): string[] {
  const full: RecurrenceRule = { ...rule, durationMin };
  const planned = minuteToTime(rule.startMinute);
  return dstNotes(full, tz, dates).map(({ seriesDate, kind }) => {
    const day = formatDayMonth(seriesDate);
    if (kind === "shifted") {
      const real = minuteToTime(wallClockMinutes(instantAt(seriesDate, rule.startMinute, tz), tz));
      return `Le ${day}, ${planned} n'existe pas (heure d'été) : la séance commence à ${real}.`;
    }
    return `Le ${day}, ${planned} existe deux fois (heure d'hiver) : la séance a lieu à la première.`;
  });
}

/** describeRecurrence and monthlyDayWarning of the form; null when the form is not a valid rule. */
export function recurrenceSummary(v: RecurrenceFormValue): { label: string; warning: string | null } | null {
  const built = ruleFromForm(v);
  if (!built || !recurrenceRuleSchema.safeParse(built.rule).success) return null;
  const full: RecurrenceRule = { ...built.rule, durationMin: built.durationMin };
  return { label: describeRecurrence(full), warning: monthlyDayWarning(full) };
}

/**
 * The words around the « Intervalle » number: « Tous les [2] jours », « Toutes les [2] semaines », « Tous les [1] mois ».
 * « semaine » is feminine and « mois » never takes an s; the unit follows the count (a cleared field, 0, reads as a count to
 * come and keeps the plural).
 */
export function intervalWords(freq: Exclude<RecurrenceFreq, "once">, interval: number): { lead: string; unit: string } {
  const many = interval < 1;
  const unit = (one: string, plural: string) => (many ? plural : pluralWord(interval, one, plural));
  if (freq === "weekly") return { lead: "Toutes les", unit: unit("semaine", "semaines") };
  if (freq === "monthly") return { lead: "Tous les", unit: "mois" };
  return { lead: "Tous les", unit: unit("jour", "jours") };
}
