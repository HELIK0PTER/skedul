import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, markProcessing, startPurchase, type PaymentFacts } from "@/lib/booking/fulfillment";
import { throttle, ticketMovement, ticketPurchase } from "@/lib/db/schema";
import { HEALTH_KEYS, readHealth } from "@/lib/throttle";
import { ticketExpiry } from "@/lib/ticket-expiry";
import { addMinutes, createTestPro, dbTest, deleteTestUser, inParallel, type DbHarness } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType, ticketsOf } from "@/test/fixtures";

const codeOf = (r: { ok: true } | { ok: false; code: string }): string => (r.ok ? "ok" : r.code);

/** Unique Stripe ids: checkout_session_id is UNIQUE across the whole test branch. */
function payment(livemode = false): PaymentFacts {
  return { sessionId: `cs_test_${nanoid()}`, paymentIntentId: `pi_test_${nanoid()}`, livemode };
}

async function shop(h: DbHarness, quantity: number) {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, {
    quantity,
    priceCents: 19000,
    validityCount: 6,
    validityUnit: "month",
  });
  const customerId = await makeCustomer(h.db, h.pro);
  return { typeId, offerId, customerId };
}

async function purchaseMovements(h: DbHarness, purchaseId: string) {
  return h.db
    .select({ kind: ticketMovement.kind, ticketId: ticketMovement.ticketId, toStatus: ticketMovement.toStatus })
    .from(ticketMovement)
    .where(eq(ticketMovement.purchaseId, purchaseId));
}

dbTest("E9 startPurchase creates a pending shop purchase from the offer snapshot", async (h) => {
  const s = await shop(h, 10);
  const now = new Date();
  const res = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId }, now);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.quantity, 10);
  assert.equal(res.amountCents, 19000);
  assert.equal(res.label, "Carnet de 10");
  assert.equal(res.checkoutExpiresAt.getTime(), addMinutes(now, 24 * 60).getTime());

  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, res.purchaseId));
  assert.equal(p.status, "pending");
  assert.equal(p.validityCount, 6);
  assert.equal(p.validityUnit, "month");
  assert.equal(p.currency, "eur");

  // An offer taken off sale is not found.
  await h.db.execute(sql`update ticket_offer set is_active = false where id = ${s.offerId}`);
  const off = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId });
  assert.equal(codeOf(off), "not_found");
});

dbTest("E9 startPurchase never crosses tenants: another pro's offer or customer is not_found", async (h) => {
  const s = await shop(h, 3);
  const other = await createTestPro(h.db);
  try {
    const otherOffer = await makeOffer(h.db, other, await makeType(h.db, other), { quantity: 5, priceCents: 12000 });
    const otherCustomer = await makeCustomer(h.db, other);

    const foreignOffer = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: otherOffer, customerId: s.customerId });
    assert.equal(codeOf(foreignOffer), "not_found");
    const foreignCustomer = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: otherCustomer });
    assert.equal(codeOf(foreignCustomer), "not_found");
    // The same ids, seen from the other pro's side.
    const reversed = await startPurchase(h.db, { professionalId: other.proId, offerId: s.offerId, customerId: otherCustomer });
    assert.equal(codeOf(reversed), "not_found");

    const created = await h.db
      .select({ id: ticketPurchase.id })
      .from(ticketPurchase)
      .where(inArray(ticketPurchase.professionalId, [h.pro.proId, other.proId]));
    assert.equal(created.length, 0);
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("E9 startPurchase refuses an offer whose ticket type is archived, and sells it again once unarchived", async (h) => {
  const s = await shop(h, 2);
  const input = { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId };
  const archive = (archived: boolean) =>
    setTicketTypeArchived(h.db, { professionalId: h.pro.proId, ticketTypeId: s.typeId, archived });

  assert.ok((await archive(true)).ok);
  assert.equal(codeOf(await startPurchase(h.db, input)), "not_found");
  const none = await h.db.select({ id: ticketPurchase.id }).from(ticketPurchase).where(eq(ticketPurchase.professionalId, h.pro.proId));
  assert.equal(none.length, 0);

  assert.ok((await archive(false)).ok);
  const again = await startPurchase(h.db, input);
  assert.ok(again.ok, JSON.stringify(again));
});

