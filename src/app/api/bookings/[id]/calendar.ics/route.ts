import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, eventType, professional } from "@/lib/db/schema";
import { buildIcs } from "@/lib/calendar-links";

/**
 * Public ICS download for a booking. The booking id (unguessable) acts as
 * the capability token — same model as /merci?ref=. No customer data inside.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const rows = await db
    .select({
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      title: eventType.title,
      businessName: professional.businessName,
    })
    .from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .where(eq(booking.id, id))
    .limit(1);

  const b = rows[0];
  if (!b || b.status === "cancelled") {
    return new Response("Not found", { status: 404 });
  }

  const ics = buildIcs({
    uid: `${id}@skedul.app`,
    title: b.title,
    description: `Rendez-vous avec ${b.businessName}`,
    startAt: b.startAt,
    endAt: b.endAt,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="rendez-vous.ics"',
    },
  });
}
