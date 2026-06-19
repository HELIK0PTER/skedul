import { dayKeyInTz, instantFromWallClock } from "@/lib/datetime";

export interface Rule {
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

export interface Slot {
  start: Date;
  end: Date;
}

interface ComputeArgs {
  rules: Rule[];
  busy: BusyInterval[];
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  timezone: string;
  daysAhead?: number;
  now?: Date;
  /** smallest gap from now before a slot is bookable (minutes) */
  minNoticeMinutes?: number;
}

/** Computes bookable slots over the next `daysAhead` days. */
export function computeSlots({
  rules,
  busy,
  durationMinutes,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
  timezone,
  daysAhead = 21,
  now = new Date(),
  minNoticeMinutes = 60,
}: ComputeArgs): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<number>();
  const earliest = now.getTime() + minNoticeMinutes * 60_000;
  const step = durationMinutes;

  for (let offset = 0; offset < daysAhead; offset++) {
    const base = new Date(now.getTime() + offset * 86_400_000);
    const ymd = dayKeyInTz(base, timezone); // YYYY-MM-DD (local to tz)
    const [year, month, day] = ymd.split("-").map(Number);
    const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();

    for (const rule of rules) {
      if (rule.dayOfWeek !== dow) continue;
      for (
        let t = rule.startMinute;
        t + durationMinutes <= rule.endMinute;
        t += step
      ) {
        const start = instantFromWallClock(year, month, day, t, timezone);
        if (start.getTime() < earliest) continue;
        if (seen.has(start.getTime())) continue;

        const end = instantFromWallClock(
          year,
          month,
          day,
          t + durationMinutes,
          timezone,
        );

        const blockStart = start.getTime() - bufferBeforeMinutes * 60_000;
        const blockEnd = end.getTime() + bufferAfterMinutes * 60_000;
        const overlaps = busy.some(
          (b) =>
            b.startAt.getTime() < blockEnd && b.endAt.getTime() > blockStart,
        );
        if (overlaps) continue;

        seen.add(start.getTime());
        slots.push({ start, end });
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
