import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { deleteOffer, setAvailabilityRules, setTicketTypeArchived, setTypeQuestions } from "@/lib/booking/catalog";
import { bookWithHeldTicket } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { editSeriesFrom } from "@/lib/booking/series";
import { closeTickets, convertTickets, pointTickets } from "@/lib/booking/wallet";
import type { Db } from "@/lib/db/atomic";
import type { RecurrenceRuleInput } from "@/lib/tickets";
import { addDaysMs, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { rowRdv } from "@/test/rows";

import { getTicketTypeDetail, listActiveTypeOptions, listTicketTypes, type TicketTypeSummary } from "./catalog-reads";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

function found<T>(value: T | undefined | null, what: string): T {
  assert.ok(value, what);
  return value;
}

const weekly = (startDate: string, weekdays: number[], startMinute = 600): RecurrenceRuleInput => ({
  startDate,
  startMinute,
  freq: "weekly",
  interval: 1,
  weekdays,
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
});

/** A paid purchase through the engine: startPurchase + fulfillPurchase. */
async function buy(db: Db, pro: TestPro, offerId: string, customerId: string): Promise<void> {
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  must(started, "startPurchase");
  const done = await fulfillPurchase(db, started.purchaseId, {
    sessionId: `cs_test_${nanoid()}`,
    paymentIntentId: `pi_test_${nanoid()}`,
    livemode: false,
  });
  must(done, "fulfillPurchase");
}

async function summaryOf(db: Db, pro: TestPro, ticketTypeId: string, now = new Date()): Promise<TicketTypeSummary> {
  const { active, archived } = await listTicketTypes(db, pro.proId, now);
  return found([...active, ...archived].find((t) => t.id === ticketTypeId), `type ${ticketTypeId} in the list`);
}

dbTest("catalog reads: types come back by position, then createdAt, then id, split active / archived", async ({ db, pro }) => {
  const a = await makeType(db, pro, { name: "A" });
  const b = await makeType(db, pro, { name: "B" });
  const c = await makeType(db, pro, { name: "C" });
  const d = await makeType(db, pro, { name: "D" });
  await db.execute(sql`update ticket_type set position = 5, created_at = '2026-01-02T00:00:00Z' where id = ${a}`);
  await db.execute(sql`update ticket_type set position = 5, created_at = '2026-01-01T00:00:00Z' where id = ${b}`);
  await db.execute(sql`update ticket_type set position = 1 where id = ${c}`);
  await db.execute(sql`update ticket_type set position = 9 where id = ${d}`);
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: d, archived: true }), "archive D");

  const res = await listTicketTypes(db, pro.proId, new Date());
  assert.deepEqual(res.active.map((t) => t.id), [c, b, a], "position, then createdAt");
  assert.deepEqual(res.archived.map((t) => [t.id, t.archived]), [[d, true]]);
  assert.deepEqual(res.active.map((t) => t.name), ["C", "B", "A"]);

  // Same position and same createdAt: the id decides (concurrent creates share a position).
  await db.execute(sql`update ticket_type set position = 5, created_at = '2026-01-01T00:00:00Z' where id in (${a}, ${b})`);
  const tied = await listTicketTypes(db, pro.proId, new Date());
  assert.deepEqual(tied.active.map((t) => t.id), [c, ...[a, b].sort()]);
});

