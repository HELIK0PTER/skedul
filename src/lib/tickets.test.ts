import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTORS,
  ACTOR_LABELS,
  BOOKING_COVERAGES,
  BOOKING_MODES,
  BOOKING_MODE_LABELS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOUNDS,
  CHECKOUT_MINUTES,
  CLOSE_REASON_LABELS,
  COVERAGE_LABELS,
  ENGINE_ERROR_CODES,
  ENGINE_ERROR_MESSAGES,
  HOLD_MINUTES,
  HORIZON_REFRESH_DAYS,
  MATERIALIZE_DAYS,
  MATERIALIZE_MAX_ROWS,
  MAX_PENDING_HOLDS,
  MONTHLY_BY,
  MOVEMENT_KINDS,
  MOVEMENT_KIND_LABELS,
  OCCURRENCE_STATUSES,
  OCCURRENCE_STATUS_LABELS,
  OTP_EMAIL_LIMIT,
  PURCHASE_STATUSES,
  PURCHASE_STATUS_LABELS,
  QUESTION_TYPES,
  RECURRENCE_ENDS,
  RECURRENCE_FREQS,
  THROTTLE_ACTIONS,
  THROTTLE_LIMITS,
  TICKET_CLOSE_REASONS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  VALIDITY_UNITS,
  availabilityRuleInputSchema,
  customerInputSchema,
  dateKeySchema,
  eventInputSchema,
  isEngineErrorCode,
  normalizeEmail,
  offerInputSchema,
  offerLabel,
  questionInputSchema,
  recurrenceRuleSchema,
  ticketTypeInputSchema,
  validityLabel,
  type RecurrenceRuleInput,
} from "./tickets";

test("enum values are exactly the ones of spec § 6.2", () => {
  assert.deepEqual([...BOOKING_MODES], ["tickets", "free", "none"]);
  assert.deepEqual([...RECURRENCE_FREQS], ["once", "daily", "weekly", "monthly"]);
  assert.deepEqual([...MONTHLY_BY], ["day_of_month", "weekday"]);
  assert.deepEqual([...RECURRENCE_ENDS], ["never", "until", "count"]);
  assert.deepEqual([...VALIDITY_UNITS], ["day", "month"]);
  assert.deepEqual([...OCCURRENCE_STATUSES], ["scheduled", "cancelled"]);
  assert.deepEqual([...BOOKING_STATUSES], ["pending", "confirmed", "cancelled", "expired"]);
  assert.deepEqual([...BOOKING_COVERAGES], ["ticket", "free", "guest"]);
  assert.deepEqual([...ACTORS], ["client", "pro", "system"]);
  assert.deepEqual([...PURCHASE_STATUSES], ["pending", "paid", "expired"]);
  assert.deepEqual([...TICKET_STATUSES], ["available", "booked", "used", "expired", "closed"]);
  assert.deepEqual([...TICKET_CLOSE_REASONS], ["rembourse", "compense", "retire", "autre"]);
  assert.deepEqual([...MOVEMENT_KINDS], [
    "purchase",
    "offer",
    "spend",
    "return",
    "pointage",
    "unpoint",
    "convert",
    "expire",
    "close",
  ]);
  assert.deepEqual([...QUESTION_TYPES], ["text", "choice", "boolean"]);
});

test("every enum value has a French label", () => {
  const pairs: [readonly string[], Record<string, string>][] = [
    [BOOKING_MODES, BOOKING_MODE_LABELS],
    [BOOKING_STATUSES, BOOKING_STATUS_LABELS],
    [BOOKING_COVERAGES, COVERAGE_LABELS],
    [PURCHASE_STATUSES, PURCHASE_STATUS_LABELS],
    [OCCURRENCE_STATUSES, OCCURRENCE_STATUS_LABELS],
    [TICKET_STATUSES, TICKET_STATUS_LABELS],
    [TICKET_CLOSE_REASONS, CLOSE_REASON_LABELS],
    [MOVEMENT_KINDS, MOVEMENT_KIND_LABELS],
    [ACTORS, ACTOR_LABELS],
    [ENGINE_ERROR_CODES, ENGINE_ERROR_MESSAGES],
  ];
  for (const [values, labels] of pairs) {
    assert.deepEqual(Object.keys(labels).sort(), [...values].sort());
    for (const v of values) assert.ok(labels[v].trim().length > 0, v);
  }
});

