import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";

import { bookWithHeldTicket, registerFree, registerPro } from "@/lib/booking/claims";
import { ticket, ticketMovement } from "@/lib/db/schema";
import { addMinutes, dbTest, inParallel, type DbHarness } from "@/test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeType,
  movementsOf,
  ticketsOf,
  type OccurrenceRow,
} from "@/test/fixtures";

type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (r: Outcome): string => (r.ok ? "ok" : r.code);
const codesOf = (settled: PromiseSettledResult<Outcome>[]): string[] =>
  settled.map((s) => (s.status === "fulfilled" ? codeOf(s.value) : `threw: ${String(s.reason)}`));
const countOf = (codes: string[], code: string): number => codes.filter((c) => c === code).length;

function held(h: DbHarness, occ: OccurrenceRow, customerId: string) {
  return {
    professionalId: h.pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    actorUserId: null,
  };
}

function pro(h: DbHarness, occ: OccurrenceRow, customerId: string) {
  return {
    professionalId: h.pro.proId,
    actorUserId: h.pro.userId,
    occurrenceId: occ.id,
    customerId,
    asGuest: false,
  };
}

dbTest(
  "T1: 20 concurrent spends on 5 seats: exactly 5 win",
  async (h) => {
    const typeId = await makeType(h.db, h.pro);
    const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId], capacity: 5 });
    const customers = await Promise.all(Array.from({ length: 20 }, () => makeCustomer(h.db, h.pro)));
    await Promise.all(customers.map((c) => giveTickets(h.db, h.pro, c, typeId, 1)));

    const codes = codesOf(await inParallel(customers.map((c) => () => bookWithHeldTicket(h.db, held(h, occ, c)))));
    assert.equal(countOf(codes, "ok"), 5, codes.join(","));
    assert.equal(countOf(codes, "full"), 15, codes.join(","));
    assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 5);
    const booked = await h.db
      .select({ id: ticket.id })
      .from(ticket)
      .where(and(eq(ticket.professionalId, h.pro.proId), eq(ticket.status, "booked")));
    assert.equal(booked.length, 5);
  },
  { timeout: 240_000 },
);

dbTest(
  "T2: 3 tickets, 10 concurrent bookings on 10 séances: exactly 3 win",
  async (h) => {
    const typeId = await makeType(h.db, h.pro);
    const { occurrences } = await makeEvent(h.db, h.pro, {
      ticketTypeIds: [typeId],
      rule: { freq: "daily", interval: 1, endMode: "count", occurrenceCount: 10 },
    });
    assert.equal(occurrences.length, 10);
    const customerId = await makeCustomer(h.db, h.pro);
    await giveTickets(h.db, h.pro, customerId, typeId, 3);

    const codes = codesOf(await inParallel(occurrences.map((o) => () => bookWithHeldTicket(h.db, held(h, o, customerId)))));
    assert.equal(countOf(codes, "ok"), 3, codes.join(","));
    assert.equal(countOf(codes, "no_ticket"), 7, codes.join(","));

    const tickets = await ticketsOf(h.db, customerId);
    assert.equal(tickets.filter((t) => t.status === "booked").length, 3);
    assert.equal(new Set(tickets.map((t) => t.bookingId)).size, 3);
    const spends = await h.db
      .select({ id: ticketMovement.id })
      .from(ticketMovement)
      .where(and(eq(ticketMovement.customerId, customerId), eq(ticketMovement.kind, "spend")));
    assert.equal(spends.length, 3);
    const seats = await Promise.all(occurrences.map((o) => getOccurrence(h.db, o.id)));
    assert.equal(seats.reduce((n, o) => n + o.seatsTaken, 0), 3);
  },
  { timeout: 180_000 },
);

dbTest("E2 spends the soonest-expiring valid ticket and confirms", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(h.db, h.pro);
  const [forever] = await giveTickets(h.db, h.pro, customerId, typeId, 1);
  const [soon] = await giveTickets(h.db, h.pro, customerId, typeId, 1, { expiresAt: addMinutes(occ.startsAt, 1440) });
  const [tooSoon] = await giveTickets(h.db, h.pro, customerId, typeId, 1, { expiresAt: addMinutes(occ.startsAt, -60) });

  const res = await bookWithHeldTicket(h.db, held(h, occ, customerId));
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.ticketId, soon);
  assert.deepEqual(res.effects, [
    { type: "email.booking_confirmed", bookingId: res.bookingId },
    { type: "email.pro_new_booking", bookingId: res.bookingId },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);
  const b = await getBooking(h.db, res.bookingId);
  assert.equal(b.status, "confirmed");
  assert.equal(b.coverage, "ticket");
  assert.equal(b.createdBy, "client");
  assert.ok(b.confirmedAt);
  const moves = await movementsOf(h.db, soon);
  assert.deepEqual(moves.map((m) => m.kind), ["offer", "spend"]);
  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 1);

  // The same client again on the same séance.
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, occ, customerId))), "already_booked");
  // A second séance: the ticket without expiry is next; the one expiring before the séance never is.
  const { occurrences: [later] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  const next = await bookWithHeldTicket(h.db, held(h, later, customerId));
  assert.ok(next.ok, JSON.stringify(next));
  assert.equal(next.ticketId, forever);
  const { occurrences: [third] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, third, customerId))), "no_ticket");
  const left = (await ticketsOf(h.db, customerId)).find((t) => t.id === tooSoon);
  assert.equal(left?.status, "available");
});