dbTest("catalog reads: offers carry label, validity text and paid sales; archived offers leave the list", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const unit = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 2500 });
  const book = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const custom = await makeOffer(db, pro, typeId, {
    quantity: 10,
    priceCents: 19000,
    label: "Gros carnet",
    validityCount: 30,
    validityUnit: "day",
    isActive: false,
  });
  const gone = await makeOffer(db, pro, typeId, { quantity: 2, priceCents: 4000 });
  const customerId = await makeCustomer(db, pro);

  await buy(db, pro, book, customerId);
  await buy(db, pro, book, customerId);
  // A pending purchase is not a sale.
  must(await startPurchase(db, { professionalId: pro.proId, offerId: unit, customerId }), "pending purchase");
  // A bought offer is archived by « Supprimer »: it leaves the list.
  await buy(db, pro, gone, customerId);
  const deleted = await deleteOffer(db, { professionalId: pro.proId, offerId: gone });
  must(deleted, "deleteOffer");
  assert.equal(deleted.outcome, "archived");

  const type = await summaryOf(db, pro, typeId);
  assert.deepEqual(
    type.offers.map((o) => [o.id, o.label, o.customLabel, o.quantity, o.priceCents, o.validityCount, o.validityUnit, o.validityText, o.isActive, o.archived, o.sold]),
    [
      [unit, "À l'unité", null, 1, 2500, null, null, null, true, false, 0],
      [book, "Carnet de 4", null, 4, 8500, 3, "month", "3 mois", true, false, 2],
      [custom, "Gros carnet", "Gros carnet", 10, 19000, 30, "day", "30 jours", false, false, 0],
    ],
  );
  assert.ok(type.offers.every((o) => o.ticketTypeId === typeId));

  const detail = found(await getTicketTypeDetail(db, pro.proId, typeId, new Date()), "detail");
  assert.deepEqual(detail.offers.map((o) => o.id), [unit, book, custom]);
  assert.deepEqual(detail.archivedOffers.map((o) => [o.id, o.archived, o.sold]), [[gone, true, 1]]);
});

dbTest("catalog reads: acceptedBy lists one entry per series root (its latest segment), by title", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const otherType = await makeType(db, pro);
  const debutants = (await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] })).eventId;
  const equipe = (await makeEvent(db, pro, { title: "Équipe compétition", isPrivate: true, ticketTypeIds: [typeId] })).eventId;
  const atelier = (await makeEvent(db, pro, { title: "Atelier technique", ticketTypeIds: [typeId] })).eventId;
  await makeEvent(db, pro, { title: "Roda libre", ticketTypeIds: [otherType] });
  const archivedEvent = (await makeEvent(db, pro, { title: "Ancien cours", ticketTypeIds: [typeId] })).eventId;
  await db.execute(sql`update event set archived_at = now() where id = ${archivedEvent}`);

  // A weekly series started two weeks ago and edited « à partir de demain »: two segments, one entry.
  const seriesStart = (
    await makeEvent(db, pro, { title: "Altinha intermédiaires", ticketTypeIds: [typeId], rule: weekly(dayIn(pro, -14, now), [1, 3, 5]) }, addDaysMs(now, -14))
  ).eventId;
  const split = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId: seriesStart,
      seenVersion: 1,
      fromDate: dayIn(pro, 1, now),
      rule: weekly(dayIn(pro, 1, now), [1, 3]),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(split, "split the series");
  assert.notEqual(split.eventId, seriesStart, "a new segment was created");

  const type = await summaryOf(db, pro, typeId, now);
  assert.deepEqual(type.acceptedBy, [
    { eventId: debutants, title: "Altinha débutants", isPrivate: false },
    { eventId: split.eventId, title: "Altinha intermédiaires", isPrivate: false },
    { eventId: atelier, title: "Atelier technique", isPrivate: false },
    { eventId: equipe, title: "Équipe compétition", isPrivate: true },
  ]);
  const detail = found(await getTicketTypeDetail(db, pro.proId, typeId, now), "detail");
  assert.deepEqual(detail.acceptedBy, type.acceptedBy);
  assert.deepEqual((await summaryOf(db, pro, otherType, now)).acceptedBy.map((e) => e.title), ["Roda libre"]);
});

