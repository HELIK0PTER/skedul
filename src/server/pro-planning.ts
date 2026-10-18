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
  type OccurrenceEditInput,
} from "@/lib/back-office/planning-actions";
import type { ActionResult } from "@/lib/back-office/result";
import type { DateKey } from "@/lib/civil-date";
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
