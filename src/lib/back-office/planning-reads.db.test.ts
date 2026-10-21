import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { cancelBookingsByPro, cancelOccurrence } from "@/lib/booking/cancel";
import { registerPro } from "@/lib/booking/claims";
import { updateOccurrence } from "@/lib/booking/series";
import { moveAttendee } from "@/lib/booking/wallet";
import { addDays, dayOfWeek, instantAt } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { event, occurrence, question, timeOff } from "@/lib/db/schema";
import { addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeType } from "@/test/fixtures";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowLink,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "@/test/rows";

import { getPlanningRange, moveTargets, registerOptions, searchCustomers, type PlanningItem } from "./planning-reads";

const DAY = 86_400_000;

/**
 * One planning item by id, through the range read the app uses (the range is the occurrence's own): null when the
 * occurrence is unknown or the read leaves it out (another pro's, a cancelled RDV, a phantom RDV).
 */
async function planningItem(db: Db, proId: string, occurrenceId: string, now: Date): Promise<PlanningItem | null> {
  const [o] = await db
    .select({ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt })
    .from(occurrence)
    .where(eq(occurrence.id, occurrenceId));
  if (!o) return null;
  const { items } = await getPlanningRange(db, proId, { start: o.startsAt, end: o.endsAt }, now);
  return items.find((i) => i.id === occurrenceId) ?? null;
}

/**
 * A pending booking (ticket coverage) backed by a purchase of `typeId` through `offerId`, as « buy and book » leaves
 * it until the client pays: a new customer unless `customerId` is given, `holdExpiresAt` past or future.
 */
async function pendingHold(
  db: Db,
  pro: TestPro,
  args: { occurrenceId: string; typeId: string; offerId: string; holdExpiresAt: Date; customerId?: string },
): Promise<string> {
  const customerId = args.customerId ?? (await rowCustomer(db, pro));
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId: args.offerId, ticketTypeId: args.typeId });
  return rowBooking(db, pro, {
    occurrenceId: args.occurrenceId,
    customerId,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: args.holdExpiresAt,
  });
}

