/**
 * The RDV slot loader against the real engine (P5 dossier § 3.4, § 5 T6): what loadRdvWeek offers, bookRdv books;
 * what it hides, bookRdv refuses (or checkRdvStart refuses it first, for an off-grid start). Every test injects a
 * fixed `now` far from any DST change, except the two DST weeks, so the counts never depend on the run date.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setAvailabilityRules, setTicketTypeArchived } from "@/lib/booking/catalog";
import { bookRdv, rdvRules, type BookRdvInput } from "@/lib/booking/claims";
import { releasePurchase } from "@/lib/booking/release";
import { addDays, instantAt, mondayOf, todayKey, type DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { occurrence, ticketType, timeOff } from "@/lib/db/schema";
import { checkRdvStart, loadRdvBusy, loadRdvWeek, type RdvWeek } from "@/lib/slots";
import { addMinutes, createTestPro, dbTest, deleteTestUser, type DbHarness, type TestPro } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { rowEvent, rowSeance } from "@/test/rows";

/** A fixed Wednesday, 10:00 in Paris (winter time, UTC+1). */
const NOW = new Date("2027-01-13T09:00:00.000Z");
/** The week of NOW: Monday 2027-01-11 to Sunday 2027-01-17. */
const THIS_WEEK = "2027-01-11";
const WED = "2027-01-13";
const THU = "2027-01-14";
const FRI = "2027-01-15";
const SAT = "2027-01-16";
const SUN = "2027-01-17";
/** The next week, wholly in the future: Monday 2027-01-18 to Sunday 2027-01-24. */
const NEXT_WEEK = "2027-01-18";
const NEXT_TUE = "2027-01-19";
const NEXT_WED = "2027-01-20";
const NEXT_THU = "2027-01-21";
const NEXT_FRI = "2027-01-22";

type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (r: Outcome): string => (r.ok ? "ok" : r.code);

const ALL_WEEK = (startMinute: number, endMinute: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute, endMinute }));

async function setHours(
  db: Db,
  pro: TestPro,
  ticketTypeId: string | null,
  rules: { dayOfWeek: number; startMinute: number; endMinute: number }[],
): Promise<void> {
  const res = await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId, rules });
  assert.ok(res.ok, JSON.stringify(res));
}

/** Global hours 08:00 to 20:00 every day and a free RDV type (60 min unless overridden). */
async function setup(h: DbHarness, typeOver: Parameters<typeof makeType>[2] = {}): Promise<string> {
  await setHours(h.db, h.pro, null, ALL_WEEK(480, 1200));
  return makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60, ...typeOver });
}

/** `minute` of local date `key`, in the pro's zone. */
function atOf(pro: TestPro) {
  return (key: DateKey, minute: number): Date => instantAt(key, minute, pro.tz);
}

const iso = (d: Date): string => d.toISOString();

/** The ISO starts of local date `key` in a loaded week. */
function startsOn(week: RdvWeek | null, key: DateKey): string[] {
  assert.ok(week, "the type is bookable");
  const day = week.days.find((d) => d.key === key);
  assert.ok(day, `${key} is a day of the loaded week`);
  return day.slots.map((s) => iso(s.start));
}

/** The ISO starts `at(key, m)` of every minute `from, from + step, …` up to `to` (inclusive), minus `except`. */
function grid(at: (key: DateKey, minute: number) => Date, key: DateKey, from: number, to: number, step = 60, except: number[] = []) {
  const out: string[] = [];
  for (let m = from; m <= to; m += step) if (!except.includes(m)) out.push(iso(at(key, m)));
  return out;
}

function freeRdv(pro: TestPro, ticketTypeId: string, startsAt: Date, customerId: string): BookRdvInput {
  return { professionalId: pro.proId, ticketTypeId, startsAt, customerId, actorUserId: null, mode: "free" };
}

async function bookFree(db: Db, pro: TestPro, ticketTypeId: string, startsAt: Date, now: Date) {
  return bookRdv(db, freeRdv(pro, ticketTypeId, startsAt, await makeCustomer(db, pro)), now);
}

