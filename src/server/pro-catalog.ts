"use server";

import {
  createOfferCore,
  createTicketTypeCore,
  deleteOfferCore,
  deleteTicketTypeCore,
  setOfferActiveCore,
  setTicketTypeArchivedCore,
  setTypeHoursCore,
  setTypeQuestionsCore,
  updateOfferCore,
  updateTicketTypeCore,
  type TicketTypePatch,
} from "@/lib/back-office/catalog-actions";
import type { ActionResult } from "@/lib/back-office/result";
import { db } from "@/lib/db";
import type { AvailabilityRuleInput, OfferInput, QuestionInput, TicketTypeInput } from "@/lib/tickets";
import { runProAction } from "@/server/pro-context";

/*
 * Thin wrappers of src/lib/back-office/catalog-actions.ts: session context,
 * core, revalidation of /dashboard and of the public page, effects after commit
 * (runProAction). Task 16 adds the events wrappers to this file.
 */

export async function createTicketTypeAction(input: TicketTypeInput): Promise<ActionResult<{ ticketTypeId: string }>> {
  return runProAction("createTicketType", (ctx, now) => createTicketTypeCore(db, ctx, input, now), { publicPage: true });
}

export async function updateTicketTypeAction(input: { ticketTypeId: string; patch: TicketTypePatch }): Promise<ActionResult> {
  return runProAction("updateTicketType", (ctx, now) => updateTicketTypeCore(db, ctx, input, now), { publicPage: true });
}

export async function setTicketTypeArchivedAction(input: { ticketTypeId: string; archived: boolean }): Promise<ActionResult> {
  return runProAction("setTicketTypeArchived", (ctx, now) => setTicketTypeArchivedCore(db, ctx, input, now), { publicPage: true });
}

export async function deleteTicketTypeAction(input: { ticketTypeId: string }): Promise<ActionResult<{ outcome: "deleted" | "archived" }>> {
  return runProAction("deleteTicketType", (ctx, now) => deleteTicketTypeCore(db, ctx, input, now), { publicPage: true });
}

export async function createOfferAction(input: OfferInput): Promise<ActionResult<{ offerId: string }>> {
  return runProAction("createOffer", (ctx, now) => createOfferCore(db, ctx, input, now), { publicPage: true });
}

export async function updateOfferAction(input: { offerId: string; offer: OfferInput }): Promise<ActionResult> {
  return runProAction("updateOffer", (ctx, now) => updateOfferCore(db, ctx, input, now), { publicPage: true });
}

export async function setOfferActiveAction(input: { offerId: string; isActive: boolean }): Promise<ActionResult> {
  return runProAction("setOfferActive", (ctx, now) => setOfferActiveCore(db, ctx, input, now), { publicPage: true });
}

export async function deleteOfferAction(input: { offerId: string }): Promise<ActionResult<{ outcome: "deleted" | "archived" }>> {
  return runProAction("deleteOffer", (ctx, now) => deleteOfferCore(db, ctx, input, now), { publicPage: true });
}

export async function setTypeHoursAction(input: { ticketTypeId: string; rules: AvailabilityRuleInput[] }): Promise<ActionResult> {
  return runProAction("setTypeHours", (ctx, now) => setTypeHoursCore(db, ctx, input, now), { publicPage: true });
}

export async function setTypeQuestionsAction(input: { ticketTypeId: string; questions: QuestionInput[] }): Promise<ActionResult> {
  return runProAction("setTypeQuestions", (ctx, now) => setTypeQuestionsCore(db, ctx, input, now), { publicPage: true });
}
