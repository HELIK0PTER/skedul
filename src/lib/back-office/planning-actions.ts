/**
 * Planning write cores (spec § 11 E2, E6, E7, E8). Testable: every core takes
 * `(db, ctx, input, now)`, `professionalId` and `actorUserId` come from `ctx`
 * (built from the session by the wrapper), never from input. They import
 * neither server-only, next/*, @/lib/db (index), @/lib/env, @/lib/session nor
 * @/lib/auth. Input is validated with parseFr before the engine is called, so
 * no English zod message reaches the UI; engine failures become French through
 * fromEngine(res, context). Effects are returned for the wrapper to run after
 * commit.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { expiryLabel, formatWhenShort } from "@/lib/back-office/format";
import { moveTargets, registerOptions, searchCustomers, type CustomerHit } from "@/lib/back-office/planning-reads";
import { actionFail, fromEngine, type ActionFail, type ActionResult, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { cancelBookingsByPro, cancelOccurrence, restoreOccurrence } from "@/lib/booking/cancel";
import { registerPro } from "@/lib/booking/claims";
import { ruleOf } from "@/lib/booking/occurrences";
import {
  bookingsExpiringBefore,
  editEventInPlace,
  editSeriesFrom,
  previewSeriesEdit,
  updateOccurrence,
  type OccurrencePatch,
} from "@/lib/booking/series";
import { fail } from "@/lib/booking/types";
import { createCustomer, moveAttendee } from "@/lib/booking/wallet";
import { instantAt, type DateKey } from "@/lib/civil-date";
import { dayKeyInTz } from "@/lib/datetime";
import type { Db } from "@/lib/db/atomic";
import { booking, event, occurrence, ticketType } from "@/lib/db/schema";
import type { ProErrorContext } from "@/lib/pro-messages";
import { expandDates, remainingCount, type RecurrenceRule } from "@/lib/recurrence";
import { describeSeriesEdit } from "@/lib/series-plan";
import {
  BOUNDS,
  answersInputSchema,
  customerInputSchema,
  dateKeySchema,
  idSchema,
  type BookingCoverage,
  type BookingMode,
  type OccurrenceStatus,
  type RecurrenceRuleInput,
} from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export const TIME_PARTS_REQUIRED = "Indiquez la date et l'heure.";
export const FOLLOWING_DETACHED = "Cette séance ne fait plus partie de la série : modifiez-la seule.";
export const FOLLOWING_TIME_DETACHED =
  "Cette séance a été modifiée seule : elle ne suit plus l'horaire de la série. Enregistrez le changement pour cette séance seulement, ou ouvrez la séance suivante et choisissez « Appliquer aussi aux séances suivantes ».";

/** The engine's own texts for the refusals updateOccurrence makes while it plans (src/lib/booking/series.ts). */
const RDV_NOT_MOVABLE = "Un rendez-vous se déplace en l'annulant puis en le réservant à nouveau.";
const SEANCE_STARTED = "Une séance concernée a déjà commencé.";
const NEW_START_PAST = "La nouvelle date serait déjà passée.";

const startMinuteSchema = z.number().int().min(BOUNDS.startMinute.min).max(BOUNDS.startMinute.max);
const durationSchema = z
  .number()
  .int()
  .min(BOUNDS.eventDurationMin.min)
  .max(BOUNDS.eventDurationMin.max)
  .multipleOf(BOUNDS.eventDurationMin.step);

function notFound(context: ProErrorContext): ActionFail {
  return fromEngine(fail("not_found"), context);
}

type OccurrenceHead = {
  eventId: string | null;
  seriesDate: DateKey | null;
  status: OccurrenceStatus;
  startsAt: Date;
  timeDetached: boolean;
};

/** The pro's occurrence (null for an unknown id or another pro's). */
async function readOccurrenceOf(db: Db, professionalId: string, occurrenceId: string): Promise<OccurrenceHead | null> {
  const [row] = await db
    .select({
      eventId: occurrence.eventId,
      seriesDate: occurrence.seriesDate,
      status: occurrence.status,
      startsAt: occurrence.startsAt,
      timeDetached: occurrence.timeDetached,
    })
    .from(occurrence)
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId)));
  return row ?? null;
}

