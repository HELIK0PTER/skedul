import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { addDaysMs, dbTest, type DbHarness } from "../../test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeType,
  occurrencesOf,
  ticketsOf,
} from "../../test/fixtures";
import { addDays, dayOfWeek, instantAt } from "../civil-date";
import type { Db } from "../db/atomic";
import { event } from "../db/schema";
import { expandDates } from "../recurrence";
import type { RecurrenceRuleInput } from "../tickets";
import { cancelOccurrence, restoreOccurrence } from "./cancel";
import { registerPro } from "./claims";
import { ensureHorizon, horizonEnd } from "./occurrences";
import { deleteSeriesFrom, editSeriesFrom, previewSeriesEdit, updateOccurrence } from "./series";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

const weekly = (startDate: string, weekdays: number[], startMinute = 600): RecurrenceRuleInput => ({
  startDate,
  startMinute,
  freq: "weekly",
  interval: 1,
  weekdays,
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
});

async function getEvent(db: Db, id: string) {
  const [ev] = await db.select().from(event).where(eq(event.id, id));
  return ev;
}

/**
 * A Mon/Wed/Fri 10:00 series created 14 days ago (rows exist before d = tomorrow),
 * materialised up to (then) today + 400 = now + 386 days.
 */
async function pastSeries({ db, pro }: DbHarness, now: Date) {
  const typeId = await makeType(db, pro);
  const { eventId } = await makeEvent(
    db,
    pro,
    { ticketTypeIds: [typeId], rule: weekly(dayIn(pro, -14, now), [1, 3, 5]) },
    addDaysMs(now, -14),
  );
  return { typeId, eventId, d: dayIn(pro, 1, now) };
}

const sorted = (xs: readonly string[]) => [...xs].sort();
const byStart = <T extends { startsAt: Date }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

dbTest(
  "T8a: a claim on a row planned for delete makes the split stale; the re-plan keeps it as an isolated séance",
  async (h) => {
    const { db, pro } = h;
    const now = new Date();
    const { eventId, d } = await pastSeries(h, now);
    const friday = (await occurrencesOf(db, eventId)).find((o) => (o.seriesDate ?? "") >= d && dayOfWeek(o.seriesDate ?? "") === 5);
    assert.ok(friday, "a Friday séance after d");
    const customerId = await makeCustomer(db, pro);
    let bookingId = "";
    const newRule = weekly(d, [1, 3]);

    const res = await editSeriesFrom(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        eventId,
        seenVersion: 1,
        fromDate: d,
        rule: newRule,
        durationMin: 60,
        orphans: "keep",
      },
      now,
      {
        afterPlan: async () => {
          const r = await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: friday.id, customerId, asGuest: true });
          must(r, "claim inside afterPlan");
          bookingId = r.bookingId;
        },
      },
    );
    must(res, "split after one re-plan");
    assert.notEqual(res.eventId, eventId);
    assert.equal(res.summary.orphans, 1);

    const b = await getBooking(db, bookingId);
    assert.equal(b.status, "confirmed");
    const isolated = await getOccurrence(db, friday.id);
    assert.equal(isolated.eventId, res.eventId);
    assert.equal(isolated.timeDetached, true);
    assert.equal(isolated.status, "scheduled");

    const old = await getEvent(db, eventId);
    assert.equal(old.endMode, "until");
    assert.equal(old.untilDate, addDays(d, -1));
    assert.equal(old.version, 2);
    const fresh = await getEvent(db, res.eventId);
    assert.equal(fresh.seriesRootId, old.seriesRootId ?? old.id);

    // no phantom séance: the old segment stops before d, the new one = new-rule dates ∪ the isolated séance
    assert.ok((await occurrencesOf(db, eventId)).every((o) => (o.seriesDate ?? "") < d));
    const expected = expandDates({ ...newRule, durationMin: 60 }, d, horizonEnd(now, pro.tz));
    assert.deepEqual(
      sorted((await occurrencesOf(db, res.eventId)).map((o) => o.seriesDate ?? "")),
      sorted([...expected, friday.seriesDate ?? ""]),
    );
  },
);

