import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { buildBookingIcs, loadIcsFacts } from "@/lib/back-office/ics";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { createTestPro, dbTest, deleteTestUser } from "@/test/db";
import { getOccurrence } from "@/test/fixtures";
import { rowBooking, rowCustomer, rowEvent, rowOffer, rowPurchase, rowRdv, rowRdvType, rowSeance, rowType } from "@/test/rows";

async function businessNameOf(db: Db, proId: string): Promise<string> {
  const [row] = await db
    .select({ name: schema.professional.businessName })
    .from(schema.professional)
    .where(eq(schema.professional.id, proId));
  return row.name;
}

dbTest("loadIcsFacts: a confirmed booking on a séance gives the event title and the effective location", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro);
  await db
    .update(schema.event)
    .set({ title: "Altinha débutants", location: "Gymnase Jean Bouin" })
    .where(eq(schema.event.id, eventId));
  const seance = await rowSeance(db, pro, eventId, { seatsTaken: 1 });
  const bookingId = await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" });
  const occ = await getOccurrence(db, seance);

  const facts = await loadIcsFacts(db, bookingId);
  assert.deepEqual(facts, {
    bookingId,
    title: "Altinha débutants",
    location: "Gymnase Jean Bouin",
    startAt: occ.startsAt,
    endAt: occ.endsAt,
    businessName: await businessNameOf(db, pro.proId),
  });

  // A location set on the séance itself wins over the event's.
  await db.update(schema.occurrence).set({ locationOverride: "Salle B" }).where(eq(schema.occurrence.id, seance));
  assert.equal((await loadIcsFacts(db, bookingId))?.location, "Salle B");

  // No location anywhere (or an empty one): null, never an empty string.
  await db.update(schema.occurrence).set({ locationOverride: null }).where(eq(schema.occurrence.id, seance));
  await db.update(schema.event).set({ location: null }).where(eq(schema.event.id, eventId));
  assert.equal((await loadIcsFacts(db, bookingId))?.location, null);
  await db.update(schema.event).set({ location: "" }).where(eq(schema.event.id, eventId));
  assert.equal((await loadIcsFacts(db, bookingId))?.location, null);
});

dbTest("loadIcsFacts: a confirmed RDV gives the type name and no location", async ({ db, pro }) => {
  const typeId = await rowRdvType(db, pro, { name: "Cours particulier" });
  const rdv = await rowRdv(db, pro, typeId);
  const bookingId = await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro), status: "confirmed" });
  const occ = await getOccurrence(db, rdv);

  assert.deepEqual(await loadIcsFacts(db, bookingId), {
    bookingId,
    title: "Cours particulier",
    location: null,
    startAt: occ.startsAt,
    endAt: occ.endsAt,
    businessName: await businessNameOf(db, pro.proId),
  });
});

dbTest("loadIcsFacts: a cancelled, expired or pending booking has no file", async ({ db, pro }) => {
  const seance = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 1 });
  const confirmed = await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" });
  const cancelled = await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "cancelled" });
  const expired = await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "expired" });

  // A pending booking holds a seat and belongs to a pending purchase (booking_pending_chk).
  const other = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 1 });
  const typeId = await rowType(db, pro);
  const buyer = await rowCustomer(db, pro);
  const purchaseId = await rowPurchase(db, pro, { customerId: buyer, offerId: await rowOffer(db, pro, typeId), ticketTypeId: typeId });
  const pending = await rowBooking(db, pro, { occurrenceId: other, customerId: buyer, status: "pending", purchaseId });

  assert.ok(await loadIcsFacts(db, confirmed));
  assert.equal(await loadIcsFacts(db, cancelled), null);
  assert.equal(await loadIcsFacts(db, expired), null);
  assert.equal(await loadIcsFacts(db, pending), null);
});

dbTest(
  "loadIcsFacts: a cancelled occurrence has no file, even for a booking still marked confirmed",
  async ({ db, pro }) => {
    // The engine never leaves a confirmed booking on a cancelled occurrence (invariant I5);
    // this inconsistent row proves the occurrence filter on its own, hence invariants: false.
    const seance = await rowSeance(db, pro, await rowEvent(db, pro), { seatsTaken: 1, status: "cancelled" });
    const bookingId = await rowBooking(db, pro, { occurrenceId: seance, customerId: await rowCustomer(db, pro), status: "confirmed" });
    assert.equal(await loadIcsFacts(db, bookingId), null);
  },
  { invariants: false },
);

