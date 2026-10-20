import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  CONVERT_SAME_TYPE,
  CONVERT_TARGET_UNAVAILABLE,
  EXPIRY_IN_PAST,
  OFFER_RDV_FREE,
  closeTicketsCore,
  convertTicketsCore,
  createCustomerCore,
  offerTicketsCore,
  pointTicketsCore,
  retireTicketsCore,
  revokeLinksCore,
  unpointTicketsCore,
  updateCustomerCore,
} from "@/lib/back-office/client-actions";
import type { ActionFail, CoreResult } from "@/lib/back-office/result";
import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { checkInvariants } from "@/lib/booking/invariants";
import { addDays, instantAt, todayKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { customer, ticket, ticketMovement } from "@/lib/db/schema";
import { ENGINE_ERROR_MESSAGES, type EngineErrorCode } from "@/lib/tickets";
import { createTestPro, dbTest, deleteTestUser, testEmail, type DbHarness } from "@/test/db";
import { giveTickets, makeCustomer, makeOffer, makeType, movementsOf, ticketsOf } from "@/test/fixtures";
import { proCtx } from "@/test/pro-ctx";

const NO_TICKET = "Pas assez de tickets pour cette action : rafraîchissez la page.";
const TICKET_NOT_FOUND = "Ticket ou type introuvable.";
const CLIENT_NOT_FOUND = "Client introuvable.";

function must<T extends object>(res: CoreResult<T>): Extract<CoreResult<T>, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<CoreResult<T>, { ok: true }>;
}

function errorOf(res: CoreResult<object>): string {
  assert.equal(res.ok, false, JSON.stringify(res));
  return res.ok ? "" : res.error;
}

async function customerRow(db: Db, id: string) {
  const [row] = await db.select().from(customer).where(eq(customer.id, id));
  assert.ok(row, `customer ${id}`);
  return row;
}

async function ticketRow(db: Db, id: string) {
  const [row] = await db.select().from(ticket).where(eq(ticket.id, id));
  assert.ok(row, `ticket ${id}`);
  return row;
}

async function movementReasons(db: Db, customerId: string) {
  return db
    .select({ kind: ticketMovement.kind, reason: ticketMovement.reason })
    .from(ticketMovement)
    .where(eq(ticketMovement.customerId, customerId))
    .orderBy(asc(ticketMovement.seq));
}

/** A paid purchase of `offerId`: startPurchase then fulfillPurchase, both at `now`. */
async function payOffer(h: DbHarness, customerId: string, offerId: string, now: Date): Promise<void> {
  const started = await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId }, now);
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;
  await fulfillPurchase(
    h.db,
    started.purchaseId,
    { sessionId: `cs_test_${nanoid()}`, paymentIntentId: `pi_test_${nanoid()}`, livemode: false },
    now,
  );
}

dbTest("createCustomerCore: French validation messages, nothing is created", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  assert.equal(errorOf(await createCustomerCore(db, ctx, { name: "Léa", email: "pas-un-email", phone: null }, now)), "Email : adresse email invalide.");
  assert.equal(errorOf(await createCustomerCore(db, ctx, { name: "   ", email: testEmail(), phone: null }, now)), "Nom : ce champ est obligatoire.");
  assert.equal(errorOf(await createCustomerCore(db, ctx, { name: "x".repeat(81), email: testEmail(), phone: null }, now)), "Nom : 80 caractères au maximum.");
  assert.equal(errorOf(await createCustomerCore(db, ctx, { name: "Léa", email: testEmail(), phone: "0".repeat(31) }, now)), "Téléphone : 30 caractères au maximum.");
  const rows = await db.select({ id: customer.id }).from(customer).where(eq(customer.professionalId, pro.proId));
  assert.equal(rows.length, 0);
});

