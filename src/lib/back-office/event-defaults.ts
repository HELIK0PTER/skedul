/**
 * Defaults of the « Nouvel événement » form (pure, client-safe): the new
 * event's values and the start proposed to the pro (Q10). Dates are civil
 * `DateKey`s and minutes from local midnight in the pro's zone; the browser's
 * zone never enters.
 */
import { addDays, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { wallClockMinutes } from "@/lib/datetime";
import { DEFAULT_COLOR } from "@/lib/tickets-vocab";

export const EVENT_DEFAULTS = {
  durationMin: 60,
  capacity: 12,
  bookingMode: "tickets",
  color: DEFAULT_COLOR,
} as const;

/** Tomorrow's proposed start when today has no full hour left (09:00). */
const TOMORROW_MINUTE = 540;
/** The last full hour proposed today (23:00). */
const LAST_PROPOSED_MINUTE = 1380;

/**
 * Q10: the clicked planning cell when it is still ahead (a later date, or today
 * with its start minute, rounded down to 30, after the current wall-clock
 * minute: the engine refuses a start at or before now), else the next full hour
 * today when it is at most 23:00, else tomorrow 09:00.
 */
export function defaultEventStart(args: {
  now: Date;
  tz: string;
  clicked?: { date: DateKey; minute: number } | null;
}): { startDate: DateKey; startMinute: number } {
  const today = todayKey(args.now, args.tz);
  const nowMinute = wallClockMinutes(args.now, args.tz);
  const { clicked } = args;
  if (clicked && clicked.date >= today) {
    const startMinute = Math.floor(clicked.minute / 30) * 30;
    if (clicked.date > today || startMinute > nowMinute) return { startDate: clicked.date, startMinute };
  }
  const nextHour = (Math.floor(nowMinute / 60) + 1) * 60;
  if (nextHour <= LAST_PROPOSED_MINUTE) return { startDate: today, startMinute: nextHour };
  return { startDate: addDays(today, 1), startMinute: TOMORROW_MINUTE };
}

/** ?date=YYYY-MM-DD&minute=0..1439 of /dashboard/events/new; anything malformed → null. */
export function parseClickedCell(params: {
  date?: string | string[];
  minute?: string | string[];
}): { date: DateKey; minute: number } | null {
  const { date, minute } = params;
  if (typeof date !== "string" || typeof minute !== "string") return null;
  if (!/^\d{1,4}$/.test(minute)) return null;
  const value = Number(minute);
  if (value > 1439) return null;
  try {
    parseKey(date);
  } catch {
    return null;
  }
  return { date, minute: value };
}
