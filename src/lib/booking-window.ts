/**
 * Booking windows (spec § 2.13, § 7): horizon, minimum notice and client
 * cancellation deadline. An event (or an RDV ticket type) may override each
 * of the pro's three settings. The online rule here mirrors the SQL guard
 * ONLINE_OK of src/lib/booking/claims.ts; the pro path ignores both.
 */
import { addDays, dayOfWeek, instantAt, todayKey, type DateKey } from "@/lib/civil-date";
import { wallClockMinutes } from "@/lib/datetime";
import type { WindowOverrides } from "@/lib/tickets";

export type BookingWindow = { bookingHorizonDays: number; minNoticeMinutes: number; cancelDeadlineHours: number };

/** Each field: the override when not null, else the pro's. */
export function effectiveWindow(pro: BookingWindow, override?: Partial<WindowOverrides> | null): BookingWindow {
  return {
    bookingHorizonDays: override?.bookingHorizonDays ?? pro.bookingHorizonDays,
    minNoticeMinutes: override?.minNoticeMinutes ?? pro.minNoticeMinutes,
    cancelDeadlineHours: override?.cancelDeadlineHours ?? pro.cancelDeadlineHours,
  };
}

/** today (local, tz) + horizonDays. */
export function lastBookableDate(now: Date, tz: string, horizonDays: number): DateKey {
  return addDays(todayKey(now, tz), horizonDays);
}

export type Bookability = { ok: true } | { ok: false; reason: "past" | "notice" | "horizon" };

/** now + minNotice ≤ startsAt AND local date(startsAt) ≤ today + horizon; "past" when startsAt ≤ now. Mirrors ONLINE_OK (§6). */
export function onlineBookability(args: { startsAt: Date; now: Date; tz: string; window: BookingWindow }): Bookability {
  const { startsAt, now, tz, window } = args;
  if (startsAt.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (now.getTime() + window.minNoticeMinutes * 60_000 > startsAt.getTime()) {
    return { ok: false, reason: "notice" };
  }
  if (todayKey(startsAt, tz) > lastBookableDate(now, tz, window.bookingHorizonDays)) {
    return { ok: false, reason: "horizon" };
  }
  return { ok: true };
}

/** RDV: [startsAt, endsAt) inside one rule window of the local day of startsAt (rules already resolved). */
export function fitsAvailability(
  rules: readonly { dayOfWeek: number; startMinute: number; endMinute: number }[],
  startsAt: Date,
  endsAt: Date,
  tz: string,
): boolean {
  if (endsAt.getTime() <= startsAt.getTime()) return false;
  const day = todayKey(startsAt, tz);
  const startMinute = wallClockMinutes(startsAt, tz);
  let endMinute: number;
  if (todayKey(endsAt, tz) === day) {
    endMinute = wallClockMinutes(endsAt, tz);
  } else if (endsAt.getTime() === instantAt(addDays(day, 1), 0, tz).getTime()) {
    endMinute = 1440;
  } else {
    return false;
  }
  const dow = dayOfWeek(day);
  return rules.some((r) => r.dayOfWeek === dow && r.startMinute <= startMinute && endMinute <= r.endMinute);
}
