/**
 * Espace of one customer at one pro (spec § 12, Q22): what is booked, whether it can still be cancelled online, and
 * what is left in the wallet. P3 showed it read-only; P4 adds the cancel and spend actions on top of this read. No
 * `server-only`, no env, no process db.
 *
 * Every statement filters `professional_id` AND `customer_id`: the id of the customer comes from a link or a
 * session, so it is only a claim until this read has checked that the customer is this pro's. Every join filters
 * `professional_id` too (the event and the type of a booking included, pinned by a crossed-row test).
 */
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { formatWhen, formatWhenShort } from "@/lib/back-office/format";
import { groupWallet, type WalletTicketRow, type WalletTypeRow } from "@/lib/back-office/wallet-view";
import { loadTypeFacts } from "@/lib/booking/wallet";
import { clientCanCancel, clientCancelDeadline } from "@/lib/cancellation";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, occurrence, professional, ticket, ticketType } from "@/lib/db/schema";
import { cancelLockedText } from "@/lib/public/messages";
import { coverageLabelOf, type BookingCoverage } from "@/lib/tickets";
import { classifyTypes, type TypeClass } from "@/lib/wallet-rules";

export type CustomerSpace = {
  /** the pro's business name: the locked cancellation sentence and the archived-type note name it */
  businessName: string;
  customer: { id: string; name: string; email: string };
  upcoming: {
    bookingId: string;
    title: string;
    whenLabel: string;
    location: string | null;
    coverage: BookingCoverage;
    coverageLabel: string;
    /** cancelTextOf(…) !== null: clientCanCancel allows it now (before the deadline, or after a pro change or a move) */
    cancellable: boolean;
    /** cancelTextOf(…) when cancellable (its séance or rendez-vous wording kept), else « Seul(e) {pro} peut annuler maintenant. » (L921) */
    cancelText: string;
  }[];
  wallet: {
    ticketTypeId: string;
    name: string;
    color: string;
    archived: boolean;
    /** orphan = no upcoming event accepts the type and it is not a paid RDV type; archived; else ok (the rules of the client list alerts) */
    typeClass: TypeClass;
    usable: number;
    expiries: string[];
  }[];
};

/**
 * The online cancellation hint of one booking; null when the client can no longer cancel online (getCustomerSpace then
 * gives the locked sentence). A rendez-vous is called a rendez-vous, a séance a séance.
 */
export function cancelTextOf(
  b: { startsAt: Date; bookingCreatedAt: Date; changedAt: Date | null; movedAt: Date | null },
  deadlineHours: number,
  now: Date,
  tz: string,
  kind: "seance" | "rdv",
): string | null {
  const check = clientCanCancel({
    startsAt: b.startsAt,
    now,
    deadlineHours,
    bookingCreatedAt: b.bookingCreatedAt,
    occurrenceChangedAt: b.changedAt,
    movedAt: b.movedAt,
  });
  if (!check.allowed) return null;
  if (check.reason === "before_deadline") {
    return `Annulation en ligne possible jusqu'au ${formatWhenShort(clientCancelDeadline(b.startsAt, deadlineHours), tz)}.`;
  }
  return `Annulation en ligne possible jusqu'au début ${kind === "rdv" ? "du rendez-vous" : "de la séance"}.`;
}

/**
 * Confirmed bookings on scheduled future occurrences (soonest first) and the
 * usable tickets by type with their expiries and type class; null when the
 * customer is not this pro's. A pending booking (a seat hold, live or lapsed) is
 * not a booking yet, so only `confirmed` rows are read. Dates are formatted in
 * the PRO's time zone.
 */
