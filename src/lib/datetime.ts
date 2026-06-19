import { TZDate } from "@date-fns/tz";

export const DAYS_FR = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Build the UTC instant for a wall-clock time on a given calendar day in `tz`. */
export function instantFromWallClock(
  year: number,
  month1: number, // 1-12
  day: number,
  minutesFromMidnight: number,
  tz: string,
): Date {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  const tzDate = new TZDate(year, month1 - 1, day, h, m, 0, tz);
  return new Date(tzDate.getTime());
}

/** Format a slot range, e.g. "lun. 23 juin 2026 · 14:00 – 15:00". */
export function formatSlot(start: Date, end: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(start);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(d);
  return `${date} · ${t(start)} – ${t(end)}`;
}

export function formatTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function formatDateLong(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  }).format(d);
}

/** Returns YYYY-MM-DD for a date as seen in `tz` (stable grouping key). */
export function dayKeyInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
}
