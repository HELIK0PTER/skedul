import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addMinutes, dbTest, testEmail } from "../../test/db";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "../../test/rows";
import {
  G,
  PlanError,
  R,
  RET,
  SEAT,
  atomic,
  lockRows,
  textArray,
  tryAtomic,
  ts,
  type BatchCtx,
} from "./atomic";
import { pgErrorInfo } from "./pg-error";
import * as schema from "./schema";

const DAY = 86_400_000;

async function occurrenceRow(db: BatchCtx["db"], id: string) {
  const [row] = await db.select().from(schema.occurrence).where(eq(schema.occurrence.id, id));
  return row;
}

async function bookingRow(db: BatchCtx["db"], id: string) {
  const [row] = await db.select().from(schema.booking).where(eq(schema.booking.id, id));
  return row;
}

dbTest("atomic: an empty batch sends nothing and keeps the given aid", async ({ db }) => {
  const done = await atomic(db, async () => () => [], { aid: "fixed-aid" });
  assert.deepEqual(done, { aid: "fixed-aid", results: [] });
});

dbTest("G: a false predicate rolls back the statements before it", async ({ db, pro }) => {
  const id = nanoid();
  const now = new Date();
  const res = await tryAtomic(db, async () => () => [
    db.insert(schema.customer).values({
      id,
      professionalId: pro.proId,
      email: testEmail(),
      name: "Rollback",
      createdAt: now,
      updatedAt: now,
    }),
    G(db, sql`false`, "stale"),
  ]);
  assert.deepEqual(res, { ok: false, code: "stale" });
  const rows = await db.select().from(schema.customer).where(eq(schema.customer.id, id));
  assert.equal(rows.length, 0);
});

dbTest("G: a NULL predicate (a row that vanished) raises too", async ({ db }) => {
  const res = await tryAtomic(db, async () => () => [
    G(db, sql`(select name from customer where id = ${"missing"}) = 'x'`, "not_found"),
  ]);
  assert.deepEqual(res, { ok: false, code: "not_found" });
});

dbTest("tryAtomic: a PlanError becomes its code and detail", async ({ db }) => {
  const res = await tryAtomic(db, async () => {
    throw new PlanError("not_found", "no such occurrence");
  });
  assert.deepEqual(res, { ok: false, code: "not_found", message: "no such occurrence" });
});

dbTest("tryAtomic: skedul:already_paid is reported as duplicate", async ({ db }) => {
  const res = await tryAtomic(db, async () => () => [G(db, sql`false`, "already_paid")]);
  assert.deepEqual(res, { ok: false, code: "duplicate" });
});

dbTest("tryAtomic: replanOnStale re-runs plan() exactly once, and only for stale", async ({ db }) => {
  let plans = 0;
  const failWith = (code: "stale" | "full") => async () => {
    plans++;
    return () => [G(db, sql`false`, code)];
  };

  assert.deepEqual(await tryAtomic(db, failWith("stale")), { ok: false, code: "stale" });
  assert.equal(plans, 1, "no re-plan without the option");

  plans = 0;
  assert.deepEqual(await tryAtomic(db, failWith("stale"), { replanOnStale: true }), { ok: false, code: "stale" });
  assert.equal(plans, 2, "one re-plan, then stale is returned");

  plans = 0;
  assert.deepEqual(await tryAtomic(db, failWith("full"), { replanOnStale: true }), { ok: false, code: "full" });
  assert.equal(plans, 1, "other codes are never re-planned");

  plans = 0;
  const staleOnce = async () => {
    plans++;
    const pass = plans > 1;
    return () => [G(db, sql.raw(pass ? "true" : "false"), "stale")];
  };
  const res = await tryAtomic(db, staleOnce, { replanOnStale: true });
  assert.equal(res.ok, true);
  assert.equal(plans, 2);
});

