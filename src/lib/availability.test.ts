/**
 * The RDV slot generator (P5 Task 3, dossier § 3.4 and § 5 T3). Every instant here is spelled in UTC or built
 * with `instantAt` in an explicit zone, so the file passes under any host zone: run it with PowerShell
 * `$env:TZ = "America/Los_Angeles"`, `"Europe/Paris"` and `"Asia/Tokyo"` (never Git Bash `TZ=`).
 * DST days: Paris 2026-03-29 and 2026-10-25, Los Angeles 2026-03-08 and 2026-11-01.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { computeSlots, gridStartsOfDay, isGridStart, type BusyInterval, type RdvRule } from "./availability";
import { fitsAvailability, lastBookableDate, onlineBookability, type BookingWindow } from "./booking-window";
import { addDays, dayOfWeek, instantAt, todayKey, type DateKey } from "./civil-date";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const ZONES = [PARIS, LA] as const;

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (iso: string): Date => new Date(iso);
const isos = (dates: readonly Date[]): string[] => dates.map((d) => d.toISOString());
const startsOf = (slots: readonly { start: Date }[]): string[] => slots.map((s) => s.start.toISOString());
const endsOf = (slots: readonly { end: Date }[]): string[] => slots.map((s) => s.end.toISOString());
const window = (over: Partial<BookingWindow> = {}): BookingWindow => ({
  bookingHorizonDays: 60,
  minNoticeMinutes: 0,
  cancelDeadlineHours: 24,
  ...over,
});
/** One rule on the weekday of `key`. */
const ruleOn = (key: DateKey, startMinute: number, endMinute: number): RdvRule => ({ dayOfWeek: dayOfWeek(key), startMinute, endMinute });
/** The same hours every day of the week. */
const everyDay = (startMinute: number, endMinute: number): RdvRule[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute, endMinute }));

type Args = Parameters<typeof computeSlots>[0];
function slots(over: Partial<Args> & Pick<Args, "rules" | "tz" | "fromKey" | "toKey" | "now">): ReturnType<typeof computeSlots> {
  return computeSlots({ busy: [], durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, window: window(), ...over });
}

/* ───────────────────────── DST days: elapsed ends, gaps, repeated hours ───────────────────────── */

const DST_CASES = [
  {
    name: "Paris fall-back 2026-10-25 (02:00 CEST is followed by 02:00 CET)",
    tz: PARIS,
    key: "2026-10-25",
    rule: { start: 60, end: 240 }, // 01:00-04:00
    starts: ["2026-10-24T23:00:00.000Z", "2026-10-25T00:00:00.000Z", "2026-10-25T02:00:00.000Z"],
    ends: ["2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z", "2026-10-25T03:00:00.000Z"],
    // the second pass of the repeated hour (02:00-03:00 CET) holds a séance: the first-instant slot stays
    repeated: { start: "2026-10-25T01:30:00.000Z", end: "2026-10-25T02:00:00.000Z" },
  },
  {
    name: "Los Angeles fall-back 2026-11-01 (01:00 PDT is followed by 01:00 PST)",
    tz: LA,
    key: "2026-11-01",
    rule: { start: 0, end: 180 }, // 00:00-03:00
    starts: ["2026-11-01T07:00:00.000Z", "2026-11-01T08:00:00.000Z", "2026-11-01T10:00:00.000Z"],
    ends: ["2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z", "2026-11-01T11:00:00.000Z"],
    repeated: { start: "2026-11-01T09:30:00.000Z", end: "2026-11-01T10:00:00.000Z" },
  },
  {
    name: "Paris spring-forward 2026-03-29 (02:00 CET jumps to 03:00 CEST)",
    tz: PARIS,
    key: "2026-03-29",
    rule: { start: 60, end: 240 }, // 01:00-04:00: 02:00 shifts to 03:00 CEST, the same instant as 03:00, deduped
    starts: ["2026-03-29T00:00:00.000Z", "2026-03-29T01:00:00.000Z"],
    ends: ["2026-03-29T01:00:00.000Z", "2026-03-29T02:00:00.000Z"],
    repeated: null,
  },
  {
    name: "Los Angeles spring-forward 2026-03-08 (02:00 PST jumps to 03:00 PDT)",
    tz: LA,
    key: "2026-03-08",
    rule: { start: 60, end: 240 },
    starts: ["2026-03-08T09:00:00.000Z", "2026-03-08T10:00:00.000Z"],
    ends: ["2026-03-08T10:00:00.000Z", "2026-03-08T11:00:00.000Z"],
    repeated: null,
  },
] as const;

