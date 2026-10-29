import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";

import { ticketMovement, ticketPurchase } from "@/lib/db/schema";

import { createTestPro, dbTest, deleteTestUser, type DbHarness } from "../../test/db";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowLink,
  rowMovement,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "../../test/rows";
import { checkInvariants, type InvariantId } from "./invariants";
import { paidPurchaseOf, revenueByCurrency } from "./revenue";

const BAD = { invariants: false };

async function expectViolation(h: DbHarness, invariant: InvariantId, rowId: string): Promise<void> {
  const found = await checkInvariants(h.db, { proId: h.pro.proId });
  assert.ok(
    found.some((v) => v.invariant === invariant && v.rowId === rowId),
    `expected ${invariant} on ${rowId}, got ${JSON.stringify(found)}`,
  );
}

dbTest("a consistent pro has no violation", async ({ db, pro }) => {
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId, { quantity: 2 });
  const eventId = await rowEvent(db, pro);
  const seance = await rowSeance(db, pro, eventId, { seatsTaken: 2 });
  const alice = await rowCustomer(db, pro);
  const bob = await rowCustomer(db, pro);
  const paid = await rowPurchase(db, pro, { customerId: alice, offerId, ticketTypeId: typeId, status: "paid", quantity: 2 });
  const aliceBooking = await rowBooking(db, pro, { occurrenceId: seance, customerId: alice, coverage: "ticket" });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: typeId, purchaseId: paid, status: "booked", bookingId: aliceBooking });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: typeId, purchaseId: paid });
  const pending = await rowPurchase(db, pro, { customerId: bob, offerId, ticketTypeId: typeId });
  await rowBooking(db, pro, { occurrenceId: seance, customerId: bob, status: "pending", coverage: "ticket", purchaseId: pending });
  await rowTicket(db, pro, { customerId: bob, ticketTypeId: typeId, status: "used" });
  const rdvType = await rowRdvType(db, pro);
  const rdv = await rowRdv(db, pro, rdvType);
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: bob, coverage: "guest" });
  await rowRdv(db, pro, rdvType, {
    startsAt: new Date(Date.now() + 5 * 86_400_000),
    seatsTaken: 0,
    status: "cancelled",
  });

  assert.deepEqual(await checkInvariants(db, { proId: pro.proId }), []);
});

dbTest(
  "I1: seats_taken differs from the active bookings",
  async (h) => {
    const eventId = await rowEvent(h.db, h.pro);
    const seance = await rowSeance(h.db, h.pro, eventId, { seatsTaken: 1 });
    await expectViolation(h, "I1", seance);
  },
  BAD,
);

dbTest(
  "I2: a booked ticket on a cancelled booking, and a confirmed ticket booking without ticket",
  async (h) => {
    const { db, pro } = h;
    const typeId = await rowType(db, pro);
    const eventId = await rowEvent(db, pro);
    const seance = await rowSeance(db, pro, eventId, { seatsTaken: 1 });
    const customerId = await rowCustomer(db, pro);
    const ended = await rowBooking(db, pro, { occurrenceId: seance, customerId, status: "cancelled", coverage: "ticket" });
    const stray = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "booked", bookingId: ended });
    const bare = await rowBooking(db, pro, { occurrenceId: seance, customerId, coverage: "ticket" });
    await expectViolation(h, "I2", stray);
    await expectViolation(h, "I2", bare);
  },
  BAD,
);

dbTest(
  "I3: a paid purchase missing tickets, a pending purchase with one",
  async (h) => {
    const { db, pro } = h;
    const typeId = await rowType(db, pro);
    const offerId = await rowOffer(db, pro, typeId, { quantity: 2 });
    const customerId = await rowCustomer(db, pro);
    const short = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId, status: "paid", quantity: 2 });
    await rowTicket(db, pro, { customerId, ticketTypeId: typeId, purchaseId: short });
    const early = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
    await rowTicket(db, pro, { customerId, ticketTypeId: typeId, purchaseId: early });
    await expectViolation(h, "I3", short);
    await expectViolation(h, "I3", early);
  },
  BAD,
);

