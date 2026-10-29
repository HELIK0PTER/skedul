import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setAvailabilityRules, setTicketTypeArchived } from "@/lib/booking/catalog";
import { bookRdv, loadRdvType, rdvRules, type BookRdvInput } from "@/lib/booking/claims";
import { fulfillPurchase } from "@/lib/booking/fulfillment";
import { checkInvariants } from "@/lib/booking/invariants";
import { addDays, dayOfWeek, instantAt } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { booking, occurrence, professional, ticketOffer, ticketPurchase, ticketType, timeOff } from "@/lib/db/schema";
import type { TicketTypeInput } from "@/lib/tickets";
import { addMinutes, createTestPro, dbTest, deleteTestUser, inParallel, type DbHarness, type TestPro } from "@/test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeOffer,
  makeType,
  ticketsOf,
} from "@/test/fixtures";

type Outcome = { ok: true } | { ok: false; code: string };
const codeOf = (r: Outcome): string => (r.ok ? "ok" : r.code);

/** Global hours 08:00-20:00 every day; an RDV type; `at(minute)` = that minute on the day in 3 days (Paris). */
async function rdvSetup(h: DbHarness, typeOver: Partial<TicketTypeInput> = {}) {
  const hours = await setAvailabilityRules(h.db, {
    professionalId: h.pro.proId,
    ticketTypeId: null,
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 480, endMinute: 1200 })),
  });
  assert.ok(hours.ok, JSON.stringify(hours));
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60, ...typeOver });
  const day = dayIn(h.pro, 3);
  const at = (minute: number) => instantAt(day, minute, h.pro.tz);
  return { typeId, day, at };
}

function rdv(h: DbHarness, typeId: string, startsAt: Date, customerId: string, mode: "held_ticket" | "free"): BookRdvInput {
  return { professionalId: h.pro.proId, ticketTypeId: typeId, startsAt, customerId, actorUserId: null, mode };
}

async function scheduledRdvs(h: DbHarness) {
  return h.db
    .select()
    .from(occurrence)
    .where(and(eq(occurrence.professionalId, h.pro.proId), isNull(occurrence.eventId), eq(occurrence.status, "scheduled")));
}

dbTest("E4 held ticket: creates the RDV, confirms it and spends the ticket", async (h) => {
  const s = await rdvSetup(h);
  const customerId = await makeCustomer(h.db, h.pro);
  const [ticketId] = await giveTickets(h.db, h.pro, customerId, s.typeId, 1);

  const res = await bookRdv(h.db, rdv(h, s.typeId, s.at(600), customerId, "held_ticket"));
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.purchaseId, null);
  assert.equal(res.checkoutExpiresAt, null);
  assert.equal(res.amountCents, null);
  assert.equal(res.checkout, null, "no Checkout facts without a purchase");
  assert.deepEqual(res.effects, [
    { type: "email.booking_confirmed", bookingId: res.bookingId },
    { type: "email.pro_new_booking", bookingId: res.bookingId },
    { type: "google.sync_occurrence", occurrenceId: res.occurrenceId },
  ]);
  const o = await getOccurrence(h.db, res.occurrenceId);
  assert.equal(o.eventId, null);
  assert.equal(o.ticketTypeId, s.typeId);
  assert.equal(o.seriesDate, null);
  assert.equal(o.capacity, 1);
  assert.equal(o.seatsTaken, 1);
  assert.equal(o.status, "scheduled");
  assert.equal(o.startsAt.getTime(), s.at(600).getTime());
  assert.equal(o.endsAt.getTime(), s.at(660).getTime());
  assert.equal(o.blockStart.getTime(), s.at(600).getTime());
  assert.equal(o.blockEnd.getTime(), s.at(660).getTime());
  const b = await getBooking(h.db, res.bookingId);
  assert.equal(b.status, "confirmed");
  assert.equal(b.coverage, "ticket");
  const [t] = await ticketsOf(h.db, customerId);
  assert.equal(t.id, ticketId);
  assert.equal(t.status, "booked");
  assert.equal(t.bookingId, res.bookingId);

  // No ticket left: nothing is created.
  const other = await makeCustomer(h.db, h.pro);
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(780), other, "held_ticket"))), "no_ticket");
  assert.equal((await scheduledRdvs(h)).length, 1);
});