dbTest("range: séances and RDVs kept, cancelled RDV dropped, cancelled séance kept, half-open bounds, one pro only", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const {
    occurrences: [seance],
  } = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  const {
    occurrences: [struck],
  } = await makeEvent(db, pro, { title: "Altinha annulée", rule: { startDate: dayIn(pro, 4) } });
  const cancelled = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: struck.id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const beatriz = await makeCustomer(db, pro, { name: "Beatriz Almeida" });
  const rdvId = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 5), 840, pro.tz) });
  await rowBooking(db, pro, { occurrenceId: rdvId, customerId: beatriz });
  await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 6), 840, pro.tz), status: "cancelled", seatsTaken: 0 });

  const other = await createTestPro(db);
  try {
    const {
      occurrences: [theirs],
    } = await makeEvent(db, other, { title: "Chez l'autre" });
    const range = { start: instantAt(dayIn(pro, 0), 0, pro.tz), end: instantAt(dayIn(pro, 10), 0, pro.tz) };
    const { items } = await getPlanningRange(db, pro.proId, range, now);
    assert.deepEqual(
      items.map((i) => [i.id, i.kind, i.title, i.status]),
      [
        [seance.id, "seance", "Altinha débutants", "scheduled"],
        [struck.id, "seance", "Altinha annulée", "cancelled"],
        [rdvId, "rdv", "Cours particulier", "scheduled"],
      ],
    );
    const rdv = items[2];
    assert.deepEqual(
      [rdv.eventId, rdv.eventVersion, rdv.ticketTypeId, rdv.bookingMode, rdv.isPrivate, rdv.capacity, rdv.seatsTaken, rdv.acceptedTypes.length],
      [null, null, rdvType, null, false, 1, 1, 0],
    );
    assert.deepEqual(
      rdv.attendees.map((a) => [a.name, a.status, a.coverage]),
      [["Beatriz Almeida", "confirmed", "guest"]],
    );
    assert.equal(items[0].eventVersion, 1);
    assert.equal(items[0].kind === "seance" && items[0].eventId !== null, true);

    // Half-open: [start, end) against starts_at < end AND ends_at > start.
    const idsIn = async (start: Date, end: Date) =>
      (await getPlanningRange(db, pro.proId, { start, end }, now)).items.map((i) => i.id);
    assert.deepEqual(await idsIn(seance.startsAt, seance.endsAt), [seance.id]);
    assert.deepEqual(await idsIn(addMinutes(seance.startsAt, 10), addMinutes(seance.startsAt, 20)), [seance.id], "inside");
    assert.deepEqual(await idsIn(addMinutes(seance.startsAt, -1), addMinutes(seance.startsAt, 1)), [seance.id], "straddles the start");
    assert.deepEqual(await idsIn(addMinutes(seance.startsAt, -60), seance.startsAt), [], "ends where the séance starts");
    assert.deepEqual(await idsIn(seance.endsAt, addMinutes(seance.endsAt, 60)), [], "starts where the séance ends");

    // Tenancy: the other pro's séance is neither in the range nor readable by id.
    assert.ok(!items.some((i) => i.id === theirs.id));
    assert.equal(await planningItem(db, pro.proId, theirs.id, now), null);
    assert.equal((await planningItem(db, other.proId, theirs.id, now))?.id, theirs.id);
    assert.equal(await planningItem(db, pro.proId, "inconnu", now), null);
    assert.equal((await planningItem(db, pro.proId, seance.id, now))?.title, "Altinha débutants");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("range: the time off overlapping the range, this pro's only", async ({ db, pro }) => {
  const now = new Date();
  const day = dayIn(pro, 3);
  const at = (d: string, m: number) => instantAt(d, m, pro.tz);
  const range = { start: at(day, 0), end: at(addDays(day, 1), 0) };
  const mine = {
    inside: nanoid(),
    before: nanoid(),
    after: nanoid(),
    around: nanoid(),
  };
  await db.insert(timeOff).values([
    { id: mine.inside, professionalId: pro.proId, startAt: at(day, 600), endAt: at(day, 720), allDay: false, reason: "Médecin" },
    { id: mine.before, professionalId: pro.proId, startAt: at(addDays(day, -1), 0), endAt: at(day, 0), allDay: true, reason: null },
    { id: mine.after, professionalId: pro.proId, startAt: at(addDays(day, 1), 0), endAt: at(addDays(day, 2), 0), allDay: true, reason: null },
    { id: mine.around, professionalId: pro.proId, startAt: at(addDays(day, -2), 0), endAt: at(addDays(day, 2), 0), allDay: true, reason: "Vacances" },
  ]);
  const other = await createTestPro(db);
  try {
    await db.insert(timeOff).values({
      id: nanoid(),
      professionalId: other.proId,
      startAt: at(day, 0),
      endAt: at(addDays(day, 1), 0),
      allDay: true,
      reason: "Autre",
    });
    const { timeOff: found } = await getPlanningRange(db, pro.proId, range, now);
    assert.deepEqual(
      found.map((t) => [t.id, t.allDay, t.reason]),
      [
        [mine.around, true, "Vacances"],
        [mine.inside, false, "Médecin"],
      ],
    );
    assert.deepEqual(found[1].startAt, at(day, 600));
    assert.deepEqual(found[1].endAt, at(day, 720));
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("attendees: pending and confirmed with answers and ticket, cancelled ones left out", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const {
    eventId,
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], capacity: 5 });
  const levelId = nanoid();
  await db.insert(question).values({
    id: levelId,
    professionalId: pro.proId,
    eventId,
    label: "Niveau",
    type: "text",
    options: null,
    required: false,
    position: 0,
  });
  const thomas = await makeCustomer(db, pro, { name: "Thomas Leroy" });
  const marina = await makeCustomer(db, pro, { name: "Marina Costa" });
  const lea = await makeCustomer(db, pro, { name: "Léa Martin" });
  const expiresAt = instantAt(dayIn(pro, 30), 0, pro.tz);
  await giveTickets(db, pro, thomas, typeId, 1);
  await giveTickets(db, pro, marina, typeId, 1, { expiresAt });

  const base = { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, asGuest: false };
  // createdAt = the engine's `now`: one distinct minute per booking keeps the order deterministic.
  const first = await registerPro(db, { ...base, customerId: thomas }, addMinutes(now, 1));
  assert.ok(first.ok, JSON.stringify(first));
  const second = await registerPro(
    db,
    { ...base, customerId: marina, answers: [{ questionId: levelId, value: "Débutant" }] },
    addMinutes(now, 2),
  );
  assert.ok(second.ok, JSON.stringify(second));
  const third = await registerPro(db, { ...base, customerId: lea, asGuest: true }, addMinutes(now, 3));
  assert.ok(third.ok, JSON.stringify(third));
  const left = await cancelBookingsByPro(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, bookingIds: [third.bookingId] },
    addMinutes(now, 4),
  );
  assert.ok(left.ok, JSON.stringify(left));

  const found = await planningItem(db, pro.proId, occ.id, now);
  assert.ok(found);
  assert.equal(found.seatsTaken, 2);
  assert.deepEqual(
    found.attendees.map((a) => [a.name, a.status, a.coverage, a.createdBy, a.bookingId]),
    [
      ["Thomas Leroy", "confirmed", "ticket", "pro", first.bookingId],
      ["Marina Costa", "confirmed", "ticket", "pro", second.bookingId],
    ],
  );
  assert.deepEqual(found.attendees[0].ticket, { id: first.ticketId, typeName: "Cours collectif", expiresAt: null, purchased: false });
  assert.deepEqual(found.attendees[1].ticket, { id: second.ticketId, typeName: "Cours collectif", expiresAt, purchased: false });
  assert.deepEqual(found.attendees[0].answers, []);
  assert.deepEqual(found.attendees[1].answers, [{ label: "Niveau", value: "Débutant" }]);
  assert.equal(found.attendees[0].email.endsWith("@skedul.test"), true);
  assert.equal(found.attendees[0].holdExpiresAt, null);
  assert.equal(found.attendees[0].movedAt, null);
  assert.deepEqual(found.questions.map((q) => [q.id, q.label, q.type, q.required, q.options]), [[levelId, "Niveau", "text", false, null]]);
});

dbTest("attendee ticket: purchased is true when the ticket comes from a purchase", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro, { name: "Cours collectif" });
  const eventId = await rowEvent(db, pro, { capacity: 5 });
  await rowLink(db, pro, eventId, typeId);
  const occId = await rowSeance(db, pro, eventId, { seatsTaken: 1 });
  const customerId = await rowCustomer(db, pro, { name: "Marina Costa" });
  const offerId = await rowOffer(db, pro, typeId);
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId, status: "paid" });
  const bookingId = await rowBooking(db, pro, { occurrenceId: occId, customerId, coverage: "ticket" });
  const ticketId = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "booked", bookingId, purchaseId });

  const found = await planningItem(db, pro.proId, occId, now);
  assert.deepEqual(found?.attendees[0].ticket, { id: ticketId, typeName: "Cours collectif", expiresAt: null, purchased: true });
});

