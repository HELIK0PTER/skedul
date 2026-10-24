import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { activeBookingOf, attachCheckoutSession, startBuyAndBook, type BuyAndBookInput } from "@/lib/booking/claims";
import { startPurchase } from "@/lib/booking/fulfillment";
import { booking, bookingAnswer, question, ticketPurchase, timeOff } from "@/lib/db/schema";
import type { OfferInput } from "@/lib/tickets";
import { addMinutes, createTestPro, dbTest, deleteTestUser, inParallel, type DbHarness } from "@/test/db";
import { getBooking, getOccurrence, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { rowBooking, rowPurchase } from "@/test/rows";

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

dbTest("E1 and E9 refuse an offer whose type became « Gratuit » after its creation: stale, no purchase, no seat (LED:139)", async (h) => {
  const s = await setup(h);
  // The pro switches the type to « Gratuit » (rdv_free): done by SQL here, as the pro half of FR:F9 is not guarded in P4.
  // The offer is still active and linked, so only the sale's own batch guard can refuse it.
  await h.db.execute(
    sql`update ticket_type set rdv_enabled = true, rdv_duration_min = 60, rdv_free = true where id = ${s.typeId}`,
  );
  assert.deepEqual(await startBuyAndBook(h.db, buyInput(h, s)), { ok: false, code: "stale" });
  assert.deepEqual(
    await startPurchase(h.db, { professionalId: h.pro.proId, offerId: s.offerId, customerId: s.customerId }),
    { ok: false, code: "stale" },
  );
  const purchases = await h.db.select({ id: ticketPurchase.id }).from(ticketPurchase).where(eq(ticketPurchase.professionalId, h.pro.proId));
  assert.deepEqual(purchases, []);
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 0);

  // another type of the same pro is not affected
  const control = await setup(h);
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, control))), "ok");
});

dbTest("E1 and E9 refuse a type switched to « Gratuit » between the plan and the batch: stale, no purchase, no seat (LED:139 race)", async (h) => {
  const switchToFree = (typeId: string) => async () => {
    await h.db.execute(
      sql`update ticket_type set rdv_enabled = true, rdv_duration_min = 60, rdv_free = true where id = ${typeId}`,
    );
  };

  // Control: the plan reads a type that is not free, so the plan alone accepts it (an idle hook changes nothing).
  const control = await setup(h);
  let idleHookRuns = 0;
  const idle = async () => {
    idleHookRuns += 1;
  };
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, control), new Date(), { afterPlan: idle })), "ok");
  assert.equal(
    codeOf(await startPurchase(h.db, { professionalId: h.pro.proId, offerId: control.offerId, customerId: control.customerId }, new Date(), { afterPlan: idle })),
    "ok",
  );
  assert.equal(idleHookRuns, 2, "the hook runs once between each plan and its batch");

  // Buy + book: the switch lands after the plan, so only the batch guard (offerUnchanged) can refuse.
  const buy = await setup(h);
  assert.deepEqual(await startBuyAndBook(h.db, buyInput(h, buy), new Date(), { afterPlan: switchToFree(buy.typeId) }), {
    ok: false,
    code: "stale",
  });
  assert.equal((await getOccurrence(h.db, buy.occ.id)).seatsTaken, 0);

  // Shop: same race, same guard.
  const shop = await setup(h);
  assert.deepEqual(
    await startPurchase(h.db, { professionalId: h.pro.proId, offerId: shop.offerId, customerId: shop.customerId }, new Date(), {
      afterPlan: switchToFree(shop.typeId),
    }),
    { ok: false, code: "stale" },
  );

  // Nothing was written by the two refused batches: only the control's two purchases exist.
  const purchases = await h.db
    .select({ id: ticketPurchase.id, customerId: ticketPurchase.customerId })
    .from(ticketPurchase)
    .where(eq(ticketPurchase.professionalId, h.pro.proId));
  assert.deepEqual(
    purchases.map((p) => p.customerId),
    [control.customerId, control.customerId],
  );
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