dbTest("T6a: two clients on the same slot, one wins", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true, rdvDurationMin: 15 });
  const [a, b] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);
  const settled = await inParallel([
    () => bookRdv(h.db, rdv(h, s.typeId, s.at(600), a, "free")),
    () => bookRdv(h.db, rdv(h, s.typeId, s.at(600), b, "free")),
  ]);
  const codes = settled.map((r) => (r.status === "fulfilled" ? codeOf(r.value) : `threw: ${String(r.reason)}`)).sort();
  assert.deepEqual(codes, ["ok", "slot_taken"]);
  assert.equal((await scheduledRdvs(h)).length, 1);
});

dbTest("T6b: an RDV over an event séance is slot_taken; back-to-back is fine", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true, rdvDurationMin: 30 });
  // makeEvent default: once, in 3 days, 10:00-11:00 (Paris), private séances block too.
  await makeEvent(h.db, h.pro, { isPrivate: true, bookingMode: "none" });
  const customerId = await makeCustomer(h.db, h.pro);
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(630), customerId, "free"))), "slot_taken");
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(660), customerId, "free"))), "ok");
});

dbTest("E4 buffers widen the block: neighbours inside the buffer are slot_taken", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true, rdvBufferBeforeMin: 15, rdvBufferAfterMin: 15 });
  const [a, b, c] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);
  const first = await bookRdv(h.db, rdv(h, s.typeId, s.at(600), a, "free"));
  assert.ok(first.ok, JSON.stringify(first));
  const o = await getOccurrence(h.db, first.occurrenceId);
  assert.equal(o.blockStart.getTime(), s.at(585).getTime());
  assert.equal(o.blockEnd.getTime(), s.at(675).getTime());
  // 11:00 → block 10:45-12:15 overlaps 09:45-11:15 (EXCLUDE).
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(660), b, "free"))), "slot_taken");
  // 11:30 → block 11:15-12:45 only touches it.
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(690), c, "free"))), "ok");
});

dbTest("E4 free type, mode checks, hours, archived type and time off", async (h) => {
  const free = await rdvSetup(h, { rdvFree: true, rdvDurationMin: 15 });
  const paid = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const customerId = await makeCustomer(h.db, h.pro);

  const ok = await bookRdv(h.db, rdv(h, free.typeId, free.at(540), customerId, "free"));
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal((await getBooking(h.db, ok.bookingId)).coverage, "free");

  assert.equal(codeOf(await bookRdv(h.db, rdv(h, free.typeId, free.at(600), customerId, "held_ticket"))), "unavailable");
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, paid, free.at(600), customerId, "free"))), "unavailable");
  // 20:00 is outside the 08:00-20:00 hours (the 15 min would end at 20:15).
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, free.typeId, free.at(1200), customerId, "free"))), "unavailable");

  await h.db.insert(timeOff).values({
    professionalId: h.pro.proId,
    startAt: free.at(720),
    endAt: free.at(780),
    allDay: false,
  });
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, free.typeId, free.at(735), customerId, "free"))), "slot_taken");

  const archived = await setTicketTypeArchived(h.db, { professionalId: h.pro.proId, ticketTypeId: free.typeId, archived: true });
  assert.ok(archived.ok);
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, free.typeId, free.at(900), customerId, "free"))), "unavailable");
});

