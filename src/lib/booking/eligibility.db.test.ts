import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { SEAT, atomic, lockRows, releaseEndedSeats, tryAtomic, type BatchCtx, type Db } from "@/lib/db/atomic";
import { booking, bookingAnswer, occurrence, question, ticket, ticketMovement } from "@/lib/db/schema";

import { addMinutes, dbTest, type TestPro } from "../../test/db";
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
} from "../../test/rows";
import { insertAnswers, loadQuestions } from "./answers";
import { assertSpent, spendTicket, usableTickets } from "./eligibility";
import { assertHoldQuota, expireElapsedHolds } from "./holds";

const DAY = 86_400_000;

/** The batch of a client ticket claim on an event séance (E2 shape). */
function claimBatch(c: BatchCtx, pro: TestPro, args: { occurrenceId: string; customerId: string; bookingId: string; ticketId?: string }) {
  return [
    lockRows(c.db, "occurrence", [args.occurrenceId]),
    SEAT(c, args.occurrenceId, 1),
    c.db.insert(booking).values({
      id: args.bookingId,
      professionalId: pro.proId,
      occurrenceId: args.occurrenceId,
      customerId: args.customerId,
      status: "confirmed",
      coverage: "ticket",
      createdBy: "client",
      confirmedAt: c.now,
      createdAt: c.now,
      updatedAt: c.now,
    }),
    spendTicket(c, {
      bookingId: args.bookingId,
      customerId: args.customerId,
      occurrenceId: args.occurrenceId,
      ticketId: args.ticketId,
      by: { actor: "client", userId: null },
    }),
    assertSpent(c, args.bookingId),
  ];
}

async function seatsOf(db: Db, id: string): Promise<number> {
  const [row] = await db.select({ n: occurrence.seatsTaken }).from(occurrence).where(eq(occurrence.id, id));
  return row.n;
}

dbTest("ELIGIBLE: mode, live link, archived type, expiry at the séance, RDV paid vs free, status", async ({ db, pro }) => {
  const now = new Date();
  const linked = await rowType(db, pro);
  const unlinked = await rowType(db, pro);
  const archived = await rowType(db, pro, { archivedAt: now });
  const rdvPaid = await rowRdvType(db, pro);
  const rdvFree = await rowRdvType(db, pro, { rdvFree: true, rdvDurationMin: 15 });

  const ticketsEvent = await rowEvent(db, pro, { bookingMode: "tickets" });
  await rowLink(db, pro, ticketsEvent, linked);
  await rowLink(db, pro, ticketsEvent, archived);
  const freeEvent = await rowEvent(db, pro, { bookingMode: "free" });
  await rowLink(db, pro, freeEvent, linked);
  const seance = await rowSeance(db, pro, ticketsEvent, { startsAt: new Date(now.getTime() + 2 * DAY) });
  const freeSeance = await rowSeance(db, pro, freeEvent, { startsAt: new Date(now.getTime() + 2 * DAY) });
  const holder = await rowCustomer(db, pro);
  const paidRdv = await rowRdv(db, pro, rdvPaid, { startsAt: new Date(now.getTime() + 3 * DAY) });
  await rowBooking(db, pro, { occurrenceId: paidRdv, customerId: holder });
  const freeRdv = await rowRdv(db, pro, rdvFree, { startsAt: new Date(now.getTime() + 4 * DAY), durationMin: 15 });
  await rowBooking(db, pro, { occurrenceId: freeRdv, customerId: holder });
  const [{ startsAt }] = await db.select({ startsAt: occurrence.startsAt }).from(occurrence).where(eq(occurrence.id, seance));

  const customerId = await rowCustomer(db, pro);
  const good = await rowTicket(db, pro, { customerId, ticketTypeId: linked, expiresAt: addMinutes(startsAt, 1) });
  await rowTicket(db, pro, { customerId, ticketTypeId: linked, expiresAt: startsAt }); // expires at the start: not valid
  await rowTicket(db, pro, { customerId, ticketTypeId: linked, status: "used" });
  await rowTicket(db, pro, { customerId, ticketTypeId: unlinked });
  await rowTicket(db, pro, { customerId, ticketTypeId: archived });
  const rdvTicket = await rowTicket(db, pro, { customerId, ticketTypeId: rdvPaid });
  await rowTicket(db, pro, { customerId, ticketTypeId: rdvFree });

  const ids = async (occurrenceId: string) => (await usableTickets(db, { customerId, occurrenceId })).map((t) => t.id);
  assert.deepEqual(await ids(seance), [good]);
  assert.deepEqual(await ids(freeSeance), [], "a free-mode event accepts no ticket, even linked");
  assert.deepEqual(await ids(paidRdv), [rdvTicket]);
  assert.deepEqual(await ids(freeRdv), [], "a free RDV never consumes a ticket");

  const [usable] = await usableTickets(db, { customerId, occurrenceId: seance });
  assert.equal(usable.expiresAt?.getTime(), addMinutes(startsAt, 1).getTime());
  assert.equal(usable.ticketTypeId, linked);
  assert.equal(usable.purchaseId, null);

  // links are read live: unlinking makes the ticket unusable at once
  await db.execute(sql`delete from event_ticket_type where event_id = ${ticketsEvent} and ticket_type_id = ${linked}`);
  assert.deepEqual(await ids(seance), []);
});

