import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, type DbHarness, type TestPro } from "../../test/db";
import {
  dayIn,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeType,
  occurrencesOf,
  ticketsOf,
} from "../../test/fixtures";
import { proCtx } from "../../test/pro-ctx";
import { rowBooking, rowCustomer, rowRdv, rowRdvType } from "../../test/rows";
import { setTicketTypeArchived } from "../booking/catalog";
import { registerPro } from "../booking/claims";
import { addDays, dayOfWeek, formatDayMonthYear } from "../civil-date";
import type { Db } from "../db/atomic";
import { event, eventTicketType, occurrence } from "../db/schema";
import { expand } from "../recurrence";
import type { EventInfoInput, EventInput, RecurrenceRuleInput } from "../tickets";
import {
  EVENT_START_PAST,
  EVENT_START_TOO_FAR,
  EVENT_TYPE_UNAVAILABLE,
  applyScheduleCore,
  createEventCore,
  deleteEventFromCore,
  deleteEventPreviewCore,
  editEventInfoCore,
  previewNewEventCore,
  previewScheduleCore,
} from "./event-actions";
import { NOTICE_TOO_LONG } from "./notice";

const DAY = 86_400_000;
const STALE = "Les données ont changé entre-temps : rafraîchissez la page.";
const NOT_FOUND = "Événement introuvable ou terminé.";
const NO_OVERRIDES = { bookingHorizonDays: null, minNoticeMinutes: null, cancelDeadlineHours: null };
/** The engine's own French texts for a delete from a date (src/lib/booking/series.ts). */
const SEANCE_STARTED = "Une séance concernée a déjà commencé.";
const LEFTOVER_BEFORE = "Une séance isolée avec inscrits reste avant cette date. Annulez-la d'abord.";
/** A pinned clock, far from any midnight in Paris: 2026-10-14 12:00 and 15:00 local (UTC+2). */
const MIDDAY_PARIS = new Date("2026-10-14T10:00:00.000Z");
const AFTERNOON_PARIS = new Date("2026-10-14T13:00:00.000Z");

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

/** "ok" for a success, else the French message: one assertion shows both. */
const outcome = (res: { ok: boolean; error?: string }): string => (res.ok ? "ok" : (res.error ?? "no error text"));

const onceRule = (startDate: string, startMinute = 600): RecurrenceRuleInput => ({
  startDate,
  startMinute,
  freq: "once",
  interval: 1,
  weekdays: null,
  monthlyBy: null,
  monthWeek: null,
  endMode: "count",
  untilDate: null,
  occurrenceCount: 1,
});

const weekly = (
  startDate: string,
  weekdays: number[],
  extra: Partial<RecurrenceRuleInput> = {},
): RecurrenceRuleInput => ({
  startDate,
  startMinute: 600,
  freq: "weekly",
  interval: 1,
  weekdays,
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
  ...extra,
});

const eventInput = (pro: TestPro, now: Date, over: Partial<EventInput> = {}): EventInput => ({
  title: "Cours test",
  rule: onceRule(dayIn(pro, 2, now)),
  ...over,
});

const infoOf = (over: Partial<EventInfoInput> = {}): EventInfoInput => ({
  title: "Titre",
  description: null,
  location: null,
  color: "#6366f1",
  bookingMode: "tickets",
  isPrivate: false,
  capacity: 12,
  overrides: NO_OVERRIDES,
  ticketTypeIds: [],
  questions: [],
  ...over,
});

async function getEvent(db: Db, id: string) {
  const [row] = await db.select().from(event).where(eq(event.id, id));
  return row;
}

/** A Mon / Wed / Fri 10:00 series created 14 days ago, so that séances exist before now. */
async function pastSeries({ db, pro }: DbHarness, now: Date) {
  const typeId = await makeType(db, pro);
  const { eventId } = await makeEvent(
    db,
    pro,
    { title: "Série passée", ticketTypeIds: [typeId], rule: weekly(dayIn(pro, -14, now), [1, 3, 5]) },
    addDaysMs(now, -14),
  );
  return { typeId, eventId };
}

/** The séances of the event after `now`, by start. */
async function futureRows(db: Db, eventId: string, now: Date) {
  return (await occurrencesOf(db, eventId)).filter((o) => o.status === "scheduled" && o.startsAt.getTime() > now.getTime());
}

/* ───────────────────────────── createEventCore ───────────────────────────── */