dbTest("createCustomerCore: a new client, then an existing e-mail takes the pro's name and phone", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const email = testEmail();
  const first = must(
    await createCustomerCore(db, ctx, { name: "  Léa Martin ", email: ` ${email.toUpperCase()} `, phone: " 06 12 34 56 78 " }, now),
  );
  assert.equal(first.created, true);
  assert.deepEqual(first.effects, []);
  const row = await customerRow(db, first.customerId);
  assert.deepEqual(
    [row.name, row.email, row.phone, row.professionalId, row.linkVersion],
    ["Léa Martin", email, "06 12 34 56 78", pro.proId, 1],
  );

  // the same e-mail again: created false, the name is replaced, a missing phone keeps the old one
  const again = must(await createCustomerCore(db, ctx, { name: "Léa M.", email, phone: null }, now));
  assert.deepEqual([again.created, again.customerId], [false, first.customerId]);
  const after = await customerRow(db, first.customerId);
  assert.deepEqual([after.name, after.phone], ["Léa M.", "06 12 34 56 78"]);
  must(await createCustomerCore(db, ctx, { name: "Léa M.", email, phone: "07 00 00 00 00" }, now));
  assert.equal((await customerRow(db, first.customerId)).phone, "07 00 00 00 00");

  // another pro with the same e-mail has its own client
  const other = await createTestPro(db);
  try {
    const theirs = must(await createCustomerCore(db, proCtx(other), { name: "Chez l'autre", email, phone: null }, now));
    assert.equal(theirs.created, true);
    assert.notEqual(theirs.customerId, first.customerId);
    assert.equal((await customerRow(db, first.customerId)).name, "Léa M.");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("updateCustomerCore: name and phone only, the e-mail is the key", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const email = testEmail();
  const id = await makeCustomer(db, pro, { name: "Ancien nom", email });
  must(await updateCustomerCore(db, ctx, { customerId: id, name: " Nouveau nom ", phone: " 06 00 00 00 00 " }, now));
  const row = await customerRow(db, id);
  assert.deepEqual([row.name, row.phone, row.email], ["Nouveau nom", "06 00 00 00 00", email]);
  must(await updateCustomerCore(db, ctx, { customerId: id, name: "Nouveau nom", phone: "" }, now));
  assert.equal((await customerRow(db, id)).phone, null);
  must(await updateCustomerCore(db, ctx, { customerId: id, name: "Nouveau nom", phone: null }, now));

  assert.equal(errorOf(await updateCustomerCore(db, ctx, { customerId: id, name: "  ", phone: null }, now)), "Nom : ce champ est obligatoire.");
  assert.equal(errorOf(await updateCustomerCore(db, ctx, { customerId: id, name: "Nom", phone: "0".repeat(31) }, now)), "Téléphone : 30 caractères au maximum.");
  assert.equal(errorOf(await updateCustomerCore(db, ctx, { customerId: "no-such-customer", name: "Nom", phone: null }, now)), CLIENT_NOT_FOUND);
  assert.equal((await customerRow(db, id)).name, "Nouveau nom");
});

dbTest("revokeLinksCore: link_version + 1 each time", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const id = await makeCustomer(db, pro);
  assert.equal((await customerRow(db, id)).linkVersion, 1);
  const first = must(await revokeLinksCore(db, ctx, { customerId: id }, now));
  assert.deepEqual(first.effects, []);
  assert.equal((await customerRow(db, id)).linkVersion, 2);
  must(await revokeLinksCore(db, ctx, { customerId: id }, now));
  assert.equal((await customerRow(db, id)).linkVersion, 3);
  assert.equal(errorOf(await revokeLinksCore(db, ctx, { customerId: "no-such-customer" }, now)), CLIENT_NOT_FOUND);
});

dbTest("offerTicketsCore: refusals leave the wallet untouched", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const customerId = await makeCustomer(db, pro);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const freeId = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const archivedId = await makeType(db, pro, { name: "Stage d'été 2026" });
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archivedId, archived: true });
  assert.equal(archived.ok, true);
  const offer = (over: Partial<Parameters<typeof offerTicketsCore>[2]> = {}) =>
    offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 1, lastValidDay: null, reason: null, notify: false, ...over }, now);

  assert.equal(errorOf(await offer({ ticketTypeId: freeId })), OFFER_RDV_FREE);
  assert.equal(errorOf(await offer({ ticketTypeId: archivedId })), TICKET_NOT_FOUND);
  assert.equal(errorOf(await offer({ ticketTypeId: "no-such-type" })), TICKET_NOT_FOUND);
  assert.equal(errorOf(await offer({ lastValidDay: addDays(todayKey(now, pro.tz), -1) })), EXPIRY_IN_PAST);
  assert.equal(errorOf(await offer({ quantity: 0 })), "Quantité : minimum 1.");
  assert.equal(errorOf(await offer({ quantity: 101 })), "Quantité : maximum 100.");
  assert.equal(errorOf(await offer({ reason: "x".repeat(501) })), "Motif : 500 caractères au maximum.");
  assert.match(errorOf(await offer({ lastValidDay: "2026-13-45" })), /ate invalide\.$/);
  assert.deepEqual(await ticketsOf(db, customerId), []);
});

