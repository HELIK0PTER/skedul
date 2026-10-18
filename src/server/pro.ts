"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isReservedSegment } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { clearGoogleLink } from "@/lib/calendar-sync-load";
import { db } from "@/lib/db";
import {
  availabilityRule,
  professional,
  user as userTable,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createSkedulCalendar } from "@/lib/google-calendar";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";
import { isHexColor, presetColor } from "@/lib/color";
import type { ActionResult } from "@/lib/back-office/result";
import {
  saveAvailabilityCore,
  updateBookingSettingsCore,
  updateProfileCore,
  type ProfileInput,
} from "@/lib/back-office/settings-actions";
import { isValidTimeZone } from "@/lib/timezones";
import { runProAction } from "@/server/pro-context";
import type { AvailabilityRuleInput, BookingSettings } from "@/lib/tickets";
import { checkSlug } from "@/lib/slug";
import { slugify } from "@/lib/utils";

type Res = { ok: true } | { ok: false; error: string };

// Answer of the planning actions until P3 rebuilds them on the tickets engine.
const COMING_SOON: Res = {
  ok: false,
  error: "Bientôt disponible : cette action revient avec les tickets et événements.",
};

async function requirePro() {
  const pro = await getCurrentProfessional();
  if (!pro) redirect("/onboarding");
  return pro;
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "pro";
  let candidate = root;
  let n = 1;
  // ensure global uniqueness of professional slug; an app route ("admin",
  // "dashboard"…) counts as taken so a pro page never shadows it
  while (true) {
    if (!isReservedSegment(candidate)) {
      const existing = await db
        .select({ id: professional.id })
        .from(professional)
        .where(eq(professional.slug, candidate))
        .limit(1);
      if (existing.length === 0) return candidate;
    }
    candidate = `${root}-${++n}`;
  }
}

/* ─────────────────────── Onboarding / profile ──────────────────── */

export async function createProfessionalProfile(input: {
  businessName: string;
  headline?: string;
  bio?: string;
  timezone?: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const existing = await getCurrentProfessional();
  if (existing) redirect("/dashboard");

  const slug = await uniqueSlug(input.businessName);

  const [created] = await db
    .insert(professional)
    .values({
      userId: user.id,
      slug,
      businessName: input.businessName,
      headline: input.headline || null,
      bio: input.bio || null,
      timezone: input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "Europe/Paris",
    })
    .returning({ id: professional.id });

  // Promote plain clients to "pro", never demote an admin.
  await db
    .update(userTable)
    .set({ role: "pro" })
    .where(and(eq(userTable.id, user.id), eq(userTable.role, "client")));

  // sensible default availability: Monday to Friday, 9:00 to 17:00 (global rules)
  await db.insert(availabilityRule).values(
    [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      professionalId: created.id,
      dayOfWeek,
      startMinute: 540,
      endMinute: 1020,
    })),
  );

  redirect("/dashboard");
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  return runProAction("updateProfile", (ctx, now) => updateProfileCore(db, ctx, input, now), { publicPage: true });
}

const SLUG_TAKEN = "Cette adresse est déjà prise.";

/** Changes the public address. The old one stops working (no redirect). */
export async function updateSlug(input: {
  slug: string;
}): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const pro = await requirePro();
  const check = checkSlug(input.slug);
  if (!check.ok) return check;
  const { slug } = check;
  if (slug === pro.slug) return { ok: true, slug };

  const [taken] = await db
    .select({ id: professional.id })
    .from(professional)
    .where(eq(professional.slug, slug))
    .limit(1);
  if (taken) return { ok: false, error: SLUG_TAKEN };

  try {
    await db
      .update(professional)
      .set({ slug })
      .where(eq(professional.id, pro.id));
  } catch (err) {
    // lost a race against another pro claiming it: the unique index decides
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") {
      return { ok: false, error: SLUG_TAKEN };
    }
    throw err;
  }
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/${pro.slug}`);
  revalidatePath(`/${slug}`);
  return { ok: true, slug };
}

export async function updateBranding(input: {
  themePreset?: string;
  customColor?: string | null;
  bannerUrl?: string | null;
  headerLayout?: string;
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
}) {
  const pro = await requirePro();
  const layout = input.headerLayout === "vitrine" ? "vitrine" : "profil";
  const kind =
    input.avatarKind === "generated" ||
    input.avatarKind === "pack" ||
    input.avatarKind === "upload"
      ? input.avatarKind
      : null;

  // Resolve the active brand color from the chosen preset (or the pro's custom).
  // The custom color persists even while a named preset is active.
  const custom = isHexColor(input.customColor)
    ? (input.customColor as string)
    : pro.customColor;
  const preset = presetColor(input.themePreset);
  const themePreset = input.themePreset === "custom" || !preset ? "custom" : input.themePreset!;
  const brandColor =
    themePreset === "custom" ? (custom ?? pro.brandColor) : (preset as string);

  await db
    .update(professional)
    .set({
      brandColor,
      themePreset,
      customColor: custom ?? null,
      bannerUrl: input.bannerUrl ?? null,
      headerLayout: layout,
      avatarKind: kind,
      avatarStyle: kind === "generated" ? (input.avatarStyle ?? null) : null,
      avatarSeed: kind === "generated" ? (input.avatarSeed ?? null) : null,
      avatarUrl:
        kind === "pack" || kind === "upload" ? (input.avatarUrl ?? null) : null,
    })
    .where(eq(professional.id, pro.id));
  revalidatePath("/dashboard/settings");
  revalidatePath(`/${pro.slug}`);
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

/* ──────────── Séances et planning (the P3 actions live in pro-planning.ts; only this stub is left, until Task 37) ──────────── */

export async function cancelBooking(bookingId: string): Promise<Res> {
  await requirePro();
  void bookingId;
  return COMING_SOON;
}

/* ─────────────────────── Google Calendar ───────────────────────── */

/** After the Google OAuth redirect: create the Skedul calendar + store its id. */
export async function finalizeGoogleConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
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
    return { ok: true };
  } catch (err) {
    console.error("[google] finalize connection failed:", err);
    return { ok: false, error: "Connexion à Google impossible." };
  }
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
    console.error("[google] unlink failed:", err);
  }
  await clearGoogleLink(db, pro.id);
  return { ok: true };
}
