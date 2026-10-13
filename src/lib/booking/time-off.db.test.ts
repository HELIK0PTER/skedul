import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { dbTest, inParallel } from "../../test/db";
import { dayIn, getBooking, getOccurrence, giveTickets, makeCustomer, makeEvent, makeType, ticketsOf } from "../../test/fixtures";
import { addDays, instantAt } from "../civil-date";
import type { Db } from "../db/atomic";
import { createTimeOffWithConflicts, previewTimeOffConflicts } from "./cancel";
import { setAvailabilityRules } from "./catalog";
import { bookRdv, bookWithHeldTicket, registerPro } from "./claims";

type Outcome = { ok: boolean; code?: string };

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

const label = (s: PromiseSettledResult<Outcome>): string =>
  s.status === "rejected" ? `threw: ${String(s.reason)}` : s.value.ok ? "ok" : String(s.value.code);

async function timeOffCount(db: Db, proId: string): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from time_off where professional_id = ${proId}`);
  return Number(res.rows[0]?.n ?? 0);
}

dbTest("T6c: an RDV and a time off on the same slot are serialised by the professional lock", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const allWeek = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
  must(await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: allWeek }), "rules");
  const customerId = await makeCustomer(db, pro);
  const day = dayIn(pro, 3);
  const startsAt = instantAt(day, 600, pro.tz);

  const [rdv, off] = await inParallel<Outcome>([
    () => bookRdv(db, { professionalId: pro.proId, ticketTypeId: typeId, startsAt, customerId, actorUserId: null, mode: "free" }),
    () =>
      createTimeOffWithConflicts(db, {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        startAt: instantAt(day, 0, pro.tz),
        endAt: instantAt(addDays(day, 1), 0, pro.tz),
        allDay: true,
        reason: null,
        seenOccurrenceIds: [],
        cancelBooked: false,
      }),
  ]);
  const pair = `${label(rdv)} / ${label(off)}`;
  assert.ok(pair === "slot_taken / ok" || pair === "ok / stale", pair);
  assert.equal(await timeOffCount(db, pro.proId), label(off) === "ok" ? 1 : 0);
});

dbTest("T10a: a claim between the preview and the time-off batch makes it stale", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const range = { startAt: new Date(occ.startsAt.getTime() - 3_600_000), endAt: new Date(occ.endsAt.getTime() + 3_600_000) };
  assert.deepEqual(await previewTimeOffConflicts(db, { professionalId: pro.proId, ...range }), []);

  let bookingId = "";
  const res = await createTimeOffWithConflicts(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      ...range,
      allDay: false,
      reason: "Rendez-vous médical",
      seenOccurrenceIds: [],
      cancelBooked: false,
    },
    new Date(),
    {
      afterPlan: async () => {
        const b = await bookWithHeldTicket(db, {
          professionalId: pro.proId,
          occurrenceId: occ.id,
          customerId,
          seenStartsAt: occ.startsAt,
          actorUserId: null,
        });
        must(b, "claim inside afterPlan");
        bookingId = b.bookingId;
      },
    },
  );
  assert.equal(res.ok ? "ok" : res.code, "stale");
  assert.equal(await timeOffCount(db, pro.proId), 0);
  assert.equal((await getBooking(db, bookingId)).status, "confirmed");
  const preview = await previewTimeOffConflicts(db, { professionalId: pro.proId, ...range });
  assert.deepEqual(
    preview.map((p) => [p.occurrenceId, p.activeBookings]),
    [[occ.id, 1]],
  );
});

dbTest("T10b: once the time off exists, an online claim is unavailable but the pro can still register", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 2);
  const off = await createTimeOffWithConflicts(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    startAt: occ.startsAt,
    endAt: occ.endsAt,
    allDay: false,
    reason: null,
    seenOccurrenceIds: [],
    cancelBooked: false,
  });
  must(off, "time off");
  assert.equal(off.cancelledOccurrences, 0);
  assert.deepEqual(off.effects, []);

  const claim = await bookWithHeldTicket(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    actorUserId: null,
  });
  assert.equal(claim.ok ? "ok" : claim.code, "unavailable");
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: false }),
    "registerPro under a time off",
  );
});

dbTest("E6c: « Annuler ces séances » cancels the booked overlapping séances only", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const day = dayIn(pro, 4);
  const {
    occurrences: [booked],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 600 } });
  const {
    occurrences: [empty],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 840 } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const b = await bookWithHeldTicket(db, {
    professionalId: pro.proId,
    occurrenceId: booked.id,
    customerId,
    seenStartsAt: booked.startsAt,
    actorUserId: null,
  });
  must(b, "book");
  const range = { startAt: instantAt(day, 0, pro.tz), endAt: instantAt(addDays(day, 1), 0, pro.tz) };
  const preview = await previewTimeOffConflicts(db, { professionalId: pro.proId, ...range });
  assert.equal(preview.length, 1);
  assert.equal(preview[0].occurrenceId, booked.id);
  assert.equal(preview[0].activeBookings, 1);
  assert.ok(preview[0].title.length > 0);

  const res = await createTimeOffWithConflicts(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    ...range,
    allDay: true,
    reason: "Vacances",
    seenOccurrenceIds: preview.map((p) => p.occurrenceId),
    cancelBooked: true,
  });
  must(res, "time off + cancel");
  assert.equal(res.cancelledOccurrences, 1);
  assert.ok(res.effects.some((e) => e.type === "email.occurrence_cancelled" && e.occurrenceId === booked.id));
  assert.equal((await getOccurrence(db, booked.id)).status, "cancelled");
  assert.equal((await getOccurrence(db, empty.id)).status, "scheduled");
  assert.equal((await getBooking(db, b.bookingId)).status, "cancelled");
  const [t] = await ticketsOf(db, customerId);
  assert.equal(t.status, "available");
  assert.equal(await timeOffCount(db, pro.proId), 1);
});

dbTest("E6c: « Les garder » keeps the booked séance; a bad range is invalid", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  must(
    await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null }),
    "book",
  );
  const kept = await createTimeOffWithConflicts(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    startAt: occ.startsAt,
    endAt: occ.endsAt,
    allDay: false,
    reason: null,
    seenOccurrenceIds: [occ.id],
    cancelBooked: false,
  });
  must(kept, "keep");
  assert.equal(kept.cancelledOccurrences, 0);
  const o = await getOccurrence(db, occ.id);
  assert.equal(o.status, "scheduled");
  assert.equal(o.seatsTaken, 1);

  const bad = await createTimeOffWithConflicts(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    startAt: occ.endsAt,
    endAt: occ.startsAt,
    allDay: false,
    reason: null,
    seenOccurrenceIds: [],
    cancelBooked: false,
  });
  assert.equal(bad.ok ? "ok" : bad.code, "invalid");
});
