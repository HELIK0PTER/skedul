import assert from "node:assert/strict";

import { addDaysMs, createTestPro, dbTest, deleteTestUser } from "../test/db";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowRdv, rowRdvType, rowSeance, rowType } from "../test/rows";
import { listOccurrenceIdsToBackfill, saveGoogleEventId } from "./calendar-sync-load";

dbTest("backfill ids: only the pro's future scheduled occurrences with a confirmed booking, séances and RDV, soonest first", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId, { quantity: 1 });
  const rdvTypeId = await rowRdvType(db, pro);
  const eventId = await rowEvent(db, pro);
  const customers: string[] = [];
  for (let i = 0; i < 6; i++) customers.push(await rowCustomer(db, pro));

  const later = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 9), seatsTaken: 1 });
  const soon = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 3), seatsTaken: 2 });
  const rdv = await rowRdv(db, pro, rdvTypeId, { startsAt: addDaysMs(now, 5) });
  await rowBooking(db, pro, { occurrenceId: later, customerId: customers[0] });
  await rowBooking(db, pro, { occurrenceId: soon, customerId: customers[1] });
  await rowBooking(db, pro, { occurrenceId: soon, customerId: customers[2] });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: customers[3] });

  // Out: no booking at all.
  await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 4) });
  // Out: its only booking was cancelled.
  const cancelledOnly = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 6) });
  await rowBooking(db, pro, { occurrenceId: cancelledOnly, customerId: customers[4], status: "cancelled" });
  // Out: a pending hold is not a confirmed booking.
  const held = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 7), seatsTaken: 1 });
  const purchase = await rowPurchase(db, pro, { customerId: customers[5], offerId, ticketTypeId: typeId });
  await rowBooking(db, pro, { occurrenceId: held, customerId: customers[5], status: "pending", coverage: "ticket", purchaseId: purchase });
  // Out: past, even booked.
  const past = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, -2), seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: past, customerId: customers[0] });

  assert.deepEqual(await listOccurrenceIdsToBackfill(db, pro.proId, now, 50), [soon, rdv, later]);
});

dbTest("backfill ids: another pro's occurrences, a foreign booking row and a cancelled occurrence never qualify", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const now = new Date();
  try {
    const mine = await rowSeance(db, pro, await rowEvent(db, pro), { startsAt: addDaysMs(now, 2), seatsTaken: 1 });
    await rowBooking(db, pro, { occurrenceId: mine, customerId: await rowCustomer(db, pro) });
    const theirs = await rowSeance(db, other, await rowEvent(db, other), { startsAt: addDaysMs(now, 2), seatsTaken: 1 });
    await rowBooking(db, other, { occurrenceId: theirs, customerId: await rowCustomer(db, other) });

    // Built by hand on purpose: booking.professional_id has no composite FK to the occurrence's pro.
    // The other pro's confirmed row on MY unbooked séance must not pull that séance into my backfill.
    const unbooked = await rowSeance(db, pro, await rowEvent(db, pro), { startsAt: addDaysMs(now, 3) });
    await rowBooking(db, other, { occurrenceId: unbooked, customerId: await rowCustomer(db, other) });

    // A cancelled occurrence is never wanted in the calendar, whatever its booking rows say.
    const cancelled = await rowSeance(db, pro, await rowEvent(db, pro), { startsAt: addDaysMs(now, 4), status: "cancelled" });
    await rowBooking(db, pro, { occurrenceId: cancelled, customerId: await rowCustomer(db, pro) });

    assert.deepEqual(await listOccurrenceIdsToBackfill(db, pro.proId, now, 50), [mine]);
    assert.deepEqual(await listOccurrenceIdsToBackfill(db, other.proId, now, 50), [theirs]);
  } finally {
    // Cascades the foreign booking away.
    await deleteTestUser(db, other.userId);
  }
}, { invariants: false });

dbTest("backfill ids: the limit keeps the soonest occurrences", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro);
  const ids: string[] = [];
  for (const day of [8, 2, 5]) {
    const id = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, day), seatsTaken: 1 });
    await rowBooking(db, pro, { occurrenceId: id, customerId: await rowCustomer(db, pro) });
    ids.push(id);
  }
  assert.deepEqual(await listOccurrenceIdsToBackfill(db, pro.proId, now, 2), [ids[1], ids[2]]);
  assert.deepEqual(await listOccurrenceIdsToBackfill(db, pro.proId, now, 1), [ids[1]]);
});

dbTest("backfill ids: a marker already stored does not exclude the occurrence (the sync is idempotent)", async ({ db, pro }) => {
  const now = new Date();
  const seance = await rowSeance(db, pro, await rowEvent(db, pro), { startsAt: addDaysMs(now, 2), seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro) });
  await saveGoogleEventId(db, seance, "a".repeat(64));

  assert.deepEqual(await listOccurrenceIdsToBackfill(db, pro.proId, now, 10), [seance]);
});