dbTest("E4 buy: a pending RDV, then paid like T14", async (h) => {
  const s = await rdvSetup(h);
  const offerId = await makeOffer(h.db, h.pro, s.typeId, {
    quantity: 5,
    priceCents: 22500,
    validityCount: 6,
    validityUnit: "month",
  });
  const customerId = await makeCustomer(h.db, h.pro);
  const now = new Date();
  const res = await bookRdv(
    h.db,
    { professionalId: h.pro.proId, ticketTypeId: s.typeId, startsAt: s.at(600), customerId, actorUserId: null, mode: "buy", offerId },
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, []);
  assert.equal(res.amountCents, 22500);
  assert.equal(res.checkoutExpiresAt?.getTime(), addMinutes(now, 31).getTime());
  assert.ok(res.purchaseId);
  const pending = await getBooking(h.db, res.bookingId);
  assert.equal(pending.status, "pending");
  assert.equal(pending.purchaseId, res.purchaseId);
  assert.equal((await getOccurrence(h.db, res.occurrenceId)).seatsTaken, 1);

  const paid = await fulfillPurchase(h.db, res.purchaseId, {
    sessionId: `cs_test_${nanoid()}`,
    paymentIntentId: `pi_test_${nanoid()}`,
    livemode: false,
  });
  assert.equal(paid.outcome, "fulfilled");
  assert.equal(paid.bookingConfirmed, true);
  const tickets = await ticketsOf(h.db, customerId);
  assert.equal(tickets.length, 5);
  assert.equal(tickets.filter((t) => t.status === "booked" && t.bookingId === res.bookingId).length, 1);

  // An offer of another type cannot buy this RDV.
  const otherType = await makeType(h.db, h.pro);
  const foreignOffer = await makeOffer(h.db, h.pro, otherType);
  const foreign = await bookRdv(h.db, {
    professionalId: h.pro.proId,
    ticketTypeId: s.typeId,
    startsAt: s.at(780),
    customerId,
    actorUserId: null,
    mode: "buy",
    offerId: foreignOffer,
  });
  assert.equal(codeOf(foreign), "unavailable");
});

dbTest("E4 an elapsed RDV hold frees the slot for the next client", async (h) => {
  const s = await rdvSetup(h);
  const offerId = await makeOffer(h.db, h.pro, s.typeId);
  const [a, b] = await Promise.all([makeCustomer(h.db, h.pro), makeCustomer(h.db, h.pro)]);
  const now = new Date();
  const buy = (customerId: string) =>
    ({ professionalId: h.pro.proId, ticketTypeId: s.typeId, startsAt: s.at(600), customerId, actorUserId: null, mode: "buy", offerId }) as const;

  const first = await bookRdv(h.db, buy(a), now);
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(codeOf(await bookRdv(h.db, buy(b), addMinutes(now, 10))), "slot_taken");

  const second = await bookRdv(h.db, buy(b), addMinutes(now, 46));
  assert.ok(second.ok, JSON.stringify(second));
  const old = await getOccurrence(h.db, first.occurrenceId);
  assert.equal(old.status, "cancelled");
  assert.equal(old.seatsTaken, 0);
  assert.equal((await getBooking(h.db, first.bookingId)).status, "expired");
  assert.equal((await scheduledRdvs(h)).length, 1);
});

dbTest("E4 plans in the committed time zone: a zone change between its plan and its batch is stale and writes nothing", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true });
  const customerId = await makeCustomer(h.db, h.pro);
  const res = await bookRdv(h.db, rdv(h, s.typeId, s.at(600), customerId, "free"), new Date(), {
    afterPlan: async () => {
      await h.db.update(professional).set({ timezone: "America/New_York" }).where(eq(professional.id, h.pro.proId));
    },
  });
  assert.deepEqual(res, { ok: false, code: "stale" });
  const occurrences = await h.db.select({ id: occurrence.id }).from(occurrence).where(eq(occurrence.professionalId, h.pro.proId));
  assert.equal(occurrences.length, 0, "no occurrence row");
  const bookings = await h.db.select({ id: booking.id }).from(booking).where(eq(booking.professionalId, h.pro.proId));
  assert.equal(bookings.length, 0, "no booking row");

  // a retry plans in the new zone: 10:00 in Paris is 04:00 or 05:00 in New York, outside the 08:00 to 20:00 hours
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(600), customerId, "free"))), "unavailable");
});