/* ───────────────────────── « Cette séance » ───────────────────────── */

export const occurrenceEditSchema = z.object({
  occurrenceId: idSchema,
  seenStartsAt: z.iso.datetime(),
  date: dateKeySchema.optional(),
  startMinute: startMinuteSchema.optional(),
  durationMin: durationSchema.optional(),
  locationOverride: z.string().trim().max(BOUNDS.location).nullable().optional(),
  unenrollBookingIds: z.array(idSchema).max(BOUNDS.capacity.max).default([]),
});
export type OccurrenceEditInput = z.input<typeof occurrenceEditSchema>;

/**
 * « Cette séance »: date + startMinute (both or neither, else TIME_PARTS_REQUIRED)
 * become instantAt(date, minute, ctx.timezone) on the server, never in the
 * browser; updateOccurrence with seenStartsAt = the instant the form was
 * rendered with. Context "occurrence".
 */
export async function updateOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: OccurrenceEditInput,
  now: Date,
): Promise<CoreResult<{ timeChanged: boolean }>> {
  const parsed = parseFr(occurrenceEditSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  if ((p.date === undefined) !== (p.startMinute === undefined)) return actionFail(TIME_PARTS_REQUIRED);

  const patch: OccurrencePatch = {};
  if (p.date !== undefined && p.startMinute !== undefined) patch.startsAt = instantAt(p.date, p.startMinute, ctx.timezone);
  if (p.durationMin !== undefined) patch.durationMin = p.durationMin;
  if (p.locationOverride !== undefined) patch.locationOverride = p.locationOverride;

  const res = await updateOccurrence(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      occurrenceId: p.occurrenceId,
      seenStartsAt: new Date(p.seenStartsAt),
      patch,
      unenrollBookingIds: p.unenrollBookingIds,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "occurrence");
  return { ok: true, effects: res.effects, timeChanged: res.timeChanged };
}

const expiringSchema = z.object({ occurrenceId: idSchema, date: dateKeySchema, startMinute: startMinuteSchema });

/**
 * What updateOccurrence would refuse for a start moved to `newStartsAt`, with its
 * own texts and codes, in its order (an RDV, a séance no longer scheduled, a séance
 * that has started, a new start already behind). The warning below is shown before
 * the save, so it must not list consequences of a move the save then refuses. The
 * engine's seenStartsAt guard needs the instant the form was rendered with, which
 * the warning does not receive, and a start that does not move is never a time
 * change here (the duration is not part of the warning).
 */
function moveRefusal(occ: OccurrenceHead, newStartsAt: Date, now: Date): ActionFail | null {
  if (occ.eventId === null) return fromEngine(fail("invalid", RDV_NOT_MOVABLE), "occurrence");
  if (occ.status !== "scheduled") return fromEngine(fail("changed"), "occurrence");
  if (newStartsAt.getTime() === occ.startsAt.getTime()) return null;
  if (occ.startsAt.getTime() <= now.getTime()) return fromEngine(fail("invalid", SEANCE_STARTED), "occurrence");
  if (newStartsAt.getTime() <= now.getTime()) return fromEngine(fail("invalid", NEW_START_PAST), "occurrence");
  return null;
}

/**
 * Preview of « Déplacement au-delà de la validité »: the confirmed ticket
 * bookings whose ticket ends at or before instantAt(date, minute, tz). The
 * occurrence is checked against the pro first, so a foreign id is « Séance
 * introuvable. » and never an empty list; a move updateOccurrenceCore would
 * refuse (moveRefusal) is refused here with the same failure.
 */
export async function expiringBeforeCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; date: DateKey; startMinute: number },
  now: Date,
): Promise<ActionResult<{ bookings: { bookingId: string; customerName: string; expiryText: string }[] }>> {
  const parsed = parseFr(expiringSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const occ = await readOccurrenceOf(db, ctx.professionalId, p.occurrenceId);
  if (!occ) return notFound("occurrence");
  const newStartsAt = instantAt(p.date, p.startMinute, ctx.timezone);
  const refusal = moveRefusal(occ, newStartsAt, now);
  if (refusal !== null) return refusal;
  const rows = await bookingsExpiringBefore(db, {
    professionalId: ctx.professionalId,
    occurrenceId: p.occurrenceId,
    newStartsAt,
  });
  return {
    ok: true,
    bookings: rows.map((r) => ({
      bookingId: r.bookingId,
      customerName: r.customerName,
      expiryText: expiryLabel(r.expiresAt, ctx.timezone, now),
    })),
  };
}

/* ───────────────────────── Capacity (Q19) ───────────────────────── */

const capacitySchema = z.object({
  occurrenceId: idSchema,
  seenStartsAt: z.iso.datetime(),
  scope: z.enum(["occurrence", "event"]),
  capacity: z.number().int().min(BOUNDS.capacity.min).max(BOUNDS.capacity.max),
  seenVersion: z.number().int().min(1).nullable(),
});

/**
 * Q19: scope "occurrence" = updateOccurrence({ capacity }) (the séance gets
 * capacity_override); scope "event" = editEventInPlace({ capacity }) on the
 * séance's event with the version the page was rendered with: it reaches the
 * future scheduled séances WITHOUT a capacity_override, the overridden ones keep
 * theirs. Neither ever goes below the seats already taken. Context "occurrence"
 * / "event".
 */
export async function updateCapacityCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; seenStartsAt: string; scope: "occurrence" | "event"; capacity: number; seenVersion: number | null },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(capacitySchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;

  if (p.scope === "occurrence") {
    const res = await updateOccurrence(
      db,
      {
        professionalId: ctx.professionalId,
        actorUserId: ctx.actorUserId,
        occurrenceId: p.occurrenceId,
        seenStartsAt: new Date(p.seenStartsAt),
        patch: { capacity: p.capacity },
      },
      now,
    );
    if (!res.ok) return fromEngine(res, "occurrence");
    return { ok: true, effects: res.effects };
  }

  const occ = await readOccurrenceOf(db, ctx.professionalId, p.occurrenceId);
  if (!occ || occ.eventId === null) return notFound("occurrence");
  if (p.seenVersion === null) return fromEngine(fail("stale"), "event");
  const res = await editEventInPlace(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      eventId: occ.eventId,
      seenVersion: p.seenVersion,
      patch: { capacity: p.capacity },
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "event");
  return { ok: true, effects: res.effects };
}

