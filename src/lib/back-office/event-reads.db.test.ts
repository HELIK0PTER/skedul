import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, type DbHarness } from "../../test/db";
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
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowType,
} from "../../test/rows";
import { setTicketTypeArchived } from "../booking/catalog";
import { registerPro } from "../booking/claims";
import { deleteSeriesFrom, editSeriesFrom } from "../booking/series";
import { addDays } from "../civil-date";
import type { Db } from "../db/atomic";
import { event, occurrence } from "../db/schema";
import type { RecurrenceRuleInput } from "../tickets";
import {
  countRdvConflicts,
  deleteFromPreview,
  getEventEditor,
  listEvents,
  type EventEditorData,
  type EventEditorLookup,
} from "./event-reads";

const DAY = 86_400_000;

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

function editorOf(lookup: EventEditorLookup): EventEditorData {
  assert.ok(lookup !== null && lookup.kind === "ok", `expected an editor, got ${JSON.stringify(lookup)}`);
  return lookup.data;
}

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

/** A Mon / Wed / Fri 10:00 series created 14 days ago, so that séances exist before now. */
async function pastSeries({ db, pro }: DbHarness, now: Date, title = "Série passée") {
  const typeId = await makeType(db, pro);
  const { eventId } = await makeEvent(
    db,
    pro,
    { title, ticketTypeIds: [typeId], rule: weekly(dayIn(pro, -14, now), [1, 3, 5]) },
    addDaysMs(now, -14),
  );
  return { typeId, eventId };
}

/** The first scheduled séance of the event after `now`. */
async function firstFuture(db: Db, eventId: string, now: Date) {
  const row = (await occurrencesOf(db, eventId)).find((o) => o.status === "scheduled" && o.startsAt.getTime() > now.getTime());
  assert.ok(row, "a séance after now");
  return row;
}

dbTest("listEvents: one row per series after a split, on the segment that owns the next séance", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { typeId, eventId } = await pastSeries(h, now);
  const d = (await firstFuture(db, eventId, now)).seriesDate ?? "";
  const cut = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId,
      seenVersion: 1,
      fromDate: d,
      rule: weekly(d, [1, 3]),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(cut, "split");
  assert.notEqual(cut.eventId, eventId);

  const { live, ended } = await listEvents(db, pro.proId, now);
  assert.equal(ended.length, 0);
  assert.equal(live.length, 1);
  const row = live[0];
  assert.equal(row.eventId, cut.eventId);
  assert.equal(row.seriesRootId, eventId);
  assert.equal(row.title, "Série passée");
  assert.equal(row.recurrenceLabel, "Toutes les semaines le lundi et le mercredi");
  assert.deepEqual(
    row.acceptedTypes.map((t) => [t.id, t.archived]),
    [[typeId, false]],
  );
  assert.equal(row.noActiveType, false);
  const next = await firstFuture(db, cut.eventId, now);
  assert.deepEqual(row.nextOccurrence, { id: next.id, startsAt: next.startsAt });
});

dbTest("listEvents: noActiveType in tickets mode only (no type, only archived types, an active one, free mode)", async ({ db, pro }) => {
  const now = new Date();
  const active = await makeType(db, pro);
  const archived = await makeType(db, pro);
  const none = (await makeEvent(db, pro, { title: "Sans type" })).eventId;
  const onlyArchived = (await makeEvent(db, pro, { title: "Type archivé", ticketTypeIds: [archived] })).eventId;
  const mixed = (await makeEvent(db, pro, { title: "Deux types", ticketTypeIds: [active, archived] })).eventId;
  const free = (await makeEvent(db, pro, { title: "Inscription libre", bookingMode: "free" })).eventId;
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");

  const { live } = await listEvents(db, pro.proId, now);
  const byId = new Map(live.map((r) => [r.eventId, r]));
  assert.equal(byId.get(none)?.noActiveType, true);
  assert.deepEqual(byId.get(none)?.acceptedTypes, []);
  assert.equal(byId.get(onlyArchived)?.noActiveType, true);
  assert.deepEqual(
    byId.get(onlyArchived)?.acceptedTypes.map((t) => [t.id, t.archived]),
    [[archived, true]],
  );
  assert.equal(byId.get(mixed)?.noActiveType, false);
  assert.deepEqual(
    byId.get(mixed)?.acceptedTypes.map((t) => [t.id, t.archived]),
    [
      [active, false],
      [archived, true],
    ],
  );
  assert.equal(byId.get(free)?.noActiveType, false);
  assert.equal(byId.get(free)?.bookingMode, "free");
});

