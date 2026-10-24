import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { event, ticketOffer } from "@/lib/db/schema";
import { createTestPro, dbTest, deleteTestUser } from "@/test/db";
import { makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { keyPaths, privateKeyPaths } from "@/test/key-paths";
import { rowEvent, rowLink, rowOffer, rowType } from "@/test/rows";

import { getPublicOffer } from "./offer-reads";

dbTest("getPublicOffer: an active offer of an open type is on sale, with its type, price, validity and the events that accept it", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif", description: "Les cours en groupe.", color: "#22c55e" });
  const carnet = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const named = await makeOffer(db, pro, typeId, { label: "Carnet de 10 (6 mois)", quantity: 10, priceCents: 19000 });
  await makeEvent(db, pro, { title: "Altinha intermédiaires", ticketTypeIds: [typeId] });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [typeId] });
  await makeEvent(db, pro, { title: "Équipe compétition", isPrivate: true, ticketTypeIds: [typeId] });

  assert.deepEqual(await getPublicOffer(db, pro.proId, carnet), {
    kind: "on_sale",
    offerId: carnet,
    ticketTypeId: typeId,
    ticketTypeName: "Cours collectif",
    typeDescription: "Les cours en groupe.",
    color: "#22c55e",
    label: "Carnet de 4",
    quantity: 4,
    priceCents: 8500,
    validityText: "3 mois",
    acceptedBy: ["Altinha débutants", "Altinha intermédiaires"],
  });
  const second = await getPublicOffer(db, pro.proId, named);
  assert.ok(second && second.kind === "on_sale");
  assert.deepEqual([second.label, second.validityText], ["Carnet de 10 (6 mois)", null]);
});

dbTest("getPublicOffer: acceptedBy leaves out archived and free events, and is empty for a type nobody accepts", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 2500 });
  const archivedEvent = await makeEvent(db, pro, { title: "Atelier archivé", ticketTypeIds: [typeId] });
  await db.update(event).set({ archivedAt: new Date() }).where(eq(event.id, archivedEvent.eventId));
  const roda = await rowEvent(db, pro, { bookingMode: "free" });
  await rowLink(db, pro, roda, typeId);
  const none = await getPublicOffer(db, pro.proId, offerId);
  assert.ok(none && none.kind === "on_sale");
  assert.deepEqual(none.acceptedBy, []);
});

dbTest("getPublicOffer: an inactive, archived or archived-type offer, and the offer of a free type, are unavailable and say nothing", async ({ db, pro }) => {
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const inactive = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 2500, isActive: false });
  const archivedOffer = await makeOffer(db, pro, typeId, { quantity: 2, priceCents: 4500 });
  await db.update(ticketOffer).set({ archivedAt: new Date() }).where(eq(ticketOffer.id, archivedOffer));
  const archivedType = await makeType(db, pro, { name: "Ancien type" });
  const ofArchivedType = await makeOffer(db, pro, archivedType, { quantity: 1, priceCents: 2000 });
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archivedType, archived: true });
  assert.ok(archived.ok, JSON.stringify(archived));
  const free = await rowType(db, pro, { name: "Cours gratuit", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const ofFreeType = await rowOffer(db, pro, free);

  for (const offerId of [inactive, archivedOffer, ofArchivedType, ofFreeType]) {
    assert.deepEqual(await getPublicOffer(db, pro.proId, offerId), { kind: "unavailable" }, offerId);
  }
});

dbTest("getPublicOffer: another pro's offer, an unknown id and a malformed id are null", async ({ db, pro }) => {
  const mine = await makeOffer(db, pro, await makeType(db, pro, { name: "Cours collectif" }), { quantity: 4, priceCents: 8500 });
  const other = await createTestPro(db);
  try {
    const theirs = await makeOffer(db, other, await makeType(db, other, { name: "Cours collectif" }), { quantity: 1, priceCents: 3000 });
    assert.equal((await getPublicOffer(db, pro.proId, mine))?.kind, "on_sale");
    assert.equal((await getPublicOffer(db, other.proId, theirs))?.kind, "on_sale");
    assert.equal(await getPublicOffer(db, pro.proId, theirs), null, "their offer on my page");
    assert.equal(await getPublicOffer(db, other.proId, mine), null, "my offer on their page");
    for (const bad of ["inconnu", "", "x".repeat(65)]) {
      assert.equal(await getPublicOffer(db, pro.proId, bad), null, JSON.stringify(bad));
    }
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("getPublicOffer: offers that cross two pros, built by hand, are on neither page (S6, G3b)", async ({ db, pro }) => {
  const other = await createTestPro(db);
  const handBuilt: string[] = [];
  try {
    const mine = await makeType(db, pro, { name: "Cours collectif" });
    const theirs = await makeType(db, other, { name: "Cours d'essai" });
    // Offers that cross the two pros, built by hand on purpose (every domain foreign key is single-column, so only the
    // read's own professional filters keep them out; G3b, as the Task 23 reads): an offer of MY type written under
    // THEIR id (the offer's filter refuses it on my page, the type's filter on theirs) and an offer of THEIR type
    // written under MY id (the type's filter refuses it on my page, the offer's filter on theirs).
    const myTypeTheirId = await rowOffer(db, other, mine, { quantity: 2, priceCents: 4500 });
    handBuilt.push(myTypeTheirId);
    const theirTypeMyId = await rowOffer(db, pro, theirs, { quantity: 3, priceCents: 6500 });
    handBuilt.push(theirTypeMyId);

    for (const crossed of [myTypeTheirId, theirTypeMyId]) {
      assert.equal(await getPublicOffer(db, pro.proId, crossed), null, `${crossed} on my page`);
      assert.equal(await getPublicOffer(db, other.proId, crossed), null, `${crossed} on their page`);
    }
  } finally {
    // The hand-built rows go before the invariant check (and before the other pro): they are not part of any model.
    for (const id of handBuilt) await db.delete(ticketOffer).where(eq(ticketOffer.id, id));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("getPublicOffer: an offer on sale carries the public fields only, an unavailable one says nothing but its kind (G4a)", async ({ db, pro }) => {
  const type = await makeType(db, pro, { name: "Cours collectif", description: "Les cours en groupe." });
  const carnet = await makeOffer(db, pro, type, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const closed = await makeOffer(db, pro, type, { quantity: 10, priceCents: 19000, isActive: false });
  await makeEvent(db, pro, { title: "Altinha débutants", ticketTypeIds: [type] });

  const onSale = await getPublicOffer(db, pro.proId, carnet);
  assert.deepEqual(keyPaths(onSale), [
    "acceptedBy",
    "color",
    "kind",
    "label",
    "offerId",
    "priceCents",
    "quantity",
    "ticketTypeId",
    "ticketTypeName",
    "typeDescription",
    "validityText",
  ]);
  assert.deepEqual(privateKeyPaths(onSale), []);
  assert.deepEqual(keyPaths(await getPublicOffer(db, pro.proId, closed)), ["kind"]);
});
