/**
 * The weekly hours grid as plain data: day order and names, and the check a pro
 * gets before the hours are sent. Pure and client-safe. The grid itself
 * (src/components/dashboard/weekly-hours-editor.tsx) imports the names from here.
 */
import type { ByDay } from "@/components/dashboard/weekly-hours-editor";

/** Monday first, Sunday last (Date#getDay numbers). */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  0: "Dimanche",
};

/** The range a message is about: its day, its position in the day (from 0) and the field to put the focus on. */
export type RangeProblem = { day: number; index: number; field: "start" | "end"; message: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The first range, Monday first, that cannot be saved: a time left empty (or not an hour) or an
 * end that is not after the start. « HH:MM » strings of the same width compare in time order.
 * Null when every range is fine. A closed day has no range and is never a problem.
 */
export function firstRangeProblem(byDay: ByDay): RangeProblem | null {
  for (const day of DAY_ORDER) {
    const ranges = byDay[day] ?? [];
    for (let index = 0; index < ranges.length; index++) {
      const { start, end } = ranges[index];
      const where = `${DAY_LABELS[day]}, plage ${index + 1} : `;
      if (!HHMM.test(start)) return { day, index, field: "start", message: `${where}indiquez l'heure de début.` };
      if (!HHMM.test(end)) return { day, index, field: "end", message: `${where}indiquez l'heure de fin.` };
      if (end <= start) {
        return { day, index, field: "end", message: `${where}l'heure de fin doit être après l'heure de début.` };
      }
    }
  }
  return null;
}