dbTest("createEventCore: the start date is between local today and today + 730", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = MIDDAY_PARIS; // pinned: « today at 23:59 » must stay later today whenever the suite runs
  const past = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(dayIn(pro, -1, now)) }), now);
  assert.equal(outcome(past), EVENT_START_PAST);
  const far = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(dayIn(pro, 731, now)) }), now);
  assert.equal(outcome(far), EVENT_START_TOO_FAR);

  const today = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(dayIn(pro, 0, now), 1439) }), now);
  must(today, "today is allowed");
  assert.equal(today.occurrenceCount, 1);
  const limit = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(dayIn(pro, 730, now)) }), now);
  must(limit, "today + 730 is allowed");
  assert.equal(limit.occurrenceCount, 0, "beyond the 400-day horizon nothing is materialised yet");
  assert.equal((await db.select().from(event).where(eq(event.professionalId, pro.proId))).length, 2, "the refusals wrote nothing");
});

dbTest("createEventCore: today is the pro's local day (Paris midnight is still the day before in Los Angeles)", async ({ db, pro }) => {
  // 2026-10-14 22:30Z = 15 October 00:30 in Paris, 14 October 15:30 in Los Angeles
  const now = new Date("2026-10-14T22:30:00.000Z");
  const input = { title: "Cours du 14", rule: onceRule("2026-10-14", 1020) };
  const paris = await createEventCore(db, proCtx(pro), input, now);
  assert.equal(outcome(paris), EVENT_START_PAST);

  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    const res = await createEventCore(db, proCtx(la), input, now);
    must(res, "the Los Angeles pro may start on the 14th");
    assert.equal(res.occurrenceCount, 1);
    const [seance] = await occurrencesOf(db, res.eventId);
    assert.equal(seance.startsAt.toISOString(), "2026-10-15T00:00:00.000Z", "17:00 in Los Angeles (UTC-7)");
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("createEventCore: a first séance that has already started is refused, one later today is accepted", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = AFTERNOON_PARIS; // 15:00 in Paris
  const today = dayIn(pro, 0, now);
  assert.equal(today, "2026-10-14");

  const earlier = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(today, 600) }), now);
  assert.equal(outcome(earlier), EVENT_START_PAST, "10:00 is behind us");
  const exactlyNow = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(today, 900) }), now);
  assert.equal(outcome(exactlyNow), EVENT_START_PAST, "a séance starting right now has started");
  const weeklyToday = await createEventCore(db, ctx, eventInput(pro, now, { rule: weekly(today, [dayOfWeek(today)]) }), now);
  assert.equal(outcome(weeklyToday), EVENT_START_PAST, "the first séance of the series is today at 10:00");
  assert.equal((await db.select().from(event).where(eq(event.professionalId, pro.proId))).length, 0, "the refusals wrote nothing");

  const later = await createEventCore(db, ctx, eventInput(pro, now, { rule: onceRule(today, 1020) }), now);
  must(later, "17:00 is still to come");
  assert.equal(later.occurrenceCount, 1);
  const nextWeekday = await createEventCore(
    db,
    ctx,
    eventInput(pro, now, { rule: weekly(today, [(dayOfWeek(today) + 1) % 7], { endMode: "count", occurrenceCount: 2 }) }),
    now,
  );
  must(nextWeekday, "the series starts today but its first séance is tomorrow, whatever the hour");
  assert.equal(nextWeekday.occurrenceCount, 2);
});

