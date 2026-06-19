import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { availabilityRule, booking } from "@/lib/db/schema";
import { computeSlots, type Slot } from "@/lib/availability";

interface EventTypeLike {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** Loads the bookable slots for a professional + event type over the next weeks. */
export async function loadBookableSlots(
  professionalId: string,
  timezone: string,
  evt: EventTypeLike,
  daysAhead = 21,
): Promise<Slot[]> {
  const now = new Date();

  const [rules, busy] = await Promise.all([
    db
      .select({
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(eq(availabilityRule.professionalId, professionalId)),
    db
      .select({ startAt: booking.startAt, endAt: booking.endAt })
      .from(booking)
      .where(
        and(
          eq(booking.professionalId, professionalId),
          gte(booking.startAt, now),
          inArray(booking.status, ["pending", "confirmed"]),
        ),
      ),
  ]);

  return computeSlots({
    rules,
    busy,
    durationMinutes: evt.durationMinutes,
    bufferBeforeMinutes: evt.bufferBeforeMinutes,
    bufferAfterMinutes: evt.bufferAfterMinutes,
    timezone,
    daysAhead,
    now,
  });
}

/** Returns true if `startISO` is a currently bookable slot. */
export async function isSlotAvailable(
  professionalId: string,
  timezone: string,
  evt: EventTypeLike,
  startISO: string,
): Promise<boolean> {
  const slots = await loadBookableSlots(professionalId, timezone, evt);
  const target = new Date(startISO).getTime();
  return slots.some((s) => s.start.getTime() === target);
}
