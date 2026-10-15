/**
 * The questions editor's model (spec § 13.1): drafts as typed in the form,
 * converted to QuestionInput for setTypeQuestions / editEventInPlace. Pure, so
 * the conversion rules are unit-tested; QuestionsEditor re-exports them.
 */
import type { QuestionRow } from "@/lib/booking/answers";
import type { QuestionInput } from "@/lib/tickets";
import type { QuestionType } from "@/lib/tickets-vocab";

export type QuestionDraft = {
  /** React key: the saved id, or a client-made key for a new question */
  key: string;
  /** set for a saved question only */
  id?: string;
  label: string;
  type: QuestionType;
  options: string[];
  required: boolean;
};

/** Drafts of saved questions (key = id). */
export function draftsFromRows(rows: readonly QuestionRow[]): QuestionDraft[] {
  return rows.map((r) => ({
    key: r.id,
    id: r.id,
    label: r.label,
    type: r.type,
    options: r.options ?? [],
    required: r.required,
  }));
}

/** Inputs for setTypeQuestions / editEventInPlace (trimmed; options only for choice, blanks dropped; id kept for saved ones). */
export function inputsFromDrafts(drafts: readonly QuestionDraft[]): QuestionInput[] {
  return drafts.map((d) => ({
    ...(d.id === undefined ? {} : { id: d.id }),
    label: d.label.trim(),
    type: d.type,
    options: d.type === "choice" ? d.options.map((o) => o.trim()).filter((o) => o !== "") : [],
    required: d.required,
  }));
}

/** « Ajouter une question »: an empty optional text question. */
export function newQuestionDraft(key: string): QuestionDraft {
  return { key, label: "", type: "text", options: [], required: false };
}

/** Changes the answer type; a choice starts with at least two (empty) options. */
export function withQuestionType(draft: QuestionDraft, type: QuestionType): QuestionDraft {
  const missing = type === "choice" ? Math.max(0, 2 - draft.options.length) : 0;
  return { ...draft, type, options: [...draft.options, ...Array.from({ length: missing }, () => "")] };
}

/** A copy of `items` with the item at `index` swapped with its neighbour (unchanged at the ends). */
export function moveDraft<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  const next = [...items];
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
