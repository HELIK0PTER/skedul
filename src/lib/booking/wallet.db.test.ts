import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { addMinutes, dbTest, inParallel } from "../../test/db";
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
import type { TicketCloseReason } from "../tickets";
import { cancelByClient } from "./cancel";
import { setTicketTypeArchived } from "./catalog";
import { bookWithHeldTicket } from "./claims";
import { fulfillPurchase, startPurchase } from "./fulfillment";
import {
  closeTickets,
  convertTickets,
  loadTypeFacts,
  moveAttendee,
  pointTickets,
  unpointTickets,
  walletBalance,
} from "./wallet";

type Outcome = { ok: boolean; code?: string };

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

const label = (s: PromiseSettledResult<Outcome>): string =>
  s.status === "rejected" ? `threw: ${String(s.reason)}` : s.value.ok ? "ok" : String(s.value.code);

dbTest("T9a: convert and spend race for the last ticket: exactly one takes effect", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA] });
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeA, 1);

  const settled = await inParallel<Outcome>([
    () =>
      convertTickets(db, {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        customerId,
        selection: { ticketTypeId: typeA, quantity: 1 },
        toTicketTypeId: typeB,
      }),
    () => bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null }),
  ]);
  const [conv, spend] = settled.map(label);
  assert.ok((conv === "ok" && spend === "no_ticket") || (conv === "no_ticket" && spend === "ok"), `${conv} / ${spend}`);
  const kinds = (await movementsOf(db, ticketId)).map((m) => m.kind);
  assert.equal(kinds.filter((k) => k === "convert" || k === "spend").length, 1, kinds.join());
  const [t] = await ticketsOf(db, customerId);
  if (conv === "ok") {
    assert.equal(t.ticketTypeId, typeB);
    assert.equal(t.status, "available");
    assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 0);
  } else {
    assert.equal(t.ticketTypeId, typeA);
    assert.equal(t.status, "booked");
  }
});

dbTest("T9b: two identical converts at once: one converts, the other finds no ticket", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeA, 1);
  const convert = () =>
    convertTickets(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      customerId,
      selection: { ticketTypeId: typeA, quantity: 1 },
      toTicketTypeId: typeB,
    });
  const outcomes = (await inParallel<Outcome>([convert, convert])).map(label).sort();
  assert.deepEqual(outcomes, ["no_ticket", "ok"]);
  const moves = await movementsOf(db, ticketId);
  assert.equal(moves.filter((m) => m.kind === "convert").length, 1);
  const res = await db.execute<{ from_ticket_type_id: string; ticket_type_id: string }>(
    sql`select from_ticket_type_id, ticket_type_id from ticket_movement where ticket_id = ${ticketId} and kind = 'convert'`,
  );
  assert.deepEqual(res.rows[0], { from_ticket_type_id: typeA, ticket_type_id: typeB });
});

dbTest("T9c: a paid ticket cannot be « retiré »; it can be closed with a reason", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeA);
  const customerId = await makeCustomer(db, pro);
  const purchase = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  must(purchase, "startPurchase");
  const paid = await fulfillPurchase(db, purchase.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false });
  assert.equal(paid.outcome, "fulfilled");
  const [paidId] = paid.ticketIds;
  const [offeredId] = await giveTickets(db, pro, customerId, typeA, 1);

  const retirePaid = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketIds: [paidId] },
    reason: "retire",
  });
  assert.equal(retirePaid.ok ? "ok" : retirePaid.code, "retire_paid");

  const retireByType = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketTypeId: typeA, quantity: 1 },
    reason: "retire",
  });
  must(retireByType, "retire by type");
  assert.deepEqual(retireByType.ticketIds, [offeredId]);
  const none = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketTypeId: typeA, quantity: 1 },
    reason: "retire",
  });
  assert.equal(none.ok ? "ok" : none.code, "no_ticket");

  const noNote = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketIds: [paidId] },
    reason: "autre",
  });
  assert.equal(noNote.ok ? "ok" : noNote.code, "invalid");
  must(
    await closeTickets(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      customerId,
      selection: { ticketIds: [paidId] },
      reason: "rembourse",
      note: "Remboursé en espèces",
    }),
    "close paid",
  );
  const closed = (await ticketsOf(db, customerId)).find((t) => t.id === paidId);
  assert.equal(closed?.status, "closed");
  assert.equal(closed?.closedReason, "rembourse");
  assert.equal(closed?.closedNote, "Remboursé en espèces");
  const kinds = (await movementsOf(db, paidId)).map((m) => `${m.kind}:${m.toStatus}`);
  assert.deepEqual(kinds, ["purchase:available", "close:closed"]);
});

