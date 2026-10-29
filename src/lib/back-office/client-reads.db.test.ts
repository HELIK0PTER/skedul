import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { CLIENT_FILTERS, isListedClient, matchesClientFilter, type ClientFacts } from "@/lib/back-office/client-filters";
import {
  CLIENT_LIST_LIMIT,
  PAST_BOOKINGS_MAX,
  customerAlertCounts,
  getClientRecord,
  listClients,
} from "@/lib/back-office/client-reads";
import { formatDayMonthOf, formatWhen, planningHref } from "@/lib/back-office/format";
import { cancelBookingsByPro } from "@/lib/booking/cancel";
import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { registerPro } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { checkInvariants } from "@/lib/booking/invariants";
import { closeTickets, convertTickets, pointTickets } from "@/lib/booking/wallet";
import { formatDayMonthYear, parseKey, todayKey } from "@/lib/civil-date";
import { ts } from "@/lib/db/atomic";
import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, type DbHarness } from "@/test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import {
  rowBooking,
  rowEvent,
  rowLink,
  rowOffer,
  rowPurchase,
  rowRdv,
  rowRdvType,
  rowSeance,
  rowTicket,
  rowType,
} from "@/test/rows";

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

/** An event that accepts `typeId`, so that the tickets of that type are not « orphan » (spec § 9). */
function linkedEvent(h: DbHarness, typeId: string, title: string, startDate?: string) {
  return makeEvent(h.db, h.pro, { title, ticketTypeIds: [typeId], ...(startDate ? { rule: { startDate } } : {}) });
}

/** A paid purchase of `offerId`: startPurchase then fulfillPurchase, both at `now`. */
async function pay(h: DbHarness, customerId: string, offerId: string, now: Date): Promise<string> {
  const started = must(await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId }, now));
  must(
    await fulfillPurchase(
      h.db,
      started.purchaseId,
      { sessionId: `cs_test_${nanoid()}`, paymentIntentId: `pi_test_${nanoid()}`, livemode: false },
      now,
    ),
  );
  return started.purchaseId;
}

const names = (rows: readonly { name: string }[]) => rows.map((r) => r.name);

/** The ClientFacts of a customer on the pro's clock, stated by hand. */
const ZERO_FACTS: ClientFacts = {
  usableTickets: 0,
  upcomingConfirmed: 0,
  red: false,
  orange: false,
  confirmedBookings: 0,
  ticketsAny: 0,
  bookingsAny: 0,
  purchasesAny: 0,
};

/** A wallet line names the year when its day is not in now's local year (the rule of expiryLabel). */
function walletDay(instant: Date, now: Date, tz: string): string {
  const key = todayKey(instant, tz);
  return parseKey(key).y === parseKey(todayKey(now, tz)).y ? formatDayMonthOf(instant, tz) : formatDayMonthYear(key);
}

/** The text of a history line without its « JJ/MM HH:mm · acteur · » head. */
const tail = (text: string) => text.split(" · ").slice(2).join(" · ");

dbTest("listClients: a pending purchase or a cancelled booking alone does not list a customer", async (h) => {
  const typeId = await makeType(h.db, h.pro, { name: "Cours collectif" });
  const offerId = await makeOffer(h.db, h.pro, typeId, { quantity: 10, priceCents: 19000 });
  const event = await linkedEvent(h, typeId, "Altinha débutants");
  const fresh = await makeCustomer(h.db, h.pro, { name: "Nouvelle Cliente" });
  const pending = await makeCustomer(h.db, h.pro, { name: "Paiement en attente" });
  const holder = await makeCustomer(h.db, h.pro, { name: "Titulaire" });
  const cancelled = await makeCustomer(h.db, h.pro, { name: "Annulée" });

  must(await startPurchase(h.db, { professionalId: h.pro.proId, offerId, customerId: pending }));
  await giveTickets(h.db, h.pro, holder, typeId, 1);
  const booked = must(
    await registerPro(h.db, {
      professionalId: h.pro.proId,
      actorUserId: h.pro.userId,
      occurrenceId: event.occurrences[0].id,
      customerId: cancelled,
      asGuest: true,
    }),
  );
  must(
    await cancelBookingsByPro(h.db, {
      professionalId: h.pro.proId,
      actorUserId: h.pro.userId,
      occurrenceId: event.occurrences[0].id,
      bookingIds: [booked.bookingId],
    }),
  );

  const out = await listClients(h.db, h.pro.proId, new Date(), { q: "", filter: "tous" });
  assert.deepEqual(names(out.rows), ["Nouvelle Cliente", "Titulaire"]);
  assert.deepEqual(
    out.rows.map((r) => r.id),
    [fresh, holder],
  );
  assert.equal(out.counts.tous, 2);
});

