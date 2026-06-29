import { TZDate } from "@date-fns/tz";

import { dayKeyInTz } from "@/lib/datetime";

/** Local midnight (as a UTC instant) of the calendar day `instant` falls on, in `tz`. */
function localMidnight(instant: Date, tz: string): Date {
  const z = new TZDate(instant.getTime(), tz);
  return new Date(
    new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, tz).getTime(),
  );
}

/** Monday 00:00 (local) of the week containing `param` (YYYY-MM-DD) or `now`. */
export function weekStartFromParam(
  param: string | undefined,
  tz: string,
  now: Date,
): Date {
  let base: Date;
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const [y, m, d] = param.split("-").map(Number);
    base = new Date(new TZDate(y, m - 1, d, 12, 0, 0, tz).getTime());
  } else {
    base = now;
  }
  const midnight = localMidnight(base, tz);
  const z = new TZDate(midnight.getTime(), tz);
  const dow = z.getDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // days since Monday
  return new Date(midnight.getTime() - backToMonday * 86_400_000);
}

export function weekBounds(weekStart: Date): { start: Date; end: Date } {
  return {
    start: weekStart,
    end: new Date(weekStart.getTime() + 7 * 86_400_000),
  };
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from(
    { length: 7 },
    (_, i) => new Date(weekStart.getTime() + i * 86_400_000),
  );
}

export function minutesIntoDay(instant: Date, dayStart: Date): number {
  return Math.round((instant.getTime() - dayStart.getTime()) / 60_000);
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
