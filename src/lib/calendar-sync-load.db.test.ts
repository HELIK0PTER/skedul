import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { event, occurrence, professional } from "@/lib/db/schema";

import { createTestPro, dbTest, deleteTestUser } from "../test/db";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowRdv, rowRdvType, rowSeance, rowType } from "../test/rows";
import { clearGoogleLink, loadOccurrenceForSync, saveGoogleEventId } from "./calendar-sync-load";

const HOUR = 3_600_000;

dbTest("a séance lists its confirmed attendees by creation time, never the pending hold", async ({ db, pro }) => {
  const t0 = Date.now();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId, { quantity: 1 });
  const eventId = await rowEvent(db, pro, { capacity: 12 });
  await db.update(event).set({ title: "Altinha débutants", location: "Parc de la Villette" }).where(eq(event.id, eventId));
  const seance = await rowSeance(db, pro, eventId, { seatsTaken: 3 });
  const alice = await rowCustomer(db, pro, { name: "Alice", email: "alice@example.com" });
  const bob = await rowCustomer(db, pro, { name: "Bob", email: "bob@example.com" });
  const carol = await rowCustomer(db, pro, { name: "Carol", email: "carol@example.com" });
  // Bob books after Alice: the insertion order is the reverse of the expected one.
  await rowBooking(db, pro, { occurrenceId: seance, customerId: bob }, new Date(t0 + 2_000));
  await rowBooking(db, pro, { occurrenceId: seance, customerId: alice }, new Date(t0 + 1_000));
  const purchase = await rowPurchase(db, pro, { customerId: carol, offerId, ticketTypeId: typeId });
  await rowBooking(db, pro, { occurrenceId: seance, customerId: carol, status: "pending", coverage: "ticket", purchaseId: purchase });

  const loaded = await loadOccurrenceForSync(db, seance);
  assert.ok(loaded);
  assert.equal(loaded.occurrenceId, seance);
  assert.equal(loaded.userId, pro.userId);
  assert.equal(loaded.googleCalendarId, null);
  assert.equal(loaded.googleEventId, null);
  assert.equal(loaded.status, "scheduled");
  assert.equal(loaded.isRdv, false);
  assert.equal(loaded.title, "Altinha débutants");
  assert.equal(loaded.location, "Parc de la Villette");
  assert.equal(loaded.capacity, 12);
  assert.equal(loaded.timezone, "Europe/Paris");
  assert.equal(loaded.endAt.getTime() - loaded.startAt.getTime(), HOUR);
  assert.deepEqual(loaded.attendees, [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ]);
});

dbTest("the occurrence's location override wins over the event's location", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro);
  await db.update(event).set({ location: "Parc de la Villette" }).where(eq(event.id, eventId));
  const seance = await rowSeance(db, pro, eventId);

  assert.equal((await loadOccurrenceForSync(db, seance))?.location, "Parc de la Villette");

  await db.update(occurrence).set({ locationOverride: "Gymnase Japy" }).where(eq(occurrence.id, seance));
  assert.equal((await loadOccurrenceForSync(db, seance))?.location, "Gymnase Japy");

  await db.update(occurrence).set({ locationOverride: null }).where(eq(occurrence.id, seance));
  await db.update(event).set({ location: null }).where(eq(event.id, eventId));
  assert.equal((await loadOccurrenceForSync(db, seance))?.location, null);
});

dbTest("an RDV loads its type name as title, isRdv and no location", async ({ db, pro }) => {
  const typeId = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, typeId);
  const beatriz = await rowCustomer(db, pro, { name: "Beatriz", email: "beatriz@example.com" });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: beatriz });
  await db.update(occurrence).set({ locationOverride: "Ignoré pour un RDV" }).where(eq(occurrence.id, rdv));

  const loaded = await loadOccurrenceForSync(db, rdv);
  assert.ok(loaded);
  assert.equal(loaded.isRdv, true);
  assert.equal(loaded.title, "Cours particulier");
  assert.equal(loaded.location, null);
  assert.equal(loaded.capacity, 1);
  assert.deepEqual(loaded.attendees, [{ name: "Beatriz", email: "beatriz@example.com" }]);
});

dbTest("a cancelled séance loads as cancelled and its cancelled bookings are not attendees", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro);
  const seance = await rowSeance(db, pro, eventId, { status: "cancelled", seatsTaken: 0 });
  const alice = await rowCustomer(db, pro, { name: "Alice", email: "alice@example.com" });
  await rowBooking(db, pro, { occurrenceId: seance, customerId: alice, status: "cancelled" });

  const loaded = await loadOccurrenceForSync(db, seance);
  assert.ok(loaded);
  assert.equal(loaded.status, "cancelled");
  assert.deepEqual(loaded.attendees, []);
});

