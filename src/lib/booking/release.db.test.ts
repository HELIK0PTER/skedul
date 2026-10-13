import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, markProcessing, startPurchase } from "@/lib/booking/fulfillment";
import { expireStalePurchases, releasePurchase, sweepHolds } from "@/lib/booking/release";
import { instantAt } from "@/lib/civil-date";
import { booking, occurrence, ticketPurchase } from "@/lib/db/schema";
import { addMinutes, dbTest, type DbHarness } from "@/test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  makeCustomer,
  makeEvent,
  makeOffer,
  makeType,
  ticketsOf,
} from "@/test/fixtures";

const codeOf = (r: { ok: true } | { ok: false; code: string }): string => (r.ok ? "ok" : r.code);

async function purchaseStatus(h: DbHarness, purchaseId: string): Promise<string> {
  const [p] = await h.db.select({ status: ticketPurchase.status }).from(ticketPurchase).where(eq(ticketPurchase.id, purchaseId));
  return p.status;
}

/** A buy + book hold on a tickets-mode séance (capacity 1 by default). */
async function hold(h: DbHarness, now: Date, opts: { capacity?: number; quantity?: number } = {}) {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: opts.quantity ?? 1 });
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId], capacity: opts.capacity ?? 1 });
  const customerId = await makeCustomer(h.db, h.pro);
  const res = await startBuyAndBook(
    h.db,
    { professionalId: h.pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, offerId },
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  return { typeId, offerId, occ, customerId, purchaseId: res.purchaseId, bookingId: res.bookingId };
}

dbTest("T5: sweep, then a late payment: booking expired, N tickets available", async (h) => {
  const now = new Date();
  const s = await hold(h, now, { quantity: 4 });

  const swept = await sweepHolds(h.db, addMinutes(now, 46));
  assert.ok(swept.expiredBookings >= 1);
  const ended = await getBooking(h.db, s.bookingId);
  assert.equal(ended.status, "expired");
  assert.equal(ended.endedBy, "system");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  const paid = await fulfillPurchase(
    h.db,
    s.purchaseId,
    { sessionId: `cs_test_${nanoid()}`, paymentIntentId: `pi_test_${nanoid()}`, livemode: false },
    addMinutes(now, 50),
  );
  assert.equal(paid.outcome, "fulfilled");
  assert.equal(paid.bookingConfirmed, false);
  assert.deepEqual(paid.effects, [
    { type: "email.purchase_receipt", purchaseId: s.purchaseId },
    { type: "email.late_payment", purchaseId: s.purchaseId },
  ]);
  assert.equal((await getBooking(h.db, s.bookingId)).status, "expired");
  const tickets = await ticketsOf(h.db, s.customerId);
  assert.equal(tickets.length, 4);
  assert.ok(tickets.every((t) => t.status === "available" && t.bookingId === null));
  assert.equal(await purchaseStatus(h, s.purchaseId), "paid");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("releasePurchase frees the seat once (idempotent)", async (h) => {
  const now = new Date();
  const s = await hold(h, now);

  const first = await releasePurchase(h.db, s.purchaseId, addMinutes(now, 5));
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.released, true);
  assert.deepEqual(first.effects, [{ type: "google.sync_occurrence", occurrenceId: s.occ.id }]);
  const b = await getBooking(h.db, s.bookingId);
  assert.equal(b.status, "expired");
  assert.equal(b.endedBy, "system");
  assert.equal(await purchaseStatus(h, s.purchaseId), "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  const second = await releasePurchase(h.db, s.purchaseId, addMinutes(now, 6));
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(second.released, false);
  assert.deepEqual(second.effects, []);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  // The freed seat can be taken again.
  const other = await makeCustomer(h.db, h.pro);
  const again = await startBuyAndBook(
    h.db,
    { professionalId: h.pro.proId, occurrenceId: s.occ.id, customerId: other, seenStartsAt: s.occ.startsAt, offerId: s.offerId },
    addMinutes(now, 7),
  );
  assert.ok(again.ok, JSON.stringify(again));
});

dbTest("releasePurchase: shop purchase, paid purchase, unknown purchase", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 2 });
  const customerId = await makeCustomer(h.db, h.pro);

  const shop = await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId });
  assert.ok(shop.ok, JSON.stringify(shop));
  const released = await releasePurchase(h.db, shop.purchaseId);
  assert.ok(released.ok && released.released === false, JSON.stringify(released));
  assert.equal(await purchaseStatus(h, shop.purchaseId), "expired");

  const bought = await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId });
  assert.ok(bought.ok, JSON.stringify(bought));
  await fulfillPurchase(h.db, bought.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false });
  const untouched = await releasePurchase(h.db, bought.purchaseId);
  assert.ok(untouched.ok && untouched.released === false, JSON.stringify(untouched));
  assert.equal(await purchaseStatus(h, bought.purchaseId), "paid");
  assert.equal((await ticketsOf(h.db, customerId)).length, 2);

  assert.equal(codeOf(await releasePurchase(h.db, `missing_${nanoid()}`)), "not_found");
});