dbTest("tryAtomic: afterPlan runs once, between the first plan and its batch", async ({ db, pro }) => {
  let plans = 0;
  let hooks = 0;
  let staged: string | null = null;
  const res = await tryAtomic(
    db,
    async () => {
      plans++;
      const first = plans === 1;
      return () => [
        // the row staged by the hook is visible to the FIRST batch: the hook ran before it
        G(db, sql`exists (select 1 from customer where id = ${staged ?? "none"})`, "not_found"),
        G(db, sql.raw(first ? "false" : "true"), "stale"),
      ];
    },
    {
      replanOnStale: true,
      afterPlan: async () => {
        hooks++;
        staged = await rowCustomer(db, pro);
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(plans, 2);
  assert.equal(hooks, 1, "the hook is not re-run by the re-plan");
});

dbTest("textArray binds ONE text[] parameter; lockRows dedupes and sorts", async ({ db, pro }) => {
  const a = await rowCustomer(db, pro, { name: "A" });
  const b = await rowCustomer(db, pro, { name: "B" });
  const c = await rowCustomer(db, pro, { name: "C" });
  const done = await atomic(db, async () => () => [
    lockRows(db, "customer", [c, a, b, a]),
    db.execute(sql`update customer set name = 'Renamed' where id = any(${textArray([a, b])})`),
  ]);
  const locked = done.results[0] as { rows: { id: string }[] };
  assert.deepEqual(
    locked.rows.map((r) => r.id),
    [a, b, c].sort(),
  );
  const rows = await db
    .select({ id: schema.customer.id, name: schema.customer.name })
    .from(schema.customer)
    .where(inArray(schema.customer.id, [a, b, c]));
  const names = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  assert.deepEqual(names, { [a]: "Renamed", [b]: "Renamed", [c]: "C" });
});

dbTest("R + SEAT(o, 0): an elapsed hold expires and an RDV left with 0 seats is cancelled", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const customerId = await rowCustomer(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
  const o = await rowRdv(db, pro, typeId, { startsAt: new Date(now.getTime() + 2 * DAY) });
  const b = await rowBooking(db, pro, {
    occurrenceId: o,
    customerId,
    status: "pending",
    coverage: "ticket",
    purchaseId,
    holdExpiresAt: addMinutes(now, -1),
  });

  const done = await atomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [lockRows(db, "occurrence", [o]), R(c, o), SEAT(c, o, 0)];
  });

  const occ = await occurrenceRow(db, o);
  assert.equal(occ.seatsTaken, 0);
  assert.equal(occ.status, "cancelled");
  assert.equal(occ.cancelledAt?.getTime(), now.getTime());
  const bk = await bookingRow(db, b);
  assert.equal(bk.status, "expired");
  assert.equal(bk.endedBy, "system");
  assert.equal(bk.endedActionId, done.aid);
  assert.equal(bk.endedAt?.getTime(), now.getTime());
});

dbTest("R only expires elapsed holds; SEAT counts them once", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowType(db, pro);
  const offerId = await rowOffer(db, pro, typeId);
  const eventId = await rowEvent(db, pro, { capacity: 3 });
  const o = await rowSeance(db, pro, eventId, { capacity: 3, seatsTaken: 2 });
  const holds: string[] = [];
  for (const holdExpiresAt of [addMinutes(now, -5), addMinutes(now, 30)]) {
    const customerId = await rowCustomer(db, pro);
    const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeId });
    holds.push(
      await rowBooking(db, pro, { occurrenceId: o, customerId, status: "pending", coverage: "ticket", purchaseId, holdExpiresAt }),
    );
  }

  await atomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [lockRows(db, "occurrence", [o]), R(c, o), SEAT(c, o, 0)];
  });

  assert.equal((await bookingRow(db, holds[0])).status, "expired");
  assert.equal((await bookingRow(db, holds[1])).status, "pending");
  const occ = await occurrenceRow(db, o);
  assert.equal(occ.seatsTaken, 1);
  assert.equal(occ.status, "scheduled", "an event séance is never cancelled by SEAT");
});