dbTest("createEventCore: duplicate type ids link once; archived, rdv_free, foreign and unknown types are refused", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const active = await makeType(db, pro);
  const archived = await makeType(db, pro);
  const gratuit = await makeType(db, pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");
  const other = await createTestPro(db);
  try {
    const foreign = await makeType(db, other);
    const res = await createEventCore(db, ctx, eventInput(pro, now, { ticketTypeIds: [active, active] }), now);
    must(res, "duplicates are accepted once");
    assert.equal(res.occurrenceCount, 1);
    const links = await db.select().from(eventTicketType).where(eq(eventTicketType.eventId, res.eventId));
    assert.deepEqual(
      links.map((l) => l.ticketTypeId),
      [active],
    );
    for (const bad of [archived, gratuit, foreign, "unknown-type"]) {
      const refused = await createEventCore(db, ctx, eventInput(pro, now, { ticketTypeIds: [active, bad] }), now);
      assert.equal(outcome(refused), EVENT_TYPE_UNAVAILABLE, bad);
    }
    assert.equal((await db.select().from(event).where(eq(event.professionalId, pro.proId))).length, 1, "only the first call wrote");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("createEventCore and editEventInfoCore keep ticket type links only in « Sur tickets » mode", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const linksOf = async (eventId: string) =>
    (await db.select().from(eventTicketType).where(eq(eventTicketType.eventId, eventId))).map((l) => l.ticketTypeId);

  for (const bookingMode of ["free", "none"] as const) {
    const created = await createEventCore(db, ctx, eventInput(pro, now, { bookingMode, ticketTypeIds: [typeId] }), now);
    must(created, `create in ${bookingMode} mode`);
    assert.deepEqual(await linksOf(created.eventId), [], `${bookingMode}: no link written, whatever the browser sent`);
  }
  const tickets = await createEventCore(db, ctx, eventInput(pro, now, { bookingMode: "tickets", ticketTypeIds: [typeId] }), now);
  must(tickets, "create in tickets mode");
  assert.deepEqual(await linksOf(tickets.eventId), [typeId]);

  // Leaving « Sur tickets » drops the links even when the request still carries the types...
  const toFree = await editEventInfoCore(
    db,
    ctx,
    { eventId: tickets.eventId, seenVersion: 1, info: infoOf({ bookingMode: "free", ticketTypeIds: [typeId] }) },
    now,
  );
  must(toFree, "switch to free");
  assert.deepEqual(await linksOf(tickets.eventId), [], "links dropped on the way to « Libre »");
  assert.equal((await getEvent(db, tickets.eventId)).bookingMode, "free");
  // ...and a mode that is not « Sur tickets » never links a type, not even one that is archived or unknown.
  const stillNone = await editEventInfoCore(
    db,
    ctx,
    { eventId: tickets.eventId, seenVersion: toFree.version, info: infoOf({ bookingMode: "none", ticketTypeIds: [typeId, "unknown-type"] }) },
    now,
  );
  must(stillNone, "switch to none");
  assert.deepEqual(await linksOf(tickets.eventId), []);
  // Back to « Sur tickets »: the types sent are linked again.
  const back = await editEventInfoCore(
    db,
    ctx,
    { eventId: tickets.eventId, seenVersion: stillNone.version, info: infoOf({ bookingMode: "tickets", ticketTypeIds: [typeId] }) },
    now,
  );
  must(back, "back to tickets");
  assert.deepEqual(await linksOf(tickets.eventId), [typeId]);
});

dbTest("createEventCore: French validation, notice against horizon, and the number of séances created", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const empty = await createEventCore(db, ctx, eventInput(pro, now, { title: "" }), now);
  assert.equal(outcome(empty), "Titre : ce champ est obligatoire.");

  const tooLong = await createEventCore(
    db,
    ctx,
    eventInput(pro, now, { overrides: { bookingHorizonDays: 3, minNoticeMinutes: 5000, cancelDeadlineHours: null } }),
    now,
  );
  assert.equal(outcome(tooLong), NOTICE_TOO_LONG);
  const edge = await createEventCore(
    db,
    ctx,
    eventInput(pro, now, { overrides: { bookingHorizonDays: 3, minNoticeMinutes: 4320, cancelDeadlineHours: null } }),
    now,
  );
  must(edge, "a notice equal to the horizon still opens bookings");

  const series = await createEventCore(
    db,
    ctx,
    eventInput(pro, now, { rule: weekly(dayIn(pro, 1, now), [1, 3], { endMode: "count", occurrenceCount: 5 }) }),
    now,
  );
  must(series, "weekly, 5 séances");
  assert.equal(series.occurrenceCount, 5);
  assert.equal((await occurrencesOf(db, series.eventId)).length, 5);
});

/* ───────────────────────────── editEventInfoCore ───────────────────────────── */

dbTest("editEventInfoCore: a stale version gets the stale wording, the next save with the new version works", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await makeEvent(db, pro, { title: "Avant" });
  const first = await editEventInfoCore(db, ctx, { eventId, seenVersion: 1, info: infoOf({ title: "Après" }) }, now);
  must(first, "first save");
  assert.equal(first.version, 2);

  const stale = await editEventInfoCore(db, ctx, { eventId, seenVersion: 1, info: infoOf({ title: "Encore" }) }, now);
  assert.deepEqual(stale, { ok: false, error: STALE, code: "stale" });
  assert.equal((await getEvent(db, eventId)).title, "Après");

  const again = await editEventInfoCore(db, ctx, { eventId, seenVersion: first.version, info: infoOf({ title: "Encore" }) }, now);
  must(again, "second save with the fresh version");
  assert.equal(again.version, 3);
  assert.equal((await getEvent(db, eventId)).title, "Encore");
});

dbTest("editEventInfoCore: a new location warns the registered clients; a title alone only re-syncs Google", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occurrences[0].id,
    customerId,
    asGuest: true,
  });
  must(reg, "register");

  const moved = await editEventInfoCore(
    db,
    ctx,
    { eventId, seenVersion: 1, info: infoOf({ location: "Nouveau lieu", ticketTypeIds: [typeId] }) },
    now,
  );
  must(moved, "new location");
  assert.deepEqual(moved.effects, [
    { type: "email.occurrence_changed", occurrenceId: occurrences[0].id, bookingIds: [reg.bookingId] },
    { type: "google.sync_occurrence", occurrenceId: occurrences[0].id },
  ]);
  assert.equal((await getEvent(db, eventId)).location, "Nouveau lieu");

  const renamed = await editEventInfoCore(
    db,
    ctx,
    { eventId, seenVersion: moved.version, info: infoOf({ title: "Autre titre", location: "Nouveau lieu", ticketTypeIds: [typeId] }) },
    now,
  );
  must(renamed, "title only");
  assert.deepEqual(renamed.effects, [{ type: "google.sync_occurrence", occurrenceId: occurrences[0].id }]);
});

