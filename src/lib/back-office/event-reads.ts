/**
 * Event reads (spec § 13.1, Q9): the events list (one row per series, on its
 * current segment), the editor data of a segment, the RDV conflicts of a set of
 * dates and the preview of « Supprimer à partir du ». Plain functions of
 * `(db, professionalId, ..., now)`: no session, no Next, no server-only, so the
 * DB tests call them directly. Every query filters on `professional_id`.
 */
import { and, asc, eq, gt, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { listActiveTypeOptions, readProWindow, type TypeOption } from "@/lib/back-office/catalog-reads";
import { loadQuestions, type QuestionRow } from "@/lib/booking/answers";
import { ruleOf, type EventRow } from "@/lib/booking/occurrences";
import type { BookingWindow } from "@/lib/booking-window";
import type { DateKey } from "@/lib/civil-date";
import { ts, tsArray, type Db } from "@/lib/db/atomic";
import { booking, event, eventTicketType, occurrence, ticketType } from "@/lib/db/schema";
import { describeRecurrence, lastSeriesDate, remainingCount } from "@/lib/recurrence";
import type { BookingMode, OccurrenceStatus, RecurrenceRuleInput, WindowOverrides } from "@/lib/tickets";

/* ───────────────────────────── Types ───────────────────────────── */

export type EventListRow = {
  /** The current segment (Q9). */
  eventId: string;
  seriesRootId: string;
  title: string;
  color: string;
  bookingMode: BookingMode;
  isPrivate: boolean;
  recurrenceLabel: string;
  acceptedTypes: { id: string; name: string; color: string; archived: boolean }[];
  nextOccurrence: { id: string; startsAt: Date } | null;
  /** tickets mode and no non-archived linked type */
  noActiveType: boolean;
};

export type EventSegmentView = {
  eventId: string;
  recurrenceLabel: string;
  firstDate: DateKey;
  lastDate: DateKey | null;
  archived: boolean;
};

export type DeletePreview = {
  fromDate: DateKey;
  deleteWhole: boolean;
  deletedSeances: number;
  cancelledSeances: number;
  registrants: number;
  ticketsReturned: number;
};

export type EventEditorData = {
  event: {
    id: string;
    seriesRootId: string;
    version: number;
    title: string;
    description: string | null;
    location: string | null;
    color: string;
    bookingMode: BookingMode;
    isPrivate: boolean;
    capacity: number;
    durationMin: number;
    overrides: WindowOverrides;
    ticketTypeIds: string[];
    questions: QuestionRow[];
    rule: RecurrenceRuleInput;
    recurrenceLabel: string;
    archived: boolean;
  };
  /** The segment is archived (every segment of the root is). */
  readOnly: boolean;
  /** series_date of the first scheduled séance of this segment with starts_at > now (the cut d). */
  fromDate: DateKey | null;
  /** remainingCount(ruleOf(event), fromDate) in count mode. */
  remainingCount: number | null;
  /**
   * The next 10 séances (scheduled or cancelled) of this segment. `seatsTaken` still counts the pending holds that
   * have lapsed and that nobody has released yet; `elapsedHolds` is how many those are (the engine's
   * expireElapsedHolds rule: pending and hold_expires_at < now), so that seatsShown() gives the truthful figure.
   */
  upcoming: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    status: OccurrenceStatus;
    seatsTaken: number;
    elapsedHolds: number;
    capacity: number;
  }[];
  /** Same root, other segments, by firstDate. */
  otherSegments: EventSegmentView[];
  /** Active and not rdv_free. */
  typeOptions: TypeOption[];
  linkedArchivedTypes: { id: string; name: string }[];
  /** Live bookings that a change of place would warn: future scheduled séances without their own place. */
  futureRegistrants: number;
  /** deleteFromPreview(fromDate) when fromDate is set and the event is not read-only. */
  deletePreview: DeletePreview | null;
  proWindow: BookingWindow;
};

