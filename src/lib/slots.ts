/**
 * RDV libre slot loader (spec L1501; P5 dossier § 3.2, § 3.4). It reads what the engine (`bookRdv`, claims.ts) reads
 * and hands it to the pure generator (`computeSlots`, availability.ts), so the page never offers a slot the engine
 * refuses and never hides one it accepts:
 *
 * - the type and its zone and window through `loadRdvType`, the hours through `rdvRules` (ONE statement each, shared
 *   with E4's plan);
 * - the busy intervals through `loadRdvBusy`: the predicates of `rdvSlotFree` and of the EXCLUDE
 *   `occurrence_rdv_excl`, minus the RDVs held only by a lapsed hold (`lapsedHold`, holds.ts: the engine expires
 *   those before it inserts);
 * - the grid check of a submitted start through `checkRdvStart` (`isGridStart`), the one rule the engine leaves to
 *   the P5 action.
 *
 * A testable core: `(db, …, now)`, no `server-only`, no `next/*`, no env. Every read is filtered by the pro.
 */
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { computeSlots, isGridStart, type BusyInterval, type RdvSlot } from "@/lib/availability";
import { noticeExceedsHorizon } from "@/lib/back-office/notice";
import { loadRdvType, rdvRules, type RdvTypeFacts } from "@/lib/booking/claims";
import { lapsedHold } from "@/lib/booking/holds";
import { lastBookableDate, type BookingWindow } from "@/lib/booking-window";
import { addDays, instantAt, maxKey, minKey, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { ts, type Db } from "@/lib/db/atomic";
import { occurrence, timeOff } from "@/lib/db/schema";
import { occurrenceStartWindow } from "@/lib/planning";

const MINUTE_MS = 60_000;

/** An RDV type the public can book: enabled, not archived, with a duration (the 404 rule of the RDV page, § 3.11). */
export type BookableRdvType = RdvTypeFacts & { durationMin: number };

export function isBookableRdvType(type: RdvTypeFacts | null): type is BookableRdvType {
  return type !== null && type.rdvEnabled && !type.archived && type.durationMin !== null;
}

/**
 * True when online booking of a type never opens (O14): no hours at all (its own rules and the pro's are both
 * empty), or a notice longer than the horizon of its effective window.
 */
export function rdvNeverBookable(window: BookingWindow, hasHours: boolean): boolean {
  return !hasHours || noticeExceedsHorizon(window.minNoticeMinutes, window.bookingHorizonDays);
}

/**
 * Every interval `[start, end)` of this pro that a new RDV block must miss, among those overlapping `range`
 * (`[)` overlap, like `tstzrange &&`):
 *
 * - every scheduled EVENT séance (private, `none`, empty, archived event: no filter beyond `rdvSlotFree`'s), by its
 *   block (= its times). `starts_at` is also bounded from below (`occurrenceStartWindow`: a séance lasts at most
 *   720 minutes) so the pro + starts_at index serves the read;
 * - every scheduled RDV of any type of this pro, by its STORED block (its own buffers), unless it is a phantom: no
 *   confirmed booking and no pending one whose hold is still live (`lapsedHold`, the complement of what
 *   `expireElapsedHolds` releases);
 * - every time off (`end_at` exclusive).
 */
export async function loadRdvBusy(
  db: Db,
  professionalId: string,
  range: { start: Date; end: Date },
  now: Date,
): Promise<BusyInterval[]> {
  const startWindow = occurrenceStartWindow(range);
  const [seances, rdvs, offs] = await Promise.all([
    db
      .select({ start: occurrence.blockStart, end: occurrence.blockEnd })
      .from(occurrence)
      .where(
        and(
          eq(occurrence.professionalId, professionalId),
          isNotNull(occurrence.eventId),
          eq(occurrence.status, "scheduled"),
          gt(occurrence.startsAt, startWindow.after),
          lt(occurrence.blockStart, range.end),
          gt(occurrence.blockEnd, range.start),
        ),
      ),
    db
      .select({ start: occurrence.blockStart, end: occurrence.blockEnd })
      .from(occurrence)
      .where(
        and(
          eq(occurrence.professionalId, professionalId),
          isNull(occurrence.eventId),
          eq(occurrence.status, "scheduled"),
          sql`tstzrange(${occurrence.blockStart}, ${occurrence.blockEnd}) && tstzrange(${ts(range.start)}, ${ts(range.end)})`,
          sql`exists (select 1 from booking b
            where b.occurrence_id = ${occurrence.id} and b.status in ('pending', 'confirmed')
              and not ${lapsedHold(now, sql`b`)})`,
        ),
      ),
    db
      .select({ start: timeOff.startAt, end: timeOff.endAt })
      .from(timeOff)
      .where(and(eq(timeOff.professionalId, professionalId), lt(timeOff.startAt, range.end), gt(timeOff.endAt, range.start))),
  ]);
  return [...seances, ...rdvs, ...offs];
}

/** True for a well-formed, real calendar date (`parseKey` throws on anything else). */
function isDateKey(key: string): boolean {
  try {
    parseKey(key);
    return true;
  } catch {
    return false;
  }
}

export type RdvWeekDay = { key: DateKey; slots: RdvSlot[] };

export type RdvWeek = { type: BookableRdvType; days: RdvWeekDay[]; neverBookable: boolean };

/**
 * The slots of the Monday-based week holding `weekKey`, in the pro's zone: always its seven days (Monday first),
 * each with its slots sorted by start. Null when this pro has no bookable RDV type `ticketTypeId` (unknown, another
 * pro's, archived, not RDV-enabled, no duration). The dates are bounded by today and by the horizon (inclusive,
 * by local date) BEFORE anything is read: a week past the horizon, a past week, a never-bookable type or a
 * malformed key read the type and the hours only and generate nothing.
 */
export async function loadRdvWeek(
  db: Db,
  professionalId: string,
  ticketTypeId: string,
  weekKey: DateKey,
  now: Date,
): Promise<RdvWeek | null> {
  const [type, rules] = await Promise.all([
    loadRdvType(db, professionalId, ticketTypeId),
    rdvRules(db, professionalId, ticketTypeId),
  ]);
  if (!isBookableRdvType(type)) return null;
  const neverBookable = rdvNeverBookable(type.window, rules.length > 0);
  if (!isDateKey(weekKey)) return { type, days: [], neverBookable };

  const monday = mondayOf(weekKey);
  const keys = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const first = maxKey(monday, todayKey(now, type.tz));
  const last = minKey(keys[6], lastBookableDate(now, type.tz, type.window.bookingHorizonDays));
  const days: RdvWeekDay[] = keys.map((key) => ({ key, slots: [] }));
  if (neverBookable || first > last) return { type, days, neverBookable };

  const range = {
    start: new Date(instantAt(first, 0, type.tz).getTime() - type.bufferBeforeMin * MINUTE_MS),
    end: new Date(instantAt(addDays(last, 1), 0, type.tz).getTime() + type.bufferAfterMin * MINUTE_MS),
  };
  const busy = await loadRdvBusy(db, professionalId, range, now);
  const slots = computeSlots({
    rules,
    busy,
    durationMin: type.durationMin,
    bufferBeforeMin: type.bufferBeforeMin,
    bufferAfterMin: type.bufferAfterMin,
    tz: type.tz,
    fromKey: first,
    toKey: last,
    window: type.window,
    now,
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const slot of slots) byKey.get(todayKey(slot.start, type.tz))?.slots.push(slot);
  return { type, days, neverBookable };
}

/**
 * The grid check of a submitted start (§ 3.4 point 8): `not_found` when this pro has no such type, `off_grid` when
 * the type is not bookable or `startsAt` is not exactly one of the grid starts of its local date (10:07, a second,
 * a millisecond, outside the hours, a DST gap instant). Busy, notice and horizon are the engine's (its plan and its
 * batch, plus the EXCLUDE), so a real conflict comes back as `slot_taken`. No clock: the grid has none.
 */
export async function checkRdvStart(
  db: Db,
  professionalId: string,
  ticketTypeId: string,
  startsAt: Date,
): Promise<"ok" | "not_found" | "off_grid"> {
  const [type, rules] = await Promise.all([
    loadRdvType(db, professionalId, ticketTypeId),
    rdvRules(db, professionalId, ticketTypeId),
  ]);
  if (type === null) return "not_found";
  if (!isBookableRdvType(type)) return "off_grid";
  return isGridStart({ rules, durationMin: type.durationMin, tz: type.tz, startsAt }) ? "ok" : "off_grid";
}
