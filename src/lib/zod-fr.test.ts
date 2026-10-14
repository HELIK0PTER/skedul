import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  answersInputSchema,
  availabilityRuleInputSchema,
  bookingSettingsSchema,
  customerInputSchema,
  eventInputSchema,
  offerInputSchema,
  questionInputSchema,
  recurrenceRuleSchema,
  ticketTypeInputSchema,
} from "./tickets";
import { FIELD_LABELS, parseFr, zodFr, zodFrMessage } from "./zod-fr";

/** fr-FR thousands, exactly as zodFrMessage prints them. */
const n = (value: number) => value.toLocaleString("fr-FR");

/** The message of the first issue of a parse with the French error map, or null when it passes. */
function message(schema: z.ZodType, value: unknown): string | null {
  const res = schema.safeParse(value, { error: zodFr });
  return res.success ? null : res.error.issues[0].message;
}

const ENGLISH = /\b(Too|Invalid|Required|Unrecognized|expected|must|received|string|number)\b/;
const DASH = /[\u2014\u2013]/;

const WEEKLY = {
  startDate: "2026-10-12",
  startMinute: 1140,
  freq: "weekly",
  interval: 1,
  weekdays: [1, 3],
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
};

test("zodFrMessage: strings", () => {
  assert.equal(message(z.string().min(1), ""), "Ce champ est obligatoire.");
  assert.equal(message(z.string().min(3), "ab"), "3 caractères au minimum.");
  assert.equal(message(z.string().max(5), "abcdef"), "5 caractères au maximum.");
  assert.equal(message(z.string().max(2000), "x".repeat(2001)), `${n(2000)} caractères au maximum.`);
});

test("zodFrMessage: numbers, integers and multiples", () => {
  assert.equal(message(z.number().min(2), 1), "Minimum 2.");
  assert.equal(message(z.number().gt(2), 2), "Doit être supérieur à 2.");
  assert.equal(message(z.number().max(10), 11), "Maximum 10.");
  assert.equal(message(z.number().lt(10), 10), "Doit être inférieur à 10.");
  assert.equal(message(z.int().min(2), 1), "Minimum 2.");
  assert.equal(message(z.int().max(2), 3), "Maximum 2.");
  assert.equal(message(z.number().max(10080), 10081), `Maximum ${n(10080)}.`);
  assert.equal(message(z.number().multipleOf(5), 7), "Choisissez un multiple de 5.");
});

test("zodFrMessage: arrays", () => {
  assert.equal(message(z.array(z.string()).min(1), []), "Choisissez au moins un élément.");
  assert.equal(message(z.array(z.string()).min(2), ["a"]), "2 éléments au minimum.");
  assert.equal(message(z.array(z.string()).max(20), Array.from({ length: 21 }, () => "a")), "20 éléments au maximum.");
});

test("zodFrMessage: wrong types", () => {
  assert.equal(message(z.number(), "x"), "Indiquez un nombre.");
  assert.equal(message(z.number().int(), 1.5), "Indiquez un nombre entier.");
  assert.equal(message(z.string(), 1), "Ce champ est obligatoire.");
  assert.equal(message(z.boolean(), "x"), "Valeur invalide.");
  assert.equal(message(z.object({ a: z.string() }), "x"), "Valeur invalide.");
});

test("zodFrMessage: formats", () => {
  assert.equal(message(z.email(), "x"), "Adresse email invalide.");
  assert.equal(message(z.iso.date(), "2026-02-30"), "Date invalide.");
  assert.equal(message(z.iso.datetime(), "x"), "Date et heure invalides.");
  assert.equal(message(z.string().regex(/^a$/), "b"), "Format invalide.");
  assert.equal(message(z.string().startsWith("a"), "b"), "Format invalide.");
});

test("zodFrMessage: values, unions, unknown keys, custom and fallbacks", () => {
  assert.equal(message(z.enum(["a", "b"]), "c"), "Choix invalide.");
  assert.equal(message(z.union([z.literal(1), z.literal(2)]), 3), "Valeur invalide.");
  assert.equal(message(z.strictObject({ a: z.string() }), { a: "x", b: 1 }), "Champ inattendu.");
  assert.equal(message(z.string().refine(() => false), "x"), "Valeur invalide.");
  assert.equal(zodFrMessage({ code: "custom", message: "Texte propre.", input: 1, path: [] } as unknown as z.core.$ZodRawIssue), "Texte propre.");
  assert.equal(zodFrMessage({ code: "invalid_key", input: 1, path: [] } as unknown as z.core.$ZodRawIssue), "Valeur invalide.");
});

