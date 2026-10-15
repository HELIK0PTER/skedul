import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { setTicketTypeArchived } from "@/lib/booking/catalog";
import { bookWithHeldTicket } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import type { Db } from "@/lib/db/atomic";
import { addDaysMs, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import { giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "@/test/fixtures";
import { proCtx } from "@/test/pro-ctx";

import {
  createOfferCore,
  createTicketTypeCore,
  deleteOfferCore,
  deleteTicketTypeCore,
  RDV_FREE_HAS_SALES,
  RDV_FREE_NO_OFFER,
  RDV_FREE_OFFER_STAYS_OFF,
  setOfferActiveCore,
  setTicketTypeArchivedCore,
  setTypeHoursCore,
  setTypeQuestionsCore,
  updateOfferCore,
  updateTicketTypeCore,
  type TicketTypePatch,
} from "./catalog-actions";
import { getTicketTypeDetail, listActiveTypeOptions, listTicketTypes } from "./catalog-reads";
import { NOTICE_TOO_LONG } from "./notice";
import type { CoreResult } from "./result";

const NOT_FOUND = "Type ou offre introuvable.";

/** A success with no effect (every catalog core returns `effects: []`). */
function must<T extends { ok: boolean }>(res: T, what: string): asserts res is Extract<T, { ok: true }> {
  assert.ok(res.ok, `${what}: ${JSON.stringify(res)}`);
  assert.deepEqual((res as { effects?: unknown }).effects, [], `${what}: effects`);
}

/** A refusal with exactly this French message. */
function refused<T extends object>(res: CoreResult<T>, error: string, what: string): void {
  assert.equal(res.ok, false, `${what}: expected a refusal, got ${JSON.stringify(res)}`);
  if (!res.ok) assert.equal(res.error, error, what);
}

async function detailOf(db: Db, pro: TestPro, ticketTypeId: string, now = new Date()) {
  const detail = await getTicketTypeDetail(db, pro.proId, ticketTypeId, now);
  assert.ok(detail, `type ${ticketTypeId} exists`);
  return detail;
}

/** A paid purchase through the engine. */
async function buy(db: Db, pro: TestPro, offerId: string, customerId: string): Promise<void> {
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId });
  if (!started.ok) assert.fail(`startPurchase: ${JSON.stringify(started)}`);
  // fulfillPurchase returns its own effects (receipt e-mail): not a catalog core, so no `must` here.
  const done = await fulfillPurchase(db, started.purchaseId, {
    sessionId: `cs_test_${nanoid()}`,
    paymentIntentId: `pi_test_${nanoid()}`,
    livemode: false,
  });
  assert.ok(done.ok, `fulfillPurchase: ${JSON.stringify(done)}`);
}

dbTest("createTicketTypeCore validates in French, checks the effective window, then creates", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();

  refused(await createTicketTypeCore(db, ctx, { name: "   " }, now), "Nom : ce champ est obligatoire.", "empty name");
  refused(await createTicketTypeCore(db, ctx, { name: "Test", color: "bleu" }, now), "Couleur : format invalide.", "bad colour");
  refused(
    await createTicketTypeCore(
      db,
      ctx,
      {
        name: "Cours",
        rdvEnabled: true,
        rdvDurationMin: 60,
        rdvOverrides: { bookingHorizonDays: 1, minNoticeMinutes: 10080, cancelDeadlineHours: null },
      },
      now,
    ),
    NOTICE_TOO_LONG,
    "notice longer than the horizon",
  );
  assert.deepEqual(await listActiveTypeOptions(db, pro.proId), [], "the refusals created nothing");

  const created = await createTicketTypeCore(db, ctx, { name: "  Cours collectif  ", description: "Un cours", color: "#16a34a" }, now);
  must(created, "create");
  const detail = await detailOf(db, pro, created.ticketTypeId, now);
  assert.deepEqual(
    [detail.name, detail.description, detail.color, detail.rdvEnabled, detail.rdvFree, detail.archived],
    ["Cours collectif", "Un cours", "#16a34a", false, false, false],
  );

  const call = await createTicketTypeCore(db, ctx, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 }, now);
  must(call, "create a free RDV type");
  const free = await detailOf(db, pro, call.ticketTypeId, now);
  assert.deepEqual([free.rdvEnabled, free.rdvFree, free.rdvDurationMin], [true, true, 15]);
  assert.deepEqual((await listActiveTypeOptions(db, pro.proId)).map((o) => o.name), ["Cours collectif", "Appel découverte"]);
});

