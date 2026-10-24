import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { cancelOccurrence } from "@/lib/booking/cancel";
import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { attachCheckoutSession, bookWithHeldTicket, startBuyAndBook } from "@/lib/booking/claims";
import { releasePurchase } from "@/lib/booking/release";
import { instantAt } from "@/lib/civil-date";
import { booking, event, eventTicketType, occurrence, question, ticket, ticketOffer, ticketPurchase, timeOff } from "@/lib/db/schema";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type DbHarness, type TestPro } from "@/test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { keyPaths, privateKeyPaths } from "@/test/key-paths";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowLink,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "@/test/rows";

import type { PublicVisitor } from "./identity";
import { listPublicSeances, type PublicSeance } from "./planning-reads";
import { purchaseByReference } from "./purchase-reads";
import { getPublicSeance, livePendingHoldsOf, seanceVisitorFacts } from "./seance-reads";
import { referenceForPage, seanceViewerOf } from "./visibility";

const WINDOW = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };
const proOf = (pro: TestPro) => ({ professionalId: pro.proId, timezone: pro.tz, window: WINDOW });

/** A tickets séance in 3 days at 10:00 with one linked type, one offer of 4 tickets and one customer (the victim of a typed address). */
async function world(h: DbHarness) {
  const typeId = await makeType(h.db, h.pro, { name: "Cours collectif" });
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 4, priceCents: 8500 });
  const { eventId, occurrences } = await makeEvent(h.db, h.pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(h.db, h.pro, { name: "Beatriz Almeida", email: testEmail("beatriz") });
  return { typeId, offerId, eventId, occ: occurrences[0], customerId };
}

async function buyAndBook(h: DbHarness, w: Awaited<ReturnType<typeof world>>, now: Date, over: { customerId?: string; occurrenceId?: string; startsAt?: Date } = {}) {
  const res = await startBuyAndBook(
    h.db,
    {
      professionalId: h.pro.proId,
      occurrenceId: over.occurrenceId ?? w.occ.id,
      customerId: over.customerId ?? w.customerId,
      seenStartsAt: over.startsAt ?? w.occ.startsAt,
      offerId: w.offerId,
    },
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  return res;
}

/** A pending booking (ticket coverage) backed by a pending purchase, as « buy + book » leaves it until the client pays. */
async function pendingHold(h: DbHarness, args: { occurrenceId: string; typeId: string; offerId: string; holdExpiresAt: Date }): Promise<void> {
  const customerId = await rowCustomer(h.db, h.pro);
  const purchaseId = await rowPurchase(h.db, h.pro, { customerId, offerId: args.offerId, ticketTypeId: args.typeId });
  await rowBooking(h.db, h.pro, {
    occurrenceId: args.occurrenceId,
    customerId,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: args.holdExpiresAt,
  });
}

const ANONYMOUS: PublicVisitor = { state: "anonymous", email: null, name: null, isPageOwner: false, owner: null, guestCustomerId: null };

/* ───────────────────────── getPublicSeance ───────────────────────── */

dbTest("getPublicSeance: the séance with its place, seats, types, questions and the offers that can pay for it", async ({ db, pro }) => {
  const now = new Date();
  const collectif = await makeType(db, pro, { name: "Cours collectif", color: "#22c55e" });
  const unite = await makeOffer(db, pro, collectif, { quantity: 1, priceCents: 2500 });
  const trimestre = await makeOffer(db, pro, collectif, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const court = await makeOffer(db, pro, collectif, { quantity: 2, priceCents: 4500, validityCount: 1, validityUnit: "day" });
  const inactive = await makeOffer(db, pro, collectif, { quantity: 10, priceCents: 19000, isActive: false });
  const archivedOffer = await makeOffer(db, pro, collectif, { quantity: 3, priceCents: 6500 });
  await db.update(ticketOffer).set({ archivedAt: now }).where(eq(ticketOffer.id, archivedOffer));
  const essai = await makeType(db, pro, { name: "Cours d'essai" });
  const essaiOffer = await makeOffer(db, pro, essai, { quantity: 1, priceCents: 1500 });
  const ancien = await makeType(db, pro, { name: "Ancien type" });
  await makeOffer(db, pro, ancien, { quantity: 1, priceCents: 2000 });
  const free = await rowType(db, pro, { name: "Cours gratuit", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await rowOffer(db, pro, free);

  // A séance in 10 days: a one-day offer cannot cover it.
  const { eventId, occurrences } = await makeEvent(
    db,
    pro,
    { title: "Altinha débutants", capacity: 12, ticketTypeIds: [collectif, essai, ancien], rule: { startDate: dayIn(pro, 10, now) } },
    now,
  );
  await rowLink(db, pro, eventId, free);
  const archivedType = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: ancien, archived: true });
  assert.ok(archivedType.ok, JSON.stringify(archivedType));
  await db.update(event).set({ description: "Séance d'initiation.", location: "Gymnase Jean Bouin" }).where(eq(event.id, eventId));
  await db.insert(question).values({ professionalId: pro.proId, eventId, label: "Votre niveau ?", type: "text", required: true, position: 0 });

  const got = await getPublicSeance(db, proOf(pro), occurrences[0].id, now);
  assert.ok(got && got.kind === "seance", JSON.stringify(got));
  assert.deepEqual(
    [got.occurrenceId, got.eventId, got.title, got.description, got.location, got.bookingMode, got.status, got.capacity, got.seatsLeft],
    [occurrences[0].id, eventId, "Altinha débutants", "Séance d'initiation.", "Gymnase Jean Bouin", "tickets", "scheduled", 12, 12],
  );
  assert.deepEqual([got.isPrivate, got.archived, got.underTimeOff], [false, false, false]);
  assert.deepEqual(got.startsAt, occurrences[0].startsAt);
  assert.deepEqual(got.endsAt, occurrences[0].endsAt);
  assert.deepEqual(got.window, WINDOW);
  assert.deepEqual(got.acceptedTypes.map((t) => t.name).sort(), ["Cours collectif", "Cours d'essai", "Cours gratuit"], "the archived type is dropped");
  assert.deepEqual(
    got.questions.map((q) => [q.label, q.type, q.required]),
    [["Votre niveau ?", "text", true]],
  );
  assert.deepEqual(
    got.offers.map((o) => [o.offerId, o.label, o.ticketTypeName, o.priceCents, o.validityText, o.covers]),
    [
      [unite, "À l'unité", "Cours collectif", 2500, null, true],
      [trimestre, "Carnet de 4", "Cours collectif", 8500, "3 mois", true],
      [court, "Carnet de 2", "Cours collectif", 4500, "1 jour", false],
      [essaiOffer, "À l'unité", "Cours d'essai", 1500, null, true],
    ],
    "inactive and archived offers, the archived type's and the free type's offers are left out; a one-day offer does not cover a séance in 10 days",
  );
  assert.equal(got.offers.some((o) => o.offerId === inactive), false);
  assert.deepEqual(got.offers[0].ticketTypeId, collectif);
});

dbTest("getPublicSeance: private, archived, cancelled, under a time off, a lapsed hold, free and onsite séances", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);

  const priv = await makeEvent(db, pro, { title: "Équipe compétition", isPrivate: true }, now);
  const archivedEvent = await makeEvent(db, pro, { title: "Atelier archivé" }, now);
  await db.update(event).set({ archivedAt: now }).where(eq(event.id, archivedEvent.eventId));
  const struck = await makeEvent(db, pro, { title: "Altinha annulée" }, now);
  const cancelled = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: struck.occurrences[0].id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));
  const blocked = await makeEvent(db, pro, { title: "Altinha bloquée", rule: { startDate: dayIn(pro, 5, now) } }, now);
  await db.insert(timeOff).values({
    id: nanoid(),
    professionalId: pro.proId,
    startAt: instantAt(dayIn(pro, 5, now), 0, pro.tz),
    endAt: instantAt(dayIn(pro, 6, now), 0, pro.tz),
    allDay: true,
    reason: null,
  });
  const lapsed = await makeEvent(db, pro, { title: "Altinha abandonnée", capacity: 5, rule: { startDate: dayIn(pro, 4, now) } }, now);
  await db.update(occurrence).set({ seatsTaken: 1 }).where(eq(occurrence.id, lapsed.occurrences[0].id));
  await pendingHold(
    { db, pro },
    { occurrenceId: lapsed.occurrences[0].id, typeId, offerId, holdExpiresAt: addMinutes(now, -5) },
  );
  const roda = await rowEvent(db, pro, { bookingMode: "free" }, now);
  await rowLink(db, pro, roda, typeId);
  const rodaSeance = await rowSeance(db, pro, roda, { startsAt: instantAt(dayIn(pro, 7, now), 600, pro.tz), seriesDate: dayIn(pro, 7, now) }, now);
  const onsite = await makeEvent(db, pro, { title: "Atelier sur place", bookingMode: "none", rule: { startDate: dayIn(pro, 8, now) } }, now);

  const read = async (id: string) => {
    const got = await getPublicSeance(db, proOf(pro), id, now);
    assert.ok(got && got.kind === "seance", id);
    return got;
  };
  const p = await read(priv.occurrences[0].id);
  assert.deepEqual([p.title, p.isPrivate, p.archived, p.status], ["Équipe compétition", true, false, "scheduled"]);
  const a = await read(archivedEvent.occurrences[0].id);
  assert.deepEqual([a.isPrivate, a.archived], [false, true]);
  const c = await read(struck.occurrences[0].id);
  assert.equal(c.status, "cancelled");
  const t = await read(blocked.occurrences[0].id);
  assert.equal(t.underTimeOff, true, "an empty séance under a time off is still readable by its URL: the page says « Réservations fermées »");
  const l = await read(lapsed.occurrences[0].id);
  assert.deepEqual([l.capacity, l.seatsLeft], [5, 5], "a lapsed hold is a free seat");
  const f = await read(rodaSeance);
  assert.deepEqual([f.bookingMode, f.acceptedTypes, f.offers], ["free", [], []], "a free séance has no accepted type and sells nothing, a stale link or not");
  const o = await read(onsite.occurrences[0].id);
  assert.deepEqual([o.bookingMode, o.acceptedTypes, o.offers], ["none", [], []]);
});

