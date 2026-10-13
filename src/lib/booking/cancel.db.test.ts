import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { addDaysMs, addMinutes, dbTest, inParallel, type DbHarness } from "../../test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeOffer,
  makeType,
  movementsOf,
  ticketsOf,
} from "../../test/fixtures";
import { instantAt } from "../civil-date";
import { ts } from "../db/atomic";
import { cancelBookingsByPro, cancelByClient, cancelOccurrence, restoreOccurrence } from "./cancel";
import { setAvailabilityRules } from "./catalog";
import { attachCheckoutSession, bookRdv, bookWithHeldTicket, registerPro, startBuyAndBook } from "./claims";

type Outcome = { ok: boolean; code?: string };

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

const label = (s: PromiseSettledResult<Outcome>): string =>
  s.status === "rejected" ? `threw: ${String(s.reason)}` : s.value.ok ? "ok" : String(s.value.code);

dbTest("T3: client and pro cancel the same booking at once: one wins, exactly one return", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeId, 1);
  const booked = await bookWithHeldTicket(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    actorUserId: null,
  });
  must(booked, "book");

  const settled = await inParallel<Outcome>([
    () => cancelByClient(db, { professionalId: pro.proId, customerId, bookingId: booked.bookingId, actorUserId: null }),
    () =>
      cancelBookingsByPro(db, {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        occurrenceId: occ.id,
        bookingIds: [booked.bookingId],
      }),
  ]);
  const outcomes = settled.map(label);
  assert.equal(outcomes.filter((o) => o === "ok").length, 1, outcomes.join(", "));
  const loser = outcomes.find((o) => o !== "ok");
  assert.ok(loser === "too_late_or_done" || loser === "stale", outcomes.join(", "));

  const moves = await movementsOf(db, ticketId);
  assert.equal(moves.filter((m) => m.kind === "return").length, 1);
  const [t] = await ticketsOf(db, customerId);
  assert.equal(t.status, "available");
  assert.equal(t.bookingId, null);
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 0);
  assert.equal((await getBooking(db, booked.bookingId)).status, "cancelled");
});

dbTest("T7: cancelling a séance during 8 parallel claims keeps I5 and returns every ticket", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], capacity: 12 });
  const customers: { customerId: string; ticketId: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const customerId = await makeCustomer(db, pro);
    const [ticketId] = await giveTickets(db, pro, customerId, typeId, 1);
    customers.push({ customerId, ticketId });
  }
  const claim = (customerId: string) => () =>
    bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null });

  const first = inParallel<Outcome>(customers.slice(0, 4).map((c) => claim(c.customerId)));
  const cancelled = cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id });
  const second = inParallel<Outcome>(customers.slice(4).map((c) => claim(c.customerId)));
  const [a, cancelRes, b] = await Promise.all([first, cancelled, second]);
  must(cancelRes, "cancelOccurrence");

  const claims = [...a, ...b].map(label);
  for (const o of claims) assert.ok(o === "ok" || o === "unavailable", claims.join(", "));
  const okClaims = claims.filter((o) => o === "ok").length;
  // every claim committed before the cancellation was ended by it, none after it got in
  assert.equal(cancelRes.bookingsCancelled, okClaims);
  assert.equal(cancelRes.ticketsReturned, okClaims);

  const o = await getOccurrence(db, occ.id);
  assert.equal(o.status, "cancelled");
  assert.equal(o.seatsTaken, 0);
  for (const c of customers) {
    const [t] = await ticketsOf(db, c.customerId);
    assert.equal(t.status, "available", `ticket of ${c.customerId}`);
    const kinds = (await movementsOf(db, c.ticketId)).map((m) => m.kind);
    assert.equal(kinds.filter((k) => k === "spend").length, kinds.filter((k) => k === "return").length);
  }
});

async function bookedSeance(h: DbHarness) {
  const { db, pro } = h;
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeId, 1);
  const booked = await bookWithHeldTicket(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId,
    seenStartsAt: occ.startsAt,
    actorUserId: null,
  });
  must(booked, "book");
  return { typeId, occ, customerId, ticketId, bookingId: booked.bookingId };
}

