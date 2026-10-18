import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";

import { ticketMovement, ticketPurchase } from "@/lib/db/schema";

import { dbTest, type DbHarness } from "../../test/db";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
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