dbTest("getPublicSeance: an RDV is { kind: rdv }, another pro's séance, an unknown id and a malformed id are null", async ({ db, pro }) => {
  const now = new Date();
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, rdvType, {}, now);
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) }, now);
  const mine = await makeEvent(db, pro, { title: "Altinha débutants" }, now);
  const other = await createTestPro(db);
  try {
    const theirs = await makeEvent(db, other, { title: "Chez l'autre" }, now);
    assert.deepEqual(await getPublicSeance(db, proOf(pro), rdv, now), { kind: "rdv" });
    assert.equal(await getPublicSeance(db, proOf(pro), theirs.occurrences[0].id, now), null, "another pro's séance");
    assert.equal(await getPublicSeance(db, proOf(other), mine.occurrences[0].id, now), null, "and the other way round");
    assert.equal(await getPublicSeance(db, proOf(other), rdv, now), null, "another pro's RDV is not an RDV of this one");
    assert.equal((await getPublicSeance(db, proOf(other), theirs.occurrences[0].id, now))?.kind, "seance");
    for (const bad of ["inconnu", "", "x".repeat(65), "../etc", "a b"]) {
      assert.equal(await getPublicSeance(db, proOf(pro), bad, now), null, JSON.stringify(bad));
    }
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("getPublicSeance says what the planning list says about the same séance: seats, place, window, types and time off (Task 24 review)", async ({ db, pro }) => {
  const now = new Date();
  const range = { start: now, end: addMinutes(now, 15 * 24 * 60) };
  const typeId = await makeType(db, pro, { name: "Cours collectif", color: "#22c55e" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500 });

  await makeEvent(db, pro, { title: "Altinha débutants", capacity: 8, ticketTypeIds: [typeId] }, now);
  // The event's own horizon, notice, cancel deadline and place, a séance with its own place, and a lapsed hold (capacity 5,
  // one seat taken by a hold that ended: it is a free seat again).
  const custom = await makeEvent(
    db,
    pro,
    { title: "Altinha intermédiaires", capacity: 5, ticketTypeIds: [typeId], rule: { startDate: dayIn(pro, 4, now) } },
    now,
  );
  await db
    .update(event)
    .set({ bookingHorizonDays: 20, minNoticeMinutes: 180, cancelDeadlineHours: 6, location: "Gymnase Jean Bouin" })
    .where(eq(event.id, custom.eventId));
  await db.update(occurrence).set({ locationOverride: "Plage de Copacabana", seatsTaken: 1 }).where(eq(occurrence.id, custom.occurrences[0].id));
  await pendingHold({ db, pro }, { occurrenceId: custom.occurrences[0].id, typeId, offerId, holdExpiresAt: addMinutes(now, -5) });
  // A booked séance under a time off stays in the list, closed online (an empty one would be hidden).
  const blocked = await makeEvent(db, pro, { title: "Altinha bloquée", rule: { startDate: dayIn(pro, 5, now) } }, now);
  await rowBooking(db, pro, { occurrenceId: blocked.occurrences[0].id, customerId: await rowCustomer(db, pro) }, now);
  await db.update(occurrence).set({ seatsTaken: 1 }).where(eq(occurrence.id, blocked.occurrences[0].id));
  await db.insert(timeOff).values({
    id: nanoid(),
    professionalId: pro.proId,
    startAt: instantAt(dayIn(pro, 5, now), 0, pro.tz),
    endAt: instantAt(dayIn(pro, 6, now), 0, pro.tz),
    allDay: true,
    reason: null,
  });
  const struck = await makeEvent(db, pro, { title: "Altinha annulée", ticketTypeIds: [typeId] }, now);
  const cancelled = await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: struck.occurrences[0].id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));
  // A free séance keeps no accepted type, a stale link or not; an onsite one neither.
  const roda = await rowEvent(db, pro, { bookingMode: "free" }, now);
  await db.update(event).set({ title: "Roda libre" }).where(eq(event.id, roda));
  await rowLink(db, pro, roda, typeId);
  await rowSeance(db, pro, roda, { startsAt: instantAt(dayIn(pro, 7, now), 600, pro.tz), seriesDate: dayIn(pro, 7, now) }, now);
  await makeEvent(db, pro, { title: "Atelier sur place", bookingMode: "none", rule: { startDate: dayIn(pro, 8, now) } }, now);

  const listed = await listPublicSeances(db, proOf(pro), range, now);
  const byTitle = new Map(listed.map((s) => [s.title, s]));
  assert.equal(listed.length, 6, [...byTitle.keys()].join(", "));
  // Not vacuous: the list itself shows each of the differences the page has to repeat.
  assert.equal(byTitle.get("Altinha bloquée")?.underTimeOff, true);
  assert.equal(byTitle.get("Altinha débutants")?.underTimeOff, false);
  assert.deepEqual(
    [byTitle.get("Altinha intermédiaires")?.seatsLeft, byTitle.get("Altinha intermédiaires")?.location],
    [5, "Plage de Copacabana"],
  );
  assert.deepEqual(byTitle.get("Altinha intermédiaires")?.window, { bookingHorizonDays: 20, minNoticeMinutes: 180, cancelDeadlineHours: 6 });
  assert.deepEqual(byTitle.get("Altinha débutants")?.acceptedTypes.map((t) => t.name), ["Cours collectif"]);
  assert.equal(byTitle.get("Altinha annulée")?.status, "cancelled");
  assert.deepEqual(byTitle.get("Roda libre")?.acceptedTypes, []);
  assert.deepEqual(byTitle.get("Atelier sur place")?.acceptedTypes, []);

  for (const seance of listed) {
    const detail = await getPublicSeance(db, proOf(pro), seance.occurrenceId, now);
    assert.ok(detail && detail.kind === "seance", seance.title);
    const shared = Object.fromEntries(Object.keys(seance).map((key) => [key, detail[key as keyof PublicSeance]]));
    assert.deepEqual(shared, seance, `${seance.title}: the séance page and the planning disagree`);
  }
});

