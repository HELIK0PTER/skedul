import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  account,
  booking,
  customer,
  eventType,
  pack,
  packPurchase,
  pageView,
  professional,
  session,
  user,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { ADMIN_TZ } from "@/lib/analytics";
import { mergeMoney, stripeMode, type MoneyTotal } from "@/lib/admin-metrics";
import {
  BOOKING_STATUS_LABELS,
  USERS_PAGE_SIZE,
  type UserFilter,
} from "@/lib/admin-params";
import { userIsSuspended } from "@/lib/suspension";
import { formatMoney } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bookings that actually happened or will (counted as activity / revenue). */
const CONFIRMED = ["confirmed", "completed"] as const;

/**
 * YYYY-MM-DD of a timestamp in ADMIN_TZ. The zone is inlined as a literal
 * (it is a constant) so SELECT and GROUP BY render the exact same SQL.
 */
function dayOf(column: AnyPgColumn) {
  return sql<string>`to_char(${column} at time zone ${sql.raw(`'${ADMIN_TZ}'`)}, 'YYYY-MM-DD')`;
}

/* ───────────────────────────── Overview ───────────────────────────── */

export async function getOverviewStats(now: Date = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const confirmedRecently = and(
    gte(booking.createdAt, since30),
    inArray(booking.status, [...CONFIRMED]),
  );

  const [users, newUsers, pros, activePros, bookings, revenue30d] =
    await Promise.all([
      db.select({ value: count() }).from(user),
      db.select({ value: count() }).from(user).where(gte(user.createdAt, since7)),
      db.select({ value: count() }).from(professional),
      db
        .select({ value: sql<string>`count(distinct ${booking.professionalId})` })
        .from(booking)
        .where(confirmedRecently),
      db.select({ value: count() }).from(booking).where(confirmedRecently),
      getRevenue({ since: since30 }),
    ]);

  return {
    users: users[0]?.value ?? 0,
    newUsers7d: newUsers[0]?.value ?? 0,
    pros: pros[0]?.value ?? 0,
    activePros30d: Number(activePros[0]?.value ?? 0),
    bookings30d: bookings[0]?.value ?? 0,
    revenue30d,
  };
}

/** Paid bookings + paid packs, summed per currency (optionally since a date / for one pro). */
export async function getRevenue(
  opts: { since?: Date; professionalId?: string } = {},
): Promise<MoneyTotal[]> {
  const [bookingRows, purchaseRows] = await Promise.all([
    db
      .select({
        currency: professional.currency,
        cents: sql<string>`coalesce(sum(${booking.amountPaidCents}), 0)`,
      })
      .from(booking)
      .innerJoin(professional, eq(professional.id, booking.professionalId))
      .where(
        and(
          eq(booking.paymentType, "direct"),
          inArray(booking.status, [...CONFIRMED]),
          opts.since ? gte(booking.createdAt, opts.since) : undefined,
          opts.professionalId
            ? eq(booking.professionalId, opts.professionalId)
            : undefined,
        ),
      )
      .groupBy(professional.currency),
    db
      .select({
        currency: packPurchase.currency,
        cents: sql<string>`coalesce(sum(${packPurchase.amountPaidCents}), 0)`,
      })
      .from(packPurchase)
      .where(
        and(
          eq(packPurchase.status, "paid"),
          opts.since ? gte(packPurchase.createdAt, opts.since) : undefined,
          opts.professionalId
            ? eq(packPurchase.professionalId, opts.professionalId)
            : undefined,
        ),
      )
      .groupBy(packPurchase.currency),
  ]);
  return mergeMoney([...bookingRows, ...purchaseRows]);
}

export function getDailySignups(since: Date) {
  const day = dayOf(user.createdAt);
  return db
    .select({ day, value: count() })
    .from(user)
    .where(gte(user.createdAt, since))
    .groupBy(day);
}

export function getDailyTraffic(since: Date) {
  const day = dayOf(pageView.createdAt);
  return db
    .select({
      day,
      views: count(),
      visitors: sql<string>`count(distinct ${pageView.visitorHash})`,
    })
    .from(pageView)
    .where(gte(pageView.createdAt, since))
    .groupBy(day);
}

export type ActivityEvent = {
  id: string;
  kind: "signup" | "pro" | "booking" | "purchase";
  at: Date;
  /** The account the event belongs to (links to /admin/users/[id]). */
  userId: string;
  title: string;
  detail: string;
};