dbTest("loadIcsFacts: an unknown id gives null", async ({ db }) => {
  assert.equal(await loadIcsFacts(db, "unknown-booking"), null);
  assert.equal(await loadIcsFacts(db, ""), null);
});

dbTest("loadIcsFacts: each id resolves to its own pro's booking and nothing else", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const mineEvent = await rowEvent(db, pro);
    await db.update(schema.event).set({ title: "Cours de Marie" }).where(eq(schema.event.id, mineEvent));
    const mine = await rowBooking(db, pro, {
      occurrenceId: await rowSeance(db, pro, mineEvent, { seatsTaken: 1 }),
      customerId: await rowCustomer(db, pro),
      status: "confirmed",
    });
    const theirEvent = await rowEvent(db, other);
    await db.update(schema.event).set({ title: "Cours de Paul" }).where(eq(schema.event.id, theirEvent));
    const theirs = await rowBooking(db, other, {
      occurrenceId: await rowSeance(db, other, theirEvent, { seatsTaken: 1 }),
      customerId: await rowCustomer(db, other),
      status: "confirmed",
    });

    const a = await loadIcsFacts(db, mine);
    const b = await loadIcsFacts(db, theirs);
    assert.equal(a?.title, "Cours de Marie");
    assert.equal(a?.businessName, await businessNameOf(db, pro.proId));
    assert.equal(b?.title, "Cours de Paul");
    assert.equal(b?.businessName, await businessNameOf(db, other.proId));
    assert.notEqual(a?.businessName, b?.businessName);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("buildBookingIcs: a hostile title and location read from the database inject no line", async ({ db, pro }) => {
  const eventId = await rowEvent(db, pro);
  await db
    .update(schema.event)
    .set({
      title: "Cours\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:mailto:evil@example.test\u2028X-EVIL:1\u0085X-EVIL2:2\u000BX-EVIL3:3",
      location: "Salle 1\nBEGIN:VEVENT\rORGANIZER:mailto:evil@example.test, bis; ter\\",
    })
    .where(eq(schema.event.id, eventId));
  const bookingId = await rowBooking(db, pro, {
    occurrenceId: await rowSeance(db, pro, eventId, { seatsTaken: 1 }),
    customerId: await rowCustomer(db, pro),
    status: "confirmed",
  });

  const facts = await loadIcsFacts(db, bookingId);
  assert.ok(facts);
  const body = buildBookingIcs(facts);
  // The long lines are folded (75 octets, CRLF + space); unfold them to read the properties.
  assert.ok(body.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  const lines = body.replace(/\r\n /g, "").split("\r\n");

  // 13 lines of the file + the empty string after the last terminator: nothing was added.
  assert.equal(lines.length, 14);
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.equal(lines.filter((line) => line === "END:VEVENT").length, 1);
  assert.ok(!lines.some((line) => line.startsWith("ATTENDEE") || line.startsWith("ORGANIZER")));
  // U+2028 and U+0085 become the \n escape, the vertical tab is dropped.
  assert.ok(
    lines.includes("SUMMARY:Cours\\nEND:VEVENT\\nBEGIN:VEVENT\\nATTENDEE:mailto:evil@example.test\\nX-EVIL:1\\nX-EVIL2:2X-EVIL3:3"),
  );
  assert.ok(lines.includes("LOCATION:Salle 1\\nBEGIN:VEVENT\\nORGANIZER:mailto:evil@example.test\\, bis\\; ter\\\\"));
  // The only CR and LF of the file are the CRLF line terminators.
  assert.ok(!body.replace(/\r\n/g, "").includes("\r"));
  assert.ok(!body.replace(/\r\n/g, "").includes("\n"));
  // Nor any other character a lenient parser reads as a line break.
  assert.equal(body.split(/\r\n|[\n\v\f\r\u001C-\u001E\u0085\u2028\u2029]/).length, body.split("\r\n").length);
});