dbTest("E2 client refuses a free-mode séance and a type the event does not accept", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const otherType = await makeType(h.db, h.pro);
  const customerId = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, customerId, otherType, 1);

  const { occurrences: [free] } = await makeEvent(h.db, h.pro, { bookingMode: "free" });
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, free, customerId))), "unavailable");

  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, occ, customerId))), "no_ticket");
  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 0);
});

dbTest("E3 registerFree: confirmed free booking, already booked, full, wrong mode", async (h) => {
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { bookingMode: "free", capacity: 2 });
  const [a, b, c] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);
  const input = (customerId: string) => ({
    professionalId: h.pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
  });

  const res = await registerFree(h.db, input(a));
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, [
    { type: "email.booking_confirmed", bookingId: res.bookingId },
    { type: "email.pro_new_booking", bookingId: res.bookingId },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);
  const row = await getBooking(h.db, res.bookingId);
  assert.equal(row.coverage, "free");
  assert.equal(row.status, "confirmed");
  assert.equal(row.purchaseId, null);

  assert.equal(codeOf(await registerFree(h.db, input(a))), "already_booked");
  assert.equal(codeOf(await registerFree(h.db, input(b))), "ok");
  assert.equal(codeOf(await registerFree(h.db, input(c))), "full");
  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 2);

  const { occurrences: [paid] } = await makeEvent(h.db, h.pro, { bookingMode: "tickets" });
  assert.equal(
    codeOf(await registerFree(h.db, { ...input(c), occurrenceId: paid.id, seenStartsAt: paid.startsAt })),
    "unavailable",
  );
});

dbTest("registerPro: guest on a « Sur place » séance, private and past séances, forced ticket", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const otherType = await makeType(h.db, h.pro);
  const customerId = await makeCustomer(h.db, h.pro);

  const { occurrences: [none] } = await makeEvent(h.db, h.pro, { bookingMode: "none" });
  assert.equal(codeOf(await registerPro(h.db, pro(h, none, customerId))), "not_eligible");
  const guest = await registerPro(h.db, { ...pro(h, none, customerId), asGuest: true });
  assert.ok(guest.ok, JSON.stringify(guest));
  assert.equal(guest.coverage, "guest");
  assert.equal(guest.ticketId, null);
  assert.deepEqual(guest.effects, [
    { type: "email.booking_confirmed", bookingId: guest.bookingId },
    { type: "google.sync_occurrence", occurrenceId: none.id },
  ]);
  assert.equal((await getBooking(h.db, guest.bookingId)).createdBy, "pro");

  // A private séance two days ago: the pro path ignores privacy, notice and horizon.
  const [first, second] = await giveTickets(h.db, h.pro, customerId, typeId, 2);
  const { occurrences: [past] } = await makeEvent(h.db, h.pro, {
    ticketTypeIds: [typeId],
    isPrivate: true,
    rule: { startDate: dayIn(h.pro, -2) },
  });
  const forced = await registerPro(h.db, { ...pro(h, past, customerId), ticketId: second });
  assert.ok(forced.ok, JSON.stringify(forced));
  assert.equal(forced.coverage, "ticket");
  assert.equal(forced.ticketId, second);
  const secondMoves = await movementsOf(h.db, second);
  assert.equal(secondMoves[secondMoves.length - 1].kind, "spend");
  const [actor] = await h.db
    .select({ actor: ticketMovement.actor, actorUserId: ticketMovement.actorUserId })
    .from(ticketMovement)
    .where(and(eq(ticketMovement.ticketId, second), eq(ticketMovement.kind, "spend")));
  assert.deepEqual(actor, { actor: "pro", actorUserId: h.pro.userId });

  // A forced ticket the séance does not accept.
  const [foreign] = await giveTickets(h.db, h.pro, customerId, otherType, 1);
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId] });
  assert.equal(codeOf(await registerPro(h.db, { ...pro(h, occ, customerId), ticketId: foreign })), "not_eligible");
  // Without forcing, the remaining eligible ticket is spent.
  const auto = await registerPro(h.db, pro(h, occ, customerId));
  assert.ok(auto.ok, JSON.stringify(auto));
  assert.equal(auto.ticketId, first);
});