dbTest("Clore: a ticket past expires_at that the sweep has not flipped is skipped, like convert and point", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const now = new Date();
  const [unswept] = await giveTickets(db, pro, customerId, typeA, 1, {
    now: addMinutes(now, -3 * 24 * 60),
    expiresAt: addMinutes(now, -24 * 60),
  });
  const [valid] = await giveTickets(db, pro, customerId, typeA, 1);
  const usable = async () => (await walletBalance(db, { professionalId: pro.proId, customerId })).find((b) => b.ticketTypeId === typeA)?.usable ?? 0;
  assert.equal(await usable(), 1, "only the valid ticket is usable");
  assert.equal((await ticketsOf(db, customerId)).find((t) => t.id === unswept)?.status, "available", "not swept yet");

  // Offered tickets: « autre » (rembourse / compense close paid tickets only, SPE2).
  const closed = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketTypeId: typeA, quantity: 1 },
    reason: "autre",
    note: "Geste commercial",
  });
  must(closed, "close by type");
  assert.deepEqual(closed.ticketIds, [valid], "the valid ticket is closed, not the one past its expiry");
  assert.equal(await usable(), 0, "the balance dropped by one");
  const after = await ticketsOf(db, customerId);
  assert.equal(after.find((t) => t.id === unswept)?.status, "available");
  assert.equal(after.find((t) => t.id === valid)?.status, "closed");

  const explicit = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketIds: [unswept] },
    reason: "autre",
    note: "Geste commercial",
  });
  assert.equal(explicit.ok ? "ok" : explicit.code, "no_ticket", "an explicit id past its expiry is not closed either");
});

dbTest("Clore (SPE2): « remboursé » / « compensé » close a paid ticket, never an offered one", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeA);
  const customerId = await makeCustomer(db, pro);
  const purchase = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  must(purchase, "startPurchase");
  const paid = await fulfillPurchase(db, purchase.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false });
  assert.equal(paid.outcome, "fulfilled");
  const [paidId] = paid.ticketIds;
  // The gift expires first, so the consumption order alone would pick it.
  const [offeredId] = await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: addMinutes(new Date(), 30 * 24 * 60) });
  const close = (selection: { ticketIds: string[] } | { ticketTypeId: string; quantity: number }, reason: TicketCloseReason) =>
    closeTickets(db, { professionalId: pro.proId, actorUserId: pro.userId, customerId, selection, reason, note: "Remboursé en espèces" });

  const refunded = await close({ ticketTypeId: typeA, quantity: 1 }, "rembourse");
  must(refunded, "close 1 by type, rembourse");
  assert.deepEqual(refunded.ticketIds, [paidId]);
  const rows = new Map((await ticketsOf(db, customerId)).map((t) => [t.id, t]));
  assert.deepEqual([rows.get(paidId)?.status, rows.get(paidId)?.closedReason], ["closed", "rembourse"]);
  assert.equal(rows.get(offeredId)?.status, "available", "the gift stays usable");

  const explicit = await close({ ticketIds: [offeredId] }, "compense");
  assert.deepEqual(explicit.ok ? "ok" : [explicit.code, explicit.message], ["invalid", "Un ticket offert se retire."]);
  const noPaidLeft = await close({ ticketTypeId: typeA, quantity: 1 }, "compense");
  assert.equal(noPaidLeft.ok ? "ok" : noPaidLeft.code, "no_ticket");
  assert.equal((await ticketsOf(db, customerId)).find((t) => t.id === offeredId)?.status, "available");

  // « autre » and « Retirer » still take the gift.
  const other = await close({ ticketIds: [offeredId] }, "autre");
  must(other, "close the gift with autre");
  assert.deepEqual(other.ticketIds, [offeredId]);
});

