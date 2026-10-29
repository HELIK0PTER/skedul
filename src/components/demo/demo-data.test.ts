import test from "node:test";
import assert from "node:assert/strict";

import { altinhaCatalog } from "../../../scripts/content/altinha";
import { addDays, addMonthsClamped, compareKeys, dayOfWeek, diffDays, parseKey, todayKey } from "../../lib/civil-date";
import {
  CARNET_OFFER_ID,
  DEMO_BRAND,
  DEMO_CARNET,
  DEMO_CLIENT,
  DEMO_EVENTS,
  DEMO_TICKET_TYPES,
  DEMO_TZ,
  LEA_RDV,
  LEA_SEANCE_IDS,
  MONDAY_ATTENDEES,
  PLANNING_HOURS,
  WEEK_RDVS,
  carnetExpiryKey,
  carnetExpiryLine,
  demoToday,
  demoWeek,
  rdvSlots,
  weekSeances,
  whenLong,
  whenShort,
} from "./demo-data";

test("demoToday is the local date of the demo pro (Europe/Paris), whatever the zone of the host", () => {
  assert.equal(DEMO_TZ, "Europe/Paris");
  assert.equal(demoToday(), todayKey(new Date(), "Europe/Paris"));
});

test("demoWeek: the seven days of the week after today, Monday first", () => {
  const week = demoWeek();
  assert.equal(week.length, 7);
  assert.equal(dayOfWeek(week[0]), 1, "the week starts on a Monday");
  const gap = diffDays(demoToday(), week[0]);
  assert.ok(gap >= 1 && gap <= 7, `the Monday is 1 to 7 days ahead (got ${gap})`);
  week.forEach((day, i) => assert.equal(day, addDays(week[0], i)));
  assert.ok(compareKeys(week[0], demoToday()) > 0, "every séance of the tour is in the future");
});

test("the ticket types and their offers are the Altinha catalog (scripts/content/altinha.ts)", () => {
  const catalog = altinhaCatalog(demoToday());
  assert.deepEqual(
    DEMO_TICKET_TYPES.map((t) => t.key),
    catalog.types.map((t) => t.key),
  );
  for (const real of catalog.types) {
    const shown = DEMO_TICKET_TYPES.find((t) => t.key === real.key);
    assert.ok(shown, real.key);
    assert.equal(shown.name, real.type.name);
    assert.equal(shown.description, real.type.description);
    assert.equal(shown.color, real.type.color);
    assert.deepEqual(
      shown.offers.map((o) => ({ quantity: o.quantity, priceCents: o.priceCents, months: o.validityMonths })),
      real.offers.map((o) => ({ quantity: o.quantity, priceCents: o.priceCents, months: o.validityCount ?? null })),
      `${real.key} offers`,
    );
    assert.equal(shown.rdv === null, !real.type.rdvEnabled, `${real.key} RDV libre`);
    if (shown.rdv) {
      assert.equal(shown.rdv.durationMin, real.type.rdvDurationMin);
      assert.equal(shown.rdv.free, real.type.rdvFree === true);
    }
  }
});

test("the events are the Altinha catalog: place, colour, places, duration, start, days, mode and accepted tickets", () => {
  const catalog = altinhaCatalog(demoToday());
  assert.deepEqual(
    DEMO_EVENTS.map((e) => e.key),
    catalog.events.map((e) => e.key),
  );
  for (const real of catalog.events) {
    const shown = DEMO_EVENTS.find((e) => e.key === real.key);
    assert.ok(shown, real.key);
    assert.equal(shown.title, real.title);
    assert.equal(shown.description, real.description);
    assert.equal(shown.location, real.location);
    assert.equal(shown.color, real.color);
    assert.equal(shown.capacity, real.capacity);
    assert.equal(shown.durationMin, real.durationMin);
    assert.equal(shown.startMinute, real.rule.startMinute);
    assert.equal(shown.mode, real.bookingMode);
    assert.equal(shown.isPrivate, real.isPrivate);
    assert.deepEqual(shown.accepts, real.ticketTypeKeys);
  }
});

test("weekSeances: each event on its days of the shown week, the atelier only on a first Sunday", () => {
  const week = demoWeek();
  const seances = weekSeances();
  const daysOf = (key: string) => seances.filter((s) => s.event === key).map((s) => s.dayIndex);
  assert.deepEqual(daysOf("debutants"), [0, 2], "Monday and Wednesday");
  assert.deepEqual(daysOf("intermediaires"), [1, 3], "Tuesday and Thursday");
  assert.deepEqual(daysOf("competition"), [4], "Friday");
  assert.deepEqual(daysOf("roda"), [5], "Saturday");
  assert.deepEqual(daysOf("atelier"), parseKey(week[6]).d <= 7 ? [6] : [], "the first Sunday of the month only");
  for (const s of seances) {
    const event = DEMO_EVENTS.find((e) => e.key === s.event);
    assert.ok(event);
    assert.equal(s.startMinute, event.startMinute);
    assert.ok(s.taken < s.capacity, `${s.id} has a free place`);
  }
});

