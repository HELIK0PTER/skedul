"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { clearGoogleLink } from "@/lib/calendar-sync-load";
import { db } from "@/lib/db";
import { professional } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createSkedulCalendar } from "@/lib/google-calendar";
import { logSafeMessage } from "@/lib/log-safe";
import { getCurrentProfessional, getCurrentUser, getFreshSession } from "@/lib/session";
import type { ActionFail, ActionResult } from "@/lib/back-office/result";
import {
  createProfessionalProfileCore,
  saveAvailabilityCore,
  updateBookingSettingsCore,
  updateBrandingCore,
  updateProfileCore,
  updateSlugCore,
  type BrandingInput,
  type OnboardingInput,
  type ProfileInput,
} from "@/lib/back-office/settings-actions";
import { publicBlobHost } from "@/lib/branding-upload";
import { scheduleGoogleBackfill } from "@/server/google-backfill";
import { runProAction } from "@/server/pro-context";
import type { AvailabilityRuleInput, BookingSettings } from "@/lib/tickets";

/* ─────────────────────── Onboarding / profile ──────────────────── */

/**
 * The pro page of the signed-in account (no session: /sign-in; a page already: /dashboard). The page, the pro role
 * and the default hours are written in one batch by the core; a refusal (an invalid name, an address taken meanwhile)
 * is answered for the form to show, a success goes to the dashboard.
 */
export async function createProfessionalProfile(input: OnboardingInput): Promise<ActionFail | undefined> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const existing = await getCurrentProfessional();
  if (existing) redirect("/dashboard");

  const res = await createProfessionalProfileCore(db, user.id, input);
  if (!res.ok) return res;
  redirect("/dashboard");
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  return runProAction("updateProfile", (ctx, now) => updateProfileCore(db, ctx, input, now), { publicPage: true });
}

/** Changes the public address. The old one stops working (no redirect). */
export async function updateSlug(input: { slug: string }): Promise<ActionResult<{ slug: string }>> {
  return runProAction("updateSlug", (ctx, now) => updateSlugCore(db, ctx, input, now), { publicPage: true });
}

/** The branding of the public page; its images can only be the pro's own uploads or a bundled avatar (P6 A5). */
export async function updateBranding(input: BrandingInput): Promise<ActionResult> {
  return runProAction(
    "updateBranding",
    (ctx, now) => updateBrandingCore(db, ctx, input, now, { blobHost: env.BLOB_ENABLED ? publicBlobHost(env.BLOB_READ_WRITE_TOKEN) : null }),
    { publicPage: true },
  );
}

/* ───────────── Réservations et disponibilités (RDV libre) ───────────── */

/** Booking horizon, minimum notice and client cancellation deadline of the pro. */
export async function updateBookingSettingsAction(input: BookingSettings): Promise<ActionResult> {
  return runProAction(
    "updateBookingSettings",
    (ctx, now) => updateBookingSettingsCore(db, ctx, input, now),
    { publicPage: true },
  );
}

/** Replaces the pro's global RDV hours (the hours of a ticket type are untouched). */
export async function saveAvailabilityAction(rules: AvailabilityRuleInput[]): Promise<ActionResult> {
  return runProAction(
    "saveAvailability",
    (ctx, now) => saveAvailabilityCore(db, ctx, { rules }, now),
    { publicPage: true },
  );
}

/* ─────────────────────── Google Calendar ───────────────────────── */

const GOOGLE_REFUSED_WHILE_IMPERSONATING =
  "La connexion à Google Agenda n'est pas possible pendant que vous agissez au nom de ce pro.";

/**
 * After the Google OAuth redirect: create the Skedul calendar + store its id. Refused while an admin impersonates the
 * pro (P6 A6, read fresh): the calendar of a pro is linked by the pro only.
 */
export async function finalizeGoogleConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await getFreshSession();
  if (session?.session.impersonatedBy) return { ok: false, error: GOOGLE_REFUSED_WHILE_IMPERSONATING };
  const pro = await getCurrentProfessional();
  if (!pro) return { ok: false, error: "Non authentifié." };
  if (!env.GOOGLE_CALENDAR_ENABLED) return { ok: false, error: "Désactivé." };

  // Already connected → idempotent success.
  const existing = await db
    .select({ id: professional.googleCalendarId })
    .from(professional)
    .where(eq(professional.id, pro.id))
    .limit(1);
  if (existing[0]?.id) return { ok: true };

  try {
    const { accessToken } = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers: await headers(),
    });
    const calendarId = await createSkedulCalendar(accessToken);
    await db
      .update(professional)
      .set({ googleCalendarId: calendarId })
      .where(eq(professional.id, pro.id));
  } catch (err) {
    console.error(`[google] finalize connection failed: ${logSafeMessage(err)}`);
    return { ok: false, error: "Connexion à Google impossible." };
  }
  // Final review COV-2: the séances and RDV already booked reach the new calendar (bounded and
  // paced, after the response). Outside the try: a scheduling problem never fails the connection.
  scheduleGoogleBackfill(pro.id);
  return { ok: true };
}

/**
 * Unlink Google and stop syncing (the Skedul calendar is left in place). One
 * batch clears the calendar id and every occurrence's Google marker (Q33), so a
 * later reconnect never patches events that belong to the old link.
 */
export async function disconnectGoogleCalendar(): Promise<{ ok: boolean }> {
  const pro = await getCurrentProfessional();
  if (!pro) return { ok: false };
  try {
    await auth.api.unlinkAccount({
      body: { providerId: "google" },
      headers: await headers(),
    });
  } catch (err) {
    console.error(`[google] unlink failed: ${logSafeMessage(err)}`);
  }
  await clearGoogleLink(db, pro.id);
  // P6 A34: the card reads « connecté » from this page; the action refreshes it, the card never calls router.refresh().
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
