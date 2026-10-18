import "server-only";

import { getPlanningRange } from "@/lib/back-office/planning-reads";
import {
  gridHours,
  timeOffSegments,
  toPlanningVM,
  weekTitle,
  type PlanningItemVM,
  type TimeOffSegmentVM,
} from "@/lib/back-office/planning-view";
import { minGeneratedUntil, needsHorizon } from "@/lib/booking/occurrences";
import { addDays, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import { paramForWeek, weekBounds, weekStartFromParam } from "@/lib/planning";

export type PlanningPageData = {
  tz: string;
  days: DateKey[];
  todayKey: DateKey;
  title: string;
  nav: { prev: DateKey; next: DateKey; today: DateKey };
  items: PlanningItemVM[];
  timeOff: TimeOffSegmentVM[];
  startHour: number;
  endHour: number;
  nowIso: string;
  needsHorizon: boolean;
};

/** A well-formed date between 2000 and 2100, else undefined (the page then shows this week). */
function validWeekParam(param: string | undefined): string | undefined {
  if (!param) return undefined;
  try {
    const { y } = parseKey(param);
    return y >= 2000 && y <= 2100 ? param : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The week of `weekParam` (YYYY-MM-DD, any day; invalid → this week) in the pro
 * time zone: Monday 00:00 to next Monday 00:00 by local date, the range read,
 * the view model, the time-off segments, the grid hours and the title. Reads
 * only: the caller schedules ensureHorizon with after() when `needsHorizon`.
 */
export async function getPlanningPage(
  pro: { id: string; timezone: string },
  weekParam: string | undefined,
): Promise<PlanningPageData> {
  const now = new Date();
  const tz = pro.timezone;
  const weekStart = weekStartFromParam(validWeekParam(weekParam), tz, now);
  const monday = paramForWeek(weekStart, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [{ items, timeOff }, generatedUntil] = await Promise.all([
    getPlanningRange(db, pro.id, weekBounds(weekStart, tz), now),
    minGeneratedUntil(db, pro.id, now),
  ]);
  const vms = toPlanningVM(items, timeOff, tz, now);
  const today = todayKey(now, tz);
  return {
    tz,
    days,
    todayKey: today,
    title: weekTitle(days),
    nav: { prev: addDays(monday, -7), next: addDays(monday, 7), today: mondayOf(today) },
    items: vms,
    timeOff: timeOffSegments(timeOff, days, tz),
    ...gridHours(vms),
    nowIso: now.toISOString(),
    needsHorizon: needsHorizon(generatedUntil, now, tz),
  };
}
