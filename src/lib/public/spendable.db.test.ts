import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { formatWhen } from "@/lib/back-office/format";
import { bookWithHeldTicket } from "@/lib/booking/claims";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { SPENDABLE_DAYS, SPENDABLE_MAX, spendableSeances } from "@/lib/public/spendable";
import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, getOccurrence, giveTickets, makeCustomer, makeEvent, makeType } from "@/test/fixtures";
import { rowBooking, rowCustomer, rowEvent, rowLink, rowOffer, rowPurchase, rowSeance, rowTicket, rowType } from "@/test/rows";

/** A customer of `p` holding one ticket of a type that an event 3 days ahead accepts. */
async function eligibleFor(db: Db, p: TestPro, now: Date): Promise<{ customerId: string; occurrenceId: string }> {
  const typeId = await makeType(db, p, { name: "Cours collectif" });
  const {
    occurrences: [occ],
  } = await makeEvent(db, p, { ticketTypeIds: [typeId] }, now);
  const customerId = await makeCustomer(db, p);
  await giveTickets(db, p, customerId, typeId, 1);
  return { customerId, occurrenceId: occ.id };
}

dbTest(
  "spendableSeances: lists the séances a held ticket can book now, soonest first, and none the engine would refuse",
  async ({ db, pro }) => {
    const now = new Date();
    const typeId = await makeType(db, pro, { name: "Cours collectif" });
    const customerId = await makeCustomer(db, pro);
    await giveTickets(db, pro, customerId, typeId, 2);

    /** An event of `typeId` whose only séance is `days` ahead (10:00 in the pro's zone). */
    const eventAt = async (days: number, over: Parameters<typeof makeEvent>[2] = {}) => {
      const { eventId, occurrences } = await makeEvent(
        db,
        pro,
        { ticketTypeIds: [typeId], ...over, rule: { startDate: dayIn(pro, days, now), ...over.rule } },
        now,
      );
      return { eventId, occ: occurrences[0] };
    };
    const book = async (who: string, occ: { id: string; startsAt: Date }) => {
      const res = await bookWithHeldTicket(
        db,
        { professionalId: pro.proId, occurrenceId: occ.id, customerId: who, seenStartsAt: occ.startsAt, actorUserId: pro.userId },
        now,
      );
      assert.equal(res.ok, true, JSON.stringify(res));
    };

    // The two séances that must be listed (the second one has a question).
    const near = await eventAt(3, { title: "Listed near" });
    const far = await eventAt(5, { title: "Listed far" });
    await db.insert(schema.question).values({
      id: nanoid(),
      professionalId: pro.proId,
      eventId: far.eventId,
      label: "Niveau ?",
      type: "text",
      required: false,
      position: 0,
    });

    // Everything below is excluded, one reason each.
    const booked = await eventAt(4, { title: "Already booked" });
    await book(customerId, booked.occ);
    const full = await eventAt(6, { title: "Full", capacity: 1 });
    const holder = await makeCustomer(db, pro);
    await giveTickets(db, pro, holder, typeId, 1);
    await book(holder, full.occ);
    await eventAt(7, { title: "Private", isPrivate: true });
    const noticed = await eventAt(3, { title: "Inside the notice" });
    await db.update(schema.event).set({ minNoticeMinutes: 10_080 }).where(eq(schema.event.id, noticed.eventId));
    const beyond = await eventAt(9, { title: "Beyond the horizon" });
    await db.update(schema.event).set({ bookingHorizonDays: 1 }).where(eq(schema.event.id, beyond.eventId));
    const offDay = await eventAt(10, { title: "Under a time off" });
    await db.insert(schema.timeOff).values({
      id: nanoid(),
      professionalId: pro.proId,
      startAt: addMinutes(offDay.occ.startsAt, -60),
      endAt: addMinutes(offDay.occ.endsAt, 60),
    });
    // A free-mode event takes no ticket, even when a link exists.
    const freeMode = await makeEvent(
      db,
      pro,
      { title: "Free mode", bookingMode: "free", rule: { startDate: dayIn(pro, 11, now) } },
      now,
    );
    await rowLink(db, pro, freeMode.eventId, typeId);
    await eventAt(12, { title: "No linked type", ticketTypeIds: [] });
    // A cancelled séance (o.status <> 'scheduled') and a séance of an archived event (e.archived_at set) are not listed (G3b).
    const cancelledSeance = await eventAt(13, { title: "Cancelled séance" });
    await db
      .update(schema.occurrence)
      .set({ status: "cancelled", cancelledAt: now })
      .where(eq(schema.occurrence.id, cancelledSeance.occ.id));
    const archivedEvent = await eventAt(14, { title: "Archived event" });
    await db.update(schema.event).set({ archivedAt: now }).where(eq(schema.event.id, archivedEvent.eventId));

    const list = await spendableSeances(db, pro.proId, customerId, now);
    assert.deepEqual(
      list.map((s) => s.occurrenceId),
      [near.occ.id, far.occ.id],
      "only the two open séances, soonest first",
    );
    const o1 = await getOccurrence(db, near.occ.id);
    assert.deepEqual(list[0], {
      occurrenceId: o1.id,
      title: "Listed near",
      whenLabel: formatWhen(o1.startsAt, o1.endsAt, pro.tz),
      startsAt: o1.startsAt.toISOString(),
      ticketTypeName: "Cours collectif",
      needsAnswers: false,
    });
    assert.equal(list[1].needsAnswers, true, "an event with a question needs the answers: the espace links to its page");
  },
  { timeout: 280_000 },
);

