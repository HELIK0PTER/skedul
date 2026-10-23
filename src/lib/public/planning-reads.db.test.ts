import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { cancelOccurrence } from "@/lib/booking/cancel";
import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { instantAt, type DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { event, eventTicketType, occurrence, timeOff } from "@/lib/db/schema";
import { addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, makeEvent, makeType } from "@/test/fixtures";
import { rowBooking, rowCustomer, rowEvent, rowLink, rowOffer, rowPurchase, rowSeance, rowType } from "@/test/rows";

import { acceptedTypesOf, effectiveLocation, listPublicSeances, nextPublicSeanceStart } from "./planning-reads";

const WINDOW = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };
const LA = "America/Los_Angeles";

/** The PublicPro fields the reads need, with the pro's default booking settings. */
const proOf = (pro: TestPro) => ({ professionalId: pro.proId, timezone: pro.tz, window: WINDOW });

/** From yesterday to 120 local days ahead: wide enough for every séance of these tests. */
const wide = (pro: TestPro, now: Date) => ({
  start: addMinutes(now, -24 * 60),
  end: instantAt(dayIn(pro, 120, now), 0, pro.tz),
});

/** A séance of `eventId` at `minute` (wall clock) of the local day `days` ahead; its series date is that day. */
function seanceAt(
  db: Db,
  pro: TestPro,
  eventId: string,
  now: Date,
  days: number,
  over: { minute?: number; capacity?: number; seatsTaken?: number; status?: "scheduled" | "cancelled" } = {},
): Promise<string> {
  const day: DateKey = dayIn(pro, days, now);
  const { minute, ...row } = over;
  return rowSeance(db, pro, eventId, { startsAt: instantAt(day, minute ?? 600, pro.tz), seriesDate: day, ...row }, now);
}

/** A pending booking (ticket coverage) backed by a pending purchase, as « buy + book » leaves it until the client pays. */
async function pendingHold(
  db: Db,
  pro: TestPro,
  args: { occurrenceId: string; typeId: string; offerId: string; holdExpiresAt: Date },
): Promise<void> {
  const customerId = await rowCustomer(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId: args.offerId, ticketTypeId: args.typeId });
  await rowBooking(db, pro, {
    occurrenceId: args.occurrenceId,
    customerId,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: args.holdExpiresAt,
  });
}