dbTest("catalog reads: acceptedBy lists tickets-mode events only, like the orange alert does", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const onlyFree = await makeType(db, pro, { name: "Lié à un événement libre" });
  const cours = (await makeEvent(db, pro, { title: "Cours payant", ticketTypeIds: [typeId] })).eventId;
  await makeEvent(db, pro, { title: "Roda libre", bookingMode: "free", ticketTypeIds: [typeId, onlyFree] });
  await makeEvent(db, pro, { title: "Stage sans réservation", bookingMode: "none", ticketTypeIds: [typeId] });

  // A series whose latest segment switched to « free »: the older tickets-mode segment does not come back.
  const seriesStart = (
    await makeEvent(db, pro, { title: "Altinha intermédiaires", ticketTypeIds: [typeId], rule: weekly(dayIn(pro, -14, now), [1, 3, 5]) }, addDaysMs(now, -14))
  ).eventId;
  const split = await editSeriesFrom(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      eventId: seriesStart,
      seenVersion: 1,
      fromDate: dayIn(pro, 1, now),
      rule: weekly(dayIn(pro, 1, now), [1, 3]),
      durationMin: 60,
      orphans: "keep",
    },
    now,
  );
  must(split, "split the series");
  assert.notEqual(split.eventId, seriesStart, "a new segment was created");
  assert.ok(
    (await summaryOf(db, pro, typeId, now)).acceptedBy.some((e) => e.eventId === split.eventId),
    "while the latest segment is in tickets mode, the series is listed",
  );
  await db.execute(sql`update event set booking_mode = 'free' where id = ${split.eventId}`);

  const type = await summaryOf(db, pro, typeId, now);
  assert.deepEqual(type.acceptedBy, [{ eventId: cours, title: "Cours payant", isPrivate: false }]);
  assert.equal(type.orphan, false, "linked to a future tickets-mode event");

  // Only linked to a free-mode event: nothing accepts it, and the card says so on both sides.
  const freeOnly = await summaryOf(db, pro, onlyFree, now);
  assert.deepEqual(freeOnly.acceptedBy, []);
  assert.equal(freeOnly.orphan, true);
  const detail = found(await getTicketTypeDetail(db, pro.proId, typeId, now), "detail");
  assert.deepEqual(detail.acceptedBy, type.acceptedBy);
});

dbTest("catalog reads: usableTickets counts available, unexpired tickets of every customer", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const first = await makeCustomer(db, pro);
  const second = await makeCustomer(db, pro);
  await giveTickets(db, pro, first, typeId, 2);
  await giveTickets(db, pro, second, typeId, 1, { expiresAt: addDaysMs(now, 10) });

  assert.equal((await summaryOf(db, pro, typeId, now)).usableTickets, 3);
  assert.equal((await summaryOf(db, pro, typeId, addDaysMs(now, 20))).usableTickets, 2, "the expired ticket no longer counts");
  assert.equal((await summaryOf(db, pro, await makeType(db, pro), now)).usableTickets, 0);
});

dbTest("catalog reads: usableTickets ignores booked, used and closed tickets", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const [pointedId, closedId] = await giveTickets(db, pro, customerId, typeId, 4);
  assert.equal((await summaryOf(db, pro, typeId, now)).usableTickets, 4);

  must(
    await pointTickets(db, { professionalId: pro.proId, actorUserId: pro.userId, customerId, selection: { ticketIds: [pointedId] } }),
    "point",
  );
  must(
    await closeTickets(db, { professionalId: pro.proId, actorUserId: pro.userId, customerId, selection: { ticketIds: [closedId] }, reason: "retire" }),
    "close",
  );
  assert.equal((await summaryOf(db, pro, typeId, now)).usableTickets, 2, "used and closed tickets no longer count");

  must(
    await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null }),
    "book",
  );
  assert.equal((await summaryOf(db, pro, typeId, now)).usableTickets, 1, "a booked ticket no longer counts");
});

