import assert from "node:assert/strict";

import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  ACTIVITY_LIMIT,
  activityCounts30d,
  deletionImpactFor,
  healthCounts,
  listRecentBookings,
  listRecentPurchases,
  platformRevenue,
  proStats,
  recentBookingEvents,
  recentPurchaseEvents,
} from "@/lib/admin-reads";
import { fulfillPurchase, startPurchase, type PaymentFacts } from "@/lib/booking/fulfillment";
import { checkInvariants } from "@/lib/booking/invariants";
import { addDays, dayOfWeek, todayKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { HEALTH_KEYS, readHealth, setHealth } from "@/lib/throttle";
import { BOOKING_STATUS_LABELS } from "@/lib/tickets";
import { formatMoney } from "@/lib/utils";
import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, getOccurrence, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "@/test/rows";

/** Unique Stripe ids: checkout_session_id is UNIQUE across the whole test branch. */
function payment(livemode: boolean): PaymentFacts {
  return { sessionId: `cs_test_${nanoid()}`, paymentIntentId: `pi_test_${nanoid()}`, livemode };
}

type Paid = { purchaseId: string; customerId: string; ticketTypeId: string; label: string; amountCents: number };

/** A paid purchase made by the engine (startPurchase + fulfillPurchase), so invariants I3 and I6 hold. */
async function paidPurchase(
  db: Db,
  pro: TestPro,
  opts: { livemode: boolean; priceCents?: number; customerName?: string; now?: Date },
): Promise<Paid> {
  const ticketTypeId = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, ticketTypeId, { quantity: 2, priceCents: opts.priceCents ?? 4200 });
  const customerId = await makeCustomer(db, pro, { name: opts.customerName });
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId }, opts.now);
  assert.ok(started.ok, JSON.stringify(started));
  const done = await fulfillPurchase(db, started.purchaseId, payment(opts.livemode), opts.now);
  assert.equal(done.outcome, "fulfilled");
  return { purchaseId: started.purchaseId, customerId, ticketTypeId, label: started.label, amountCents: started.amountCents };
}

async function businessNameOf(db: Db, pro: TestPro): Promise<string> {
  const [row] = await db
    .select({ name: schema.professional.businessName })
    .from(schema.professional)
    .where(eq(schema.professional.id, pro.proId));
  return row.name;
}

/** A one-off event row (rowEvent) renamed to `title`. */
async function titledEvent(db: Db, pro: TestPro, title: string): Promise<string> {
  const eventId = await rowEvent(db, pro);
  await db.update(schema.event).set({ title }).where(eq(schema.event.id, eventId));
  return eventId;
}

async function generatedUntilOf(db: Db, eventId: string): Promise<string> {
  const [row] = await db
    .select({ value: schema.event.generatedUntil })
    .from(schema.event)
    .where(eq(schema.event.id, eventId));
  return row.value;
}

dbTest("activityCounts30d: a confirmed booking makes its pro active and adds one booking", async ({ db, pro }) => {
  const now = new Date();
  const before = await activityCounts30d(db, now);

  // One séance holding three confirmed bookings (two recent, one created 40 days ago) and a cancelled one.
  const seance = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 3 });
  await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" });
  const afterOne = await activityCounts30d(db, now);
  assert.equal(afterOne.activePros30d, before.activePros30d + 1);
  assert.equal(afterOne.bookings30d, before.bookings30d + 1);

  // A second confirmed booking of the same pro adds a booking, not a pro.
  await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" });
  const afterTwo = await activityCounts30d(db, now);
  assert.equal(afterTwo.activePros30d, before.activePros30d + 1);
  assert.equal(afterTwo.bookings30d, before.bookings30d + 2);

  // A booking created 40 days ago and a cancelled one count for nothing.
  await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" }, addDaysMs(now, -40));
  await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "cancelled" });
  assert.deepEqual(await activityCounts30d(db, now), afterTwo);
});