dbTest("E5: 25 h before the start the client cancels and gets the ticket back", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId: s.customerId, bookingId: s.bookingId, actorUserId: null },
    addMinutes(s.occ.startsAt, -25 * 60),
  );
  must(res, "cancel");
  assert.equal(res.ticketReturned, true);
  assert.equal(res.occurrenceId, s.occ.id);
  assert.deepEqual(
    res.effects.map((e) => e.type),
    ["email.booking_cancelled", "email.pro_booking_cancelled", "google.sync_occurrence"],
  );
  const b = await getBooking(db, s.bookingId);
  assert.equal(b.status, "cancelled");
  assert.equal(b.endedBy, "client");
  assert.equal((await getOccurrence(db, s.occ.id)).seatsTaken, 0);
});

dbTest("E5: 23 h before the start (deadline 24 h) is too late", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId: s.customerId, bookingId: s.bookingId, actorUserId: null },
    addMinutes(s.occ.startsAt, -23 * 60),
  );
  assert.equal(res.ok ? "ok" : res.code, "too_late_or_done");
  assert.equal((await getBooking(db, s.bookingId)).status, "confirmed");
  assert.equal((await getOccurrence(db, s.occ.id)).seatsTaken, 1);
});

dbTest("E5: 23 h before the start is allowed after the pro changed the séance", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  const b = await getBooking(db, s.bookingId);
  // what updateOccurrence (Task 27) stamps when the pro moves the séance
  await db.execute(sql`update occurrence set changed_at = ${ts(addMinutes(b.createdAt, 1))} where id = ${s.occ.id}`);
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId: s.customerId, bookingId: s.bookingId, actorUserId: null },
    addMinutes(s.occ.startsAt, -23 * 60),
  );
  must(res, "cancel after a change");
});

dbTest("E5: 23 h before the start is allowed after the pro moved the client", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  // what moveAttendee (Task 29) stamps
  await db.execute(sql`update booking set moved_at = ${ts(new Date())} where id = ${s.bookingId}`);
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId: s.customerId, bookingId: s.bookingId, actorUserId: null },
    addMinutes(s.occ.startsAt, -23 * 60),
  );
  must(res, "cancel after a move");
});

dbTest("E5: never once the séance started, never twice, never someone else's booking", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  const input = { professionalId: pro.proId, customerId: s.customerId, bookingId: s.bookingId, actorUserId: null };
  const started = await cancelByClient(db, input, addMinutes(s.occ.startsAt, 1));
  assert.equal(started.ok ? "ok" : started.code, "too_late_or_done");
  const other = await makeCustomer(db, pro);
  const notMine = await cancelByClient(db, { ...input, customerId: other });
  assert.equal(notMine.ok ? "ok" : notMine.code, "not_found");
  must(await cancelByClient(db, input), "first cancel");
  const twice = await cancelByClient(db, input);
  assert.equal(twice.ok ? "ok" : twice.code, "too_late_or_done");
});

dbTest("E5 on an RDV libre: the RDV occurrence is cancelled and leaves the EXCLUDE", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const allWeek = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
  must(await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: allWeek }), "rules");
  const customerId = await makeCustomer(db, pro);
  const startsAt = instantAt(dayIn(pro, 3), 600, pro.tz);
  const rdv = await bookRdv(db, { professionalId: pro.proId, ticketTypeId: typeId, startsAt, customerId, actorUserId: null, mode: "free" });
  must(rdv, "bookRdv");

  const res = await cancelByClient(db, { professionalId: pro.proId, customerId, bookingId: rdv.bookingId, actorUserId: null });
  must(res, "cancel");
  assert.equal(res.ticketReturned, false);
  const o = await getOccurrence(db, rdv.occurrenceId);
  assert.equal(o.status, "cancelled");
  assert.equal(o.seatsTaken, 0);
  // the slot is free again
  const again = await bookRdv(db, { professionalId: pro.proId, ticketTypeId: typeId, startsAt, customerId, actorUserId: null, mode: "free" });
  must(again, "rebook the same slot");
});

