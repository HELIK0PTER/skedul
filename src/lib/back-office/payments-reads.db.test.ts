import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";

import { checkInvariants } from "@/lib/booking/invariants";
import { revenueByCurrency } from "@/lib/booking/revenue";
import type { Db } from "@/lib/db/atomic";
import { event, ticket, ticketPurchase } from "@/lib/db/schema";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, type TestPro } from "../../test/db";
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
import { getPayments, parsePaymentsPeriod } from "./payments-reads";

const DAY = 86_400_000;
const MINUTE = 60_000;

type Shop = { typeId: string; offerId: string };

async function makeShop(db: Db, pro: TestPro, name: string): Promise<Shop> {
  const typeId = await rowType(db, pro, { name });
  const offerId = await rowOffer(db, pro, typeId);
  return { typeId, offerId };
}

/** A paid purchase and its `quantity` available tickets (invariants I3 and I6 hold). */
async function paidPurchase(
  db: Db,
  pro: TestPro,
  shop: Shop,
  customerId: string,
  args: {
    paidAt: Date;
    label?: string;
    quantity?: number;
    amountCents?: number;
    currency?: string;
    livemode?: boolean;
  },
): Promise<{ purchaseId: string }> {
  const quantity = args.quantity ?? 1;
  const purchaseId = await rowPurchase(db, pro, {
    customerId,
    offerId: shop.offerId,
    ticketTypeId: shop.typeId,
    status: "paid",
    quantity,
    amountCents: args.amountCents,
    currency: args.currency,
    livemode: args.livemode,
    paymentIntentId: args.livemode ? "pi_live_test" : null,
    paidAt: args.paidAt,
  });
  if (args.label) {
    await db.update(ticketPurchase).set({ label: args.label }).where(eq(ticketPurchase.id, purchaseId));
  }
  for (let i = 0; i < quantity; i += 1) {
    await rowTicket(db, pro, { customerId, ticketTypeId: shop.typeId, purchaseId });
  }
  return { purchaseId };
}

dbTest("getPayments lists the paid purchases only, newest first", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const alice = await rowCustomer(db, pro, { name: "Alice Martin", email: "alice@skedul.test" });
  const old = await paidPurchase(db, pro, shop, alice, {
    paidAt: addDaysMs(now, -3),
    label: "Carnet de 4",
    quantity: 4,
    amountCents: 8500,
  });
  const newest = await paidPurchase(db, pro, shop, alice, { paidAt: addDaysMs(now, -1), label: "À l'unité" });
  const middle = await paidPurchase(db, pro, shop, alice, { paidAt: addDaysMs(now, -2) });
  await rowPurchase(db, pro, { customerId: alice, offerId: shop.offerId, ticketTypeId: shop.typeId });
  await rowPurchase(db, pro, { customerId: alice, offerId: shop.offerId, ticketTypeId: shop.typeId, status: "expired" });

  const { rows } = await getPayments(db, pro.proId, now, { period: "tout", live: false });

  assert.deepEqual(
    rows.map((r) => r.purchaseId),
    [newest.purchaseId, middle.purchaseId, old.purchaseId],
  );
  const last = rows[2];
  assert.equal(last.customerId, alice);
  assert.equal(last.customerName, "Alice Martin");
  assert.equal(last.customerEmail, "alice@skedul.test");
  assert.equal(last.label, "Carnet de 4");
  assert.equal(last.quantity, 4);
  assert.equal(last.amountCents, 8500);
  assert.equal(last.currency, "eur");
  assert.equal(last.livemode, false);
  assert.equal(last.paidAt.getTime(), addDaysMs(now, -3).getTime());
  assert.equal(last.booking, null);
  assert.deepEqual(last.closedNotes, []);
});

dbTest("getPayments period 30j keeps paid_at at or after now minus 30 days", async ({ db, pro }) => {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const shop = await makeShop(db, pro, "Cours collectif");
  const customerId = await rowCustomer(db, pro);
  const recent = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -10), amountCents: 2500 });
  const edge = await paidPurchase(db, pro, shop, customerId, { paidAt: since, amountCents: 1000 });
  const justBefore = await paidPurchase(db, pro, shop, customerId, {
    paidAt: new Date(since.getTime() - 1),
    amountCents: 400,
  });
  const old = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -40), amountCents: 300 });

  const month = await getPayments(db, pro.proId, now, { period: "30j", live: false });
  assert.deepEqual(
    month.rows.map((r) => r.purchaseId),
    [recent.purchaseId, edge.purchaseId],
  );
  assert.deepEqual(month.totals, [{ currency: "eur", cents: 3500 }]);
  assert.deepEqual(month.totals, await revenueByCurrency(db, { live: false, professionalId: pro.proId, since }));

  const all = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  assert.deepEqual(
    all.rows.map((r) => r.purchaseId),
    [recent.purchaseId, edge.purchaseId, justBefore.purchaseId, old.purchaseId],
  );
  assert.deepEqual(all.totals, [{ currency: "eur", cents: 4200 }]);
});

