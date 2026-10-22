/**
 * The ?p= purchase reference (spec L1460-1461, contract Decision 71). A
 * purchase id in a URL is a capability for THAT purchase and its OWN booking
 * on THAT pro's pages, nothing more: the customer of a purchase came from an
 * e-mail typed on a public form (upsertCustomer), so a reference never stands
 * for its customer (no wallet, no other booking, no other purchase's resume
 * URL). No `server-only`, no env, no process db: pages and cores pass `db`.
 */
import { and, count, eq, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import { booking, event, occurrence, ticket, ticketPurchase, ticketType } from "@/lib/db/schema";
import { idSchema, type BookingStatus, type PurchaseStatus } from "@/lib/tickets";

export type PurchaseReference = {
  purchaseId: string;
  /** server-side only: never a viewer identity, never sent to the browser (Decision 71) */
  customerId: string;
  status: PurchaseStatus;
  processing: boolean;
  livemode: boolean;
  label: string;
  quantity: number;
  amountCents: number;
  currency: string;
  ticketTypeName: string;
  offerId: string | null;
  checkoutSessionId: string | null;
  /** checkout_url while pending AND checkout_expires_at > now (the Stripe session is still open), else null */
  resumeUrl: string | null;
  /** the booking of THIS purchase (booking.purchase_id = purchaseId), whatever its status */
  booking: {
    bookingId: string;
    occurrenceId: string;
    status: BookingStatus;
    /** the live hold of a pending booking; null once it is confirmed, cancelled or expired */
    holdExpiresAt: Date | null;
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
  } | null;
  /** tickets issued for the purchase (0 until paid) */
  ticketCount: number;
};

/** The nanoid alphabet: idSchema bounds the length, this bounds the characters (`$` without the m flag only matches at the very end). */
const REFERENCE_ID_RE = /^[A-Za-z0-9_-]+$/;

/** True for a string of 1 to 64 characters of [A-Za-z0-9_-]: the only shape a ?p= value or a mock `purchase` parameter may have before any query is built. */
export function isReferenceId(value: unknown): value is string {
  return typeof value === "string" && idSchema.safeParse(value).success && REFERENCE_ID_RE.test(value);
}

/** The purchase of THIS pro named by a ?p= reference; null for a malformed id (idSchema, [A-Za-z0-9_-]), an unknown one or another pro's (L1461). It describes that purchase and its own booking only. */
export async function purchaseByReference(
  db: Db,
  professionalId: string,
  purchaseId: string,
  now: Date,
): Promise<PurchaseReference | null> {
  if (!isReferenceId(purchaseId)) return null;

  const [p] = await db
    .select({
      purchaseId: ticketPurchase.id,
      customerId: ticketPurchase.customerId,
      status: ticketPurchase.status,
      processingAt: ticketPurchase.processingAt,
      livemode: ticketPurchase.livemode,
      label: ticketPurchase.label,
      quantity: ticketPurchase.quantity,
      amountCents: ticketPurchase.amountCents,
      currency: ticketPurchase.currency,
      ticketTypeName: ticketType.name,
      offerId: ticketPurchase.offerId,
      checkoutSessionId: ticketPurchase.checkoutSessionId,
      checkoutUrl: ticketPurchase.checkoutUrl,
      checkoutExpiresAt: ticketPurchase.checkoutExpiresAt,
    })
    .from(ticketPurchase)
    .innerJoin(
      ticketType,
      and(eq(ticketType.id, ticketPurchase.ticketTypeId), eq(ticketType.professionalId, professionalId)),
    )
    .where(and(eq(ticketPurchase.id, purchaseId), eq(ticketPurchase.professionalId, professionalId)));
  if (!p) return null;

  const [rows, issued] = await Promise.all([
    db
      .select({
        bookingId: booking.id,
        occurrenceId: booking.occurrenceId,
        status: booking.status,
        holdExpiresAt: booking.holdExpiresAt,
        title: sql<string>`coalesce(${event.title}, ${ticketType.name}, '')`,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        location: sql<string | null>`coalesce(${occurrence.locationOverride}, ${event.location})`,
      })
      .from(booking)
      .innerJoin(occurrence, and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, professionalId)))
      // Defence in depth: the foreign keys are single-column, so a row that points at another pro's event or ticket type
      // must still show none of its text (title, location).
      .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, professionalId)))
      .leftJoin(ticketType, and(eq(ticketType.id, occurrence.ticketTypeId), eq(ticketType.professionalId, professionalId)))
      .where(and(eq(booking.purchaseId, purchaseId), eq(booking.professionalId, professionalId))),
    db
      .select({ n: count() })
      .from(ticket)
      .where(and(eq(ticket.purchaseId, purchaseId), eq(ticket.professionalId, professionalId))),
  ]);
  const b = rows[0];

  const sessionOpen =
    p.status === "pending" && p.checkoutUrl !== null && p.checkoutExpiresAt.getTime() > now.getTime();
  return {
    purchaseId: p.purchaseId,
    customerId: p.customerId,
    status: p.status,
    processing: p.processingAt !== null,
    livemode: p.livemode,
    label: p.label,
    quantity: p.quantity,
    amountCents: p.amountCents,
    currency: p.currency,
    ticketTypeName: p.ticketTypeName,
    offerId: p.offerId,
    checkoutSessionId: p.checkoutSessionId,
    resumeUrl: sessionOpen ? p.checkoutUrl : null,
    booking: b
      ? {
          bookingId: b.bookingId,
          occurrenceId: b.occurrenceId,
          status: b.status,
          holdExpiresAt: b.status === "pending" ? b.holdExpiresAt : null,
          title: b.title,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          location: b.location && b.location.trim() !== "" ? b.location : null,
        }
      : null,
    ticketCount: issued[0]?.n ?? 0,
  };
}
