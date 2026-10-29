"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { QUESTION_TYPE_LABELS } from "@/lib/back-office/labels";
import { moveDraft, newQuestionDraft, withQuestionType, type QuestionDraft } from "@/lib/back-office/question-drafts";
import { BOUNDS, QUESTION_TYPES, type QuestionType } from "@/lib/tickets-vocab";

export { draftsFromRows, inputsFromDrafts, type QuestionDraft } from "@/lib/back-office/question-drafts";

/** Questions of a type or an event: add, edit, reorder, remove. Owns no persistence. */
export function QuestionsEditor({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: QuestionDraft[];
  onChange: (next: QuestionDraft[]) => void;
  disabled?: boolean;
}) {
  const counter = useRef(0);

  function update(index: number, next: QuestionDraft) {
    onChange(value.map((d, i) => (i === index ? next : d)));
  }

  function add() {
    counter.current += 1;
    onChange([...value, newQuestionDraft(`new-${idPrefix}-${counter.current}`)]);
  }

  return (
    <div className="space-y-4">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune question.</p>
      ) : (
        <ol className="space-y-4">
          {value.map((d, index) => {
            const base = `${idPrefix}-${d.key}`;
            // Repeated buttons name their question, so a screen reader can tell them apart.
            const nth = `la question ${index + 1}`;
            return (
              <li key={d.key} className="space-y-3 rounded-xl border border-border p-4">
                <FormField label="Question" htmlFor={`${base}-label`}>
                  <Input
                    id={`${base}-label`}
                    value={d.label}
                    maxLength={BOUNDS.questionLabel}
                    disabled={disabled}
                    onChange={(e) => update(index, { ...d, label: e.target.value })}
                  />
                </FormField>
                <FormField label="Type de réponse" htmlFor={`${base}-type`}>
                  <Select
                    id={`${base}-type`}
                    value={d.type}
                    disabled={disabled}
                    onChange={(e) => update(index, withQuestionType(d, e.target.value as QuestionType))}
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {QUESTION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </FormField>

                {d.type === "choice" && (
                  <fieldset className="space-y-2" disabled={disabled}>
                    <legend className="mb-1.5 text-sm font-medium">Options</legend>
                    {d.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-center gap-2">
                        <Input
                          aria-label={`Option ${optionIndex + 1} de ${nth}`}
                          value={option}
                          maxLength={BOUNDS.questionLabel}
                          onChange={(e) =>
                            update(index, { ...d, options: d.options.map((o, i) => (i === optionIndex ? e.target.value : o)) })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Retirer l'option ${optionIndex + 1} de ${nth}`}
                          onClick={() => update(index, { ...d, options: d.options.filter((_, i) => i !== optionIndex) })}
                        >
                          <X />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Ajouter une option à ${nth}`}
                      disabled={d.options.length >= BOUNDS.questionOptions}
                      onClick={() => update(index, { ...d, options: [...d.options, ""] })}
                    >
                      <Plus />
                      Ajouter une option
                    </Button>
                  </fieldset>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={d.required}
                    disabled={disabled}
                    onChange={(e) => update(index, { ...d, required: e.target.checked })}
                  />
                  Obligatoire pour le client
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Monter ${nth}`}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveDraft(value, index, -1))}
                  >
                    <ArrowUp />
                    Monter
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Descendre ${nth}`}
                    disabled={disabled || index === value.length - 1}
                    onClick={() => onChange(moveDraft(value, index, 1))}
                  >
                    <ArrowDown />
                    Descendre
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Retirer ${nth}`}
                    className="text-destructive hover:bg-destructive/10 sm:ml-auto"
                    disabled={disabled}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <X />
                    Retirer
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Button type="button" variant="secondary" size="sm" disabled={disabled || value.length >= BOUNDS.questions} onClick={add}>
        <Plus />
        Ajouter une question
      </Button>
    </div>
  );
}
