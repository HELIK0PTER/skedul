/**
 * Field-message bookkeeping of the event forms (create form, information card,
 * schedule card). Pure and client-safe: an edit drops the messages of the fields
 * it changed (their `aria-invalid` goes with them), and the next submit validates
 * everything again. Keys are the dotted paths of `parseFr` (`rule.startDate`,
 * `questions.0.label`).
 */
import type { RecurrenceFormValue } from "./recurrence-form";

/** `errors` without the messages whose dotted key is, or sits under, one of `prefixes`; the same object when nothing goes. */
export function withoutErrorsUnder(errors: Record<string, string>, prefixes: readonly string[]): Record<string, string> {
  const kept = Object.entries(errors).filter(
    ([key]) => !prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
  );
  return kept.length === Object.keys(errors).length ? errors : Object.fromEntries(kept);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => item === b[i]);
  return a === b;
}

/** The keys of a form value that differ between two states (arrays element by element, anything else by identity). */
export function changedKeys<T extends object>(prev: T, next: T): (keyof T)[] {
  return (Object.keys(next) as (keyof T)[]).filter((key) => !sameValue(prev[key], next[key]));
}

/**
 * The error keys (parseFr dotted paths) that editing each recurrence field can resolve. Some rule errors
 * are blamed on another field than the one that causes them (« interval » on « freq », « untilDate » on
 * the start date), so those are listed too. A field added to RecurrenceFormValue must be listed here.
 */
export const RECURRENCE_ERROR_KEYS: Record<keyof RecurrenceFormValue, readonly string[]> = {
  startDate: ["rule.startDate", "rule.untilDate"],
  startTime: ["rule.startMinute"],
  durationMin: ["durationMin"],
  freq: ["rule.freq", "rule.interval", "rule.weekdays", "rule.monthlyBy", "rule.monthWeek"],
  interval: ["rule.interval", "rule.freq"],
  weekdays: ["rule.weekdays"],
  monthlyChoice: ["rule.monthlyBy", "rule.monthWeek"],
  endMode: ["rule.endMode", "rule.untilDate", "rule.occurrenceCount"],
  untilDate: ["rule.untilDate"],
  occurrenceCount: ["rule.occurrenceCount"],
};