dbTest("listEvents: live by next séance then title, a finished series last; ended by latest start date", async ({ db, pro }) => {
  const now = new Date();
  const at = (days: number) => ({ startDate: dayIn(pro, days, now) });
  await makeEvent(db, pro, { title: "Charlie", rule: at(5) });
  await makeEvent(db, pro, { title: "Bravo", rule: at(2) });
  await makeEvent(db, pro, { title: "Alpha", rule: at(2) });
  await makeEvent(db, pro, { title: "Passé", rule: at(-3) }, addDaysMs(now, -5));
  const older = await makeEvent(db, pro, { title: "Terminé ancien", rule: at(-30) }, addDaysMs(now, -32));
  const recent = await makeEvent(db, pro, { title: "Terminé récent", rule: at(-10) }, addDaysMs(now, -12));
  await db.update(event).set({ archivedAt: now }).where(eq(event.id, older.eventId));
  await db.update(event).set({ archivedAt: now }).where(eq(event.id, recent.eventId));

  const { live, ended } = await listEvents(db, pro.proId, now);
  assert.deepEqual(
    live.map((r) => r.title),
    ["Alpha", "Bravo", "Charlie", "Passé"],
  );
  assert.equal(live[3].nextOccurrence, null);
  assert.deepEqual(
    ended.map((r) => [r.title, r.nextOccurrence]),
    [
      ["Terminé récent", null],
      ["Terminé ancien", null],
    ],
  );
});

dbTest("getEventEditor: the current segment with its cut date, remaining count, types and window", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours A" });
  const { eventId, occurrences } = await makeEvent(
    db,
    pro,
    {
      title: "Série comptée",
      capacity: 8,
      durationMin: 90,
      ticketTypeIds: [typeId],
      rule: weekly(dayIn(pro, -14, now), [1, 3, 5], { endMode: "count", occurrenceCount: 12 }),
    },
    addDaysMs(now, -14),
  );
  const future = occurrences.filter((o) => o.startsAt.getTime() > now.getTime());
  assert.ok(future.length > 0 && future.length < occurrences.length, "some séances are past, some to come");

  const data = editorOf(await getEventEditor(db, pro.proId, eventId, now));
  assert.equal(data.event.id, eventId);
  assert.equal(data.event.seriesRootId, eventId);
  assert.equal(data.event.version, 1);
  assert.equal(data.event.title, "Série comptée");
  assert.equal(data.event.capacity, 8);
  assert.equal(data.event.durationMin, 90);
  assert.equal(data.event.bookingMode, "tickets");
  assert.equal(data.event.archived, false);
  assert.deepEqual(data.event.overrides, { bookingHorizonDays: null, minNoticeMinutes: null, cancelDeadlineHours: null });
  assert.deepEqual(data.event.ticketTypeIds, [typeId]);
  assert.deepEqual(data.event.questions, []);
  assert.equal(data.event.rule.freq, "weekly");
  assert.deepEqual(data.event.rule.weekdays, [1, 3, 5]);
  assert.equal(data.event.rule.endMode, "count");
  assert.equal(data.event.rule.occurrenceCount, 12);
  assert.equal(data.event.recurrenceLabel, "Toutes les semaines le lundi, le mercredi et le vendredi, 12 séances");
  assert.equal(data.readOnly, false);
  assert.equal(data.fromDate, future[0].seriesDate);
  assert.equal(data.remainingCount, future.length);
  assert.deepEqual(
    data.upcoming.map((u) => u.id),
    future.slice(0, 10).map((o) => o.id),
  );
  assert.deepEqual(data.upcoming[0], {
    id: future[0].id,
    startsAt: future[0].startsAt,
    endsAt: future[0].endsAt,
    status: "scheduled",
    seatsTaken: 0,
    capacity: 8,
    elapsedHolds: 0,
  });
  assert.deepEqual(data.otherSegments, []);
  assert.deepEqual(
    data.typeOptions.map((t) => t.id),
    [typeId],
  );
  assert.deepEqual(data.linkedArchivedTypes, []);
  assert.equal(data.futureRegistrants, 0);
  assert.deepEqual(data.deletePreview, {
    fromDate: future[0].seriesDate,
    deleteWhole: false,
    deletedSeances: future.length,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    laterSegments: [],
  });
  assert.deepEqual(data.proWindow, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 });
});