dbTest("T4: two concurrent deliveries give the tickets once", async (h) => {
  const s = await shop(h, 3);
  const started = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const facts = payment();
  const now = new Date();

  const settled = await inParallel([
    () => fulfillPurchase(h.db, started.purchaseId, facts, now),
    () => fulfillPurchase(h.db, started.purchaseId, facts, now),
  ]);
  const outcomes = settled.map((r) => (r.status === "fulfilled" ? r.value.outcome : `threw: ${String(r.reason)}`)).sort();
  assert.deepEqual(outcomes, ["duplicate", "fulfilled"]);
  const winner = settled.find((r) => r.status === "fulfilled" && r.value.outcome === "fulfilled");
  assert.ok(winner && winner.status === "fulfilled");
  assert.deepEqual(winner.value.effects, [{ type: "email.purchase_receipt", purchaseId: started.purchaseId }]);
  assert.equal(winner.value.bookingConfirmed, false);
  assert.equal(winner.value.ticketIds.length, 3);
  const loser = settled.find((r) => r.status === "fulfilled" && r.value.outcome === "duplicate");
  assert.ok(loser && loser.status === "fulfilled");
  assert.deepEqual(loser.value.effects, []);

  const tickets = await ticketsOf(h.db, s.customerId);
  assert.equal(tickets.length, 3);
  assert.ok(tickets.every((t) => t.status === "available" && t.purchaseId === started.purchaseId));
  const expected = ticketExpiry(now, { count: 6, unit: "month" }, h.pro.tz);
  assert.ok(tickets.every((t) => t.expiresAt?.getTime() === expected?.getTime()));
  const moves = await purchaseMovements(h, started.purchaseId);
  assert.equal(moves.length, 3);
  assert.ok(moves.every((m) => m.kind === "purchase" && m.toStatus === "available"));

  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, started.purchaseId));
  assert.equal(p.status, "paid");
  assert.equal(p.paidAt?.getTime(), now.getTime());
  assert.equal(p.checkoutSessionId, facts.sessionId);
  assert.equal(p.paymentIntentId, facts.paymentIntentId);
  assert.ok(p.fulfilledActionId);

  // A third, late delivery is a no-op too.
  const again = await fulfillPurchase(h.db, started.purchaseId, facts);
  assert.equal(again.outcome, "duplicate");
  assert.equal((await ticketsOf(h.db, s.customerId)).length, 3);
});

dbTest("T14: a paid buy + book confirms the booking and books ticket no 1", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, {
    quantity: 4,
    priceCents: 8500,
    validityCount: 3,
    validityUnit: "month",
  });
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(h.db, h.pro);
  const started = await startBuyAndBook(h.db, {
    professionalId: h.pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    offerId,
  });
  assert.ok(started.ok, JSON.stringify(started));

  const done = await fulfillPurchase(h.db, started.purchaseId, payment());
  assert.equal(done.outcome, "fulfilled");
  assert.equal(done.bookingConfirmed, true);
  assert.equal(done.ticketIds.length, 4);
  assert.deepEqual(done.effects, [
    { type: "email.purchase_receipt", purchaseId: started.purchaseId },
    { type: "email.booking_confirmed", bookingId: started.bookingId },
    { type: "email.pro_new_booking", bookingId: started.bookingId },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);

  const b = await getBooking(h.db, started.bookingId);
  assert.equal(b.status, "confirmed");
  assert.ok(b.confirmedAt);
  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 1);

  const tickets = await ticketsOf(h.db, customerId);
  assert.equal(tickets.length, 4);
  const booked = tickets.filter((t) => t.status === "booked");
  assert.equal(booked.length, 1);
  assert.equal(booked[0].id, done.ticketIds[0]);
  assert.equal(booked[0].bookingId, started.bookingId);
  assert.equal(tickets.filter((t) => t.status === "available").length, 3);

  const moves = await purchaseMovements(h, started.purchaseId);
  assert.equal(moves.length, 4);
  assert.ok(moves.every((m) => m.kind === "purchase"));
  assert.equal(new Set(moves.map((m) => m.ticketId)).size, 4);
  const spends = await h.db
    .select({ id: ticketMovement.id })
    .from(ticketMovement)
    .where(and(eq(ticketMovement.customerId, customerId), eq(ticketMovement.kind, "spend")));
  assert.equal(spends.length, 0);
});