for (const c of DST_CASES) {
  const rules = [ruleOn(c.key, c.rule.start, c.rule.end)];
  const now = instantAt(addDays(c.key, -5), 600, c.tz);

  test(`${c.name}: the grid and its elapsed ends`, () => {
    assert.deepEqual(isos(gridStartsOfDay({ rules, durationMin: 60, tz: c.tz, key: c.key })), [...c.starts]);
    const day = slots({ rules, tz: c.tz, fromKey: c.key, toKey: c.key, now });
    assert.deepEqual(startsOf(day), [...c.starts]);
    assert.deepEqual(endsOf(day), [...c.ends]);
    for (const s of day) assert.equal(s.end.getTime() - s.start.getTime(), HOUR, "an RDV of 60 minutes lasts 60 elapsed minutes");
  });

  if (c.repeated) {
    const repeated = c.repeated;
    test(`${c.name}: no start in the repeated hour, and a séance there does not hide the first-instant slot`, () => {
      const busy: BusyInterval[] = [{ start: at(repeated.start), end: at(repeated.end) }];
      assert.deepEqual(startsOf(slots({ rules, busy, tz: c.tz, fromKey: c.key, toKey: c.key, now })), [...c.starts]);
      // the first-instant slot really is one hour long: a séance inside that hour hides it
      const inside: BusyInterval[] = [{ start: new Date(at(c.starts[1]).getTime() + 30 * MIN), end: at(c.ends[1]) }];
      assert.equal(startsOf(slots({ rules, busy: inside, tz: c.tz, fromKey: c.key, toKey: c.key, now })).includes(c.starts[1]), false);
    });
  } else {
    test(`${c.name}: a shifted gap start whose elapsed end overruns its rule is refused`, () => {
      // 01:00-03:30: the start shifted past the gap would end at 04:00 local, after the rule
      const short = [ruleOn(c.key, 60, 210)];
      assert.deepEqual(isos(gridStartsOfDay({ rules: short, durationMin: 60, tz: c.tz, key: c.key })), [c.starts[0]]);
      assert.deepEqual(startsOf(slots({ rules: short, tz: c.tz, fromKey: c.key, toKey: c.key, now })), [c.starts[0]]);
    });
  }
}

test("isGridStart on DST days: the shifted gap start is on the grid, a wall time inside the gap or the repeated hour is not", () => {
  const paris = [ruleOn("2026-03-29", 60, 240)];
  assert.equal(isGridStart({ rules: paris, durationMin: 60, tz: PARIS, startsAt: at("2026-03-29T01:00:00.000Z") }), true);
  // « 02:30 » on the gap day resolves to 03:30 CEST = 01:30Z: not a grid start
  assert.equal(isGridStart({ rules: paris, durationMin: 60, tz: PARIS, startsAt: instantAt("2026-03-29", 150, PARIS) }), false);
  const la = [ruleOn("2026-03-08", 60, 240)];
  assert.equal(isGridStart({ rules: la, durationMin: 60, tz: LA, startsAt: at("2026-03-08T10:00:00.000Z") }), true);
  assert.equal(isGridStart({ rules: la, durationMin: 60, tz: LA, startsAt: instantAt("2026-03-08", 150, LA) }), false);
  // the second 02:00 of Paris (02:00 CET = 01:00Z) and the second 01:00 of Los Angeles (01:00 PST = 09:00Z)
  assert.equal(isGridStart({ rules: [ruleOn("2026-10-25", 60, 240)], durationMin: 60, tz: PARIS, startsAt: at("2026-10-25T01:00:00.000Z") }), false);
  assert.equal(isGridStart({ rules: [ruleOn("2026-11-01", 0, 180)], durationMin: 60, tz: LA, startsAt: at("2026-11-01T09:00:00.000Z") }), false);
});