dbTest("listClients: filters, counts, holdings and the red / orange alerts", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const typeOk = await makeType(db, pro, { name: "Cours collectif", color: "#6366f1" });
  const typeArchived = await makeType(db, pro, { name: "Stage d'été 2026", color: "#f59e0b" });
  const typeOrphan = await makeType(db, pro, { name: "Cours en plein air", color: "#22c55e" });
  const typeFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const event = await linkedEvent(h, typeOk, "Altinha débutants");

  const alice = await makeCustomer(db, pro, { name: "Alice Ok", email: "alice.ok@skedul.test" });
  const bruno = await makeCustomer(db, pro, { name: "Bruno À venir", email: "bruno.avenir@skedul.test" });
  const carla = await makeCustomer(db, pro, { name: "Carla Rouge", email: "carla.rouge@skedul.test" });
  const denis = await makeCustomer(db, pro, { name: "Denis Orange", email: "denis.orange@skedul.test" });
  const emma = await makeCustomer(db, pro, { name: "Emma Gratuit", email: "emma.gratuit@skedul.test" });
  const felix = await makeCustomer(db, pro, { name: "Félix Expiré", email: "felix.expire@skedul.test" });
  await makeCustomer(db, pro, { name: "Gaëlle Nouvelle", email: "gaelle.nouvelle@skedul.test" });

  await giveTickets(db, pro, alice, typeOk, 2);
  must(
    await registerPro(db, {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      occurrenceId: event.occurrences[0].id,
      customerId: bruno,
      asGuest: true,
    }),
  );
  await giveTickets(db, pro, carla, typeArchived, 1);
  await giveTickets(db, pro, denis, typeOrphan, 1);
  // offerTickets refuses a free type (FR:F9, P5 T5): a ticket handed back as available on it (E6a) is written raw
  await rowTicket(db, pro, { customerId: emma, ticketTypeId: typeFree });
  await giveTickets(db, pro, felix, typeOk, 1, { now: addDaysMs(now, -30), expiresAt: addDaysMs(now, -1) });
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: typeArchived, archived: true }));

  const all = await listClients(db, pro.proId, now, { q: "", filter: "tous" });
  assert.deepEqual(names(all.rows), [
    "Alice Ok",
    "Bruno À venir",
    "Carla Rouge",
    "Denis Orange",
    "Emma Gratuit",
    "Félix Expiré",
    "Gaëlle Nouvelle",
  ]);
  assert.deepEqual(all.counts, { tous: 7, tickets: 4, "a-venir": 1, alertes: 3 });
  assert.deepEqual(
    all.rows.map((r) => [r.name, r.usableTickets, r.upcomingConfirmed, r.red, r.orange]),
    [
      ["Alice Ok", 2, 0, false, false],
      ["Bruno À venir", 0, 1, false, false],
      ["Carla Rouge", 1, 0, true, false],
      ["Denis Orange", 1, 0, false, true],
      ["Emma Gratuit", 1, 0, false, true],
      ["Félix Expiré", 0, 0, false, false],
      ["Gaëlle Nouvelle", 0, 0, false, false],
    ],
  );
  assert.deepEqual(all.rows[0].holdings, [
    { ticketTypeId: typeOk, name: "Cours collectif", color: "#6366f1", archived: false, usable: 2 },
  ]);
  assert.deepEqual(all.rows[2].holdings, [
    { ticketTypeId: typeArchived, name: "Stage d'été 2026", color: "#f59e0b", archived: true, usable: 1 },
  ]);
  assert.deepEqual(all.rows[5].holdings, []);
  assert.equal(all.rows[0].linkedAccount, false);
  assert.equal(all.rows[0].phone, null);

  const tickets = await listClients(db, pro.proId, now, { q: "", filter: "tickets" });
  assert.deepEqual(names(tickets.rows), ["Alice Ok", "Carla Rouge", "Denis Orange", "Emma Gratuit"]);
  const upcoming = await listClients(db, pro.proId, now, { q: "", filter: "a-venir" });
  assert.deepEqual(names(upcoming.rows), ["Bruno À venir"]);
  const alerts = await listClients(db, pro.proId, now, { q: "", filter: "alertes" });
  assert.deepEqual(names(alerts.rows), ["Carla Rouge", "Denis Orange", "Emma Gratuit"]);
  assert.deepEqual(await customerAlertCounts(db, pro.proId, now), { red: 1, orange: 2 });
  // the overview counts are the flags of the listed rows
  assert.deepEqual(await customerAlertCounts(db, pro.proId, now), {
    red: all.rows.filter((r) => r.red).length,
    orange: all.rows.filter((r) => r.orange).length,
  });

  // The search matches the name or the e-mail, ignores case, leaves the counts alone and combines with a filter.
  const byName = await listClients(db, pro.proId, now, { q: "ali", filter: "tous" });
  assert.deepEqual(names(byName.rows), ["Alice Ok"]);
  assert.deepEqual(byName.counts, all.counts);
  const byEmail = await listClients(db, pro.proId, now, { q: "DENIS.ORANGE@skedul", filter: "tous" });
  assert.deepEqual(names(byEmail.rows), ["Denis Orange"]);
  const combined = await listClients(db, pro.proId, now, { q: "ora", filter: "alertes" });
  assert.deepEqual(names(combined.rows), ["Denis Orange"]);
  const none = await listClients(db, pro.proId, now, { q: "ora", filter: "a-venir" });
  assert.deepEqual(none.rows, []);
});

