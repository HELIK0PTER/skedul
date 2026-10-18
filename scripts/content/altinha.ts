/**
 * The Altinha Paris catalog (spec § 15.4): ticket types and offers, events,
 * RDV hours and booking settings. Shared by the seed (demo account) and
 * scripts/bootstrap-content.ts (the owner's real account). Data only: it is
 * written through the engine by ./apply-catalog.ts.
 */
import { addDays, dayOfWeek, type DateKey } from "@/lib/civil-date";
import type {
  AvailabilityRuleInput,
  BookingMode,
  BookingSettings,
  OfferInput,
  QuestionInput,
  RecurrenceRuleInput,
  TicketTypeInput,
} from "@/lib/tickets";

export type CatalogType = {
  key: "collectif" | "essai" | "particulier" | "decouverte";
  type: TicketTypeInput;
  offers: Omit<OfferInput, "ticketTypeId">[];
  /** per-type RDV hours (replace the global ones for this type) */
  availability?: AvailabilityRuleInput[];
  /** RDV questions */
  questions?: QuestionInput[];
};

export type CatalogEvent = {
  key: "debutants" | "intermediaires" | "roda" | "atelier" | "competition";
  title: string;
  description: string;
  location: string;
  color: string;
  bookingMode: BookingMode;
  isPrivate: boolean;
  capacity: number;
  durationMin: number;
  rule: RecurrenceRuleInput;
  ticketTypeKeys: CatalogType["key"][];
  questions?: QuestionInput[];
};

export type CatalogContent = {
  settings: BookingSettings;
  /** global RDV hours */
  availability: AvailabilityRuleInput[];
  types: CatalogType[];
  events: CatalogEvent[];
};

/** The demo pro's profile, copied from the v1 seed (bootstrap keeps the real pro's profile). */
export const ALTINHA_PROFILE = {
  slug: "altinha-paris",
  businessName: "Altinha Paris",
  headline: "Aulas de altinha em Paris, com a energia do Rio ☀️",
  bio: "A gente começou a dar aulas pra compartilhar a altinha e fazer esse esporte crescer aqui em Paris. Nascemos e crescemos no Rio, então trazemos essa energia pra cá. As aulas duram 1h, em grupos pequenos organizados por nível, pra todo mundo evoluir no seu ritmo. De segunda a sábado, entre Nation e Tuileries. 🤍",
  brandColor: "#d97706",
  themePreset: "amber",
  headerLayout: "vitrine",
  avatarKind: "generated",
  avatarStyle: "fun-emoji",
  avatarSeed: "altinha-paris",
  timezone: "Europe/Paris",
  currency: "eur",
};

/** Fixed demo client accounts (also deleted by `seed --wipe`). */
export const SEED_CLIENT_EMAILS = ["beatriz@example.com"] as const;

/** Rules for every listed day, `start`–`end` minutes after local midnight. */
function hours(days: readonly number[], ranges: readonly [number, number][]): AvailabilityRuleInput[] {
  return days.flatMap((day) => ranges.map(([startMinute, endMinute]) => ({ dayOfWeek: day, startMinute, endMinute })));
}

/** First date ≥ `from` falling on `weekday` (0 = Sunday … 6 = Saturday). */
function nextWeekday(from: DateKey, weekday: number): DateKey {
  return addDays(from, (weekday - dayOfWeek(from) + 7) % 7);
}

function weekly(startDate: DateKey, startMinute: number, weekdays: number[], interval = 1): RecurrenceRuleInput {
  return {
    startDate,
    startMinute,
    freq: "weekly",
    interval,
    weekdays,
    monthlyBy: null,
    monthWeek: null,
    endMode: "never",
    untilDate: null,
    occurrenceCount: null,
  };
}

/**
 * Spec § 15.4. Every event starts on `startDate` (local), never ends, and
 * produces its first séance on the first matching date ≥ startDate.
 */