dbTest("getPayments links the booking paid by a buy + book purchase", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const customerId = await rowCustomer(db, pro);

  const eventId = await rowEvent(db, pro);
  const startsAt = new Date(now.getTime() + 2 * DAY);
  const seance = await rowSeance(db, pro, eventId, { startsAt, seatsTaken: 1 });
  const seancePurchase = await rowPurchase(db, pro, {
    customerId,
    offerId: shop.offerId,
    ticketTypeId: shop.typeId,
    status: "paid",
    paidAt: addDaysMs(now, -1),
  });
  const seanceBooking = await rowBooking(db, pro, {
    occurrenceId: seance,
    customerId,
    coverage: "ticket",
    purchaseId: seancePurchase,
  });
  await rowTicket(db, pro, {
    customerId,
    ticketTypeId: shop.typeId,
    purchaseId: seancePurchase,
    status: "booked",
    bookingId: seanceBooking,
  });

  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdvOffer = await rowOffer(db, pro, rdvType);
  const rdvStartsAt = new Date(now.getTime() + 5 * DAY);
  const rdv = await rowRdv(db, pro, rdvType, { startsAt: rdvStartsAt });
  const rdvPurchase = await rowPurchase(db, pro, {
    customerId,
    offerId: rdvOffer,
    ticketTypeId: rdvType,
    status: "paid",
    paidAt: addDaysMs(now, -2),
  });
  const rdvBooking = await rowBooking(db, pro, {
    occurrenceId: rdv,
    customerId,
    coverage: "ticket",
    purchaseId: rdvPurchase,
  });
  await rowTicket(db, pro, {
    customerId,
    ticketTypeId: rdvType,
    purchaseId: rdvPurchase,
    status: "booked",
    bookingId: rdvBooking,
  });

  const plain = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -3) });

  const [eventRow] = await db.select({ title: event.title }).from(event).where(eq(event.id, eventId));
  const { rows } = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  const byId = new Map(rows.map((r) => [r.purchaseId, r]));

  assert.deepEqual(byId.get(seancePurchase)?.booking, {
    occurrenceId: seance,
    title: eventRow.title,
    startsAt,
    status: "confirmed",
  });
  assert.deepEqual(byId.get(rdvPurchase)?.booking, {
    occurrenceId: rdv,
    title: "Cours particulier",
    startsAt: rdvStartsAt,
    status: "confirmed",
  });
  assert.equal(byId.get(plain.purchaseId)?.booking, null);
});

dbTest("getPayments reads the real status of a linked booking whose hold lapsed", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const eventId = await rowEvent(db, pro);

  /** A paid purchase (tickets available) linked to a booking of its own on a fresh séance. */
  async function linked(
    daysAgo: number,
    bookingArgs: { status: "pending" | "cancelled" | "expired"; holdExpiresAt?: Date },
  ): Promise<{ purchaseId: string; occurrenceId: string }> {
    const customerId = await rowCustomer(db, pro);
    const active = bookingArgs.status === "pending";
    const occurrenceId = await rowSeance(db, pro, eventId, {
      startsAt: new Date(now.getTime() + (daysAgo + 3) * DAY),
      seatsTaken: active ? 1 : 0,
    });
    const { purchaseId } = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -daysAgo) });
    await rowBooking(db, pro, { occurrenceId, customerId, coverage: "ticket", purchaseId, ...bookingArgs });
    return { purchaseId, occurrenceId };
  }

  // The nightly job already ended the booking: money received after the hold, the tickets went to the wallet.
  const swept = await linked(1, { status: "expired" });
  // The hold ended 5 minutes ago and nothing released it yet (the engine's expireElapsedHolds rule: pending and hold_expires_at < now).
  const lapsed = await linked(2, { status: "pending", holdExpiresAt: new Date(now.getTime() - 5 * MINUTE) });
  // A hold that is still running.
  const running = await linked(3, { status: "pending", holdExpiresAt: new Date(now.getTime() + 20 * MINUTE) });
  const cancelled = await linked(4, { status: "cancelled" });

  const { rows } = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  const statusOf = (purchaseId: string) => rows.find((r) => r.purchaseId === purchaseId)?.booking?.status;

  assert.equal(statusOf(swept.purchaseId), "expired");
  assert.equal(statusOf(lapsed.purchaseId), "expired");
  assert.equal(statusOf(running.purchaseId), "pending");
  assert.equal(statusOf(cancelled.purchaseId), "cancelled");
  assert.equal(rows.find((r) => r.purchaseId === lapsed.purchaseId)?.booking?.occurrenceId, lapsed.occurrenceId);
});

