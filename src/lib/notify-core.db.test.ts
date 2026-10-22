import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, testEmail, type Db, type TestPro } from "../test/db";
import { dayIn, getOccurrence, giveTickets, makeCustomer, makeEvent, makeOffer, makeType } from "../test/fixtures";
import { rowBooking, rowPurchase } from "../test/rows";
import { expiryLabel, formatWhen, planningHref } from "./back-office/format";
import { googleCalendarUrl, outlookCalendarUrl } from "./calendar-links";
import { cancelByClient, cancelBookingsByPro, cancelOccurrence } from "./booking/cancel";
import { setAvailabilityRules } from "./booking/catalog";
import { attachCheckoutSession, bookRdv, registerFree, registerPro, startBuyAndBook } from "./booking/claims";
import { fulfillPurchase } from "./booking/fulfillment";
import { releasePurchase } from "./booking/release";
import { updateOccurrence } from "./booking/series";
import type { Effect } from "./booking/types";
import { moveAttendee, offerTickets } from "./booking/wallet";
import { booking, professional, ticketPurchase, user } from "./db/schema";
import { escapeHtml } from "./email-layout";
import { formatDayMonthYear, instantAt, todayKey } from "./civil-date";
import { guestLinkKey, personalLinkUrl } from "./guest-link";
import { planEffect, type EffectPlan, type NotifyDeps, type OutgoingEmail } from "./notify-core";
import { COPY } from "./public/messages";
import { ticketExpiry } from "./ticket-expiry";
import { formatMoney } from "./utils";

const APP = "https://app.test";
const KEY = guestLinkKey("test-secret");
const NONE: EffectPlan = { kind: "emails", professionalId: null, emails: [] };
const esc = escapeHtml;

const depsAt = (now: Date): NotifyDeps => ({ appUrl: APP, guestKey: KEY, now });
const linkOf = (customerId: string): string => personalLinkUrl(APP, { id: customerId, linkVersion: 1 }, KEY);

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

/** The mails of an e-mails plan; with `proId`, also that the plan names that pro (the budget of src/lib/mail-budget.ts is spent on it). */
function emailsOf(plan: EffectPlan, proId?: string): OutgoingEmail[] {
  assert.equal(plan.kind, "emails", JSON.stringify(plan));
  if (plan.kind !== "emails") return [];
  if (proId !== undefined) assert.equal(plan.professionalId, proId, "the plan names the pro whose budget it spends");
  return plan.emails;
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
  const mails = emailsOf(plan, pro.proId);
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

dbTest("booking_confirmed: the tickets left of one type are listed per expiry date, with the right plural", async ({ db, pro }) => {
  const now = new Date();
  const collectif = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [collectif] });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: testEmail("left") });
  const soon = addDaysMs(now, 20);
  const later = addDaysMs(now, 90);
  await giveTickets(db, pro, customerId, collectif, 1, { expiresAt: soon });
  await giveTickets(db, pro, customerId, collectif, 2, { expiresAt: later });
  await giveTickets(db, pro, customerId, collectif, 1);
  // a guest place spends no ticket: the wallet the mail reads is the four tickets above
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: true },
      now,
    ),
  );

  const [mail] = emailsOf(await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, depsAt(now)), pro.proId);
  const dated = (expiresAt: Date, n: number) => `• ${n} ${expiryLabel(expiresAt, pro.tz, now, n)}`;
  assert.ok(mail.html.includes("Vos tickets restants :"));
  assert.ok(
    mail.html.includes(
      `<p>${esc("4 × Cours collectif")}<br>${esc(dated(soon, 1))}<br>${esc(dated(later, 2))}<br>${esc("• 1 sans limite de validité")}</p>`,
    ),
    "the type's total, then one sub-line per expiry date (soonest first), the tickets without limit last",
  );
  assert.ok(dated(soon, 1).includes(" valable jusqu'au ") && dated(later, 2).includes(" valables jusqu'au "), "the wording agrees with each count");
  assert.equal(mail.html.split(" × ").length - 1, 1, "one line for the one type");
});

dbTest("booking_confirmed: a type whose tickets all share one expiry stays on one line", async ({ db, pro }) => {
  const now = new Date();
  const carnet = await makeType(db, pro, { name: "Carnet" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [carnet] });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: testEmail("one") });
  const expires = addDaysMs(now, 30);
  await giveTickets(db, pro, customerId, carnet, 3, { expiresAt: expires });
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId, asGuest: true },
      now,
    ),
  );
  const [mail] = emailsOf(await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, depsAt(now)));
  assert.ok(mail.html.includes(esc(`3 × Carnet, ${expiryLabel(expires, pro.tz, now, 3)}`)));
  assert.ok(expiryLabel(expires, pro.tz, now, 3).startsWith("valables jusqu'au "));
  assert.ok(!mail.html.includes("• "), "no sub-line for a single expiry");
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
    pro.proId,
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

  const mails = emailsOf(await planEffect(db, cancelled, depsAt(now)), pro.proId);
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