dbTest("catalog reads: orphan follows the wallet classes (linked event, private, rdv_free)", async ({ db, pro }) => {
  const plain = await makeType(db, pro);
  const linked = await makeType(db, pro);
  const privateLinked = await makeType(db, pro);
  const rdvPaid = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const rdvFree = await makeType(db, pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 });
  const archived = await makeType(db, pro);
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");

  const before = await listTicketTypes(db, pro.proId, new Date());
  const orphanIn = (ids: TicketTypeSummary[], id: string) => found(ids.find((t) => t.id === id), id).orphan;
  assert.equal(orphanIn(before.active, plain), true, "unlinked non-RDV type");
  assert.equal(orphanIn(before.active, rdvPaid), false, "a paid RDV type needs no event");
  assert.equal(orphanIn(before.active, rdvFree), true, "an unlinked rdv_free type is an orphan (Q16)");
  assert.equal(orphanIn(before.archived, archived), false, "an archived type is red, not orange");

  await makeEvent(db, pro, { ticketTypeIds: [plain, linked] });
  await makeEvent(db, pro, { ticketTypeIds: [privateLinked], isPrivate: true });
  const after = await listTicketTypes(db, pro.proId, new Date());
  assert.equal(orphanIn(after.active, plain), false, "linked to a future tickets-mode event");
  assert.equal(orphanIn(after.active, linked), false);
  assert.equal(orphanIn(after.active, privateLinked), false, "a private event counts");
  assert.equal(orphanIn(after.active, rdvFree), true);
});

dbTest("catalog reads: getTicketTypeDetail returns RDV settings, own and global hours, questions", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, {
    name: "Cours particulier",
    description: "Un cours rien que pour vous.",
    color: "#0ea5e9",
    rdvEnabled: true,
    rdvDurationMin: 60,
    rdvBufferBeforeMin: 5,
    rdvBufferAfterMin: 10,
    rdvOverrides: { bookingHorizonDays: 30, minNoticeMinutes: null, cancelDeadlineHours: 48 },
  });
  const plainType = await makeType(db, pro, { name: "Sans RDV" });
  must(
    await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 780 }] }),
    "global hours",
  );
  must(
    await setAvailabilityRules(db, {
      professionalId: pro.proId,
      ticketTypeId: typeId,
      rules: [
        { dayOfWeek: 2, startMinute: 720, endMinute: 840 },
        { dayOfWeek: 2, startMinute: 900, endMinute: 960 },
      ],
    }),
    "own hours",
  );
  must(
    await setTypeQuestions(db, {
      professionalId: pro.proId,
      ticketTypeId: typeId,
      questions: [
        { label: "Quel est votre objectif ?", type: "text", required: true },
        { label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false },
      ],
    }),
    "questions",
  );

  const detail = found(await getTicketTypeDetail(db, pro.proId, typeId, new Date()), "detail");
  assert.equal(detail.id, typeId);
  assert.equal(detail.name, "Cours particulier");
  assert.equal(detail.description, "Un cours rien que pour vous.");
  assert.equal(detail.color, "#0ea5e9");
  assert.deepEqual(
    [detail.archived, detail.rdvEnabled, detail.rdvFree, detail.rdvDurationMin, detail.rdvBufferBeforeMin, detail.rdvBufferAfterMin],
    [false, true, false, 60, 5, 10],
  );
  assert.deepEqual(detail.rdvOverrides, { bookingHorizonDays: 30, minNoticeMinutes: null, cancelDeadlineHours: 48 });
  assert.deepEqual(detail.ownHours, [
    { dayOfWeek: 2, startMinute: 720, endMinute: 840 },
    { dayOfWeek: 2, startMinute: 900, endMinute: 960 },
  ]);
  assert.deepEqual(detail.globalHours, [{ dayOfWeek: 1, startMinute: 600, endMinute: 780 }]);
  assert.deepEqual(
    detail.questions.map((q) => [q.label, q.type, q.options, q.required]),
    [
      ["Quel est votre objectif ?", "text", null, true],
      ["Niveau", "choice", ["Débutant", "Confirmé"], false],
    ],
  );
  assert.deepEqual(detail.proWindow, { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 });

  const plain = found(await getTicketTypeDetail(db, pro.proId, plainType, new Date()), "plain detail");
  assert.deepEqual(plain.ownHours, [], "no own hours: the type follows the global ones");
  assert.deepEqual(plain.globalHours, [{ dayOfWeek: 1, startMinute: 600, endMinute: 780 }]);
  assert.deepEqual(plain.questions, []);
  assert.deepEqual(plain.rdvOverrides, { bookingHorizonDays: null, minNoticeMinutes: null, cancelDeadlineHours: null });
  assert.equal(plain.rdvDurationMin, null);
});