dbTest("getPayments groups the closed tickets of a purchase by reason and note", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const customerId = await rowCustomer(db, pro);

  const carnet = await rowPurchase(db, pro, {
    customerId,
    offerId: shop.offerId,
    ticketTypeId: shop.typeId,
    status: "paid",
    quantity: 5,
    amountCents: 8500,
    paidAt: addDaysMs(now, -1),
  });
  const closedIds: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    closedIds.push(await rowTicket(db, pro, { customerId, ticketTypeId: shop.typeId, purchaseId: carnet, status: "closed" }));
  }
  await rowTicket(db, pro, { customerId, ticketTypeId: shop.typeId, purchaseId: carnet });
  await db
    .update(ticket)
    .set({ closedReason: "rembourse", closedNote: "Remboursé en espèces" })
    .where(inArray(ticket.id, closedIds.slice(0, 2)));
  await db.update(ticket).set({ closedReason: "rembourse", closedNote: null }).where(eq(ticket.id, closedIds[2]));
  await db.update(ticket).set({ closedReason: "autre", closedNote: "Geste commercial" }).where(eq(ticket.id, closedIds[3]));

  const second = await rowPurchase(db, pro, {
    customerId,
    offerId: shop.offerId,
    ticketTypeId: shop.typeId,
    status: "paid",
    paidAt: addDaysMs(now, -2),
  });
  const secondTicket = await rowTicket(db, pro, {
    customerId,
    ticketTypeId: shop.typeId,
    purchaseId: second,
    status: "closed",
  });
  await db.update(ticket).set({ closedReason: "compense" }).where(eq(ticket.id, secondTicket));

  // An offered ticket closed with no purchase belongs to no payment row.
  await rowTicket(db, pro, { customerId, ticketTypeId: shop.typeId, status: "closed" });

  const { rows } = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  const byId = new Map(rows.map((r) => [r.purchaseId, r]));

  assert.deepEqual(byId.get(carnet)?.closedNotes, [
    { reason: "rembourse", note: null, count: 1 },
    { reason: "rembourse", note: "Remboursé en espèces", count: 2 },
    { reason: "autre", note: "Geste commercial", count: 1 },
  ]);
  assert.deepEqual(byId.get(second)?.closedNotes, [{ reason: "compense", note: null, count: 1 }]);
});

dbTest("getPayments counts the closed tickets of each purchase on their own", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const customerId = await rowCustomer(db, pro);

  /** A paid purchase of `quantity` tickets, `closed` of them closed for the same reason and note (I3 and I4 hold). */
  async function purchaseWithClosed(daysAgo: number, quantity: number, closed: number): Promise<string> {
    const purchaseId = await rowPurchase(db, pro, {
      customerId,
      offerId: shop.offerId,
      ticketTypeId: shop.typeId,
      status: "paid",
      quantity,
      paidAt: addDaysMs(now, -daysAgo),
    });
    const closedIds: string[] = [];
    for (let i = 0; i < quantity; i += 1) {
      const isClosed = i < closed;
      const id = await rowTicket(db, pro, {
        customerId,
        ticketTypeId: shop.typeId,
        purchaseId,
        status: isClosed ? "closed" : "available",
      });
      if (isClosed) closedIds.push(id);
    }
    if (closedIds.length > 0) {
      await db
        .update(ticket)
        .set({ closedReason: "rembourse", closedNote: "Remboursé en espèces" })
        .where(inArray(ticket.id, closedIds));
    }
    return purchaseId;
  }

  const three = await purchaseWithClosed(1, 4, 3);
  const one = await purchaseWithClosed(2, 2, 1);
  const none = await purchaseWithClosed(3, 2, 0);

  const { rows } = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  const byId = new Map(rows.map((r) => [r.purchaseId, r]));

  assert.deepEqual(byId.get(three)?.closedNotes, [{ reason: "rembourse", note: "Remboursé en espèces", count: 3 }]);
  assert.deepEqual(byId.get(one)?.closedNotes, [{ reason: "rembourse", note: "Remboursé en espèces", count: 1 }]);
  assert.deepEqual(byId.get(none)?.closedNotes, []);
});