/* ───────────────────────── The 7 local days of a DST week ───────────────────────── */

const WEEKS = [
  { name: "Paris spring week (167 h)", tz: PARIS, monday: "2026-03-23", hours: 167, slots: 167 },
  { name: "Paris fall week (169 h)", tz: PARIS, monday: "2026-10-19", hours: 169, slots: 168 },
  { name: "Los Angeles spring week (167 h)", tz: LA, monday: "2026-03-02", hours: 167, slots: 167 },
  { name: "Los Angeles fall week (169 h)", tz: LA, monday: "2026-10-26", hours: 169, slots: 168 },
] as const;

for (const w of WEEKS) {
  test(`${w.name}: every local day once, one slot per elapsed hour, the repeated hour offers none`, () => {
    const sunday = addDays(w.monday, 6);
    const week = slots({ rules: everyDay(0, 1440), tz: w.tz, fromKey: w.monday, toKey: sunday, now: instantAt(addDays(w.monday, -3), 0, w.tz) });
    const first = instantAt(w.monday, 0, w.tz);
    const last = instantAt(addDays(sunday, 1), 0, w.tz);
    assert.equal((last.getTime() - first.getTime()) / HOUR, w.hours, "the week's length in elapsed hours");
    assert.equal(week.length, w.slots);
    assert.equal(week[0].start.getTime(), first.getTime());
    assert.equal(week[week.length - 1].end.getTime(), last.getTime(), "the last slot ends at the next local midnight");
    const days = [...new Set(week.map((s) => todayKey(s.start, w.tz)))];
    assert.deepEqual(days, [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(w.monday, n)));
    // contiguous, except the repeated hour of a fall week
    const holes = week.slice(1).filter((s, i) => s.start.getTime() !== week[i].end.getTime()).length;
    assert.equal(holes, w.hours - w.slots);
  });
}

/* ───────────────────────── Window: horizon by local date, notice, past ───────────────────────── */

test("Paris: the horizon is inclusive by local date (23:30 on the last day is in, 00:00 the next day is out)", () => {
  const now = at("2026-07-01T08:00:00.000Z"); // Wed 10:00 Paris
  const rules = [...everyDay(0, 60), ...everyDay(1380, 1440)];
  const out = slots({ rules, durationMin: 30, tz: PARIS, fromKey: "2026-07-01", toKey: "2026-07-07", now, window: window({ bookingHorizonDays: 2 }) });
  assert.equal(lastBookableDate(now, PARIS, 2), "2026-07-03");
  assert.equal(out[out.length - 1].start.toISOString(), "2026-07-03T21:30:00.000Z"); // 23:30 Paris on the last day
  assert.equal(out.some((s) => s.start.getTime() >= at("2026-07-03T22:00:00.000Z").getTime()), false);
});

test("Los Angeles: 17:00 PDT on the last day (00:00Z the next UTC day) stays in, the next local day is out", () => {
  const now = at("2026-07-01T17:00:00.000Z"); // Wed 10:00 PDT
  const out = slots({ rules: everyDay(960, 1080), tz: LA, fromKey: "2026-07-01", toKey: "2026-07-07", now, window: window({ bookingHorizonDays: 2 }) });
  assert.equal(out[out.length - 1].start.toISOString(), "2026-07-04T00:00:00.000Z"); // Fri 3 Jul 17:00 PDT
  assert.equal(out.some((s) => todayKey(s.start, LA) === "2026-07-04"), false);
});