dbTest("occurrence_cancelled: a cancelled rendez-vous is announced as « Rendez-vous annulé », a séance still as « Séance annulée »", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 60 });
  const allWeek = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
  must(await setAvailabilityRules(db, { professionalId: pro.proId, ticketTypeId: null, rules: allWeek }));
  const email = testEmail("rdv");
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email });
  const rdv = must(
    await bookRdv(
      db,
      {
        professionalId: pro.proId,
        ticketTypeId: typeId,
        startsAt: instantAt(dayIn(pro, 3), 600, pro.tz),
        customerId,
        actorUserId: null,
        mode: "free",
      },
      now,
    ),
  );
  const res = must(
    await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: rdv.occurrenceId }, now),
  );
  const [mail] = emailsOf(await planEffect(db, effectOf(res.effects, "email.occurrence_cancelled"), depsAt(now)), pro.proId);
  assert.equal(mail.to, email);
  assert.equal(mail.subject, "Rendez-vous annulé : Appel découverte");
  assert.ok(mail.html.includes(">Rendez-vous annulé</h1>"));
  assert.ok(mail.html.includes(esc(`Bonjour Beatriz Almeida, ${business} a annulé votre rendez-vous « Appel découverte » du `)));
  assert.ok(!mail.html.includes("Séance annulée"), "a rendez-vous is not a séance");
  assert.ok(mail.html.includes(linkOf(customerId)));

  // the same plan for a séance keeps its wording
  const seanceType = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [seanceType] });
  const guest = await makeCustomer(db, pro, { name: "Rafael Souza", email: testEmail("seance") });
  must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: guest, asGuest: true },
      now,
    ),
  );
  const cancelled = must(
    await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id }, now),
  );
  const [seance] = emailsOf(await planEffect(db, effectOf(cancelled.effects, "email.occurrence_cancelled"), depsAt(now)));
  assert.equal(seance.subject, "Séance annulée : Altinha du soir");
  assert.ok(!seance.html.includes("Rendez-vous annulé"));
});

dbTest("occurrence_cancelled: a hold still live when the séance is cancelled hears about it (Decision 11 boundary)", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const buyerEmail = testEmail("live");
  const buyer = await makeCustomer(db, pro, { name: "Thomas Leroy", email: buyerEmail });
  // the hold lasts 45 min: started now, it is still live when the pro cancels 10 min later
  const hold = must(
    await startBuyAndBook(
      db,
      { professionalId: pro.proId, occurrenceId: occ.id, customerId: buyer, seenStartsAt: occ.startsAt, offerId },
      now,
    ),
  );
  const cancelAt = addMinutes(now, 10);
  const res = must(
    await cancelOccurrence(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id }, cancelAt),
  );
  const cancelled = effectOf(res.effects, "email.occurrence_cancelled");
  assert.ok(cancelled.bookingIds.includes(hold.bookingId));

  const mails = emailsOf(await planEffect(db, cancelled, depsAt(cancelAt)));
  assert.equal(mails.length, 1, "a client who may still pay for a seat that no longer exists is told");
  assert.equal(mails[0].to, buyerEmail);
  assert.equal(mails[0].subject, "Séance annulée : Altinha du soir");
  assert.ok(mails[0].html.includes("Votre inscription est annulée."));
  assert.ok(!mails[0].html.includes("Votre ticket a été rendu"), "nothing was paid, so nothing came back");
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
  const [first] = emailsOf(await planEffect(db, own, depsAt(changedAt)), pro.proId);
  assert.equal(first.subject, "Séance modifiée : Altinha du soir");
  assert.ok(first.html.includes("Studio Marais"));
  // the calendar links carry the NEW time and place, and the file is this booking's
  const updated = await getOccurrence(db, occ.id);
  const asked = {
    title: "Altinha du soir",
    description: `Avec ${await businessNameOf(db, pro.proId)}`,
    location: "Studio Marais",
    startAt: updated.startsAt,
    endAt: updated.endsAt,
  };
  assert.equal(updated.startsAt.getTime(), addMinutes(occ.startsAt, 60).getTime());
  assert.ok(first.html.includes(esc(googleCalendarUrl(asked))), "Google link of the new time");
  assert.ok(first.html.includes(esc(outlookCalendarUrl(asked))), "Outlook link of the new time");
  assert.ok(first.html.includes(`${APP}/api/bookings/${reg1.bookingId}/calendar.ics`), "ICS link of this booking");
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

