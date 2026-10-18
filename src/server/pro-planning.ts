"use server";

import {
  applyFollowingCore,
  cancelOccurrenceCore,
  expiringBeforeCore,
  previewFollowingCore,
  restoreOccurrenceCore,
  unenrollCore,
  updateCapacityCore,
  updateOccurrenceCore,
  moveAttendeeCore,
  moveTargetsCore,
  registerAttendeeCore,
  registerOptionsCore,
  searchCustomersCore,
  type MoveTargetVM,
  type OccurrenceEditInput,
  type RegisterInput,
} from "@/lib/back-office/planning-actions";
import type { CustomerHit } from "@/lib/back-office/planning-reads";
import type { ActionResult } from "@/lib/back-office/result";
import type { DateKey } from "@/lib/civil-date";
import type { BookingCoverage, BookingMode } from "@/lib/tickets-vocab";
import { db } from "@/lib/db";
import { runProAction, runProQuery } from "@/server/pro-context";

/*
 * Thin wrappers of src/lib/back-office/planning-actions.ts: session context,
 * core, revalidation of /dashboard and of the public page, effects after commit
 * (runProAction). The two previews use runProQuery (no revalidation, no effect).
 */

/* ───────────────────────── Séance ───────────────────────── */

export async function updateOccurrenceAction(input: OccurrenceEditInput): Promise<ActionResult<{ timeChanged: boolean }>> {
  return runProAction("updateOccurrence", (ctx, now) => updateOccurrenceCore(db, ctx, input, now), { publicPage: true });
}

export async function expiringBeforeAction(input: {
  occurrenceId: string;
  date: DateKey;
  startMinute: number;
}): Promise<ActionResult<{ bookings: { bookingId: string; customerName: string; expiryText: string }[] }>> {
  return runProQuery("expiringBefore", (ctx, now) => expiringBeforeCore(db, ctx, input, now));
}

export async function updateCapacityAction(input: {
  occurrenceId: string;
  seenStartsAt: string;
  scope: "occurrence" | "event";
  capacity: number;
  seenVersion: number | null;
}): Promise<ActionResult> {
  return runProAction("updateCapacity", (ctx, now) => updateCapacityCore(db, ctx, input, now), { publicPage: true });
}

export async function cancelOccurrenceAction(input: {
  occurrenceId: string;
}): Promise<ActionResult<{ bookingsCancelled: number; ticketsReturned: number }>> {
  return runProAction("cancelOccurrence", (ctx, now) => cancelOccurrenceCore(db, ctx, input, now), { publicPage: true });
}

export async function restoreOccurrenceAction(input: { occurrenceId: string }): Promise<ActionResult> {
  return runProAction("restoreOccurrence", (ctx, now) => restoreOccurrenceCore(db, ctx, input, now), { publicPage: true });
}

export async function unenrollAction(input: {
  occurrenceId: string;
  bookingIds: string[];
  reason: string | null;
}): Promise<ActionResult<{ cancelled: number; ticketsReturned: number }>> {
  return runProAction("unenroll", (ctx, now) => unenrollCore(db, ctx, input, now), { publicPage: true });
}

/* ───────────────────────── Attendees ───────────────────────── */

export async function registerAttendeeAction(
  input: RegisterInput,
): Promise<ActionResult<{ bookingId: string; customerId: string; coverage: BookingCoverage; customerCreated: boolean }>> {
  return runProAction("registerAttendee", (ctx, now) => registerAttendeeCore(db, ctx, input, now), { publicPage: true });
}

export async function moveAttendeeAction(input: {
  bookingId: string;
  targetOccurrenceId: string;
  force: boolean;
  convertToTicketTypeId: string | null;
}): Promise<ActionResult<{ converted: boolean }>> {
  return runProAction("moveAttendee", (ctx, now) => moveAttendeeCore(db, ctx, input, now), { publicPage: true });
}

export async function searchCustomersAction(input: { q: string }): Promise<ActionResult<{ customers: CustomerHit[] }>> {
  return runProQuery("searchCustomers", (ctx, now) => searchCustomersCore(db, ctx, input, now));
}

export async function registerOptionsAction(input: {
  occurrenceId: string;
  customerId: string;
}): Promise<ActionResult<{ mode: BookingMode; alreadyBooked: boolean; usable: { id: string; label: string }[] }>> {
  return runProQuery("registerOptions", (ctx, now) => registerOptionsCore(db, ctx, input, now));
}

export async function moveTargetsAction(input: {
  bookingId: string;
  seriesRootId: string | null;
}): Promise<ActionResult<{ series: { seriesRootId: string; title: string }[]; targets: MoveTargetVM[] }>> {
  return runProQuery("moveTargets", (ctx, now) => moveTargetsCore(db, ctx, input, now));
}

/* ───────────────────────── « Cette séance et les suivantes » ───────────────────────── */

export async function previewFollowingAction(input: {
  occurrenceId: string;
  startMinute: number;
  durationMin: number;
}): Promise<ActionResult<{ text: string; fromDate: DateKey }>> {
  return runProQuery("previewFollowing", (ctx, now) => previewFollowingCore(db, ctx, input, now));
}

export async function applyFollowingAction(input: {
  occurrenceId: string;
  seenVersion: number;
  startMinute: number;
  durationMin: number;
}): Promise<ActionResult<{ eventId: string; summaryText: string }>> {
  return runProAction("applyFollowing", (ctx, now) => applyFollowingCore(db, ctx, input, now), { publicPage: true });
}