test("horizon and hold constants keep their margins", () => {
  // the longest booking horizon (365) plus a month of slack stays materialised
  assert.ok(365 + 30 < MATERIALIZE_DAYS);
  assert.ok(HORIZON_REFRESH_DAYS < MATERIALIZE_DAYS);
  assert.ok(BOUNDS.bookingHorizonDays.max + 30 < MATERIALIZE_DAYS);
  // one ensureHorizon call can fill a whole daily series window
  assert.ok(MATERIALIZE_MAX_ROWS >= MATERIALIZE_DAYS);
  // the seat outlives the Stripe session, which Stripe caps at 30 min minimum
  assert.ok(CHECKOUT_MINUTES >= 30);
  assert.ok(HOLD_MINUTES > CHECKOUT_MINUTES);
  assert.equal(MAX_PENDING_HOLDS, 2);
  assert.deepEqual(OTP_EMAIL_LIMIT, { limit: 5, windowSec: 3600 });
  assert.deepEqual(Object.keys(THROTTLE_LIMITS).sort(), [...THROTTLE_ACTIONS].sort());
});

test("the source contains no em dash", () => {
  const source = readFileSync(join(__dirname, "tickets.ts"), "utf8");
  assert.equal(source.includes("\u2014"), false);
});

test("isEngineErrorCode accepts only engine codes", () => {
  assert.equal(isEngineErrorCode("full"), true);
  assert.equal(isEngineErrorCode("already_paid"), false);
  assert.equal(isEngineErrorCode(""), false);
});

test("normalizeEmail trims and lower-cases", () => {
  assert.equal(normalizeEmail("  Lea.Martin@Example.COM "), "lea.martin@example.com");
});

test("offerLabel uses the typed label, else a generated one", () => {
  assert.equal(offerLabel({ label: null, quantity: 1 }), "À l'unité");
  assert.equal(offerLabel({ label: null, quantity: 10 }), "Carnet de 10");
  assert.equal(offerLabel({ label: "   ", quantity: 4 }), "Carnet de 4");
  assert.equal(offerLabel({ label: "  Rentrée  ", quantity: 4 }), "Rentrée");
});

test("validityLabel", () => {
  assert.equal(validityLabel(3, "month"), "3 mois");
  assert.equal(validityLabel(30, "day"), "30 jours");
  assert.equal(validityLabel(1, "day"), "1 jour");
  assert.equal(validityLabel(null, null), null);
  assert.equal(validityLabel(3, null), null);
});

test("dateKeySchema accepts real calendar dates only", () => {
  assert.equal(dateKeySchema.safeParse("2026-10-12").success, true);
  assert.equal(dateKeySchema.safeParse("2028-02-29").success, true);
  assert.equal(dateKeySchema.safeParse("2026-02-30").success, false);
  assert.equal(dateKeySchema.safeParse("12/10/2026").success, false);
});

test("customerInputSchema normalises the e-mail and requires a name", () => {
  const ok = customerInputSchema.parse({ name: " Léa ", email: "Lea@Example.COM" });
  assert.deepEqual(ok, { name: "Léa", email: "lea@example.com" });
  assert.equal(customerInputSchema.safeParse({ name: " ", email: "lea@example.com" }).success, false);
  assert.equal(customerInputSchema.safeParse({ name: "Léa", email: "not-an-email" }).success, false);
});

test("offerInputSchema: validity needs both fields, price is positive", () => {
  const base = { ticketTypeId: "tt1", quantity: 10, priceCents: 19_000 };
  const ok = offerInputSchema.parse(base);
  assert.equal(ok.validityCount, null);
  assert.equal(ok.validityUnit, null);
  assert.equal(ok.isActive, true);
  assert.equal(offerInputSchema.safeParse({ ...base, validityCount: 6, validityUnit: "month" }).success, true);
  assert.equal(offerInputSchema.safeParse({ ...base, validityCount: 6 }).success, false);
  assert.equal(offerInputSchema.safeParse({ ...base, validityUnit: "month" }).success, false);
  assert.equal(offerInputSchema.safeParse({ ...base, priceCents: 0 }).success, false);
  assert.equal(offerInputSchema.safeParse({ ...base, quantity: 101 }).success, false);
});

