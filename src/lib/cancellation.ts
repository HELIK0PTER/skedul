/**
 * Client cancellation rule (spec § 2.7, E5): the client cancels a confirmed
 * booking up to `deadline` hours before the start; when the pro changed the
 * occurrence's time after the booking, or moved the client, the client may
 * cancel until the start. Mirrors the EXISTS of cancelByClient
 * (src/lib/booking/cancel.ts). Hours are elapsed hours, like make_interval.
 */
export function clientCancelDeadline(startsAt: Date, deadlineHours: number): Date {
  return new Date(startsAt.getTime() - deadlineHours * 3_600_000);
}

export type ClientCancelCheck =
  | { allowed: true; reason: "before_deadline" | "changed_by_pro" }
  | { allowed: false; reason: "started" | "too_late" };

/** startsAt > now AND (startsAt − deadline > now OR occurrenceChangedAt > bookingCreatedAt OR movedAt set). Mirrors cancelByClient's EXISTS. */
export function clientCanCancel(args: {
  startsAt: Date;
  now: Date;
  deadlineHours: number;
  bookingCreatedAt: Date;
  occurrenceChangedAt: Date | null;
  movedAt: Date | null;
}): ClientCancelCheck {
  const now = args.now.getTime();
  if (args.startsAt.getTime() <= now) return { allowed: false, reason: "started" };
  if (clientCancelDeadline(args.startsAt, args.deadlineHours).getTime() > now) {
    return { allowed: true, reason: "before_deadline" };
  }
  const changedAfterBooking =
    args.occurrenceChangedAt !== null && args.occurrenceChangedAt.getTime() > args.bookingCreatedAt.getTime();
  if (changedAfterBooking || args.movedAt !== null) return { allowed: true, reason: "changed_by_pro" };
  return { allowed: false, reason: "too_late" };
}