dbTest("the user, calendar and zone come from the occurrence's own pro; an unknown id loads nothing", async ({ db, pro }) => {
  const other = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    await db.update(professional).set({ googleCalendarId: "cal-mine" }).where(eq(professional.id, pro.proId));
    await db.update(professional).set({ googleCalendarId: "cal-other" }).where(eq(professional.id, other.proId));
    const mine = await rowSeance(db, pro, await rowEvent(db, pro));
    const theirs = await rowSeance(db, other, await rowEvent(db, other));

    const loadedMine = await loadOccurrenceForSync(db, mine);
    const loadedTheirs = await loadOccurrenceForSync(db, theirs);
    assert.equal(loadedMine?.userId, pro.userId);
    assert.equal(loadedMine?.googleCalendarId, "cal-mine");
    assert.equal(loadedMine?.timezone, "Europe/Paris");
    assert.equal(loadedTheirs?.userId, other.userId);
    assert.equal(loadedTheirs?.googleCalendarId, "cal-other");
    assert.equal(loadedTheirs?.timezone, "America/Los_Angeles");
    assert.equal(await loadOccurrenceForSync(db, "no-such-occurrence"), null);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("saveGoogleEventId sets then clears the marker, and ignores an unknown occurrence", async ({ db, pro }) => {
  const seance = await rowSeance(db, pro, await rowEvent(db, pro));

  await saveGoogleEventId(db, seance, "a".repeat(64));
  assert.equal((await loadOccurrenceForSync(db, seance))?.googleEventId, "a".repeat(64));

  await saveGoogleEventId(db, seance, null);
  assert.equal((await loadOccurrenceForSync(db, seance))?.googleEventId, null);

  await saveGoogleEventId(db, "no-such-occurrence", "x");
});

dbTest("clearGoogleLink clears the calendar id and every marker of that pro only", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    await db.update(professional).set({ googleCalendarId: "cal-mine" }).where(eq(professional.id, pro.proId));
    await db.update(professional).set({ googleCalendarId: "cal-other" }).where(eq(professional.id, other.proId));
    const eventId = await rowEvent(db, pro);
    const first = await rowSeance(db, pro, eventId, { seriesDate: "2026-12-01" });
    const second = await rowSeance(db, pro, eventId, { seriesDate: "2026-12-02" });
    const theirs = await rowSeance(db, other, await rowEvent(db, other));
    for (const id of [first, second]) await saveGoogleEventId(db, id, `marker-${id}`);
    await saveGoogleEventId(db, theirs, "marker-theirs");

    await clearGoogleLink(db, pro.proId);

    const mine = await db.select({ calendar: professional.googleCalendarId }).from(professional).where(eq(professional.id, pro.proId));
    assert.equal(mine[0].calendar, null);
    assert.equal((await loadOccurrenceForSync(db, first))?.googleEventId, null);
    assert.equal((await loadOccurrenceForSync(db, second))?.googleEventId, null);
    const theirCalendar = await db.select({ calendar: professional.googleCalendarId }).from(professional).where(eq(professional.id, other.proId));
    assert.equal(theirCalendar[0].calendar, "cal-other");
    assert.equal((await loadOccurrenceForSync(db, theirs))?.googleEventId, "marker-theirs");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("attendees are read for the occurrence's own pro only: a booking row of another pro is ignored", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const seance = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 1 });
    const alice = await rowCustomer(db, pro, { name: "Alice", email: "alice@example.com" });
    const mallory = await rowCustomer(db, other, { name: "Mallory", email: "mallory@example.com" });
    await rowBooking(db, pro, { occurrenceId: seance, customerId: alice });
    // Built by hand on purpose: booking.professional_id has no composite FK to the occurrence's pro,
    // so only the loader's own filter keeps a foreign row out of the Google event.
    await rowBooking(db, other, { occurrenceId: seance, customerId: mallory });

    const loaded = await loadOccurrenceForSync(db, seance);
    assert.deepEqual(loaded?.attendees, [{ name: "Alice", email: "alice@example.com" }]);
  } finally {
    // Cascades the foreign booking away, so I1 (seats_taken = 1) holds when the harness checks.
    await deleteTestUser(db, other.userId);
  }
});
