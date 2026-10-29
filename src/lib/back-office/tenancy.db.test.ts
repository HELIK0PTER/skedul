/**
 * P6 A1: the back-office reads join event and ticket_type under the reading pro's id. Every domain foreign key is
 * single-column, so a row of mine that points at another pro's event, type or séance is accepted by the database; the
 * reads must not surface a field of theirs through it (title, type name, booking mode, eligibility).
 */
import assert from "node:assert/strict";
import { nanoid } from "nanoid";

import { usableTickets } from "@/lib/booking/eligibility";

import { createTestPro, dbTest, deleteTestUser } from "../../test/db";
import {
  rowBooking,
  rowCustomer,
  rowEvent,
  rowLink,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
} from "../../test/rows";
import { getDashboardData } from "./dashboard-reads";
import { getPayments } from "./payments-reads";
import { getPlanningRange, moveTargets, registerOptions } from "./planning-reads";

const DAY = 86_400_000;

dbTest("a row of mine pointing at another pro's event, type or séance shows none of their fields (P6 A1)", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const theirTypeName = `Leur type ${nanoid(6)}`;
    const theirType = await rowRdvType(db, other, { name: theirTypeName });
    const theirEvent = await rowEvent(db, other, { bookingMode: "free" });
    const theirTitle = `Event ${theirEvent}`;
    const theirSeance = await rowSeance(db, other, theirEvent, { seatsTaken: 1 });

    const myCustomer = await rowCustomer(db, pro);
    // My séance of THEIR event, with a link of mine to THEIR type, and a confirmed booking of mine holding a ticket of THEIR type.
    const crossedSeance = await rowSeance(db, pro, theirEvent, { seatsTaken: 1, startsAt: new Date(now.getTime() + 3 * DAY) });
    await rowLink(db, pro, theirEvent, theirType);
    const onCrossedSeance = await rowBooking(db, pro, { occurrenceId: crossedSeance, customerId: myCustomer, coverage: "ticket" });
    await rowTicket(db, pro, { customerId: myCustomer, ticketTypeId: theirType, status: "booked", bookingId: onCrossedSeance });
    // My RDV of THEIR type, paid by a purchase of mine through an offer of mine on THEIR type, and an available ticket of THEIR type.
    const crossedOffer = await rowOffer(db, pro, theirType);
    const rdvPurchase = await rowPurchase(db, pro, { customerId: myCustomer, offerId: crossedOffer, ticketTypeId: theirType, status: "paid" });
    const crossedRdv = await rowRdv(db, pro, theirType);
    await rowBooking(db, pro, { occurrenceId: crossedRdv, customerId: myCustomer, purchaseId: rdvPurchase });
    await rowTicket(db, pro, { customerId: myCustomer, ticketTypeId: theirType });
    // A paid purchase of mine whose booking sits on THEIR séance.
    const seancePurchase = await rowPurchase(db, pro, { customerId: myCustomer, offerId: crossedOffer, ticketTypeId: theirType, status: "paid" });
    await rowBooking(db, pro, { occurrenceId: theirSeance, customerId: myCustomer, purchaseId: seancePurchase });
    // A genuine séance of mine with a confirmed guest booking: the source of « Déplacer ».
    const myEvent = await rowEvent(db, pro);
    const mySeance = await rowSeance(db, pro, myEvent, { seatsTaken: 1, startsAt: new Date(now.getTime() + DAY) });
    const guest = await rowBooking(db, pro, { occurrenceId: mySeance, customerId: await rowCustomer(db, pro) });

    const leaks: string[] = [];
    const scan = (label: string, value: unknown) => {
      const text = JSON.stringify(value);
      for (const secret of [theirTitle, theirTypeName]) if (text.includes(secret)) leaks.push(`${label}: ${secret}`);
    };
    scan("planning", await getPlanningRange(db, pro.proId, { start: now, end: new Date(now.getTime() + 7 * DAY) }, now));
    const dashboard = await getDashboardData(db, { id: pro.proId, timezone: pro.tz, currency: pro.currency }, now, false);
    scan("dashboard", dashboard);
    if (dashboard.gettingStarted.hasOffer) leaks.push("dashboard: an offer of mine on their type counts as « offre »");
    const payments = await getPayments(db, pro.proId, now, { period: "tout", live: false });
    scan("payments", payments);
    if (payments.rows.find((r) => r.purchaseId === seancePurchase)?.booking) leaks.push("payments: a booking on their séance");
    const targets = await moveTargets(db, pro.proId, guest, now);
    scan("moveTargets", targets);
    if (targets?.targets.some((t) => t.occurrenceId === crossedSeance)) leaks.push("moveTargets: a séance of their event");
    if ((await registerOptions(db, pro.proId, crossedSeance, myCustomer, now)) !== null) leaks.push("registerOptions: their booking mode");
    if ((await usableTickets(db, { customerId: myCustomer, occurrenceId: crossedRdv })).length > 0) leaks.push("usableTickets: a ticket of their type");
    assert.deepEqual(leaks, []);
  } finally {
    // Mine first (my rows are the ones that point across), then theirs: no NO ACTION link is left to block it.
    await deleteTestUser(db, pro.userId);
    await deleteTestUser(db, other.userId);
  }
});
