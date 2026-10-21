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

import { loadQuestions } from "@/lib/booking/answers";
import { createEvent, horizonEnd } from "@/lib/booking/occurrences";
import { deleteSeriesFrom, editEventInPlace, editSeriesFrom, previewSeriesEdit } from "@/lib/booking/series";
import { fail, type Effect } from "@/lib/booking/types";
import { effectiveWindow } from "@/lib/booking-window";
import { addDays, maxKey, minKey, todayKey, type DateKey } from "@/lib/civil-date";
import { textArray, ts, type Db } from "@/lib/db/atomic";
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
import { countRdvConflicts, deleteFromPreview, loadLaterSegments, type DeletePreview, type LaterSegment } from "./event-reads";
import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "./notice";
import { actionFail, fromEngine, type ActionResult, type CoreResult, type ProCtx } from "./result";
import { questionsForSegment } from "./series-questions";

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

/**
 * A delete or an information edit reaches the segment AND every later segment of its series, one engine batch each
 * (each with its own version guard). When a later one fails after another went through, the action answers "ok" with
 * what was done (its effects must still run) and one of these sentences, which the form shows instead of its success.
 */
export const SERIES_DELETE_INCOMPLETE = "Une partie seulement a été supprimée. Rechargez la page, puis supprimez de nouveau pour finir.";
export const SERIES_INFO_INCOMPLETE =
  "Les informations sont enregistrées ici, mais pas sur la suite de la série. Rechargez la page et recommencez.";

/** The engine's own text for a cut before local today (src/lib/booking/series.ts), so both layers say the same. */
const PAST_FROM_DATE = "La modification doit partir d'aujourd'hui ou d'une date future.";
/** The two refusals of deleteSeriesFrom that the delete preview must reproduce (src/lib/booking/series.ts). */
const SEANCE_STARTED = "Une séance concernée a déjà commencé.";
const LEFTOVER_BEFORE = "Une séance isolée avec inscrits reste avant cette date. Annulez-la d'abord.";
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
/** The later segments the page showed, each with the version it had: the guard of the segments the form does not own. */
const laterSchema = z.array(z.object({ eventId: idSchema, version: versionSchema })).max(200).default([]);
const editInfoSchema = z.object({ eventId: idSchema, seenVersion: versionSchema, info: eventInfoSchema, later: laterSchema });
const deletePreviewSchema = z.object({ eventId: idSchema, fromDate: dateKeySchema });
const deleteFromSchema = deletePreviewSchema.extend({ seenVersion: versionSchema, later: laterSchema });
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

/** True when `startDate` is more than 730 days after the pro's local today (Decision 15's typo guard, creation and schedule cut alike). */
function startTooFar(startDate: DateKey, tz: string, now: Date): boolean {
  return startDate > addDays(todayKey(now, tz), START_MAX_DAYS);
}

/**
 * The start window of a NEW event, shared by the create core and the create-form
 * preview so both refuse the same things with the same text: the start date is in
 * [local today, today + 730], and the first séance the rule produces has not
 * started yet (one inserted at or before `now` could not be deleted from today
 * afterwards: the engine refuses a delete that reaches a started séance). Dates
 * are the pro's local days (`tz`), never the host's. Null when the start is fine.
 */
function startProblem(rule: RecurrenceRuleInput, durationMin: number, tz: string, now: Date): string | null {
  const today = todayKey(now, tz);
  if (rule.startDate < today) return EVENT_START_PAST;
  if (startTooFar(rule.startDate, tz, now)) return EVENT_START_TOO_FAR;
  // A first séance on a later local day starts after `now`: only a start date of today can already be behind us.
  if (rule.startDate === today) {
    const [first] = expand({ ...rule, durationMin }, tz, today, today);
    if (first !== undefined && first.startsAt.getTime() <= now.getTime()) return EVENT_START_PAST;
  }
  return null;
}