dbTest(
  "I4: a ticket without movement, and one whose last movement disagrees",
  async (h) => {
    const { db, pro } = h;
    const typeId = await rowType(db, pro);
    const otherType = await rowType(db, pro);
    const customerId = await rowCustomer(db, pro);
    const silent = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, movements: false });
    const drifted = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "used" });
    // a later movement claiming a conversion that never happened
    await rowMovement(db, pro, {
      ticketId: drifted,
      customerId,
      ticketTypeId: otherType,
      kind: "convert",
      fromStatus: "available",
      toStatus: "available",
    });
    await expectViolation(h, "I4", silent);
    await expectViolation(h, "I4", drifted);
    const last = await db.select().from(ticketMovement).where(eq(ticketMovement.ticketId, drifted));
    assert.equal(last.length, 3);
  },
  BAD,
);

dbTest(
  "I5: an active booking on a cancelled séance, and a scheduled RDV without its seat",
  async (h) => {
    const { db, pro } = h;
    const eventId = await rowEvent(db, pro);
    const cancelled = await rowSeance(db, pro, eventId, { status: "cancelled" });
    const active = await rowBooking(db, pro, { occurrenceId: cancelled, customerId: await rowCustomer(db, pro) });
    const rdv = await rowRdv(db, pro, await rowRdvType(db, pro), { seatsTaken: 0 });
    await expectViolation(h, "I5", active);
    await expectViolation(h, "I5", rdv);
  },
  BAD,
);

dbTest(
  "I6: paid without fulfilled_action_id, livemode without payment_intent_id",
  async (h) => {
    const { db, pro } = h;
    const typeId = await rowType(db, pro);
    const offerId = await rowOffer(db, pro, typeId);
    const customerId = await rowCustomer(db, pro);
    const unmarked = await rowPurchase(db, pro, {
      customerId,
      offerId,
      ticketTypeId: typeId,
      status: "paid",
      fulfilledActionId: null,
    });
    await rowTicket(db, pro, { customerId, ticketTypeId: typeId, purchaseId: unmarked });
    const live = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId, livemode: true });
    await expectViolation(h, "I6", unmarked);
    await expectViolation(h, "I6", live);
  },
  BAD,
);

dbTest(
  "without proId the check covers every pro",
  async (h) => {
    const eventId = await rowEvent(h.db, h.pro);
    const seance = await rowSeance(h.db, h.pro, eventId, { seatsTaken: 2 });
    const all = await checkInvariants(h.db);
    assert.ok(all.some((v) => v.invariant === "I1" && v.rowId === seance));
  },
  BAD,
);