/* ───────────── P5 Task 4: the E4 carries and the RDV test gaps (OUT:76, OUT:120, dossier § 3.15) ───────────── */

/** Rows of a pro that a refused booking must not have written. */
async function rowCounts(db: Db, proId: string) {
  const [o, b, p] = await Promise.all([
    db.select({ id: occurrence.id }).from(occurrence).where(eq(occurrence.professionalId, proId)),
    db.select({ id: booking.id }).from(booking).where(eq(booking.professionalId, proId)),
    db.select({ id: ticketPurchase.id }).from(ticketPurchase).where(eq(ticketPurchase.professionalId, proId)),
  ]);
  return { occurrences: o.length, bookings: b.length, purchases: p.length };
}

function buyInput(h: { pro: TestPro }, typeId: string, startsAt: Date, customerId: string, offerId: string): BookRdvInput {
  return { professionalId: h.pro.proId, ticketTypeId: typeId, startsAt, customerId, actorUserId: null, mode: "buy", offerId };
}

/** Pro-made edits between E4's plan and its batch (a raw UPDATE, as another tab of the pro would commit). */
const setType = (db: Db, typeId: string, values: Partial<typeof ticketType.$inferInsert>) => async (): Promise<void> => {
  await db.update(ticketType).set(values).where(eq(ticketType.id, typeId));
};

dbTest("E4 notice and horizon: the type's overrides replace the pro's, at the plan and in the batch", async (h) => {
  const s = await rdvSetup(h, {
    rdvFree: true,
    rdvOverrides: { minNoticeMinutes: 120, bookingHorizonDays: 3, cancelDeadlineHours: null },
  });
  const customerId = await makeCustomer(h.db, h.pro);
  const startsAt = s.at(600);
  const before = await rowCounts(h.db, h.pro.proId);

  // Plan: 119 minutes ahead passes the pro's 60 but not the type's 120; 120 minutes ahead passes.
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, startsAt, customerId, "free"), addMinutes(startsAt, -119))), "unavailable");
  // Plan: a horizon of 3 local days. Four days before the start, today + 3 is the day before it: out (the pro's 60 would let it in).
  const fourDaysBefore = instantAt(addDays(s.day, -4), 600, h.pro.tz);
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, startsAt, customerId, "free"), fourDaysBefore)), "unavailable");
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before, "a refused plan writes nothing");

  // Batch: the notice raised, or the horizon lowered, after the plan → slot_taken (rdvSlotFree re-reads them), nothing written.
  const raised = await bookRdv(h.db, rdv(h, s.typeId, startsAt, customerId, "free"), addMinutes(startsAt, -180), {
    afterPlan: setType(h.db, s.typeId, { rdvMinNoticeMinutes: 240 }),
  });
  assert.equal(codeOf(raised), "slot_taken");
  await setType(h.db, s.typeId, { rdvMinNoticeMinutes: 120 })();
  const threeDaysBefore = instantAt(addDays(s.day, -3), 600, h.pro.tz);
  const lowered = await bookRdv(h.db, rdv(h, s.typeId, startsAt, customerId, "free"), threeDaysBefore, {
    afterPlan: setType(h.db, s.typeId, { rdvBookingHorizonDays: 1 }),
  });
  assert.equal(codeOf(lowered), "slot_taken");
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before, "a refused batch writes nothing");
  await setType(h.db, s.typeId, { rdvBookingHorizonDays: 3 })();

  // The boundaries the type sets: exactly 120 minutes ahead, and three local days ahead.
  const ok = await bookRdv(h.db, rdv(h, s.typeId, startsAt, customerId, "free"), addMinutes(startsAt, -120));
  assert.ok(ok.ok, JSON.stringify(ok));
  const later = await bookRdv(h.db, rdv(h, s.typeId, s.at(720), customerId, "free"), threeDaysBefore);
  assert.ok(later.ok, JSON.stringify(later));
});