dbTest("updateTicketTypeCore merges a patch over the stored type", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, {
    name: "Cours particulier",
    description: "Avant",
    color: "#0ea5e9",
    rdvEnabled: true,
    rdvDurationMin: 60,
    rdvBufferBeforeMin: 5,
    rdvBufferAfterMin: 10,
    rdvOverrides: { bookingHorizonDays: 30, minNoticeMinutes: 120, cancelDeadlineHours: null },
  });

  // A name-only patch keeps every RDV field.
  must(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { name: "Cours privé" } }, now), "rename");
  let d = await detailOf(db, pro, typeId, now);
  assert.deepEqual(
    [d.name, d.description, d.color, d.rdvEnabled, d.rdvDurationMin, d.rdvBufferBeforeMin, d.rdvBufferAfterMin, d.rdvOverrides],
    ["Cours privé", "Avant", "#0ea5e9", true, 60, 5, 10, { bookingHorizonDays: 30, minNoticeMinutes: 120, cancelDeadlineHours: null }],
  );

  // null clears the description; the other fields stay.
  must(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { description: null, rdvBufferAfterMin: 15 } }, now), "patch");
  d = await detailOf(db, pro, typeId, now);
  assert.deepEqual([d.description, d.rdvBufferAfterMin, d.name, d.rdvBufferBeforeMin], [null, 15, "Cours privé", 5]);

  // An explicit undefined changes nothing.
  must(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { name: undefined, color: "#16a34a" } }, now), "undefined");
  d = await detailOf(db, pro, typeId, now);
  assert.deepEqual([d.name, d.color], ["Cours privé", "#16a34a"]);

  refused(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { name: "" } }, now), "Nom : ce champ est obligatoire.", "empty name");
  refused(
    await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { rdvDurationMin: null } }, now),
    "Indiquez la durée du rendez-vous.",
    "RDV without duration",
  );
  refused(await updateTicketTypeCore(db, ctx, { ticketTypeId: "inconnu", patch: { name: "X" } }, now), NOT_FOUND, "unknown id");
  assert.equal((await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: null as never }, now)).ok, false, "a patch that is not an object");
  d = await detailOf(db, pro, typeId, now);
  assert.deepEqual([d.name, d.rdvDurationMin], ["Cours privé", 60], "the refusals changed nothing");
});

dbTest("rdvFree cannot be switched on while an offer is en vente or a usable ticket exists, and a free type's offers stay off", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const makeFree = (ticketTypeId: string, at = now) =>
    updateTicketTypeCore(db, ctx, { ticketTypeId, patch: { rdvFree: true } }, at);

  const withOffer = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 15 });
  const offerId = await makeOffer(db, pro, withOffer);
  refused(await makeFree(withOffer), RDV_FREE_HAS_SALES, "offer en vente");
  must(await setOfferActiveCore(db, ctx, { offerId, isActive: false }, now), "offer off");
  must(await makeFree(withOffer), "free once the offer is off");
  assert.equal((await detailOf(db, pro, withOffer, now)).rdvFree, true);
  // The leftover offer cannot go back en vente on a free type (its tickets would be usable nowhere)...
  refused(await setOfferActiveCore(db, ctx, { offerId, isActive: true }, now), RDV_FREE_OFFER_STAYS_OFF, "a free type's offer cannot go back on sale");
  refused(
    await updateOfferCore(db, ctx, { offerId, offer: { ticketTypeId: withOffer, quantity: 1, priceCents: 2500 } }, now),
    RDV_FREE_OFFER_STAYS_OFF,
    "an edit that puts a free type's offer en vente (isActive defaults to true)",
  );
  // ...but it can still be edited while it stays « Pas en vente ».
  must(
    await updateOfferCore(db, ctx, { offerId, offer: { ticketTypeId: withOffer, quantity: 2, priceCents: 4000, isActive: false } }, now),
    "an edit that keeps the offer off sale",
  );
  assert.deepEqual(
    (await detailOf(db, pro, withOffer, now)).offers.map((o) => [o.id, o.quantity, o.priceCents, o.isActive]),
    [[offerId, 2, 4000, false]],
  );
  must(await updateTicketTypeCore(db, ctx, { ticketTypeId: withOffer, patch: { rdvFree: false } }, now), "back to paid");
  must(await setOfferActiveCore(db, ctx, { offerId, isActive: true }, now), "the offer goes back en vente once the type is paid again");
  assert.equal((await detailOf(db, pro, withOffer, now)).rdvFree, false);

  const withTicket = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 15 });
  await giveTickets(db, pro, await makeCustomer(db, pro), withTicket, 1, { expiresAt: addDaysMs(now, 1) });
  refused(await makeFree(withTicket), RDV_FREE_HAS_SALES, "usable ticket");
  must(await makeFree(withTicket, addDaysMs(now, 2)), "the ticket is expired two days later: nothing is held");

  const plain = await makeType(db, pro);
  refused(await makeFree(plain), "Le rendez-vous gratuit demande le RDV libre.", "rdv_free needs the RDV option");
});