dbTest("editEventInfoCore: a linked type archived since can stay, a new archived one cannot", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const a = await makeType(db, pro);
  const b = await makeType(db, pro);
  const c = await makeType(db, pro);
  const { eventId } = await makeEvent(db, pro, { ticketTypeIds: [a, b] });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: b, archived: true }), "archive b");
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: c, archived: true }), "archive c");

  const keep = await editEventInfoCore(db, ctx, { eventId, seenVersion: 1, info: infoOf({ ticketTypeIds: [a, b, a] }) }, now);
  must(keep, "the archived but linked type stays (and the duplicate is ignored)");
  const add = await editEventInfoCore(db, ctx, { eventId, seenVersion: keep.version, info: infoOf({ ticketTypeIds: [a, b, c] }) }, now);
  assert.equal(outcome(add), EVENT_TYPE_UNAVAILABLE);
  const drop = await editEventInfoCore(db, ctx, { eventId, seenVersion: keep.version, info: infoOf({ ticketTypeIds: [a] }) }, now);
  must(drop, "unticking the archived type");
  const links = await db.select().from(eventTicketType).where(eq(eventTicketType.eventId, eventId)).orderBy(asc(eventTicketType.ticketTypeId));
  assert.deepEqual(
    links.map((l) => l.ticketTypeId),
    [a],
  );
});

dbTest("editEventInfoCore: the capacity reaches the séances to come", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { capacity: 12 });
  const res = await editEventInfoCore(db, ctx, { eventId, seenVersion: 1, info: infoOf({ capacity: 8 }) }, now);
  must(res, "capacity");
  assert.equal((await getEvent(db, eventId)).capacity, 8);
  assert.equal((await getOccurrence(db, occurrences[0].id)).capacity, 8);
});

dbTest("editEventInfoCore: French validation, notice against horizon and another pro's event", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await makeEvent(db, pro);
  const empty = await editEventInfoCore(db, ctx, { eventId, seenVersion: 1, info: infoOf({ title: "" }) }, now);
  assert.equal(outcome(empty), "Titre : ce champ est obligatoire.");
  const tooLong = await editEventInfoCore(
    db,
    ctx,
    { eventId, seenVersion: 1, info: infoOf({ overrides: { bookingHorizonDays: 3, minNoticeMinutes: 5000, cancelDeadlineHours: null } }) },
    now,
  );
  assert.equal(outcome(tooLong), NOTICE_TOO_LONG);

  const other = await createTestPro(db);
  try {
    const foreign = await editEventInfoCore(db, proCtx(other), { eventId, seenVersion: 1, info: infoOf({ title: "Piraté" }) }, now);
    assert.equal(outcome(foreign), NOT_FOUND);
    assert.notEqual((await getEvent(db, eventId)).title, "Piraté");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────────────────────── previewScheduleCore / applyScheduleCore ───────────────────────────── */

dbTest("previewScheduleCore: both texts, the cut kind, the remaining count and the RDV conflicts", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const future = await futureRows(db, eventId, now);
  const d = future[0].seriesDate ?? "";
  const rule = weekly(d, [2, 4]);

  // one RDV overlapping the first new séance, one far from it, one cancelled
  const [first] = expand({ ...rule, durationMin: 60 }, pro.tz, d, addDays(d, 14));
  const rdvType = await rowRdvType(db, pro);
  const overlapping = await rowRdv(db, pro, rdvType, { startsAt: new Date(first.startsAt.getTime() + 30 * 60_000), durationMin: 60 });
  await rowBooking(db, pro, { occurrenceId: overlapping, customerId: await rowCustomer(db, pro) });
  const far = await rowRdv(db, pro, rdvType, { startsAt: new Date(first.startsAt.getTime() + 4 * 3_600_000), durationMin: 60 });
  await rowBooking(db, pro, { occurrenceId: far, customerId: await rowCustomer(db, pro) });
  await rowRdv(db, pro, rdvType, { startsAt: new Date(first.startsAt.getTime() + 3 * DAY), durationMin: 60, status: "cancelled", seatsTaken: 0 });

  const res = await previewScheduleCore(db, ctx, { eventId, fromDate: d, rule, durationMin: 60 }, now);
  must(res, "preview");
  const p = res.preview;
  assert.equal(p.inPlace, false, "séances precede the cut: it splits");
  assert.equal(p.remainingCount, null);
  assert.equal(p.rdvConflicts, 1);
  assert.equal(p.summary.orphans, 0);
  assert.equal(p.summary.modified, 0);
  assert.equal(p.summary.deleted, future.length, "every Monday, Wednesday and Friday séance to come disappears");
  assert.ok(p.summary.inserted > 0);
  assert.equal(p.textKeep, `${p.summary.deleted} séances supprimées, ${p.summary.inserted} séances ajoutées`);
  assert.equal(p.textCancel, p.textKeep, "no booked séance: both choices read the same");
  assert.equal((await getEvent(db, eventId)).version, 1, "a preview writes nothing");
});

dbTest("previewScheduleCore: a booked séance that disappears reads differently under « Garder » and « Annuler »", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const future = await futureRows(db, eventId, now);
  const d = future[0].seriesDate ?? "";
  const customerId = await makeCustomer(db, pro);
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: future[0].id, customerId, asGuest: true }),
    "register",
  );
  const res = await previewScheduleCore(db, proCtx(pro), { eventId, fromDate: d, rule: weekly(d, [2, 4]), durationMin: 60 }, now);
  must(res, "preview");
  assert.equal(res.preview.summary.orphans, 1);
  assert.match(res.preview.textKeep, /1 séance gardée à part/);
  assert.doesNotMatch(res.preview.textKeep, /annulée/);
  assert.match(res.preview.textCancel, /1 séance annulée/);
  assert.doesNotMatch(res.preview.textCancel, /gardée à part/);
});

