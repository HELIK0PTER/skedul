/**
 * Tickets & événements: the vocabulary shared by the schema (pgEnums), the
 * booking engine, the server actions and the UI. Enum values, bounds, French
 * labels and messages, engine error codes and the zod input schemas.
 * No drizzle and no Node APIs, so client components may import it.
 */
import { z } from "zod";

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

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "En attente",
  paid: "Payé",
  expired: "Expiré",
};

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  scheduled: "Planifiée",
  cancelled: "Annulée",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  available: "Disponible",
  booked: "Réservé",
  used: "Utilisé",
  expired: "Expiré",
  closed: "Clos",
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
export const THROTTLE_ACTIONS = ["free", "buybook", "rdv", "shop"] as const;
export type ThrottleAction = (typeof THROTTLE_ACTIONS)[number];
export const THROTTLE_LIMITS: Record<ThrottleAction, { ip: number; email: number }> = {
  free: { ip: 20, email: 6 },
  buybook: { ip: 20, email: 6 },
  rdv: { ip: 20, email: 6 },
  shop: { ip: 20, email: 6 },
};
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
  timezone_locked: "Fuseau verrouillé : vous avez des séances planifiées.",
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

/* ───────────────────────────── zod schemas ───────────────────────────── */

const intIn = (min: number, max: number) => z.number().int().min(min).max(max);
const optionalOverride = (min: number, max: number) => intIn(min, max).nullable();

export const dateKeySchema = z.iso.date();
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const idSchema = z.string().min(1).max(64);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(BOUNDS.name),
  email: z.email().max(254).transform(normalizeEmail),
  phone: z.string().trim().max(BOUNDS.phone).optional(),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const answerInputSchema = z.object({
  questionId: idSchema,
  value: z.string().max(BOUNDS.answer),
});
export const answersInputSchema = z.array(answerInputSchema).max(BOUNDS.questions);
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const bookingSettingsSchema = z.object({
  bookingHorizonDays: intIn(BOUNDS.bookingHorizonDays.min, BOUNDS.bookingHorizonDays.max),
  minNoticeMinutes: intIn(BOUNDS.minNoticeMinutes.min, BOUNDS.minNoticeMinutes.max),
  cancelDeadlineHours: intIn(BOUNDS.cancelDeadlineHours.min, BOUNDS.cancelDeadlineHours.max),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;

export const windowOverridesSchema = z.object({
  bookingHorizonDays: optionalOverride(BOUNDS.bookingHorizonDays.min, BOUNDS.bookingHorizonDays.max),
  minNoticeMinutes: optionalOverride(BOUNDS.minNoticeMinutes.min, BOUNDS.minNoticeMinutes.max),
  cancelDeadlineHours: optionalOverride(BOUNDS.cancelDeadlineHours.min, BOUNDS.cancelDeadlineHours.max),
});
export type WindowOverrides = z.infer<typeof windowOverridesSchema>;

export const questionInputSchema = z
  .object({
    id: idSchema.optional(),
    label: z.string().trim().min(1).max(BOUNDS.questionLabel),
    type: z.enum(QUESTION_TYPES),
    options: z.array(z.string().trim().min(1).max(BOUNDS.questionLabel)).max(BOUNDS.questionOptions).default([]),
    required: z.boolean().default(false),
  })
  .refine((q) => q.type !== "choice" || q.options.length >= 2, {
    message: "Une question à choix demande au moins deux options.",
    path: ["options"],
  });
export type QuestionInput = z.input<typeof questionInputSchema>;

export const ticketTypeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(BOUNDS.name),
    description: z.string().trim().max(BOUNDS.description).nullable().default(null),
    color: hexColorSchema.default(DEFAULT_COLOR),
    rdvEnabled: z.boolean().default(false),
    rdvFree: z.boolean().default(false),
    rdvDurationMin: z
      .number()
      .int()
      .min(BOUNDS.rdvDurationMin.min)
      .max(BOUNDS.rdvDurationMin.max)
      .multipleOf(BOUNDS.rdvDurationMin.step)
      .nullable()
      .default(null),
    rdvBufferBeforeMin: intIn(BOUNDS.rdvBufferMin.min, BOUNDS.rdvBufferMin.max).default(0),
    rdvBufferAfterMin: intIn(BOUNDS.rdvBufferMin.min, BOUNDS.rdvBufferMin.max).default(0),
    rdvOverrides: windowOverridesSchema.default({
      bookingHorizonDays: null,
      minNoticeMinutes: null,
      cancelDeadlineHours: null,
    }),
  })
  .refine((t) => !t.rdvEnabled || t.rdvDurationMin !== null, {
    message: "Indiquez la durée du rendez-vous.",
    path: ["rdvDurationMin"],
  })
  .refine((t) => !t.rdvFree || t.rdvEnabled, {
    message: "Le rendez-vous gratuit demande le RDV libre.",
    path: ["rdvFree"],
  });
export type TicketTypeInput = z.input<typeof ticketTypeInputSchema>;