for (const tz of ZONES) {
  test(`${tz}: notice 0 at now (a start equal to now is past), and the notice boundary to the millisecond`, () => {
    const key = "2026-07-08";
    const rules = [ruleOn(key, 600, 720)]; // 10:00-12:00
    const ten = instantAt(key, 600, tz);
    const eleven = instantAt(key, 660, tz);
    const run = (now: Date, minNoticeMinutes: number) =>
      startsOf(slots({ rules, tz, fromKey: key, toKey: key, now, window: window({ minNoticeMinutes }) }));
    assert.deepEqual(run(ten, 0), [eleven.toISOString()], "start <= now is excluded");
    assert.deepEqual(run(new Date(ten.getTime() - 1), 0), [ten.toISOString(), eleven.toISOString()]);
    assert.deepEqual(run(new Date(ten.getTime() - HOUR), 60), [ten.toISOString(), eleven.toISOString()], "now + notice == start is bookable");
    assert.deepEqual(run(new Date(ten.getTime() - HOUR + 1), 60), [eleven.toISOString()]);
  });

  test(`${tz}: the dates are bounded by today and the horizon first (a past week or a far week generates nothing)`, () => {
    const now = instantAt("2026-07-08", 600, tz);
    const rules = everyDay(540, 1080);
    // yesterday and earlier are never walked; today keeps only what is after now
    const out = slots({ rules, tz, fromKey: "2026-07-01", toKey: "2026-07-08", now });
    assert.ok(out.length > 0);
    assert.ok(out.every((s) => todayKey(s.start, tz) === "2026-07-08" && s.start.getTime() > now.getTime()));
    assert.deepEqual(slots({ rules, tz, fromKey: "2026-06-29", toKey: "2026-07-05", now }), []);
    // a week past the horizon (60 days here)
    assert.deepEqual(slots({ rules, tz, fromKey: "2026-09-07", toKey: "2026-09-13", now }), []);
    // the horizon's last day is still walked
    const edge = slots({ rules, tz, fromKey: "2026-09-06", toKey: "2026-09-12", now });
    assert.deepEqual([...new Set(edge.map((s) => todayKey(s.start, tz)))], ["2026-09-06"]);
  });
}

/* ───────────────────────── Busy intervals and buffers ───────────────────────── */

for (const tz of ZONES) {
  const key = "2026-07-08";
  const rules = [ruleOn(key, 480, 840)]; // 08:00-14:00
  const now = instantAt("2026-07-01", 600, tz);
  const ten = instantAt(key, 600, tz); // the candidate 10:00-11:00
  const eleven = instantAt(key, 660, tz);
  const has10 = (busy: BusyInterval[], bufferBeforeMin: number, bufferAfterMin: number): boolean =>
    startsOf(slots({ rules, busy, bufferBeforeMin, bufferAfterMin, tz, fromKey: key, toKey: key, now })).includes(ten.toISOString());
  const range = (from: number, to: number): BusyInterval => ({ start: new Date(from), end: new Date(to) });
  const t10 = ten.getTime();
  const t11 = eleven.getTime();

  test(`${tz}: buffers 15/15: touching blocks are allowed, a one-minute overlap is refused`, () => {
    assert.equal(has10([range(t10 - 75 * MIN, t10 - 15 * MIN)], 15, 15), true, "ends where the block starts");
    assert.equal(has10([range(t10 - 75 * MIN, t10 - 14 * MIN)], 15, 15), false, "one minute into the block");
    assert.equal(has10([range(t11 + 15 * MIN, t11 + 60 * MIN)], 15, 15), true, "starts where the block ends");
    assert.equal(has10([range(t11 + 14 * MIN, t11 + 60 * MIN)], 15, 15), false);
    assert.equal(has10([range(t10 - 75 * MIN, t10 - 15 * MIN + 1)], 15, 15), false, "one millisecond is an overlap too");
  });

  test(`${tz}: the candidate's own buffers apply on their own side, against another RDV's stored block`, () => {
    // another RDV 11:15-11:45 with 15 minutes before: its stored block is 11:00-11:45
    const otherRdv = range(t11, t11 + 45 * MIN);
    assert.equal(has10([otherRdv], 0, 0), true, "the blocks only touch");
    assert.equal(has10([otherRdv], 30, 0), true, "a buffer before never reaches a later block");
    assert.equal(has10([otherRdv], 0, 1), false, "one minute after is enough to overlap");
    // a séance 09:30-10:00 just before
    const before = range(t10 - 30 * MIN, t10);
    assert.equal(has10([before], 0, 30), true);
    assert.equal(has10([before], 30, 0), false);
  });

  test(`${tz}: an all-day time off removes that day's slots only`, () => {
    const next = addDays(key, 1);
    const both = [ruleOn(key, 540, 660), ruleOn(next, 540, 660)];
    const off = range(instantAt(key, 0, tz).getTime(), instantAt(addDays(key, 1), 0, tz).getTime());
    assert.equal(slots({ rules: both, tz, fromKey: key, toKey: next, now }).length, 4);
    const left = slots({ rules: both, busy: [off], tz, fromKey: key, toKey: next, now });
    assert.deepEqual(left.map((s) => todayKey(s.start, tz)), [next, next]);
  });
}