dbTest("occurrence_changed: a client who has not paid yet gets the new time but no calendar file", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const holder = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: testEmail("paid") });
  const buyer = await makeCustomer(db, pro, { name: "Thomas Leroy", email: testEmail("unpaid") });
  await giveTickets(db, pro, holder, typeId, 1);
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: holder, asGuest: false },
      now,
    ),
  );
  const hold = must(
    await startBuyAndBook(
      db,
      { professionalId: pro.proId, occurrenceId: occ.id, customerId: buyer, seenStartsAt: occ.startsAt, offerId },
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
        patch: { startsAt: addMinutes(occ.startsAt, 60) },
      },
      changedAt,
    ),
  );
  const effect = effectOf(upd.effects, "email.occurrence_changed");
  assert.deepEqual([...effect.bookingIds].sort(), [reg.bookingId, hold.bookingId].sort());
  const mails = emailsOf(await planEffect(db, effect, depsAt(changedAt)));
  assert.equal(mails.length, 2);
  const toHolder = mails.find((m) => m.html.includes(linkOf(holder)));
  const toBuyer = mails.find((m) => m.html.includes(linkOf(buyer)));
  assert.ok(toHolder && toBuyer);
  assert.ok(toHolder.html.includes(`${APP}/api/bookings/${reg.bookingId}/calendar.ics`), "a confirmed place has its file");
  assert.ok(!toBuyer.html.includes("calendar.ics"), "the file of a pending booking would answer 404");
  assert.ok(!toBuyer.html.includes("calendar.google.com"), "no calendar for a place that is not confirmed yet");
  assert.ok(toBuyer.html.includes("Séance modifiée") && toBuyer.html.includes(">Date<"), "the new time is still told");
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
  const [mail] = emailsOf(await planEffect(db, effect, depsAt(addMinutes(now, 1))), pro.proId);
  assert.equal(mail.to, email);
  assert.equal(mail.subject, "Inscription déplacée : Altinha du samedi");
  assert.ok(mail.html.includes("Altinha du soir"), "the old séance");
  assert.ok(mail.html.includes("Altinha du samedi"), "the new séance");
  assert.ok(mail.html.includes(linkOf(customerId)));
  // the calendar links are those of the NEW séance, the file is the booking's
  const asked = {
    title: "Altinha du samedi",
    description: `Avec ${await businessNameOf(db, pro.proId)}`,
    location: null,
    startAt: to.startsAt,
    endAt: to.endsAt,
  };
  assert.ok(mail.html.includes(esc(googleCalendarUrl(asked))), "Google link of the new séance");
  assert.ok(mail.html.includes(esc(outlookCalendarUrl(asked))), "Outlook link of the new séance");
  assert.ok(mail.html.includes(`${APP}/api/bookings/${reg.bookingId}/calendar.ics`), "ICS link of the moved booking");

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
  const [m3] = emailsOf(await planEffect(db, threeEffect, depsAt(now)), pro.proId);
  assert.equal(m3.to, email);
  assert.equal(m3.subject, `${business} vous offre 3 tickets`);
  assert.ok(
    m3.html.includes(esc(`vous offre 3 tickets « Cours collectif », ${expiryLabel(expires, pro.tz, now, 3)}.`)),
    "three tickets with their expiry",
  );
  assert.ok(expiryLabel(expires, pro.tz, now, 3).startsWith("valables jusqu'au "), "several tickets: valables");
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