dbTest("E10 pays a purchase that already expired: the tickets go to the wallet", async (h) => {
  const s = await shop(h, 2);
  const started = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId });
  assert.ok(started.ok, JSON.stringify(started));
  await h.db.execute(sql`update ticket_purchase set status = 'expired' where id = ${started.purchaseId}`);

  const done = await fulfillPurchase(h.db, started.purchaseId, payment(true));
  assert.equal(done.outcome, "fulfilled");
  assert.equal(done.bookingConfirmed, false);
  assert.deepEqual(done.effects, [{ type: "email.purchase_receipt", purchaseId: started.purchaseId }]);
  const tickets = await ticketsOf(h.db, s.customerId);
  assert.equal(tickets.length, 2);
  assert.ok(tickets.every((t) => t.status === "available"));
  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, started.purchaseId));
  assert.equal(p.status, "paid");
  assert.equal(p.livemode, true);
});

dbTest("E10 orphan payment: no purchase, counted for the admin health card", async (h) => {
  const before = (await readHealth(h.db))[HEALTH_KEYS.orphanPayments]?.value ?? 0;
  const done = await fulfillPurchase(h.db, `missing_${nanoid()}`, payment());
  assert.equal(done.outcome, "orphan");
  assert.deepEqual(done.ticketIds, []);
  assert.deepEqual(done.effects, []);
  const after = (await readHealth(h.db))[HEALTH_KEYS.orphanPayments]?.value ?? 0;
  assert.equal(after, before + 1);
});

dbTest("markProcessing keeps the first instant and refuses a paid purchase", async (h) => {
  const s = await shop(h, 1);
  const started = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const t0 = new Date();
  assert.ok((await markProcessing(h.db, started.purchaseId, t0)).ok);
  assert.ok((await markProcessing(h.db, started.purchaseId, addMinutes(t0, 5))).ok);
  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, started.purchaseId));
  assert.equal(p.processingAt?.getTime(), t0.getTime());

  const done = await fulfillPurchase(h.db, started.purchaseId, payment());
  assert.equal(done.outcome, "fulfilled");
  assert.equal(codeOf(await markProcessing(h.db, started.purchaseId)), "stale");
});

dbTest("E10 a purchase that vanishes between the read and the batch is an orphan, not a duplicate", async (h) => {
  const s = await shop(h, 2);
  const started = await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId });
  assert.ok(started.ok, JSON.stringify(started));
  const key = HEALTH_KEYS.orphanPayments;
  const [saved] = await h.db.select().from(throttle).where(eq(throttle.key, key));
  try {
    const done = await fulfillPurchase(h.db, started.purchaseId, payment(true), new Date(), {
      // Stands in for the pro being deleted after the purchase was read and before the batch runs (the purchase goes with them).
      afterPlan: async () => {
        await h.db.execute(sql`delete from ticket_purchase where id = ${started.purchaseId}`);
      },
    });
    assert.equal(done.outcome, "orphan");
    assert.equal(done.bookingConfirmed, false);
    assert.deepEqual(done.ticketIds, []);
    assert.deepEqual(done.effects, []);
    const after = (await readHealth(h.db))[key]?.value ?? 0;
    assert.equal(after, (saved?.hits ?? 0) + 1);
    assert.equal((await ticketsOf(h.db, s.customerId)).length, 0);
  } finally {
    if (saved) {
      await h.db.update(throttle).set({ hits: saved.hits, windowStart: saved.windowStart }).where(eq(throttle.key, key));
    } else {
      await h.db.delete(throttle).where(eq(throttle.key, key));
    }
  }
});

