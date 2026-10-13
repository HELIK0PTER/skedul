import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, markProcessing, startPurchase, type PaymentFacts } from "@/lib/booking/fulfillment";
import { ticketMovement, ticketPurchase } from "@/lib/db/schema";
import { HEALTH_KEYS, readHealth } from "@/lib/throttle";
import { ticketExpiry } from "@/lib/ticket-expiry";
import { addMinutes, dbTest, inParallel, type DbHarness } from "@/test/db";
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