dbTest("seatsShown counts an elapsed hold as a free seat; the pending attendee is listed", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const eventId = await rowEvent(db, pro, { capacity: 3 });
  const occId = await rowSeance(db, pro, eventId, { capacity: 3, seatsTaken: 2 });
  const sure = await rowCustomer(db, pro, { name: "Rafael Souza" });
  const lapsing = await rowCustomer(db, pro, { name: "Léa Martin" });
  await rowBooking(db, pro, { occurrenceId: occId, customerId: sure });
  const offerId = await rowOffer(db, pro, typeId);
  const purchaseId = await rowPurchase(db, pro, { customerId: lapsing, offerId, ticketTypeId: typeId });
  const pendingId = await rowBooking(db, pro, {
    occurrenceId: occId,
    customerId: lapsing,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: addMinutes(now, 30),
  });

  const live = await planningItem(db, pro.proId, occId, now);
  assert.ok(live);
  assert.deepEqual([live.seatsTaken, live.elapsedHolds, live.seatsShown, live.capacity], [2, 0, 1, 3]);
  const pending = live.attendees.find((a) => a.bookingId === pendingId);
  assert.deepEqual([pending?.status, pending?.coverage, pending?.ticket], ["pending", "ticket", null]);
  assert.deepEqual(pending?.holdExpiresAt, addMinutes(now, 30));

  const lapsed = await planningItem(db, pro.proId, occId, addMinutes(now, 60));
  assert.deepEqual([lapsed?.seatsTaken, lapsed?.elapsedHolds, lapsed?.seatsShown], [2, 1, 2]);
  assert.equal(lapsed?.attendees.length, 2, "the lapsed hold is still a row until it is released");
});

// Guard against the drizzle single-table trap: an interpolated column of a one-table select renders unqualified, so a
// correlated count written with it would silently count against the inner table and give the same wrong number to
// every séance. Four séances with four different counts make such a mistake visible, in both reads that count holds.
dbTest("elapsed holds are counted per séance, in the range read and in the move targets", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const lapsedAt = addMinutes(now, -10);
  const liveAt = addMinutes(now, 30);
  const startsIn = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  // One event per séance: (event_id, series_date) is unique.
  const seance = async (hours: number, capacity: number, seatsTaken: number) =>
    rowSeance(db, pro, await rowEvent(db, pro, { capacity }), { startsAt: startsIn(hours), capacity, seatsTaken });
  const confirmed = async (occurrenceId: string) =>
    rowBooking(db, pro, { occurrenceId, customerId: await rowCustomer(db, pro) });
  const pending = (occurrenceId: string, holdExpiresAt: Date) =>
    pendingHold(db, pro, { occurrenceId, typeId, offerId, holdExpiresAt });

  const source = await seance(12, 5, 1);
  await confirmed(source);
  const twoLapsed = await seance(24, 5, 3);
  await confirmed(twoLapsed);
  await pending(twoLapsed, lapsedAt);
  await pending(twoLapsed, lapsedAt);
  const none = await seance(26, 5, 2);
  await confirmed(none);
  await confirmed(none);
  const oneLapsed = await seance(28, 1, 1);
  await pending(oneLapsed, lapsedAt);
  const oneLive = await seance(30, 5, 1);
  await pending(oneLive, liveAt);
  const ids = [twoLapsed, none, oneLapsed, oneLive];

  const { items } = await getPlanningRange(db, pro.proId, { start: now, end: startsIn(48) }, now);
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.deepEqual(
    ids.map((id) => [byId.get(id)?.seatsTaken, byId.get(id)?.elapsedHolds, byId.get(id)?.seatsShown]),
    [
      [3, 2, 4],
      [2, 0, 3],
      [1, 1, 1],
      [1, 0, 4],
    ],
  );

  // The same four séances as « Déplacer » targets of a guest booking (every target is accepted).
  const [sourceBooking] = (await planningItem(db, pro.proId, source, now))?.attendees ?? [];
  assert.ok(sourceBooking);
  const res = await moveTargets(db, pro.proId, sourceBooking.bookingId, now);
  assert.deepEqual(
    res?.targets.map((t) => [t.occurrenceId, t.seatsShown, t.capacity, t.full]),
    [
      [twoLapsed, 4, 5, false],
      [none, 3, 5, false],
      [oneLapsed, 1, 1, false],
      [oneLive, 4, 5, false],
    ],
  );
});