test("a message set by the schema (refine, superRefine, explicit text) wins over the error map", () => {
  assert.equal(message(z.string().refine(() => false, { message: "Message propre." }), "x"), "Message propre.");
  assert.equal(message(z.string().min(1, "Texte du schéma."), ""), "Texte du schéma.");
  const res = parseFr(ticketTypeInputSchema, { name: "Cours", rdvEnabled: true });
  assert.deepEqual(res, {
    ok: false,
    error: "Indiquez la durée du rendez-vous.",
    fieldErrors: { rdvDurationMin: "Indiquez la durée du rendez-vous." },
  });
});

test("the error map is per parse: a plain parse keeps zod's own English text", () => {
  const res = z.string().min(1).safeParse("");
  assert.equal(res.success, false);
  if (!res.success) assert.match(res.error.issues[0].message, /^Too small/);
});

test("FIELD_LABELS is the contract table", () => {
  assert.deepEqual(FIELD_LABELS, {
    name: "Nom",
    email: "Email",
    phone: "Téléphone",
    title: "Titre",
    description: "Description",
    location: "Lieu",
    locationOverride: "Lieu",
    color: "Couleur",
    label: "Libellé",
    quantity: "Quantité",
    priceCents: "Prix",
    validityCount: "Validité",
    capacity: "Places",
    durationMin: "Durée",
    rdvDurationMin: "Durée du rendez-vous",
    rdvBufferBeforeMin: "Marge avant",
    rdvBufferAfterMin: "Marge après",
    bookingHorizonDays: "Réservable jusqu'à",
    minNoticeMinutes: "Délai minimum",
    cancelDeadlineHours: "Annulation par le client",
    startDate: "Date de début",
    startMinute: "Heure de début",
    interval: "Intervalle",
    weekdays: "Jours",
    untilDate: "Date de fin",
    occurrenceCount: "Nombre de séances",
    options: "Options",
    questions: "Questions",
    ticketTypeIds: "Types de ticket acceptés",
    reason: "Motif",
    note: "Note",
    value: "Réponse",
    businessName: "Nom de l'activité",
    headline: "Accroche",
    bio: "Présentation",
    timezone: "Fuseau horaire",
    endDate: "Date de fin",
    startTime: "Heure de début",
    endTime: "Heure de fin",
    q: "Recherche",
  });
  for (const label of Object.values(FIELD_LABELS)) assert.equal(DASH.test(label), false);
});

test("parseFr: a valid value comes back parsed", () => {
  const res = parseFr(customerInputSchema, { name: "  Léa Martin ", email: "Lea.Martin@Example.COM" });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.data.name, "Léa Martin");
    assert.equal(res.data.email, "lea.martin@example.com");
  }
});

test("parseFr: the first issue is prefixed with its field label", () => {
  const empty = parseFr(ticketTypeInputSchema, { name: "" });
  assert.deepEqual(empty, {
    ok: false,
    error: "Nom : ce champ est obligatoire.",
    fieldErrors: { name: "Ce champ est obligatoire." },
  });

  const capacity = parseFr(eventInputSchema, { title: "Roda", rule: WEEKLY, capacity: 501 });
  assert.equal(capacity.ok, false);
  if (!capacity.ok) assert.equal(capacity.error, "Places : maximum 500.");

  const duration = parseFr(eventInputSchema, { title: "Roda", rule: WEEKLY, durationMin: 62 });
  assert.equal(duration.ok, false);
  if (!duration.ok) assert.equal(duration.error, "Durée : choisissez un multiple de 5.");

  const email = parseFr(customerInputSchema, { name: "Léa", email: "x" });
  assert.equal(email.ok, false);
  if (!email.ok) assert.equal(email.error, "Email : adresse email invalide.");
});

