import assert from "node:assert/strict";
import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  availabilityRule,
  bookingAnswer,
  eventTicketType,
  professional,
  question,
  ticketOffer,
  ticketType,
} from "@/lib/db/schema";
import type { Db } from "@/lib/db/atomic";

import { createTestPro, dbTest, deleteTestUser, type TestPro } from "../../test/db";
import { hasDomainData } from "../../test/fixtures";
import { rowBooking, rowCustomer, rowEvent, rowLink, rowPurchase, rowRdv, rowTicket } from "../../test/rows";
import {
  createOffer,
  createTicketType,
  deleteOffer,
  deleteTicketType,
  setAvailabilityRules,
  setTicketTypeArchived,
  setTypeQuestions,
  updateBookingSettings,
  updateOffer,
  updateTicketType,
} from "./catalog";

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

dbTest("createTicketType appends with defaults; zod errors come back as invalid with their message", async ({ db, pro }) => {
  const now = new Date();
  const first = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "  Cours collectif " } }, now));
  const second = must(
    await createTicketType(db, {
      professionalId: pro.proId,
      type: { name: "Cours particulier", rdvEnabled: true, rdvDurationMin: 60, rdvBufferAfterMin: 10 },
    }),
  );
  const rows = await db
    .select()
    .from(ticketType)
    .where(eq(ticketType.professionalId, pro.proId))
    .orderBy(asc(ticketType.position));
  assert.deepEqual(
    rows.map((r) => [r.id, r.name, r.position, r.color, r.rdvEnabled, r.rdvDurationMin, r.rdvBufferAfterMin]),
    [
      [first.ticketTypeId, "Cours collectif", 0, "#6366f1", false, null, 0],
      [second.ticketTypeId, "Cours particulier", 1, "#6366f1", true, 60, 10],
    ],
  );
  assert.equal(rows[0].createdAt.getTime(), now.getTime());

  assert.deepEqual(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "RDV", rdvEnabled: true } }),
    { ok: false, code: "invalid", message: "Indiquez la durée du rendez-vous." },
  );
  assert.deepEqual(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "Gratuit", rdvFree: true, rdvEnabled: false, rdvDurationMin: 15 } }),
    { ok: false, code: "invalid", message: "Le rendez-vous gratuit demande le RDV libre." },
  );
});

dbTest("updateTicketType and setTicketTypeArchived stay inside the pro", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const { ticketTypeId } = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Avant" } }));
    assert.deepEqual(
      await updateTicketType(db, { professionalId: other.proId, ticketTypeId, type: { name: "Volé" } }),
      { ok: false, code: "not_found" },
    );
    must(await updateTicketType(db, { professionalId: pro.proId, ticketTypeId, type: { name: "Après", color: "#16a34a" } }));
    must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId, archived: true }));
    let [row] = await db.select().from(ticketType).where(eq(ticketType.id, ticketTypeId));
    assert.equal(row.name, "Après");
    assert.equal(row.color, "#16a34a");
    assert.ok(row.archivedAt);
    must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId, archived: false }));
    [row] = await db.select().from(ticketType).where(eq(ticketType.id, ticketTypeId));
    assert.equal(row.archivedAt, null);
    assert.deepEqual(
      await setTicketTypeArchived(db, { professionalId: other.proId, ticketTypeId, archived: true }),
      { ok: false, code: "not_found" },
    );
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("deleteTicketType deletes an unused type (offers cascade) and archives one with history", async ({ db, pro }) => {
  const unused = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Jamais servi" } }));
  const unusedOffer = must(
    await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId: unused.ticketTypeId, quantity: 1, priceCents: 1500 } }),
  );
  assert.deepEqual(await deleteTicketType(db, { professionalId: pro.proId, ticketTypeId: unused.ticketTypeId }), {
    ok: true,
    effects: [],
    outcome: "deleted",
  });
  assert.equal((await db.select().from(ticketOffer).where(eq(ticketOffer.id, unusedOffer.offerId))).length, 0);

  const used = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Déjà vendu" } }));
  const usedOffer = must(
    await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId: used.ticketTypeId, quantity: 1, priceCents: 1500 } }),
  );
  const eventId = await rowEvent(db, pro);
  await rowLink(db, pro, eventId, used.ticketTypeId);
  await rowTicket(db, pro, { customerId: await rowCustomer(db, pro), ticketTypeId: used.ticketTypeId });
  assert.deepEqual(await deleteTicketType(db, { professionalId: pro.proId, ticketTypeId: used.ticketTypeId }), {
    ok: true,
    effects: [],
    outcome: "archived",
  });
  const [row] = await db.select().from(ticketType).where(eq(ticketType.id, used.ticketTypeId));
  assert.ok(row.archivedAt, "archived instead of deleted");
  assert.equal((await db.select().from(ticketOffer).where(eq(ticketOffer.id, usedOffer.offerId))).length, 1, "offers untouched");
  assert.equal(
    (await db.select().from(eventTicketType).where(eq(eventTicketType.ticketTypeId, used.ticketTypeId))).length,
    1,
    "links untouched",
  );
  assert.deepEqual(await deleteTicketType(db, { professionalId: pro.proId, ticketTypeId: "missing" }), {
    ok: false,
    code: "not_found",
  });
});