/* ───────────────────────── seanceVisitorFacts ───────────────────────── */

dbTest("seanceVisitorFacts (owner): nothing, then the tickets that would pay, left after this séance", async ({ db, pro }) => {
  const w = await world({ db, pro });
  const now = new Date();
  const viewer = { customerId: w.customerId, source: "owner" } as const;
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer, now), { booking: null, ended: null, usable: null });

  await giveTickets(db, pro, w.customerId, w.typeId, 3);
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer, now), {
    booking: null,
    ended: null,
    usable: { typeName: "Cours collectif", leftAfter: 2 },
  });
});

dbTest("seanceVisitorFacts (owner): the type spent first is the one that expires first; unfit tickets are not usable here", async ({ db, pro }) => {
  const now = new Date();
  const soonest = await makeType(db, pro, { name: "Cours d'essai" });
  const open = await makeType(db, pro, { name: "Cours collectif" });
  const unlinked = await makeType(db, pro, { name: "Stage d'été" });
  const archived = await makeType(db, pro, { name: "Ancien type" });
  const { occurrences } = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [soonest, open, archived] }, now);
  const occ = occurrences[0];
  const viewer = (customerId: string) => ({ customerId, source: "owner" as const });

  const beatriz = await makeCustomer(db, pro, { name: "Beatriz Almeida" });
  await giveTickets(db, pro, beatriz, open, 3);
  await giveTickets(db, pro, beatriz, soonest, 2, { expiresAt: instantAt(dayIn(pro, 20, now), 0, pro.tz) });
  assert.deepEqual((await seanceVisitorFacts(db, pro.proId, occ.id, viewer(beatriz), now)).usable, { typeName: "Cours d'essai", leftAfter: 1 });

  // A ticket that expires before the séance, a ticket of a type the event does not accept and a ticket of an archived type.
  const rafael = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await giveTickets(db, pro, rafael, open, 1, { expiresAt: instantAt(dayIn(pro, 2, now), 0, pro.tz) });
  await giveTickets(db, pro, rafael, unlinked, 1);
  await giveTickets(db, pro, rafael, archived, 1);
  const archivedType = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true });
  assert.ok(archivedType.ok, JSON.stringify(archivedType));
  assert.equal((await seanceVisitorFacts(db, pro.proId, occ.id, viewer(rafael), now)).usable, null);
});