test("parseFr: a field without a label keeps the bare text", () => {
  const res = parseFr(offerInputSchema, { ticketTypeId: "", quantity: 1, priceCents: 100 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error, "Ce champ est obligatoire.");
});

test("parseFr: the label is the last NAMED segment, array indexes are skipped", () => {
  const res = parseFr(questionInputSchema, { label: "Niveau ?", type: "choice", options: ["", "B"] });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error, "Options : ce champ est obligatoire.");
    assert.deepEqual(Object.keys(res.fieldErrors), ["options.0"]);
  }
});

test("parseFr: fieldErrors are keyed by dotted paths, first issue per path", () => {
  const overrides = parseFr(ticketTypeInputSchema, {
    name: "Cours",
    rdvOverrides: { bookingHorizonDays: 400, minNoticeMinutes: null, cancelDeadlineHours: null },
  });
  assert.equal(overrides.ok, false);
  if (!overrides.ok) {
    assert.deepEqual(overrides.fieldErrors, { "rdvOverrides.bookingHorizonDays": "Maximum 365." });
    assert.equal(overrides.error, "Réservable jusqu'à : maximum 365.");
  }

  const questions = parseFr(eventInputSchema, { title: "Roda", rule: WEEKLY, questions: [{ label: "", type: "text" }] });
  assert.equal(questions.ok, false);
  if (!questions.ok) assert.deepEqual(Object.keys(questions.fieldErrors), ["questions.0.label"]);

  const settings = parseFr(bookingSettingsSchema, {});
  assert.equal(settings.ok, false);
  if (!settings.ok) {
    assert.deepEqual(Object.keys(settings.fieldErrors).sort(), ["bookingHorizonDays", "cancelDeadlineHours", "minNoticeMinutes"]);
  }

  const root = parseFr(answersInputSchema, "x");
  assert.equal(root.ok, false);
  if (!root.ok) assert.deepEqual(Object.keys(root.fieldErrors), [""]);
});

test("parseFr: a refine message is returned verbatim, without a label", () => {
  const unsorted = parseFr(recurrenceRuleSchema, { ...WEEKLY, weekdays: [3, 1] });
  assert.equal(unsorted.ok, false);
  if (!unsorted.ok) assert.equal(unsorted.error, "Jours en double ou non triés.");

  const validity = parseFr(offerInputSchema, { ticketTypeId: "t", quantity: 1, priceCents: 100, validityCount: 3 });
  assert.equal(validity.ok, false);
  if (!validity.ok) assert.equal(validity.error, "Indiquez une durée et une unité de validité, ou aucune.");

  const choice = parseFr(questionInputSchema, { label: "Niveau ?", type: "choice", options: ["A"] });
  assert.equal(choice.ok, false);
  if (!choice.ok) assert.equal(choice.error, "Une question à choix demande au moins deux options.");
});