dbTest("offers: refused on an archived type; edit; delete, or archive once bought", async ({ db, pro }) => {
  const { ticketTypeId } = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Collectif" } }));
  const unit = must(await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 1, priceCents: 2500 } }));
  const pack = must(
    await createOffer(db, {
      professionalId: pro.proId,
      offer: { ticketTypeId, label: "  ", quantity: 10, priceCents: 19000, validityCount: 6, validityUnit: "month" },
    }),
  );
  const offers = await db
    .select()
    .from(ticketOffer)
    .where(eq(ticketOffer.ticketTypeId, ticketTypeId))
    .orderBy(asc(ticketOffer.position));
  assert.deepEqual(
    offers.map((o) => [o.id, o.position, o.label, o.quantity, o.validityCount, o.validityUnit]),
    [
      [unit.offerId, 0, null, 1, null, null],
      [pack.offerId, 1, null, 10, 6, "month"],
    ],
  );

  const free = await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 1, priceCents: 0 } });
  assert.equal(!free.ok && free.code, "invalid", "no offer at 0 €");
  assert.deepEqual(
    await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 1, priceCents: 900, validityCount: 3 } }),
    { ok: false, code: "invalid", message: "Indiquez une durée et une unité de validité, ou aucune." },
  );

  must(
    await updateOffer(db, {
      professionalId: pro.proId,
      offerId: pack.offerId,
      offer: { ticketTypeId: "ignored", label: "Carnet été", quantity: 8, priceCents: 15000, isActive: false },
    }),
  );
  const [edited] = await db.select().from(ticketOffer).where(eq(ticketOffer.id, pack.offerId));
  assert.deepEqual(
    [edited.ticketTypeId, edited.label, edited.quantity, edited.priceCents, edited.validityCount, edited.isActive],
    [ticketTypeId, "Carnet été", 8, 15000, null, false],
  );

  assert.deepEqual(await deleteOffer(db, { professionalId: pro.proId, offerId: pack.offerId }), {
    ok: true,
    effects: [],
    outcome: "deleted",
  });
  const customerId = await rowCustomer(db, pro);
  await rowPurchase(db, pro, { customerId, offerId: unit.offerId, ticketTypeId });
  assert.deepEqual(await deleteOffer(db, { professionalId: pro.proId, offerId: unit.offerId }), {
    ok: true,
    effects: [],
    outcome: "archived",
  });
  assert.deepEqual(
    await updateOffer(db, { professionalId: pro.proId, offerId: unit.offerId, offer: { ticketTypeId, quantity: 1, priceCents: 1 } }),
    { ok: false, code: "not_found" },
    "an archived offer is no longer editable",
  );

  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId, archived: true }));
  assert.deepEqual(
    await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 1, priceCents: 2500 } }),
    { ok: false, code: "not_found" },
  );
});

