/**
 * Facts of the calendar file (ICS) of one booking (spec Q34). The unguessable
 * booking id is the capability, as before the tickets redesign: the mail's
 * download button carries it. No `server-only`, no env, no process db.
 *
 * The file carries the event's facts only (title, place, instants, business
 * name, uid): never the customer's name, e-mail, phone, notes or answers.
 */
import { and, eq, sql } from "drizzle-orm";

import { buildIcs } from "@/lib/calendar-links";
import type { Db } from "@/lib/db/atomic";
import { booking, event, occurrence, professional, ticketType } from "@/lib/db/schema";
import { idSchema } from "@/lib/tickets";

export type IcsFacts = {
  bookingId: string;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
  businessName: string;
};

/**
 * The project's id schema (1 to 64 chars) narrowed to the nanoid and uuid
 * alphabet, so a malformed id (control character, NUL, space, slash) is
 * refused before any query instead of reaching Postgres.
 */
const bookingIdSchema = idSchema.regex(/^[A-Za-z0-9_-]+$/);

/**
 * A confirmed booking on a scheduled occurrence: title = event title or RDV
 * type name, location = coalesce(location_override, event.location) (an empty
 * string counts as none). Null for a malformed or unknown id, a pending,
 * cancelled or expired booking and a cancelled occurrence: all the same answer,
 * so nothing tells « exists but has no file » from « does not exist ».
 */
export async function loadIcsFacts(db: Db, bookingId: string): Promise<IcsFacts | null> {
  if (!bookingIdSchema.safeParse(bookingId).success) return null;
  const [row] = await db
    .select({
      bookingId: booking.id,
      title: sql<string>`coalesce(${event.title}, ${ticketType.name})`,
      location: sql<string | null>`coalesce(${occurrence.locationOverride}, ${event.location})`,
      startAt: occurrence.startsAt,
      endAt: occurrence.endsAt,
      businessName: professional.businessName,
    })
    .from(booking)
    // The séance is joined through the booking's own pro (no composite FK enforces it): a booking pointing
    // at another pro's séance gives no file, so it never leaks that séance's title, place and hours.
    .innerJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, booking.professionalId)))
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .where(and(eq(booking.id, bookingId), eq(booking.status, "confirmed"), eq(occurrence.status, "scheduled")));
  if (!row) return null;
  return { ...row, location: row.location && row.location.trim() !== "" ? row.location : null };
}

/**
 * The file body. The uid is per booking (`<id>@skedul.app`), so downloading it
 * again updates the same calendar entry; the texts are escaped by `buildIcs`
 * (CR, LF, commas, semicolons, backslashes), so no value can add a line.
 */
export function buildBookingIcs(facts: IcsFacts): string {
  return buildIcs({
    uid: `${facts.bookingId}@skedul.app`,
    title: facts.title,
    description: `Avec ${facts.businessName}`,
    location: facts.location,
    startAt: facts.startAt,
    endAt: facts.endAt,
  });
}