dbTest("offerTicketsCore: valid through the end of the chosen day in the pro's zone, notify adds an effect", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const customerId = await makeCustomer(db, pro);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const today = todayKey(now, pro.tz);

  const noLimit = must(
    await offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 3, lastValidDay: null, reason: "Cadeau", notify: false }, now),
  );
  assert.equal(noLimit.count, 3);
  assert.deepEqual(noLimit.effects, []);
  const todayOffer = must(
    await offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 1, lastValidDay: today, reason: null, notify: true }, now),
  );
  assert.equal(todayOffer.count, 1);
  assert.equal(todayOffer.effects.length, 1);
  const [effect] = todayOffer.effects;
  assert.ok(effect.type === "email.tickets_offered" && effect.customerId === customerId && effect.quantity === 1);

  const tickets = await ticketsOf(db, customerId);
  assert.equal(tickets.length, 4);
  assert.equal(tickets.filter((t) => t.expiresAt === null).length, 3);
  const limited = tickets.find((t) => t.expiresAt !== null);
  assert.equal(limited?.expiresAt?.getTime(), instantAt(addDays(today, 1), 0, pro.tz).getTime());
  assert.ok(tickets.every((t) => t.purchaseId === null && t.status === "available"));
  assert.deepEqual(
    (await movementReasons(db, customerId)).map((m) => [m.kind, m.reason]),
    [
      ["offer", "Cadeau"],
      ["offer", "Cadeau"],
      ["offer", "Cadeau"],
      ["offer", null],
    ],
  );

  // a pro in Los Angeles: the same day key ends at the next Los Angeles midnight
  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    const laType = await makeType(db, la, { name: "Cours LA" });
    const laCustomer = await makeCustomer(db, la);
    const laToday = todayKey(now, la.tz);
    must(
      await offerTicketsCore(db, proCtx(la), { customerId: laCustomer, ticketTypeId: laType, quantity: 1, lastValidDay: laToday, reason: null, notify: false }, now),
    );
    const [laTicket] = await ticketsOf(db, laCustomer);
    assert.equal(laTicket.expiresAt?.getTime(), instantAt(addDays(laToday, 1), 0, "America/Los_Angeles").getTime());
    assert.deepEqual(await checkInvariants(db, { proId: la.proId }), []);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("convertTicketsCore: same type, unavailable targets, purchase and expiry kept", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const typeA = await makeType(db, pro, { name: "Cours collectif" });
  const typeB = await makeType(db, pro, { name: "Cours particulier" });
  const typeFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const typeArchived = await makeType(db, pro, { name: "Stage d'été 2026" });
  const archived = await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: typeArchived, archived: true });
  assert.equal(archived.ok, true);
  const offerId = await makeOffer(db, pro, typeA, { quantity: 3, priceCents: 5000, validityCount: 1, validityUnit: "month" });
  const customerId = await makeCustomer(db, pro);
  await payOffer(h, customerId, offerId, now);
  const [offered] = await giveTickets(db, pro, customerId, typeA, 1);
  const paid = (await ticketsOf(db, customerId)).filter((t) => t.purchaseId !== null);
  assert.equal(paid.length, 3);
  assert.ok(paid.every((t) => t.expiresAt !== null));
  const convert = (ticketIds: string[], toTicketTypeId: string) =>
    convertTicketsCore(db, ctx, { customerId, ticketIds, toTicketTypeId }, now);

  assert.equal(errorOf(await convert([paid[0].id], typeA)), CONVERT_SAME_TYPE);
  assert.equal(errorOf(await convert([paid[0].id], typeFree)), CONVERT_TARGET_UNAVAILABLE);
  assert.equal(errorOf(await convert([paid[0].id], typeArchived)), CONVERT_TARGET_UNAVAILABLE);
  assert.equal(errorOf(await convert([paid[0].id], "no-such-type")), CONVERT_TARGET_UNAVAILABLE);
  assert.match(errorOf(await convert([], typeB)), /hoisissez au moins un élément\.$/);
  assert.ok((await ticketsOf(db, customerId)).every((t) => t.ticketTypeId === typeA));

  const ok = must(await convert([paid[0].id, paid[1].id, paid[1].id], typeB)); // a repeated id counts once
  assert.equal(ok.count, 2);
  assert.deepEqual(ok.effects, []);
  const after = await ticketsOf(db, customerId);
  for (const before of [paid[0], paid[1]]) {
    const moved = after.find((t) => t.id === before.id);
    assert.ok(moved);
    assert.equal(moved.ticketTypeId, typeB);
    assert.equal(moved.purchaseId, before.purchaseId);
    assert.equal(moved.expiresAt?.getTime(), before.expiresAt?.getTime());
    assert.deepEqual(
      (await movementsOf(db, before.id)).map((m) => m.kind),
      ["purchase", "convert"],
    );
  }
  assert.equal(after.find((t) => t.id === paid[2].id)?.ticketTypeId, typeA);

  // one ticket of the selection already has the target type
  assert.equal(errorOf(await convert([paid[0].id, paid[2].id], typeB)), CONVERT_SAME_TYPE);
  // a ticket that is not available any more
  must(await pointTicketsCore(db, ctx, { customerId, ticketIds: [offered], note: null }, now));
  assert.equal(errorOf(await convert([offered], typeB)), NO_TICKET);
});

dbTest("closeTicketsCore: reasons, notes and the paid / offered rule", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 2, priceCents: 3000, validityCount: 1, validityUnit: "month" });
  const customerId = await makeCustomer(db, pro);
  await payOffer(h, customerId, offerId, now);
  const offered = await giveTickets(db, pro, customerId, typeId, 2);
  const paid = (await ticketsOf(db, customerId)).filter((t) => t.purchaseId !== null).map((t) => t.id);
  assert.equal(paid.length, 2);
  const close = (ticketIds: string[], reason: "rembourse" | "compense" | "autre", note: string | null) =>
    closeTicketsCore(db, ctx, { customerId, ticketIds, reason, note }, now);

  assert.equal(errorOf(await close([offered[0]], "rembourse", null)), "Un ticket offert se retire.");
  assert.equal(errorOf(await close([offered[0]], "compense", "geste")), "Un ticket offert se retire.");
  assert.equal(errorOf(await close([offered[0]], "autre", null)), "Précisez le motif.");
  assert.equal(errorOf(await close([offered[0]], "autre", "   ")), "Précisez le motif.");
  assert.equal(errorOf(await close([paid[0]], "retire" as never, null)), "Motif : choix invalide.");
  assert.equal(errorOf(await close([paid[0]], "autre", "x".repeat(501))), "Note : 500 caractères au maximum.");
  assert.ok((await ticketsOf(db, customerId)).every((t) => t.status === "available"));

  const refunded = must(await close([paid[0]], "rembourse", "Remboursé par virement"));
  assert.equal(refunded.count, 1);
  assert.deepEqual(refunded.effects, []);
  const refundedRow = await ticketRow(db, paid[0]);
  assert.deepEqual(
    [refundedRow.status, refundedRow.closedReason, refundedRow.closedNote],
    ["closed", "rembourse", "Remboursé par virement"],
  );
  assert.deepEqual(
    (await movementsOf(db, paid[0])).map((m) => m.kind),
    ["purchase", "close"],
  );
  must(await close([paid[1]], "compense", null));
  const compensatedRow = await ticketRow(db, paid[1]);
  assert.deepEqual([compensatedRow.status, compensatedRow.closedReason, compensatedRow.closedNote], ["closed", "compense", null]);
  must(await close([offered[0]], "autre", "geste commercial"));
  const otherRow = await ticketRow(db, offered[0]);
  assert.deepEqual([otherRow.status, otherRow.closedReason, otherRow.closedNote], ["closed", "autre", "geste commercial"]);

  // closed is final
  assert.equal(errorOf(await close([paid[0]], "autre", "encore")), NO_TICKET);
  assert.equal((await ticketRow(db, offered[1])).status, "available");
});

