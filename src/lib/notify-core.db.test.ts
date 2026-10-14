import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type Db } from "../test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "../test/fixtures";
import { expiryLabel } from "./back-office/format";
import { cancelBookingsByPro, cancelOccurrence } from "./booking/cancel";
import { attachCheckoutSession, registerPro, startBuyAndBook } from "./booking/claims";
import { updateOccurrence } from "./booking/series";
import type { Effect } from "./booking/types";
import { moveAttendee, offerTickets } from "./booking/wallet";
import { professional } from "./db/schema";
import { escapeHtml } from "./email-layout";
import { guestLinkKey, personalLinkUrl } from "./guest-link";
import { planEffect, type EffectPlan, type NotifyDeps, type OutgoingEmail } from "./notify-core";

const APP = "https://app.test";
const KEY = guestLinkKey("test-secret");
const NONE: EffectPlan = { kind: "emails", emails: [] };
const esc = escapeHtml;

const depsAt = (now: Date): NotifyDeps => ({ appUrl: APP, guestKey: KEY, now });
const linkOf = (customerId: string): string => personalLinkUrl(APP, { id: customerId, linkVersion: 1 }, KEY);

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

function emailsOf(plan: EffectPlan): OutgoingEmail[] {
  assert.equal(plan.kind, "emails", JSON.stringify(plan));
  return plan.kind === "emails" ? plan.emails : [];
}

function effectOf<T extends Effect["type"]>(effects: readonly Effect[], type: T): Extract<Effect, { type: T }> {
  const found = effects.find((e): e is Extract<Effect, { type: T }> => e.type === type);
  assert.ok(found, `no ${type} effect in ${JSON.stringify(effects)}`);
  return found;
}

async function businessNameOf(db: Db, proId: string): Promise<string> {
  const [row] = await db.select({ name: professional.businessName }).from(professional).where(eq(professional.id, proId));
  return row.name;
}

dbTest("booking_confirmed: one e-mail with the links, the ticket, the tickets left and the cancel deadline", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const collectif = await makeType(db, pro, { name: "Cours collectif" });
  const essai = await makeType(db, pro, { name: "Cours d'essai" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [collectif] });
  const email = testEmail("conf");
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email });
  await giveTickets(db, pro, customerId, collectif, 2);
  const expires = addDaysMs(now, 40);
  await giveTickets(db, pro, customerId, essai, 1, { expiresAt: expires });
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: false },
      now,
    ),
  );

  const plan = await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, depsAt(now));
  const mails = emailsOf(plan);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  assert.equal(mail.to, email);
  assert.equal(mail.subject, "Inscription confirmée : Altinha du soir");
  assert.ok(mail.html.includes(`Bonjour Beatriz Almeida, votre inscription chez ${esc(business)} est confirmée.`));
  assert.ok(mail.html.includes(linkOf(customerId)), "personal link");
  assert.ok(mail.html.includes(`${APP}/api/bookings/${reg.bookingId}/calendar.ics`), "ICS link");
  assert.ok(mail.html.includes("https://calendar.google.com/calendar/render?action=TEMPLATE"), "Google link");
  assert.ok(mail.html.includes("https://outlook.live.com/calendar/0/deeplink/compose?"), "Outlook link");
  assert.ok(mail.html.includes("Ticket (Cours collectif)"), "coverage with the ticket type");
  assert.ok(mail.html.includes("1 × Cours collectif, sans limite de validité"), "tickets left, no expiry");
  assert.ok(
    mail.html.includes(esc(`1 × Cours d'essai, ${expiryLabel(expires, pro.tz, now)}`)),
    "tickets left, with expiry",
  );
  assert.ok(mail.html.includes(esc("Vous pouvez annuler en ligne jusqu'au ")), "cancel deadline sentence");
});

dbTest("booking_confirmed carries the effective location of the séance", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Roda libre", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  must(
    await updateOccurrence(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        occurrenceId: occ.id,
        seenStartsAt: occ.startsAt,
        patch: { locationOverride: "Studio Marais" },
      },
      now,
    ),
  );
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: false },
      addMinutes(now, 1),
    ),
  );
  const [mail] = emailsOf(
    await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, depsAt(addMinutes(now, 1))),
  );
  assert.ok(mail.html.includes("Studio Marais"));
  assert.ok(mail.html.includes("location=Studio+Marais"), "calendar links carry the location");
});

