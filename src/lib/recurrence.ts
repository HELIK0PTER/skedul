/**
 * Recurrence expander (spec § 8): pure, on civil dates (src/lib/civil-date.ts).
 * A rule is the recurrence columns of `event` + its duration. Every supported
 * rule produces at most one date per local day, so `series_date` identifies an
 * occurrence (spec § 7). Instants come last: startsAt = the wall-clock start on
 * that local date (DST: shifted forward / first instant), endsAt = startsAt +
 * duration in elapsed milliseconds.
 */
import {
  addDays,
  dayOfWeek,
  diffDays,
  formatDayMonth,
  formatDayMonthYear,
  instantAt,
  makeKey,
  maxKey,
  minKey,
  mondayOf,
  monthIndex,
  nthWeekdayOfMonth,
  parseKey,
  todayKey,
  type DateKey,
} from "@/lib/civil-date";
import { wallClockMinutes } from "@/lib/datetime";
import type { MonthlyBy, RecurrenceEnd, RecurrenceFreq } from "@/lib/tickets";

/** The recurrence columns of `event` + duration: everything the expander needs. */
export type RecurrenceRule = {
  startDate: DateKey;
  startMinute: number;
  durationMin: number;
  freq: RecurrenceFreq;
  interval: number;
  weekdays: number[] | null;
  monthlyBy: MonthlyBy | null;
  monthWeek: 1 | 2 | 3 | 4 | -1 | null;
  endMode: RecurrenceEnd;
  untilDate: DateKey | null;
  occurrenceCount: number | null;
};

export type ExpandedDate = { seriesDate: DateKey; startsAt: Date; endsAt: Date };

/** At most this many dates are produced by one call. */
export const EXPAND_MAX_DATES = 1000;

/** Far enough for any count rule (≤ 730 dates, monthly interval ≤ 12). */
const FAR_FUTURE: DateKey = "9999-12-31";

/** Throws on a rule the DB CHECKs would refuse in a way that could loop forever. */
function assertWalkable(rule: RecurrenceRule): void {
  parseKey(rule.startDate);
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new RangeError(`Invalid recurrence interval: ${rule.interval}`);
  }
  if (rule.freq === "weekly" && (!rule.weekdays || rule.weekdays.length === 0)) {
    throw new RangeError("A weekly rule needs at least one weekday");
  }
  if (rule.freq === "monthly" && rule.monthlyBy === null) {
    throw new RangeError("A monthly rule needs monthlyBy");
  }
  if (rule.monthlyBy === "weekday" && rule.monthWeek === null) {
    throw new RangeError("A monthly weekday rule needs monthWeek");
  }
  if (rule.endMode === "count" && (rule.occurrenceCount === null || rule.occurrenceCount < 1)) {
    throw new RangeError("A count rule needs occurrenceCount ≥ 1");
  }
  if (rule.endMode === "until" && rule.untilDate === null) {
    throw new RangeError("An until rule needs untilDate");
  }
}

export type WalkResult = {
  /** Dates in [lower, upper], ascending. */
  dates: DateKey[];
  /** Candidate dates examined (one per period for daily and monthly, one per weekday for weekly). */
  steps: number;
  /** Rule dates ≥ startDate seen by the walk (count mode: the running count). */
  produced: number;
  /** A cap (EXPAND_MAX_DATES or the step cap) stopped the walk early. */
  capped: boolean;
};

/**
 * The single walker behind expandDates and countDatesBefore. `fromRuleStart`
 * walks from startDate (count mode, or counting); otherwise never/until jump
 * arithmetically to the first aligned period containing `lower`. Candidates
 * come out in ascending order, so the walk stops at the first one > upper.
 */