dbTest("T8b: ensureHorizon rows inserted after the split's plan make it stale; the re-plan absorbs them", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId, d } = await pastSeries(h, now);
  const newRule = weekly(d, [2, 4], 720);
  const res = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d, rule: newRule, durationMin: 60, orphans: "keep" },
    now,
    {
      afterPlan: async () => {
        const hz = await ensureHorizon(db, pro.proId, now);
        must(hz, "ensureHorizon inside afterPlan");
        assert.ok(hz.inserted > 0, "the series was 14 days behind");
      },
    },
  );
  must(res, "split");
  assert.ok((await occurrencesOf(db, eventId)).every((o) => (o.seriesDate ?? "") < d));
  const expected = expandDates({ ...newRule, durationMin: 60 }, d, horizonEnd(now, pro.tz));
  assert.deepEqual(sorted((await occurrencesOf(db, res.eventId)).map((o) => o.seriesDate ?? "")), sorted(expected));
  const again = await ensureHorizon(db, pro.proId, now);
  must(again, "ensureHorizon after");
  assert.equal(again.inserted, 0);
});

dbTest("T8b: a split committed after ensureHorizon's plan leaves no phantom séance", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId, d } = await pastSeries(h, now);
  const newRule = weekly(d, [2, 4], 720);
  let newEventId = "";
  const hz = await ensureHorizon(db, pro.proId, now, {
    afterPlan: async () => {
      const r = await editSeriesFrom(
        db,
        { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d, rule: newRule, durationMin: 60, orphans: "keep" },
        now,
      );
      must(r, "split inside afterPlan");
      newEventId = r.eventId;
    },
  });
  must(hz, "ensureHorizon");
  assert.ok((await occurrencesOf(db, eventId)).every((o) => (o.seriesDate ?? "") < d));
  const expected = expandDates({ ...newRule, durationMin: 60 }, d, horizonEnd(now, pro.tz));
  assert.deepEqual(sorted((await occurrencesOf(db, newEventId)).map((o) => o.seriesDate ?? "")), sorted(expected));
});

dbTest("E7 suivantes: without rows before d the edit happens in place (same event, version + 1)", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [0, 1, 2, 3, 4, 5, 6]) }, now);
  assert.ok(occurrences.length > 300);
  const preview = await previewSeriesEdit(
    db,
    { professionalId: pro.proId, eventId, fromDate: start, rule: weekly(start, [0, 1, 2, 3, 4, 5, 6], 720), durationMin: 60 },
    now,
  );
  must(preview, "preview");
  assert.equal(preview.inPlace, true);
  assert.equal(preview.summary.modified, occurrences.length);

  const res = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId,
      seenVersion: 1,
      fromDate: start,
      rule: weekly(start, [0, 1, 2, 3, 4, 5, 6], 720),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(res, "in place");
  assert.equal(res.eventId, eventId);
  const ev = await getEvent(db, eventId);
  assert.equal(ev.version, 2);
  assert.equal(ev.startMinute, 720);
  const rows = byStart(await occurrencesOf(db, eventId));
  assert.equal(rows.length, occurrences.length);
  const first = rows[0];
  assert.equal(first.startsAt.getTime() - occurrences[0].startsAt.getTime(), 2 * 3_600_000);
  assert.equal(first.changedAt?.getTime(), now.getTime());
  const segments = await db.select({ id: event.id }).from(event).where(eq(event.seriesRootId, ev.seriesRootId ?? eventId));
  assert.equal(segments.length, 1);

  const stale = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: start, rule: weekly(start, [1]), durationMin: 60, orphans: "keep" },
    now,
  );
  assert.equal(stale.ok ? "ok" : stale.code, "stale");
});

