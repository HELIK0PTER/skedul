import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail } from "../../test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeOffer, makeType, occurrencesOf } from "../../test/fixtures";
import { instantAt } from "../civil-date";
import type { Db } from "../db/atomic";
import { deletionImpact, pendingCheckoutSessions } from "./account";
import { loadQuestions } from "./answers";
import { cancelByClient, cancelOccurrence, createTimeOffWithConflicts } from "./cancel";
import { setAvailabilityRules, setTicketTypeArchived } from "./catalog";
import { attachCheckoutSession, bookRdv, bookWithHeldTicket, registerFree, registerPro, startBuyAndBook } from "./claims";
import { fulfillPurchase, startPurchase } from "./fulfillment";
import { expireTickets } from "./nightly";
import { createEvent } from "./occurrences";
import { releasePurchase } from "./release";
import { closeTickets, convertTickets, pointTickets, unpointTickets, upsertCustomer } from "./wallet";

function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
}

/** Every domain table: each has its own professional_id → professional ON DELETE CASCADE (R2). */
const DOMAIN_TABLES = [
  "ticket_type",
  "ticket_offer",
  "availability_rule",
  "event",
  "event_ticket_type",
  "question",
  "occurrence",
  "customer",
  "ticket_purchase",
  "booking",
  "booking_answer",
  "ticket",
  "ticket_movement",
  "time_off",
] as const;

