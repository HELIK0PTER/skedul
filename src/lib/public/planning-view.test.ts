import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, instantAt, type DateKey } from "@/lib/civil-date";

import { PUBLIC_STATE_LABELS, seatsLeftLabel } from "./messages";
import type { PublicSeance } from "./planning-reads";
import {
  groupByDay,
  parsePlanningParams,
  planningEmptyState,
  planningNav,
  seanceState,
  stateBadgeVariant,
  stateLabel,
  toPublicSeanceVM,
  type PublicSeanceState,
} from "./planning-view";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const NO_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const WINDOW = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };
const TYPE = { id: "t1", name: "Cours collectif", color: "#22c55e" };

/** One DST day per zone and per change: the spring gap and the autumn repeat. */
const ZONES: { tz: string; spring: DateKey; autumn: DateKey }[] = [
  { tz: PARIS, spring: "2026-03-29", autumn: "2026-10-25" },
  { tz: LA, spring: "2026-03-08", autumn: "2026-11-01" },
];

const at = (day: DateKey, minute: number, tz: string): Date => instantAt(day, minute, tz);

/** A séance of 60 minutes starting at `minute` of `day` (wall clock in tz), open to tickets by default. */
function seance(tz: string, day: DateKey, minute: number, over: Partial<PublicSeance> = {}): PublicSeance {
  const startsAt = at(day, minute, tz);
  return {
    occurrenceId: "o1",
    eventId: "e1",
    title: "Altinha débutants",
    color: "#6366f1",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    location: null,
    status: "scheduled",
    bookingMode: "tickets",
    capacity: 12,
    seatsLeft: 12,
    acceptedTypes: [TYPE],
    window: WINDOW,
    underTimeOff: false,
    ...over,
  };
}

const stateOf = (s: PublicSeance, now: Date, tz: string): PublicSeanceState => seanceState(s, now, tz);

test("seanceState: open, free, full and the three states a séance cannot be booked in", () => {
  for (const { tz, spring, autumn } of ZONES) {
    for (const day of [spring, autumn]) {
      const now = at(addDays(day, -1), 8 * 60, tz);
      const label = `${tz} ${day}`;
      assert.deepEqual(stateOf(seance(tz, day, 19 * 60), now, tz), { kind: "open", seatsLeft: 12 }, label);
      assert.deepEqual(
        stateOf(seance(tz, day, 19 * 60, { bookingMode: "free", acceptedTypes: [], seatsLeft: 5 }), now, tz),
        { kind: "free", seatsLeft: 5 },
        `${label}: a free séance needs no accepted type`,
      );
      assert.deepEqual(stateOf(seance(tz, day, 19 * 60, { seatsLeft: 0 }), now, tz), { kind: "full" }, label);
      assert.deepEqual(
        stateOf(seance(tz, day, 19 * 60, { bookingMode: "none", seatsLeft: 0 }), now, tz),
        { kind: "onsite" },
        label,
      );
    }
  }
});

test("seanceState: past and ongoing are read against the end, cancelled wins over both", () => {
  for (const { tz, spring, autumn } of ZONES) {
    for (const day of [spring, autumn]) {
      const s = seance(tz, day, 19 * 60);
      assert.deepEqual(stateOf(s, at(day, 19 * 60 + 30, tz), tz), { kind: "ongoing" }, `${tz} ${day} during`);
      assert.deepEqual(stateOf(s, s.startsAt, tz), { kind: "ongoing" }, "it has started at its start");
      assert.deepEqual(stateOf(s, s.endsAt, tz), { kind: "past" }, "it is over at its end");
      assert.deepEqual(stateOf(s, at(day, 21 * 60, tz), tz), { kind: "past" }, `${tz} ${day} after`);
      const cancelled = seance(tz, day, 19 * 60, { status: "cancelled" });
      for (const now of [at(addDays(day, -1), 8 * 60, tz), at(day, 19 * 60 + 30, tz), at(day, 21 * 60, tz)]) {
        assert.deepEqual(stateOf(cancelled, now, tz), { kind: "cancelled" }, "cancelled comes first");
      }
    }
  }
});