/** `db` with a count of its `select` calls (every read of the loader is one). */
function countingSelects(db: Db): { db: Db; count: () => number } {
  let n = 0;
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "select") {
        return (...args: unknown[]) => {
          n += 1;
          return Reflect.apply(target.select, target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, count: () => n };
}

dbTest("loadRdvWeek: the seven days from Monday, the grid of the hours, nothing before now + notice; the type facts", async (h) => {
  const typeId = await setup(h);
  const at = atOf(h.pro);
  const week = await loadRdvWeek(h.db, h.pro.proId, typeId, WED, NOW);
  assert.ok(week);
  assert.deepEqual(
    week.days.map((d) => d.key),
    ["2027-01-11", "2027-01-12", WED, THU, FRI, SAT, SUN],
  );
  assert.equal(week.neverBookable, false);
  assert.equal(week.type.durationMin, 60);
  assert.equal(week.type.rdvFree, true);
  assert.equal(week.type.tz, "Europe/Paris");
  assert.deepEqual(week.type.window, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 });
  assert.deepEqual(startsOn(week, "2027-01-11"), [], "a past day");
  assert.deepEqual(startsOn(week, "2027-01-12"), [], "yesterday");
  // now is 10:00 and the notice 60 minutes: 11:00 is exactly now + notice, and is in
  assert.deepEqual(startsOn(week, WED), grid(at, WED, 660, 1140));
  for (const key of [THU, FRI, SAT, SUN]) assert.deepEqual(startsOn(week, key), grid(at, key, 480, 1140), key);
  for (const day of week.days) {
    for (const s of day.slots) assert.equal(s.end.getTime() - s.start.getTime(), 3_600_000, "60 elapsed minutes");
  }
  // any day of the week loads the same week
  assert.deepEqual(await loadRdvWeek(h.db, h.pro.proId, typeId, SUN, NOW), week);
  // the engine agrees on the notice boundary: 11:00 books, 10:00 does not
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(WED, 600), NOW)), "unavailable");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(WED, 660), NOW)), "ok");
});

dbTest("loadRdvBusy and loadRdvWeek: every scheduled séance blocks (private, « none », empty, archived event, started before the window, across midnight), a cancelled one does not", async (h) => {
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await setHours(h.db, h.pro, typeId, ALL_WEEK(0, 1440));
  const at = atOf(h.pro);
  // Sunday 23:00 to Monday 01:00: it starts before the week the loader reads
  await makeEvent(h.db, h.pro, { durationMin: 120, rule: { startDate: SUN, startMinute: 1380 } }, NOW);
  await makeEvent(h.db, h.pro, { isPrivate: true, rule: { startDate: NEXT_TUE, startMinute: 600 } }, NOW);
  await makeEvent(h.db, h.pro, { bookingMode: "none", rule: { startDate: NEXT_TUE, startMinute: 720 } }, NOW);
  await makeEvent(h.db, h.pro, { rule: { startDate: NEXT_TUE, startMinute: 840 } }, NOW); // public, nobody booked
  const archived = await rowEvent(h.db, h.pro, { archivedAt: NOW }, NOW);
  await rowSeance(h.db, h.pro, archived, { startsAt: at(NEXT_TUE, 960) }, NOW);
  const cancelled = await rowEvent(h.db, h.pro, {}, NOW);
  await rowSeance(h.db, h.pro, cancelled, { startsAt: at(NEXT_TUE, 1080), status: "cancelled" }, NOW);
  // Wednesday 23:00 to Thursday 01:00
  await makeEvent(h.db, h.pro, { durationMin: 120, rule: { startDate: NEXT_WED, startMinute: 1380 } }, NOW);

  const week = await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, NOW);
  assert.deepEqual(startsOn(week, NEXT_WEEK), grid(at, NEXT_WEEK, 60, 1380), "00:00 is under Sunday's séance");
  assert.deepEqual(startsOn(week, NEXT_TUE), grid(at, NEXT_TUE, 0, 1380, 60, [600, 720, 840, 960]), "18:00 (cancelled) is offered");
  assert.deepEqual(startsOn(week, NEXT_WED), grid(at, NEXT_WED, 0, 1320));
  assert.deepEqual(startsOn(week, NEXT_THU), grid(at, NEXT_THU, 60, 1380));
  assert.deepEqual(startsOn(week, NEXT_FRI), grid(at, NEXT_FRI, 0, 1380));

  const tuesday = await loadRdvBusy(h.db, h.pro.proId, { start: at(NEXT_TUE, 0), end: at(NEXT_WED, 0) }, NOW);
  assert.deepEqual(
    tuesday.map((b) => [iso(b.start), iso(b.end)]).sort(),
    [600, 720, 840, 960].map((m) => [iso(at(NEXT_TUE, m)), iso(at(NEXT_TUE, m + 60))]),
  );
  const mondayNight = await loadRdvBusy(h.db, h.pro.proId, { start: at(NEXT_WEEK, 0), end: at(NEXT_WEEK, 60) }, NOW);
  assert.deepEqual(
    mondayNight.map((b) => [iso(b.start), iso(b.end)]),
    [[iso(at(SUN, 1380)), iso(at(NEXT_WEEK, 60))]],
    "a séance that started 60 minutes before the range",
  );
  // the engine agrees: under a séance is slot_taken, next to one is fine
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 960), NOW)), "slot_taken", "the archived event's séance");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_THU, 0), NOW)), "slot_taken", "across midnight");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 1080), NOW)), "ok", "the cancelled séance");
});

