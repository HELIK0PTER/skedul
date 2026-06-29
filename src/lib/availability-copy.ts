import type { ByDay, Range } from "@/components/dashboard/weekly-hours-editor";

const cloneRange = (r: Range): Range => ({ start: r.start, end: r.end });
const sameRange = (a: Range, b: Range) => a.start === b.start && a.end === b.end;

/**
 * Add one range to each target day, skipping exact duplicates (same start+end
 * already present). Existing ranges are kept and their order preserved; the new
 * range is appended. Pure: returns a new ByDay, never mutates the input.
 */
export function mergeRangeIntoDays(
  byDay: ByDay,
  range: Range,
  targetDays: number[],
): ByDay {
  const next: ByDay = { ...byDay };
  for (const day of targetDays) {
    const current = byDay[day] ?? [];
    if (current.some((r) => sameRange(r, range))) {
      next[day] = current.map(cloneRange);
    } else {
      next[day] = [...current.map(cloneRange), cloneRange(range)];
    }
  }
  return next;
}

/**
 * Replace each target day's ranges with a deep clone of `ranges`. Pure: returns
 * a new ByDay, never mutates the input, and the cloned ranges are independent of
 * the source objects.
 */
export function replaceDaysWith(
  byDay: ByDay,
  ranges: Range[],
  targetDays: number[],
): ByDay {
  const next: ByDay = { ...byDay };
  for (const day of targetDays) {
    next[day] = ranges.map(cloneRange);
  }
  return next;
}
