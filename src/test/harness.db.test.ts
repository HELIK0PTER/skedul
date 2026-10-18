/**
 * Schema smoke tests on tickets-test: the manual SQL of migration 0012
 * (btree_gist, occurrence_rdv_excl, skedul_assert) and rule R2 (deleting a
 * pro's user removes every domain row, through NO ACTION references).
 */
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { pgErrorInfo, skedulCode } from "../lib/db/pg-error";
import * as schema from "../lib/db/schema";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail } from "./db";

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  assert.fail("expected the statement to fail");
}

// Fixed instants far in the future: no dependency on the clock or on DST.
const MON_0900 = new Date("2030-01-07T09:00:00.000Z");

dbTest("migration 0012 installed btree_gist and skedul_assert", async ({ db }) => {
  const ext = await db.execute<{ extname: string }>(
    sql`select extname from pg_extension where extname = 'btree_gist'`,
  );
  assert.equal(ext.rows.length, 1);
  const excl = await db.execute<{ conname: string }>(
    sql`select conname from pg_constraint where conname = 'occurrence_rdv_excl' and contype = 'x'`,
  );
  assert.equal(excl.rows.length, 1);
  const ok = await db.execute<{ ok: boolean }>(sql`select skedul_assert(true, 'unused') as ok`);
  assert.equal(ok.rows[0].ok, true);
});

dbTest("skedul_assert raises P0001 skedul:<code> and rolls its batch back", async ({ db, pro }) => {
  const typeId = nanoid();
  const err = await failure(
    db.batch([
      db.insert(schema.ticketType).values({ id: typeId, professionalId: pro.proId, name: "Rollback" }),
      db.execute(sql`select skedul_assert(false, 'stale')`),
    ]),
  );
  assert.equal(pgErrorInfo(err).code, "P0001");
  assert.equal(skedulCode(err), "stale");
  const rows = await db
    .select({ id: schema.ticketType.id })
    .from(schema.ticketType)
    .where(eq(schema.ticketType.id, typeId));
  assert.equal(rows.length, 0, "the insert before the assert was rolled back");

  // A scalar subquery on a missing row is NULL: IS NOT TRUE makes it raise too.
  const nullErr = await failure(db.execute(sql`select skedul_assert((select true where false), 'not_found')`));
  assert.equal(skedulCode(nullErr), "not_found");
});

dbTest("occurrence_rdv_excl refuses overlapping scheduled RDVs of one pro", async ({ db, pro }) => {
  const typeId = nanoid();
  await db.insert(schema.ticketType).values({
    id: typeId,
    professionalId: pro.proId,
    name: "Cours particulier",
    rdvEnabled: true,
    rdvDurationMin: 60,
  });
  const rdv = (start: Date, minutes: number) => ({
    id: nanoid(),
    professionalId: pro.proId,
    ticketTypeId: typeId,
    startsAt: start,
    endsAt: addMinutes(start, minutes),
    blockStart: start,
    blockEnd: addMinutes(start, minutes),
    capacity: 1,
    seatsTaken: 1,
  });
  const first = rdv(MON_0900, 60);
  await db.insert(schema.occurrence).values(first);

  const overlap = await failure(db.batch([db.insert(schema.occurrence).values(rdv(addMinutes(MON_0900, 30), 60))]));
  assert.equal(pgErrorInfo(overlap).code, "23P01");
  assert.equal(pgErrorInfo(overlap).constraint, "occurrence_rdv_excl");

  // [) ranges: an RDV starting when the first one ends is allowed.
  await db.insert(schema.occurrence).values(rdv(addMinutes(MON_0900, 60), 60));

  // An event séance is outside the EXCLUDE (the engine guards it, E4).
  const eventId = nanoid();
  await db.insert(schema.event).values({
    id: eventId,
    professionalId: pro.proId,
    title: "Atelier",
    capacity: 10,
    durationMin: 60,
    startDate: "2030-01-07",
    startMinute: 600,
    freq: "once",
    endMode: "count",
    occurrenceCount: 1,
    generatedUntil: "2030-01-07",
    seriesRootId: eventId,
  });
  await db.insert(schema.occurrence).values({
    id: nanoid(),
    professionalId: pro.proId,
    eventId,
    seriesDate: "2030-01-07",
    startsAt: MON_0900,
    endsAt: addMinutes(MON_0900, 60),
    blockStart: MON_0900,
    blockEnd: addMinutes(MON_0900, 60),
    capacity: 10,
  });

  // A cancelled RDV frees its slot.
  await db
    .update(schema.occurrence)
    .set({ status: "cancelled", cancelledAt: new Date(), seatsTaken: 0 })
    .where(eq(schema.occurrence.id, first.id));
  await db.insert(schema.occurrence).values(rdv(MON_0900, 30));

  // These hand-made RDVs have no booking: remove them so I1–I6 hold for the pro.
  await db.delete(schema.occurrence).where(eq(schema.occurrence.professionalId, pro.proId));
});