/* ───────────────────────── Cancel, restore, unenroll ───────────────────────── */

const occurrenceIdSchema = z.object({ occurrenceId: idSchema });

/** E6b: the séance (or the RDV) is cancelled, its bookings are ended and the tickets return. Context "cancel". */
export async function cancelOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string },
  now: Date,
): Promise<CoreResult<{ bookingsCancelled: number; ticketsReturned: number }>> {
  const parsed = parseFr(occurrenceIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await cancelOccurrence(
    db,
    { professionalId: ctx.professionalId, actorUserId: ctx.actorUserId, occurrenceId: parsed.data.occurrenceId },
    now,
  );
  if (!res.ok) return fromEngine(res, "cancel");
  return { ok: true, effects: res.effects, bookingsCancelled: res.bookingsCancelled, ticketsReturned: res.ticketsReturned };
}

/** « Rétablir »: a future event séance becomes scheduled again, empty. Context "restore". */
export async function restoreOccurrenceCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(occurrenceIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await restoreOccurrence(db, { professionalId: ctx.professionalId, occurrenceId: parsed.data.occurrenceId }, now);
  if (!res.ok) return fromEngine(res, "restore");
  return { ok: true, effects: res.effects };
}

const unenrollSchema = z.object({
  occurrenceId: idSchema,
  bookingIds: z.array(idSchema).min(1).max(BOUNDS.capacity.max),
  reason: z.string().trim().max(BOUNDS.note).nullable(),
});

/** E6a « Désinscrire » one or several bookings of one occurrence, any time (past séances too). Context "unenroll". */
export async function unenrollCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; bookingIds: string[]; reason: string | null },
  now: Date,
): Promise<CoreResult<{ cancelled: number; ticketsReturned: number }>> {
  const parsed = parseFr(unenrollSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await cancelBookingsByPro(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      occurrenceId: parsed.data.occurrenceId,
      bookingIds: parsed.data.bookingIds,
      reason: parsed.data.reason,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "unenroll");
  return { ok: true, effects: res.effects, cancelled: res.cancelled, ticketsReturned: res.ticketsReturned };
}

/* ───────────────────── « Cette séance et les suivantes » (time only) ───────────────────── */

/**
 * The rule of Q8 « Cette séance et les suivantes » from the dialog: the
 * event's own rule with startDate = this séance's series_date and the new
 * start minute; count mode keeps the dates left from here
 * (remainingCount(old, seriesDate)). It only makes sense for a séance that sits
 * on a date of the old rule: any other (past the last counted or until date,
 * off the weekday pattern or the interval, a month without that day) was kept
 * apart or brought back by « Rétablir », and the new rule starting there would
 * reshape the series around it (the planner would delete or cancel it). So when
 * expandDates(old, seriesDate, seriesDate) is empty the séance is refused with
 * FOLLOWING_DETACHED. That one check also covers the monthly « jour du mois »
 * rule whose series_date has another day than the rule's (such a rule only
 * produces dates on its own day), which is why there is no separate guard.
 */
export function followingRuleOf(
  old: RecurrenceRule,
  seriesDate: DateKey,
  startMinute: number,
): { ok: true; rule: RecurrenceRuleInput } | { ok: false; error: string } {
  if (expandDates(old, seriesDate, seriesDate).length === 0) return { ok: false, error: FOLLOWING_DETACHED };
  // A counted date of the rule: at least this one is left.
  const occurrenceCount = old.endMode === "count" ? remainingCount(old, seriesDate) : old.occurrenceCount;
  return {
    ok: true,
    rule: {
      startDate: seriesDate,
      startMinute,
      freq: old.freq,
      interval: old.interval,
      weekdays: old.weekdays,
      monthlyBy: old.monthlyBy,
      monthWeek: old.monthWeek,
      endMode: old.endMode,
      untilDate: old.untilDate,
      occurrenceCount,
    },
  };
}

type FollowingTarget = { ok: true; eventId: string; fromDate: DateKey; rule: RecurrenceRuleInput };

/**
 * The event segment owning this séance (the pro's, not archived) and the rule to apply from the séance's date.
 * A séance whose time was changed alone (time_detached) is refused: the planner keeps such a row where it is
 * (reparentOnly), so the preview would count it among the séances to change while the apply leaves it behind.
 */
async function followingTarget(
  db: Db,
  ctx: ProCtx,
  occurrenceId: string,
  startMinute: number,
): Promise<FollowingTarget | ActionFail> {
  const occ = await readOccurrenceOf(db, ctx.professionalId, occurrenceId);
  if (!occ || occ.eventId === null || occ.seriesDate === null) return notFound("series");
  const [ev] = await db
    .select()
    .from(event)
    .where(and(eq(event.id, occ.eventId), eq(event.professionalId, ctx.professionalId)));
  if (!ev || ev.archivedAt !== null) return notFound("series");
  if (occ.timeDetached) return actionFail(FOLLOWING_TIME_DETACHED);
  const built = followingRuleOf(ruleOf(ev), occ.seriesDate, startMinute);
  if (!built.ok) return actionFail(built.error);
  return { ok: true, eventId: ev.id, fromDate: occ.seriesDate, rule: built.rule };
}

const previewFollowingSchema = z.object({ occurrenceId: idSchema, startMinute: startMinuteSchema, durationMin: durationSchema });
const applyFollowingSchema = previewFollowingSchema.extend({ seenVersion: z.number().int().min(1) });

/**
 * The preview of the same edit as applyFollowingCore, no write: « 12 séances modifiées, 3 inscrits prévenus ».
 * previewSeriesEdit runs the very reads and plan of editSeriesFrom, so the refusals are the same (a started
 * séance, a cut before today, a new time already behind, a later segment); only the version guard is the
 * action's own. Context "series".
 */
export async function previewFollowingCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; startMinute: number; durationMin: number },
  now: Date,
): Promise<ActionResult<{ text: string; fromDate: DateKey }>> {
  const parsed = parseFr(previewFollowingSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const target = await followingTarget(db, ctx, p.occurrenceId, p.startMinute);
  if (!target.ok) return target;
  const res = await previewSeriesEdit(
    db,
    {
      professionalId: ctx.professionalId,
      eventId: target.eventId,
      fromDate: target.fromDate,
      rule: target.rule,
      durationMin: p.durationMin,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, text: describeSeriesEdit(res.summary, "keep"), fromDate: target.fromDate };
}

/** editSeriesFrom from this séance's date, orphans kept (a time change never removes a date). eventId = the segment after a split. Context "series". */
export async function applyFollowingCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; seenVersion: number; startMinute: number; durationMin: number },
  now: Date,
): Promise<CoreResult<{ eventId: string; summaryText: string }>> {
  const parsed = parseFr(applyFollowingSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;
  const target = await followingTarget(db, ctx, p.occurrenceId, p.startMinute);
  if (!target.ok) return target;
  const res = await editSeriesFrom(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      eventId: target.eventId,
      seenVersion: p.seenVersion,
      fromDate: target.fromDate,
      rule: target.rule,
      durationMin: p.durationMin,
      orphans: "keep",
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "series");
  return { ok: true, effects: res.effects, eventId: res.eventId, summaryText: describeSeriesEdit(res.summary, "keep") };
}

/* ───────────────────────── Attendees: register and move ───────────────────────── */

export const REGISTER_RDV = "Un rendez-vous ne s'inscrit pas depuis le planning.";
export const REGISTER_NONE_GUEST = "Séance sans réservation en ligne : inscrivez ce client comme invité.";
export const REGISTER_NO_TICKET_MODE = "Cette séance n'accepte pas de ticket : choisissez « Invité ».";
export const CONVERSION_TYPE_UNAVAILABLE = "Ce type ne peut pas recevoir de tickets.";
export const MOVE_NOT_MOVABLE = "Cette inscription ne peut pas être déplacée.";
export const MOVE_TARGET_UNAVAILABLE = "La séance choisie n'est plus disponible.";

export const registerInputSchema = z.object({
  occurrenceId: idSchema,
  customer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), customerId: idSchema }),
    z.object({ kind: z.literal("new"), name: z.string(), email: z.string(), phone: z.string().nullable() }),
  ]),
  coverage: z.enum(["auto", "guest"]),
  ticketId: idSchema.nullable(),
  extraSeat: z.boolean(),
  answers: answersInputSchema,
});
export type RegisterInput = z.input<typeof registerInputSchema>;