test("seanceState: the horizon is a local date, the notice an elapsed time", () => {
  for (const { tz, spring, autumn } of ZONES) {
    for (const day of [spring, autumn]) {
      const now = at(addDays(day, -1), 8 * 60, tz);
      const label = `${tz} ${day}`;
      // today = day - 1, horizon 2 days: the last bookable local date is day + 1.
      const near: Partial<PublicSeance> = { window: { ...WINDOW, bookingHorizonDays: 2 } };
      assert.deepEqual(stateOf(seance(tz, addDays(day, 1), 23 * 60 + 30, near), now, tz), { kind: "open", seatsLeft: 12 }, label);
      assert.deepEqual(stateOf(seance(tz, addDays(day, 2), 0, near), now, tz), { kind: "notYet" }, `${label}: one minute past the last date`);
      // 7 hours before the start with a 10 hour notice: closed.
      const late = at(day, 12 * 60, tz);
      assert.deepEqual(
        stateOf(seance(tz, day, 19 * 60, { window: { ...WINDOW, minNoticeMinutes: 10 * 60 } }), late, tz),
        { kind: "closed" },
        label,
      );
    }
  }
});

test("seanceState: closed for a time off or a tickets séance nobody accepts, and the precedence of the states", () => {
  const { tz, spring: day } = ZONES[0];
  const now = at(addDays(day, -1), 8 * 60, tz);
  const base = seance(tz, day, 19 * 60);
  assert.deepEqual(stateOf({ ...base, underTimeOff: true }, now, tz), { kind: "closed" });
  assert.deepEqual(stateOf({ ...base, acceptedTypes: [] }, now, tz), { kind: "closed" });
  assert.deepEqual(stateOf({ ...base, bookingMode: "free", acceptedTypes: [], underTimeOff: true }, now, tz), { kind: "closed" });
  // closed before full
  assert.deepEqual(stateOf({ ...base, underTimeOff: true, seatsLeft: 0 }, now, tz), { kind: "closed" });
  assert.deepEqual(stateOf({ ...base, acceptedTypes: [], seatsLeft: 0 }, now, tz), { kind: "closed" });
  // onsite before notYet and closed
  const far = seance(tz, addDays(day, 90), 19 * 60, { bookingMode: "none", underTimeOff: true });
  assert.deepEqual(stateOf(far, now, tz), { kind: "onsite" });
  // notYet before closed
  assert.deepEqual(stateOf({ ...far, bookingMode: "tickets", acceptedTypes: [] }, now, tz), { kind: "notYet" });
  // past before onsite
  assert.deepEqual(stateOf({ ...base, bookingMode: "none" }, at(day, 21 * 60, tz), tz), { kind: "past" });
});

test("stateLabel is the public label of the state, null for open", () => {
  const states: PublicSeanceState[] = [
    { kind: "cancelled" },
    { kind: "past" },
    { kind: "ongoing" },
    { kind: "onsite" },
    { kind: "notYet" },
    { kind: "closed" },
    { kind: "full" },
    { kind: "free", seatsLeft: 3 },
  ];
  assert.deepEqual(
    states.map(stateLabel),
    ["Annulée", "Terminée", "En cours", "Sur place", "Réservations pas encore ouvertes", "Réservations fermées", "Complet", "Inscription libre"],
  );
  assert.equal(stateLabel({ kind: "open", seatsLeft: 3 }), null);
  for (const state of states) assert.equal(stateLabel(state), PUBLIC_STATE_LABELS[state.kind as keyof typeof PUBLIC_STATE_LABELS]);
});

test("stateBadgeVariant: one colour per state, whoever draws the label (the planning row and the séance page, G4c)", () => {
  const kinds: PublicSeanceState["kind"][] = ["cancelled", "past", "ongoing", "onsite", "notYet", "closed", "full", "free", "open"];
  assert.deepEqual(
    kinds.map((kind) => [kind, stateBadgeVariant(kind)]),
    [
      ["cancelled", "destructive"],
      ["past", "neutral"],
      ["ongoing", "neutral"],
      ["onsite", "neutral"],
      ["notYet", "neutral"],
      ["closed", "neutral"],
      ["full", "neutral"],
      ["free", "success"],
      ["open", "neutral"],
    ],
  );
});

test("a row carries the kind of its state, so its badge colour never depends on the wording of its label", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const day = "2026-10-12";
  const kindOf = (over: Partial<PublicSeance>) => toPublicSeanceVM(seance(PARIS, day, 19 * 60, over), "s", now, PARIS).stateKind;
  assert.equal(kindOf({}), "open");
  assert.equal(kindOf({ bookingMode: "free" }), "free");
  assert.equal(kindOf({ status: "cancelled" }), "cancelled");
  assert.equal(kindOf({ seatsLeft: 0 }), "full");
  assert.equal(stateBadgeVariant(kindOf({ bookingMode: "free" })), "success", "« Inscription libre » is the one good news");
});

