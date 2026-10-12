import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { account, pageView, professional, session, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { ADMIN_TZ } from "@/lib/analytics";
import { stripeMode, type MoneyTotal } from "@/lib/admin-metrics";
import { USERS_PAGE_SIZE, type UserFilter } from "@/lib/admin-params";
import { userIsSuspended } from "@/lib/suspension";

/*
 * Tickets & événements, P2: the booking and pack tables are gone. Revenue,
 * booking counts, pending payments and the activity lists are stubbed with
 * their exported shapes unchanged; P3 rebuilds them on ticket_purchase
 * (src/lib/booking/revenue.ts) and booking.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const [users, newUsers, pros, revenue30d] = await Promise.all([
    db.select({ value: count() }).from(user),
    db.select({ value: count() }).from(user).where(gte(user.createdAt, since7)),
    db.select({ value: count() }).from(professional),
    getRevenue({ since: since30 }),
  ]);

  return {
    users: users[0]?.value ?? 0,
    newUsers7d: newUsers[0]?.value ?? 0,
    pros: pros[0]?.value ?? 0,
    activePros30d: 0,
    bookings30d: 0,
    revenue30d,
  };
}

/** Paid purchases summed per currency. Stubbed until P3 (ticket_purchase). */
export async function getRevenue(
  opts: { since?: Date; professionalId?: string } = {},
): Promise<MoneyTotal[]> {
  void opts;
  return [];
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

/** The latest sign-ups and pro pages, merged by date (bookings and purchases return in P3). */
export async function getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
  const [signups, pros] = await Promise.all([
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
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type AppHealth = Awaited<ReturnType<typeof getAppHealth>>;

/** Integration modes and DB latency (pending payments return in P3). */
export async function getAppHealth(now: Date = new Date()) {
  void now;
  const started = performance.now();
  await db.execute(sql`select 1`);
  const dbLatencyMs = Math.round(performance.now() - started);

  return {
    appEnv: env.APP_ENV,
    appUrl: env.APP_URL,
    stripe: stripeMode(env.STRIPE_SECRET_KEY, env.STRIPE_ENABLED),
    stripeWebhook: env.STRIPE_WEBHOOK_CONFIGURED,
    resend: env.RESEND_ENABLED,
    blob: env.BLOB_ENABLED,
    google: env.GOOGLE_CALENDAR_ENABLED,
    dbLatencyMs,
    pendingBookings: 0,
    pendingPurchases: 0,
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
      // id breaks ties so offset paging never repeats or skips a row
      .orderBy(desc(user.createdAt), desc(user.id))
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

/** A pro's catalogue and booking counts. Stubbed until P3. */
async function getProStats(professionalId: string, now: Date) {
  void professionalId;
  void now;
  return {
    eventTypes: 0,
    bookings: 0,
    upcoming: 0,
    customers: 0,
    packsSold: 0,
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
  const [stats, revenue, deletion] = await Promise.all([
    pro ? getProStats(pro.id, now) : null,
    pro ? getRevenue({ professionalId: pro.id }) : [],
    getDeletionImpact(userId, pro?.id ?? null),
  ]);

  return {
    user: found,
    pro,
    providers: providers.map((p) => p.providerId),
    sessions,
    stats,
    revenue,
    deletion,
  };
}

/**
 * What deleting this account changes beyond its own pro page: tickets its
 * clients would lose and client records it has with other pros. Stubbed until
 * P3 (src/lib/booking/account.ts deletionImpact).
 */
async function getDeletionImpact(userId: string, professionalId: string | null) {
  void userId;
  void professionalId;
  return {
    creditsOutstanding: 0,
    clientRecordsElsewhere: 0,
  };
}

/* ───────────────────────────── Traffic ───────────────────────────── */

export async function getTrafficReport(since: Date) {
  const day = dayOf(pageView.createdAt);
  const visitors = () => sql<string>`count(distinct ${pageView.visitorHash})`;
  const source = sql<string>`coalesce(${pageView.source}, ${pageView.referrerHost}, 'Direct')`;
  const inRange = gte(pageView.createdAt, since);

  const [daily, devices, pages, pros, sources, countries] = await Promise.all([
    db
      .select({ day, views: count(), visitors: visitors() })
      .from(pageView)
      .where(inRange)
      .groupBy(day),
    db
      .select({ device: pageView.device, views: count() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.device)
      .orderBy(desc(count())),
    db
      .select({ path: pageView.path, views: count(), visitors: visitors() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.path)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({
        userId: professional.userId,
        businessName: professional.businessName,
        slug: professional.slug,
        views: count(),
      })
      .from(pageView)
      .innerJoin(professional, eq(professional.id, pageView.professionalId))
      .where(inRange)
      .groupBy(professional.id)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({ source, visits: count() })
      .from(pageView)
      .where(and(inRange, eq(pageView.entry, true)))
      .groupBy(source)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({ country: pageView.country, views: count() })
      .from(pageView)
      .where(inRange)
      .groupBy(pageView.country)
      .orderBy(desc(count()))
      .limit(10),
  ]);
  return { daily, devices, pages, pros, sources, countries };
}