dbTest("listPublicSeances: the public séances of the range, in order, with place, seats, accepted types and window", async ({ db, pro }) => {
  const now = new Date();
  const collectif = await makeType(db, pro, { name: "Cours collectif", color: "#22c55e" });
  const essai = await makeType(db, pro, { name: "Cours d'essai", color: "#f59e0b" });
  const ancien = await makeType(db, pro, { name: "Ancien type" });

  const debutants = await makeEvent(db, pro, { title: "Altinha débutants", capacity: 12, ticketTypeIds: [collectif, essai, ancien] }, now);
  const archivedType = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: ancien, archived: true });
  assert.ok(archivedType.ok, JSON.stringify(archivedType));
  await db.update(event).set({ location: "Gymnase Jean Bouin", cancelDeadlineHours: 48 }).where(eq(event.id, debutants.eventId));

  // A free séance: its own place wins over the event's, and a stale ticket link accepts nothing.
  const roda = await makeEvent(db, pro, { title: "Roda libre", bookingMode: "free", capacity: 20, rule: { startDate: dayIn(pro, 4, now) } }, now);
  await rowLink(db, pro, roda.eventId, collectif);
  await db.update(event).set({ location: "Gymnase Jean Bouin" }).where(eq(event.id, roda.eventId));
  await db.update(occurrence).set({ locationOverride: "Plage de Copacabana" }).where(eq(occurrence.id, roda.occurrences[0].id));

  // A cancelled séance stays on the page, with an empty place ("" is no place).
  const annulee = await makeEvent(db, pro, { title: "Altinha annulée", ticketTypeIds: [collectif], rule: { startDate: dayIn(pro, 6, now) } }, now);
  await db.update(event).set({ location: "" }).where(eq(event.id, annulee.eventId));
  const cancelled = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: annulee.occurrences[0].id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));

  const surPlace = await makeEvent(db, pro, { title: "Atelier sur place", bookingMode: "none", rule: { startDate: dayIn(pro, 7, now) } }, now);

  // Left out: a private event, an archived event, a séance that already started.
  await makeEvent(db, pro, { title: "Équipe compétition", isPrivate: true, rule: { startDate: dayIn(pro, 3, now) } }, now);
  const archivedEvent = await makeEvent(db, pro, { title: "Atelier archivé", rule: { startDate: dayIn(pro, 5, now) } }, now);
  await db.update(event).set({ archivedAt: now }).where(eq(event.id, archivedEvent.eventId));
  await rowSeance(db, pro, await rowEvent(db, pro, {}, now), { startsAt: addMinutes(now, -120) }, now);

  const other = await createTestPro(db);
  try {
    await makeEvent(db, other, { title: "Chez l'autre" }, now);
    const seances = await listPublicSeances(db, proOf(pro), wide(pro, now), now);

    assert.deepEqual(
      seances.map((s) => [s.title, s.status, s.bookingMode, s.location, s.capacity, s.seatsLeft, s.acceptedTypes.map((t) => t.name)]),
      [
        ["Altinha débutants", "scheduled", "tickets", "Gymnase Jean Bouin", 12, 12, ["Cours collectif", "Cours d'essai"]],
        ["Roda libre", "scheduled", "free", "Plage de Copacabana", 20, 20, []],
        ["Altinha annulée", "cancelled", "tickets", null, 12, 12, ["Cours collectif"]],
        ["Atelier sur place", "scheduled", "none", null, 12, 12, []],
      ],
    );
    const [first, , , last] = seances;
    assert.deepEqual(first.acceptedTypes, [
      { id: collectif, name: "Cours collectif", color: "#22c55e" },
      { id: essai, name: "Cours d'essai", color: "#f59e0b" },
    ]);
    assert.equal(first.occurrenceId, debutants.occurrences[0].id);
    assert.equal(first.eventId, debutants.eventId);
    assert.deepEqual(first.startsAt, debutants.occurrences[0].startsAt);
    assert.deepEqual(first.endsAt, debutants.occurrences[0].endsAt);
    assert.equal(first.color, "#6366f1");
    assert.equal(first.underTimeOff, false);
    assert.deepEqual(first.window, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 48 }, "the event's own deadline");
    assert.deepEqual(seances[1].window, WINDOW);
    assert.equal(last.occurrenceId, surPlace.occurrences[0].id);

    // Tenancy: the other pro sees its own séance only, and mine do not leak.
    const theirs = await listPublicSeances(db, proOf(other), wide(other, now), now);
    assert.deepEqual(theirs.map((s) => s.title), ["Chez l'autre"]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

test("effectiveLocation: the séance's own place, else the event's, an empty or blank place is none", () => {
  assert.equal(effectiveLocation("Salle B", "Gymnase"), "Salle B");
  assert.equal(effectiveLocation(null, "Gymnase"), "Gymnase");
  assert.equal(effectiveLocation(null, null), null);
  assert.equal(effectiveLocation("", "Gymnase"), null, "coalesce keeps the empty override, which is no place");
  assert.equal(effectiveLocation(null, ""), null);
  assert.equal(effectiveLocation(null, "   "), null);
});

dbTest("listPublicSeances: the range is half-open on the start, and the read never lists a séance that started", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro, {}, now);
  const id = await seanceAt(db, pro, eventId, now, 3);
  const [row] = await db.select({ startsAt: occurrence.startsAt }).from(occurrence).where(eq(occurrence.id, id));
  const ids = async (start: Date, end: Date) => (await listPublicSeances(db, proOf(pro), { start, end }, now)).map((s) => s.occurrenceId);
  assert.deepEqual(await ids(row.startsAt, addMinutes(row.startsAt, 60)), [id], "the start is included");
  assert.deepEqual(await ids(addMinutes(row.startsAt, -60), row.startsAt), [], "the end is excluded");
  assert.deepEqual(await ids(addMinutes(row.startsAt, 1), addMinutes(row.startsAt, 60)), []);

  // starts_at > now: a séance at `now` itself is already started.
  const started = await rowSeance(db, pro, eventId, { startsAt: now, seriesDate: "2020-01-01" }, now);
  assert.equal((await ids(addMinutes(now, -60), addMinutes(now, 60))).includes(started), false);
});