dbTest("retireTicketsCore: offered tickets only, a paid one points to « Clore »", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 3000 });
  const customerId = await makeCustomer(db, pro);
  await payOffer(h, customerId, offerId, now);
  const offered = await giveTickets(db, pro, customerId, typeId, 3);
  const [paid] = (await ticketsOf(db, customerId)).filter((t) => t.purchaseId !== null);
  const retire = (ticketIds: string[], note: string | null) => retireTicketsCore(db, ctx, { customerId, ticketIds, note }, now);

  assert.equal(errorOf(await retire([paid.id], "erreur")), "Un ticket payé ne peut pas être retiré : utilisez « Clore ».");
  assert.equal((await ticketRow(db, paid.id)).status, "available");

  const res = must(await retire([offered[0], offered[1]], "Cadeau en double"));
  assert.equal(res.count, 2);
  assert.deepEqual(res.effects, []);
  for (const id of [offered[0], offered[1]]) {
    const row = await ticketRow(db, id);
    assert.deepEqual([row.status, row.closedReason, row.closedNote], ["closed", "retire", "Cadeau en double"]);
  }
  must(await retire([offered[2]], null));
  const last = await ticketRow(db, offered[2]);
  assert.deepEqual([last.status, last.closedReason, last.closedNote], ["closed", "retire", null]);
  assert.equal((await ticketRow(db, paid.id)).status, "available");
});

dbTest("pointTicketsCore and unpointTicketsCore: explicit ids, a double submit changes nothing twice", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const customerId = await makeCustomer(db, pro);
  const [o1, o2, o3] = await giveTickets(db, pro, customerId, typeId, 3);
  const point = (ticketIds: string[], note: string | null) => pointTicketsCore(db, ctx, { customerId, ticketIds, note }, now);
  const unpoint = (ticketIds: string[]) => unpointTicketsCore(db, ctx, { customerId, ticketIds }, now);

  const res = must(await point([o1, o2], "Cours du jeudi"));
  assert.equal(res.count, 2);
  assert.deepEqual(res.effects, []);
  assert.deepEqual([(await ticketRow(db, o1)).status, (await ticketRow(db, o2)).status, (await ticketRow(db, o3)).status], ["used", "used", "available"]);
  assert.deepEqual(
    (await movementReasons(db, customerId)).filter((m) => m.kind === "pointage").map((m) => m.reason),
    ["Cours du jeudi", "Cours du jeudi"],
  );

  // the same request again (a double click): the tickets are already used, nothing moves twice
  assert.equal(errorOf(await point([o1, o2], "Cours du jeudi")), NO_TICKET);
  assert.deepEqual(
    (await movementsOf(db, o1)).map((m) => m.kind),
    ["offer", "pointage"],
  );
  assert.match(errorOf(await point([], null)), /hoisissez au moins un élément\.$/);
  assert.match(errorOf(await point(Array.from({ length: 101 }, (_, i) => `t${i}`), null)), /100 éléments au maximum\.$/);
  assert.equal(errorOf(await point([o3], "x".repeat(501))), "Note : 500 caractères au maximum.");
  assert.equal(must(await point([o3, o3], null)).count, 1); // a repeated id counts once

  const undone = must(await unpoint([o1, o2]));
  assert.equal(undone.count, 2);
  assert.deepEqual(undone.effects, []);
  assert.deepEqual([(await ticketRow(db, o1)).status, (await ticketRow(db, o2)).status], ["available", "available"]);
  assert.deepEqual(
    (await movementsOf(db, o1)).map((m) => m.kind),
    ["offer", "pointage", "unpoint"],
  );
  assert.equal(errorOf(await unpoint([o1, o2])), NO_TICKET);
  assert.equal((await movementsOf(db, o2)).length, 3);
});