export type EventEditorLookup = { kind: "ok"; data: EventEditorData } | { kind: "redirect"; eventId: string } | null;

/* ───────────────────────────── Segments ───────────────────────────── */

type NextSeance = { id: string; seriesDate: DateKey; startsAt: Date };

/** Every segment of the pro (archived included), or the segments of one series root. */
async function loadSegments(db: Db, professionalId: string, root?: string): Promise<EventRow[]> {
  const inRoot: SQL | undefined =
    root === undefined ? undefined : sql`coalesce(${event.seriesRootId}, ${event.id}) = ${root}`;
  return db
    .select()
    .from(event)
    .where(and(eq(event.professionalId, professionalId), inRoot))
    .orderBy(asc(event.startDate), asc(event.id));
}

/** The first scheduled séance after `now` of each of these segments. */
async function loadNextSeances(
  db: Db,
  professionalId: string,
  eventIds: readonly string[],
  now: Date,
): Promise<Map<string, NextSeance>> {
  const next = new Map<string, NextSeance>();
  if (eventIds.length === 0) return next;
  const rows = await db
    .selectDistinctOn([occurrence.eventId], {
      eventId: occurrence.eventId,
      id: occurrence.id,
      seriesDate: occurrence.seriesDate,
      startsAt: occurrence.startsAt,
    })
    .from(occurrence)
    .where(
      and(
        eq(occurrence.professionalId, professionalId),
        inArray(occurrence.eventId, [...eventIds]),
        eq(occurrence.status, "scheduled"),
        gt(occurrence.startsAt, now),
      ),
    )
    .orderBy(occurrence.eventId, asc(occurrence.startsAt), asc(occurrence.id));
  for (const r of rows) {
    if (r.eventId !== null && r.seriesDate !== null) {
      next.set(r.eventId, { id: r.id, seriesDate: r.seriesDate, startsAt: r.startsAt });
    }
  }
  return next;
}

/**
 * Q9: the current segment of a series: the non-archived one owning the next
 * scheduled séance, else the non-archived one with the latest start_date, else
 * the latest one (every segment archived).
 */
function pickCurrentSegment(segments: readonly EventRow[], next: ReadonlyMap<string, NextSeance>): EventRow {
  const live = segments.filter((s) => s.archivedAt === null);
  const owning = live
    .flatMap((s) => {
      const n = next.get(s.id);
      return n ? [{ segment: s, at: n.startsAt.getTime() }] : [];
    })
    .sort((a, b) => a.at - b.at || a.segment.id.localeCompare(b.segment.id));
  if (owning.length > 0) return owning[0].segment;
  const pool = live.length > 0 ? live : segments;
  return [...pool].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id))[0];
}

function ruleInputOf(e: EventRow): RecurrenceRuleInput {
  const r = ruleOf(e);
  return {
    startDate: r.startDate,
    startMinute: r.startMinute,
    freq: r.freq,
    interval: r.interval,
    weekdays: r.weekdays,
    monthlyBy: r.monthlyBy,
    monthWeek: r.monthWeek,
    endMode: r.endMode,
    untilDate: r.untilDate,
    occurrenceCount: r.occurrenceCount,
  };
}

/** A booking a séance still counts on: confirmed, or pending with a hold that has not lapsed. */
function liveRegistrant(now: Date): SQL {
  return sql`(${booking.status} = 'confirmed' or (${booking.status} = 'pending' and ${booking.holdExpiresAt} > ${ts(now)}))`;
}

/* ───────────────────────────── The list ───────────────────────────── */

type LinkedType = { id: string; name: string; color: string; archived: boolean };