dbTest("registerPro: « +1 place » raises the capacity; a cancelled séance is refused", async (h) => {
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { bookingMode: "free", capacity: 1 });
  const [a, b, c] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);

  assert.equal(codeOf(await registerPro(h.db, pro(h, occ, a))), "ok");
  assert.equal(codeOf(await registerPro(h.db, pro(h, occ, b))), "full");
  const extra = await registerPro(h.db, { ...pro(h, occ, b), extraSeat: true });
  assert.ok(extra.ok, JSON.stringify(extra));
  assert.equal(extra.coverage, "free");
  const after = await getOccurrence(h.db, occ.id);
  assert.equal(after.capacity, 2);
  assert.equal(after.seatsTaken, 2);
  assert.equal(after.capacityOverride, true);

  const { occurrences: [gone] } = await makeEvent(h.db, h.pro, { bookingMode: "free" });
  await h.db.execute(sql`update occurrence set status = 'cancelled', cancelled_at = ${new Date().toISOString()}::timestamptz where id = ${gone.id}`);
  assert.equal(codeOf(await registerPro(h.db, pro(h, gone, c))), "unavailable");
});

/* ─ Ledger ruling (Task 20 review): a same-customer double submit for the LAST seat is
   « already_booked », never « full ». assertNotBooked sits between R and SEAT. ─ */

dbTest("E2 the same client twice for the last seat is already_booked, not full", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId], capacity: 1 });
  const customerId = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, customerId, typeId, 2);

  const first = await bookWithHeldTicket(h.db, held(h, occ, customerId));
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, occ, customerId))), "already_booked");
  // Another client does meet the real « full ».
  const other = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, other, typeId, 1);
  assert.equal(codeOf(await bookWithHeldTicket(h.db, held(h, occ, other))), "full");

  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 1);
  const tickets = await ticketsOf(h.db, customerId);
  assert.equal(tickets.filter((t) => t.status === "booked").length, 1);
  assert.equal(tickets.filter((t) => t.status === "available").length, 1);

  // The same double submit, concurrent, on a second one-seat séance: one wins, one is already_booked.
  const { occurrences: [racy] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId], capacity: 1 });
  const racer = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, racer, typeId, 2);
  const codes = codesOf(
    await inParallel([() => bookWithHeldTicket(h.db, held(h, racy, racer)), () => bookWithHeldTicket(h.db, held(h, racy, racer))]),
  );
  assert.deepEqual([...codes].sort(), ["already_booked", "ok"], codes.join(","));
  assert.equal((await getOccurrence(h.db, racy.id)).seatsTaken, 1);
});

dbTest("E3 the same client twice for the last seat is already_booked, not full", async (h) => {
  const { occurrences: [occ] } = await makeEvent(h.db, h.pro, { bookingMode: "free", capacity: 1 });
  const [a, b] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);
  const input = (customerId: string) => ({
    professionalId: h.pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
  });

  assert.equal(codeOf(await registerFree(h.db, input(a))), "ok");
  assert.equal(codeOf(await registerFree(h.db, input(a))), "already_booked");
  assert.equal(codeOf(await registerFree(h.db, input(b))), "full");
  assert.equal((await getOccurrence(h.db, occ.id)).seatsTaken, 1);
});

dbTest("registerPro: the same client twice for the last seat is already_booked, whatever the coverage", async (h) => {
  const typeId = await makeType(h.db, h.pro);
  const customerId = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, customerId, typeId, 2);

  // free
  const { occurrences: [free] } = await makeEvent(h.db, h.pro, { bookingMode: "free", capacity: 1 });
  assert.equal(codeOf(await registerPro(h.db, pro(h, free, customerId))), "ok");
  assert.equal(codeOf(await registerPro(h.db, pro(h, free, customerId))), "already_booked");
  // « +1 place » must not raise the capacity for a client who is already registered.
  assert.equal(codeOf(await registerPro(h.db, { ...pro(h, free, customerId), extraSeat: true })), "already_booked");
  const freeAfter = await getOccurrence(h.db, free.id);
  assert.equal(freeAfter.capacity, 1);
  assert.equal(freeAfter.seatsTaken, 1);
  assert.equal(freeAfter.capacityOverride, false);

  // guest (the unique index booking_active_uq covers every coverage)
  const { occurrences: [none] } = await makeEvent(h.db, h.pro, { bookingMode: "none", capacity: 1 });
  assert.equal(codeOf(await registerPro(h.db, { ...pro(h, none, customerId), asGuest: true })), "ok");
  assert.equal(codeOf(await registerPro(h.db, { ...pro(h, none, customerId), asGuest: true })), "already_booked");
  assert.equal((await getOccurrence(h.db, none.id)).seatsTaken, 1);

  // ticket: the second attempt spends nothing
  const { occurrences: [paid] } = await makeEvent(h.db, h.pro, { ticketTypeIds: [typeId], capacity: 1 });
  assert.equal(codeOf(await registerPro(h.db, pro(h, paid, customerId))), "ok");
  assert.equal(codeOf(await registerPro(h.db, pro(h, paid, customerId))), "already_booked");
  assert.equal((await getOccurrence(h.db, paid.id)).seatsTaken, 1);
  const tickets = await ticketsOf(h.db, customerId);
  assert.equal(tickets.filter((t) => t.status === "booked").length, 1);
  assert.equal(tickets.filter((t) => t.status === "available").length, 1);
});
