import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { attachCheckoutSession, startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { releasePurchase } from "@/lib/booking/release";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { purchaseByReference } from "@/lib/public/purchase-reads";
import { HOLD_MINUTES } from "@/lib/tickets";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type TestPro } from "@/test/db";
import { makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { rowBooking, rowCustomer, rowOffer, rowPurchase, rowRdv, rowSeance, rowType } from "@/test/rows";

/** A 4-ticket offer linked to a fresh event: « Altinha débutants » at « Gymnase Jean Bouin », capacity 12. */
async function catalog(db: Db, pro: TestPro) {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, {
    quantity: 4,
    priceCents: 8500,
    validityCount: 3,
    validityUnit: "month",
  });
  const {
    eventId,
    occurrences: [occ],
  } = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  await db.update(schema.event).set({ location: "Gymnase Jean Bouin" }).where(eq(schema.event.id, eventId));
  return { typeId, offerId, occ };
}

type Catalog = Awaited<ReturnType<typeof catalog>>;

/** A buy + book hold the way startBuyAndBookCore leaves it: pending purchase and booking, session attached unless `attach` is false. */
async function hold(db: Db, pro: TestPro, cat: Catalog, customerId: string, now: Date, attach = true) {
  const started = await startBuyAndBook(
    db,
    {
      professionalId: pro.proId,
      occurrenceId: cat.occ.id,
      customerId,
      seenStartsAt: cat.occ.startsAt,
      offerId: cat.offerId,
    },
    now,
  );
  assert.ok(started.ok, JSON.stringify(started));
  const sessionId = `cs_test_${nanoid()}`;
  const url = `https://checkout.test/${started.purchaseId}`;
  if (attach) {
    const attached = await attachCheckoutSession(
      db,
      { purchaseId: started.purchaseId, checkoutSessionId: sessionId, checkoutUrl: url },
      now,
    );
    assert.ok(attached.ok, JSON.stringify(attached));
  }
  return { ...started, sessionId, url };
}

dbTest("purchaseByReference: a pending buy + book purchase with its own booking and the resume URL while the session is open", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const customerId = await makeCustomer(db, pro);
  const h = await hold(db, pro, cat, customerId, now);

  const ref = await purchaseByReference(db, pro.proId, h.purchaseId, now);
  assert.deepEqual(ref, {
    purchaseId: h.purchaseId,
    customerId,
    status: "pending",
    processing: false,
    livemode: false,
    label: "Carnet de 4",
    quantity: 4,
    amountCents: 8500,
    currency: "eur",
    ticketTypeName: "Cours collectif",
    offerId: cat.offerId,
    checkoutSessionId: h.sessionId,
    resumeUrl: h.url,
    booking: {
      bookingId: h.bookingId,
      occurrenceId: cat.occ.id,
      status: "pending",
      holdExpiresAt: addMinutes(now, HOLD_MINUTES),
      title: "Altinha débutants",
      startsAt: cat.occ.startsAt,
      endsAt: cat.occ.endsAt,
      location: "Gymnase Jean Bouin",
    },
    ticketCount: 0,
  });
});

dbTest("purchaseByReference: the resume URL is withheld once checkout_expires_at has passed, the hold stays", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const h = await hold(db, pro, cat, await makeCustomer(db, pro), now);

  const open = await purchaseByReference(db, pro.proId, h.purchaseId, addMinutes(h.checkoutExpiresAt, -1));
  assert.equal(open?.resumeUrl, h.url);

  // The Stripe session closes at checkout_expires_at: from that instant the URL would be dead, so it is not given.
  const atExpiry = await purchaseByReference(db, pro.proId, h.purchaseId, h.checkoutExpiresAt);
  assert.equal(atExpiry?.resumeUrl, null);
  const closed = await purchaseByReference(db, pro.proId, h.purchaseId, addMinutes(h.checkoutExpiresAt, 1));
  assert.equal(closed?.resumeUrl, null);
  assert.equal(closed?.status, "pending");
  assert.equal(closed?.booking?.status, "pending");
  assert.ok(closed?.booking?.holdExpiresAt, "the 45-minute hold outlives the 31-minute session");
});