async function loadLinkedTypes(
  db: Db,
  professionalId: string,
  eventIds: readonly string[],
): Promise<Map<string, LinkedType[]>> {
  const byEvent = new Map<string, LinkedType[]>();
  if (eventIds.length === 0) return byEvent;
  const rows = await db
    .select({
      eventId: eventTicketType.eventId,
      id: ticketType.id,
      name: ticketType.name,
      color: ticketType.color,
      archivedAt: ticketType.archivedAt,
    })
    .from(eventTicketType)
    .innerJoin(ticketType, eq(ticketType.id, eventTicketType.ticketTypeId))
    .where(and(eq(eventTicketType.professionalId, professionalId), inArray(eventTicketType.eventId, [...eventIds])))
    .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id));
  for (const r of rows) {
    byEvent.set(r.eventId, [
      ...(byEvent.get(r.eventId) ?? []),
      { id: r.id, name: r.name, color: r.color, archived: r.archivedAt !== null },
    ]);
  }
  return byEvent;
}

/**
 * One row per series root, on its current segment (Q9). `live` = the series
 * has a non-archived segment (by next séance, then title); `ended` = the rest
 * (by latest start_date, newest first).
 */
export async function listEvents(
  db: Db,
  professionalId: string,
  now: Date,
): Promise<{ live: EventListRow[]; ended: EventListRow[] }> {
  const segments = await loadSegments(db, professionalId);
  const next = await loadNextSeances(
    db,
    professionalId,
    segments.filter((s) => s.archivedAt === null).map((s) => s.id),
    now,
  );
  const byRoot = new Map<string, EventRow[]>();
  for (const s of segments) {
    const root = s.seriesRootId ?? s.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), s]);
  }
  const currents = [...byRoot.entries()].map(([root, segs]) => ({ root, current: pickCurrentSegment(segs, next) }));
  const linked = await loadLinkedTypes(
    db,
    professionalId,
    currents.map((c) => c.current.id),
  );

  const toRow = ({ root, current }: { root: string; current: EventRow }) => {
    const acceptedTypes = linked.get(current.id) ?? [];
    const upcoming = next.get(current.id);
    const row: EventListRow = {
      eventId: current.id,
      seriesRootId: root,
      title: current.title,
      color: current.color,
      bookingMode: current.bookingMode,
      isPrivate: current.isPrivate,
      recurrenceLabel: describeRecurrence(ruleOf(current)),
      acceptedTypes,
      nextOccurrence: upcoming ? { id: upcoming.id, startsAt: upcoming.startsAt } : null,
      noActiveType: current.bookingMode === "tickets" && !acceptedTypes.some((t) => !t.archived),
    };
    return row;
  };

  const live = currents
    .filter((c) => c.current.archivedAt === null)
    .map(toRow)
    .sort((a, b) => {
      const at = a.nextOccurrence?.startsAt.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.nextOccurrence?.startsAt.getTime() ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return at < bt ? -1 : 1;
      return a.title.localeCompare(b.title, "fr") || a.eventId.localeCompare(b.eventId);
    });
  const ended = currents
    .filter((c) => c.current.archivedAt !== null)
    .sort(
      (a, b) =>
        b.current.startDate.localeCompare(a.current.startDate) ||
        a.current.title.localeCompare(b.current.title, "fr") ||
        a.current.id.localeCompare(b.current.id),
    )
    .map(toRow);
  return { live, ended };
}

/* ───────────────────────────── The editor ───────────────────────────── */

/**
 * Q9: resolves the series' current segment (the non-archived one owning the
 * next scheduled séance, else the non-archived one with the latest start_date,
 * else the latest one); another id of the series → redirect; unknown id or
 * another pro's event → null.
 */