dbTest("seanceVisitorFacts (owner): a pending booking carries its purchase and its resume URL while the session is open", async ({ db, pro }) => {
  const h = { db, pro };
  const w = await world(h);
  const now = new Date();
  const started = await buyAndBook(h, w, now);
  const attached = await attachCheckoutSession(db, { purchaseId: started.purchaseId, checkoutSessionId: "cs_test_1", checkoutUrl: "https://checkout.test/p1" }, now);
  assert.ok(attached.ok);
  const viewer = { customerId: w.customerId, source: "owner" } as const;

  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer, now), {
    booking: { bookingId: started.bookingId, status: "pending", coverage: "ticket", purchaseId: started.purchaseId, resumeUrl: "https://checkout.test/p1" },
    ended: null,
    usable: null,
  });
  // 35 minutes in: the Checkout session (31 minutes) is closed, the hold (45 minutes) is not: no URL, the purchase can still be released.
  const later = await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer, addMinutes(now, 35));
  assert.deepEqual(later.booking, { bookingId: started.bookingId, status: "pending", coverage: "ticket", purchaseId: started.purchaseId, resumeUrl: null });
  // 50 minutes in: the hold has lapsed, the seat is free and the sweep has not run: the booking is an ended one.
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer, addMinutes(now, 50)), { booking: null, ended: "expired", usable: null });
});

dbTest("seanceVisitorFacts (owner): a confirmed booking, with a ticket or not", async ({ db, pro }) => {
  const w = await world({ db, pro });
  const now = new Date();
  await giveTickets(db, pro, w.customerId, w.typeId, 1);
  const booked = await bookWithHeldTicket(
    db,
    { professionalId: pro.proId, occurrenceId: w.occ.id, customerId: w.customerId, seenStartsAt: w.occ.startsAt, actorUserId: pro.userId },
    now,
  );
  assert.ok(booked.ok, JSON.stringify(booked));
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: w.customerId, source: "owner" }, now), {
    booking: { bookingId: booked.bookingId, status: "confirmed", coverage: "ticket", purchaseId: null, resumeUrl: null },
    ended: null,
    usable: null,
  });

  const free = await makeCustomer(db, pro, { name: "Rafael Souza" });
  const guestBooking = await rowBooking(db, pro, { occurrenceId: w.occ.id, customerId: free, status: "confirmed", coverage: "guest" }, now);
  await db.update(occurrence).set({ seatsTaken: 2 }).where(eq(occurrence.id, w.occ.id));
  const facts = await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: free, source: "owner" }, now);
  assert.deepEqual(facts.booking, { bookingId: guestBooking, status: "confirmed", coverage: "guest", purchaseId: null, resumeUrl: null });
});

dbTest("seanceVisitorFacts (owner): the latest ended booking says how it ended, an active one hides it", async ({ db, pro }) => {
  const w = await world({ db, pro });
  const now = new Date();
  const viewer = (customerId: string) => ({ customerId, source: "owner" as const });
  const ended = (customerId: string, status: "cancelled" | "expired", at: Date) =>
    rowBooking(db, pro, { occurrenceId: w.occ.id, customerId, status }, at);

  await ended(w.customerId, "cancelled", addMinutes(now, -120));
  await ended(w.customerId, "expired", addMinutes(now, -60));
  assert.equal((await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer(w.customerId), now)).ended, "expired", "the expired one is the latest");

  const other = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await ended(other, "expired", addMinutes(now, -120));
  await ended(other, "cancelled", addMinutes(now, -60));
  assert.equal((await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer(other), now)).ended, "cancelled", "the cancelled one is the latest");

  // An active booking after an ended one: no ended state.
  const third = await makeCustomer(db, pro, { name: "Marina Costa" });
  await ended(third, "cancelled", addMinutes(now, -60));
  await rowBooking(db, pro, { occurrenceId: w.occ.id, customerId: third, status: "confirmed" }, now);
  await db.update(occurrence).set({ seatsTaken: 1 }).where(eq(occurrence.id, w.occ.id));
  const facts = await seanceVisitorFacts(db, pro.proId, w.occ.id, viewer(third), now);
  assert.equal(facts.ended, null);
  assert.equal(facts.booking?.status, "confirmed");
});

dbTest("seanceVisitorFacts (guest cookie): the status of the booking only, never a purchase, a URL, a wallet or an ended state (Decision 63)", async ({ db, pro }) => {
  const h = { db, pro };
  const w = await world(h);
  const now = new Date();
  const guest = { customerId: w.customerId, source: "guest" } as const;
  await giveTickets(db, pro, w.customerId, w.typeId, 2);
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, guest, now), { booking: null, ended: null, usable: null }, "tickets are not shown to a cookie");

  const started = await buyAndBook(h, w, now);
  const attached = await attachCheckoutSession(db, { purchaseId: started.purchaseId, checkoutSessionId: "cs_test_1", checkoutUrl: "https://checkout.test/p1" }, now);
  assert.ok(attached.ok);
  const facts = await seanceVisitorFacts(db, pro.proId, w.occ.id, guest, now);
  assert.deepEqual(facts, {
    booking: { bookingId: started.bookingId, status: "pending", coverage: "ticket", purchaseId: null, resumeUrl: null },
    ended: null,
    usable: null,
  });
  assert.equal(JSON.stringify(facts).includes(started.purchaseId), false);
  assert.equal(JSON.stringify(facts).includes("checkout.test"), false);

  // The same state for the Owner carries both.
  const owner = await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: w.customerId, source: "owner" }, now);
  assert.equal(owner.booking?.purchaseId, started.purchaseId);
  assert.equal(owner.booking?.resumeUrl, "https://checkout.test/p1");

  // Ended: nothing for a cookie.
  const released = await releasePurchase(db, started.purchaseId, addMinutes(now, 1));
  assert.ok(released.ok, JSON.stringify(released));
  assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, guest, addMinutes(now, 2)), { booking: null, ended: null, usable: null });
  assert.equal((await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: w.customerId, source: "owner" }, addMinutes(now, 2))).ended, "expired");
});

