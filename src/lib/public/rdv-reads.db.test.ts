/**
 * The public RDV reads (P5 dossier § 5 T7): the RDV page's type, the cards of `/[slug]` and the Owner's tickets of a
 * type. Every read is this pro's only; the second-pro cases give null or nothing.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setAvailabilityRules, setTicketTypeArchived, setTypeQuestions } from "@/lib/booking/catalog";
import type { Db } from "@/lib/db/atomic";
import { ticketOffer, ticketType } from "@/lib/db/schema";
import { getPublicRdvType, listRdvCards, rdvOwnerTickets } from "@/lib/public/rdv-reads";
import { addDaysMs, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { giveTickets, makeCustomer, makeOffer, makeType, ticketsOf } from "@/test/fixtures";
import { rowTicket } from "@/test/rows";

/** A fixed Wednesday, 10:00 in Paris (winter time). */
const NOW = new Date("2027-01-13T09:00:00.000Z");

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 480, endMinute: 1200 }));

async function globalHours(db: Db, pro: TestPro): Promise<void> {
  const res = await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: ALL_WEEK });
  assert.ok(res.ok, JSON.stringify(res));
}

const rdvType = (db: Db, pro: TestPro, over: Parameters<typeof makeType>[2] = {}) =>
  makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 60, ...over });

dbTest("getPublicRdvType: the type, its offers of this type on sale by position with their coverage, its questions", async ({ db, pro }) => {
  await globalHours(db, pro);
  const typeId = await rdvType(db, pro, { name: "Massage sportif", description: "Une heure de soin.", rdvDurationMin: 45 });
  const otherType = await rdvType(db, pro);
  const single = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 6000 });
  const pack = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 20000, validityCount: 3, validityUnit: "month", label: "Pack trimestre" });
  const month = await makeOffer(db, pro, typeId, { quantity: 2, priceCents: 11000, validityCount: 30, validityUnit: "day" });
  await makeOffer(db, pro, typeId, { quantity: 10, priceCents: 45000, isActive: false });
  const archived = await makeOffer(db, pro, typeId, { quantity: 5, priceCents: 25000 });
  await db.update(ticketOffer).set({ archivedAt: NOW }).where(eq(ticketOffer.id, archived));
  await makeOffer(db, pro, otherType, { quantity: 3, priceCents: 9000 });
  // the pack goes first (position), the single last
  await db.update(ticketOffer).set({ position: -1 }).where(eq(ticketOffer.id, pack));
  await db.update(ticketOffer).set({ position: 99 }).where(eq(ticketOffer.id, single));
  const questions = await setTypeQuestions(db, {
    professionalId: pro.proId,
    ticketTypeId: typeId,
    questions: [{ label: "Une blessure à signaler ?", type: "text", required: true }],
  });
  assert.ok(questions.ok, JSON.stringify(questions));

  const page = await getPublicRdvType(db, { professionalId: pro.proId }, typeId, NOW);
  assert.ok(page);
  assert.deepEqual(
    { ...page, questions: page.questions.map((q) => [q.label, q.type, q.required]) },
    {
      ticketTypeId: typeId,
      name: "Massage sportif",
      description: "Une heure de soin.",
      durationMin: 45,
      isFree: false,
      hasHours: true,
      neverBookable: false,
      window: { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 },
      offers: [
        // bought on 13/01 (Paris): valid through 13/04 inclusive, so it stops at local midnight (CEST) after it
        { offerId: pack, label: "Pack trimestre", quantity: 4, priceCents: 20000, validityText: "3 mois", coversUntil: "2027-04-13T22:00:00.000Z" },
        { offerId: month, label: "Carnet de 2", quantity: 2, priceCents: 11000, validityText: "30 jours", coversUntil: "2027-02-12T23:00:00.000Z" },
        { offerId: single, label: "À l'unité", quantity: 1, priceCents: 6000, validityText: null, coversUntil: null },
      ],
      questions: [["Une blessure à signaler ?", "text", true]],
    },
  );
});

