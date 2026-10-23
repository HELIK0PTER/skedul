/**
 * Pure view model of the public planning (spec L1440-1443, Decisions 9, 10, 46, 47). Everything the `/[slug]` page
 * draws from `listPublicSeances`: the state of a séance, its row, the days of a week and the week navigation. Every
 * function takes the pro's time zone explicitly (never the host zone), no output contains an em or en dash, and
 * nothing here imports the database: `PublicSeance` is a type import only, so a client component may load the module.
 */
import { formatTimeRange } from "@/lib/back-office/format";
import { dayLongLabel, weekTitle } from "@/lib/back-office/planning-view";
import { onlineBookability } from "@/lib/booking-window";
import { addDays, compareKeys, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { BOUNDS } from "@/lib/tickets-vocab";

import { PUBLIC_STATE_LABELS, seatsLeftLabel } from "./messages";
import type { PublicSeance } from "./planning-reads";

export type PublicSeanceState =
  | { kind: "cancelled" }
  | { kind: "past" }
  | { kind: "ongoing" }
  | { kind: "onsite" }
  | { kind: "notYet" }
  | { kind: "closed" }
  | { kind: "full" }
  | { kind: "free"; seatsLeft: number }
  | { kind: "open"; seatsLeft: number };

/**
 * Precedence (exact): cancelled; then startsAt <= now -> past (endsAt <= now) or ongoing; mode none -> onsite;
 * onlineBookability reason horizon -> notYet; reason notice, underTimeOff, or tickets mode without an accepted type
 * -> closed; seatsLeft 0 -> full; mode free -> free; else open.
 */
export function seanceState(
  s: Pick<PublicSeance, "status" | "startsAt" | "endsAt" | "bookingMode" | "seatsLeft" | "acceptedTypes" | "window" | "underTimeOff">,
  now: Date,
  tz: string,
): PublicSeanceState {
  if (s.status === "cancelled") return { kind: "cancelled" };
  if (s.startsAt.getTime() <= now.getTime()) {
    return s.endsAt.getTime() <= now.getTime() ? { kind: "past" } : { kind: "ongoing" };
  }
  if (s.bookingMode === "none") return { kind: "onsite" };
  const online = onlineBookability({ startsAt: s.startsAt, now, tz, window: s.window });
  if (!online.ok && online.reason === "horizon") return { kind: "notYet" };
  // Past cannot happen here (startsAt > now): any other refusal is the minimum notice.
  if (!online.ok || s.underTimeOff || (s.bookingMode === "tickets" && s.acceptedTypes.length === 0)) {
    return { kind: "closed" };
  }
  if (s.seatsLeft <= 0) return { kind: "full" };
  return s.bookingMode === "free" ? { kind: "free", seatsLeft: s.seatsLeft } : { kind: "open", seatsLeft: s.seatsLeft };
}

/** PUBLIC_STATE_LABELS of the state; null for open. */
export function stateLabel(state: PublicSeanceState): string | null {
  return state.kind === "open" ? null : PUBLIC_STATE_LABELS[state.kind];
}

export type PublicSeanceVM = {
  occurrenceId: string;
  href: string;
  title: string;
  color: string;
  dayKey: DateKey;
  /** formatTimeRange: « 19:00 à 20:00 » */
  timeLabel: string;
  location: string | null;
  stateText: string | null;
  /** seatsLeftLabel for open / free */
  seatsText: string | null;
  /** cancelled, past, closed, full */
  muted: boolean;
  badges: { name: string; color: string }[];
  /** COV-M12: « {title}, {dayLabel} {timeLabel}, {stateText ?? seatsText} » (the row link's accessible name) */
  ariaLabel: string;
};

/** The row of one séance (href = /{slug}/seance/{id}); dates are read in tz. */
export function toPublicSeanceVM(s: PublicSeance, slug: string, now: Date, tz: string): PublicSeanceVM {
  const state = seanceState(s, now, tz);
  const dayKey = todayKey(s.startsAt, tz);
  const timeLabel = formatTimeRange(s.startsAt, s.endsAt, tz);
  const stateText = stateLabel(state);
  const seatsText = state.kind === "open" || state.kind === "free" ? seatsLeftLabel(state.seatsLeft) : null;
  const tail = stateText ?? seatsText;
  const head = `${s.title}, ${dayLongLabel(dayKey)} ${timeLabel}`;
  return {
    occurrenceId: s.occurrenceId,
    href: `/${slug}/seance/${s.occurrenceId}`,
    title: s.title,
    color: s.color,
    dayKey,
    timeLabel,
    location: s.location,
    stateText,
    seatsText,
    muted: state.kind === "cancelled" || state.kind === "past" || state.kind === "closed" || state.kind === "full",
    badges: s.acceptedTypes.map((t) => ({ name: t.name, color: t.color })),
    ariaLabel: tail === null ? head : `${head}, ${tail}`,
  };
}

export type PublicDay = { dayKey: DateKey; label: string; seances: PublicSeanceVM[] };

/** One entry per day of `days`, in that order, empty days kept; label = dayLongLabel (« lundi 12 octobre »). */
export function groupByDay(vms: readonly PublicSeanceVM[], days: readonly DateKey[]): PublicDay[] {
  return days.map((dayKey) => ({
    dayKey,
    label: dayLongLabel(dayKey),
    seances: vms.filter((vm) => vm.dayKey === dayKey),
  }));
}

export type PlanningView = "liste" | "semaine";

const WEEK_YEARS = { min: 2000, max: 2100 } as const;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A well-formed date key between 2000 and 2100, else undefined (the page then shows this week). */
function validWeek(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    const { y } = parseKey(value);
    return y >= WEEK_YEARS.min && y <= WEEK_YEARS.max ? value : undefined;
  } catch {
    return undefined;
  }
}

