import assert from "node:assert/strict";
import { and, asc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { formatWhen } from "@/lib/back-office/format";
import { setAvailabilityRules } from "@/lib/booking/catalog";
import { bookRdv, registerPro } from "@/lib/booking/claims";
import { checkInvariants } from "@/lib/booking/invariants";
import { addDays, instantAt } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { occurrence, timeOff } from "@/lib/db/schema";
import { addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, getBooking, getOccurrence, giveTickets, makeCustomer, makeEvent, makeType, ticketsOf } from "@/test/fixtures";
import { proCtx } from "@/test/pro-ctx";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowSeance, rowType } from "@/test/rows";

import { TIME_OFF_TOO_LONG, TIME_OFF_TOO_MANY, createTimeOffCore, deleteTimeOffCore, previewTimeOffCore } from "./time-off-actions";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

function mustFail<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: false }> {
  assert.equal(res.ok, false, `${what}: expected a failure, got ${JSON.stringify(res)}`);
}

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
const NONE = { seenOccurrenceIds: [] as string[], cancelBooked: false };

async function rowsOf(db: Db, proId: string) {
  const rows = await db.select().from(timeOff).where(eq(timeOff.professionalId, proId));
  return rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/** An all-day and a timed time off land on the instants of the PRO's wall clock, not the host's. */
async function checkInterval(db: Db, pro: TestPro): Promise<void> {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 5);
  const allDay = await createTimeOffCore(
    db,
    ctx,
    { startDate: day, endDate: addDays(day, 1), allDay: true, reason: "  Vacances  ", ...NONE },
    new Date(),
  );
  must(allDay, "all-day time off");
  assert.equal(allDay.cancelledOccurrences, 0);
  assert.deepEqual(allDay.effects, []);
  const timed = await createTimeOffCore(
    db,
    ctx,
    { startDate: addDays(day, 10), endDate: addDays(day, 10), allDay: false, startMinute: 540, endMinute: 600, ...NONE },
    new Date(),
  );
  must(timed, "timed time off");

  const rows = await rowsOf(db, pro.proId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].startAt.getTime(), instantAt(day, 0, pro.tz).getTime());
  assert.equal(rows[0].endAt.getTime(), instantAt(addDays(day, 2), 0, pro.tz).getTime());
  assert.equal(rows[0].allDay, true);
  assert.equal(rows[0].reason, "Vacances");
  assert.equal(rows[1].startAt.getTime(), instantAt(addDays(day, 10), 540, pro.tz).getTime());
  assert.equal(rows[1].endAt.getTime(), instantAt(addDays(day, 10), 600, pro.tz).getTime());
  assert.equal(rows[1].allDay, false);
  assert.equal(rows[1].reason, null);
}

dbTest("create: the interval is built in the pro time zone (Europe/Paris)", async ({ db, pro }) => {
  await checkInterval(db, pro);
});

