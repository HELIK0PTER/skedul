import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { instantAt } from "@/lib/civil-date";
import { customer, ticketMovement, ticketOffer } from "@/lib/db/schema";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, testEmail } from "../../test/db";
import {
  dayIn,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeOffer,
  makeType,
  movementsOf,
  ticketsOf,
} from "../../test/fixtures";
import { setTicketTypeArchived } from "./catalog";
import { createCustomer, offerTickets, revokeLinks, updateCustomer, upsertCustomer, walletBalance } from "./wallet";

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

async function customerRow(db: Parameters<typeof upsertCustomer>[0], id: string) {
  const [row] = await db.select().from(customer).where(eq(customer.id, id));
  return row;
}

dbTest("upsertCustomer normalises the e-mail, fills blanks only and never overwrites the name", async ({ db, pro }) => {
  const email = testEmail();
  const first = await upsertCustomer(db, { professionalId: pro.proId, email: `  ${email.toUpperCase()} `, name: " Léa " });
  const again = await upsertCustomer(db, {
    professionalId: pro.proId,
    email,
    name: "Quelqu'un d'autre",
    phone: " 06 00 00 00 00 ",
    userId: pro.userId,
  });
  assert.equal(again.customerId, first.customerId);
  let row = await customerRow(db, first.customerId);
  assert.deepEqual([row.email, row.name, row.phone, row.userId, row.linkVersion], [email, "Léa", "06 00 00 00 00", pro.userId, 1]);

  await upsertCustomer(db, { professionalId: pro.proId, email, name: "Encore", phone: "07 11 11 11 11", userId: null });
  row = await customerRow(db, first.customerId);
  assert.deepEqual([row.name, row.phone, row.userId], ["Léa", "06 00 00 00 00", pro.userId], "nothing filled is replaced");
});

dbTest("createCustomer: the pro's name and phone win; created tells a new row", async ({ db, pro }) => {
  const email = testEmail();
  const created = must(await createCustomer(db, { professionalId: pro.proId, name: "Rafael", email: ` ${email} ` }));
  assert.equal(created.created, true);
  const updated = must(await createCustomer(db, { professionalId: pro.proId, name: "Rafael Souza", email, phone: "0612" }));
  assert.deepEqual([updated.customerId, updated.created], [created.customerId, false]);
  must(await createCustomer(db, { professionalId: pro.proId, name: "Rafael S.", email }));
  const row = await customerRow(db, created.customerId);
  assert.deepEqual([row.name, row.phone], ["Rafael S.", "0612"], "an omitted phone is kept");

  const bad = await createCustomer(db, { professionalId: pro.proId, name: "X", email: "pas-une-adresse" });
  assert.equal(!bad.ok && bad.code, "invalid");
  const blank = await createCustomer(db, { professionalId: pro.proId, name: "  ", email: testEmail() });
  assert.equal(!blank.ok && blank.code, "invalid");
});