dbTest("rdvFree also waits for a payment in progress and for a booked ticket", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const makeFree = (ticketTypeId: string) => updateTicketTypeCore(db, ctx, { ticketTypeId, patch: { rdvFree: true } }, now);

  // A checkout started before the pro turned the offer off can still be paid: its tickets would land on a free type.
  const withCheckout = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 15 });
  const offerId = await makeOffer(db, pro, withCheckout);
  const started = await startPurchase(db, { professionalId: pro.proId, offerId, customerId: await makeCustomer(db, pro) });
  if (!started.ok) assert.fail(`startPurchase: ${JSON.stringify(started)}`);
  must(await setOfferActiveCore(db, ctx, { offerId, isActive: false }, now), "offer off");
  refused(await makeFree(withCheckout), RDV_FREE_HAS_SALES, "a checkout in progress, offer already off");
  assert.equal((await detailOf(db, pro, withCheckout, now)).rdvFree, false, "the refusal changed nothing");

  // A booked ticket comes back available when its booking is cancelled.
  const withBooked = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 15 });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [withBooked] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, withBooked, 1);
  const booked = await bookWithHeldTicket(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt, actorUserId: null });
  assert.ok(booked.ok, `bookWithHeldTicket: ${JSON.stringify(booked)}`);
  refused(await makeFree(withBooked), RDV_FREE_HAS_SALES, "a booked ticket");
  assert.equal((await detailOf(db, pro, withBooked, now)).rdvFree, false, "the refusal changed nothing");
});

dbTest("updateTicketTypeCore refuses a notice longer than the effective horizon", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 60 });
  const overrides = (bookingHorizonDays: number | null, minNoticeMinutes: number | null) => ({
    bookingHorizonDays,
    minNoticeMinutes,
    cancelDeadlineHours: null,
  });
  const patch = (rdvOverrides: ReturnType<typeof overrides>, extra: TicketTypePatch = {}) =>
    updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { rdvOverrides, ...extra } }, now);

  refused(await patch(overrides(1, 10080)), NOTICE_TOO_LONG, "7 days notice, 1 day horizon");
  must(await patch(overrides(null, 10080)), "7 days notice inside the pro's 60 days horizon");
  refused(await patch(overrides(1, 10080)), NOTICE_TOO_LONG, "the same again");
  must(await patch(overrides(1, null)), "1 day horizon with the pro's 60 minutes notice");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).rdvOverrides, overrides(1, null));

  // The pro lowers their own horizon below this type's 7 days notice: a rename (« Informations » card) still works,
  // a patch of the booking rules is checked again.
  must(await patch(overrides(null, 10080)), "7 days notice again, inside the 60 days horizon");
  await db.execute(sql`update professional set booking_horizon_days = 3 where id = ${pro.proId}`);
  must(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { name: "Renommé", color: "#16a34a" } }, now), "a rename skips the window check");
  refused(await patch(overrides(null, 10080)), NOTICE_TOO_LONG, "the booking rules are checked against the lowered horizon");
  refused(await updateTicketTypeCore(db, ctx, { ticketTypeId: typeId, patch: { rdvEnabled: true } }, now), NOTICE_TOO_LONG, "so is the RDV switch");

  // RDV off: the overrides are inert, nothing is checked.
  must(await patch(overrides(1, 10080), { rdvEnabled: false, rdvDurationMin: null }), "RDV off");
});