dbTest("create: the interval is built in the pro time zone (America/Los_Angeles)", async ({ db }) => {
  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    await checkInterval(db, la);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("a time off lasts at most 366 days", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const start = dayIn(pro, 2);
  const tooLong = { startDate: start, endDate: addDays(start, 366), allDay: true };

  const preview = await previewTimeOffCore(db, ctx, tooLong, new Date());
  mustFail(preview, "preview of 367 days");
  assert.equal(preview.error, TIME_OFF_TOO_LONG);
  const created = await createTimeOffCore(db, ctx, { ...tooLong, ...NONE }, new Date());
  mustFail(created, "creation of 367 days");
  assert.equal(created.error, TIME_OFF_TOO_LONG);
  assert.equal((await rowsOf(db, pro.proId)).length, 0);

  const exact = { startDate: start, endDate: addDays(start, 365), allDay: true };
  must(await previewTimeOffCore(db, ctx, exact, new Date()), "preview of 366 days");
  must(await createTimeOffCore(db, ctx, { ...exact, ...NONE }, new Date()), "creation of 366 days");
  assert.equal((await rowsOf(db, pro.proId)).length, 1);
});

dbTest("the French messages of buildTimeOffInterval and of the form pass through", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 2);
  const now = new Date();

  const inverted = await previewTimeOffCore(db, ctx, { startDate: addDays(day, 1), endDate: day, allDay: true }, now);
  mustFail(inverted, "inverted all-day range");
  assert.equal(inverted.error, "La date de fin doit être après la date de début.");

  const manyDays = await previewTimeOffCore(
    db,
    ctx,
    { startDate: day, endDate: addDays(day, 1), allDay: false, startMinute: 540, endMinute: 600 },
    now,
  );
  mustFail(manyDays, "timed range over two days");
  assert.equal(manyDays.error, "Une plage horaire doit tenir sur une seule journée.");

  const reversed = await createTimeOffCore(
    db,
    ctx,
    { startDate: day, endDate: day, allDay: false, startMinute: 600, endMinute: 540, ...NONE },
    now,
  );
  mustFail(reversed, "end before start");
  assert.equal(reversed.error, "L'heure de fin doit être après l'heure de début.");

  const badDate = await previewTimeOffCore(db, ctx, { startDate: "2026-13-45", endDate: day, allDay: true }, now);
  mustFail(badDate, "invalid date");
  assert.equal(badDate.error, "Date de début : date invalide.");

  const longReason = await createTimeOffCore(db, ctx, { startDate: day, endDate: day, allDay: true, reason: "x".repeat(501), ...NONE }, now);
  mustFail(longReason, "reason over 500 characters");
  assert.equal(longReason.error, "Motif : 500 caractères au maximum.");
  assert.equal((await rowsOf(db, pro.proId)).length, 0);
});

dbTest("preview: booked séances and RDVs come with their kind, another pro's bookings never show", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 3);
  const classType = await makeType(db, pro);
  const rdvType = await makeType(db, pro, { name: "Cours particulier", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  must(await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: ALL_WEEK }), "hours");
  const {
    occurrences: [seance],
  } = await makeEvent(db, pro, { title: "Altinha test", ticketTypeIds: [classType], rule: { startDate: day, startMinute: 600 } });
  const {
    occurrences: [empty],
  } = await makeEvent(db, pro, { title: "Séance vide", ticketTypeIds: [classType], rule: { startDate: day, startMinute: 900 } });
  const clientA = await makeCustomer(db, pro);
  const clientB = await makeCustomer(db, pro);
  const clientC = await makeCustomer(db, pro);
  // Two registrants on the séance, one on the RDV: a count read against the wrong row would give both the same number.
  for (const customerId of [clientA, clientC]) {
    must(
      await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: seance.id, customerId, asGuest: true }),
      "register on the séance",
    );
  }
  const rdv = await bookRdv(db, {
    professionalId: pro.proId,
    ticketTypeId: rdvType,
    startsAt: instantAt(day, 780, pro.tz),
    customerId: clientB,
    actorUserId: null,
    mode: "free",
  });
  must(rdv, "book the RDV");

  const other = await createTestPro(db);
  try {
    const otherType = await makeType(db, other);
    const {
      occurrences: [theirs],
    } = await makeEvent(db, other, { ticketTypeIds: [otherType], rule: { startDate: day, startMinute: 600 } });
    const theirClient = await makeCustomer(db, other);
    must(
      await registerPro(db, {
        professionalId: other.proId,
        actorUserId: other.userId,
        occurrenceId: theirs.id,
        customerId: theirClient,
        asGuest: true,
      }),
      "registration of the other pro",
    );

    const preview = await previewTimeOffCore(db, ctx, { startDate: day, endDate: day, allDay: true }, new Date());
    must(preview, "preview");
    assert.equal(preview.conflicts.length, 2);
    const bySeance = preview.conflicts.find((c) => c.occurrenceId === seance.id);
    const byRdv = preview.conflicts.find((c) => c.occurrenceId === rdv.occurrenceId);
    assert.ok(bySeance && byRdv, "the séance and the RDV are both listed");
    assert.deepEqual(bySeance, {
      occurrenceId: seance.id,
      kind: "seance",
      title: "Altinha test",
      whenLabel: formatWhen(seance.startsAt, seance.endsAt, pro.tz),
      activeBookings: 2,
    });
    assert.equal(byRdv.kind, "rdv");
    assert.equal(byRdv.title, "Cours particulier");
    assert.equal(byRdv.activeBookings, 1);
    assert.ok(!preview.conflicts.some((c) => c.occurrenceId === empty.id || c.occurrenceId === theirs.id));
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("create: a registration taken after the preview makes it stale and the next preview lists it", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 3);
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 600 } });
  const form = { startDate: day, endDate: day, allDay: true };

  const first = await previewTimeOffCore(db, ctx, form, new Date());
  must(first, "first preview");
  assert.equal(first.conflicts.length, 0);

  const customerId = await makeCustomer(db, pro);
  must(
    await registerPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: true }),
    "registration after the preview",
  );

  const stale = await createTimeOffCore(
    db,
    ctx,
    { ...form, seenOccurrenceIds: first.conflicts.map((c) => c.occurrenceId), cancelBooked: false },
    new Date(),
  );
  mustFail(stale, "stale creation");
  assert.equal(stale.code, "stale");
  assert.equal(stale.error, "Des inscriptions ont changé pendant la vérification : voici la liste à jour.");
  assert.equal((await rowsOf(db, pro.proId)).length, 0);

  const second = await previewTimeOffCore(db, ctx, form, new Date());
  must(second, "second preview");
  assert.deepEqual(
    second.conflicts.map((c) => [c.occurrenceId, c.kind, c.activeBookings]),
    [[occ.id, "seance", 1]],
  );
});

