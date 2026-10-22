import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { getCustomerSpace } from "@/lib/back-office/customer-space";
import { formatWhen, formatWhenShort } from "@/lib/back-office/format";
import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { clientCancelDeadline } from "@/lib/cancellation";
import { formatDayMonth, formatDayMonthYear, parseKey, todayKey } from "@/lib/civil-date";
import * as schema from "@/lib/db/schema";
import { cancelLockedText } from "@/lib/public/messages";
import { expiryFromLastDay } from "@/lib/ticket-expiry";
import { COVERAGE_LABELS } from "@/lib/tickets";
import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, testEmail } from "@/test/db";
import { dayIn, getOccurrence, giveTickets, makeCustomer, makeEvent, makeType } from "@/test/fixtures";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowRdv, rowRdvType, rowSeance, rowType } from "@/test/rows";

const BUSINESS = "Altinha Test";

dbTest("getCustomerSpace: confirmed future bookings only, soonest first, with place, coverage and cancellation hint", async ({ db, pro }) => {
  const now = new Date();
  await db
    .update(schema.professional)
    .set({ cancelDeadlineHours: 24, businessName: BUSINESS })
    .where(eq(schema.professional.id, pro.proId));
  const email = testEmail("beatriz");
  const customerId = await rowCustomer(db, pro, { name: "Beatriz Almeida", email });
  const eventId = await rowEvent(db, pro);
  await db
    .update(schema.event)
    .set({ title: "Altinha débutants", location: "Gymnase Jean Bouin" })
    .where(eq(schema.event.id, eventId));

  // Séances of one event (distinct series dates: the key is (event, date)).
  const seance = (key: string, startsAt: Date, seatsTaken: number) =>
    rowSeance(db, pro, eventId, { startsAt, seatsTaken, seriesDate: `2030-01-${key}` });
  const tooLate = await seance("01", addMinutes(now, 6 * 60), 1); // inside the 24 h deadline
  const changed = await seance("02", addMinutes(now, 7 * 60), 1); // inside the deadline, but the pro changed it afterwards
  const inTwoDays = await seance("03", addDaysMs(now, 2), 1);
  const inFiveDays = await seance("04", addDaysMs(now, 5), 1);
  const past = await seance("05", addDaysMs(now, -1), 1);
  const cancelledSeance = await seance("06", addDaysMs(now, 3), 0);
  const pendingSeance = await seance("07", addDaysMs(now, 4), 1);
  await db.update(schema.occurrence).set({ locationOverride: "Salle B" }).where(eq(schema.occurrence.id, inFiveDays));
  await db.update(schema.occurrence).set({ changedAt: now }).where(eq(schema.occurrence.id, changed));

  const bTooLate = await rowBooking(db, pro, { occurrenceId: tooLate, customerId, status: "confirmed" });
  const bChanged = await rowBooking(db, pro, { occurrenceId: changed, customerId, status: "confirmed" }, addMinutes(now, -120));
  const bTwoDays = await rowBooking(db, pro, { occurrenceId: inTwoDays, customerId, status: "confirmed", coverage: "guest" });
  const bFiveDays = await rowBooking(db, pro, { occurrenceId: inFiveDays, customerId, status: "confirmed", coverage: "free" });
  await rowBooking(db, pro, { occurrenceId: past, customerId, status: "confirmed" });
  await rowBooking(db, pro, { occurrenceId: cancelledSeance, customerId, status: "cancelled" });
  const typeId = await rowType(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId: await rowOffer(db, pro, typeId), ticketTypeId: typeId });
  await rowBooking(db, pro, { occurrenceId: pendingSeance, customerId, status: "pending", purchaseId });

  // An RDV in two and a half days: its title is the type name, it has no place.
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, 60 * 60) });
  const bRdv = await rowBooking(db, pro, { occurrenceId: rdv, customerId, status: "confirmed", coverage: "guest" });

  const space = await getCustomerSpace(db, pro.proId, customerId, now);
  assert.ok(space, "the customer belongs to this pro");
  assert.deepEqual(space.customer, { id: customerId, name: "Beatriz Almeida", email });
  assert.deepEqual(
    space.upcoming.map((u) => u.bookingId),
    [bTooLate, bChanged, bTwoDays, bRdv, bFiveDays],
    "confirmed future bookings only (not the past, cancelled or pending ones), soonest first",
  );

  const byId = new Map(space.upcoming.map((u) => [u.bookingId, u]));
  const when = async (occurrenceId: string) => {
    const o = await getOccurrence(db, occurrenceId);
    return { label: formatWhen(o.startsAt, o.endsAt, pro.tz), startsAt: o.startsAt };
  };
  const deadlineText = (startsAt: Date) =>
    `Annulation en ligne possible jusqu'au ${formatWhenShort(clientCancelDeadline(startsAt, 24), pro.tz)}.`;

  const two = await when(inTwoDays);
  assert.equal(space.businessName, BUSINESS, "the pro's business name travels with the space");
  assert.deepEqual(byId.get(bTwoDays), {
    bookingId: bTwoDays,
    title: "Altinha débutants",
    whenLabel: two.label,
    location: "Gymnase Jean Bouin",
    coverage: "guest",
    coverageLabel: COVERAGE_LABELS.guest,
    cancellable: true,
    cancelText: deadlineText(two.startsAt),
  });

  const five = await when(inFiveDays);
  assert.equal(byId.get(bFiveDays)?.location, "Salle B", "a location set on the séance wins over the event's");
  assert.equal(byId.get(bFiveDays)?.coverage, "free");
  assert.equal(byId.get(bFiveDays)?.coverageLabel, COVERAGE_LABELS.free);
  assert.equal(byId.get(bFiveDays)?.cancellable, true);
  assert.equal(byId.get(bFiveDays)?.cancelText, deadlineText(five.startsAt));

  assert.equal(byId.get(bTooLate)?.cancellable, false, "inside the deadline and never changed: no online cancellation");
  assert.equal(byId.get(bTooLate)?.cancelText, cancelLockedText(BUSINESS), "the P3 null is now the locked sentence");
  assert.equal(byId.get(bTooLate)?.cancelText, "Seul(e) Altinha Test peut annuler maintenant.");
  assert.equal(byId.get(bChanged)?.cancellable, true);
  assert.equal(
    byId.get(bChanged)?.cancelText,
    "Annulation en ligne possible jusqu'au début de la séance.",
    "changed by the pro after the booking: cancellable until the start",
  );

  const rdvWhen = await when(rdv);
  assert.deepEqual(byId.get(bRdv), {
    bookingId: bRdv,
    title: "Cours particulier",
    whenLabel: rdvWhen.label,
    location: null,
    coverage: "guest",
    coverageLabel: COVERAGE_LABELS.guest,
    cancellable: true,
    cancelText: deadlineText(rdvWhen.startsAt),
  });
});

