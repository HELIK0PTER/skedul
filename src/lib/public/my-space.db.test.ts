import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { ownedCustomerId } from "@/lib/back-office/guest-access";
import { textArray, type Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import type { SessionFacts } from "@/lib/public/identity";
import { MY_SPACE_MAX_PROS, getMySpace } from "@/lib/public/my-space";
import { addDaysMs, createTestPro, dbTest, deleteTestUser, testEmail, type TestPro } from "@/test/db";
import { createTestClientUser } from "@/test/public";
import { rowBooking, rowCustomer, rowEvent, rowSeance, rowTicket, rowType } from "@/test/rows";

function rename(db: Db, pro: TestPro, businessName: string) {
  return db.update(schema.professional).set({ businessName }).where(eq(schema.professional.id, pro.proId));
}

/** The facts of a fresh, verified, not impersonated session of `me` typing `email`; `over` turns one of them off. */
function sessionOf(me: { userId: string }, email: string, over: Partial<SessionFacts> = {}): SessionFacts {
  return { userId: me.userId, email, name: "Beatriz", emailVerified: true, impersonated: false, impersonatedBy: null, ...over };
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

    const cards = await getMySpace(db, sessionOf(me, email), now);
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

    const cards = await getMySpace(db, sessionOf(me, email), now);
    assert.deepEqual(cards.map((c) => c.slug), [pro.slug]);
    assert.deepEqual(cards.map((c) => c.space.customer.id), [unlinked]);

    // The address is matched the way normalizeEmail spells it, whatever the session carries.
    const spelled = await getMySpace(db, sessionOf(me, `  ${email.toUpperCase()} `), now);
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
    const slugs = async () => (await getMySpace(db, sessionOf(me, email), now)).map((c) => c.slug);
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
  const handBuilt: { bookings: string[]; tickets: string[] } = { bookings: [], tickets: [] };
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
    // A client of the second pro (no link, another address) has a booking and a ticket too: they make no card of hers
    // and none of it reaches the card of the first pro.
    const secondEvent = await rowEvent(db, second);
    await db.update(schema.event).set({ title: "Capoeira roda" }).where(eq(schema.event.id, secondEvent));
    const secondSeance = await rowSeance(db, second, secondEvent, { startsAt: addDaysMs(now, 4), seatsTaken: 1, seriesDate: "2030-03-02" });
    const secondType = await rowType(db, second, { name: "Carte de l'autre pro" });
    const secondClient = await rowCustomer(db, second, { name: "Client de l'autre pro" });
    await rowBooking(db, second, { occurrenceId: secondSeance, customerId: secondClient });
    await rowTicket(db, second, { customerId: secondClient, ticketTypeId: secondType });
    // Rows that crossed two pros, built by hand on purpose (every domain foreign key is single-column, so only the reads'
    // own professional filters keep them out): a booking and a ticket of the SECOND pro that carry MY customer id, on
    // the second pro's own séance and type. Neither may reach my card (G3b, the way mock-checkout.db.test.ts builds them).
    handBuilt.bookings.push(await rowBooking(db, second, { occurrenceId: secondSeance, customerId: mine }));
    handBuilt.tickets.push(await rowTicket(db, second, { customerId: mine, ticketTypeId: secondType, movements: false }));

    const cards = await getMySpace(db, sessionOf(me, email), now);
    assert.equal(cards.length, 1);
    const [card] = cards;
    assert.equal(card.slug, pro.slug);
    assert.equal(card.space.customer.id, mine);
    assert.deepEqual(card.space.upcoming.map((b) => [b.bookingId, b.title]), [[myBooking, "Altinha débutants"]]);
    assert.deepEqual(card.space.wallet.map((w) => [w.ticketTypeId, w.usable]), [[typeId, 1]]);
    assert.equal(JSON.stringify(card).includes("Capoeira roda"), false, "nothing of the second pro's séance reaches the card");
    assert.equal(JSON.stringify(card).includes(secondType), false, "nor does its ticket type");
  } finally {
    // The hand-built rows go before the invariant check (and before the second pro): they are not part of any model.
    for (const id of handBuilt.bookings) await db.delete(schema.booking).where(eq(schema.booking.id, id));
    for (const id of handBuilt.tickets) await db.delete(schema.ticket).where(eq(schema.ticket.id, id));
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: the card of a pro is the row the Owner predicate picks, so a row linked to the user under another address is not a card (Decision 5)", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const sessionEmail = testEmail("session");
  const me = await createTestClientUser(db, { email: sessionEmail, name: "Beatriz", verified: true });
  try {
    await rename(db, pro, "Altinha Paris");
    await rename(db, second, "Capoeira Lyon");
    // The address of the account is not the one these rows carry (it changed since: the e-mail change is closed today,
    // so nothing writes this, but the rule must not depend on it). At the first pro the unlinked row of the session's
    // address is hers, the linked row under the old address is not; at the second pro nothing of hers carries the address.
    const owned = await rowCustomer(db, pro, { email: sessionEmail, name: "Fiche de l'adresse", userId: null });
    await rowCustomer(db, pro, { email: testEmail("old"), name: "Fiche liée, ancienne adresse", userId: me.userId });
    await rowCustomer(db, second, { email: testEmail("older"), name: "Fiche liée seule", userId: me.userId });

    const session = sessionOf(me, sessionEmail);
    const cards = await getMySpace(db, session, now);
    assert.deepEqual(cards.map((c) => [c.slug, c.space.customer.id]), [[pro.slug, owned]]);
    // The same row the wallet Owner is, pro by pro.
    assert.equal(await ownedCustomerId(db, pro.proId, session), owned);
    assert.equal(await ownedCustomerId(db, second.proId, session), null);
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: a card is the row the user owns, linked or not: the same rows as ownedCustomerId", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  const stranger = await createTestClientUser(db, { email: testEmail("stranger"), name: "Autre compte", verified: true });
  try {
    const linked = await rowCustomer(db, pro, { email, name: "Fiche liée", userId: me.userId });
    const unlinked = await rowCustomer(db, second, { email, name: "Fiche libre", userId: null });
    const session = sessionOf(me, email);
    const cards = await getMySpace(db, session, now);
    assert.deepEqual(new Set(cards.map((c) => c.space.customer.id)), new Set([linked, unlinked]));
    for (const proRow of [pro, second]) {
      const card = cards.find((c) => c.slug === proRow.slug);
      assert.equal(card?.space.customer.id, await ownedCustomerId(db, proRow.proId, session), proRow.slug);
    }
    // Linked to another account, the row is nobody's but that account's: no card, no Owner.
    await db.update(schema.customer).set({ userId: stranger.userId }).where(eq(schema.customer.id, unlinked));
    assert.deepEqual((await getMySpace(db, session, now)).map((c) => c.space.customer.id), [linked]);
    assert.equal(await ownedCustomerId(db, second.proId, session), null);
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, stranger.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("getMySpace: it refuses a session that is not verified, is impersonated or does not exist, whatever the rows", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  try {
    await rowCustomer(db, pro, { email, name: "Beatriz", userId: me.userId });
    assert.equal((await getMySpace(db, sessionOf(me, email), now)).length, 1, "the verified session sees its card");
    assert.deepEqual(await getMySpace(db, null, now), [], "no session");
    assert.deepEqual(await getMySpace(db, sessionOf(me, email, { emailVerified: false }), now), [], "unverified: the banner, never the data");
    assert.deepEqual(
      await getMySpace(db, sessionOf(me, email, { impersonated: true, impersonatedBy: "admin-1" }), now),
      [],
      "an admin impersonating never reads a client's data",
    );
    // Fails closed like visitorState: an impersonation flag wins over a verified address.
    assert.deepEqual(await getMySpace(db, sessionOf(me, email, { impersonated: true }), now), []);
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
    assert.deepEqual(await getMySpace(db, sessionOf(me, email), now), []);

    proUserIds = await manyPros(db, MY_SPACE_MAX_PROS + 1, email, me.userId);
    const cards = await getMySpace(db, sessionOf(me, email), now);
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