dbTest("E4 batch re-asserts the type: archived or made free → unavailable, duration or a buffer changed → stale, nothing written", async (h) => {
  const free = await rdvSetup(h, { rdvFree: true });
  const paid = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const customerId = await makeCustomer(h.db, h.pro);
  await giveTickets(h.db, h.pro, customerId, paid, 1);
  const startsAt = free.at(600);
  const before = await rowCounts(h.db, h.pro.proId);
  const staged = (typeId: string, mode: "free" | "held_ticket", afterPlan: () => Promise<void>) =>
    bookRdv(h.db, rdv(h, typeId, startsAt, customerId, mode), new Date(), { afterPlan });
  const now = new Date();

  assert.equal(codeOf(await staged(free.typeId, "free", setType(h.db, free.typeId, { archivedAt: now }))), "unavailable");
  await setType(h.db, free.typeId, { archivedAt: null })();
  assert.equal(codeOf(await staged(paid, "held_ticket", setType(h.db, paid, { rdvFree: true }))), "unavailable");
  await setType(h.db, paid, { rdvFree: false })();
  assert.equal(codeOf(await staged(free.typeId, "free", setType(h.db, free.typeId, { rdvDurationMin: 30 }))), "stale");
  await setType(h.db, free.typeId, { rdvDurationMin: 60 })();
  assert.equal(codeOf(await staged(free.typeId, "free", setType(h.db, free.typeId, { rdvBufferBeforeMin: 15 }))), "stale");
  await setType(h.db, free.typeId, { rdvBufferBeforeMin: 0 })();
  assert.equal(codeOf(await staged(free.typeId, "free", setType(h.db, free.typeId, { rdvBufferAfterMin: 15 }))), "stale");
  await setType(h.db, free.typeId, { rdvBufferAfterMin: 0 })();
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before, "no occurrence, booking or purchase");
  assert.equal((await ticketsOf(h.db, customerId))[0].status, "available", "the ticket was not spent");

  // Archived AND resized at once: the type guard speaks first (unavailable, not stale).
  const both = await staged(free.typeId, "free", setType(h.db, free.typeId, { archivedAt: now, rdvDurationMin: 30 }));
  assert.equal(codeOf(both), "unavailable");
  await setType(h.db, free.typeId, { archivedAt: null, rdvDurationMin: 60 })();
  // A staged edit that changes nothing E4 planned on still books.
  const control = await staged(free.typeId, "free", setType(h.db, free.typeId, { description: "Changé entre-temps" }));
  assert.ok(control.ok, JSON.stringify(control));
});

dbTest("E4 batch re-asserts the slot: a time off or an event séance created between plan and batch → slot_taken", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true });
  const customerId = await makeCustomer(h.db, h.pro);
  const before = await rowCounts(h.db, h.pro.proId);

  const withTimeOff = await bookRdv(h.db, rdv(h, s.typeId, s.at(780), customerId, "free"), new Date(), {
    afterPlan: async () => {
      await h.db.insert(timeOff).values({ professionalId: h.pro.proId, startAt: s.at(810), endAt: s.at(900), allDay: false });
    },
  });
  assert.equal(codeOf(withTimeOff), "slot_taken");
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before);

  // makeEvent's default séance: in 3 days, 10:00 to 11:00 (a private one blocks too)
  const withSeance = await bookRdv(h.db, rdv(h, s.typeId, s.at(630), customerId, "free"), new Date(), {
    afterPlan: async () => {
      await makeEvent(h.db, h.pro, { isPrivate: true });
    },
  });
  assert.equal(codeOf(withSeance), "slot_taken");
  const rdvs = await scheduledRdvs(h);
  assert.equal(rdvs.length, 0, "no RDV occurrence");
});