/**
 * The two refusals deleteSeriesFrom makes after its plan reads, which the delete
 * preview does not reproduce on its own (same predicates as src/lib/booking/series.ts,
 * checked in the same order, scoped to the pro): (a) any séance of the event, whatever
 * its status, with a local date at or after `fromDate` and a start at or before `now`;
 * (b) a cut that archives the segment (`fromDate` at or before its start date) while a
 * scheduled séance to come is left before `fromDate`. Null when the delete would not
 * refuse (an unknown or archived event is the caller's not_found).
 */
async function deleteRefusal(db: Db, professionalId: string, eventId: string, fromDate: DateKey, now: Date): Promise<string | null> {
  const res = await db.execute<{ started: boolean; archive: boolean; live_before: boolean }>(sql`
    select
      exists (select 1 from occurrence o
        where o.professional_id = e.professional_id and o.event_id = e.id
          and o.series_date >= ${fromDate}::date and o.starts_at <= ${ts(now)}) as started,
      (${fromDate}::date <= e.start_date) as archive,
      exists (select 1 from occurrence o
        where o.professional_id = e.professional_id and o.event_id = e.id
          and o.series_date < ${fromDate}::date and o.status = 'scheduled' and o.starts_at > ${ts(now)}) as live_before
    from event e
    where e.id = ${eventId} and e.professional_id = ${professionalId} and e.archived_at is null`);
  const flags = res.rows[0];
  if (!flags) return null;
  if (flags.started === true) return SEANCE_STARTED;
  // A leftover can only precede fromDate when rows exist before it, so the engine's physical-delete
  // branch (no row before, never booked) never meets this one: no need to know about deleteWhole here.
  if (flags.archive === true && flags.live_before === true) return LEFTOVER_BEFORE;
  return null;
}

/** True when the later segments the page saw are exactly the ones there are now, each at the version it was seen at. */
function sameSegments(current: readonly LaterSegment[], seen: readonly LaterSegment[]): boolean {
  return (
    current.length === seen.length &&
    current.every((c) => seen.some((t) => t.eventId === c.eventId && t.version === c.version))
  );
}

/** Test-only hook of the cores that walk a series: runs after each segment's batch went through. */
type StepHook = { afterStep?: (eventId: string) => Promise<void> };

/* ───────────────────────────── Create ───────────────────────────── */

/**
 * parseFr(eventInputSchema); the start window (`startProblem`: the start date in
 * [local today, today + 730] and a first séance that has not started); the types deduped (none unless the mode is « Sur tickets »), each an active non-rdv_free type of the pro; the notice
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

  const badStart = startProblem(draft.rule, draft.durationMin, ctx.timezone, now);
  if (badStart !== null) return actionFail(badStart);

  // Only « Sur tickets » accepts tickets: any other mode carries no link (the browser rule is not enough).
  const typeIds = draft.bookingMode === "tickets" ? [...new Set(draft.ticketTypeIds)] : [];
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
 * « Informations » (in place, Q7): parseFr(eventInfoSchema); the later segments of the series must be the ones the page
 * saw, at the versions it saw (else stale: nothing is written); the types deduped (none unless the mode is « Sur
 * tickets »: any other mode drops the links), each active and non-rdv_free OR already linked to that segment; the
 * notice within its horizon; then editEventInPlace on the segment and on each later segment, earliest first, each with
 * its own version guard and with the questions followed onto its own copies (questionsForSegment). A later segment that
 * fails once the first is saved answers "ok" with `incomplete` (SERIES_INFO_INCOMPLETE). `version` is the segment's.
 * Context "event".
 */