dbTest("previewScheduleCore: French refusals, the engine's own texts and another pro's event", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const d = (await futureRows(db, eventId, now))[0].seriesDate ?? "";
  const base = { eventId, fromDate: d, rule: weekly(d, [2, 4]), durationMin: 60 };

  const endsBefore = await previewScheduleCore(
    db,
    ctx,
    { ...base, rule: weekly(d, [2, 4], { endMode: "until", untilDate: addDays(d, -1) }) },
    now,
  );
  assert.equal(outcome(endsBefore), "La fin précède le début.");
  const badDuration = await previewScheduleCore(db, ctx, { ...base, durationMin: 7 }, now);
  assert.equal(outcome(badDuration), "Durée : choisissez un multiple de 5.");
  const past = await previewScheduleCore(db, ctx, { ...base, fromDate: dayIn(pro, -3, now) }, now);
  assert.equal(outcome(past), "La modification doit partir d'aujourd'hui ou d'une date future.");
  const unknown = await previewScheduleCore(db, ctx, { ...base, eventId: "unknown-event" }, now);
  assert.equal(outcome(unknown), NOT_FOUND);

  const other = await createTestPro(db);
  try {
    const foreign = await previewScheduleCore(db, proCtx(other), base, now);
    assert.equal(outcome(foreign), NOT_FOUND);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("applyScheduleCore: a series with past séances splits and returns the new segment; the text is the preview's", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const d = (await futureRows(db, eventId, now))[0].seriesDate ?? "";
  const rule = weekly(d, [2, 4]);
  const preview = await previewScheduleCore(db, ctx, { eventId, fromDate: d, rule, durationMin: 60 }, now);
  must(preview, "preview");

  const res = await applyScheduleCore(db, ctx, { eventId, seenVersion: 1, fromDate: d, rule, durationMin: 60, orphans: "keep" }, now);
  must(res, "apply");
  assert.notEqual(res.eventId, eventId, "the new segment");
  assert.equal(res.summaryText, preview.preview.textKeep);
  assert.deepEqual(res.effects, []);
  const old = await getEvent(db, eventId);
  assert.equal(old.untilDate, addDays(d, -1));
  assert.equal(old.version, 2);
  assert.equal((await getEvent(db, res.eventId)).seriesRootId, eventId);
});

dbTest("applyScheduleCore: nothing precedes the cut, so the same event changes in place", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro);
  const day = occurrences[0].seriesDate ?? "";
  const res = await applyScheduleCore(
    db,
    ctx,
    { eventId, seenVersion: 1, fromDate: day, rule: onceRule(day, 660), durationMin: 60, orphans: "keep" },
    now,
  );
  must(res, "retime");
  assert.equal(res.eventId, eventId);
  assert.equal(res.summaryText, "1 séance modifiée");
  assert.equal((await getEvent(db, eventId)).startMinute, 660);
  assert.equal((await getEvent(db, eventId)).version, 2);
});