dbTest("E7 suivantes: booked orphans cancelled on request return their tickets", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { typeId, eventId, d } = await pastSeries(h, now);
  const friday = (await occurrencesOf(db, eventId)).find((o) => (o.seriesDate ?? "") >= d && dayOfWeek(o.seriesDate ?? "") === 5);
  assert.ok(friday);
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: friday.id, customerId, asGuest: false });
  must(reg, "registerPro");

  const preview = await previewSeriesEdit(db, { professionalId: pro.proId, eventId, fromDate: d, rule: weekly(d, [1, 3]), durationMin: 60 }, now);
  must(preview, "preview");
  assert.equal(preview.inPlace, false);
  assert.equal(preview.summary.orphans, 1);
  assert.equal(preview.summary.orphanTickets, 1);

  const res = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d, rule: weekly(d, [1, 3]), durationMin: 60, orphans: "cancel" },
    now,
  );
  must(res, "split with cancel");
  assert.ok(res.effects.some((e) => e.type === "email.occurrence_cancelled" && e.occurrenceId === friday.id));
  const o = await getOccurrence(db, friday.id);
  assert.equal(o.status, "cancelled");
  assert.equal(o.seatsTaken, 0);
  assert.equal((await getBooking(db, reg.bookingId)).status, "cancelled");
  const [t] = await ticketsOf(db, customerId);
  assert.equal(t.status, "available");
});

dbTest("E7 suivantes: count mode keeps the remaining total (« Il reste K séances »)", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { eventId } = await makeEvent(
    db,
    pro,
    {
      ticketTypeIds: [typeId],
      rule: {
        startDate: dayIn(pro, -3, now),
        startMinute: 600,
        freq: "daily",
        interval: 1,
        weekdays: null,
        monthlyBy: null,
        monthWeek: null,
        endMode: "count",
        untilDate: null,
        occurrenceCount: 10,
      },
    },
    addDaysMs(now, -3),
  );
  const d = dayIn(pro, 1, now);
  const preview = await previewSeriesEdit(
    db,
    {
      professionalId: pro.proId,
      eventId,
      fromDate: d,
      rule: {
        startDate: d,
        startMinute: 600,
        freq: "daily",
        interval: 1,
        weekdays: null,
        monthlyBy: null,
        monthWeek: null,
        endMode: "count",
        untilDate: null,
        occurrenceCount: 6,
      },
      durationMin: 60,
    },
    now,
  );
  must(preview, "preview");
  assert.equal(preview.remainingCount, 6);
  assert.equal(preview.inPlace, false);
  assert.equal(preview.summary.modified, 0);
  assert.equal(preview.summary.inserted, 0);
  assert.equal(preview.summary.deleted, 0);

  const past = await previewSeriesEdit(
    db,
    { professionalId: pro.proId, eventId, fromDate: dayIn(pro, -1, now), rule: weekly(dayIn(pro, -1, now), [1]), durationMin: 60 },
    now,
  );
  assert.equal(past.ok ? "ok" : past.code, "invalid");
});

dbTest("E7 supprimer à partir du: a never-booked event is deleted physically", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const res = await deleteSeriesFrom(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    eventId,
    seenVersion: 1,
    fromDate: occurrences[0].seriesDate ?? "",
  });
  must(res, "delete");
  assert.equal(res.deletedEvent, true);
  assert.equal(res.deletedOccurrences, 1);
  assert.equal(await getEvent(db, eventId), undefined);
  assert.equal((await occurrencesOf(db, eventId)).length, 0);
});