dbTest("spendableSeances: a lapsed hold of someone else frees the seat shown, a live hold of this customer excludes the séance", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro, { name: "Cours collectif" });
  const offerId = await rowOffer(db, pro, typeId);
  const me = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId: me, ticketTypeId: typeId });
  const stranger = await rowCustomer(db, pro);

  // One seat, held by someone else whose hold ran out 5 minutes ago and was not swept yet: the seat is shown free.
  const lapsedEvent = await rowEvent(db, pro, { capacity: 1 });
  await rowLink(db, pro, lapsedEvent, typeId);
  const lapsed = await rowSeance(db, pro, lapsedEvent, { startsAt: addDaysMs(now, 3), capacity: 1, seatsTaken: 1 });
  await rowBooking(db, pro, {
    occurrenceId: lapsed,
    customerId: stranger,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId: stranger, offerId, ticketTypeId: typeId }),
    holdExpiresAt: addMinutes(now, -5),
  });

  // Seats left, but this customer already holds one of them (a live hold): never offered twice.
  const heldEvent = await rowEvent(db, pro, { capacity: 5 });
  await rowLink(db, pro, heldEvent, typeId);
  const held = await rowSeance(db, pro, heldEvent, { startsAt: addDaysMs(now, 4), capacity: 5, seatsTaken: 1 });
  await rowBooking(db, pro, {
    occurrenceId: held,
    customerId: me,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId: me, offerId, ticketTypeId: typeId }),
    holdExpiresAt: addMinutes(now, 30),
  });

  const list = await spendableSeances(db, pro.proId, me, now);
  assert.deepEqual(
    list.map((s) => s.occurrenceId),
    [lapsed],
  );
});

dbTest("spendableSeances: ticketTypeName is the type spent first, and a ticket that expires before the séance does not count", async ({ db, pro }) => {
  const now = new Date();
  const soon = await makeType(db, pro, { name: "Carnet court" });
  const later = await makeType(db, pro, { name: "Carnet long" });
  const never = await makeType(db, pro, { name: "Sans limite" });
  const tooShort = await makeType(db, pro, { name: "Expire avant la séance" });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [soon, later, never, tooShort] }, now);

  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, never, 1);
  await giveTickets(db, pro, customerId, later, 1, { expiresAt: addDaysMs(now, 30) });
  await giveTickets(db, pro, customerId, soon, 1, { expiresAt: addDaysMs(now, 10) });
  // Soonest of all, but it ends a day before the séance (3 days ahead): not eligible, so not the one spent.
  await giveTickets(db, pro, customerId, tooShort, 1, { expiresAt: addDaysMs(now, 1) });

  const [first] = await spendableSeances(db, pro.proId, customerId, now);
  assert.equal(first?.occurrenceId, occ.id);
  assert.equal(first?.ticketTypeName, "Carnet court", "consumption order: soonest expiry first, no expiry last");

  const shortOnly = await makeCustomer(db, pro);
  await giveTickets(db, pro, shortOnly, tooShort, 1, { expiresAt: addDaysMs(now, 1) });
  assert.deepEqual(await spendableSeances(db, pro.proId, shortOnly, now), [], "a ticket that is not valid at the séance opens nothing");
});

