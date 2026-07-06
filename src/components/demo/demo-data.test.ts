import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "date-fns";

import { toDayKey } from "../../lib/calendar-grid";
import {
  bookedDayKey,
  creditDayKey,
  demoAvailableKeys,
  leaSession,
  planningWeekDays,
  DEMO_WEEK_SESSIONS,
} from "./demo-data";

test("demoAvailableKeys: 8 jours, le premier à J+2", () => {
  const keys = demoAvailableKeys();
  assert.equal(keys.length, 8);
  assert.equal(keys[0], toDayKey(addDays(new Date(), 2)));
});

test("bookedDayKey/creditDayKey: J+2 et J+3", () => {
  assert.equal(bookedDayKey(), toDayKey(addDays(new Date(), 2)));
  assert.equal(creditDayKey(), toDayKey(addDays(new Date(), 3)));
});

test("planningWeekDays: 7 jours, lundi en tête, contient le jour réservé", () => {
  const week = planningWeekDays();
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 1); // lundi
  assert.ok(week.map(toDayKey).includes(bookedDayKey()));
});

test("leaSession: positionnée sur le jour réservé à 18:00", () => {
  const s = leaSession();
  assert.ok(s.dayIndex >= 0 && s.dayIndex <= 6);
  assert.equal(toDayKey(planningWeekDays()[s.dayIndex]), bookedDayKey());
  assert.equal(s.startMinute, 18 * 60);
});

test("aucune séance statique ne chevauche le créneau de Léa (18:00 – 19:00), quel que soit son jour", () => {
  const lea = leaSession();
  const leaEnd = lea.startMinute + lea.durationMinutes;
  for (const s of DEMO_WEEK_SESSIONS) {
    const sEnd = s.startMinute + s.durationMinutes;
    const overlaps = s.startMinute < leaEnd && sEnd > lea.startMinute;
    assert.equal(overlaps, false, `${s.id} chevauche la séance de Léa`);
  }
});