dbTest("E7 supprimer à partir du: booked séances are cancelled, empty ones deleted, the series ends at d − 1", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { typeId, eventId, d } = await pastSeries(h, now);
  const rowsAfter = byStart(await occurrencesOf(db, eventId)).filter((o) => (o.seriesDate ?? "") >= d);
  const target = rowsAfter[0];
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: target.id, customerId, asGuest: false });
  must(reg, "registerPro");

  const res = await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d }, now);
  must(res, "delete from d");
  assert.equal(res.deletedEvent, false);
  assert.equal(res.cancelledOccurrences, 1);
  assert.equal(res.deletedOccurrences, rowsAfter.length - 1);
  assert.ok(res.effects.some((e) => e.type === "email.occurrence_cancelled" && e.occurrenceId === target.id));
  const left = (await occurrencesOf(db, eventId)).filter((o) => (o.seriesDate ?? "") >= d);
  assert.deepEqual(
    left.map((o) => [o.id, o.status]),
    [[target.id, "cancelled"]],
  );
  const ev = await getEvent(db, eventId);
  assert.equal(ev.untilDate, addDays(d, -1));
  assert.equal(ev.archivedAt, null);
  const [t] = await ticketsOf(db, customerId);
  assert.equal(t.status, "available");
});

dbTest("E7 supprimer à partir du: from the first séance of a booked event, the event is archived", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [0, 3]) }, now);
  const customerId = await makeCustomer(db, pro);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occurrences[0].id,
    customerId,
    asGuest: true,
  });
  must(reg, "registerPro");
  const res = await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: start }, now);
  must(res, "delete from start");
  const ev = await getEvent(db, eventId);
  assert.equal(ev.archivedAt?.getTime(), now.getTime());
  assert.equal(ev.endMode, "never");
  const rows = await occurrencesOf(db, eventId);
  assert.deepEqual(
    rows.map((o) => [o.id, o.status]),
    [[occurrences[0].id, "cancelled"]],
  );
});

dbTest(
  "E7 suivantes: a séance moved by « cette séance » after the plan keeps its moved time (re-plan as reparent-only)",
  async (h) => {
    const { db, pro } = h;
    const now = new Date();
    const { eventId, d } = await pastSeries(h, now);
    const rowsAfter = byStart(await occurrencesOf(db, eventId)).filter((o) => (o.seriesDate ?? "") >= d);
    const moved = rowsAfter[0];
    const movedStart = new Date(moved.startsAt.getTime() + 5 * 3_600_000);

    const res = await editSeriesFrom(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        eventId,
        seenVersion: 1,
        fromDate: d,
        rule: weekly(d, [1, 3, 5], 720),
        durationMin: 60,
        orphans: "keep",
      },
      now,
      {
        afterPlan: async () => {
          const r = await updateOccurrence(
            db,
            {
              professionalId: pro.proId,
              actorUserId: pro.userId,
              occurrenceId: moved.id,
              seenStartsAt: moved.startsAt,
              patch: { startsAt: movedStart },
            },
            now,
          );
          must(r, "« cette séance » inside afterPlan");
          assert.equal(r.timeChanged, true);
        },
      },
    );
    must(res, "split after one re-plan");

    const kept = await getOccurrence(db, moved.id);
    assert.equal(kept.eventId, res.eventId);
    assert.equal(kept.startsAt.toISOString(), movedStart.toISOString(), "the moved séance keeps its moved time");
    assert.equal(kept.endsAt.getTime(), movedStart.getTime() + 3_600_000);
    assert.equal(kept.blockStart.getTime(), movedStart.getTime());
    assert.equal(kept.timeDetached, true);
    assert.equal(res.summary.modified, rowsAfter.length - 1);

    const others = (await occurrencesOf(db, res.eventId)).filter((o) => o.id !== moved.id);
    assert.ok(others.length >= rowsAfter.length - 1);
    for (const o of others) {
      assert.equal(o.startsAt.getTime(), instantAt(o.seriesDate ?? "", 720, pro.tz).getTime(), `${o.seriesDate} retimed`);
      assert.equal(o.timeDetached, false);
    }
  },
);