dbTest("consumption order: soonest expiry first, no expiry last, then oldest, then id", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const eventId = await rowEvent(db, pro);
  await rowLink(db, pro, eventId, typeId);
  const seance = await rowSeance(db, pro, eventId);
  const customerId = await rowCustomer(db, pro);
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const never = await rowTicket(db, pro, { customerId, ticketTypeId: typeId }, at(-40));
  const later = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, expiresAt: new Date(now.getTime() + 30 * DAY) }, at(-30));
  const soonOld = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, expiresAt: new Date(now.getTime() + 10 * DAY) }, at(-20));
  const soonNew = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, expiresAt: new Date(now.getTime() + 10 * DAY) }, at(-10));

  const order = (await usableTickets(db, { customerId, occurrenceId: seance })).map((t) => t.id);
  assert.deepEqual(order, [soonOld, soonNew, later, never]);

  const bookingId = nanoid();
  const done = await atomic(db, async () => (aid) => claimBatch({ db, aid, now }, pro, { occurrenceId: seance, customerId, bookingId }));
  const [spent] = await db.select().from(ticket).where(eq(ticket.bookingId, bookingId));
  assert.equal(spent.id, soonOld, "the spend takes the first ticket of the consumption order");
  assert.equal(spent.status, "booked");
  const moves = await db.select().from(ticketMovement).where(eq(ticketMovement.actionId, done.aid));
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, "spend");
  assert.equal(moves[0].fromStatus, "available");
  assert.equal(moves[0].toStatus, "booked");
  assert.equal(moves[0].bookingId, bookingId);
  assert.equal(moves[0].actor, "client");
  assert.equal(await seatsOf(db, seance), 1);
});

dbTest("a forced ticket is spent only if eligible; no eligible ticket raises no_ticket", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const otherType = await rowType(db, pro);
  const eventId = await rowEvent(db, pro);
  await rowLink(db, pro, eventId, typeId);
  const seance = await rowSeance(db, pro, eventId);
  const customerId = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId, ticketTypeId: typeId, expiresAt: new Date(now.getTime() + 10 * DAY) });
  const chosen = await rowTicket(db, pro, { customerId, ticketTypeId: typeId });
  const foreign = await rowTicket(db, pro, { customerId, ticketTypeId: otherType });

  const refused = await tryAtomic(db, async () => (aid) =>
    claimBatch({ db, aid, now }, pro, { occurrenceId: seance, customerId, bookingId: nanoid(), ticketId: foreign }),
  );
  assert.deepEqual(refused, { ok: false, code: "no_ticket" });
  assert.equal(await seatsOf(db, seance), 0, "the whole batch was rolled back");

  const bookingId = nanoid();
  const forced = await tryAtomic(db, async () => (aid) =>
    claimBatch({ db, aid, now }, pro, { occurrenceId: seance, customerId, bookingId, ticketId: chosen }),
  );
  assert.equal(forced.ok, true);
  const [spent] = await db.select({ id: ticket.id }).from(ticket).where(eq(ticket.bookingId, bookingId));
  assert.equal(spent.id, chosen, "the forced ticket wins over the consumption order");

  const nobody = await rowCustomer(db, pro);
  const none = await tryAtomic(db, async () => (aid) =>
    claimBatch({ db, aid, now }, pro, { occurrenceId: seance, customerId: nobody, bookingId: nanoid() }),
  );
  assert.deepEqual(none, { ok: false, code: "no_ticket" });
});

