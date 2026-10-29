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
import {
  applyScheduleCore,
  createEventCore,
  deleteEventFromCore,
  deleteEventPreviewCore,
  editEventInfoCore,
  previewNewEventCore,
  previewScheduleCore,
  type SchedulePreview,
} from "@/lib/back-office/event-actions";
import type { DeletePreview, LaterSegment } from "@/lib/back-office/event-reads";
import type { ActionResult } from "@/lib/back-office/result";
import type { DateKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import type {
  AvailabilityRuleInput,
  EventInfoInput,
  EventInput,
  OfferInput,
  QuestionInput,
  RecurrenceRuleInput,
  TicketTypeInput,
} from "@/lib/tickets";
import { runProAction, runProQuery } from "@/server/pro-context";

/*
 * Thin wrappers of src/lib/back-office/catalog-actions.ts: session context,
 * core, revalidation of /dashboard and of the public page, effects after commit
 * (runProAction). The events wrappers (src/lib/back-office/event-actions.ts) follow
 * the catalog ones; the previews use runProQuery (no revalidation, no effect).
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

/* Events: create, edit the information, cut the schedule, delete from a date. */

export async function createEventAction(
  input: EventInput,
): Promise<ActionResult<{ eventId: string; occurrenceCount: number }>> {
  return runProAction("createEvent", (ctx, now) => createEventCore(db, ctx, input, now), { publicPage: true });
}

export async function editEventInfoAction(input: {
  eventId: string;
  seenVersion: number;
  info: EventInfoInput;
  /** The later segments of the series the page showed, each with its version (the guard of the segments the form does not own). */
  later?: LaterSegment[];
}): Promise<ActionResult<{ version: number; incomplete: string | null }>> {
  return runProAction("editEventInfo", (ctx, now) => editEventInfoCore(db, ctx, input, now), { publicPage: true });
}

export async function previewScheduleAction(input: {
  eventId: string;
  fromDate: DateKey;
  rule: RecurrenceRuleInput;
  durationMin: number;
}): Promise<ActionResult<{ preview: SchedulePreview }>> {
  return runProQuery("previewSchedule", (ctx, now) => previewScheduleCore(db, ctx, input, now));
}

export async function applyScheduleAction(input: {
  eventId: string;
  seenVersion: number;
  fromDate: DateKey;
  rule: RecurrenceRuleInput;
  durationMin: number;
  orphans: "keep" | "cancel";
}): Promise<ActionResult<{ eventId: string; summaryText: string }>> {
  return runProAction("applySchedule", (ctx, now) => applyScheduleCore(db, ctx, input, now), { publicPage: true });
}

export async function deleteEventPreviewAction(input: {
  eventId: string;
  fromDate: DateKey;
}): Promise<ActionResult<{ preview: DeletePreview }>> {
  return runProQuery("deleteEventPreview", (ctx, now) => deleteEventPreviewCore(db, ctx, input, now));
}

export async function deleteEventFromAction(input: {
  eventId: string;
  seenVersion: number;
  fromDate: DateKey;
  /** The later segments the preview listed, each with its version. */
  later?: LaterSegment[];
}): Promise<
  ActionResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number; incomplete: string | null }>
> {
  return runProAction("deleteEventFrom", (ctx, now) => deleteEventFromCore(db, ctx, input, now), { publicPage: true });
}

export async function previewNewEventAction(input: {
  rule: RecurrenceRuleInput;
  durationMin: number;
}): Promise<ActionResult<{ rdvConflicts: number; occurrenceCount: number }>> {
  return runProQuery("previewNewEvent", (ctx, now) => previewNewEventCore(db, ctx, input, now));
}
