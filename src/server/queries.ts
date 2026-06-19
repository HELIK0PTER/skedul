import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  availabilityRule,
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  professional,
  timeOff,
} from "@/lib/db/schema";

export async function getProDashboardData(proId: string) {
  const now = new Date();

  const [upcoming, customersCount, revenueRow, creditsRow, recent] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(booking)
        .where(
          and(
            eq(booking.professionalId, proId),
            gte(booking.startAt, now),
            inArray(booking.status, ["pending", "confirmed"]),
          ),
        ),
      db
        .select({ value: count() })
        .from(customer)
        .where(eq(customer.professionalId, proId)),
      db
        .select({
          bookings: sql<number>`coalesce(sum(${booking.amountPaidCents}), 0)`,
        })
        .from(booking)
        .where(eq(booking.professionalId, proId)),
      db
        .select({
          packRevenue: sql<number>`coalesce(sum(${packPurchase.amountPaidCents}), 0)`,
          creditsLeft: sql<number>`coalesce(sum(${packPurchase.creditsRemaining}), 0)`,
        })
        .from(packPurchase)
        .where(
          and(
            eq(packPurchase.professionalId, proId),
            eq(packPurchase.status, "paid"),
          ),
        ),
      db
        .select({
          id: booking.id,
          startAt: booking.startAt,
          endAt: booking.endAt,
          status: booking.status,
          paymentType: booking.paymentType,
          eventTitle: eventType.title,
          eventColor: eventType.color,
          customerName: customer.name,
        })
        .from(booking)
        .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
        .innerJoin(customer, eq(customer.id, booking.customerId))
        .where(
          and(
            eq(booking.professionalId, proId),
            gte(booking.startAt, now),
            inArray(booking.status, ["pending", "confirmed"]),
          ),
        )
        .orderBy(asc(booking.startAt))
        .limit(6),
    ]);

  const revenue =
    Number(revenueRow[0]?.bookings ?? 0) +
    Number(creditsRow[0]?.packRevenue ?? 0);

  return {
    upcomingCount: upcoming[0]?.value ?? 0,
    customersCount: customersCount[0]?.value ?? 0,
    revenueCents: revenue,
    creditsLeft: Number(creditsRow[0]?.creditsLeft ?? 0),
    upcoming: recent,
  };
}

export function getProEventTypes(proId: string) {
  return db
    .select()
    .from(eventType)
    .where(eq(eventType.professionalId, proId))
    .orderBy(asc(eventType.createdAt));
}

export function getProAvailability(proId: string) {
  return db
    .select()
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        isNull(availabilityRule.eventTypeId),
      ),
    )
    .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute));
}

export function getProEventTypeRules(proId: string) {
  return db
    .select({
      eventTypeId: availabilityRule.eventTypeId,
      dayOfWeek: availabilityRule.dayOfWeek,
      startMinute: availabilityRule.startMinute,
      endMinute: availabilityRule.endMinute,
    })
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        isNotNull(availabilityRule.eventTypeId),
      ),
    )
    .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute));
}

export function getProTimeOff(proId: string) {
  return db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.professionalId, proId), gte(timeOff.endAt, new Date())))
    .orderBy(asc(timeOff.startAt));
}

export async function getProPacks(proId: string) {
  const packs = await db
    .select({
      id: pack.id,
      name: pack.name,
      description: pack.description,
      credits: pack.credits,
      priceCents: pack.priceCents,
      eventTypeId: pack.eventTypeId,
      isActive: pack.isActive,
      eventTitle: eventType.title,
      sold: sql<number>`(
        select count(*) from ${packPurchase}
        where ${packPurchase.packId} = ${pack.id} and ${packPurchase.status} = 'paid'
      )`,
    })
    .from(pack)
    .leftJoin(eventType, eq(eventType.id, pack.eventTypeId))
    .where(eq(pack.professionalId, proId))
    .orderBy(asc(pack.createdAt));
  return packs;
}

export function getProBookings(proId: string) {
  return db
    .select({
      id: booking.id,
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      paymentType: booking.paymentType,
      amountPaidCents: booking.amountPaidCents,
      notes: booking.customerNotes,
      eventTitle: eventType.title,
      eventColor: eventType.color,
      customerName: customer.name,
      customerEmail: customer.email,
    })
    .from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(eq(booking.professionalId, proId))
    .orderBy(desc(booking.startAt));
}

export async function getPublicEventType(slug: string, eventTypeId: string) {
  const rows = await db
    .select({ eventType, professional })
    .from(eventType)
    .innerJoin(professional, eq(professional.id, eventType.professionalId))
    .where(
      and(
        eq(professional.slug, slug),
        eq(eventType.id, eventTypeId),
        eq(eventType.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getPublicPack(slug: string, packId: string) {
  const rows = await db
    .select({
      pack,
      professional,
      eventTitle: eventType.title,
    })
    .from(pack)
    .innerJoin(professional, eq(professional.id, pack.professionalId))
    .leftJoin(eventType, eq(eventType.id, pack.eventTypeId))
    .where(
      and(
        eq(professional.slug, slug),
        eq(pack.id, packId),
        eq(pack.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getPublicProfile(slug: string) {
  const rows = await db
    .select()
    .from(professional)
    .where(eq(professional.slug, slug))
    .limit(1);
  const pro = rows[0];
  if (!pro) return null;

  const [eventTypes, packs] = await Promise.all([
    db
      .select()
      .from(eventType)
      .where(
        and(eq(eventType.professionalId, pro.id), eq(eventType.isActive, true)),
      )
      .orderBy(asc(eventType.priceCents)),
    db
      .select({
        id: pack.id,
        name: pack.name,
        description: pack.description,
        credits: pack.credits,
        priceCents: pack.priceCents,
        eventTypeId: pack.eventTypeId,
        eventTitle: eventType.title,
      })
      .from(pack)
      .leftJoin(eventType, eq(eventType.id, pack.eventTypeId))
      .where(and(eq(pack.professionalId, pro.id), eq(pack.isActive, true)))
      .orderBy(asc(pack.priceCents)),
  ]);

  return { pro, eventTypes, packs };
}