dbTest("applyScheduleCore: « Annuler » cancels a booked séance that disappears and returns its ticket", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { typeId, eventId } = await pastSeries(h, now);
  const future = await futureRows(db, eventId, now);
  const d = future[0].seriesDate ?? "";
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: future[0].id,
    customerId,
    asGuest: false,
  });
  must(reg, "register with a ticket");

  const res = await applyScheduleCore(
    db,
    ctx,
    { eventId, seenVersion: 1, fromDate: d, rule: weekly(d, [2, 4]), durationMin: 60, orphans: "cancel" },
    now,
  );
  must(res, "apply");
  assert.ok(res.summaryText.includes("1 séance annulée (1 ticket rendu)"), res.summaryText);
  assert.ok(
    res.effects.some((e) => e.type === "email.occurrence_cancelled" && e.occurrenceId === future[0].id && e.bookingIds.includes(reg.bookingId)),
    "the registered client is told",
  );
  const [ticket] = await ticketsOf(db, customerId);
  assert.equal(ticket.status, "available");
});

dbTest("applyScheduleCore: the engine refusal « La série change déjà à partir du … » passes through", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId: root } = await pastSeries(h, now);
  const future = await futureRows(db, root, now);
  const d1 = future[0].seriesDate ?? "";
  const d2 = future[3].seriesDate ?? "";
  const rule1 = weekly(d1, [1, 3, 5]);

  const second = await applyScheduleCore(db, ctx, { eventId: root, seenVersion: 1, fromDate: d1, rule: rule1, durationMin: 60, orphans: "keep" }, now);
  must(second, "first cut");
  const third = await applyScheduleCore(
    db,
    ctx,
    { eventId: second.eventId, seenVersion: 1, fromDate: d2, rule: weekly(d2, [1, 3, 5]), durationMin: 60, orphans: "keep" },
    now,
  );
  must(third, "second cut");

  const refused = await applyScheduleCore(
    db,
    ctx,
    { eventId: second.eventId, seenVersion: 2, fromDate: d1, rule: rule1, durationMin: 60, orphans: "keep" },
    now,
  );
  assert.equal(
    outcome(refused),
    `La série change déjà à partir du ${formatDayMonthYear(d2)} : modifiez-la depuis cette date, ou terminez celle-ci avant.`,
  );
}, { timeout: 240_000 });

dbTest("previewScheduleCore and applyScheduleCore: a new rule may start at most 730 days from today, like a creation", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = MIDDAY_PARIS;
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: onceRule(dayIn(pro, 3, now)) }, now);
  const fromDate = occurrences[0].seriesDate ?? "";
  const ruleAt = (offset: number) => weekly(dayIn(pro, offset, now), [1], { endMode: "count", occurrenceCount: 3 });

  const farPreview = await previewScheduleCore(db, ctx, { eventId, fromDate, rule: ruleAt(731), durationMin: 60 }, now);
  assert.equal(outcome(farPreview), EVENT_START_TOO_FAR, "a typo year");
  const farApply = await applyScheduleCore(
    db,
    ctx,
    { eventId, seenVersion: 1, fromDate, rule: ruleAt(731), durationMin: 60, orphans: "keep" },
    now,
  );
  assert.equal(outcome(farApply), EVENT_START_TOO_FAR);
  assert.equal((await getEvent(db, eventId)).version, 1, "nothing was written");
  assert.equal((await occurrencesOf(db, eventId)).length, 1);

  // The day 730 is still allowed (the same bound as a creation).
  const edge = await previewScheduleCore(db, ctx, { eventId, fromDate, rule: ruleAt(730), durationMin: 60 }, now);
  must(edge, "the 730th day");
});

dbTest("applyScheduleCore: a stale version and another pro's event", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const d = (await futureRows(db, eventId, now))[0].seriesDate ?? "";
  const input = { eventId, seenVersion: 9, fromDate: d, rule: weekly(d, [2, 4]), durationMin: 60, orphans: "keep" as const };
  assert.deepEqual(await applyScheduleCore(db, ctx, input, now), { ok: false, error: STALE, code: "stale" });

  const other = await createTestPro(db);
  try {
    assert.equal(outcome(await applyScheduleCore(db, proCtx(other), { ...input, seenVersion: 1 }, now)), NOT_FOUND);
  } finally {
    await deleteTestUser(db, other.userId);
  }
  assert.equal((await getEvent(db, eventId)).version, 1, "nothing changed");
});

/* ───────────────────────────── Delete ───────────────────────────── */