dbTest("a booking row that crosses two pros plans no e-mail: its customer and its séance must be its own pro's", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const ownEmail = testEmail("own");
  const own = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: ownEmail });
  const goneEmail = testEmail("gone");
  const gone = await makeCustomer(db, pro, { name: "Rafael Souza", email: goneEmail });
  await giveTickets(db, pro, own, typeId, 1);
  const reg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: occ.id, customerId: own, asGuest: false },
      now,
    ),
  );
  const other = await createTestPro(db);
  const handBuilt: string[] = [];
  const row = async (args: Parameters<typeof rowBooking>[2]): Promise<string> => {
    const id = await rowBooking(db, pro, args, now);
    handBuilt.push(id);
    return id;
  };
  try {
    const stranger = await makeCustomer(db, other, { name: "Mallory", email: testEmail("mallory") });
    const { occurrences: [foreignOcc] } = await makeEvent(db, other, { title: "Séance d'un autre" });
    // Built by hand on purpose: booking.professional_id has no composite FK to its customer's or its
    // séance's pro, so only the plans' own joins keep a foreign row out of an e-mail.
    const ownGone = await row({ occurrenceId: occ.id, customerId: gone, status: "cancelled" });
    const strangerConfirmed = await row({ occurrenceId: occ.id, customerId: stranger });
    const strangerCancelled = await row({ occurrenceId: occ.id, customerId: stranger, status: "cancelled" });
    const misplacedConfirmed = await row({ occurrenceId: foreignOcc.id, customerId: own });
    const misplacedCancelled = await row({ occurrenceId: foreignOcc.id, customerId: own, status: "cancelled" });
    const deps = depsAt(now);

    // booking_confirmed: the control still plans its e-mail, the crossed rows plan none
    const [control] = emailsOf(await planEffect(db, { type: "email.booking_confirmed", bookingId: reg.bookingId }, deps));
    assert.equal(control.to, ownEmail);
    assert.deepEqual(
      await planEffect(db, { type: "email.booking_confirmed", bookingId: strangerConfirmed }, deps),
      NONE,
      "customer of another pro",
    );
    assert.deepEqual(
      await planEffect(db, { type: "email.booking_confirmed", bookingId: misplacedConfirmed }, deps),
      NONE,
      "séance of another pro",
    );

    // booking_cancelled
    const [goneMail] = emailsOf(await planEffect(db, { type: "email.booking_cancelled", bookingId: ownGone, by: "pro" }, deps));
    assert.equal(goneMail.to, goneEmail);
    for (const bookingId of [strangerCancelled, misplacedCancelled]) {
      assert.deepEqual(await planEffect(db, { type: "email.booking_cancelled", bookingId, by: "pro" }, deps), NONE, bookingId);
    }

    // occurrence_cancelled and occurrence_changed: the list keeps the pro's own rows only
    const cancelledList: Effect = {
      type: "email.occurrence_cancelled",
      occurrenceId: occ.id,
      bookingIds: [ownGone, strangerCancelled],
    };
    assert.deepEqual(emailsOf(await planEffect(db, cancelledList, deps)).map((m) => m.to), [goneEmail]);
    assert.deepEqual(
      await planEffect(
        db,
        { type: "email.occurrence_cancelled", occurrenceId: foreignOcc.id, bookingIds: [misplacedCancelled] },
        deps,
      ),
      NONE,
    );
    const changedList: Effect = {
      type: "email.occurrence_changed",
      occurrenceId: occ.id,
      bookingIds: [reg.bookingId, strangerConfirmed],
    };
    assert.deepEqual(emailsOf(await planEffect(db, changedList, deps)).map((m) => m.to), [ownEmail]);
    assert.deepEqual(
      await planEffect(
        db,
        { type: "email.occurrence_changed", occurrenceId: foreignOcc.id, bookingIds: [misplacedConfirmed] },
        deps,
      ),
      NONE,
    );

    // attendee_moved
    for (const bookingId of [strangerConfirmed, misplacedConfirmed]) {
      assert.deepEqual(
        await planEffect(db, { type: "email.attendee_moved", bookingId, fromOccurrenceId: occ.id }, deps),
        NONE,
        bookingId,
      );
    }

    // pro_new_booking and pro_booking_cancelled: the control plans its notice to the pro, the crossed rows none
    await db.update(booking).set({ endedBy: "client" }).where(inArray(booking.id, [ownGone, strangerCancelled, misplacedCancelled]));
    const proEmail = await userEmailOf(db, pro.userId);
    const [created] = emailsOf(await planEffect(db, { type: "email.pro_new_booking", bookingId: reg.bookingId }, deps), pro.proId);
    assert.equal(created.to, proEmail);
    for (const bookingId of [strangerConfirmed, misplacedConfirmed]) {
      assert.deepEqual(await planEffect(db, { type: "email.pro_new_booking", bookingId }, deps), NONE, bookingId);
    }
    const [notice] = emailsOf(await planEffect(db, { type: "email.pro_booking_cancelled", bookingId: ownGone }, deps), pro.proId);
    assert.equal(notice.to, proEmail);
    for (const bookingId of [strangerCancelled, misplacedCancelled]) {
      assert.deepEqual(await planEffect(db, { type: "email.pro_booking_cancelled", bookingId }, deps), NONE, bookingId);
    }
  } finally {
    // The hand-built rows go first: foreign keys inside the domain are NO ACTION, and a confirmed one
    // would break I1 (seats_taken) when the harness checks.
    if (handBuilt.length > 0) await db.delete(booking).where(inArray(booking.id, handBuilt));
    await deleteTestUser(db, other.userId);
  }
});