export const offerInputSchema = z
  .object({
    ticketTypeId: idSchema,
    label: z.string().trim().max(BOUNDS.offerLabel).nullable().default(null),
    quantity: intIn(BOUNDS.offerQuantity.min, BOUNDS.offerQuantity.max),
    priceCents: intIn(BOUNDS.offerPriceCents.min, BOUNDS.offerPriceCents.max),
    validityCount: intIn(BOUNDS.validityCount.min, BOUNDS.validityCount.max).nullable().default(null),
    validityUnit: z.enum(VALIDITY_UNITS).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .refine((o) => (o.validityCount === null) === (o.validityUnit === null), {
    message: "Indiquez une durée et une unité de validité, ou aucune.",
    path: ["validityCount"],
  });
export type OfferInput = z.input<typeof offerInputSchema>;

/** Recurrence columns of `event` (spec § 8); refinements mirror the DB CHECKs. */
export const recurrenceRuleSchema = z
  .object({
    startDate: dateKeySchema,
    startMinute: intIn(BOUNDS.startMinute.min, BOUNDS.startMinute.max),
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(52),
    weekdays: z.array(intIn(0, 6)).min(1).max(7).nullable(),
    monthlyBy: z.enum(MONTHLY_BY).nullable(),
    monthWeek: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).nullable(),
    endMode: z.enum(RECURRENCE_ENDS),
    untilDate: dateKeySchema.nullable(),
    occurrenceCount: intIn(BOUNDS.occurrenceCount.min, BOUNDS.occurrenceCount.max).nullable(),
  })
  .superRefine((r, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (r.interval > BOUNDS.interval[r.freq]) fail("interval", "Intervalle trop grand.");
    if (r.freq === "once") {
      if (r.interval !== 1 || r.endMode !== "count" || r.occurrenceCount !== 1) fail("freq", "Une séance unique se répète une fois.");
      if (r.weekdays !== null || r.monthlyBy !== null || r.monthWeek !== null || r.untilDate !== null) fail("freq", "Champs de récurrence inattendus.");
    }
    if (r.freq === "weekly") {
      const days = r.weekdays ?? [];
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      if (days.length === 0) fail("weekdays", "Choisissez au moins un jour.");
      if (sorted.length !== days.length || sorted.some((d, i) => d !== days[i])) fail("weekdays", "Jours en double ou non triés.");
    } else if (r.weekdays !== null) fail("weekdays", "Jours réservés aux séries hebdomadaires.");
    if (r.freq === "monthly") {
      if (r.monthlyBy === null) fail("monthlyBy", "Choisissez le jour du mois.");
      if (r.monthlyBy === "weekday" && r.monthWeek === null) fail("monthWeek", "Choisissez la semaine du mois.");
      if (r.monthlyBy === "day_of_month" && r.monthWeek !== null) fail("monthWeek", "Semaine inattendue.");
    } else if (r.monthlyBy !== null || r.monthWeek !== null) fail("monthlyBy", "Réservé aux séries mensuelles.");
    if (r.endMode === "never" && (r.untilDate !== null || r.occurrenceCount !== null)) fail("endMode", "Fin inattendue.");
    if (r.endMode === "until") {
      if (r.untilDate === null || r.occurrenceCount !== null) fail("untilDate", "Indiquez la date de fin.");
      else if (r.untilDate < r.startDate) fail("untilDate", "La fin précède le début.");
      else {
        const [y, m, d] = r.startDate.split("-").map(Number);
        const max = `${String(y + BOUNDS.untilYears).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (r.untilDate > max) fail("untilDate", "La série ne peut pas dépasser 5 ans.");
      }
    }
    if (r.endMode === "count" && (r.occurrenceCount === null || r.untilDate !== null)) fail("occurrenceCount", "Indiquez le nombre de séances.");
  });
export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleSchema>;

export const eventInputSchema = z.object({
  title: z.string().trim().min(1).max(BOUNDS.title),
  description: z.string().trim().max(BOUNDS.description).nullable().default(null),
  location: z.string().trim().max(BOUNDS.location).nullable().default(null),
  color: hexColorSchema.default(DEFAULT_COLOR),
  bookingMode: z.enum(BOOKING_MODES).default("tickets"),
  isPrivate: z.boolean().default(false),
  capacity: intIn(BOUNDS.capacity.min, BOUNDS.capacity.max).default(BOUNDS.capacity.default),
  durationMin: z
    .number()
    .int()
    .min(BOUNDS.eventDurationMin.min)
    .max(BOUNDS.eventDurationMin.max)
    .multipleOf(BOUNDS.eventDurationMin.step)
    .default(BOUNDS.eventDurationMin.default),
  rule: recurrenceRuleSchema,
  overrides: windowOverridesSchema.default({
    bookingHorizonDays: null,
    minNoticeMinutes: null,
    cancelDeadlineHours: null,
  }),
  ticketTypeIds: z.array(idSchema).max(50).default([]),
  questions: z.array(questionInputSchema).max(BOUNDS.questions).default([]),
});
export type EventInput = z.input<typeof eventInputSchema>;
export type EventInputParsed = z.infer<typeof eventInputSchema>;

export const availabilityRuleInputSchema = z
  .object({
    dayOfWeek: intIn(0, 6),
    startMinute: intIn(0, 1439),
    endMinute: intIn(1, 1440),
  })
  .refine((r) => r.startMinute < r.endMinute, { message: "Plage horaire invalide.", path: ["endMinute"] });
export type AvailabilityRuleInput = z.infer<typeof availabilityRuleInputSchema>;
