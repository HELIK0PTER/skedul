import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setAvailabilityRules, setTicketTypeArchived } from "@/lib/booking/catalog";
import { bookRdv, type BookRdvInput } from "@/lib/booking/claims";
import { fulfillPurchase } from "@/lib/booking/fulfillment";
import { instantAt } from "@/lib/civil-date";
import { occurrence, timeOff } from "@/lib/db/schema";
import type { TicketTypeInput } from "@/lib/tickets";
import { addMinutes, dbTest, inParallel, type DbHarness } from "@/test/db";
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

/** Global hours 08:00–20:00 every day; an RDV type; `at(minute)` = that minute on the day in 3 days (Paris). */
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
  // makeEvent default: once, in 3 days, 10:00–11:00 (Paris), private séances block too.
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
  // 11:00 → block 10:45–12:15 overlaps 09:45–11:15 (EXCLUDE).
  assert.equal(codeOf(await bookRdv(h.db, rdv(h, s.typeId, s.at(660), b, "free"))), "slot_taken");
  // 11:30 → block 11:15–12:45 only touches it.
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
  // 20:00 is outside the 08:00–20:00 hours (the 15 min would end at 20:15).
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