dbTest("activeBookingOf: a purchase written under another pro's id never surfaces, nor its Checkout URL (S6, G4a)", async (h) => {
  const now = new Date();
  const s = await setup(h);
  const other = await createTestPro(h.db);
  const bookings: string[] = [];
  const purchases: string[] = [];
  try {
    const withUrl = async (purchaseId: string): Promise<void> => {
      await h.db
        .update(ticketPurchase)
        .set({ checkoutSessionId: `cs_test_${purchaseId}`, checkoutUrl: `https://checkout.test/${purchaseId}` })
        .where(eq(ticketPurchase.id, purchaseId));
    };
    const crossedCustomer = s.customerId;
    const genuineCustomer = await makeCustomer(h.db, h.pro);

    // A pending booking of MY customer on MY séance that holds a purchase written under THEIR id, built by hand on purpose
    // (every domain foreign key is single-column, so only the join's own professional filter keeps it out): the purchase
    // is pending and its Checkout session is open, so before the filter its id and its URL would both come back.
    const crossed = await rowPurchase(h.db, other, { customerId: crossedCustomer, offerId: s.offerId, ticketTypeId: s.typeId }, now);
    purchases.push(crossed);
    await withUrl(crossed);
    bookings.push(
      await rowBooking(h.db, h.pro, { occurrenceId: s.occ.id, customerId: crossedCustomer, status: "pending", coverage: "ticket", purchaseId: crossed }, now),
    );
    // The same state with the purchase under MY id, for another customer: the control that the answer below is not blanket.
    const genuine = await rowPurchase(h.db, h.pro, { customerId: genuineCustomer, offerId: s.offerId, ticketTypeId: s.typeId }, now);
    purchases.push(genuine);
    await withUrl(genuine);
    bookings.push(
      await rowBooking(h.db, h.pro, { occurrenceId: s.occ.id, customerId: genuineCustomer, status: "pending", coverage: "ticket", purchaseId: genuine }, now),
    );

    const mine = await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: genuineCustomer }, now);
    assert.deepEqual(mine, { bookingId: bookings[1], status: "pending", purchaseId: genuine, checkoutUrl: `https://checkout.test/${genuine}` });
    const got = await activeBookingOf(h.db, { occurrenceId: s.occ.id, customerId: crossedCustomer }, now);
    assert.deepEqual(got, { bookingId: bookings[0], status: "pending", purchaseId: null, checkoutUrl: null });
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of bookings) await h.db.delete(booking).where(eq(booking.id, id));
    for (const id of purchases) await h.db.delete(ticketPurchase).where(eq(ticketPurchase.id, id));
    await deleteTestUser(h.db, other.userId);
  }
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

dbTest("attachCheckoutSession never replaces a different attached session", async (h) => {
  const s = await setup(h);
  const res = await startBuyAndBook(h.db, buyInput(h, s));
  assert.ok(res.ok, JSON.stringify(res));
  const sessionA = `cs_test_a_${res.purchaseId}`;
  const sessionB = `cs_test_b_${res.purchaseId}`;
  const urlA = "https://checkout.stripe.com/c/pay/cs_test_a";
  const urlB = "https://checkout.stripe.com/c/pay/cs_test_b";

  assert.ok((await attachCheckoutSession(h.db, { purchaseId: res.purchaseId, checkoutSessionId: sessionA, checkoutUrl: urlA })).ok);

  // Another session for the same purchase is refused and A stays attached.
  const other = await attachCheckoutSession(h.db, { purchaseId: res.purchaseId, checkoutSessionId: sessionB, checkoutUrl: urlB });
  assert.equal(codeOf(other), "stale");
  const [p] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, res.purchaseId));
  assert.equal(p.checkoutSessionId, sessionA);
  assert.equal(p.checkoutUrl, urlA);

  // Re-attaching the SAME session is idempotent.
  assert.ok((await attachCheckoutSession(h.db, { purchaseId: res.purchaseId, checkoutSessionId: sessionA, checkoutUrl: urlA })).ok);
});

dbTest("E1 a double submit for the last seat is already_booked, not full", async (h) => {
  const now = new Date();
  const s = await setup(h, { capacity: 1 });
  const first = await startBuyAndBook(h.db, buyInput(h, s), now);
  assert.ok(first.ok, JSON.stringify(first));

  // The same customer again (two tabs): their own hold is what fills the séance.
  const again = await startBuyAndBook(h.db, buyInput(h, s), now);
  assert.deepEqual(again, { ok: false, code: "already_booked" });
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);

  // Once their hold has elapsed, R releases it first: the same customer can book again.
  const later = await startBuyAndBook(h.db, buyInput(h, s), addMinutes(now, 46));
  assert.ok(later.ok, JSON.stringify(later));
  assert.equal((await getBooking(h.db, first.bookingId)).status, "expired");
  assert.equal((await getOccurrence(h.db, s.occ.id)).seatsTaken, 1);
});

dbTest("E1 parallel holds of one customer cannot all pass the quota (customer lock)", async (h) => {
  const now = new Date();
  const s = await setup(h);
  assert.equal(codeOf(await startBuyAndBook(h.db, buyInput(h, s), now)), "ok");

  // One live hold already and MAX_PENDING_HOLDS is 2: of 4 simultaneous holds, exactly one can start.
  const contenders = 4;
  const others = [];
  for (let i = 0; i < contenders; i++) {
    const { occurrences: [o] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [s.typeId] });
    others.push(o);
  }
  // Barrier between the plans and the batches: every batch is sent in the same tick, so only the
  // customer lock (the séances differ, so their occurrence locks never meet) can order them.
  let planned = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const barrier = async () => {
    if (++planned === contenders) release();
    await gate;
  };
  const results = await inParallel(
    others.map((o) => () =>
      startBuyAndBook(h.db, buyInput(h, s, { occurrenceId: o.id, seenStartsAt: o.startsAt }), now, { afterPlan: barrier }),
    ),
  );
  const codes = results.map((r) => (r.status === "fulfilled" ? codeOf(r.value) : `rejected: ${String(r.reason)}`));
  assert.deepEqual([...codes].sort(), ["ok", "too_many_holds", "too_many_holds", "too_many_holds"]);
});