dbTest("getPublicRdvType: null for a malformed, unknown, foreign, archived, not RDV-enabled type; a free type has no offers; no hours reads as never bookable", async ({ db, pro }) => {
  const read = (id: string) => getPublicRdvType(db, { professionalId: pro.proId }, id, NOW);
  const notRdv = await makeType(db, pro);
  const archived = await rdvType(db, pro);
  assert.ok((await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true })).ok);
  for (const bad of ["", "../x", "a".repeat(65), `missing_${nanoid()}`, notRdv, archived]) {
    assert.equal(await read(bad), null, JSON.stringify(bad));
  }

  const other = await createTestPro(db);
  try {
    const theirs = await rdvType(db, other, { rdvFree: true });
    assert.equal(await read(theirs), null, "another pro's type");
    assert.ok(await getPublicRdvType(db, { professionalId: other.proId }, theirs, NOW), "theirs under their own page");
  } finally {
    await deleteTestUser(db, other.userId);
  }

  // a free type: a mode, not a 404, and nothing to buy
  const free = await rdvType(db, pro, { name: "Premier échange", rdvFree: true, rdvDurationMin: 30 });
  const page = await read(free);
  assert.ok(page);
  assert.equal(page.isFree, true);
  assert.deepEqual(page.offers, []);
  assert.equal(page.hasHours, false, "no own rules and no global ones");
  assert.equal(page.neverBookable, true);

  await globalHours(db, pro);
  const open = await read(free);
  assert.equal(open?.hasHours, true);
  assert.equal(open?.neverBookable, false);
  // a notice above the horizon (a direct row edit: the back-office refuses it)
  await db.update(ticketType).set({ rdvMinNoticeMinutes: 2880, rdvBookingHorizonDays: 1 }).where(eq(ticketType.id, free));
  const closed = await read(free);
  assert.equal(closed?.neverBookable, true);
  assert.deepEqual(closed?.window, { bookingHorizonDays: 1, minNoticeMinutes: 2880, cancelDeadlineHours: 24 });
});

dbTest("listRdvCards: the bookable RDV types by position; « Gratuit » has no price; the lowest price on sale; no hours or a notice above the horizon hide a card", async ({ db, pro }) => {
  const noHours = await rdvType(db, pro, { name: "Sans horaires" });
  assert.deepEqual(await listRdvCards(db, pro.proId), [], "no hours at all: nothing to offer");

  await globalHours(db, pro);
  const paid = await rdvType(db, pro, { name: "Cours particulier", description: "Sur mesure." });
  const free = await rdvType(db, pro, { name: "Premier échange", rdvFree: true, rdvDurationMin: 30 });
  const noOffer = await rdvType(db, pro, { name: "Sur tickets seulement", rdvDurationMin: 90 });
  const ownHours = await rdvType(db, pro, { name: "Horaires propres" });
  assert.ok((await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: ownHours, rules: [ALL_WEEK[2]] })).ok);
  const tooLong = await rdvType(db, pro, { name: "Délai trop long" });
  await db.update(ticketType).set({ rdvMinNoticeMinutes: 10080, rdvBookingHorizonDays: 2 }).where(eq(ticketType.id, tooLong));
  const archived = await rdvType(db, pro, { name: "Archivé" });
  assert.ok((await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true })).ok);
  await makeType(db, pro, { name: "Pas un rendez-vous" });

  await makeOffer(db, pro, paid, { quantity: 1, priceCents: 6000 });
  await makeOffer(db, pro, paid, { quantity: 4, priceCents: 4500 });
  await makeOffer(db, pro, paid, { quantity: 10, priceCents: 1000, isActive: false });
  const cheapArchived = await makeOffer(db, pro, paid, { quantity: 1, priceCents: 500 });
  await db.update(ticketOffer).set({ archivedAt: NOW }).where(eq(ticketOffer.id, cheapArchived));
  await makeOffer(db, pro, noOffer, { quantity: 1, priceCents: 3000, isActive: false });
  await makeOffer(db, pro, ownHours, { quantity: 1, priceCents: 7000 });
  // « Premier échange » goes first
  await db.update(ticketType).set({ position: -1 }).where(eq(ticketType.id, free));

  const other = await createTestPro(db);
  try {
    await globalHours(db, other);
    await rdvType(db, other, { name: "Type de l'autre pro" });
    const cards = await listRdvCards(db, pro.proId);
    assert.deepEqual(cards, [
      { ticketTypeId: free, name: "Premier échange", description: null, durationMin: 30, isFree: true, fromPriceCents: null },
      { ticketTypeId: noHours, name: "Sans horaires", description: null, durationMin: 60, isFree: false, fromPriceCents: null },
      { ticketTypeId: paid, name: "Cours particulier", description: "Sur mesure.", durationMin: 60, isFree: false, fromPriceCents: 4500 },
      { ticketTypeId: noOffer, name: "Sur tickets seulement", description: null, durationMin: 90, isFree: false, fromPriceCents: null },
      { ticketTypeId: ownHours, name: "Horaires propres", description: null, durationMin: 60, isFree: false, fromPriceCents: 7000 },
    ]);
    assert.equal(JSON.stringify(cards).includes("l'autre pro"), false);
  } finally {
    await deleteTestUser(db, other.userId);
  }

  // a type with own rules only, the global ones gone: still shown; the others lose their hours
  assert.ok((await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: [] })).ok);
  assert.deepEqual(
    (await listRdvCards(db, pro.proId)).map((c) => c.name),
    ["Horaires propres"],
  );
});

