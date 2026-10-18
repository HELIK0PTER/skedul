/**
 * Settings and profile cores (spec §§ 7, 13.4). Every core takes
 * `(db, ctx, input, now)`, validates with parseFr, then writes in ONE batch;
 * none imports server-only, next/*, env or the session, so the DB tests call
 * them directly. src/server/pro.ts wraps them with runProAction.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "@/lib/back-office/notice";
import { actionFail, fromEngine, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { setAvailabilityRules, updateBookingSettings } from "@/lib/booking/catalog";
import { failOf } from "@/lib/booking/types";
import { G, lockRows, tryAtomic, ts, type Db } from "@/lib/db/atomic";
import { professional } from "@/lib/db/schema";
import {
  availabilityRuleInputSchema,
  bookingSettingsSchema,
  type AvailabilityRuleInput,
  type BookingSettings,
} from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";
import { isValidTimeZone } from "@/lib/timezones";
import { parseFr } from "@/lib/zod-fr";

/* ───────────────────────────── Profile ───────────────────────────── */

export const profileInputSchema = z.object({
  businessName: z.string().trim().min(1).max(BOUNDS.name),
  headline: z.string().trim().max(160).nullable(),
  bio: z.string().trim().max(BOUNDS.description).nullable(),
  timezone: z.string().refine(isValidTimeZone, { message: "Fuseau horaire inconnu." }),
});
export type ProfileInput = z.input<typeof profileInputSchema>;

/**
 * SQL: a non-archived event exists, or a future scheduled occurrence (séance
 * or RDV) does. The time zone cannot change while this holds (spec § 7): the
 * stored instants and the recurrence dates were computed in the old zone.
 */
function timezoneLockedSql(professionalId: string, now: Date): SQL {
  return sql`(exists (select 1 from event where professional_id = ${professionalId} and archived_at is null)
    or exists (select 1 from occurrence where professional_id = ${professionalId} and status = 'scheduled' and starts_at > ${ts(now)}))`;
}

/** True when the pro's time zone cannot change (see timezoneLockedSql). Only this pro's rows are read. */
export async function isTimezoneLocked(db: Db, professionalId: string, now: Date): Promise<boolean> {
  const res = await db.execute<{ locked: boolean }>(sql`select ${timezoneLockedSql(professionalId, now)} as locked`);
  return res.rows[0]?.locked === true;
}

/**
 * Profile in ONE batch: lock the professional row (rank 1 of the lock order,
 * the same row createEvent locks), G(the pro exists, 'not_found'),
 * G(zone unchanged OR not locked, 'timezone_locked'), UPDATE. The whole update
 * is refused when the zone is locked, not only the zone. Context "profile".
 */
export async function updateProfileCore(db: Db, ctx: ProCtx, input: ProfileInput, now: Date): Promise<CoreResult> {
  const parsed = parseFr(profileInputSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const pid = ctx.professionalId;

  const res = await tryAtomic(db, async () => () => [
    lockRows(db, "professional", [pid]),
    G(db, sql`exists (select 1 from professional where id = ${pid})`, "not_found"),
    G(
      db,
      sql`(select timezone from professional where id = ${pid}) = ${p.timezone} or not ${timezoneLockedSql(pid, now)}`,
      "timezone_locked",
    ),
    db
      .update(professional)
      .set({
        businessName: p.businessName,
        headline: p.headline || null,
        bio: p.bio || null,
        timezone: p.timezone,
        updatedAt: now,
      })
      .where(eq(professional.id, pid)),
  ]);
  if (!res.ok) return fromEngine(failOf(res), "profile");
  return { ok: true, effects: [] };
}

/* ───────────── Réservations and global RDV hours (Task 29) ───────────── */

/**
 * Booking window and client cancellation deadline (spec § 7). parseFr first, so the
 * bounds speak French (« Réservable jusqu'à : maximum 365. »), then a notice longer
 * than the horizon is refused: online booking would never open (OUT L106).
 * Context "settings". The pro is the one of the context, never one of the input.
 */
export async function updateBookingSettingsCore(
  db: Db,
  ctx: ProCtx,
  input: BookingSettings,
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(bookingSettingsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const settings = parsed.data;
  if (noticeExceedsHorizon(settings.minNoticeMinutes, settings.bookingHorizonDays)) {
    return actionFail(NOTICE_TOO_LONG);
  }
  const res = await updateBookingSettings(db, { professionalId: ctx.professionalId, settings }, now);
  if (!res.ok) return fromEngine(res, "settings");
  return { ok: true, effects: res.effects };
}

const globalHoursSchema = z.object({ rules: z.array(availabilityRuleInputSchema).max(168) });

/**
 * The global RDV hours (ticketTypeId null), replaced in one engine batch: the hours of
 * a ticket type are untouched, an empty list closes every day. An inverted range is
 * « Plage horaire invalide. » (the schema's own message). Context "settings".
 */
export async function saveAvailabilityCore(
  db: Db,
  ctx: ProCtx,
  input: { rules: AvailabilityRuleInput[] },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(globalHoursSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await setAvailabilityRules(
    db,
    { professionalId: ctx.professionalId, ticketTypeId: null, rules: parsed.data.rules },
    now,
  );
  if (!res.ok) return fromEngine(res, "settings");
  return { ok: true, effects: res.effects };
}