dbTest("deleteEventPreviewCore and deleteEventFromCore: a never-booked event goes whole; refusals are French", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro);
  const fromDate = occurrences[0].seriesDate ?? "";

  const preview = await deleteEventPreviewCore(db, ctx, { eventId, fromDate }, now);
  must(preview, "preview");
  assert.deepEqual(preview.preview, { fromDate, deleteWhole: true, deletedSeances: 1, cancelledSeances: 0, registrants: 0, ticketsReturned: 0 });
  const past = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: dayIn(pro, -1, now) }, now);
  assert.equal(outcome(past), "La modification doit partir d'aujourd'hui ou d'une date future.");

  const other = await createTestPro(db);
  try {
    assert.equal(outcome(await deleteEventPreviewCore(db, proCtx(other), { eventId, fromDate }, now)), NOT_FOUND);
    assert.equal(outcome(await deleteEventFromCore(db, proCtx(other), { eventId, seenVersion: 1, fromDate }, now)), NOT_FOUND);
  } finally {
    await deleteTestUser(db, other.userId);
  }
  assert.ok(await getEvent(db, eventId), "the other pro deleted nothing");

  const del = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 1, fromDate }, now);
  must(del, "delete");
  assert.equal(del.deletedEvent, true);
  assert.equal(del.cancelledOccurrences, 0);
  assert.equal(del.deletedOccurrences, 1);
  assert.deepEqual(del.effects, []);
  assert.equal(await getEvent(db, eventId), undefined);
  assert.equal(outcome(await deleteEventPreviewCore(db, ctx, { eventId, fromDate }, now)), NOT_FOUND);
});

dbTest("deleteEventFromCore: a booked event is archived, its client told, and the preview announced it", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occurrences[0].id,
    customerId,
    asGuest: false,
  });
  must(reg, "register with a ticket");
  const fromDate = occurrences[0].seriesDate ?? "";

  const preview = await deleteEventPreviewCore(db, ctx, { eventId, fromDate }, now);
  must(preview, "preview");
  assert.deepEqual(preview.preview, { fromDate, deleteWhole: false, deletedSeances: 0, cancelledSeances: 1, registrants: 1, ticketsReturned: 1 });

  const del = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 1, fromDate }, now);
  must(del, "delete");
  assert.equal(del.deletedEvent, false);
  assert.equal(del.cancelledOccurrences, preview.preview.cancelledSeances);
  assert.equal(del.deletedOccurrences, preview.preview.deletedSeances);
  assert.ok(del.effects.some((e) => e.type === "email.occurrence_cancelled" && e.bookingIds.includes(reg.bookingId)));
  assert.notEqual((await getEvent(db, eventId)).archivedAt, null);
  assert.equal((await ticketsOf(db, customerId))[0].status, "available");

  const again = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 2, fromDate }, now);
  assert.equal(outcome(again), NOT_FOUND, "an archived event is finished");
});

dbTest("deleteEventPreviewCore: a séance that has already started refuses like the delete does", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = AFTERNOON_PARIS; // 15:00 in Paris
  const today = dayIn(pro, 0, now);
  // the engine itself accepts a started séance: today at 10:00, five hours before `now`
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: { startDate: today, startMinute: 600 } }, now);
  assert.equal(occurrences.length, 1);

  const preview = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: today }, now);
  assert.equal(outcome(preview), SEANCE_STARTED);
  const del = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 1, fromDate: today }, now);
  assert.equal(outcome(del), SEANCE_STARTED, "the preview and the delete say the same");
  assert.ok(await getEvent(db, eventId), "nothing was deleted");

  const tomorrow = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: addDays(today, 1) }, now);
  must(tomorrow, "from tomorrow no started séance is concerned");
  assert.equal(tomorrow.preview.deletedSeances + tomorrow.preview.cancelledSeances, 0);
});

dbTest("deleteEventPreviewCore: like the engine, a cancelled séance that has started also refuses", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = AFTERNOON_PARIS;
  const today = dayIn(pro, 0, now);
  const { eventId, occurrences } = await makeEvent(
    db,
    pro,
    { rule: { startDate: today, startMinute: 600, freq: "weekly", weekdays: [dayOfWeek(today)], endMode: "count", occurrenceCount: 2 } },
    now,
  );
  assert.equal(occurrences.length, 2);
  await db.update(occurrence).set({ status: "cancelled", cancelledAt: now }).where(eq(occurrence.id, occurrences[0].id));

  const preview = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: today }, now);
  assert.equal(outcome(preview), SEANCE_STARTED, "series.ts does not filter on the status");
  const del = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 1, fromDate: today }, now);
  assert.equal(outcome(del), SEANCE_STARTED);
});

