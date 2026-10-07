import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  account,
  availabilityRule,
  bookingAnswer,
  booking,
  classSession,
  customer,
  eventType,
  pack,
  packPurchase,
  professional,
  question,
  timeOff,
  user,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { loadBookableSlots } from "@/lib/slots";
import { userNotSuspended } from "@/lib/suspension";
import { dayKeyInTz, formatTime } from "@/lib/datetime";

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
    .innerJoin(user, eq(user.id, professional.userId))
    .where(
      and(
        eq(professional.slug, slug),
        eq(eventType.id, eventTypeId),
        eq(eventType.isActive, true),
        userNotSuspended(),
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
    .innerJoin(user, eq(user.id, professional.userId))
    .leftJoin(eventType, eq(eventType.id, pack.eventTypeId))
    .where(
      and(
        eq(professional.slug, slug),
        eq(pack.id, packId),
        eq(pack.isActive, true),
        userNotSuspended(),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function getEventTypeQuestions(eventTypeId: string) {
  return db
    .select({
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options,
      required: question.required,
      position: question.position,
    })
    .from(question)
    .where(eq(question.eventTypeId, eventTypeId))
    .orderBy(asc(question.position), asc(question.createdAt));
}

export async function getProSessions(proId: string) {
  const now = new Date();
  const sessions = await db
    .select({
      id: classSession.id,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
      seatsRemaining: classSession.seatsRemaining,
      eventTitle: eventType.title,
      eventColor: eventType.color,
    })
    .from(classSession)
    .innerJoin(eventType, eq(eventType.id, classSession.eventTypeId))
    .where(
      and(
        eq(classSession.professionalId, proId),
        gte(classSession.startAt, now),
        gt(classSession.capacity, 1),
      ),
    )
    .orderBy(asc(classSession.startAt));

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const rows = await db
    .select({
      sessionId: booking.sessionId,
      bookingId: booking.id,
      name: customer.name,
      email: customer.email,
      status: booking.status,
    })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(
      and(
        inArray(booking.sessionId, sessionIds),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  const bookingIds = rows.map((r) => r.bookingId);
  const answerRows = bookingIds.length
    ? await db
        .select({
          bookingId: bookingAnswer.bookingId,
          label: bookingAnswer.questionLabel,
          value: bookingAnswer.value,
        })
        .from(bookingAnswer)
        .where(inArray(bookingAnswer.bookingId, bookingIds))
    : [];

  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answerRows) {
    const arr = answersByBooking.get(a.bookingId) ?? [];
    arr.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, arr);
  }

  return sessions.map((s) => ({
    ...s,
    attendees: rows
      .filter((r) => r.sessionId === s.id)
      .map((r) => ({
        name: r.name,
        email: r.email,
        answers: answersByBooking.get(r.bookingId) ?? [],
      })),
  }));
}

export async function getProPlanningWeek(proId: string, start: Date, end: Date) {
  const sessions = await db
    .select({
      id: classSession.id,
      startAt: classSession.startAt,
      endAt: classSession.endAt,
      capacity: classSession.capacity,
      seatsRemaining: classSession.seatsRemaining,
      eventTypeId: classSession.eventTypeId,
      eventTitle: eventType.title,
      eventColor: eventType.color,
    })
    .from(classSession)
    .innerJoin(eventType, eq(eventType.id, classSession.eventTypeId))
    .where(
      and(
        eq(classSession.professionalId, proId),
        gte(classSession.startAt, start),
        lt(classSession.startAt, end),
      ),
    )
    .orderBy(asc(classSession.startAt));

  const timeOffRows = await db
    .select({
      id: timeOff.id,
      startAt: timeOff.startAt,
      endAt: timeOff.endAt,
      reason: timeOff.reason,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.professionalId, proId),
        lt(timeOff.startAt, end),
        gt(timeOff.endAt, start),
      ),
    )
    .orderBy(asc(timeOff.startAt));

  if (sessions.length === 0) {
    return { sessions: [], timeOff: timeOffRows };
  }

  const sessionIds = sessions.map((s) => s.id);
  const attRows = await db
    .select({
      sessionId: booking.sessionId,
      bookingId: booking.id,
      name: customer.name,
      email: customer.email,
      status: booking.status,
      paymentType: booking.paymentType,
    })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(
      and(
        inArray(booking.sessionId, sessionIds),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  const bookingIds = attRows.map((r) => r.bookingId);
  const answerRows = bookingIds.length
    ? await db
        .select({
          bookingId: bookingAnswer.bookingId,
          label: bookingAnswer.questionLabel,
          value: bookingAnswer.value,
        })
        .from(bookingAnswer)
        .where(inArray(bookingAnswer.bookingId, bookingIds))
    : [];

  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answerRows) {
    const arr = answersByBooking.get(a.bookingId) ?? [];
    arr.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, arr);
  }

  return {
    sessions: sessions.map((s) => ({
      ...s,
      attendees: attRows
        .filter((r) => r.sessionId === s.id)
        .map((r) => ({
          bookingId: r.bookingId,
          name: r.name,
          email: r.email,
          status: r.status,
          paymentType: r.paymentType,
          answers: answersByBooking.get(r.bookingId) ?? [],
        })),
    })),
    timeOff: timeOffRows,
  };
}

export async function getManualDaySlots(
  proId: string,
  eventTypeId: string,
  dayKey: string,
) {
  const [evt] = await db
    .select()
    .from(eventType)
    .where(
      and(eq(eventType.id, eventTypeId), eq(eventType.professionalId, proId)),
    )
    .limit(1);
  const [pro] = await db
    .select({ timezone: professional.timezone })
    .from(professional)
    .where(eq(professional.id, proId))
    .limit(1);
  if (!evt || !pro) return [];

  const slots = await loadBookableSlots(proId, pro.timezone, evt, 21);
  return slots
    .filter((s) => dayKeyInTz(s.start, pro.timezone) === dayKey)
    .map((s) => ({
      startISO: s.start.toISOString(),
      label: formatTime(s.start, pro.timezone),
    }));
}

export async function getPublicProfile(slug: string) {
  const rows = await db
    .select({ pro: professional })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(and(eq(professional.slug, slug), userNotSuspended()))
    .limit(1);
  const pro = rows[0]?.pro;
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

export async function getGoogleConnection(pro: {
  id: string;
  userId: string;
}) {
  const proRows = await db
    .select({ googleCalendarId: professional.googleCalendarId })
    .from(professional)
    .where(eq(professional.id, pro.id))
    .limit(1);

  const acct = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.userId, pro.userId), eq(account.providerId, "google")),
    )
    .limit(1);

  const linkedEmail = acct.length
    ? (
        await db
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, pro.userId))
          .limit(1)
      )[0]?.email ?? null
    : null;

  return {
    configured: env.GOOGLE_CALENDAR_ENABLED,
    connected: !!proRows[0]?.googleCalendarId,
    linked: acct.length > 0,
    accountEmail: linkedEmail,
  };
}
