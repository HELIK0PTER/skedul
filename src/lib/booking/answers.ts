/**
 * Registration questions and answers (moved from src/server/booking-core.ts).
 * Questions belong to an event, or to a ticket type for the RDV libre; answers
 * are snapshotted (question_label) onto the booking, so they survive a
 * question's deletion (booking_answer.question_id → question SET NULL).
 */
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { BatchCtx, Db, Query } from "@/lib/db/atomic";
import { bookingAnswer, question } from "@/lib/db/schema";
import { BOUNDS, ENGINE_ERROR_MESSAGES, type AnswerInput, type QuestionType } from "@/lib/tickets";

export type QuestionRow = {
  id: string;
  label: string;
  type: QuestionType;
  options: string[] | null;
  required: boolean;
  position: number;
};
export type AnswerRow = { questionId: string; questionLabel: string; value: string };

/** The answers a boolean question accepts. */
export const BOOLEAN_ANSWERS = ["Oui", "Non"] as const;

/** Questions of an event, or the RDV questions of a ticket type, by position. */
export async function loadQuestions(
  db: Db,
  owner: { eventId: string } | { ticketTypeId: string },
): Promise<QuestionRow[]> {
  const where = "eventId" in owner ? eq(question.eventId, owner.eventId) : eq(question.ticketTypeId, owner.ticketTypeId);
  return db
    .select({
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options,
      required: question.required,
      position: question.position,
    })
    .from(question)
    .where(where)
    .orderBy(asc(question.position), asc(question.createdAt), asc(question.id));
}

/**
 * Validates answers against the questions, in question order. Values are
 * trimmed and an empty one is skipped; a required question is enforced only
 * when `enforceRequired` (clients, never the pro). A choice must be one of the
 * options, a boolean « Oui » or « Non ». An answer to an unknown question, a
 * duplicate answer or an over-long value is invalid.
 */
export function buildAnswers(
  questions: readonly QuestionRow[],
  answers: readonly AnswerInput[] | undefined,
  opts: { enforceRequired: boolean },
): { ok: true; rows: AnswerRow[] } | { ok: false; message: string } {
  const invalid = { ok: false as const, message: ENGINE_ERROR_MESSAGES.invalid };
  const known = new Set(questions.map((q) => q.id));
  const byId = new Map<string, string>();
  for (const a of answers ?? []) {
    if (!known.has(a.questionId) || byId.has(a.questionId)) return invalid;
    byId.set(a.questionId, a.value.trim());
  }

  const rows: AnswerRow[] = [];
  for (const q of questions) {
    const value = byId.get(q.id) ?? "";
    if (!value) {
      if (q.required && opts.enforceRequired) return { ok: false, message: `Merci de répondre à : ${q.label}` };
      continue;
    }
    if (value.length > BOUNDS.answer) return invalid;
    const accepted =
      q.type === "choice"
        ? (q.options ?? []).includes(value)
        : q.type === "boolean"
          ? (BOOLEAN_ANSWERS as readonly string[]).includes(value)
          : true;
    if (!accepted) return { ok: false, message: `Réponse invalide pour : ${q.label}` };
    rows.push({ questionId: q.id, questionLabel: q.label, value });
  }
  return { ok: true, rows };
}

/** One multi-row INSERT into booking_answer (nanoid ids, timestamps = now); [] when there is nothing to insert. */
export function insertAnswers(
  c: BatchCtx,
  args: { professionalId: string; bookingId: string; rows: readonly AnswerRow[] },
): Query[] {
  if (args.rows.length === 0) return [];
  return [
    c.db.insert(bookingAnswer).values(
      args.rows.map((r) => ({
        id: nanoid(),
        professionalId: args.professionalId,
        bookingId: args.bookingId,
        questionId: r.questionId,
        questionLabel: r.questionLabel,
        value: r.value,
        createdAt: c.now,
        updatedAt: c.now,
      })),
    ),
  ];
}