dbTest("SEAT(o, +1) on a full occurrence maps to full", async ({ db, pro }) => {
  const typeId = await rowRdvType(db, pro);
  const o = await rowRdv(db, pro, typeId);
  await rowBooking(db, pro, { occurrenceId: o, customerId: await rowCustomer(db, pro), coverage: "guest" });
  const now = new Date();
  const res = await tryAtomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [lockRows(db, "occurrence", [o]), SEAT(c, o, 1)];
  });
  assert.deepEqual(res, { ok: false, code: "full" });
  assert.equal((await occurrenceRow(db, o)).seatsTaken, 1);
});

dbTest("SEAT extraSeat (pro « +1 place ») raises the capacity of a full séance", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro, { bookingMode: "free", capacity: 1 });
  const o = await rowSeance(db, pro, eventId, { capacity: 1, seatsTaken: 1 });
  await rowBooking(db, pro, { occurrenceId: o, customerId: await rowCustomer(db, pro), coverage: "free" });
  const second = await rowCustomer(db, pro);
  const now = new Date();
  await atomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [
      lockRows(db, "occurrence", [o]),
      SEAT(c, o, 1, { extraSeat: true }),
      db.insert(schema.booking).values({
        id: nanoid(),
        professionalId: pro.proId,
        occurrenceId: o,
        customerId: second,
        status: "confirmed",
        coverage: "guest",
        createdBy: "pro",
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ];
  });
  const occ = await occurrenceRow(db, o);
  assert.equal(occ.seatsTaken, 2);
  assert.equal(occ.capacity, 2);
  assert.equal(occ.capacityOverride, true);
});

dbTest("RET gives back every ticket of the bookings this action ended, one return movement each", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  const customerId = await rowCustomer(db, pro);
  const rdvA = await rowRdv(db, pro, typeId, { startsAt: new Date(now.getTime() + 2 * DAY) });
  const rdvB = await rowRdv(db, pro, typeId, { startsAt: new Date(now.getTime() + 3 * DAY) });
  const bookingA = await rowBooking(db, pro, { occurrenceId: rdvA, customerId, coverage: "ticket" });
  const bookingB = await rowBooking(db, pro, { occurrenceId: rdvB, customerId, coverage: "ticket" });
  const ticketA = await rowTicket(db, pro, { customerId, ticketTypeId: typeId, status: "booked", bookingId: bookingA });
  const ticketB = await rowTicket(db, pro, {
    customerId,
    ticketTypeId: typeId,
    status: "booked",
    bookingId: bookingB,
    expiresAt: new Date(now.getTime() - 3_600_000),
  });

  const done = await atomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [
      lockRows(db, "occurrence", [rdvB, rdvA]),
      db.execute(sql`
        update booking set status = 'cancelled', ended_at = ${ts(now)}, ended_by = 'pro',
          ended_action_id = ${aid}, updated_at = ${ts(now)}
        where id = any(${textArray([bookingA, bookingB])})`),
      SEAT(c, rdvA, 0),
      SEAT(c, rdvB, 0),
      RET(c, { actor: "pro", userId: pro.userId }),
    ];
  });

  const tickets = await db.select().from(schema.ticket).where(inArray(schema.ticket.id, [ticketA, ticketB]));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  assert.equal(byId.get(ticketA)?.status, "available");
  assert.equal(byId.get(ticketA)?.bookingId, null);
  assert.equal(byId.get(ticketB)?.status, "expired", "a ticket past its expiry comes back expired");
  assert.equal(byId.get(ticketB)?.bookingId, null);

  const moves = await db
    .select()
    .from(schema.ticketMovement)
    .where(eq(schema.ticketMovement.actionId, done.aid));
  assert.equal(moves.length, 2);
  const moveOf = new Map(moves.map((m) => [m.ticketId, m]));
  assert.equal(moveOf.get(ticketA)?.kind, "return");
  assert.equal(moveOf.get(ticketA)?.fromStatus, "booked");
  assert.equal(moveOf.get(ticketA)?.toStatus, "available");
  assert.equal(moveOf.get(ticketA)?.bookingId, bookingA);
  assert.equal(moveOf.get(ticketA)?.actorUserId, pro.userId);
  assert.equal(moveOf.get(ticketB)?.toStatus, "expired");

  for (const o of [rdvA, rdvB]) {
    const occ = await occurrenceRow(db, o);
    assert.equal(occ.status, "cancelled");
    assert.equal(occ.seatsTaken, 0);
  }
});