/**
 * E2 pro « Inscrire » (steps in this exact order): 1) validate; 2) the
 * occurrence of the pro: unknown « Séance introuvable. », an RDV
 * REGISTER_RDV, a cancelled one the register « unavailable » wording; 3) mode
 * « none » needs « Invité » (REGISTER_NONE_GUEST), a ticket needs the tickets
 * mode and no « Invité » (REGISTER_NO_TICKET_MODE); 4) the customer: an
 * existing id (the engine checks it belongs to the pro) or a new one made
 * with the engine's createCustomer (name, e-mail trimmed and validated, the
 * e-mail is the key: an existing e-mail is reused, `customerCreated` false);
 * 5) registerPro (ticket in tickets mode, free in free mode, « Invité » on
 * request; « +1 place » through `extraSeat`). A refused registration after a
 * new client was typed leaves that client in the list, like any started
 * booking. Context "register" (the customer creation uses "customer").
 *
 * Identity: professionalId and actorUserId are ctx's. The schema is not
 * passthrough, so a key the form does not know (a professionalId, an
 * actorUserId, a userId on the typed client) is dropped by parseFr and can
 * never reach the engine; a typed client is created without any user id, and
 * the engine does not check that the actor belongs to the pro, which is why
 * only ctx may feed it. The engine's refusals reach the pro in pro wording
 * (proErrorMessage, "register" context): already_booked is « Ce client est
 * déjà inscrit à cette séance. », never the client's « Vous êtes déjà
 * inscrit(e) ».
 */