/* ───────────────────────── Rule shapes ───────────────────────── */

for (const tz of ZONES) {
  const key = "2026-07-08";
  const grid = (rules: RdvRule[], durationMin = 60): string[] => isos(gridStartsOfDay({ rules, durationMin, tz, key }));
  const local = (...minutes: number[]): string[] => minutes.map((m) => instantAt(key, m, tz).toISOString());

  test(`${tz}: overlapping stored rules are deduped, each anchored at its own start, sorted`, () => {
    assert.deepEqual(grid([ruleOn(key, 540, 720), ruleOn(key, 600, 720)]), local(540, 600, 660));
    assert.deepEqual(grid([ruleOn(key, 570, 690), ruleOn(key, 540, 660)]), local(540, 570, 600, 630));
  });

  test(`${tz}: a rule ending at 24:00, and a duration that does not divide the rule`, () => {
    assert.deepEqual(grid([ruleOn(key, 1320, 1440)]), local(1320, 1380));
    const lateSlots = slots({ rules: [ruleOn(key, 1320, 1440)], tz, fromKey: key, toKey: key, now: instantAt("2026-07-01", 0, tz) });
    assert.equal(lateSlots[1].end.getTime(), instantAt(addDays(key, 1), 0, tz).getTime());
    assert.deepEqual(grid([ruleOn(key, 540, 630)]), local(540));
    assert.deepEqual(grid([ruleOn(key, 540, 660)], 45), local(540, 585));
  });

  test(`${tz}: rules of other weekdays, and rules the generator cannot walk, give nothing`, () => {
    const other: RdvRule = { dayOfWeek: (dayOfWeek(key) + 1) % 7, startMinute: 540, endMinute: 660 };
    assert.deepEqual(grid([other]), []);
    for (const bad of [
      { startMinute: 600, endMinute: 600 },
      { startMinute: 660, endMinute: 600 },
      { startMinute: -60, endMinute: 600 },
      { startMinute: 540, endMinute: 1500 },
      { startMinute: 540.5, endMinute: 660 },
    ]) {
      assert.deepEqual(grid([{ dayOfWeek: dayOfWeek(key), ...bad }]), [], JSON.stringify(bad));
    }
  });
}