export async function getEventEditor(
  db: Db,
  professionalId: string,
  eventId: string,
  now: Date,
): Promise<EventEditorLookup> {
  const [requested] = await db
    .select({ id: event.id, seriesRootId: event.seriesRootId })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.professionalId, professionalId)));
  if (!requested) return null;
  const root = requested.seriesRootId ?? requested.id;
  const segments = await loadSegments(db, professionalId, root);
  const next = await loadNextSeances(
    db,
    professionalId,
    segments.filter((s) => s.archivedAt === null).map((s) => s.id),
    now,
  );
  const current = pickCurrentSegment(segments, next);
  if (current.id !== requested.id) return { kind: "redirect", eventId: current.id };

  const readOnly = current.archivedAt !== null;
  const fromDate = readOnly ? null : (next.get(current.id)?.seriesDate ?? null);
  const rule = ruleOf(current);

  const [links, questions, upcoming, futureRegistrants, typeOptions, proWindow, deletePreview] = await Promise.all([
    db
      .select({ id: ticketType.id, name: ticketType.name, archivedAt: ticketType.archivedAt })
      .from(eventTicketType)
      .innerJoin(ticketType, eq(ticketType.id, eventTicketType.ticketTypeId))
      .where(and(eq(eventTicketType.professionalId, professionalId), eq(eventTicketType.eventId, current.id)))
      .orderBy(asc(ticketType.position), asc(ticketType.createdAt), asc(ticketType.id)),
    loadQuestions(db, { eventId: current.id }),
    db
      .select({
        id: occurrence.id,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        status: occurrence.status,
        seatsTaken: occurrence.seatsTaken,
        // Written "occurrence.id", not ${occurrence.id}: in a single-table select drizzle drops the table name of an
        // interpolated column, and a bare "id" would resolve to booking.id inside the subquery.
        elapsedHolds: sql<number>`(select count(*)::int from booking b where b.occurrence_id = occurrence.id
          and b.status = 'pending' and b.hold_expires_at < ${ts(now)})`.mapWith(Number),
        capacity: occurrence.capacity,
      })
      .from(occurrence)
      .where(and(eq(occurrence.professionalId, professionalId), eq(occurrence.eventId, current.id), gt(occurrence.startsAt, now)))
      .orderBy(asc(occurrence.startsAt), asc(occurrence.id))
      .limit(10),
    db
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(booking)
      .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
      .where(
        and(
          eq(occurrence.professionalId, professionalId),
          eq(occurrence.eventId, current.id),
          eq(occurrence.status, "scheduled"),
          gt(occurrence.startsAt, now),
          isNull(occurrence.locationOverride),
          liveRegistrant(now),
        ),
      ),
    listActiveTypeOptions(db, professionalId),
    readProWindow(db, professionalId),
    fromDate === null ? Promise.resolve(null) : deleteFromPreview(db, professionalId, current.id, fromDate, now),
  ]);
  if (!proWindow) return null;

  const otherSegments: EventSegmentView[] = segments
    .filter((s) => s.id !== current.id)
    .map((s) => ({
      eventId: s.id,
      recurrenceLabel: describeRecurrence(ruleOf(s)),
      firstDate: s.startDate,
      lastDate: lastSeriesDate(ruleOf(s)),
      archived: s.archivedAt !== null,
    }))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.eventId.localeCompare(b.eventId));

  return {
    kind: "ok",
    data: {
      event: {
        id: current.id,
        seriesRootId: root,
        version: current.version,
        title: current.title,
        description: current.description,
        location: current.location,
        color: current.color,
        bookingMode: current.bookingMode,
        isPrivate: current.isPrivate,
        capacity: current.capacity,
        durationMin: current.durationMin,
        overrides: {
          bookingHorizonDays: current.bookingHorizonDays,
          minNoticeMinutes: current.minNoticeMinutes,
          cancelDeadlineHours: current.cancelDeadlineHours,
        },
        ticketTypeIds: links.map((l) => l.id),
        questions,
        rule: ruleInputOf(current),
        recurrenceLabel: describeRecurrence(rule),
        archived: readOnly,
      },
      readOnly,
      fromDate,
      remainingCount: fromDate === null ? null : remainingCount(rule, fromDate),
      upcoming,
      otherSegments,
      typeOptions: typeOptions.filter((t) => !t.rdvFree),
      linkedArchivedTypes: links.filter((l) => l.archivedAt !== null).map((l) => ({ id: l.id, name: l.name })),
      futureRegistrants: futureRegistrants[0]?.n ?? 0,
      deletePreview,
      proWindow,
    },
  };
}

