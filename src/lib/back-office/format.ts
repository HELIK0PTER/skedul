/**
 * Formatting helpers of the back-office and of the client e-mails. Pure: every
 * function takes the time zone explicitly (never the host zone), and no output
 * contains an em or en dash (UI rule).
 */
import { addDays, compareKeys, formatDayMonth, formatDayMonthYear, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { frenchFirst } from "@/lib/datetime";
import { lastValidDay } from "@/lib/ticket-expiry";

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One Intl.DateTimeFormat per (zone, shape): building them is the slow part of formatting. */
function formatter(tz: string, shape: "time" | "weekday" | "dateLong"): Intl.DateTimeFormat {
  const key = `${tz}|${shape}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      shape === "time"
        ? { hour: "2-digit", minute: "2-digit", timeZone: tz }
        : shape === "weekday"
          ? { weekday: "short", timeZone: tz }
          : { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: tz };
    f = new Intl.DateTimeFormat("fr-FR", options);
    formatters.set(key, f);
  }
  return f;
}

/** Minutes east of UTC of the zone at `instant` (its wall clock read as UTC, minus the instant, to the minute). */
function offsetMinutes(instant: Date, tz: string, time: Intl.DateTimeFormat): number {
  const { y, m, d } = parseKey(todayKey(instant, tz));
  const [hh, mm] = time.format(instant).split(":").map(Number);
  return Math.round((Date.UTC(y, m - 1, d, hh, mm) - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * « 19:00 à 20:00 » in tz. An end on another local day says so: « 22:00 à 01:00 le lendemain », « 14:00 au 14/10 à
 * 10:00 » (an end at 00:00 the next day closes the same evening: « 23:00 à 00:00 »). A range across a change of time
 * adds « (changement d'heure) », since its two clock times alone misread its length (« 02:30 à 02:30 »).
 */
export function formatTimeRange(start: Date, end: Date, tz: string): string {
  const time = formatter(tz, "time");
  const from = time.format(start);
  const to = time.format(end);
  const startDay = todayKey(start, tz);
  const endDay = todayKey(end, tz);
  const nextDay = addDays(startDay, 1);
  let range: string;
  if (endDay === startDay || (endDay === nextDay && to === "00:00")) range = `${from} à ${to}`;
  else if (endDay === nextDay) range = `${from} à ${to} le lendemain`;
  else range = `${from} au ${formatDayMonth(endDay)} à ${to}`;
  return offsetMinutes(start, tz, time) === offsetMinutes(end, tz, time) ? range : `${range} (changement d'heure)`;
}

/** « lun. 12 octobre 2026 · 19:00 à 20:00 » in tz; « dim. 1er novembre 2026 » on a first. */
export function formatWhen(start: Date, end: Date, tz: string): string {
  return `${frenchFirst(formatter(tz, "dateLong").format(start))} · ${formatTimeRange(start, end, tz)}`;
}

/** The local year of an instant in tz. */
export function yearOf(instant: Date, tz: string): number {
  return parseKey(todayKey(instant, tz)).y;
}

/**
 * The year rule of the back-office: « 12/10 », or « 12/10/2025 » when that day is not in `thisYear` (the local year of
 * now). A day alone cannot say whether it is this October or last one.
 */
export function dayLabel(day: DateKey, thisYear: number): string {
  return parseKey(day).y === thisYear ? formatDayMonth(day) : formatDayMonthYear(day);
}

/** « lun. 12/10 · 19:00 » in tz; with `now`, « lun. 12/10/2027 · 19:00 » when that day is not in now's local year. */
export function formatWhenShort(start: Date, tz: string, now?: Date): string {
  return `${formatter(tz, "weekday").format(start)} ${formatDayMonthOf(start, tz, now)} · ${formatter(tz, "time").format(start)}`;
}

/** « 12/10 » (local day of an instant in tz); with `now`, « 12/10/2025 » when that day is not in now's local year. */
export function formatDayMonthOf(instant: Date, tz: string, now?: Date): string {
  const day = todayKey(instant, tz);
  return now === undefined ? formatDayMonth(day) : dayLabel(day, yearOf(now, tz));
}

/** « 12/10 14:03 » in tz (history lines); with `now`, the day names its year when it is not now's. */
export function formatDayMonthTime(instant: Date, tz: string, now?: Date): string {
  return `${formatDayMonthOf(instant, tz, now)} ${formatter(tz, "time").format(instant)}`;
}

const NO_LIMIT = "sans limite de validité";

/** « valable(s) jusqu'au 12/01 inclus » for `count` tickets whose last valid day is `last` (« 12/01/2027 » when that day is not in now's local year). */
function lastDayLabel(last: DateKey, tz: string, now: Date, count: number): string {
  return `${pluralWord(count, "valable", "valables")} jusqu'au ${dayLabel(last, yearOf(now, tz))} inclus`;
}

/**
 * « valable jusqu'au 12/01 inclus » (« 12/01/2027 » when that last day is not in now's local year), or « sans limite de validité ».
 * `count` is how many tickets the sentence speaks of (default 1): several take « valables ».
 */
export function expiryLabel(expiresAt: Date | null, tz: string, now: Date, count = 1): string {
  return expiresAt === null ? NO_LIMIT : lastDayLabel(lastValidDay(expiresAt, tz), tz, now, count);
}

/** Tickets that share an expiry: `count` of them, valid until `expiresAt` (null: no limit). */
export type ExpiryEntry = { expiresAt: Date | null; count: number };
/** What a group of tickets says about its expiry, without its count: « valables jusqu'au 12/01 inclus » or « sans limite de validité ». */
export type ExpiryGroup = { count: number; text: string };

/**
 * One group per last valid day (soonest first; two instants of the same local day make one group), then the tickets
 * without limit. The wording follows each group's count (« valable » for 1, « valables » for more).
 */
export function expiryGroups(entries: readonly ExpiryEntry[], tz: string, now: Date): ExpiryGroup[] {
  const perDay = new Map<DateKey, number>();
  let unlimited = 0;
  for (const entry of entries) {
    if (entry.expiresAt === null) {
      unlimited += entry.count;
      continue;
    }
    const day = lastValidDay(entry.expiresAt, tz);
    perDay.set(day, (perDay.get(day) ?? 0) + entry.count);
  }
  const groups = [...perDay.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([day, count]) => ({ count, text: lastDayLabel(day, tz, now, count) }));
  if (unlimited > 0) groups.push({ count: unlimited, text: NO_LIMIT });
  return groups;
}

/** « 2 valables jusqu'au 12/01 inclus », « 1 sans limite de validité »: one line per group of `expiryGroups`. */
export function expirySummary(entries: readonly ExpiryEntry[], tz: string, now: Date): string[] {
  return expiryGroups(entries, tz, now).map((group) => `${formatCount(group.count)} ${group.text}`);
}

/** The word alone: « jour » for 0 and 1, « jours » for the rest, an empty field (NaN) included. */
export function pluralWord(n: number, one: string, many: string): string {
  return Math.abs(n) < 2 ? one : many;
}

/** « 1 234 »: a count as the pro reads it (fr-FR thousands). Every count shown in the back-office goes through here. */
export function formatCount(n: number): string {
  return n.toLocaleString("fr-FR");
}

/** « 1 séance » / « 3 séances » (fr-FR thousands; 0 and 1 take the singular). */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${pluralWord(n, one, many)}`;
}

/** « Passées (52) »: the heading of a client's ended séances counts all of them, not only the ones listed. */
export function pastHeading(total: number): string {
  return `Passées (${formatCount(total)})`;
}

/** « Les 50 plus récentes sur 63. » when the list shows fewer rows than there are (`shown` < `total`), else null. */
export function pastCutNote(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return shown <= 1 ? `La plus récente sur ${formatCount(total)}.` : `Les ${formatCount(shown)} plus récentes sur ${formatCount(total)}.`;
}

/** /dashboard/planning?semaine=<Monday DateKey of the séance, tz>&seance=<id> (Q20). */
export function planningHref(args: { occurrenceId: string; startsAt: Date | string; tz: string }): string {
  const monday = mondayOf(todayKey(new Date(args.startsAt), args.tz));
  return `/dashboard/planning?semaine=${monday}&seance=${encodeURIComponent(args.occurrenceId)}`;
}

/** « 25 », « 25,50 », « 25.5 » → 2500 / 2550; anything else (≤ 0, more than 2 decimals, letters) → null. */
export function parseMoneyInput(text: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** 2550 → « 25,50 », 2500 → « 25 ». */
export function moneyInputValue(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0")}`;
}

/** « € » for eur (Intl narrow symbol of the currency). */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency.toUpperCase();
  } catch {
    return currency.toUpperCase();
  }
}
