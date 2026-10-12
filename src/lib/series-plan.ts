/**
 * Pure planner of « cette séance et les suivantes » (spec § 11 E7). It splits
 * the existing occurrences of the edited segment (series_date ≥ d) between
 * the new rule's dates, and lists the dates to insert. The engine
 * (src/lib/booking/series.ts) turns the plan into one guarded batch.
 */
import { instantAt, maxKey, type DateKey } from "@/lib/civil-date";
import { expandDates, remainingCount, type RecurrenceRule } from "@/lib/recurrence";
import { MATERIALIZE_MAX_ROWS, type OccurrenceStatus } from "@/lib/tickets";

/** An existing occurrence of the edited segment with seriesDate ≥ d. */
export type SeriesRow = {
  id: string;
  seriesDate: DateKey;
  startsAt: Date;
  endsAt: Date;
  status: OccurrenceStatus;
  timeDetached: boolean;
  /** pending + confirmed bookings */
  activeBookings: number;
  /** confirmed bookings of coverage ticket */
  ticketBookings: number;
  /** any booking ever, whatever its status */
  hasHistory: boolean;
};

export type SeriesEditInput = {
  tz: string;
  /** d */
  fromDate: DateKey;
  /** today + MATERIALIZE_DAYS */
  horizonEnd: DateKey;
  oldRule: RecurrenceRule;
  newRule: RecurrenceRule;
  rows: readonly SeriesRow[];
};

export type SeriesEditSummary = {
  /** scheduled retime rows whose time changes */
  modified: number;
  /** active bookings on those rows (they get « séance modifiée ») */
  notified: number;
  /** orphanBooked rows */
  orphans: number;
  /** ticket bookings on orphanBooked rows (given back if the pro cancels them) */
  orphanTickets: number;
  deleted: number;
  /** cancelEmpty rows that were still scheduled (already-cancelled rows are not counted) */
  cancelledEmpty: number;
  inserted: number;
};

export type SeriesEditPlan = {
  /** not detached, date still produced by the new rule: new start and end (status kept) */
  retime: { id: string; seriesDate: DateKey; startsAt: Date; endsAt: Date; timeChanged: boolean }[];
  /** time_detached rows: keep their time, only change event_id */
  reparentOnly: string[];
  /** date gone, never booked, scheduled: physical delete */
  delete: string[];
  /** date gone, no active booking, but a history or already cancelled: → cancelled */
  cancelEmpty: string[];
  /** date gone, active bookings: kept isolated (time_detached) or cancelled (E6b) */
  orphanBooked: string[];
  /** new-rule dates without a row, ascending, at most MATERIALIZE_MAX_ROWS */
  insert: { seriesDate: DateKey; startsAt: Date; endsAt: Date }[];
  /** the new segment's generated_until: the last inserted date when capped, else horizonEnd */
  generatedUntil: DateKey;
  /** count mode of the old rule: dates left from d (« Il reste K séances »); else null */
  remainingCount: number | null;
  summary: SeriesEditSummary;
};

export function planSeriesEdit(input: SeriesEditInput): SeriesEditPlan {
  const { tz, fromDate, horizonEnd, oldRule, newRule, rows } = input;
  const newDates = expandDates(newRule, maxKey(fromDate, newRule.startDate), horizonEnd);
  const produced = new Set(newDates);
  const instants = (seriesDate: DateKey) => {
    const startsAt = instantAt(seriesDate, newRule.startMinute, tz);
    return { startsAt, endsAt: new Date(startsAt.getTime() + newRule.durationMin * 60_000) };
  };

  const plan: SeriesEditPlan = {
    retime: [],
    reparentOnly: [],
    delete: [],
    cancelEmpty: [],
    orphanBooked: [],
    insert: [],
    generatedUntil: horizonEnd,
    remainingCount: remainingCount(oldRule, fromDate),
    summary: { modified: 0, notified: 0, orphans: 0, orphanTickets: 0, deleted: 0, cancelledEmpty: 0, inserted: 0 },
  };

  for (const row of rows) {
    if (row.timeDetached) {
      plan.reparentOnly.push(row.id);
    } else if (produced.has(row.seriesDate)) {
      const { startsAt, endsAt } = instants(row.seriesDate);
      const timeChanged =
        startsAt.getTime() !== row.startsAt.getTime() || endsAt.getTime() !== row.endsAt.getTime();
      plan.retime.push({ id: row.id, seriesDate: row.seriesDate, startsAt, endsAt, timeChanged });
      if (timeChanged && row.status === "scheduled") {
        plan.summary.modified++;
        plan.summary.notified += row.activeBookings;
      }
    } else if (row.activeBookings > 0) {
      plan.orphanBooked.push(row.id);
      plan.summary.orphans++;
      plan.summary.orphanTickets += row.ticketBookings;
    } else if (!row.hasHistory && row.status === "scheduled") {
      plan.delete.push(row.id);
    } else {
      plan.cancelEmpty.push(row.id);
      if (row.status === "scheduled") plan.summary.cancelledEmpty++;
    }
  }

  const existing = new Set(rows.map((r) => r.seriesDate));
  const missing = newDates.filter((d) => !existing.has(d));
  const capped = missing.length > MATERIALIZE_MAX_ROWS;
  for (const seriesDate of missing.slice(0, MATERIALIZE_MAX_ROWS)) {
    plan.insert.push({ seriesDate, ...instants(seriesDate) });
  }
  if (capped) plan.generatedUntil = plan.insert[plan.insert.length - 1].seriesDate;

  plan.summary.deleted = plan.delete.length;
  plan.summary.inserted = plan.insert.length;
  return plan;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « 12 séances modifiées, 3 inscrits prévenus, 1 séance annulée (2 tickets rendus) ». */
export function describeSeriesEdit(summary: SeriesEditSummary, orphans: "keep" | "cancel"): string {
  const parts: string[] = [];
  if (summary.modified > 0) parts.push(plural(summary.modified, "séance modifiée", "séances modifiées"));
  if (summary.notified > 0) parts.push(plural(summary.notified, "inscrit prévenu", "inscrits prévenus"));
  if (summary.orphans > 0) {
    if (orphans === "cancel") {
      const tickets =
        summary.orphanTickets > 0
          ? ` (${plural(summary.orphanTickets, "ticket rendu", "tickets rendus")})`
          : "";
      parts.push(`${plural(summary.orphans, "séance annulée", "séances annulées")}${tickets}`);
    } else {
      parts.push(plural(summary.orphans, "séance gardée à part", "séances gardées à part"));
    }
  }
  if (summary.cancelledEmpty > 0) {
    parts.push(plural(summary.cancelledEmpty, "séance vide annulée", "séances vides annulées"));
  }
  if (summary.deleted > 0) parts.push(plural(summary.deleted, "séance supprimée", "séances supprimées"));
  if (summary.inserted > 0) parts.push(plural(summary.inserted, "séance ajoutée", "séances ajoutées"));
  return parts.length > 0 ? parts.join(", ") : "Aucun changement sur les séances";
}
