/**
 * Civil (calendar) dates as "YYYY-MM-DD" keys (spec § 8). All arithmetic is on
 * whole days since 1970-01-01, through Date.UTC, which has no time zone and no
 * daylight saving time. Spec § 4: iterate by local date, never by adding
 * n × 86 400 000 ms to an instant. Instants are built only at the edge, by
 * `instantAt` (TZDate through datetime.instantFromWallClock).
 */
import {
  addDaysToKey,
  dayKeyInTz,
  dayOfWeekForKey,
  instantFromWallClock,
} from "@/lib/datetime";

/** A local calendar date, "YYYY-MM-DD". */
export type DateKey = string;

const DAY_MS = 86_400_000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Parse a key; throws on a malformed one ("2026-13-01", "2026-02-30", "26-1-1"). */
export function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`Invalid date key: ${key}`);
  }
  return { y, m, d };
}

/** Days since 1970-01-01 (may be negative). */
export function dayNumber(key: DateKey): number {
  const { y, m, d } = parseKey(key);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n: number): DateKey {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Build a normalised key: month and day overflow roll over (2026-02-31 → 2026-03-03). */
export function makeKey(y: number, m: number, d: number): DateKey {
  return fromDayNumber(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** = datetime.addDaysToKey. */
export function addDays(key: DateKey, n: number): DateKey {
  return addDaysToKey(key, n);
}

/** b − a in days. */
export function diffDays(a: DateKey, b: DateKey): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 = Sunday … 6 = Saturday (= datetime.dayOfWeekForKey). */
export function dayOfWeek(key: DateKey): number {
  return dayOfWeekForKey(key);
}

/** Monday of the ISO week containing key. */
export function mondayOf(key: DateKey): DateKey {
  return addDays(key, -((dayOfWeek(key) + 6) % 7));
}

/** y*12 + (m−1). */
export function monthIndex(key: DateKey): number {
  const { y, m } = parseKey(key);
  return y * 12 + (m - 1);
}

/** Add months, clamping the day to the target month's length (2026-01-31 + 1 → 2026-02-28). */
export function addMonthsClamped(key: DateKey, n: number): DateKey {
  const { d } = parseKey(key);
  const target = monthIndex(key) + n;
  const y = Math.floor(target / 12);
  const m = target - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(Math.min(d, daysInMonth(y, m)))}`;
}

/** nth (1..4) or last (−1) `weekday` (0..6) of month m (1..12) of year y. */
export function nthWeekdayOfMonth(
  y: number,
  m: number,
  weekday: number,
  nth: 1 | 2 | 3 | 4 | -1,
): DateKey {
  if (nth === -1) {
    const last = makeKey(y, m, daysInMonth(y, m));
    return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
  }
  const first = makeKey(y, m, 1);
  return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (nth - 1) * 7);
}

export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minKey(a: DateKey, b: DateKey): DateKey {
  return a <= b ? a : b;
}

export function maxKey(a: DateKey, b: DateKey): DateKey {
  return a >= b ? a : b;
}

/** Local calendar date of `instant` in tz (= datetime.dayKeyInTz). */
export function todayKey(instant: Date, tz: string): DateKey {
  return dayKeyInTz(instant, tz);
}

/**
 * Instant of `minute` (0..1440) on local date `key` in tz (= datetime.
 * instantFromWallClock). A nonexistent spring-forward time is shifted forward
 * (02:30 on 2026-03-29 → 03:30), a repeated fall-back time takes the first
 * instant (02:30 on 2026-10-25 → 00:30Z). 1440 is the next local midnight.
 */
export function instantAt(key: DateKey, minute: number, tz: string): Date {
  const { y, m, d } = parseKey(key);
  return instantFromWallClock(y, m, d, minute, tz);
}

/** "12/10" (dd/MM). */
export function formatDayMonth(key: DateKey): string {
  const { m, d } = parseKey(key);
  return `${pad2(d)}/${pad2(m)}`;
}

/** "12/10/2026". */
export function formatDayMonthYear(key: DateKey): string {
  const { y } = parseKey(key);
  return `${formatDayMonth(key)}/${String(y).padStart(4, "0")}`;
}
