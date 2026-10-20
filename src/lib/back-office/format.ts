/**
 * Formatting helpers of the back-office and of the client e-mails. Pure: every
 * function takes the time zone explicitly (never the host zone), and no output
 * contains an em or en dash (UI rule).
 */
import { formatDayMonth, formatDayMonthYear, mondayOf, parseKey, todayKey } from "@/lib/civil-date";
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

/** « 19:00 à 20:00 » in tz. */
export function formatTimeRange(start: Date, end: Date, tz: string): string {
  const time = formatter(tz, "time");
  return `${time.format(start)} à ${time.format(end)}`;
}

/** « lun. 12 octobre 2026 · 19:00 à 20:00 » in tz; « dim. 1er novembre 2026 » on a first. */
export function formatWhen(start: Date, end: Date, tz: string): string {
  return `${frenchFirst(formatter(tz, "dateLong").format(start))} · ${formatTimeRange(start, end, tz)}`;
}

/** « lun. 12/10 · 19:00 » in tz. */
export function formatWhenShort(start: Date, tz: string): string {
  return `${formatter(tz, "weekday").format(start)} ${formatDayMonthOf(start, tz)} · ${formatter(tz, "time").format(start)}`;
}

/** « 12/10 » (local day of an instant in tz). */
export function formatDayMonthOf(instant: Date, tz: string): string {
  return formatDayMonth(todayKey(instant, tz));
}

/** « 12/10 14:03 » in tz (history lines). */
export function formatDayMonthTime(instant: Date, tz: string): string {
  return `${formatDayMonthOf(instant, tz)} ${formatter(tz, "time").format(instant)}`;
}

/** « valable jusqu'au 12/01 inclus » (« 12/01/2027 » when that last day is not in now's local year), or « sans limite de validité ». */
export function expiryLabel(expiresAt: Date | null, tz: string, now: Date): string {
  if (expiresAt === null) return "sans limite de validité";
  const last = lastValidDay(expiresAt, tz);
  const sameYear = parseKey(last).y === parseKey(todayKey(now, tz)).y;
  return `valable jusqu'au ${sameYear ? formatDayMonth(last) : formatDayMonthYear(last)} inclus`;
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