dbTest("archive, unarchive and delete a type: « Supprimer » archives a used type", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const unused = await makeType(db, pro, { name: "Inutilisé" });
  const used = await makeType(db, pro, { name: "Utilisé" });
  await giveTickets(db, pro, await makeCustomer(db, pro), used, 1);

  must(await setTicketTypeArchivedCore(db, ctx, { ticketTypeId: unused, archived: true }, now), "archive");
  let list = await listTicketTypes(db, pro.proId, now);
  assert.deepEqual(list.archived.map((t) => t.id), [unused]);
  assert.deepEqual(list.active.map((t) => t.id), [used]);
  must(await setTicketTypeArchivedCore(db, ctx, { ticketTypeId: unused, archived: false }, now), "unarchive");
  list = await listTicketTypes(db, pro.proId, now);
  assert.deepEqual(list.archived, []);
  assert.deepEqual(list.active.map((t) => t.id), [unused, used]);

  const gone = await deleteTicketTypeCore(db, ctx, { ticketTypeId: unused }, now);
  must(gone, "delete an unused type");
  assert.equal(gone.outcome, "deleted");
  assert.equal(await getTicketTypeDetail(db, pro.proId, unused, now), null);

  const kept = await deleteTicketTypeCore(db, ctx, { ticketTypeId: used }, now);
  must(kept, "delete a used type");
  assert.equal(kept.outcome, "archived");
  const detail = await detailOf(db, pro, used, now);
  assert.deepEqual([detail.archived, detail.usage.tickets], [true, 1]);

  refused(await deleteTicketTypeCore(db, ctx, { ticketTypeId: unused }, now), NOT_FOUND, "already deleted");
  refused(await setTicketTypeArchivedCore(db, ctx, { ticketTypeId: "inconnu", archived: true }, now), NOT_FOUND, "unknown id");
});

dbTest("createOfferCore: validation, rdv_free types and archived types are refused", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const free = await makeType(db, pro, { rdvEnabled: true, rdvFree: true, rdvDurationMin: 15 });
  const archived = await makeType(db, pro);
  must(await setTicketTypeArchived(db, { professionalId: pro.proId, ticketTypeId: archived, archived: true }), "archive");

  refused(await createOfferCore(db, ctx, { ticketTypeId: typeId, quantity: 1, priceCents: 0 }, now), "Prix : minimum 1.", "free offer");
  refused(
    await createOfferCore(db, ctx, { ticketTypeId: typeId, quantity: 1, priceCents: 2500, validityCount: 3 }, now),
    "Indiquez une durée et une unité de validité, ou aucune.",
    "validity without unit",
  );
  refused(await createOfferCore(db, ctx, { ticketTypeId: free, quantity: 1, priceCents: 2500 }, now), RDV_FREE_NO_OFFER, "offer on an rdv_free type");
  refused(await createOfferCore(db, ctx, { ticketTypeId: archived, quantity: 1, priceCents: 2500 }, now), NOT_FOUND, "offer on an archived type");
  refused(await createOfferCore(db, ctx, { ticketTypeId: "inconnu", quantity: 1, priceCents: 2500 }, now), NOT_FOUND, "unknown type");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).offers, [], "the refusals created nothing");

  const created = await createOfferCore(db, ctx, { ticketTypeId: typeId, quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" }, now);
  must(created, "create");
  const [offer] = (await detailOf(db, pro, typeId, now)).offers;
  assert.deepEqual(
    [offer.id, offer.label, offer.quantity, offer.priceCents, offer.validityText, offer.isActive],
    [created.offerId, "Carnet de 4", 4, 8500, "3 mois", true],
  );
});

