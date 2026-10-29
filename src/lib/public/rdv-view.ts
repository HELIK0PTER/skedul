/**
 * Pure view model of the RDV page `/{slug}/rdv/{ticketTypeId}` (P5 dossier § 3.2, § 3.6, § 3.11; O8, O15, O28, O30):
 * the week it shows and its navigation, the days and their time chips, the mode of a chosen slot, the sign-in hint, and
 * the labels of a type (its duration, its price). Client-safe: no database, no env and no clock of its own (`now` comes
 * from the page, every slot as an ISO string the server rendered). Every instant is read in the PRO's zone and every day
 * label from its DateKey, never in the host zone. No text here names a séance, an inscription or a place, and none holds
 * a dash (rdv-view.test.ts).
 */
import { formatTimeRange, formatWhen, pluralWord } from "@/lib/back-office/format";
import { dayLongLabel, dayShortLabel, weekTitle } from "@/lib/back-office/planning-view";
import { lastBookableDate, type BookingWindow } from "@/lib/booking-window";
import { addDays, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import { formatTime } from "@/lib/datetime";
import type { VisitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import { formatMoney } from "@/lib/utils";

/** What the week rules read of a type's effective window. */
export type RdvWindow = Pick<BookingWindow, "bookingHorizonDays" | "minNoticeMinutes">;

/* ───────────────────────── the week ───────────────────────── */

type WeekBounds = {
  /** the Monday of today's week */
  current: DateKey;
  /** the Monday of the week holding the last bookable day (today + horizon) */
  horizon: DateKey;
  /** the week the page opens on: the one of now + notice, never past the horizon week */
  fallback: DateKey;
};

function weekBoundsOf(now: Date, tz: string, window: RdvWindow): WeekBounds {
  const current = mondayOf(todayKey(now, tz));
  const horizon = mondayOf(lastBookableDate(now, tz, window.bookingHorizonDays));
  const noticed = mondayOf(todayKey(new Date(now.getTime() + window.minNoticeMinutes * 60_000), tz));
  return { current, horizon, fallback: noticed > horizon ? horizon : noticed };
}

const WEEK_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written YYYY-MM-DD, else null. */
function realDateKey(value: string | undefined): DateKey | null {
  if (value === undefined || !WEEK_PARAM_RE.test(value)) return null;
  try {
    parseKey(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * The Monday of the week the page shows (O28). `?semaine=` names it when it is a real date whose week lies between the
 * current week and the horizon week (the week of today + horizon, by local date in the pro's zone); anything else
 * (absent, malformed, a past week, a week beyond the horizon) gives the week of now + notice, so the first slot that can
 * be booked is on the first screen. A notice longer than the horizon (a type never bookable) stops at the horizon week.
 */
export function rdvWeekKey(param: string | undefined, now: Date, tz: string, window: RdvWindow): DateKey {
  const bounds = weekBoundsOf(now, tz, window);
  const asked = realDateKey(param);
  if (asked === null) return bounds.fallback;
  const monday = mondayOf(asked);
  return monday < bounds.current || monday > bounds.horizon ? bounds.fallback : monday;
}

/** /{slug}/rdv/{ticketTypeId}, every segment encoded: the RDV page of a type (its cards, the espace, the back office). */
export function rdvPagePath(slug: string, ticketTypeId: string): string {
  return `/${encodeURIComponent(slug)}/rdv/${encodeURIComponent(ticketTypeId)}`;
}

/** /{slug}/rdv/{ticketTypeId}?semaine={monday}: the only query a week carries (no personal data), every segment encoded. */
export function rdvWeekHref(slug: string, ticketTypeId: string, monday: DateKey): string {
  return `${rdvPagePath(slug, ticketTypeId)}?semaine=${monday}`;
}

export type RdvWeekNav = {
  /** the Monday of the shown week */
  weekKey: DateKey;
  /** « 26 octobre au 1er novembre 2026 » */
  title: string;
  /** null on the current week: nothing before it can be booked */
  prevHref: string | null;
  /** null on the horizon week: nothing after it can be booked */
  nextHref: string | null;
};

/** The week navigation of the RDV page, by local date in the pro's zone; `weekKey` is read as the Monday of its week. */
export function rdvWeekNav(a: {
  slug: string;
  ticketTypeId: string;
  weekKey: DateKey;
  now: Date;
  tz: string;
  window: RdvWindow;
}): RdvWeekNav {
  const bounds = weekBoundsOf(a.now, a.tz, a.window);
  const monday = mondayOf(a.weekKey);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return {
    weekKey: monday,
    title: weekTitle(days),
    prevHref: monday > bounds.current ? rdvWeekHref(a.slug, a.ticketTypeId, addDays(monday, -7)) : null,
    nextHref: monday < bounds.horizon ? rdvWeekHref(a.slug, a.ticketTypeId, addDays(monday, 7)) : null,
  };
}

/* ───────────────────────── the days and their chips ───────────────────────── */

export type RdvSlotVM = {
  /** the start as the server rendered it (`toISOString()`): the form posts it verbatim, never a rebuilt wall time */
  iso: string;
  /** « 10:00 » in the pro's zone: the chip's text */
  time: string;
  /** « lun. 2 novembre 2026 · 10:00 à 10:30 »: the chosen slot and the booked line */
  whenLabel: string;
  /** « lundi 2 novembre 2026, 10:00 à 10:30 »: the chip's accessible name, the full date and time */
  ariaLabel: string;
};

export type RdvDayVM = {
  key: DateKey;
  /** « lundi 2 novembre » (from the DateKey, never an instant) */
  label: string;
  /** « lun. 2 »: the day chip */
  shortLabel: string;
  slots: RdvSlotVM[];
};

/** The days of a week (as the slot loader groups them, by local date) with their chips, every label in the pro's zone. */
export function rdvDaysVM(
  days: readonly { key: DateKey; slots: readonly { start: Date; end: Date }[] }[],
  tz: string,
): RdvDayVM[] {
  return days.map((day) => {
    const label = dayLongLabel(day.key);
    const year = parseKey(day.key).y;
    return {
      key: day.key,
      label,
      shortLabel: dayShortLabel(day.key),
      slots: day.slots.map((s) => ({
        iso: s.start.toISOString(),
        time: formatTime(s.start, tz),
        whenLabel: formatWhen(s.start, s.end, tz),
        ariaLabel: `${label} ${year}, ${formatTimeRange(s.start, s.end, tz)}`,
      })),
    };
  });
}

/* ───────────────────────── the mode of a slot (§ 3.6) ───────────────────────── */

/**
 * Whether the Owner can spend a ticket on a slot starting at `startsAtIso`, and how many she keeps after. `tickets` are
 * hers of THIS type, usable now (`rdvOwnerTickets`): a ticket is usable at the start when it has no expiry or expires
 * after the start (ELIGIBLE's `expires_at > starts_at`), so one expiring exactly at the start is not. `leftAfter` is the
 * usable ones minus the one spent (P4 Review Focus 6: never counted over every type).
 */
export function canSpendAt(
  tickets: readonly { expiresAt: string | null }[],
  startsAtIso: string,
): { canSpend: boolean; leftAfter: number } {
  const start = Date.parse(startsAtIso);
  const usable = tickets.filter((t) => t.expiresAt === null || Date.parse(t.expiresAt) > start).length;
  return usable === 0 ? { canSpend: false, leftAfter: 0 } : { canSpend: true, leftAfter: usable - 1 };
}

/** The offers whose tickets would still be valid at the start (no validity, or `coversUntil` after it), in their order. */
export function offersCoveringAt<T extends { coversUntil: string | null }>(offers: readonly T[], startsAtIso: string): T[] {
  const start = Date.parse(startsAtIso);
  return offers.filter((o) => o.coversUntil === null || Date.parse(o.coversUntil) > start);
}

export type RdvSlotMode<T> =
  | { kind: "free" }
  | { kind: "held"; leftAfter: number }
  | { kind: "tickets_only" }
  | { kind: "buy"; offers: T[] };

/**
 * What the form of a chosen slot is (§ 3.6, the séance page's TicketsBooking rule): a free type books for free; a paid
 * type spends the Owner's ticket when one is usable at this start (and shows nothing else); with no offer on sale at all
 * it is for ticket holders only (`tickets_only`, rdvTicketsOnlyLine: R3); otherwise it buys, with the offers covering
 * this start only (none: the page says COPY.RDV_NO_OFFER). `offers` are the type's offers on sale. `ownerTickets` is
 * null for anyone but the Owner: a typed address, a guest cookie or an impersonating admin never spends.
 */
export function rdvSlotMode<T extends { coversUntil: string | null }>(a: {
  isFree: boolean;
  startsAtIso: string;
  ownerTickets: readonly { expiresAt: string | null }[] | null;
  offers: readonly T[];
}): RdvSlotMode<T> {
  if (a.isFree) return { kind: "free" };
  if (a.ownerTickets !== null) {
    const spend = canSpendAt(a.ownerTickets, a.startsAtIso);
    if (spend.canSpend) return { kind: "held", leftAfter: spend.leftAfter };
  }
  if (a.offers.length === 0) return { kind: "tickets_only" };
  return { kind: "buy", offers: offersCoveringAt(a.offers, a.startsAtIso) };
}

/**
 * The line of a paid type with no offer on sale (R3): it is booked with a ticket already held. An anonymous visitor, the
 * one the card shows « J'ai déjà des tickets » to (`hint` "prompt"), is pointed to it; the others have no such prompt.
 */
export function rdvTicketsOnlyLine(hint: "prompt" | "confirm" | null): string {
  return hint === "prompt" ? `${COPY.RDV_TICKETS_ONLY} Pour l'utiliser, cliquez sur « ${COPY.HAVE_TICKETS} ».` : COPY.RDV_TICKETS_ONLY;
}

/**
 * What a paid type offers a visitor who may hold tickets: « J'ai déjà des tickets » (the code sign-in dialog) to an
 * anonymous visitor only (risk 7: the form would purge the password of an unverified account), the « Confirmez votre
 * email » hint to an unverified one; nothing to a verified visitor, an impersonating admin, or on a free type.
 */
export function rdvSignInHint(a: { isFree: boolean; state: VisitorState }): "prompt" | "confirm" | null {
  if (a.isFree) return null;
  if (canOfferCodeSignIn(a.state)) return "prompt";
  return a.state === "unverified" ? "confirm" : null;
}

/* ───────────────────────── the type's labels and the copy ───────────────────────── */

/** « 30 minutes », « 1 heure », « 1 heure 30 », « 2 heures ». */
export function rdvDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} ${pluralWord(minutes, "minute", "minutes")}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const head = `${hours} ${pluralWord(hours, "heure", "heures")}`;
  return rest === 0 ? head : `${head} ${rest}`;
}

/** « Gratuit » for a free type, « À partir de {prix} » with the lowest price on sale, null when nothing is on sale. */
export function rdvPriceLabel(type: { isFree: boolean; fromPriceCents: number | null }, currency: string): string | null {
  if (type.isFree) return "Gratuit";
  return type.fromPriceCents === null ? null : `À partir de ${formatMoney(type.fromPriceCents, currency)}`;
}

/** The heading of the RDV cards of `/[slug]`. */
export const RDV_CARDS_TITLE = "Prendre rendez-vous";

export type RdvCardVM = {
  ticketTypeId: string;
  name: string;
  description: string | null;
  /** « 15 minutes », « 1 heure » */
  durationLabel: string;
  /** « Gratuit », « À partir de 50 € », null for a paid type with nothing on sale (only ticket holders can book) */
  priceLabel: string | null;
  isFree: boolean;
  href: string;
  /** COPY.RDV_CARD_CTA, the visible label of the link */
  ctaLabel: string;
  /** « Réserver un rendez-vous : {name} »: starts with the visible label (WCAG 2.5.3) and tells the cards apart */
  ctaAriaLabel: string;
};

/**
 * One RDV card of `/[slug]` (§ 3.11, O8): the name, the duration, « Gratuit » or « À partir de » the lowest price on
 * sale, the description and the link to the type's page. No next-slot is computed: the card is facts of the type only.
 */
export function rdvCardVM(
  card: { ticketTypeId: string; name: string; description: string | null; durationMin: number; isFree: boolean; fromPriceCents: number | null },
  slug: string,
  currency: string,
): RdvCardVM {
  return {
    ticketTypeId: card.ticketTypeId,
    name: card.name,
    description: card.description,
    durationLabel: rdvDurationLabel(card.durationMin),
    priceLabel: rdvPriceLabel(card, currency),
    isFree: card.isFree,
    href: rdvPagePath(slug, card.ticketTypeId),
    ctaLabel: COPY.RDV_CARD_CTA,
    ctaAriaLabel: `${COPY.RDV_CARD_CTA} : ${card.name}`,
  };
}

/** The lowest price of the offers on sale (the « À partir de » of the page), null without any. */
export function lowestPriceCents(offers: readonly { priceCents: number }[]): number | null {
  return offers.length === 0 ? null : Math.min(...offers.map((o) => o.priceCents));
}

/** The title of the booking card. */
export const RDV_PICK_TITLE = "Choisissez un créneau";
/** The accessible name of the day chips. */
export const RDV_DAYS_LABEL = "Jours de la semaine";
/** The week navigation (« Semaine suivante » is COPY.RDV_NEXT_WEEK, shared with the empty week). */
export const RDV_PREV_WEEK = "Semaine précédente";
/** Above the form of the chosen slot: « Créneau choisi : {when} ». */
export const RDV_CHOSEN_LABEL = "Créneau choisi";

/** « aucun créneau », « 1 créneau », « 3 créneaux »: under a day chip. */
export function rdvSlotCountLabel(n: number): string {
  return n === 0 ? "aucun créneau" : `${n} ${pluralWord(n, "créneau", "créneaux")}`;
}

/** « lundi 2 novembre, 3 créneaux »: the accessible name of a day chip (its text is the short label and the count). */
export function rdvDayChipLabel(day: { label: string; slots: readonly unknown[] }): string {
  return `${day.label}, ${rdvSlotCountLabel(day.slots.length)}`;
}

/** « Créneaux du lundi 2 novembre »: the accessible name of a day's time chips. */
export function rdvTimesLabel(dayLabel: string): string {
  return `Créneaux du ${dayLabel}`;
}

/** The line a booked slot leaves on the page (§ 3.3 ruling): the day and the time, then the e-mail sent. */
export function rdvBookedLine(whenLabel: string, withTicket: boolean): string {
  return `Rendez-vous confirmé${withTicket ? " avec 1 ticket" : ""} : ${whenLabel}. Un email de confirmation vous a été envoyé.`;
}
