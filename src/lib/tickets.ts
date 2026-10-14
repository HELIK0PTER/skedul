/**
 * Tickets & événements: the zod input schemas shared by the booking engine, the
 * server actions and the forms. The vocabulary (enum values, labels, bounds,
 * engine error codes and messages) lives in tickets-vocab.ts, which imports
 * nothing, and is re-exported here so `@/lib/tickets` keeps every name.
 * No drizzle and no Node APIs, so client components may import it; a client
 * component that only needs labels imports `@/lib/tickets-vocab` instead.
 */
export * from "./tickets-vocab";

import { z } from "zod";

import {
  BOOKING_MODES,
  BOUNDS,
  DEFAULT_COLOR,
  MONTHLY_BY,
  QUESTION_TYPES,
  RECURRENCE_ENDS,
  RECURRENCE_FREQS,
  VALIDITY_UNITS,
  normalizeEmail,
} from "./tickets-vocab";

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