async function rowCounts(db: Db, proId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of DOMAIN_TABLES) {
    const res = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where professional_id = ${proId}`,
    );
    out[table] = Number(res.rows[0]?.n ?? 0);
  }
  return out;
}

async function distinct(db: Db, table: string, column: string, proId: string): Promise<string[]> {
  const res = await db.execute<{ v: string }>(
    sql`select distinct ${sql.identifier(column)}::text as v from ${sql.identifier(table)} where professional_id = ${proId} order by 1`,
  );
  return res.rows.map((r) => r.v).sort();
}

dbTest("T11: deleteUser on a fully populated pro removes the whole domain; other pros keep their client, unlinked", async ({ db, pro }) => {
  const now = new Date();
  const p = pro.proId;
  const actor = pro.userId;
  const allWeek = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));

  // ── catalog: types (one archived later, two RDV), offers, hours (global + per type), questions
  const typeA = await makeType(db, pro, { name: "Cours collectif" });
  const typeB = await makeType(db, pro, { name: "Stage d'été" });
  const rdvPaid = await makeType(db, pro, { name: "Cours particulier", rdvEnabled: true, rdvDurationMin: 60 });
  const rdvFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 });
  const offerA = await makeOffer(db, pro, typeA, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  await makeOffer(db, pro, rdvPaid, { priceCents: 5000 });
  must(await setAvailabilityRules(db, { professionalId: p, ticketTypeId: null, rules: allWeek }), "global hours");
  must(await setAvailabilityRules(db, { professionalId: p, ticketTypeId: rdvFree, rules: allWeek }), "type hours");

  // ── events: tickets mode with a question (4 daily séances from day 2), free mode, private
  const created = await createEvent(db, {
    professionalId: p,
    event: {
      title: "Altinha débutants",
      ticketTypeIds: [typeA, typeB],
      questions: [{ label: "Avez-vous déjà pratiqué ?", type: "boolean", required: true }],
      rule: {
        startDate: dayIn(pro, 2, now),
        startMinute: 600,
        freq: "daily",
        interval: 1,
        weekdays: null,
        monthlyBy: null,
        monthWeek: null,
        endMode: "count",
        untilDate: null,
        occurrenceCount: 4,
      },
    },
  });
  must(created, "createEvent");
  const [s1, s2, s3, s4] = (await occurrencesOf(db, created.eventId)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const [questionRow] = await loadQuestions(db, { eventId: created.eventId });
  const {
    occurrences: [freeSeance],
  } = await makeEvent(db, pro, { bookingMode: "free", rule: { startDate: dayIn(pro, 3, now), startMinute: 1080 } });
  const {
    occurrences: [privateSeance],
  } = await makeEvent(db, pro, { isPrivate: true, ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, 3, now), startMinute: 1140 } });

  // ── c1: a paid carnet, then booked (with an answer), cancelled, pointed, unpointed, converted, closed, an RDV
  const c1 = await makeCustomer(db, pro);
  const shop = await startPurchase(db, { professionalId: p, offerId: offerA, customerId: c1 });
  must(shop, "startPurchase");
  const paid = await fulfillPurchase(db, shop.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false });
  assert.equal(paid.outcome, "fulfilled");
  must(
    await bookWithHeldTicket(db, {
      professionalId: p,
      occurrenceId: s1.id,
      customerId: c1,
      seenStartsAt: s1.startsAt,
      actorUserId: null,
      answers: [{ questionId: questionRow.id, value: "Oui" }],
    }),
    "book s1",
  );
  const onS2 = await bookWithHeldTicket(db, {
    professionalId: p,
    occurrenceId: s2.id,
    customerId: c1,
    seenStartsAt: s2.startsAt,
    actorUserId: null,
    answers: [{ questionId: questionRow.id, value: "Non" }],
  });
  must(onS2, "book s2");
  must(await cancelByClient(db, { professionalId: p, customerId: c1, bookingId: onS2.bookingId, actorUserId: null }), "cancel s2");
  must(await pointTickets(db, { professionalId: p, actorUserId: actor, customerId: c1, selection: { ticketTypeId: typeA, quantity: 2 } }), "point");
  must(await unpointTickets(db, { professionalId: p, actorUserId: actor, customerId: c1, selection: { ticketTypeId: typeA, quantity: 1 } }), "unpoint");
  must(
    await convertTickets(db, { professionalId: p, actorUserId: actor, customerId: c1, selection: { ticketTypeId: typeA, quantity: 1 }, toTicketTypeId: typeB }),
    "convert",
  );
  must(
    await closeTickets(db, {
      professionalId: p,
      actorUserId: actor,
      customerId: c1,
      selection: { ticketTypeId: typeA, quantity: 1 },
      reason: "rembourse",
      note: "Remboursé en espèces",
    }),
    "close",
  );
  await giveTickets(db, pro, c1, rdvPaid, 1);
  must(
    await bookRdv(db, {
      professionalId: p,
      ticketTypeId: rdvPaid,
      startsAt: instantAt(dayIn(pro, 3, now), 840, pro.tz),
      customerId: c1,
      actorUserId: null,
      mode: "held_ticket",
    }),
    "RDV with a ticket",
  );

  // ── c2: buy + book still pending with an open checkout
  const c2 = await makeCustomer(db, pro);
  const pending = await startBuyAndBook(db, {
    professionalId: p,
    occurrenceId: s3.id,
    customerId: c2,
    seenStartsAt: s3.startsAt,
    offerId: offerA,
    answers: [{ questionId: questionRow.id, value: "Oui" }],
  });
  must(pending, "buy + book (pending)");
  const sessionId = `cs_test_${pending.purchaseId}`;
  must(
    await attachCheckoutSession(db, { purchaseId: pending.purchaseId, checkoutSessionId: sessionId, checkoutUrl: "https://checkout.example.test/s" }),
    "attach",
  );

  // ── c3: buy + book released (booking and purchase expired)
  const c3 = await makeCustomer(db, pro);
  const released = await startBuyAndBook(db, {
    professionalId: p,
    occurrenceId: s3.id,
    customerId: c3,
    seenStartsAt: s3.startsAt,
    offerId: offerA,
    answers: [{ questionId: questionRow.id, value: "Non" }],
  });
  must(released, "buy + book (released)");
  must(await releasePurchase(db, released.purchaseId), "release");

  // ── c4: free registration, guest on a private séance, free RDV, an expired offered ticket, a cancelled séance
  const c4 = await makeCustomer(db, pro);
  must(await registerFree(db, { professionalId: p, occurrenceId: freeSeance.id, customerId: c4, seenStartsAt: freeSeance.startsAt }), "free");
  must(await registerPro(db, { professionalId: p, actorUserId: actor, occurrenceId: privateSeance.id, customerId: c4, asGuest: true }), "guest");
  must(
    await bookRdv(db, {
      professionalId: p,
      ticketTypeId: rdvFree,
      startsAt: instantAt(dayIn(pro, 3, now), 960, pro.tz),
      customerId: c4,
      actorUserId: null,
      mode: "free",
    }),
    "free RDV",
  );
  // Fresh clock: offerTickets refuses an expiry that is not after its own now, and the test has run for a while.
  const t0 = new Date();
  await giveTickets(db, pro, c4, typeA, 1, { expiresAt: addMinutes(t0, 1), now: t0 });
  await expireTickets(db, addMinutes(t0, 2));
  must(await registerPro(db, { professionalId: p, actorUserId: actor, occurrenceId: s4.id, customerId: c4, asGuest: true }), "guest on s4");
  must(await cancelOccurrence(db, { professionalId: p, actorUserId: actor, occurrenceId: s4.id }), "cancel s4");

  // ── a time off with no séance, an archived type
  must(
    await createTimeOffWithConflicts(db, {
      professionalId: p,
      actorUserId: actor,
      startAt: instantAt(dayIn(pro, 20, now), 0, pro.tz),
      endAt: instantAt(dayIn(pro, 21, now), 0, pro.tz),
      allDay: true,
      reason: "Vacances",
      seenOccurrenceIds: [],
      cancelBooked: false,
    }),
    "time off",
  );
  must(await setTicketTypeArchived(db, { professionalId: p, ticketTypeId: typeB, archived: true }), "archive B");

  // ── the pro (A) is also a client of another pro (B)
  const other = await createTestPro(db);
  try {
    const { customerId: elsewhere } = await upsertCustomer(db, {
      professionalId: other.proId,
      email: testEmail("pro-a"),
      name: "Pro A",
      userId: pro.userId,
    });

    // fully populated: every table, every status
    const before = await rowCounts(db, p);
    for (const table of DOMAIN_TABLES) assert.ok(before[table] > 0, `${table} is empty before the delete`);
    assert.deepEqual(await distinct(db, "booking", "status", p), ["cancelled", "confirmed", "expired", "pending"]);
    assert.deepEqual(await distinct(db, "booking", "coverage", p), ["free", "guest", "ticket"]);
    assert.deepEqual(await distinct(db, "ticket", "status", p), ["available", "booked", "closed", "expired", "used"]);
    assert.deepEqual(await distinct(db, "ticket_purchase", "status", p), ["expired", "paid", "pending"]);
    assert.deepEqual(await distinct(db, "occurrence", "status", p), ["cancelled", "scheduled"]);
    assert.deepEqual(await distinct(db, "ticket_movement", "kind", p), [
      "close",
      "convert",
      "expire",
      "offer",
      "pointage",
      "purchase",
      "return",
      "spend",
      "unpoint",
    ]);

    // E13 reads, before the delete
    assert.deepEqual(await pendingCheckoutSessions(db, p), [{ purchaseId: pending.purchaseId, checkoutSessionId: sessionId }]);
    assert.deepEqual(await deletionImpact(db, p, now), { ticketsInCirculation: 1, pendingPayments: 1 });

    // the deleteUser path: one DELETE FROM "user"
    await deleteTestUser(db, pro.userId);
    const after = await rowCounts(db, p);
    for (const table of DOMAIN_TABLES) assert.equal(after[table], 0, `${table} still has rows`);
    const link = await db.execute<{ user_id: string | null }>(sql`select user_id from customer where id = ${elsewhere}`);
    assert.equal(link.rows[0]?.user_id, null);
  } finally {
    await deleteTestUser(db, other.userId);
  }
}, { timeout: 300_000 });
