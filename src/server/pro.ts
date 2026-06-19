"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import {
  availabilityRule,
  eventType,
  pack,
  professional,
  timeOff,
  user as userTable,
} from "@/lib/db/schema";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";
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

/* ─────────────────────────── Event types ───────────────────────── */

export async function saveEventType(input: {
  id?: string;
  title: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  color?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  isActive?: boolean;
}) {
  const pro = await requirePro();

  if (input.id) {
    await db
      .update(eventType)
      .set({
        title: input.title,
        description: input.description || null,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents,
        color: input.color || "#6d5cf6",
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
        isActive: input.isActive ?? true,
      })
      .where(
        and(eq(eventType.id, input.id), eq(eventType.professionalId, pro.id)),
      );
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
    await db.insert(eventType).values({
      professionalId: pro.id,
      title: input.title,
      slug,
      description: input.description || null,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents,
      color: input.color || "#6d5cf6",
      bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
      isActive: input.isActive ?? true,
    });
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
    .where(eq(availabilityRule.professionalId, pro.id));
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