dbTest("loadRdvWeek: an all-day and a timed time off hide what they overlap; end_at is exclusive", async (h) => {
  const typeId = await setup(h);
  const at = atOf(h.pro);
  await h.db.insert(timeOff).values([
    { professionalId: h.pro.proId, startAt: at(NEXT_TUE, 0), endAt: at(NEXT_WED, 0), allDay: true },
    { professionalId: h.pro.proId, startAt: at(NEXT_THU, 720), endAt: at(NEXT_THU, 810), allDay: false },
    { professionalId: h.pro.proId, startAt: at(NEXT_FRI, 360), endAt: at(NEXT_FRI, 480), allDay: false },
  ]);
  const week = await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, NOW);
  assert.deepEqual(startsOn(week, NEXT_TUE), [], "the all-day time off");
  assert.deepEqual(startsOn(week, NEXT_WED), grid(at, NEXT_WED, 480, 1140), "the day after it is whole");
  assert.deepEqual(startsOn(week, NEXT_THU), grid(at, NEXT_THU, 480, 1140, 60, [720, 780]), "12:00 to 13:30 hides 12:00 and 13:00");
  assert.deepEqual(startsOn(week, NEXT_FRI), grid(at, NEXT_FRI, 480, 1140), "a time off ending at 08:00 leaves 08:00");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_THU, 780), NOW)), "slot_taken");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_THU, 660), NOW)), "ok", "11:00 to 12:00 only touches it");
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_FRI, 480), NOW)), "ok");
});

dbTest("loadRdvWeek: another RDV type of the pro blocks by its stored block, against the candidate's own buffers", async (h) => {
  // The loaded type: 60 minutes, 15 before. The other: 30 minutes, 30 after (its block is 12:00 to 13:00).
  const typeId = await setup(h, { rdvBufferBeforeMin: 15 });
  const other = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 30, rdvBufferAfterMin: 30 });
  const at = atOf(h.pro);
  const booked = await bookFree(h.db, h.pro, other, at(NEXT_TUE, 720), NOW);
  assert.ok(booked.ok, JSON.stringify(booked));
  const o = await getOccurrence(h.db, booked.occurrenceId);
  assert.deepEqual([iso(o.blockStart), iso(o.blockEnd)], [iso(at(NEXT_TUE, 720)), iso(at(NEXT_TUE, 780))]);

  const load = async () => startsOn(await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, NOW), NEXT_TUE);
  // 13:00 → block 12:45 to 14:00 meets the other's after-buffer; 11:00 → block 10:45 to 12:00 only touches it
  assert.deepEqual(await load(), grid(at, NEXT_TUE, 480, 1140, 60, [720, 780]));
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 780), NOW)), "slot_taken");
  const touching = await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 660), NOW);
  assert.ok(touching.ok, JSON.stringify(touching));
  // now 11:00 is booked (block 10:45 to 12:00): 10:00 (block 09:45 to 11:00) overlaps it too
  assert.deepEqual(await load(), grid(at, NEXT_TUE, 480, 1140, 60, [600, 660, 720, 780]));
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 600), NOW)), "slot_taken");
});

