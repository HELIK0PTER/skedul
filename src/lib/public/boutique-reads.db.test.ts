import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { event, eventTicketType, ticketOffer } from "@/lib/db/schema";
import { createTestPro, dbTest, deleteTestUser } from "@/test/db";
import { dayIn, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { rowEvent, rowLink, rowOffer, rowType } from "@/test/rows";

import { acceptedByTitles, listBoutique } from "./boutique-reads";

dbTest("listBoutique: the offers on sale by type, with their label, price, validity and the events that accept them", async ({ db, pro }) => {
  const collectif = await makeType(db, pro, { name: "Cours collectif", description: "Les cours en groupe.", color: "#22c55e" });
  const unite = await makeOffer(db, pro, collectif, { quantity: 1, priceCents: 2500 });
  const carnet = await makeOffer(db, pro, collectif, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const nomme = await makeOffer(db, pro, collectif, { label: "Carnet de 10 (6 mois)", quantity: 10, priceCents: 19000, validityCount: 6, validityUnit: "month" });
  const stage = await makeType(db, pro, { name: "Stage d'été" });
  const stageOffer = await makeOffer(db, pro, stage, { quantity: 1, priceCents: 12000, validityCount: 30, validityUnit: "day" });
  await makeEvent(db, pro, { title: "Altinha intermédiaires", ticketTypeIds: [collectif] });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [collectif] });

  const boutique = await listBoutique(db, pro.proId);
  assert.deepEqual(
    boutique.map((t) => [t.ticketTypeId, t.name, t.description, t.color, t.acceptedBy]),
    [
      [collectif, "Cours collectif", "Les cours en groupe.", "#22c55e", ["Altinha débutants", "Altinha intermédiaires"]],
      [stage, "Stage d'été", null, "#6366f1", []],
    ],
    "types by position; acceptedBy in French alphabetical order; a type no event accepts has an empty line",
  );
  assert.deepEqual(boutique[0].offers, [
    { offerId: unite, label: "À l'unité", quantity: 1, priceCents: 2500, validityText: null },
    { offerId: carnet, label: "Carnet de 4", quantity: 4, priceCents: 8500, validityText: "3 mois" },
    { offerId: nomme, label: "Carnet de 10 (6 mois)", quantity: 10, priceCents: 19000, validityText: "6 mois" },
  ]);
  assert.deepEqual(boutique[1].offers, [{ offerId: stageOffer, label: "À l'unité", quantity: 1, priceCents: 12000, validityText: "30 jours" }]);
});

dbTest("listBoutique: archived and free types, inactive and archived offers, types without an offer on sale are left out", async ({ db, pro }) => {
  const open = await makeType(db, pro, { name: "Cours collectif" });
  const onSale = await makeOffer(db, pro, open, { quantity: 4, priceCents: 8500 });
  const inactive = await makeOffer(db, pro, open, { quantity: 10, priceCents: 19000, isActive: false });
  const archivedOffer = await makeOffer(db, pro, open, { quantity: 2, priceCents: 4500 });
  await db.update(ticketOffer).set({ archivedAt: new Date() }).where(eq(ticketOffer.id, archivedOffer));

  const archivedType = await makeType(db, pro, { name: "Ancien type" });
  await makeOffer(db, pro, archivedType, { quantity: 1, priceCents: 2000 });
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archivedType, archived: true });
  assert.ok(archived.ok, JSON.stringify(archived));

  const free = await rowType(db, pro, { name: "Cours gratuit", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  await rowOffer(db, pro, free);
  await makeType(db, pro, { name: "Sans offre" });
  const onlyInactive = await makeType(db, pro, { name: "Seulement inactive" });
  await makeOffer(db, pro, onlyInactive, { quantity: 1, priceCents: 1000, isActive: false });

  const boutique = await listBoutique(db, pro.proId);
  assert.deepEqual(boutique.map((t) => [t.name, t.offers.map((o) => o.offerId)]), [["Cours collectif", [onSale]]]);
  assert.equal(boutique[0].offers.some((o) => o.offerId === inactive), false);
});

dbTest("listBoutique: acceptedBy lists public tickets-mode events only, one title per series", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500 });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId], rule: { startDate: dayIn(pro, 5) } });
  await makeEvent(db, pro, { title: "Équipe compétition", isPrivate: true, ticketTypeIds: [typeId] });
  const archivedEvent = await makeEvent(db, pro, { title: "Atelier archivé", ticketTypeIds: [typeId] });
  await db.update(event).set({ archivedAt: new Date() }).where(eq(event.id, archivedEvent.eventId));
  // A free event that still carries the link accepts no ticket.
  const roda = await rowEvent(db, pro, { bookingMode: "free" });
  await rowLink(db, pro, roda, typeId);
  await db.update(event).set({ title: "Roda libre" }).where(eq(event.id, roda));

  const [type] = await listBoutique(db, pro.proId);
  assert.deepEqual(type.acceptedBy, ["Altinha débutants"], "duplicate titles collapse; private, archived and free events are not listed");
  assert.deepEqual([...(await acceptedByTitles(db, pro.proId, [typeId]))], [[typeId, ["Altinha débutants"]]]);
  assert.deepEqual([...(await acceptedByTitles(db, pro.proId, []))], []);
});