dbTest("Google and Stripe pass through, a row that no longer exists plans no e-mail", async ({ db }) => {
  const deps = depsAt(new Date());
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
    { type: "email.pro_new_booking", bookingId: "gone" },
    { type: "email.pro_booking_cancelled", bookingId: "gone" },
    { type: "email.purchase_receipt", purchaseId: "gone" },
    { type: "email.late_payment", purchaseId: "gone" },
  ];
  for (const effect of gone) {
    assert.deepEqual(await planEffect(db, effect, deps), NONE, effect.type);
  }
});

/* ───────────────────── P4: receipt, late payment and the pro's notices ───────────────────── */

/** The address of a user (the pro's own account is the recipient of the pro notices). */
async function userEmailOf(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  return row.email;
}

/** E1 as the action does it: the hold and its pending purchase at `holdAt`, then the Checkout session attached. */
async function holdSeat(
  db: Db,
  pro: TestPro,
  args: { occurrence: { id: string; startsAt: Date }; customerId: string; offerId: string; holdAt: Date },
) {
  const hold = must(
    await startBuyAndBook(
      db,
      {
        professionalId: pro.proId,
        occurrenceId: args.occurrence.id,
        customerId: args.customerId,
        seenStartsAt: args.occurrence.startsAt,
        offerId: args.offerId,
      },
      args.holdAt,
    ),
  );
  must(
    await attachCheckoutSession(
      db,
      {
        purchaseId: hold.purchaseId,
        checkoutSessionId: `cs_test_${hold.purchaseId}`,
        checkoutUrl: "https://checkout.example.test/s",
      },
      args.holdAt,
    ),
  );
  return hold;
}

/** The webhook's path: the purchase is fulfilled at `now` (a live payment carries its payment intent, invariant I6). */
function pay(db: Db, purchaseId: string, now: Date, livemode = false) {
  return fulfillPurchase(db, purchaseId, { sessionId: `cs_test_${purchaseId}`, paymentIntentId: `pi_${purchaseId}`, livemode }, now);
}

dbTest("purchase_receipt: « Reçu » of a paid buy + book of « Carnet de 4 »: amount, expiry of the 4 tickets, the booking, 3 tickets left, the test line", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId, { quantity: 4, priceCents: 8500, validityCount: 3, validityUnit: "month" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const email = testEmail("receipt");
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email });
  const hold = await holdSeat(db, pro, { occurrence: occ, customerId, offerId, holdAt: now });
  const paid = await pay(db, hold.purchaseId, now);
  assert.equal(paid.outcome, "fulfilled");
  assert.deepEqual(
    paid.effects.map((e) => e.type),
    ["email.purchase_receipt", "email.booking_confirmed", "email.pro_new_booking", "google.sync_occurrence"],
  );

  const mails = emailsOf(await planEffect(db, effectOf(paid.effects, "email.purchase_receipt"), depsAt(now)), pro.proId);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  const expires = ticketExpiry(now, { count: 3, unit: "month" }, pro.tz);
  const when = formatWhen(occ.startsAt, occ.endsAt, pro.tz);
  assert.equal(mail.to, email);
  assert.equal(mail.subject, `Reçu : Carnet de 4 chez ${business}`);
  assert.ok(mail.html.includes(esc(`Bonjour Beatriz Almeida, merci pour votre achat chez ${business}.`)));
  assert.ok(mail.html.includes(esc("Carnet de 4 (4 tickets « Cours collectif »)")), "label, quantity and type");
  assert.ok(mail.html.includes(esc(formatMoney(8500, "eur"))), "amount");
  assert.ok(mail.html.includes(esc(formatDayMonthYear(todayKey(now, pro.tz)))), "paid on");
  assert.ok(expiryLabel(expires, pro.tz, now, 4).startsWith("valables jusqu'au "), "four tickets: « valables »");
  assert.ok(mail.html.includes(esc(expiryLabel(expires, pro.tz, now, 4))), "the expiry of the 4 tickets");
  assert.ok(mail.html.includes(esc(`Un des tickets a servi pour votre inscription à « Altinha du soir » (${when}).`)), "booking line");
  assert.ok(mail.html.includes(esc("3 tickets sont dans votre portefeuille.")), "the spent ticket is not counted");
  assert.ok(mail.html.includes(esc(COPY.TEST_PAYMENT_LINE)), "livemode false: the test line");
  assert.ok(mail.html.includes(linkOf(customerId)), "personal link");
});

