/**
 * Tickets & événements vocabulary: enum values (pgEnum sources), French
 * labels, bounds, engine constants, engine error codes and their client-facing
 * messages, small helpers. No import at all (not even zod), so client
 * components may load it without pulling the schemas; src/lib/tickets.ts
 * re-exports everything here next to the zod input schemas.
 */

/* ───────────────────────── Enum values (pgEnum sources) ───────────────────────── */

export const BOOKING_MODES = ["tickets", "free", "none"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const RECURRENCE_FREQS = ["once", "daily", "weekly", "monthly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const MONTHLY_BY = ["day_of_month", "weekday"] as const;
export type MonthlyBy = (typeof MONTHLY_BY)[number];

export const RECURRENCE_ENDS = ["never", "until", "count"] as const;
export type RecurrenceEnd = (typeof RECURRENCE_ENDS)[number];

export const VALIDITY_UNITS = ["day", "month"] as const;
export type ValidityUnit = (typeof VALIDITY_UNITS)[number];

export const OCCURRENCE_STATUSES = ["scheduled", "cancelled"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "expired"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_COVERAGES = ["ticket", "free", "guest"] as const;
export type BookingCoverage = (typeof BOOKING_COVERAGES)[number];

export const ACTORS = ["client", "pro", "system"] as const;
export type Actor = (typeof ACTORS)[number];

export const PURCHASE_STATUSES = ["pending", "paid", "expired"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const TICKET_STATUSES = ["available", "booked", "used", "expired", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CLOSE_REASONS = ["rembourse", "compense", "retire", "autre"] as const;
export type TicketCloseReason = (typeof TICKET_CLOSE_REASONS)[number];

export const MOVEMENT_KINDS = [
  "purchase",
  "offer",
  "spend",
  "return",
  "pointage",
  "unpoint",
  "convert",
  "expire",
  "close",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const QUESTION_TYPES = ["text", "choice", "boolean"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The answers a boolean question accepts (the engine checks them, the forms offer them). */
export const BOOLEAN_ANSWERS = ["Oui", "Non"] as const;

/* ───────────────────────────── Labels (FR) ───────────────────────────── */

export const BOOKING_MODE_LABELS: Record<BookingMode, string> = {
  tickets: "Sur tickets",
  free: "Inscription libre",
  none: "Sans réservation en ligne",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  expired: "Expirée",
};

export const COVERAGE_LABELS: Record<BookingCoverage, string> = {
  ticket: "Ticket",
  free: "Inscription libre",
  guest: "Invité",
};

/** The coverage of one booking in words: a free rendez-vous is « Gratuit », never an « inscription » (P5 § 3.10). */
export function coverageLabelOf(coverage: BookingCoverage, isRdv: boolean): string {
  return isRdv && coverage === "free" ? "Gratuit" : COVERAGE_LABELS[coverage];
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "En attente",
  paid: "Payé",
  expired: "Expiré",
};

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  scheduled: "Planifiée",
  cancelled: "Annulée",
};

export const CLOSE_REASON_LABELS: Record<TicketCloseReason, string> = {
  rembourse: "Remboursé hors Skedul",
  compense: "Compensé",
  retire: "Retiré",
  autre: "Autre",
};

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  purchase: "Acheté",
  offer: "Offert",
  spend: "Utilisé pour une inscription",
  return: "Rendu",
  pointage: "Pointé",
  unpoint: "Pointage annulé",
  convert: "Converti",
  expire: "Expiré",
  close: "Clos",
};

export const ACTOR_LABELS: Record<Actor, string> = {
  client: "Client",
  pro: "Vous",
  system: "Skedul",
};

/* ───────────────────────────── Bounds ───────────────────────────── */

export const BOUNDS = {
  bookingHorizonDays: { min: 1, max: 365, default: 60 },
  minNoticeMinutes: { min: 0, max: 10_080, default: 60 },
  cancelDeadlineHours: { min: 0, max: 720, default: 24 },
  capacity: { min: 1, max: 500, default: 12 },
  eventDurationMin: { min: 5, max: 720, step: 5, default: 60 },
  rdvDurationMin: { min: 5, max: 480, step: 5, default: 60 },
  rdvBufferMin: { min: 0, max: 240 },
  offerQuantity: { min: 1, max: 100 },
  offerPriceCents: { min: 1, max: 1_000_000 },
  validityCount: { min: 1, max: 1000 },
  occurrenceCount: { min: 1, max: 730 },
  interval: { once: 1, daily: 31, weekly: 52, monthly: 12 },
  untilYears: 5,
  startMinute: { min: 0, max: 1439 },
  name: 80,
  title: 120,
  description: 2000,
  location: 200,
  offerLabel: 80,
  phone: 30,
  note: 500,
  questionLabel: 200,
  questionOptions: 20,
  answer: 2000,
  questions: 20,
  walletQuantity: 100,
  /** weekly hours of one scope (global or one type): at most 24 ranges a day */
  hoursRules: 7 * 24,
} as const;

/** Event occurrences are materialised this many days ahead of local today. */
export const MATERIALIZE_DAYS = 400;
/** Renders call ensureHorizon only when min(generated_until) < today + this. */
export const HORIZON_REFRESH_DAYS = 393;
/** At most this many occurrence rows are inserted by one call. */
export const MATERIALIZE_MAX_ROWS = 450;

/** A buy+book booking holds its seat this long (`hold_expires_at`). */
export const HOLD_MINUTES = 45;
/** Stripe Checkout `expires_at` for a buy+book purchase (Stripe minimum: 30). */
export const CHECKOUT_MINUTES = 31;
/** Stripe Checkout `expires_at` for a shop purchase. */
export const SHOP_CHECKOUT_HOURS = 24;
/** A pending purchase this long past `checkout_expires_at` is expired by the nightly job. */
export const STALE_PURCHASE_GRACE_MINUTES = 60;
/** Live holds (pending bookings) one customer may have at once. */
export const MAX_PENDING_HOLDS = 2;

export const THROTTLE_WINDOW_SEC = 3600;
/** Public actions that consume throttle keys (src/lib/throttle.ts `actionThrottleKeys`). « mail », « horizon », « otp », « reset » and « track » name other key families of the same table and are never actions. */
export const THROTTLE_ACTIONS = ["free", "buybook", "rdv", "shop", "held", "cancel", "release"] as const;
export type ThrottleAction = (typeof THROTTLE_ACTIONS)[number];
/**
 * Limits per THROTTLE_WINDOW_SEC. `ip`: per IPv4 address or IPv6 /64; `ip48`: per IPv6 /48; `email`: per
 * (pro, typed address) AND per verified user; `emailGlobal`: per typed address across pros (the mailbox
 * bound); `perOccurrenceIp`: per séance and IP on the seat-taking actions; `perProIp`: per pro and IP on
 * free registrations and on RDV bookings of every mode (P5 O22: it bounds the filling of a pro's calendar;
 * an RDV has no occurrence before it is booked, so it has no per-séance key). A null limit means the key
 * does not exist for that action.
 */
export type ThrottleLimits = {
  ip: number;
  ip48: number;
  email: number;
  emailGlobal: number;
  perOccurrenceIp: number | null;
  perProIp: number | null;
};
export const THROTTLE_LIMITS: Record<ThrottleAction, ThrottleLimits> = {
  free: { ip: 20, ip48: 60, email: 6, emailGlobal: 20, perOccurrenceIp: 2, perProIp: 6 },
  buybook: { ip: 20, ip48: 60, email: 6, emailGlobal: 20, perOccurrenceIp: 2, perProIp: null },
  rdv: { ip: 20, ip48: 60, email: 6, emailGlobal: 20, perOccurrenceIp: null, perProIp: 6 },
  shop: { ip: 20, ip48: 60, email: 6, emailGlobal: 20, perOccurrenceIp: null, perProIp: null },
  held: { ip: 20, ip48: 60, email: 10, emailGlobal: 20, perOccurrenceIp: null, perProIp: null },
  cancel: { ip: 20, ip48: 60, email: 10, emailGlobal: 20, perOccurrenceIp: null, perProIp: null },
  release: { ip: 30, ip48: 90, email: 30, emailGlobal: 30, perOccurrenceIp: null, perProIp: null },
};
/**
 * Page-view beacons (/api/track) per THROTTLE_WINDOW_SEC (P6 A8): `ip` per IPv4 address or IPv6 /64, `ip48` per IPv6
 * /48. A reader sends one beacon per page, so 600 an hour (10 a minute, all hour long) leaves room for a shared
 * address (an office, a school) and still bounds the rows a script can write into the traffic stats.
 */
export const TRACK_THROTTLE_LIMITS = { ip: 600, ip48: 1800 } as const;
/** Sign-in / verification codes sent to one address per hour (auth hook). */
export const OTP_EMAIL_LIMIT = { limit: 5, windowSec: 3600 } as const;
/** `throttle` rows older than this are purged by the nightly job. */
export const THROTTLE_PURGE_DAYS = 2;

export const DEFAULT_COLOR = "#6366f1";

/* ───────────────────────── Engine error codes ───────────────────────── */

export const ENGINE_ERROR_CODES = [
  "full",
  "unavailable",
  "changed",
  "stale",
  "already_booked",
  "slot_taken",
  "no_ticket",
  "too_many_holds",
  "too_late_or_done",
  "not_found",
  "not_eligible",
  "in_use",
  "invalid",
  "throttled",
  "offer_too_short",
  "ticket_expires_before",
  "retire_paid",
  "timezone_locked",
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export function isEngineErrorCode(value: string): value is EngineErrorCode {
  return (ENGINE_ERROR_CODES as readonly string[]).includes(value);
}

export const ENGINE_ERROR_MESSAGES: Record<EngineErrorCode, string> = {
  full: "Complet",
  unavailable: "Cette séance n'est plus ouverte aux réservations.",
  changed: "La séance a changé, rafraîchissez la page.",
  stale: "Ceci a changé, rafraîchissez la page.",
  already_booked: "Vous êtes déjà inscrit(e).",
  slot_taken: "Ce créneau vient d'être pris.",
  no_ticket: "Aucun ticket utilisable pour cette séance.",
  too_many_holds: "Vous avez déjà deux paiements en cours. Terminez-les ou libérez une place.",
  too_late_or_done: "Cette inscription ne peut plus être annulée en ligne.",
  not_found: "Élément introuvable.",
  not_eligible: "Ce ticket n'est pas accepté pour cette séance.",
  in_use: "Cet élément a déjà servi : il a été archivé.",
  invalid: "Données invalides.",
  throttled: "Trop de demandes. Réessayez dans un moment.",
  offer_too_short: "La validité de cette offre ne couvre pas la date de la séance.",
  ticket_expires_before: "Ticket expiré à la date de cette séance. Déplacer quand même ?",
  retire_paid: "Un ticket payé ne peut pas être retiré.",
  timezone_locked: "Fuseau verrouillé : vous avez des séances planifiées, des indisponibilités à venir ou des tickets à durée limitée.",
};

/* ───────────────────────────── Helpers ───────────────────────────── */

/** Trimmed, lower-cased e-mail: the `customer.email` key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** « À l'unité » / « Carnet de 10 » unless the pro typed a label. */
export function offerLabel(offer: { label: string | null; quantity: number }): string {
  const typed = offer.label?.trim();
  if (typed) return typed;
  return offer.quantity === 1 ? "À l'unité" : `Carnet de ${offer.quantity}`;
}

/** « 3 mois », « 30 jours », « 1 jour »; null without validity. */
export function validityLabel(count: number | null, unit: ValidityUnit | null): string | null {
  if (count == null || unit == null) return null;
  if (unit === "month") return `${count} mois`;
  return count > 1 ? `${count} jours` : "1 jour";
}
