/**
 * The public RDV libre reads (spec L1445, L1519, L1615; P5 dossier § 3.2, § 3.11, § 3.13). Testable core: takes `db`,
 * imports neither server-only, next/* nor the db index. The pro comes from the slug on the server, and every statement
 * filters `professional_id` on each row it reads (type, offer, rule, ticket). The type facts come from the engine's own
 * reader (`loadRdvType`) and the 404 and « never bookable » rules from the slot loader (slots.ts), so the page, the
 * cards, the loader and `bookRdv` never disagree on which type is bookable.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { effectiveWindow, type BookingWindow } from "@/lib/booking-window";
import { loadQuestions, type QuestionRow } from "@/lib/booking/answers";
import { loadRdvType, rdvRules } from "@/lib/booking/claims";
import type { Db } from "@/lib/db/atomic";
import { professional, ticket, ticketOffer, ticketType } from "@/lib/db/schema";
import { isBookableRdvType, rdvNeverBookable } from "@/lib/slots";
import { ticketExpiry, validityOf } from "@/lib/ticket-expiry";
import { idSchema, offerLabel, validityLabel } from "@/lib/tickets";

import type { PublicPro } from "./context";

export type PublicRdvOffer = {
  offerId: string;
  /** offerLabel(): the pro's label, « À l'unité » or « Carnet de N » */
  label: string;
  quantity: number;
  priceCents: number;
  /** validityLabel(): « 3 mois », « 30 jours »; null without validity */
  validityText: string | null;
  /**
   * ISO: the first instant the tickets it sells today would no longer be valid (`ticketExpiry(now, validity, tz)`),
   * null without validity. It covers a start when null or later than the start (`offerCovers`, the engine's plan).
   */
  coversUntil: string | null;
};

export type PublicRdvType = {
  ticketTypeId: string;
  name: string;
  description: string | null;
  durationMin: number;
  /** rdv_free: the free mode, never a 404 */
  isFree: boolean;
  /** its own weekly hours, else the pro's: any rule at all */
  hasHours: boolean;
  /** no hours, or a notice above the horizon (O14) */
  neverBookable: boolean;
  /** the effective window (the type's overrides, else the pro's): the page's default week and its navigation */
  window: BookingWindow;
  /** active, non-archived offers of THIS type, by position; none for a free type */
  offers: PublicRdvOffer[];
  /** loadQuestions({ ticketTypeId }) */
  questions: QuestionRow[];
};

/**
 * The RDV type `ticketTypeId` of this pro as its public page shows it, or null (then the page answers notFound()):
 * a malformed id (checked before any read), unknown, another pro's, archived, not RDV-enabled or without a duration.
 */
export async function getPublicRdvType(
  db: Db,
  pro: Pick<PublicPro, "professionalId">,
  ticketTypeId: string,
  now: Date,
): Promise<PublicRdvType | null> {
  if (!idSchema.safeParse(ticketTypeId).success) return null;
  const { professionalId } = pro;
  const [type, rules] = await Promise.all([
    loadRdvType(db, professionalId, ticketTypeId),
    rdvRules(db, professionalId, ticketTypeId),
  ]);
  if (!isBookableRdvType(type)) return null;

  const [[row], offers, questions] = await Promise.all([
    db
      .select({ name: ticketType.name, description: ticketType.description })
      .from(ticketType)
      .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId))),
    type.rdvFree
      ? Promise.resolve([])
      : db
          .select({
            offerId: ticketOffer.id,
            label: ticketOffer.label,
            quantity: ticketOffer.quantity,
            priceCents: ticketOffer.priceCents,
            validityCount: ticketOffer.validityCount,
            validityUnit: ticketOffer.validityUnit,
          })
          .from(ticketOffer)
          .where(
            and(
              eq(ticketOffer.ticketTypeId, ticketTypeId),
              eq(ticketOffer.professionalId, professionalId),
              eq(ticketOffer.isActive, true),
              isNull(ticketOffer.archivedAt),
            ),
          )
          .orderBy(asc(ticketOffer.position), asc(ticketOffer.createdAt), asc(ticketOffer.id)),
    loadQuestions(db, { ticketTypeId }),
  ]);
  if (!row) return null;

  const hasHours = rules.length > 0;
  return {
    ticketTypeId,
    name: row.name,
    description: row.description,
    durationMin: type.durationMin,
    isFree: type.rdvFree,
    hasHours,
    neverBookable: rdvNeverBookable(type.window, hasHours),
    window: type.window,
    offers: offers.map((o) => ({
      offerId: o.offerId,
      label: offerLabel({ label: o.label, quantity: o.quantity }),
      quantity: o.quantity,
      priceCents: o.priceCents,
      validityText: validityLabel(o.validityCount, o.validityUnit),
      coversUntil: ticketExpiry(now, validityOf(o), type.tz)?.toISOString() ?? null,
    })),
    questions,
  };
}