export async function editEventInfoCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; seenVersion: number; info: EventInfoInput; later?: readonly LaterSegment[] },
  now: Date,
  opts: StepHook = {},
): Promise<CoreResult<{ version: number; incomplete: string | null }>> {
  const parsed = parseFr(editInfoSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, seenVersion, info, later: seenLater } = parsed.data;

  const later = await loadLaterSegments(db, ctx.professionalId, eventId);
  if (later === null) return fromEngine(fail("not_found"), "event");
  if (!sameSegments(later, seenLater)) return fromEngine(fail("stale"), "event");

  // Only « Sur tickets » accepts tickets: any other mode drops every link (the browser rule is not enough).
  const typeIds = info.bookingMode === "tickets" ? [...new Set(info.ticketTypeIds)] : [];
  for (const id of [eventId, ...later.map((s) => s.eventId)]) {
    if (!(await typesUsable(db, ctx.professionalId, typeIds, id))) return actionFail(EVENT_TYPE_UNAVAILABLE);
  }
  const tooLong = await noticeProblem(db, ctx.professionalId, info.overrides);
  if (tooLong !== null) return actionFail(tooLong);

  // Read before the first write: the edit rewrites the questions of the segment the pro opened.
  const sourceQuestions = later.length === 0 ? [] : await loadQuestions(db, { eventId });
  const patchFor = (questions: typeof info.questions) => ({
    title: info.title,
    description: info.description,
    location: info.location,
    color: info.color,
    isPrivate: info.isPrivate,
    bookingMode: info.bookingMode,
    ticketTypeIds: typeIds,
    questions,
    overrides: info.overrides,
    capacity: info.capacity,
  });

  const first = await editEventInPlace(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, eventId, seenVersion, patch: patchFor(info.questions) },
    now,
  );
  if (!first.ok) return fromEngine(first, "event");
  const effects: Effect[] = [...first.effects];
  await opts.afterStep?.(eventId);

  for (const segment of later) {
    const targetQuestions = await loadQuestions(db, { eventId: segment.eventId });
    const res = await editEventInPlace(
      db,
      {
        professionalId: ctx.professionalId,
        actorUserId: ctx.actorUserId,
        eventId: segment.eventId,
        seenVersion: segment.version,
        patch: patchFor(questionsForSegment(info.questions, sourceQuestions, targetQuestions)),
      },
      now,
    );
    if (!res.ok) return { ok: true, effects, version: first.version, incomplete: SERIES_INFO_INCOMPLETE };
    effects.push(...res.effects);
    await opts.afterStep?.(segment.eventId);
  }
  return { ok: true, effects, version: first.version, incomplete: null };
}

/* ───────────────────────────── Horaire et récurrence (cut) ───────────────────────────── */

/**
 * parseFr of the rule and the duration; the new rule's start within 730 days (EVENT_START_TOO_FAR, like a creation); previewSeriesEdit; describeSeriesEdit
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
  if (startTooFar(rule.startDate, ctx.timezone, now)) return actionFail(EVENT_START_TOO_FAR);

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
 * The new rule's start within 730 days (EVENT_START_TOO_FAR, like a creation), then editSeriesFrom; `eventId` is the new segment after a split (the same event
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
  if (startTooFar(rule.startDate, ctx.timezone, now)) return actionFail(EVENT_START_TOO_FAR);

  const res = await editSeriesFrom(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, eventId, seenVersion, fromDate, rule, durationMin, orphans },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, effects: res.effects, eventId: res.eventId, summaryText: describeSeriesEdit(res.summary, orphans) };
}

/* ───────────────────────────── Supprimer à partir du ───────────────────────────── */

/**
 * deleteFromPreview behind validation (unknown, other pro's or finished event → « Événement introuvable ou terminé. »).
 * The preview computes consequences but not the engine's refusals, so the ones deleteEventFromCore would
 * answer are answered here first, with the engine's own texts: the confirm dialog never lists
 * consequences of a delete that is then refused. The delete reaches the later segments of the series too, so they
 * are refused (a started séance, a leftover) and counted like the segment itself.
 */
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
  const later = await loadLaterSegments(db, ctx.professionalId, eventId);
  for (const id of [eventId, ...(later ?? []).map((s) => s.eventId)]) {
    const refusal = await deleteRefusal(db, ctx.professionalId, id, fromDate, now);
    if (refusal !== null) return actionFail(refusal);
  }

  const preview = await deleteFromPreview(db, ctx.professionalId, eventId, fromDate, now);
  if (!preview) return fromEngine(fail("not_found"), "series");
  return { ok: true, preview };
}

