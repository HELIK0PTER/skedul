/**
 * The data of the guided tour (/demo), shared with the landing's product shots. A scripted simulation: nothing here
 * reads or writes the database, nothing calls the booking engine. The catalog mirrors the real Altinha Paris one
 * (scripts/content/altinha.ts, pinned by demo-data.test.ts), and every date is a civil date of the demo pro's zone,
 * so that the server render and the browser agree whatever the visitor's zone (no hydration mismatch).
 */
import { dayLabel } from "@/lib/back-office/format";
import { dayShortLabel } from "@/lib/back-office/planning-view";
import { addDays, addMonthsClamped, mondayOf, parseKey, todayKey, type DateKey } from "@/lib/civil-date";
import type { OfferChoice } from "@/lib/public/buy-and-book-form";
import { HOLD_MINUTES } from "@/lib/tickets-vocab";

export const DEMO_TZ = "Europe/Paris";

export const DEMO_BRAND = {
  businessName: "Altinha Paris",
  headline: "Cours d'altinha à Paris, entre Nation et Tuileries",
  brandColor: "#6d5cf6",
};

/** The client of the story. A reserved example address (RFC 2606): no real inbox, no account of the app. */
export const DEMO_CLIENT = { name: "Léa Martin", email: "lea.martin@example.com" };

/** The six digits Léa types in the simulated code form. Valid nowhere: the tour never signs anyone in. */
export const DEMO_CODE = "482913";

export type TypeKey = "collectif" | "essai" | "particulier" | "decouverte";

export interface DemoOffer {
  id: string;
  /** « À l'unité » or « Carnet de N », the label the app derives for an offer without its own label. */
  label: string;
  quantity: number;
  priceCents: number;
  /** Months of validity from the purchase, or null (no limit). */
  validityMonths: number | null;
  /** How many were sold (the back-office counter). */
  sold: number;
}

export interface DemoTicketType {
  key: TypeKey;
  name: string;
  description: string;
  color: string;
  offers: DemoOffer[];
  /** RDV libre: the rendez-vous a client books in the pro's hours with this type, or null. */
  rdv: { durationMin: number; free: boolean } | null;
  /** Tickets of this type held by clients (the back-office counter). */
  inCirculation: number;
}

function offer(id: string, quantity: number, priceCents: number, validityMonths: number | null, sold: number): DemoOffer {
  return { id, label: quantity === 1 ? "À l'unité" : `Carnet de ${quantity}`, quantity, priceCents, validityMonths, sold };
}

export const DEMO_TICKET_TYPES: readonly DemoTicketType[] = [
  {
    key: "collectif",
    name: "Cours collectif",
    description: "Une place dans un cours en groupe : débutants, intermédiaires ou atelier technique.",
    color: "#16a34a",
    offers: [offer("collectif-1", 1, 2500, null, 31), offer("collectif-4", 4, 8500, 3, 18), offer("collectif-10", 10, 19000, 6, 7)],
    rdv: null,
    inCirculation: 64,
  },
  {
    key: "essai",
    name: "Cours d'essai",
    description: "Votre premier cours pour découvrir l'altinha, sans engagement.",
    color: "#f59e0b",
    offers: [offer("essai-1", 1, 1500, null, 23)],
    rdv: null,
    inCirculation: 5,
  },
  {
    key: "particulier",
    name: "Cours particulier",
    description: "Un cours rien que pour vous, au rythme de vos objectifs.",
    color: "#0ea5e9",
    offers: [offer("particulier-1", 1, 5000, null, 9), offer("particulier-5", 5, 22500, 6, 3)],
    rdv: { durationMin: 60, free: false },
    inCirculation: 8,
  },
  {
    key: "decouverte",
    name: "Appel découverte",
    description: "15 minutes au téléphone pour faire connaissance et trouver le bon cours.",
    color: "#8b5cf6",
    offers: [],
    rdv: { durationMin: 15, free: true },
    inCirculation: 0,
  },
];