dbTest("E4 per-type hours replace the global ones; loadRdvType and rdvRules are the shared readers", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true });
  const weekday = (await rdvRules(h.db, h.pro.proId, s.typeId)).length;
  assert.equal(weekday, 7, "no own rules: the seven global ones");
  const own = [{ dayOfWeek: dayOfWeek(s.day), startMinute: 840, endMinute: 960 }];
  const set = await setAvailabilityRules(h.db, { professionalId: h.pro.proId, ticketTypeId: s.typeId, rules: own });
  assert.ok(set.ok, JSON.stringify(set));
  assert.deepEqual(await rdvRules(h.db, h.pro.proId, s.typeId), own, "any own rule replaces every global one");
  const other = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  assert.equal((await rdvRules(h.db, h.pro.proId, other)).length, 7);

  const customerId = await makeCustomer(h.db, h.pro);
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(600), customerId, "free"))), "unavailable", "10:00 is outside its own 14:00 to 16:00");
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(960), customerId, "free"))), "unavailable", "16:00 would end at 17:00");
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(840), customerId, "free"))), "ok");
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, other, s.at(600), customerId, "free"))), "ok", "the other type keeps the global hours");

  const facts = await loadRdvType(h.db, h.pro.proId, s.typeId);
  assert.ok(facts);
  assert.equal(facts.rdvEnabled, true);
  assert.equal(facts.rdvFree, true);
  assert.equal(facts.durationMin, 60);
  assert.equal(facts.tz, h.pro.tz);
  assert.deepEqual(facts.window, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 });
  assert.equal(await loadRdvType(h.db, h.pro.proId, `missing_${nanoid()}`), null);
});

dbTest("E4 on a Paris DST day (spring-forward 2027-03-28): elapsed ends, a shifted start that overruns its hours is refused", async (h) => {
  const now = new Date("2027-03-24T10:00:00.000Z");
  const typeId = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const short = await makeType(h.db, h.pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const sunday = (startMinute: number, endMinute: number) => [{ dayOfWeek: 0, startMinute, endMinute }];
  assert.ok((await setAvailabilityRules(h.db, { professionalId: h.pro.proId, ticketTypeId: typeId, rules: sunday(60, 240) })).ok);
  assert.ok((await setAvailabilityRules(h.db, { professionalId: h.pro.proId, ticketTypeId: short, rules: sunday(60, 210) })).ok);
  const customerId = await makeCustomer(h.db, h.pro);
  const book = (type: string, iso: string) => bookRdv(h.db, rdv(h, type, new Date(iso), customerId, "free"), now);

  const first = await book(typeId, "2027-03-28T00:00:00.000Z"); // 01:00 CET
  assert.ok(first.ok, JSON.stringify(first));
  const o = await getOccurrence(h.db, first.occurrenceId);
  assert.equal(o.endsAt.toISOString(), "2027-03-28T01:00:00.000Z", "60 elapsed minutes (03:00 CEST on the wall)");
  // 02:00 does not exist: the grid start is 03:00 CEST = 01:00Z, it ends at 04:00 CEST, inside 01:00 to 04:00
  const shifted = await book(typeId, "2027-03-28T01:00:00.000Z");
  assert.ok(shifted.ok, JSON.stringify(shifted));
  assert.equal((await getOccurrence(h.db, shifted.occurrenceId)).endsAt.toISOString(), "2027-03-28T02:00:00.000Z");
  assert.equal(codeOf(await book(typeId, "2027-03-28T00:30:00.000Z")), "slot_taken");
  // with hours 01:00 to 03:30, the shifted start would end at 04:00 CEST
  assert.equal(codeOf(await book(short, "2027-03-28T01:00:00.000Z")), "unavailable");
});

dbTest("E4 on a Los Angeles DST day (fall-back 2026-11-01): the first 01:00 books with its elapsed end", async (h) => {
  const la = await createTestPro(h.db, { tz: "America/Los_Angeles" });
  try {
    const now = new Date("2026-10-29T17:00:00.000Z");
    const typeId = await makeType(h.db, la, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
    const rules = [{ dayOfWeek: 0, startMinute: 0, endMinute: 180 }];
    assert.ok((await setAvailabilityRules(h.db, { professionalId: la.proId, ticketTypeId: typeId, rules })).ok);
    const customerId = await makeCustomer(h.db, la);
    const book = (iso: string) =>
      bookRdv(h.db, { professionalId: la.proId, ticketTypeId: typeId, startsAt: new Date(iso), customerId, actorUserId: null, mode: "free" }, now);

    const first = await book("2026-11-01T08:00:00.000Z"); // 01:00 PDT, the first of the two
    assert.ok(first.ok, JSON.stringify(first));
    // the wall-clock end (02:00 PST) would have been 10:00Z: the engine keeps 60 elapsed minutes
    assert.equal((await getOccurrence(h.db, first.occurrenceId)).endsAt.toISOString(), "2026-11-01T09:00:00.000Z");
    const after = await book("2026-11-01T10:00:00.000Z"); // 02:00 PST
    assert.ok(after.ok, JSON.stringify(after));
    assert.equal(codeOf(await book("2026-11-01T08:30:00.000Z")), "slot_taken");
    assert.deepEqual(await checkInvariants(h.db, { proId: la.proId }), []);
  } finally {
    await deleteTestUser(h.db, la.userId);
  }
});

dbTest("E4 buffers against a time off and an event séance: touching is fine, a buffer overlap is slot_taken", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true, rdvBufferBeforeMin: 15, rdvBufferAfterMin: 15 });
  await makeEvent(h.db, h.pro, { rule: { startMinute: 720 } }); // séance 12:00 to 13:00
  await h.db.insert(timeOff).values({ professionalId: h.pro.proId, startAt: s.at(1020), endAt: s.at(1080), allDay: false }); // 17:00 to 18:00
  const customerId = await makeCustomer(h.db, h.pro);
  const book = (minute: number) => bookRdv(h.db, rdv(h, s.typeId, s.at(minute), customerId, "free"));

  // The RDV alone would only touch; its buffers reach into the séance or the time off.
  assert.equal(codeOf(await book(660)), "slot_taken", "11:00 to 12:00, after-buffer into the séance");
  assert.equal(codeOf(await book(960)), "slot_taken", "16:00 to 17:00, after-buffer into the time off");
  assert.equal(codeOf(await book(1080)), "slot_taken", "18:00 to 19:00, before-buffer into the time off");
  // Blocks that only touch them are fine.
  assert.equal(codeOf(await book(795)), "ok", "13:15: its block starts at 13:00");
  assert.equal(codeOf(await book(945)), "ok", "15:45: its block ends at 17:00");
  assert.equal(codeOf(await book(1095)), "ok", "18:15: its block starts at 18:00");
});

