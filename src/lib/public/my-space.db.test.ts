import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { textArray, type Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { MY_SPACE_MAX_PROS, getMySpace } from "@/lib/public/my-space";
import { addDaysMs, createTestPro, dbTest, deleteTestUser, testEmail, type TestPro } from "@/test/db";
import { createTestClientUser } from "@/test/public";
import { rowBooking, rowCustomer, rowEvent, rowSeance, rowTicket, rowType } from "@/test/rows";

function rename(db: Db, pro: TestPro, businessName: string) {
  return db.update(schema.professional).set({ businessName }).where(eq(schema.professional.id, pro.proId));
}

/** `count` pros, each with a customer row of `email` linked to `userId`, in three multi-row inserts; returns the pros' user ids for the cleanup. */
async function manyPros(db: Db, count: number, email: string, userId: string): Promise<string[]> {
  const pros = Array.from({ length: count }, (_, i) => {
    const tag = nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "x");
    return { i, tag, userId: nanoid(), proId: nanoid() };
  });
  await db.insert(schema.user).values(
    pros.map((p) => ({ id: p.userId, name: `Pro ${p.tag}`, email: `pro-${p.tag}@skedul.test`, emailVerified: true, role: "pro" as const })),
  );
  await db.insert(schema.professional).values(
    pros.map((p) => ({
      id: p.proId,
      userId: p.userId,
      slug: `t-${p.tag}`,
      businessName: `Pro ${String(p.i).padStart(2, "0")}`,
      timezone: "Europe/Paris",
      currency: "eur",
    })),
  );
  await db.insert(schema.customer).values(pros.map((p) => ({ id: nanoid(), professionalId: p.proId, userId, email, name: "Beatriz" })));
  return pros.map((p) => p.userId);
}

