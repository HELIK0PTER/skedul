/**
 * Admin reads on the tickets domain (spec § 13.8, Q24). Platform-wide queries
 * for /admin: no professional filter unless an argument asks for one. No
 * `server-only`, no env and no process db: src/server/admin-queries.ts wraps
 * these with the real db and the Stripe mode, and the DB tests call them with
 * the test db.
 *
 * Every function here is an unguarded read: the only callers are the admin
 * pages, behind requireAdmin() / getAdminUser() (src/lib/admin.ts).
 */
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { mergeMoney, type MoneyTotal } from "@/lib/admin-metrics";
import { deletionImpact } from "@/lib/booking/account";
import { ruleOf } from "@/lib/booking/occurrences";
import { revenueByCurrency } from "@/lib/booking/revenue";
import { compareKeys } from "@/lib/civil-date";
import { ts, type Db } from "@/lib/db/atomic";
import { inProCustomers } from "@/lib/back-office/pro-scope";
import { booking, customer, event, occurrence, professional, ticketPurchase, ticketType } from "@/lib/db/schema";
import { lastSeriesDate } from "@/lib/recurrence";
import { HEALTH_KEYS, readHealth } from "@/lib/throttle";
import {
  BOOKING_STATUS_LABELS,
  HORIZON_REFRESH_DAYS,
  type BookingCoverage,
  type BookingStatus,
  type PurchaseStatus,
} from "@/lib/tickets";
import { formatMoney } from "@/lib/utils";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* ───────────────────────────── Overview ───────────────────────────── */

export type ActivityEvent = {
  id: string;
  kind: "signup" | "pro" | "booking" | "purchase";
  at: Date;
  /** The account the event belongs to (links to /admin/users/[id]). */
  userId: string;
  title: string;
  detail: string;
};

/** Rows per list of /admin/activity, and the default size of the overview feed sources. */
export const ACTIVITY_LIMIT = 50;

/**
 * Pros with a confirmed booking created, or a paid purchase (whatever its
 * livemode: this measures activity, not revenue), in the last 30 days; and the
 * confirmed bookings created in those 30 days. The recent bookings are read
 * once (booking has no created_at index, so every read of it is a scan) and
 * serve both figures.
 */
export async function activityCounts30d(db: Db, now: Date): Promise<{ activePros30d: number; bookings30d: number }> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const res = await db.execute<{ pros: number; bookings: number }>(sql`
    with recent as (
      select professional_id from booking where status = 'confirmed' and created_at >= ${ts(since)}
    )
    select
      (select count(*)::int from (
        select professional_id from recent
        union
        select professional_id from ticket_purchase where status = 'paid' and paid_at >= ${ts(since)}
      ) active) as pros,
      (select count(*)::int from recent) as bookings`);
  const row = res.rows[0];
  return { activePros30d: Number(row?.pros ?? 0), bookings30d: Number(row?.bookings ?? 0) };
}

/**
 * « Encaissé » for the admin: the paid purchases of the asked mode summed per
 * currency (biggest first, zeros dropped). An empty professionalId is refused
 * with an empty result here (paidPurchaseOf itself throws on it, so that it is
 * never read as "no scope", which would widen the figure to the whole platform).
 */
export async function platformRevenue(
  db: Db,
  opts: { live: boolean; since?: Date; professionalId?: string },
): Promise<MoneyTotal[]> {
  if (opts.professionalId === "") return [];
  return mergeMoney(await revenueByCurrency(db, opts));
}

/* ───────────────────────────── Bookings and purchases ───────────────────────────── */

/**
 * The ids of the `limit` newest bookings (optionally one status), picked from the booking table alone: the rows of the
 * feed and of the list then join only those ids (a join-then-sort plan joins every booking before it can sort).
 */
function newestBookingIds(db: Db, status: BookingStatus | null, limit: number) {
  return db
    .select({ id: booking.id })
    .from(booking)
    .where(status ? eq(booking.status, status) : undefined)
    .orderBy(desc(booking.createdAt), desc(booking.id))
    .limit(limit);
}

/** Every booking column the feed and the list need; callers add where / order (the rows are already limited by newestBookingIds). */
function bookingRows(db: Db) {
  return db
    .select({
      id: booking.id,
      createdAt: booking.createdAt,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      status: booking.status,
      coverage: booking.coverage,
      proUserId: professional.userId,
      businessName: professional.businessName,
      timezone: professional.timezone,
      customerName: customer.name,
      customerEmail: customer.email,
      // a séance has an event, an RDV has a ticket type (occurrence_kind_chk)
      title: sql<string>`coalesce(${event.title}, ${ticketType.name})`,
    })
    .from(booking)
    .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .innerJoin(customer, eq(customer.id, booking.customerId));
}