dbTest("catalog reads: usage counts tickets (also converted away), purchases and RDV occurrences", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 30 });
  const source = await makeType(db, pro);
  const target = await makeType(db, pro);
  const usageOf = async (id: string) => found(await getTicketTypeDetail(db, pro.proId, id, now), id).usage;

  assert.deepEqual(await usageOf(typeId), { tickets: 0, purchases: 0, rdvs: 0 });

  const offerId = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 5000 });
  const customerId = await makeCustomer(db, pro);
  await buy(db, pro, offerId, customerId);
  // A cancelled RDV holds no seat (invariants I1 and I5b) but still names the type, which blocks the DELETE.
  await rowRdv(db, pro, typeId, { status: "cancelled", seatsTaken: 0 }, now);
  assert.deepEqual(await usageOf(typeId), { tickets: 1, purchases: 1, rdvs: 1 });

  // A ticket converted away from « source » still names it in its movement: deleting « source » would fail.
  await giveTickets(db, pro, customerId, source, 1);
  must(
    await convertTickets(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      customerId,
      selection: { ticketTypeId: source, quantity: 1 },
      toTicketTypeId: target,
    }),
    "convert",
  );
  assert.deepEqual(await usageOf(source), { tickets: 1, purchases: 0, rdvs: 0 });
  assert.deepEqual(await usageOf(target), { tickets: 1, purchases: 0, rdvs: 0 });
});

dbTest("catalog reads: listActiveTypeOptions returns non-archived types in order, with rdvFree", async ({ db, pro }) => {
  const a = await makeType(db, pro, { name: "Cours collectif", color: "#16a34a" });
  const b = await makeType(db, pro, { name: "Ancien", color: "#ef4444" });
  const c = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: b, archived: true }), "archive");

  assert.deepEqual(await listActiveTypeOptions(db, pro.proId), [
    { id: a, name: "Cours collectif", color: "#16a34a", rdvFree: false },
    { id: c, name: "Appel découverte", color: "#6366f1", rdvFree: true },
  ]);
});

dbTest("catalog reads never cross tenants", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const mine = await makeType(db, pro, { name: "Le mien" });
    const theirs = await makeType(db, other, { name: "Le leur" });
    const theirOffer = await makeOffer(db, other, theirs);
    await makeEvent(db, other, { title: "Leur cours", ticketTypeIds: [theirs] });
    await giveTickets(db, other, await makeCustomer(db, other), theirs, 2);

    assert.equal(await getTicketTypeDetail(db, pro.proId, theirs, new Date()), null, "another pro's id");
    assert.equal(await getTicketTypeDetail(db, other.proId, mine, new Date()), null);
    assert.equal(await getTicketTypeDetail(db, pro.proId, "inconnu", new Date()), null, "an unknown id");

    const list = await listTicketTypes(db, pro.proId, new Date());
    assert.deepEqual(list.active.map((t) => t.id), [mine]);
    assert.deepEqual(list.active[0].offers, []);
    assert.deepEqual(list.active[0].acceptedBy, []);
    assert.equal(list.active[0].usableTickets, 0);
    assert.deepEqual((await listActiveTypeOptions(db, pro.proId)).map((o) => o.id), [mine]);

    const theirList = await listTicketTypes(db, other.proId, new Date());
    assert.deepEqual(theirList.active.map((t) => t.id), [theirs]);
    assert.deepEqual(theirList.active[0].offers.map((o) => o.id), [theirOffer]);
    assert.deepEqual(theirList.active[0].acceptedBy.map((e) => e.title), ["Leur cours"]);
    assert.equal(theirList.active[0].usableTickets, 2);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