dbTest("booking_confirmed after the online deadline says the cancellation is closed", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: false },
      now,
    ),
  );
  // the default deadline is 24 h: two hours before the start it has passed
  const late = addMinutes(occ.startsAt, -120);
  const [mail] = emailsOf(await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, depsAt(late)));
  assert.ok(mail.html.includes(esc(`L'annulation en ligne n'est plus possible : contactez ${business}.`)));
  assert.ok(!mail.html.includes(esc("Vous pouvez annuler en ligne jusqu'au ")));
});

dbTest("booking_confirmed plans nothing for an unknown, a pending or a cancelled booking", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const holder = await makeCustomer(db, pro);
  const buyer = await makeCustomer(db, pro);
  await giveTickets(db, pro, holder, typeId, 1);
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: holder, asGuest: false },
      now,
    ),
  );
  const pending = must(
    await startBuyAndBook(
      db,
      { professionalId: pro.proId, occurrenceId: occ.id, customerId: buyer, seenStartsAt: occ.startsAt, offerId },
      now,
    ),
  );
  const confirmedOf = (bookingId: string): Effect => ({ type: "email.booking_confirmed", bookingId });

  assert.deepEqual(await planEffect(db, confirmedOf("unknown-booking"), depsAt(now)), NONE);
  assert.deepEqual(await planEffect(db, confirmedOf(pending.bookingId), depsAt(now)), NONE);
  must(
    await cancelBookingsByPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, bookingIds: [reg.bookingId] },
      now,
    ),
  );
  assert.deepEqual(await planEffect(db, confirmedOf(reg.bookingId), depsAt(now)), NONE);
});

dbTest("booking_cancelled: the reason, the personal link and the ticket line only when a ticket came back", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const holderEmail = testEmail("holder");
  const holder = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: holderEmail });
  const guest = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await giveTickets(db, pro, holder, typeId, 1);
  const withTicket = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: holder, asGuest: false },
      now,
    ),
  );
  const asGuest = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: guest, asGuest: true },
      now,
    ),
  );
  const res = must(
    await cancelBookingsByPro(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        occurrenceId: occ.id,
        bookingIds: [withTicket.bookingId, asGuest.bookingId],
        reason: "Cours annulé pour travaux",
      },
      now,
    ),
  );
  assert.equal(res.effects.filter((e) => e.type === "email.booking_cancelled").length, 2);

  const [m1] = emailsOf(
    await planEffect(db, { type: "email.booking_cancelled", bookingId: withTicket.bookingId, by: "pro" }, depsAt(now)),
  );
  assert.equal(m1.to, holderEmail);
  assert.equal(m1.subject, "Inscription annulée : Altinha du soir");
  assert.ok(m1.html.includes(`${esc(business)} a annulé votre inscription à « Altinha du soir »`));
  assert.ok(m1.html.includes("Motif : Cours annulé pour travaux"));
  assert.ok(m1.html.includes("Votre ticket a été rendu à votre portefeuille."));
  assert.ok(m1.html.includes(linkOf(holder)));

  const [m2] = emailsOf(
    await planEffect(db, { type: "email.booking_cancelled", bookingId: asGuest.bookingId, by: "pro" }, depsAt(now)),
  );
  assert.ok(m2.html.includes("Motif : Cours annulé pour travaux"));
  assert.ok(!m2.html.includes("Votre ticket a été rendu"), "a guest has no ticket to give back");
  assert.ok(m2.html.includes(linkOf(guest)));

  const [m3] = emailsOf(
    await planEffect(db, { type: "email.booking_cancelled", bookingId: withTicket.bookingId, by: "client" }, depsAt(now)),
  );
  assert.ok(m3.html.includes("est bien enregistrée"));
  assert.ok(!m3.html.includes("a annulé votre inscription"));
});