// Spec § 7: an RDV occupies a slot only with a confirmed booking or a pending one whose hold has not ended. A buy-mode
// RDV the client abandoned stays `scheduled` with seats_taken 1 until the nightly sweep, but it is not an appointment.
dbTest("phantom RDV: a lapsed hold alone leaves nothing on the planning; a live hold, a confirmed RDV and séances stay", async ({ db, pro }) => {
  const now = new Date();
  const startsIn = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const offerId = await rowOffer(db, pro, rdvType);
  const hold = (occurrenceId: string, holdExpiresAt: Date) =>
    pendingHold(db, pro, { occurrenceId, typeId: rdvType, offerId, holdExpiresAt });

  const abandoned = await rowRdv(db, pro, rdvType, { startsAt: startsIn(24) });
  await hold(abandoned, addMinutes(now, -10));
  const holding = await rowRdv(db, pro, rdvType, { startsAt: startsIn(26) });
  await hold(holding, addMinutes(now, 30));
  const confirmed = await rowRdv(db, pro, rdvType, { startsAt: startsIn(28) });
  await rowBooking(db, pro, { occurrenceId: confirmed, customerId: await rowCustomer(db, pro) });
  // A séance with only a lapsed hold is unchanged: it stays, with its seat shown as free.
  const seance = await rowSeance(db, pro, await rowEvent(db, pro, { capacity: 3 }), {
    startsAt: startsIn(30),
    capacity: 3,
    seatsTaken: 1,
  });
  await hold(seance, addMinutes(now, -10));

  const { items } = await getPlanningRange(db, pro.proId, { start: now, end: startsIn(48) }, now);
  assert.deepEqual(
    items.map((i) => [i.id, i.kind, i.seatsTaken, i.elapsedHolds, i.seatsShown]),
    [
      [holding, "rdv", 1, 0, 0],
      [confirmed, "rdv", 1, 0, 0],
      [seance, "seance", 1, 1, 3],
    ],
  );
  assert.equal(await planningItem(db, pro.proId, abandoned, now), null, "the abandoned RDV is not readable by id either");
  assert.deepEqual(
    (await planningItem(db, pro.proId, holding, now))?.attendees.map((a) => a.status),
    ["pending"],
  );
  assert.equal((await planningItem(db, pro.proId, confirmed, now))?.kind, "rdv");
  assert.equal((await planningItem(db, pro.proId, seance, now))?.attendees.length, 1);

  // The hold is read against the given now: ten minutes earlier the abandoned RDV was still waiting for its payment,
  // and the live hold of the other one lapses an hour later.
  assert.equal((await planningItem(db, pro.proId, abandoned, addMinutes(now, -30)))?.kind, "rdv");
  assert.equal(await planningItem(db, pro.proId, holding, addMinutes(now, 60)), null);
});

dbTest("attendees: the customer join is scoped to the pro too", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const occId = await rowSeance(db, pro, await rowEvent(db, pro, { capacity: 3 }), { capacity: 3, seatsTaken: 2 });
  await rowBooking(db, pro, { occurrenceId: occId, customerId: await rowCustomer(db, pro, { name: "Marina Costa" }) });
  // A row the engine never writes: this pro's booking pointing at another pro's customer.
  const foreign = await rowCustomer(db, other, { name: "Client de l'autre" });
  const stray = await rowBooking(db, pro, { occurrenceId: occId, customerId: foreign });
  try {
    const found = await planningItem(db, pro.proId, occId, now);
    assert.deepEqual(found?.attendees.map((a) => a.name), ["Marina Costa"]);
  } finally {
    // booking.customer_id has no cascade: the stray row has to go before the other pro does.
    await db.execute(sql`delete from booking where id = ${stray}`);
    await db.execute(sql`update occurrence set seats_taken = 1 where id = ${occId}`);
    await deleteTestUser(db, other.userId);
  }
});

dbTest("item facts: location, accepted types, questions, recurring and canRestore", async ({ db, pro }) => {
  const now = new Date();
  const tA = await makeType(db, pro, { name: "Cours collectif" });
  const tB = await makeType(db, pro, { name: "Cours d'essai" });
  const { eventId, occurrences } = await makeEvent(db, pro, {
    title: "Altinha",
    ticketTypeIds: [tA, tB],
    isPrivate: true,
    rule: {
      startDate: dayIn(pro, 3),
      freq: "weekly",
      interval: 1,
      weekdays: [dayOfWeek(dayIn(pro, 3))],
      endMode: "count",
      occurrenceCount: 2,
    },
  });
  assert.equal(occurrences.length, 2);
  await db.update(event).set({ location: "Salle A", color: "#112233" }).where(eq(event.id, eventId));
  await db.execute(sql`update occurrence set location_override = 'Salle B' where id = ${occurrences[1].id}`);
  await db.insert(question).values([
    { id: nanoid(), professionalId: pro.proId, eventId, label: "Avec un ballon ?", type: "boolean", options: null, required: true, position: 1 },
    { id: nanoid(), professionalId: pro.proId, eventId, label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false, position: 0 },
  ]);

  const first = await planningItem(db, pro.proId, occurrences[0].id, now);
  const second = await planningItem(db, pro.proId, occurrences[1].id, now);
  assert.ok(first && second);
  assert.deepEqual([first.location, first.eventLocation, first.locationOverride], ["Salle A", "Salle A", null]);
  assert.deepEqual([second.location, second.eventLocation, second.locationOverride], ["Salle B", "Salle A", "Salle B"]);
  assert.deepEqual([first.recurring, first.isPrivate, first.bookingMode, first.color, first.seriesDate], [true, true, "tickets", "#112233", dayIn(pro, 3)]);
  assert.deepEqual(first.acceptedTypes.map((t) => t.name), ["Cours collectif", "Cours d'essai"]);
  assert.deepEqual(first.questions.map((q) => [q.label, q.type, q.required, q.options]), [
    ["Niveau", "choice", false, ["Débutant", "Confirmé"]],
    ["Avec un ballon ?", "boolean", true, null],
  ]);
  assert.equal(first.canRestore, false, "a scheduled séance has nothing to restore");

  // canRestore: a cancelled future séance of a live segment, up to its until_date.
  await db.execute(sql`update event set end_mode = 'until', until_date = ${dayIn(pro, 5)}::date, occurrence_count = null where id = ${eventId}`);
  for (const o of occurrences) {
    const res = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: o.id }, now);
    assert.ok(res.ok, JSON.stringify(res));
  }
  assert.equal((await planningItem(db, pro.proId, occurrences[0].id, now))?.canRestore, true);
  assert.equal((await planningItem(db, pro.proId, occurrences[1].id, now))?.canRestore, false, "past the until_date");

  const archivedEvent = await rowEvent(db, pro, { archivedAt: now });
  const archivedSeance = await rowSeance(db, pro, archivedEvent, { status: "cancelled" });
  assert.equal((await planningItem(db, pro.proId, archivedSeance, now))?.canRestore, false, "archived segment");
  const liveEvent = await rowEvent(db, pro);
  const pastSeance = await rowSeance(db, pro, liveEvent, { status: "cancelled", startsAt: new Date(now.getTime() - 2 * DAY) });
  assert.equal((await planningItem(db, pro.proId, pastSeance, now))?.canRestore, false, "past séance");

  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const gone = await rowRdv(db, pro, rdvType, { status: "cancelled", seatsTaken: 0 });
  assert.equal(await planningItem(db, pro.proId, gone, now), null, "a cancelled RDV is not on the planning");
});

