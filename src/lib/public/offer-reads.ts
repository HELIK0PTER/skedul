/**
 * The offer page read (spec L1458-1459, E9). Testable core: takes `db`, imports neither server-only, next/* nor the db
 * index. The pro comes from the slug on the server; the offer id comes from the URL, so it is checked as an id and
 * against the pro before anything is returned.
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import { ticketOffer, ticketType } from "@/lib/db/schema";
import { idSchema, offerLabel, validityLabel } from "@/lib/tickets";

import { acceptedByTitles } from "./boutique-reads";

export type PublicOfferDetail =
  | {
      kind: "on_sale";
      offerId: string;
      ticketTypeId: string;
      ticketTypeName: string;
      typeDescription: string | null;
      color: string;
      label: string;
      quantity: number;
      priceCents: number;
      validityText: string | null;
      acceptedBy: string[];
    }
  | { kind: "unavailable" };

/**
 * L1458-1459: an active offer of a non-archived, non-rdv_free type -> on_sale; inactive, archived or of an archived
 * (or free) type -> unavailable, with nothing of the offer; another pro's, unknown or not an id -> null.
 */
export async function getPublicOffer(db: Db, professionalId: string, offerId: string): Promise<PublicOfferDetail | null> {
  if (!idSchema.safeParse(offerId).success) return null;
  const [row] = await db
    .select({
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      typeDescription: ticketType.description,
      color: ticketType.color,
      typeArchivedAt: ticketType.archivedAt,
      rdvFree: ticketType.rdvFree,
      label: ticketOffer.label,
      quantity: ticketOffer.quantity,
      priceCents: ticketOffer.priceCents,
      validityCount: ticketOffer.validityCount,
      validityUnit: ticketOffer.validityUnit,
      isActive: ticketOffer.isActive,
      archivedAt: ticketOffer.archivedAt,
    })
    .from(ticketOffer)
    .innerJoin(ticketType, eq(ticketType.id, ticketOffer.ticketTypeId))
    .where(
      and(
        eq(ticketOffer.id, offerId),
        eq(ticketOffer.professionalId, professionalId),
        eq(ticketType.professionalId, professionalId),
      ),
    );
  if (!row) return null;
  if (!row.isActive || row.archivedAt !== null || row.typeArchivedAt !== null || row.rdvFree) {
    return { kind: "unavailable" };
  }
  const accepted = await acceptedByTitles(db, professionalId, [row.ticketTypeId]);
  return {
    kind: "on_sale",
    offerId,
    ticketTypeId: row.ticketTypeId,
    ticketTypeName: row.ticketTypeName,
    typeDescription: row.typeDescription,
    color: row.color,
    label: offerLabel({ label: row.label, quantity: row.quantity }),
    quantity: row.quantity,
    priceCents: row.priceCents,
    validityText: validityLabel(row.validityCount, row.validityUnit),
    acceptedBy: accepted.get(row.ticketTypeId) ?? [],
  };
}