dbTest("getEventEditor: the old segment id redirects to the new one, which lists the old as a previous segment", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId } = await pastSeries(h, now);
  const d = (await firstFuture(db, eventId, now)).seriesDate ?? "";
  const cut = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId,
      seenVersion: 1,
      fromDate: d,
      rule: weekly(d, [2, 4]),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(cut, "split");

  assert.deepEqual(await getEventEditor(db, pro.proId, eventId, now), { kind: "redirect", eventId: cut.eventId });
  const fresh = editorOf(await getEventEditor(db, pro.proId, cut.eventId, now));
  assert.equal(fresh.event.id, cut.eventId);
  assert.equal(fresh.event.seriesRootId, eventId);
  assert.equal(fresh.event.version, 1);
  assert.equal(fresh.event.recurrenceLabel, "Toutes les semaines le mardi et le jeudi");
  const next = await firstFuture(db, cut.eventId, now);
  assert.equal(fresh.fromDate, next.seriesDate);
  assert.equal(fresh.remainingCount, null);

  assert.equal(fresh.otherSegments.length, 1);
  const previous = fresh.otherSegments[0];
  assert.equal(previous.eventId, eventId);
  assert.equal(previous.archived, false);
  assert.equal(previous.firstDate, dayIn(pro, -14, now));
  assert.equal(previous.lastDate, addDays(d, -1));
  assert.match(previous.recurrenceLabel, /^Toutes les semaines le lundi, le mercredi et le vendredi, jusqu'au \d{2}\/\d{2}(\/\d{4})?$/);
});

/**
 * A Mon / Wed / Fri series of 8 séances starting the day after tomorrow, cut (« cette séance et les suivantes ») at its
 * 4th séance: A keeps the 3 séances before the cut, B (a later segment, same series) owns the 5 others. Both are live.
 */
async function twoLiveSegments({ db, pro }: DbHarness, now: Date) {
  const typeId = await makeType(db, pro);
  const first = await makeEvent(
    db,
    pro,
    { title: "Roda", ticketTypeIds: [typeId], rule: weekly(dayIn(pro, 2, now), [1, 3, 5], { endMode: "count", occurrenceCount: 8 }) },
    now,
  );
  const cutDate = first.occurrences[3].seriesDate ?? "";
  const cut = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId: first.eventId,
      seenVersion: 1,
      fromDate: cutDate,
      rule: weekly(cutDate, [1, 3, 5], { endMode: "count", occurrenceCount: 5 }),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(cut, "split");
  return {
    typeId,
    a: first.eventId,
    b: cut.eventId,
    cutDate,
    aRows: await occurrencesOf(db, first.eventId),
    bRows: await occurrencesOf(db, cut.eventId),
  };
}

