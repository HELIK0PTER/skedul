import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { activeBookingOf, attachCheckoutSession, startBuyAndBook, type BuyAndBookInput } from "@/lib/booking/claims";
import { bookingAnswer, question, ticketPurchase, timeOff } from "@/lib/db/schema";
import type { OfferInput } from "@/lib/tickets";
import { addMinutes, dbTest, type DbHarness } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";

const codeOf = (r: { ok: true } | { ok: false; code: string }): string => (r.ok ? "ok" : r.code);

/** A tickets-mode séance in 3 days at 10:00 (Paris), one linked type, one offer, one customer. */
async function setup(
  h: DbHarness,
  over: { capacity?: number; isPrivate?: boolean; offer?: Partial<OfferInput> } = {},
) {
  const typeId = await makeType(h.db, h.pro);
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 4, priceCents: 8500, ...over.offer });
  const { eventId, occurrences } = await makeEvent(h.db, h.pro, {
    ticketTypeIds: [typeId],
    capacity: over.capacity ?? 12,
    isPrivate: over.isPrivate ?? false,
  });
  const customerId = await makeCustomer(h.db, h.pro);
  return { typeId, offerId, eventId, occ: occurrences[0], customerId };
}

function buyInput(h: DbHarness, s: Awaited<ReturnType<typeof setup>>, over: Partial<BuyAndBookInput> = {}): BuyAndBookInput {
  return {
    professionalId: h.pro.proId,
    occurrenceId: s.occ.id,
    customerId: s.customerId,
    seenStartsAt: s.occ.startsAt,
    offerId: s.offerId,
    ...over,
  };
}

dbTest("E1 holds a seat, snapshots the offer and stores the answers", async (h) => {
  const s = await setup(h);
  await h.db.insert(question).values({
    professionalId: h.pro.proId,
    eventId: s.eventId,
    label: "Votre niveau ?",
    type: "text",
    required: true,
    position: 0,
  });
  const [q] = await h.db.select().from(question).where(eq(question.eventId, s.eventId));
  const now = new Date();

  const res = await startBuyAndBook(
    h.db,
    buyInput(h, s, { answers: [{ questionId: q.id, value: "  Débutant " }], customerNotes: " Première fois " }),
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.amountCents, 8500);
  assert.equal(res.quantity, 4);
  assert.equal(res.currency, "eur");
  assert.equal(res.label, "Carnet de 4");
  assert.equal(res.checkoutExpiresAt.getTime(), addMinutes(now, 31).getTime());

  const b = await getBooking(h.db, res.bookingId);
  assert.equal(b.status, "pending");
  assert.equal(b.coverage, "ticket");
  assert.equal(b.createdBy, "client");
  assert.equal(b.purchaseId, res.purchaseId);
  assert.equal(b.customerNotes, "Première fois");
  assert.equal(b.holdExpiresAt?.getTime(), addMinutes(now, 45).getTime());
  assert.equal(b.createdAt.getTime(), now.getTime());

  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, res.purchaseId));
  assert.equal(p.status, "pending");
  assert.equal(p.offerId, s.offerId);
  assert.equal(p.ticketTypeId, s.typeId);
  assert.equal(p.customerId, s.customerId);
  assert.equal(p.label, "Carnet de 4");
  assert.equal(p.amountCents, 8500);
  assert.equal(p.quantity, 4);
  assert.equal(p.checkoutExpiresAt.getTime(), addMinutes(now, 31).getTime());

  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);

  const answers = await h.db.select().from(bookingAnswer).where(eq(bookingAnswer.bookingId, res.bookingId));
  assert.equal(answers.length, 1);
  assert.equal(answers[0].value, "Débutant");
  assert.equal(answers[0].questionLabel, "Votre niveau ?");
});

dbTest("E1 refuses a missing required answer (invalid, no seat taken)", async (h) => {
  const s = await setup(h);
  await h.db.insert(question).values({
    professionalId: h.pro.proId,
    eventId: s.eventId,
    label: "Votre niveau ?",
    type: "text",
    required: true,
    position: 0,
  });
  const res = await startBuyAndBook(h.db, buyInput(h, s));
  assert.equal(codeOf(res), "invalid");
  assert.ok(!res.ok && /Votre niveau/.test(res.message ?? ""), JSON.stringify(res));
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("E1 refuses a private event and an archived type (unavailable)", async (h) => {
  const hidden = await setup(h, { isPrivate: true });
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, hidden))), "unavailable");

  const s = await setup(h);
  const archived = await setTicketTypeArchived(h.db, {
    professionalId: h.pro.proId,
    ticketTypeId: s.typeId,
    archived: true,
  });
  assert.ok(archived.ok);
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s))), "unavailable");
});

dbTest("E1 respects notice and horizon, in the plan and under the lock", async (h) => {
  const s = await setup(h);
  const start = s.occ.startsAt;
  // Plan: inside the 60 min notice, then 70 days ahead with a 60-day horizon.
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s), addMinutes(start, -30))), "unavailable");
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s), addMinutes(start, -70 * 1440))), "unavailable");

  // Batch: the pro raises the notice to 7 days after the plan read.
  const notice = await startBuyAndBook(h.db, buyInput(h, s), new Date(), {
    afterPlan: async () => {
      await h.db.execute(sql`update professional set min_notice_minutes = 10080 where id = ${h.pro.proId}`);
    },
  });
  assert.equal(codeOf(notice), "unavailable");
  await h.db.execute(sql`update professional set min_notice_minutes = 60 where id = ${h.pro.proId}`);

  // Batch: the event's own horizon drops to 1 day after the plan read.
  const horizon = await startBuyAndBook(h.db, buyInput(h, s), new Date(), {
    afterPlan: async () => {
      await h.db.execute(sql`update event set booking_horizon_days = 1 where id = ${s.eventId}`);
    },
  });
  assert.equal(codeOf(horizon), "unavailable");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("E1 refuses a séance under a time off (batch guard)", async (h) => {
  const s = await setup(h);
  await h.db.insert(timeOff).values({
    professionalId: h.pro.proId,
    startAt: addMinutes(s.occ.startsAt, -60),
    endAt: addMinutes(s.occ.startsAt, 30),
    allDay: false,
  });
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s))), "unavailable");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);
});

