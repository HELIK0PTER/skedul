import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Formats a local Date as "yyyy-MM-dd" (no timezone conversion — reads local Y/M/D fields). */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses a "yyyy-MM-dd" string into a local Date at midnight. Inverse of toDayKey. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns every Date needed to render a Monday-start month grid for `viewMonth`,
 * including the leading/trailing days of adjacent months that fill out full weeks.
 */
export function getMonthGridDays(viewMonth: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}