dbTest("E7 suivantes: a séance planned for delete but moved by « cette séance » meanwhile is kept as reparent-only", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId, d } = await pastSeries(h, now);
  const friday = byStart(await occurrencesOf(db, eventId)).find((o) => (o.seriesDate ?? "") >= d && dayOfWeek(o.seriesDate ?? "") === 5);
  assert.ok(friday, "a never-booked Friday séance after d");
  const movedStart = new Date(friday.startsAt.getTime() + 2 * 3_600_000);

  const res = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d, rule: weekly(d, [1, 3]), durationMin: 60, orphans: "keep" },
    now,
    {
      afterPlan: async () => {
        const r = await updateOccurrence(
          db,
          { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: friday.id, seenStartsAt: friday.startsAt, patch: { startsAt: movedStart } },
          now,
        );
        must(r, "« cette séance » inside afterPlan");
      },
    },
  );
  must(res, "split after one re-plan");
  const kept = (await occurrencesOf(db, res.eventId)).find((o) => o.id === friday.id);
  assert.ok(kept, "the moved séance survives the split");
  assert.equal(kept.startsAt.getTime(), movedStart.getTime());
  assert.equal(kept.timeDetached, true);
  assert.equal(kept.status, "scheduled");
});

dbTest("E7 suivantes: an unknown orphans choice is invalid", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [1, 3, 5]) }, now);
  const res = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId,
      seenVersion: 1,
      fromDate: start,
      rule: weekly(start, [1, 3, 5], 720),
      durationMin: 60,
      orphans: "drop" as unknown as "keep",
    },
    now,
  );
  assert.equal(res.ok ? "ok" : res.code, "invalid");
  assert.equal((await getEvent(db, eventId)).version, 1);
});

/**
 * A Mon/Wed/Fri series from dayIn(2) whose first séance is booked, re-ruled in
 * place from that séance with a start one week later: the booked séance stays
 * on the event as a leftover before start_date (s2).
 */
async function leftoverSeries({ db, pro }: DbHarness, now: Date) {
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(dayIn(pro, 2, now), [1, 3, 5]) }, now);
  const leftover = occurrences[0];
  const d1 = leftover.seriesDate ?? "";
  const customerId = await makeCustomer(db, pro);
  const reg = await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: leftover.id, customerId, asGuest: true });
  must(reg, "registerPro");
  const s2 = addDays(d1, 7);
  const res = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d1, rule: weekly(s2, [1, 3, 5]), durationMin: 60, orphans: "keep" },
    now,
  );
  must(res, "re-rule in place with a later start");
  assert.equal(res.eventId, eventId);
  const ev = await getEvent(db, eventId);
  assert.equal(ev.startDate, s2);
  return { eventId, leftover, s2 };
}

dbTest("E7 suivantes: a leftover séance before start_date does not force a split (in place from start_date)", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId, leftover, s2 } = await leftoverSeries(h, now);
  const input = { professionalId: pro.proId, eventId, fromDate: s2, rule: weekly(s2, [1, 3, 5], 720), durationMin: 60 };
  const preview = await previewSeriesEdit(db, input, now);
  must(preview, "preview");

  const res = await editSeriesFrom(db, { ...input, actorUserId: pro.userId, seenVersion: 2, orphans: "keep" }, now);
  must(res, "edit from start_date");
  assert.equal(preview.inPlace, true);
  assert.equal(res.eventId, eventId);
  const ev = await getEvent(db, eventId);
  assert.equal(ev.version, 3);
  assert.equal(ev.startMinute, 720);
  const kept = await getOccurrence(db, leftover.id);
  assert.equal(kept.eventId, eventId);
  assert.equal(kept.startsAt.getTime(), leftover.startsAt.getTime());
  assert.equal(kept.status, "scheduled");
  assert.equal(kept.timeDetached, true);
  for (const o of (await occurrencesOf(db, eventId)).filter((x) => x.id !== leftover.id)) {
    assert.equal(o.startsAt.getTime(), instantAt(o.seriesDate ?? "", 720, pro.tz).getTime(), `${o.seriesDate} retimed`);
  }
});