/** A 4-ticket offer linked to a fresh event: the séance, the offer and two customers (the buyer and a rival). */
async function buyAndBookSetup(h: DbHarness) {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, {
    quantity: 4,
    priceCents: 8500,
    validityCount: 3,
    validityUnit: "month",
  });
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  const buyer = await makeCustomer(h.db, h.pro);
  const rival = await makeCustomer(h.db, h.pro);
  const claim = (customerId: string, now: Date) =>
    startBuyAndBook(
      h.db,
      { professionalId: h.pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, offerId },
      now,
    );
  return { occ, buyer, rival, claim };
}

dbTest("E10 late payment after the buy + book booking ended: the tickets go to the wallet, the booking stays expired", async (h) => {
  const s = await buyAndBookSetup(h);
  const t0 = new Date();
  const started = await s.claim(s.buyer, t0);
  assert.ok(started.ok, JSON.stringify(started));
  const hold = (await getBooking(h.db, started.bookingId)).holdExpiresAt;
  assert.ok(hold);

  // The hold elapses and another client claims the séance: R(o) of that claim expires the buyer's booking and
  // releases its seat (the rival's pending booking takes it), while the buyer's purchase is still pending.
  const late = addMinutes(hold, 1);
  const rivalClaim = await s.claim(s.rival, late);
  assert.ok(rivalClaim.ok, JSON.stringify(rivalClaim));
  assert.equal((await getBooking(h.db, started.bookingId)).status, "expired");
  const seatsBefore = (await getOccurrence(h.db, s.occ.id)).seatsTaken;
  assert.equal(seatsBefore, 1);

  const done = await fulfillPurchase(h.db, started.purchaseId, payment(), late);
  assert.equal(done.outcome, "fulfilled");
  assert.equal(done.bookingConfirmed, false);
  assert.equal(done.ticketIds.length, 4);
  assert.deepEqual(done.effects, [
    { type: "email.purchase_receipt", purchaseId: started.purchaseId },
    { type: "email.late_payment", purchaseId: started.purchaseId },
  ]);

  // Never resurrected: still expired, no seat taken back, no confirmation.
  const b = await getBooking(h.db, started.bookingId);
  assert.equal(b.status, "expired");
  assert.equal(b.confirmedAt, null);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, seatsBefore);

  const tickets = await ticketsOf(h.db, s.buyer);
  assert.equal(tickets.length, 4);
  assert.ok(tickets.every((t) => t.status === "available" && t.bookingId === null));
  const moves = await purchaseMovements(h, started.purchaseId);
  assert.equal(moves.length, 4);
  assert.ok(moves.every((m) => m.kind === "purchase" && m.toStatus === "available"));
  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, started.purchaseId));
  assert.equal(p.status, "paid");
});

dbTest("E10 payment after the hold elapsed but before any sweep still confirms the booking (step 4)", async (h) => {
  const s = await buyAndBookSetup(h);
  const started = await s.claim(s.buyer, new Date());
  assert.ok(started.ok, JSON.stringify(started));
  const hold = (await getBooking(h.db, started.bookingId)).holdExpiresAt;
  assert.ok(hold);

  // Nothing has released the hold (no other claim, no sweep): the booking is still `pending` and keeps its seat.
  const late = addMinutes(hold, 5);
  const done = await fulfillPurchase(h.db, started.purchaseId, payment(), late);
  assert.equal(done.outcome, "fulfilled");
  assert.equal(done.bookingConfirmed, true);
  assert.deepEqual(done.effects, [
    { type: "email.purchase_receipt", purchaseId: started.purchaseId },
    { type: "email.booking_confirmed", bookingId: started.bookingId },
    { type: "email.pro_new_booking", bookingId: started.bookingId },
    { type: "google.sync_occurrence", occurrenceId: s.occ.id },
  ]);

  const b = await getBooking(h.db, started.bookingId);
  assert.equal(b.status, "confirmed");
  assert.equal(b.confirmedAt?.getTime(), late.getTime());
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
  const tickets = await ticketsOf(h.db, s.buyer);
  assert.equal(tickets.length, 4);
  const booked = tickets.filter((t) => t.status === "booked");
  assert.equal(booked.length, 1);
  assert.equal(booked[0].id, done.ticketIds[0]);
  assert.equal(booked[0].bookingId, started.bookingId);
});
