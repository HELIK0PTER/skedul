/**
 * « Utiliser vos tickets » (spec L1386-1387, Decision 18): the séances a wallet owner can book right now with a ticket
 * they already hold. One read of the rule the engine asserts when the booking is made (bookWithHeldTicket: ONLINE_OK,
 * the free seat, no booking of this customer yet, an ELIGIBLE ticket), so a listed séance is one the engine accepts. Every
 * table is reached through this pro's `professional_id` and this customer's id: another pro's customer or tickets find
 * nothing. No `server-only`, no env, no process db: the espace page passes `db`.
 */
import { sql } from "drizzle-orm";

import { formatWhen } from "@/lib/back-office/format";
import { ELIGIBLE } from "@/lib/booking/eligibility";
import { ts, type Db } from "@/lib/db/atomic";

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
  const res = await db.execute<Row>(sql`
    select o.id as occurrence_id, e.title, o.starts_at, o.ends_at, p.timezone as tz,
      (select tt.name from ticket t join ticket_type tt on tt.id = t.ticket_type_id
        where t.customer_id = ${customerId} and t.professional_id = o.professional_id and ${ELIGIBLE}
        order by t.expires_at asc nulls last, t.created_at, t.id
        limit 1) as ticket_type_name,
      exists (select 1 from question q where q.event_id = e.id) as needs_answers
    from occurrence o
    join event e on e.id = o.event_id
    join professional p on p.id = o.professional_id
    where o.professional_id = ${professionalId}
      and exists (select 1 from customer c where c.id = ${customerId} and c.professional_id = o.professional_id)
      and o.status = 'scheduled' and e.booking_mode = 'tickets' and not e.is_private and e.archived_at is null
      and o.starts_at >= ${ts(now)} + make_interval(mins => coalesce(e.min_notice_minutes, p.min_notice_minutes))
      and o.starts_at < ${ts(until)}
      and (o.starts_at at time zone p.timezone)::date
          <= (${ts(now)} at time zone p.timezone)::date + coalesce(e.booking_horizon_days, p.booking_horizon_days)
      and not exists (select 1 from time_off toff where toff.professional_id = o.professional_id
                      and toff.start_at < o.ends_at and toff.end_at > o.starts_at)
      and o.capacity - o.seats_taken
          + (select count(*)::int from booking h
             where h.occurrence_id = o.id and h.status = 'pending' and h.hold_expires_at < ${ts(now)}) > 0
      and not exists (select 1 from booking b
                      where b.occurrence_id = o.id and b.customer_id = ${customerId}
                        and (b.status = 'confirmed' or (b.status = 'pending' and b.hold_expires_at >= ${ts(now)})))
      and exists (select 1 from ticket t join ticket_type tt on tt.id = t.ticket_type_id
                  where t.customer_id = ${customerId} and t.professional_id = o.professional_id and ${ELIGIBLE})
    order by o.starts_at, o.id
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