dbTest("seanceVisitorFacts: a customer or a séance of another pro gives empty facts", async ({ db, pro }) => {
  const w = await world({ db, pro });
  const now = new Date();
  await giveTickets(db, pro, w.customerId, w.typeId, 2);
  await rowBooking(db, pro, { occurrenceId: w.occ.id, customerId: w.customerId, status: "confirmed", coverage: "guest" }, now);
  await db.update(occurrence).set({ seatsTaken: 1 }).where(eq(occurrence.id, w.occ.id));
  const empty = { booking: null, ended: null, usable: null };
  const other = await createTestPro(db);
  try {
    const theirCustomer = await makeCustomer(db, other, { name: "Chez l'autre" });
    const theirs = await makeEvent(db, other, { title: "Chez l'autre" }, now);
    for (const source of ["owner", "guest"] as const) {
      assert.deepEqual(await seanceVisitorFacts(db, other.proId, w.occ.id, { customerId: w.customerId, source }, now), empty, `${source}: my customer, my séance, their pro`);
      assert.deepEqual(await seanceVisitorFacts(db, pro.proId, theirs.occurrences[0].id, { customerId: w.customerId, source }, now), empty, `${source}: their séance`);
      assert.deepEqual(await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: theirCustomer, source }, now), empty, `${source}: their customer`);
      assert.deepEqual(await seanceVisitorFacts(db, other.proId, theirs.occurrences[0].id, { customerId: w.customerId, source }, now), empty, `${source}: my customer at their séance`);
    }
    assert.equal((await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: w.customerId, source: "owner" }, now)).booking?.status, "confirmed");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────────────────── livePendingHoldsOf ───────────────────────── */

dbTest("livePendingHoldsOf: the holds anonymous requests started with her address, soonest end first, and nothing else (SEC-I6)", async ({ db, pro }) => {
  const h = { db, pro };
  const w = await world(h);
  const second = await makeEvent(db, pro, { title: "Altinha intermédiaires", ticketTypeIds: [w.typeId], rule: { startDate: dayIn(pro, 4) } });
  const now = new Date();
  const holdA = await buyAndBook(h, w, now);
  const holdB = await buyAndBook(h, w, addMinutes(now, 5), { occurrenceId: second.occurrences[0].id, startsAt: second.occurrences[0].startsAt });
  // Somebody else's hold on the same séance is not hers.
  const stranger = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await buyAndBook(h, w, now, { customerId: stranger });

  const listed = await livePendingHoldsOf(db, pro.proId, w.customerId, addMinutes(now, 6));
  assert.deepEqual(
    listed.map((x) => [x.purchaseId, x.occurrenceId, x.title]),
    [
      [holdA.purchaseId, w.occ.id, "Altinha débutants"],
      [holdB.purchaseId, second.occurrences[0].id, "Altinha intermédiaires"],
    ],
  );
  assert.deepEqual(listed.map((x) => x.holdExpiresAt), [addMinutes(now, 45), addMinutes(now, 50)]);
  assert.deepEqual(listed.map((x) => x.startsAt), [w.occ.startsAt, second.occurrences[0].startsAt]);

  // The first hold has lapsed after 45 minutes, the second after 50.
  assert.deepEqual((await livePendingHoldsOf(db, pro.proId, w.customerId, addMinutes(now, 46))).map((x) => x.purchaseId), [holdB.purchaseId]);
  assert.deepEqual(await livePendingHoldsOf(db, pro.proId, w.customerId, addMinutes(now, 51)), []);

  // A released hold goes; the stranger's customer has its own list.
  const released = await releasePurchase(db, holdB.purchaseId, addMinutes(now, 10));
  assert.ok(released.ok, JSON.stringify(released));
  assert.deepEqual((await livePendingHoldsOf(db, pro.proId, w.customerId, addMinutes(now, 11))).map((x) => x.purchaseId), [holdA.purchaseId]);
  assert.equal((await livePendingHoldsOf(db, pro.proId, stranger, addMinutes(now, 11))).length, 1);
});