dbTest("Clore: an unknown reason is invalid, never a database error", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeA, 1);
  const res = await closeTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketIds: [ticketId] },
    reason: "bogus" as unknown as TicketCloseReason,
    note: "x",
  });
  assert.equal(res.ok ? "ok" : res.code, "invalid");
  assert.equal((await ticketsOf(db, customerId))[0]?.status, "available");
});

dbTest("Pointer / annuler le pointage: available ↔ used, an expired ticket goes back to expired", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const now = new Date();
  await giveTickets(db, pro, customerId, typeA, 1);
  const [shortLived] = await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: addMinutes(now, 60) });

  const pointed = await pointTickets(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, customerId, selection: { ticketTypeId: typeA, quantity: 1 }, note: "Cours rattrapé au parc" },
    now,
  );
  must(pointed, "point");
  assert.deepEqual(pointed.ticketIds, [shortLived], "the ticket expiring first is used first");
  const reason = await db.execute<{ reason: string | null }>(
    sql`select reason from ticket_movement where ticket_id = ${shortLived} and kind = 'pointage'`,
  );
  assert.equal(reason.rows[0]?.reason, "Cours rattrapé au parc");

  const later = addMinutes(now, 120);
  const unpointed = await unpointTickets(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, customerId, selection: { ticketTypeId: typeA, quantity: 1 } },
    later,
  );
  must(unpointed, "unpoint");
  const t = (await ticketsOf(db, customerId)).find((x) => x.id === shortLived);
  assert.equal(t?.status, "expired");
  const last = (await movementsOf(db, shortLived)).at(-1);
  assert.equal(last?.kind, "unpoint");
  assert.equal(last?.toStatus, "expired");

  const nothing = await unpointTickets(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    customerId,
    selection: { ticketTypeId: typeA, quantity: 1 },
  });
  assert.equal(nothing.ok ? "ok" : nothing.code, "no_ticket");
});

dbTest("Déplacer un inscrit: eligibility, expiry (force) and seats on both séances", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const day3 = dayIn(pro, 3);
  const day5 = dayIn(pro, 5);
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: day3 } });
  const {
    occurrences: [sameType],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: day5 } });
  const {
    occurrences: [otherType],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeB], rule: { startDate: day5, startMinute: 840 } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: instantAt(dayIn(pro, 4), 0, pro.tz) });
  const b = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: src.id, customerId, seenStartsAt: src.startsAt, actorUserId: null });
  must(b, "book");
  const move = (targetOccurrenceId: string, force: boolean) =>
    moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b.bookingId, targetOccurrenceId, force });

  const wrongType = await move(otherType.id, true);
  assert.equal(wrongType.ok ? "ok" : wrongType.code, "not_eligible");
  const expires = await move(sameType.id, false);
  assert.equal(expires.ok ? "ok" : expires.code, "ticket_expires_before");

  const now = new Date();
  const res = await moveAttendee(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b.bookingId, targetOccurrenceId: sameType.id, force: true },
    now,
  );
  must(res, "forced move");
  assert.equal(res.fromOccurrenceId, src.id);
  assert.deepEqual(res.effects, [
    { type: "email.attendee_moved", bookingId: b.bookingId, fromOccurrenceId: src.id },
    { type: "google.sync_occurrence", occurrenceId: src.id },
    { type: "google.sync_occurrence", occurrenceId: sameType.id },
  ]);
  const moved = await getBooking(db, b.bookingId);
  assert.equal(moved.occurrenceId, sameType.id);
  assert.equal(moved.movedAt?.getTime(), now.getTime());
  assert.equal((await getOccurrence(db, src.id)).seatsTaken, 0);
  assert.equal((await getOccurrence(db, sameType.id)).seatsTaken, 1);
});

