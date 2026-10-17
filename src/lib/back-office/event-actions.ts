/**
 * Event cores (contract 4.11): create, edit the information in place, preview
 * and apply a schedule cut (« cette série à partir du »), preview and apply
 * « Supprimer à partir du », and the create-form preview. Plain functions of
 * `(db, ctx, input, now)`: the identity comes from `ctx` (built from the
 * session by requireProContext), never from the input; no Next, no
 * server-only, so the DB tests call them directly. Every input is validated
 * with `parseFr` and the engine's own schema BEFORE the engine runs, so no
 * English zod text reaches the UI; engine failures become French through
 * `fromEngine`. The thin "use server" wrappers live in src/server/pro-catalog.ts.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";

import { createEvent, horizonEnd } from "@/lib/booking/occurrences";
import { deleteSeriesFrom, editEventInPlace, editSeriesFrom, previewSeriesEdit } from "@/lib/booking/series";
import { fail } from "@/lib/booking/types";
import { effectiveWindow } from "@/lib/booking-window";
import { addDays, maxKey, minKey, todayKey, type DateKey } from "@/lib/civil-date";
import { textArray, type Db } from "@/lib/db/atomic";
import { expand, lastSeriesDate, type RecurrenceRule } from "@/lib/recurrence";
import { describeSeriesEdit, type SeriesEditSummary } from "@/lib/series-plan";
import {
  BOUNDS,
  MATERIALIZE_DAYS,
  MATERIALIZE_MAX_ROWS,
  dateKeySchema,
  eventInfoSchema,
  eventInputSchema,
  idSchema,
  recurrenceRuleSchema,
  type EventInfoInput,
  type EventInput,
  type RecurrenceRuleInput,
  type WindowOverrides,
} from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

import { readProWindow } from "./catalog-reads";
import { countRdvConflicts, deleteFromPreview, type DeletePreview } from "./event-reads";
import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "./notice";
import { actionFail, fromEngine, type ActionResult, type CoreResult, type ProCtx } from "./result";

export type SchedulePreview = {
  summary: SeriesEditSummary;
  /** describeSeriesEdit(summary, "keep") */
  textKeep: string;
  /** describeSeriesEdit(summary, "cancel") */
  textCancel: string;
  remainingCount: number | null;
  /** true when no séance precedes the cut: the edit applies to the same event */
  inPlace: boolean;
  /** scheduled RDV that overlap a new séance */
  rdvConflicts: number;
};

export const EVENT_START_PAST = "La date de début ne peut pas être passée.";
export const EVENT_START_TOO_FAR = "La date de début doit être dans les deux prochaines années.";
export const EVENT_TYPE_UNAVAILABLE = "Un type de ticket choisi est archivé ou introuvable.";

/** The engine's own text for a cut before local today (src/lib/booking/series.ts), so both layers say the same. */
const PAST_FROM_DATE = "La modification doit partir d'aujourd'hui ou d'une date future.";
/** A new event may start at most this many days after local today (OUT L114). */
const START_MAX_DAYS = 730;

const versionSchema = z.number().int().min(1);
const durationSchema = z
  .number()
  .int()
  .min(BOUNDS.eventDurationMin.min)
  .max(BOUNDS.eventDurationMin.max)
  .multipleOf(BOUNDS.eventDurationMin.step);
const scheduleSchema = z.object({
  eventId: idSchema,
  fromDate: dateKeySchema,
  rule: recurrenceRuleSchema,
  durationMin: durationSchema,
});
const applySchema = scheduleSchema.extend({
  seenVersion: versionSchema,
  orphans: z.enum(["keep", "cancel"]),
});
const editInfoSchema = z.object({ eventId: idSchema, seenVersion: versionSchema, info: eventInfoSchema });
const deletePreviewSchema = z.object({ eventId: idSchema, fromDate: dateKeySchema });
const deleteFromSchema = deletePreviewSchema.extend({ seenVersion: versionSchema });
const newEventSchema = z.object({ rule: recurrenceRuleSchema, durationMin: durationSchema });

/* ───────────────────────────── Shared checks ───────────────────────────── */

/** NOTICE_TOO_LONG when the notice of the effective window (pro settings + overrides) outlasts its horizon (OUT L106). */
async function noticeProblem(db: Db, professionalId: string, overrides: WindowOverrides): Promise<string | null> {
  const pro = await readProWindow(db, professionalId);
  if (!pro) return null; // the engine answers not_found
  const window = effectiveWindow(pro, overrides);
  return noticeExceedsHorizon(window.minNoticeMinutes, window.bookingHorizonDays) ? NOTICE_TOO_LONG : null;
}