dbTest("E7 supprimer à partir du: from start_date with a booked leftover before it, the delete is refused", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const { eventId, leftover, s2 } = await leftoverSeries(h, now);
  const rows = await occurrencesOf(db, eventId);
  const res = await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 2, fromDate: s2 }, now);
  assert.deepEqual(res.ok ? "ok" : [res.code, res.message], [
    "invalid",
    "Une séance isolée avec inscrits reste avant cette date. Annulez-la d'abord.",
  ]);
  const ev = await getEvent(db, eventId);
  assert.equal(ev.version, 2);
  assert.equal(ev.archivedAt, null);
  assert.deepEqual(
    (await occurrencesOf(db, eventId)).map((o) => [o.id, o.status]),
    rows.map((o) => [o.id, o.status]),
  );
  assert.equal((await getOccurrence(db, leftover.id)).status, "scheduled");
});

dbTest("E7 supprimer à partir du: a never-booked series keeps its séances before d and ends at d − 1", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [1, 3, 5]) }, now);
  const d = addDays(start, 14);
  const before = occurrences.filter((o) => (o.seriesDate ?? "") < d);
  const after = occurrences.filter((o) => (o.seriesDate ?? "") >= d);
  assert.ok(before.length >= 5);

  const res = await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d }, now);
  must(res, "delete from d");
  assert.equal(res.deletedEvent, false);
  assert.equal(res.deletedOccurrences, after.length);
  assert.equal(res.cancelledOccurrences, 0);
  const ev = await getEvent(db, eventId);
  assert.ok(ev, "the event still exists");
  assert.equal(ev.untilDate, addDays(d, -1));
  assert.equal(ev.archivedAt, null);
  assert.deepEqual(
    sorted((await occurrencesOf(db, eventId)).map((o) => o.id)),
    sorted(before.map((o) => o.id)),
  );
});

dbTest("E7 supprimer à partir du: a never-booked root still used by a later segment is archived, not deleted", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [1, 3, 5]) }, now);
  const d = addDays(start, 14);
  const split = await editSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: d, rule: weekly(d, [1, 3, 5], 720), durationMin: 60, orphans: "keep" },
    now,
  );
  must(split, "split");
  assert.notEqual(split.eventId, eventId);

  const res = await deleteSeriesFrom(db, { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 2, fromDate: start }, now);
  must(res, "delete the root from its first date");
  assert.equal(res.deletedEvent, false);
  const root = await getEvent(db, eventId);
  assert.ok(root, "the root still exists");
  assert.equal(root.archivedAt?.getTime(), now.getTime());
  assert.equal((await occurrencesOf(db, eventId)).length, 0);
  const next = await getEvent(db, split.eventId);
  assert.equal(next.seriesRootId, eventId);
  assert.equal(next.archivedAt, null);
  assert.ok((await occurrencesOf(db, split.eventId)).length > 0);
});

dbTest("E7 supprimer à partir du: a cancelled séance restored before the batch is cancelled after the re-plan", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const start = dayIn(pro, 2, now);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: weekly(start, [1, 3, 5]) }, now);
  const target = occurrences[1];
  const customerId = await makeCustomer(db, pro);
  const reg = await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: target.id, customerId, asGuest: true });
  must(reg, "registerPro");
  must(await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: target.id }, now), "cancel the séance");

  const res = await deleteSeriesFrom(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, eventId, seenVersion: 1, fromDate: start },
    now,
    {
      afterPlan: async () => {
        must(await restoreOccurrence(db, { professionalId: pro.proId, occurrenceId: target.id }, now), "rétablir inside afterPlan");
      },
    },
  );
  must(res, "delete after one re-plan");
  assert.equal(res.cancelledOccurrences, 1);
  assert.equal((await getOccurrence(db, target.id)).status, "cancelled");
  assert.equal((await occurrencesOf(db, eventId)).filter((o) => o.status === "scheduled").length, 0);
});
