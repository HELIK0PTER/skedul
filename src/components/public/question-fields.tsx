"use client";

import { FormField } from "@/components/dashboard/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionFieldDef } from "@/lib/public/occurrence-form";
import { BOOLEAN_ANSWERS, BOUNDS } from "@/lib/tickets-vocab";

/**
 * The questions of an event (contract § 3.23): text -> textarea, choice -> select (first option « Choisir »), boolean ->
 * two radios « Oui » / « Non ». A required question says « (obligatoire) ». `errors` is keyed by question id. The
 * labels are the pro's text and can be long and unbroken, hence `wrap-anywhere`.
 */
export function QuestionFields({
  idPrefix,
  questions,
  value,
  onChange,
  errors,
}: {
  idPrefix: string;
  questions: QuestionFieldDef[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  errors: Record<string, string>;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="space-y-4">
      {questions.map((q) => {
        const id = `${idPrefix}-q-${q.id}`;
        const label = q.required ? `${q.label} (obligatoire)` : q.label;
        const current = value[q.id] ?? "";
        const error = errors[q.id] ?? null;
        const set = (next: string) => onChange({ ...value, [q.id]: next });

        if (q.type === "boolean") {
          return (
            <fieldset key={q.id} className="wrap-anywhere">
              <legend className="text-sm font-medium">{label}</legend>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                {BOOLEAN_ANSWERS.map((answer, index) => (
                  <label key={answer} htmlFor={`${id}-${index}`} className="inline-flex items-center gap-2 text-sm">
                    <input
                      id={`${id}-${index}`}
                      type="radio"
                      name={id}
                      value={answer}
                      checked={current === answer}
                      onChange={() => set(answer)}
                      aria-invalid={error && index === 0 ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      className="size-4 accent-primary"
                    />
                    {answer}
                  </label>
                ))}
              </div>
              {error && (
                <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-rose-700">
                  {error}
                </p>
              )}
            </fieldset>
          );
        }

        if (q.type === "choice") {
          return (
            <div key={q.id} className="wrap-anywhere">
              <FormField label={label} htmlFor={id} error={error}>
                <Select id={id} value={current} onChange={(e) => set(e.target.value)}>
                  <option value="">Choisir</option>
                  {(q.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          );
        }

        return (
          <div key={q.id} className="wrap-anywhere">
            <FormField label={label} htmlFor={id} error={error}>
              <Textarea id={id} rows={3} maxLength={BOUNDS.answer} value={current} onChange={(e) => set(e.target.value)} />
            </FormField>
          </div>
        );
      })}
    </div>
  );
}