dbTest("listBoutique: another pro's types, offers and events are never listed", async ({ db, pro }) => {
  const mine = await makeType(db, pro, { name: "Cours collectif" });
  const myOffer = await makeOffer(db, pro, mine, { quantity: 4, priceCents: 8500 });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [mine] });
  const other = await createTestPro(db);
  try {
    const theirs = await makeType(db, other, { name: "Cours collectif" });
    const theirOffer = await makeOffer(db, other, theirs, { quantity: 1, priceCents: 3000 });
    await makeEvent(db, other, { title: "Chez l'autre", ticketTypeIds: [theirs] });

    const boutique = await listBoutique(db, pro.proId);
    assert.deepEqual(boutique.map((t) => [t.ticketTypeId, t.offers.map((o) => o.offerId), t.acceptedBy]), [[mine, [myOffer], ["Altinha débutants"]]]);
    const their = await listBoutique(db, other.proId);
    assert.deepEqual(their.map((t) => [t.ticketTypeId, t.offers.map((o) => o.offerId), t.acceptedBy]), [[theirs, [theirOffer], ["Chez l'autre"]]]);
    // Asking for my type with their pro id (or the other way round) finds nothing.
    assert.deepEqual([...(await acceptedByTitles(db, other.proId, [mine]))], []);
    assert.deepEqual([...(await acceptedByTitles(db, pro.proId, [theirs]))], []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("acceptedByTitles: links that cross two pros, built by hand, never advertise an event under another pro's type (S6, G3b)", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const handBuilt: { eventId: string; ticketTypeId: string }[] = [];
  try {
    const mine = await makeType(db, pro, { name: "Cours collectif" });
    await makeOffer(db, pro, mine, { quantity: 4, priceCents: 8500 });
    const theirs = await makeType(db, other, { name: "Cours d'essai" });
    await makeOffer(db, other, theirs, { quantity: 1, priceCents: 3000 });
    const myEvent = await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [mine] });
    const theirEvent = await makeEvent(db, other, { title: "Chez l'autre", ticketTypeIds: [theirs] });
    // Links that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b, the way my-space.db.test.ts builds them). MY event linked to
    // THEIR type under THEIR id: on their page only the inner event filter refuses it, on mine only the link filter.
    // THEIR event linked to MY type under MY id: the same, the other way round.
    await rowLink(db, other, myEvent.eventId, theirs);
    handBuilt.push({ eventId: myEvent.eventId, ticketTypeId: theirs });
    await rowLink(db, pro, theirEvent.eventId, mine);
    handBuilt.push({ eventId: theirEvent.eventId, ticketTypeId: mine });

    assert.deepEqual([...(await acceptedByTitles(db, pro.proId, [mine, theirs]))], [[mine, ["Altinha débutants"]]]);
    assert.deepEqual([...(await acceptedByTitles(db, other.proId, [mine, theirs]))], [[theirs, ["Chez l'autre"]]]);
    // And on the two Boutique pages.
    assert.deepEqual((await listBoutique(db, pro.proId)).map((t) => [t.ticketTypeId, t.acceptedBy]), [[mine, ["Altinha débutants"]]]);
    assert.deepEqual((await listBoutique(db, other.proId)).map((t) => [t.ticketTypeId, t.acceptedBy]), [[theirs, ["Chez l'autre"]]]);
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const l of handBuilt) {
      await db.delete(eventTicketType).where(and(eq(eventTicketType.eventId, l.eventId), eq(eventTicketType.ticketTypeId, l.ticketTypeId)));
    }
    await deleteTestUser(db, other.userId);
  }
});

dbTest("listBoutique: offers that cross two pros, built by hand, never reach the other pro's Boutique (S6, G3b)", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const handBuilt: string[] = [];
  try {
    const mine = await makeType(db, pro, { name: "Cours collectif" });
    const myOffer = await makeOffer(db, pro, mine, { quantity: 4, priceCents: 8500 });
    const theirs = await makeType(db, other, { name: "Cours d'essai" });
    const theirOffer = await makeOffer(db, other, theirs, { quantity: 1, priceCents: 3000 });
    // Offers that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b): an offer of MY type written under THEIR id (the offer filter
    // refuses it on my page, the type filter on theirs), and an offer of THEIR type written under MY id (the type
    // filter refuses it on my page, the offer filter on theirs).
    handBuilt.push(await rowOffer(db, other, mine, { quantity: 2, priceCents: 4500 }));
    handBuilt.push(await rowOffer(db, pro, theirs, { quantity: 3, priceCents: 6500 }));

    const offersOf = async (professionalId: string) =>
      (await listBoutique(db, professionalId)).map((t) => [t.ticketTypeId, t.offers.map((o) => o.offerId)]);
    assert.deepEqual(await offersOf(pro.proId), [[mine, [myOffer]]]);
    assert.deepEqual(await offersOf(other.proId), [[theirs, [theirOffer]]]);
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of handBuilt) await db.delete(ticketOffer).where(eq(ticketOffer.id, id));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("listBoutique: a pro with nothing on sale has an empty Boutique", async ({ db, pro }) => {
  assert.deepEqual(await listBoutique(db, pro.proId), []);
});