dbTest("timeDetached: a séance moved alone reads true, a normal séance and an RDV read false", async ({ db, pro }) => {
  const now = new Date();
  const { occurrences } = await makeEvent(db, pro, {
    rule: {
      startDate: dayIn(pro, 3),
      freq: "weekly",
      interval: 1,
      weekdays: [dayOfWeek(dayIn(pro, 3))],
      endMode: "count",
      occurrenceCount: 3,
    },
  });
  const [first, second, third] = occurrences;
  // A place-only edit keeps the séance on the series' time; a resize alone detaches it.
  const place = await updateOccurrence(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: first.id, seenStartsAt: first.startsAt, patch: { locationOverride: "Salle C" } },
    now,
  );
  assert.ok(place.ok, JSON.stringify(place));
  const resized = await updateOccurrence(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: second.id, seenStartsAt: second.startsAt, patch: { durationMin: 90 } },
    now,
  );
  assert.ok(resized.ok, JSON.stringify(resized));

  const rdvType = await rowRdvType(db, pro);
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 2), 840, pro.tz) });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) });

  const read = async (id: string) => (await planningItem(db, pro.proId, id, now))?.timeDetached;
  assert.deepEqual(
    [await read(first.id), await read(second.id), await read(third.id), await read(rdv)],
    [false, true, false, false],
  );
  const { items } = await getPlanningRange(db, pro.proId, { start: now, end: new Date(now.getTime() + 30 * DAY) }, now);
  assert.deepEqual(
    items.filter((i) => [first.id, second.id, third.id, rdv].includes(i.id)).map((i) => [i.id, i.timeDetached]).sort(),
    [[first.id, false], [second.id, true], [third.id, false], [rdv, false]].sort(),
  );
});