dbTest("purchase_receipt: « À l'unité » paid for real: no wallet line (its ticket was spent), no test line, no limit of validity (COV-M1g)", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: testEmail("unit") });
  const hold = await holdSeat(db, pro, { occurrence: occ, customerId, offerId, holdAt: now });
  const paid = await pay(db, hold.purchaseId, now, true);

  const [mail] = emailsOf(await planEffect(db, effectOf(paid.effects, "email.purchase_receipt"), depsAt(now)), pro.proId);
  assert.equal(mail.subject, `Reçu : À l'unité chez ${business}`);
  assert.ok(mail.html.includes(esc("À l'unité (1 ticket « Cours collectif »)")));
  assert.ok(mail.html.includes(esc(formatMoney(2500, "eur"))));
  assert.ok(mail.html.includes("sans limite de validité"));
  assert.equal(mail.html.includes("portefeuille"), false, "the only ticket was spent on the booking");
  assert.equal(mail.html.includes("Paiement de test"), false, "a live payment carries no test line");
});

dbTest("late_payment: a payment that lands after the hold ended mails « Paiement reçu » with the ticket count; the receipt says every ticket is in the wallet", async ({ db, pro }) => {
  const now = new Date();
  const business = await businessNameOf(db, pro.proId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const when = formatWhen(occ.startsAt, occ.endsAt, pro.tz);
  const cases = [
    { quantity: 4, sentence: "vos 4 tickets sont dans votre portefeuille.", wallet: "4 tickets sont dans votre portefeuille." },
    { quantity: 1, sentence: "votre ticket est dans votre portefeuille.", wallet: "1 ticket est dans votre portefeuille." },
  ];
  for (const { quantity, sentence, wallet } of cases) {
    const offerId = await makeOffer(db, pro, typeId, { quantity });
    const email = testEmail("late");
    const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email });
    // the hold started 60 minutes ago: it lapsed at 45, and the seat was released before the payment landed
    const hold = await holdSeat(db, pro, { occurrence: occ, customerId, offerId, holdAt: addMinutes(now, -60) });
    const released = must(await releasePurchase(db, hold.purchaseId, now));
    assert.equal(released.released, true);
    const paid = await pay(db, hold.purchaseId, now);
    assert.deepEqual(paid.effects.map((e) => e.type), ["email.purchase_receipt", "email.late_payment"]);

    const lateMails = emailsOf(await planEffect(db, effectOf(paid.effects, "email.late_payment"), depsAt(now)), pro.proId);
    assert.equal(lateMails.length, 1, `${quantity}`);
    const [mail] = lateMails;
    assert.equal(mail.to, email);
    assert.equal(mail.subject, "Paiement reçu : votre place n'était plus réservée");
    assert.ok(mail.html.includes(esc(`Paiement reçu, votre place n'était plus réservée : ${sentence}`)), sentence);
    assert.ok(
      mail.html.includes(
        esc(`La séance « Altinha du soir » (${when}) n'est pas réservée pour vous. Vous pouvez utiliser vos tickets sur une autre séance.`),
      ),
    );
    assert.ok(mail.html.includes(`href="${APP}/${pro.slug}"`), "the page of the pro");
    assert.ok(mail.html.includes(`>Voir la page de ${esc(business)}</a>`));
    assert.ok(mail.html.includes(linkOf(customerId)), "personal link");

    const [receipt] = emailsOf(await planEffect(db, effectOf(paid.effects, "email.purchase_receipt"), depsAt(now)), pro.proId);
    assert.ok(receipt.html.includes(esc(wallet)), "no ticket was spent: all of them are in the wallet");
    assert.equal(receipt.html.includes("Un des tickets a servi"), false, "no confirmed booking");
  }
});

