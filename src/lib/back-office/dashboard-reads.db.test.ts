import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { checkInvariants } from "@/lib/booking/invariants";
import { revenueByCurrency } from "@/lib/booking/revenue";
import type { Db } from "@/lib/db/atomic";
import { booking, bookingAnswer, event, ticketOffer, timeOff } from "@/lib/db/schema";
import type { OccurrenceStatus } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";

import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "../../test/db";
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
import { getDashboardData } from "./dashboard-reads";
import { formatWhen, planningHref } from "./format";

const HOUR = 60;
const DAY = 24 * HOUR;

function proInfo(pro: TestPro): { id: string; timezone: string; currency: string } {
  return { id: pro.proId, timezone: pro.tz, currency: pro.currency };
}

/** A one-off event with one séance starting at `startsAt` (own event, so séances never share a series date). */
async function seanceAt(
  db: Db,
  pro: TestPro,
  startsAt: Date,
  over: { seatsTaken?: number; status?: OccurrenceStatus } = {},
): Promise<{ eventId: string; seanceId: string }> {
  const eventId = await rowEvent(db, pro);
  const seanceId = await rowSeance(db, pro, eventId, { startsAt, ...over });
  return { eventId, seanceId };
}

dbTest("getDashboardData counts the séances of the next 7 days and their confirmed registrants", async ({ db, pro }) => {
  const now = new Date();
  const alice = await rowCustomer(db, pro);
  const bruno = await rowCustomer(db, pro);
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  await db.insert(timeOff).values({
    professionalId: pro.proId,
    startAt: addMinutes(now, 36 * HOUR),
    endAt: addMinutes(now, 60 * HOUR),
    allDay: true,
  });

  // Counted: an empty séance before the time off.
  await seanceAt(db, pro, addMinutes(now, 24 * HOUR));
  // Hidden: an empty séance under the time off.
  await seanceAt(db, pro, addMinutes(now, 48 * HOUR));
  // Counted: a booked séance under the time off.
  const booked = await seanceAt(db, pro, addMinutes(now, 49 * HOUR), { seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: booked.seanceId, customerId: alice });
  // Excluded: cancelled, starting exactly at now + 7 days, already started.
  await seanceAt(db, pro, addMinutes(now, 72 * HOUR), { status: "cancelled" });
  await seanceAt(db, pro, addMinutes(now, 7 * DAY));
  await seanceAt(db, pro, addMinutes(now, -HOUR));
  // Counted: the last minute of the window, one confirmed and one pending registrant.
  const last = await seanceAt(db, pro, addMinutes(now, 7 * DAY - 1), { seatsTaken: 2 });
  await rowBooking(db, pro, { occurrenceId: last.seanceId, customerId: alice });
  const pendingPurchase = await rowPurchase(db, pro, { customerId: bruno, offerId, ticketTypeId: typeId });
  await rowBooking(db, pro, {
    occurrenceId: last.seanceId,
    customerId: bruno,
    status: "pending",
    coverage: "ticket",
    purchaseId: pendingPurchase,
  });
  // RDV: a booked one under the time off is counted (never hidden), a cancelled one is not.
  const rdvType = await rowRdvType(db, pro);
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, 50 * HOUR) });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: bruno });
  await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, 20 * HOUR), seatsTaken: 0, status: "cancelled" });

  const { kpis } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(kpis.upcomingSeances7d, 4);
  assert.equal(kpis.upcomingRegistrants7d, 3);
});