dbTest("searchCustomers: name or email, wildcards escaped, 2 characters minimum, this pro only", async ({ db, pro }) => {
  const yoga = await makeCustomer(db, pro, { name: "100% Yoga" });
  const thousand = await makeCustomer(db, pro, { name: "1000 Yoga" });
  const under = await makeCustomer(db, pro, { name: "a_b Studio" });
  const plain = await makeCustomer(db, pro, { name: "axb Studio" });
  const mail = await makeCustomer(db, pro, { name: "Zoé", email: "zoe.durand@example.com" });
  const slash = await makeCustomer(db, pro, { name: "Dos\\slash" });
  const alice = await makeCustomer(db, pro, { name: "Alice Dupont" });
  const bruno = await makeCustomer(db, pro, { name: "Bruno Dupont" });
  const other = await createTestPro(db);
  try {
    await makeCustomer(db, other, { name: "100% Yoga" });
    const ids = async (q: string, limit?: number) => (await searchCustomers(db, pro.proId, q, limit)).map((c) => c.id);
    assert.deepEqual(await ids("100%"), [yoga], "the % is literal: 1000 Yoga does not match");
    assert.deepEqual(await ids("a_b"), [under], "the _ is literal: axb Studio does not match");
    assert.deepEqual((await ids("  yoga  ")).sort(), [yoga, thousand].sort(), "trimmed, case-insensitive");
    assert.deepEqual(await ids("s\\sl"), [slash], "the backslash is literal");
    assert.deepEqual(await ids("ZOE.durand"), [mail], "e-mail search");
    assert.deepEqual(await ids("dupont"), [alice, bruno], "by name");
    assert.deepEqual(await ids("dupont", 1), [alice], "limit");
    assert.deepEqual(await ids("1"), [], "one character");
    assert.deepEqual(await ids(" a "), [], "one character once trimmed");
    assert.deepEqual(await ids(""), []);
    assert.ok(plain);
    const hit = (await searchCustomers(db, pro.proId, "zoe", 8))[0];
    assert.deepEqual([hit.id, hit.name, hit.email, hit.phone], [mail, "Zoé", "zoe.durand@example.com", null]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("registerOptions: usable tickets in consumption order, alreadyBooked, tenancy", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const unlinked = await makeType(db, pro, { name: "Cours d'essai" });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const {
    occurrences: [freeOcc],
  } = await makeEvent(db, pro, { bookingMode: "free" });
  const customerId = await makeCustomer(db, pro);
  const [forever] = await giveTickets(db, pro, customerId, typeId, 1);
  const [soon] = await giveTickets(db, pro, customerId, typeId, 1, { expiresAt: addMinutes(occ.startsAt, 1440) });
  await giveTickets(db, pro, customerId, unlinked, 1);

  const options = await registerOptions(db, pro.proId, occ.id, customerId, now);
  assert.ok(options);
  assert.equal(options.mode, "tickets");
  assert.equal(options.alreadyBooked, false);
  assert.deepEqual(
    options.usable.map((u) => [u.id, u.typeName, u.purchased]),
    [
      [soon, "Cours collectif", false],
      [forever, "Cours collectif", false],
    ],
  );
  assert.deepEqual(options.usable[0].expiresAt, addMinutes(occ.startsAt, 1440));
  assert.equal(options.usable[1].expiresAt, null);

  const booked = await registerPro(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: false },
    now,
  );
  assert.ok(booked.ok, JSON.stringify(booked));
  const after = await registerOptions(db, pro.proId, occ.id, customerId, now);
  assert.equal(after?.alreadyBooked, true);
  assert.deepEqual(after?.usable.map((u) => u.id), [forever]);

  const free = await registerOptions(db, pro.proId, freeOcc.id, customerId, now);
  assert.deepEqual([free?.mode, free?.alreadyBooked, free?.usable.length], ["free", false, 0]);

  // An RDV and unknown ids give null.
  const rdvType = await rowRdvType(db, pro);
  const rdvId = await rowRdv(db, pro, rdvType, { status: "cancelled", seatsTaken: 0 });
  assert.equal(await registerOptions(db, pro.proId, rdvId, customerId, now), null);
  assert.equal(await registerOptions(db, pro.proId, "inconnu", customerId, now), null);
  assert.equal(await registerOptions(db, pro.proId, occ.id, "inconnu", now), null);

  // Tenancy: another pro's customer or occurrence.
  const other = await createTestPro(db);
  try {
    const foreignCustomer = await makeCustomer(db, other);
    const {
      occurrences: [foreignOcc],
    } = await makeEvent(db, other);
    assert.equal(await registerOptions(db, pro.proId, occ.id, foreignCustomer, now), null);
    assert.equal(await registerOptions(db, pro.proId, foreignOcc.id, customerId, now), null);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

type MakeEventOver = NonNullable<Parameters<typeof makeEvent>[2]>;

dbTest(
  "moveTargets: ticket coverage keeps tickets-mode séances, marks accepted, conversion and full; 60 days; no source, past, RDV or cancelled",
  async ({ db, pro }) => {
    const typeX = await makeType(db, pro, { name: "Cours collectif" });
    const typeY = await makeType(db, pro, { name: "Cours d'essai" });
    const typeFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
    const mk = (title: string, day: number, over: MakeEventOver = {}) =>
      makeEvent(db, pro, { title, ...over, rule: { startDate: dayIn(pro, day), ...over.rule } });

    const source = await mk("Source", 3, { ticketTypeIds: [typeX] });
    const accepted = await mk("Acceptée", 4, { ticketTypeIds: [typeX] });
    const conversion = await mk("Conversion", 5, { ticketTypeIds: [typeY, typeFree] });
    await mk("Sans lien", 6);
    await mk("Libre", 7, { bookingMode: "free" });
    const struck = await mk("Annulée", 8, { ticketTypeIds: [typeX] });
    const full = await mk("Complète", 9, { ticketTypeIds: [typeX], capacity: 1 });
    await mk("Passée", -2, { ticketTypeIds: [typeX] });
    const near = await mk("Proche", 59, { ticketTypeIds: [typeX] });
    await mk("Lointaine", 61, { ticketTypeIds: [typeX] });
    const cancelled = await cancelOccurrence(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: struck.occurrences[0].id },
      new Date(),
    );
    assert.ok(cancelled.ok, JSON.stringify(cancelled));

    const rdvType = await rowRdvType(db, pro);
    const rdvId = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 6), 840, pro.tz) });
    const guest = await makeCustomer(db, pro);
    await rowBooking(db, pro, { occurrenceId: rdvId, customerId: guest });

    const thomas = await makeCustomer(db, pro, { name: "Thomas Leroy" });
    await giveTickets(db, pro, thomas, typeX, 1);
    const booked = await registerPro(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      occurrenceId: source.occurrences[0].id,
      customerId: thomas,
      asGuest: false,
    });
    assert.ok(booked.ok, JSON.stringify(booked));
    const filler = await makeCustomer(db, pro);
    const fill = await registerPro(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      occurrenceId: full.occurrences[0].id,
      customerId: filler,
      asGuest: true,
    });
    assert.ok(fill.ok, JSON.stringify(fill));

    // A fixed "now" (today 12:00, pro tz) keeps the 60-day window and the 5-day window deterministic.
    const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
    const res = await moveTargets(db, pro.proId, booked.bookingId, noon);
    assert.ok(res);
    assert.deepEqual(
      res.targets.map((t) => [t.title, t.occurrenceId, t.accepted, t.conversionTypes, t.full, t.expiresBefore, t.capacity, t.seatsShown]),
      [
        ["Acceptée", accepted.occurrences[0].id, true, [], false, false, 12, 12],
        ["Conversion", conversion.occurrences[0].id, false, [{ id: typeY, name: "Cours d'essai" }], false, false, 12, 12],
        ["Complète", full.occurrences[0].id, true, [], true, false, 1, 0],
        ["Proche", near.occurrences[0].id, true, [], false, false, 12, 12],
      ],
    );
    assert.deepEqual(
      res.targets.map((t) => t.seriesRootId),
      [accepted.eventId, conversion.eventId, full.eventId, near.eventId],
    );
    assert.deepEqual(
      res.series,
      [
        { seriesRootId: accepted.eventId, title: "Acceptée" },
        { seriesRootId: full.eventId, title: "Complète" },
        { seriesRootId: conversion.eventId, title: "Conversion" },
        { seriesRootId: near.eventId, title: "Proche" },
      ],
    );
    assert.ok(res.targets.every((t) => t.occurrenceId !== source.occurrences[0].id), "the source is excluded");

    const short = await moveTargets(db, pro.proId, booked.bookingId, noon, { days: 5 });
    assert.deepEqual(short?.targets.map((t) => t.title), ["Acceptée", "Conversion"]);
  },
  { timeout: 240_000 },
);