dbTest("setAvailabilityRules replaces the global hours, or one type's hours, in one batch", async ({ db, pro }) => {
  const { ticketTypeId } = must(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "Appel", rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 } }),
  );
  const global = async () =>
    db
      .select({ d: availabilityRule.dayOfWeek, s: availabilityRule.startMinute, e: availabilityRule.endMinute })
      .from(availabilityRule)
      .where(and(eq(availabilityRule.professionalId, pro.proId), isNull(availabilityRule.ticketTypeId)))
      .orderBy(asc(availabilityRule.dayOfWeek), asc(availabilityRule.startMinute));

  must(
    await setAvailabilityRules(db, {
      professionalId: pro.proId,
      ticketTypeId: null,
      rules: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 840, endMinute: 1080 },
      ],
    }),
  );
  must(
    await setAvailabilityRules(db, {
      professionalId: pro.proId,
      ticketTypeId,
      rules: [{ dayOfWeek: 2, startMinute: 720, endMinute: 840 }],
    }),
  );
  must(
    await setAvailabilityRules(db, {
      professionalId: pro.proId,
      ticketTypeId: null,
      rules: [{ dayOfWeek: 3, startMinute: 600, endMinute: 780 }],
    }),
  );
  assert.deepEqual(await global(), [{ d: 3, s: 600, e: 780 }], "the global hours were replaced");
  const typed = await db.select().from(availabilityRule).where(eq(availabilityRule.ticketTypeId, ticketTypeId));
  assert.equal(typed.length, 1, "the type's own hours are untouched");

  assert.equal(
    (
      await setAvailabilityRules(db, {
        professionalId: pro.proId,
        ticketTypeId: null,
        rules: [{ dayOfWeek: 3, startMinute: 780, endMinute: 600 }],
      })
    ).ok,
    false,
  );
  assert.deepEqual(await global(), [{ d: 3, s: 600, e: 780 }], "an invalid list changes nothing");
  assert.deepEqual(
    await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: "missing", rules: [] }),
    { ok: false, code: "not_found" },
  );
});

dbTest("setTypeQuestions keeps known ids, inserts new ones, deletes the rest; answers keep their label", async ({ db, pro }) => {
  const { ticketTypeId } = must(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "Particulier", rdvEnabled: true, rdvDurationMin: 60 } }),
  );
  must(
    await setTypeQuestions(db, {
      professionalId: pro.proId,
      ticketTypeId,
      questions: [
        { label: "Objectif ?", type: "text", required: true },
        { label: "Niveau ?", type: "choice", options: ["Débutant", "Confirmé"] },
      ],
    }),
  );
  const initial = await db
    .select()
    .from(question)
    .where(eq(question.ticketTypeId, ticketTypeId))
    .orderBy(asc(question.position));
  const [objective, levelQ] = initial;
  assert.deepEqual(
    initial.map((q) => [q.label, q.type, q.options, q.required, q.position]),
    [
      ["Objectif ?", "text", null, true, 0],
      ["Niveau ?", "choice", ["Débutant", "Confirmé"], false, 1],
    ],
  );

  const rdv = await rowRdv(db, pro, ticketTypeId);
  const bookingId = await rowBooking(db, pro, { occurrenceId: rdv, customerId: await rowCustomer(db, pro) });
  const now = new Date();
  await db.insert(bookingAnswer).values({
    id: nanoid(),
    professionalId: pro.proId,
    bookingId,
    questionId: levelQ.id,
    questionLabel: levelQ.label,
    value: "Débutant",
    createdAt: now,
    updatedAt: now,
  });

  must(
    await setTypeQuestions(db, {
      professionalId: pro.proId,
      ticketTypeId,
      questions: [
        { label: "Matériel ?", type: "boolean" },
        { id: objective.id, label: "Votre objectif ?", type: "text", required: true },
      ],
    }),
  );
  const after = await db
    .select()
    .from(question)
    .where(eq(question.ticketTypeId, ticketTypeId))
    .orderBy(asc(question.position));
  assert.deepEqual(
    after.map((q) => [q.label, q.type, q.position]),
    [
      ["Matériel ?", "boolean", 0],
      ["Votre objectif ?", "text", 1],
    ],
  );
  assert.equal(after[1].id, objective.id, "the kept question keeps its id");
  const [answer] = await db.select().from(bookingAnswer).where(eq(bookingAnswer.bookingId, bookingId));
  assert.equal(answer.questionId, null, "the deleted question's answers are detached (SET NULL)");
  assert.equal(answer.questionLabel, "Niveau ?");

  assert.equal(
    (
      await setTypeQuestions(db, {
        professionalId: pro.proId,
        ticketTypeId,
        questions: [{ label: "Choix ?", type: "choice", options: ["Seul"] }],
      })
    ).ok,
    false,
    "a choice needs two options",
  );
});