function walk(
  rule: RecurrenceRule,
  lower: DateKey,
  upper: DateKey,
  opts: { fromRuleStart: boolean; maxDates: number },
): WalkResult {
  const result: WalkResult = { dates: [], steps: 0, produced: 0, capped: false };
  const limit = rule.endMode === "count" ? (rule.occurrenceCount ?? 0) : Infinity;
  const jumpFrom = opts.fromRuleStart ? rule.startDate : maxKey(lower, rule.startDate);

  let walkStart: DateKey;
  let next: () => DateKey | null | "skip";

  if (rule.freq === "once") {
    let done = false;
    walkStart = rule.startDate;
    next = () => {
      if (done) return null;
      done = true;
      return rule.startDate;
    };
  } else if (rule.freq === "daily") {
    let k = Math.max(0, Math.ceil(diffDays(rule.startDate, jumpFrom) / rule.interval));
    walkStart = addDays(rule.startDate, k * rule.interval);
    next = () => addDays(rule.startDate, k++ * rule.interval);
  } else if (rule.freq === "weekly") {
    // Monday-based weeks from the week of startDate; inside a week Mon..Sun.
    const offsets = [...new Set(rule.weekdays ?? [])]
      .map((d) => (d + 6) % 7)
      .sort((a, b) => a - b);
    const firstMonday = mondayOf(rule.startDate);
    const weeksToJump = Math.max(0, Math.floor(diffDays(firstMonday, mondayOf(jumpFrom)) / 7));
    let week = weeksToJump - (weeksToJump % rule.interval);
    let i = 0;
    walkStart = addDays(firstMonday, week * 7);
    next = () => {
      const date = addDays(firstMonday, week * 7 + offsets[i]);
      i++;
      if (i === offsets.length) {
        i = 0;
        week += rule.interval;
      }
      return date;
    };
  } else {
    const firstMonth = monthIndex(rule.startDate);
    const monthsToJump = Math.max(0, monthIndex(jumpFrom) - firstMonth);
    let k = monthsToJump - (monthsToJump % rule.interval);
    const { d: startDay } = parseKey(rule.startDate);
    const weekday = dayOfWeek(rule.startDate);
    const monthStart = (n: number) => {
      const idx = firstMonth + n;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    };
    const first = monthStart(k);
    walkStart = makeKey(first.y, first.m, 1);
    next = () => {
      const { y, m } = monthStart(k);
      k += rule.interval;
      if (makeKey(y, m, 1) > upper) return null;
      if (rule.monthlyBy === "day_of_month") {
        const date = makeKey(y, m, startDay);
        // RFC 5545: a month without that day is skipped (no 31 in April).
        return parseKey(date).d === startDay ? date : "skip";
      }
      return nthWeekdayOfMonth(y, m, weekday, rule.monthWeek ?? 1);
    };
  }

  const maxSteps = Math.max(0, diffDays(walkStart, upper)) + 31;
  for (;;) {
    if (result.steps >= maxSteps) {
      result.capped = true;
      break;
    }
    const date = next();
    if (date === null) break;
    result.steps++;
    if (date === "skip") continue;
    if (date > upper) break;
    if (date < rule.startDate) continue;
    result.produced++;
    if (date >= lower) {
      if (result.dates.length >= opts.maxDates) {
        result.capped = true;
        break;
      }
      result.dates.push(date);
    }
    if (result.produced >= limit) break;
  }
  return result;
}

function bounds(rule: RecurrenceRule, fromDate: DateKey, toDate: DateKey): { lower: DateKey; upper: DateKey } {
  const lower = maxKey(fromDate, rule.startDate);
  const upper = rule.endMode === "until" && rule.untilDate ? minKey(toDate, rule.untilDate) : toDate;
  return { lower, upper };
}

/**
 * The rule's dates in [fromDate, toDate] with the walk statistics; exported for
 * the cap tests. Prefer expandDates.
 */
export function expandWalk(rule: RecurrenceRule, fromDate: DateKey, toDate: DateKey): WalkResult {
  assertWalkable(rule);
  parseKey(fromDate);
  parseKey(toDate);
  const { lower, upper } = bounds(rule, fromDate, toDate);
  if (lower > upper) return { dates: [], steps: 0, produced: 0, capped: false };
  return walk(rule, lower, upper, {
    fromRuleStart: rule.endMode === "count",
    maxDates: EXPAND_MAX_DATES,
  });
}

/**
 * The rule's local dates in [fromDate, toDate] (inclusive), ascending. Never a
 * date before startDate; until inclusive; count walks from startDate and
 * counts every produced date. never/until jump arithmetically to the first
 * aligned period containing fromDate. Caps: EXPAND_MAX_DATES produced, and
 * (days from walk start to toDate) + 31 loop steps.
 */
export function expandDates(rule: RecurrenceRule, fromDate: DateKey, toDate: DateKey): DateKey[] {
  return expandWalk(rule, fromDate, toDate).dates;
}

/** expandDates + instants: startsAt = instantAt(date, startMinute, tz), endsAt = startsAt + durationMin. */
export function expand(rule: RecurrenceRule, tz: string, fromDate: DateKey, toDate: DateKey): ExpandedDate[] {
  return expandDates(rule, fromDate, toDate).map((seriesDate) => {
    const startsAt = instantAt(seriesDate, rule.startMinute, tz);
    return { seriesDate, startsAt, endsAt: new Date(startsAt.getTime() + rule.durationMin * 60_000) };
  });
}

