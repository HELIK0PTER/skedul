import { buildBookingIcs, loadIcsFacts } from "@/lib/back-office/ics";
import { db } from "@/lib/db";

/** The file is personal: never shared-cached, never indexed. */
const PERSONAL_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * The only 404: an unknown or malformed id, a pending, cancelled or expired
 * booking and a cancelled séance all get this exact response (same body, same
 * headers), so nothing tells a booking that exists from one that does not.
 */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: PERSONAL_HEADERS });
}

/**
 * ICS download of a confirmed booking, rebuilt on the occurrence (event title
 * or RDV type, effective location). The booking id is the capability: the shape
 * check is inside `loadIcsFacts`, before its query. The file holds the event's
 * facts only, no customer data; the filename is a constant, no user text.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const facts = await loadIcsFacts(db, id);
  if (!facts) return notFound();

  return new Response(buildBookingIcs(facts), {
    status: 200,
    headers: {
      ...PERSONAL_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="seance.ics"',
    },
  });
}