dbTest("23503: stale when writing, in_use when deleting", async ({ db, pro }) => {
  const now = new Date();
  const customerId = await rowCustomer(db, pro);
  const write = await tryAtomic(db, async () => () => [
    db.insert(schema.booking).values({
      id: nanoid(),
      professionalId: pro.proId,
      occurrenceId: "missing-occurrence",
      customerId,
      status: "confirmed",
      coverage: "guest",
      createdBy: "pro",
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  assert.deepEqual(write, { ok: false, code: "stale" });

  const typeId = await rowType(db, pro);
  await rowTicket(db, pro, { customerId, ticketTypeId: typeId });
  const del = await tryAtomic(db, async () => () => [db.delete(schema.ticketType).where(eq(schema.ticketType.id, typeId))], {
    ctx: "delete",
  });
  assert.deepEqual(del, { ok: false, code: "in_use" });
});

dbTest("23505 booking_active_uq maps to already_booked", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro, { bookingMode: "free" });
  const o = await rowSeance(db, pro, eventId, { seatsTaken: 1 });
  const customerId = await rowCustomer(db, pro);
  await rowBooking(db, pro, { occurrenceId: o, customerId, coverage: "free" });
  const now = new Date();
  const res = await tryAtomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    return [
      lockRows(db, "occurrence", [o]),
      SEAT(c, o, 1),
      db.insert(schema.booking).values({
        id: nanoid(),
        professionalId: pro.proId,
        occurrenceId: o,
        customerId,
        status: "confirmed",
        coverage: "free",
        createdBy: "client",
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ];
  });
  assert.deepEqual(res, { ok: false, code: "already_booked" });
  assert.equal((await occurrenceRow(db, o)).seatsTaken, 1, "the batch was rolled back");
});

dbTest("23P01 occurrence_rdv_excl maps to slot_taken", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  const startsAt = new Date(now.getTime() + 2 * DAY);
  const first = await rowRdv(db, pro, typeId, { startsAt });
  await rowBooking(db, pro, { occurrenceId: first, customerId: await rowCustomer(db, pro), coverage: "guest" });
  const overlapStart = addMinutes(startsAt, 30);
  const overlapEnd = addMinutes(startsAt, 90);
  const res = await tryAtomic(db, async () => () => [
    db.insert(schema.occurrence).values({
      id: nanoid(),
      professionalId: pro.proId,
      ticketTypeId: typeId,
      startsAt: overlapStart,
      endsAt: overlapEnd,
      blockStart: overlapStart,
      blockEnd: overlapEnd,
      capacity: 1,
      seatsTaken: 1,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  assert.deepEqual(res, { ok: false, code: "slot_taken" });
});

dbTest("tryAtomic rethrows a unique violation other than booking_active_uq", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail();
  const customerRow = () => ({
    id: nanoid(),
    professionalId: pro.proId,
    email,
    name: "Twin",
    createdAt: now,
    updatedAt: now,
  });
  await assert.rejects(
    tryAtomic(db, async () => () => [
      db.insert(schema.customer).values(customerRow()),
      db.insert(schema.customer).values(customerRow()),
    ]),
    (err: unknown) => {
      assert.equal(pgErrorInfo(err).code, "23505");
      assert.equal(pgErrorInfo(err).constraint, "customer_pro_email_uq");
      return true;
    },
  );
});