/** Last date the rule can produce: once → startDate; until → untilDate (upper bound); count → exact; never → null. */
export function lastSeriesDate(rule: RecurrenceRule): DateKey | null {
  assertWalkable(rule);
  if (rule.freq === "once") return rule.startDate;
  if (rule.endMode === "never") return null;
  if (rule.endMode === "until") return rule.untilDate;
  const { dates } = walk(rule, rule.startDate, FAR_FUTURE, {
    fromRuleStart: true,
    maxDates: EXPAND_MAX_DATES,
  });
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** How many dates the rule produces strictly before d (from startDate; capped by occurrenceCount). */
export function countDatesBefore(rule: RecurrenceRule, d: DateKey): number {
  assertWalkable(rule);
  parseKey(d);
  if (d <= rule.startDate) return 0;
  const { lower, upper } = bounds(rule, rule.startDate, addDays(d, -1));
  if (lower > upper) return 0;
  return walk(rule, lower, upper, { fromRuleStart: true, maxDates: Infinity }).produced;
}

/** count mode: occurrenceCount − countDatesBefore(rule, d) (≥ 0); null otherwise (« Il reste K séances »). */
export function remainingCount(rule: RecurrenceRule, d: DateKey): number | null {
  if (rule.endMode !== "count" || rule.occurrenceCount === null) return null;
  return Math.max(0, rule.occurrenceCount - countDatesBefore(rule, d));
}

/* ───────────────────────────── Labels (FR) ───────────────────────────── */

const WEEKDAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « le lundi, le mercredi et le vendredi » */
function joinFr(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

function ordinalFr(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

function every(interval: number, unit: "jour" | "semaine" | "mois"): string {
  if (unit === "semaine") return interval === 1 ? "Toutes les semaines" : `Toutes les ${interval} semaines`;
  if (unit === "jour") return interval === 1 ? "Tous les jours" : `Tous les ${interval} jours`;
  return interval === 1 ? "Tous les mois" : `Tous les ${interval} mois`;
}

/** « Toutes les 2 semaines le lundi et le mercredi, jusqu'au 30/06 » (spec § 8). */
export function describeRecurrence(rule: RecurrenceRule): string {
  if (rule.freq === "once") return `Le ${formatDayMonthYear(rule.startDate)}`;

  let base: string;
  if (rule.freq === "daily") {
    base = every(rule.interval, "jour");
  } else if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    base = `${every(rule.interval, "semaine")} ${joinFr(days.map((d) => `le ${WEEKDAY_NAMES[d]}`))}`;
  } else if (rule.monthlyBy === "day_of_month") {
    const { d } = parseKey(rule.startDate);
    base = `${every(rule.interval, "mois")} le ${d === 1 ? "1er" : d}`;
  } else {
    const which = rule.monthWeek === -1 ? "dernier" : ordinalFr(rule.monthWeek ?? 1);
    base = `${every(rule.interval, "mois")} le ${which} ${WEEKDAY_NAMES[dayOfWeek(rule.startDate)]}`;
  }

  if (rule.endMode === "until" && rule.untilDate) {
    const sameYear = rule.untilDate.slice(0, 4) === rule.startDate.slice(0, 4);
    return `${base}, jusqu'au ${sameYear ? formatDayMonth(rule.untilDate) : formatDayMonthYear(rule.untilDate)}`;
  }
  if (rule.endMode === "count" && rule.occurrenceCount !== null) {
    return `${base}, ${rule.occurrenceCount} séance${rule.occurrenceCount > 1 ? "s" : ""}`;
  }
  return base;
}

/** Monthly-by-day on 29/30/31: « Certains mois n'ont pas de 31 : ils sont sautés. »; else null. */
export function monthlyDayWarning(rule: RecurrenceRule): string | null {
  if (rule.freq !== "monthly" || rule.monthlyBy !== "day_of_month") return null;
  const { d } = parseKey(rule.startDate);
  return d >= 29 ? `Certains mois n'ont pas de ${d} : ils sont sautés.` : null;
}

/** Editor preview: dates whose wall-clock start is shifted (nonexistent) or ambiguous (repeated) in tz. */
export function dstNotes(
  rule: RecurrenceRule,
  tz: string,
  dates: readonly DateKey[],
): { seriesDate: DateKey; kind: "shifted" | "ambiguous" }[] {
  const notes: { seriesDate: DateKey; kind: "shifted" | "ambiguous" }[] = [];
  for (const seriesDate of dates) {
    const start = instantAt(seriesDate, rule.startMinute, tz);
    const sameWallClock = (instant: Date) =>
      todayKey(instant, tz) === seriesDate && wallClockMinutes(instant, tz) === rule.startMinute;
    if (!sameWallClock(start)) {
      notes.push({ seriesDate, kind: "shifted" });
    } else if ([30, 60, 120].some((min) => sameWallClock(new Date(start.getTime() + min * 60_000)))) {
      notes.push({ seriesDate, kind: "ambiguous" });
    }
  }
  return notes;
}