dbTest("setTypeQuestions fails stale when a kept question vanished meanwhile, and changes nothing", async ({ db, pro }) => {
  const { ticketTypeId } = must(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "Particulier", rdvEnabled: true, rdvDurationMin: 60 } }),
  );
  must(
    await setTypeQuestions(db, {
      professionalId: pro.proId,
      ticketTypeId,
      questions: [
        { label: "Objectif ?", type: "text" },
        { label: "Niveau ?", type: "text" },
      ],
    }),
  );
  const [kept, other] = await db
    .select()
    .from(question)
    .where(eq(question.ticketTypeId, ticketTypeId))
    .orderBy(asc(question.position));

  // Another save (a second tab) removes the question this save wants to keep, after this save read its state.
  const res = await setTypeQuestions(
    db,
    {
      professionalId: pro.proId,
      ticketTypeId,
      questions: [
        { id: kept.id, label: "Votre objectif ?", type: "text" },
        { label: "Matériel ?", type: "boolean" },
      ],
    },
    new Date(),
    {
      afterPlan: async () => {
        await db.delete(question).where(eq(question.id, kept.id));
      },
    },
  );
  assert.deepEqual(res, { ok: false, code: "stale" });

  const rows = await db.select().from(question).where(eq(question.ticketTypeId, ticketTypeId));
  assert.deepEqual(
    rows.map((q) => [q.id, q.label]),
    [[other.id, "Niveau ?"]],
    "the batch rolled back: the dropped question is still there and nothing was inserted",
  );
});

dbTest("setAvailabilityRules never treats an empty type id as the global scope", async ({ db, pro }) => {
  must(
    await setAvailabilityRules(db, {
      professionalId: pro.proId,
      ticketTypeId: null,
      rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
    }),
  );
  assert.deepEqual(await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: "", rules: [] }), {
    ok: false,
    code: "not_found",
  });
  const rules = await db
    .select({ d: availabilityRule.dayOfWeek, s: availabilityRule.startMinute, e: availabilityRule.endMinute })
    .from(availabilityRule)
    .where(and(eq(availabilityRule.professionalId, pro.proId), isNull(availabilityRule.ticketTypeId)));
  assert.deepEqual(rules, [{ d: 1, s: 540, e: 720 }], "the global hours are untouched");
});

dbTest("updateBookingSettings validates the bounds; hasDomainData sees the catalog", async ({ db, pro }) => {
  assert.equal(await hasDomainData(db, pro.proId), false);
  must(
    await updateBookingSettings(db, {
      professionalId: pro.proId,
      settings: { bookingHorizonDays: 90, minNoticeMinutes: 0, cancelDeadlineHours: 48 },
    }),
  );
  const [row] = await db.select().from(professional).where(eq(professional.id, pro.proId));
  assert.deepEqual([row.bookingHorizonDays, row.minNoticeMinutes, row.cancelDeadlineHours], [90, 0, 48]);
  for (const settings of [
    { bookingHorizonDays: 366, minNoticeMinutes: 0, cancelDeadlineHours: 24 },
    { bookingHorizonDays: 60, minNoticeMinutes: 10_081, cancelDeadlineHours: 24 },
    { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 721 },
  ]) {
    const res = await updateBookingSettings(db, { professionalId: pro.proId, settings });
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.code, "invalid");
  }
  assert.deepEqual(
    await updateBookingSettings(db, {
      professionalId: "missing",
      settings: { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 },
    }),
    { ok: false, code: "not_found" },
  );

  must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Premier" } }));
  assert.equal(await hasDomainData(db, pro.proId), true);
});