export function ticketType(key: TypeKey): DemoTicketType {
  const type = DEMO_TICKET_TYPES.find((t) => t.key === key);
  if (!type) throw new Error(`unknown ticket type ${key}`);
  return type;
}

/** An offer as « Acheter et réserver » takes it (its validity in months; every demo offer covers the séance). */
export function offerChoice(offer: DemoOffer): OfferChoice {
  return {
    offerId: offer.id,
    label: offer.label,
    priceCents: offer.priceCents,
    validityText: offer.validityMonths === null ? null : `${offer.validityMonths} mois`,
    covers: true,
  };
}

/** The offer Léa buys on her first séance: the Carnet de 4 of Cours collectif. */
export const CARNET_OFFER_ID = "collectif-4";
export const DEMO_CARNET: DemoOffer = (() => {
  const found = ticketType("collectif").offers.find((o) => o.id === CARNET_OFFER_ID);
  if (!found) throw new Error("the demo carnet is missing");
  return found;
})();

export type EventKey = "debutants" | "intermediaires" | "roda" | "atelier" | "competition";

export interface DemoEvent {
  key: EventKey;
  title: string;
  description: string;
  location: string;
  color: string;
  capacity: number;
  durationMin: number;
  /** Minutes after local midnight. */
  startMinute: number;
  mode: "tickets" | "free";
  isPrivate: boolean;
  /** The ticket types a séance accepts (none for a free registration). */
  accepts: TypeKey[];
  /** The repetition, as the event list writes it. */
  recurrenceLabel: string;
  /** Days of the shown week (0 = Monday) holding a séance; the atelier is resolved by `weekSeances`. */
  days: number[];
}

export const DEMO_EVENTS: readonly DemoEvent[] = [
  {
    key: "debutants",
    title: "Altinha débutants",
    description: "Les bases de l'altinha en petit groupe : contrôle, passes et placement.",
    location: "Jardin des Tuileries",
    color: "#16a34a",
    capacity: 12,
    durationMin: 60,
    startMinute: 19 * 60,
    mode: "tickets",
    isPrivate: false,
    accepts: ["collectif", "essai"],
    recurrenceLabel: "Toutes les semaines le lundi et le mercredi",
    days: [0, 2],
  },
  {
    key: "intermediaires",
    title: "Altinha intermédiaires",
    description: "Pour celles et ceux qui tiennent déjà la balle : enchaînements et jeu à plusieurs.",
    location: "Place de la Nation",
    color: "#0d9488",
    capacity: 12,
    durationMin: 90,
    startMinute: 19 * 60,
    mode: "tickets",
    isPrivate: false,
    accepts: ["collectif"],
    recurrenceLabel: "Toutes les semaines le mardi et le jeudi",
    days: [1, 3],
  },
  {
    key: "roda",
    title: "Roda libre",
    description: "La roda ouverte à tous, un samedi sur deux. Venez jouer : l'inscription est gratuite.",
    location: "Parc de Bercy",
    color: "#f59e0b",
    capacity: 30,
    durationMin: 120,
    startMinute: 15 * 60,
    mode: "free",
    isPrivate: false,
    accepts: [],
    recurrenceLabel: "Toutes les 2 semaines le samedi",
    days: [5],
  },
  {
    key: "atelier",
    title: "Atelier technique",
    description: "Deux heures de technique en salle, le premier dimanche du mois.",
    location: "Gymnase Japy, Paris 11e",
    color: "#0ea5e9",
    capacity: 10,
    durationMin: 120,
    startMinute: 14 * 60,
    mode: "tickets",
    isPrivate: false,
    accepts: ["collectif"],
    recurrenceLabel: "Tous les mois le 1er dimanche",
    days: [6],
  },
  {
    key: "competition",
    title: "Équipe compétition",
    description: "L'entraînement de l'équipe qui représente Altinha Paris en tournoi. Sur invitation.",
    location: "Place de la Nation",
    color: "#dc2626",
    capacity: 8,
    durationMin: 90,
    startMinute: 20 * 60,
    mode: "tickets",
    isPrivate: true,
    accepts: ["collectif"],
    recurrenceLabel: "Toutes les semaines le vendredi",
    days: [4],
  },
];