dbTest(
  "listClients: every filter and count equals the pure predicates over facts stated by hand",
  async (h) => {
    const { db, pro } = h;
    const p = pro.proId;
    const now = new Date();
    const typeOk = await makeType(db, pro, { name: "Cours collectif" });
    const typeArchived = await makeType(db, pro, { name: "Stage d'été 2026" });
    const typeOrphan = await makeType(db, pro, { name: "Cours en plein air" });
    const offerId = await makeOffer(db, pro, typeOk, { quantity: 3, priceCents: 7500 });
    const future = await linkedEvent(h, typeOk, "Altinha débutants");
    const futureSeance = future.occurrences[0].id;
    const pastEvent = await rowEvent(db, pro);
    const pastSeance = await rowSeance(db, pro, pastEvent, { startsAt: addDaysMs(now, -3) });
    const holdEvent = await rowEvent(db, pro);
    let holdDay = 4;
    /** A pending booking whose hold ended 10 minutes ago, on its own future séance (the seat is still counted: not swept yet). */
    const lapsedHold = async (customerId: string) => {
      const seance = await rowSeance(db, pro, holdEvent, { startsAt: addDaysMs(now, holdDay++), seatsTaken: 1 });
      const purchaseId = await rowPurchase(db, pro, { customerId, offerId, ticketTypeId: typeOk });
      await rowBooking(db, pro, {
        occurrenceId: seance,
        customerId,
        status: "pending",
        coverage: "ticket",
        purchaseId,
        holdExpiresAt: addMinutes(now, -10),
      });
    };
    const guest = (occurrenceId: string, customerId: string) =>
      registerPro(db, { professionalId: p, actorUserId: pro.userId, occurrenceId, customerId, asGuest: true });

    const expected = new Map<string, { name: string; facts: ClientFacts }>();
    const add = async (name: string, facts: Partial<ClientFacts>, setup: (id: string) => Promise<void> = async () => {}) => {
      const id = await makeCustomer(db, pro, { name });
      await setup(id);
      expected.set(id, { name, facts: { ...ZERO_FACTS, ...facts } });
      return id;
    };

    await add("01 Nouveau", {});
    await add("02 Paiement en attente", { purchasesAny: 1 }, async (id) => {
      must(await startPurchase(db, { professionalId: p, offerId, customerId: id }));
    });
    await add("03 Annulée", { bookingsAny: 1 }, async (id) => {
      const booked = must(await guest(futureSeance, id));
      must(
        await cancelBookingsByPro(db, {
          professionalId: p,
          actorUserId: pro.userId,
          occurrenceId: futureSeance,
          bookingIds: [booked.bookingId],
        }),
      );
    });
    await add("04 Paiement abandonné", { bookingsAny: 1, purchasesAny: 1 }, lapsedHold);
    await add("05 À venir", { bookingsAny: 1, confirmedBookings: 1, upcomingConfirmed: 1 }, async (id) => {
      must(await guest(futureSeance, id));
    });
    await add("06 Passé", { bookingsAny: 1, confirmedBookings: 1 }, async (id) => {
      must(await guest(pastSeance, id));
    });
    await add("07 Porteur", { ticketsAny: 2, usableTickets: 2 }, async (id) => {
      await giveTickets(db, pro, id, typeOk, 2);
    });
    await add("08 Expiré", { ticketsAny: 1 }, async (id) => {
      await giveTickets(db, pro, id, typeOk, 1, { now: addDaysMs(now, -30), expiresAt: addDaysMs(now, -1) });
    });
    const rouge = await add("09 Rouge", { ticketsAny: 1, usableTickets: 1, red: true }, async (id) => {
      await giveTickets(db, pro, id, typeArchived, 1);
    });
    await add("10 Orange", { ticketsAny: 1, usableTickets: 1, orange: true }, async (id) => {
      await giveTickets(db, pro, id, typeOrphan, 1);
    });
    await add("11 Acheteur", { ticketsAny: 3, usableTickets: 3, purchasesAny: 1 }, async (id) => {
      await pay(h, id, offerId, now);
    });
    await add("12 Ticket et paiement abandonné", { ticketsAny: 1, usableTickets: 1, bookingsAny: 1, purchasesAny: 1 }, async (id) => {
      await giveTickets(db, pro, id, typeOk, 1);
      await lapsedHold(id);
    });
    await add("13 Pointé", { ticketsAny: 1 }, async (id) => {
      await giveTickets(db, pro, id, typeOk, 1);
      must(
        await pointTickets(
          db,
          { professionalId: p, actorUserId: pro.userId, customerId: id, selection: { ticketTypeId: typeOk, quantity: 1 } },
          now,
        ),
      );
    });
    await add("14 Inscrit avec ticket", { ticketsAny: 1, bookingsAny: 1, confirmedBookings: 1, upcomingConfirmed: 1 }, async (id) => {
      await giveTickets(db, pro, id, typeOk, 1);
      must(
        await registerPro(db, {
          professionalId: p,
          actorUserId: pro.userId,
          occurrenceId: futureSeance,
          customerId: id,
          asGuest: false,
        }),
      );
    });
    // two tickets of the archived type and one of the orphan type: ONE red and ONE orange client, not three
    await add("15 Rouge et orange", { ticketsAny: 3, usableTickets: 3, red: true, orange: true }, async (id) => {
      await giveTickets(db, pro, id, typeArchived, 2);
      await giveTickets(db, pro, id, typeOrphan, 1);
    });
    must(await setTicketTypeArchived(db, { professionalId: p, ticketTypeId: typeArchived, archived: true }));

    // The listed clients and the counts follow from the facts alone (hand-checked: 12 listed, 6 with usable tickets, 2 upcoming, 3 alerts).
    const listed = [...expected].filter(([, e]) => isListedClient(e.facts));
    assert.equal(listed.length, 12);
    const want = (filter: (typeof CLIENT_FILTERS)[number]) => listed.filter(([, e]) => matchesClientFilter(e.facts, filter));
    assert.deepEqual(
      Object.fromEntries(CLIENT_FILTERS.map((f) => [f, want(f).length])),
      { tous: 12, tickets: 6, "a-venir": 2, alertes: 3 },
    );

    for (const filter of CLIENT_FILTERS) {
      const got = await listClients(db, p, now, { q: "", filter });
      assert.deepEqual(
        got.rows.map((r) => r.id).sort(),
        want(filter)
          .map(([id]) => id)
          .sort(),
        `filter ${filter}`,
      );
      assert.deepEqual(got.counts, { tous: 12, tickets: 6, "a-venir": 2, alertes: 3 }, `counts with filter ${filter}`);
      for (const row of got.rows) {
        const e = expected.get(row.id);
        assert.ok(e, row.name);
        assert.deepEqual(
          [row.usableTickets, row.upcomingConfirmed, row.red, row.orange],
          [e.facts.usableTickets, e.facts.upcomingConfirmed, e.facts.red, e.facts.orange],
          row.name,
        );
      }
    }
    // the overview counts equal the red / orange flags of the listed rows (the facts, by hand: 09 and 15 red, 10 and 15 orange)
    assert.deepEqual(await customerAlertCounts(db, p, now), { red: 2, orange: 2 });
    const everyone = await listClients(db, p, now, { q: "", filter: "tous" });
    assert.deepEqual(await customerAlertCounts(db, p, now), {
      red: everyone.rows.filter((r) => r.red).length,
      orange: everyone.rows.filter((r) => r.orange).length,
    });

    // An archived type still shows in the wallet of its holder (red), and is not offered for new tickets.
    const record = await getClientRecord(db, p, rouge, now);
    assert.ok(record);
    assert.equal(record.wallet.length, 1);
    assert.deepEqual(
      [record.wallet[0].name, record.wallet[0].archived, record.wallet[0].alert, record.wallet[0].usableCount],
      ["Stage d'été 2026", true, "red", 1],
    );
    assert.deepEqual(
      record.typeOptions.map((t) => t.id),
      [typeOk, typeOrphan],
    );
    assert.deepEqual(
      record.history.map((l) => tail(l.text)),
      ["Offert 1 Stage d'été 2026"],
    );
  },
  { timeout: 280_000 },
);