export async function registerAttendeeCore(
  db: Db,
  ctx: ProCtx,
  input: RegisterInput,
  now: Date,
): Promise<CoreResult<{ bookingId: string; customerId: string; coverage: BookingCoverage; customerCreated: boolean }>> {
  const parsed = parseFr(registerInputSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;

  const [occ] = await db
    .select({ eventId: occurrence.eventId, status: occurrence.status, mode: event.bookingMode })
    .from(occurrence)
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .where(and(eq(occurrence.id, p.occurrenceId), eq(occurrence.professionalId, ctx.professionalId)));
  if (!occ) return notFound("occurrence");
  if (occ.eventId === null || occ.mode === null) return actionFail(REGISTER_RDV);
  if (occ.status !== "scheduled") return fromEngine(fail("unavailable"), "register");

  if (occ.mode === "none" && p.coverage === "auto") return actionFail(REGISTER_NONE_GUEST);
  if (p.ticketId !== null && (p.coverage === "guest" || occ.mode !== "tickets")) return actionFail(REGISTER_NO_TICKET_MODE);

  let customerId: string;
  let customerCreated = false;
  if (p.customer.kind === "existing") {
    customerId = p.customer.customerId;
  } else {
    const typed = parseFr(customerInputSchema, {
      name: p.customer.name,
      email: p.customer.email.trim(),
      phone: p.customer.phone ?? undefined,
    });
    if (!typed.ok) return actionFail(typed.error);
    const created = await createCustomer(
      db,
      { professionalId: ctx.professionalId, name: typed.data.name, email: typed.data.email, phone: typed.data.phone ?? null },
      now,
    );
    if (!created.ok) return fromEngine(created, "customer");
    customerId = created.customerId;
    customerCreated = created.created;
  }

  const res = await registerPro(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      occurrenceId: p.occurrenceId,
      customerId,
      asGuest: p.coverage === "guest",
      ticketId: p.ticketId,
      extraSeat: p.extraSeat,
      answers: p.answers,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "register");
  return { ok: true, effects: res.effects, bookingId: res.bookingId, customerId, coverage: res.coverage, customerCreated };
}

const moveSchema = z.object({
  bookingId: idSchema,
  targetOccurrenceId: idSchema,
  force: z.boolean(),
  convertToTicketTypeId: idSchema.nullable(),
});

/**
 * E8 « Déplacer »: a conversion type must be an active, non rdv_free type of
 * the pro (CONVERSION_TYPE_UNAVAILABLE), then moveAttendee. The engine's
 * `ticket_expires_before` comes back with that code and the pro wording, so
 * the UI offers « Déplacer quand même » (force). Context "move".
 */
export async function moveAttendeeCore(
  db: Db,
  ctx: ProCtx,
  input: { bookingId: string; targetOccurrenceId: string; force: boolean; convertToTicketTypeId: string | null },
  now: Date,
): Promise<CoreResult<{ converted: boolean }>> {
  const parsed = parseFr(moveSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const p = parsed.data;

  if (p.convertToTicketTypeId !== null) {
    const [usable] = await db
      .select({ id: ticketType.id })
      .from(ticketType)
      .where(
        and(
          eq(ticketType.id, p.convertToTicketTypeId),
          eq(ticketType.professionalId, ctx.professionalId),
          isNull(ticketType.archivedAt),
          eq(ticketType.rdvFree, false),
        ),
      );
    if (!usable) return actionFail(CONVERSION_TYPE_UNAVAILABLE);
  }

  const res = await moveAttendee(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      bookingId: p.bookingId,
      targetOccurrenceId: p.targetOccurrenceId,
      force: p.force,
      convertToTicketTypeId: p.convertToTicketTypeId ?? undefined,
    },
    now,
  );
  if (!res.ok) {
    // moveAttendee answers not_eligible for a target that is no longer scheduled, an RDV, or a type it does not
    // accept. The « choisissez un type vers lequel le convertir » wording only makes sense for a booking that holds
    // a ticket; a guest or free booking has nothing to convert, so the target itself is the problem.
    if (res.code === "not_eligible" && (await holdsNoTicket(db, ctx.professionalId, p.bookingId))) {
      return actionFail(MOVE_TARGET_UNAVAILABLE, res.code);
    }
    return fromEngine(res, "move");
  }
  return { ok: true, effects: res.effects, converted: res.conversion !== null };
}

/** True when the pro's booking exists and is not covered by a ticket (guest or free). */
async function holdsNoTicket(db: Db, professionalId: string, bookingId: string): Promise<boolean> {
  const [row] = await db
    .select({ coverage: booking.coverage })
    .from(booking)
    .where(and(eq(booking.id, bookingId), eq(booking.professionalId, professionalId)));
  return row !== undefined && row.coverage !== "ticket";
}

const searchSchema = z.object({ q: z.string().max(254) });

/** The customer search of « Inscrire » behind validation (the read trims, needs 2 characters, escapes wildcards). */
export async function searchCustomersCore(
  db: Db,
  ctx: ProCtx,
  input: { q: string },
  now: Date,
): Promise<ActionResult<{ customers: CustomerHit[] }>> {
  void now;
  const parsed = parseFr(searchSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  return { ok: true, customers: await searchCustomers(db, ctx.professionalId, parsed.data.q) };
}

const registerOptionsSchema = z.object({ occurrenceId: idSchema, customerId: idSchema });

/** registerOptions as client data: each usable ticket as « {type} · {validité} » (+ « · offert »). A null read is « Séance ou client introuvable. ». */
export async function registerOptionsCore(
  db: Db,
  ctx: ProCtx,
  input: { occurrenceId: string; customerId: string },
  now: Date,
): Promise<ActionResult<{ mode: BookingMode; alreadyBooked: boolean; usable: { id: string; label: string }[] }>> {
  const parsed = parseFr(registerOptionsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const options = await registerOptions(db, ctx.professionalId, parsed.data.occurrenceId, parsed.data.customerId, now);
  if (!options) return fromEngine(fail("not_found"), "register");
  return {
    ok: true,
    mode: options.mode,
    alreadyBooked: options.alreadyBooked,
    usable: options.usable.map((u) => ({
      id: u.id,
      label: `${u.typeName} · ${expiryLabel(u.expiresAt, ctx.timezone, now)}${u.purchased ? "" : " · offert"}`,
    })),
  };
}

export type MoveTargetVM = {
  occurrenceId: string;
  seriesRootId: string;
  title: string;
  /** « lun. 12/10 · 19:00 » in the pro zone */
  whenLabel: string;
  /** the local day, to group the targets */
  dayKey: DateKey;
  seatsShown: number;
  capacity: number;
  full: boolean;
  accepted: boolean;
  conversionTypes: { id: string; name: string }[];
  expiresBefore: boolean;
  /** the moved client already holds a live seat there: the move is refused with « already_booked », so the UI disables the target */
  customerBooked: boolean;
};

const moveTargetsSchema = z.object({ bookingId: idSchema, seriesRootId: idSchema.nullable() });

/** moveTargets as client data (labels and days computed in the pro zone). A null read is MOVE_NOT_MOVABLE. */
export async function moveTargetsCore(
  db: Db,
  ctx: ProCtx,
  input: { bookingId: string; seriesRootId: string | null },
  now: Date,
): Promise<ActionResult<{ series: { seriesRootId: string; title: string }[]; targets: MoveTargetVM[] }>> {
  const parsed = parseFr(moveTargetsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await moveTargets(db, ctx.professionalId, parsed.data.bookingId, now, { seriesRootId: parsed.data.seriesRootId });
  if (!res) return actionFail(MOVE_NOT_MOVABLE);
  return {
    ok: true,
    series: res.series,
    targets: res.targets.map(
      (t): MoveTargetVM => ({
        occurrenceId: t.occurrenceId,
        seriesRootId: t.seriesRootId,
        title: t.title,
        whenLabel: formatWhenShort(t.startsAt, ctx.timezone),
        dayKey: dayKeyInTz(t.startsAt, ctx.timezone),
        seatsShown: t.seatsShown,
        capacity: t.capacity,
        full: t.full,
        accepted: t.accepted,
        conversionTypes: t.conversionTypes,
        expiresBefore: t.expiresBefore,
        customerBooked: t.customerBooked,
      }),
    ),
  };
}