test("toPublicSeanceVM: the row of an open séance in Paris", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const s = seance(PARIS, "2026-10-12", 19 * 60, { location: "Gymnase Jean Bouin" });
  const vm = toPublicSeanceVM(s, "altinha-paris", now, PARIS);
  assert.deepEqual(vm, {
    occurrenceId: "o1",
    href: "/altinha-paris/seance/o1",
    title: "Altinha débutants",
    color: "#6366f1",
    dayKey: "2026-10-12",
    timeLabel: "19:00 à 20:00",
    location: "Gymnase Jean Bouin",
    stateText: null,
    stateKind: "open",
    seatsText: seatsLeftLabel(12),
    muted: false,
    badges: [{ name: "Cours collectif", color: "#22c55e" }],
    ariaLabel: "Altinha débutants, lundi 12 octobre 19:00 à 20:00, 12 places restantes",
  });
});

test("toPublicSeanceVM: state text, seats text, muted and the accessible name per state", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const row = (over: Partial<PublicSeance>) => toPublicSeanceVM(seance(PARIS, "2026-10-12", 19 * 60, over), "altinha-paris", now, PARIS);

  const cancelled = row({ status: "cancelled" });
  assert.deepEqual([cancelled.stateText, cancelled.seatsText, cancelled.muted], ["Annulée", null, true]);
  assert.equal(cancelled.ariaLabel, "Altinha débutants, lundi 12 octobre 19:00 à 20:00, Annulée");

  const free = row({ bookingMode: "free", acceptedTypes: [], seatsLeft: 5 });
  assert.deepEqual([free.stateText, free.seatsText, free.muted, free.badges], ["Inscription libre", "5 places restantes", false, []]);
  assert.equal(
    free.ariaLabel,
    "Altinha débutants, lundi 12 octobre 19:00 à 20:00, Inscription libre, 5 places restantes",
    "a free séance names both its state and its seats (G4a)",
  );

  const one = row({ seatsLeft: 1 });
  assert.equal(one.seatsText, "1 place restante");

  const full = row({ seatsLeft: 0 });
  assert.deepEqual([full.stateText, full.seatsText, full.muted], ["Complet", null, true]);
  const closed = row({ underTimeOff: true });
  assert.deepEqual([closed.stateText, closed.muted], ["Réservations fermées", true]);
  const onsite = row({ bookingMode: "none", acceptedTypes: [] });
  assert.deepEqual([onsite.stateText, onsite.muted], ["Sur place", false]);

  const ongoing = toPublicSeanceVM(seance(PARIS, "2026-10-12", 19 * 60), "altinha-paris", at("2026-10-12", 19 * 60 + 10, PARIS), PARIS);
  assert.deepEqual([ongoing.stateText, ongoing.muted], ["En cours", false]);
  const past = toPublicSeanceVM(seance(PARIS, "2026-10-12", 19 * 60), "altinha-paris", at("2026-10-12", 21 * 60, PARIS), PARIS);
  assert.deepEqual([past.stateText, past.muted], ["Terminée", true]);
  const notYet = toPublicSeanceVM(seance(PARIS, "2026-12-30", 19 * 60), "altinha-paris", now, PARIS);
  assert.deepEqual([notYet.stateText, notYet.muted], ["Réservations pas encore ouvertes", false]);

  const lastOne = row({ bookingMode: "free", acceptedTypes: [], seatsLeft: 1 });
  assert.equal(lastOne.ariaLabel, "Altinha débutants, lundi 12 octobre 19:00 à 20:00, Inscription libre, 1 place restante");
  // The other states keep COV-M12's rule: the state text alone, or the seats text alone for an open séance.
  assert.equal(full.ariaLabel, "Altinha débutants, lundi 12 octobre 19:00 à 20:00, Complet");
  assert.equal(one.ariaLabel, "Altinha débutants, lundi 12 octobre 19:00 à 20:00, 1 place restante");

  for (const vm of [cancelled, free, lastOne, one, full, closed, onsite, ongoing, past, notYet]) {
    assert.equal(NO_DASH.test(vm.ariaLabel), false, vm.ariaLabel);
    assert.ok(vm.ariaLabel.startsWith("Altinha débutants, "), vm.ariaLabel);
  }
});