// R1: « empty » is measured on the live seats: seats_taken also counts a hold that lapsed and was not released yet.
dbTest("getDashboardData: a séance kept only by a lapsed hold is empty under a time off, a live hold keeps it", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  await db.insert(timeOff).values({
    professionalId: pro.proId,
    startAt: addMinutes(now, 36 * HOUR),
    endAt: addMinutes(now, 60 * HOUR),
    allDay: true,
  });
  const hold = async (occurrenceId: string, holdExpiresAt: Date) => {
    const customerId = await rowCustomer(db, pro);
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
    await rowBooking(db, pro, { occurrenceId, customerId, status: "pending", coverage: "ticket", purchaseId, holdExpiresAt });
  };
  const lapsed = await seanceAt(db, pro, addMinutes(now, 48 * HOUR), { seatsTaken: 1 });
  await hold(lapsed.seanceId, addMinutes(now, -10));
  const live = await seanceAt(db, pro, addMinutes(now, 49 * HOUR), { seatsTaken: 1 });
  await hold(live.seanceId, addMinutes(now, 30));

  const { kpis } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(kpis.upcomingSeances7d, 1, "the lapsed hold's séance is hidden by the time off, the live hold's is not");
  assert.equal(kpis.upcomingRegistrants7d, 0, "a pending booking is no registrant");
});

dbTest("getDashboardData counts the valid available tickets, archived types included", async ({ db, pro }) => {
  const now = new Date();
  const active = await rowType(db, pro);
  const archived = await rowType(db, pro, { archivedAt: now });
  const alice = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: active });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: active, expiresAt: addDaysMs(now, 5) });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: active, expiresAt: addDaysMs(now, -1) });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: active, status: "used" });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: archived });

  const { kpis } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(kpis.ticketsInCirculation, 3);
  assert.equal(kpis.currency, "eur");
});

dbTest("getDashboardData clients are the customers with a confirmed booking or a ticket", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);

  // A confirmed guest booking only: a client.
  const guest = await rowCustomer(db, pro);
  const guestSeance = await seanceAt(db, pro, addMinutes(now, 2 * DAY), { seatsTaken: 2 });
  await rowBooking(db, pro, { occurrenceId: guestSeance.seanceId, customerId: guest });
  // A ticket in any state (closed): a client.
  const holder = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId: holder, ticketTypeId: typeId, status: "closed" });
  // Both: counted once.
  const both = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId: both, ticketTypeId: typeId });
  await rowBooking(db, pro, { occurrenceId: guestSeance.seanceId, customerId: both });
  // Not clients: a pending purchase only, a brand new customer, a cancelled booking only.
  const buyer = await rowCustomer(db, pro);
  await rowPurchase(db, pro, { customerId: buyer, offerId, ticketTypeId: typeId });
  await rowCustomer(db, pro);
  const cancelled = await rowCustomer(db, pro);
  const otherSeance = await seanceAt(db, pro, addMinutes(now, 3 * DAY));
  await rowBooking(db, pro, { occurrenceId: otherSeance.seanceId, customerId: cancelled, status: "cancelled" });

  const { kpis } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(kpis.clients, 3);
});

dbTest("getDashboardData alerts count red and orange clients and the events without an active type", async ({ db, pro }) => {
  const now = new Date();
  const active = await rowType(db, pro);
  const archived = await rowType(db, pro, { archivedAt: now });
  const unlinked = await rowType(db, pro);

  // Linked to a tickets-mode event with an upcoming séance: no alert.
  const e2 = await rowEvent(db, pro);
  await rowSeance(db, pro, e2, {}, now);
  await rowLink(db, pro, e2, active, now);
  // Tickets mode with no type, and with only an archived type: both flagged.
  const e1 = await rowEvent(db, pro);
  const e4 = await rowEvent(db, pro);
  await rowLink(db, pro, e4, archived, now);
  // Free mode with no type: not flagged.
  await rowEvent(db, pro, { bookingMode: "free" });

  const green = await rowCustomer(db, pro);
  const red = await rowCustomer(db, pro);
  const orange = await rowCustomer(db, pro);
  await rowTicket(db, pro, { customerId: green, ticketTypeId: active });
  await rowTicket(db, pro, { customerId: red, ticketTypeId: archived });
  await rowTicket(db, pro, { customerId: orange, ticketTypeId: unlinked });

  const { alerts } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(alerts.redClients, 1);
  assert.equal(alerts.orangeClients, 1);
  assert.deepEqual(alerts.eventsWithoutActiveType.map((e) => e.eventId).sort(), [e1, e4].sort());
  const [e1Row] = await db.select({ title: event.title }).from(event).where(eq(event.id, e1));
  assert.equal(alerts.eventsWithoutActiveType.find((e) => e.eventId === e1)?.title, e1Row.title);
});