dbTest("purchaseByReference: no session attached yet means no checkout id and no resume URL", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const h = await hold(db, pro, cat, await makeCustomer(db, pro), now, false);
  const ref = await purchaseByReference(db, pro.proId, h.purchaseId, now);
  assert.equal(ref?.checkoutSessionId, null);
  assert.equal(ref?.resumeUrl, null);
});

dbTest("purchaseByReference: processing_at shows as processing while the purchase is pending", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const h = await hold(db, pro, cat, await makeCustomer(db, pro), now);
  assert.equal((await purchaseByReference(db, pro.proId, h.purchaseId, now))?.processing, false);
  await db.execute(sql`update ticket_purchase set processing_at = ${now.toISOString()}::timestamptz where id = ${h.purchaseId}`);
  const ref = await purchaseByReference(db, pro.proId, h.purchaseId, now);
  assert.equal(ref?.processing, true);
  assert.equal(ref?.status, "pending");
});

dbTest("purchaseByReference: after payment the booking is confirmed, the tickets are counted and the URL is gone", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const h = await hold(db, pro, cat, await makeCustomer(db, pro), now);
  const done = await fulfillPurchase(
    db,
    h.purchaseId,
    { sessionId: h.sessionId, paymentIntentId: `pi_test_${nanoid()}`, livemode: false },
    now,
  );
  assert.equal(done.outcome, "fulfilled");

  const ref = await purchaseByReference(db, pro.proId, h.purchaseId, now);
  assert.equal(ref?.status, "paid");
  assert.equal(ref?.ticketCount, 4);
  assert.equal(ref?.resumeUrl, null);
  assert.equal(ref?.processing, false);
  assert.equal(ref?.booking?.status, "confirmed");
  assert.equal(ref?.booking?.holdExpiresAt, null, "a confirmed booking no longer holds a seat");
  assert.equal(ref?.booking?.bookingId, h.bookingId);
});

dbTest("purchaseByReference: a shop purchase has no booking", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 10, priceCents: 19000 });
  const customerId = await makeCustomer(db, pro);
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId }, now);
  assert.ok(started.ok, JSON.stringify(started));

  const ref = await purchaseByReference(db, pro.proId, started.purchaseId, now);
  assert.equal(ref?.booking, null);
  assert.equal(ref?.label, "Carnet de 10");
  assert.equal(ref?.amountCents, 19000);
  assert.equal(ref?.ticketCount, 0);
  assert.equal(ref?.offerId, offerId);
  assert.equal(ref?.customerId, customerId);
});

dbTest("purchaseByReference: a later booking of the same customer on the same séance is NOT the reference's booking (SEC-C1)", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const customerId = await makeCustomer(db, pro);
  const first = await hold(db, pro, cat, customerId, now);
  const released = await releasePurchase(db, first.purchaseId, now);
  assert.ok(released.ok, JSON.stringify(released));
  const second = await hold(db, pro, cat, customerId, addMinutes(now, 1));
  assert.notEqual(second.bookingId, first.bookingId);

  const ofFirst = await purchaseByReference(db, pro.proId, first.purchaseId, addMinutes(now, 1));
  assert.equal(ofFirst?.booking?.bookingId, first.bookingId);
  assert.equal(ofFirst?.booking?.status, "expired");
  assert.equal(ofFirst?.status, "expired");
  assert.equal(ofFirst?.resumeUrl, null);

  const ofSecond = await purchaseByReference(db, pro.proId, second.purchaseId, addMinutes(now, 1));
  assert.equal(ofSecond?.booking?.bookingId, second.bookingId);
  assert.equal(ofSecond?.booking?.status, "pending");
  assert.equal(ofSecond?.resumeUrl, second.url);
});

