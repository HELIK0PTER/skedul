import { TZDate } from "@date-fns/tz";

export const DAYS_FR = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    wallFormatters.set(tz, formatter);
  }
  return formatter;
}

/**
 * Wall clock of the instant `t` (whole seconds) in `tz`, read as if it were UTC.
 * Pure Intl with an explicit time zone: it never looks at the host zone.
 */
function wallAsUtcMs(t: number, tz: string): number {
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of wallFormatter(tz).formatToParts(t)) {
    switch (part.type) {
      case "year":
        year = Number(part.value);
        break;
      case "month":
        month = Number(part.value);
        break;
      case "day":
        day = Number(part.value);
        break;
      case "hour":
        hour = Number(part.value) % 24;
        break;
      case "minute":
        minute = Number(part.value);
        break;
      case "second":
        second = Number(part.value);
        break;
    }
  }
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** UTC offset of `tz` at the instant `t` (whole seconds), in ms (positive east of Greenwich). */
function zoneOffsetMs(t: number, tz: string): number {
  return wallAsUtcMs(t, tz) - t;
}

/**
 * Build the UTC instant for a wall-clock time on a given calendar day in `tz`
 * (minutesFromMidnight may be 1440, the next local midnight).
 *
 * Independent of the host time zone (spec § 7). A wall time that does not exist
 * (spring-forward gap) is shifted forward by the length of the gap (02:30 on
 * 2026-03-29 in Paris -> 03:30 CEST). A wall time that occurs twice (fall-back
 * overlap) resolves to the FIRST instant (02:30 on 2026-10-25 in Paris -> 00:30Z).
 *
 * The wall time read as UTC is `naive`. The zone offset a day before and a day
 * after bracket any transition near the answer, and `naive - offset` is the
 * instant for each of them; the ones that read back as the requested wall time
 * are valid, and the earliest wins. With no valid one, the time is in a gap and
 * the offset in force before the transition places it after the gap.
 */
export function instantFromWallClock(
  year: number,
  month1: number, // 1-12
  day: number,
  minutesFromMidnight: number,
  tz: string,
): Date {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  const naive = Date.UTC(year, month1 - 1, day, h, m);
  const before = zoneOffsetMs(naive - DAY_MS, tz);
  const after = zoneOffsetMs(naive + DAY_MS, tz);
  // Same offset on both sides: no transition around this day, one candidate.
  if (before === after) return new Date(naive - before);
  const candidates = [naive - before, naive - after].sort((a, b) => a - b);
  for (const t of candidates) {
    if (wallAsUtcMs(t, tz) === naive) return new Date(t);
  }
  return new Date(naive - before);
}

/** Format a slot range, e.g. "lun. 23 juin 2026 · 14:00 – 15:00". */
export function formatSlot(start: Date, end: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(d);
  return `${date} · ${t(start)} – ${t(end)}`;
}

export function formatTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function formatDateLong(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  }).format(d);
}

/** Returns YYYY-MM-DD for a date as seen in `tz` (stable grouping key). */
export function dayKeyInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
}

/** "7 oct. 2026" */
export function formatDateShort(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

/** "7 oct. 2026, 14:32" */
export function formatDateTimeShort(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

/** Adds `n` calendar days to a YYYY-MM-DD key (civil arithmetic, no time zone). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD key. */
export function dayOfWeekForKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Local midnight of the calendar day `key` in `tz`, as an instant. */
export function startOfDayKey(key: string, tz: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return instantFromWallClock(y, m, d, 0, tz);
}

/**
 * Minutes on the wall clock (hours × 60 + minutes) of `instant` in `tz`.
 * Unlike "time elapsed since local midnight", 19:00 is 1140 even on a
 * 23- or 25-hour DST day.
 */
export function wallClockMinutes(instant: Date, tz: string): number {
  const z = new TZDate(instant.getTime(), tz);
  return z.getHours() * 60 + z.getMinutes();
}