dbTest("activityCounts30d: a paid purchase makes its pro active whatever its mode, without adding a booking", async ({ db, pro }) => {
  const now = new Date();
  const before = await activityCounts30d(db, now);

  await paidPurchase(db, pro, { livemode: false });
  const after = await activityCounts30d(db, now);
  assert.equal(after.activePros30d, before.activePros30d + 1);
  assert.equal(after.bookings30d, before.bookings30d);

  // A second purchase of the same pro (live) adds nobody.
  await paidPurchase(db, pro, { livemode: true });
  assert.deepEqual(await activityCounts30d(db, now), after);

  // Another pro whose only purchase was paid 40 days ago, or is still pending, is not active.
  const other = await createTestPro(db);
  try {
    await paidPurchase(db, other, { livemode: false, now: addDaysMs(now, -40) });
    const typeId = await rowType(db, other);
    await rowPurchase(db, other, {
      customerId: await rowCustomer(db, other),
      offerId: await rowOffer(db, other, typeId),
      ticketTypeId: typeId,
    });
    assert.deepEqual(await activityCounts30d(db, now), after);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("platformRevenue: paid purchases of the asked mode, scoped by pro and by period", async ({ db, pro }) => {
  const now = new Date();
  await paidPurchase(db, pro, { livemode: false, priceCents: 4200 });
  await paidPurchase(db, pro, { livemode: true, priceCents: 1000 });

  assert.deepEqual(await platformRevenue(db, { live: false, professionalId: pro.proId }), [{ currency: "eur", cents: 4200 }]);
  assert.deepEqual(await platformRevenue(db, { live: true, professionalId: pro.proId }), [{ currency: "eur", cents: 1000 }]);
  assert.deepEqual(
    await platformRevenue(db, { live: false, professionalId: pro.proId, since: addMinutes(now, -60) }),
    [{ currency: "eur", cents: 4200 }],
  );
  assert.deepEqual(await platformRevenue(db, { live: false, professionalId: pro.proId, since: addMinutes(now, 60) }), []);

  // Another pro sees none of it, and an empty id never widens the scope to the whole platform.
  const other = await createTestPro(db);
  try {
    assert.deepEqual(await platformRevenue(db, { live: false, professionalId: other.proId }), []);
    assert.deepEqual(await platformRevenue(db, { live: true, professionalId: other.proId }), []);
    assert.deepEqual(await platformRevenue(db, { live: false, professionalId: "" }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("feed events read « Réservation · … » and « Achat · … » with the customer, the title and the amount", async ({ db, pro }) => {
  const businessName = await businessNameOf(db, pro);

  // A confirmed séance booking, a confirmed RDV and a cancelled booking.
  const seance = await rowSeance(db, pro, await titledEvent(db, pro, "Altinha débutants"), { seatsTaken: 1 });
  const booked = await rowBooking(db, pro, {
    occurrenceId: seance,
    customerId: await rowCustomer(db, pro, { name: "Beatriz Almeida" }),
    status: "confirmed",
  });
  const rdv = await rowRdv(db, pro, await rowRdvType(db, pro, { name: "Cours particulier" }));
  const rdvBooked = await rowBooking(db, pro, {
    occurrenceId: rdv,
    customerId: await rowCustomer(db, pro, { name: "Rafael Souza" }),
    status: "confirmed",
  });
  const cancelled = await rowBooking(db, pro, {
    occurrenceId: seance,
    customerId: await rowCustomer(db, pro, { name: "Thomas Leroy" }),
    status: "cancelled",
  });

  const bookings = await recentBookingEvents(db, 50);
  const seanceEvent = bookings.find((e) => e.id === `booking-${booked}`);
  assert.ok(seanceEvent, "the séance booking is in the feed");
  assert.equal(seanceEvent.kind, "booking");
  assert.equal(seanceEvent.userId, pro.userId);
  assert.ok(seanceEvent.title.startsWith("Réservation · Test "));
  assert.equal(seanceEvent.title, `Réservation · ${businessName}`);
  assert.equal(seanceEvent.detail, `Beatriz Almeida · Altinha débutants · ${BOOKING_STATUS_LABELS.confirmed}`);
  const rdvEvent = bookings.find((e) => e.id === `booking-${rdvBooked}`);
  assert.ok(rdvEvent, "the RDV booking is in the feed");
  assert.equal(rdvEvent.detail, `Rafael Souza · Cours particulier · ${BOOKING_STATUS_LABELS.confirmed}`);
  assert.equal(bookings.some((e) => e.id === `booking-${cancelled}`), false);
  assert.ok((await recentBookingEvents(db, 2)).length <= 2);

  // A paid purchase is in the purchase feed, a pending one is not.
  const paid = await paidPurchase(db, pro, { livemode: false, customerName: "Marina Costa", priceCents: 4250 });
  const typeId = await rowType(db, pro);
  const pending = await rowPurchase(db, pro, {
    customerId: await rowCustomer(db, pro),
    offerId: await rowOffer(db, pro, typeId),
    ticketTypeId: typeId,
  });
  const purchases = await recentPurchaseEvents(db, 50);
  const bought = purchases.find((e) => e.id === `purchase-${paid.purchaseId}`);
  assert.ok(bought, "the paid purchase is in the feed");
  assert.equal(bought.kind, "purchase");
  assert.equal(bought.userId, pro.userId);
  assert.ok(bought.title.startsWith("Achat · Test "));
  assert.equal(bought.title, `Achat · ${businessName}`);
  assert.equal(bought.detail, `Marina Costa · ${paid.label} · ${formatMoney(4250, "eur")}`);
  assert.equal(purchases.some((e) => e.id === `purchase-${pending}`), false);
});

dbTest("listRecentBookings: status filter, newest first, title from the event or from the RDV type", async ({ db, pro }) => {
  const businessName = await businessNameOf(db, pro);
  const seance = await rowSeance(db, pro, await titledEvent(db, pro, "Roda libre"), { seatsTaken: 1 });
  const confirmed = await rowBooking(db, pro, {
    occurrenceId: seance,
    customerId: await rowCustomer(db, pro, { name: "Léa Martin" }),
    status: "confirmed",
    coverage: "free",
  });
  const cancelled = await rowBooking(db, pro, {
    occurrenceId: seance,
    customerId: await rowCustomer(db, pro),
    status: "cancelled",
  });

  // A pending RDV: its hold belongs to a pending purchase (booking_pending_chk).
  const typeId = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, typeId);
  const buyer = await rowCustomer(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId: buyer, offerId: await rowOffer(db, pro, typeId), ticketTypeId: typeId });
  const pending = await rowBooking(db, pro, { occurrenceId: rdv, customerId: buyer, status: "pending", purchaseId });

  const all = await listRecentBookings(db, null);
  assert.ok(all.length <= ACTIVITY_LIMIT);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].createdAt.getTime() >= all[i].createdAt.getTime(), "newest first");
  }

  const row = all.find((r) => r.id === confirmed);
  assert.ok(row, "the confirmed booking is listed");
  assert.equal(row.title, "Roda libre");
  assert.equal(row.status, "confirmed");
  assert.equal(row.coverage, "free");
  assert.equal(row.proUserId, pro.userId);
  assert.equal(row.businessName, businessName);
  assert.equal(row.timezone, "Europe/Paris");
  assert.equal(row.customerName, "Léa Martin");
  assert.ok(row.customerEmail.endsWith("@skedul.test"));
  assert.equal(row.startsAt.getTime(), (await getOccurrence(db, seance)).startsAt.getTime());
  assert.equal(row.endsAt.getTime(), (await getOccurrence(db, seance)).endsAt.getTime());

  const rdvRow = all.find((r) => r.id === pending);
  assert.ok(rdvRow, "the pending RDV booking is listed");
  assert.equal(rdvRow.title, "Cours particulier");
  assert.equal(rdvRow.status, "pending");

  const onlyCancelled = await listRecentBookings(db, "cancelled");
  assert.ok(onlyCancelled.every((r) => r.status === "cancelled"));
  assert.ok(onlyCancelled.some((r) => r.id === cancelled));
  assert.equal(onlyCancelled.some((r) => r.id === confirmed), false);
  const onlyPending = await listRecentBookings(db, "pending");
  assert.ok(onlyPending.every((r) => r.status === "pending"));
  assert.ok(onlyPending.some((r) => r.id === pending));
  assert.equal(onlyPending.some((r) => r.id === cancelled), false);
});

dbTest("listRecentPurchases: label, quantity, amount, mode and status filter", async ({ db, pro }) => {
  const businessName = await businessNameOf(db, pro);
  const test = await paidPurchase(db, pro, { livemode: false, customerName: "Marina Costa", priceCents: 4200 });
  const live = await paidPurchase(db, pro, { livemode: true, priceCents: 1000 });
  const typeId = await rowType(db, pro);
  const pendingId = await rowPurchase(db, pro, {
    customerId: await rowCustomer(db, pro),
    offerId: await rowOffer(db, pro, typeId),
    ticketTypeId: typeId,
  });

  const all = await listRecentPurchases(db, null);
  assert.ok(all.length <= ACTIVITY_LIMIT);
  const t = all.find((r) => r.id === test.purchaseId);
  assert.ok(t, "the test-mode purchase is listed");
  assert.equal(t.livemode, false);
  assert.equal(t.status, "paid");
  assert.equal(t.amountCents, 4200);
  assert.equal(t.currency, "eur");
  assert.equal(t.label, test.label);
  assert.equal(t.quantity, 2);
  assert.equal(t.customerName, "Marina Costa");
  assert.equal(t.proUserId, pro.userId);
  assert.equal(t.businessName, businessName);
  assert.ok(t.paidAt instanceof Date);
  assert.equal(all.find((r) => r.id === live.purchaseId)?.livemode, true);
  const p = all.find((r) => r.id === pendingId);
  assert.ok(p, "the pending purchase is listed");
  assert.equal(p.status, "pending");
  assert.equal(p.paidAt, null);

  const paidOnly = await listRecentPurchases(db, "paid");
  assert.ok(paidOnly.every((r) => r.status === "paid"));
  assert.ok(paidOnly.some((r) => r.id === test.purchaseId) && paidOnly.some((r) => r.id === live.purchaseId));
  assert.equal(paidOnly.some((r) => r.id === pendingId), false);
  const pendingOnly = await listRecentPurchases(db, "pending");
  assert.ok(pendingOnly.every((r) => r.status === "pending"));
  assert.ok(pendingOnly.some((r) => r.id === pendingId));
  assert.equal(pendingOnly.some((r) => r.id === test.purchaseId), false);
});

dbTest("healthCounts: pending holds older than 1 h and pending purchases whose checkout expired", async ({ db, pro }) => {
  const now = new Date();
  const before = await healthCounts(db, now);
  const twoHoursAgo = addMinutes(now, -120);

  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const seance = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 2 });

  // A hold created 2 h ago (its checkout expired 89 minutes ago) and a fresh one (checkout open for 31 more minutes).
  const stale = await rowCustomer(db, pro);
  const stalePurchase = await rowPurchase(db, pro, { customerId: stale, offerId, ticketTypeId: typeId }, twoHoursAgo);
  await rowBooking(db, pro, { occurrenceId: seance, customerId: stale, status: "pending", purchaseId: stalePurchase }, twoHoursAgo);
  const fresh = await rowCustomer(db, pro);
  const freshPurchase = await rowPurchase(db, pro, { customerId: fresh, offerId, ticketTypeId: typeId }, now);
  await rowBooking(db, pro, { occurrenceId: seance, customerId: fresh, status: "pending", purchaseId: freshPurchase }, now);

  const after = await healthCounts(db, now);
  assert.equal(after.pendingHolds, before.pendingHolds + 1);
  assert.equal(after.pendingPurchases, before.pendingPurchases + 1);

  // A pending purchase without a booking and an expired checkout counts as a purchase only.
  await rowPurchase(db, pro, { customerId: await rowCustomer(db, pro), offerId, ticketTypeId: typeId }, twoHoursAgo);
  const last = await healthCounts(db, now);
  assert.equal(last.pendingHolds, after.pendingHolds);
  assert.equal(last.pendingPurchases, after.pendingPurchases + 1);
});

dbTest("healthCounts: horizonLag counts live segments that can still produce dates and are behind", async ({ db, pro }) => {
  const now = new Date();
  const start = dayIn(pro, 3, now);
  const weekly = { freq: "weekly" as const, weekdays: [dayOfWeek(start)], interval: 1 };
  const before = await healthCounts(db, now);
  const lag = (eventId: string, daysAhead: number) =>
    db.update(schema.event).set({ generatedUntil: dayIn(pro, daysAhead, now) }).where(eq(schema.event.id, eventId));

  // An endless series generated 100 days ahead only: behind.
  const behind = await makeEvent(db, pro, { rule: { ...weekly, endMode: "never", occurrenceCount: null } }, now);
  await lag(behind.eventId, 100);
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag + 1);

  // The cutoff is today + 393 days: 392 days ahead is behind, 393 is not.
  await lag(behind.eventId, 392);
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag + 1);
  await lag(behind.eventId, 393);
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag);

  // Never behind although generated_until is far below the cutoff: a finished count series, an until series
  // generated up to its end date, a one-off, and an archived endless series.
  const counted = await makeEvent(db, pro, { rule: { ...weekly, endMode: "count", occurrenceCount: 3 } }, now);
  const until = await makeEvent(db, pro, { rule: { ...weekly, endMode: "until", untilDate: dayIn(pro, 60, now), occurrenceCount: null } }, now);
  const once = await makeEvent(db, pro, {}, now);
  const archived = await makeEvent(db, pro, { rule: { ...weekly, endMode: "never", occurrenceCount: null } }, now);
  await lag(archived.eventId, 100);
  await db.update(schema.event).set({ archivedAt: now }).where(eq(schema.event.id, archived.eventId));
  for (const e of [counted, until, once]) {
    assert.ok((await generatedUntilOf(db, e.eventId)) < dayIn(pro, 393, now), "generated_until is below the cutoff");
  }
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag);

  // The behind series counts again at 100 days, and stops counting once archived.
  await lag(behind.eventId, 100);
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag + 1);
  await db.update(schema.event).set({ archivedAt: now }).where(eq(schema.event.id, behind.eventId));
  assert.equal((await healthCounts(db, now)).horizonLag, before.horizonLag);
});

