import { addDays, differenceInCalendarDays, startOfWeek } from "date-fns";

import { parseDayKey, toDayKey } from "@/lib/calendar-grid";

export interface DemoService {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  color: string;
  capacity: number;
}

export const DEMO_BRAND = {
  businessName: "Altinha Paris",
  headline: "Altinha & footvolley — Canal Saint-Martin",
  brandColor: "#6d5cf6",
};

export const DEMO_SERVICES: DemoService[] = [
  {
    id: "decouverte",
    title: "Séance découverte",
    description: "Premier contact avec le ballon, tous niveaux.",
    durationMinutes: 60,
    priceCents: 2500,
    color: "#6d5cf6",
    capacity: 1,
  },
  {
    id: "collectif",
    title: "Cours collectif",
    description: "Jeu en cercle, 8 places par session.",
    durationMinutes: 90,
    priceCents: 1800,
    color: "#0ea5e9",
    capacity: 8,
  },
  {
    id: "coaching",
    title: "Coaching privé",
    description: "Technique individuelle, vidéo à l'appui.",
    durationMinutes: 60,
    priceCents: 4000,
    color: "#16a34a",
    capacity: 1,
  },
];

export const DEMO_PACK = {
  id: "pack-10h",
  name: "Pack 10 heures",
  description: "10 crédits à utiliser sur toutes les prestations.",
  credits: 10,
  priceCents: 20000,
  scope: "Toutes prestations",
  sold: 12,
};

export const DEMO_CLIENT = { name: "Léa Martin", email: "lea@exemple.com" };

/** Offsets (jours depuis aujourd'hui) des jours réservables — la démo reste d'actualité sans maintenance. */
const AVAILABLE_OFFSETS = [2, 3, 5, 7, 9, 12, 14, 16];

/**
 * Décale toute la fenêtre de 2 jours quand le 1er jour réservable (J+2) tombe le
 * dernier jour de son mois : sinon le 2e jour (la réservation à crédit) bascule au
 * mois suivant, hors du mois affiché par le calendrier — qui se cale sur le 1er jour.
 * Ce décalage ne concerne qu'une date par mois et garde les deux premiers jours
 * dans le même mois. (La démo reste relative à « aujourd'hui ».)
 */
function windowShift(today: Date): number {
  const first = addDays(today, AVAILABLE_OFFSETS[0]);
  const second = addDays(today, AVAILABLE_OFFSETS[0] + 1);
  return first.getMonth() === second.getMonth() ? 0 : 2;
}

export function demoAvailableKeys(): string[] {
  const today = new Date();
  const shift = windowShift(today);
  return AVAILABLE_OFFSETS.map((o) => toDayKey(addDays(today, o + shift)));
}

/** Jour de la 1re réservation (payée) : J+2. */
export function bookedDayKey(): string {
  return demoAvailableKeys()[0];
}

/** Jour de la réservation à crédit : J+3. */
export function creditDayKey(): string {
  return demoAvailableKeys()[1];
}

export const DEMO_SLOT_TIMES = ["09:00", "10:30", "12:00", "14:00", "16:30", "18:00"];
export const BOOKED_TIME = "18:00";
export const CREDIT_TIME = "10:30";
export const BOOKED_RANGE = "18:00 – 19:00";
export const CREDIT_RANGE = "10:30 – 11:30";

/** Les 7 jours (lundi → dimanche) affichés par le planning pro : la semaine du jour réservé. */
export function planningWeekDays(): Date[] {
  const monday = startOfWeek(parseDayKey(bookedDayKey()), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export interface DemoSession {
  id: string;
  dayIndex: number; // 0 = lundi
  startMinute: number;
  durationMinutes: number;
  title: string;
  color: string;
  subtitle: string;
}

/** Séances déjà présentes dans le planning (hors résa de Léa). */
export const DEMO_WEEK_SESSIONS: DemoSession[] = [
  { id: "s1", dayIndex: 0, startMinute: 10 * 60, durationMinutes: 90, title: "Cours collectif", color: "#0ea5e9", subtitle: "5/8" },
  { id: "s2", dayIndex: 1, startMinute: 12 * 60, durationMinutes: 60, title: "Coaching privé", color: "#16a34a", subtitle: "Marc D." },
  { id: "s3", dayIndex: 3, startMinute: 16 * 60 + 30, durationMinutes: 90, title: "Cours collectif", color: "#0ea5e9", subtitle: "8/8" },
  { id: "s4", dayIndex: 4, startMinute: 9 * 60 + 30, durationMinutes: 60, title: "Séance découverte", color: "#6d5cf6", subtitle: "Noé P." },
];

/** La séance de Léa — apparaît dans le planning à l'étape 7. */
export function leaSession(): DemoSession {
  const monday = planningWeekDays()[0];
  const dayIndex = differenceInCalendarDays(parseDayKey(bookedDayKey()), monday);
  return {
    id: "lea",
    dayIndex,
    startMinute: 18 * 60,
    durationMinutes: 60,
    title: "Séance découverte",
    color: "#6d5cf6",
    subtitle: DEMO_CLIENT.name,
  };
}