// P6 A12: one hold rule for the reads and the engine. A hold runs strictly before hold_expires_at; from that instant on
// it has lapsed: the page offers the slot and the engine books it (R expires the phantom first).
dbTest("loadRdvWeek: a live hold blocks up to 1 ms before hold_expires_at (slot_taken); at hold_expires_at the RDV is a phantom and the slot books", async (h) => {
  const typeId = await setup(h, { rdvFree: false });
  const offerId = await makeOffer(h.db, h.pro, typeId);
  const at = atOf(h.pro);
  const slot = iso(at(NEXT_TUE, 600));
  const buy = async (now: Date) =>
    bookRdv(
      h.db,
      { professionalId: h.pro.proId, ticketTypeId: typeId, startsAt: at(NEXT_TUE, 600), customerId: await makeCustomer(h.db, h.pro), actorUserId: null, mode: "buy", offerId },
      now,
    );
  const offered = async (now: Date) => startsOn(await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, now), NEXT_TUE).includes(slot);
  const busyAt = async (now: Date) =>
    (await loadRdvBusy(h.db, h.pro.proId, { start: at(NEXT_TUE, 0), end: at(NEXT_WED, 0) }, now)).map((b) => iso(b.start));

  const first = await buy(NOW);
  assert.ok(first.ok, JSON.stringify(first));
  const holdEnd = (await getBooking(h.db, first.bookingId)).holdExpiresAt;
  assert.ok(holdEnd);
  assert.equal(holdEnd.getTime(), addMinutes(NOW, 45).getTime());

  assert.equal(await offered(addMinutes(NOW, 10)), false, "a live hold");
  const before = new Date(holdEnd.getTime() - 1);
  assert.equal(await offered(before), false, "1 ms before hold_expires_at: still live");
  assert.deepEqual(await busyAt(before), [slot]);
  assert.equal(codeOf(await buy(before)), "slot_taken", "the engine agrees before the boundary");

  assert.equal(await offered(holdEnd), true, "hold_expires_at == now: only a lapsed hold, a phantom");
  assert.deepEqual(await busyAt(holdEnd), []);
  const second = await buy(holdEnd);
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal((await getOccurrence(h.db, first.occurrenceId)).status, "cancelled", "the engine released the phantom at the boundary");
  assert.equal(await offered(holdEnd), false, "the new hold blocks");
});

dbTest("loadRdvWeek: a released (cancelled) RDV is ignored, a confirmed one blocks", async (h) => {
  const typeId = await setup(h, { rdvFree: false });
  const freeType = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const offerId = await makeOffer(h.db, h.pro, typeId);
  const at = atOf(h.pro);
  const held = await bookRdv(
    h.db,
    { professionalId: h.pro.proId, ticketTypeId: typeId, startsAt: at(NEXT_TUE, 600), customerId: await makeCustomer(h.db, h.pro), actorUserId: null, mode: "buy", offerId },
    NOW,
  );
  assert.ok(held.ok && held.purchaseId, JSON.stringify(held));
  const released = await releasePurchase(h.db, held.purchaseId, addMinutes(NOW, 1));
  assert.ok(released.ok, JSON.stringify(released));
  const [o] = await h.db.select().from(occurrence).where(eq(occurrence.id, held.occurrenceId));
  assert.equal(o.status, "cancelled");
  const confirmed = await bookFree(h.db, h.pro, freeType, at(NEXT_TUE, 720), NOW);
  assert.ok(confirmed.ok, JSON.stringify(confirmed));

  const week = await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, addMinutes(NOW, 2));
  assert.deepEqual(startsOn(week, NEXT_TUE), grid(at, NEXT_TUE, 480, 1140, 60, [720]));
});