/* ───────────── P5 Task 5: FR:F9, the pro half (P3OUT:90, P4OUT:96, dossier § 3.15 point 5) ───────────── */

/** A paid RDV type of this pro and a raw setter of its rdv_free (another tab of the pro committing « Gratuit »). */
async function paidRdvType(db: Db, pro: TestPro) {
  const { ticketTypeId } = must(
    await createTicketType(db, { professionalId: pro.proId, type: { name: "Particulier", rdvEnabled: true, rdvDurationMin: 60 } }),
  );
  const setFree = (free: boolean) => async () => {
    await db.update(ticketType).set({ rdvFree: free }).where(eq(ticketType.id, ticketTypeId));
  };
  return { ticketTypeId, setFree };
}

dbTest("FR:F9 createOffer and updateOffer (en vente) on a type switched to « Gratuit » are stale and write nothing", async ({ db, pro }) => {
  const { ticketTypeId, setFree } = await paidRdvType(db, pro);
  const offersOf = () => db.select().from(ticketOffer).where(eq(ticketOffer.ticketTypeId, ticketTypeId));
  const body = { ticketTypeId, quantity: 1, priceCents: 2500 };

  // The switch commits between the plan and the batch.
  assert.deepEqual(
    await createOffer(db, { professionalId: pro.proId, offer: body }, new Date(), { afterPlan: setFree(true) }),
    { ok: false, code: "stale" },
  );
  assert.equal((await offersOf()).length, 0, "no offer row");
  // The engine refuses a free type on its own, even with no race (and even an offer created « Pas en vente »).
  assert.deepEqual(await createOffer(db, { professionalId: pro.proId, offer: body }), { ok: false, code: "stale" });
  assert.deepEqual(await createOffer(db, { professionalId: pro.proId, offer: { ...body, isActive: false } }), { ok: false, code: "stale" });
  assert.equal((await offersOf()).length, 0);

  await setFree(false)();
  const { offerId } = must(await createOffer(db, { professionalId: pro.proId, offer: { ...body, isActive: false } }));
  const update = (isActive: boolean, priceCents: number, afterPlan?: () => Promise<void>) =>
    updateOffer(db, { professionalId: pro.proId, offerId, offer: { ...body, priceCents, isActive } }, new Date(), { afterPlan });

  // Putting it en vente while the type turns free: stale, the offer keeps its old price and stays off sale.
  assert.deepEqual(await update(true, 3000, setFree(true)), { ok: false, code: "stale" });
  let [row] = await offersOf();
  assert.deepEqual([row.isActive, row.priceCents], [false, 2500]);
  assert.deepEqual(await update(true, 3000), { ok: false, code: "stale" }, "no race needed: a free type sells nothing");
  // An offer left « Pas en vente » on a free type stays editable.
  must(await update(false, 3500));
  [row] = await offersOf();
  assert.deepEqual([row.isActive, row.priceCents], [false, 3500]);

  // Back to paid: both go through.
  await setFree(false)();
  must(await update(true, 4000));
  must(await createOffer(db, { professionalId: pro.proId, offer: body }));
  assert.equal((await offersOf()).length, 2);
});

