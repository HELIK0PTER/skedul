/**
 * Field-message bookkeeping of the event forms (create form, information card,
 * schedule card). Pure and client-safe: an edit drops the messages of the fields
 * it changed (their `aria-invalid` goes with them), and the next submit validates
 * everything again. Keys are the dotted paths of `parseFr` (`rule.startDate`,
 * `questions.0.label`).
 */
import type { OfferField, OfferFormValues } from "./offer-form";
import type { RdvField, RdvFormValues } from "./rdv-form";
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

/** The one message of a form that shows it under a field (`field`) or above the buttons (null). */
export type FieldError<F extends string> = { field: F | null; message: string };

/**
 * The message left after an edit that resolves `fixed`: dropped when it was shown under one of those fields (its
 * `aria-invalid` goes with it), kept otherwise. A general message (no field) stays until the next submit.
 */
export function errorAfterEdit<F extends string>(error: FieldError<F> | null, fixed: readonly F[]): FieldError<F> | null {
  if (error === null || error.field === null) return error;
  return fixed.includes(error.field) ? null : error;
}

/** The offer form fields whose message editing each value resolves. A field added to OfferFormValues must be listed here. */
export const OFFER_ERROR_FIELDS: Record<keyof OfferFormValues, readonly OfferField[]> = {
  quantity: ["quantity"],
  price: ["price"],
  label: ["label"],
  validity: ["validity"],
  validityCount: ["validity"],
  isActive: [],
};

/** Same for the « RDV libre » form: switching RDV off hides the three number fields, so their messages go too. */
export const RDV_ERROR_FIELDS: Record<keyof RdvFormValues, readonly RdvField[]> = {
  enabled: ["duration", "before", "after"],
  free: [],
  duration: ["duration"],
  before: ["before"],
  after: ["after"],
  overrides: [],
};
