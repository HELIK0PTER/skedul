/**
 * Read-only espace of one customer at one pro (spec § 12, Q22). P3 shows what
 * is booked and what is left in the wallet; P4 reuses this read and adds the
 * cancel and spend actions. No `server-only`, no env, no process db.
 *
 * Every statement filters `professional_id` AND `customer_id`: the id of the
 * customer comes from a link or a session, so it is only a claim until this
 * read has checked that the customer is this pro's.
 */
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { formatWhen, formatWhenShort } from "@/lib/back-office/format";
import { groupWallet, type WalletTicketRow, type WalletTypeRow } from "@/lib/back-office/wallet-view";
import { clientCanCancel, clientCancelDeadline } from "@/lib/cancellation";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, occurrence, professional, ticket, ticketType } from "@/lib/db/schema";
import { COVERAGE_LABELS } from "@/lib/tickets";

export type CustomerSpace = {
  customer: { id: string; name: string; email: string };
  upcoming: {
    bookingId: string;
    title: string;
    whenLabel: string;
    location: string | null;
    coverageLabel: string;
    cancelText: string | null;
  }[];
  wallet: { ticketTypeId: string; name: string; color: string; archived: boolean; usable: number; expiries: string[] }[];
};

/**
 * The online cancellation hint of one booking; null when the client can no longer cancel online (P4 turns it into a
 * button). A rendez-vous is called a rendez-vous, a séance a séance.
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
 * usable tickets by type with their expiries; null when the customer is not
 * this pro's. A pending booking (a seat hold, live or lapsed) is not a booking
 * yet, so only `confirmed` rows are read. Dates are formatted in the PRO's
 * time zone.
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
      cancelHours: professional.cancelDeadlineHours,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId)));
  if (!owner) return null;

  const [bookings, tickets] = await Promise.all([
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
        title: sql<string>`coalesce(${event.title}, ${ticketType.name})`,
        location: sql<string | null>`coalesce(${occurrence.locationOverride}, ${event.location})`,
        cancelHours: sql<number | null>`coalesce(${event.cancelDeadlineHours}, ${ticketType.rdvCancelDeadlineHours})`,
      })
      .from(booking)
      .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
      .leftJoin(event, eq(event.id, occurrence.eventId))
      .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
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
  ]);

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
    customer: { id: owner.id, name: owner.name, email: owner.email },
    upcoming: bookings.map((b) => ({
      bookingId: b.bookingId,
      title: b.title,
      whenLabel: formatWhen(b.startsAt, b.endsAt, owner.tz),
      location: b.location && b.location.trim() !== "" ? b.location : null,
      coverageLabel: COVERAGE_LABELS[b.coverage],
      cancelText: cancelTextOf(b, b.cancelHours ?? owner.cancelHours, now, owner.tz, b.eventId === null ? "rdv" : "seance"),
    })),
    wallet: groupWallet(walletRows, types, new Map(), now, owner.tz).map((g) => ({
      ticketTypeId: g.ticketTypeId,
      name: g.name,
      color: g.color,
      archived: g.archived,
      usable: g.usableCount,
      expiries: g.expirySummary,
    })),
  };
}