dbTest("E6a: the pro cancels a confirmed and a pending booking; the open checkout is expired", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeId);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const c1 = await makeCustomer(db, pro);
  await giveTickets(db, pro, c1, typeId, 1);
  const confirmed = await bookWithHeldTicket(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId: c1,
    seenStartsAt: occ.startsAt,
    actorUserId: null,
  });
  must(confirmed, "held ticket");
  const c2 = await makeCustomer(db, pro);
  const pending = await startBuyAndBook(db, {
    professionalId: pro.proId,
    occurrenceId: occ.id,
    customerId: c2,
    seenStartsAt: occ.startsAt,
    offerId,
  });
  must(pending, "buy + book");
  const sessionId = `cs_test_${pending.purchaseId}`;
  must(
    await attachCheckoutSession(db, { purchaseId: pending.purchaseId, checkoutSessionId: sessionId, checkoutUrl: "https://checkout.example.test/s" }),
    "attach",
  );

  const res = await cancelBookingsByPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occ.id,
    bookingIds: [confirmed.bookingId, pending.bookingId],
    reason: "Cours déplacé",
  });
  must(res, "cancelBookingsByPro");
  assert.equal(res.cancelled, 2);
  assert.equal(res.ticketsReturned, 1);
  assert.ok(res.effects.some((e) => e.type === "email.booking_cancelled" && e.bookingId === pending.bookingId && e.by === "pro"));
  assert.ok(
    res.effects.some(
      (e) => e.type === "stripe.expire_session" && e.purchaseId === pending.purchaseId && e.checkoutSessionId === sessionId,
    ),
  );
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 0);
  const b = await getBooking(db, confirmed.bookingId);
  assert.equal(b.status, "cancelled");
  assert.equal(b.endedBy, "pro");
  assert.equal(b.cancelReason, "Cours déplacé");

  const again = await cancelBookingsByPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: occ.id,
    bookingIds: [confirmed.bookingId],
  });
  assert.equal(again.ok ? "ok" : again.code, "stale");
});

dbTest("E6a: allowed on a past séance (the pro fixes a mistake), the ticket comes back", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const {
    occurrences: [past],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], rule: { startDate: dayIn(pro, -5, now) } }, addDaysMs(now, -10));
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeId, 1);
  const reg = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: past.id,
    customerId,
    asGuest: false,
  });
  must(reg, "registerPro on a past séance");
  const res = await cancelBookingsByPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId: past.id,
    bookingIds: [reg.bookingId],
  });
  must(res, "cancel");
  assert.equal(res.ticketsReturned, 1);
  const [t] = await ticketsOf(db, customerId);
  assert.equal(t.id, ticketId);
  assert.equal(t.status, "available");
});

dbTest("E6b: cancelling a séance ends every booking, returns the tickets, and is idempotent", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const bookingIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const customerId = await makeCustomer(db, pro);
    await giveTickets(db, pro, customerId, typeId, 1);
    const r = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null });
    must(r, "book");
    bookingIds.push(r.bookingId);
  }
  const now = new Date();
  const res = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id }, now);
  must(res, "cancelOccurrence");
  assert.equal(res.bookingsCancelled, 2);
  assert.equal(res.ticketsReturned, 2);
  const mail = res.effects.find((e) => e.type === "email.occurrence_cancelled");
  assert.ok(mail && mail.type === "email.occurrence_cancelled");
  assert.deepEqual([...mail.bookingIds].sort(), [...bookingIds].sort());
  const o = await getOccurrence(db, occ.id);
  assert.equal(o.status, "cancelled");
  assert.equal(o.seatsTaken, 0);
  assert.equal(o.cancelledAt?.getTime(), now.getTime());

  const again = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id });
  must(again, "second cancelOccurrence");
  assert.equal(again.bookingsCancelled, 0);
  assert.equal(again.ticketsReturned, 0);

  const missing = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: "nope" });
  assert.equal(missing.ok ? "ok" : missing.code, "not_found");
});

dbTest("Rétablir: a cancelled future séance comes back empty; never after its start", async (h) => {
  const { db, pro } = h;
  const s = await bookedSeance(h);
  must(await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: s.occ.id }), "cancel");
  const now = new Date();
  const res = await restoreOccurrence(db, { professionalId: pro.proId, occurrenceId: s.occ.id }, now);
  must(res, "restore");
  assert.deepEqual(res.effects, []);
  const o = await getOccurrence(db, s.occ.id);
  assert.equal(o.status, "scheduled");
  assert.equal(o.cancelledAt, null);
  assert.equal(o.changedAt?.getTime(), now.getTime());
  assert.equal(o.seatsTaken, 0);
  assert.equal((await getBooking(db, s.bookingId)).status, "cancelled");
  must(await restoreOccurrence(db, { professionalId: pro.proId, occurrenceId: s.occ.id }), "restore is idempotent");

  must(await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: s.occ.id }), "cancel again");
  const late = await restoreOccurrence(db, { professionalId: pro.proId, occurrenceId: s.occ.id }, addMinutes(s.occ.startsAt, 1));
  assert.equal(late.ok ? "ok" : late.code, "not_found");
});
