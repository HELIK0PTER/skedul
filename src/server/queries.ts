import "server-only";
import { and, asc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, availabilityRule, professional, timeOff, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { isTimezoneLocked } from "@/lib/back-office/settings-actions";
import { readPublicProfile } from "@/lib/public/profile-reads";
import { getPayments, type PaymentsPeriod } from "@/lib/back-office/payments-reads";
import { revenueLive } from "@/server/revenue";
import { getDashboardData } from "@/lib/back-office/dashboard-reads";
import type { BookingSettings } from "@/lib/tickets";

/*
 * Server-side readers of the pro back-office: thin wrappers that bind the db and
 * the clock to the testable cores in src/lib/back-office (dashboard, payments),
 * plus the few reads that have no core of their own. The planning, clients,
 * catalogue and events pages read through src/server/*-queries.ts. The public
 * pages' readers are P4's.
 */

export type AvailabilityRow = { dayOfWeek: number; startMinute: number; endMinute: number };

/** /dashboard: KPIs, alerts, first steps and the next bookings (revenue counts live payments only with a live Stripe key). */
export async function getDashboardPage(pro: { id: string; timezone: string; currency: string }) {
  return getDashboardData(db, pro, new Date(), revenueLive());
}

/** /dashboard/payments: the pro's paid purchases and the « Encaissé » totals (a live Stripe key counts live payments only). */
export async function getPaymentsPage(pro: { id: string }, period: PaymentsPeriod) {
  return getPayments(db, pro.id, new Date(), { period, live: revenueLive() });
}

/** The pro's global weekly hours (ticket_type_id NULL); a type's own rules replace them for that type. */
export async function getProAvailability(proId: string): Promise<AvailabilityRow[]> {
  return db
    .select({
      dayOfWeek: availabilityRule.dayOfWeek,
      startMinute: availabilityRule.startMinute,
      endMinute: availabilityRule.endMinute,
    })
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        isNull(availabilityRule.ticketTypeId),
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

/** What the settings page needs beyond the professional row: the time-zone lock and the booking settings. */
export async function getSettingsExtras(
  professionalId: string,
): Promise<{ timezoneLocked: boolean; bookingSettings: BookingSettings }> {
  const [timezoneLocked, [row]] = await Promise.all([
    isTimezoneLocked(db, professionalId, new Date()),
    db
      .select({
        bookingHorizonDays: professional.bookingHorizonDays,
        minNoticeMinutes: professional.minNoticeMinutes,
        cancelDeadlineHours: professional.cancelDeadlineHours,
      })
      .from(professional)
      .where(eq(professional.id, professionalId)),
  ]);
  return { timezoneLocked, bookingSettings: row };
}

/**
 * The public row of the pro at this slug (the tested read `readPublicProfile`, src/lib/public/profile-reads.ts: only
 * the columns a public page renders or needs, never the Stripe account or the Google calendar). A suspended pro's
 * page is offline (null), except where `includeSuspended` is set: the thank-you page, so a customer who paid just
 * before the suspension still sees their confirmation.
 */
export async function getPublicProfile(slug: string, opts: { includeSuspended?: boolean } = {}) {
  const pro = await readPublicProfile(db, slug, opts);
  return pro ? { pro } : null;
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