dbTest("getCustomerSpace: a locked rendez-vous says who can still cancel it, and the wallet carries each type's class (LED:438, COV-I2)", async ({ db, pro }) => {
  const now = new Date();
  await db.update(schema.professional).set({ businessName: BUSINESS }).where(eq(schema.professional.id, pro.proId));
  const customerId = await rowCustomer(db, pro);
  // A paid RDV in 5 hours with the default 24 h deadline: locked.
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: addMinutes(now, 5 * 60) });
  const bRdv = await rowBooking(db, pro, { occurrenceId: rdv, customerId, status: "confirmed", coverage: "guest" });

  const linked = await makeType(db, pro, { name: "Cours lié" });
  const orphan = await makeType(db, pro, { name: "Cours orphelin" });
  const paidRdv = await makeType(db, pro, { name: "Rendez-vous payant", rdvEnabled: true, rdvDurationMin: 60 });
  const old = await makeType(db, pro, { name: "Ancien stage" });
  await makeEvent(db, pro, { title: "Altinha", ticketTypeIds: [linked] }, now);
  for (const typeId of [linked, orphan, paidRdv, old]) await giveTickets(db, pro, customerId, typeId, 1);
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: old, archived: true });
  assert.ok(archived.ok, JSON.stringify(archived));

  const space = await getCustomerSpace(db, pro.proId, customerId, now);
  assert.ok(space);
  const locked = space.upcoming.find((u) => u.bookingId === bRdv);
  assert.equal(locked?.coverage, "guest");
  assert.equal(locked?.cancellable, false);
  assert.equal(locked?.cancelText, "Seul(e) Altinha Test peut annuler maintenant.");
  assert.deepEqual(
    Object.fromEntries(space.wallet.map((w) => [w.name, w.typeClass])),
    {
      "Cours lié": "ok", // accepted by an upcoming tickets-mode event
      "Cours orphelin": "orphan", // no upcoming event accepts it and it is not a paid RDV type
      "Rendez-vous payant": "ok", // a paid RDV type needs no event
      "Ancien stage": "archived",
    },
  );
});