dbTest("deleting a pro's user removes every domain row (R2), NO ACTION refs included", async ({ db }) => {
  const other = await createTestPro(db);
  let deleted = false;
  try {
    const p = other.proId;
    const typeId = nanoid();
    const eventId = nanoid();
    const occId = nanoid();
    const customerId = nanoid();
    const bookingId = nanoid();
    const ticketId = nanoid();
    const offerId = nanoid();
    const purchaseId = nanoid();
    const questionId = nanoid();
    await db.insert(schema.ticketType).values({ id: typeId, professionalId: p, name: "Cours collectif" });
    await db.insert(schema.ticketOffer).values({ id: offerId, professionalId: p, ticketTypeId: typeId, quantity: 10, priceCents: 19_000 });
    await db.insert(schema.availabilityRule).values({ professionalId: p, dayOfWeek: 1, startMinute: 600, endMinute: 780 });
    await db.insert(schema.event).values({
      id: eventId,
      professionalId: p,
      title: "Altinha débutants",
      capacity: 12,
      durationMin: 60,
      startDate: "2030-01-07",
      startMinute: 1140,
      freq: "once",
      endMode: "count",
      occurrenceCount: 1,
      generatedUntil: "2030-01-07",
      seriesRootId: eventId,
    });
    await db.insert(schema.eventTicketType).values({ eventId, ticketTypeId: typeId, professionalId: p });
    await db.insert(schema.question).values({ id: questionId, professionalId: p, eventId, label: "Niveau ?", type: "text" });
    await db.insert(schema.occurrence).values({
      id: occId,
      professionalId: p,
      eventId,
      seriesDate: "2030-01-07",
      startsAt: new Date("2030-01-07T18:00:00.000Z"),
      endsAt: new Date("2030-01-07T19:00:00.000Z"),
      blockStart: new Date("2030-01-07T18:00:00.000Z"),
      blockEnd: new Date("2030-01-07T19:00:00.000Z"),
      capacity: 12,
      seatsTaken: 1,
    });
    await db.insert(schema.customer).values({ id: customerId, professionalId: p, email: testEmail(), name: "Léa" });
    // The deepest NO ACTION target: the booking, the ticket and the movement all point at it.
    await db.insert(schema.ticketPurchase).values({
      id: purchaseId,
      professionalId: p,
      customerId,
      offerId,
      ticketTypeId: typeId,
      label: "Carnet de 10",
      quantity: 10,
      amountCents: 19_000,
      currency: "eur",
      status: "paid",
      paidAt: new Date(),
      fulfilledActionId: nanoid(),
      checkoutExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    await db.insert(schema.booking).values({
      id: bookingId,
      professionalId: p,
      occurrenceId: occId,
      customerId,
      status: "confirmed",
      coverage: "ticket",
      purchaseId,
      createdBy: "pro",
      confirmedAt: new Date(),
    });
    await db.insert(schema.bookingAnswer).values({
      professionalId: p,
      bookingId,
      questionId,
      questionLabel: "Niveau ?",
      value: "Débutant",
    });
    await db.insert(schema.ticket).values({
      id: ticketId,
      professionalId: p,
      customerId,
      ticketTypeId: typeId,
      purchaseId,
      status: "booked",
      bookingId,
    });
    await db.insert(schema.ticketMovement).values({
      professionalId: p,
      customerId,
      ticketId,
      actionId: nanoid(),
      kind: "spend",
      fromStatus: "available",
      toStatus: "booked",
      ticketTypeId: typeId,
      bookingId,
      purchaseId,
      actor: "pro",
    });

    await deleteTestUser(db, other.userId);
    deleted = true;

    const left = await db.execute<{ n: number }>(sql`
      select (
        (select count(*) from professional where id = ${p})
        + (select count(*) from ticket_type where professional_id = ${p})
        + (select count(*) from ticket_offer where professional_id = ${p})
        + (select count(*) from availability_rule where professional_id = ${p})
        + (select count(*) from event where professional_id = ${p})
        + (select count(*) from event_ticket_type where professional_id = ${p})
        + (select count(*) from question where professional_id = ${p})
        + (select count(*) from occurrence where professional_id = ${p})
        + (select count(*) from customer where professional_id = ${p})
        + (select count(*) from booking where professional_id = ${p})
        + (select count(*) from ticket where professional_id = ${p})
        + (select count(*) from ticket_movement where professional_id = ${p})
        + (select count(*) from ticket_purchase where professional_id = ${p})
        + (select count(*) from booking_answer where professional_id = ${p})
      )::int as n`);
    assert.equal(left.rows[0].n, 0);
  } finally {
    if (!deleted) await deleteTestUser(db, other.userId);
  }
});