/** Every purchase column the feed and the list need; callers add where / order / limit. */
function purchaseRows(db: Db) {
  return db
    .select({
      id: ticketPurchase.id,
      createdAt: ticketPurchase.createdAt,
      paidAt: ticketPurchase.paidAt,
      status: ticketPurchase.status,
      amountCents: ticketPurchase.amountCents,
      currency: ticketPurchase.currency,
      livemode: ticketPurchase.livemode,
      label: ticketPurchase.label,
      quantity: ticketPurchase.quantity,
      proUserId: professional.userId,
      businessName: professional.businessName,
      customerName: customer.name,
      customerEmail: customer.email,
    })
    .from(ticketPurchase)
    .innerJoin(professional, eq(professional.id, ticketPurchase.professionalId))
    .innerJoin(customer, eq(customer.id, ticketPurchase.customerId));
}

/** The latest confirmed bookings as feed events: « Réservation · {businessName} ». */
export async function recentBookingEvents(db: Db, limit: number): Promise<ActivityEvent[]> {
  const rows = await bookingRows(db)
    .where(inArray(booking.id, newestBookingIds(db, "confirmed", limit)))
    .orderBy(desc(booking.createdAt), desc(booking.id));
  return rows.map((r) => ({
    id: `booking-${r.id}`,
    kind: "booking" as const,
    at: r.createdAt,
    userId: r.proUserId,
    title: `Réservation · ${r.businessName}`,
    detail: `${r.customerName} · ${r.title} · ${BOOKING_STATUS_LABELS[r.status]}`,
  }));
}

/** The latest paid purchases as feed events: « Achat · {businessName} ». */
export async function recentPurchaseEvents(db: Db, limit: number): Promise<ActivityEvent[]> {
  const rows = await purchaseRows(db)
    .where(eq(ticketPurchase.status, "paid"))
    .orderBy(desc(ticketPurchase.paidAt), desc(ticketPurchase.id))
    .limit(limit);
  return rows.map((r) => ({
    id: `purchase-${r.id}`,
    kind: "purchase" as const,
    at: r.paidAt ?? r.createdAt,
    userId: r.proUserId,
    title: `Achat · ${r.businessName}`,
    detail: `${r.customerName} · ${r.label} · ${formatMoney(r.amountCents, r.currency)}`,
  }));
}

export type AdminBookingRow = {
  id: string;
  createdAt: Date;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  coverage: BookingCoverage;
  proUserId: string;
  businessName: string;
  timezone: string;
  customerName: string;
  customerEmail: string;
  title: string;
};

/** /admin/activity « Inscriptions »: newest first (created_at), ACTIVITY_LIMIT rows, optionally one status. */
export async function listRecentBookings(db: Db, status: BookingStatus | null): Promise<AdminBookingRow[]> {
  return bookingRows(db)
    .where(inArray(booking.id, newestBookingIds(db, status, ACTIVITY_LIMIT)))
    .orderBy(desc(booking.createdAt), desc(booking.id));
}

export type AdminPurchaseRow = {
  id: string;
  createdAt: Date;
  paidAt: Date | null;
  status: PurchaseStatus;
  amountCents: number;
  currency: string;
  livemode: boolean;
  label: string;
  quantity: number;
  proUserId: string;
  businessName: string;
  customerName: string;
  customerEmail: string;
};

/** /admin/activity « Achats »: newest first (created_at), ACTIVITY_LIMIT rows, optionally one status. */
export async function listRecentPurchases(db: Db, status: PurchaseStatus | null): Promise<AdminPurchaseRow[]> {
  return purchaseRows(db)
    .where(status ? eq(ticketPurchase.status, status) : undefined)
    .orderBy(desc(ticketPurchase.createdAt), desc(ticketPurchase.id))
    .limit(ACTIVITY_LIMIT);
}

/* ───────────────────────────── Health ───────────────────────────── */

export type HealthCounts = {
  /**
   * Pending bookings created more than 1 h ago, whether or not their
   * hold_expires_at has elapsed. A hold lives HOLD_MINUTES (45), so such a
   * booking is lapsed: lapsed holds ARE counted, but only once they are over
   * 1 h old. A hold lapsed for less than that is not counted yet (grace
   * period), and a live hold never is. The timely release of a hold is the
   * checkout.session.expired webhook (P4, about 31 min after creation, via
   * releasePurchase). Until it runs, a mock or delayed-payment hold stays
   * until the nightly job or a booking on that same séance releases it, so
   * this counter can show such holds for hours without any failure.
   */
  pendingHolds: number;
  /**
   * Pending purchases whose checkout has expired and whose payment is not
   * being processed (processing_at null): a delayed payment (SEPA) is not an
   * anomaly, same rule as expireStalePurchases and deletionImpact.
   */
  pendingPurchases: number;
  /** Live segments that can still produce dates, generated less than HORIZON_REFRESH_DAYS ahead (pro time zone). */
  horizonLag: number;
  /** Payments received for a purchase that no longer exists (refund by hand in Stripe). */
  orphanPayments: { value: number; at: Date } | null;
  /** Result of the last nightly invariant check; null = it never ran. */
  invariantViolations: { value: number; at: Date } | null;
};

/**
 * Same rule as minGeneratedUntil (src/lib/booking/occurrences.ts): a segment
 * is complete once generated_until reaches the last date its rule can produce
 * (never for an endless one). SQL keeps the candidates (live, recurring, behind
 * the cutoff of its pro's OWN local today + HORIZON_REFRESH_DAYS); the rule
 * check needs the recurrence walk, so it runs here.
 */