dbTest("loadRdvWeek: the type's window overrides the pro's; its own hours replace the global ones; touching rules stay two rules", async (h) => {
  const at = atOf(h.pro);
  // notice 24 h and horizon 2 days (the pro's: 60 min and 60 days)
  const windowed = await setup(h, { rdvOverrides: { minNoticeMinutes: 1440, bookingHorizonDays: 2, cancelDeadlineHours: null } });
  const week = await loadRdvWeek(h.db, h.pro.proId, windowed, THIS_WEEK, NOW);
  assert.ok(week);
  assert.deepEqual(week.type.window, { bookingHorizonDays: 2, minNoticeMinutes: 1440, cancelDeadlineHours: 24 });
  assert.deepEqual(startsOn(week, WED), []);
  assert.deepEqual(startsOn(week, THU), grid(at, THU, 600, 1140), "from now + 24 h");
  assert.deepEqual(startsOn(week, FRI), grid(at, FRI, 480, 1140), "today + 2, the horizon, inclusive");
  assert.deepEqual(startsOn(week, SAT), []);
  assert.deepEqual(startsOn(week, SUN), []);
  assert.equal(codeOf(await bookFree(h.db, h.pro, windowed, at(THU, 540), NOW)), "unavailable");
  assert.equal(codeOf(await bookFree(h.db, h.pro, windowed, at(SAT, 600), NOW)), "unavailable");
  assert.equal(codeOf(await bookFree(h.db, h.pro, windowed, at(FRI, 1140), NOW)), "ok");

  // its own hours: Tuesday 14:00 to 16:00 only
  const own = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await setHours(h.db, h.pro, own, [{ dayOfWeek: 2, startMinute: 840, endMinute: 960 }]);
  const ownWeek = await loadRdvWeek(h.db, h.pro.proId, own, NEXT_WEEK, NOW);
  assert.deepEqual(startsOn(ownWeek, NEXT_TUE), grid(at, NEXT_TUE, 840, 900));
  assert.deepEqual(startsOn(ownWeek, NEXT_WED), [], "no own rule on Wednesday, and the global ones no longer count");

  // touching rules 08:00 to 10:00 and 10:00 to 12:00, 90 minutes: 08:00 and 10:00, never 09:30 across both
  const touching = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 90 });
  await setHours(h.db, h.pro, touching, [
    { dayOfWeek: 2, startMinute: 480, endMinute: 600 },
    { dayOfWeek: 2, startMinute: 600, endMinute: 720 },
  ]);
  assert.equal((await rdvRules(h.db, h.pro.proId, touching)).length, 2, "stored unmerged");
  const touchingWeek = await loadRdvWeek(h.db, h.pro.proId, touching, NEXT_WEEK, NOW);
  assert.deepEqual(startsOn(touchingWeek, NEXT_TUE), [iso(at(NEXT_TUE, 480)), iso(at(NEXT_TUE, 600))]);
  assert.equal(await checkRdvStart(h.db, h.pro.proId, touching, at(NEXT_TUE, 570)), "off_grid");
  assert.equal(codeOf(await bookFree(h.db, h.pro, touching, at(NEXT_TUE, 570), NOW)), "unavailable", "the engine: inside one rule only");
  assert.equal(await checkRdvStart(h.db, h.pro.proId, touching, at(NEXT_TUE, 600)), "ok");
});

dbTest("loadRdvWeek: never bookable (no hours, notice above horizon), a week past the horizon, a past week and a malformed key read the type and the hours only", async (h) => {
  const at = atOf(h.pro);
  const noHours = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const counted = countingSelects(h.db);
  const closed = await loadRdvWeek(counted.db, h.pro.proId, noHours, NEXT_WEEK, NOW);
  assert.ok(closed);
  assert.equal(closed.neverBookable, true, "no own rules and no global ones");
  assert.equal(closed.days.length, 7);
  assert.ok(closed.days.every((d) => d.slots.length === 0));
  assert.equal(counted.count(), 2, "the type and the hours, no busy read");

  await setHours(h.db, h.pro, null, ALL_WEEK(480, 1200));
  const open = countingSelects(h.db);
  const week = await loadRdvWeek(open.db, h.pro.proId, noHours, NEXT_WEEK, NOW);
  assert.equal(week?.neverBookable, false);
  assert.deepEqual(startsOn(week, NEXT_TUE), grid(at, NEXT_TUE, 480, 1140));
  assert.equal(open.count(), 5, "the type, the hours and the three busy reads");

  // a notice above the horizon (a direct row edit: the back-office refuses it, OUT L106)
  const tooLong = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await h.db.update(ticketType).set({ rdvMinNoticeMinutes: 10080, rdvBookingHorizonDays: 1 }).where(eq(ticketType.id, tooLong));
  const never = countingSelects(h.db);
  const neverWeek = await loadRdvWeek(never.db, h.pro.proId, tooLong, THIS_WEEK, NOW);
  assert.equal(neverWeek?.neverBookable, true);
  assert.ok(neverWeek?.days.every((d) => d.slots.length === 0));
  assert.equal(never.count(), 2);

  const today = todayKey(NOW, h.pro.tz);
  for (const [what, key] of [
    ["a week past the 60-day horizon", mondayOf(addDays(today, 70))],
    ["last week", addDays(THIS_WEEK, -7)],
  ] as const) {
    const c = countingSelects(h.db);
    const w = await loadRdvWeek(c.db, h.pro.proId, noHours, key, NOW);
    assert.equal(w?.neverBookable, false, what);
    assert.equal(w?.days.length, 7, what);
    assert.ok(w?.days.every((d) => d.slots.length === 0), what);
    assert.equal(c.count(), 2, `${what}: nothing generated, nothing read but the type and the hours`);
  }
  const malformed = countingSelects(h.db);
  const bad = await loadRdvWeek(malformed.db, h.pro.proId, noHours, "2027-13-45", NOW);
  assert.deepEqual(bad?.days, []);
  assert.equal(malformed.count(), 2);

  // the week holding the horizon: up to today + 60, inclusive
  const horizon = addDays(today, 60);
  const edge = await loadRdvWeek(h.db, h.pro.proId, noHours, horizon, NOW);
  assert.deepEqual(startsOn(edge, horizon), grid(at, horizon, 480, 1140));
  const after = addDays(horizon, 1);
  if (mondayOf(after) === mondayOf(horizon)) assert.deepEqual(startsOn(edge, after), []);
});

