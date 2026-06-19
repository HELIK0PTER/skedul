import { dayKeyInTz, instantFromWallClock } from "@/lib/datetime";

export interface TimeOffInput {
  /** YYYY-MM-DD, interpreted in the pro's timezone */
  startDate: string;
  /** YYYY-MM-DD, interpreted in the pro's timezone */
  endDate: string;
  allDay: boolean;
  /** minutes from midnight; required when !allDay */
  startMinute?: number;
  /** minutes from midnight; required when !allDay */
  endMinute?: number;
}

export interface TimeOffInterval {
  startAt: Date;
  endAt: Date;
}

/** Next calendar day (UTC math, rollover-safe) for a Y/M/D triple. */
function nextDay(y: number, m1: number, d: number) {
  const dt = new Date(Date.UTC(y, m1 - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Maps a back-office time-off form input to a continuous instant interval
 * `[startAt, endAt)` in `tz`. Throws on invalid input.
 */
export function buildTimeOffInterval(
  input: TimeOffInput,
  tz: string,
): TimeOffInterval {
  const [sy, sm, sd] = input.startDate.split("-").map(Number);
  const [ey, em, ed] = input.endDate.split("-").map(Number);

  if (input.allDay) {
    const startAt = instantFromWallClock(sy, sm, sd, 0, tz);
    const end = nextDay(ey, em, ed); // exclusive bound = day after last day
    const endAt = instantFromWallClock(end.y, end.m, end.d, 0, tz);
    if (endAt.getTime() <= startAt.getTime()) {
      throw new Error("La date de fin doit être après la date de début.");
    }
    return { startAt, endAt };
  }

  if (input.startDate !== input.endDate) {
    throw new Error("Une plage horaire doit tenir sur une seule journée.");
  }
  const startMin = input.startMinute ?? 0;
  const endMin = input.endMinute ?? 0;
  if (endMin <= startMin) {
    throw new Error("L'heure de fin doit être après l'heure de début.");
  }
  return {
    startAt: instantFromWallClock(sy, sm, sd, startMin, tz),
    endAt: instantFromWallClock(sy, sm, sd, endMin, tz),
  };
}

/** The distinct local-day keys (YYYY-MM-DD in `tz`) an interval spans. */
export function coveredDayKeys(
  startAt: Date,
  endAt: Date,
  tz: string,
): string[] {
  const keys: string[] = [];
  let cursor = startAt.getTime();
  const end = endAt.getTime();
  let guard = 0; // backstop against pathological ranges
  while (cursor < end && guard < 400) {
    const key = dayKeyInTz(new Date(cursor), tz);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor += 86_400_000;
    guard++;
  }
  return keys;
}
