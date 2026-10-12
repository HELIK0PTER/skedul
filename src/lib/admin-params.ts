// Types only from the schema: keeps drizzle out of client bundles that import these labels.
import type { userRole } from "@/lib/db/schema";
import {
  BOOKING_STATUSES,
  PURCHASE_STATUSES,
  type BookingStatus,
  type PurchaseStatus,
} from "@/lib/tickets";

export type UserRole = (typeof userRole.enumValues)[number];
export type { BookingStatus, PurchaseStatus };

/* ── Users ── */

export const USER_FILTERS = ["all", "client", "pro", "admin", "suspended"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export const USER_FILTER_LABELS: Record<UserFilter, string> = {
  all: "Tous",
  client: "Clients",
  pro: "Pros",
  admin: "Admins",
  suspended: "Suspendus",
};
export const USERS_PAGE_SIZE = 25;

export const ROLE_LABELS: Record<UserRole, string> = {
  client: "Client",
  pro: "Pro",
  admin: "Admin",
};

/* ── Activity ── */

export const ACTIVITY_TABS = ["bookings", "purchases"] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

// The tickets vocabulary (src/lib/tickets.ts) is the single source of these labels.
export { BOOKING_STATUS_LABELS, COVERAGE_LABELS, PURCHASE_STATUS_LABELS } from "@/lib/tickets";

/* ── Traffic ── */

export const TRAFFIC_RANGES = [7, 30, 90] as const;
export type TrafficRange = (typeof TRAFFIC_RANGES)[number];

/* ── Suspension ── */

/** Ban length in seconds; null = no end date. */
export const BAN_DURATIONS = {
  "1d": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  forever: null,
} as const;
export type BanDuration = keyof typeof BAN_DURATIONS;
export const BAN_DURATION_LABELS: Record<BanDuration, string> = {
  "1d": "1 jour",
  "7d": "7 jours",
  "30d": "30 jours",
  forever: "Sans limite",
};

/* ── Parsers (search params & action inputs) ── */

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function parseUserFilter(value: unknown): UserFilter {
  return pick(USER_FILTERS, value) ?? "all";
}

export function parseActivityTab(value: unknown): ActivityTab {
  return pick(ACTIVITY_TABS, value) ?? "bookings";
}

export function parseBookingStatus(value: unknown): BookingStatus | null {
  return pick(BOOKING_STATUSES, value);
}

export function parsePurchaseStatus(value: unknown): PurchaseStatus | null {
  return pick(PURCHASE_STATUSES, value);
}

export function parseBanDuration(value: unknown): BanDuration | null {
  return pick(Object.keys(BAN_DURATIONS) as BanDuration[], value);
}

export function parseRange(value: unknown): TrafficRange {
  const n = typeof value === "string" ? Number(value) : NaN;
  return (TRAFFIC_RANGES as readonly number[]).includes(n) ? (n as TrafficRange) : 30;
}

/** 1-based page number from a search param; anything invalid → 1. */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/**
 * Deleting an account needs its email retyped. Case and surrounding spaces are
 * ignored; an empty input never matches.
 */
export function deletionConfirmed(typed: string, email: string): boolean {
  const t = typed.trim().toLowerCase();
  return t.length > 0 && t === email.trim().toLowerCase();
}