dbTest("E1 maps a moved séance to changed and an edited offer to stale", async (h) => {
  const s = await setup(h);
  // Plan: the client saw another start.
  const seen = await startBuyAndBook(h.db, buyInput(h, s, { seenStartsAt: addMinutes(s.occ.startsAt, 1) }));
  assert.equal(codeOf(seen), "changed");

  // Batch: the pro moves the séance between the read and the batch.
  const moved = await startBuyAndBook(h.db, buyInput(h, s), new Date(), {
    afterPlan: async () => {
      await h.db.execute(sql`
        update occurrence set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour',
          block_start = block_start + interval '1 hour', block_end = block_end + interval '1 hour'
        where id = ${s.occ.id}`);
    },
  });
  assert.equal(codeOf(moved), "changed");

  // Batch: the pro edits the offer's price between the read and the batch.
  const s2 = await setup(h);
  const edited = await startBuyAndBook(h.db, buyInput(h, s2), new Date(), {
    afterPlan: async () => {
      await h.db.execute(sql`update ticket_offer set price_cents = 9000 where id = ${s2.offerId}`);
    },
  });
  assert.equal(codeOf(edited), "stale");
  assert.equal((await getOccurrence(h.db, s2.occ.id)).seatsTaken, 0);
});

dbTest("E1 refuses an offer whose validity ends before the séance", async (h) => {
  const s = await setup(h, { offer: { validityCount: 1, validityUnit: "day" } });
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s))), "offer_too_short");
});

dbTest("E1 double submit, hold quota and last seat", async (h) => {
  const now = new Date();
  const s = await setup(h, { capacity: 3 });
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s), now)), "ok");
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s), now)), "already_booked");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);

  // A second séance: 2 live holds; a third one is refused.
  const { occurrences: [second] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [s.typeId] });
  const { occurrences: [third] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [s.typeId] });
  const on = (o: typeof second) => buyInput(h, s, { occurrenceId: o.id, seenStartsAt: o.startsAt });
  assert.equal(codeOf(await startBuyAndBook(h.db, on(second), now)), "ok");
  assert.equal(codeOf(await startBuyAndBook(h.db, on(third), now)), "too_many_holds");
  // 46 minutes later both holds have elapsed: they no longer count.
  assert.equal(codeOf(await startBuyAndBook(h.db, on(third), addMinutes(now, 46))), "ok");

  // Last seat: the CHECK raises full.
  const one = await setup(h, { capacity: 1 });
  const other = await makeCustomer(h.db, h.pro);
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, one), now)), "ok");
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, one, { customerId: other }), now)), "full");
});

dbTest("E1 releases an elapsed hold on the same séance before taking the seat (R)", async (h) => {
  const now = new Date();
  const s = await setup(h, { capacity: 1 });
  const first = await startBuyAndBook(h.db, buyInput(h, s), now);
  assert.ok(first.ok, JSON.stringify(first));
  const other = await makeCustomer(h.db, h.pro);
  const second = await startBuyAndBook(h.db, buyInput(h, s, { customerId: other }), addMinutes(now, 46));
  assert.ok(second.ok, JSON.stringify(second));

  const expired = await getBooking(h.db, first.bookingId);
  assert.equal(expired.status, "expired");
  assert.equal(expired.endedBy, "system");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
});

dbTest("attachCheckoutSession and activeBookingOf", async (h) => {
  const now = new Date();
  const s = await setup(h);
  const res = await startBuyAndBook(h.db, buyInput(h, s), now);
  assert.ok(res.ok, JSON.stringify(res));

  const before = await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: s.customerId }, now);
  assert.deepEqual(before, { bookingId: res.bookingId, status: "pending", purchaseId: res.purchaseId, checkoutUrl: null });

  const url = "https://checkout.stripe.com/c/pay/cs_test_1";
  const attached = await attachCheckoutSession(h.db, {
    purchaseId: res.purchaseId,
    checkoutSessionId: `cs_test_${res.purchaseId}`,
    checkoutUrl: url,
  });
  assert.ok(attached.ok);
  const after = await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: s.customerId }, now);
  assert.equal(after?.checkoutUrl, url);

  // Checkout expired (31 min) but the hold is still live (45 min): no dead URL, the purchase stays releasable.
  const lapsed = await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: s.customerId }, addMinutes(now, 40));
  assert.deepEqual(lapsed, { bookingId: res.bookingId, status: "pending", purchaseId: res.purchaseId, checkoutUrl: null });

  // An elapsed hold is not « active » any more.
  assert.equal(await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: s.customerId }, addMinutes(now, 46)), null);

  // A purchase that is no longer pending cannot take a session.
  await h.db.execute(sql`update ticket_purchase set status = 'expired' where id = ${res.purchaseId}`);
  const late = await attachCheckoutSession(h.db, {
    purchaseId: res.purchaseId,
    checkoutSessionId: `cs_test_late_${res.purchaseId}`,
    checkoutUrl: url,
  });
  assert.equal(codeOf(late), "stale");
});