dbTest("loadRdvWeek and checkRdvStart: a type that is not bookable reads as null and off_grid, an unknown id as null and not_found", async (h) => {
  const at = atOf(h.pro);
  await setHours(h.db, h.pro, null, ALL_WEEK(480, 1200));
  const notRdv = await makeType(h.db, h.pro);
  const archived = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const done = await setTicketTypeArchived(h.db, { professionalId: h.pro.proId, ticketTypeId: archived, archived: true });
  assert.ok(done.ok, JSON.stringify(done));
  const paid = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const start = at(NEXT_TUE, 600);

  assert.equal(await loadRdvWeek(h.db, h.pro.proId, notRdv, NEXT_WEEK, NOW), null);
  assert.equal(await loadRdvWeek(h.db, h.pro.proId, archived, NEXT_WEEK, NOW), null);
  assert.equal(await loadRdvWeek(h.db, h.pro.proId, `missing_${nanoid()}`, NEXT_WEEK, NOW), null);
  assert.equal(await checkRdvStart(h.db, h.pro.proId, notRdv, start), "off_grid");
  assert.equal(await checkRdvStart(h.db, h.pro.proId, archived, start), "off_grid");
  assert.equal(await checkRdvStart(h.db, h.pro.proId, `missing_${nanoid()}`, start), "not_found");
  // a paid type is a mode, never a 404
  const paidWeek = await loadRdvWeek(h.db, h.pro.proId, paid, NEXT_WEEK, NOW);
  assert.equal(paidWeek?.type.rdvFree, false);
  assert.deepEqual(startsOn(paidWeek, NEXT_TUE), grid(at, NEXT_TUE, 480, 1140));
  assert.equal(await checkRdvStart(h.db, h.pro.proId, paid, start), "ok");
});