dbTest("every client core refuses another pro's customer and tickets", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeMine = await makeType(db, pro, { name: "Cours collectif" });
  const mine = await makeCustomer(db, pro, { name: "Ma cliente" });
  const [myTicket] = await giveTickets(db, pro, mine, typeMine, 1);
  const other = await createTestPro(db);
  try {
    const typeTheirs = await makeType(db, other, { name: "Type de l'autre" });
    const theirs = await makeCustomer(db, other, { name: "Sa cliente" });
    const [theirTicket] = await giveTickets(db, other, theirs, typeTheirs, 1);
    const offerInput = { quantity: 1, lastValidDay: null, reason: null, notify: false };

    assert.equal(errorOf(await updateCustomerCore(db, ctx, { customerId: theirs, name: "Pirate", phone: "0600000000" }, now)), CLIENT_NOT_FOUND);
    assert.equal(errorOf(await revokeLinksCore(db, ctx, { customerId: theirs }, now)), CLIENT_NOT_FOUND);
    assert.equal(errorOf(await offerTicketsCore(db, ctx, { customerId: theirs, ticketTypeId: typeMine, ...offerInput }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await offerTicketsCore(db, ctx, { customerId: mine, ticketTypeId: typeTheirs, ...offerInput }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await convertTicketsCore(db, ctx, { customerId: theirs, ticketIds: [theirTicket], toTicketTypeId: typeMine }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await convertTicketsCore(db, ctx, { customerId: mine, ticketIds: [theirTicket], toTicketTypeId: typeMine }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await closeTicketsCore(db, ctx, { customerId: theirs, ticketIds: [theirTicket], reason: "autre", note: "x" }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await retireTicketsCore(db, ctx, { customerId: theirs, ticketIds: [theirTicket], note: null }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await pointTicketsCore(db, ctx, { customerId: mine, ticketIds: [theirTicket], note: null }, now)), TICKET_NOT_FOUND);
    assert.equal(errorOf(await unpointTicketsCore(db, ctx, { customerId: theirs, ticketIds: [theirTicket] }, now)), TICKET_NOT_FOUND);

    const theirRow = await customerRow(db, theirs);
    assert.deepEqual([theirRow.name, theirRow.phone, theirRow.linkVersion], ["Sa cliente", null, 1]);
    const theirTicketRow = await ticketRow(db, theirTicket);
    assert.deepEqual([theirTicketRow.status, theirTicketRow.ticketTypeId], ["available", typeTheirs]);
    const myTicketRow = await ticketRow(db, myTicket);
    assert.deepEqual([myTicketRow.status, myTicketRow.ticketTypeId], ["available", typeMine]);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────── Task 32 additions: SECURITY carries, double submits, wording, dates ───────────── */

function refusalOf(res: CoreResult<object>): ActionFail {
  assert.equal(res.ok, false, JSON.stringify(res));
  if (res.ok) throw new Error("unreachable");
  return res;
}

/** A refusal with its engine code kept, the exact pro text, and never the client wording of that code. */
function expectRefusal(res: CoreResult<object>, code: EngineErrorCode, text: string): void {
  const refusal = refusalOf(res);
  assert.equal(refusal.code, code);
  assert.equal(refusal.error, text);
  assert.notEqual(refusal.error, ENGINE_ERROR_MESSAGES[code], `${code} must not use the client wording`);
}

dbTest("smuggled professionalId, actorUserId and userId in any input are ignored", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const smuggled = { professionalId: other.proId, actorUserId: other.userId, userId: other.userId };
    const email = testEmail();

    // a client created by the pro never takes a user account from the input, new or existing
    const created = must(await createCustomerCore(db, ctx, { name: "Léa", email, phone: null, ...smuggled }, now));
    const customerId = created.customerId;
    const createdRow = await customerRow(db, customerId);
    assert.deepEqual([createdRow.professionalId, createdRow.userId], [pro.proId, null]);
    const again = must(await createCustomerCore(db, ctx, { name: "Léa", email, phone: null, ...smuggled }, now));
    assert.deepEqual([again.created, again.customerId], [false, customerId]);
    assert.equal((await customerRow(db, customerId)).userId, null);

    // every other core acts for ctx: a smuggled professionalId would not even find the client
    const typeA = await makeType(db, pro, { name: "Cours collectif" });
    const typeB = await makeType(db, pro, { name: "Cours particulier" });
    must(await updateCustomerCore(db, ctx, { customerId, name: "Léa M.", phone: null, ...smuggled }, now));
    must(await revokeLinksCore(db, ctx, { customerId, ...smuggled }, now));
    const row = await customerRow(db, customerId);
    assert.deepEqual([row.name, row.linkVersion, row.professionalId, row.userId], ["Léa M.", 2, pro.proId, null]);

    must(await offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeA, quantity: 6, lastValidDay: null, reason: null, notify: false, ...smuggled }, now));
    const ids = (await ticketsOf(db, customerId)).map((t) => t.id);
    assert.equal(ids.length, 6);
    must(await convertTicketsCore(db, ctx, { customerId, ticketIds: ids.slice(0, 1), toTicketTypeId: typeB, ...smuggled }, now));
    must(await pointTicketsCore(db, ctx, { customerId, ticketIds: ids.slice(1, 3), note: null, ...smuggled }, now));
    must(await unpointTicketsCore(db, ctx, { customerId, ticketIds: ids.slice(1, 2), ...smuggled }, now));
    must(await closeTicketsCore(db, ctx, { customerId, ticketIds: ids.slice(3, 4), reason: "autre", note: "geste", ...smuggled }, now));
    must(await retireTicketsCore(db, ctx, { customerId, ticketIds: ids.slice(4, 5), note: null, ...smuggled }, now));

    // 6 offers, 1 convert, 2 pointages, 1 unpoint, 1 close, 1 retire: all by this pro's user, none by the smuggled one
    const movements = await db
      .select({ actor: ticketMovement.actor, actorUserId: ticketMovement.actorUserId, professionalId: ticketMovement.professionalId })
      .from(ticketMovement)
      .where(eq(ticketMovement.customerId, customerId));
    assert.equal(movements.length, 12);
    assert.ok(
      movements.every((m) => m.actor === "pro" && m.actorUserId === pro.userId && m.professionalId === pro.proId),
      JSON.stringify(movements),
    );
    assert.ok((await ticketsOf(db, customerId)).every((t) => t.professionalId === pro.proId));

    // nothing was written for the other pro
    assert.deepEqual(await db.select({ id: customer.id }).from(customer).where(eq(customer.professionalId, other.proId)), []);
    assert.deepEqual(await db.select({ id: ticket.id }).from(ticket).where(eq(ticket.professionalId, other.proId)), []);
    assert.deepEqual(await db.select({ id: ticketMovement.id }).from(ticketMovement).where(eq(ticketMovement.professionalId, other.proId)), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("a ticket of another client of the same pro is refused by every wallet core", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeA = await makeType(db, pro, { name: "Cours collectif" });
  const typeB = await makeType(db, pro, { name: "Cours particulier" });
  const alice = await makeCustomer(db, pro, { name: "Alice" });
  const bob = await makeCustomer(db, pro, { name: "Bob" });
  const [aliceTicket] = await giveTickets(db, pro, alice, typeA, 1);
  const [bobTicket, bobUsed] = await giveTickets(db, pro, bob, typeA, 2);
  must(await pointTicketsCore(db, ctx, { customerId: bob, ticketIds: [bobUsed], note: null }, now));
  const before = [(await movementReasons(db, alice)).length, (await movementReasons(db, bob)).length];

  // Bob's tickets under Alice's record: the action must find them all in her wallet
  const attempts: [string, () => Promise<CoreResult<object>>][] = [
    ["convert", () => convertTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobTicket], toTicketTypeId: typeB }, now)],
    ["convert (same type as Bob's)", () => convertTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobTicket], toTicketTypeId: typeA }, now)],
    ["close", () => closeTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobTicket], reason: "autre", note: "x" }, now)],
    ["retire", () => retireTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobTicket], note: null }, now)],
    ["point", () => pointTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobTicket], note: null }, now)],
    ["unpoint", () => unpointTicketsCore(db, ctx, { customerId: alice, ticketIds: [bobUsed] }, now)],
    // one ticket of her own next to one of Bob's: the whole selection is refused
    ["point (mixed)", () => pointTicketsCore(db, ctx, { customerId: alice, ticketIds: [aliceTicket, bobTicket], note: null }, now)],
    ["retire (mixed)", () => retireTicketsCore(db, ctx, { customerId: alice, ticketIds: [aliceTicket, bobTicket], note: null }, now)],
  ];
  for (const [name, run] of attempts) assert.equal(errorOf(await run()), TICKET_NOT_FOUND, name);

  const rows = [await ticketRow(db, aliceTicket), await ticketRow(db, bobTicket), await ticketRow(db, bobUsed)];
  assert.deepEqual(
    rows.map((t) => [t.customerId, t.status, t.ticketTypeId]),
    [
      [alice, "available", typeA],
      [bob, "available", typeA],
      [bob, "used", typeA],
    ],
  );
  assert.deepEqual([(await movementReasons(db, alice)).length, (await movementReasons(db, bob)).length], before);
});

