import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { addMinutes, dbTest, type DbHarness } from "../../test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeType,
  occurrencesOf,
  ticketsOf,
} from "../../test/fixtures";
import { instantAt } from "../civil-date";
import { event, eventTicketType } from "../db/schema";
import { cancelByClient } from "./cancel";
import { bookWithHeldTicket } from "./claims";
import { bookingsExpiringBefore, editEventInPlace, updateOccurrence } from "./series";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

/** A séance 3 days ahead at 10:00 with `n` clients booked with a ticket each. */
async function seanceWithBookings({ db, pro }: DbHarness, n: number, ticketExpiresAt: Date | null = null) {
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const occ = occurrences[0];
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const customerId = await makeCustomer(db, pro);
    await giveTickets(db, pro, customerId, typeId, 1, { expiresAt: ticketExpiresAt });
    const b = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null });
    must(b, "book");
    bookingIds.push(b.bookingId);
    customerIds.push(customerId);
  }
  return { typeId, eventId, occ, bookingIds, customerIds };
}

dbTest("E7 cette séance: moving it detaches the time, stamps changed_at and notifies the attendees", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 1);
  const now = new Date();
  const newStart = instantAt(dayIn(pro, 4), 660, pro.tz);
  const res = await updateOccurrence(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: s.occ.id, seenStartsAt: s.occ.startsAt, patch: { startsAt: newStart, durationMin: 90 } },
    now,
  );
  must(res, "move");
  assert.equal(res.timeChanged, true);
  assert.deepEqual(res.effects, [
    { type: "email.occurrence_changed", occurrenceId: s.occ.id, bookingIds: s.bookingIds },
    { type: "google.sync_occurrence", occurrenceId: s.occ.id },
  ]);
  const o = await getOccurrence(db, s.occ.id);
  assert.equal(o.startsAt.getTime(), newStart.getTime());
  assert.equal(o.endsAt.getTime(), newStart.getTime() + 90 * 60_000);
  assert.equal(o.blockStart.getTime(), o.startsAt.getTime());
  assert.equal(o.blockEnd.getTime(), o.endsAt.getTime());
  assert.equal(o.timeDetached, true);
  assert.equal(o.changedAt?.getTime(), now.getTime());
  assert.equal(o.seriesDate, s.occ.seriesDate);

  const stale = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: s.occ.id,
    seenStartsAt: s.occ.startsAt,
    patch: { capacity: 3 },
  });
  assert.equal(stale.ok ? "ok" : stale.code, "changed");
});

dbTest("E7 cette séance: a capacity below the seats taken is clamped by GREATEST", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 3);
  const res = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: s.occ.id,
    seenStartsAt: s.occ.startsAt,
    patch: { capacity: 1 },
  });
  must(res, "capacity");
  assert.equal(res.timeChanged, false);
  assert.ok(!res.effects.some((e) => e.type === "email.occurrence_changed"));
  const o = await getOccurrence(db, s.occ.id);
  assert.equal(o.capacity, 3);
  assert.equal(o.capacityOverride, true);
  assert.equal(o.timeDetached, false);
  assert.equal(o.seatsTaken, 3);
});

dbTest("E7 cette séance: a location override e-mails the attendees, without detaching the time", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 1);
  const res = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: s.occ.id,
    seenStartsAt: s.occ.startsAt,
    patch: { locationOverride: "  Salle B  " },
  });
  must(res, "location");
  assert.ok(res.effects.some((e) => e.type === "email.occurrence_changed" && e.occurrenceId === s.occ.id));
  const o = await getOccurrence(db, s.occ.id);
  assert.equal(o.locationOverride, "Salle B");
  assert.equal(o.timeDetached, false);
  assert.equal(o.changedAt, null);
});

dbTest("E7 cette séance: moving past a ticket's validity lists it, and « Désinscrire » returns the ticket", async (h) => {
  const { db, pro } = h;
  const expiresAt = instantAt(dayIn(pro, 4), 0, pro.tz);
  const s = await seanceWithBookings(h, 1, expiresAt);
  const newStart = instantAt(dayIn(pro, 5), 600, pro.tz);
  const expiring = await bookingsExpiringBefore(db, { professionalId: pro.proId, occurrenceId: s.occ.id, newStartsAt: newStart });
  assert.deepEqual(
    expiring.map((e) => [e.bookingId, e.expiresAt.getTime()]),
    [[s.bookingIds[0], expiresAt.getTime()]],
  );
  assert.ok(expiring[0].customerName.length > 0);

  const res = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: s.occ.id,
    seenStartsAt: s.occ.startsAt,
    patch: { startsAt: newStart },
    unenrollBookingIds: s.bookingIds,
  });
  must(res, "move + unenroll");
  assert.ok(res.effects.some((e) => e.type === "email.booking_cancelled" && e.bookingId === s.bookingIds[0] && e.by === "pro"));
  assert.ok(!res.effects.some((e) => e.type === "email.occurrence_changed"));
  const o = await getOccurrence(db, s.occ.id);
  assert.equal(o.seatsTaken, 0);
  assert.equal((await getBooking(db, s.bookingIds[0])).status, "cancelled");
  const [t] = await ticketsOf(db, s.customerIds[0]);
  assert.equal(t.status, "available");
});