dbTest("deleteEventPreviewCore: a booked séance left before the start refuses the archive like the delete does", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const d1 = dayIn(pro, 2, now);
  const d2 = dayIn(pro, 4, now);
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: d1 } }, now);
  const customerId = await makeCustomer(db, pro);
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occurrences[0].id, customerId, asGuest: true }),
    "register",
  );
  // moving the series to d2 keeps the booked séance of d1 apart, before the new start
  const moved = await applyScheduleCore(
    db,
    ctx,
    { eventId, seenVersion: 1, fromDate: d1, rule: onceRule(d2), durationMin: 60, orphans: "keep" },
    now,
  );
  must(moved, "move to d2, keeping the booked séance");
  assert.equal(moved.eventId, eventId, "nothing precedes d1: the same event changes in place");
  assert.equal((await getEvent(db, eventId)).startDate, d2);
  assert.equal((await futureRows(db, eventId, now)).length, 2, "the kept séance of d1 and the new one of d2");

  const preview = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: d2 }, now);
  assert.equal(outcome(preview), LEFTOVER_BEFORE);
  const del = await deleteEventFromCore(db, ctx, { eventId, seenVersion: 2, fromDate: d2 }, now);
  assert.equal(outcome(del), LEFTOVER_BEFORE, "the preview and the delete say the same");
  assert.equal((await getEvent(db, eventId)).archivedAt, null, "nothing was archived");

  const fromD1 = await deleteEventPreviewCore(db, ctx, { eventId, fromDate: d1 }, now);
  must(fromD1, "from d1 nothing is left before the cut");
  assert.deepEqual(fromD1.preview, { fromDate: d1, deleteWhole: false, deletedSeances: 1, cancelledSeances: 1, registrants: 1, ticketsReturned: 0 });
});

/* ───────────────────────────── previewNewEventCore ───────────────────────────── */

dbTest("previewNewEventCore: the séances the rule would create and their RDV conflicts, nothing written", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const rule = weekly(dayIn(pro, 2, now), [1, 3], { endMode: "count", occurrenceCount: 5 });
  const dates = expand({ ...rule, durationMin: 60 }, pro.tz, rule.startDate, addDays(rule.startDate, 60));
  const rdv = await rowRdv(db, pro, await rowRdvType(db, pro), { startsAt: dates[1].startsAt, durationMin: 30 });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) });

  const res = await previewNewEventCore(db, ctx, { rule, durationMin: 60 }, now);
  must(res, "preview");
  assert.equal(res.occurrenceCount, 5);
  assert.equal(res.rdvConflicts, 1);

  const endless = await previewNewEventCore(
    db,
    ctx,
    { rule: weekly(dayIn(pro, 1, now), [0, 1, 2, 3, 4, 5, 6]), durationMin: 60 },
    now,
  );
  must(endless, "an endless rule");
  assert.equal(endless.occurrenceCount, 400, "from tomorrow to today + 400");

  const invalid = await previewNewEventCore(
    db,
    ctx,
    { rule: weekly(dayIn(pro, 1, now), [1], { endMode: "until", untilDate: dayIn(pro, 0, now) }), durationMin: 60 },
    now,
  );
  assert.equal(outcome(invalid), "La fin précède le début.");
  assert.equal((await db.select().from(event).where(eq(event.professionalId, pro.proId))).length, 0, "a preview creates nothing");
});

dbTest("previewNewEventCore: refuses the start dates createEventCore refuses, with the same texts", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = AFTERNOON_PARIS; // 15:00 in Paris
  const today = dayIn(pro, 0, now);
  const cases: [string, RecurrenceRuleInput, string][] = [
    ["a past day", onceRule(addDays(today, -1)), EVENT_START_PAST],
    ["today at 10:00, already started", onceRule(today, 600), EVENT_START_PAST],
    ["a series whose first séance is today at 10:00", weekly(today, [dayOfWeek(today)]), EVENT_START_PAST],
    ["today + 731", onceRule(addDays(today, 731)), EVENT_START_TOO_FAR],
  ];
  for (const [what, rule, message] of cases) {
    const preview = await previewNewEventCore(db, ctx, { rule, durationMin: 60 }, now);
    assert.equal(outcome(preview), message, `preview: ${what}`);
    const created = await createEventCore(db, ctx, { title: "Cours", rule }, now);
    assert.equal(outcome(created), message, `create: ${what}`);
  }

  const later = await previewNewEventCore(db, ctx, { rule: onceRule(today, 1020), durationMin: 60 }, now);
  must(later, "today at 17:00 is still to come");
  assert.equal(later.occurrenceCount, 1);
  const limit = await previewNewEventCore(db, ctx, { rule: onceRule(addDays(today, 730)), durationMin: 60 }, now);
  must(limit, "today + 730 is allowed");
  assert.equal(limit.occurrenceCount, 0, "beyond the 400-day horizon nothing is materialised yet");
  assert.equal((await db.select().from(event).where(eq(event.professionalId, pro.proId))).length, 0, "nothing was created");
});