export function demoEvent(key: EventKey): DemoEvent {
  const event = DEMO_EVENTS.find((e) => e.key === key);
  if (!event) throw new Error(`unknown event ${key}`);
  return event;
}

/** Today in the demo pro's zone: the same key on the server and in the browser. */
export function demoToday(): DateKey {
  return todayKey(new Date(), DEMO_TZ);
}

/** The week the tour shows: the seven days from the Monday after today, so that every séance of the story is ahead. */
export function demoWeek(): DateKey[] {
  const monday = mondayOf(addDays(demoToday(), 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Places already taken (before Léa) on each séance of the shown week, by event and day. */
const TAKEN: Record<string, number> = {
  "debutants-0": 5,
  "debutants-2": 8,
  "intermediaires-1": 7,
  "intermediaires-3": 11,
  "competition-4": 6,
  "roda-5": 14,
  "atelier-6": 4,
};

export interface DemoSeance {
  /** `${event}-${dayIndex}` */
  id: string;
  event: EventKey;
  /** 0 = Monday */
  dayIndex: number;
  startMinute: number;
  durationMin: number;
  title: string;
  location: string;
  color: string;
  capacity: number;
  /** Places taken before Léa books. */
  taken: number;
  mode: DemoEvent["mode"];
  isPrivate: boolean;
  accepts: TypeKey[];
}

/** The séances of the shown week, day by day. The atelier only runs on the first Sunday of a month. */
export function weekSeances(week: readonly DateKey[] = demoWeek()): DemoSeance[] {
  const out: DemoSeance[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    for (const e of DEMO_EVENTS) {
      if (!e.days.includes(dayIndex)) continue;
      if (e.key === "atelier" && parseKey(week[dayIndex]).d > 7) continue;
      const id = `${e.key}-${dayIndex}`;
      out.push({
        id,
        event: e.key,
        dayIndex,
        startMinute: e.startMinute,
        durationMin: e.durationMin,
        title: e.title,
        location: e.location,
        color: e.color,
        capacity: e.capacity,
        taken: TAKEN[id] ?? 0,
        mode: e.mode,
        isPrivate: e.isPrivate,
        accepts: e.accepts,
      });
    }
  }
  return out;
}

/** The two séances Léa books: Monday's (with the carnet she buys) and Wednesday's (with one of its tickets). */
export const LEA_SEANCE_IDS = { monday: "debutants-0", wednesday: "debutants-2" } as const;

export function seanceById(id: string, week?: readonly DateKey[]): DemoSeance {
  const seance = weekSeances(week).find((s) => s.id === id);
  if (!seance) throw new Error(`unknown séance ${id}`);
  return seance;
}

export interface DemoRdv {
  id: string;
  type: TypeKey;
  dayIndex: number;
  startMinute: number;
  durationMin: number;
  who: string;
}

/** The rendez-vous already in the pro's week (Léa's arrives during the tour). */
export const WEEK_RDVS: readonly DemoRdv[] = [
  { id: "rdv-marc", type: "particulier", dayIndex: 3, startMinute: 11 * 60, durationMin: 60, who: "Marc Dubois" },
  { id: "rdv-ines", type: "decouverte", dayIndex: 0, startMinute: 12 * 60 + 15, durationMin: 15, who: "Inès Moreau" },
];

/** Léa's free Appel découverte: Tuesday 12:30, 15 minutes. */
export const LEA_RDV = { id: "rdv-lea", type: "decouverte" as TypeKey, dayIndex: 1, time: "12:30", startMinute: 12 * 60 + 30, durationMin: 15 };

/** « 19:00 » */
export function timeLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** « 19:00 à 20:00 » */
export function rangeLabel(startMinute: number, durationMin: number): string {
  return `${timeLabel(startMinute)} à ${timeLabel(startMinute + durationMin)}`;
}

/**
 * The Appel découverte slots of a day of the shown week (0 = Monday): its own hours, Monday to Friday 12:00 to 14:00,
 * one slot every 15 minutes. The slot of Marc's or Inès's rendez-vous is gone.
 */
export function rdvSlots(dayIndex: number): string[] {
  if (dayIndex < 0 || dayIndex > 4) return [];
  const taken = new Set(WEEK_RDVS.filter((r) => r.type === "decouverte" && r.dayIndex === dayIndex).map((r) => r.startMinute));
  const out: string[] = [];
  for (let m = 12 * 60; m + 15 <= 14 * 60; m += 15) if (!taken.has(m)) out.push(timeLabel(m));
  return out;
}

/** The hours the pro planning shows. */
export const PLANNING_HOURS = { start: 10, end: 22 };

/** The last valid day of the carnet Léa buys today (its validity counts from the purchase). */
export function carnetExpiryKey(): DateKey {
  return addMonthsClamped(demoToday(), DEMO_CARNET.validityMonths ?? 0);
}

/** « 02/02 », or « 02/02/2027 » when that day is not in this year (the back-office rule). */
export function dayMonth(key: DateKey): string {
  return dayLabel(key, parseKey(demoToday()).y);
}

/** A civil date at noon UTC: its weekday and month read the same in every zone. */
function civilNoon(key: DateKey): Date {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const WEEKDAY_SHORT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

/** « lun. 2 » for a day of the shown week (0 = Monday). */
export function weekDayLabel(dayIndex: number, week: readonly DateKey[] = demoWeek()): string {
  return dayShortLabel(week[dayIndex]);
}

/** « lun. 2 novembre 2026 · 19:00 à 20:00 », as the booking pages write a séance. */
export function whenLong(key: DateKey, startMinute: number, durationMin: number): string {
  return `${dayShortLabel(key)} ${MONTH_LONG.format(civilNoon(key))} ${parseKey(key).y} · ${rangeLabel(startMinute, durationMin)}`;
}

/** « lun. 02/11 · 19:00 », as the client space writes a booking. */
export function whenShort(key: DateKey, minute: number): string {
  return `${WEEKDAY_SHORT.format(civilNoon(key))} ${dayMonth(key)} · ${timeLabel(minute)}`;
}

/** « 3 valables jusqu'au 29/01 inclus »: the tickets left of Léa's carnet. */
export function carnetExpiryLine(count: number): string {
  return `${count} ${count < 2 ? "valable" : "valables"} jusqu'au ${dayMonth(carnetExpiryKey())} inclus`;
}

/**
 * « 18:42 »: the end of a seat hold taken now (HOLD_MINUTES), in the pro's zone. Shown in the browser only: a hold is
 * never on screen when a step opens, so the server never renders it.
 */
export function holdUntilLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: DEMO_TZ }).format(
    new Date(now.getTime() + HOLD_MINUTES * 60_000),
  );
}

/** The free Appel découverte's own hours, as its ticket type page writes them. */
export const DECOUVERTE_HOURS = "Du lundi au vendredi, de 12:00 à 14:00";

/**
 * The clients registered on Monday's débutants séance before Léa, with the ticket each one used. Example names only.
 */
export const MONDAY_ATTENDEES: readonly { name: string; coverage: "ticket" | "guest"; ticket: string | null }[] = [
  { name: "Camille Bernard", coverage: "ticket", ticket: "Cours collectif" },
  { name: "Hugo Lefèvre", coverage: "ticket", ticket: "Cours collectif" },
  { name: "Sarah Petit", coverage: "ticket", ticket: "Cours d'essai" },
  { name: "Nora Haddad", coverage: "ticket", ticket: "Cours collectif" },
  { name: "Tom Girard", coverage: "guest", ticket: null },
];