dbTest("getMySpace: the rows linked to the user at two pros give two cards, in French alphabetical order", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz Almeida", verified: true });
  try {
    await rename(db, pro, "Zen Atelier");
    await rename(db, other, "Élan Yoga");
    const atZen = await rowCustomer(db, pro, { email, name: "Beatriz Almeida", userId: me.userId });
    const atElan = await rowCustomer(db, other, { email, name: "Beatriz Almeida", userId: me.userId });

    const cards = await getMySpace(db, { userId: me.userId, email }, now);
    // « Élan » sorts before « Zen » with the French collation; a plain string comparison would put it last.
    assert.deepEqual(
      cards.map((c) => [c.slug, c.businessName]),
      [
        [other.slug, "Élan Yoga"],
        [pro.slug, "Zen Atelier"],
      ],
    );
    assert.deepEqual(cards.map((c) => c.space.customer.id), [atElan, atZen]);
    assert.deepEqual(cards.map((c) => c.space.customer.email), [email, email]);
  } finally {
    await deleteTestUser(db, other.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: the unlinked row of the verified address counts, a row linked to another user does not (Decision 5, S28)", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  const stranger = await createTestClientUser(db, { email: testEmail("stranger"), name: "Autre compte", verified: true });
  try {
    await rename(db, pro, "Altinha Paris");
    await rename(db, second, "Capoeira Lyon");
    const unlinked = await rowCustomer(db, pro, { email, name: "Beatriz", userId: null });
    // The same address at another pro, but already linked to ANOTHER account: not hers.
    await rowCustomer(db, second, { email, name: "Beatriz", userId: stranger.userId });
    // Another client of the same pro, no link, another address: not hers either.
    await rowCustomer(db, pro, { name: "Autre client", userId: null });

    const cards = await getMySpace(db, { userId: me.userId, email }, now);
    assert.deepEqual(cards.map((c) => c.slug), [pro.slug]);
    assert.deepEqual(cards.map((c) => c.space.customer.id), [unlinked]);

    // The address is matched the way normalizeEmail spells it, whatever the session carries.
    const spelled = await getMySpace(db, { userId: me.userId, email: `  ${email.toUpperCase()} ` }, now);
    assert.deepEqual(spelled.map((c) => c.space.customer.id), [unlinked]);
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, stranger.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: a pro whose user is suspended is offline, a lapsed ban counts as lifted (S28)", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  try {
    await rename(db, pro, "Altinha Paris");
    await rename(db, second, "Capoeira Lyon");
    await rowCustomer(db, pro, { email, userId: me.userId });
    await rowCustomer(db, second, { email, userId: me.userId });
    const slugs = async () => (await getMySpace(db, { userId: me.userId, email }, now)).map((c) => c.slug);
    const ban = (banned: boolean, banExpires: Date | null) =>
      db.update(schema.user).set({ banned, banExpires }).where(eq(schema.user.id, second.userId));

    assert.deepEqual(await slugs(), [pro.slug, second.slug], "nobody suspended");
    await ban(true, null);
    assert.deepEqual(await slugs(), [pro.slug], "suspended without an end");
    await ban(true, new Date(Date.now() + 3_600_000));
    assert.deepEqual(await slugs(), [pro.slug], "suspended until later");
    await ban(true, new Date(Date.now() - 3_600_000));
    assert.deepEqual(await slugs(), [pro.slug, second.slug], "the ban ended an hour ago: lifted");
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: a card shows that customer's own bookings and tickets, never another client's, never another pro's", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  try {
    const eventId = await rowEvent(db, pro);
    await db.update(schema.event).set({ title: "Altinha débutants" }).where(eq(schema.event.id, eventId));
    // Two confirmed bookings on one séance: seats_taken says 2.
    const seance = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 3), seatsTaken: 2, seriesDate: "2030-03-01" });
    const typeId = await rowType(db, pro, { name: "Séance collective" });
    const mine = await rowCustomer(db, pro, { email, name: "Beatriz", userId: me.userId });
    const theirs = await rowCustomer(db, pro, { name: "Autre client" });
    const myBooking = await rowBooking(db, pro, { occurrenceId: seance, customerId: mine });
    await rowBooking(db, pro, { occurrenceId: seance, customerId: theirs });
    await rowTicket(db, pro, { customerId: mine, ticketTypeId: typeId });
    await rowTicket(db, pro, { customerId: theirs, ticketTypeId: typeId });
    await rowTicket(db, pro, { customerId: theirs, ticketTypeId: typeId });
    // A client of the second pro (no link, another address) has data too: it makes no card of hers.
    await rowCustomer(db, second, { name: "Client de l'autre pro" });

    const cards = await getMySpace(db, { userId: me.userId, email }, now);
    assert.equal(cards.length, 1);
    const [card] = cards;
    assert.equal(card.space.customer.id, mine);
    assert.deepEqual(card.space.upcoming.map((b) => [b.bookingId, b.title]), [[myBooking, "Altinha débutants"]]);
    assert.deepEqual(card.space.wallet.map((w) => [w.ticketTypeId, w.usable]), [[typeId, 1]]);
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: one card per pro, the row linked to the user wins over another row of the same pro", async ({ db, pro }) => {
  const now = new Date();
  const sessionEmail = testEmail("session");
  const me = await createTestClientUser(db, { email: sessionEmail, name: "Beatriz", verified: true });
  try {
    // The address of the account changed since the first booking: the pro holds two rows that both match.
    await rowCustomer(db, pro, { email: sessionEmail, name: "Fiche non liée", userId: null });
    const linked = await rowCustomer(db, pro, { email: testEmail("old"), name: "Fiche liée", userId: me.userId });

    const cards = await getMySpace(db, { userId: me.userId, email: sessionEmail }, now);
    assert.equal(cards.length, 1, "one card per pro");
    assert.equal(cards[0].space.customer.id, linked, "the linked row wins");
  } finally {
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: no row gives no card; at most MY_SPACE_MAX_PROS cards come back, the first ones in French order", async ({ db }) => {
  const now = new Date();
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  let proUserIds: string[] = [];
  try {
    assert.deepEqual(await getMySpace(db, { userId: me.userId, email }, now), []);

    proUserIds = await manyPros(db, MY_SPACE_MAX_PROS + 1, email, me.userId);
    const cards = await getMySpace(db, { userId: me.userId, email }, now);
    assert.equal(MY_SPACE_MAX_PROS, 20);
    assert.equal(cards.length, MY_SPACE_MAX_PROS);
    assert.deepEqual(
      cards.map((c) => c.businessName),
      Array.from({ length: MY_SPACE_MAX_PROS }, (_, i) => `Pro ${String(i).padStart(2, "0")}`),
    );
  } finally {
    if (proUserIds.length > 0) await db.execute(sql`delete from "user" where id = any(${textArray(proUserIds)})`);
    await deleteTestUser(db, me.userId);
  }
});