dbTest("listClients: the search treats %, _ and ! literally and is trimmed", async (h) => {
  await makeCustomer(h.db, h.pro, { name: "100% Bio", email: "bio.pct@skedul.test" });
  await makeCustomer(h.db, h.pro, { name: "100x Bio", email: "bio.x@skedul.test" });
  await makeCustomer(h.db, h.pro, { name: "Hello! World", email: "hello@skedul.test" });
  const now = new Date();
  const search = async (q: string) => names((await listClients(h.db, h.pro.proId, now, { q, filter: "tous" })).rows);
  assert.deepEqual(await search("100%"), ["100% Bio"]);
  assert.deepEqual(await search("100_ Bio"), []);
  assert.deepEqual(await search("%"), ["100% Bio"]);
  assert.deepEqual(await search("_"), []);
  assert.deepEqual(await search("lo!"), ["Hello! World"]);
  assert.deepEqual(await search("!"), ["Hello! World"]);
  assert.deepEqual(await search("  bio  "), ["100% Bio", "100x Bio"]);
});

// A31: unaccent on both sides (migration 0013), ILIKE for the case.
dbTest("listClients: the search ignores accents both ways and stays on this pro", async (h) => {
  const accented = await makeCustomer(h.db, h.pro, { name: "Élodie Martin", email: "e.martin@skedul.test" });
  const plain = await makeCustomer(h.db, h.pro, { name: "Elodie Durand", email: "elodie.durand@skedul.test" });
  const noel = await makeCustomer(h.db, h.pro, { name: "Eloise Noël", email: "eloise@skedul.test" });
  const other = await createTestPro(h.db);
  try {
    await makeCustomer(h.db, other, { name: "Élodie Ailleurs", email: "ailleurs@skedul.test" });
    const now = new Date();
    const ids = async (q: string) =>
      (await listClients(h.db, h.pro.proId, now, { q, filter: "tous" })).rows.map((r) => r.id).sort();
    const both = [accented, plain].sort();
    assert.deepEqual(await ids("Elodie"), both, "Elodie finds Élodie");
    assert.deepEqual(await ids("élodie"), both, "élodie finds Elodie");
    assert.deepEqual(await ids("ÉLODIE"), both, "case and accent together");
    assert.deepEqual(await ids("noel"), [noel], "an accent inside the name");
    assert.deepEqual(await ids("élodie.durand"), [plain], "the e-mail side is folded too");
    assert.deepEqual(await ids("Ailleurs"), [], "another pro's client is never a hit");
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest("listClients: the list stops at CLIENT_LIST_LIMIT rows, the search and the counts see every client", async (h) => {
  const { db, pro } = h;
  const tag = nanoid(8);
  const caps = CLIENT_LIST_LIMIT + 1;
  const total = caps + 1;
  await db.execute(sql`
    insert into customer (id, professional_id, email, name)
    select ${tag}::text || '-' || i::text, ${pro.proId}, 'cap' || i::text || '@skedul.test', 'Cap ' || lpad(i::text, 4, '0')
    from generate_series(1, ${caps}::int) as i`);
  // An accented initial sorts with its letter (French order): « Ágata » is the FIRST client, so the cap never cuts it.
  await makeCustomer(db, pro, { name: "Ágata Souza" });
  const now = new Date();
  const all = await listClients(db, pro.proId, now, { q: "", filter: "tous" });
  assert.equal(all.rows.length, CLIENT_LIST_LIMIT);
  assert.equal(all.rows[0].name, "Ágata Souza");
  assert.equal(all.rows[1].name, "Cap 0001");
  assert.equal(all.rows[CLIENT_LIST_LIMIT - 1].name, `Cap ${String(CLIENT_LIST_LIMIT - 1).padStart(4, "0")}`);
  assert.deepEqual(all.counts, { tous: total, tickets: 0, "a-venir": 0, alertes: 0 });
  // the last clients are past the cap in the plain list, and found by their names
  const last = await listClients(db, pro.proId, now, { q: `Cap ${String(caps).padStart(4, "0")}`, filter: "tous" });
  assert.deepEqual(names(last.rows), [`Cap ${String(caps).padStart(4, "0")}`]);
  assert.equal(last.counts.tous, total);
});

dbTest("listClients: names sort in French order, accents and case ignored, ties by id", async (h) => {
  const { db, pro } = h;
  const zoe = await makeCustomer(db, pro, { name: "Zoé", email: "zoe@skedul.test" });
  const elodie = await makeCustomer(db, pro, { name: "Élodie", email: "elodie@skedul.test" });
  const ericLower = await makeCustomer(db, pro, { name: "eric", email: "eric.lower@skedul.test" });
  const ericAccent = await makeCustomer(db, pro, { name: "Éric", email: "eric.accent@skedul.test" });
  const aaron = await makeCustomer(db, pro, { name: "Aaron", email: "aaron@skedul.test" });
  const rows = (await listClients(db, pro.proId, new Date(), { q: "", filter: "tous" })).rows;
  // « eric » and « Éric » are the same name for the collation: the id decides between them
  const erics = [ericLower, ericAccent].sort();
  assert.deepEqual(
    rows.map((r) => r.id),
    [aaron, elodie, ...erics, zoe],
  );
});

dbTest("client reads never cross the tenant boundary", async (h) => {
  const other = await createTestPro(h.db);
  try {
    const now = new Date();
    const theirType = await makeType(h.db, other, { name: "Type de l'autre" });
    const theirs = await makeCustomer(h.db, other, { name: "Chez l'autre" });
    await giveTickets(h.db, other, theirs, theirType, 1);
    const mine = await makeCustomer(h.db, h.pro, { name: "Chez moi" });
    // the same e-mail on both sides: nothing of theirs may be read as mine
    const twinMine = await makeCustomer(h.db, h.pro, { name: "Jumeau chez moi", email: "jumeau@skedul.test" });
    const twinTheirs = await makeCustomer(h.db, other, { name: "Jumeau chez l'autre", email: "jumeau@skedul.test" });
    const theirLinkedType = await makeType(h.db, other, { name: "Type lié de l'autre" });
    const theirEvent = await makeEvent(h.db, other, { title: "Cours de l'autre", ticketTypeIds: [theirLinkedType] });
    await giveTickets(h.db, other, twinTheirs, theirLinkedType, 2);
    must(
      await registerPro(h.db, {
        professionalId: other.proId,
        actorUserId: other.userId,
        occurrenceId: theirEvent.occurrences[0].id,
        customerId: twinTheirs,
        asGuest: false,
      }),
    );

    const out = await listClients(h.db, h.pro.proId, now, { q: "", filter: "tous" });
    assert.deepEqual(names(out.rows), ["Chez moi", "Jumeau chez moi"]);
    assert.deepEqual(out.counts, { tous: 2, tickets: 0, "a-venir": 0, alertes: 0 });
    assert.deepEqual(
      out.rows.map((r) => [r.usableTickets, r.upcomingConfirmed, r.holdings.length]),
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    assert.deepEqual(await customerAlertCounts(h.db, h.pro.proId, now), { red: 0, orange: 0 });
    // their first ticket type is linked to no event: one orange client, for them only
    assert.deepEqual(await customerAlertCounts(h.db, other.proId, now), { red: 0, orange: 1 });
    const theirList = await listClients(h.db, other.proId, now, { q: "", filter: "tous" });
    assert.deepEqual(names(theirList.rows), ["Chez l'autre", "Jumeau chez l'autre"]);
    assert.deepEqual(theirList.counts, { tous: 2, tickets: 2, "a-venir": 1, alertes: 1 });

    assert.equal(await getClientRecord(h.db, h.pro.proId, theirs, now), null);
    assert.equal(await getClientRecord(h.db, other.proId, mine, now), null);
    assert.equal(await getClientRecord(h.db, h.pro.proId, "unknown-customer", now), null);

    // a client with no activity: an empty record, not an error
    const empty = await getClientRecord(h.db, h.pro.proId, mine, now);
    assert.ok(empty);
    assert.equal(empty.customer.name, "Chez moi");
    assert.equal(empty.customer.linkedAccount, false);
    assert.deepEqual(empty.wallet, []);
    assert.deepEqual(empty.bookings, { upcoming: [], cancelled: [], past: [], pastTotal: 0 });
    assert.deepEqual(empty.purchases, []);
    assert.deepEqual(empty.history, []);
    assert.deepEqual(empty.typeOptions, []);

    // the twin sees none of the other side's tickets, bookings or movements
    const twin = await getClientRecord(h.db, h.pro.proId, twinMine, now);
    assert.ok(twin);
    assert.deepEqual([twin.wallet, twin.bookings, twin.purchases, twin.history], [[], { upcoming: [], cancelled: [], past: [], pastTotal: 0 }, [], []]);

    assert.deepEqual(await checkInvariants(h.db, { proId: other.proId }), []);
  } finally {
    await deleteTestUser(h.db, other.userId);
  }
});

dbTest(
  "getClientRecord: wallet groups, bookings, purchases and history of one client",
  async (h) => {
    const { db, pro } = h;
    const p = pro.proId;
    const tz = pro.tz;
    const now = new Date();
    const coll = await makeType(db, pro, { name: "Cours collectif", color: "#6366f1" });
    const priv = await makeType(db, pro, { name: "Cours particulier", color: "#0ea5e9" });
    const offerId = await makeOffer(db, pro, coll, { quantity: 10, priceCents: 19000, validityCount: 6, validityUnit: "month" });
    const future = await linkedEvent(h, coll, "Altinha débutants");
    const second = await linkedEvent(h, coll, "Roda libre", dayIn(pro, 5));
    // A séance that already took place: the engine does not create past séances, a row builder does.
    const pastEvent = await rowEvent(db, pro, { bookingMode: "tickets" });
    await db.execute(sql`update event set title = 'Atelier technique' where id = ${pastEvent}`);
    await rowLink(db, pro, pastEvent, coll);
    const pastStart = addDaysMs(now, -3);
    const pastSeance = await rowSeance(db, pro, pastEvent, { startsAt: pastStart });

    const retiredAt = addMinutes(now, 2); // after the pointage: « Retiré » sorts before « Pointé » in the done list
    const dd = (d: Date) => formatDayMonthOf(d, tz, now); // the year shows when the day is not in now's year (R6)
    const wd = (d: Date) => walletDay(d, now, tz);

    const beatriz = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: "beatriz@skedul.test" });
    await pay(h, beatriz, offerId, now);
    const register = async (occurrenceId: string) =>
      must(
        await registerPro(db, {
          professionalId: p,
          actorUserId: pro.userId,
          occurrenceId,
          customerId: beatriz,
          asGuest: false,
        }),
      );
    const futureBooking = await register(future.occurrences[0].id);
    const pastBooking = await register(pastSeance);
    must(
      await pointTickets(
        db,
        { professionalId: p, actorUserId: pro.userId, customerId: beatriz, selection: { ticketTypeId: coll, quantity: 1 } },
        now,
      ),
    );
    const offered = await giveTickets(db, pro, beatriz, coll, 2);
    must(
      await convertTickets(
        db,
        {
          professionalId: p,
          actorUserId: pro.userId,
          customerId: beatriz,
          selection: { ticketTypeId: coll, quantity: 1 },
          toTicketTypeId: priv,
        },
        now,
      ),
    );
    const secondBooking = await register(second.occurrences[0].id);
    must(
      await cancelBookingsByPro(
        db,
        { professionalId: p, actorUserId: pro.userId, occurrenceId: second.occurrences[0].id, bookingIds: [secondBooking.bookingId], reason: "Test" },
        now,
      ),
    );
    must(
      await closeTickets(
        db,
        { professionalId: p, actorUserId: pro.userId, customerId: beatriz, selection: { ticketIds: [offered[0]] }, reason: "retire", note: "erreur" },
        retiredAt,
      ),
    );
    must(await startPurchase(db, { professionalId: p, offerId, customerId: beatriz }, addMinutes(now, 1)));

    const record = await getClientRecord(db, p, beatriz, new Date());
    assert.ok(record);

    assert.deepEqual(
      { ...record.customer, createdAt: undefined },
      { id: beatriz, name: "Beatriz Almeida", email: "beatriz@skedul.test", phone: null, linkedAccount: false, createdAt: undefined },
    );
    assert.ok(record.customer.createdAt instanceof Date);
    assert.deepEqual(
      record.typeOptions.map((t) => [t.id, t.name, t.rdvFree]),
      [
        [coll, "Cours collectif", false],
        [priv, "Cours particulier", false],
      ],
    );

    // wallet: 10 bought - 2 booked - 1 pointed - 1 converted (the cancelled booking gave its ticket back) + 2 offered - 1 retired
    assert.deepEqual(
      record.wallet.map((g) => g.ticketTypeId),
      [coll, priv],
    );
    const [gColl, gPriv] = record.wallet;
    assert.equal(gColl.name, "Cours collectif");
    assert.equal(gColl.alert, null);
    assert.equal(gColl.usableCount, 7);
    assert.equal(gColl.usable.length, 7);
    assert.equal(gColl.expired.length, 0);
    assert.equal(gColl.expirySummary.length, 2);
    assert.ok(gColl.expirySummary[0].startsWith("6 valables jusqu'au "), gColl.expirySummary[0]);
    assert.equal(gColl.expirySummary[1], "1 sans limite de validité");
    assert.deepEqual(
      gColl.booked.map((t) => t.line),
      [`Réservé pour le ${wd(future.occurrences[0].startsAt)}`],
    );
    assert.deepEqual(
      gColl.done.map((t) => t.line),
      [`Retiré le ${wd(retiredAt)} (erreur)`, `Pointé le ${wd(now)}`, `Utilisé le ${wd(pastStart)}`],
    );
    assert.equal(gColl.ids.point.length, 7);
    assert.equal(gColl.ids.closePaid.length, 6);
    assert.equal(gColl.ids.retire.length, 1);
    assert.equal(gColl.ids.unpoint.length, 1);
    assert.equal(gPriv.name, "Cours particulier");
    assert.equal(gPriv.usableCount, 1);
    assert.equal(gPriv.alert, "orange"); // linked to no event
    assert.equal(gPriv.ids.closePaid.length, 1);

    // bookings: the future one is active, the cancelled one (next week) has its own group, the past one is history
    assert.equal(record.bookings.upcoming.length, 1);
    const [up] = record.bookings.upcoming;
    const upOccurrence = future.occurrences[0];
    assert.equal(up.bookingId, futureBooking.bookingId);
    assert.equal(up.occurrenceId, upOccurrence.id);
    assert.equal(up.kind, "seance");
    assert.equal(up.title, "Altinha débutants");
    assert.equal(up.startsAt, upOccurrence.startsAt.toISOString());
    assert.equal(up.endsAt, upOccurrence.endsAt.toISOString());
    assert.equal(up.whenLabel, formatWhen(upOccurrence.startsAt, upOccurrence.endsAt, tz));
    assert.equal(up.status, "confirmed");
    assert.equal(up.coverage, "ticket");
    assert.equal(up.ticketTypeName, "Cours collectif");
    assert.equal(up.occurrenceStatus, "scheduled");
    assert.deepEqual([up.canMove, up.canUnenroll, up.moved, up.hasTicket, up.pending], [true, true, false, true, false]);
    assert.equal(up.planningHref, planningHref({ occurrenceId: upOccurrence.id, startsAt: upOccurrence.startsAt, tz }));
    assert.deepEqual(
      record.bookings.cancelled.map((b) => [b.bookingId, b.title, b.status, b.canMove, b.canUnenroll, b.hasTicket, b.ticketTypeName]),
      [[secondBooking.bookingId, "Roda libre", "cancelled", false, false, false, null]],
    );
    assert.deepEqual(
      record.bookings.past.map((b) => [b.bookingId, b.title, b.status, b.canMove, b.canUnenroll, b.hasTicket, b.ticketTypeName]),
      [[pastBooking.bookingId, "Atelier technique", "confirmed", false, true, true, "Cours collectif"]],
    );
    assert.equal(record.bookings.pastTotal, 1);

    // purchases, newest first
    assert.deepEqual(
      record.purchases.map((x) => [x.status, x.label, x.quantity, x.amountCents, x.currency]),
      [
        ["pending", "Carnet de 10", 10, 19000, "eur"],
        ["paid", "Carnet de 10", 10, 19000, "eur"],
      ],
    );
    assert.equal(record.purchases[0].paidAt, null);
    assert.ok(record.purchases[1].paidAt instanceof Date);
    assert.ok(record.purchases[1].createdAt instanceof Date);

    // history: one line per action, newest first, the séance on spend and return lines only
    assert.deepEqual(record.history.map((l) => tail(l.text)), [
      "Retiré 1 Cours collectif (erreur)",
      `Rendu 1 Cours collectif · Roda libre du ${dd(second.occurrences[0].startsAt)}`,
      `Utilisé pour une inscription 1 Cours collectif · Roda libre du ${dd(second.occurrences[0].startsAt)}`,
      "Converti 1 Cours collectif → Cours particulier",
      "Offert 2 Cours collectif",
      "Pointé 1 Cours collectif",
      `Utilisé pour une inscription 1 Cours collectif · Atelier technique du ${dd(pastStart)}`,
      `Utilisé pour une inscription 1 Cours collectif · Altinha débutants du ${dd(upOccurrence.startsAt)}`,
      "Acheté 10 Cours collectif",
    ]);
    assert.equal(new Set(record.history.map((l) => l.key)).size, record.history.length);
    // the fulfillment writes the purchase with actor « system »: the client bought online
    assert.equal(record.history[record.history.length - 1].text.split(" · ")[1], "Client");
    assert.equal(record.history[0].text.split(" · ")[1], "Vous");
  },
  { timeout: 280_000 },
);

dbTest("getClientRecord: RDV, live and lapsed holds, cancelled and past bookings", async (h) => {
  const { db, pro } = h;
  const tz = pro.tz;
  const now = new Date();
  const rdvType = await rowRdvType(db, pro, { name: "Cours particulier" });
  const typeId = await rowType(db, pro, { name: "Cours collectif" });
  const offerId = await rowOffer(db, pro, typeId);
  const event = await rowEvent(db, pro);
  await db.execute(sql`update event set title = 'Roda libre' where id = ${event}`);
  const lea = await makeCustomer(db, pro, { name: "Léa Martin" });

  const futureRdv = await rowRdv(db, pro, rdvType, { startsAt: addDaysMs(now, 1) });
  const pastRdv = await rowRdv(db, pro, rdvType, { startsAt: addDaysMs(now, -2) });
  const liveSeance = await rowSeance(db, pro, event, { startsAt: addDaysMs(now, 5), seatsTaken: 1 });
  const lapsedSeance = await rowSeance(db, pro, event, { startsAt: addDaysMs(now, 6), seatsTaken: 1 });
  const freedSeance = await rowSeance(db, pro, event, { startsAt: addDaysMs(now, 7), seatsTaken: 0 });
  const rdvBooking = await rowBooking(db, pro, { occurrenceId: futureRdv, customerId: lea });
  const pastRdvBooking = await rowBooking(db, pro, { occurrenceId: pastRdv, customerId: lea });
  const hold = async (occurrenceId: string, holdExpiresAt: Date) =>
    rowBooking(db, pro, {
      occurrenceId,
      customerId: lea,
      status: "pending",
      coverage: "ticket",
      purchaseId: await rowPurchase(db, pro, { customerId: lea, offerId, ticketTypeId: typeId }),
      holdExpiresAt,
    });
  const liveHold = await hold(liveSeance, addMinutes(now, 30));
  const lapsedHold = await hold(lapsedSeance, addMinutes(now, -10));
  const cancelledBooking = await rowBooking(db, pro, { occurrenceId: freedSeance, customerId: lea, status: "cancelled" });

  const record = await getClientRecord(db, pro.proId, lea, now);
  assert.ok(record);
  const flags = (b: { canMove: boolean; canUnenroll: boolean; moved: boolean; hasTicket: boolean; pending: boolean }) =>
    [b.canMove, b.canUnenroll, b.moved, b.hasTicket, b.pending];

  // upcoming = a live registration that has not ended, soonest first: the lapsed hold is not one
  assert.deepEqual(
    record.bookings.upcoming.map((b) => [b.bookingId, b.kind, b.title, b.status, b.coverage, b.ticketTypeName]),
    [
      [rdvBooking, "rdv", "Cours particulier", "confirmed", "guest", null],
      [liveHold, "seance", "Roda libre", "pending", "ticket", null],
    ],
  );
  assert.deepEqual(flags(record.bookings.upcoming[0]), [false, true, false, false, false]); // an RDV is never moved
  assert.deepEqual(flags(record.bookings.upcoming[1]), [false, true, false, false, true]);
  assert.equal(record.bookings.upcoming[0].planningHref, planningHref({ occurrenceId: futureRdv, startsAt: record.bookings.upcoming[0].startsAt, tz }));

  // R2: a cancelled booking and a lapsed hold (« expired », the seat is already free) on séances still to come are not
  // « Passées »: they have their own group, soonest first, with no action.
  assert.deepEqual(
    record.bookings.cancelled.map((b) => [b.bookingId, b.title, b.status, b.occurrenceStatus]),
    [
      [lapsedHold, "Roda libre", "expired", "scheduled"],
      [cancelledBooking, "Roda libre", "cancelled", "scheduled"],
    ],
  );
  assert.deepEqual(flags(record.bookings.cancelled[0]), [false, false, false, false, false]);
  assert.deepEqual(flags(record.bookings.cancelled[1]), [false, false, false, false, false]);

  // past = the séances that have ended, newest first, and only those: neither future row is in it nor in its count
  assert.deepEqual(
    record.bookings.past.map((b) => [b.bookingId, b.title, b.status, b.occurrenceStatus]),
    [[pastRdvBooking, "Cours particulier", "confirmed", "scheduled"]],
  );
  assert.deepEqual(flags(record.bookings.past[0]), [false, true, false, false, false]); // E6a: a past registration can still be removed
  assert.equal(record.bookings.pastTotal, 1);

  // the list counts the confirmed RDV only: neither hold is a confirmed registration
  const list = await listClients(db, pro.proId, now, { q: "", filter: "a-venir" });
  assert.deepEqual(
    list.rows.map((r) => [r.name, r.upcomingConfirmed]),
    [["Léa Martin", 1]],
  );
});

dbTest("getClientRecord: a pending purchase whose checkout has ended reads expired, unless a payment is processing", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const typeId = await rowType(db, pro, { name: "Cours collectif" });
  const offerId = await rowOffer(db, pro, typeId);
  const lea = await makeCustomer(db, pro, { name: "Léa Martin" });
  const purchase = (minutesAgo: number) =>
    rowPurchase(db, pro, { customerId: lea, offerId, ticketTypeId: typeId }, addMinutes(now, -minutesAgo));
  // rowPurchase opens a Checkout session for 31 minutes from its own clock
  const live = await purchase(0);
  const ended = await purchase(60);
  const processing = await purchase(90);
  const storedExpired = await purchase(120);
  await db.execute(sql`update ticket_purchase set processing_at = ${ts(addMinutes(now, -100))} where id = ${processing}`);
  await db.execute(sql`update ticket_purchase set status = 'expired' where id = ${storedExpired}`);

  const record = await getClientRecord(db, pro.proId, lea, now);
  assert.ok(record);
  // newest first; a delayed payment (processing_at) is still awaited, the stored « expired » stays
  assert.deepEqual(
    record.purchases.map((x) => [x.id, x.status]),
    [
      [live, "pending"],
      [ended, "expired"],
      [processing, "pending"],
      [storedExpired, "expired"],
    ],
  );
});

dbTest("getClientRecord: the past bookings stop at PAST_BOOKINGS_MAX, newest first, and pastTotal is the true count", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const tag = nanoid(8);
  const total = PAST_BOOKINGS_MAX + 2;
  const event = await rowEvent(db, pro);
  const customerId = await makeCustomer(db, pro, { name: "Habitué" });
  await db.execute(sql`
    insert into occurrence (id, professional_id, event_id, series_date, starts_at, ends_at, block_start, block_end, capacity, seats_taken)
    select ${tag}::text || '-o' || i::text, ${pro.proId}, ${event}, date '2020-01-01' + i, s.at, s.at + interval '1 hour', s.at, s.at + interval '1 hour', 12, 1
    from generate_series(1, ${total}::int) as i
    cross join lateral (select ${ts(now)} - make_interval(days => i) as at) s`);
  await db.execute(sql`
    insert into booking (id, professional_id, occurrence_id, customer_id, status, coverage, created_by, confirmed_at)
    select ${tag}::text || '-b' || i::text, ${pro.proId}, ${tag}::text || '-o' || i::text, ${customerId}, 'confirmed', 'guest', 'pro', ${ts(now)}
    from generate_series(1, ${total}::int) as i`);

  const record = await getClientRecord(db, pro.proId, customerId, now);
  assert.ok(record);
  assert.deepEqual(record.bookings.upcoming, []);
  assert.deepEqual(record.bookings.cancelled, []);
  assert.equal(record.bookings.past.length, PAST_BOOKINGS_MAX);
  assert.equal(record.bookings.past[0].startsAt, addDaysMs(now, -1).toISOString());
  assert.equal(record.bookings.past[PAST_BOOKINGS_MAX - 1].startsAt, addDaysMs(now, -PAST_BOOKINGS_MAX).toISOString());
  // R2: the count is read before the cut, so the heading can say 52 and the note « les 50 plus récentes »
  assert.equal(record.bookings.pastTotal, total);
});

