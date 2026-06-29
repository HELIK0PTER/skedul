"use server";

import { and, desc, eq, gt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  professional,
} from "@/lib/db/schema";
import { createCheckoutUrl } from "@/lib/stripe";
import { fulfillBooking } from "@/lib/payments";
import { syncSession } from "@/lib/calendar-sync";
import { claimSeat, releaseSeat } from "@/lib/sessions";
import { isSlotAvailable } from "@/lib/slots";
import {
  buildAnswers,
  getOrCreateCustomer,
  insertAnswers,
  type CustomerInput,
} from "@/server/booking-core";
import { env } from "@/lib/env";

type ActionResult =
  | { ok: true; redirectUrl?: string; bookingId?: string; message?: string }
  | { ok: false; error: string };

/* ──────────────────────────── Buy a pack ───────────────────────── */

export async function purchasePack(input: {
  packId: string;
  customer: CustomerInput;
}): Promise<ActionResult> {
  const rows = await db
    .select({ pack, professional })
    .from(pack)
    .innerJoin(professional, eq(professional.id, pack.professionalId))
    .where(and(eq(pack.id, input.packId), eq(pack.isActive, true)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Pack introuvable." };

  const cust = await getOrCreateCustomer(row.professional.id, input.customer);

  const [purchase] = await db
    .insert(packPurchase)
    .values({
      packId: row.pack.id,
      professionalId: row.professional.id,
      customerId: cust.id,
      creditsTotal: row.pack.credits,
      creditsRemaining: 0,
      amountPaidCents: row.pack.priceCents,
      currency: row.professional.currency,
      status: "pending",
    })
    .returning();

  const successUrl = `${env.APP_URL}/${row.professional.slug}/merci?type=pack&ref=${purchase.id}`;
  const cancelUrl = `${env.APP_URL}/${row.professional.slug}?canceled=1`;

  const url = await createCheckoutUrl({
    kind: "pack",
    referenceId: purchase.id,
    productName: `${row.pack.name} — ${row.professional.businessName}`,
    description: `${row.pack.credits} séance(s) prépayée(s)`,
    amountCents: row.pack.priceCents,
    currency: row.professional.currency,
    customerEmail: cust.email,
    successUrl,
    cancelUrl,
  });

  return { ok: true, redirectUrl: url };
}

/* ─────────────────── Look up a customer's credits ──────────────── */

export async function lookupCredits(input: {
  professionalId: string;
  email: string;
}) {
  const email = input.email.trim().toLowerCase();
  const cust = await db
    .select()
    .from(customer)
    .where(
      and(
        eq(customer.professionalId, input.professionalId),
        eq(customer.email, email),
      ),
    )
    .limit(1);
  if (!cust[0]) return { found: false as const, purchases: [] };

  const purchases = await db
    .select({
      id: packPurchase.id,
      creditsRemaining: packPurchase.creditsRemaining,
      packName: pack.name,
      eventTypeId: pack.eventTypeId,
    })
    .from(packPurchase)
    .innerJoin(pack, eq(pack.id, packPurchase.packId))
    .where(
      and(
        eq(packPurchase.customerId, cust[0].id),
        eq(packPurchase.status, "paid"),
        gt(packPurchase.creditsRemaining, 0),
      ),
    )
    .orderBy(desc(packPurchase.createdAt));

  return { found: true as const, customer: cust[0], purchases };
}

/* ─────────────────────────── Book a slot ───────────────────────── */

async function loadEventType(eventTypeId: string) {
  const rows = await db
    .select({ eventType, professional })
    .from(eventType)
    .innerJoin(professional, eq(professional.id, eventType.professionalId))
    .where(and(eq(eventType.id, eventTypeId), eq(eventType.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

/** Book by paying now (Stripe / mock) — or instantly if the event is free. */
export async function bookWithPayment(input: {
  eventTypeId: string;
  startISO: string;
  customer: CustomerInput;
  notes?: string;
  answers?: { questionId: string; value: string }[];
}): Promise<ActionResult> {
  const row = await loadEventType(input.eventTypeId);
  if (!row) return { ok: false, error: "Prestation introuvable." };

  const available = await isSlotAvailable(
    row.professional.id,
    row.professional.timezone,
    row.eventType,
    input.startISO,
  );
  if (!available)
    return { ok: false, error: "Ce créneau n'est plus disponible." };

  const answers = await buildAnswers(row.eventType.id, input.answers);
  if (!answers.ok) return { ok: false, error: answers.error };

  const cust = await getOrCreateCustomer(row.professional.id, input.customer);
  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + row.eventType.durationMinutes * 60_000);
  const free = row.eventType.priceCents <= 0;

  const seat = await claimSeat({
    professionalId: row.professional.id,
    eventTypeId: row.eventType.id,
    startAt: start,
    endAt: end,
    capacity: row.eventType.capacity,
  });
  if (!seat.ok) return { ok: false, error: "Cette séance est complète." };

  const [created] = await db
    .insert(booking)
    .values({
      professionalId: row.professional.id,
      eventTypeId: row.eventType.id,
      customerId: cust.id,
      sessionId: seat.sessionId,
      startAt: start,
      endAt: end,
      status: free ? "confirmed" : "pending",
      paymentType: free ? "free" : "direct",
      amountPaidCents: free ? 0 : row.eventType.priceCents,
      customerNotes: input.notes ?? null,
    })
    .returning();

  await insertAnswers(created.id, answers.rows);

  if (free) {
    await fulfillBooking(created.id);
    await syncSession(seat.sessionId);
    return {
      ok: true,
      bookingId: created.id,
      redirectUrl: `${env.APP_URL}/${row.professional.slug}/merci?type=booking&ref=${created.id}`,
    };
  }

  const successUrl = `${env.APP_URL}/${row.professional.slug}/merci?type=booking&ref=${created.id}`;
  const cancelUrl = `${env.APP_URL}/${row.professional.slug}/book/${row.eventType.id}?canceled=1`;

  const url = await createCheckoutUrl({
    kind: "booking",
    referenceId: created.id,
    productName: `${row.eventType.title} — ${row.professional.businessName}`,
    amountCents: row.eventType.priceCents,
    currency: row.professional.currency,
    customerEmail: cust.email,
    successUrl,
    cancelUrl,
  });

  return { ok: true, redirectUrl: url };
}

/** Book using a prepaid pack credit (no payment). */
export async function bookWithCredit(input: {
  eventTypeId: string;
  startISO: string;
  customer: CustomerInput;
  notes?: string;
  answers?: { questionId: string; value: string }[];
}): Promise<ActionResult> {
  const row = await loadEventType(input.eventTypeId);
  if (!row) return { ok: false, error: "Prestation introuvable." };

  const cust = await getOrCreateCustomer(row.professional.id, input.customer);

  // find a paid purchase with credits, valid for this event type (or any)
  const candidates = await db
    .select({
      id: packPurchase.id,
      creditsRemaining: packPurchase.creditsRemaining,
      eventTypeId: pack.eventTypeId,
    })
    .from(packPurchase)
    .innerJoin(pack, eq(pack.id, packPurchase.packId))
    .where(
      and(
        eq(packPurchase.customerId, cust.id),
        eq(packPurchase.status, "paid"),
        gt(packPurchase.creditsRemaining, 0),
        or(
          sql`${pack.eventTypeId} is null`,
          eq(pack.eventTypeId, row.eventType.id),
        ),
      ),
    )
    .orderBy(desc(packPurchase.createdAt));

  const purchaseId = candidates[0]?.id;
  if (!purchaseId)
    return { ok: false, error: "Aucun crédit disponible pour cette prestation." };

  const available = await isSlotAvailable(
    row.professional.id,
    row.professional.timezone,
    row.eventType,
    input.startISO,
  );
  if (!available)
    return { ok: false, error: "Ce créneau n'est plus disponible." };

  const answers = await buildAnswers(row.eventType.id, input.answers);
  if (!answers.ok) return { ok: false, error: answers.error };

  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + row.eventType.durationMinutes * 60_000);

  // 1) claim a seat atomically (authority against oversell)
  const seat = await claimSeat({
    professionalId: row.professional.id,
    eventTypeId: row.eventType.id,
    startAt: start,
    endAt: end,
    capacity: row.eventType.capacity,
  });
  if (!seat.ok) return { ok: false, error: "Cette séance est complète." };

  // 2) atomic credit decrement; if it fails, give the seat back
  const decremented = await db
    .update(packPurchase)
    .set({ creditsRemaining: sql`${packPurchase.creditsRemaining} - 1` })
    .where(
      and(eq(packPurchase.id, purchaseId), gt(packPurchase.creditsRemaining, 0)),
    )
    .returning({ id: packPurchase.id });

  if (decremented.length === 0) {
    await releaseSeat(seat.sessionId);
    return { ok: false, error: "Crédit indisponible, réessayez." };
  }

  // 3) create the booking
  const [created] = await db
    .insert(booking)
    .values({
      professionalId: row.professional.id,
      eventTypeId: row.eventType.id,
      customerId: cust.id,
      sessionId: seat.sessionId,
      startAt: start,
      endAt: end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: purchaseId,
      customerNotes: input.notes ?? null,
    })
    .returning();

  await insertAnswers(created.id, answers.rows);
  await fulfillBooking(created.id);
  await syncSession(seat.sessionId);

  return {
    ok: true,
    bookingId: created.id,
    redirectUrl: `${env.APP_URL}/${row.professional.slug}/merci?type=booking&ref=${created.id}`,
  };
}