dbTest("E4 buy: Checkout facts are the guarded snapshot; too_many_holds, offer_too_short, a changed price (stale), a type made free (unavailable first)", async (h) => {
  const s = await rdvSetup(h);
  const offerId = await makeOffer(h.db, h.pro, s.typeId, { quantity: 3, priceCents: 6000, label: "Trio" });
  const [c1, c2, c3, c4] = await Promise.all([1, 2, 3, 4].map(() => makeCustomer(h.db, h.pro)));
  const now = new Date();

  const first = await bookRdv(h.db, buyInput(h, s.typeId, s.at(600), c1, offerId), now);
  assert.ok(first.ok, JSON.stringify(first));
  const [purchase] = await h.db.select().from(ticketPurchase).where(eq(ticketPurchase.id, first.purchaseId ?? ""));
  const [type] = await h.db.select({ name: ticketType.name }).from(ticketType).where(eq(ticketType.id, s.typeId));
  assert.deepEqual(first.checkout, { currency: "eur", label: "Trio", quantity: 3, ticketTypeName: type.name });
  assert.deepEqual(
    { currency: purchase.currency, label: purchase.label, quantity: purchase.quantity, amountCents: purchase.amountCents },
    { currency: first.checkout?.currency, label: first.checkout?.label, quantity: first.checkout?.quantity, amountCents: first.amountCents },
    "the Checkout request and the purchase row say the same",
  );

  // too_many_holds: the third live hold of one customer
  assert.ok((await bookRdv(h.db, buyInput(h, s.typeId, s.at(720), c1, offerId), now)).ok);
  let before = await rowCounts(h.db, h.pro.proId);
  assert.equal(codeOf(await bookRdv(h.db, buyInput(h, s.typeId, s.at(840), c1, offerId), now)), "too_many_holds");
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before);

  // offer_too_short: a one-day validity does not cover a start in three days
  const short = await makeOffer(h.db, h.pro, s.typeId, { validityCount: 1, validityUnit: "day" });
  assert.equal(codeOf(await bookRdv(h.db, buyInput(h, s.typeId, s.at(840), c2, short), now)), "offer_too_short");

  // stale: the price changed between plan and batch
  before = await rowCounts(h.db, h.pro.proId);
  const repriced = await bookRdv(h.db, buyInput(h, s.typeId, s.at(840), c3, offerId), now, {
    afterPlan: async () => {
      await h.db.update(ticketOffer).set({ priceCents: 6500 }).where(eq(ticketOffer.id, offerId));
    },
  });
  assert.equal(codeOf(repriced), "stale");
  await h.db.update(ticketOffer).set({ priceCents: 6000 }).where(eq(ticketOffer.id, offerId));

  // the type switched to « Gratuit » between plan and batch: rdvTypeOk (unavailable) speaks before offerUnchanged (stale)
  const madeFree = await bookRdv(h.db, buyInput(h, s.typeId, s.at(840), c4, offerId), now, { afterPlan: setType(h.db, s.typeId, { rdvFree: true }) });
  assert.equal(codeOf(madeFree), "unavailable");
  await setType(h.db, s.typeId, { rdvFree: false })();
  assert.deepEqual(await rowCounts(h.db, h.pro.proId), before, "neither refusal wrote a row");
});