dbTest("healthCounts: the horizon cutoff is the local today of each pro's own time zone", async ({ db, pro }) => {
  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    // 2026-11-10 03:00 UTC is already Nov 10 in Paris but still Nov 9 (19:00) in Los Angeles.
    const fixedNow = new Date("2026-11-10T03:00:00Z");
    assert.equal(todayKey(fixedNow, pro.tz), "2026-11-10");
    assert.equal(todayKey(fixedNow, la.tz), "2026-11-09");
    const before = await healthCounts(db, fixedNow);

    const real = new Date();
    const endless = (p: TestPro) =>
      makeEvent(db, p, { rule: { freq: "weekly", weekdays: [dayOfWeek(dayIn(p, 3, real))], endMode: "never", occurrenceCount: null } }, real);
    const paris = await endless(pro);
    const lax = await endless(la);
    const setUntil = (eventId: string, key: string) =>
      db.update(schema.event).set({ generatedUntil: key }).where(eq(schema.event.id, eventId));

    // Exactly at the cutoff of each pro's own today + 393 days: not behind.
    await setUntil(paris.eventId, addDays("2026-11-10", 393));
    await setUntil(lax.eventId, addDays("2026-11-09", 393));
    assert.equal((await healthCounts(db, fixedNow)).horizonLag, before.horizonLag);

    // One day short: behind. Los Angeles first (a Paris or UTC cutoff would have counted it above), then Paris.
    await setUntil(lax.eventId, addDays("2026-11-09", 392));
    assert.equal((await healthCounts(db, fixedNow)).horizonLag, before.horizonLag + 1);
    await setUntil(paris.eventId, addDays("2026-11-10", 392));
    assert.equal((await healthCounts(db, fixedNow)).horizonLag, before.horizonLag + 2);
    assert.deepEqual(await checkInvariants(db, { proId: la.proId }), []);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("healthCounts: orphan payments and the nightly check come from the stored counters, null before the first run", async ({ db }) => {
  const now = new Date();
  const keys = Object.values(HEALTH_KEYS);
  const saved = await readHealth(db);
  try {
    await db.delete(schema.throttle).where(inArray(schema.throttle.key, keys));
    const none = await healthCounts(db, now);
    assert.equal(none.orphanPayments, null);
    assert.equal(none.invariantViolations, null);

    const at = new Date("2026-10-01T02:00:00Z");
    await setHealth(db, HEALTH_KEYS.orphanPayments, 3, at);
    await setHealth(db, HEALTH_KEYS.invariantViolations, 0, at);
    const stored = await healthCounts(db, now);
    assert.deepEqual(stored.orphanPayments, { value: 3, at });
    assert.deepEqual(stored.invariantViolations, { value: 0, at });
  } finally {
    await db.delete(schema.throttle).where(inArray(schema.throttle.key, keys));
    for (const key of keys) {
      const entry = saved[key];
      if (entry) await setHealth(db, key, entry.value, entry.at);
    }
  }
});

dbTest("proStats: live series, active types, bookings, clients and paid purchases of one pro only", async ({ db, pro }) => {
  const now = new Date();
  assert.deepEqual(await proStats(db, pro.proId, now), {
    events: 0,
    ticketTypes: 0,
    confirmedBookings: 0,
    upcoming: 0,
    clients: 0,
    paidPurchases: 0,
  });

  // Series: A = an archived first segment and a live second segment (ONE series), B live, C archived.
  const firstSegment = await rowEvent(db, pro, { archivedAt: now });
  const secondSegment = await rowEvent(db, pro);
  await db.update(schema.event).set({ seriesRootId: firstSegment }).where(eq(schema.event.id, secondSegment));
  const live = await rowEvent(db, pro);
  await rowEvent(db, pro, { archivedAt: now });

  // Types: two active, one archived.
  const typeA = await rowType(db, pro);
  await rowType(db, pro);
  await rowType(db, pro, { archivedAt: now });
  const offerA = await rowOffer(db, pro, typeA);

  // Séances of series B: one in two days (confirmed + pending), one three days ago (confirmed).
  const future = await rowSeance(db, pro, live, { seatsTaken: 2 });
  const past = await rowSeance(db, pro, live, { startsAt: addDaysMs(now, -3), seatsTaken: 1 });
  const confirmedFuture = await rowCustomer(db, pro); // a client: confirmed booking
  const pendingOnly = await rowCustomer(db, pro); // not a client: only a pending hold
  const cancelledOnly = await rowCustomer(db, pro); // not a client: only a cancelled booking
  const confirmedPast = await rowCustomer(db, pro); // a client
  const ticketOnly = await rowCustomer(db, pro); // a client: holds a ticket
  await rowCustomer(db, pro); // not a client: nothing yet
  await rowBooking(db, pro, { occurrenceId: future, customerId: confirmedFuture, status: "confirmed" });
  const holdPurchase = await rowPurchase(db, pro, { customerId: pendingOnly, offerId: offerA, ticketTypeId: typeA });
  await rowBooking(db, pro, { occurrenceId: future, customerId: pendingOnly, status: "pending", purchaseId: holdPurchase });
  await rowBooking(db, pro, { occurrenceId: future, customerId: cancelledOnly, status: "cancelled" });
  await rowBooking(db, pro, { occurrenceId: past, customerId: confirmedPast, status: "confirmed" });
  await rowTicket(db, pro, { customerId: ticketOnly, ticketTypeId: typeA });

  // One paid purchase: a new active type, a new client (it holds tickets), one paid purchase.
  await paidPurchase(db, pro, { livemode: false });

  // Another pro's rows never leak in.
  const other = await createTestPro(db);
  try {
    await rowEvent(db, other);
    await rowType(db, other);
    await paidPurchase(db, other, { livemode: true });

    assert.deepEqual(await proStats(db, pro.proId, now), {
      events: 2, // series A (through its live second segment) and series B
      ticketTypes: 3, // typeA, the second active type, and the paid purchase's type
      confirmedBookings: 2, // the future one and the past one
      upcoming: 2, // the confirmed and the pending booking on the future séance
      clients: 4, // confirmedFuture, confirmedPast, ticketOnly and the buyer
      paidPurchases: 1,
    });
    assert.deepEqual(await proStats(db, other.proId, now), {
      events: 1,
      ticketTypes: 2,
      confirmedBookings: 0,
      upcoming: 0,
      clients: 1,
      paidPurchases: 1,
    });
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("deletionImpactFor: tickets in circulation, payments in progress and client records elsewhere", async ({ db, pro }) => {
  const now = new Date();
  assert.deepEqual(await deletionImpactFor(db, pro.userId, pro.proId, now), {
    ticketsInCirculation: 0,
    pendingPayments: 0,
    clientRecordsElsewhere: 0,
  });

  // Three usable tickets and one already expired (not in circulation).
  const typeId = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 3);
  await giveTickets(db, pro, customerId, typeId, 1, { now: addDaysMs(now, -30), expiresAt: addDaysMs(now, -1) });

  // A checkout in progress: a pending purchase whose checkout is still open.
  const offerId = await makeOffer(db, pro, typeId);
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId }, now);
  assert.ok(started.ok, JSON.stringify(started));

  // This very user is also a client of another pro; a record at its own pro is not "elsewhere".
  const other = await createTestPro(db);
  try {
    await rowCustomer(db, other, { userId: pro.userId });
    await rowCustomer(db, pro, { userId: pro.userId });
    assert.deepEqual(await deletionImpactFor(db, pro.userId, pro.proId, now), {
      ticketsInCirculation: 3,
      pendingPayments: 1,
      clientRecordsElsewhere: 1,
    });

    // An account without a pro page: no tickets, no payments, every linked client record counts.
    assert.deepEqual(await deletionImpactFor(db, pro.userId, null, now), {
      ticketsInCirculation: 0,
      pendingPayments: 0,
      clientRecordsElsewhere: 2,
    });
    // Another pro's tickets and payments are never read for this user.
    assert.deepEqual(await deletionImpactFor(db, other.userId, other.proId, now), {
      ticketsInCirculation: 0,
      pendingPayments: 0,
      clientRecordsElsewhere: 0,
    });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