// R2: a séance that has started but not ended is still « à venir » for a live booking, and « Annulées » for a cancelled one.
dbTest("getClientRecord: a running séance is not past yet; a cancelled booking on it is in the cancelled group", async (h) => {
  const { db, pro } = h;
  const now = new Date();
  const event = await rowEvent(db, pro);
  const lea = await makeCustomer(db, pro, { name: "Léa Martin" });
  const running = await rowSeance(db, pro, event, { startsAt: addMinutes(now, -20), seatsTaken: 1 });
  const ended = await rowSeance(db, pro, await rowEvent(db, pro), { startsAt: addMinutes(now, -180), seatsTaken: 1 });
  const runningCancelledEvent = await rowEvent(db, pro);
  const runningCancelled = await rowSeance(db, pro, runningCancelledEvent, { startsAt: addMinutes(now, -10), seatsTaken: 0 });
  const live = await rowBooking(db, pro, { occurrenceId: running, customerId: lea });
  const done = await rowBooking(db, pro, { occurrenceId: ended, customerId: lea });
  const gone = await rowBooking(db, pro, { occurrenceId: runningCancelled, customerId: lea, status: "cancelled" });

  const record = await getClientRecord(db, pro.proId, lea, now);
  assert.ok(record);
  assert.deepEqual(record.bookings.upcoming.map((b) => b.bookingId), [live]);
  assert.deepEqual(record.bookings.cancelled.map((b) => b.bookingId), [gone]);
  assert.deepEqual(record.bookings.past.map((b) => b.bookingId), [done]);
  assert.equal(record.bookings.pastTotal, 1);
});