/**
 * True when each id is an active, non-rdv_free type of the pro, or (with
 * `eventId`) a type the event already links, which may have been archived
 * since: it stays until the pro unticks it (OUT L92).
 */
async function typesUsable(db: Db, professionalId: string, ids: readonly string[], eventId?: string): Promise<boolean> {
  if (ids.length === 0) return true;
  const linked =
    eventId === undefined
      ? sql`false`
      : sql`exists (select 1 from event_ticket_type l
          where l.event_id = ${eventId} and l.ticket_type_id = t.id and l.professional_id = ${professionalId})`;
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ticket_type t
    where t.professional_id = ${professionalId} and t.id = any(${textArray(ids)})
      and ((t.archived_at is null and not t.rdv_free) or ${linked})`);
  return Number(res.rows[0]?.n ?? 0) === ids.length;
}

/* ───────────────────────────── Create ───────────────────────────── */

/**
 * parseFr(eventInputSchema); the start date in [local today, today + 730];
 * the types deduped, each an active non-rdv_free type of the pro; the notice
 * of the effective window within its horizon; createEvent. Context "event".
 */
export async function createEventCore(
  db: Db,
  ctx: ProCtx,
  input: EventInput,
  now: Date,
): Promise<CoreResult<{ eventId: string; occurrenceCount: number }>> {
  const parsed = parseFr(eventInputSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const draft = parsed.data;

  const today = todayKey(now, ctx.timezone);
  if (draft.rule.startDate < today) return actionFail(EVENT_START_PAST);
  if (draft.rule.startDate > addDays(today, START_MAX_DAYS)) return actionFail(EVENT_START_TOO_FAR);

  const typeIds = [...new Set(draft.ticketTypeIds)];
  if (!(await typesUsable(db, ctx.professionalId, typeIds))) return actionFail(EVENT_TYPE_UNAVAILABLE);
  const tooLong = await noticeProblem(db, ctx.professionalId, draft.overrides);
  if (tooLong !== null) return actionFail(tooLong);

  const res = await createEvent(
    db,
    { professionalId: ctx.professionalId, event: { ...draft, ticketTypeIds: typeIds } },
    now,
  );
  if (!res.ok) return fromEngine(res, "event");
  return { ok: true, effects: res.effects, eventId: res.eventId, occurrenceCount: res.occurrenceCount };
}

/* ───────────────────────────── Informations (in place) ───────────────────────────── */

/**
 * « Informations » (in place on one segment, Q7): parseFr(eventInfoSchema);
 * the types deduped, each active and non-rdv_free OR already linked to this
 * event; the notice within its horizon; editEventInPlace with the full info
 * patch. Context "event".
 */
export async function editEventInfoCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; seenVersion: number; info: EventInfoInput },
  now: Date,
): Promise<CoreResult<{ version: number }>> {
  const parsed = parseFr(editInfoSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, seenVersion, info } = parsed.data;

  const typeIds = [...new Set(info.ticketTypeIds)];
  if (!(await typesUsable(db, ctx.professionalId, typeIds, eventId))) return actionFail(EVENT_TYPE_UNAVAILABLE);
  const tooLong = await noticeProblem(db, ctx.professionalId, info.overrides);
  if (tooLong !== null) return actionFail(tooLong);

  const res = await editEventInPlace(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      eventId,
      seenVersion,
      patch: {
        title: info.title,
        description: info.description,
        location: info.location,
        color: info.color,
        isPrivate: info.isPrivate,
        bookingMode: info.bookingMode,
        ticketTypeIds: typeIds,
        questions: info.questions,
        overrides: info.overrides,
        capacity: info.capacity,
      },
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "event");
  return { ok: true, effects: res.effects, version: res.version };
}

/* ───────────────────────────── Horaire et récurrence (cut) ───────────────────────────── */

/**
 * parseFr of the rule and the duration; previewSeriesEdit; describeSeriesEdit
 * for both orphan choices; the RDV that overlap the new dates over
 * [max(fromDate, today), today + MATERIALIZE_DAYS]. Context "series".
 */
export async function previewScheduleCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; fromDate: DateKey; rule: RecurrenceRuleInput; durationMin: number },
  now: Date,
): Promise<ActionResult<{ preview: SchedulePreview }>> {
  const parsed = parseFr(scheduleSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, fromDate, rule, durationMin } = parsed.data;

  const res = await previewSeriesEdit(db, { professionalId: ctx.professionalId, eventId, fromDate, rule, durationMin }, now);
  if (!res.ok) return fromEngine(res, "series");

  const today = todayKey(now, ctx.timezone);
  const dates = expand({ ...rule, durationMin }, ctx.timezone, maxKey(fromDate, today), addDays(today, MATERIALIZE_DAYS));
  const rdvConflicts = await countRdvConflicts(db, ctx.professionalId, dates);
  return {
    ok: true,
    preview: {
      summary: res.summary,
      textKeep: describeSeriesEdit(res.summary, "keep"),
      textCancel: describeSeriesEdit(res.summary, "cancel"),
      remainingCount: res.remainingCount,
      inPlace: res.inPlace,
      rdvConflicts,
    },
  };
}

/**
 * editSeriesFrom; `eventId` is the new segment after a split (the same event
 * when nothing precedes the cut). The engine's TIM1 refusal (« La série change
 * déjà à partir du … ») passes through. Context "series".
 */
export async function applyScheduleCore(
  db: Db,
  ctx: ProCtx,
  input: {
    eventId: string;
    seenVersion: number;
    fromDate: DateKey;
    rule: RecurrenceRuleInput;
    durationMin: number;
    orphans: "keep" | "cancel";
  },
  now: Date,
): Promise<CoreResult<{ eventId: string; summaryText: string }>> {
  const parsed = parseFr(applySchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, seenVersion, fromDate, rule, durationMin, orphans } = parsed.data;

  const res = await editSeriesFrom(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, eventId, seenVersion, fromDate, rule, durationMin, orphans },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, effects: res.effects, eventId: res.eventId, summaryText: describeSeriesEdit(res.summary, orphans) };
}

/* ───────────────────────────── Supprimer à partir du ───────────────────────────── */

/** deleteFromPreview behind validation (unknown, other pro's or finished event → « Événement introuvable ou terminé. »). */
export async function deleteEventPreviewCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; fromDate: DateKey },
  now: Date,
): Promise<ActionResult<{ preview: DeletePreview }>> {
  const parsed = parseFr(deletePreviewSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, fromDate } = parsed.data;
  if (fromDate < todayKey(now, ctx.timezone)) return actionFail(PAST_FROM_DATE);

  const preview = await deleteFromPreview(db, ctx.professionalId, eventId, fromDate, now);
  if (!preview) return fromEngine(fail("not_found"), "series");
  return { ok: true, preview };
}

/** deleteSeriesFrom (Q32: « Supprimer l'événement » is a cut from the first séance to come). Context "series". */
export async function deleteEventFromCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; seenVersion: number; fromDate: DateKey },
  now: Date,
): Promise<CoreResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number }>> {
  const parsed = parseFr(deleteFromSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, seenVersion, fromDate } = parsed.data;

  const res = await deleteSeriesFrom(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, eventId, seenVersion, fromDate },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return {
    ok: true,
    effects: res.effects,
    deletedEvent: res.deletedEvent,
    cancelledOccurrences: res.cancelledOccurrences,
    deletedOccurrences: res.deletedOccurrences,
  };
}

/* ───────────────────────────── Create-form preview ───────────────────────────── */

/**
 * The create form's preview: how many séances the rule would materialise (the
 * rows createEvent inserts: from the start date to the horizon, at most
 * MATERIALIZE_MAX_ROWS) and how many scheduled RDV overlap the ones still to come.
 */
export async function previewNewEventCore(
  db: Db,
  ctx: ProCtx,
  input: { rule: RecurrenceRuleInput; durationMin: number },
  now: Date,
): Promise<ActionResult<{ rdvConflicts: number; occurrenceCount: number }>> {
  const parsed = parseFr(newEventSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { rule, durationMin } = parsed.data;

  const full: RecurrenceRule = { ...rule, durationMin };
  const last = lastSeriesDate(full);
  const end = horizonEnd(now, ctx.timezone);
  const dates = expand(full, ctx.timezone, rule.startDate, last === null ? end : minKey(last, end)).slice(0, MATERIALIZE_MAX_ROWS);
  const today = todayKey(now, ctx.timezone);
  const rdvConflicts = await countRdvConflicts(
    db,
    ctx.professionalId,
    dates.filter((d) => d.seriesDate >= today),
  );
  return { ok: true, rdvConflicts, occurrenceCount: dates.length };
}