export async function getCustomerSpace(
  db: Db,
  professionalId: string,
  customerId: string,
  now: Date,
): Promise<CustomerSpace | null> {
  const [owner] = await db
    .select({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      tz: professional.timezone,
      businessName: professional.businessName,
      cancelHours: professional.cancelDeadlineHours,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId)));
  if (!owner) return null;

  const [bookings, tickets, typeFacts] = await Promise.all([
    db
      .select({
        bookingId: booking.id,
        coverage: booking.coverage,
        bookingCreatedAt: booking.createdAt,
        movedAt: booking.movedAt,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        changedAt: occurrence.changedAt,
        eventId: occurrence.eventId,
        title: sql<string | null>`coalesce(${event.title}, ${ticketType.name})`,
        location: sql<string | null>`coalesce(${occurrence.locationOverride}, ${event.location})`,
        cancelHours: sql<number | null>`coalesce(${event.cancelDeadlineHours}, ${ticketType.rdvCancelDeadlineHours})`,
      })
      .from(booking)
      .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
      // The pro's predicate sits in the join conditions, not the where: an event or a type of another pro (a crossed row,
      // every domain foreign key being single-column) blanks its own columns but never drops the client's booking, which
      // stays listed under the generic label, with this pro's own deadline (ID-2).
      .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, professionalId)))
      .leftJoin(ticketType, and(eq(ticketType.id, occurrence.ticketTypeId), eq(ticketType.professionalId, professionalId)))
      .where(
        and(
          eq(booking.professionalId, professionalId),
          eq(booking.customerId, customerId),
          eq(booking.status, "confirmed"),
          eq(occurrence.professionalId, professionalId),
          eq(occurrence.status, "scheduled"),
          gt(occurrence.startsAt, now),
        ),
      )
      .orderBy(asc(occurrence.startsAt), asc(booking.id)),
    db
      .select({
        id: ticket.id,
        ticketTypeId: ticket.ticketTypeId,
        status: ticket.status,
        expiresAt: ticket.expiresAt,
        purchaseId: ticket.purchaseId,
        closedReason: ticket.closedReason,
        closedNote: ticket.closedNote,
        statusChangedAt: ticket.statusChangedAt,
        createdAt: ticket.createdAt,
      })
      .from(ticket)
      .where(
        and(
          eq(ticket.professionalId, professionalId),
          eq(ticket.customerId, customerId),
          eq(ticket.status, "available"),
          or(isNull(ticket.expiresAt), gt(ticket.expiresAt, now)),
        ),
      ),
    // The same type facts as the client list alerts (an rdv_free type is not RDV-enabled there): no second rule.
    loadTypeFacts(db, professionalId, now),
  ]);
  const classes = classifyTypes(typeFacts);

  const typeIds = [...new Set(tickets.map((t) => t.ticketTypeId))];
  const typeRows =
    typeIds.length === 0
      ? []
      : await db
          .select({ id: ticketType.id, name: ticketType.name, color: ticketType.color, archivedAt: ticketType.archivedAt })
          .from(ticketType)
          .where(and(eq(ticketType.professionalId, professionalId), inArray(ticketType.id, typeIds)))
          .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id));
  // Archived types are passed too: a client still holds their tickets (flagged "archived").
  const types: WalletTypeRow[] = typeRows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    archived: t.archivedAt !== null,
  }));
  const walletRows: WalletTicketRow[] = tickets.map((t) => ({ ...t, bookingStartsAt: null }));

  return {
    businessName: owner.businessName,
    customer: { id: owner.id, name: owner.name, email: owner.email },
    upcoming: bookings.map((b) => {
      const kind = b.eventId === null ? "rdv" : "seance";
      const hint = cancelTextOf(b, b.cancelHours ?? owner.cancelHours, now, owner.tz, kind);
      return {
        bookingId: b.bookingId,
        title: b.title ?? (kind === "rdv" ? "Rendez-vous" : "Séance"),
        whenLabel: formatWhen(b.startsAt, b.endsAt, owner.tz),
        location: b.location && b.location.trim() !== "" ? b.location : null,
        coverage: b.coverage,
        coverageLabel: coverageLabelOf(b.coverage, kind === "rdv"),
        cancellable: hint !== null,
        cancelText: hint ?? cancelLockedText(owner.businessName),
      };
    }),
    wallet: groupWallet(walletRows, types, classes, now, owner.tz).map((g) => ({
      ticketTypeId: g.ticketTypeId,
      name: g.name,
      color: g.color,
      archived: g.archived,
      typeClass: classes.get(g.ticketTypeId) ?? (g.archived ? "archived" : "ok"),
      usable: g.usableCount,
      expiries: g.expirySummary,
    })),
  };
}
