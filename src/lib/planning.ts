import { TZDate } from "@date-fns/tz";

import {
  addDaysToKey,
  dayKeyInTz,
  dayOfWeekForKey,
  startOfDayKey,
} from "@/lib/datetime";

/** The Monday (YYYY-MM-DD) of the week that contains `key`. */
function mondayKeyOf(key: string): string {
  return addDaysToKey(key, -((dayOfWeekForKey(key) + 6) % 7));
}

/** Monday 00:00 (local) of the week containing `param` (YYYY-MM-DD) or `now`. */
export function weekStartFromParam(
  param: string | undefined,
  tz: string,
  now: Date,
): Date {
  const key =
    param && /^\d{4}-\d{2}-\d{2}$/.test(param)
      ? addDaysToKey(param, 0) // normalizes an overflowing date like 2026-02-31
      : dayKeyInTz(now, tz);
  return startOfDayKey(mondayKeyOf(key), tz);
}

/** [Monday 00:00, next Monday 00:00) in local time — 167 h or 169 h on DST weeks. */
export function weekBounds(weekStart: Date, tz: string): { start: Date; end: Date } {
  const monday = dayKeyInTz(weekStart, tz);
  return { start: weekStart, end: startOfDayKey(addDaysToKey(monday, 7), tz) };
}

/** The 7 local midnights Monday → Sunday. */
export function weekDays(weekStart: Date, tz: string): Date[] {
  const monday = dayKeyInTz(weekStart, tz);
  return Array.from({ length: 7 }, (_, i) =>
    startOfDayKey(addDaysToKey(monday, i), tz),
  );
}

/** The `?week=` param of the week `deltaWeeks` away from `weekStart`. */
export function adjacentWeekParam(
  weekStart: Date,
  tz: string,
  deltaWeeks: number,
): string {
  return addDaysToKey(dayKeyInTz(weekStart, tz), 7 * deltaWeeks);
}

export function gridRange(
  events: { startAt: Date; endAt: Date }[],
  tz: string,
): { startHour: number; endHour: number } {
  let startHour = 8;
  let endHour = 21;
  for (const e of events) {
    const s = new TZDate(e.startAt.getTime(), tz);
    const en = new TZDate(e.endAt.getTime(), tz);
    startHour = Math.min(startHour, s.getHours());
    const endMin = en.getHours() * 60 + en.getMinutes();
    endHour = Math.max(endHour, Math.ceil(endMin / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export function paramForWeek(weekStart: Date, tz: string): string {
  return dayKeyInTz(weekStart, tz);
}
