/**
 * « Utiliser vos tickets » (spec L1386-1387, Decision 18): the séances a wallet owner can book right now with a ticket
 * they already hold. One read of the rule the engine asserts when the booking is made (bookWithHeldTicket: ONLINE_OK,
 * the free seat, no booking of this customer yet, an ELIGIBLE ticket), so a listed séance is one the engine accepts. The
 * séance, its event, the pro, the customer, the ticket, its type and the time off are each filtered on this pro's
 * `professional_id` (the customer and the ticket also on this customer's id), the joins included: another pro's
 * customer, tickets, event or type find nothing, even through a row that crossed two pros (every domain foreign key is
 * single-column; the DB test hand-builds such rows). Only the engine's own reads go by the id of this pro's séance or
 * event alone: the holds counted on the séance, its questions and ELIGIBLE's `event_ticket_type` link. No
 * `server-only`, no env, no process db: the espace page passes `db`.
 */
import { sql } from "drizzle-orm";

import { formatWhen } from "@/lib/back-office/format";
import { ELIGIBLE } from "@/lib/booking/eligibility";
import { ts, type Db } from "@/lib/db/atomic";
import { holdsSeat, lapsedHold } from "@/lib/db/hold-sql";

/** The most séances « Utiliser vos tickets » lists. */
export const SPENDABLE_MAX = 8;
/** The horizon of the list, in days from now (the pro's own horizon may be shorter, never longer here). */
export const SPENDABLE_DAYS = 60;

export type SpendableSeance = {
  occurrenceId: string;
  title: string;
  whenLabel: string;
  /** ISO instant, the `seenStartsAt` to post with the booking */
  startsAt: string;
  /** the type that would be spent first (consumption order) */
  ticketTypeName: string;
  /** the event has questions: the espace links to the séance page instead of booking in place */
  needsAnswers: boolean;
};

const DAY_MS = 86_400_000;
/** A caller never reads more than this many rows, whatever it asks for. */
const HARD_LIMIT = 50;

type Row = {
  occurrence_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  tz: string;
  ticket_type_name: string;
  needs_answers: boolean;
};

/**
 * Public tickets-mode séances of the next SPENDABLE_DAYS open online now (scheduled, not private, not archived, the
 * notice and the local-date horizon with the event's overrides, no overlapping time off: the ONLINE_OK twin of
 * src/lib/booking/claims.ts), a SHOWN seat free (capacity minus seats taken plus the elapsed holds not yet released:
 * seatsShown, holds.ts), no active booking of this customer (confirmed, or a live hold), and an ELIGIBLE ticket of
 * theirs (valid at the séance, accepted by the event, type not archived). Soonest first, at most `limit` (default
 * SPENDABLE_MAX, never above 50, never below 1). `ticketTypeName` is the type spent first (soonest expiry, no expiry
 * last, oldest, id: the order of pickTicket) and `needsAnswers` says whether the event has questions.
 */
export async function spendableSeances(
  db: Db,
  professionalId: string,
  customerId: string,
  now: Date,
  limit: number = SPENDABLE_MAX,
): Promise<SpendableSeance[]> {
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), HARD_LIMIT)) : SPENDABLE_MAX;
  const until = new Date(now.getTime() + SPENDABLE_DAYS * DAY_MS);
  // The séance and its event are `so` and `se`; the lateral pick joins them again by id as `o` and `e`, the FROM that
  // ELIGIBLE expects (eligibleFrom's shape), so its link EXISTS correlates with a relation of its own level. Written over
  // the outer `o` instead, Postgres 17 hashed that EXISTS once and kept the link set of the first séance it scanned in
  // the join filter, so a ticket fitting only a later séance went unnamed (spendable.db.test.ts pins it).
  const res = await db.execute<Row>(sql`
    select so.id as occurrence_id, se.title, so.starts_at, so.ends_at, p.timezone as tz, pick.name as ticket_type_name,
      exists (select 1 from question q where q.event_id = se.id) as needs_answers
    from occurrence so
    join event se on se.id = so.event_id and se.professional_id = so.professional_id
    join professional p on p.id = so.professional_id
    join lateral (
      select tt.name from ticket t
        join ticket_type tt on tt.id = t.ticket_type_id and tt.professional_id = t.professional_id
        join occurrence o on o.id = so.id
        join event e on e.id = se.id
      where t.customer_id = ${customerId} and t.professional_id = o.professional_id and ${ELIGIBLE}
      order by t.expires_at asc nulls last, t.created_at, t.id
      limit 1
    ) pick on true
    where so.professional_id = ${professionalId}
      and exists (select 1 from customer c where c.id = ${customerId} and c.professional_id = so.professional_id)
      and so.status = 'scheduled' and se.booking_mode = 'tickets' and not se.is_private and se.archived_at is null
      and so.starts_at >= ${ts(now)} + make_interval(mins => coalesce(se.min_notice_minutes, p.min_notice_minutes))
      and so.starts_at < ${ts(until)}
      and (so.starts_at at time zone p.timezone)::date
          <= (${ts(now)} at time zone p.timezone)::date + coalesce(se.booking_horizon_days, p.booking_horizon_days)
      and not exists (select 1 from time_off toff where toff.professional_id = so.professional_id
                      and toff.start_at < so.ends_at and toff.end_at > so.starts_at)
      and so.capacity - so.seats_taken
          + (select count(*)::int from booking h
             where h.occurrence_id = so.id and ${lapsedHold(now, sql`h`)}) > 0
      and not exists (select 1 from booking b
                      where b.occurrence_id = so.id and b.customer_id = ${customerId} and ${holdsSeat(now, sql`b`)})
    order by so.starts_at, so.id
    limit ${cap}::int`);
  return res.rows.map((r) => {
    const startsAt = new Date(r.starts_at);
    const endsAt = new Date(r.ends_at);
    return {
      occurrenceId: r.occurrence_id,
      title: r.title,
      whenLabel: formatWhen(startsAt, endsAt, r.tz),
      startsAt: startsAt.toISOString(),
      ticketTypeName: r.ticket_type_name,
      needsAnswers: r.needs_answers === true,
    };
  });
}