dbTest("loadRdvWeek agrees with bookRdv: the first and the last slot offered book, the overlapping neighbours go, off-grid starts are refused", async (h) => {
  // 45 minutes, buffers 10 before and 5 after: grid 08:00, 08:45, … 19:15 (ends 20:00)
  const typeId = await setup(h, { rdvDurationMin: 45, rdvBufferBeforeMin: 10, rdvBufferAfterMin: 5 });
  const at = atOf(h.pro);
  const MIN = 60_000;
  const blockOf = (startIso: string): [number, number] => {
    const s = new Date(startIso).getTime();
    return [s - 10 * MIN, s + 50 * MIN];
  };
  const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && a[1] > b[0];
  const all = (w: RdvWeek | null) => {
    assert.ok(w);
    return w.days.flatMap((d) => d.slots.map((s) => iso(s.start)));
  };

  const before = all(await loadRdvWeek(h.db, h.pro.proId, typeId, THIS_WEEK, NOW));
  const first = before[0];
  const last = before[before.length - 1];
  assert.equal(first, iso(at(WED, 660)), "the first grid start at or after now + notice");
  assert.equal(last, iso(at(SUN, 1155)), "19:15, its 45 minutes end at 20:00");
  assert.equal(startsOn(await loadRdvWeek(h.db, h.pro.proId, typeId, THIS_WEEK, NOW), WED).length, 12);

  for (const startIso of [first, last]) {
    assert.equal(await checkRdvStart(h.db, h.pro.proId, typeId, new Date(startIso)), "ok");
    const res = await bookFree(h.db, h.pro, typeId, new Date(startIso), NOW);
    assert.ok(res.ok, `${startIso}: ${JSON.stringify(res)}`);
  }
  const after = all(await loadRdvWeek(h.db, h.pro.proId, typeId, THIS_WEEK, NOW));
  const booked = [blockOf(first), blockOf(last)];
  assert.deepEqual(
    after,
    before.filter((s) => !booked.some((b) => overlaps(blockOf(s), b))),
    "exactly the slots whose block overlaps a booked block are gone",
  );
  assert.ok(!after.includes(iso(at(WED, 705))), "11:45: its block 11:35 to 12:35 meets 10:50 to 11:50");
  assert.ok(after.includes(iso(at(WED, 750))), "12:30: its block starts at 12:20");
  assert.ok(!after.includes(iso(at(SUN, 1110))), "18:30: its block 18:20 to 19:20 meets 19:05 to 20:05");
  for (const gone of [iso(at(WED, 705)), iso(at(SUN, 1110))]) {
    assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, new Date(gone), NOW)), "slot_taken", gone);
  }
  // a grid start before now + notice is neither offered nor booked
  assert.ok(!before.includes(iso(at(WED, 615))));
  assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(WED, 615), NOW)), "unavailable");

  const firstAt = new Date(first);
  for (const [what, startsAt] of [
    ["5 minutes later", new Date(firstAt.getTime() + 5 * MIN)],
    ["30 seconds later", new Date(firstAt.getTime() + 30_000)],
    ["1 ms later", new Date(firstAt.getTime() + 1)],
    ["07:00, before the hours", at(THU, 420)],
    ["20:00, its end would overrun the hours", at(THU, 1200)],
    ["10:00, inside the hours but off the 45-minute grid", at(THU, 600)],
  ] as const) {
    assert.equal(await checkRdvStart(h.db, h.pro.proId, typeId, startsAt), "off_grid", what);
  }
});

dbTest("loadRdvWeek on the Paris spring-forward week (2027-03-28): elapsed ends, the deduped shifted start, a start that would overrun its hours", async (h) => {
  const now = new Date("2027-03-24T10:00:00.000Z");
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const short = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await setHours(h.db, h.pro, typeId, [{ dayOfWeek: 0, startMinute: 60, endMinute: 240 }]);
  await setHours(h.db, h.pro, short, [{ dayOfWeek: 0, startMinute: 60, endMinute: 210 }]);

  const week = await loadRdvWeek(h.db, h.pro.proId, typeId, "2027-03-28", now);
  assert.ok(week);
  assert.deepEqual(
    week.days.map((d) => d.key),
    ["2027-03-22", "2027-03-23", "2027-03-24", "2027-03-25", "2027-03-26", "2027-03-27", "2027-03-28"],
  );
  // 01:00 CET, then 03:00 CEST (02:00 does not exist and 03:00 is the same instant: one start)
  assert.deepEqual(startsOn(week, "2027-03-28"), ["2027-03-28T00:00:00.000Z", "2027-03-28T01:00:00.000Z"]);
  assert.deepEqual(
    week.days.find((d) => d.key === "2027-03-28")?.slots.map((s) => iso(s.end)),
    ["2027-03-28T01:00:00.000Z", "2027-03-28T02:00:00.000Z"],
    "60 elapsed minutes each",
  );
  assert.deepEqual(startsOn(await loadRdvWeek(h.db, h.pro.proId, short, "2027-03-28", now), "2027-03-28"), [
    "2027-03-28T00:00:00.000Z",
  ]);
  assert.equal(await checkRdvStart(h.db, h.pro.proId, short, new Date("2027-03-28T01:00:00.000Z")), "off_grid");

  for (const startIso of startsOn(week, "2027-03-28")) {
    const res = await bookFree(h.db, h.pro, typeId, new Date(startIso), now);
    assert.ok(res.ok, `${startIso}: ${JSON.stringify(res)}`);
  }
  assert.deepEqual(startsOn(await loadRdvWeek(h.db, h.pro.proId, typeId, "2027-03-28", now), "2027-03-28"), []);
  assert.deepEqual(startsOn(await loadRdvWeek(h.db, h.pro.proId, short, "2027-03-28", now), "2027-03-28"), [], "the other type's RDV blocks it");
  assert.equal(codeOf(await bookFree(h.db, h.pro, short, new Date("2027-03-28T00:00:00.000Z"), now)), "slot_taken");
});

