/**
 * Pure helpers of the public booking forms (the séance page and, later, the offer page): what the browser sends and
 * the checks it runs before a Server Action call. The throttle keys of a public action are consumed before the engine
 * reads the answers, so a typo caught here costs no rate-limit hit. Client-safe: no server module. The server parses
 * the whole input again; nothing here authorises anything.
 */
import { z } from "zod";

import type { IdentityInput } from "@/lib/public/booking-actions";
import { plainNameSchema } from "@/lib/public/plain-name";
import { customerInputSchema, type AnswerInput, type QuestionType } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

/** A registration question as the forms need it (the page picks these fields from the engine's question rows). */
export type QuestionFieldDef = {
  id: string;
  label: string;
  type: QuestionType;
  options: string[] | null;
  required: boolean;
};

/** The server's identity rules (plain name, e-mail, phone) as one schema; the same building blocks as the action's. */
const identityCheck = z.object({
  name: plainNameSchema,
  email: z.string().trim().pipe(customerInputSchema.shape.email),
  phone: customerInputSchema.shape.phone,
});

/** Field messages the server would refuse (keys `identity.name`, `identity.email`, `identity.phone`, as parseFr on the whole input). */
export function identityErrors(identity: IdentityInput): Record<string, string> {
  const phone = (identity.phone ?? "").trim();
  const parsed = parseFr(identityCheck, {
    name: identity.name,
    email: identity.email,
    ...(phone === "" ? {} : { phone }),
  });
  if (parsed.ok) return {};
  return Object.fromEntries(Object.entries(parsed.fieldErrors).map(([key, message]) => [`identity.${key}`, message]));
}

/** The identity as the Server Action receives it: trimmed, the phone omitted when empty. */
export function identityToSend(identity: IdentityInput): { name: string; email: string; phone?: string } {
  const phone = (identity.phone ?? "").trim();
  return { name: identity.name.trim(), email: identity.email.trim(), ...(phone === "" ? {} : { phone }) };
}

/** Answers in question order, trimmed, blank ones skipped (the engine's rule); a value of an unknown question is ignored. */
export function answersFromValues(
  questions: readonly QuestionFieldDef[],
  values: Readonly<Record<string, string>>,
): AnswerInput[] {
  const answers: AnswerInput[] = [];
  for (const q of questions) {
    const value = (values[q.id] ?? "").trim();
    if (value !== "") answers.push({ questionId: q.id, value });
  }
  return answers;
}

/** « Merci de répondre à : {label} » (the engine's sentence) per required question left blank, keyed by question id. */
export function requiredAnswerErrors(
  questions: readonly QuestionFieldDef[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    if (q.required && (values[q.id] ?? "").trim() === "") errors[q.id] = `Merci de répondre à : ${q.label}`;
  }
  return errors;
}

/** Server field errors `answers.<i>.…` mapped back to the question id of answer i; the first message of a question wins. */
export function answerErrorsById(
  answers: readonly AnswerInput[],
  fieldErrors: Readonly<Record<string, string>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const match = /^answers\.(\d+)(?:\.|$)/.exec(key);
    if (!match) continue;
    const answer = answers[Number(match[1])];
    if (answer && errors[answer.questionId] === undefined) errors[answer.questionId] = message;
  }
  return errors;
}
