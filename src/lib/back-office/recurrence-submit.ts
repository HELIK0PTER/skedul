/**
 * The two gates of the event forms (pure, client-safe): whether a recurrence
 * form value may be previewed and submitted (`submittableRule`), and which
 * start field to blame when `ruleFromForm` cannot build a rule at all
 * (`startProblem`). The rule itself is `ruleFromForm`'s; the French messages of
 * the schemas come from `parseFr`, so only the two start fields need their own.
 */
import { parseKey } from "@/lib/civil-date";
import { recurrenceRuleSchema, type RecurrenceRuleInput } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";

import { ruleFromForm, timeToMinute, type RecurrenceFormValue } from "./recurrence-form";

/** The rule and duration of a form value when both pass the engine's schemas (rule schema, duration 5..720 by 5), else null. */
export function submittableRule(
  value: RecurrenceFormValue,
): { rule: RecurrenceRuleInput; durationMin: number } | null {
  const built = ruleFromForm(value);
  if (!built) return null;
  if (!recurrenceRuleSchema.safeParse(built.rule).success) return null;
  const { min, max, step } = BOUNDS.eventDurationMin;
  const d = built.durationMin;
  if (!Number.isInteger(d) || d < min || d > max || d % step !== 0) return null;
  return built;
}

function isDay(value: string): boolean {
  try {
    parseKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which start field makes `ruleFromForm` return null: "date" when the start date
 * is cleared or not a day (checked first), else "time" when the start time is
 * cleared or not HH:MM, else null (every other mistake still yields a rule that
 * the schemas refuse with their own field message).
 */
export function startProblem(value: RecurrenceFormValue): "date" | "time" | null {
  if (!isDay(value.startDate)) return "date";
  if (timeToMinute(value.startTime) === null) return "time";
  return null;
}