test("parseFr: a battery of invalid inputs never yields English or a dash", () => {
  const cases: [string, z.ZodType, unknown][] = [
    ["type empty", ticketTypeInputSchema, {}],
    ["type name long", ticketTypeInputSchema, { name: "x".repeat(81) }],
    ["type color", ticketTypeInputSchema, { name: "x", color: "red" }],
    ["type rdv short", ticketTypeInputSchema, { name: "x", rdvEnabled: true, rdvDurationMin: 3 }],
    ["type buffer", ticketTypeInputSchema, { name: "x", rdvBufferBeforeMin: -5 }],
    ["type flag type", ticketTypeInputSchema, { name: "x", rdvEnabled: "yes" }],
    ["type duration fraction", ticketTypeInputSchema, { name: "x", rdvDurationMin: 2.5 }],
    ["offer no type", offerInputSchema, { ticketTypeId: "", quantity: 1, priceCents: 100 }],
    ["offer quantity", offerInputSchema, { ticketTypeId: "t", quantity: 0, priceCents: 100 }],
    ["offer price type", offerInputSchema, { ticketTypeId: "t", quantity: 1, priceCents: "12" }],
    ["offer validity", offerInputSchema, { ticketTypeId: "t", quantity: 1, priceCents: 100, validityCount: 1001, validityUnit: "day" }],
    ["offer unit", offerInputSchema, { ticketTypeId: "t", quantity: 1, priceCents: 100, validityCount: 3, validityUnit: "week" }],
    ["event no rule", eventInputSchema, { title: "x" }],
    ["event title", eventInputSchema, { title: "", rule: WEEKLY }],
    ["event mode", eventInputSchema, { title: "x", rule: WEEKLY, bookingMode: "x" }],
    ["event types", eventInputSchema, { title: "x", rule: WEEKLY, ticketTypeIds: Array.from({ length: 51 }, (_, k) => `t${k}`) }],
    ["event location", eventInputSchema, { title: "x", rule: WEEKLY, location: "x".repeat(201) }],
    ["event capacity", eventInputSchema, { title: "x", rule: WEEKLY, capacity: 501 }],
    ["event duration", eventInputSchema, { title: "x", rule: WEEKLY, durationMin: 62 }],
    ["rule date", recurrenceRuleSchema, { ...WEEKLY, startDate: "2026-02-30" }],
    ["rule minute", recurrenceRuleSchema, { ...WEEKLY, startMinute: 1440 }],
    ["rule interval", recurrenceRuleSchema, { ...WEEKLY, interval: 0 }],
    ["rule weekdays empty", recurrenceRuleSchema, { ...WEEKLY, weekdays: [] }],
    ["rule weekday", recurrenceRuleSchema, { ...WEEKLY, weekdays: [7] }],
    ["rule month week", recurrenceRuleSchema, { ...WEEKLY, freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: 5 }],
    ["rule end mode", recurrenceRuleSchema, { ...WEEKLY, endMode: "x" }],
    ["rule until", recurrenceRuleSchema, { ...WEEKLY, endMode: "until", untilDate: "x" }],
    ["rule count", recurrenceRuleSchema, { ...WEEKLY, endMode: "count", occurrenceCount: 731 }],
    ["rule unsorted", recurrenceRuleSchema, { ...WEEKLY, weekdays: [3, 1] }],
    ["customer name", customerInputSchema, { name: " ", email: "a@b.co" }],
    ["customer email", customerInputSchema, { name: "a", email: "x" }],
    ["customer phone", customerInputSchema, { name: "a", email: "a@b.co", phone: "1".repeat(31) }],
    ["settings horizon", bookingSettingsSchema, { bookingHorizonDays: 0, minNoticeMinutes: 60, cancelDeadlineHours: 24 }],
    ["settings notice", bookingSettingsSchema, { bookingHorizonDays: 60, minNoticeMinutes: 10081, cancelDeadlineHours: 24 }],
    ["settings type", bookingSettingsSchema, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: "24" }],
    ["settings empty", bookingSettingsSchema, {}],
    ["question one option", questionInputSchema, { label: "Niveau ?", type: "choice", options: ["A"] }],
    ["question type", questionInputSchema, { label: "Niveau ?", type: "x" }],
    ["question empty option", questionInputSchema, { label: "Niveau ?", type: "choice", options: ["", "B"] }],
    ["rule end before start", availabilityRuleInputSchema, { dayOfWeek: 1, startMinute: 780, endMinute: 600 }],
    ["rule weekday out of range", availabilityRuleInputSchema, { dayOfWeek: 7, startMinute: 600, endMinute: 780 }],
    ["rule negative start", availabilityRuleInputSchema, { dayOfWeek: 1, startMinute: -1, endMinute: 780 }],
    ["answers long", answersInputSchema, [{ questionId: "q", value: "x".repeat(2001) }]],
    ["answers many", answersInputSchema, Array.from({ length: 21 }, (_, k) => ({ questionId: `q${k}`, value: "x" }))],
    ["answers no id", answersInputSchema, [{ value: "x" }]],
    ["answers not an array", answersInputSchema, "x"],
  ];
  for (const [name, schema, value] of cases) {
    const res = parseFr(schema, value);
    assert.equal(res.ok, false, name);
    if (res.ok) continue;
    assert.equal(ENGLISH.test(res.error), false, `${name}: ${res.error}`);
    assert.equal(DASH.test(res.error), false, `${name}: ${res.error}`);
    assert.ok(Object.keys(res.fieldErrors).length > 0, name);
    for (const [path, text] of Object.entries(res.fieldErrors)) {
      assert.equal(ENGLISH.test(text), false, `${name} ${path}: ${text}`);
      assert.equal(DASH.test(text), false, `${name} ${path}: ${text}`);
      assert.equal(path.includes("["), false, `${name}: path ${path} is dotted`);
    }
  }
});