dbTest("offers: update keeps the type, « En vente » only flips is_active, delete archives a bought offer", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeA = await makeType(db, pro);
  const typeB = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeA, { quantity: 4, priceCents: 8500, label: "Carnet été", validityCount: 3, validityUnit: "month" });

  // The body names the other type: it is ignored, the offer stays in its own type.
  must(
    await updateOfferCore(
      db,
      ctx,
      { offerId, offer: { ticketTypeId: typeB, quantity: 5, priceCents: 9000, label: "Carnet été", validityCount: 6, validityUnit: "month", isActive: true } },
      now,
    ),
    "update",
  );
  const a = await detailOf(db, pro, typeA, now);
  assert.deepEqual(a.offers.map((o) => [o.id, o.quantity, o.priceCents, o.validityText]), [[offerId, 5, 9000, "6 mois"]]);
  assert.deepEqual((await detailOf(db, pro, typeB, now)).offers, []);
  refused(
    await updateOfferCore(db, ctx, { offerId, offer: { ticketTypeId: typeA, quantity: 0, priceCents: 9000 } }, now),
    "Quantité : minimum 1.",
    "quantity 0",
  );
  refused(
    await updateOfferCore(db, ctx, { offerId: "inconnu", offer: { ticketTypeId: typeA, quantity: 1, priceCents: 100 } }, now),
    NOT_FOUND,
    "unknown offer",
  );

  // « En vente » flips is_active and keeps every other column.
  const columns = (o: { label: string; customLabel: string | null; quantity: number; priceCents: number; validityCount: number | null; validityUnit: string | null }) =>
    [o.label, o.customLabel, o.quantity, o.priceCents, o.validityCount, o.validityUnit];
  const before = columns((await detailOf(db, pro, typeA, now)).offers[0]);
  must(await setOfferActiveCore(db, ctx, { offerId, isActive: false }, now), "off");
  let [offer] = (await detailOf(db, pro, typeA, now)).offers;
  assert.equal(offer.isActive, false);
  assert.deepEqual(columns(offer), before);
  must(await setOfferActiveCore(db, ctx, { offerId, isActive: true }, now), "on");
  [offer] = (await detailOf(db, pro, typeA, now)).offers;
  assert.equal(offer.isActive, true);
  assert.deepEqual(columns(offer), before);

  // Delete: unsold disappears, bought is archived.
  const unsold = await makeOffer(db, pro, typeA);
  const removed = await deleteOfferCore(db, ctx, { offerId: unsold }, now);
  must(removed, "delete an unsold offer");
  assert.equal(removed.outcome, "deleted");
  await buy(db, pro, offerId, await makeCustomer(db, pro));
  const archived = await deleteOfferCore(db, ctx, { offerId }, now);
  must(archived, "delete a bought offer");
  assert.equal(archived.outcome, "archived");
  const after = await detailOf(db, pro, typeA, now);
  assert.deepEqual(after.offers, []);
  assert.deepEqual(after.archivedOffers.map((o) => [o.id, o.sold]), [[offerId, 1]]);
  refused(await setOfferActiveCore(db, ctx, { offerId, isActive: true }, now), NOT_FOUND, "an archived offer is gone");
  refused(await deleteOfferCore(db, ctx, { offerId }, now), NOT_FOUND, "deleting it again");
});

dbTest("setTypeHoursCore sets, validates and clears the hours of a type", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 30 });
  const rules = [
    { dayOfWeek: 1, startMinute: 600, endMinute: 780 },
    { dayOfWeek: 3, startMinute: 840, endMinute: 1020 },
  ];

  must(await setTypeHoursCore(db, ctx, { ticketTypeId: typeId, rules }, now), "set");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).ownHours, rules);
  refused(
    await setTypeHoursCore(db, ctx, { ticketTypeId: typeId, rules: [{ dayOfWeek: 1, startMinute: 900, endMinute: 900 }] }, now),
    "Plage horaire invalide.",
    "empty range",
  );
  const tooMany = Array.from({ length: 169 }, (_, i) => ({ dayOfWeek: i % 7, startMinute: 0, endMinute: 60 }));
  assert.equal((await setTypeHoursCore(db, ctx, { ticketTypeId: typeId, rules: tooMany }, now)).ok, false, "more than 168 ranges");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).ownHours, rules, "the refusals changed nothing");

  must(await setTypeHoursCore(db, ctx, { ticketTypeId: typeId, rules: [] }, now), "clear");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).ownHours, []);
});