dbTest("sweepHolds cancels an RDV whose hold elapsed and leaves live holds alone", async (h) => {
  const now = new Date();
  // A live event hold (10 minutes old at sweep time) must survive.
  const live = await hold(h, now, { capacity: 3 });

  // A buy + book RDV hold, written by hand (bookRdv arrives in Task 24).
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const offerId = await makeOffer(h.db, h.pro, typeId);
  const customerId = await makeCustomer(h.db, h.pro);
  const startsAt = instantAt(dayIn(h.pro, 4), 600, h.pro.tz);
  const endsAt = addMinutes(startsAt, 60);
  const ids = { occurrence: nanoid(), purchase: nanoid(), booking: nanoid() };
  const early = addMinutes(now, -50);
  await h.db.batch([
    h.db.insert(occurrence).values({
      id: ids.occurrence,
      professionalId: h.pro.proId,
      ticketTypeId: typeId,
      startsAt,
      endsAt,
      blockStart: startsAt,
      blockEnd: endsAt,
      capacity: 1,
      seatsTaken: 1,
    }),
    h.db.insert(ticketPurchase).values({
      id: ids.purchase,
      professionalId: h.pro.proId,
      customerId,
      offerId,
      ticketTypeId: typeId,
      label: "À l'unité",
      quantity: 1,
      amountCents: 2500,
      currency: "eur",
      checkoutExpiresAt: addMinutes(early, 31),
    }),
    h.db.insert(booking).values({
      id: ids.booking,
      professionalId: h.pro.proId,
      occurrenceId: ids.occurrence,
      customerId,
      status: "pending",
      coverage: "ticket",
      purchaseId: ids.purchase,
      createdBy: "client",
      holdExpiresAt: addMinutes(early, 45),
    }),
  ]);

  const swept = await sweepHolds(h.db, addMinutes(now, 10));
  assert.ok(swept.expiredBookings >= 1);
  const rdv = await getOccurrence(h.db, ids.occurrence);
  assert.equal(rdv.status, "cancelled");
  assert.equal(rdv.seatsTaken, 0);
  assert.ok(rdv.cancelledAt);
  assert.equal((await getBooking(h.db, ids.booking)).status, "expired");

  assert.equal((await getBooking(h.db, live.bookingId)).status, "pending");
  assert.equal((await getOccurrence(h.db, live.occ.id)).seatsTaken, 1);
});

dbTest("expireStalePurchases: grace period, processing purchases kept", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId);
  const customerId = await makeCustomer(h.db, h.pro);
  const now = new Date();
  const plain = await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId }, now);
  const slow = await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId }, now);
  assert.ok(plain.ok && slow.ok);
  assert.ok((await markProcessing(h.db, slow.purchaseId, addMinutes(now, 1))).ok);

  // 24 h checkout + 59 min: still inside the 60 min grace.
  await expireStalePurchases(h.db, addMinutes(now, 24 * 60 + 59));
  assert.equal(await purchaseStatus(h, plain.purchaseId), "pending");

  const done = await expireStalePurchases(h.db, addMinutes(now, 24 * 60 + 61));
  assert.ok(done.expired >= 1);
  assert.equal(await purchaseStatus(h, plain.purchaseId), "expired");
  assert.equal(await purchaseStatus(h, slow.purchaseId), "pending");
});