dbTest("occurrence_cancelled mails the confirmed client only: a lapsed hold hears nothing; the open session is planned for expiry", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const confirmedEmail = testEmail("kept");
  const confirmed = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: confirmedEmail });
  const abandoned = await makeCustomer(db, pro, { name: "Thomas Leroy" });
  await giveTickets(db, pro, confirmed, typeId, 1);
  must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: confirmed, asGuest: false },
      now,
    ),
  );
  // the hold lasts 45 min: started 60 min ago it has lapsed when the pro cancels
  const hold = must(
    await startBuyAndBook(
      db,
      { professionalId: pro.proId, occurrenceId: occ.id, customerId: abandoned, seenStartsAt: occ.startsAt, offerId },
      addMinutes(now, -60),
    ),
  );
  const sessionId = `cs_test_${hold.purchaseId}`;
  must(
    await attachCheckoutSession(db, {
      purchaseId: hold.purchaseId,
      checkoutSessionId: sessionId,
      checkoutUrl: "https://checkout.example.test/s",
    }),
  );

  const res = must(
    await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id }, now),
  );
  const cancelled = effectOf(res.effects, "email.occurrence_cancelled");
  assert.equal(cancelled.bookingIds.length, 2);

  const mails = emailsOf(await planEffect(db, cancelled, depsAt(now)));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, confirmedEmail);
  assert.equal(mails[0].subject, "Séance annulée : Altinha du soir");
  assert.ok(mails[0].html.includes("Votre inscription est annulée."));
  assert.ok(mails[0].html.includes("Votre ticket a été rendu à votre portefeuille."));
  assert.ok(mails[0].html.includes(linkOf(confirmed)));

  assert.deepEqual(
    await planEffect(db, { type: "email.booking_cancelled", bookingId: hold.bookingId, by: "pro" }, depsAt(now)),
    NONE,
    "the lapsed hold gets no « Inscription annulée » either",
  );
  const expire = effectOf(res.effects, "stripe.expire_session");
  assert.deepEqual(await planEffect(db, expire, depsAt(now)), {
    kind: "stripe",
    purchaseId: hold.purchaseId,
    checkoutSessionId: sessionId,
  });
});

dbTest("occurrence_changed: the new time and place, the cancel line only for those who may cancel until the start", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const early = await makeCustomer(db, pro, { name: "Beatriz Almeida" });
  const lateComer = await makeCustomer(db, pro, { name: "Rafael Souza" });
  await giveTickets(db, pro, early, typeId, 1);
  await giveTickets(db, pro, lateComer, typeId, 1);
  const reg1 = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: early, asGuest: false },
      now,
    ),
  );
  const changedAt = addMinutes(now, 5);
  const upd = must(
    await updateOccurrence(
      db,
      {
        professionalId: pro.proId,
        actorUserId: pro.userId,
        occurrenceId: occ.id,
        seenStartsAt: occ.startsAt,
        patch: { startsAt: addMinutes(occ.startsAt, 60), locationOverride: "Studio Marais" },
      },
      changedAt,
    ),
  );
  const reg2 = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: lateComer, asGuest: false },
      addMinutes(now, 10),
    ),
  );

  const own = effectOf(upd.effects, "email.occurrence_changed");
  assert.deepEqual(own.bookingIds, [reg1.bookingId]);
  const [first] = emailsOf(await planEffect(db, own, depsAt(changedAt)));
  assert.equal(first.subject, "Séance modifiée : Altinha du soir");
  assert.ok(first.html.includes("Studio Marais"));
  const cancelLine = esc("Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.");
  assert.ok(first.html.includes(cancelLine), "booked before the change: may cancel until the start");

  const both: Effect = {
    type: "email.occurrence_changed",
    occurrenceId: occ.id,
    bookingIds: [reg2.bookingId, reg1.bookingId],
  };
  const mails = emailsOf(await planEffect(db, both, depsAt(addMinutes(now, 11))));
  assert.equal(mails.length, 2);
  const toLate = mails.find((m) => m.html.includes(linkOf(lateComer)));
  assert.ok(toLate, "one e-mail per listed booking");
  assert.ok(!toLate.html.includes(cancelLine), "booked after the change: the normal deadline applies");

  must(
    await cancelBookingsByPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, bookingIds: [reg2.bookingId] },
      addMinutes(now, 12),
    ),
  );
  assert.equal(emailsOf(await planEffect(db, both, depsAt(addMinutes(now, 12)))).length, 1, "a cancelled booking is skipped");
});