dbTest("moveTargets: expiresBefore compares the ticket expiry with each target start", async ({ db, pro }) => {
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const mk = (title: string, day: number) =>
    makeEvent(db, pro, { title, ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, day) } });
  const source = await mk("Source", 3);
  const day4 = await mk("Jour 4", 4);
  const day6 = await mk("Jour 6", 6);
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeX, 1, { expiresAt: instantAt(dayIn(pro, 5), 0, pro.tz) });
  const booked = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: source.occurrences[0].id,
    customerId,
    asGuest: false,
  });
  assert.ok(booked.ok, JSON.stringify(booked));

  const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
  const res = await moveTargets(db, pro.proId, booked.bookingId, noon);
  assert.deepEqual(
    res?.targets.map((t) => [t.occurrenceId, t.expiresBefore, t.accepted]),
    [
      [day4.occurrences[0].id, false, true],
      [day6.occurrences[0].id, true, true],
    ],
  );
});

dbTest("moveTargets: a guest booking sees every scheduled séance; series filter; null cases", async ({ db, pro }) => {
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const source = await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, 3) } });
  const weekly = await makeEvent(db, pro, {
    title: "Hebdo",
    rule: {
      startDate: dayIn(pro, 4),
      freq: "weekly",
      interval: 1,
      weekdays: [dayOfWeek(dayIn(pro, 4))],
      endMode: "count",
      occurrenceCount: 3,
    },
  });
  const free = await makeEvent(db, pro, { title: "Libre", bookingMode: "free", rule: { startDate: dayIn(pro, 6) } });
  assert.equal(weekly.occurrences.length, 3);
  const customerId = await makeCustomer(db, pro);
  const booked = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: source.occurrences[0].id,
    customerId,
    asGuest: true,
  });
  assert.ok(booked.ok, JSON.stringify(booked));

  const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
  const all = await moveTargets(db, pro.proId, booked.bookingId, noon);
  assert.ok(all);
  assert.deepEqual(
    all.targets.map((t) => [t.title, t.accepted, t.conversionTypes, t.expiresBefore]),
    [
      ["Hebdo", true, [], false],
      ["Libre", true, [], false],
      ["Hebdo", true, [], false],
      ["Hebdo", true, [], false],
    ],
  );
  assert.deepEqual(all.series, [
    { seriesRootId: weekly.eventId, title: "Hebdo" },
    { seriesRootId: free.eventId, title: "Libre" },
  ]);
  const onlyWeekly = await moveTargets(db, pro.proId, booked.bookingId, noon, { seriesRootId: weekly.eventId });
  assert.deepEqual(onlyWeekly?.targets.map((t) => t.occurrenceId), weekly.occurrences.map((o) => o.id));
  assert.equal(onlyWeekly?.series.length, 2, "the series list ignores the filter");
  const none = await moveTargets(db, pro.proId, booked.bookingId, noon, { seriesRootId: "inconnu" });
  assert.deepEqual(none?.targets, []);

  // Not movable: another pro, unknown, cancelled booking, RDV booking.
  const other = await createTestPro(db);
  try {
    assert.equal(await moveTargets(db, other.proId, booked.bookingId, noon), null);
  } finally {
    await deleteTestUser(db, other.userId);
  }
  assert.equal(await moveTargets(db, pro.proId, "inconnu", noon), null);
  const rdvType = await rowRdvType(db, pro);
  const rdvId = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 6), 840, pro.tz) });
  const rdvBooking = await rowBooking(db, pro, { occurrenceId: rdvId, customerId: await makeCustomer(db, pro) });
  assert.equal(await moveTargets(db, pro.proId, rdvBooking, noon), null, "an RDV booking is not movable");
  const left = await cancelBookingsByPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: source.occurrences[0].id,
    bookingIds: [booked.bookingId],
  });
  assert.ok(left.ok, JSON.stringify(left));
  assert.equal(await moveTargets(db, pro.proId, booked.bookingId, noon), null, "a cancelled booking is not movable");
});