/** ?semaine= (a DateKey, else undefined) and ?vue= ("semaine", else "liste"); a repeated parameter counts by its first value. */
export function parsePlanningParams(sp: { semaine?: string | string[]; vue?: string | string[] }): {
  semaine: string | undefined;
  view: PlanningView;
} {
  return { semaine: validWeek(firstOf(sp.semaine)), view: firstOf(sp.vue) === "semaine" ? "semaine" : "liste" };
}

export type PlanningNav = {
  weekKey: DateKey;
  title: string;
  prevHref: string | null;
  nextHref: string | null;
  listHref: string;
  weekHref: string;
};

/** /{slug}?semaine=<Monday>[&vue=semaine]: the only query a public week carries (no personal data). */
function publicWeekHref(slug: string, monday: DateKey, view: PlanningView): string {
  return `/${slug}?semaine=${monday}${view === "semaine" ? "&vue=semaine" : ""}`;
}

/**
 * Week navigation by local date (L1440): `weekKey` is read as the Monday of its week; prev is null on the current week
 * (or before); next is null when the next week starts past todayKey + BOUNDS.bookingHorizonDays.max (nothing can be
 * listed there); title = weekTitle(days); the hrefs keep the chosen view.
 */
export function planningNav(a: { slug: string; weekKey: DateKey; view: PlanningView; todayKey: DateKey }): PlanningNav {
  const monday = mondayOf(a.weekKey);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const prev = addDays(monday, -7);
  const next = addDays(monday, 7);
  const lastListable = addDays(a.todayKey, BOUNDS.bookingHorizonDays.max);
  return {
    weekKey: monday,
    title: weekTitle(days),
    prevHref: compareKeys(monday, mondayOf(a.todayKey)) > 0 ? publicWeekHref(a.slug, prev, a.view) : null,
    nextHref: compareKeys(next, lastListable) <= 0 ? publicWeekHref(a.slug, next, a.view) : null,
    listHref: publicWeekHref(a.slug, monday, "liste"),
    weekHref: publicWeekHref(a.slug, monday, "semaine"),
  };
}

/**
 * The empty state of the shown week. `shown` = the séances the week lists (cancelled ones included); `nextStart` = the
 * first séance after the week (nextPublicSeanceStart); `anyStart` = the first séance ahead at all, read only when the
 * week is empty and nothing follows it. null while the week lists a séance; "week" when the week is empty but another
 * one has a séance (nextWeekHref points to the next one when it follows); "all" when no séance is ahead at all.
 */
export function planningEmptyState(a: {
  slug: string;
  view: PlanningView;
  tz: string;
  shown: number;
  nextStart: Date | null;
  anyStart: Date | null;
}): { empty: "week" | "all" | null; nextWeekHref: string | null } {
  if (a.shown > 0) return { empty: null, nextWeekHref: null };
  if (a.nextStart !== null) {
    return { empty: "week", nextWeekHref: publicWeekHref(a.slug, mondayOf(todayKey(a.nextStart, a.tz)), a.view) };
  }
  return { empty: a.anyStart === null ? "all" : "week", nextWeekHref: null };
}
