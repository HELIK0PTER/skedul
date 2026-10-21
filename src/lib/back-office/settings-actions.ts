/**
 * Settings and profile cores (spec §§ 7, 13.4). Every core takes
 * `(db, ctx, input, now)`, validates with parseFr, then writes in ONE batch;
 * none imports server-only, next/*, env or the session, so the DB tests call
 * them directly. src/server/pro.ts wraps them with runProAction.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { readProWindow } from "@/lib/back-office/catalog-reads";
import { NOTICE_TOO_LONG, noticeExceedsHorizon, settingsWouldClose } from "@/lib/back-office/notice";
import { actionFail, fromEngine, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { mergeAvailabilityRules } from "@/lib/back-office/week-hours";
import { setAvailabilityRules, updateBookingSettings } from "@/lib/booking/catalog";
import { failOf } from "@/lib/booking/types";
import { effectiveWindow, type BookingWindow } from "@/lib/booking-window";
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
 * SQL: something stored as an instant (or a local date) of the OLD zone is still ahead. The time zone cannot change
 * while this holds (spec § 7): a non-archived event exists, a scheduled occurrence (séance or RDV) starts later, a
 * time off ends later (an all-day one is a pair of local midnights), or an available ticket has an expiry still
 * to come (the local midnight after its last day). Tickets with no limit and everything already over do not count.
 */
function timezoneLockedSql(professionalId: string, now: Date): SQL {
  return sql`(exists (select 1 from event where professional_id = ${professionalId} and archived_at is null)
    or exists (select 1 from occurrence where professional_id = ${professionalId} and status = 'scheduled' and starts_at > ${ts(now)})
    or exists (select 1 from time_off where professional_id = ${professionalId} and end_at > ${ts(now)})
    or exists (select 1 from ticket where professional_id = ${professionalId} and status = 'available'
      and expires_at is not null and expires_at > ${ts(now)}))`;
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
 * The first RDV type or event (in that order, by position then creation) whose effective window the NEW
 * settings would close (notice longer than horizon, Decision 28), among the ones the CURRENT settings leave
 * open: a window that was already closed does not block an unrelated change. Considered: non-archived RDV types
 * (RDV libre on) and non-archived events with online booking and a séance to come, each carrying an override of
 * the horizon or of the notice (the ones with neither follow the pro's settings and are checked by the pro's own
 * rule). Null when nothing would close. Raw SQL with aliases: the outer columns are written out.
 */
async function windowClosedBy(
  db: Db,
  professionalId: string,
  current: BookingWindow,
  next: BookingSettings,
  now: Date,
): Promise<string | null> {
  const closes = (overrides: { bookingHorizonDays: number | null; minNoticeMinutes: number | null }): boolean => {
    const was = effectiveWindow(current, overrides);
    const will = effectiveWindow({ ...current, ...next }, overrides);
    return (
      !noticeExceedsHorizon(was.minNoticeMinutes, was.bookingHorizonDays) &&
      noticeExceedsHorizon(will.minNoticeMinutes, will.bookingHorizonDays)
    );
  };
  const types = await db.execute<{ name: string; horizon: number | null; notice: number | null }>(sql`
    select t.name, t.rdv_booking_horizon_days as horizon, t.rdv_min_notice_minutes as notice
    from ticket_type t
    where t.professional_id = ${professionalId} and t.archived_at is null and t.rdv_enabled
      and (t.rdv_booking_horizon_days is not null or t.rdv_min_notice_minutes is not null)
    order by t.position, t.created_at, t.id`);
  for (const t of types.rows) {
    if (closes({ bookingHorizonDays: t.horizon, minNoticeMinutes: t.notice })) return settingsWouldClose("type", t.name);
  }
  const events = await db.execute<{ title: string; horizon: number | null; notice: number | null }>(sql`
    select e.title, e.booking_horizon_days as horizon, e.min_notice_minutes as notice
    from event e
    where e.professional_id = ${professionalId} and e.archived_at is null and e.booking_mode <> 'none'
      and (e.booking_horizon_days is not null or e.min_notice_minutes is not null)
      and exists (select 1 from occurrence o
        where o.event_id = e.id and o.professional_id = ${professionalId} and o.status = 'scheduled' and o.starts_at > ${ts(now)})
    order by e.start_date, e.created_at, e.id`);
  for (const e of events.rows) {
    if (closes({ bookingHorizonDays: e.horizon, minNoticeMinutes: e.notice })) return settingsWouldClose("event", e.title);
  }
  return null;
}

/**
 * Booking window and client cancellation deadline (spec § 7). parseFr first, so the
 * bounds speak French (« Réservable jusqu'à : maximum 365. »), then a notice longer
 * than the horizon is refused: online booking would never open (OUT L106). Settings that would close
 * the online booking of a type or an event that overrides the horizon or the notice are refused too,
 * naming the first one (windowClosedBy). Context "settings".
 * The pro is the one of the context, never one of the input.
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
  const current = await readProWindow(db, ctx.professionalId);
  if (current) {
    const closed = await windowClosedBy(db, ctx.professionalId, current, settings, now);
    if (closed !== null) return actionFail(closed);
  }
  const res = await updateBookingSettings(db, { professionalId: ctx.professionalId, settings }, now);
  if (!res.ok) return fromEngine(res, "settings");
  return { ok: true, effects: res.effects };
}

const globalHoursSchema = z.object({ rules: z.array(availabilityRuleInputSchema).max(168) });

/**
 * The global RDV hours (ticketTypeId null), replaced in one engine batch: the hours of
 * a ticket type are untouched, an empty list closes every day. An inverted range is
 * « Plage horaire invalide. » (the schema's own message). Overlapping and touching ranges of a day are stored as
 * one (mergeAvailabilityRules: an RDV must fit inside a single range). Context "settings".
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
    { professionalId: ctx.professionalId, ticketTypeId: null, rules: mergeAvailabilityRules(parsed.data.rules) },
    now,
  );
  if (!res.ok) return fromEngine(res, "settings");
  return { ok: true, effects: res.effects };
}