dbTest("getDashboardData getting-started flags and the first type", async ({ db, pro }) => {
  const now = new Date();
  const empty = await getDashboardData(db, proInfo(pro), now, false);
  assert.deepEqual(empty.gettingStarted, { hasType: false, hasOffer: false, hasEvent: false, firstTypeId: null });

  // An RDV « Gratuit » type counts as a type but cannot take an offer.
  await rowRdvType(db, pro, { rdvFree: true, position: 0 });
  assert.deepEqual((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted, {
    hasType: true,
    hasOffer: false,
    hasEvent: false,
    firstTypeId: null,
  });

  const paid = await rowType(db, pro, { position: 1 });
  await rowType(db, pro, { position: 2 });
  assert.equal((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted.firstTypeId, paid);

  // An offer of an archived type, then an inactive offer: still no active offer.
  const old = await rowType(db, pro, { archivedAt: now });
  await rowOffer(db, pro, old);
  const offerId = await rowOffer(db, pro, paid);
  await db.update(ticketOffer).set({ isActive: false }).where(eq(ticketOffer.id, offerId));
  assert.equal((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted.hasOffer, false);
  await db.update(ticketOffer).set({ isActive: true }).where(eq(ticketOffer.id, offerId));
  assert.equal((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted.hasOffer, true);

  // An archived event does not count, a live one does.
  await rowEvent(db, pro, { archivedAt: now });
  assert.equal((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted.hasEvent, false);
  await rowEvent(db, pro);
  assert.deepEqual((await getDashboardData(db, proInfo(pro), now, false)).gettingStarted, {
    hasType: true,
    hasOffer: true,
    hasEvent: true,
    firstTypeId: paid,
  });
});

dbTest("getDashboardData lists the next 8 confirmed bookings, soonest first", async ({ db, pro }) => {
  const now = new Date();
  const alice = await rowCustomer(db, pro, { name: "Alice Martin", email: "alice@skedul.test" });
  const created: { eventId: string; seanceId: string; bookingId: string; startsAt: Date }[] = [];
  for (let day = 1; day <= 10; day += 1) {
    const startsAt = addMinutes(now, day * DAY);
    const s = await seanceAt(db, pro, startsAt, { seatsTaken: 1 });
    const bookingId = await rowBooking(db, pro, { occurrenceId: s.seanceId, customerId: alice });
    created.push({ ...s, bookingId, startsAt });
  }
  // Excluded: a booking on a séance already started, and a cancelled booking.
  const started = await seanceAt(db, pro, addMinutes(now, -DAY), { seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: started.seanceId, customerId: alice });
  const unbooked = await seanceAt(db, pro, addMinutes(now, 12 * HOUR));
  await rowBooking(db, pro, { occurrenceId: unbooked.seanceId, customerId: alice, status: "cancelled" });

  const { upcomingBookings } = await getDashboardData(db, proInfo(pro), now, false);
  assert.deepEqual(
    upcomingBookings.map((b) => b.bookingId),
    created.slice(0, 8).map((c) => c.bookingId),
  );

  const first = upcomingBookings[0];
  const [eventRow] = await db.select({ title: event.title, color: event.color }).from(event).where(eq(event.id, created[0].eventId));
  const endsAt = addMinutes(created[0].startsAt, 60);
  assert.equal(first.occurrenceId, created[0].seanceId);
  assert.equal(first.kind, "seance");
  assert.equal(first.title, eventRow.title);
  assert.equal(first.color, eventRow.color);
  assert.equal(first.startsAt, created[0].startsAt.toISOString());
  assert.equal(first.endsAt, endsAt.toISOString());
  assert.equal(first.whenLabel, formatWhen(created[0].startsAt, endsAt, pro.tz));
  assert.equal(first.planningHref, planningHref({ occurrenceId: created[0].seanceId, startsAt: created[0].startsAt, tz: pro.tz }));
  assert.equal(first.status, "confirmed");
  assert.equal(first.coverage, "guest");
  assert.equal(first.ticketTypeName, null);
  assert.equal(first.purchase, null);
  assert.equal(first.customerId, alice);
  assert.equal(first.customerName, "Alice Martin");
  assert.equal(first.customerEmail, "alice@skedul.test");
  assert.equal(first.customerPhone, null);
  assert.equal(first.notes, null);
  assert.deepEqual(first.answers, []);
});

dbTest("getDashboardData booking details carry the ticket type, the payment, the notes and the answers", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro, { name: "Cours collectif" });
  const offerId = await rowOffer(db, pro, typeId);
  const alice = await rowCustomer(db, pro);
  const s = await seanceAt(db, pro, addMinutes(now, DAY), { seatsTaken: 1 });
  const purchaseId = await rowPurchase(db, pro, {
    customerId: alice,
    offerId,
    ticketTypeId: typeId,
    status: "paid",
    amountCents: 2500,
  });
  const bookingId = await rowBooking(db, pro, {
    occurrenceId: s.seanceId,
    customerId: alice,
    coverage: "ticket",
    purchaseId,
  });
  await rowTicket(db, pro, { customerId: alice, ticketTypeId: typeId, purchaseId, status: "booked", bookingId });
  await db.update(booking).set({ customerNotes: "J'arrive en retard" }).where(eq(booking.id, bookingId));
  await db.insert(bookingAnswer).values({ professionalId: pro.proId, bookingId, questionLabel: "Niveau", value: "Débutant" });
  await db.insert(bookingAnswer).values({ professionalId: pro.proId, bookingId, questionLabel: "Blessure", value: "Aucune" });

  const { upcomingBookings } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(upcomingBookings.length, 1);
  const detail = upcomingBookings[0];
  assert.equal(detail.coverage, "ticket");
  assert.equal(detail.ticketTypeName, "Cours collectif");
  assert.deepEqual(detail.purchase, { status: "paid", amountLabel: formatMoney(2500, "eur"), livemode: false });
  assert.equal(detail.notes, "J'arrive en retard");
  assert.deepEqual(detail.answers, [
    { label: "Niveau", value: "Débutant" },
    { label: "Blessure", value: "Aucune" },
  ]);
});

dbTest("getDashboardData an RDV row takes the name and the colour of its type", async ({ db, pro }) => {
  const now = new Date();
  const alice = await rowCustomer(db, pro);
  const rdvType = await rowRdvType(db, pro, { name: "Massage découverte", color: "#0f766e" });
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, DAY) });
  const bookingId = await rowBooking(db, pro, { occurrenceId: rdv, customerId: alice });

  const { upcomingBookings } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(upcomingBookings.length, 1);
  assert.equal(upcomingBookings[0].bookingId, bookingId);
  assert.equal(upcomingBookings[0].kind, "rdv");
  assert.equal(upcomingBookings[0].title, "Massage découverte");
  assert.equal(upcomingBookings[0].color, "#0f766e");
});

