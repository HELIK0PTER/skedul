/**
 * The Boutique read (spec L616-619, L1443, E9): what a visitor can buy on `/[slug]`, by ticket type. Testable core:
 * takes `db`, imports neither server-only, next/* nor the db index. Every statement filters `professional_id` on the
 * offer AND on its type; the pro comes from the slug on the server, never from input.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { textArray, type Db } from "@/lib/db/atomic";
import { ticketOffer, ticketType } from "@/lib/db/schema";
import { offerLabel, validityLabel } from "@/lib/tickets-vocab";

export type BoutiqueOffer = {
  offerId: string;
  /** offerLabel(): the pro's label, « À l'unité » or « Carnet de N » */
  label: string;
  quantity: number;
  priceCents: number;
  /** validityLabel(): « 3 mois », « 30 jours »; null without validity */
  validityText: string | null;
};

export type BoutiqueType = {
  ticketTypeId: string;
  name: string;
  description: string | null;
  color: string;
  offers: BoutiqueOffer[];
  /** the titles of the public events that accept this type, in French alphabetical order */
  acceptedBy: string[];
};

const TITLE_COLLATOR = new Intl.Collator("fr", { sensitivity: "base" });

/**
 * « Utilisable pour »: per type, the distinct titles of the pro's public events that accept it. Same rule as the
 * pro's own « Accepté par » (catalog-reads): the latest non-archived segment of each series, in tickets mode (only a
 * tickets-mode event accepts tickets, a stale link on a free event does not count), and a private event is left out
 * of the public line (its title is not public). The privacy test is on the OUTER query: a series whose latest segment
 * is private does not fall back to an older public segment. Types with no such event are absent from the map.
 */
export async function acceptedByTitles(
  db: Db,
  professionalId: string,
  ticketTypeIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byType = new Map<string, string[]>();
  if (ticketTypeIds.length === 0) return byType;
  const res = await db.execute<{ ticket_type_id: string; title: string }>(sql`
    select l.ticket_type_id, e.title
    from (
      select distinct on (coalesce(series_root_id, id)) id, title, is_private, booking_mode
      from event
      where professional_id = ${professionalId} and archived_at is null
      order by coalesce(series_root_id, id), start_date desc, created_at desc, id desc
    ) e
    join event_ticket_type l on l.event_id = e.id
    where l.professional_id = ${professionalId} and e.booking_mode = 'tickets' and not e.is_private
      and l.ticket_type_id = any(${textArray(ticketTypeIds)})`);
  for (const r of res.rows) {
    const list = byType.get(r.ticket_type_id) ?? [];
    if (!list.includes(r.title)) list.push(r.title);
    byType.set(r.ticket_type_id, list);
  }
  for (const list of byType.values()) list.sort((a, b) => TITLE_COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  return byType;
}

/**
 * L616-619, L1443: non-archived, non-rdv_free types with at least one active non-archived offer; offers by position,
 * created_at, id; acceptedBy = distinct titles of non-private non-archived events linking the type (acceptedByTitles,
 * fr collation). Types by position, created_at, id.
 */
export async function listBoutique(db: Db, professionalId: string): Promise<BoutiqueType[]> {
  const rows = await db
    .select({
      ticketTypeId: ticketType.id,
      name: ticketType.name,
      description: ticketType.description,
      color: ticketType.color,
      offerId: ticketOffer.id,
      label: ticketOffer.label,
      quantity: ticketOffer.quantity,
      priceCents: ticketOffer.priceCents,
      validityCount: ticketOffer.validityCount,
      validityUnit: ticketOffer.validityUnit,
    })
    .from(ticketOffer)
    .innerJoin(ticketType, eq(ticketType.id, ticketOffer.ticketTypeId))
    .where(
      and(
        eq(ticketOffer.professionalId, professionalId),
        eq(ticketType.professionalId, professionalId),
        eq(ticketOffer.isActive, true),
        isNull(ticketOffer.archivedAt),
        isNull(ticketType.archivedAt),
        eq(ticketType.rdvFree, false),
      ),
    )
    .orderBy(
      asc(ticketType.position),
      asc(ticketType.createdAt),
      asc(ticketType.id),
      asc(ticketOffer.position),
      asc(ticketOffer.createdAt),
      asc(ticketOffer.id),
    );
  if (rows.length === 0) return [];

  const types = new Map<string, BoutiqueType>();
  for (const r of rows) {
    let type = types.get(r.ticketTypeId);
    if (!type) {
      type = { ticketTypeId: r.ticketTypeId, name: r.name, description: r.description, color: r.color, offers: [], acceptedBy: [] };
      types.set(r.ticketTypeId, type);
    }
    type.offers.push({
      offerId: r.offerId,
      label: offerLabel({ label: r.label, quantity: r.quantity }),
      quantity: r.quantity,
      priceCents: r.priceCents,
      validityText: validityLabel(r.validityCount, r.validityUnit),
    });
  }
  const accepted = await acceptedByTitles(db, professionalId, [...types.keys()]);
  for (const type of types.values()) type.acceptedBy = accepted.get(type.ticketTypeId) ?? [];
  return [...types.values()];
}
