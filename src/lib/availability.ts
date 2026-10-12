import {
  addDaysToKey,
  dayKeyInTz,
  dayOfWeekForKey,
  instantFromWallClock,
} from "@/lib/datetime";

export interface Rule {
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

export interface SessionInfo {
  eventTypeId: string;
  startMs: number;
  endMs: number;
  seatsRemaining: number;
  capacity: number;
}

export interface Slot {
  start: Date;
  end: Date;
  seatsRemaining: number;
  capacity: number;
}

interface ComputeArgs {
  rules: Rule[];
  busy: BusyInterval[]; // time-off only
  sessions: SessionInfo[]; // all of the pro's future sessions
  eventTypeId: string; // the event type we are computing slots for
  defaultCapacity: number; // eventType.capacity (used when no session exists yet)
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  timezone: string;
  daysAhead?: number;
  now?: Date;
  /** smallest gap from now before a slot is bookable (minutes) */
  minNoticeMinutes?: number;
}

/** Computes bookable slots over the next `daysAhead` days, capacity-aware. */
export function computeSlots({
  rules,
  busy,
  sessions,
  eventTypeId,
  defaultCapacity,
  durationMinutes,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
  timezone,
  daysAhead = 21,
  now = new Date(),
  minNoticeMinutes = 60,
}: ComputeArgs): Slot[] {
  if (durationMinutes <= 0) return [];
  const slots: Slot[] = [];
  const seen = new Set<number>();
  const earliest = now.getTime() + minNoticeMinutes * 60_000;
  const step = durationMinutes;

  // Walk calendar days in the pro's zone. Stepping 24 h from `now` skips or
  // repeats a day when a DST change falls inside the horizon.
  const firstKey = dayKeyInTz(now, timezone);
  for (let offset = 0; offset < daysAhead; offset++) {
    const ymd = addDaysToKey(firstKey, offset);
    const [year, month, day] = ymd.split("-").map(Number);
    const dow = dayOfWeekForKey(ymd);

    for (const rule of rules) {
      if (rule.dayOfWeek !== dow) continue;
      for (
        let t = rule.startMinute;
        t + durationMinutes <= rule.endMinute;
        t += step
      ) {
        const start = instantFromWallClock(year, month, day, t, timezone);
        const startMs = start.getTime();
        if (startMs < earliest) continue;
        if (seen.has(startMs)) continue;

        const end = instantFromWallClock(
          year,
          month,
          day,
          t + durationMinutes,
          timezone,
        );

        const blockStart = startMs - bufferBeforeMinutes * 60_000;
        const blockEnd = end.getTime() + bufferAfterMinutes * 60_000;

        // time-off blocks
        const timeOffOverlap = busy.some(
          (b) =>
            b.startAt.getTime() < blockEnd && b.endAt.getTime() > blockStart,
        );
        if (timeOffOverlap) continue;

        // any OTHER session occupies the pro ("one class at a time")
        const otherSessionOverlap = sessions.some(
          (s) =>
            !(s.eventTypeId === eventTypeId && s.startMs === startMs) &&
            s.startMs < blockEnd &&
            s.endMs > blockStart,
        );
        if (otherSessionOverlap) continue;

        // the session exactly at this (eventType, start), if any
        const exact = sessions.find(
          (s) => s.eventTypeId === eventTypeId && s.startMs === startMs,
        );
        const seatsRemaining = exact ? exact.seatsRemaining : defaultCapacity;
        const capacity = exact ? exact.capacity : defaultCapacity;
        if (seatsRemaining <= 0) continue;

        seen.add(startMs);
        slots.push({ start, end, seatsRemaining, capacity });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/** Groups slots by their day-of-month label in the given timezone. */
export function groupSlotsByDay(
  slots: Slot[],
  timezone: string,
): { dayKey: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dayKeyInTz(slot.start, timezone);
    const arr = groups.get(key) ?? [];
    arr.push(slot);
    groups.set(key, arr);
  }
  return [...groups.entries()].map(([dayKey, slots]) => ({ dayKey, slots }));
}
