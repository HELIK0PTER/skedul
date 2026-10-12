/**
 * ICS download of a booking. The old booking rows are gone; P3 rebuilds this
 * route on the occurrence (event title or RDV type, effective location).
 */
export async function GET() {
  return new Response("Not found", { status: 404 });
}