dbTest("assertHoldQuota counts live holds only; expireElapsedHolds marks them with the action id", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro);
  const customerId = await rowCustomer(db, pro);
  const seances: string[] = [];
  const holds: string[] = [];
  for (const [i, minutes] of [30, 20, -5].entries()) {
    const o = await rowSeance(db, pro, eventId, { seatsTaken: 1, startsAt: new Date(now.getTime() + (2 + i) * DAY) });
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
    seances.push(o);
    holds.push(
      await rowBooking(db, pro, {
        occurrenceId: o,
        customerId,
        status: "pending",
        coverage: "ticket",
        purchaseId,
        holdExpiresAt: addMinutes(now, minutes),
      }),
    );
  }

  const quota = await tryAtomic(db, async () => (aid) => [assertHoldQuota({ db, aid, now }, customerId)]);
  assert.deepEqual(quota, { ok: false, code: "too_many_holds" }, "two live holds: a third is refused");
  const later = addMinutes(now, 25); // the 20-minute hold has elapsed too
  const fine = await tryAtomic(db, async () => (aid) => [assertHoldQuota({ db, aid, now: later }, customerId)]);
  assert.equal(fine.ok, true, "elapsed holds do not count, swept or not");

  const done = await atomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    const ids = sql`select id from occurrence where event_id = ${eventId}`;
    return [
      db.execute(sql`select id from occurrence where event_id = ${eventId} order by id for no key update`),
      expireElapsedHolds(c, ids),
      releaseEndedSeats(c),
    ];
  });
  const rows = await db.select().from(booking).where(eq(booking.endedActionId, done.aid));
  assert.deepEqual(
    rows.map((r) => r.id),
    [holds[2]],
  );
  assert.equal(rows[0].status, "expired");
  assert.equal(await seatsOf(db, seances[2]), 0);
  assert.equal(await seatsOf(db, seances[0]), 1);
});

dbTest("loadQuestions orders by position; insertAnswers writes one row per answer", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  const second = nanoid();
  const first = nanoid();
  await db.insert(question).values([
    { id: second, professionalId: pro.proId, ticketTypeId: typeId, label: "Deuxième", type: "text", position: 1, createdAt: now, updatedAt: now },
    { id: first, professionalId: pro.proId, ticketTypeId: typeId, label: "Première", type: "choice", options: ["A", "B"], required: true, position: 0, createdAt: now, updatedAt: now },
  ]);
  const questions = await loadQuestions(db, { ticketTypeId: typeId });
  assert.deepEqual(
    questions.map((q) => [q.id, q.label, q.type, q.options, q.required, q.position]),
    [
      [first, "Première", "choice", ["A", "B"], true, 0],
      [second, "Deuxième", "text", null, false, 1],
    ],
  );
  assert.deepEqual(await loadQuestions(db, { eventId: "none" }), []);

  const rdv = await rowRdv(db, pro, typeId);
  const bookingId = await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) });
  const c: BatchCtx = { db, aid: nanoid(), now };
  assert.deepEqual(insertAnswers(c, { professionalId: pro.proId, bookingId, rows: [] }), []);
  await atomic(db, async () => (aid) =>
    insertAnswers({ db, aid, now }, {
      professionalId: pro.proId,
      bookingId,
      rows: [
        { questionId: first, questionLabel: "Première", value: "B" },
        { questionId: second, questionLabel: "Deuxième", value: "Libre" },
      ],
    }),
  );
  const saved = await db.select().from(bookingAnswer).where(eq(bookingAnswer.bookingId, bookingId));
  assert.equal(saved.length, 2);
  assert.ok(saved.every((a) => a.professionalId === pro.proId && a.createdAt.getTime() === now.getTime()));
});