dbTest("create with cancelBooked cancels the booked séance, gives the ticket back and keeps the empty one", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 4);
  const typeId = await makeType(db, pro);
  const {
    occurrences: [booked],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 600 } });
  const {
    occurrences: [empty],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 900 } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: booked.id,
    customerId,
    asGuest: false,
  });
  must(reg, "registration with a ticket");

  const form = { startDate: day, endDate: day, allDay: true, reason: "Vacances" };
  const preview = await previewTimeOffCore(db, ctx, form, new Date());
  must(preview, "preview");
  assert.deepEqual(
    preview.conflicts.map((c) => c.occurrenceId),
    [booked.id],
  );

  const res = await createTimeOffCore(
    db,
    ctx,
    { ...form, seenOccurrenceIds: preview.conflicts.map((c) => c.occurrenceId), cancelBooked: true },
    new Date(),
  );
  must(res, "time off with cancellation");
  assert.equal(res.cancelledOccurrences, 1);
  assert.ok(res.effects.some((e) => e.type === "email.occurrence_cancelled" && e.occurrenceId === booked.id));
  assert.equal((await getOccurrence(db, booked.id)).status, "cancelled");
  assert.equal((await getOccurrence(db, empty.id)).status, "scheduled");
  assert.equal((await getBooking(db, reg.bookingId)).status, "cancelled");
  assert.equal((await ticketsOf(db, customerId))[0].status, "available");
  assert.equal((await rowsOf(db, pro.proId)).length, 1);
});

dbTest("create with cancelBooked false keeps the booked séance, its registrants and its ticket", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 4);
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: day, startMinute: 600 } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occ.id,
    customerId,
    asGuest: false,
  });
  must(reg, "registration with a ticket");

  const res = await createTimeOffCore(
    db,
    ctx,
    { startDate: day, endDate: day, allDay: true, seenOccurrenceIds: [occ.id], cancelBooked: false },
    new Date(),
  );
  must(res, "time off that keeps the séance");
  assert.equal(res.cancelledOccurrences, 0);
  assert.deepEqual(res.effects, []);
  const row = await getOccurrence(db, occ.id);
  assert.equal(row.status, "scheduled");
  assert.equal(row.seatsTaken, 1);
  assert.equal((await getBooking(db, reg.bookingId)).status, "confirmed");
  assert.equal((await ticketsOf(db, customerId))[0].status, "booked");
  assert.equal((await rowsOf(db, pro.proId)).length, 1);
});