dbTest("loadRdvWeek on the Los Angeles fall-back week (2026-11-01): the first 01:00 only, elapsed ends, the repeated hour off the grid", async (h) => {
  const la = await createTestPro(h.db, { tz: "America/Los_Angeles" });
  try {
    const now = new Date("2026-10-29T17:00:00.000Z");
    const typeId = await makeType(h.db, la, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
    await setHours(h.db, la, typeId, [{ dayOfWeek: 0, startMinute: 0, endMinute: 180 }]);

    const week = await loadRdvWeek(h.db, la.proId, typeId, "2026-10-29", now);
    assert.ok(week);
    assert.equal(week.type.tz, "America/Los_Angeles");
    assert.deepEqual(week.days.map((d) => d.key)[0], "2026-10-26");
    assert.deepEqual(week.days.map((d) => d.key)[6], "2026-11-01");
    // 00:00 PDT, 01:00 PDT (the first of the two), 02:00 PST
    const starts = ["2026-11-01T07:00:00.000Z", "2026-11-01T08:00:00.000Z", "2026-11-01T10:00:00.000Z"];
    assert.deepEqual(startsOn(week, "2026-11-01"), starts);
    assert.deepEqual(
      week.days.find((d) => d.key === "2026-11-01")?.slots.map((s) => iso(s.end)),
      ["2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z", "2026-11-01T11:00:00.000Z"],
    );
    // the second 01:00 (01:00 PST) is inside the hours, but not a grid start: the action refuses it before the engine
    assert.equal(await checkRdvStart(h.db, la.proId, typeId, new Date("2026-11-01T09:00:00.000Z")), "off_grid");

    for (const startIso of starts) {
      const res = await bookFree(h.db, la, typeId, new Date(startIso), now);
      assert.ok(res.ok, `${startIso}: ${JSON.stringify(res)}`);
    }
    assert.deepEqual(startsOn(await loadRdvWeek(h.db, la.proId, typeId, "2026-10-29", now), "2026-11-01"), []);
  } finally {
    await deleteTestUser(h.db, la.userId);
  }
});

dbTest("loadRdvWeek, loadRdvBusy and checkRdvStart: a second pro's hours, RDVs, séances and time off never touch this pro; its type id is null and not_found", async (h) => {
  const at = atOf(h.pro);
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const other = await createTestPro(h.db);
  try {
    await setHours(h.db, other, null, ALL_WEEK(0, 1440));
    const theirType = await makeType(h.db, other, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
    const closed = await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, NOW);
    assert.equal(closed?.neverBookable, true, "their hours are not this pro's");

    await setHours(h.db, h.pro, null, ALL_WEEK(480, 1200));
    const theirs = await bookFree(h.db, other, theirType, at(NEXT_TUE, 600), NOW);
    assert.ok(theirs.ok, JSON.stringify(theirs));
    await makeEvent(h.db, other, { rule: { startDate: NEXT_TUE, startMinute: 720 } }, NOW);
    await h.db.insert(timeOff).values({ professionalId: other.proId, startAt: at(NEXT_TUE, 840), endAt: at(NEXT_TUE, 900), allDay: false });

    const mine = await loadRdvWeek(h.db, h.pro.proId, typeId, NEXT_WEEK, NOW);
    assert.deepEqual(startsOn(mine, NEXT_TUE), grid(at, NEXT_TUE, 480, 1140));
    assert.deepEqual(await loadRdvBusy(h.db, h.pro.proId, { start: at(NEXT_TUE, 0), end: at(NEXT_WED, 0) }, NOW), []);
    const theirWeek = await loadRdvWeek(h.db, other.proId, theirType, NEXT_WEEK, NOW);
    assert.equal(startsOn(theirWeek, NEXT_TUE).length, 24 - 3, "their own loader sees their RDV, séance and time off");

    assert.equal(await loadRdvWeek(h.db, h.pro.proId, theirType, NEXT_WEEK, NOW), null);
    assert.equal(await checkRdvStart(h.db, h.pro.proId, theirType, at(NEXT_TUE, 600)), "not_found");
    assert.equal(codeOf(await bookFree(h.db, h.pro, typeId, at(NEXT_TUE, 600), NOW)), "ok");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});
