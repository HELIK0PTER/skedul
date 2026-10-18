/**
 * Materialised séances (spec § 7). Creating an event inserts its occurrences
 * over [start_date, min(last date, today + MATERIALIZE_DAYS)] in the same
 * batch; ensureHorizon keeps every active segment MATERIALIZE_DAYS ahead (the
 * nightly job, and after() on the pro planning and the public page when
 * needsHorizon says so). Inserts are ON CONFLICT (event_id, series_date) DO
 * NOTHING: a moved or cancelled row is never recreated.
 *
 * event.generated_until: every rule date ≤ generated_until has its row. It is
 * min(last rule date, horizon end), or the last inserted date when a call hit
 * MATERIALIZE_MAX_ROWS. A series is complete once generated_until ≥ its last
 * date (never for an endless one).
 */
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addDays, compareKeys, minKey, todayKey, type DateKey } from "@/lib/civil-date";
import {
  G,
  PlanError,
  dateArray,
  lockRows,
  textArray,
  tryAtomic,
  ts,
  tsArray,
  type BatchCtx,
  type Db,
  type Query,
} from "@/lib/db/atomic";
import { event, professional, question } from "@/lib/db/schema";
import { EXPAND_MAX_DATES, expand, lastSeriesDate, type RecurrenceRule } from "@/lib/recurrence";
import {
  eventInputSchema,
  HORIZON_REFRESH_DAYS,
  MATERIALIZE_DAYS,
  MATERIALIZE_MAX_ROWS,
  type EventInput,
} from "@/lib/tickets";

import { fail, failOf, type EngineResult } from "./types";

export type EventRow = typeof event.$inferSelect;
export type OccurrenceDraft = { id: string; seriesDate: DateKey; startsAt: Date; endsAt: Date };

function monthWeekOf(n: number | null): RecurrenceRule["monthWeek"] {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === -1 ? n : null;
}

/** The recurrence of an event row (durationMin included). */
export function ruleOf(e: EventRow): RecurrenceRule {
  return {
    startDate: e.startDate,
    startMinute: e.startMinute,
    durationMin: e.durationMin,
    freq: e.freq,
    interval: e.interval,
    weekdays: e.weekdays,
    monthlyBy: e.monthlyBy,
    monthWeek: monthWeekOf(e.monthWeek),
    endMode: e.endMode,
    untilDate: e.untilDate,
    occurrenceCount: e.occurrenceCount,
  };
}

/** Local today (tz) + MATERIALIZE_DAYS: occurrences exist up to this date. */
export function horizonEnd(now: Date, tz: string): DateKey {
  return addDays(todayKey(now, tz), MATERIALIZE_DAYS);
}

/** Render-time trigger (spec § 7): an active series is generated less than HORIZON_REFRESH_DAYS ahead. */
export function needsHorizon(minGeneratedUntil: DateKey | null, now: Date, tz: string): boolean {
  if (minGeneratedUntil === null) return false;
  return compareKeys(minGeneratedUntil, addDays(todayKey(now, tz), HORIZON_REFRESH_DAYS)) < 0;
}

/**
 * The rule's dates in [from, to] as drafts with fresh ids, at most maxRows.
 * generatedUntil = `to` when everything fits, else the last draft's date
 * (from − 1 when not even one fits).
 */
export function draftOccurrences(
  rule: RecurrenceRule,
  tz: string,
  from: DateKey,
  to: DateKey,
  maxRows: number,
): { drafts: OccurrenceDraft[]; generatedUntil: DateKey } {
  const dates = expand(rule, tz, from, to);
  const capped = dates.length > maxRows || dates.length >= EXPAND_MAX_DATES;
  const kept = dates.slice(0, Math.max(0, maxRows));
  const drafts = kept.map((d) => ({ id: nanoid(), seriesDate: d.seriesDate, startsAt: d.startsAt, endsAt: d.endsAt }));
  if (!capped) return { drafts, generatedUntil: to };
  return { drafts, generatedUntil: drafts.length > 0 ? drafts[drafts.length - 1].seriesDate : addDays(from, -1) };
}

/**
 * One INSERT … SELECT FROM unnest(ids, dates, starts, ends) ON CONFLICT
 * (event_id, series_date) DO NOTHING. With `guardVersion` (ensureHorizon), a
 * row is inserted only while the event still has that version, is not
 * archived and the date is ≤ until_date: a concurrent split never gets
 * phantom séances.
 */