test("toPublicSeanceVM: the day and the time are the pro's wall clock, in both zones, on both DST days", () => {
  for (const { tz, spring, autumn } of ZONES) {
    const now = at(addDays(spring, -3), 8 * 60, tz);
    // 19:00 on the day of each change: the offset differs from the day before, the label does not.
    for (const day of [spring, autumn]) {
      const s = seance(tz, day, 19 * 60);
      const vm = toPublicSeanceVM(s, "altinha-paris", day === autumn ? at(addDays(day, -3), 8 * 60, tz) : now, tz);
      assert.equal(vm.dayKey, day, `${tz} ${day}`);
      assert.equal(vm.timeLabel, "19:00 à 20:00", `${tz} ${day}`);
    }
    // 01:30 for 60 minutes across the spring gap reads 01:30 à 03:30.
    const gap = toPublicSeanceVM(seance(tz, spring, 90), "altinha-paris", now, tz);
    assert.equal(gap.dayKey, spring);
    assert.equal(gap.timeLabel, "01:30 à 03:30", `${tz} across the gap`);
  }
  // 19:00 in Los Angeles is the next day in Paris: the zone argument decides the day.
  const la = seance(LA, "2026-10-12", 19 * 60);
  const now = new Date("2026-10-10T10:00:00Z");
  assert.equal(toPublicSeanceVM(la, "altinha-paris", now, LA).dayKey, "2026-10-12");
  assert.equal(toPublicSeanceVM(la, "altinha-paris", now, PARIS).dayKey, "2026-10-13");
});

test("toPublicSeanceVM: the first of a month is written 1er in the accessible name", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const vm = toPublicSeanceVM(seance(LA, "2026-11-01", 10 * 60), "altinha-paris", now, LA);
  assert.equal(vm.ariaLabel, "Altinha débutants, dimanche 1er novembre 10:00 à 11:00, 12 places restantes");
});

test("groupByDay keeps every day of the week, empty ones included, in order", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const week = Array.from({ length: 7 }, (_, i) => addDays("2026-10-12", i));
  const make = (id: string, day: DateKey, minute: number) =>
    toPublicSeanceVM(seance(PARIS, day, minute, { occurrenceId: id }), "altinha-paris", now, PARIS);
  const vms = [make("a", "2026-10-13", 10 * 60), make("b", "2026-10-13", 19 * 60), make("c", "2026-10-15", 19 * 60), make("out", "2026-10-26", 19 * 60)];
  const days = groupByDay(vms, week);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.dayKey), week);
  assert.deepEqual(days.map((d) => d.label), [
    "lundi 12 octobre",
    "mardi 13 octobre",
    "mercredi 14 octobre",
    "jeudi 15 octobre",
    "vendredi 16 octobre",
    "samedi 17 octobre",
    "dimanche 18 octobre",
  ]);
  assert.deepEqual(days.map((d) => d.seances.map((s) => s.occurrenceId)), [[], ["a", "b"], [], ["c"], [], [], []]);
  assert.deepEqual(groupByDay([], week).map((d) => d.seances.length), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(groupByDay(vms, []), []);
});

test("parsePlanningParams: a valid ?semaine= and ?vue=semaine, everything else falls back", () => {
  assert.deepEqual(parsePlanningParams({}), { semaine: undefined, view: "liste" });
  assert.deepEqual(parsePlanningParams({ semaine: "2026-10-12", vue: "semaine" }), { semaine: "2026-10-12", view: "semaine" });
  assert.deepEqual(parsePlanningParams({ semaine: "2026-10-14", vue: "liste" }), { semaine: "2026-10-14", view: "liste" });
  for (const bad of ["2026-13-01", "2026-02-30", "abc", "", "2026-1-5", "2026-10-12 ", "1999-12-27", "2101-01-04", "<script>"]) {
    assert.equal(parsePlanningParams({ semaine: bad }).semaine, undefined, JSON.stringify(bad));
  }
  assert.equal(parsePlanningParams({ vue: "Semaine" }).view, "liste");
  assert.equal(parsePlanningParams({ vue: "grille" }).view, "liste");
  // A repeated parameter counts by its first value.
  assert.deepEqual(parsePlanningParams({ semaine: ["2026-10-12", "x"], vue: ["semaine", "liste"] }), { semaine: "2026-10-12", view: "semaine" });
  assert.deepEqual(parsePlanningParams({ semaine: ["x", "2026-10-12"], vue: [] }), { semaine: undefined, view: "liste" });
});

