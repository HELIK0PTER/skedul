"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import {
  availabilityRule,
  eventType,
  pack,
  professional,
  question,
  timeOff,
  user as userTable,
} from "@/lib/db/schema";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";
import { isHexColor, presetColor } from "@/lib/color";
import { buildTimeOffInterval } from "@/lib/timeoff";
import { slugify } from "@/lib/utils";

async function requirePro() {
  const pro = await getCurrentProfessional();
  if (!pro) redirect("/onboarding");
  return pro;
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "pro";
  let candidate = root;
  let n = 1;
  // ensure global uniqueness of professional slug
  while (true) {
    const existing = await db
      .select({ id: professional.id })
      .from(professional)
      .where(eq(professional.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
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
      timezone: input.timezone || "Europe/Paris",
    })
    .returning({ id: professional.id });

  await db
    .update(userTable)
    .set({ role: "pro" })
    .where(eq(userTable.id, user.id));

  // sensible default availability: Mon–Fri 9:00–17:00
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

/* ─────────────────────────── Event types ───────────────────────── */

export async function saveEventType(input: {
  id?: string;
  title: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  capacity?: number;
  color?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  isActive?: boolean;
  availability?: {
    customized: boolean;
    rules: { dayOfWeek: number; startMinute: number; endMinute: number }[];
  };
}) {
  const pro = await requirePro();
  let eventTypeId: string | undefined;

  if (input.id) {
    const updated = await db
      .update(eventType)
      .set({
        title: input.title,
        description: input.description || null,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        capacity: Math.max(1, Math.floor(input.capacity ?? 1)),
        color: input.color || "#6d5cf6",
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
        isActive: input.isActive ?? true,
      })
      .where(
        and(eq(eventType.id, input.id), eq(eventType.professionalId, pro.id)),
      )
      .returning({ id: eventType.id });
    if (updated.length === 0) return; // not this pro's event type
    eventTypeId = updated[0].id;
  } else {
    let slug = slugify(input.title) || "rdv";
    // ensure unique slug within this pro
    let n = 1;
    while (
      (
        await db
          .select({ id: eventType.id })
          .from(eventType)
          .where(
            and(
              eq(eventType.professionalId, pro.id),
              eq(eventType.slug, slug),
            ),
          )
          .limit(1)
      ).length > 0
    ) {
      slug = `${slugify(input.title)}-${++n}`;
    }
    const [created] = await db
      .insert(eventType)
      .values({
        professionalId: pro.id,
        title: input.title,
        slug,
        description: input.description || null,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        capacity: Math.max(1, Math.floor(input.capacity ?? 1)),
        color: input.color || "#6d5cf6",
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
        isActive: input.isActive ?? true,
      })
      .returning({ id: eventType.id });
    eventTypeId = created.id;
  }

  // per-event custom availability: replace this event type's own rules
  if (input.availability && eventTypeId) {
    await db
      .delete(availabilityRule)
      .where(
        and(
          eq(availabilityRule.eventTypeId, eventTypeId),
          eq(availabilityRule.professionalId, pro.id),
        ),
      );
    const valid = input.availability.customized
      ? input.availability.rules.filter((r) => r.endMinute > r.startMinute)
      : [];
    if (valid.length > 0) {
      await db.insert(availabilityRule).values(
        valid.map((r) => ({
          professionalId: pro.id,
          eventTypeId,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
      );
    }
  }

  revalidatePath("/dashboard/event-types");
  revalidatePath(`/${pro.slug}`);
}

export async function deleteEventType(id: string) {
  const pro = await requirePro();
  await db
    .delete(eventType)
    .where(and(eq(eventType.id, id), eq(eventType.professionalId, pro.id)));
  revalidatePath("/dashboard/event-types");
  revalidatePath(`/${pro.slug}`);
}

/* ───────────────────────────── Availability ────────────────────── */

export async function saveAvailability(
  rules: { dayOfWeek: number; startMinute: number; endMinute: number }[],
) {
  const pro = await requirePro();
  await db
    .delete(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, pro.id),
        isNull(availabilityRule.eventTypeId),
      ),
    );
  const valid = rules.filter((r) => r.endMinute > r.startMinute);
  if (valid.length > 0) {
    await db
      .insert(availabilityRule)
      .values(valid.map((r) => ({ ...r, professionalId: pro.id })));
  }
  revalidatePath("/dashboard/availability");
  revalidatePath(`/${pro.slug}`);
}

/* ───────────────────────────────── Packs ───────────────────────── */

export async function savePack(input: {
  id?: string;
  name: string;
  description?: string;
  credits: number;
  priceCents: number;
  eventTypeId?: string | null;
  isActive?: boolean;
}) {
  const pro = await requirePro();
  const eventTypeId = input.eventTypeId || null;

  if (input.id) {
    await db
      .update(pack)
      .set({
        name: input.name,
        description: input.description || null,
        credits: input.credits,
        priceCents: input.priceCents,
        eventTypeId,
        isActive: input.isActive ?? true,
      })
      .where(and(eq(pack.id, input.id), eq(pack.professionalId, pro.id)));
  } else {
    await db.insert(pack).values({
      professionalId: pro.id,
      name: input.name,
      description: input.description || null,
      credits: input.credits,
      priceCents: input.priceCents,
      eventTypeId,
      isActive: input.isActive ?? true,
    });
  }
  revalidatePath("/dashboard/packs");
  revalidatePath(`/${pro.slug}`);
}

export async function deletePack(id: string) {
  const pro = await requirePro();
  await db
    .delete(pack)
    .where(and(eq(pack.id, id), eq(pack.professionalId, pro.id)));
  revalidatePath("/dashboard/packs");
  revalidatePath(`/${pro.slug}`);
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

/* ─────────────────────────── Questions ─────────────────────────── */

export async function saveQuestion(input: {
  id?: string;
  eventTypeId: string;
  label: string;
  type: "text" | "choice" | "boolean";
  options?: string[];
  required?: boolean;
  position?: number;
}) {
  const pro = await requirePro();
  // ownership check: the event type must belong to this pro
  const owns = await db
    .select({ id: eventType.id })
    .from(eventType)
    .where(
      and(
        eq(eventType.id, input.eventTypeId),
        eq(eventType.professionalId, pro.id),
      ),
    )
    .limit(1);
  if (owns.length === 0) return;

  const cleaned =
    input.type === "choice"
      ? (input.options ?? []).map((o) => o.trim()).filter(Boolean)
      : [];
  const options = cleaned.length > 0 ? cleaned : null;

  if (input.id) {
    await db
      .update(question)
      .set({
        label: input.label,
        type: input.type,
        options,
        required: input.required ?? false,
        position: input.position ?? 0,
      })
      .where(
        and(
          eq(question.id, input.id),
          eq(question.eventTypeId, input.eventTypeId),
        ),
      );
  } else {
    await db.insert(question).values({
      eventTypeId: input.eventTypeId,
      label: input.label,
      type: input.type,
      options,
      required: input.required ?? false,
      position: input.position ?? 0,
    });
  }
  revalidatePath("/dashboard/event-types");
}

export async function deleteQuestion(id: string) {
  const pro = await requirePro();
  // ownership via join on the pro's event types
  const owned = await db
    .select({ id: question.id })
    .from(question)
    .innerJoin(eventType, eq(eventType.id, question.eventTypeId))
    .where(and(eq(question.id, id), eq(eventType.professionalId, pro.id)))
    .limit(1);
  if (owned.length === 0) return;
  await db.delete(question).where(eq(question.id, id));
  revalidatePath("/dashboard/event-types");
}