dbTest("E4 second pro: a foreign type, customer or offer is not_found; its RDVs, séances and time off never block this pro", async (h) => {
  const s = await rdvSetup(h, { rdvFree: true });
  const customerId = await makeCustomer(h.db, h.pro);
  const other = await createTestPro(h.db);
  try {
    const theirType = await makeType(h.db, other, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
    const theirPaid = await makeType(h.db, other, { rdvEnabled: true, rdvDurationMin: 60 });
    const theirOffer = await makeOffer(h.db, other, theirPaid);
    const theirCustomer = await makeCustomer(h.db, other);
    const allWeek = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
    assert.ok((await setAvailabilityRules(h.db, { professionalId: other.proId, ticketTypeId: null, rules: allWeek })).ok);
    const before = await rowCounts(h.db, h.pro.proId);

    assert.equal(codeOf(await bookRdv(h.db, rdv(h, theirType, s.at(600), customerId, "free"))), "not_found", "their type");
    assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(600), theirCustomer, "free"))), "not_found", "their customer");
    const paid = await makeType(h.db, h.pro, { rdvEnabled: true, rdvDurationMin: 60 });
    assert.equal(codeOf(await bookRdv(h.db, buyInput(h, paid, s.at(600), customerId, theirOffer))), "not_found", "their offer");
    assert.deepEqual(await rowCounts(h.db, h.pro.proId), before);
    assert.equal(await loadRdvType(h.db, h.pro.proId, theirType), null);

    // Their RDV, séance and time off at the very same instants.
    const theirs = await bookRdv(h.db, {
      professionalId: other.proId,
      ticketTypeId: theirType,
      startsAt: s.at(600),
      customerId: theirCustomer,
      actorUserId: null,
      mode: "free",
    });
    assert.ok(theirs.ok, JSON.stringify(theirs));
    await makeEvent(h.db, other, { rule: { startDate: s.day, startMinute: 720 } });
    await h.db.insert(timeOff).values({ professionalId: other.proId, startAt: s.at(840), endAt: s.at(900), allDay: false });
    for (const minute of [600, 720, 840]) {
      assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(minute), customerId, "free"))), "ok", `${minute}`);
    }
    assert.deepEqual(await checkInvariants(h.db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});