dbTest("E7 cette séance: an empty patch is invalid, an unknown séance is not_found", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 0);
  const empty = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: s.occ.id,
    seenStartsAt: s.occ.startsAt,
    patch: {},
  });
  assert.equal(empty.ok ? "ok" : empty.code, "invalid");
  const missing = await updateOccurrence(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: "nope",
    seenStartsAt: s.occ.startsAt,
    patch: { capacity: 4 },
  });
  assert.equal(missing.ok ? "ok" : missing.code, "not_found");
});

dbTest("E7 éditeur: capacity propagates to future séances without capacity_override; version guards", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const { eventId, occurrences } = await makeEvent(db, pro, {
    ticketTypeIds: [typeId],
    capacity: 12,
    rule: {
      startDate: dayIn(pro, 2),
      startMinute: 600,
      freq: "daily",
      interval: 1,
      weekdays: null,
      monthlyBy: null,
      monthWeek: null,
      endMode: "count",
      untilDate: null,
      occurrenceCount: 3,
    },
  });
  assert.equal(occurrences.length, 3);
  const [first, second, third] = occurrences;
  must(
    await updateOccurrence(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      occurrenceId: second.id,
      seenStartsAt: second.startsAt,
      patch: { capacity: 5 },
    }),
    "override one séance",
  );

  const res = await editEventInPlace(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    eventId,
    seenVersion: 1,
    patch: { capacity: 20, title: "Cours du soir" },
  });
  must(res, "edit in place");
  assert.equal(res.version, 2);
  assert.equal((await getOccurrence(db, first.id)).capacity, 20);
  assert.equal((await getOccurrence(db, second.id)).capacity, 5);
  assert.equal((await getOccurrence(db, third.id)).capacity, 20);
  const [ev] = await db.select().from(event).where(eq(event.id, eventId));
  assert.equal(ev.capacity, 20);
  assert.equal(ev.title, "Cours du soir");
  assert.equal(ev.version, 2);

  const stale = await editEventInPlace(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    eventId,
    seenVersion: 1,
    patch: { capacity: 8 },
  });
  assert.equal(stale.ok ? "ok" : stale.code, "stale");
  assert.equal((await occurrencesOf(db, eventId)).length, 3);
});

dbTest("E7 éditeur: links, questions and location are replaced in place; the location change is e-mailed", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 1);
  const otherType = await makeType(db, pro);
  const res = await editEventInPlace(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    eventId: s.eventId,
    seenVersion: 1,
    patch: {
      ticketTypeIds: [otherType],
      location: "Parc de Bercy",
      questions: [{ label: "Niveau ?", type: "choice", options: ["Débutant", "Confirmé"], required: true }],
    },
  });
  must(res, "edit in place");
  assert.deepEqual(res.effects, [
    { type: "email.occurrence_changed", occurrenceId: s.occ.id, bookingIds: s.bookingIds },
    { type: "google.sync_occurrence", occurrenceId: s.occ.id },
  ]);
  const links = await db.select().from(eventTicketType).where(eq(eventTicketType.eventId, s.eventId));
  assert.deepEqual(
    links.map((l) => l.ticketTypeId),
    [otherType],
  );
  const q = await db.execute<{ label: string; options: string[] }>(
    sql`select label, options from question where event_id = ${s.eventId} order by position`,
  );
  assert.deepEqual(
    q.rows.map((r) => r.label),
    ["Niveau ?"],
  );

  const foreign = await editEventInPlace(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    eventId: s.eventId,
    seenVersion: 2,
    patch: { ticketTypeIds: ["not-a-type-of-this-pro"] },
  });
  assert.equal(foreign.ok ? "ok" : foreign.code, "invalid");
});

dbTest("E5 after « cette séance »: once the pro moved the séance, the client may cancel until its start", async (h) => {
  const { db, pro } = h;
  const s = await seanceWithBookings(h, 1);
  const newStart = instantAt(dayIn(pro, 4), 600, pro.tz);
  must(
    await updateOccurrence(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      occurrenceId: s.occ.id,
      seenStartsAt: s.occ.startsAt,
      patch: { startsAt: newStart },
    }),
    "move",
  );
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId: s.customerIds[0], bookingId: s.bookingIds[0], actorUserId: null },
    addMinutes(newStart, -23 * 60),
  );
  must(res, "late cancel after the pro's change");
  assert.equal(res.ticketReturned, true);
});