test("planningNav: the current week has no previous link, the hrefs keep the view", () => {
  const nav = planningNav({ slug: "altinha-paris", weekKey: "2026-10-12", view: "liste", todayKey: "2026-10-14" });
  assert.deepEqual(nav, {
    weekKey: "2026-10-12",
    title: "12 au 18 octobre 2026",
    prevHref: null,
    nextHref: "/altinha-paris?semaine=2026-10-19",
    listHref: "/altinha-paris?semaine=2026-10-12",
    weekHref: "/altinha-paris?semaine=2026-10-12&vue=semaine",
  });
  const later = planningNav({ slug: "altinha-paris", weekKey: "2026-10-19", view: "semaine", todayKey: "2026-10-14" });
  assert.equal(later.prevHref, "/altinha-paris?semaine=2026-10-12&vue=semaine");
  assert.equal(later.nextHref, "/altinha-paris?semaine=2026-10-26&vue=semaine");
  assert.equal(later.listHref, "/altinha-paris?semaine=2026-10-19");
  assert.equal(later.weekHref, "/altinha-paris?semaine=2026-10-19&vue=semaine");
});

test("planningNav: any day of a week names its Monday, a past week cannot go further back", () => {
  const wednesday = planningNav({ slug: "altinha-paris", weekKey: "2026-10-14", view: "liste", todayKey: "2026-10-14" });
  assert.equal(wednesday.weekKey, "2026-10-12");
  assert.equal(wednesday.title, "12 au 18 octobre 2026");
  const past = planningNav({ slug: "altinha-paris", weekKey: "2026-10-05", view: "liste", todayKey: "2026-10-14" });
  assert.equal(past.prevHref, null);
  assert.equal(past.nextHref, "/altinha-paris?semaine=2026-10-12");
});

test("planningNav: next stops when the next week starts past today + 365 days", () => {
  // today is a Sunday: today + 365 is the Monday 2027-10-11.
  const last = planningNav({ slug: "altinha-paris", weekKey: "2027-10-04", view: "liste", todayKey: "2026-10-11" });
  assert.equal(last.nextHref, "/altinha-paris?semaine=2027-10-11", "the next Monday is the last listable day");
  const after = planningNav({ slug: "altinha-paris", weekKey: "2027-10-11", view: "liste", todayKey: "2026-10-11" });
  assert.equal(after.nextHref, null);
  assert.equal(after.prevHref, "/altinha-paris?semaine=2027-10-04");
});

test("planningNav: the title crosses the year", () => {
  const nav = planningNav({ slug: "altinha-paris", weekKey: "2026-12-28", view: "liste", todayKey: "2026-10-14" });
  assert.equal(nav.title, "28 décembre 2026 au 3 janvier 2027");
  assert.equal(planningNav({ slug: "altinha-paris", weekKey: "2026-10-26", view: "liste", todayKey: "2026-10-14" }).title, "26 octobre au 1er novembre 2026");
});

test("planningEmptyState: a week with séances is not empty", () => {
  assert.deepEqual(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: PARIS, shown: 3, nextStart: null, anyStart: null }),
    { empty: null, nextWeekHref: null },
  );
});

test("planningEmptyState: an empty week points to the week of the next séance, in the pro's zone", () => {
  const next = at("2026-10-21", 19 * 60, PARIS);
  assert.deepEqual(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: PARIS, shown: 0, nextStart: next, anyStart: null }),
    { empty: "week", nextWeekHref: "/altinha-paris?semaine=2026-10-19" },
  );
  assert.deepEqual(
    planningEmptyState({ slug: "altinha-paris", view: "semaine", tz: PARIS, shown: 0, nextStart: next, anyStart: null }),
    { empty: "week", nextWeekHref: "/altinha-paris?semaine=2026-10-19&vue=semaine" },
  );
  // Sunday 23:30 in Los Angeles is already Monday in Paris: the Monday is the pro's.
  const sunday = at("2026-11-01", 23 * 60 + 30, LA);
  assert.equal(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: LA, shown: 0, nextStart: sunday, anyStart: null }).nextWeekHref,
    "/altinha-paris?semaine=2026-10-26",
  );
  assert.equal(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: PARIS, shown: 0, nextStart: sunday, anyStart: null }).nextWeekHref,
    "/altinha-paris?semaine=2026-11-02",
  );
});

test("planningEmptyState: nothing after the week, an earlier séance keeps it a week, none at all is all", () => {
  assert.deepEqual(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: PARIS, shown: 0, nextStart: null, anyStart: at("2026-10-14", 19 * 60, PARIS) }),
    { empty: "week", nextWeekHref: null },
  );
  assert.deepEqual(
    planningEmptyState({ slug: "altinha-paris", view: "liste", tz: PARIS, shown: 0, nextStart: null, anyStart: null }),
    { empty: "all", nextWeekHref: null },
  );
});
