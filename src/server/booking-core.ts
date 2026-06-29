import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  booking,
  bookingAnswer,
  customer,
  packPurchase,
  question,
} from "@/lib/db/schema";

export interface CustomerInput {
  name: string;
  email: string;
  phone?: string;
}

export async function getOrCreateCustomer(
  professionalId: string,
  input: CustomerInput,
) {
  const email = input.email.trim().toLowerCase();
  const existing = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.professionalId, professionalId),
        eq(customer.email, email),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].name !== input.name || input.phone) {
      await db
        .update(customer)
        .set({ name: input.name, phone: input.phone ?? existing[0].phone })
        .where(eq(customer.id, existing[0].id));
    }
    return existing[0];
  }
  const [created] = await db
    .insert(customer)
    .values({
      professionalId,
      name: input.name,
      email,
      phone: input.phone ?? null,
    })
    .returning();
  return created;
}

/** Validates required questions and returns rows to insert into booking_answer. */
export async function buildAnswers(
  eventTypeId: string,
  answers: { questionId: string; value: string }[] | undefined,
): Promise<
  | { ok: true; rows: { questionId: string; questionLabel: string; value: string }[] }
  | { ok: false; error: string }
> {
  const questions = await db
    .select({
      id: question.id,
      label: question.label,
      required: question.required,
    })
    .from(question)
    .where(eq(question.eventTypeId, eventTypeId));

  if (questions.length === 0) return { ok: true, rows: [] };

  const byId = new Map(answers?.map((a) => [a.questionId, a.value.trim()]));
  const rows: { questionId: string; questionLabel: string; value: string }[] = [];
  for (const q of questions) {
    const value = byId.get(q.id) ?? "";
    if (q.required && !value)
      return { ok: false, error: `Merci de répondre à : ${q.label}` };
    if (value) rows.push({ questionId: q.id, questionLabel: q.label, value });
  }
  return { ok: true, rows };
}

export async function insertAnswers(
  bookingId: string,
  rows: { questionId: string; questionLabel: string; value: string }[],
) {
  if (rows.length === 0) return;
  await db.insert(bookingAnswer).values(rows.map((r) => ({ bookingId, ...r })));
}

/** If the booking was paid with a pack credit, give the credit back (guarded). */
export async function restoreCreditFor(bookingId: string): Promise<void> {
  const rows = await db
    .select({
      packPurchaseId: booking.packPurchaseId,
      paymentType: booking.paymentType,
    })
    .from(booking)
    .where(eq(booking.id, bookingId))
    .limit(1);
  const b = rows[0];
  if (!b || b.paymentType !== "credit" || !b.packPurchaseId) return;
  await db
    .update(packPurchase)
    .set({ creditsRemaining: sql`${packPurchase.creditsRemaining} + 1` })
    .where(eq(packPurchase.id, b.packPurchaseId));
}