dbTest("getClientRecord: the history is cut on an action boundary, never inside an action", async (h) => {
  const { db, pro } = h;
  const p = pro.proId;
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 9000 });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida" });
  // three actions, 9 movements: Acheté 4 (seq 1 to 4), Offert 3 (5 to 7), Pointé 2 (8 and 9)
  await pay(h, customerId, offerId, now);
  await giveTickets(db, pro, customerId, typeId, 3);
  must(
    await pointTickets(
      db,
      { professionalId: p, actorUserId: pro.userId, customerId, selection: { ticketTypeId: typeId, quantity: 2 } },
      now,
    ),
  );
  const linesWith = async (historyMaxMovements?: number) =>
    (await getClientRecord(db, p, customerId, now, historyMaxMovements === undefined ? {} : { historyMaxMovements }))?.history.map((l) =>
      tail(l.text),
    );

  const pointed = "Pointé 2 Cours collectif";
  const offered = "Offert 3 Cours collectif";
  const bought = "Acheté 4 Cours collectif";
  assert.deepEqual(await linesWith(), [pointed, offered, bought]);
  assert.deepEqual(await linesWith(9), [pointed, offered, bought]); // exactly the whole ledger
  assert.deepEqual(await linesWith(8), [pointed, offered]); // would cut « Acheté 4 » into « Acheté 3 »: dropped whole
  assert.deepEqual(await linesWith(5), [pointed, offered]); // lands on the boundary: both newer actions kept
  assert.deepEqual(await linesWith(4), [pointed]); // would cut « Offert 3 » into « Offert 2 »
  assert.deepEqual(await linesWith(2), [pointed]);
  assert.deepEqual(await linesWith(1), []); // would cut « Pointé 2 » into « Pointé 1 »
});