dbTest("getDashboardData a pending booking is never a registrant nor an upcoming booking, lapsed hold or not", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const alice = await rowCustomer(db, pro, { name: "Alice Martin" });
  const lapsed = await rowCustomer(db, pro);
  const live = await rowCustomer(db, pro);
  const seance = await seanceAt(db, pro, addMinutes(now, DAY), { seatsTaken: 3 });
  const aliceBooking = await rowBooking(db, pro, { occurrenceId: seance.seanceId, customerId: alice });
  for (const [customerId, holdExpiresAt] of [
    [lapsed, addMinutes(now, -5)],
    [live, addMinutes(now, 20)],
  ] as const) {
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
    await rowBooking(db, pro, {
      occurrenceId: seance.seanceId,
      customerId,
      status: "pending",
      coverage: "ticket",
      purchaseId,
      holdExpiresAt,
    });
  }
  // An RDV nobody holds any more (only a lapsed hold, seat not yet released) is not an appointment.
  const rdvType = await rowRdvType(db, pro);
  const phantom = await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, 2 * DAY) });
  const phantomPurchase = await rowPurchase(db, pro, { customerId: lapsed, offerId, ticketTypeId: typeId });
  await rowBooking(db, pro, {
    occurrenceId: phantom,
    customerId: lapsed,
    status: "pending",
    coverage: "ticket",
    purchaseId: phantomPurchase,
    holdExpiresAt: addMinutes(now, -5),
  });

  const { kpis, upcomingBookings } = await getDashboardData(db, proInfo(pro), now, false);
  assert.equal(kpis.upcomingSeances7d, 1);
  assert.equal(kpis.upcomingRegistrants7d, 1);
  assert.deepEqual(
    upcomingBookings.map((b) => b.bookingId),
    [aliceBooking],
  );
});