dbTest("listPublicSeances: the horizon is a local date, the pro's own or the event's, and the notice never hides a séance", async ({ db, pro }) => {
  const now = new Date();
  const standard = await rowEvent(db, pro, {}, now);
  const short = await rowEvent(db, pro, {}, now);
  const long = await rowEvent(db, pro, {}, now);
  await db.update(event).set({ bookingHorizonDays: 5 }).where(eq(event.id, short));
  await db.update(event).set({ bookingHorizonDays: 90 }).where(eq(event.id, long));

  const in60 = await seanceAt(db, pro, standard, now, 60);
  await seanceAt(db, pro, standard, now, 61);
  const in5 = await seanceAt(db, pro, short, now, 5);
  await seanceAt(db, pro, short, now, 6);
  const in75 = await seanceAt(db, pro, long, now, 75);
  await seanceAt(db, pro, long, now, 91);
  // Inside the 60 minute notice: still listed (the page then says « Réservations fermées »).
  const soon = await rowSeance(db, pro, standard, { startsAt: addMinutes(now, 30), seriesDate: "2020-02-02" }, now);

  const got = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
  assert.deepEqual(
    got.map((s) => s.occurrenceId),
    [soon, in5, in60, in75],
  );
  assert.deepEqual(got.map((s) => s.window.bookingHorizonDays), [60, 5, 60, 90]);
});

dbTest("listPublicSeances: the horizon follows the pro's zone, not UTC", async ({ db }) => {
  const la = await createTestPro(db, { tz: LA });
  try {
    const now = new Date();
    const eventId = await rowEvent(db, la, {}, now);
    // 23:30 on the last local day is already the next day in UTC; 00:30 on the day after is still the same UTC day.
    const lastDay = await seanceAt(db, la, eventId, now, 60, { minute: 23 * 60 + 30 });
    const nextDay = await seanceAt(db, la, eventId, now, 61, { minute: 30 });
    const got = await listPublicSeances(db, proOf(la), wide(la, now), now);
    assert.deepEqual(got.map((s) => s.occurrenceId), [lastDay]);
    assert.notEqual(nextDay, lastDay);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("listPublicSeances: an empty séance under a time off is hidden, a booked or a cancelled one stays", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro, {}, now);
  const empty = await seanceAt(db, pro, eventId, now, 4);
  const booked = await seanceAt(db, pro, eventId, now, 5, { seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: booked, customerId: await rowCustomer(db, pro), status: "confirmed" }, now);
  const cancelled = await seanceAt(db, pro, eventId, now, 6, { status: "cancelled" });
  const after = await seanceAt(db, pro, eventId, now, 8);
  await db.insert(timeOff).values({
    id: nanoid(),
    professionalId: pro.proId,
    startAt: instantAt(dayIn(pro, 4, now), 0, pro.tz),
    endAt: instantAt(dayIn(pro, 8, now), 0, pro.tz),
    allDay: true,
    reason: "Vacances",
  });

  const hidden = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
  assert.deepEqual(
    hidden.map((s) => [s.occurrenceId, s.underTimeOff]),
    [
      [booked, true],
      [cancelled, true],
      [after, false],
    ],
  );
  assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), now, now), hidden[0].startsAt, "the hidden séance is not the next one");

  // Removing the time off brings the hidden séance back.
  await db.delete(timeOff).where(eq(timeOff.professionalId, pro.proId));
  const back = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
  assert.deepEqual(
    back.map((s) => [s.occurrenceId, s.underTimeOff]),
    [
      [empty, false],
      [booked, false],
      [cancelled, false],
      [after, false],
    ],
  );
});

dbTest("listPublicSeances: a time off overlaps by one minute or not at all", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro, {}, now);
  const apart = await seanceAt(db, pro, eventId, now, 4); // 10:00 to 11:00
  const cut = await seanceAt(db, pro, eventId, now, 9);
  const day4 = (minute: number) => instantAt(dayIn(pro, 4, now), minute, pro.tz);
  const day9 = (minute: number) => instantAt(dayIn(pro, 9, now), minute, pro.tz);
  await db.insert(timeOff).values([
    { id: nanoid(), professionalId: pro.proId, startAt: day4(540), endAt: day4(600), allDay: false, reason: "avant" },
    { id: nanoid(), professionalId: pro.proId, startAt: day4(660), endAt: day4(720), allDay: false, reason: "après" },
    { id: nanoid(), professionalId: pro.proId, startAt: day9(659), endAt: day9(720), allDay: false, reason: "chevauche" },
  ]);
  const got = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
  assert.deepEqual(
    got.map((s) => [s.occurrenceId, s.underTimeOff]),
    [[apart, false]],
    "touching bounds do not overlap; the séance cut by a minute is empty and hidden",
  );
  assert.equal(got.some((s) => s.occurrenceId === cut), false);
});