dbTest("another pro's ids are refused in every combination and nothing moves", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeMine = await makeType(db, pro, { name: "Cours collectif" });
  const typeMine2 = await makeType(db, pro, { name: "Cours particulier" });
  const mine = await makeCustomer(db, pro, { name: "Ma cliente" });
  const [myAvailable, myUsed] = await giveTickets(db, pro, mine, typeMine, 2);
  must(await pointTicketsCore(db, ctx, { customerId: mine, ticketIds: [myUsed], note: null }, now));
  const other = await createTestPro(db);
  try {
    const otherCtx = proCtx(other);
    const typeTheirs = await makeType(db, other, { name: "Type de l'autre" });
    const theirs = await makeCustomer(db, other, { name: "Sa cliente" });
    const [theirAvailable, theirUsed] = await giveTickets(db, other, theirs, typeTheirs, 2);
    must(await pointTicketsCore(db, otherCtx, { customerId: theirs, ticketIds: [theirUsed], note: null }, now));
    const before = [(await movementReasons(db, mine)).length, (await movementReasons(db, theirs)).length];

    // each core gets a ticket it WOULD accept if the ownership check were missing (used for unpoint, available otherwise)
    const cores: [string, boolean, (customerId: string, ticketId: string) => Promise<CoreResult<object>>][] = [
      ["convert", false, (customerId, ticketId) => convertTicketsCore(db, ctx, { customerId, ticketIds: [ticketId], toTicketTypeId: typeMine2 }, now)],
      ["close", false, (customerId, ticketId) => closeTicketsCore(db, ctx, { customerId, ticketIds: [ticketId], reason: "autre", note: "x" }, now)],
      ["retire", false, (customerId, ticketId) => retireTicketsCore(db, ctx, { customerId, ticketIds: [ticketId], note: null }, now)],
      ["point", false, (customerId, ticketId) => pointTicketsCore(db, ctx, { customerId, ticketIds: [ticketId], note: null }, now)],
      ["unpoint", true, (customerId, ticketId) => unpointTicketsCore(db, ctx, { customerId, ticketIds: [ticketId] }, now)],
    ];
    for (const [name, used, run] of cores) {
      const theirTicket = used ? theirUsed : theirAvailable;
      const myTicket = used ? myUsed : myAvailable;
      assert.equal(errorOf(await run(mine, theirTicket)), TICKET_NOT_FOUND, `${name}: my client, their ticket`);
      assert.equal(errorOf(await run(theirs, theirTicket)), TICKET_NOT_FOUND, `${name}: their client, their ticket`);
      assert.equal(errorOf(await run(theirs, myTicket)), TICKET_NOT_FOUND, `${name}: their client, my ticket`);
    }

    // a target type of another pro cannot receive anything
    assert.equal(
      errorOf(await convertTicketsCore(db, ctx, { customerId: mine, ticketIds: [myAvailable], toTicketTypeId: typeTheirs }, now)),
      CONVERT_TARGET_UNAVAILABLE,
    );
    assert.equal(
      errorOf(await offerTicketsCore(db, ctx, { customerId: mine, ticketTypeId: typeTheirs, quantity: 1, lastValidDay: null, reason: null, notify: false }, now)),
      TICKET_NOT_FOUND,
    );

    const rows = [await ticketRow(db, myAvailable), await ticketRow(db, myUsed), await ticketRow(db, theirAvailable), await ticketRow(db, theirUsed)];
    assert.deepEqual(
      rows.map((t) => [t.status, t.ticketTypeId]),
      [
        ["available", typeMine],
        ["used", typeMine],
        ["available", typeTheirs],
        ["used", typeTheirs],
      ],
    );
    assert.deepEqual([(await movementReasons(db, mine)).length, (await movementReasons(db, theirs)).length], before);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("a double submit never moves a second batch (point, convert, close, retire, unpoint)", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const typeA = await makeType(db, pro, { name: "Cours collectif" });
  const typeB = await makeType(db, pro, { name: "Cours particulier" });
  const offerId = await makeOffer(db, pro, typeA, { quantity: 3, priceCents: 4500 });
  const customerId = await makeCustomer(db, pro);
  await payOffer(h, customerId, offerId, now);
  const offered = await giveTickets(db, pro, customerId, typeA, 4);
  const paid = (await ticketsOf(db, customerId)).filter((t) => t.purchaseId !== null).map((t) => t.id);
  assert.equal(paid.length, 3);
  const movementCount = async () => (await movementReasons(db, customerId)).length;

  /** Runs the same request twice: the first moves the tickets, the second is refused with `second` and moves nothing. */
  const twice = async (name: string, run: () => Promise<CoreResult<object>>, second: string) => {
    must(await run());
    const afterFirst = await movementCount();
    assert.equal(errorOf(await run()), second, name);
    assert.equal(await movementCount(), afterFirst, `${name}: the second submit moved nothing`);
  };

  await twice("point", () => pointTicketsCore(db, ctx, { customerId, ticketIds: [offered[0], offered[1]], note: null }, now), NO_TICKET);
  // convert: the ticket already has the target type, so the same-type refusal answers before the engine's no_ticket
  await twice("convert", () => convertTicketsCore(db, ctx, { customerId, ticketIds: [paid[0], paid[1]], toTicketTypeId: typeB }, now), CONVERT_SAME_TYPE);
  await twice("close", () => closeTicketsCore(db, ctx, { customerId, ticketIds: [paid[2]], reason: "rembourse", note: null }, now), NO_TICKET);
  await twice("retire", () => retireTicketsCore(db, ctx, { customerId, ticketIds: [offered[2], offered[3]], note: null }, now), NO_TICKET);
  await twice("unpoint", () => unpointTicketsCore(db, ctx, { customerId, ticketIds: [offered[0], offered[1]] }, now), NO_TICKET);

  assert.deepEqual(
    (await movementsOf(db, offered[0])).map((m) => m.kind),
    ["offer", "pointage", "unpoint"],
  );
  assert.deepEqual(
    (await movementsOf(db, paid[0])).map((m) => m.kind),
    ["purchase", "convert"],
  );
  assert.deepEqual(
    (await movementsOf(db, offered[2])).map((m) => m.kind),
    ["offer", "close"],
  );
});

dbTest("every engine refusal a pro can see is worded for the pro, with its code kept", async (h) => {
  const { db, pro } = h;
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 1, priceCents: 3000 });
  const customerId = await makeCustomer(db, pro);
  await payOffer(h, customerId, offerId, now);
  const [offered, other] = await giveTickets(db, pro, customerId, typeId, 2);
  const [paid] = (await ticketsOf(db, customerId)).filter((t) => t.purchaseId !== null);

  must(await pointTicketsCore(db, ctx, { customerId, ticketIds: [offered], note: null }, now));
  expectRefusal(await pointTicketsCore(db, ctx, { customerId, ticketIds: [offered], note: null }, now), "no_ticket", NO_TICKET);
  expectRefusal(await pointTicketsCore(db, ctx, { customerId: "no-such-customer", ticketIds: [offered], note: null }, now), "not_found", TICKET_NOT_FOUND);
  expectRefusal(await pointTicketsCore(db, ctx, { customerId, ticketIds: ["no-such-ticket"], note: null }, now), "not_found", TICKET_NOT_FOUND);
  expectRefusal(await updateCustomerCore(db, ctx, { customerId: "no-such-customer", name: "Nom", phone: null }, now), "not_found", CLIENT_NOT_FOUND);
  expectRefusal(await revokeLinksCore(db, ctx, { customerId: "no-such-customer" }, now), "not_found", CLIENT_NOT_FOUND);
  expectRefusal(
    await retireTicketsCore(db, ctx, { customerId, ticketIds: [paid.id], note: null }, now),
    "retire_paid",
    "Un ticket payé ne peut pas être retiré : utilisez « Clore ».",
  );
  expectRefusal(
    await closeTicketsCore(db, ctx, { customerId, ticketIds: [other], reason: "rembourse", note: null }, now),
    "invalid",
    "Un ticket offert se retire.",
  );
  expectRefusal(await closeTicketsCore(db, ctx, { customerId, ticketIds: [other], reason: "autre", note: null }, now), "invalid", "Précisez le motif.");
});

