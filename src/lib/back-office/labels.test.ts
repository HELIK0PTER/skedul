import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_MODES, QUESTION_TYPES } from "@/lib/tickets-vocab";

import {
  ALERT_GROUP_NOTES,
  ALERT_LABELS,
  ALERT_SHORT_LABELS,
  MODE_HELP,
  MODE_SHORT_LABELS,
  ORIGIN_LABELS,
  QUESTION_TYPE_LABELS,
  WEEKDAY_LETTERS,
  WEEKDAY_NAMES,
  WEEK_ORDER,
} from "./labels";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("booking modes have a short label and a help text, exactly", () => {
  assert.deepEqual(MODE_SHORT_LABELS, { tickets: "Sur tickets", free: "Inscription libre", none: "Sur place" });
  assert.deepEqual(MODE_HELP, {
    tickets: "Vos clients réservent avec un ticket d'un type accepté, ou l'achètent en réservant.",
    free: "Inscription par email, gratuite, dans la limite des places.",
    none: "Pas de réservation en ligne : la séance est affichée « Sur place » sur votre page.",
  });
  assert.deepEqual(Object.keys(MODE_SHORT_LABELS).sort(), [...BOOKING_MODES].sort());
  assert.deepEqual(Object.keys(MODE_HELP).sort(), [...BOOKING_MODES].sort());
});

test("question types are labelled for every value of the vocabulary", () => {
  assert.deepEqual(QUESTION_TYPE_LABELS, { text: "Texte libre", choice: "Choix dans une liste", boolean: "Oui ou non" });
  assert.deepEqual(Object.keys(QUESTION_TYPE_LABELS).sort(), [...QUESTION_TYPES].sort());
});

test("the week starts on Monday and every weekday is named", () => {
  assert.deepEqual(WEEK_ORDER, [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(
    WEEK_ORDER.map((d) => WEEKDAY_LETTERS[d]),
    ["L", "M", "M", "J", "V", "S", "D"],
  );
  assert.deepEqual(
    WEEK_ORDER.map((d) => WEEKDAY_NAMES[d]),
    ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  );
});

test("alert and origin labels are exact", () => {
  assert.deepEqual(ALERT_LABELS, { red: "Tickets d'un type archivé", orange: "Type lié à aucun événement à venir" });
  assert.deepEqual(ORIGIN_LABELS, { purchased: "Acheté", offered: "Offert" });
});

test("the short alert labels are exact and cover the same tones", () => {
  assert.deepEqual(ALERT_SHORT_LABELS, { red: "Type archivé", orange: "Aucun événement à venir" });
  assert.deepEqual(Object.keys(ALERT_SHORT_LABELS), Object.keys(ALERT_LABELS));
});

test("the group notes of the client wallet are exact, one per tone, and tell the pro what to do", () => {
  assert.deepEqual(ALERT_GROUP_NOTES, {
    red: "Type archivé : ces tickets ne servent plus. Proposez « Convertir ».",
    orange: "Lié à aucun événement à venir.",
  });
  assert.deepEqual(Object.keys(ALERT_GROUP_NOTES), Object.keys(ALERT_LABELS));
});

test("no label carries a dash", () => {
  const all = [
    ...Object.values(MODE_SHORT_LABELS),
    ...Object.values(MODE_HELP),
    ...Object.values(QUESTION_TYPE_LABELS),
    ...Object.values(WEEKDAY_NAMES),
    ...Object.values(ALERT_LABELS),
    ...Object.values(ALERT_SHORT_LABELS),
    ...Object.values(ALERT_GROUP_NOTES),
    ...Object.values(ORIGIN_LABELS),
  ];
  for (const text of all) assert.equal(DASH.test(text), false, text);
});