/** The latest sign-ups, pro pages, bookings and paid packs, merged by date. */
export async function getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
  const [signups, pros, bookings, purchases] = await Promise.all([
    db
      .select({ id: user.id, at: user.createdAt, name: user.name, email: user.email })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(limit),
    db
      .select({
        id: professional.id,
        at: professional.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        slug: professional.slug,
      })
      .from(professional)
      .orderBy(desc(professional.createdAt))
      .limit(limit),
    db
      .select({
        id: booking.id,
        at: booking.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        customerName: customer.name,
        eventTitle: eventType.title,
        status: booking.status,
      })
      .from(booking)
      .innerJoin(professional, eq(professional.id, booking.professionalId))
      .innerJoin(customer, eq(customer.id, booking.customerId))
      .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
      .orderBy(desc(booking.createdAt))
      .limit(limit),
    db
      .select({
        id: packPurchase.id,
        at: packPurchase.createdAt,
        userId: professional.userId,
        businessName: professional.businessName,
        customerName: customer.name,
        packName: pack.name,
        cents: packPurchase.amountPaidCents,
        currency: packPurchase.currency,
      })
      .from(packPurchase)
      .innerJoin(professional, eq(professional.id, packPurchase.professionalId))
      .innerJoin(customer, eq(customer.id, packPurchase.customerId))
      .innerJoin(pack, eq(pack.id, packPurchase.packId))
      .where(eq(packPurchase.status, "paid"))
      .orderBy(desc(packPurchase.createdAt))
      .limit(limit),
  ]);

  const events: ActivityEvent[] = [
    ...signups.map((r) => ({
      id: `signup-${r.id}`,
      kind: "signup" as const,
      at: r.at,
      userId: r.id,
      title: `Inscription · ${r.name}`,
      detail: r.email,
    })),
    ...pros.map((r) => ({
      id: `pro-${r.id}`,
      kind: "pro" as const,
      at: r.at,
      userId: r.userId,
      title: `Page pro créée · ${r.businessName}`,
      detail: `/${r.slug}`,
    })),
    ...bookings.map((r) => ({
      id: `booking-${r.id}`,
      kind: "booking" as const,
      at: r.at,
      userId: r.userId,
      title: `Réservation · ${r.businessName}`,
      detail: `${r.customerName} · ${r.eventTitle} · ${BOOKING_STATUS_LABELS[r.status]}`,
    })),
    ...purchases.map((r) => ({
      id: `purchase-${r.id}`,
      kind: "purchase" as const,
      at: r.at,
      userId: r.userId,
      title: `Pack vendu · ${r.businessName}`,
      detail: `${r.customerName} · ${r.packName} · ${formatMoney(r.cents, r.currency)}`,
    })),
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type AppHealth = Awaited<ReturnType<typeof getAppHealth>>;

/** Integration modes, DB latency and recent payments still pending after 1 h. */
export async function getAppHealth(now: Date = new Date()) {
  const started = performance.now();
  await db.execute(sql`select 1`);
  const dbLatencyMs = Math.round(performance.now() - started);

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [pendingBookings, pendingPurchases] = await Promise.all([
    db
      .select({ value: count() })
      .from(booking)
      .where(
        and(
          eq(booking.status, "pending"),
          lt(booking.createdAt, hourAgo),
          gte(booking.createdAt, weekAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(packPurchase)
      .where(
        and(
          eq(packPurchase.status, "pending"),
          lt(packPurchase.createdAt, hourAgo),
          gte(packPurchase.createdAt, weekAgo),
        ),
      ),
  ]);

  return {
    appEnv: env.APP_ENV,
    appUrl: env.APP_URL,
    stripe: stripeMode(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED),
    stripeWebhook: env.STRIPE_WEBHOOK_CONFIGURED,
    resend: env.RESEND_ENABLED,
    blob: env.BLOB_ENABLED,
    google: env.GOOGLE_CALENDAR_ENABLED,
    dbLatencyMs,
    pendingBookings: pendingBookings[0]?.value ?? 0,
    pendingPurchases: pendingPurchases[0]?.value ?? 0,
  };
}

/* ───────────────────────────── Users ───────────────────────────── */

export async function listUsers(opts: {
  q: string;
  filter: UserFilter;
  page: number;
}) {
  const conditions: (SQL | undefined)[] = [];
  if (opts.q) {
    const pattern = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(professional.businessName, pattern),
      ),
    );
  }
  if (opts.filter === "client") conditions.push(eq(user.role, "client"));
  if (opts.filter === "admin") conditions.push(eq(user.role, "admin"));
  if (opts.filter === "pro") conditions.push(isNotNull(professional.id));
  if (opts.filter === "suspended") conditions.push(userIsSuspended());
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        banned: user.banned,
        banExpires: user.banExpires,
        slug: professional.slug,
      })
      .from(user)
      .leftJoin(professional, eq(professional.userId, user.id))
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(USERS_PAGE_SIZE)
      .offset((opts.page - 1) * USERS_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(user)
      .leftJoin(professional, eq(professional.userId, user.id))
      .where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

async function getProStats(professionalId: string, now: Date) {
  const [eventTypes, confirmed, upcoming, customers, packsSold] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(eventType)
        .where(eq(eventType.professionalId, professionalId)),
      db
        .select({ value: count() })
        .from(booking)
        .where(
          and(
            eq(booking.professionalId, professionalId),
            inArray(booking.status, [...CONFIRMED]),
          ),
        ),
      db
        .select({ value: count() })
        .from(booking)
        .where(
          and(
            eq(booking.professionalId, professionalId),
            inArray(booking.status, ["pending", "confirmed"]),
            gte(booking.startAt, now),
          ),
        ),
      db
        .select({ value: count() })
        .from(customer)
        .where(eq(customer.professionalId, professionalId)),
      db
        .select({ value: count() })
        .from(packPurchase)
        .where(
          and(
            eq(packPurchase.professionalId, professionalId),
            eq(packPurchase.status, "paid"),
          ),
        ),
    ]);
  return {
    eventTypes: eventTypes[0]?.value ?? 0,
    bookings: confirmed[0]?.value ?? 0,
    upcoming: upcoming[0]?.value ?? 0,
    customers: customers[0]?.value ?? 0,
    packsSold: packsSold[0]?.value ?? 0,
  };
}

export async function getUserDetail(userId: string, now: Date = new Date()) {
  const [found] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!found) return null;

  const [proRows, providers, sessions] = await Promise.all([
    db.select().from(professional).where(eq(professional.userId, userId)).limit(1),
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, userId)),
    db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        impersonatedBy: session.impersonatedBy,
      })
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
      .orderBy(desc(session.createdAt)),
  ]);
  const pro = proRows[0] ?? null;
  const [stats, revenue] = pro
    ? await Promise.all([
        getProStats(pro.id, now),
        getRevenue({ professionalId: pro.id }),
      ])
    : [null, []];

  return {
    user: found,
    pro,
    providers: providers.map((p) => p.providerId),
    sessions,
    stats,
    revenue,
  };
}