test("ticketTypeInputSchema: RDV needs a duration, free RDV needs RDV", () => {
  const plain = ticketTypeInputSchema.parse({ name: "Cours collectif" });
  assert.equal(plain.rdvEnabled, false);
  assert.equal(plain.rdvDurationMin, null);
  assert.equal(plain.color, "#6366f1");
  assert.deepEqual(plain.rdvOverrides, {
    bookingHorizonDays: null,
    minNoticeMinutes: null,
    cancelDeadlineHours: null,
  });
  assert.equal(ticketTypeInputSchema.safeParse({ name: "x", rdvEnabled: true }).success, false);
  assert.equal(ticketTypeInputSchema.safeParse({ name: "x", rdvEnabled: true, rdvDurationMin: 60 }).success, true);
  assert.equal(ticketTypeInputSchema.safeParse({ name: "x", rdvEnabled: true, rdvDurationMin: 62 }).success, false);
  assert.equal(ticketTypeInputSchema.safeParse({ name: "x", rdvFree: true }).success, false);
});

test("questionInputSchema: a choice question needs two options", () => {
  assert.equal(questionInputSchema.safeParse({ label: "Niveau ?", type: "choice", options: ["Débutant"] }).success, false);
  assert.equal(
    questionInputSchema.safeParse({ label: "Niveau ?", type: "choice", options: ["Débutant", "Confirmé"] }).success,
    true,
  );
  assert.deepEqual(questionInputSchema.parse({ label: "Objectif ?", type: "text" }), {
    label: "Objectif ?",
    type: "text",
    options: [],
    required: false,
  });
});

const weekly: RecurrenceRuleInput = {
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

test("recurrenceRuleSchema accepts the shapes of spec § 8", () => {
  assert.equal(recurrenceRuleSchema.safeParse(weekly).success, true);
  const once = { ...weekly, freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 };
  assert.equal(recurrenceRuleSchema.safeParse(once).success, true);
  const firstSunday = {
    ...weekly,
    startDate: "2026-11-01",
    freq: "monthly",
    weekdays: null,
    monthlyBy: "weekday",
    monthWeek: 1,
  };
  assert.equal(recurrenceRuleSchema.safeParse(firstSunday).success, true);
  const fiveYears = { ...weekly, endMode: "until", untilDate: "2031-10-12" };
  assert.equal(recurrenceRuleSchema.safeParse(fiveYears).success, true);
});

test("recurrenceRuleSchema rejects what the DB CHECKs reject", () => {
  const bad: Record<string, unknown>[] = [
    { ...weekly, weekdays: [3, 1] },
    { ...weekly, weekdays: [1, 1] },
    { ...weekly, interval: 53 },
    { ...weekly, freq: "daily" },
    { ...weekly, freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1, interval: 2 },
    { ...weekly, freq: "monthly", weekdays: null, monthlyBy: "weekday", monthWeek: null },
    { ...weekly, freq: "monthly", weekdays: null, monthlyBy: null },
    { ...weekly, endMode: "until", untilDate: null },
    { ...weekly, endMode: "until", untilDate: "2026-10-11" },
    { ...weekly, endMode: "until", untilDate: "2031-10-13" },
    { ...weekly, endMode: "count", occurrenceCount: null },
    { ...weekly, endMode: "never", occurrenceCount: 3 },
    { ...weekly, startMinute: 1440 },
  ];
  for (const rule of bad) {
    assert.equal(recurrenceRuleSchema.safeParse(rule).success, false, JSON.stringify(rule));
  }
});

test("eventInputSchema fills the defaults", () => {
  const parsed = eventInputSchema.parse({ title: "Altinha débutants", rule: weekly });
  assert.equal(parsed.bookingMode, "tickets");
  assert.equal(parsed.isPrivate, false);
  assert.equal(parsed.capacity, 12);
  assert.equal(parsed.durationMin, 60);
  assert.deepEqual(parsed.ticketTypeIds, []);
  assert.deepEqual(parsed.questions, []);
  assert.equal(eventInputSchema.safeParse({ title: "x", rule: weekly, durationMin: 62 }).success, false);
  assert.equal(eventInputSchema.safeParse({ title: "x", rule: weekly, capacity: 501 }).success, false);
});

test("availabilityRuleInputSchema needs start < end within the day", () => {
  assert.equal(availabilityRuleInputSchema.safeParse({ dayOfWeek: 1, startMinute: 600, endMinute: 780 }).success, true);
  assert.equal(availabilityRuleInputSchema.safeParse({ dayOfWeek: 1, startMinute: 0, endMinute: 1440 }).success, true);
  assert.equal(availabilityRuleInputSchema.safeParse({ dayOfWeek: 1, startMinute: 780, endMinute: 600 }).success, false);
  assert.equal(availabilityRuleInputSchema.safeParse({ dayOfWeek: 7, startMinute: 600, endMinute: 780 }).success, false);
});
