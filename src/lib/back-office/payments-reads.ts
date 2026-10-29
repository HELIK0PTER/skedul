import { and, count, desc, eq, gte, inArray } from "drizzle-orm";

import { revenueByCurrency } from "@/lib/booking/revenue";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, occurrence, ticket, ticketPurchase, ticketType } from "@/lib/db/schema";
import { isLapsedHold } from "@/lib/hold-rule";
import { TICKET_CLOSE_REASONS, type BookingStatus, type TicketCloseReason } from "@/lib/tickets-vocab";

export const PAYMENTS_PERIODS = ["tout", "30j"] as const;
export type PaymentsPeriod = (typeof PAYMENTS_PERIODS)[number];

/** ?periode= value; unknown (or repeated, so an array) becomes "tout". */
export function parsePaymentsPeriod(value: unknown): PaymentsPeriod {
  return (PAYMENTS_PERIODS as readonly unknown[]).includes(value) ? (value as PaymentsPeriod) : "tout";
}

export type PaymentRow = {
  purchaseId: string;
  paidAt: Date;
  customerId: string;
  customerName: string;
  customerEmail: string;
  label: string;
  quantity: number;
  amountCents: number;
  currency: string;
  livemode: boolean;
  /** booking.purchase_id = purchase.id (buy + book). */
  booking: { occurrenceId: string; title: string; startsAt: Date; status: BookingStatus } | null;
  /** Closed tickets of the purchase, grouped by reason and note. */
  closedNotes: { reason: TicketCloseReason; note: string | null; count: number }[];
};

/** Rows read at most: the totals always cover the whole period. */
export const PAYMENTS_LIMIT = 200;
const DAY_MS = 86_400_000;

function reasonRank(reason: TicketCloseReason): number {
  return TICKET_CLOSE_REASONS.indexOf(reason);
}

/**
 * The status a pro should read: a pending booking whose hold has ended is
 * « expired » even before the sweep ends it (isLapsedHold, the one rule of
 * hold-rule.ts that the engine applies too; its seat is already free).
 */
function liveBookingStatus(status: BookingStatus, holdExpiresAt: Date | null, now: Date): BookingStatus {
  return isLapsedHold({ status, holdExpiresAt }, now) ? "expired" : status;
}

/**
 * Paid purchases (live and test: the UI shows « Test ») by paid_at desc, at
 * most PAYMENTS_LIMIT; period 30j = paid_at at or after the instant now minus
 * 30 days. The totals are the « Encaissé » predicate (spec § 9): paid,
 * livemode = live, this pro, same period.
 */
export async function getPayments(
  db: Db,
  professionalId: string,
  now: Date,
  opts: { period: PaymentsPeriod; live: boolean },
): Promise<{ rows: PaymentRow[]; totals: { currency: string; cents: number }[] }> {
  const since = opts.period === "30j" ? new Date(now.getTime() - 30 * DAY_MS) : undefined;

  const [totals, purchases] = await Promise.all([
    revenueByCurrency(db, { live: opts.live, professionalId, since }),
    db
      .select({
        purchaseId: ticketPurchase.id,
        paidAt: ticketPurchase.paidAt,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        label: ticketPurchase.label,
        quantity: ticketPurchase.quantity,
        amountCents: ticketPurchase.amountCents,
        currency: ticketPurchase.currency,
        livemode: ticketPurchase.livemode,
      })
      .from(ticketPurchase)
      .innerJoin(
        customer,
        and(eq(customer.id, ticketPurchase.customerId), eq(customer.professionalId, professionalId)),
      )
      .where(
        and(
          eq(ticketPurchase.professionalId, professionalId),
          eq(ticketPurchase.status, "paid"),
          since ? gte(ticketPurchase.paidAt, since) : undefined,
        ),
      )
      .orderBy(desc(ticketPurchase.paidAt), desc(ticketPurchase.id))
      .limit(PAYMENTS_LIMIT),
  ]);

  const ids = purchases.map((p) => p.purchaseId);
  if (ids.length === 0) return { rows: [], totals };

  const [bookings, closed] = await Promise.all([
    db
      .select({
        purchaseId: booking.purchaseId,
        occurrenceId: occurrence.id,
        startsAt: occurrence.startsAt,
        status: booking.status,
        holdExpiresAt: booking.holdExpiresAt,
        eventTitle: event.title,
        typeName: ticketType.name,
      })
      .from(booking)
      // The pro's own occurrence, event and type only (single-column foreign keys): a crossed row shows none of their fields.
      .innerJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, professionalId)))
      .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, professionalId)))
      .leftJoin(ticketType, and(eq(ticketType.id, occurrence.ticketTypeId), eq(ticketType.professionalId, professionalId)))
      .where(and(eq(booking.professionalId, professionalId), inArray(booking.purchaseId, ids))),
    db
      .select({
        purchaseId: ticket.purchaseId,
        reason: ticket.closedReason,
        note: ticket.closedNote,
        n: count(),
      })
      .from(ticket)
      .where(
        and(
          eq(ticket.professionalId, professionalId),
          eq(ticket.status, "closed"),
          inArray(ticket.purchaseId, ids),
        ),
      )
      .groupBy(ticket.purchaseId, ticket.closedReason, ticket.closedNote),
  ]);

  const bookingByPurchase = new Map<string, NonNullable<PaymentRow["booking"]>>();
  for (const b of bookings) {
    if (b.purchaseId === null) continue;
    bookingByPurchase.set(b.purchaseId, {
      occurrenceId: b.occurrenceId,
      title: b.eventTitle ?? b.typeName ?? "Rendez-vous",
      startsAt: b.startsAt,
      status: liveBookingStatus(b.status, b.holdExpiresAt, now),
    });
  }

  const closedByPurchase = new Map<string, PaymentRow["closedNotes"]>();
  for (const c of closed) {
    if (c.purchaseId === null || c.reason === null) continue;
    const list = closedByPurchase.get(c.purchaseId) ?? [];
    list.push({ reason: c.reason, note: c.note, count: c.n });
    closedByPurchase.set(c.purchaseId, list);
  }
  for (const list of closedByPurchase.values()) {
    list.sort((a, b) => {
      const byReason = reasonRank(a.reason) - reasonRank(b.reason);
      if (byReason !== 0) return byReason;
      const an = a.note ?? "";
      const bn = b.note ?? "";
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
  }

  const rows: PaymentRow[] = [];
  for (const p of purchases) {
    // ticket_purchase_paid_chk: a paid purchase always has paid_at.
    if (p.paidAt === null) continue;
    rows.push({
      purchaseId: p.purchaseId,
      paidAt: p.paidAt,
      customerId: p.customerId,
      customerName: p.customerName,
      customerEmail: p.customerEmail,
      label: p.label,
      quantity: p.quantity,
      amountCents: p.amountCents,
      currency: p.currency,
      livemode: p.livemode,
      booking: bookingByPurchase.get(p.purchaseId) ?? null,
      closedNotes: closedByPurchase.get(p.purchaseId) ?? [],
    });
  }
  return { rows, totals };
}