dbTest("getEventEditor: a later segment that still has séances to come opens on its own and is listed with a link", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { a, b, cutDate, aRows, bRows } = await twoLiveSegments(h, now);
  assert.deepEqual([aRows.length, bRows.length], [3, 5], "the planning split leaves séances to come on both segments");

  const onA = editorOf(await getEventEditor(db, pro.proId, a, now));
  assert.equal(onA.event.id, a);
  assert.deepEqual(onA.laterSegments, [{ eventId: b, version: 1 }]);
  assert.deepEqual(
    onA.otherSegments.map((s) => [s.eventId, s.live, s.archived, s.firstDate]),
    [[b, true, false, cutDate]],
  );

  const onB = editorOf(await getEventEditor(db, pro.proId, b, now));
  assert.equal(onB.event.id, b, "no redirect back to the earlier segment");
  assert.equal(onB.fromDate, bRows[0].seriesDate);
  assert.deepEqual(onB.laterSegments, []);
  assert.deepEqual(
    onB.otherSegments.map((s) => [s.eventId, s.live]),
    [[a, true]],
  );

  const { live } = await listEvents(db, pro.proId, now);
  assert.deepEqual(
    live.map((r) => r.eventId),
    [a],
    "the list still has one row per series, on the segment that owns the next séance",
  );
});

dbTest("deleteFromPreview: the later segments are counted and listed with their version; the editor warns their registrants too", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { typeId, a, b, cutDate, aRows, bRows } = await twoLiveSegments(h, now);
  const from = aRows[0].seriesDate ?? "";

  assert.deepEqual(await deleteFromPreview(db, pro.proId, a, from, now), {
    fromDate: from,
    deleteWhole: true,
    deletedSeances: 8,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    laterSegments: [{ eventId: b, version: 1 }],
  });
  // From the later segment alone: only its own séances.
  assert.deepEqual(await deleteFromPreview(db, pro.proId, b, cutDate, now), {
    fromDate: cutDate,
    deleteWhole: true,
    deletedSeances: 5,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    laterSegments: [],
  });
  // A date after the earlier segment's last séance still reaches the later one (it was a no-op before).
  const late = bRows[2].seriesDate ?? "";
  assert.deepEqual(await deleteFromPreview(db, pro.proId, a, late, now), {
    fromDate: late,
    deleteWhole: false,
    deletedSeances: 3,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    laterSegments: [{ eventId: b, version: 1 }],
  });

  // Registrants of a later séance: counted in the delete and warned by a change of place.
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: bRows[1].id, customerId, asGuest: false }),
    "a ticket booking on the later segment",
  );
  assert.deepEqual(await deleteFromPreview(db, pro.proId, a, from, now), {
    fromDate: from,
    deleteWhole: false,
    deletedSeances: 7,
    cancelledSeances: 1,
    registrants: 1,
    ticketsReturned: 1,
    laterSegments: [{ eventId: b, version: 1 }],
  });
  const data = editorOf(await getEventEditor(db, pro.proId, a, now));
  assert.equal(data.futureRegistrants, 1, "the registrant of the later segment is warned by a change of place too");
  assert.equal(data.deletePreview?.cancelledSeances, 1);
  assert.equal(editorOf(await getEventEditor(db, pro.proId, b, now)).futureRegistrants, 1);
});

dbTest("getEventEditor: an archived series opens read-only and is listed as ended", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { title: "Terminé", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occurrences[0].id, customerId, asGuest: true }),
    "register",
  );
  const start = occurrences[0].seriesDate ?? "";
  must(
    await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: start }, now),
    "archive by deleting from the first séance",
  );

  const { live, ended } = await listEvents(db, pro.proId, now);
  assert.equal(live.length, 0);
  assert.deepEqual(
    ended.map((r) => [r.eventId, r.title, r.nextOccurrence]),
    [[eventId, "Terminé", null]],
  );
  const data = editorOf(await getEventEditor(db, pro.proId, eventId, now));
  assert.equal(data.readOnly, true);
  assert.equal(data.event.archived, true);
  assert.equal(data.fromDate, null);
  assert.equal(data.remainingCount, null);
  assert.equal(data.deletePreview, null);
  assert.equal(data.futureRegistrants, 0);
  assert.equal(await deleteFromPreview(db, pro.proId, eventId, start, now), null);
});