// The preview must not promise what the creation refuses: both look at the same set (seats taken, not started), so a
// hold whose time has run out, still holding its seat until it is released, is listed and accepted as seen.
dbTest("preview and create agree on a séance held only by an elapsed pending booking", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const day = dayIn(pro, 3);
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro, { capacity: 3 });
  const occId = await rowSeance(db, pro, eventId, { startsAt: instantAt(day, 600, pro.tz), capacity: 3, seatsTaken: 1 });
  const customerId = await rowCustomer(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
  const bookingId = await rowBooking(db, pro, {
    occurrenceId: occId,
    customerId,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: addMinutes(now, -10),
  });
  const form = { startDate: day, endDate: day, allDay: true };

  const preview = await previewTimeOffCore(db, ctx, form, now);
  must(preview, "preview");
  assert.deepEqual(
    preview.conflicts.map((c) => [c.occurrenceId, c.kind, c.activeBookings]),
    [[occId, "seance", 1]],
  );

  const unseen = await createTimeOffCore(db, ctx, { ...form, ...NONE }, now);
  mustFail(unseen, "creation that ignores the lapsed hold");
  assert.equal(unseen.code, "stale");

  const res = await createTimeOffCore(
    db,
    ctx,
    { ...form, seenOccurrenceIds: preview.conflicts.map((c) => c.occurrenceId), cancelBooked: false },
    now,
  );
  must(res, "creation with the previewed list");
  assert.equal((await rowsOf(db, pro.proId)).length, 1);
  assert.equal((await getBooking(db, bookingId)).status, "pending");
});