dbTest("offerTicketsCore: the tickets_offered effect names the action that made the tickets", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const customerId = await makeCustomer(db, pro);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const quiet = must(await offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 1, lastValidDay: null, reason: null, notify: false }, now));
  assert.deepEqual(quiet.effects, []);
  const loud = must(await offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 2, lastValidDay: null, reason: null, notify: true }, now));
  assert.equal(loud.effects.length, 1);
  const [effect] = loud.effects;
  assert.ok(effect.type === "email.tickets_offered");
  const movements = await db
    .select({ actionId: ticketMovement.actionId })
    .from(ticketMovement)
    .where(eq(ticketMovement.customerId, customerId));
  assert.equal(movements.length, 3);
  assert.equal(movements.filter((m) => m.actionId === effect.actionId).length, 2);
  assert.deepEqual([effect.customerId, effect.quantity], [customerId, 2]);
});

dbTest("offerTicketsCore: the last valid day ends at local midnight across DST changes, and today is the pro's today", async ({ db, pro }) => {
  const ctx = proCtx(pro); // Europe/Paris
  const customerId = await makeCustomer(db, pro);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerOn = (lastValidDay: string, now: Date) =>
    offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 1, lastValidDay, reason: null, notify: false }, now);
  const expiries = async () =>
    (await ticketsOf(db, customerId)).map((t) => t.expiresAt?.toISOString() ?? null).sort();

  // 2025: Paris springs forward on 30 March (a 23 h day) and falls back on 26 October (a 25 h day)
  const early = new Date("2025-03-20T12:00:00.000Z");
  for (const day of ["2025-03-29", "2025-03-30", "2025-10-25", "2025-10-26"]) must(await offerOn(day, early));
  assert.deepEqual(await expiries(), [
    "2025-03-29T23:00:00.000Z", // 00:00 CET on 30 March
    "2025-03-30T22:00:00.000Z", // 00:00 CEST on 31 March: the 23 h day ended an hour earlier in UTC
    "2025-10-25T22:00:00.000Z", // 00:00 CEST on 26 October
    "2025-10-26T23:00:00.000Z", // 00:00 CET on 27 October: the 25 h day ended an hour later in UTC
  ]);

  // the pro's today is accepted until its last second, then it is the past
  const lastSecond = new Date("2025-03-30T21:59:59.000Z"); // 23:59:59 on 30 March in Paris
  must(await offerOn("2025-03-30", lastSecond));
  const midnight = new Date("2025-03-30T22:00:00.000Z"); // 00:00 on 31 March in Paris
  assert.equal(errorOf(await offerOn("2025-03-30", midnight)), EXPIRY_IN_PAST);
  must(await offerOn("2025-03-31", midnight));
  assert.equal((await expiries()).length, 6);
  assert.ok((await expiries()).includes("2025-03-31T22:00:00.000Z")); // 00:00 CEST on 1 April

  // the same instant is still 30 March at 15:00 in Los Angeles: there, 30 March is today and 29 March is past
  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    const laType = await makeType(db, la, { name: "Cours LA" });
    const laCustomer = await makeCustomer(db, la);
    const laOffer = (lastValidDay: string) =>
      offerTicketsCore(db, proCtx(la), { customerId: laCustomer, ticketTypeId: laType, quantity: 1, lastValidDay, reason: null, notify: false }, midnight);
    assert.equal(errorOf(await laOffer("2025-03-29")), EXPIRY_IN_PAST);
    must(await laOffer("2025-03-30"));
    const [laTicket] = await ticketsOf(db, laCustomer);
    assert.equal(laTicket.expiresAt?.toISOString(), "2025-03-31T07:00:00.000Z"); // 00:00 PDT on 31 March
    assert.deepEqual(await checkInvariants(db, { proId: la.proId }), []);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("offerTicketsCore: a last day past the end of the calendar is a refusal, not a crash", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const customerId = await makeCustomer(db, pro);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerOn = (lastValidDay: string) =>
    offerTicketsCore(db, ctx, { customerId, ticketTypeId: typeId, quantity: 1, lastValidDay, reason: null, notify: false }, now);

  // 9999-12-31 is a valid date key whose following midnight has no key
  assert.equal(errorOf(await offerOn("9999-12-31")), "La date de fin de validité est trop lointaine.");
  assert.deepEqual(await ticketsOf(db, customerId), []);
  must(await offerOn("9999-12-30"));
  assert.equal((await ticketsOf(db, customerId)).length, 1);
});