export function altinhaCatalog(startDate: DateKey): CatalogContent {
  return {
    settings: { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 },
    // Mon–Sat, 10:00–13:00 and 17:30–20:30
    availability: hours([1, 2, 3, 4, 5, 6], [
      [600, 780],
      [1050, 1230],
    ]),
    types: [
      {
        key: "collectif",
        type: {
          name: "Cours collectif",
          description: "Une place dans un cours en groupe : débutants, intermédiaires ou atelier technique.",
          color: "#16a34a",
        },
        offers: [
          { quantity: 1, priceCents: 2500 },
          { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" },
          { quantity: 10, priceCents: 19000, validityCount: 6, validityUnit: "month" },
        ],
      },
      {
        key: "essai",
        type: {
          name: "Cours d'essai",
          description: "Votre premier cours pour découvrir l'altinha, sans engagement.",
          color: "#f59e0b",
        },
        offers: [{ quantity: 1, priceCents: 1500 }],
      },
      {
        key: "particulier",
        type: {
          name: "Cours particulier",
          description: "Un cours rien que pour vous, au rythme de vos objectifs.",
          color: "#0ea5e9",
          rdvEnabled: true,
          rdvDurationMin: 60,
        },
        offers: [
          { quantity: 1, priceCents: 5000 },
          { quantity: 5, priceCents: 22500, validityCount: 6, validityUnit: "month" },
        ],
        questions: [{ label: "Quel est votre objectif ?", type: "text", required: true }],
      },
      {
        key: "decouverte",
        type: {
          name: "Appel découverte",
          description: "15 minutes au téléphone pour faire connaissance et trouver le bon cours.",
          color: "#8b5cf6",
          rdvEnabled: true,
          rdvFree: true,
          rdvDurationMin: 15,
        },
        offers: [],
        // Mon–Fri, 12:00–14:00 (replaces the global hours for this type)
        availability: hours([1, 2, 3, 4, 5], [[720, 840]]),
      },
    ],
    events: [
      {
        key: "debutants",
        title: "Altinha débutants",
        description: "Les bases de l'altinha en petit groupe : contrôle, passes et placement.",
        location: "Jardin des Tuileries",
        color: "#16a34a",
        bookingMode: "tickets",
        isPrivate: false,
        capacity: 12,
        durationMin: 60,
        rule: weekly(startDate, 1140, [1, 3]),
        ticketTypeKeys: ["collectif", "essai"],
        questions: [{ label: "Avez-vous déjà pratiqué un sport de ballon ?", type: "boolean", required: false }],
      },
      {
        key: "intermediaires",
        title: "Altinha intermédiaires",
        description: "Pour celles et ceux qui tiennent déjà la balle : enchaînements et jeu à plusieurs.",
        location: "Place de la Nation",
        color: "#0d9488",
        bookingMode: "tickets",
        isPrivate: false,
        capacity: 12,
        durationMin: 90,
        rule: weekly(startDate, 1140, [2, 4]),
        ticketTypeKeys: ["collectif"],
      },
      {
        key: "roda",
        title: "Roda libre",
        description: "La roda ouverte à tous, un samedi sur deux. Venez jouer : l'inscription est gratuite.",
        location: "Parc de Bercy",
        color: "#f59e0b",
        bookingMode: "free",
        isPrivate: false,
        capacity: 30,
        durationMin: 120,
        rule: weekly(nextWeekday(startDate, 6), 900, [6], 2),
        ticketTypeKeys: [],
      },
      {
        key: "atelier",
        title: "Atelier technique",
        description: "Deux heures de technique en salle, le premier dimanche du mois.",
        location: "Gymnase Japy, Paris 11e",
        color: "#0ea5e9",
        bookingMode: "tickets",
        isPrivate: false,
        capacity: 10,
        durationMin: 120,
        rule: {
          startDate: nextWeekday(startDate, 0),
          startMinute: 840,
          freq: "monthly",
          interval: 1,
          weekdays: null,
          monthlyBy: "weekday",
          monthWeek: 1,
          endMode: "never",
          untilDate: null,
          occurrenceCount: null,
        },
        ticketTypeKeys: ["collectif"],
      },
      {
        key: "competition",
        title: "Équipe compétition",
        description: "L'entraînement de l'équipe qui représente Altinha Paris en tournoi. Sur invitation.",
        location: "Place de la Nation",
        color: "#dc2626",
        bookingMode: "tickets",
        isPrivate: true,
        capacity: 8,
        durationMin: 90,
        rule: weekly(startDate, 1200, [5]),
        ticketTypeKeys: ["collectif"],
      },
    ],
  };
}