dbTest(
  "I7 (nightly, unscoped only): a row of one pro pointing at a row of another pro (P6 A1)",
  async (h) => {
    const { db, pro } = h;
    const other = await createTestPro(db);
    try {
      const theirType = await rowRdvType(db, other);
      const theirOffer = await rowOffer(db, other, theirType);
      const theirCustomer = await rowCustomer(db, other);
      const theirEvent = await rowEvent(db, other);
      const theirSeance = await rowSeance(db, other, theirEvent, { seatsTaken: 1 });

      // Rows of MINE built by hand on purpose (every domain foreign key is single-column): each points at THEIR row.
      const crossedSeance = await rowSeance(db, pro, theirEvent, { startsAt: new Date(Date.now() + 3 * 86_400_000) });
      const crossedPurchase = await rowPurchase(db, pro, { customerId: theirCustomer, offerId: theirOffer, ticketTypeId: theirType });
      const crossedBooking = await rowBooking(db, pro, { occurrenceId: theirSeance, customerId: theirCustomer });
      const crossedTicket = await rowTicket(db, pro, { customerId: theirCustomer, ticketTypeId: theirType, movements: false });
      await rowLink(db, pro, theirEvent, theirType);
      // The control: a consistent chain of mine is never reported.
      const myType = await rowType(db, pro);
      const myOffer = await rowOffer(db, pro, myType);
      const myCustomer = await rowCustomer(db, pro);
      const myPurchase = await rowPurchase(db, pro, { customerId: myCustomer, offerId: myOffer, ticketTypeId: myType });

      const all = (await checkInvariants(db)).filter((v) => v.invariant === "I7");
      const on = (rowId: string, link: string) => all.some((v) => v.rowId === rowId && v.detail.startsWith(link));
      assert.ok(on(crossedSeance, "occurrence.event_id"), JSON.stringify(all));
      assert.ok(on(crossedPurchase, "ticket_purchase.customer_id"), JSON.stringify(all));
      assert.ok(on(crossedPurchase, "ticket_purchase.offer_id"), JSON.stringify(all));
      assert.ok(on(crossedPurchase, "ticket_purchase.ticket_type_id"), JSON.stringify(all));
      assert.ok(on(crossedBooking, "booking.occurrence_id"), JSON.stringify(all));
      assert.ok(on(crossedBooking, "booking.customer_id"), JSON.stringify(all));
      assert.ok(on(crossedTicket, "ticket.customer_id"), JSON.stringify(all));
      assert.ok(on(crossedTicket, "ticket.ticket_type_id"), JSON.stringify(all));
      assert.ok(on(`${theirEvent}/${theirType}`, "event_ticket_type.event_id"), JSON.stringify(all));
      assert.ok(on(`${theirEvent}/${theirType}`, "event_ticket_type.ticket_type_id"), JSON.stringify(all));
      for (const id of [myType, myOffer, myCustomer, myPurchase]) assert.ok(!all.some((v) => v.rowId === id), id);

      // Scoped (after every DB test) it stays silent: many tests build such rows on purpose to prove a guard.
      assert.ok(!(await checkInvariants(db, { proId: pro.proId })).some((v) => v.invariant === "I7"));
    } finally {
      // Mine first (my rows are the ones that point across), then theirs: no NO ACTION link is left to block it.
      await deleteTestUser(db, pro.userId);
      await deleteTestUser(db, other.userId);
    }
  },
  BAD,
);

dbTest("paidPurchaseOf / revenueByCurrency: paid only, livemode = live, per pro and since", async ({ db, pro }) => {
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const customerId = await rowCustomer(db, pro);
  const old = new Date(Date.now() - 40 * 86_400_000);
  const paid = async (args: { amountCents: number; livemode?: boolean; currency?: string; paidAt?: Date }) => {
    const purchaseId = await rowPurchase(db, pro, {
      customerId,
      offerId,
      ticketTypeId: typeId,
      status: "paid",
      amountCents: args.amountCents,
      currency: args.currency,
      livemode: args.livemode,
      paymentIntentId: args.livemode ? "pi_live_test" : null,
      paidAt: args.paidAt,
    });
    await rowTicket(db, pro, { customerId, ticketTypeId: typeId, purchaseId });
  };
  await paid({ amountCents: 2500 });
  await paid({ amountCents: 1000, paidAt: old });
  await paid({ amountCents: 4000, livemode: true });
  await paid({ amountCents: 700, currency: "chf" });
  await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId, amountCents: 99_999 });

  assert.deepEqual(await revenueByCurrency(db, { live: false, professionalId: pro.proId }), [
    { currency: "chf", cents: 700 },
    { currency: "eur", cents: 3500 },
  ]);
  assert.deepEqual(await revenueByCurrency(db, { live: true, professionalId: pro.proId }), [
    { currency: "eur", cents: 4000 },
  ]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  assert.deepEqual(await revenueByCurrency(db, { live: false, professionalId: pro.proId, since }), [
    { currency: "chf", cents: 700 },
    { currency: "eur", cents: 2500 },
  ]);
  const [{ n }] = await db
    .select({ n: count() })
    .from(ticketPurchase)
    .where(paidPurchaseOf({ live: false, professionalId: pro.proId }));
  assert.equal(n, 3);
});