dbTest("getEventEditor: typeOptions without archived or rdv_free types; linked archived types apart", async ({ db, pro }) => {
  const active = await makeType(db, pro, { name: "Actif" });
  const archived = await makeType(db, pro, { name: "Archivé" });
  const gratuit = await makeType(db, pro, { name: "Gratuit", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const { eventId } = await makeEvent(db, pro, { ticketTypeIds: [active, archived] });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");

  const data = editorOf(await getEventEditor(db, pro.proId, eventId, new Date()));
  assert.deepEqual(
    data.typeOptions.map((t) => t.id),
    [active],
  );
  assert.ok(!data.typeOptions.some((t) => t.id === gratuit), "an rdv_free type is not an event ticket type");
  assert.deepEqual(data.linkedArchivedTypes, [{ id: archived, name: "Archivé" }]);
  assert.deepEqual([...data.event.ticketTypeIds].sort(), [active, archived].sort());
});

dbTest("countRdvConflicts: scheduled RDV overlapping a range, buffers included; cancelled ones and touching ends ignored", async ({ db, pro }) => {
  const typeId = await rowRdvType(db, pro);
  const base = new Date(Date.now() + 5 * DAY);
  base.setUTCMinutes(0, 0, 0);
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
  const range = (fromMin: number, toMin: number) => ({ startsAt: at(fromMin), endsAt: at(toMin) });

  // A 10:00-11:00; B 12:00-13:00 with 15 min buffers (block 11:45-13:15); C 14:00-15:00 cancelled
  const a = await rowRdv(db, pro, typeId, { startsAt: at(600), durationMin: 60 });
  await rowBooking(db, pro, { occurrenceId: a, customerId: await rowCustomer(db, pro) });
  const b = await rowRdv(db, pro, typeId, { startsAt: at(720), durationMin: 60 });
  await rowBooking(db, pro, { occurrenceId: b, customerId: await rowCustomer(db, pro) });
  await db
    .update(occurrence)
    .set({ blockStart: at(705), blockEnd: at(795) })
    .where(eq(occurrence.id, b));
  await rowRdv(db, pro, typeId, { startsAt: at(840), durationMin: 60, status: "cancelled", seatsTaken: 0 });

  const now = new Date();
  assert.equal(await countRdvConflicts(db, pro.proId, [], now), 0);
  assert.equal(await countRdvConflicts(db, pro.proId, [range(630, 690)], now), 1, "inside A");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(660, 690)], now), 0, "starts where A ends");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(660, 710)], now), 1, "reaches B's buffer, not B");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(840, 900)], now), 0, "the cancelled RDV");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(630, 690), range(750, 780)], now), 2, "A and B");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(630, 640), range(640, 650)], now), 1, "one RDV hit by two ranges counts once");
});

dbTest("countRdvConflicts: a phantom RDV (an abandoned checkout, its hold lapsed) is ignored, a live hold counts (P5 T13, the slot loader's rule)", async ({ db, pro }) => {
  const typeId = await rowRdvType(db, pro);
  const now = new Date();
  const base = new Date(now.getTime() + 6 * DAY);
  base.setUTCMinutes(0, 0, 0);
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
  const range = (fromMin: number, toMin: number) => ({ startsAt: at(fromMin), endsAt: at(toMin) });
  const customerId = await rowCustomer(db, pro);
  const offerId = await rowOffer(db, pro, typeId);

  // P 10:00 an abandoned checkout (its hold ended a minute ago); L 12:00 a checkout in progress
  const phantom = await rowRdv(db, pro, typeId, { startsAt: at(600), durationMin: 60 });
  await rowBooking(db, pro, {
    occurrenceId: phantom,
    customerId,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }),
    holdExpiresAt: new Date(now.getTime() - 60_000),
  });
  const live = await rowRdv(db, pro, typeId, { startsAt: at(720), durationMin: 60 });
  await rowBooking(db, pro, {
    occurrenceId: live,
    customerId,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }),
    holdExpiresAt: new Date(now.getTime() + 30 * 60_000),
  });

  assert.equal(await countRdvConflicts(db, pro.proId, [range(600, 660)], now), 0, "the abandoned checkout frees its slot");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(720, 780)], now), 1, "a hold still live blocks it");
  assert.equal(await countRdvConflicts(db, pro.proId, [range(600, 900)], now), 1);
  const lapsed = new Date(now.getTime() + 31 * 60_000);
  assert.equal(await countRdvConflicts(db, pro.proId, [range(720, 780)], lapsed), 0, "the same hold once it has lapsed");
});

