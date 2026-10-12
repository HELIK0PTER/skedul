"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { isReservedSegment } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { professional, timeOff, user as userTable } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createSkedulCalendar } from "@/lib/google-calendar";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";
import { isHexColor, presetColor } from "@/lib/color";
import { buildTimeOffInterval } from "@/lib/timeoff";
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

  await db.insert(professional).values({
    userId: user.id,
    slug,
    businessName: input.businessName,
    headline: input.headline || null,
    bio: input.bio || null,
    timezone: input.timezone || "Europe/Paris",
  });

  // Promote plain clients to "pro" — never demote an admin.
  await db
    .update(userTable)
    .set({ role: "pro" })
    .where(and(eq(userTable.id, user.id), eq(userTable.role, "client")));

  redirect("/dashboard");
}

export async function updateProfile(input: {
  businessName: string;
  headline?: string;
  bio?: string;
  brandColor?: string;
  timezone?: string;
}) {
  const pro = await requirePro();
  await db
    .update(professional)
    .set({
      businessName: input.businessName,
      headline: input.headline || null,
      bio: input.bio || null,
      brandColor: input.brandColor || pro.brandColor,
      timezone: input.timezone || pro.timezone,
    })
    .where(eq(professional.id, pro.id));
  revalidatePath("/dashboard/settings");
  revalidatePath(`/${pro.slug}`);
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

/* ───────────────────────────── Availability ────────────────────── */

/** Stubbed until the new availability_rule table exists (P2 Task 4). */
export async function saveAvailability(
  rules: { dayOfWeek: number; startMinute: number; endMinute: number }[],
): Promise<void> {
  await requirePro();
  void rules;
}

/* ─────────────────────────── Indisponibilités ──────────────────── */

export async function createTimeOff(input: {
  startDate: string;
  endDate: string;
  allDay: boolean;
  startMinute?: number;
  endMinute?: number;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const pro = await requirePro();

  let interval;
  try {
    interval = buildTimeOffInterval(input, pro.timezone);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Entrée invalide.",
    };
  }

  await db.insert(timeOff).values({
    professionalId: pro.id,
    startAt: interval.startAt,
    endAt: interval.endAt,
    allDay: input.allDay,
    reason: input.reason?.trim() || null,
  });

  revalidatePath("/dashboard/unavailability");
  revalidatePath(`/${pro.slug}`);
  return { ok: true };
}

export async function deleteTimeOff(id: string) {
  const pro = await requirePro();
  await db
    .delete(timeOff)
    .where(and(eq(timeOff.id, id), eq(timeOff.professionalId, pro.id)));
  revalidatePath("/dashboard/unavailability");
  revalidatePath(`/${pro.slug}`);
}

/* ──────────── Séances et planning (rebuilt in P3, same signatures) ──────────── */

export async function updateSessionCapacity(input: {
  sessionId: string;
  capacity: number;
}): Promise<void> {
  await requirePro();
  void input;
}

export async function cancelBooking(bookingId: string): Promise<Res> {
  await requirePro();
  void bookingId;
  return COMING_SOON;
}

export async function moveAttendee(input: {
  bookingId: string;
  targetSessionId: string;
}): Promise<Res> {
  await requirePro();
  void input;
  return COMING_SOON;
}

export async function cancelSession(sessionId: string): Promise<Res> {
  await requirePro();
  void sessionId;
  return COMING_SOON;
}

export async function fetchManualDaySlots(
  eventTypeId: string,
  dayKey: string,
): Promise<{ startISO: string; label: string }[]> {
  await requirePro();
  void eventTypeId;
  void dayKey;
  return [];
}

export async function createManualBooking(input: {
  eventTypeId: string;
  startISO: string;
  customerName: string;
  customerEmail: string;
  answers?: { questionId: string; value: string }[];
}): Promise<Res> {
  await requirePro();
  void input;
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

/** Unlink Google and stop syncing (the Skedul calendar is left in place). */
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
  await db
    .update(professional)
    .set({ googleCalendarId: null })
    .where(eq(professional.id, pro.id));
  return { ok: true };
}
