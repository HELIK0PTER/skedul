import { BOUNDS } from "@/lib/tickets-vocab";
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

/**
 * The starts_at window of the occurrences that overlap [start, end): `starts_at > after AND starts_at < before`.
 * An occurrence overlaps when it starts before `end` and ends after `start`; none lasts more than the longest séance
 * (event_duration_chk, 720 minutes; an RDV is shorter), so one that overlaps cannot have started before `start`
 * minus that. The lower bound lets occurrence_pro_starts_idx (professional_id, starts_at) skip the pro's history,
 * `ends_at > start` stays the exact test (starts_at/ends_at do not include the RDV buffers).
 */
export function occurrenceStartWindow(range: { start: Date; end: Date }): { after: Date; before: Date } {
  return { after: new Date(range.start.getTime() - BOUNDS.eventDurationMin.max * 60_000), before: range.end };
}

export function paramForWeek(weekStart: Date, tz: string): string {
  return dayKeyInTz(weekStart, tz);
}