dbTest("another pro sees none of it: list, editor, delete preview and RDV conflicts", async ({ db, pro }) => {
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { title: "Événement du pro A" });
  const startsAt = occurrences[0].startsAt;
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const rdv = await rowRdv(db, pro, await rowRdvType(db, pro), { startsAt, durationMin: 60 });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) });

  const other = await createTestPro(db);
  try {
    assert.deepEqual(await listEvents(db, other.proId, now), { live: [], ended: [] });
    assert.equal(await getEventEditor(db, other.proId, eventId, now), null);
    assert.equal(await deleteFromPreview(db, other.proId, eventId, occurrences[0].seriesDate ?? "", now), null);
    assert.equal(await countRdvConflicts(db, other.proId, [{ startsAt, endsAt }], now), 0);
    assert.equal(await countRdvConflicts(db, pro.proId, [{ startsAt, endsAt }], now), 1);
    assert.equal(await getEventEditor(db, pro.proId, "unknown-id", now), null);
    assert.equal(editorOf(await getEventEditor(db, pro.proId, eventId, now)).event.title, "Événement du pro A");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("deleteFromPreview: a never-booked event is deleted whole, as deleteSeriesFrom then reports", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(
    db,
    pro,
    { ticketTypeIds: [typeId], rule: weekly(dayIn(pro, 2, now), [1, 3, 5], { endMode: "count", occurrenceCount: 6 }) },
    now,
  );
  const fromDate = occurrences[0].seriesDate ?? "";

  const preview = await deleteFromPreview(db, pro.proId, eventId, fromDate, now);
  assert.deepEqual(preview, {
    fromDate,
    deleteWhole: true,
    deletedSeances: 6,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    laterSegments: [],
  });

  const res = await deleteSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate },
    now,
  );
  must(res, "delete");
  assert.equal(res.deletedEvent, preview?.deleteWhole);
  assert.equal(res.deletedOccurrences, preview?.deletedSeances);
  assert.equal(res.cancelledOccurrences, preview?.cancelledSeances);
});

dbTest("deleteFromPreview and the editor: a booked series, cancelled séances, registrants and tickets, as deleteSeriesFrom then reports", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { typeId, eventId } = await pastSeries(h, now);
  const future = (await occurrencesOf(db, eventId)).filter((o) => o.startsAt.getTime() > now.getTime());
  const d = future[0].seriesDate ?? "";
  const withTicket = await makeCustomer(db, pro);
  await giveTickets(db, pro, withTicket, typeId, 1);
  const guest = await makeCustomer(db, pro);
  const book = (occurrenceId: string, customerId: string, asGuest: boolean) =>
    registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId, customerId, asGuest });
  must(await book(future[0].id, withTicket, false), "ticket booking");
  must(await book(future[0].id, guest, true), "guest booking");
  must(await book(future[1].id, guest, true), "second guest booking");

  const expected = {
    fromDate: d,
    deleteWhole: false,
    deletedSeances: future.length - 2,
    cancelledSeances: 2,
    registrants: 3,
    ticketsReturned: 1,
    laterSegments: [],
  };
  assert.deepEqual(await deleteFromPreview(db, pro.proId, eventId, d, now), expected);

  const data = editorOf(await getEventEditor(db, pro.proId, eventId, now));
  assert.equal(data.futureRegistrants, 3);
  assert.deepEqual(data.deletePreview, expected);
  assert.deepEqual(
    data.upcoming.slice(0, 2).map((u) => u.seatsTaken),
    [2, 1],
  );

  // a séance with its own place is not warned by a change of the event's place
  await db.update(occurrence).set({ locationOverride: "Ailleurs" }).where(eq(occurrence.id, future[1].id));
  assert.equal(editorOf(await getEventEditor(db, pro.proId, eventId, now)).futureRegistrants, 2);

  const res = await deleteSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d },
    now,
  );
  must(res, "delete from the first séance to come");
  assert.equal(res.deletedEvent, expected.deleteWhole);
  assert.equal(res.cancelledOccurrences, expected.cancelledSeances);
  assert.equal(res.deletedOccurrences, expected.deletedSeances);
  const [ticket] = await ticketsOf(db, withTicket);
  assert.equal(ticket.status, "available", "the ticket is back, as the preview said");
});

