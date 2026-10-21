import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, instantAt, type DateKey } from "@/lib/civil-date";

import type { PlanningAttendee, PlanningItem, PlanningTimeOff } from "./planning-reads";
import {
  blockLabel,
  dayCountText,
  dayLongLabel,
  dayShortLabel,
  gridHours,
  hhmm,
  hiddenByTimeOff,
  horizonNotice,
  minimumSeatsMessage,
  minuteFromOffset,
  previewTitle,
  seatsRatio,
  seatsSummary,
  seatsText,
  timeOffSegments,
  tintOf,
  toPlanningVM,
  unenrolledMessage,
  weekTitle,
} from "./planning-view";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const NO_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const NOW = new Date("2026-10-10T10:00:00Z");
const MONDAY: DateKey = "2026-10-12";

const at = (day: DateKey, minute: number, tz: string = PARIS): Date => instantAt(day, minute, tz);

function week(monday: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function item(id: string, startsAt: Date, minutes: number, over: Partial<PlanningItem> = {}): PlanningItem {
  return {
    id,
    kind: "seance",
    eventId: `ev-${id}`,
    eventVersion: 1,
    ticketTypeId: null,
    title: `Séance ${id}`,
    color: "#6366f1",
    startsAt,
    endsAt: new Date(startsAt.getTime() + minutes * 60_000),
    status: "scheduled",
    capacity: 12,
    seatsTaken: 0,
    elapsedHolds: 0,
    liveSeats: 0,
    seatsShown: 12,
    location: null,
    eventLocation: null,
    locationOverride: null,
    bookingMode: "tickets",
    isPrivate: false,
    acceptedTypes: [],
    questions: [],
    seriesDate: null,
    recurring: false,
    canRestore: false,
    timeDetached: false,
    attendees: [],
    ...over,
  };
}

function attendee(over: Partial<PlanningAttendee> = {}): PlanningAttendee {
  return {
    bookingId: "b1",
    customerId: "c1",
    name: "Thomas Leroy",
    email: "thomas@example.com",
    phone: null,
    status: "confirmed",
    coverage: "ticket",
    createdBy: "pro",
    ticket: null,
    holdExpiresAt: null,
    answers: [],
    customerNotes: null,
    movedAt: null,
    createdAt: NOW,
    ...over,
  };
}

test("hiddenByTimeOff hides only an empty scheduled séance that overlaps a time off", () => {
  const off = [{ startAt: at(MONDAY, 540), endAt: at(MONDAY, 720) }]; // 09:00 to 12:00
  const inside = item("a", at(MONDAY, 600), 60);
  assert.equal(hiddenByTimeOff(inside, off), true);
  assert.equal(hiddenByTimeOff({ ...inside, liveSeats: 1 }, off), false, "booked");
  assert.equal(hiddenByTimeOff({ ...inside, status: "cancelled" }, off), false, "cancelled");
  assert.equal(hiddenByTimeOff({ ...inside, kind: "rdv" }, off), false, "an RDV is never hidden");
  // R1: a seat kept only by a hold that has lapsed is a free seat, the séance is as empty as any other.
  assert.equal(
    hiddenByTimeOff(item("e", at(MONDAY, 600), 60, { seatsTaken: 1, elapsedHolds: 1, liveSeats: 0 }), off),
    true,
    "only a lapsed hold left",
  );
  assert.equal(
    hiddenByTimeOff(item("f", at(MONDAY, 600), 60, { seatsTaken: 2, elapsedHolds: 1, liveSeats: 1 }), off),
    false,
    "a lapsed hold next to a live seat",
  );
  assert.equal(hiddenByTimeOff(item("b", at(MONDAY, 480), 60), off), false, "ends when the time off starts");
  assert.equal(hiddenByTimeOff(item("c", at(MONDAY, 720), 60), off), false, "starts when the time off ends");
  assert.equal(hiddenByTimeOff(item("d", at(MONDAY, 510), 60), off), true, "overlaps the start");
  assert.equal(hiddenByTimeOff(inside, []), false);
});

test("toPlanningVM: two overlapping séances share the lanes, a third one stands alone", () => {
  const a = item("a", at(MONDAY, 600), 60);
  const b = item("b", at(MONDAY, 630), 60);
  const c = item("c", at(MONDAY, 720), 60);
  const vms = toPlanningVM([c, b, a], [], PARIS, NOW);
  assert.deepEqual(
    vms.map((v) => [v.id, v.dayKey, v.startMinute, v.endMinute, v.lane, v.lanes]),
    [
      ["a", MONDAY, 600, 660, 0, 2],
      ["b", MONDAY, 630, 690, 1, 2],
      ["c", MONDAY, 720, 780, 0, 1],
    ],
  );
  assert.equal(vms[0].startsAt, a.startsAt.toISOString());
  assert.equal(vms[0].endsAt, a.endsAt.toISOString());
});

test("toPlanningVM: séances of two different days never share a lane", () => {
  const [one, two] = toPlanningVM(
    [item("one", at(MONDAY, 600), 60), item("two", at(addDays(MONDAY, 1), 630), 60)],
    [],
    PARIS,
    NOW,
  );
  assert.deepEqual([one.lane, one.lanes, two.lane, two.lanes], [0, 1, 0, 1]);
});

test("toPlanningVM: an end on a later day is endMinute 1440", () => {
  const late = item("late", at(MONDAY, 1380), 90); // 23:00 to 00:30
  const exact = item("exact", at(addDays(MONDAY, 1), 1380), 60); // 23:00 to midnight
  const [l, e] = toPlanningVM([late, exact], [], PARIS, NOW);
  assert.deepEqual([l.startMinute, l.endMinute, l.dayKey], [1380, 1440, MONDAY]);
  assert.deepEqual([e.startMinute, e.endMinute, e.dayKey], [1380, 1440, addDays(MONDAY, 1)]);
});

test("toPlanningVM reads the day and the minutes in the given time zone (Paris and Los Angeles)", () => {
  const x = item("x", new Date("2026-10-13T05:00:00Z"), 60);
  const [paris] = toPlanningVM([x], [], PARIS, NOW);
  const [la] = toPlanningVM([x], [], LA, NOW);
  assert.deepEqual([paris.dayKey, paris.startMinute, paris.endMinute], ["2026-10-13", 420, 480]);
  assert.deepEqual([la.dayKey, la.startMinute, la.endMinute], ["2026-10-12", 1320, 1380]);
});

test("toPlanningVM keeps wall-clock minutes on a 25 hour day (Paris 2026-10-25, Los Angeles 2026-11-01)", () => {
  const paris = item("p", at("2026-10-25", 1140), 60);
  const la = item("l", at("2026-11-01", 1140, LA), 60);
  const [p] = toPlanningVM([paris], [], PARIS, NOW);
  const [l] = toPlanningVM([la], [], LA, NOW);
  assert.deepEqual([p.dayKey, p.startMinute, p.endMinute], ["2026-10-25", 1140, 1200]);
  assert.deepEqual([l.dayKey, l.startMinute, l.endMinute], ["2026-11-01", 1140, 1200]);
});

test("toPlanningVM drops an empty séance under a time off and keeps booked, cancelled and RDV", () => {
  const off: PlanningTimeOff[] = [
    { id: "t1", startAt: at(MONDAY, 0), endAt: at(addDays(MONDAY, 1), 0), allDay: true, reason: "Vacances" },
  ];
  const empty = item("empty", at(MONDAY, 600), 60);
  const booked = item("booked", at(MONDAY, 700), 60, { seatsTaken: 1, liveSeats: 1 });
  const gone = item("gone", at(MONDAY, 800), 60, { status: "cancelled" });
  const rdv = item("rdv", at(MONDAY, 900), 60, { kind: "rdv", eventId: null, eventVersion: null, seatsTaken: 1, liveSeats: 1 });
  const next = item("next", at(addDays(MONDAY, 1), 600), 60);
  assert.deepEqual(
    toPlanningVM([empty, booked, gone, rdv, next], off, PARIS, NOW).map((v) => v.id),
    ["booked", "gone", "rdv", "next"],
  );
});

test("toPlanningVM flags started and past against now", () => {
  const now = at(MONDAY, 630); // 10:30
  const [a, c] = toPlanningVM([item("a", at(MONDAY, 600), 60), item("c", at(MONDAY, 720), 60)], [], PARIS, now);
  assert.deepEqual([a.started, a.past, c.started, c.past], [true, false, false, false]);
  const [done] = toPlanningVM([item("d", at(MONDAY, 480), 60)], [], PARIS, now);
  assert.deepEqual([done.started, done.past], [true, true]);
});

test("toPlanningVM carries timeDetached, so the dialog can hide « et les suivantes » for a séance moved alone", () => {
  const [normal, alone] = toPlanningVM(
    [item("normal", at(MONDAY, 600), 60), item("alone", at(MONDAY, 720), 60, { timeDetached: true })],
    [],
    PARIS,
    NOW,
  );
  assert.deepEqual([normal.timeDetached, alone.timeDetached], [false, true]);
});

test("toPlanningVM with the week days drops an item of another day, which then never widens the grid", () => {
  const days = week(MONDAY);
  const carriedOver = item("prev", at("2026-10-11", 1380), 90); // Sunday 23:00 to Monday 00:30 of the previous week
  const early = item("early", at("2026-10-19", 360), 60); // next Monday 06:00
  const inside = item("in", at(MONDAY, 600), 60);
  const sunday = item("sun", at("2026-10-18", 1380), 90); // the week's own Sunday 23:00, ending next Monday 00:30
  const vms = toPlanningVM([carriedOver, early, inside, sunday], [], PARIS, NOW, days);
  assert.deepEqual(vms.map((v) => v.id), ["in", "sun"]);
  assert.deepEqual(gridHours(toPlanningVM([carriedOver, early, inside], [], PARIS, NOW, days)), { startHour: 8, endHour: 21 });
  assert.deepEqual(gridHours(vms), { startHour: 8, endHour: 24 }, "the kept Sunday séance still runs to midnight");
  // Without the days every item is placed on its own day (the previous signature).
  assert.deepEqual(
    toPlanningVM([carriedOver, early, inside], [], PARIS, NOW).map((v) => [v.id, v.dayKey]),
    [
      ["prev", "2026-10-11"],
      ["in", MONDAY],
      ["early", "2026-10-19"],
    ],
  );
});

test("toPlanningVM: holdLapsed marks a pending booking whose hold has ended, at the instant included", () => {
  const now = at(MONDAY, 600); // 10:00
  const people = [
    attendee({ bookingId: "past", status: "pending", holdExpiresAt: at(MONDAY, 599) }),
    attendee({ bookingId: "exact", status: "pending", holdExpiresAt: at(MONDAY, 600) }),
    attendee({ bookingId: "live", status: "pending", holdExpiresAt: at(MONDAY, 601) }),
    attendee({ bookingId: "sure", status: "confirmed", holdExpiresAt: null }),
    attendee({ bookingId: "stale", status: "confirmed", holdExpiresAt: at(MONDAY, 500) }),
  ];
  const [vm] = toPlanningVM([item("s", at(MONDAY, 700), 60, { seatsTaken: 5, attendees: people })], [], PARIS, now);
  assert.deepEqual(
    vm.attendees.map((a) => [a.bookingId, a.holdLapsed, a.holdUntil]),
    [
      ["past", true, "09:59"],
      ["exact", true, "10:00"],
      ["live", false, "10:01"],
      ["sure", false, null],
      ["stale", false, null],
    ],
  );
});

test("toPlanningVM: attendee labels and hold time are read in the given time zone", () => {
  const people = [
    attendee({
      bookingId: "b1",
      ticket: { id: "t1", typeName: "Cours collectif", expiresAt: at("2026-12-21", 0), purchased: true },
    }),
    attendee({
      bookingId: "b2",
      name: "Marina Costa",
      ticket: { id: "t2", typeName: "Cours collectif", expiresAt: null, purchased: false },
      answers: [{ label: "Niveau", value: "Débutant" }],
      customerNotes: "Gauchère",
      movedAt: NOW,
    }),
    attendee({ bookingId: "b3", status: "pending", holdExpiresAt: new Date("2026-10-12T17:45:00Z"), ticket: null }),
  ];
  const slot = item("s", at(MONDAY, 1140), 60, { seatsTaken: 3, attendees: people });
  const [paris] = toPlanningVM([slot], [], PARIS, NOW);
  assert.equal(paris.attendees[0].ticketLabel, "Cours collectif · valable jusqu'au 20/12 inclus");
  assert.equal(paris.attendees[1].ticketLabel, "Cours collectif · sans limite de validité · offert");
  assert.equal(paris.attendees[1].moved, true);
  assert.deepEqual(paris.attendees[1].answers, [{ label: "Niveau", value: "Débutant" }]);
  assert.equal(paris.attendees[1].notes, "Gauchère");
  assert.equal(paris.attendees[2].ticketLabel, null);
  assert.equal(paris.attendees[2].holdUntil, "19:45");
  assert.equal(paris.attendees[0].holdUntil, null);
  assert.equal(paris.attendees[0].moved, false);
  const [la] = toPlanningVM([slot], [], LA, NOW);
  assert.equal(la.attendees[2].holdUntil, "10:45");
  for (const a of [...paris.attendees, ...la.attendees]) {
    assert.doesNotMatch(`${a.ticketLabel ?? ""}${a.holdUntil ?? ""}`, NO_DASH);
  }
});

test("timeOffSegments cuts a 3-day all-day time off into 3 full-day segments", () => {
  const off: PlanningTimeOff[] = [
    { id: "t1", startAt: at("2026-10-14", 0), endAt: at("2026-10-17", 0), allDay: true, reason: "Vacances" },
  ];
  const segments = timeOffSegments(off, week(MONDAY), PARIS);
  assert.deepEqual(
    segments.map((s) => [s.id, s.dayKey, s.startMinute, s.endMinute, s.allDay, s.reason]),
    [
      ["t1", "2026-10-14", 0, 1440, true, "Vacances"],
      ["t1", "2026-10-15", 0, 1440, true, "Vacances"],
      ["t1", "2026-10-16", 0, 1440, true, "Vacances"],
    ],
  );
});

test("timeOffSegments: a partial day, and a partial range across midnight", () => {
  const partial: PlanningTimeOff[] = [
    { id: "p1", startAt: at("2026-10-14", 840), endAt: at("2026-10-14", 990), allDay: false, reason: null },
  ];
  assert.deepEqual(
    timeOffSegments(partial, week(MONDAY), PARIS).map((s) => [s.dayKey, s.startMinute, s.endMinute, s.allDay, s.reason]),
    [["2026-10-14", 840, 990, false, null]],
  );
  const overnight: PlanningTimeOff[] = [
    { id: "p2", startAt: at("2026-10-13", 1320), endAt: at("2026-10-14", 480), allDay: false, reason: "Déplacement" },
  ];
  assert.deepEqual(
    timeOffSegments(overnight, week(MONDAY), PARIS).map((s) => [s.dayKey, s.startMinute, s.endMinute]),
    [
      ["2026-10-13", 1320, 1440],
      ["2026-10-14", 0, 480],
    ],
  );
});

test("timeOffSegments keeps only the days of the week, half-open at both ends", () => {
  const spill: PlanningTimeOff[] = [
    { id: "s1", startAt: at("2026-10-10", 0), endAt: at("2026-10-13", 0), allDay: true, reason: null },
  ];
  assert.deepEqual(
    timeOffSegments(spill, week(MONDAY), PARIS).map((s) => [s.dayKey, s.startMinute, s.endMinute]),
    [["2026-10-12", 0, 1440]],
  );
  const before: PlanningTimeOff[] = [
    { id: "s2", startAt: at("2026-10-05", 0), endAt: at(MONDAY, 0), allDay: true, reason: null },
  ];
  assert.deepEqual(timeOffSegments(before, week(MONDAY), PARIS), []);
  const after: PlanningTimeOff[] = [
    { id: "s3", startAt: at("2026-10-19", 0), endAt: at("2026-10-20", 0), allDay: true, reason: null },
  ];
  assert.deepEqual(timeOffSegments(after, week(MONDAY), PARIS), []);
});

test("timeOffSegments: a full day is 0 to 1440 on a 25 hour day (Paris and Los Angeles)", () => {
  const paris: PlanningTimeOff[] = [
    { id: "d1", startAt: at("2026-10-25", 0), endAt: at("2026-10-26", 0), allDay: true, reason: null },
  ];
  assert.deepEqual(
    timeOffSegments(paris, week("2026-10-19"), PARIS).map((s) => [s.dayKey, s.startMinute, s.endMinute]),
    [["2026-10-25", 0, 1440]],
  );
  const la: PlanningTimeOff[] = [
    { id: "d2", startAt: at("2026-11-01", 0, LA), endAt: at("2026-11-02", 0, LA), allDay: true, reason: null },
  ];
  assert.deepEqual(
    timeOffSegments(la, week("2026-10-26"), LA).map((s) => [s.dayKey, s.startMinute, s.endMinute]),
    [["2026-11-01", 0, 1440]],
  );
});

test("gridHours: 8 to 21 by default, widened by the items", () => {
  const vms = (...items: PlanningItem[]) => toPlanningVM(items, [], PARIS, NOW);
  assert.deepEqual(gridHours([]), { startHour: 8, endHour: 21 });
  assert.deepEqual(gridHours(vms(item("a", at(MONDAY, 600), 60))), { startHour: 8, endHour: 21 });
  assert.deepEqual(gridHours(vms(item("a", at(MONDAY, 390), 60))), { startHour: 6, endHour: 21 }); // 06:30
  assert.deepEqual(gridHours(vms(item("a", at(MONDAY, 1260), 75))), { startHour: 8, endHour: 23 }); // 21:00 to 22:15
  assert.deepEqual(gridHours(vms(item("a", at(MONDAY, 1380), 90))), { startHour: 8, endHour: 24 }); // across midnight
});

test("weekTitle: same month, two months, two years", () => {
  assert.equal(weekTitle(week("2026-10-12")), "12 au 18 octobre 2026");
  assert.equal(weekTitle(week("2026-09-28")), "28 septembre au 4 octobre 2026");
  assert.equal(weekTitle(week("2026-12-29")), "29 décembre 2026 au 4 janvier 2027");
  // « 1er » on the first of the month, as first day (same month) and as last day (month change, year change).
  assert.equal(weekTitle(week("2026-06-01")), "1er au 7 juin 2026");
  assert.equal(weekTitle(week("2026-10-26")), "26 octobre au 1er novembre 2026");
  assert.equal(weekTitle(week("2022-12-26")), "26 décembre 2022 au 1er janvier 2023");
  assert.equal(weekTitle(week("2026-11-30")), "30 novembre au 6 décembre 2026");
  for (const monday of ["2026-10-12", "2026-09-28", "2026-12-29", "2026-06-01", "2026-10-26", "2022-12-26"]) {
    assert.doesNotMatch(weekTitle(week(monday)), NO_DASH);
  }
});

test("minuteFromOffset rounds down to 30 minutes and stays within 0..1410", () => {
  assert.equal(minuteFromOffset(0, 8, 60), 480);
  assert.equal(minuteFromOffset(29, 8, 60), 480);
  assert.equal(minuteFromOffset(30, 8, 60), 510);
  assert.equal(minuteFromOffset(45, 8, 60), 510);
  assert.equal(minuteFromOffset(120, 8, 60), 600);
  assert.equal(minuteFromOffset(36, 8, 36), 540, "36 px per hour");
  assert.equal(minuteFromOffset(18, 8, 36), 510);
  assert.equal(minuteFromOffset(-500, 0, 60), 0);
  assert.equal(minuteFromOffset(100_000, 0, 60), 1410);
  assert.equal(minuteFromOffset(1439, 0, 60), 1410);
  assert.equal(minuteFromOffset(Number.NaN, 8, 60), 480);
});

test("hhmm: a wall-clock minute as HH:MM, 1440 reads 00:00", () => {
  assert.equal(hhmm(0), "00:00");
  assert.equal(hhmm(570), "09:30");
  assert.equal(hhmm(1139), "18:59");
  assert.equal(hhmm(1439), "23:59");
  assert.equal(hhmm(1440), "00:00");
});

test("dayShortLabel and dayLongLabel read a civil day, whatever the host zone", () => {
  assert.equal(dayShortLabel("2026-10-12"), "lun. 12");
  assert.equal(dayShortLabel("2026-10-18"), "dim. 18");
  assert.equal(dayLongLabel("2026-10-12"), "lundi 12 octobre");
  assert.equal(dayLongLabel("2026-12-31"), "jeudi 31 décembre");
  // The 25 hour day of Paris and the 25 hour day of Los Angeles keep their own weekday.
  assert.equal(dayShortLabel("2026-10-25"), "dim. 25");
  assert.equal(dayLongLabel("2026-11-01"), "dimanche 1er novembre");
  // The 1st takes the ordinal everywhere a day of the month is written, the short label included (final review R5).
  assert.equal(dayShortLabel("2026-11-01"), "dim. 1er");
  assert.equal(dayShortLabel("2026-10-11"), "dim. 11");
  assert.equal(dayShortLabel("2026-10-21"), "mer. 21");
  assert.equal(dayLongLabel("2026-10-11"), "dimanche 11 octobre");
  assert.equal(dayLongLabel("2026-10-21"), "mercredi 21 octobre");
  assert.equal(dayLongLabel("2026-10-31"), "samedi 31 octobre");
  assert.equal(dayLongLabel("2026-01-01"), "jeudi 1er janvier");
  for (const day of week(MONDAY)) {
    assert.doesNotMatch(`${dayShortLabel(day)}${dayLongLabel(day)}`, NO_DASH);
  }
});

test("tintOf: a light mix of the event colour with white", () => {
  assert.equal(tintOf("#6366f1"), "color-mix(in srgb, #6366f1 16%, white)");
});

test("unenrolledMessage: one name or several, tickets returned or not, no dash", () => {
  const messages = [
    unenrolledMessage(["Thomas Leroy"], 1, 1),
    unenrolledMessage(["Thomas Leroy"], 1, 0),
    unenrolledMessage(["Thomas Leroy", "Marina Costa"], 2, 2),
    unenrolledMessage(["Thomas Leroy", "Marina Costa"], 2, 1),
    unenrolledMessage(["Thomas Leroy", "Marina Costa"], 2, 0),
  ];
  assert.deepEqual(messages, [
    "Inscription de Thomas Leroy annulée. Le ticket est rendu au client, qui est prévenu par email.",
    "Inscription de Thomas Leroy annulée. Le client est prévenu par email.",
    "2 inscriptions annulées. Les tickets sont rendus aux clients, qui sont prévenus par email.",
    "2 inscriptions annulées. Les tickets sont rendus aux clients, qui sont prévenus par email.",
    "2 inscriptions annulées. Les clients sont prévenus par email.",
  ]);
  // The count, not the number of names, decides the plural (a name list can lag the engine's count).
  assert.equal(unenrolledMessage(["A", "B"], 1, 0), "1 inscription annulée. Le client est prévenu par email.");
  assert.equal(unenrolledMessage([], 1, 1), "1 inscription annulée. Le ticket est rendu au client, qui est prévenu par email.");
});

test("unenrolledMessage: the head and the tail always agree, whatever the number of names", () => {
  // One name against a count of 2 (or 0) used to read « Inscription de X annulée. Les clients ... ».
  const lagging = [
    unenrolledMessage(["Thomas Leroy"], 2, 2),
    unenrolledMessage(["Thomas Leroy"], 2, 0),
    unenrolledMessage(["Thomas Leroy"], 0, 0),
    unenrolledMessage(["Thomas Leroy"], 0, 1),
    unenrolledMessage([], 0, 0),
  ];
  assert.deepEqual(lagging, [
    "2 inscriptions annulées. Les tickets sont rendus aux clients, qui sont prévenus par email.",
    "2 inscriptions annulées. Les clients sont prévenus par email.",
    "Aucune inscription annulée.",
    "Aucune inscription annulée.",
    "Aucune inscription annulée.",
  ]);
  for (const m of lagging) assert.doesNotMatch(m, NO_DASH);
  // A single cancellation is named only when exactly one name is known.
  assert.match(unenrolledMessage(["Thomas Leroy"], 1, 0), /^Inscription de Thomas Leroy annulée\. Le client est/);
  assert.match(unenrolledMessage(["Thomas Leroy", "Marina Costa"], 1, 0), /^1 inscription annulée\. Le client est/);
});

const blockOf = (over: Partial<Parameters<typeof blockLabel>[0]> = {}): Parameters<typeof blockLabel>[0] => ({
  title: "Altinha débutants",
  kind: "seance",
  startsAt: at("2026-10-12", 1140).toISOString(),
  endsAt: at("2026-10-12", 1200).toISOString(),
  status: "scheduled",
  liveSeats: 2,
  capacity: 12,
  attendees: [],
  ...over,
});

test("blockLabel: the accessible name of a séance block is title, when and seats", () => {
  assert.equal(blockLabel(blockOf(), PARIS), "Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00, 2 inscrits sur 12");
  assert.equal(
    blockLabel(blockOf({ liveSeats: 0 }), PARIS),
    "Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00, 0 inscrit sur 12",
  );
  assert.equal(
    blockLabel(blockOf({ liveSeats: 1 }), PARIS),
    "Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00, 1 inscrit sur 12",
  );
});

test("blockLabel: a cancelled block says so in its name, a first of the month is written « 1er »", () => {
  assert.equal(
    blockLabel(blockOf({ status: "cancelled", liveSeats: 0 }), PARIS),
    "Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00, 0 inscrit sur 12, annulée",
  );
  const first = blockOf({ startsAt: at("2026-11-01", 1140).toISOString(), endsAt: at("2026-11-01", 1200).toISOString() });
  assert.equal(blockLabel(first, PARIS), "Altinha débutants, dim. 1er novembre 2026 · 19:00 à 20:00, 2 inscrits sur 12");
});

test("blockLabel: an RDV block names its client, as the block shows it, instead of a seat count", () => {
  const client = { name: "Beatriz Almeida" };
  const rdv = blockOf({
    title: "Cours particulier",
    kind: "rdv",
    capacity: 1,
    liveSeats: 1,
    attendees: [client],
    startsAt: at("2026-10-13", 660).toISOString(),
    endsAt: at("2026-10-13", 720).toISOString(),
  });
  assert.equal(blockLabel(rdv, PARIS), "Cours particulier, mar. 13 octobre 2026 · 11:00 à 12:00, Beatriz Almeida");
  assert.equal(
    blockLabel({ ...rdv, status: "cancelled" }, PARIS),
    "Cours particulier, mar. 13 octobre 2026 · 11:00 à 12:00, Beatriz Almeida, annulée",
  );
  // No attendee to name: the seat count is the fallback.
  assert.equal(
    blockLabel({ ...rdv, attendees: [] }, PARIS),
    "Cours particulier, mar. 13 octobre 2026 · 11:00 à 12:00, 1 inscrit sur 1",
  );
  assert.doesNotMatch(blockLabel(rdv, PARIS), NO_DASH);
});

test("previewTitle: the dashboard card names the week, today, or the day shown", () => {
  assert.equal(previewTitle("week", "2026-10-14", "2026-10-14"), "Cette semaine");
  assert.equal(previewTitle("week", "2026-10-15", "2026-10-14"), "Cette semaine");
  assert.equal(previewTitle("day", "2026-10-14", "2026-10-14"), "Aujourd'hui");
  assert.equal(previewTitle("day", "2026-10-15", "2026-10-14"), "jeudi 15 octobre");
  assert.equal(previewTitle("day", "2026-11-01", "2026-10-14"), "dimanche 1er novembre");
});

// R1: « inscrits » is one number everywhere in the back-office: the confirmed bookings plus the holds that are still
// live. seatsTaken also counts the holds that lapsed and that nobody has released yet, so it is not that number.
const LAPSED = { capacity: 10, seatsTaken: 3, elapsedHolds: 1, liveSeats: 2, seatsShown: 8 } as const;

test("toPlanningVM carries liveSeats next to the raw seatsTaken", () => {
  const [vm] = toPlanningVM([item("s", at(MONDAY, 600), 60, LAPSED)], [], PARIS, NOW);
  assert.deepEqual([vm.seatsTaken, vm.liveSeats, vm.seatsShown], [3, 2, 8]);
});

test("a lapsed hold is not a registrant: the block, its name, the list and the dialog line all say 2 of 10", () => {
  // Capacity 10, two confirmed bookings and one abandoned checkout whose hold has lapsed and was not released yet.
  const [vm] = toPlanningVM([item("s", at(MONDAY, 600), 60, LAPSED)], [], PARIS, NOW);
  assert.equal(seatsText(vm), "2 inscrits sur 10");
  assert.equal(seatsRatio(vm), "2/10");
  assert.equal(seatsSummary(vm), "2 inscrits sur 10 · 8 places en ligne");
  assert.match(blockLabel(vm, PARIS), /, 2 inscrits sur 10$/);
  // The registrants and the places on offer add up to the capacity, which the raw seatsTaken never did (3 + 8).
  assert.equal(vm.liveSeats + vm.seatsShown, vm.capacity);
});

test("seatsText, seatsRatio and seatsSummary: singular, zero and a full séance", () => {
  const vm = (liveSeats: number, seatsShown: number, capacity = 12) => ({ liveSeats, seatsShown, capacity });
  assert.equal(seatsText(vm(0, 12)), "0 inscrit sur 12");
  assert.equal(seatsText(vm(1, 11)), "1 inscrit sur 12");
  // a one-seat séance: « 1 inscrit sur 1 », never « 1 / 1 places » (final review UI-10)
  assert.equal(seatsText({ liveSeats: 1, capacity: 1 }), "1 inscrit sur 1");
  assert.equal(seatsRatio(vm(0, 12)), "0/12");
  assert.equal(seatsSummary(vm(1, 11)), "1 inscrit sur 12 · 11 places en ligne");
  assert.equal(seatsSummary(vm(11, 1)), "11 inscrits sur 12 · 1 place en ligne");
  assert.equal(seatsSummary(vm(12, 0)), "12 inscrits sur 12 · 0 place en ligne");
  for (const text of [seatsText(vm(2, 10)), seatsRatio(vm(2, 10)), seatsSummary(vm(2, 10))]) assert.doesNotMatch(text, NO_DASH);
});

test("minimumSeatsMessage: the capacity floor speaks of seats taken, not of registrants (a lapsed hold still holds one)", () => {
  assert.equal(minimumSeatsMessage(0), "Minimum 1 place.");
  assert.equal(minimumSeatsMessage(1), "Minimum 1 : 1 place est déjà prise.");
  assert.equal(minimumSeatsMessage(3), "Minimum 3 : 3 places sont déjà prises.");
  for (const n of [0, 1, 3]) assert.doesNotMatch(minimumSeatsMessage(n), NO_DASH);
});

// R10: the engine materialises the recurring séances 400 days ahead. A week beyond that looks empty although the series
// go on: the page says until when they are shown.
test("horizonNotice: a week that reaches past the last generated date says until when the recurring séances are shown", () => {
  const days = week(MONDAY); // 12 to 18 October 2026
  assert.equal(horizonNotice(days, null), null, "no series that can still produce dates");
  assert.equal(horizonNotice(days, "2027-11-20"), null, "generated far beyond the week");
  assert.equal(horizonNotice(days, "2026-10-18"), null, "generated up to the last day of the week");
  assert.equal(horizonNotice(days, "2026-10-14"), "Les séances récurrentes sont affichées jusqu'au 14/10/2026.", "the week is cut by the horizon");
  const far = week("2027-12-06");
  assert.equal(horizonNotice(far, "2027-11-20"), "Les séances récurrentes sont affichées jusqu'au 20/11/2027.", "the whole week is past it");
  assert.equal(horizonNotice([], "2026-10-14"), null);
  assert.doesNotMatch(horizonNotice(far, "2027-11-20") ?? "", NO_DASH);
});

test("dayCountText: a day chip counts séances and rendez-vous with their own words (final review UI-12)", () => {
  const seance = { kind: "seance" } as const;
  const rdv = { kind: "rdv" } as const;
  assert.equal(dayCountText([]), "aucune séance ni rendez-vous");
  assert.equal(dayCountText([seance]), "1 séance");
  assert.equal(dayCountText([seance, seance]), "2 séances");
  assert.equal(dayCountText([rdv]), "1 rendez-vous");
  assert.equal(dayCountText([rdv, rdv, rdv]), "3 rendez-vous");
  assert.equal(dayCountText([seance, rdv]), "1 séance, 1 rendez-vous");
  assert.equal(dayCountText([seance, seance, rdv, rdv]), "2 séances, 2 rendez-vous");
  assert.doesNotMatch(dayCountText([seance, rdv]), NO_DASH);
});