export function insertOccurrences(
  c: BatchCtx,
  args: { professionalId: string; eventId: string; capacity: number; drafts: readonly OccurrenceDraft[]; guardVersion?: number },
): Query {
  const guard =
    args.guardVersion === undefined
      ? sql``
      : sql`where exists (select 1 from event ev where ev.id = ${args.eventId} and ev.version = ${args.guardVersion}::int
          and ev.archived_at is null and (ev.until_date is null or v.d <= ev.until_date))`;
  return c.db.execute(sql`
    insert into occurrence (id, professional_id, event_id, series_date, starts_at, ends_at, block_start, block_end,
      capacity, seats_taken, status, created_at, updated_at)
    select v.id, ${args.professionalId}, ${args.eventId}, v.d, v.s, v.e, v.s, v.e,
      ${args.capacity}::int, 0, 'scheduled'::occurrence_status, ${ts(c.now)}, ${ts(c.now)}
    from unnest(${textArray(args.drafts.map((d) => d.id))}, ${dateArray(args.drafts.map((d) => d.seriesDate))},
      ${tsArray(args.drafts.map((d) => d.startsAt))}, ${tsArray(args.drafts.map((d) => d.endsAt))}) as v(id, d, s, e)
    ${guard}
    on conflict (event_id, series_date) do nothing`);
}

/**
 * Creates an event (first segment: series_root_id = id, version 1), its
 * links (only this pro's types, else `invalid`), its questions and its
 * occurrences, in ONE batch. Effects: none (empty séances are not synced).
 * Errors: invalid, not_found (unknown pro).
 */
export async function createEvent(
  db: Db,
  input: { professionalId: string; event: EventInput },
  now: Date = new Date(),
): Promise<EngineResult<{ eventId: string; occurrenceCount: number }>> {
  const parsed = eventInputSchema.safeParse(input.event);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const e = parsed.data;
  const { professionalId } = input;
  const eventId = nanoid();
  const typeIds = [...new Set(e.ticketTypeIds)];
  let occurrenceCount = 0;

  const res = await tryAtomic(db, async () => {
    const [pro] = await db
      .select({ tz: professional.timezone })
      .from(professional)
      .where(eq(professional.id, professionalId));
    if (!pro) throw new PlanError("not_found");
    const rule: RecurrenceRule = { ...e.rule, durationMin: e.durationMin };
    const last = lastSeriesDate(rule);
    const end = horizonEnd(now, pro.tz);
    const to = last === null ? end : minKey(last, end);
    const { drafts, generatedUntil } = draftOccurrences(rule, pro.tz, rule.startDate, to, MATERIALIZE_MAX_ROWS);
    occurrenceCount = drafts.length;

    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const qs: Query[] = [
        db.insert(event).values({
          id: eventId,
          professionalId,
          title: e.title,
          description: e.description || null,
          location: e.location || null,
          color: e.color,
          bookingMode: e.bookingMode,
          isPrivate: e.isPrivate,
          capacity: e.capacity,
          durationMin: e.durationMin,
          startDate: rule.startDate,
          startMinute: rule.startMinute,
          freq: rule.freq,
          interval: rule.interval,
          weekdays: rule.weekdays,
          monthlyBy: rule.monthlyBy,
          monthWeek: rule.monthWeek,
          endMode: rule.endMode,
          untilDate: rule.untilDate,
          occurrenceCount: rule.occurrenceCount,
          bookingHorizonDays: e.overrides.bookingHorizonDays,
          minNoticeMinutes: e.overrides.minNoticeMinutes,
          cancelDeadlineHours: e.overrides.cancelDeadlineHours,
          generatedUntil,
          seriesRootId: eventId,
          version: 1,
          lastActionId: aid,
          createdAt: now,
          updatedAt: now,
        }),
      ];
      if (typeIds.length > 0) {
        qs.push(
          db.execute(sql`
            insert into event_ticket_type (event_id, ticket_type_id, professional_id, created_at)
            select ${eventId}, id, ${professionalId}, ${ts(now)} from ticket_type
            where id = any(${textArray(typeIds)}) and professional_id = ${professionalId}`),
          G(
            db,
            sql`(select count(*)::int from event_ticket_type where event_id = ${eventId}) = ${typeIds.length}::int`,
            "invalid",
          ),
        );
      }
      if (e.questions.length > 0) {
        qs.push(
          db.insert(question).values(
            e.questions.map((q, position) => ({
              id: nanoid(),
              professionalId,
              eventId,
              label: q.label,
              type: q.type,
              options: q.type === "choice" ? q.options : null,
              required: q.required,
              position,
              createdAt: now,
              updatedAt: now,
            })),
          ),
        );
      }
      if (drafts.length > 0) {
        qs.push(insertOccurrences(c, { professionalId, eventId, capacity: e.capacity, drafts }));
      }
      return qs;
    };
  });
  if (!res.ok) return failOf(res);
  return { ok: true, effects: [], eventId, occurrenceCount };
}