dbTest("Déplacer un inscrit: a full target is `full`, a target already booked by the client is `already_booked`", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3) } });
  const {
    occurrences: [full],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], capacity: 1, rule: { startDate: dayIn(pro, 4) } });
  const {
    occurrences: [twice],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 5) } });
  const c1 = await makeCustomer(db, pro);
  const c2 = await makeCustomer(db, pro);
  await giveTickets(db, pro, c1, typeA, 2);
  await giveTickets(db, pro, c2, typeA, 1);
  const book = async (customerId: string, o: { id: string; startsAt: Date }) => {
    const r = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: o.id, customerId, seenStartsAt: o.startsAt, actorUserId: null });
    must(r, "book");
    return r.bookingId;
  };
  const b1 = await book(c1, src);
  await book(c1, twice);
  await book(c2, full);

  const toFull = await moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b1, targetOccurrenceId: full.id, force: false });
  assert.equal(toFull.ok ? "ok" : toFull.code, "full");
  const toTwice = await moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b1, targetOccurrenceId: twice.id, force: false });
  assert.equal(toTwice.ok ? "ok" : toTwice.code, "already_booked");
  assert.equal((await getBooking(db, b1)).occurrenceId, src.id);
  assert.equal((await getOccurrence(db, src.id)).seatsTaken, 1);
});

/* Ledger ruling (Task 20): the same customer on a FULL target is « already_booked », never
   « full ». assertNotBooked sits between R and SEAT(target, +1). */
dbTest("Déplacer un inscrit: a full target the client already holds is `already_booked`, not `full`", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3) } });
  const {
    occurrences: [full],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], capacity: 1, rule: { startDate: dayIn(pro, 4) } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeA, 2);
  const book = async (o: { id: string; startsAt: Date }) => {
    const r = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: o.id, customerId, seenStartsAt: o.startsAt, actorUserId: null });
    must(r, "book");
    return r.bookingId;
  };
  const onSrc = await book(src);
  await book(full);
  assert.equal((await getOccurrence(db, full.id)).seatsTaken, 1, "the target is full with the client's own seat");

  const res = await moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: onSrc, targetOccurrenceId: full.id, force: false });
  assert.equal(res.ok ? "ok" : res.code, "already_booked");
  assert.equal((await getBooking(db, onSrc)).occurrenceId, src.id);
  assert.equal((await getOccurrence(db, src.id)).seatsTaken, 1);
  assert.equal((await getOccurrence(db, full.id)).seatsTaken, 1);
});

dbTest("Déplacer + convertir (SPE1): the booked ticket takes a type the target accepts, in the same action", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const archived = await makeType(db, pro);
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3) } });
  const {
    occurrences: [tgt],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeB], rule: { startDate: dayIn(pro, 5) } });
  const customerId = await makeCustomer(db, pro);
  const [bookedTicket] = await giveTickets(db, pro, customerId, typeA, 1);
  const b = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: src.id, customerId, seenStartsAt: src.startsAt, actorUserId: null });
  must(b, "book");
  const [spare] = await giveTickets(db, pro, customerId, typeA, 1);
  const now = new Date();
  const move = (convertToTicketTypeId?: string) =>
    moveAttendee(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b.bookingId, targetOccurrenceId: tgt.id, force: false, convertToTicketTypeId },
      now,
    );

  // Without the option the target still refuses the type; an archived or the same type is refused before any write.
  assert.equal(((r) => (r.ok ? "ok" : r.code))(await move()), "not_eligible");
  assert.equal(((r) => (r.ok ? "ok" : r.code))(await move(archived)), "not_found");
  assert.equal(((r) => (r.ok ? "ok" : r.code))(await move(typeA)), "invalid");
  assert.equal((await getBooking(db, b.bookingId)).occurrenceId, src.id);

  const res = await move(typeB);
  must(res, "move + convert");
  assert.deepEqual(res.conversion, { ticketId: bookedTicket, fromTicketTypeId: typeA, toTicketTypeId: typeB });
  const moved = await getBooking(db, b.bookingId);
  assert.equal(moved.occurrenceId, tgt.id);
  assert.equal(moved.movedAt?.getTime(), now.getTime());
  assert.equal((await getOccurrence(db, src.id)).seatsTaken, 0);
  assert.equal((await getOccurrence(db, tgt.id)).seatsTaken, 1);

  const tickets = new Map((await ticketsOf(db, customerId)).map((t) => [t.id, t]));
  assert.deepEqual(
    [tickets.get(bookedTicket)?.status, tickets.get(bookedTicket)?.ticketTypeId, tickets.get(bookedTicket)?.bookingId],
    ["booked", typeB, b.bookingId],
  );
  assert.deepEqual([tickets.get(spare)?.status, tickets.get(spare)?.ticketTypeId], ["available", typeA], "the spare ticket is untouched");
  const converts = await db.execute<{
    from_status: string;
    to_status: string;
    ticket_type_id: string;
    from_ticket_type_id: string;
    booking_id: string | null;
    purchase_id: string | null;
    actor: string;
    actor_user_id: string | null;
  }>(sql`select from_status, to_status, ticket_type_id, from_ticket_type_id, booking_id, purchase_id, actor, actor_user_id
    from ticket_movement where ticket_id = ${bookedTicket} and kind = 'convert'`);
  assert.deepEqual(converts.rows, [
    {
      from_status: "booked",
      to_status: "booked",
      ticket_type_id: typeB,
      from_ticket_type_id: typeA,
      booking_id: b.bookingId,
      purchase_id: null,
      actor: "pro",
      actor_user_id: pro.userId,
    },
  ]);
  assert.equal((await movementsOf(db, spare)).length, 1, "only the spare's offer movement");
});