dbTest("getCustomerSpace: a lapsed or live hold, an expired booking and a cancelled séance are not upcoming bookings", async ({ db, pro }) => {
  const now = new Date();
  const customerId = await makeCustomer(db, pro);
  const eventId = await rowEvent(db, pro);
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const seance = (key: string, startsAt: Date, seatsTaken = 1) =>
    rowSeance(db, pro, eventId, { startsAt, seatsTaken, seriesDate: `2030-02-${key}` });

  const confirmed = await rowBooking(db, pro, { occurrenceId: await seance("01", addDaysMs(now, 2)), customerId, status: "confirmed" });
  // A hold that ran out 5 minutes ago and was not swept yet: not a live booking (holds.ts), for any of the bookings that follow.
  await rowBooking(db, pro, {
    occurrenceId: await seance("02", addDaysMs(now, 3)),
    customerId,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }),
    holdExpiresAt: addMinutes(now, -5),
  });
  // A live hold is not a booking either until the payment confirms it.
  await rowBooking(db, pro, {
    occurrenceId: await seance("03", addDaysMs(now, 4)),
    customerId,
    status: "pending",
    purchaseId: await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId }),
    holdExpiresAt: addMinutes(now, 30),
  });
  await rowBooking(db, pro, { occurrenceId: await seance("04", addDaysMs(now, 5), 0), customerId, status: "expired" });

  const space = await getCustomerSpace(db, pro.proId, customerId, now);
  assert.ok(space);
  assert.deepEqual(
    space.upcoming.map((u) => u.bookingId),
    [confirmed],
  );
});

// The engine never leaves a confirmed booking on a cancelled séance (invariant I5), so the check that
// this state is off the list is defense in depth: the row is forged, hence no invariant check afterwards.
dbTest(
  "getCustomerSpace: a confirmed booking on a séance that is cancelled is not listed",
  async ({ db, pro }) => {
    const now = new Date();
    const customerId = await makeCustomer(db, pro);
    const eventId = await rowEvent(db, pro);
    const cancelled = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 6), seatsTaken: 0, status: "cancelled" });
    await rowBooking(db, pro, { occurrenceId: cancelled, customerId, status: "confirmed" });
    const space = await getCustomerSpace(db, pro.proId, customerId, now);
    assert.deepEqual(space?.upcoming, []);
  },
  { invariants: false },
);

dbTest("getCustomerSpace: usable tickets by type with their expiries, an archived type is flagged", async ({ db, pro }) => {
  const now = new Date();
  const customerId = await makeCustomer(db, pro, { name: "Rafael Souza" });
  const collectif = await makeType(db, pro, { name: "Cours collectif" });
  await makeType(db, pro, { name: "Cours d'essai" });
  const stage = await makeType(db, pro, { name: "Stage d'été" });
  const lastDay = dayIn(pro, 10, now);

  await giveTickets(db, pro, customerId, collectif, 2, { expiresAt: expiryFromLastDay(lastDay, pro.tz) });
  await giveTickets(db, pro, customerId, collectif, 1);
  await giveTickets(db, pro, customerId, collectif, 1, { now: addDaysMs(now, -30), expiresAt: addDaysMs(now, -1) }); // already expired
  await giveTickets(db, pro, customerId, stage, 1);
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: stage, archived: true });
  assert.ok(archived.ok, JSON.stringify(archived));

  const space = await getCustomerSpace(db, pro.proId, customerId, now);
  assert.ok(space);
  // The wording of `expiryLabel` (Task 3): « JJ/MM » when the last day is in the current year of the pro's zone, else « JJ/MM/AAAA » (this test runs late in December too).
  const day = parseKey(lastDay).y === parseKey(todayKey(now, pro.tz)).y ? formatDayMonth(lastDay) : formatDayMonthYear(lastDay);
  assert.deepEqual(
    space.wallet.map(({ name, usable, archived: isArchived, expiries }) => ({ name, usable, archived: isArchived, expiries })),
    [
      { name: "Cours collectif", usable: 3, archived: false, expiries: [`2 valables jusqu'au ${day} inclus`, "1 sans limite de validité"] },
      { name: "Stage d'été", usable: 1, archived: true, expiries: ["1 sans limite de validité"] },
    ],
    "the type without tickets is absent; the expired ticket is not usable",
  );
  assert.ok(space.wallet.every((w) => /^#[0-9a-fA-F]{6}$/.test(w.color)));
  assert.deepEqual(space.upcoming, []);
});