dbTest("livePendingHoldsOf: a confirmed booking is not a hold, another pro's id lists nothing", async ({ db, pro }) => {
  const w = await world({ db, pro });
  const now = new Date();
  await giveTickets(db, pro, w.customerId, w.typeId, 1);
  const booked = await bookWithHeldTicket(
    db,
    { professionalId: pro.proId, occurrenceId: w.occ.id, customerId: w.customerId, seenStartsAt: w.occ.startsAt, actorUserId: pro.userId },
    now,
  );
  assert.ok(booked.ok, JSON.stringify(booked));
  assert.deepEqual(await livePendingHoldsOf(db, pro.proId, w.customerId, now), []);

  const h = { db, pro };
  const holder = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await buyAndBook(h, w, now, { customerId: holder });
  const other = await createTestPro(db);
  try {
    assert.equal((await livePendingHoldsOf(db, pro.proId, holder, now)).length, 1);
    assert.deepEqual(await livePendingHoldsOf(db, other.proId, holder, now), [], "another pro's id");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────────────────── SEC-C1 ───────────────────────── */

dbTest("a ?p= reference carries its own purchase and booking only: the victim's later hold on the same séance stays hidden (SEC-C1)", async ({ db, pro }) => {
  const h = { db, pro };
  const w = await world(h);
  const now = new Date();

  // The attacker types the victim's address, starts a purchase P, and lets it go.
  const attack = await buyAndBook(h, w, now);
  const attackSession = await attachCheckoutSession(db, { purchaseId: attack.purchaseId, checkoutSessionId: "cs_attacker", checkoutUrl: "https://checkout.test/attacker" }, now);
  assert.ok(attackSession.ok);
  const released = await releasePurchase(db, attack.purchaseId, addMinutes(now, 1));
  assert.ok(released.ok && released.released, JSON.stringify(released));

  // The victim then holds her own seat on the same séance.
  const mine = await buyAndBook(h, w, addMinutes(now, 2));
  const mineSession = await attachCheckoutSession(db, { purchaseId: mine.purchaseId, checkoutSessionId: "cs_victim", checkoutUrl: "https://checkout.test/victim" }, addMinutes(now, 2));
  assert.ok(mineSession.ok);
  const at = addMinutes(now, 3);
  const page = { kind: "seance", occurrenceId: w.occ.id } as const;

  const ref = await purchaseByReference(db, pro.proId, attack.purchaseId, at);
  assert.ok(ref);
  const view = referenceForPage(ref, page, null);
  assert.ok(view);
  assert.equal(view.purchaseId, attack.purchaseId);
  assert.deepEqual(view.booking, { occurrenceId: w.occ.id, status: "expired" }, "its own booking, which ended");
  assert.deepEqual([view.status, view.resumeUrl], ["expired", null]);
  assert.deepEqual(Object.keys(view).sort(), ["booking", "holdExpiresAt", "kind", "livemode", "processing", "purchaseId", "resumeUrl", "status"], "no customerId, no balance");
  const text = JSON.stringify(view);
  for (const secret of [mine.purchaseId, mine.bookingId, "https://checkout.test/victim", w.customerId]) {
    assert.equal(text.includes(secret), false, `the view leaks ${secret}`);
  }

  // The viewer of that reference is the reference: the page never asks the facts of a customer for it.
  assert.deepEqual(seanceViewerOf({ visitor: ANONYMOUS, reference: view }), { kind: "reference", reference: view });

  // The victim's own reference shows her own purchase, and only hers.
  const ownRef = await purchaseByReference(db, pro.proId, mine.purchaseId, at);
  const own = referenceForPage(ownRef, page, null);
  assert.deepEqual([own?.purchaseId, own?.status, own?.resumeUrl], [mine.purchaseId, "pending", "https://checkout.test/victim"]);
  assert.equal(JSON.stringify(own).includes(attack.purchaseId), false);

  // Another séance, another pro: the reference shows nothing.
  const other = await makeEvent(db, pro, { title: "Altinha intermédiaires", rule: { startDate: dayIn(pro, 4) } });
  assert.equal(referenceForPage(ref, { kind: "seance", occurrenceId: other.occurrences[0].id }, null), null);
  const stranger = await createTestPro(db);
  try {
    assert.equal(await purchaseByReference(db, stranger.proId, attack.purchaseId, at), null);
  } finally {
    await deleteTestUser(db, stranger.userId);
  }
});

/* ───────────────────────── tenancy with hand-built crossed rows (S6, G3b) ───────────────────────── */

dbTest("getPublicSeance: séances that cross two pros, built by hand, are on neither page, and another pro's time off is not mine (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const handBuilt: string[] = [];
  try {
    const mine = await makeEvent(db, pro, { title: "Altinha débutants" }, now);
    const theirs = await makeEvent(db, other, { title: "Chez l'autre" }, now);
    // Séances that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b, as the Task 23 reads): a séance of MY event written under
    // THEIR id (the occurrence filter refuses it on my page, the event filter on theirs) and a séance of THEIR event
    // written under MY id (the event filter refuses it on my page, the occurrence filter on theirs).
    const day = dayIn(pro, 20, now);
    const crossedAt = (owner: TestPro, eventId: string) =>
      rowSeance(db, owner, eventId, { startsAt: instantAt(day, 600, pro.tz), seriesDate: day }, now);
    const myEventTheirId = await crossedAt(other, mine.eventId);
    handBuilt.push(myEventTheirId);
    const theirEventMyId = await crossedAt(pro, theirs.eventId);
    handBuilt.push(theirEventMyId);
    for (const crossed of [myEventTheirId, theirEventMyId]) {
      assert.equal(await getPublicSeance(db, proOf(pro), crossed, now), null, `${crossed} on my page`);
      assert.equal(await getPublicSeance(db, proOf(other), crossed, now), null, `${crossed} on their page`);
    }

    // Another pro's time off over my séance is not mine: the page does not close it.
    await db.insert(timeOff).values({
      id: nanoid(),
      professionalId: other.proId,
      startAt: instantAt(dayIn(pro, 3, now), 0, pro.tz),
      endAt: instantAt(dayIn(pro, 4, now), 0, pro.tz),
      allDay: true,
      reason: null,
    });
    const got = await getPublicSeance(db, proOf(pro), mine.occurrences[0].id, now);
    assert.ok(got && got.kind === "seance", JSON.stringify(got));
    assert.equal(got.underTimeOff, false);
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of handBuilt) await db.delete(occurrence).where(eq(occurrence.id, id));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("getPublicSeance: offers and links that cross two pros, built by hand, never reach the séance's offers (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const offers: string[] = [];
  const links: { eventId: string; ticketTypeId: string }[] = [];
  try {
    const linked = await makeType(db, pro, { name: "Cours collectif" });
    const linkedOffer = await makeOffer(db, pro, linked, { quantity: 4, priceCents: 8500 });
    const unlinked = await makeType(db, pro, { name: "Stage d'été" });
    await makeOffer(db, pro, unlinked, { quantity: 1, priceCents: 9000 });
    const theirType = await makeType(db, other, { name: "Cours d'essai" });
    await makeOffer(db, other, theirType, { quantity: 1, priceCents: 3000 });
    const { eventId, occurrences } = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [linked] }, now);

    // Rows that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b), each refused by exactly one filter of the offers read:
    // an offer of MY linked type written under THEIR id (the offer's filter), THEIR type linked to MY event under MY id
    // with an offer of that type under MY id (the type's filter), and my own unlinked type linked to my event under
    // THEIR id, with its genuine offer (the link's filter).
    offers.push(await rowOffer(db, other, linked, { quantity: 2, priceCents: 4500 }, now));
    await rowLink(db, pro, eventId, theirType, now);
    links.push({ eventId, ticketTypeId: theirType });
    offers.push(await rowOffer(db, pro, theirType, { quantity: 3, priceCents: 6500 }, now));
    await rowLink(db, other, eventId, unlinked, now);
    links.push({ eventId, ticketTypeId: unlinked });

    const got = await getPublicSeance(db, proOf(pro), occurrences[0].id, now);
    assert.ok(got && got.kind === "seance", JSON.stringify(got));
    assert.deepEqual(got.offers.map((o) => o.offerId), [linkedOffer], "only the pro's own offers of the pro's own linked types");
    assert.deepEqual(got.acceptedTypes.map((t) => t.id), [linked]);
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of offers) await db.delete(ticketOffer).where(eq(ticketOffer.id, id));
    for (const l of links) {
      await db.delete(eventTicketType).where(and(eq(eventTicketType.eventId, l.eventId), eq(eventTicketType.ticketTypeId, l.ticketTypeId)));
    }
    await deleteTestUser(db, other.userId);
  }
});