dbTest("getClientRecord: an action whose movements are not contiguous in seq is dropped whole too", async (h) => {
  const { db, pro } = h;
  const p = pro.proId;
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida" });
  // Four offered tickets; the ledger interleaves two actions (seq 1 to 4: A, B, A, B), as two concurrent actions could.
  const ticketIds: string[] = [];
  for (let i = 0; i < 4; i++) ticketIds.push(await rowTicket(db, pro, { customerId, ticketTypeId: typeId, movements: false }));
  const actions = [nanoid(), nanoid()];
  for (const [i, ticketId] of ticketIds.entries()) {
    await db.execute(sql`
      insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, to_status, ticket_type_id, actor)
      values (${p}, ${customerId}, ${ticketId}, ${actions[i % 2]}, 'offer', 'available', ${typeId}, 'pro')`);
  }
  const lines = async (historyMaxMovements: number) =>
    (await getClientRecord(db, p, customerId, new Date(), { historyMaxMovements }))?.history.map((l) => tail(l.text));

  assert.deepEqual(await lines(4), ["Offert 2 Cours collectif", "Offert 2 Cours collectif"]);
  // the cut falls after seq 1: action A has seq 1 behind it and seq 3 in front, action B is whole
  assert.deepEqual(await lines(3), ["Offert 2 Cours collectif"]);
  // the cut falls after seq 2: both actions straddle it
  assert.deepEqual(await lines(2), []);
});