async function laggingSeries(db: Db, now: Date): Promise<number> {
  const rows = await db
    .select({ row: event })
    .from(event)
    .innerJoin(professional, eq(professional.id, event.professionalId))
    .where(
      and(
        isNull(event.archivedAt),
        ne(event.freq, "once"),
        or(ne(event.endMode, "until"), sql`${event.untilDate} > ${event.generatedUntil}`),
        sql`${event.generatedUntil} < ((${ts(now)} at time zone ${professional.timezone})::date + ${HORIZON_REFRESH_DAYS}::int)`,
      ),
    );
  return rows.filter(({ row }) => {
    const last = lastSeriesDate(ruleOf(row));
    return last === null || compareKeys(row.generatedUntil, last) < 0;
  }).length;
}

export async function healthCounts(db: Db, now: Date): Promise<HealthCounts> {
  const holdCutoff = new Date(now.getTime() - HOUR_MS);
  const [pending, horizonLag, health] = await Promise.all([
    db.execute<{ holds: number; purchases: number }>(sql`
      select
        (select count(*)::int from booking where status = 'pending' and created_at < ${ts(holdCutoff)}) as holds,
        (select count(*)::int from ticket_purchase where status = 'pending' and processing_at is null and checkout_expires_at < ${ts(now)}) as purchases`),
    laggingSeries(db, now),
    readHealth(db),
  ]);
  const row = pending.rows[0];
  return {
    pendingHolds: Number(row?.holds ?? 0),
    pendingPurchases: Number(row?.purchases ?? 0),
    horizonLag,
    orphanPayments: health[HEALTH_KEYS.orphanPayments] ?? null,
    invariantViolations: health[HEALTH_KEYS.invariantViolations] ?? null,
  };
}

/* ───────────────────────────── One pro ───────────────────────────── */

export type ProStats = {
  events: number;
  ticketTypes: number;
  confirmedBookings: number;
  upcoming: number;
  clients: number;
  paidPurchases: number;
};

/**
 * One pro's footprint for /admin/users/[id]. booking has no index that starts with professional_id, so its counts go
 * through the pro's customers (booking_customer_idx) and the pro's coming occurrences (booking_occurrence_status_idx).
 * events = live series (distinct
 * series root among the non-archived segments: a split series is ONE event);
 * ticketTypes = non-archived; upcoming = pending + confirmed bookings on
 * future occurrences; clients = spec § 9 (a confirmed booking ever, or a
 * ticket in any state); paidPurchases = paid whatever the livemode.
 */
export async function proStats(db: Db, professionalId: string, now: Date): Promise<ProStats> {
  const res = await db.execute<{
    events: number;
    ticket_types: number;
    confirmed: number;
    upcoming: number;
    clients: number;
    paid: number;
  }>(sql`
    select
      (select count(distinct coalesce(series_root_id, id))::int from event
        where professional_id = ${professionalId} and archived_at is null) as events,
      (select count(*)::int from ticket_type
        where professional_id = ${professionalId} and archived_at is null) as ticket_types,
      (select count(*)::int from booking
        where professional_id = ${professionalId} and status = 'confirmed'
          and ${inProCustomers(sql.raw("customer_id"), professionalId)}) as confirmed,
      (select count(*)::int from booking b
        where b.professional_id = ${professionalId} and b.status in ('pending', 'confirmed')
          and b.occurrence_id = any(array(
            select o.id from occurrence o where o.professional_id = ${professionalId} and o.starts_at > ${ts(now)}))) as upcoming,
      (select count(*)::int from customer c
        where c.professional_id = ${professionalId}
          and (exists (select 1 from booking b where b.customer_id = c.id and b.status = 'confirmed')
            or exists (select 1 from ticket t where t.customer_id = c.id))) as clients,
      (select count(*)::int from ticket_purchase
        where professional_id = ${professionalId} and status = 'paid') as paid`);
  const row = res.rows[0];
  return {
    events: Number(row?.events ?? 0),
    ticketTypes: Number(row?.ticket_types ?? 0),
    confirmedBookings: Number(row?.confirmed ?? 0),
    upcoming: Number(row?.upcoming ?? 0),
    clients: Number(row?.clients ?? 0),
    paidPurchases: Number(row?.paid ?? 0),
  };
}

/**
 * What deleting this account changes beyond its own pro page: usable tickets
 * and payments in progress of its page (deletionImpact), and the client
 * records of this user at OTHER pros (kept, detached from the account).
 */
export async function deletionImpactFor(
  db: Db,
  userId: string,
  professionalId: string | null,
  now: Date,
): Promise<{ ticketsInCirculation: number; pendingPayments: number; clientRecordsElsewhere: number }> {
  const [impact, elsewhere] = await Promise.all([
    professionalId ? deletionImpact(db, professionalId, now) : { ticketsInCirculation: 0, pendingPayments: 0 },
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from customer
      where user_id = ${userId} ${professionalId ? sql`and professional_id <> ${professionalId}` : sql``}`),
  ]);
  return { ...impact, clientRecordsElsewhere: Number(elsewhere.rows[0]?.n ?? 0) };
}
