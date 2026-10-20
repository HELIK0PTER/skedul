/**
 * UI-only labels of the back-office (modes, question types, weekdays, alert
 * tones, ticket origins). Pure; imports types from the vocabulary only. Labels
 * that also reach the public pages or the e-mails live in tickets-vocab.ts.
 */
import type { BookingMode, QuestionType, ValidityUnit } from "@/lib/tickets-vocab";

export const MODE_SHORT_LABELS: Record<BookingMode, string> = {
  tickets: "Sur tickets",
  free: "Inscription libre",
  none: "Sur place",
};

export const MODE_HELP: Record<BookingMode, string> = {
  tickets: "Vos clients réservent avec un ticket d'un type accepté, ou l'achètent en réservant.",
  free: "Inscription par email, gratuite, dans la limite des places.",
  none: "Pas de réservation en ligne : la séance est affichée « Sur place » sur votre page.",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: "Texte libre",
  choice: "Choix dans une liste",
  boolean: "Oui ou non",
};

export const VALIDITY_UNIT_LABELS: Record<ValidityUnit, string> = {
  day: "jours",
  month: "mois",
};

/** Monday first (day-of-week 0 is Sunday, as in availability_rule and recurrence). */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_LETTERS: Readonly<Record<number, string>> = {
  0: "D",
  1: "L",
  2: "M",
  3: "M",
  4: "J",
  5: "V",
  6: "S",
};

export const WEEKDAY_NAMES: Readonly<Record<number, string>> = {
  0: "dimanche",
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
};

export type AlertTone = "red" | "orange";

export const ALERT_LABELS: Record<AlertTone, string> = {
  red: "Tickets d'un type archivé",
  orange: "Type lié à aucun événement à venir",
};

/** The alerts in a few words, for a narrow table cell; ALERT_LABELS says them in full (tooltip, cards, accessible name). */
export const ALERT_SHORT_LABELS: Record<AlertTone, string> = {
  red: "Type archivé",
  orange: "Aucun événement à venir",
};

export const ORIGIN_LABELS ={ purchased: "Acheté", offered: "Offert" } as const;