dbTest("purchaseByReference: a malformed id, an unknown id and an empty string give null", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const h = await hold(db, pro, cat, await makeCustomer(db, pro), now);
  assert.ok(await purchaseByReference(db, pro.proId, h.purchaseId, now));

  for (const bad of ["../x", "a".repeat(65), "", " ", "a b", "x/y", "%2e%2e", "p;q", "é", `${h.purchaseId}\n`, `${h.purchaseId}/`]) {
    assert.equal(await purchaseByReference(db, pro.proId, bad, now), null, JSON.stringify(bad));
  }
  assert.equal(await purchaseByReference(db, pro.proId, nanoid(), now), null);
});

dbTest("purchaseByReference: tenancy, another pro's purchase is null under this pro and the reverse (S6, S7, S26)", async ({ db, pro }) => {
  const now = new Date();
  const cat = await catalog(db, pro);
  const mine = await hold(db, pro, cat, await makeCustomer(db, pro), now);
  const other = await createTestPro(db);
  try {
    const otherCat = await catalog(db, other);
    const theirs = await hold(db, other, otherCat, await makeCustomer(db, other), now);

    assert.equal(await purchaseByReference(db, pro.proId, theirs.purchaseId, now), null, "their purchase under my page");
    assert.equal(await purchaseByReference(db, other.proId, mine.purchaseId, now), null, "my purchase under their page");
    assert.equal((await purchaseByReference(db, pro.proId, mine.purchaseId, now))?.purchaseId, mine.purchaseId);
    assert.equal((await purchaseByReference(db, other.proId, theirs.purchaseId, now))?.purchaseId, theirs.purchaseId);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("purchaseByReference: a séance row that points to another pro's event or ticket type shows none of its text (defence in depth, G2b)", async ({ db, pro }) => {
  const now = new Date();
  const mineType = await rowType(db, pro);
  const mineOffer = await rowOffer(db, pro, mineType);
  const customerId = await rowCustomer(db, pro, { email: testEmail("cross") });
  const other = await createTestPro(db);
  const handBuilt: { bookings: string[]; occurrences: string[] } = { bookings: [], occurrences: [] };
  try {
    const theirType = await makeType(db, other, { name: "Type de l'autre pro" });
    const { eventId: theirEvent } = await makeEvent(db, other, { title: "Séance de l'autre pro", ticketTypeIds: [theirType] });
    await db.update(schema.event).set({ location: "Gymnase de l'autre pro" }).where(eq(schema.event.id, theirEvent));

    // Built by hand on purpose: occurrence.event_id and occurrence.ticket_type_id are single-column foreign keys, so
    // nothing but the read's own joins keeps another pro's event or ticket type out of the reference.
    const viaEvent = await rowSeance(db, pro, theirEvent, { seatsTaken: 1 }, now);
    const viaType = await rowRdv(db, pro, theirType, { seatsTaken: 1 }, now);
    handBuilt.occurrences.push(viaEvent, viaType);
    for (const occurrenceId of [viaEvent, viaType]) {
      const purchaseId = await rowPurchase(db, pro, { customerId, offerId: mineOffer, ticketTypeId: mineType, status: "pending" }, now);
      handBuilt.bookings.push(
        await rowBooking(db, pro, { occurrenceId, customerId, status: "confirmed", coverage: "guest", purchaseId }, now),
      );

      const ref = await purchaseByReference(db, pro.proId, purchaseId, now);
      assert.ok(ref?.booking, "the booking is the pro's own and is still described");
      assert.equal(ref.booking.occurrenceId, occurrenceId);
      assert.equal(ref.booking.title, "", "no title of another pro");
      assert.equal(ref.booking.location, null, "no location of another pro");
      assert.equal(JSON.stringify(ref).includes("l'autre pro"), false, "nothing of the other pro's event or type anywhere in the reference");
    }
  } finally {
    // The hand-built rows go first: the foreign keys inside the domain are NO ACTION and they point at the other pro's rows.
    for (const id of handBuilt.bookings) await db.delete(schema.booking).where(eq(schema.booking.id, id));
    for (const id of handBuilt.occurrences) await db.delete(schema.occurrence).where(eq(schema.occurrence.id, id));
    await deleteTestUser(db, other.userId);
  }
});