dbTest("rdvOwnerTickets: this customer's available tickets of this paid RDV type only, in consumption order", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rdvType(db, pro);
  const otherRdv = await rdvType(db, pro);
  const seanceType = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const stranger = await makeCustomer(db, pro);

  const [never] = await giveTickets(db, pro, customerId, typeId, 1);
  const [late] = await giveTickets(db, pro, customerId, typeId, 1, { expiresAt: addDaysMs(now, 10) });
  const [soon] = await giveTickets(db, pro, customerId, typeId, 1, { expiresAt: addDaysMs(now, 5) });
  await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "used" });
  await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "closed" });
  await giveTickets(db, pro, customerId, otherRdv, 2);
  await giveTickets(db, pro, customerId, seanceType, 1);
  await giveTickets(db, pro, stranger, typeId, 3);

  const tickets = await ticketsOf(db, customerId);
  const expiryOf = (id: string) => tickets.find((t) => t.id === id)?.expiresAt?.toISOString() ?? null;
  assert.deepEqual(await rdvOwnerTickets(db, pro.proId, customerId, typeId), [
    { expiresAt: expiryOf(soon) },
    { expiresAt: expiryOf(late) },
    { expiresAt: null },
  ]);
  assert.ok(expiryOf(soon) && expiryOf(late) && expiryOf(never) === null);
  assert.equal((await rdvOwnerTickets(db, pro.proId, customerId, otherRdv)).length, 2, "per type, never over every type");
  assert.deepEqual(await rdvOwnerTickets(db, pro.proId, customerId, seanceType), [], "a type that is not an RDV");
  assert.equal((await rdvOwnerTickets(db, pro.proId, stranger, typeId)).length, 3);

  // a type made « Gratuit » keeps a ticket handed back as available (E6a): it is never spent on a free RDV
  const free = await rdvType(db, pro, { rdvFree: true });
  await rowTicket(db, pro, { customerId, ticketTypeId: free });
  assert.deepEqual(await rdvOwnerTickets(db, pro.proId, customerId, free), []);
  // an archived type (P3OUT:108)
  assert.ok((await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: otherRdv, archived: true })).ok);
  assert.deepEqual(await rdvOwnerTickets(db, pro.proId, customerId, otherRdv), []);

  const other = await createTestPro(db);
  try {
    const theirType = await rdvType(db, other);
    const theirCustomer = await makeCustomer(db, other);
    await giveTickets(db, other, theirCustomer, theirType, 2);
    assert.deepEqual(await rdvOwnerTickets(db, pro.proId, theirCustomer, theirType), [], "their customer and type under this pro");
    assert.deepEqual(await rdvOwnerTickets(db, pro.proId, customerId, theirType), []);
    assert.deepEqual(await rdvOwnerTickets(db, other.proId, customerId, typeId), [], "this pro's customer under theirs");
    assert.equal((await rdvOwnerTickets(db, other.proId, theirCustomer, theirType)).length, 2);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
