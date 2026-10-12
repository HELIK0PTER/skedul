import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, professional, timeOff, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { userNotSuspended } from "@/lib/suspension";

/*
 * Tickets & événements, P2: the readers of the dropped booking tables
 * (dashboard, clients, payments, planning, prestations, packs, public booking)
 * are gone. P3 rebuilds the pro readers, P4 the public ones.
 */

export type AvailabilityRow = { dayOfWeek: number; startMinute: number; endMinute: number };

/** The pro's global weekly hours. Stubbed until the new availability_rule table exists (P2 Task 4). */
export async function getProAvailability(proId: string): Promise<AvailabilityRow[]> {
  void proId;
  return [];
}

export function getProTimeOff(proId: string) {
  return db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.professionalId, proId), gte(timeOff.endAt, new Date())))
    .orderBy(asc(timeOff.startAt));
}

/**
 * A suspended pro's page is offline (null), except where `includeSuspended` is
 * set: the thank-you page, so a customer who paid just before the suspension
 * still sees their confirmation.
 */
export async function getPublicProfile(
  slug: string,
  opts: { includeSuspended?: boolean } = {},
) {
  const rows = await db
    .select({ pro: professional })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(
      and(
        eq(professional.slug, slug),
        opts.includeSuspended ? undefined : userNotSuspended(),
      ),
    )
    .limit(1);
  const pro = rows[0]?.pro;
  if (!pro) return null;
  return { pro };
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