/* ───────────────────────────── RDV conflicts ───────────────────────────── */

/** Scheduled RDV (event_id null) whose block (buffers included) overlaps any of the ranges. */
export async function countRdvConflicts(
  db: Db,
  professionalId: string,
  ranges: readonly { startsAt: Date; endsAt: Date }[],
): Promise<number> {
  if (ranges.length === 0) return 0;
  const starts = ranges.map((r) => r.startsAt);
  const ends = ranges.map((r) => r.endsAt);
  const first = new Date(Math.min(...starts.map((d) => d.getTime())));
  const last = new Date(Math.max(...ends.map((d) => d.getTime())));
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from occurrence o
    where o.professional_id = ${professionalId} and o.event_id is null and o.status = 'scheduled'
      and o.block_end > ${ts(first)} and o.block_start < ${ts(last)}
      and exists (
        select 1 from unnest(${tsArray(starts)}, ${tsArray(ends)}) as r(s, e)
        where o.block_start < r.e and o.block_end > r.s)`);
  return Number(res.rows[0]?.n ?? 0);
}

/* ───────────────────────────── Delete preview ───────────────────────────── */

/**
 * What deleteSeriesFrom(fromDate) would do on this segment (same rules as the
 * engine, src/lib/booking/series.ts): the rows of the segment from fromDate,
 * the never-booked ones deleted, the scheduled ones with a booking history
 * cancelled; `deleteWhole` = never booked, no row before fromDate and no other
 * segment rooted on it. `registrants` leaves out the pending holds that have
 * lapsed at `now` (nobody is warned about them). Null for an unknown, other
 * pro's or archived segment (the engine refuses these too).
 */
export async function deleteFromPreview(
  db: Db,
  professionalId: string,
  eventId: string,
  fromDate: DateKey,
  now: Date,
): Promise<DeletePreview | null> {
  const [ev] = await db
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.id, eventId), eq(event.professionalId, professionalId), isNull(event.archivedAt)));
  if (!ev) return null;

  const [rows, flags] = await Promise.all([
    db
      .select({
        status: occurrence.status,
        hasHistory: sql<boolean>`exists (select 1 from booking b where b.occurrence_id = occurrence.id)`,
        registrants: sql<number>`(select count(*)::int from booking b where b.occurrence_id = occurrence.id
          and (b.status = 'confirmed' or (b.status = 'pending' and b.hold_expires_at > ${ts(now)})))`.mapWith(Number),
        tickets: sql<number>`(select count(*)::int from booking b where b.occurrence_id = occurrence.id
          and b.status = 'confirmed' and b.coverage = 'ticket')`.mapWith(Number),
      })
      .from(occurrence)
      .where(
        and(
          eq(occurrence.professionalId, professionalId),
          eq(occurrence.eventId, ev.id),
          gte(occurrence.seriesDate, fromDate),
        ),
      ),
    db.execute<{ booked: boolean; root_in_use: boolean; rows_before: number }>(sql`select
      exists (select 1 from booking b join occurrence o on o.id = b.occurrence_id where o.event_id = ${ev.id}) as booked,
      exists (select 1 from event e where e.series_root_id = ${ev.id} and e.id <> ${ev.id}) as root_in_use,
      (select count(*)::int from occurrence where event_id = ${ev.id} and series_date < ${fromDate}::date) as rows_before`),
  ]);
  const f = flags.rows[0];
  const toCancel = rows.filter((r) => r.hasHistory === true && r.status === "scheduled");
  return {
    fromDate,
    deleteWhole: f?.booked !== true && Number(f?.rows_before ?? 0) === 0 && f?.root_in_use !== true,
    deletedSeances: rows.filter((r) => r.hasHistory !== true).length,
    cancelledSeances: toCancel.length,
    registrants: toCancel.reduce((sum, r) => sum + r.registrants, 0),
    ticketsReturned: toCancel.reduce((sum, r) => sum + r.tickets, 0),
  };
}