dbTest("spendableSeances: at most `limit` séances (8 by default) and none beyond SPENDABLE_DAYS, even when the pro sells that far ahead", async ({ db, pro }) => {
  const now = new Date();
  assert.equal(SPENDABLE_MAX, 8);
  assert.equal(SPENDABLE_DAYS, 60);
  await db.update(schema.professional).set({ bookingHorizonDays: 365 }).where(eq(schema.professional.id, pro.proId));
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);

  // A daily series of 10 séances from day 3, one séance 10 days inside the window, one 10 days beyond it.
  await makeEvent(
    db,
    pro,
    {
      ticketTypeIds: [typeId],
      rule: { startDate: dayIn(pro, 3, now), freq: "daily", interval: 1, endMode: "count", occurrenceCount: 10 },
    },
    now,
  );
  const inside = await makeEvent(
    db,
    pro,
    { title: "Inside", ticketTypeIds: [typeId], rule: { startDate: dayIn(pro, SPENDABLE_DAYS - 10, now) } },
    now,
  );
  const beyond = await makeEvent(
    db,
    pro,
    { title: "Beyond", ticketTypeIds: [typeId], rule: { startDate: dayIn(pro, SPENDABLE_DAYS + 10, now) } },
    now,
  );

  const all = await spendableSeances(db, pro.proId, customerId, now, 50);
  assert.equal(all.length, 11, "10 of the series and the one inside the window");
  assert.ok(all.some((s) => s.occurrenceId === inside.occurrences[0].id));
  assert.ok(!all.some((s) => s.occurrenceId === beyond.occurrences[0].id), "bookable online, but beyond the 60 days of the espace");

  const byDefault = await spendableSeances(db, pro.proId, customerId, now);
  assert.equal(byDefault.length, SPENDABLE_MAX);
  assert.deepEqual(
    byDefault.map((s) => s.occurrenceId),
    all.slice(0, SPENDABLE_MAX).map((s) => s.occurrenceId),
  );
  assert.equal((await spendableSeances(db, pro.proId, customerId, now, 2)).length, 2);
  assert.equal((await spendableSeances(db, pro.proId, customerId, now, 0)).length, 1, "a limit below 1 reads as 1");
});