dbTest("attendee_moved: before and after; a séance of another pro is never read", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [from] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const { occurrences: [to] } = await makeEvent(db, pro, {
    title: "Altinha du samedi",
    ticketTypeIds: [typeId],
    rule: { startDate: dayIn(pro, 4) },
  });
  const email = testEmail("moved");
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email });
  await giveTickets(db, pro, customerId, typeId, 1);
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: from.id, customerId, asGuest: false },
      now,
    ),
  );
  const moved = must(
    await moveAttendee(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, bookingId: reg.bookingId, targetOccurrenceId: to.id, force: false },
      addMinutes(now, 1),
    ),
  );

  const effect = effectOf(moved.effects, "email.attendee_moved");
  const [mail] = emailsOf(await planEffect(db, effect, depsAt(addMinutes(now, 1))));
  assert.equal(mail.to, email);
  assert.equal(mail.subject, "Inscription déplacée : Altinha du samedi");
  assert.ok(mail.html.includes("Altinha du soir"), "the old séance");
  assert.ok(mail.html.includes("Altinha du samedi"), "the new séance");
  assert.ok(mail.html.includes(linkOf(customerId)));

  const other = await createTestPro(db);
  try {
    const { occurrences: [foreign] } = await makeEvent(db, other, { title: "Séance d'un autre" });
    assert.deepEqual(
      await planEffect(
        db,
        { type: "email.attendee_moved", bookingId: reg.bookingId, fromOccurrenceId: foreign.id },
        depsAt(now),
      ),
      NONE,
    );
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("tickets_offered: the count and the type of that action; another pro's customer gets nothing", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const email = testEmail("offer");
  const customerId = await makeCustomer(db, pro, { name: "Léa Martin", email });
  const expires = addDaysMs(now, 30);
  const base = { professionalId: pro.proId, actorUserId: pro.userId, customerId, ticketTypeId: typeId, notify: true };
  const three = must(await offerTickets(db, { ...base, quantity: 3, expiresAt: expires }, now));
  const one = must(await offerTickets(db, { ...base, quantity: 1, expiresAt: null }, addMinutes(now, 1)));

  const threeEffect = effectOf(three.effects, "email.tickets_offered");
  const [m3] = emailsOf(await planEffect(db, threeEffect, depsAt(now)));
  assert.equal(m3.to, email);
  assert.equal(m3.subject, `${business} vous offre 3 tickets`);
  assert.ok(
    m3.html.includes(esc(`vous offre 3 tickets « Cours collectif », ${expiryLabel(expires, pro.tz, now)}.`)),
    "three tickets with their expiry",
  );
  assert.ok(m3.html.includes(linkOf(customerId)));

  const oneEffect = effectOf(one.effects, "email.tickets_offered");
  const [m1] = emailsOf(await planEffect(db, oneEffect, depsAt(now)));
  assert.equal(m1.subject, `${business} vous offre 1 ticket`);
  assert.ok(m1.html.includes(esc("vous offre 1 ticket « Cours collectif », sans limite de validité.")));

  const other = await createTestPro(db);
  try {
    const foreign = await makeCustomer(db, other);
    assert.deepEqual(
      await planEffect(
        db,
        { type: "email.tickets_offered", customerId: foreign, actionId: threeEffect.actionId, quantity: 3 },
        depsAt(now),
      ),
      NONE,
    );
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("P4 types are deferred, Google and Stripe pass through, a row that no longer exists plans no e-mail", async ({ db }) => {
  const deps = depsAt(new Date());
  const deferred: Effect[] = [
    { type: "email.pro_new_booking", bookingId: "b1" },
    { type: "email.pro_booking_cancelled", bookingId: "b1" },
    { type: "email.purchase_receipt", purchaseId: "p1" },
    { type: "email.late_payment", purchaseId: "p1" },
  ];
  for (const effect of deferred) {
    assert.deepEqual(await planEffect(db, effect, deps), { kind: "deferred", type: effect.type });
  }
  assert.deepEqual(await planEffect(db, { type: "google.sync_occurrence", occurrenceId: "o1" }, deps), {
    kind: "google",
    occurrenceId: "o1",
  });
  assert.deepEqual(
    await planEffect(db, { type: "stripe.expire_session", purchaseId: "p1", checkoutSessionId: "cs_test_1" }, deps),
    { kind: "stripe", purchaseId: "p1", checkoutSessionId: "cs_test_1" },
  );

  const gone: Effect[] = [
    { type: "email.booking_confirmed", bookingId: "gone" },
    { type: "email.booking_cancelled", bookingId: "gone", by: "pro" },
    { type: "email.occurrence_cancelled", occurrenceId: "gone", bookingIds: ["gone"] },
    { type: "email.occurrence_changed", occurrenceId: "gone", bookingIds: ["gone"] },
    { type: "email.attendee_moved", bookingId: "gone", fromOccurrenceId: "gone" },
    { type: "email.tickets_offered", customerId: "gone", actionId: "gone", quantity: 1 },
  ];
  for (const effect of gone) {
    assert.deepEqual(await planEffect(db, effect, deps), NONE, effect.type);
  }
});