dbTest("getCustomerSpace: bookings are shown in the pro's time zone", async ({ db }) => {
  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    const customerId = await rowCustomer(db, la);
    const seanceId = await rowSeance(db, la, await rowEvent(db, la), { startsAt: addDaysMs(new Date(), 4), seatsTaken: 1 });
    await rowBooking(db, la, { occurrenceId: seanceId, customerId, status: "confirmed" });
    const o = await getOccurrence(db, seanceId);

    const space = await getCustomerSpace(db, la.proId, customerId, new Date());
    assert.ok(space);
    assert.equal(space.upcoming[0]?.whenLabel, formatWhen(o.startsAt, o.endsAt, "America/Los_Angeles"));
    assert.notEqual(space.upcoming[0]?.whenLabel, formatWhen(o.startsAt, o.endsAt, "Europe/Paris"));
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("getCustomerSpace: another pro's customer, or an unknown id, gives null", async ({ db, pro }) => {
  const now = new Date();
  const mine = await makeCustomer(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    assert.ok(await getCustomerSpace(db, pro.proId, mine, now));
    assert.equal(await getCustomerSpace(db, other.proId, mine, now), null);
    assert.equal(await getCustomerSpace(db, pro.proId, theirs, now), null);
    assert.equal(await getCustomerSpace(db, pro.proId, "unknown-customer", now), null);

    // A customer with nothing yet: an empty space, not null.
    const empty = await getCustomerSpace(db, pro.proId, mine, now);
    assert.deepEqual(empty?.upcoming, []);
    assert.deepEqual(empty?.wallet, []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("getCustomerSpace: nothing of another customer, of this pro or of another pro with the same e-mail, leaks in", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("shared");
  const mine = await makeCustomer(db, pro, { name: "Mine", email });
  const sibling = await makeCustomer(db, pro, { name: "Sibling" });
  const eventId = await rowEvent(db, pro);
  const seanceId = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 2), seatsTaken: 1 });
  const typeId = await makeType(db, pro, { name: "Cours collectif" });

  // The sibling (same pro, other customer) has a booking and tickets.
  await rowBooking(db, pro, { occurrenceId: seanceId, customerId: sibling, status: "confirmed" });
  await giveTickets(db, pro, sibling, typeId, 4);

  const other = await createTestPro(db);
  try {
    // The same e-mail at another pro: a distinct customer with its own booking and tickets.
    const twin = await makeCustomer(db, other, { name: "Twin", email });
    const otherSeance = await rowSeance(db, other, await rowEvent(db, other), { startsAt: addDaysMs(now, 2), seatsTaken: 1 });
    await rowBooking(db, other, { occurrenceId: otherSeance, customerId: twin, status: "confirmed" });
    await giveTickets(db, other, twin, await makeType(db, other, { name: "Autre cours" }), 5);

    const space = await getCustomerSpace(db, pro.proId, mine, now);
    assert.ok(space);
    assert.deepEqual(space.customer, { id: mine, name: "Mine", email });
    assert.deepEqual(space.upcoming, []);
    assert.deepEqual(space.wallet, []);

    // And the sibling's own space holds only its own rows.
    const theirs = await getCustomerSpace(db, pro.proId, sibling, now);
    assert.equal(theirs?.upcoming.length, 1);
    assert.deepEqual(theirs?.wallet.map((w) => [w.name, w.usable]), [["Cours collectif", 4]]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