dbTest("getPayments totals follow the Encaissé predicate while the rows list live and test payments", async ({ db, pro }) => {
  const now = new Date();
  const shop = await makeShop(db, pro, "Cours collectif");
  const customerId = await rowCustomer(db, pro);
  const testSale = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -2), amountCents: 2500 });
  const liveSale = await paidPurchase(db, pro, shop, customerId, {
    paidAt: addDaysMs(now, -1),
    amountCents: 4000,
    livemode: true,
  });
  const swiss = await paidPurchase(db, pro, shop, customerId, {
    paidAt: addDaysMs(now, -3),
    amountCents: 700,
    currency: "chf",
  });
  const oldSale = await paidPurchase(db, pro, shop, customerId, { paidAt: addDaysMs(now, -40), amountCents: 1000 });

  const mock = await getPayments(db, pro.proId, now, { period: "tout", live: false });
  assert.deepEqual(
    mock.rows.map((r) => r.purchaseId),
    [liveSale.purchaseId, testSale.purchaseId, swiss.purchaseId, oldSale.purchaseId],
  );
  assert.deepEqual(
    mock.rows.map((r) => r.livemode),
    [true, false, false, false],
  );
  assert.deepEqual(mock.totals, [
    { currency: "chf", cents: 700 },
    { currency: "eur", cents: 3500 },
  ]);
  assert.deepEqual(mock.totals, await revenueByCurrency(db, { live: false, professionalId: pro.proId }));

  const live = await getPayments(db, pro.proId, now, { period: "tout", live: true });
  assert.equal(live.rows.length, 4);
  assert.deepEqual(live.totals, [{ currency: "eur", cents: 4000 }]);

  const month = await getPayments(db, pro.proId, now, { period: "30j", live: false });
  assert.deepEqual(
    month.rows.map((r) => r.purchaseId),
    [liveSale.purchaseId, testSale.purchaseId, swiss.purchaseId],
  );
  assert.deepEqual(month.totals, [
    { currency: "chf", cents: 700 },
    { currency: "eur", cents: 2500 },
  ]);
});

dbTest("getPayments never returns another pro's purchases", async ({ db, pro }) => {
  const now = new Date();
  const mine = await makeShop(db, pro, "Mon cours");
  const myCustomer = await rowCustomer(db, pro, { name: "Ma cliente" });
  const mySale = await paidPurchase(db, pro, mine, myCustomer, { paidAt: addDaysMs(now, -1), amountCents: 2500 });

  const other = await createTestPro(db);
  try {
    const theirs = await makeShop(db, other, "Leur cours");
    const theirCustomer = await rowCustomer(db, other, { name: "Leur cliente" });
    const theirSale = await paidPurchase(db, other, theirs, theirCustomer, {
      paidAt: addDaysMs(now, -1),
      amountCents: 9900,
    });

    const mineRes = await getPayments(db, pro.proId, now, { period: "tout", live: false });
    assert.deepEqual(
      mineRes.rows.map((r) => r.purchaseId),
      [mySale.purchaseId],
    );
    assert.deepEqual(mineRes.totals, [{ currency: "eur", cents: 2500 }]);

    const theirRes = await getPayments(db, other.proId, now, { period: "tout", live: false });
    assert.deepEqual(
      theirRes.rows.map((r) => r.purchaseId),
      [theirSale.purchaseId],
    );
    assert.deepEqual(theirRes.totals, [{ currency: "eur", cents: 9900 }]);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

test("parsePaymentsPeriod accepts 30j and falls back to tout", () => {
  assert.equal(parsePaymentsPeriod("30j"), "30j");
  assert.equal(parsePaymentsPeriod("tout"), "tout");
  for (const value of ["", "7j", "30J", undefined, null, 30, ["30j"]]) {
    assert.equal(parsePaymentsPeriod(value), "tout");
  }
});