export type RdvCard = {
  ticketTypeId: string;
  name: string;
  description: string | null;
  durationMin: number;
  isFree: boolean;
  /** the lowest price of its active, non-archived offers (« À partir de »); null for a free type or with none on sale */
  fromPriceCents: number | null;
};

/**
 * The RDV cards of `/[slug]` (§ 3.11, O8): the bookable RDV types of this pro (enabled, not archived, with a duration),
 * ordered like the Boutique (position, created_at, id). A type with no hours at all, or whose notice is above its
 * horizon, is left out (it would never offer a slot). One statement; no slot is computed here.
 */
export async function listRdvCards(db: Db, professionalId: string): Promise<RdvCard[]> {
  const rows = await db
    .select({
      ticketTypeId: ticketType.id,
      name: ticketType.name,
      description: ticketType.description,
      durationMin: ticketType.rdvDurationMin,
      isFree: ticketType.rdvFree,
      typeHorizonDays: ticketType.rdvBookingHorizonDays,
      typeNoticeMinutes: ticketType.rdvMinNoticeMinutes,
      typeCancelHours: ticketType.rdvCancelDeadlineHours,
      bookingHorizonDays: professional.bookingHorizonDays,
      minNoticeMinutes: professional.minNoticeMinutes,
      cancelDeadlineHours: professional.cancelDeadlineHours,
      // its own rules replace the global ones, so « any own rule or any global rule » is rdvRules(...).length > 0
      hasHours: sql<boolean>`exists (select 1 from availability_rule r
        where r.professional_id = ${professionalId} and (r.ticket_type_id = ${ticketType.id} or r.ticket_type_id is null))`,
      fromPriceCents: sql<number | null>`(select min(f.price_cents)::int from ticket_offer f
        where f.ticket_type_id = ${ticketType.id} and f.professional_id = ${professionalId}
          and f.is_active and f.archived_at is null)`,
    })
    .from(ticketType)
    .innerJoin(professional, eq(professional.id, ticketType.professionalId))
    .where(
      and(
        eq(ticketType.professionalId, professionalId),
        eq(ticketType.rdvEnabled, true),
        isNull(ticketType.archivedAt),
        isNotNull(ticketType.rdvDurationMin),
      ),
    )
    .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id));

  return rows.flatMap((r) => {
    if (r.durationMin === null) return [];
    const window = effectiveWindow(
      {
        bookingHorizonDays: r.bookingHorizonDays,
        minNoticeMinutes: r.minNoticeMinutes,
        cancelDeadlineHours: r.cancelDeadlineHours,
      },
      { bookingHorizonDays: r.typeHorizonDays, minNoticeMinutes: r.typeNoticeMinutes, cancelDeadlineHours: r.typeCancelHours },
    );
    if (rdvNeverBookable(window, r.hasHours)) return [];
    return [
      {
        ticketTypeId: r.ticketTypeId,
        name: r.name,
        description: r.description,
        durationMin: r.durationMin,
        isFree: r.isFree,
        fromPriceCents: r.isFree ? null : r.fromPriceCents,
      },
    ];
  });
}

/**
 * The tickets the Owner could spend on an RDV of THIS type (the RDV clause of ELIGIBLE, eligibility.ts): hers, at
 * this pro, of this type, `available`, the type RDV-enabled, paid (not `rdv_free`) and not archived, in consumption
 * order (soonest expiry first, then created_at, id). Only the expiry leaves: `canSpendAt` (rdv-view.ts) compares it
 * with the chosen start, as ELIGIBLE does with `expires_at > starts_at`. For the Owner's customer only, never a
 * typed e-mail's (Decisions 63, 71): the caller passes `owner.customerId`.
 */
export async function rdvOwnerTickets(
  db: Db,
  professionalId: string,
  customerId: string,
  ticketTypeId: string,
): Promise<{ expiresAt: string | null }[]> {
  const rows = await db
    .select({ expiresAt: ticket.expiresAt })
    .from(ticket)
    .innerJoin(ticketType, and(eq(ticketType.id, ticket.ticketTypeId), eq(ticketType.professionalId, professionalId)))
    .where(
      and(
        eq(ticket.professionalId, professionalId),
        eq(ticket.customerId, customerId),
        eq(ticket.ticketTypeId, ticketTypeId),
        eq(ticket.status, "available"),
        eq(ticketType.rdvEnabled, true),
        eq(ticketType.rdvFree, false),
        isNull(ticketType.archivedAt),
      ),
    )
    .orderBy(sql`${ticket.expiresAt} asc nulls last`, asc(ticket.createdAt), asc(ticket.id));
  return rows.map((r) => ({ expiresAt: r.expiresAt?.toISOString() ?? null }));
}