// The 500 row cap of moveTargets is a backstop: what the pro can never move to (wrong booking mode, no usable type,
// another series) must be left out in SQL, before the cap, or it fills it and hides the real targets. `maxTargets`
// lowers the cap so a handful of rows shows it.
dbTest("moveTargets: booking mode and usable types are filtered before the cap, and so is the series list", async ({ db, pro }) => {
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const typeY = await makeType(db, pro, { name: "Cours d'essai" });
  const typeFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const typeOld = await makeType(db, pro, { name: "Ancien cours" });
  const mk = (title: string, day: number, over: MakeEventOver = {}) =>
    makeEvent(db, pro, { title, ...over, rule: { startDate: dayIn(pro, day), ...over.rule } });

  const source = await mk("Source", 3, { ticketTypeIds: [typeX] });
  await mk("Libre 1", 4, { bookingMode: "free" });
  await mk("Libre 2", 5, { bookingMode: "free" });
  await mk("Sans lien", 6);
  await mk("Appel seul", 7, { ticketTypeIds: [typeFree] });
  await mk("Ancien", 8, { ticketTypeIds: [typeOld] });
  await db.execute(sql`update ticket_type set archived_at = now() where id = ${typeOld}`);
  const accepted = await mk("Acceptée", 9, { ticketTypeIds: [typeX] });
  const conversion = await mk("Conversion", 10, { ticketTypeIds: [typeY] });
  const thomas = await makeCustomer(db, pro, { name: "Thomas Leroy" });
  await giveTickets(db, pro, thomas, typeX, 1);
  const booked = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: source.occurrences[0].id,
    customerId: thomas,
    asGuest: false,
  });
  assert.ok(booked.ok, JSON.stringify(booked));

  const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
  const res = await moveTargets(db, pro.proId, booked.bookingId, noon, { maxTargets: 3 });
  assert.deepEqual(
    res?.targets.map((t) => [t.title, t.occurrenceId, t.accepted, t.conversionTypes.map((c) => c.name)]),
    [
      ["Acceptée", accepted.occurrences[0].id, true, []],
      ["Conversion", conversion.occurrences[0].id, false, ["Cours d'essai"]],
    ],
  );
  assert.deepEqual(res?.series.map((s) => s.title), ["Acceptée", "Conversion"]);
});

dbTest("moveTargets: the series filter is applied before the cap and the series list is complete", async ({ db, pro }) => {
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const mk = (title: string, day: number, over: MakeEventOver = {}) =>
    makeEvent(db, pro, { title, ...over, rule: { startDate: dayIn(pro, day), ...over.rule } });
  const source = await mk("Source", 3, { ticketTypeIds: [typeX] });
  const premier = await mk("Premier", 4, { rule: { freq: "daily", interval: 1, endMode: "count", occurrenceCount: 3 } });
  const cible = await mk("Cible", 9);
  const autre = await mk("Autre", 10);
  assert.equal(premier.occurrences.length, 3);
  const customerId = await makeCustomer(db, pro);
  const booked = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: source.occurrences[0].id,
    customerId,
    asGuest: true,
  });
  assert.ok(booked.ok, JSON.stringify(booked));

  const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
  const series = [
    { seriesRootId: autre.eventId, title: "Autre" },
    { seriesRootId: cible.eventId, title: "Cible" },
    { seriesRootId: premier.eventId, title: "Premier" },
  ];
  const capped = await moveTargets(db, pro.proId, booked.bookingId, noon, { maxTargets: 3 });
  assert.deepEqual(capped?.targets.map((t) => t.occurrenceId), premier.occurrences.map((o) => o.id), "the cap keeps the first three");
  assert.deepEqual(capped?.series, series, "every series is listed, the cap only limits the targets");
  const only = await moveTargets(db, pro.proId, booked.bookingId, noon, { maxTargets: 3, seriesRootId: cible.eventId });
  assert.deepEqual(only?.targets.map((t) => t.occurrenceId), [cible.occurrences[0].id]);
  assert.deepEqual(only?.series, series, "the series list ignores the filter");
});

dbTest("moveTargets: customerBooked is the already_booked refusal of the move, target by target", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const startsIn = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
  // One event per séance: (event_id, series_date) is unique.
  const seance = async (hours: number, seatsTaken: number) =>
    rowSeance(db, pro, await rowEvent(db, pro, { capacity: 5 }), { startsAt: startsIn(hours), capacity: 5, seatsTaken });
  const thomas = await rowCustomer(db, pro, { name: "Thomas Leroy" });
  const marina = await rowCustomer(db, pro, { name: "Marina Costa" });

  const source = await seance(12, 1);
  const sourceBooking = await rowBooking(db, pro, { occurrenceId: source, customerId: thomas });
  const confirmedHere = await seance(24, 1);
  await rowBooking(db, pro, { occurrenceId: confirmedHere, customerId: thomas });
  const liveHold = await seance(26, 1);
  await pendingHold(db, pro, { occurrenceId: liveHold, typeId, offerId, customerId: thomas, holdExpiresAt: addMinutes(now, 30) });
  const lapsedHold = await seance(28, 1);
  await pendingHold(db, pro, { occurrenceId: lapsedHold, typeId, offerId, customerId: thomas, holdExpiresAt: addMinutes(now, -10) });
  const cancelledHere = await seance(30, 0);
  await rowBooking(db, pro, { occurrenceId: cancelledHere, customerId: thomas, status: "cancelled" });
  const someoneElse = await seance(32, 1);
  await rowBooking(db, pro, { occurrenceId: someoneElse, customerId: marina });
  const empty = await seance(34, 0);

  const res = await moveTargets(db, pro.proId, sourceBooking, now);
  assert.deepEqual(
    res?.targets.map((t) => [t.occurrenceId, t.customerBooked]),
    [
      [confirmedHere, true],
      [liveHold, true],
      [lapsedHold, false],
      [cancelledHere, false],
      [someoneElse, false],
      [empty, false],
    ],
  );

  // The engine agrees: it refuses the two `true` targets, and moves onto the one whose hold has lapsed.
  const move = (targetOccurrenceId: string) =>
    moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: sourceBooking, targetOccurrenceId, force: true }, now);
  for (const target of [confirmedHere, liveHold]) {
    const refused = await move(target);
    assert.ok(!refused.ok && refused.code === "already_booked", JSON.stringify(refused));
  }
  const moved = await move(lapsedHold);
  assert.ok(moved.ok, JSON.stringify(moved));
});