test("Léa's rendez-vous is a free Appel découverte slot on a weekday, and nothing in the planning overlaps it", () => {
  const decouverte = DEMO_TICKET_TYPES.find((t) => t.key === "decouverte");
  assert.ok(decouverte?.rdv);
  assert.equal(LEA_RDV.durationMin, decouverte.rdv.durationMin);
  assert.ok(LEA_RDV.dayIndex >= 0 && LEA_RDV.dayIndex <= 4, "Monday to Friday");
  assert.ok(rdvSlots(LEA_RDV.dayIndex).includes(LEA_RDV.time));
  assert.deepEqual(rdvSlots(5), [], "no slot on Saturday");
  assert.deepEqual(rdvSlots(6), [], "no slot on Sunday");
  // Mon to Fri, 12:00 to 14:00, every 15 minutes (the catalog's own hours for this type).
  assert.equal(rdvSlots(0)[0], "12:00");
  assert.equal(rdvSlots(0).at(-1), "13:45");
});

test("the pro planning: no two blocks of a day overlap, and every block fits the hours shown", () => {
  const lea = { dayIndex: LEA_RDV.dayIndex, startMinute: LEA_RDV.startMinute, durationMin: LEA_RDV.durationMin };
  const blocks = [...weekSeances(), ...WEEK_RDVS, lea];
  for (const b of blocks) {
    assert.ok(b.startMinute >= PLANNING_HOURS.start * 60, "starts after the first hour");
    assert.ok(b.startMinute + b.durationMin <= PLANNING_HOURS.end * 60, "ends before the last hour");
  }
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.dayIndex !== b.dayIndex) continue;
      const overlaps = a.startMinute < b.startMinute + b.durationMin && b.startMinute < a.startMinute + a.durationMin;
      assert.equal(overlaps, false, `blocks ${i} and ${j} overlap`);
    }
  }
});

test("the carnet Léa buys is the Carnet de 4 of Cours collectif, valid 3 months from today", () => {
  assert.equal(DEMO_CARNET.id, CARNET_OFFER_ID);
  assert.equal(DEMO_CARNET.quantity, 4);
  assert.equal(DEMO_CARNET.validityMonths, 3);
  const collectif = DEMO_TICKET_TYPES.find((t) => t.key === "collectif");
  assert.ok(collectif?.offers.some((o) => o.id === CARNET_OFFER_ID));
  assert.equal(carnetExpiryKey(), addMonthsClamped(demoToday(), 3));
});

test("the séance panel lists one registrant per place taken on Monday before Léa", () => {
  const monday = weekSeances().find((s) => s.id === LEA_SEANCE_IDS.monday);
  assert.ok(monday);
  assert.equal(MONDAY_ATTENDEES.length, monday.taken);
  assert.ok(!MONDAY_ATTENDEES.some((a) => a.name === DEMO_CLIENT.name));
});

test("the dates the screens write: the short and long forms of the booking pages, the carnet's last day", () => {
  const week = demoWeek();
  assert.match(whenLong(week[0], 19 * 60, 60), /^lun\. \d{1,2}(er)? [a-zéû]+ \d{4} · 19:00 à 20:00$/);
  assert.match(whenShort(week[2], 19 * 60), /^mer\. \d{2}\/\d{2}(\/\d{4})? · 19:00$/);
  assert.match(carnetExpiryLine(3), /^3 valables jusqu'au \d{2}\/\d{2}(\/\d{4})? inclus$/);
  assert.match(carnetExpiryLine(1), /^1 valable jusqu'au /);
});

test("the demo data speaks of tickets and carnets, and its client is a reserved example address", () => {
  const text = JSON.stringify([DEMO_BRAND, DEMO_CLIENT, DEMO_TICKET_TYPES, DEMO_EVENTS, WEEK_RDVS, MONDAY_ATTENDEES]);
  assert.doesNotMatch(text, /\bpacks?\b|cr[eé]dits?|prestations?/i);
  assert.match(DEMO_CLIENT.email, /@example\.com$/);
  assert.doesNotMatch(text, /skedul\.(app|test)|password|mot de passe/i);
});