dbTest("FR:F9 the switch to « Gratuit » re-checks its blockers in the batch: an offer, a live checkout, a sale or a booked ticket staged after its plan is stale", async ({ db, pro }) => {
  const free = { name: "Particulier", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 };
  const toFree = (ticketTypeId: string, afterPlan?: () => Promise<void>) =>
    updateTicketType(db, { professionalId: pro.proId, ticketTypeId, type: free }, new Date(), { afterPlan });
  const isFree = async (ticketTypeId: string) =>
    (await db.select({ f: ticketType.rdvFree }).from(ticketType).where(eq(ticketType.id, ticketTypeId)))[0].f;
  const customerId = await rowCustomer(db, pro);
  const stagedIsStale = async (what: string, stage: (ticketTypeId: string) => Promise<void>) => {
    const { ticketTypeId } = await paidRdvType(db, pro);
    assert.deepEqual(await toFree(ticketTypeId, () => stage(ticketTypeId)), { ok: false, code: "stale" }, what);
    assert.equal(await isFree(ticketTypeId), false, `${what}: nothing written`);
  };

  await stagedIsStale("an offer en vente", async (ticketTypeId) => {
    must(await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 2, priceCents: 5000 } }));
  });
  await stagedIsStale("a checkout that can still be paid (the offer taken off sale since)", async (ticketTypeId) => {
    const { offerId } = must(
      await createOffer(db, { professionalId: pro.proId, offer: { ticketTypeId, quantity: 1, priceCents: 2500, isActive: false } }),
    );
    await rowPurchase(db, pro, { customerId, offerId, ticketTypeId, status: "pending" });
  });
  await stagedIsStale("a sale (a usable ticket)", async (ticketTypeId) => {
    await rowTicket(db, pro, { customerId, ticketTypeId });
  });
  await stagedIsStale("a ticket booked on an RDV to come", async (ticketTypeId) => {
    const rdv = await rowRdv(db, pro, ticketTypeId, { startsAt: new Date(Date.now() + 3 * 86_400_000) });
    const bookingId = await rowBooking(db, pro, { occurrenceId: rdv, customerId, coverage: "ticket" });
    await rowTicket(db, pro, { customerId, ticketTypeId, status: "booked", bookingId });
  });

  // Nothing that blocks (a used ticket does not count): the switch goes through.
  const { ticketTypeId } = await paidRdvType(db, pro);
  await rowTicket(db, pro, { customerId, ticketTypeId, status: "used" });
  must(await toFree(ticketTypeId));
  assert.equal(await isFree(ticketTypeId), true);
  // Already free: an edit re-checks nothing, even with a ticket handed back as available on the type (E6a, F2).
  await rowTicket(db, pro, { customerId, ticketTypeId });
  must(await updateTicketType(db, { professionalId: pro.proId, ticketTypeId, type: { ...free, name: "Appel" } }));
  // Leaving « Gratuit » is never checked either.
  must(await updateTicketType(db, { professionalId: pro.proId, ticketTypeId, type: { ...free, rdvFree: false } }));
  assert.equal(await isFree(ticketTypeId), false);
});

dbTest("FR:F9 a second pro's type id is not_found on the guarded paths, never stale", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const theirs = await paidRdvType(db, other);
    const theirOffer = must(
      await createOffer(db, { professionalId: other.proId, offer: { ticketTypeId: theirs.ticketTypeId, quantity: 1, priceCents: 2500, isActive: false } }),
    );
    const body = { ticketTypeId: theirs.ticketTypeId, quantity: 1, priceCents: 2500 };
    assert.deepEqual(await createOffer(db, { professionalId: pro.proId, offer: body }), { ok: false, code: "not_found" });
    assert.deepEqual(
      await updateOffer(db, { professionalId: pro.proId, offerId: theirOffer.offerId, offer: body }),
      { ok: false, code: "not_found" },
    );
    assert.deepEqual(
      await updateTicketType(db, {
        professionalId: pro.proId,
        ticketTypeId: theirs.ticketTypeId,
        type: { name: "Volé", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 },
      }),
      { ok: false, code: "not_found" },
    );
    const [row] = await db.select().from(ticketType).where(eq(ticketType.id, theirs.ticketTypeId));
    assert.deepEqual([row.name, row.rdvFree], ["Particulier", false]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