dbTest("listPublicSeances: seats shown count a lapsed hold as free, a live hold as taken", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro, { capacity: 5 }, now);
  const busy = await seanceAt(db, pro, eventId, now, 3, { capacity: 5, seatsTaken: 3 });
  await rowBooking(db, pro, { occurrenceId: busy, customerId: await rowCustomer(db, pro), status: "confirmed" }, now);
  await pendingHold(db, pro, { occurrenceId: busy, typeId, offerId, holdExpiresAt: addMinutes(now, 30) });
  await pendingHold(db, pro, { occurrenceId: busy, typeId, offerId, holdExpiresAt: addMinutes(now, -5) });
  const full = await seanceAt(db, pro, eventId, now, 4, { capacity: 2, seatsTaken: 2 });
  for (let i = 0; i < 2; i++) {
    await rowBooking(db, pro, { occurrenceId: full, customerId: await rowCustomer(db, pro), status: "confirmed" }, now);
  }
  const got = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
  assert.deepEqual(
    got.map((s) => [s.occurrenceId, s.capacity, s.seatsLeft]),
    [
      [busy, 5, 3],
      [full, 2, 0],
    ],
    "5 seats, 3 taken, one of them a lapsed hold: 3 left",
  );
});

dbTest("nextPublicSeanceStart: the first séance the list would show at or after the date", async ({ db, pro }) => {
  const now = new Date();
  const publicEvent = await rowEvent(db, pro, {}, now);
  const privateEvent = await rowEvent(db, pro, { isPrivate: true }, now);
  const archivedEvent = await rowEvent(db, pro, { archivedAt: now }, now);
  const hiddenByPrivate = await seanceAt(db, pro, privateEvent, now, 1);
  const hiddenByArchive = await seanceAt(db, pro, archivedEvent, now, 2);
  const hiddenByTimeOff = await seanceAt(db, pro, publicEvent, now, 3);
  const visible = await seanceAt(db, pro, publicEvent, now, 4);
  const cancelled = await seanceAt(db, pro, publicEvent, now, 6, { status: "cancelled" });
  const beyond = await seanceAt(db, pro, publicEvent, now, 90);
  await db.insert(timeOff).values({
    id: nanoid(),
    professionalId: pro.proId,
    startAt: instantAt(dayIn(pro, 3, now), 0, pro.tz),
    endAt: instantAt(dayIn(pro, 4, now), 0, pro.tz),
    allDay: true,
    reason: null,
  });
  const startOf = async (id: string) => (await db.select({ at: occurrence.startsAt }).from(occurrence).where(eq(occurrence.id, id)))[0].at;

  assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), now, now), await startOf(visible), "private, archived and hidden séances are skipped");
  assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), await startOf(visible), now), await startOf(visible), "at or after");
  assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), addMinutes(await startOf(visible), 1), now), await startOf(cancelled), "a cancelled séance is shown, so it counts");
  assert.equal(await nextPublicSeanceStart(db, proOf(pro), addMinutes(await startOf(cancelled), 1), now), null, "beyond the horizon is not listed");
  assert.equal(new Set([hiddenByPrivate, hiddenByArchive, hiddenByTimeOff, beyond, visible, cancelled]).size, 6);

  const other = await createTestPro(db);
  try {
    assert.equal(await nextPublicSeanceStart(db, proOf(other), now, now), null, "another pro has no séance");
    await makeEvent(db, other, { title: "Chez l'autre" }, now);
    assert.ok(await nextPublicSeanceStart(db, proOf(other), now, now));
    assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), now, now), await startOf(visible), "and mine is unchanged");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("tenancy: another pro's time off, types and séances never reach this pro's page", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const mine = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] }, now);
  const other = await createTestPro(db);
  try {
    // The other pro blocks the same day and owns an event with a type of the same name.
    await db.insert(timeOff).values({
      id: nanoid(),
      professionalId: other.proId,
      startAt: instantAt(dayIn(pro, 2, now), 0, pro.tz),
      endAt: instantAt(dayIn(pro, 5, now), 0, pro.tz),
      allDay: true,
      reason: null,
    });
    const theirType = await makeType(db, other, { name: "Cours collectif" });
    await makeEvent(db, other, { title: "Chez l'autre", ticketTypeIds: [theirType] }, now);

    const got = await listPublicSeances(db, proOf(pro), wide(pro, now), now);
    assert.deepEqual(got.map((s) => [s.occurrenceId, s.underTimeOff, s.acceptedTypes.map((t) => t.id)]), [
      [mine.occurrences[0].id, false, [typeId]],
    ]);
    // Their own empty séance is hidden by their own time off; nothing of mine is.
    assert.deepEqual(await listPublicSeances(db, proOf(other), wide(other, now), now), []);
    await db.delete(timeOff).where(eq(timeOff.professionalId, other.proId));
    const theirs = await listPublicSeances(db, proOf(other), wide(other, now), now);
    assert.deepEqual(theirs.map((s) => [s.title, s.acceptedTypes.map((t) => t.id)]), [["Chez l'autre", [theirType]]]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("tenancy: séances that cross two pros, built by hand, are in neither list and never the next séance (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const handBuilt: string[] = [];
  try {
    const mine = await makeEvent(db, pro, { title: "Altinha débutants", rule: { startDate: dayIn(pro, 5, now) } }, now);
    const theirs = await makeEvent(db, other, { title: "Chez l'autre", rule: { startDate: dayIn(other, 5, now) } }, now);
    // Séances that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b, the way my-space.db.test.ts builds them): the other pro's id
    // on MY event (the occurrence filter refuses it on my page, the event filter on theirs) and my id on THEIR event
    // (the event filter refuses it on my page, the occurrence filter on theirs). Both start before the genuine séances,
    // so a page's next séance would be a crossed one if either filter let it through.
    handBuilt.push(await seanceAt(db, other, mine.eventId, now, 2));
    handBuilt.push(await seanceAt(db, pro, theirs.eventId, now, 3));

    const idsOf = async (p: TestPro) => (await listPublicSeances(db, proOf(p), wide(p, now), now)).map((s) => s.occurrenceId);
    assert.deepEqual(await idsOf(pro), [mine.occurrences[0].id]);
    assert.deepEqual(await idsOf(other), [theirs.occurrences[0].id]);
    assert.deepEqual(await nextPublicSeanceStart(db, proOf(pro), now, now), mine.occurrences[0].startsAt);
    assert.deepEqual(await nextPublicSeanceStart(db, proOf(other), now, now), theirs.occurrences[0].startsAt);
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of handBuilt) await db.delete(occurrence).where(eq(occurrence.id, id));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("tenancy: links that cross two pros, built by hand, never make another pro's type accepted (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const handBuilt: { eventId: string; ticketTypeId: string }[] = [];
  /** A link row written under `owner`'s professional_id, whoever the event and the type belong to. */
  const link = async (owner: TestPro, eventId: string, ticketTypeId: string) => {
    await rowLink(db, owner, eventId, ticketTypeId, now);
    handBuilt.push({ eventId, ticketTypeId });
  };
  try {
    const myType = await makeType(db, pro, { name: "Cours collectif" });
    const theirType = await makeType(db, other, { name: "Cours d'essai" });
    const sides = [
      { me: pro, them: other, own: myType, foreign: theirType },
      { me: other, them: pro, own: theirType, foreign: myType },
    ];
    const built: { me: TestPro; own: string; plain: string; crossed: string }[] = [];
    for (const side of sides) {
      const plain = await makeEvent(db, side.me, { title: "Séance avec son type", ticketTypeIds: [side.own], rule: { startDate: dayIn(side.me, 4, now) } }, now);
      const crossed = await makeEvent(db, side.me, { title: "Séance sans type", rule: { startDate: dayIn(side.me, 5, now) } }, now);
      // Links that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
      // read's own professional filters keep them out; G3b). Each is refused by exactly one filter of acceptedTypesOf,
      // so removing either filter lets one of them through: the other pro's type linked to my event under MY id (the
      // type's filter), the same under THEIR id (both filters), and my own type linked to my event under THEIR id (the
      // link's filter).
      await link(side.me, plain.eventId, side.foreign);
      await link(side.them, crossed.eventId, side.foreign);
      await link(side.them, crossed.eventId, side.own);
      built.push({ me: side.me, own: side.own, plain: plain.eventId, crossed: crossed.eventId });
    }

    for (const b of built) {
      const seances = await listPublicSeances(db, proOf(b.me), wide(b.me, now), now);
      assert.deepEqual(
        seances.map((s) => [s.eventId, s.acceptedTypes.map((t) => t.id)]),
        [
          [b.plain, [b.own]],
          [b.crossed, []],
        ],
        "only the pro's own type, linked under the pro's own id, is accepted",
      );
      // acceptedTypesOf trusts the event ids it is given (its callers read them under the pro's own filter): ask it for
      // the events of the pro whose id it is given.
      const accepted = await acceptedTypesOf(db, b.me.proId, [b.plain, b.crossed]);
      assert.deepEqual([...accepted].map(([eventId, types]) => [eventId, types.map((t) => t.id)]), [[b.plain, [b.own]]]);
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const l of handBuilt) {
      await db.delete(eventTicketType).where(and(eq(eventTicketType.eventId, l.eventId), eq(eventTicketType.ticketTypeId, l.ticketTypeId)));
    }
    await deleteTestUser(db, other.userId);
  }
});