dbTest("spendableSeances: another pro's customer, tickets and séances never mix with this pro's", async ({ db, pro }) => {
  const now = new Date();
  const mine = await eligibleFor(db, pro, now);
  const other = await createTestPro(db);
  try {
    const theirs = await eligibleFor(db, other, now);
    assert.deepEqual((await spendableSeances(db, pro.proId, mine.customerId, now)).map((s) => s.occurrenceId), [mine.occurrenceId]);
    assert.deepEqual((await spendableSeances(db, other.proId, theirs.customerId, now)).map((s) => s.occurrenceId), [theirs.occurrenceId]);
    assert.deepEqual(await spendableSeances(db, pro.proId, theirs.customerId, now), [], "their customer at my pro");
    assert.deepEqual(await spendableSeances(db, other.proId, mine.customerId, now), [], "my customer at their pro");
    assert.deepEqual(await spendableSeances(db, pro.proId, "unknown-customer", now), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("spendableSeances: each séance is named after the ticket its own accepted types would spend, whatever the other séances accept", async ({ db, pro }) => {
  const now = new Date();
  const customerId = await rowCustomer(db, pro, { name: "Beatriz" });
  const typeX = await rowType(db, pro, { name: "Carte X" });
  const typeY = await rowType(db, pro, { name: "Carte Y" });
  await rowTicket(db, pro, { customerId, ticketTypeId: typeX, expiresAt: addDaysMs(now, 20) });
  await rowTicket(db, pro, { customerId, ticketTypeId: typeY });
  /** A séance `days` ahead of a new event that accepts `typeIds`. */
  const seanceOf = async (days: number, typeIds: string[]) => {
    const eventId = await rowEvent(db, pro);
    for (const typeId of typeIds) await rowLink(db, pro, eventId, typeId);
    return rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, days) });
  };
  // Séances that accept different types: the link set of one séance never decides another's (the read once named a
  // séance after the link set of the first séance it scanned: Postgres 17 kept a hashed form of the link EXISTS from
  // one séance to the next in the join filter, so a ticket that fits only the second séance was dropped).
  const onlyX = await seanceOf(3, [typeX]);
  const onlyY = await seanceOf(4, [typeY]);
  const both = await seanceOf(5, [typeX, typeY]);

  assert.deepEqual(
    (await spendableSeances(db, pro.proId, customerId, now)).map((s) => [s.occurrenceId, s.ticketTypeName]),
    [
      [onlyX, "Carte X"],
      [onlyY, "Carte Y"],
      [both, "Carte X"],
    ],
    "the X ticket expires first, so a séance that takes both is named after X",
  );
});

dbTest("spendableSeances: a séance or a ticket of this pro that points at another pro's event or type is never listed nor named (ID-1)", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const handBuilt: { links: [string, string][]; tickets: string[]; occurrences: string[] } = { links: [], tickets: [], occurrences: [] };
  /** A link of this pro that may cross (its event or its type of the other pro), deleted with the hand-built rows. */
  const crossedLink = async (eventId: string, ticketTypeId: string) => {
    await rowLink(db, pro, eventId, ticketTypeId);
    handBuilt.links.push([eventId, ticketTypeId]);
  };
  try {
    const mine = await rowCustomer(db, pro, { name: "Beatriz" });
    const myType = await rowType(db, pro, { name: "Carte maison" });
    await rowTicket(db, pro, { customerId: mine, ticketTypeId: myType });
    const theirType = await rowType(db, other, { name: "Carte de l'autre pro" });
    const theirEvent = await rowEvent(db, other);
    await db.update(schema.event).set({ title: "Capoeira roda" }).where(eq(schema.event.id, theirEvent));

    // Rows that crossed two pros, built by hand on purpose (every domain foreign key is single-column, so only the read's
    // own professional filters keep them out).
    // 1. A séance of MINE that carries the other pro's event, which accepts my type: my ticket fits it, the event does not.
    handBuilt.occurrences.push(await rowSeance(db, pro, theirEvent, { startsAt: addDaysMs(now, 3) }));
    await crossedLink(theirEvent, myType);
    // 2. A ticket of MINE, held by my customer, of the other pro's type (expiring soonest: the order would spend it first),
    //    on my event that accepts that type only: no ticket of mine fits it.
    handBuilt.tickets.push(
      await rowTicket(db, pro, { customerId: mine, ticketTypeId: theirType, expiresAt: addDaysMs(now, 20), movements: false }),
    );
    const onlyTheirs = await rowEvent(db, pro);
    await rowSeance(db, pro, onlyTheirs, { startsAt: addDaysMs(now, 4) });
    await crossedLink(onlyTheirs, theirType);
    // 3. My event that accepts both types: listed (my own ticket fits), and named after my type, the crossed one skipped.
    const both = await rowEvent(db, pro);
    await db.update(schema.event).set({ title: "Altinha débutants" }).where(eq(schema.event.id, both));
    const listed = await rowSeance(db, pro, both, { startsAt: addDaysMs(now, 5) });
    await rowLink(db, pro, both, myType);
    await crossedLink(both, theirType);

    const seances = await spendableSeances(db, pro.proId, mine, now);
    assert.deepEqual(
      seances.map((s) => [s.occurrenceId, s.title, s.ticketTypeName]),
      [[listed, "Altinha débutants", "Carte maison"]],
    );
    const json = JSON.stringify(seances);
    for (const theirs of ["Capoeira roda", "Carte de l'autre pro"]) {
      assert.equal(json.includes(theirs), false, `${theirs} does not reach my client's list`);
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const [eventId, ticketTypeId] of handBuilt.links) {
      await db
        .delete(schema.eventTicketType)
        .where(and(eq(schema.eventTicketType.eventId, eventId), eq(schema.eventTicketType.ticketTypeId, ticketTypeId)));
    }
    for (const id of handBuilt.tickets) await db.delete(schema.ticket).where(eq(schema.ticket.id, id));
    for (const id of handBuilt.occurrences) await db.delete(schema.occurrence).where(eq(schema.occurrence.id, id));
    await deleteTestUser(db, other.userId);
  }
});
