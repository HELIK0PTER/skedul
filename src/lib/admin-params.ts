// Types only: keeps drizzle out of client bundles that import these labels.
import type { bookingStatus, purchaseStatus, userRole } from "@/lib/db/schema";

export type UserRole = (typeof userRole.enumValues)[number];
export type BookingStatus = (typeof bookingStatus.enumValues)[number];
export type PurchaseStatus = (typeof purchaseStatus.enumValues)[number];

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

// Record<…> keeps these in sync with the schema enums at compile time.
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  completed: "Terminée",
};
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "En attente",
  paid: "Payé",
  refunded: "Remboursé",
};
export const PAYMENT_TYPE_LABELS = {
  direct: "Payé",
  credit: "Crédit",
  free: "Offert",
} as const;

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
  return pick(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[], value);
}

export function parsePurchaseStatus(value: unknown): PurchaseStatus | null {
  return pick(Object.keys(PURCHASE_STATUS_LABELS) as PurchaseStatus[], value);
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