test("a duration that is not a positive whole number of minutes yields nothing (no endless loop)", () => {
  const key = "2026-07-08";
  const rules = [ruleOn(key, 540, 660)];
  for (const durationMin of [0, -60, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(slots({ rules, durationMin, tz: PARIS, fromKey: key, toKey: key, now: at("2026-07-01T00:00:00.000Z") }), []);
    assert.deepEqual(gridStartsOfDay({ rules, durationMin, tz: PARIS, key }), []);
    assert.equal(isGridStart({ rules, durationMin, tz: PARIS, startsAt: instantAt(key, 540, PARIS) }), false);
  }
});

/* ───────────────────────── The P0 day-walk checks, kept ───────────────────────── */

test("Paris: at 23:30 the night before spring-forward, Sunday is not skipped", () => {
  const out = slots({ rules: [ruleOn("2026-03-29", 540, 600)], tz: PARIS, fromKey: "2026-03-28", toKey: "2026-03-29", now: at("2026-03-28T22:30:00.000Z") });
  assert.deepEqual(startsOf(out), ["2026-03-29T07:00:00.000Z"]); // Sun 09:00 CEST
});

test("Paris: just after midnight on fall-back Sunday, Monday is still walked", () => {
  const rules = [ruleOn("2026-10-25", 540, 600), ruleOn("2026-10-26", 540, 600)];
  const out = slots({ rules, tz: PARIS, fromKey: "2026-10-25", toKey: "2026-10-26", now: at("2026-10-24T22:30:00.000Z") });
  assert.deepEqual(startsOf(out), ["2026-10-25T08:00:00.000Z", "2026-10-26T08:00:00.000Z"]); // 09:00 CET
});

test("Los Angeles: at 23:30 the night before spring-forward, Sunday is not skipped", () => {
  const out = slots({ rules: [ruleOn("2026-03-08", 540, 600)], tz: LA, fromKey: "2026-03-07", toKey: "2026-03-08", now: at("2026-03-08T07:30:00.000Z") });
  assert.deepEqual(startsOf(out), ["2026-03-08T16:00:00.000Z"]); // Sun 09:00 PDT
});

test("Los Angeles: just after midnight on fall-back Sunday, Monday is still walked", () => {
  const rules = [ruleOn("2026-11-01", 540, 600), ruleOn("2026-11-02", 540, 600)];
  const out = slots({ rules, tz: LA, fromKey: "2026-11-01", toKey: "2026-11-02", now: at("2026-11-01T07:30:00.000Z") });
  assert.deepEqual(startsOf(out), ["2026-11-01T17:00:00.000Z", "2026-11-02T17:00:00.000Z"]); // 09:00 PST
});

/* ───────────────────────── isGridStart ───────────────────────── */

for (const tz of ZONES) {
  test(`${tz}: isGridStart accepts a grid start to the millisecond and nothing else`, () => {
    const key = "2026-07-08";
    const rules = [ruleOn(key, 600, 720)]; // 10:00-12:00, 60 min: 10:00 and 11:00
    const ten = instantAt(key, 600, tz);
    const ok = (startsAt: Date) => isGridStart({ rules, durationMin: 60, tz, startsAt });
    assert.equal(ok(ten), true);
    assert.equal(ok(instantAt(key, 660, tz)), true);
    assert.equal(ok(new Date(ten.getTime() + 7 * MIN)), false, "10:07");
    assert.equal(ok(new Date(ten.getTime() + 30_000)), false, "10:00:30");
    assert.equal(ok(new Date(ten.getTime() + 1)), false, "10:00:00.001");
    assert.equal(ok(new Date(ten.getTime() - 1)), false, "09:59:59.999");
    assert.equal(ok(instantAt(key, 630, tz)), false, "10:30 is inside the hours but off the grid");
    assert.equal(ok(instantAt(key, 720, tz)), false, "12:00 would end after the hours");
    assert.equal(ok(instantAt(key, 480, tz)), false, "08:00 is outside the hours");
    assert.equal(ok(instantAt(addDays(key, 1), 600, tz)), false, "the next day has no rule");
    assert.equal(ok(new Date(Number.NaN)), false, "an invalid date");
  });
}

/* ───────────────────────── Property test (seeded) ───────────────────────── */

/** mulberry32: a small seeded generator, so a failure replays. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("property: every slot is a grid start, bookable, free of every busy interval, sorted, unique and whole-minute; none is missing", () => {
  const random = rng(20261028);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  // days around the four DST changes, and a plain summer week
  const anchors = ["2026-03-05", "2026-03-26", "2026-07-08", "2026-10-22", "2026-10-29"];
  let checked = 0;
  for (let run = 0; run < 120; run++) {
    const tz = pick(ZONES);
    const durationMin = pick([15, 20, 30, 45, 60, 90]);
    const bufferBeforeMin = pick([0, 0, 5, 15, 30]);
    const bufferAfterMin = pick([0, 0, 10, 15, 30]);
    const rules: RdvRule[] = Array.from({ length: int(1, 6) }, () => {
      const startMinute = int(0, 276) * 5;
      return { dayOfWeek: int(0, 6), startMinute, endMinute: Math.min(1440, startMinute + int(1, 120) * 5) };
    });
    const anchor = addDays(pick(anchors), int(0, 4));
    // a now with seconds and milliseconds, like a real request
    const now = new Date(instantAt(anchor, int(0, 1439), tz).getTime() + int(0, 59_999));
    const win = window({ bookingHorizonDays: int(0, 12), minNoticeMinutes: pick([0, 0, 30, 60, 240, 1440]) });
    const fromKey = addDays(todayKey(now, tz), int(-2, 3));
    const toKey = addDays(fromKey, 6);
    const span = instantAt(addDays(toKey, 1), 0, tz).getTime() - instantAt(fromKey, 0, tz).getTime();
    const busy: BusyInterval[] = Array.from({ length: int(0, 8) }, () => {
      const start = instantAt(fromKey, 0, tz).getTime() + Math.floor(random() * span);
      return { start: new Date(start), end: new Date(start + int(1, 240) * MIN + pick([0, 0, 1, 30_000])) };
    });
    const out = computeSlots({ rules, busy, durationMin, bufferBeforeMin, bufferAfterMin, tz, fromKey, toKey, window: win, now });
    const label = JSON.stringify({ run, tz, durationMin, now: now.toISOString(), fromKey });
    for (let i = 0; i < out.length; i++) {
      const { start, end } = out[i];
      if (i > 0) assert.ok(out[i - 1].start.getTime() < start.getTime(), `sorted and unique ${label}`);
      assert.equal(start.getTime() % MIN, 0, `whole-minute start ${label}`);
      assert.equal(end.getTime() - start.getTime(), durationMin * MIN, `elapsed end ${label}`);
      assert.ok(fitsAvailability(rules, start, end, tz), `fits the hours ${label}`);
      assert.ok(onlineBookability({ startsAt: start, now, tz, window: win }).ok, `bookable ${label}`);
      assert.ok(isGridStart({ rules, durationMin, tz, startsAt: start }), `on the grid ${label}`);
      const key = todayKey(start, tz);
      assert.ok(key >= fromKey && key <= toKey, `inside the requested dates ${label}`);
      const blockStart = start.getTime() - bufferBeforeMin * MIN;
      const blockEnd = end.getTime() + bufferAfterMin * MIN;
      for (const b of busy) assert.ok(!(b.start.getTime() < blockEnd && b.end.getTime() > blockStart), `free block ${label}`);
    }
    // completeness: every grid start of the requested dates that the window and the busy intervals let through is offered
    let expected = 0;
    for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
      for (const start of gridStartsOfDay({ rules, durationMin, tz, key })) {
        const end = start.getTime() + durationMin * MIN;
        if (!onlineBookability({ startsAt: start, now, tz, window: win }).ok) continue;
        if (busy.some((b) => b.start.getTime() < end + bufferAfterMin * MIN && b.end.getTime() > start.getTime() - bufferBeforeMin * MIN)) continue;
        expected++;
      }
    }
    assert.equal(out.length, expected, `nothing bookable is hidden ${label}`);
    checked += out.length;
  }
  assert.ok(checked > 200, `the property saw enough slots (${checked})`);
});