dbTest("Déplacer + convertir (SPE1): a target type archived between the plan and the batch is stale, nothing moves", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3) } });
  const {
    occurrences: [tgt],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeB], rule: { startDate: dayIn(pro, 5) } });
  const customerId = await makeCustomer(db, pro);
  const [bookedTicket] = await giveTickets(db, pro, customerId, typeA, 1);
  const b = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: src.id, customerId, seenStartsAt: src.startsAt, actorUserId: null });
  must(b, "book");

  const res = await moveAttendee(
    db,
    { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b.bookingId, targetOccurrenceId: tgt.id, force: false, convertToTicketTypeId: typeB },
    new Date(),
    {
      afterPlan: async () => {
        must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: typeB, archived: true }), "archive inside afterPlan");
      },
    },
  );
  assert.equal(res.ok ? "ok" : res.code, "stale");
  assert.equal((await getBooking(db, b.bookingId)).occurrenceId, src.id);
  const [t] = await ticketsOf(db, customerId);
  assert.deepEqual([t.id, t.status, t.ticketTypeId], [bookedTicket, "booked", typeA]);
  assert.equal((await getOccurrence(db, tgt.id)).seatsTaken, 0);
});

dbTest("loadTypeFacts: archived, RDV, linked to an upcoming séance, orphan", async ({ db, pro }) => {
  const linked = await makeType(db, pro);
  const rdv = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const orphan = await makeType(db, pro);
  const archived = await makeType(db, pro);
  await makeEvent(db, pro, { ticketTypeIds: [linked, archived] });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");

  const facts = new Map((await loadTypeFacts(db, pro.proId)).map((f) => [f.ticketTypeId, f]));
  assert.deepEqual(facts.get(linked), { ticketTypeId: linked, archived: false, rdvEnabled: false, linkedToUpcomingEvent: true });
  assert.deepEqual(facts.get(rdv), { ticketTypeId: rdv, archived: false, rdvEnabled: true, linkedToUpcomingEvent: false });
  assert.deepEqual(facts.get(orphan), { ticketTypeId: orphan, archived: false, rdvEnabled: false, linkedToUpcomingEvent: false });
  assert.equal(facts.get(archived)?.archived, true);
});

dbTest("E5 after « Déplacer »: a moved client may cancel until the start of the new séance", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const {
    occurrences: [src],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3) } });
  const {
    occurrences: [dst],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 5) } });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeA, 1);
  const b = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: src.id, customerId, seenStartsAt: src.startsAt, actorUserId: null });
  must(b, "book");
  must(
    await moveAttendee(db, { professionalId: pro.proId, actorUserId: pro.userId, bookingId: b.bookingId, targetOccurrenceId: dst.id, force: false }),
    "move",
  );
  const res = await cancelByClient(
    db,
    { professionalId: pro.proId, customerId, bookingId: b.bookingId, actorUserId: null },
    addMinutes(dst.startsAt, -23 * 60),
  );
  must(res, "late cancel after a move");
  assert.equal(res.occurrenceId, dst.id);
  assert.equal((await getOccurrence(db, dst.id)).seatsTaken, 0);
});