dbTest("updateCustomer and revokeLinks stay inside the pro", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const customerId = await makeCustomer(db, pro, { name: "Thomas" });
    must(await updateCustomer(db, { professionalId: pro.proId, customerId, name: " Thomas Martin ", phone: "  " }));
    const row = await customerRow(db, customerId);
    assert.deepEqual([row.name, row.phone], ["Thomas Martin", null]);
    assert.deepEqual(
      await updateCustomer(db, { professionalId: other.proId, customerId, name: "Volé", phone: null }),
      { ok: false, code: "not_found" },
    );
    const empty = await updateCustomer(db, { professionalId: pro.proId, customerId, name: " ", phone: null });
    assert.equal(!empty.ok && empty.code, "invalid");

    assert.deepEqual(await revokeLinks(db, { professionalId: pro.proId, customerId }), { ok: true, effects: [], linkVersion: 2 });
    assert.deepEqual(await revokeLinks(db, { professionalId: pro.proId, customerId }), { ok: true, effects: [], linkVersion: 3 });
    assert.deepEqual(await revokeLinks(db, { professionalId: other.proId, customerId }), { ok: false, code: "not_found" });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("offerTickets: N available tickets and N offer movements in one action", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const expiresAt = addDaysMs(now, 30);
  const res = must(
    await offerTickets(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        customerId,
        ticketTypeId: typeId,
        quantity: 3,
        expiresAt,
        reason: " Geste commercial ",
        notify: true,
      },
      now,
    ),
  );
  assert.equal(res.ticketIds.length, 3);
  const tickets = await ticketsOf(db, customerId);
  assert.deepEqual(new Set(tickets.map((t) => t.id)), new Set(res.ticketIds));
  assert.ok(
    tickets.every(
      (t) =>
        t.status === "available" &&
        t.purchaseId === null &&
        t.ticketTypeId === typeId &&
        t.expiresAt?.getTime() === expiresAt.getTime() &&
        t.createdAt.getTime() === now.getTime(),
    ),
  );
  const moves = await db.select().from(ticketMovement).where(eq(ticketMovement.customerId, customerId));
  assert.equal(moves.length, 3);
  const actionId = moves[0].actionId;
  assert.ok(
    moves.every(
      (m) =>
        m.actionId === actionId &&
        m.kind === "offer" &&
        m.fromStatus === null &&
        m.toStatus === "available" &&
        m.actor === "pro" &&
        m.actorUserId === pro.userId &&
        m.reason === "Geste commercial",
    ),
  );
  assert.deepEqual(res.effects, [{ type: "email.tickets_offered", customerId, actionId, quantity: 3 }]);

  const [quiet] = await giveTickets(db, pro, customerId, typeId, 1);
  assert.deepEqual(
    (await movementsOf(db, quiet)).map((m) => [m.kind, m.fromStatus, m.toStatus]),
    [["offer", null, "available"]],
  );
});

dbTest("offerTickets refuses bad quantities, past expiries, foreign customers and archived types", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const now = new Date();
    const typeId = await makeType(db, pro);
    const customerId = await makeCustomer(db, pro);
    const base = {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      customerId,
      ticketTypeId: typeId,
      quantity: 1,
      expiresAt: null,
      notify: false,
    };
    for (const quantity of [0, 101, 1.5]) {
      assert.deepEqual(await offerTickets(db, { ...base, quantity }, now), { ok: false, code: "invalid" });
    }
    assert.deepEqual(await offerTickets(db, { ...base, expiresAt: addDaysMs(now, -1) }, now), { ok: false, code: "invalid" });
    const foreign = await makeCustomer(db, other);
    assert.deepEqual(await offerTickets(db, { ...base, customerId: foreign }, now), { ok: false, code: "not_found" });
    must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: typeId, archived: true }));
    assert.deepEqual(await offerTickets(db, base, now), { ok: false, code: "not_found" });
    assert.deepEqual(await ticketsOf(db, customerId), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("walletBalance counts usable tickets per type, with the soonest expiry", async ({ db, pro }) => {
  const now = new Date();
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeA, 2);
  const soon = addDaysMs(now, 10);
  await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: soon });
  await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: addDaysMs(now, -1), now: addDaysMs(now, -30) });
  // no `now`: the fixture acts 1 s before an expiry that is already past (not usable)
  await giveTickets(db, pro, customerId, typeB, 1, { expiresAt: addDaysMs(now, -2) });
  await giveTickets(db, pro, customerId, typeB, 1);

  const balance = await walletBalance(db, { professionalId: pro.proId, customerId }, now);
  const expected = [
    { ticketTypeId: typeA, usable: 3, nextExpiry: soon },
    { ticketTypeId: typeB, usable: 1, nextExpiry: null },
  ].sort((x, y) => (x.ticketTypeId < y.ticketTypeId ? -1 : 1));
  assert.deepEqual(
    balance.map((b) => ({ ...b, nextExpiry: b.nextExpiry ? b.nextExpiry.getTime() : null })),
    expected.map((b) => ({ ...b, nextExpiry: b.nextExpiry ? b.nextExpiry.getTime() : null })),
  );
});

dbTest("fixtures: makeEvent is a one-off at 10:00 local in three days; makeOffer has the defaults", async ({ db, pro }) => {
  const typeId = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeId);
  const [offer] = await db.select().from(ticketOffer).where(eq(ticketOffer.id, offerId));
  assert.deepEqual([offer.quantity, offer.priceCents, offer.validityCount], [1, 2500, null]);
  const { occurrences } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].seriesDate, dayIn(pro, 3));
  assert.equal(occurrences[0].startsAt.getTime(), instantAt(dayIn(pro, 3), 600, pro.tz).getTime());
  assert.equal(occurrences[0].capacity, 12);
});