dbTest("seanceVisitorFacts: bookings, tickets and séances that cross two pros, built by hand, give empty facts (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const w = await world({ db, pro });
  const other = await createTestPro(db);
  const bookings: string[] = [];
  const tickets: string[] = [];
  const links: { eventId: string; ticketTypeId: string }[] = [];
  try {
    const theirs = await makeEvent(db, other, { title: "Chez l'autre" }, now);
    const theirType = await makeType(db, other, { name: "Cours d'essai" });
    const theirCustomer = await makeCustomer(db, other, { name: "Chez l'autre" });
    const rafael = await makeCustomer(db, pro, { name: "Rafael Souza" });
    const marina = await makeCustomer(db, pro, { name: "Marina Costa" });
    const lucas = await makeCustomer(db, pro, { name: "Lucas Pereira" });
    const ines = await makeCustomer(db, pro, { name: "Ines Barbosa" });
    const book = async (owner: TestPro, args: Parameters<typeof rowBooking>[2]) => {
      bookings.push(await rowBooking(db, owner, args, now));
    };

    // Rows that cross the two pros, built by hand on purpose (every domain foreign key is single-column, and
    // activeBookingOf and usableTickets take no professional, so only this read's own professional filters keep them
    // out; G3b), each refused by exactly one filter:
    await book(pro, { occurrenceId: w.occ.id, customerId: theirCustomer, status: "confirmed" }); // THEIR customer booked on MY séance under MY id (the customer check)
    await book(other, { occurrenceId: w.occ.id, customerId: rafael, status: "confirmed" }); // MY customer booked on MY séance under THEIR id (the booking filter)
    await book(other, { occurrenceId: w.occ.id, customerId: marina, status: "cancelled" }); // the same, ended (the ended-state filter)
    await book(pro, { occurrenceId: theirs.occurrences[0].id, customerId: lucas, status: "confirmed" }); // MY customer booked on THEIR séance under MY id (the séance check)
    // MY customer holds a ticket of THEIR type under MY id, and MY event accepts that type under MY id (the type name filter).
    await rowLink(db, pro, w.eventId, theirType, now);
    links.push({ eventId: w.eventId, ticketTypeId: theirType });
    tickets.push(await rowTicket(db, pro, { customerId: ines, ticketTypeId: theirType, movements: false }, now));

    const empty = { booking: null, ended: null, usable: null };
    for (const source of ["owner", "guest"] as const) {
      for (const [label, occurrenceId, customerId] of [
        ["their customer on my séance", w.occ.id, theirCustomer],
        ["my customer, booked under their id", w.occ.id, rafael],
        ["my customer, cancelled under their id", w.occ.id, marina],
        ["my customer on their séance", theirs.occurrences[0].id, lucas],
        ["my customer with their type's ticket", w.occ.id, ines],
      ] as const) {
        assert.deepEqual(await seanceVisitorFacts(db, pro.proId, occurrenceId, { customerId, source }, now), empty, `${source}: ${label}`);
      }
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of bookings) await db.delete(booking).where(eq(booking.id, id));
    for (const id of tickets) await db.delete(ticket).where(eq(ticket.id, id));
    for (const l of links) {
      await db.delete(eventTicketType).where(and(eq(eventTicketType.eventId, l.eventId), eq(eventTicketType.ticketTypeId, l.ticketTypeId)));
    }
    await deleteTestUser(db, other.userId);
  }
});