dbTest("getDashboardData never mixes in another pro's data", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const mine = await rowCustomer(db, pro);
  const myPurchase = await rowPurchase(db, pro, {
    customerId: mine,
    offerId,
    ticketTypeId: typeId,
    status: "paid",
    amountCents: 2500,
  });
  await rowTicket(db, pro, { customerId: mine, ticketTypeId: typeId, purchaseId: myPurchase });

  const other = await createTestPro(db);
  try {
    const theirType = await rowType(db, other);
    const theirOffer = await rowOffer(db, other, theirType);
    const theirCustomer = await rowCustomer(db, other);
    const theirPurchase = await rowPurchase(db, other, {
      customerId: theirCustomer,
      offerId: theirOffer,
      ticketTypeId: theirType,
      status: "paid",
      amountCents: 4000,
    });
    await rowTicket(db, other, { customerId: theirCustomer, ticketTypeId: theirType, purchaseId: theirPurchase });
    const theirSeance = await seanceAt(db, other, addMinutes(now, 2 * DAY), { seatsTaken: 1 });
    await rowBooking(db, other, { occurrenceId: theirSeance.seanceId, customerId: theirCustomer });

    const data = await getDashboardData(db, proInfo(pro), now, false);
    assert.equal(data.kpis.upcomingSeances7d, 0);
    assert.equal(data.kpis.upcomingRegistrants7d, 0);
    assert.equal(data.kpis.ticketsInCirculation, 1);
    assert.equal(data.kpis.clients, 1);
    assert.deepEqual(data.kpis.revenue, [{ currency: "eur", cents: 2500 }]);
    assert.deepEqual(data.kpis.revenue, await revenueByCurrency(db, { live: false, professionalId: pro.proId }));
    assert.deepEqual((await getDashboardData(db, proInfo(pro), now, true)).kpis.revenue, []);
    assert.deepEqual(data.alerts.eventsWithoutActiveType, []);
    assert.deepEqual(data.upcomingBookings, []);
    assert.deepEqual(data.gettingStarted, { hasType: true, hasOffer: true, hasEvent: false, firstTypeId: typeId });

    const theirs = await getDashboardData(db, proInfo(other), now, false);
    assert.equal(theirs.kpis.upcomingSeances7d, 1);
    assert.equal(theirs.kpis.upcomingRegistrants7d, 1);
    assert.deepEqual(theirs.kpis.revenue, [{ currency: "eur", cents: 4000 }]);
    assert.equal(theirs.upcomingBookings.length, 1);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
