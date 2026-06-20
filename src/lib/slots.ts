import "server-only";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { availabilityRule, booking, timeOff } from "@/lib/db/schema";
import { computeSlots, type Slot } from "@/lib/availability";

interface EventTypeLike {
  id: string;
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

  const [allRules, busyBookings, busyTimeOff] = await Promise.all([
    db
      .select({
        eventTypeId: availabilityRule.eventTypeId,
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(
        and(
          eq(availabilityRule.professionalId, professionalId),
          or(
            isNull(availabilityRule.eventTypeId),
            eq(availabilityRule.eventTypeId, evt.id),
          ),
        ),
      ),
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
    db
      .select({ startAt: timeOff.startAt, endAt: timeOff.endAt })
      .from(timeOff)
      .where(
        and(eq(timeOff.professionalId, professionalId), gte(timeOff.endAt, now)),
      ),
  ]);

  // Full replacement: if the event type has its own rules, ignore the global ones.
  const custom = allRules.filter((r) => r.eventTypeId === evt.id);
  const rules =
    custom.length > 0 ? custom : allRules.filter((r) => r.eventTypeId === null);

  return computeSlots({
    rules,
    busy: [...busyBookings, ...busyTimeOff],
    sessions: [],
    eventTypeId: evt.id,
    defaultCapacity: 1,
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