dbTest("setTypeQuestionsCore saves, keeps ids of saved questions and refuses a one-option choice", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { rdvEnabled: true, rdvDurationMin: 30 });

  must(
    await setTypeQuestionsCore(
      db,
      ctx,
      {
        ticketTypeId: typeId,
        questions: [
          { label: "Quel est votre objectif ?", type: "text", required: true },
          { label: "Niveau", type: "choice", options: ["Débutant", "Confirmé"], required: false },
        ],
      },
      now,
    ),
    "save",
  );
  const saved = (await detailOf(db, pro, typeId, now)).questions;
  assert.deepEqual(
    saved.map((q) => [q.label, q.type, q.options, q.required]),
    [
      ["Quel est votre objectif ?", "text", null, true],
      ["Niveau", "choice", ["Débutant", "Confirmé"], false],
    ],
  );

  must(
    await setTypeQuestionsCore(
      db,
      ctx,
      { ticketTypeId: typeId, questions: [{ id: saved[0].id, label: "Votre objectif ?", type: "text", required: false }] },
      now,
    ),
    "edit and remove",
  );
  const edited = (await detailOf(db, pro, typeId, now)).questions;
  assert.deepEqual(edited.map((q) => [q.id, q.label, q.required]), [[saved[0].id, "Votre objectif ?", false]]);

  refused(
    await setTypeQuestionsCore(
      db,
      ctx,
      { ticketTypeId: typeId, questions: [{ label: "Niveau", type: "choice", options: ["Seule"], required: false }] },
      now,
    ),
    "Une question à choix demande au moins deux options.",
    "one-option choice",
  );
  assert.equal((await detailOf(db, pro, typeId, now)).questions.length, 1, "the refusal changed nothing");

  must(await setTypeQuestionsCore(db, ctx, { ticketTypeId: typeId, questions: [] }, now), "clear");
  assert.deepEqual((await detailOf(db, pro, typeId, now)).questions, []);
});

dbTest("catalog cores never act on another pro's type or offer", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const now = new Date();
    const ctx = proCtx(pro);
    const theirs = await makeType(db, other, { name: "Le leur", rdvEnabled: true, rdvDurationMin: 30 });
    const theirOffer = await makeOffer(db, other, theirs);
    const offerBody = { ticketTypeId: theirs, quantity: 1, priceCents: 100 };

    refused(await updateTicketTypeCore(db, ctx, { ticketTypeId: theirs, patch: { name: "Piraté" } }, now), NOT_FOUND, "update type");
    refused(await setTicketTypeArchivedCore(db, ctx, { ticketTypeId: theirs, archived: true }, now), NOT_FOUND, "archive type");
    refused(await deleteTicketTypeCore(db, ctx, { ticketTypeId: theirs }, now), NOT_FOUND, "delete type");
    refused(await createOfferCore(db, ctx, offerBody, now), NOT_FOUND, "create offer");
    refused(await updateOfferCore(db, ctx, { offerId: theirOffer, offer: offerBody }, now), NOT_FOUND, "update offer");
    refused(await setOfferActiveCore(db, ctx, { offerId: theirOffer, isActive: false }, now), NOT_FOUND, "toggle offer");
    refused(await deleteOfferCore(db, ctx, { offerId: theirOffer }, now), NOT_FOUND, "delete offer");
    refused(
      await setTypeHoursCore(db, ctx, { ticketTypeId: theirs, rules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }] }, now),
      NOT_FOUND,
      "hours",
    );
    refused(
      await setTypeQuestionsCore(db, ctx, { ticketTypeId: theirs, questions: [{ label: "Intrus ?", type: "text", required: false }] }, now),
      NOT_FOUND,
      "questions",
    );

    const intact = await detailOf(db, other, theirs, now);
    assert.deepEqual([intact.name, intact.archived], ["Le leur", false]);
    assert.deepEqual(intact.offers.map((o) => [o.id, o.isActive]), [[theirOffer, true]]);
    assert.deepEqual([intact.ownHours, intact.questions], [[], []]);

    // The same call from the owner works.
    must(await updateTicketTypeCore(db, proCtx(other), { ticketTypeId: theirs, patch: { name: "Renommé" } }, now), "owner update");
    assert.equal((await detailOf(db, other, theirs, now)).name, "Renommé");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