/**
 * Brings every active segment of the pro to today + MATERIALIZE_DAYS (or its
 * last date), at most MATERIALIZE_MAX_ROWS rows per call, in ONE batch:
 * lock the events (first rank of the lock order, id asc), version-guarded
 * inserts, version-guarded generated_until, then G(version unchanged,
 * 'stale'). A segment edited between the read and the batch (split, delete)
 * makes the batch stale: it re-plans once on fresh rows. `complete` = nothing
 * left to generate. Effects: none.
 */
export async function ensureHorizon(
  db: Db,
  professionalId: string,
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult<{ inserted: number; complete: boolean }>> {
  let insertAt: number[] = [];
  let complete = true;

  const res = await tryAtomic(
    db,
    async () => {
      const [pro] = await db
        .select({ tz: professional.timezone })
        .from(professional)
        .where(eq(professional.id, professionalId));
      if (!pro) throw new PlanError("not_found");
      const end = horizonEnd(now, pro.tz);
      const rows = await db
        .select()
        .from(event)
        .where(and(eq(event.professionalId, professionalId), isNull(event.archivedAt), lt(event.generatedUntil, end)))
        .orderBy(asc(event.id));

      complete = true;
      let budget = MATERIALIZE_MAX_ROWS;
      const work: { row: EventRow; drafts: OccurrenceDraft[]; generatedUntil: DateKey }[] = [];
      for (const row of rows) {
        const rule = ruleOf(row);
        const last = lastSeriesDate(rule);
        const target = last === null ? end : minKey(last, end);
        if (compareKeys(row.generatedUntil, target) >= 0) continue;
        if (budget === 0) {
          complete = false;
          break;
        }
        const d = draftOccurrences(rule, pro.tz, addDays(row.generatedUntil, 1), target, budget);
        budget -= d.drafts.length;
        if (compareKeys(d.generatedUntil, target) < 0) complete = false;
        work.push({ row, drafts: d.drafts, generatedUntil: d.generatedUntil });
      }

      return (aid) => {
        insertAt = [];
        if (work.length === 0) return [];
        const c: BatchCtx = { db, aid, now };
        const qs: Query[] = [lockRows(db, "event", work.map((w) => w.row.id))];
        for (const w of work) {
          if (w.drafts.length > 0) {
            insertAt.push(qs.length);
            qs.push(
              insertOccurrences(c, {
                professionalId,
                eventId: w.row.id,
                capacity: w.row.capacity,
                drafts: w.drafts,
                guardVersion: w.row.version,
              }),
            );
          }
          qs.push(
            db.execute(sql`
              update event set generated_until = ${w.generatedUntil}::date, updated_at = ${ts(now)}
              where id = ${w.row.id} and version = ${w.row.version}::int and archived_at is null`),
            G(db, sql`(select version from event where id = ${w.row.id}) = ${w.row.version}::int`, "stale"),
          );
        }
        return qs;
      };
    },
    { replanOnStale: true, afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  const inserted = insertAt.reduce(
    (n, i) => n + ((res.results[i] as { rowCount?: number | null } | undefined)?.rowCount ?? 0),
    0,
  );
  return { ok: true, effects: [], inserted, complete };
}

/**
 * min(generated_until) over the pro's non-archived segments that can still
 * produce dates; null when there is none. `now` keeps the engine signature
 * uniform (the comparison with today is needsHorizon's job).
 */
export async function minGeneratedUntil(db: Db, professionalId: string, now: Date = new Date()): Promise<DateKey | null> {
  void now;
  const rows = await db
    .select()
    .from(event)
    .where(and(eq(event.professionalId, professionalId), isNull(event.archivedAt)));
  let min: DateKey | null = null;
  for (const row of rows) {
    const last = lastSeriesDate(ruleOf(row));
    if (last !== null && compareKeys(row.generatedUntil, last) >= 0) continue;
    if (min === null || compareKeys(row.generatedUntil, min) < 0) min = row.generatedUntil;
  }
  return min;
}