/**
 * deleteSeriesFrom (Q32: « Supprimer l'événement » is a cut from the first séance to come) on the segment AND on each
 * later non-archived segment of its series, from the same date: the page's view of the later segments must still be
 * true (else stale, nothing is written), the refusals are answered before the first write, then one engine batch per
 * segment, the LATEST first (so the earlier one finds nothing rooted on it when the later ones are physically gone),
 * each with its own version guard. A segment that fails once another went through answers "ok" with what was done
 * (its effects must still run) and `incomplete` (SERIES_DELETE_INCOMPLETE). Context "series".
 */
export async function deleteEventFromCore(
  db: Db,
  ctx: ProCtx,
  input: { eventId: string; seenVersion: number; fromDate: DateKey; later?: readonly LaterSegment[] },
  now: Date,
  opts: StepHook = {},
): Promise<CoreResult<{ deletedEvent: boolean; cancelledOccurrences: number; deletedOccurrences: number; incomplete: string | null }>> {
  const parsed = parseFr(deleteFromSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { eventId, seenVersion, fromDate, later: seenLater } = parsed.data;

  const later = await loadLaterSegments(db, ctx.professionalId, eventId);
  if (later === null) return fromEngine(fail("not_found"), "series");
  if (!sameSegments(later, seenLater)) return fromEngine(fail("stale"), "series");
  if (fromDate < todayKey(now, ctx.timezone)) return actionFail(PAST_FROM_DATE);
  for (const id of [eventId, ...later.map((s) => s.eventId)]) {
    const refusal = await deleteRefusal(db, ctx.professionalId, id, fromDate, now);
    if (refusal !== null) return actionFail(refusal);
  }

  const steps = [...later].reverse().map((s) => ({ eventId: s.eventId, seenVersion: s.version }));
  steps.push({ eventId, seenVersion });

  const effects: Effect[] = [];
  let cancelledOccurrences = 0;
  let deletedOccurrences = 0;
  let deletedEvent = false;
  for (const [index, step] of steps.entries()) {
    const res = await deleteSeriesFrom(
      db,
      { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, eventId: step.eventId, seenVersion: step.seenVersion, fromDate },
      now,
    );
    if (!res.ok) {
      if (index === 0) return fromEngine(res, "series");
      return { ok: true, effects, deletedEvent: false, cancelledOccurrences, deletedOccurrences, incomplete: SERIES_DELETE_INCOMPLETE };
    }
    effects.push(...res.effects);
    cancelledOccurrences += res.cancelledOccurrences;
    deletedOccurrences += res.deletedOccurrences;
    if (step.eventId === eventId) deletedEvent = res.deletedEvent;
    await opts.afterStep?.(step.eventId);
  }
  return { ok: true, effects, deletedEvent, cancelledOccurrences, deletedOccurrences, incomplete: null };
}

/* ───────────────────────────── Create-form preview ───────────────────────────── */

/**
 * The create form's preview: how many séances the rule would materialise (the
 * rows createEvent inserts: from the start date to the horizon, at most
 * MATERIALIZE_MAX_ROWS) and how many scheduled RDV overlap them. The start date
 * is held to the same window as createEventCore (`startProblem`), so a start the
 * create would refuse never gets a count.
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
  const badStart = startProblem(rule, durationMin, ctx.timezone, now);
  if (badStart !== null) return actionFail(badStart);

  const full: RecurrenceRule = { ...rule, durationMin };
  const last = lastSeriesDate(full);
  const end = horizonEnd(now, ctx.timezone);
  const dates = expand(full, ctx.timezone, rule.startDate, last === null ? end : minKey(last, end)).slice(0, MATERIALIZE_MAX_ROWS);
  const rdvConflicts = await countRdvConflicts(db, ctx.professionalId, dates);
  return { ok: true, rdvConflicts, occurrenceCount: dates.length };
}