dbTest("livePendingHoldsOf: holds that cross two pros, built by hand, are never listed, nor with a title that is not the pro's (S6, G3b)", async ({ db, pro }) => {
  const now = new Date();
  const h = { db, pro };
  const w = await world(h);
  const other = await createTestPro(db);
  const bookings: string[] = [];
  const purchases: string[] = [];
  const occurrences: string[] = [];
  try {
    const theirs = await makeEvent(db, other, { title: "Chez l'autre" }, now);
    const theirType = await makeType(db, other, { name: "Cours d'essai" });
    const theirOffer = await makeOffer(db, other, theirType, { quantity: 1, priceCents: 3000 });
    // A genuine hold, so that the empty answers below are not a blanket one.
    const holder = await makeCustomer(db, pro, { name: "Rafael Souza" });
    const genuine = await buyAndBook(h, w, now, { customerId: holder });

    const day = (days: number) => dayIn(pro, days, now);
    const crossedSeance = async (owner: TestPro, eventId: string, days: number) => {
      const id = await rowSeance(db, owner, eventId, { startsAt: instantAt(day(days), 600, pro.tz), seriesDate: day(days) }, now);
      occurrences.push(id);
      return id;
    };
    /** A pending purchase of `customerId` written under `purchaseUnder`'s id and a pending booking of it written under `bookingUnder`'s id. */
    const hold = async (args: { customerId: string; occurrenceId: string; purchaseUnder: TestPro; bookingUnder: TestPro; offerId: string; ticketTypeId: string }) => {
      const purchaseId = await rowPurchase(
        db,
        args.purchaseUnder,
        { customerId: args.customerId, offerId: args.offerId, ticketTypeId: args.ticketTypeId },
        now,
      );
      purchases.push(purchaseId);
      bookings.push(
        await rowBooking(db, args.bookingUnder, { occurrenceId: args.occurrenceId, customerId: args.customerId, status: "pending", coverage: "ticket", purchaseId }, now),
      );
    };

    // Holds that cross the two pros, built by hand on purpose (every domain foreign key is single-column; G3b), each
    // refused by exactly one filter of livePendingHoldsOf, for five customers of mine:
    const viaBooking = await makeCustomer(db, pro, { name: "Marina Costa" });
    const viaPurchase = await makeCustomer(db, pro, { name: "Lucas Pereira" });
    const viaSeance = await makeCustomer(db, pro, { name: "Ines Barbosa" });
    const viaEvent = await makeCustomer(db, pro, { name: "Paulo Dias" });
    const viaType = await makeCustomer(db, pro, { name: "Clara Reis" });
    const mineOffer = { offerId: w.offerId, ticketTypeId: w.typeId };
    // the booking under THEIR id, on my séance, for my purchase (the booking filter)
    await hold({ customerId: viaBooking, occurrenceId: w.occ.id, purchaseUnder: pro, bookingUnder: other, ...mineOffer });
    // the purchase under THEIR id, the booking under MY id on my séance (the purchase filter)
    await hold({ customerId: viaPurchase, occurrenceId: w.occ.id, purchaseUnder: other, bookingUnder: pro, offerId: theirOffer, ticketTypeId: theirType });
    // my event's séance written under THEIR id (the séance filter: the event join alone would show it)
    await hold({ customerId: viaSeance, occurrenceId: await crossedSeance(other, w.eventId, 21), purchaseUnder: pro, bookingUnder: pro, ...mineOffer });
    // THEIR event's séance written under MY id (the event join: no title of another pro)
    await hold({ customerId: viaEvent, occurrenceId: await crossedSeance(pro, theirs.eventId, 22), purchaseUnder: pro, bookingUnder: pro, ...mineOffer });
    // an RDV of THEIR type written under MY id (the type join: no name of another pro's type)
    const rdv = await rowRdv(db, pro, theirType, {}, now);
    occurrences.push(rdv);
    await hold({ customerId: viaType, occurrenceId: rdv, purchaseUnder: pro, bookingUnder: pro, ...mineOffer });

    assert.deepEqual((await livePendingHoldsOf(db, pro.proId, holder, now)).map((x) => [x.purchaseId, x.title]), [[genuine.purchaseId, "Altinha débutants"]]);
    for (const [label, customerId] of [
      ["booking", viaBooking],
      ["purchase", viaPurchase],
      ["séance", viaSeance],
      ["event", viaEvent],
      ["type", viaType],
    ] as const) {
      assert.deepEqual(await livePendingHoldsOf(db, pro.proId, customerId, now), [], `crossed by the ${label}`);
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of bookings) await db.delete(booking).where(eq(booking.id, id));
    for (const id of purchases) await db.delete(ticketPurchase).where(eq(ticketPurchase.id, id));
    for (const id of occurrences) await db.delete(occurrence).where(eq(occurrence.id, id));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("the séance page reads carry the public fields only: the séance, its questions, its offers and the holds (G4a)", async ({ db, pro }) => {
  const h = { db, pro };
  const now = new Date();
  const w = await world(h);
  await db.insert(question).values({ professionalId: pro.proId, eventId: w.eventId, label: "Votre niveau ?", type: "text", required: false, position: 0 });
  const got = await getPublicSeance(db, proOf(pro), w.occ.id, now);
  assert.ok(got && got.kind === "seance", JSON.stringify(got));
  assert.deepEqual(keyPaths(got), [
    "acceptedTypes",
    "acceptedTypes[].color",
    "acceptedTypes[].id",
    "acceptedTypes[].name",
    "archived",
    "bookingMode",
    "capacity",
    "color",
    "description",
    "endsAt",
    "eventId",
    "isPrivate",
    "kind",
    "location",
    "occurrenceId",
    "offers",
    "offers[].covers",
    "offers[].label",
    "offers[].offerId",
    "offers[].priceCents",
    "offers[].quantity",
    "offers[].ticketTypeId",
    "offers[].ticketTypeName",
    "offers[].validityText",
    "questions",
    "questions[].id",
    "questions[].label",
    "questions[].options",
    "questions[].position",
    "questions[].required",
    "questions[].type",
    "seatsLeft",
    "startsAt",
    "status",
    "title",
    "underTimeOff",
    "window",
    "window.bookingHorizonDays",
    "window.cancelDeadlineHours",
    "window.minNoticeMinutes",
  ]);
  assert.deepEqual(privateKeyPaths(got), []);

  const started = await buyAndBook(h, w, now);
  const holds = await livePendingHoldsOf(db, pro.proId, w.customerId, now);
  assert.equal(holds[0]?.purchaseId, started.purchaseId);
  assert.deepEqual(keyPaths(holds[0]), ["holdExpiresAt", "occurrenceId", "purchaseId", "startsAt", "title"]);
  assert.deepEqual(privateKeyPaths(holds), []);
});

dbTest("seanceVisitorFacts (owner): a purchase written under another pro's id gives neither a purchase id nor a resume URL (S6, G4a)", async ({ db, pro }) => {
  const now = new Date();
  const w = await world({ db, pro });
  const other = await createTestPro(db);
  const bookings: string[] = [];
  const purchases: string[] = [];
  try {
    // A pending booking of the Owner's customer on my séance holding a purchase written under THEIR id, built by hand on
    // purpose (every domain foreign key is single-column): activeBookingOf's join is the only thing that keeps its id and
    // its open Checkout URL out of the Owner's facts.
    const crossed = await rowPurchase(db, other, { customerId: w.customerId, offerId: w.offerId, ticketTypeId: w.typeId }, now);
    purchases.push(crossed);
    await db
      .update(ticketPurchase)
      .set({ checkoutSessionId: `cs_test_${crossed}`, checkoutUrl: "https://checkout.test/crossed" })
      .where(eq(ticketPurchase.id, crossed));
    const bookingId = await rowBooking(db, pro, { occurrenceId: w.occ.id, customerId: w.customerId, status: "pending", coverage: "ticket", purchaseId: crossed }, now);
    bookings.push(bookingId);

    for (const source of ["owner", "guest"] as const) {
      const facts = await seanceVisitorFacts(db, pro.proId, w.occ.id, { customerId: w.customerId, source }, now);
      assert.deepEqual(facts.booking, { bookingId, status: "pending", coverage: "ticket", purchaseId: null, resumeUrl: null }, source);
      assert.equal(JSON.stringify(facts).includes("checkout.test"), false, source);
      assert.equal(JSON.stringify(facts).includes(crossed), false, source);
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of bookings) await db.delete(booking).where(eq(booking.id, id));
    for (const id of purchases) await db.delete(ticketPurchase).where(eq(ticketPurchase.id, id));
    await deleteTestUser(db, other.userId);
  }
});