// A creation accepts at most 500 « seen » ids. A preview that listed more would offer a choice the creation then refuses.
dbTest("preview refuses a list of more than 500 séances with registrants, a shorter period lists them", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const first = dayIn(pro, 2);
  const seances = async (startMinute: number, days: number) => {
    const eventId = await rowEvent(db, pro, { capacity: 12 });
    await db.insert(occurrence).values(
      Array.from({ length: days }, (_, i) => {
        const day = addDays(first, i);
        const startsAt = instantAt(day, startMinute, pro.tz);
        const endsAt = new Date(startsAt.getTime() + 3_600_000);
        return {
          id: nanoid(),
          professionalId: pro.proId,
          eventId,
          seriesDate: day,
          startsAt,
          endsAt,
          blockStart: startsAt,
          blockEnd: endsAt,
          capacity: 12,
          seatsTaken: 1,
          status: "scheduled" as const,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
  };
  // 366 + 135 = 501 séances over the longest period a time off may cover.
  await seances(600, 366);
  await seances(900, 135);

  const whole = await previewTimeOffCore(db, ctx, { startDate: first, endDate: addDays(first, 365), allDay: true }, now);
  mustFail(whole, "preview of 501 séances");
  assert.equal(whole.error, TIME_OFF_TOO_MANY);

  const shorter = await previewTimeOffCore(db, ctx, { startDate: first, endDate: addDays(first, 99), allDay: true }, now);
  must(shorter, "preview of 200 séances");
  assert.equal(shorter.conflicts.length, 200);
  // The list reads by date (the engine answers by id).
  const byDate = await db
    .select({ id: occurrence.id })
    .from(occurrence)
    .where(and(eq(occurrence.professionalId, pro.proId), lt(occurrence.startsAt, instantAt(addDays(first, 100), 0, pro.tz))))
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id));
  assert.deepEqual(
    shorter.conflicts.map((c) => c.occurrenceId),
    byDate.map((r) => r.id),
  );
  const created = await createTimeOffCore(
    db,
    ctx,
    {
      startDate: first,
      endDate: addDays(first, 99),
      allDay: true,
      seenOccurrenceIds: shorter.conflicts.map((c) => c.occurrenceId),
      cancelBooked: false,
    },
    now,
  );
  must(created, "creation with the 200 previewed séances");

  // The séances were made without bookings: give the seats back so that the invariants of the pro hold.
  await db.update(occurrence).set({ seatsTaken: 0 }).where(eq(occurrence.professionalId, pro.proId));
});

dbTest("create: another pro's séance is neither listed nor cancelled, and its id cannot be passed as seen", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 3);
  const other = await createTestPro(db);
  try {
    const otherType = await makeType(db, other);
    const {
      occurrences: [theirs],
    } = await makeEvent(db, other, { ticketTypeIds: [otherType], rule: { startDate: day, startMinute: 600 } });
    const theirClient = await makeCustomer(db, other);
    const reg = await registerPro(db, {
      professionalId: other.proId,
      actorUserId: other.userId,
      occurrenceId: theirs.id,
      customerId: theirClient,
      asGuest: true,
    });
    must(reg, "registration of the other pro");
    const form = { startDate: day, endDate: day, allDay: true };

    // Their id as « seen », with the cancellation asked: the set of my own conflicts is empty, so the creation is stale and nothing happens.
    const attack = await createTimeOffCore(db, ctx, { ...form, seenOccurrenceIds: [theirs.id], cancelBooked: true }, new Date());
    mustFail(attack, "foreign id passed as seen");
    assert.equal(attack.code, "stale");
    assert.equal((await getOccurrence(db, theirs.id)).status, "scheduled");
    assert.equal((await getBooking(db, reg.bookingId)).status, "confirmed");
    assert.equal((await rowsOf(db, pro.proId)).length, 0);

    // With the honest (empty) list the same request goes through and touches nobody else.
    const honest = await createTimeOffCore(db, ctx, { ...form, seenOccurrenceIds: [], cancelBooked: true }, new Date());
    must(honest, "creation with the honest list");
    assert.equal(honest.cancelledOccurrences, 0);
    assert.equal((await getOccurrence(db, theirs.id)).status, "scheduled");
    assert.equal((await rowsOf(db, other.proId)).length, 0);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("delete: own time off is removed; another pro's or an unknown id is « Indisponibilité introuvable. »", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const day = dayIn(pro, 3);
  must(await createTimeOffCore(db, ctx, { startDate: day, endDate: day, allDay: true, ...NONE }, new Date()), "own time off");
  const [mine] = await rowsOf(db, pro.proId);

  const other = await createTestPro(db);
  try {
    must(
      await createTimeOffCore(db, proCtx(other), { startDate: day, endDate: day, allDay: true, ...NONE }, new Date()),
      "time off of the other pro",
    );
    const [theirs] = await rowsOf(db, other.proId);

    const refused = await deleteTimeOffCore(db, ctx, { timeOffId: theirs.id }, new Date());
    mustFail(refused, "deleting another pro's time off");
    assert.equal(refused.error, "Indisponibilité introuvable.");
    assert.equal(refused.code, "not_found");
    assert.equal((await rowsOf(db, other.proId)).length, 1);

    const unknown = await deleteTimeOffCore(db, ctx, { timeOffId: "does-not-exist" }, new Date());
    mustFail(unknown, "unknown id");
    assert.equal(unknown.error, "Indisponibilité introuvable.");
    assert.equal(unknown.code, "not_found");
  } finally {
    await deleteTestUser(db, other.userId);
  }

  const removed = await deleteTimeOffCore(db, ctx, { timeOffId: mine.id }, new Date());
  must(removed, "delete own");
  assert.deepEqual(removed.effects, []);
  assert.equal((await rowsOf(db, pro.proId)).length, 0);
});
