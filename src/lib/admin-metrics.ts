import { ADMIN_TZ } from "@/lib/analytics";
import { dayKeyInTz, formatDateShort, instantFromWallClock } from "@/lib/datetime";

export type DailyPoint = { day: string; value: number };
export type MoneyTotal = { currency: string; cents: number };
export type IntegrationMode = "live" | "test" | "mock";

/**
 * The last `days` calendar days in `tz` as YYYY-MM-DD keys, oldest first.
 * Steps on the calendar date (UTC arithmetic on the key), so DST days are
 * never skipped or doubled.
 */
export function lastDayKeys(days: number, now: Date, tz: string = ADMIN_TZ): string[] {
  const [y, m, d] = dayKeyInTz(now, tz).split("-").map(Number);
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10),
  );
}

/** The instant a YYYY-MM-DD day starts in `tz`. */
export function startOfDayKey(key: string, tz: string = ADMIN_TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  return instantFromWallClock(y, m, d, 0, tz);
}

/** One point per key, 0 where the query returned no row for that day. */
export function fillDailySeries(
  rows: { day: string; value: number | string }[],
  keys: string[],
): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.value)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** "mar. 6 oct." for a YYYY-MM-DD key. */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Rounds up to 1, 2 or 5 × 10ⁿ — a clean top for a chart's y-axis. */
export function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const f = n / magnitude;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * magnitude;
}

/** Sums amounts per currency (never across currencies), biggest first, zeros dropped. */
export function mergeMoney(
  rows: { currency: string; cents: number | string }[],
): MoneyTotal[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const currency = r.currency.toLowerCase();
    totals.set(currency, (totals.get(currency) ?? 0) + Number(r.cents));
  }
  return [...totals]
    .filter(([, cents]) => cents > 0)
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => b.cents - a.cents);
}

export function stripeMode(
  secretKey: string | undefined,
  enabled: boolean,
): IntegrationMode {
  if (!enabled || !secretKey) return "mock";
  return /^(sk|rk)_live_/.test(secretKey) ? "live" : "test";
}

/** "à l'instant", "il y a 5 minutes", "hier"… then a short date after 30 days. */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "à l'instant";
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, "day");
  return formatDateShort(date, ADMIN_TZ);
}

export function countryName(code: string | null): string {
  if (!code) return "Inconnu";
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