dbTest("pro_new_booking: one e-mail to the pro's own address with the client, the coverage and the planning link; no personal link", async ({ db, pro }) => {
  const now = new Date();
  const proEmail = await userEmailOf(db, pro.userId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Roda libre", bookingMode: "free" });
  const email = testEmail("newbooking");
  const customerId = await makeCustomer(db, pro, { name: "Thomas Leroy", email });
  const reg = must(
    await registerFree(db, { professionalId: pro.proId, occurrenceId: occ.id, customerId, seenStartsAt: occ.startsAt }, now),
  );

  const mails = emailsOf(await planEffect(db, effectOf(reg.effects, "email.pro_new_booking"), depsAt(now)), pro.proId);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  const when = formatWhen(occ.startsAt, occ.endsAt, pro.tz);
  const planning = `${APP}${planningHref({ occurrenceId: occ.id, startsAt: occ.startsAt, tz: pro.tz })}`;
  assert.equal(mail.to, proEmail);
  assert.notEqual(mail.to, email, "the notice goes to the pro, not to the client");
  assert.equal(mail.subject, "Nouvelle inscription : Roda libre");
  assert.ok(mail.html.includes(esc(`Thomas Leroy (${email}) s'est inscrit(e) à « Roda libre » (${when}).`)));
  assert.ok(mail.html.includes(">Couverture</td><td style=\"text-align:right\">Inscription libre</td>"));
  assert.ok(mail.html.includes(`href="${esc(planning)}"`), "deep link to the séance in the planning");
  assert.ok(mail.html.includes(">Voir dans le planning</a>"));
  assert.equal(mail.html.includes("/api/c/"), false, "a pro notice carries no personal link");
  assert.equal(mail.subject.includes("Thomas") || mail.subject.includes(email), false, "the client is named in the body only");
});

dbTest("pro_booking_cancelled: the client cancelled; « Son ticket lui a été rendu. » only when a ticket came back; a cancellation by the pro sends no such notice", async ({ db, pro }) => {
  const now = new Date();
  const proEmail = await userEmailOf(db, pro.userId);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const { occurrences: [free] } = await makeEvent(db, pro, { title: "Roda libre", bookingMode: "free" });
  const { occurrences: [ticketed] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const email = testEmail("cancelled");
  const customerId = await makeCustomer(db, pro, { name: "Thomas Leroy", email });
  await giveTickets(db, pro, customerId, typeId, 1);
  const freeReg = must(
    await registerFree(db, { professionalId: pro.proId, occurrenceId: free.id, customerId, seenStartsAt: free.startsAt }, now),
  );
  const ticketReg = must(
    await registerPro(
      db,
      { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: ticketed.id, customerId, asGuest: false },
      now,
    ),
  );

  const freeCancel = must(await cancelByClient(db, { professionalId: pro.proId, customerId, bookingId: freeReg.bookingId, actorUserId: null }, now));
  const [freeMail] = emailsOf(await planEffect(db, effectOf(freeCancel.effects, "email.pro_booking_cancelled"), depsAt(now)), pro.proId);
  assert.equal(freeMail.to, proEmail);
  assert.equal(freeMail.subject, "Annulation : Roda libre");
  assert.ok(
    freeMail.html.includes(esc(`Thomas Leroy (${email}) a annulé son inscription à « Roda libre » (${formatWhen(free.startsAt, free.endsAt, pro.tz)}).`)),
  );
  assert.equal(freeMail.html.includes("Son ticket lui a été rendu."), false, "a free place spent no ticket");
  assert.ok(freeMail.html.includes(`href="${esc(`${APP}${planningHref({ occurrenceId: free.id, startsAt: free.startsAt, tz: pro.tz })}`)}"`));
  assert.equal(freeMail.html.includes("/api/c/"), false);

  const ticketCancel = must(await cancelByClient(db, { professionalId: pro.proId, customerId, bookingId: ticketReg.bookingId, actorUserId: null }, now));
  assert.equal(ticketCancel.ticketReturned, true);
  const [ticketMail] = emailsOf(await planEffect(db, effectOf(ticketCancel.effects, "email.pro_booking_cancelled"), depsAt(now)), pro.proId);
  assert.equal(ticketMail.subject, "Annulation : Altinha du soir");
  assert.ok(ticketMail.html.includes("Son ticket lui a été rendu."));

  // a cancellation by the pro is not « Annulation d'un client »
  const other = await makeCustomer(db, pro, { name: "Rafael Souza", email: testEmail("bypro") });
  const proReg = must(
    await registerFree(db, { professionalId: pro.proId, occurrenceId: free.id, customerId: other, seenStartsAt: free.startsAt }, now),
  );
  must(await cancelBookingsByPro(db, { professionalId: pro.proId, actorUserId: pro.userId, occurrenceId: free.id, bookingIds: [proReg.bookingId] }, now));
  assert.deepEqual(
    await planEffect(db, { type: "email.pro_booking_cancelled", bookingId: proReg.bookingId }, depsAt(now)),
    NONE,
    "ended by the pro",
  );
});

dbTest("the receipt, the late payment and the pro notices plan nothing for a purchase or a booking that is not in their state", async ({ db, pro }) => {
  const now = new Date();
  const deps = depsAt(now);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const { occurrences: [occ] } = await makeEvent(db, pro, { title: "Altinha du soir", ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: testEmail("state") });
  const hold = await holdSeat(db, pro, { occurrence: occ, customerId, offerId, holdAt: now });

  // a pending purchase with its pending booking: nothing is paid, nothing is confirmed
  const pending: Effect[] = [
    { type: "email.purchase_receipt", purchaseId: hold.purchaseId },
    { type: "email.late_payment", purchaseId: hold.purchaseId },
    { type: "email.pro_new_booking", bookingId: hold.bookingId },
    { type: "email.pro_booking_cancelled", bookingId: hold.bookingId },
  ];
  for (const effect of pending) assert.deepEqual(await planEffect(db, effect, deps), NONE, effect.type);

  // paid and confirmed: the receipt and the pro's new-booking notice exist, a late payment and a cancellation do not
  const paid = await pay(db, hold.purchaseId, now);
  assert.equal(paid.bookingConfirmed, true);
  assert.equal(emailsOf(await planEffect(db, { type: "email.purchase_receipt", purchaseId: hold.purchaseId }, deps), pro.proId).length, 1);
  assert.equal(emailsOf(await planEffect(db, { type: "email.pro_new_booking", bookingId: hold.bookingId }, deps), pro.proId).length, 1);
  assert.deepEqual(await planEffect(db, { type: "email.late_payment", purchaseId: hold.purchaseId }, deps), NONE, "the booking was confirmed: nothing was late");
  assert.deepEqual(await planEffect(db, { type: "email.pro_booking_cancelled", bookingId: hold.bookingId }, deps), NONE, "confirmed, not cancelled");

  // cancelled by the client: no longer a new booking, now a cancellation
  must(await cancelByClient(db, { professionalId: pro.proId, customerId, bookingId: hold.bookingId, actorUserId: null }, now));
  assert.deepEqual(await planEffect(db, { type: "email.pro_new_booking", bookingId: hold.bookingId }, deps), NONE, "a cancelled booking is not new");
  assert.equal(emailsOf(await planEffect(db, { type: "email.pro_booking_cancelled", bookingId: hold.bookingId }, deps), pro.proId).length, 1);
});

dbTest("S6: a purchase whose customer or type belongs to another pro plans no receipt, and a booking of another pro plans no late payment", async ({ db, pro }) => {
  const now = new Date();
  const deps = depsAt(now);
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const offerId = await makeOffer(db, pro, typeId);
  const ownEmail = testEmail("own");
  const own = await makeCustomer(db, pro, { name: "Beatriz Almeida", email: ownEmail });
  const other = await createTestPro(db);
  const purchases: string[] = [];
  const bookings: string[] = [];
  try {
    const stranger = await makeCustomer(db, other, { name: "Mallory", email: testEmail("mallory") });
    const foreignTypeId = await makeType(db, other, { name: "Type d'un autre" });
    const { occurrences: [foreignOcc] } = await makeEvent(db, other, { title: "Séance d'un autre" });
    // Built by hand on purpose: ticket_purchase.customer_id, ticket_purchase.ticket_type_id and booking.purchase_id have no
    // composite FK to the pro, so only the plans' own joins keep a foreign row out of an e-mail.
    const foreignCustomer = await rowPurchase(db, pro, { customerId: stranger, offerId, ticketTypeId: typeId, status: "paid" }, now);
    const foreignType = await rowPurchase(db, pro, { customerId: own, offerId, ticketTypeId: foreignTypeId, status: "paid" }, now);
    const crossed = await rowPurchase(db, pro, { customerId: own, offerId, ticketTypeId: typeId, status: "paid" }, now);
    purchases.push(foreignCustomer, foreignType, crossed);
    bookings.push(await rowBooking(db, other, { occurrenceId: foreignOcc.id, customerId: stranger, status: "expired", purchaseId: crossed }, now));

    for (const purchaseId of [foreignCustomer, foreignType]) {
      assert.deepEqual(await planEffect(db, { type: "email.purchase_receipt", purchaseId }, deps), NONE, purchaseId);
      assert.deepEqual(await planEffect(db, { type: "email.late_payment", purchaseId }, deps), NONE, purchaseId);
    }
    // the control: the same purchase, own customer and own type, still gets its receipt; its crossed booking gets no late payment
    const [receipt] = emailsOf(await planEffect(db, { type: "email.purchase_receipt", purchaseId: crossed }, deps), pro.proId);
    assert.equal(receipt.to, ownEmail);
    assert.equal(receipt.html.includes("Mallory"), false);
    assert.deepEqual(await planEffect(db, { type: "email.late_payment", purchaseId: crossed }, deps), NONE, "the booking belongs to another pro");
  } finally {
    // The hand-built rows go first: the foreign keys inside the domain are NO ACTION.
    if (bookings.length > 0) await db.delete(booking).where(inArray(booking.id, bookings));
    if (purchases.length > 0) await db.delete(ticketPurchase).where(inArray(ticketPurchase.id, purchases));
    await deleteTestUser(db, other.userId);
  }
});
