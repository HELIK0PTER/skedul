import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  professional,
} from "@/lib/db/schema";
import {
  bookingConfirmationEmail,
  packReceiptEmail,
  sendEmail,
} from "@/lib/email";
import { formatSlot } from "@/lib/datetime";

/** Marks a pack purchase as paid and grants its credits. Idempotent. */
export async function fulfillPackPurchase(purchaseId: string) {
  const rows = await db
    .select({
      purchase: packPurchase,
      pack: pack,
      customer: customer,
      professional: professional,
    })
    .from(packPurchase)
    .innerJoin(pack, eq(pack.id, packPurchase.packId))
    .innerJoin(customer, eq(customer.id, packPurchase.customerId))
    .innerJoin(professional, eq(professional.id, packPurchase.professionalId))
    .where(eq(packPurchase.id, purchaseId))
    .limit(1);

  const row = rows[0];
  if (!row) return;
  if (row.purchase.status === "paid") return; // already fulfilled

  await db
    .update(packPurchase)
    .set({
      status: "paid",
      creditsRemaining: row.purchase.creditsTotal,
    })
    .where(eq(packPurchase.id, purchaseId));

  await sendEmail({
    to: row.customer.email,
    subject: `Votre pack ${row.pack.name} est actif`,
    html: packReceiptEmail({
      customerName: row.customer.name,
      businessName: row.professional.businessName,
      packName: row.pack.name,
      credits: row.purchase.creditsTotal,
      amountCents: row.purchase.amountPaidCents,
    }),
  });
}

/** Marks a (direct-paid) booking as confirmed. Idempotent. */
export async function fulfillBooking(bookingId: string) {
  const rows = await db
    .select({
      booking: booking,
      eventType: eventType,
      customer: customer,
      professional: professional,
    })
    .from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .where(eq(booking.id, bookingId))
    .limit(1);

  const row = rows[0];
  if (!row) return;
  if (row.booking.status === "confirmed") return;

  await db
    .update(booking)
    .set({ status: "confirmed" })
    .where(eq(booking.id, bookingId));

  await sendEmail({
    to: row.customer.email,
    subject: `Réservation confirmée — ${row.eventType.title}`,
    html: bookingConfirmationEmail({
      customerName: row.customer.name,
      businessName: row.professional.businessName,
      eventTitle: row.eventType.title,
      whenLabel: formatSlot(
        row.booking.startAt,
        row.booking.endAt,
        row.professional.timezone,
      ),
      paidLabel:
        row.booking.amountPaidCents && row.booking.amountPaidCents > 0
          ? new Intl.NumberFormat("fr-FR", {
              style: "currency",
              currency: "EUR",
            }).format(row.booking.amountPaidCents / 100)
          : "Crédit de pack",
    }),
  });
}