dbTest("deleteFromPreview: a pending hold that has lapsed is not a registrant", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro, {}, now);
  const liveHold = await rowSeance(db, pro, eventId, { startsAt: new Date(now.getTime() + 3 * DAY), seatsTaken: 1 }, now);
  const lapsedHold = await rowSeance(db, pro, eventId, { startsAt: new Date(now.getTime() + 4 * DAY), seatsTaken: 1 }, now);
  const hold = async (occurrenceId: string, holdExpiresAt: Date) => {
    const customerId = await rowCustomer(db, pro);
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }, now);
    await rowBooking(db, pro, { occurrenceId, customerId, status: "pending", coverage: "ticket", purchaseId, holdExpiresAt }, now);
  };
  await hold(liveHold, new Date(now.getTime() + 45 * 60_000));
  await hold(lapsedHold, new Date(now.getTime() - 60_000));
  const fromDate = (await getOccurrence(db, liveHold)).seriesDate ?? "";

  assert.deepEqual(await deleteFromPreview(db, pro.proId, eventId, fromDate, now), {
    fromDate,
    deleteWhole: false,
    deletedSeances: 0,
    cancelledSeances: 2,
    registrants: 1,
    ticketsReturned: 0,
    laterSegments: [],
  });
});

dbTest("getEventEditor: each upcoming séance counts its lapsed pending holds, the ones the engine releases before a claim", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro, { capacity: 4 }, now);
  const otherEventId = await rowEvent(db, pro, { capacity: 4 }, now);
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const seance = (id: string, days: number, seatsTaken: number) =>
    rowSeance(db, pro, id, { startsAt: at(days), capacity: 4, seatsTaken }, now);
  const hold = async (occurrenceId: string, holdExpiresAt: Date) => {
    const customerId = await rowCustomer(db, pro);
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }, now);
    await rowBooking(db, pro, { occurrenceId, customerId, status: "pending", coverage: "ticket", purchaseId, holdExpiresAt }, now);
  };
  const liveUntil = new Date(now.getTime() + 45 * 60_000);
  const lapsedSince = new Date(now.getTime() - 60_000);

  // a confirmed guest, a live hold and a lapsed hold: only the lapsed one counts
  const mixed = await seance(eventId, 3, 3);
  await rowBooking(db, pro, { occurrenceId: mixed, customerId: await rowCustomer(db, pro) }, now);
  await hold(mixed, liveUntil);
  await hold(mixed, lapsedSince);
  // two lapsed holds, one per customer
  const twice = await seance(eventId, 4, 2);
  await hold(twice, lapsedSince);
  await hold(twice, new Date(now.getTime() - 3_600_000));
  // a live hold only, and an empty séance
  const live = await seance(eventId, 5, 1);
  await hold(live, liveUntil);
  const empty = await seance(eventId, 6, 0);
  // a lapsed hold on another event's séance is that séance's own
  const elsewhere = await seance(otherEventId, 3, 1);
  await hold(elsewhere, lapsedSince);

  const data = editorOf(await getEventEditor(db, pro.proId, eventId, now));
  assert.deepEqual(
    data.upcoming.map((u) => [u.id, u.seatsTaken, u.elapsedHolds]),
    [
      [mixed, 3, 1],
      [twice, 2, 2],
      [live, 1, 0],
      [empty, 0, 0],
    ],
  );
  const other = editorOf(await getEventEditor(db, pro.proId, otherEventId, now));
  assert.deepEqual(
    other.upcoming.map((u) => [u.id, u.seatsTaken, u.elapsedHolds]),
    [[elsewhere, 1, 1]],
  );
});
