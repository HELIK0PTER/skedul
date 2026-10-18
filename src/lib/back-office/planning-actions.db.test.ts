import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";

import { expiryLabel, formatWhenShort } from "@/lib/back-office/format";
import type { ProCtx } from "@/lib/back-office/result";
import { registerPro } from "@/lib/booking/claims";
import { checkInvariants } from "@/lib/booking/invariants";
import { createEvent } from "@/lib/booking/occurrences";
import { dayOfWeek, instantAt } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { bookingAnswer, customer, event, question, ticketMovement, ticketType } from "@/lib/db/schema";
import type { RecurrenceRule } from "@/lib/recurrence";
import { addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "@/test/db";
import {
  dayIn,
  getBooking,
  getOccurrence,
  giveTickets,
  makeCustomer,
  makeEvent,
  makeType,
  movementsOf,
  occurrencesOf,
  ticketsOf,
} from "@/test/fixtures";
import { proCtx } from "@/test/pro-ctx";
import { rowBooking, rowEvent, rowRdv, rowRdvType, rowSeance } from "@/test/rows";

import {
  FOLLOWING_DETACHED,
  FOLLOWING_TIME_DETACHED,
  TIME_PARTS_REQUIRED,
  applyFollowingCore,
  cancelOccurrenceCore,
  expiringBeforeCore,
  followingRuleOf,
  previewFollowingCore,
  restoreOccurrenceCore,
  unenrollCore,
  updateCapacityCore,
  updateOccurrenceCore,
  CONVERSION_TYPE_UNAVAILABLE,
  MOVE_NOT_MOVABLE,
  MOVE_TARGET_UNAVAILABLE,
  REGISTER_NONE_GUEST,
  REGISTER_NO_TICKET_MODE,
  REGISTER_RDV,
  moveAttendeeCore,
  moveTargetsCore,
  registerAttendeeCore,
  registerOptionsCore,
  searchCustomersCore,
  type RegisterInput,
} from "./planning-actions";

const DAY = 86_400_000;

/** A weekly rule on the weekday of dayIn(pro, 3), `count` séances. */
const weekly = (pro: TestPro, count: number) => ({
  startDate: dayIn(pro, 3),
  freq: "weekly" as const,
  interval: 1,
  weekdays: [dayOfWeek(dayIn(pro, 3))],
  endMode: "count" as const,
  occurrenceCount: count,
});

/** registerPro as the pro, without ticket by default (a guest keeps the fixtures short). Returns the booking id. */
async function register(
  db: Db,
  pro: TestPro,
  occurrenceId: string,
  customerId: string,
  over: { asGuest?: boolean } = {},
): Promise<string> {
  const res = await registerPro(db, {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    occurrenceId,
    customerId,
    asGuest: over.asGuest ?? true,
  });
  assert.ok(res.ok, JSON.stringify(res));
  return res.bookingId;
}

function check(name: string, res: { ok: boolean; error?: string }, error: string): void {
  assert.equal(res.ok, false, `${name}: ${JSON.stringify(res)}`);
  assert.equal(res.error, error, name);
}

dbTest("updateOccurrenceCore: date + startMinute land on instantAt(date, minute, pro tz), Paris and Los Angeles", async ({ db, pro }) => {
  const now = new Date();
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const target = dayIn(pro, 5);
  const res = await updateOccurrenceCore(
    db,
    proCtx(pro),
    { occurrenceId: occ.id, seenStartsAt: occ.startsAt.toISOString(), date: target, startMinute: 1140, durationMin: 90 },
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.timeChanged, true);
  assert.deepEqual(res.effects, [{ type: "google.sync_occurrence", occurrenceId: occ.id }]);
  const row = await getOccurrence(db, occ.id);
  assert.equal(row.startsAt.toISOString(), instantAt(target, 1140, "Europe/Paris").toISOString());
  assert.equal(row.endsAt.getTime() - row.startsAt.getTime(), 90 * 60_000);
  assert.equal(row.timeDetached, true);

  const la = await createTestPro(db, { tz: "America/Los_Angeles" });
  try {
    const {
      occurrences: [laOcc],
    } = await makeEvent(db, la);
    const laTarget = dayIn(la, 6);
    const laRes = await updateOccurrenceCore(
      db,
      proCtx(la),
      { occurrenceId: laOcc.id, seenStartsAt: laOcc.startsAt.toISOString(), date: laTarget, startMinute: 600 },
      now,
    );
    assert.ok(laRes.ok, JSON.stringify(laRes));
    const laRow = await getOccurrence(db, laOcc.id);
    assert.equal(laRow.startsAt.toISOString(), instantAt(laTarget, 600, "America/Los_Angeles").toISOString());
    assert.notEqual(
      laRow.startsAt.toISOString(),
      instantAt(laTarget, 600, "Europe/Paris").toISOString(),
      "the wall time is read in the pro zone, not in Paris or the host zone",
    );
    assert.deepEqual(await checkInvariants(db, { proId: la.proId }), []);
  } finally {
    await deleteTestUser(db, la.userId);
  }
});

dbTest("updateOccurrenceCore: TIME_PARTS_REQUIRED, French validation, a place-only edit passes the effects through", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const customerId = await makeCustomer(db, pro);
  const bookingId = await register(db, pro, occ.id, customerId);
  const base = { occurrenceId: occ.id, seenStartsAt: occ.startsAt.toISOString() };

  assert.equal(TIME_PARTS_REQUIRED, "Indiquez la date et l'heure.");
  check("date only", await updateOccurrenceCore(db, ctx, { ...base, date: dayIn(pro, 5) }, now), TIME_PARTS_REQUIRED);
  check("minute only", await updateOccurrenceCore(db, ctx, { ...base, startMinute: 600 }, now), TIME_PARTS_REQUIRED);

  const badSeen = await updateOccurrenceCore(db, ctx, { ...base, seenStartsAt: "hier", durationMin: 30 }, now);
  assert.ok(!badSeen.ok);
  assert.match(badSeen.error, /date et heure invalides/i);
  const badDuration = await updateOccurrenceCore(db, ctx, { ...base, durationMin: 7 }, now);
  assert.ok(!badDuration.ok);
  assert.match(badDuration.error, /multiple de 5/);
  check("nothing to change", await updateOccurrenceCore(db, ctx, base, now), "Rien à modifier.");

  const place = await updateOccurrenceCore(db, ctx, { ...base, locationOverride: "  Studio B  " }, now);
  assert.ok(place.ok, JSON.stringify(place));
  assert.equal(place.timeChanged, false);
  assert.deepEqual(place.effects, [
    { type: "email.occurrence_changed", occurrenceId: occ.id, bookingIds: [bookingId] },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);
  assert.equal((await getOccurrence(db, occ.id)).locationOverride, "Studio B");
});

dbTest("updateOccurrenceCore: a started séance refuses a time change but still takes its place", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const started = addMinutes(occ.startsAt, 5);
  const input = { occurrenceId: occ.id, seenStartsAt: occ.startsAt.toISOString() };

  const refused = await updateOccurrenceCore(db, ctx, { ...input, date: dayIn(pro, 9), startMinute: 600 }, started);
  assert.ok(!refused.ok);
  assert.equal(refused.error, "Une séance concernée a déjà commencé.");
  assert.equal(refused.code, "invalid");

  const place = await updateOccurrenceCore(db, ctx, { ...input, locationOverride: "Studio B" }, started);
  assert.ok(place.ok, JSON.stringify(place));
  assert.equal(place.timeChanged, false);
  assert.equal((await getOccurrence(db, occ.id)).locationOverride, "Studio B");
  const cleared = await updateOccurrenceCore(db, ctx, { ...input, locationOverride: null }, started);
  assert.ok(cleared.ok, JSON.stringify(cleared));
  assert.equal((await getOccurrence(db, occ.id)).locationOverride, null);
});

dbTest("updateOccurrenceCore: an old seenStartsAt is refused with the stale-séance wording and writes nothing", async ({ db, pro }) => {
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const res = await updateOccurrenceCore(
    db,
    proCtx(pro),
    { occurrenceId: occ.id, seenStartsAt: addMinutes(occ.startsAt, -30).toISOString(), durationMin: 45 },
    new Date(),
  );
  assert.ok(!res.ok);
  assert.equal(res.error, "La séance a changé entre-temps : rafraîchissez la page.");
  assert.equal(res.code, "changed");
  const row = await getOccurrence(db, occ.id);
  assert.equal(row.endsAt.getTime() - row.startsAt.getTime(), 60 * 60_000);
});

dbTest("updateOccurrenceCore: unenrollBookingIds are cancelled with the move, the others are told", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const a = await makeCustomer(db, pro);
  const b = await makeCustomer(db, pro);
  const bookA = await register(db, pro, occ.id, a);
  const bookB = await register(db, pro, occ.id, b);

  const res = await updateOccurrenceCore(
    db,
    ctx,
    {
      occurrenceId: occ.id,
      seenStartsAt: occ.startsAt.toISOString(),
      date: dayIn(pro, 5),
      startMinute: 1020,
      unenrollBookingIds: [bookA],
    },
    now,
  );
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(res.effects, [
    { type: "email.booking_cancelled", bookingId: bookA, by: "pro" },
    { type: "email.occurrence_changed", occurrenceId: occ.id, bookingIds: [bookB] },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);
  assert.equal((await getBooking(db, bookA)).status, "cancelled");
  assert.equal((await getBooking(db, bookB)).status, "confirmed");
  const moved = await getOccurrence(db, occ.id);
  assert.equal(moved.seatsTaken, 1);

  // An id that belongs to another séance is refused as a whole.
  const {
    occurrences: [elsewhere],
  } = await makeEvent(db, pro);
  const bookC = await register(db, pro, elsewhere.id, await makeCustomer(db, pro));
  const bad = await updateOccurrenceCore(
    db,
    ctx,
    { occurrenceId: occ.id, seenStartsAt: moved.startsAt.toISOString(), durationMin: 30, unenrollBookingIds: [bookC] },
    now,
  );
  check("foreign booking id", bad, "Modification invalide.");
  assert.equal((await getBooking(db, bookC)).status, "confirmed");
});

dbTest("updateCapacityCore: « Cette séance » vs « Toutes les séances à venir »", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: weekly(pro, 3) });
  assert.equal(occurrences.length, 3);
  const [first, second, third] = occurrences;
  const snapshot = async () =>
    (await Promise.all(occurrences.map((o) => getOccurrence(db, o.id)))).map((o) => [o.capacity, o.capacityOverride]);

  const one = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: first.id, seenStartsAt: first.startsAt.toISOString(), scope: "occurrence", capacity: 20, seenVersion: null },
    now,
  );
  assert.ok(one.ok, JSON.stringify(one));
  assert.deepEqual(one.effects, [{ type: "google.sync_occurrence", occurrenceId: first.id }]);
  assert.deepEqual(await snapshot(), [[20, true], [12, false], [12, false]]);

  // Event scope: the séance whose capacity was changed by hand keeps it.
  const all = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: second.id, seenStartsAt: second.startsAt.toISOString(), scope: "event", capacity: 8, seenVersion: 1 },
    now,
  );
  assert.ok(all.ok, JSON.stringify(all));
  assert.deepEqual(all.effects, []);
  assert.deepEqual(await snapshot(), [[20, true], [8, false], [8, false]]);
  const [ev] = await db.select({ version: event.version, capacity: event.capacity }).from(event).where(eq(event.id, eventId));
  assert.deepEqual(ev, { version: 2, capacity: 8 });

  // A second event-scope action with the fresh version works; the old version is stale.
  const again = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: second.id, seenStartsAt: second.startsAt.toISOString(), scope: "event", capacity: 9, seenVersion: 2 },
    now,
  );
  assert.ok(again.ok, JSON.stringify(again));
  const stale = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: second.id, seenStartsAt: second.startsAt.toISOString(), scope: "event", capacity: 10, seenVersion: 2 },
    now,
  );
  assert.ok(!stale.ok);
  assert.equal(stale.error, "Les données ont changé entre-temps : rafraîchissez la page.");
  assert.equal(stale.code, "stale");
  const noVersion = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: second.id, seenStartsAt: second.startsAt.toISOString(), scope: "event", capacity: 10, seenVersion: null },
    now,
  );
  assert.ok(!noVersion.ok);
  assert.equal(noVersion.error, "Les données ont changé entre-temps : rafraîchissez la page.");
  assert.deepEqual(await snapshot(), [[20, true], [9, false], [9, false]]);

  // The capacity never drops under the seats already taken.
  await register(db, pro, third.id, await makeCustomer(db, pro));
  await register(db, pro, third.id, await makeCustomer(db, pro));
  const low = await updateCapacityCore(
    db,
    ctx,
    { occurrenceId: third.id, seenStartsAt: third.startsAt.toISOString(), scope: "occurrence", capacity: 1, seenVersion: null },
    now,
  );
  assert.ok(low.ok, JSON.stringify(low));
  assert.equal((await getOccurrence(db, third.id)).capacity, 2);
});

dbTest("cancelOccurrenceCore: séance and bookings cancelled, one occurrence_cancelled effect, tickets returned", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const a = await makeCustomer(db, pro);
  const b = await makeCustomer(db, pro);
  await giveTickets(db, pro, a, typeId, 1);
  const bookA = await register(db, pro, occ.id, a, { asGuest: false });
  const bookB = await register(db, pro, occ.id, b);

  const res = await cancelOccurrenceCore(db, ctx, { occurrenceId: occ.id }, now);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual([res.bookingsCancelled, res.ticketsReturned], [2, 1]);
  const mail = res.effects.find((e) => e.type === "email.occurrence_cancelled");
  assert.ok(mail && mail.type === "email.occurrence_cancelled");
  assert.equal(mail.occurrenceId, occ.id);
  assert.deepEqual([...mail.bookingIds].sort(), [bookA, bookB].sort());
  assert.ok(res.effects.some((e) => e.type === "google.sync_occurrence" && e.occurrenceId === occ.id));
  const row = await getOccurrence(db, occ.id);
  assert.deepEqual([row.status, row.seatsTaken], ["cancelled", 0]);
  assert.equal((await ticketsOf(db, a))[0].status, "available");

  const again = await cancelOccurrenceCore(db, ctx, { occurrenceId: occ.id }, now);
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.bookingsCancelled, 0, "cancelling twice is a success with nothing to do");
});

dbTest("restoreOccurrenceCore: a future séance is restored; a past one, an RDV and an ended series are refused", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const cancelled = await cancelOccurrenceCore(db, ctx, { occurrenceId: occ.id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));

  const restored = await restoreOccurrenceCore(db, ctx, { occurrenceId: occ.id }, now);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.deepEqual(restored.effects, []);
  const row = await getOccurrence(db, occ.id);
  assert.deepEqual([row.status, row.cancelledAt], ["scheduled", null]);
  const idempotent = await restoreOccurrenceCore(db, ctx, { occurrenceId: occ.id }, now);
  assert.ok(idempotent.ok, JSON.stringify(idempotent));

  const futureOnly = "Seule une séance future d'un événement peut être rétablie.";
  const pastEvent = await rowEvent(db, pro);
  const past = await rowSeance(db, pro, pastEvent, { status: "cancelled", startsAt: new Date(now.getTime() - 2 * DAY) });
  const pastRes = await restoreOccurrenceCore(db, ctx, { occurrenceId: past }, now);
  check("past", pastRes, futureOnly);
  assert.equal((pastRes as { code?: string }).code, "not_found");

  const rdvType = await rowRdvType(db, pro);
  const rdv = await rowRdv(db, pro, rdvType, { status: "cancelled", seatsTaken: 0 });
  check("RDV", await restoreOccurrenceCore(db, ctx, { occurrenceId: rdv }, now), futureOnly);

  const archived = await rowEvent(db, pro, { archivedAt: now });
  const ended = await rowSeance(db, pro, archived, { status: "cancelled" });
  const endedRes = await restoreOccurrenceCore(db, ctx, { occurrenceId: ended }, now);
  check("ended series", endedRes, "Cette série est terminée : recréez la séance si besoin.");
  assert.equal((endedRes as { code?: string }).code, "invalid");
});

dbTest("unenrollCore: two bookings cancelled with their counts, the ticket returned, a past séance too", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const a = await makeCustomer(db, pro);
  await giveTickets(db, pro, a, typeId, 1);
  const bookA = await register(db, pro, occ.id, a, { asGuest: false });
  const bookB = await register(db, pro, occ.id, await makeCustomer(db, pro));
  const bookC = await register(db, pro, occ.id, await makeCustomer(db, pro));

  const res = await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: [bookA, bookB], reason: "Erreur de saisie" }, now);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual([res.cancelled, res.ticketsReturned], [2, 1]);
  const mailed = res.effects.flatMap((e) => (e.type === "email.booking_cancelled" && e.by === "pro" ? [e.bookingId] : []));
  assert.deepEqual(mailed.sort(), [bookA, bookB].sort());
  assert.ok(res.effects.some((e) => e.type === "google.sync_occurrence" && e.occurrenceId === occ.id));
  const cancelledA = await getBooking(db, bookA);
  assert.deepEqual([cancelledA.status, cancelledA.cancelReason, cancelledA.endedBy], ["cancelled", "Erreur de saisie", "pro"]);
  assert.equal((await getBooking(db, bookC)).status, "confirmed");
  assert.equal((await ticketsOf(db, a))[0].status, "available");
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 1);

  // Errors, in French.
  const empty = await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: [], reason: null }, now);
  assert.ok(!empty.ok);
  assert.match(empty.error, /choisissez au moins un élément/i);
  const longReason = await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: [bookC], reason: "x".repeat(501) }, now);
  assert.ok(!longReason.ok);
  assert.match(longReason.error, /500 caractères/);
  const twice = await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: [bookA], reason: null }, now);
  check("already ended", twice, "Une de ces inscriptions est déjà terminée : rafraîchissez la page.");
  assert.equal((twice as { code?: string }).code, "stale");
  check("unknown booking", await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: ["inconnu"], reason: null }, now), "Inscription introuvable sur cette séance.");

  // A séance already over can still be corrected.
  const late = await unenrollCore(db, ctx, { occurrenceId: occ.id, bookingIds: [bookC], reason: "" }, addMinutes(occ.endsAt, 3 * 24 * 60));
  assert.ok(late.ok, JSON.stringify(late));
  assert.deepEqual([late.cancelled, late.ticketsReturned], [1, 0]);
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 0);
});

dbTest("previewFollowingCore / applyFollowingCore: this séance and the later ones move to the new minute, earlier ones stay", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: weekly(pro, 4) });
  assert.equal(occurrences.length, 4);
  const [first, second, third] = occurrences;
  const bookId = await register(db, pro, third.id, await makeCustomer(db, pro));

  const preview = await previewFollowingCore(db, ctx, { occurrenceId: second.id, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(preview.ok, JSON.stringify(preview));
  assert.equal(preview.fromDate, second.seriesDate);
  assert.equal(preview.text, "3 séances modifiées, 1 inscrit prévenu");

  const applied = await applyFollowingCore(db, ctx, { occurrenceId: second.id, seenVersion: 1, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(applied.ok, JSON.stringify(applied));
  assert.equal(applied.summaryText, "3 séances modifiées, 1 inscrit prévenu");
  assert.notEqual(applied.eventId, eventId, "earlier séances exist: the series is split and the later part is a new segment");
  assert.ok(
    applied.effects.some(
      (e) => e.type === "email.occurrence_changed" && e.occurrenceId === third.id && e.bookingIds.includes(bookId),
    ),
  );
  const rows = await Promise.all(occurrences.map((o) => getOccurrence(db, o.id)));
  assert.equal(rows[0].startsAt.getTime(), first.startsAt.getTime(), "the earlier séance is untouched");
  assert.equal(rows[0].endsAt.getTime() - rows[0].startsAt.getTime(), 60 * 60_000);
  for (const r of rows.slice(1)) {
    assert.equal(r.startsAt.toISOString(), instantAt(String(r.seriesDate), 1080, pro.tz).toISOString());
    assert.equal(r.endsAt.getTime() - r.startsAt.getTime(), 90 * 60_000);
    assert.equal(r.eventId, applied.eventId);
  }

  // Nothing left to change; then a second action on the same séance, with the new segment's fresh version.
  const same = await previewFollowingCore(db, ctx, { occurrenceId: second.id, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(same.ok, JSON.stringify(same));
  assert.equal(same.text, "Aucun changement sur les séances");
  const again = await applyFollowingCore(db, ctx, { occurrenceId: second.id, seenVersion: 1, startMinute: 1140, durationMin: 90 }, now);
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.eventId, applied.eventId, "no earlier séance in this segment: applied in place");
  const stale = await applyFollowingCore(db, ctx, { occurrenceId: second.id, seenVersion: 7, startMinute: 1200, durationMin: 90 }, now);
  assert.ok(!stale.ok);
  assert.equal(stale.code, "stale");
  assert.equal(stale.error, "Les données ont changé entre-temps : rafraîchissez la page.");
});

/* ───────────────────────── Attendees: register and move ───────────────────────── */

function reg(occurrenceId: string, customerId: string, over: Partial<RegisterInput> = {}): RegisterInput {
  return {
    occurrenceId,
    customer: { kind: "existing", customerId },
    coverage: "auto",
    ticketId: null,
    extraSeat: false,
    answers: [],
    ...over,
  };
}

function move(
  bookingId: string,
  targetOccurrenceId: string,
  over: { force?: boolean; convertToTicketTypeId?: string | null } = {},
) {
  return {
    bookingId,
    targetOccurrenceId,
    force: over.force ?? false,
    convertToTicketTypeId: over.convertToTicketTypeId ?? null,
  };
}

const codeOf = (res: { ok: boolean }): string | undefined => (res as { code?: string }).code;

dbTest("registerAttendeeCore: « auto » spends the ticket that expires first, a chosen ticket, a guest", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro, { name: "Cours collectif" });
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId], capacity: 5 });
  const thomas = await makeCustomer(db, pro, { name: "Thomas Leroy" });
  const marina = await makeCustomer(db, pro, { name: "Marina Costa" });
  const lea = await makeCustomer(db, pro, { name: "Léa Martin" });
  const expiresAt = instantAt(dayIn(pro, 30), 0, pro.tz);
  const [foreverT] = await giveTickets(db, pro, thomas, typeId, 1);
  const [soonT] = await giveTickets(db, pro, thomas, typeId, 1, { expiresAt });
  const [foreverM] = await giveTickets(db, pro, marina, typeId, 1);
  const [soonM] = await giveTickets(db, pro, marina, typeId, 1, { expiresAt });
  await giveTickets(db, pro, lea, typeId, 1);

  const auto = await registerAttendeeCore(db, ctx, reg(occ.id, thomas), now);
  assert.ok(auto.ok, JSON.stringify(auto));
  assert.deepEqual([auto.coverage, auto.customerId, auto.customerCreated], ["ticket", thomas, false]);
  const thomasTickets = await ticketsOf(db, thomas);
  assert.deepEqual(
    thomasTickets.filter((t) => t.status === "booked").map((t) => [t.id, t.bookingId]),
    [[soonT, auto.bookingId]],
  );
  assert.equal(thomasTickets.find((t) => t.id === foreverT)?.status, "available");
  assert.deepEqual(auto.effects, [
    { type: "email.booking_confirmed", bookingId: auto.bookingId },
    { type: "google.sync_occurrence", occurrenceId: occ.id },
  ]);
  const row = await getBooking(db, auto.bookingId);
  assert.deepEqual([row.createdBy, row.status, row.coverage], ["pro", "confirmed", "ticket"]);

  // A chosen ticket wins over the consumption order (« auto » would have taken the expiring one).
  const chosen = await registerAttendeeCore(db, ctx, reg(occ.id, marina, { ticketId: foreverM }), now);
  assert.ok(chosen.ok, JSON.stringify(chosen));
  const marinaTickets = await ticketsOf(db, marina);
  assert.deepEqual(marinaTickets.filter((t) => t.status === "booked").map((t) => t.id), [foreverM]);
  assert.equal(marinaTickets.find((t) => t.id === soonM)?.status, "available");

  // « Invité »: no ticket is spent.
  const guest = await registerAttendeeCore(db, ctx, reg(occ.id, lea, { coverage: "guest" }), now);
  assert.ok(guest.ok, JSON.stringify(guest));
  assert.equal(guest.coverage, "guest");
  assert.equal((await ticketsOf(db, lea))[0].status, "available");
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 3);
});

dbTest("registerAttendeeCore: refusals by mode, séance and ticket, in French", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const otherType = await makeType(db, pro);
  const {
    occurrences: [none],
  } = await makeEvent(db, pro, { bookingMode: "none" });
  const {
    occurrences: [free],
  } = await makeEvent(db, pro, { bookingMode: "free" });
  const {
    occurrences: [paid],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const {
    occurrences: [toCancel],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const {
    occurrences: [open],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeId, 1);
  const [foreign] = await giveTickets(db, pro, customerId, otherType, 1);

  assert.equal(REGISTER_RDV, "Un rendez-vous ne s'inscrit pas depuis le planning.");
  assert.equal(REGISTER_NONE_GUEST, "Séance sans réservation en ligne : inscrivez ce client comme invité.");
  assert.equal(REGISTER_NO_TICKET_MODE, "Cette séance n'accepte pas de ticket : choisissez « Invité ».");

  check("none + auto", await registerAttendeeCore(db, ctx, reg(none.id, customerId), now), REGISTER_NONE_GUEST);
  check("none + auto + ticket", await registerAttendeeCore(db, ctx, reg(none.id, customerId, { ticketId }), now), REGISTER_NONE_GUEST);
  check("free + ticket", await registerAttendeeCore(db, ctx, reg(free.id, customerId, { ticketId }), now), REGISTER_NO_TICKET_MODE);
  check(
    "guest + ticket",
    await registerAttendeeCore(db, ctx, reg(paid.id, customerId, { coverage: "guest", ticketId }), now),
    REGISTER_NO_TICKET_MODE,
  );
  assert.deepEqual(
    (await Promise.all([none, free, paid].map((o) => getOccurrence(db, o.id)))).map((o) => o.seatsTaken),
    [0, 0, 0],
    "the refusals wrote nothing",
  );

  const guestOnNone = await registerAttendeeCore(db, ctx, reg(none.id, customerId, { coverage: "guest" }), now);
  assert.ok(guestOnNone.ok, JSON.stringify(guestOnNone));
  assert.equal(guestOnNone.coverage, "guest");
  const onFree = await registerAttendeeCore(db, ctx, reg(free.id, customerId), now);
  assert.ok(onFree.ok, JSON.stringify(onFree));
  assert.equal(onFree.coverage, "free");

  const rdvType = await rowRdvType(db, pro);
  const rdvId = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 5), 840, pro.tz) });
  await rowBooking(db, pro, { occurrenceId: rdvId, customerId: await makeCustomer(db, pro) });
  check("RDV", await registerAttendeeCore(db, ctx, reg(rdvId, customerId), now), REGISTER_RDV);

  const cancelled = await cancelOccurrenceCore(db, ctx, { occurrenceId: toCancel.id }, now);
  assert.ok(cancelled.ok, JSON.stringify(cancelled));
  const onCancelled = await registerAttendeeCore(db, ctx, reg(toCancel.id, customerId), now);
  check("cancelled", onCancelled, "Cette séance est annulée : rétablissez-la pour inscrire quelqu'un.");
  assert.equal(codeOf(onCancelled), "unavailable");
  check("unknown séance", await registerAttendeeCore(db, ctx, reg("inconnu", customerId), now), "Séance introuvable.");

  const noTicket = await registerAttendeeCore(db, ctx, reg(open.id, await makeCustomer(db, pro)), now);
  check(
    "no usable ticket",
    noTicket,
    "Ce client n'a aucun ticket utilisable ici : inscrivez-le comme invité, ou offrez-lui un ticket depuis sa fiche.",
  );
  assert.equal(codeOf(noTicket), "no_ticket");
  const notAccepted = await registerAttendeeCore(db, ctx, reg(open.id, customerId, { ticketId: foreign }), now);
  check("ticket of another type", notAccepted, "Ce ticket n'est pas utilisable sur cette séance.");
  assert.equal(codeOf(notAccepted), "not_eligible");
  assert.equal((await getOccurrence(db, open.id)).seatsTaken, 0);
});

dbTest("registerAttendeeCore: twice, full, and « +1 place »", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const {
    occurrences: [small],
  } = await makeEvent(db, pro, { bookingMode: "free", capacity: 1 });
  const a = await makeCustomer(db, pro);
  const b = await makeCustomer(db, pro);

  const first = await registerAttendeeCore(db, ctx, reg(small.id, a), now);
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.coverage, "free");
  const twice = await registerAttendeeCore(db, ctx, reg(small.id, a), now);
  check("twice", twice, "Ce client est déjà inscrit à cette séance.");
  assert.equal(codeOf(twice), "already_booked");
  const full = await registerAttendeeCore(db, ctx, reg(small.id, b), now);
  check("full", full, "Complet : cochez « +1 place » pour l'inscrire quand même.");
  assert.equal(codeOf(full), "full");
  check(
    "twice with +1",
    await registerAttendeeCore(db, ctx, reg(small.id, a, { extraSeat: true }), now),
    "Ce client est déjà inscrit à cette séance.",
  );
  assert.equal((await getOccurrence(db, small.id)).capacity, 1, "« +1 place » is not applied to a client already registered");

  const extra = await registerAttendeeCore(db, ctx, reg(small.id, b, { extraSeat: true }), now);
  assert.ok(extra.ok, JSON.stringify(extra));
  const row = await getOccurrence(db, small.id);
  assert.deepEqual([row.capacity, row.seatsTaken, row.capacityOverride], [2, 2, true]);
});

dbTest("registerAttendeeCore: a new client is created, an existing e-mail is reused, bad details are refused", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { occurrences } = await makeEvent(db, pro, { bookingMode: "free", rule: weekly(pro, 2) });
  const [first, second] = occurrences;
  const fresh = (occurrenceId: string, name: string, email: string, phone: string | null = null): RegisterInput =>
    reg(occurrenceId, "", { customer: { kind: "new", name, email, phone }, coverage: "guest" });
  const customerCount = async () =>
    (await db.select({ id: customer.id }).from(customer).where(eq(customer.professionalId, pro.proId))).length;

  const created = await registerAttendeeCore(db, ctx, fresh(first.id, "  Léa Martin ", " Lea.Martin@Example.com ", "06 12 34 56 78"), now);
  assert.ok(created.ok, JSON.stringify(created));
  assert.equal(created.customerCreated, true);
  assert.equal(created.coverage, "guest");
  assert.deepEqual(created.effects, [
    { type: "email.booking_confirmed", bookingId: created.bookingId },
    { type: "google.sync_occurrence", occurrenceId: first.id },
  ]);
  const [row] = await db.select().from(customer).where(eq(customer.id, created.customerId));
  assert.deepEqual([row.professionalId, row.name, row.email, row.phone], [pro.proId, "Léa Martin", "lea.martin@example.com", "06 12 34 56 78"]);

  const reused = await registerAttendeeCore(db, ctx, fresh(second.id, "Léa Martin", "LEA.MARTIN@example.com"), now);
  assert.ok(reused.ok, JSON.stringify(reused));
  assert.equal(reused.customerCreated, false);
  assert.equal(reused.customerId, created.customerId);
  assert.equal(await customerCount(), 1);

  const badMail = await registerAttendeeCore(db, ctx, fresh(second.id, "Paul", "pas-un-email"), now);
  assert.ok(!badMail.ok);
  assert.match(badMail.error, /adresse email invalide/i);
  const noName = await registerAttendeeCore(db, ctx, fresh(second.id, "   ", "paul@example.com"), now);
  assert.ok(!noName.ok);
  assert.match(noName.error, /ce champ est obligatoire/i);
  assert.equal(await customerCount(), 1, "a refused form creates nothing");
});

dbTest("moveAttendeeCore: to a target that accepts the ticket, with the move effects, twice in a row", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const src = await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX] });
  const tgt = await makeEvent(db, pro, { title: "Cible", ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, 4) } });
  const [from] = src.occurrences;
  const [to] = tgt.occurrences;
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeX, 1);
  const bookingId = await register(db, pro, from.id, customerId, { asGuest: false });

  const res = await moveAttendeeCore(db, ctx, move(bookingId, to.id), now);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.converted, false);
  assert.deepEqual(res.effects, [
    { type: "email.attendee_moved", bookingId, fromOccurrenceId: from.id },
    { type: "google.sync_occurrence", occurrenceId: from.id },
    { type: "google.sync_occurrence", occurrenceId: to.id },
  ]);
  const moved = await getBooking(db, bookingId);
  assert.equal(moved.occurrenceId, to.id);
  assert.notEqual(moved.movedAt, null);
  assert.deepEqual([(await getOccurrence(db, from.id)).seatsTaken, (await getOccurrence(db, to.id)).seatsTaken], [0, 1]);
  const [spent] = await ticketsOf(db, customerId);
  assert.deepEqual([spent.id, spent.status, spent.bookingId], [ticketId, "booked", bookingId]);

  const back = await moveAttendeeCore(db, ctx, move(bookingId, from.id), now);
  assert.ok(back.ok, JSON.stringify(back));
  assert.equal((await getBooking(db, bookingId)).occurrenceId, from.id);
});

dbTest("moveAttendeeCore: a target that does not accept the ticket needs a conversion to an active, non rdv_free type", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const typeY = await makeType(db, pro, { name: "Cours d'essai" });
  const typeFree = await makeType(db, pro, { name: "Appel découverte", rdvEnabled: true, rdvFree: true, rdvDurationMin: 30 });
  const typeOld = await makeType(db, pro, { name: "Stage d'été" });
  await db.update(ticketType).set({ archivedAt: new Date() }).where(eq(ticketType.id, typeOld));
  const src = await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX] });
  const tgt = await makeEvent(db, pro, { title: "Cible Y", ticketTypeIds: [typeY], rule: { startDate: dayIn(pro, 4) } });
  const [from] = src.occurrences;
  const [to] = tgt.occurrences;
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeX, 1);
  const bookingId = await register(db, pro, from.id, customerId, { asGuest: false });

  const notAccepted = await moveAttendeeCore(db, ctx, move(bookingId, to.id), now);
  check(
    "not accepted",
    notAccepted,
    "Cette séance n'accepte pas le ticket de ce client : choisissez un type vers lequel le convertir.",
  );
  assert.equal(codeOf(notAccepted), "not_eligible");

  assert.equal(CONVERSION_TYPE_UNAVAILABLE, "Ce type ne peut pas recevoir de tickets.");
  for (const [name, type] of [
    ["rdv_free", typeFree],
    ["archived", typeOld],
    ["unknown", "inconnu"],
  ] as const) {
    check(name, await moveAttendeeCore(db, ctx, move(bookingId, to.id, { convertToTicketTypeId: type }), now), CONVERSION_TYPE_UNAVAILABLE);
  }
  check(
    "same type",
    await moveAttendeeCore(db, ctx, move(bookingId, to.id, { convertToTicketTypeId: typeX }), now),
    "Choisissez un autre type de ticket.",
  );
  assert.equal((await getBooking(db, bookingId)).occurrenceId, from.id, "nothing moved");

  const converted = await moveAttendeeCore(db, ctx, move(bookingId, to.id, { convertToTicketTypeId: typeY }), now);
  assert.ok(converted.ok, JSON.stringify(converted));
  assert.equal(converted.converted, true);
  const [after] = await ticketsOf(db, customerId);
  assert.deepEqual([after.ticketTypeId, after.status, after.bookingId], [typeY, "booked", bookingId]);
  const kinds = (await movementsOf(db, ticketId)).map((m) => m.kind);
  assert.equal(kinds[kinds.length - 1], "convert");
});

dbTest("moveAttendeeCore: an expiring ticket asks to force; booked, full, cancelled and unknown refusals", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const mk = (title: string, day: number, over: { capacity?: number } = {}) =>
    makeEvent(db, pro, { title, ticketTypeIds: [typeX], ...over, rule: { startDate: dayIn(pro, day) } });
  const [s] = (await mk("Source", 3)).occurrences;
  const [t4] = (await mk("Jour 4", 4, { capacity: 1 })).occurrences;
  const [t6] = (await mk("Jour 6", 6)).occurrences;

  // An expiring ticket: the move beyond its validity asks for confirmation, then goes through with force.
  const expiring = await makeCustomer(db, pro);
  await giveTickets(db, pro, expiring, typeX, 1, { expiresAt: instantAt(dayIn(pro, 5), 0, pro.tz) });
  const bookExpiring = await register(db, pro, s.id, expiring, { asGuest: false });
  const refused = await moveAttendeeCore(db, ctx, move(bookExpiring, t6.id), now);
  check("expiry", refused, "Ticket expiré à la date de cette séance : déplacer quand même ?");
  assert.equal(codeOf(refused), "ticket_expires_before");
  assert.equal((await getBooking(db, bookExpiring)).occurrenceId, s.id);
  const forced = await moveAttendeeCore(db, ctx, move(bookExpiring, t6.id, { force: true }), now);
  assert.ok(forced.ok, JSON.stringify(forced));
  assert.equal((await getBooking(db, bookExpiring)).occurrenceId, t6.id);

  // Already on the target / target full.
  const twice = await makeCustomer(db, pro);
  await giveTickets(db, pro, twice, typeX, 2);
  const bookTwiceSource = await register(db, pro, s.id, twice, { asGuest: false });
  await register(db, pro, t4.id, twice, { asGuest: false });
  const already = await moveAttendeeCore(db, ctx, move(bookTwiceSource, t4.id), now);
  check("already booked", already, "Ce client est déjà inscrit à la séance choisie.");
  assert.equal(codeOf(already), "already_booked");
  const other = await makeCustomer(db, pro);
  await giveTickets(db, pro, other, typeX, 1);
  const bookOther = await register(db, pro, s.id, other, { asGuest: false });
  const full = await moveAttendeeCore(db, ctx, move(bookOther, t4.id), now);
  check("full", full, "La séance choisie est complète.");
  assert.equal(codeOf(full), "full");

  // A booking that is no longer confirmed, unknown ids, an RDV booking.
  const left = await unenrollCore(db, ctx, { occurrenceId: s.id, bookingIds: [bookOther], reason: null }, now);
  assert.ok(left.ok, JSON.stringify(left));
  const ended = await moveAttendeeCore(db, ctx, move(bookOther, t6.id), now);
  check("cancelled booking", ended, "Cette inscription a changé entre-temps : rafraîchissez la page.");
  assert.equal(codeOf(ended), "stale");
  check("unknown target", await moveAttendeeCore(db, ctx, move(bookTwiceSource, "inconnu"), now), "Inscription ou séance introuvable.");
  check("unknown booking", await moveAttendeeCore(db, ctx, move("inconnu", t6.id), now), "Inscription ou séance introuvable.");
  const rdvType = await rowRdvType(db, pro);
  const rdvId = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 5), 840, pro.tz) });
  const rdvBooking = await rowBooking(db, pro, { occurrenceId: rdvId, customerId: await makeCustomer(db, pro) });
  check(
    "RDV booking",
    await moveAttendeeCore(db, ctx, move(rdvBooking, t6.id), now),
    "Un rendez-vous ne se déplace pas : annulez-le puis réservez à nouveau.",
  );
});

dbTest("searchCustomersCore, registerOptionsCore and moveTargetsCore return client data with labels", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const typeY = await makeType(db, pro, { name: "Cours d'essai" });
  const alice = await makeCustomer(db, pro, { name: "Alice Dupont" });
  const bruno = await makeCustomer(db, pro, { name: "Bruno Dupont" });

  const search = await searchCustomersCore(db, ctx, { q: "  dupont " }, now);
  assert.ok(search.ok, JSON.stringify(search));
  assert.deepEqual(search.customers.map((c) => c.id), [alice, bruno]);
  assert.deepEqual(Object.keys(search.customers[0]).sort(), ["email", "id", "name", "phone"]);
  const short = await searchCustomersCore(db, ctx, { q: "d" }, now);
  assert.ok(short.ok, JSON.stringify(short));
  assert.deepEqual(short.customers, []);
  const long = await searchCustomersCore(db, ctx, { q: "x".repeat(300) }, now);
  assert.ok(!long.ok);
  assert.match(long.error, /254 caractères/);

  const expiresAt = instantAt(dayIn(pro, 5), 0, pro.tz);
  const src = await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX] });
  const [occ] = src.occurrences;
  const [foreverId] = await giveTickets(db, pro, alice, typeX, 1);
  const [soonId] = await giveTickets(db, pro, alice, typeX, 1, { expiresAt });
  const options = await registerOptionsCore(db, ctx, { occurrenceId: occ.id, customerId: alice }, now);
  assert.ok(options.ok, JSON.stringify(options));
  assert.deepEqual([options.mode, options.alreadyBooked], ["tickets", false]);
  assert.deepEqual(options.usable, [
    { id: soonId, label: `Cours collectif · ${expiryLabel(expiresAt, pro.tz, now)} · offert` },
    { id: foreverId, label: "Cours collectif · sans limite de validité · offert" },
  ]);
  assert.match(options.usable[0].label, /^Cours collectif · valable jusqu'au \d{2}\/\d{2}(\/\d{4})? inclus · offert$/);
  check(
    "unknown séance",
    await registerOptionsCore(db, ctx, { occurrenceId: "inconnu", customerId: alice }, now),
    "Séance ou client introuvable.",
  );

  const bookingId = await register(db, pro, occ.id, alice, { asGuest: false });
  const targetA = await makeEvent(db, pro, { title: "Cible", ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, 4) } });
  const targetB = await makeEvent(db, pro, { title: "Conversion", ticketTypeIds: [typeY], rule: { startDate: dayIn(pro, 5) } });
  const noon = instantAt(dayIn(pro, 0), 720, pro.tz);
  const targets = await moveTargetsCore(db, ctx, { bookingId, seriesRootId: null }, noon);
  assert.ok(targets.ok, JSON.stringify(targets));
  assert.deepEqual(targets.series, [
    { seriesRootId: targetA.eventId, title: "Cible" },
    { seriesRootId: targetB.eventId, title: "Conversion" },
  ]);
  const [a, b] = targets.targets;
  assert.deepEqual(
    [a.occurrenceId, a.seriesRootId, a.title, a.whenLabel, a.dayKey, a.seatsShown, a.capacity, a.full, a.accepted, a.conversionTypes, a.expiresBefore],
    [
      targetA.occurrences[0].id,
      targetA.eventId,
      "Cible",
      formatWhenShort(targetA.occurrences[0].startsAt, pro.tz),
      dayIn(pro, 4),
      12,
      12,
      false,
      true,
      [],
      false,
    ],
  );
  assert.deepEqual(
    [b.title, b.dayKey, b.accepted, b.conversionTypes, b.expiresBefore],
    ["Conversion", dayIn(pro, 5), false, [{ id: typeY, name: "Cours d'essai" }], true],
  );
  const onlyB = await moveTargetsCore(db, ctx, { bookingId, seriesRootId: targetB.eventId }, noon);
  assert.ok(onlyB.ok, JSON.stringify(onlyB));
  assert.deepEqual(onlyB.targets.map((t) => t.title), ["Conversion"]);
  assert.equal(onlyB.series.length, 2);
  assert.equal(MOVE_NOT_MOVABLE, "Cette inscription ne peut pas être déplacée.");
  check("unknown booking", await moveTargetsCore(db, ctx, { bookingId: "inconnu", seriesRootId: null }, noon), MOVE_NOT_MOVABLE);
});

dbTest("every attendee core refuses another pro's ids with the not-found wording and writes nothing", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro);
  const {
    occurrences: [mine],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeX] });
  const customerId = await makeCustomer(db, pro, { name: "Alice Dupont" });
  await giveTickets(db, pro, customerId, typeX, 1);
  const myBooking = await register(db, pro, mine.id, customerId, { asGuest: false });

  const other = await createTestPro(db);
  try {
    const otherType = await makeType(db, other);
    const {
      occurrences: [theirs],
    } = await makeEvent(db, other, { ticketTypeIds: [otherType] });
    const theirCustomer = await makeCustomer(db, other, { name: "Alice Dupont" });
    const [theirTicket] = await giveTickets(db, other, theirCustomer, otherType, 1);
    const theirBooking = await register(db, other, theirs.id, theirCustomer, { asGuest: false });

    check("register, foreign séance", await registerAttendeeCore(db, ctx, reg(theirs.id, customerId), now), "Séance introuvable.");
    check(
      "register, foreign customer",
      await registerAttendeeCore(db, ctx, reg(mine.id, theirCustomer, { coverage: "guest" }), now),
      "Séance ou client introuvable.",
    );
    const foreignTicket = await registerAttendeeCore(db, ctx, reg(mine.id, customerId, { ticketId: theirTicket }), now);
    check("register, foreign ticket", foreignTicket, "Ce ticket n'est pas utilisable sur cette séance.");
    assert.equal(codeOf(foreignTicket), "not_eligible");
    check("move, foreign booking", await moveAttendeeCore(db, ctx, move(theirBooking, mine.id), now), "Inscription ou séance introuvable.");
    check("move, foreign target", await moveAttendeeCore(db, ctx, move(myBooking, theirs.id), now), "Inscription ou séance introuvable.");
    check(
      "move, foreign conversion type",
      await moveAttendeeCore(db, ctx, move(myBooking, mine.id, { convertToTicketTypeId: otherType }), now),
      CONVERSION_TYPE_UNAVAILABLE,
    );
    const found = await searchCustomersCore(db, ctx, { q: "alice" }, now);
    assert.ok(found.ok, JSON.stringify(found));
    assert.deepEqual(found.customers.map((c) => c.id), [customerId], "the other pro's Alice is not listed");
    check(
      "options, foreign séance",
      await registerOptionsCore(db, ctx, { occurrenceId: theirs.id, customerId }, now),
      "Séance ou client introuvable.",
    );
    check(
      "options, foreign customer",
      await registerOptionsCore(db, ctx, { occurrenceId: mine.id, customerId: theirCustomer }, now),
      "Séance ou client introuvable.",
    );
    check(
      "targets, foreign booking",
      await moveTargetsCore(db, ctx, { bookingId: theirBooking, seriesRootId: null }, now),
      "Cette inscription ne peut pas être déplacée.",
    );

    // Nothing moved or was created on the other side.
    assert.equal((await getBooking(db, theirBooking)).occurrenceId, theirs.id);
    assert.equal((await getOccurrence(db, theirs.id)).seatsTaken, 1);
    assert.equal((await getBooking(db, myBooking)).occurrenceId, mine.id);
    assert.equal((await db.select({ id: customer.id }).from(customer).where(eq(customer.professionalId, other.proId))).length, 1);
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);
    assert.equal((await ticketsOf(db, theirCustomer)).find((t) => t.id === theirTicket)?.bookingId, theirBooking, "their ticket was not touched");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("registerAttendeeCore takes the pro and the actor from ctx, and a typed client never takes a user id from input", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const typeX = await makeType(db, pro);
    const {
      occurrences: [occ],
    } = await makeEvent(db, pro, { ticketTypeIds: [typeX] });
    const {
      occurrences: [free],
    } = await makeEvent(db, pro, { bookingMode: "free" });
    const holder = await makeCustomer(db, pro);
    const [ticketId] = await giveTickets(db, pro, holder, typeX, 1);

    // Keys the schema does not know are dropped by the validation, before they can reach the engine.
    const smuggled = { ...reg(occ.id, holder), professionalId: other.proId, actorUserId: other.userId } as RegisterInput;
    const res = await registerAttendeeCore(db, ctx, smuggled, now);
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal((await getBooking(db, res.bookingId)).professionalId, pro.proId);
    const spend = await db
      .select({ proId: ticketMovement.professionalId, actor: ticketMovement.actor, actorUserId: ticketMovement.actorUserId })
      .from(ticketMovement)
      .where(and(eq(ticketMovement.ticketId, ticketId), eq(ticketMovement.kind, "spend")));
    assert.deepEqual(spend, [{ proId: pro.proId, actor: "pro", actorUserId: pro.userId }]);

    const typed = {
      kind: "new",
      name: "Léa Martin",
      email: "lea.martin@example.com",
      phone: null,
      userId: other.userId,
      professionalId: other.proId,
    } as unknown as RegisterInput["customer"];
    const created = await registerAttendeeCore(db, ctx, reg(free.id, "", { customer: typed, coverage: "guest" }), now);
    assert.ok(created.ok, JSON.stringify(created));
    const [row] = await db.select().from(customer).where(eq(customer.id, created.customerId));
    assert.deepEqual([row.professionalId, row.userId], [pro.proId, null]);
    assert.equal((await db.select({ id: customer.id }).from(customer).where(eq(customer.professionalId, other.proId))).length, 0);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("moveTargetsCore flags the targets where the client already holds a seat (customerBooked)", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const mk = (title: string, day: number) =>
    makeEvent(db, pro, { title, ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, day) } });
  const [s] = (await mk("Source", 3)).occurrences;
  const [t4] = (await mk("Jour 4", 4)).occurrences;
  const [t5] = (await mk("Jour 5", 5)).occurrences;
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeX, 2);
  const bookingId = await register(db, pro, s.id, customerId, { asGuest: false });
  await register(db, pro, t4.id, customerId, { asGuest: false });

  const res = await moveTargetsCore(db, ctx, { bookingId, seriesRootId: null }, new Date());
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(
    res.targets.map((t) => [t.occurrenceId, t.customerBooked]),
    [
      [t4.id, true],
      [t5.id, false],
    ],
  );
});

dbTest("every attendee core refuses a malformed input in French, before any read or write", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const english = /\b(invalid|expected|required|too (small|big)|string|number)\b/i;
  const bad = [
    await registerAttendeeCore(db, ctx, reg("", "x"), now),
    await registerAttendeeCore(db, ctx, { ...reg("x", "x"), extraSeat: "oui" } as unknown as RegisterInput, now),
    await registerAttendeeCore(db, ctx, { ...reg("x", "x"), coverage: "ticket" } as unknown as RegisterInput, now),
    await moveAttendeeCore(db, ctx, { ...move("x", "y"), force: "oui" } as never, now),
    await moveAttendeeCore(db, ctx, move("", "y"), now),
    await searchCustomersCore(db, ctx, { q: 3 } as never, now),
    await registerOptionsCore(db, ctx, { occurrenceId: "", customerId: "x" }, now),
    await moveTargetsCore(db, ctx, { bookingId: "", seriesRootId: null }, now),
  ];
  for (const res of bad) {
    assert.ok(!res.ok, JSON.stringify(res));
    assert.ok(res.error.length > 0 && !english.test(res.error), res.error);
  }
});

dbTest("moveAttendeeCore: a booking without a ticket moved onto a target cancelled meanwhile reads « plus disponible »", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const [from] = (await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX] })).occurrences;
  const [fromFree] = (await makeEvent(db, pro, { title: "Source libre", bookingMode: "free" })).occurrences;
  const [to] = (await makeEvent(db, pro, { title: "Cible", ticketTypeIds: [typeX], rule: { startDate: dayIn(pro, 4) } })).occurrences;
  const [toFree] = (
    await makeEvent(db, pro, { title: "Cible libre", bookingMode: "free", rule: { startDate: dayIn(pro, 4) } })
  ).occurrences;
  const guestBooking = await register(db, pro, from.id, await makeCustomer(db, pro));
  const freeBooking = await register(db, pro, fromFree.id, await makeCustomer(db, pro), { asGuest: false });
  const holder = await makeCustomer(db, pro);
  await giveTickets(db, pro, holder, typeX, 1);
  const ticketBooking = await register(db, pro, from.id, holder, { asGuest: false });
  assert.equal((await getBooking(db, freeBooking)).coverage, "free");

  for (const target of [to, toFree]) {
    const cancelled = await cancelOccurrenceCore(db, ctx, { occurrenceId: target.id }, now);
    assert.ok(cancelled.ok, JSON.stringify(cancelled));
  }

  const guest = await moveAttendeeCore(db, ctx, move(guestBooking, to.id), now);
  check("guest, cancelled target", guest, "La séance choisie n'est plus disponible.");
  assert.equal(codeOf(guest), "not_eligible");
  check("free, cancelled target", await moveAttendeeCore(db, ctx, move(freeBooking, toFree.id), now), "La séance choisie n'est plus disponible.");
  assert.equal(MOVE_TARGET_UNAVAILABLE, "La séance choisie n'est plus disponible.");

  // A booking that holds a ticket keeps the engine's conversion wording (the wording of a cancelled target is not part of this fix).
  const withTicket = await moveAttendeeCore(db, ctx, move(ticketBooking, to.id), now);
  check(
    "ticket, cancelled target",
    withTicket,
    "Cette séance n'accepte pas le ticket de ce client : choisissez un type vers lequel le convertir.",
  );
  assert.equal(codeOf(withTicket), "not_eligible");

  assert.deepEqual(
    (await Promise.all([guestBooking, freeBooking, ticketBooking].map((id) => getBooking(db, id)))).map((b) => [b.occurrenceId, b.movedAt]),
    [
      [from.id, null],
      [fromFree.id, null],
      [from.id, null],
    ],
    "nothing moved",
  );
});

dbTest("registerAttendeeCore: answers are checked by the engine, stored on the booking, and a required question is not demanded of the pro", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const created = await createEvent(
    db,
    {
      professionalId: pro.proId,
      event: {
        title: "Atelier",
        bookingMode: "free",
        capacity: 12,
        durationMin: 60,
        isPrivate: false,
        ticketTypeIds: [],
        questions: [
          { label: "Votre objectif ?", type: "text", options: [], required: true },
          { label: "Niveau ?", type: "choice", options: ["Débutant", "Confirmé"], required: false },
        ],
        rule: {
          startDate: dayIn(pro, 3),
          startMinute: 600,
          freq: "once",
          interval: 1,
          weekdays: null,
          monthlyBy: null,
          monthWeek: null,
          endMode: "count",
          untilDate: null,
          occurrenceCount: 1,
        },
      },
    },
    now,
  );
  assert.ok(created.ok, JSON.stringify(created));
  const [occ] = await occurrencesOf(db, created.eventId);
  const questions = await db.select().from(question).where(eq(question.eventId, created.eventId));
  const goal = questions.find((q) => q.label === "Votre objectif ?");
  const level = questions.find((q) => q.label === "Niveau ?");
  assert.ok(goal && level);
  const answersOf = async (bookingId: string) =>
    (await db.select().from(bookingAnswer).where(eq(bookingAnswer.bookingId, bookingId))).map((a) => [a.questionId, a.questionLabel, a.value]);

  // An answer to a question that is not the event's: refused with the engine's French text, nothing is booked.
  const stranger = await makeCustomer(db, pro);
  const unknown = await registerAttendeeCore(db, ctx, reg(occ.id, stranger, { answers: [{ questionId: "inconnue", value: "x" }] }), now);
  check("unknown question", unknown, "Données invalides.");
  assert.equal(codeOf(unknown), "invalid");
  const notAnOption = await registerAttendeeCore(db, ctx, reg(occ.id, stranger, { answers: [{ questionId: level.id, value: "Expert" }] }), now);
  check("choice outside the options", notAnOption, "Réponse invalide pour : Niveau ?");
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 0, "the refusals booked nothing");

  // A valid answer is stored on the booking (trimmed), with the question's label.
  const answered = await makeCustomer(db, pro);
  const withAnswer = await registerAttendeeCore(db, ctx, reg(occ.id, answered, { answers: [{ questionId: level.id, value: " Confirmé " }] }), now);
  assert.ok(withAnswer.ok, JSON.stringify(withAnswer));
  assert.deepEqual(await answersOf(withAnswer.bookingId), [[level.id, "Niveau ?", "Confirmé"]]);

  // The required question stays unanswered: the pro is not forced to ask it (only a client is).
  const silent = await makeCustomer(db, pro);
  const without = await registerAttendeeCore(db, ctx, reg(occ.id, silent, { answers: [] }), now);
  assert.ok(without.ok, JSON.stringify(without));
  assert.deepEqual(await answersOf(without.bookingId), []);
  assert.equal(goal.required, true);
  assert.equal((await getOccurrence(db, occ.id)).seatsTaken, 2);
});

dbTest("moveAttendeeCore: a conversion type of the pro, active and not rdv_free, but not linked to the target event is refused", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeX = await makeType(db, pro, { name: "Cours collectif" });
  const typeY = await makeType(db, pro, { name: "Cours d'essai" });
  const typeZ = await makeType(db, pro, { name: "Stage" });
  const [from] = (await makeEvent(db, pro, { title: "Source", ticketTypeIds: [typeX] })).occurrences;
  const [to] = (await makeEvent(db, pro, { title: "Cible Y", ticketTypeIds: [typeY], rule: { startDate: dayIn(pro, 4) } })).occurrences;
  // typeZ is linked to another event only: it is usable in general, not on this target.
  await makeEvent(db, pro, { title: "Autre", ticketTypeIds: [typeZ], rule: { startDate: dayIn(pro, 5) } });
  const customerId = await makeCustomer(db, pro);
  const [ticketId] = await giveTickets(db, pro, customerId, typeX, 1);
  const bookingId = await register(db, pro, from.id, customerId, { asGuest: false });

  const res = await moveAttendeeCore(db, ctx, move(bookingId, to.id, { convertToTicketTypeId: typeZ }), now);
  check(
    "conversion type not linked to the target",
    res,
    "Cette séance n'accepte pas le ticket de ce client : choisissez un type vers lequel le convertir.",
  );
  assert.equal(codeOf(res), "not_eligible");

  const booking = await getBooking(db, bookingId);
  assert.deepEqual([booking.occurrenceId, booking.movedAt], [from.id, null]);
  assert.deepEqual([(await getOccurrence(db, from.id)).seatsTaken, (await getOccurrence(db, to.id)).seatsTaken], [1, 0]);
  const [held] = await ticketsOf(db, customerId);
  assert.deepEqual([held.id, held.ticketTypeId, held.status, held.bookingId], [ticketId, typeX, "booked", bookingId]);
  const kinds = (await movementsOf(db, ticketId)).map((m) => m.kind);
  assert.equal(kinds[kinds.length - 1], "spend", "no convert movement was written");
});

test("followingRuleOf: the rule that starts at the séance, with the remaining count in count mode", () => {
  const weeklyRule: RecurrenceRule = {
    startDate: "2026-10-12",
    startMinute: 600,
    durationMin: 60,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "count",
    untilDate: null,
    occurrenceCount: 6,
  };
  assert.deepEqual(followingRuleOf(weeklyRule, "2026-10-14", 1080), {
    ok: true,
    rule: {
      startDate: "2026-10-14",
      startMinute: 1080,
      freq: "weekly",
      interval: 1,
      weekdays: [1, 3],
      monthlyBy: null,
      monthWeek: null,
      endMode: "count",
      untilDate: null,
      occurrenceCount: 5,
    },
  });
  const second = followingRuleOf(weeklyRule, "2026-10-19", 1080);
  assert.ok(second.ok);
  assert.equal(second.rule.occurrenceCount, 4);

  const until = followingRuleOf({ ...weeklyRule, endMode: "until", occurrenceCount: null, untilDate: "2026-12-31" }, "2026-10-14", 600);
  assert.ok(until.ok);
  assert.deepEqual([until.rule.endMode, until.rule.untilDate, until.rule.occurrenceCount], ["until", "2026-12-31", null]);
  const never = followingRuleOf({ ...weeklyRule, endMode: "never", occurrenceCount: null }, "2026-10-14", 600);
  assert.ok(never.ok);
  assert.deepEqual([never.rule.endMode, never.rule.untilDate, never.rule.occurrenceCount], ["never", null, null]);

  const once = followingRuleOf(
    { ...weeklyRule, freq: "once", weekdays: null, endMode: "count", occurrenceCount: 1 },
    "2026-10-12",
    540,
  );
  assert.ok(once.ok);
  assert.equal(once.rule.occurrenceCount, 1);

  // A séance past the last counted date no longer belongs to the series.
  assert.deepEqual(followingRuleOf({ ...weeklyRule, occurrenceCount: 2 }, "2026-11-02", 600), {
    ok: false,
    error: FOLLOWING_DETACHED,
  });
  assert.equal(FOLLOWING_DETACHED, "Cette séance ne fait plus partie de la série : modifiez-la seule.");

  // A séance whose date is not a date of the rule is refused (one general check): a rule on the 31st never has a
  // séance « 2026-02-28 » (the engine skips a month without that day), and moving the start there would change the
  // day of every later month.
  const monthly: RecurrenceRule = {
    ...weeklyRule,
    startDate: "2026-01-31",
    freq: "monthly",
    weekdays: null,
    monthlyBy: "day_of_month",
    monthWeek: null,
    endMode: "never",
    occurrenceCount: null,
  };
  assert.deepEqual(followingRuleOf(monthly, "2026-02-28", 600), { ok: false, error: FOLLOWING_DETACHED });
  const sameDay = followingRuleOf(monthly, "2026-03-31", 600);
  assert.ok(sameDay.ok);
  assert.equal(sameDay.rule.startDate, "2026-03-31");
  // The 2nd Saturday of February 2026 is the 14th (the rule starts on a Saturday): the 10th is not a date of the rule.
  const nthWeekdayRule: RecurrenceRule = { ...monthly, monthlyBy: "weekday", monthWeek: 2 };
  const nthWeekday = followingRuleOf(nthWeekdayRule, "2026-02-14", 600);
  assert.ok(nthWeekday.ok, "the 2nd Saturday belongs to the rule");
  assert.deepEqual(followingRuleOf(nthWeekdayRule, "2026-02-10", 600), { ok: false, error: FOLLOWING_DETACHED });
});

test("followingRuleOf: a date that is not one of the rule's dates is refused, whatever the end mode", () => {
  const weeklyRule: RecurrenceRule = {
    startDate: "2026-10-12",
    startMinute: 600,
    durationMin: 60,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "count",
    untilDate: null,
    occurrenceCount: 6,
  };
  // 2026-10-13 is a Tuesday: before the last counted date, yet off the Monday and Wednesday pattern.
  assert.deepEqual(followingRuleOf(weeklyRule, "2026-10-13", 600), { ok: false, error: FOLLOWING_DETACHED });
  assert.deepEqual(followingRuleOf({ ...weeklyRule, endMode: "never", occurrenceCount: null }, "2026-10-13", 600), {
    ok: false,
    error: FOLLOWING_DETACHED,
  });
  // Every other week: the week of 2026-10-19 is skipped.
  const biweekly: RecurrenceRule = { ...weeklyRule, interval: 2, endMode: "never", occurrenceCount: null };
  assert.deepEqual(followingRuleOf(biweekly, "2026-10-19", 600), { ok: false, error: FOLLOWING_DETACHED });
  assert.ok(followingRuleOf(biweekly, "2026-10-26", 600).ok);
  // Before the rule starts.
  assert.deepEqual(followingRuleOf(weeklyRule, "2026-10-07", 600), { ok: false, error: FOLLOWING_DETACHED });
  // A one-off event has a single date.
  const once: RecurrenceRule = { ...weeklyRule, freq: "once", weekdays: null, occurrenceCount: 1 };
  assert.ok(followingRuleOf(once, "2026-10-12", 600).ok);
  assert.deepEqual(followingRuleOf(once, "2026-10-14", 600), { ok: false, error: FOLLOWING_DETACHED });
});

test("followingRuleOf: a séance past the until date no longer belongs to the series either", () => {
  const untilRule: RecurrenceRule = {
    startDate: "2026-10-12",
    startMinute: 600,
    durationMin: 60,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "until",
    untilDate: "2026-12-31",
    occurrenceCount: null,
  };
  // The new rule would end before it starts (« La fin précède le début. » from the engine): say why instead.
  assert.deepEqual(followingRuleOf(untilRule, "2027-01-04", 600), { ok: false, error: FOLLOWING_DETACHED });
  // 2026-12-30 is the last Wednesday of the rule, still in the series; 2026-12-31 is a Thursday, no date of the rule.
  const lastDay = followingRuleOf(untilRule, "2026-12-30", 600);
  assert.ok(lastDay.ok, "the last date of the rule is still in the series");
  assert.equal(lastDay.rule.untilDate, "2026-12-31");
  assert.deepEqual(followingRuleOf(untilRule, "2026-12-31", 600), { ok: false, error: FOLLOWING_DETACHED });
});

dbTest("expiringBeforeCore: lists the bookings whose ticket ends before the new start, expiry in the pro zone", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const typeId = await makeType(db, pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro, { ticketTypeIds: [typeId] });
  const thomas = await makeCustomer(db, pro, { name: "Thomas Leroy" });
  const marina = await makeCustomer(db, pro, { name: "Marina Costa" });
  const expiresAt = instantAt(dayIn(pro, 5), 0, pro.tz);
  await giveTickets(db, pro, thomas, typeId, 1, { expiresAt });
  await giveTickets(db, pro, marina, typeId, 1);
  const thomasBooking = await register(db, pro, occ.id, thomas, { asGuest: false });
  await register(db, pro, occ.id, marina, { asGuest: false });

  const later = await expiringBeforeCore(db, ctx, { occurrenceId: occ.id, date: dayIn(pro, 6), startMinute: 600 }, now);
  assert.ok(later.ok, JSON.stringify(later));
  assert.deepEqual(later.bookings, [
    { bookingId: thomasBooking, customerName: "Thomas Leroy", expiryText: expiryLabel(expiresAt, pro.tz, now) },
  ]);
  assert.match(later.bookings[0].expiryText, /^valable jusqu'au /);

  const sooner = await expiringBeforeCore(db, ctx, { occurrenceId: occ.id, date: dayIn(pro, 4), startMinute: 600 }, now);
  assert.ok(sooner.ok, JSON.stringify(sooner));
  assert.deepEqual(sooner.bookings, []);
  const edge = await expiringBeforeCore(db, ctx, { occurrenceId: occ.id, date: dayIn(pro, 5), startMinute: 0 }, now);
  assert.ok(edge.ok, JSON.stringify(edge));
  assert.equal(edge.bookings.length, 1, "expires_at equal to the new start counts as expired");

  const invalid = await expiringBeforeCore(db, ctx, { occurrenceId: occ.id, date: dayIn(pro, 6), startMinute: 1440 }, now);
  assert.ok(!invalid.ok);
  assert.match(invalid.error, /maximum 1.?439/i);
});

dbTest("every séance core refuses another pro's ids with the not-found wording and writes nothing", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const typeId = await makeType(db, other);
    const {
      eventId: theirEvent,
      occurrences: [theirs],
    } = await makeEvent(db, other, { ticketTypeIds: [typeId] });
    const theirBooking = await register(db, other, theirs.id, await makeCustomer(db, other));
    const seen = theirs.startsAt.toISOString();

    check("updateOccurrence", await updateOccurrenceCore(db, ctx, { occurrenceId: theirs.id, seenStartsAt: seen, durationMin: 30 }, now), "Séance introuvable.");
    check("expiringBefore", await expiringBeforeCore(db, ctx, { occurrenceId: theirs.id, date: dayIn(pro, 6), startMinute: 600 }, now), "Séance introuvable.");
    check(
      "capacity, séance",
      await updateCapacityCore(db, ctx, { occurrenceId: theirs.id, seenStartsAt: seen, scope: "occurrence", capacity: 3, seenVersion: null }, now),
      "Séance introuvable.",
    );
    check(
      "capacity, event",
      await updateCapacityCore(db, ctx, { occurrenceId: theirs.id, seenStartsAt: seen, scope: "event", capacity: 3, seenVersion: 1 }, now),
      "Séance introuvable.",
    );
    check("cancel", await cancelOccurrenceCore(db, ctx, { occurrenceId: theirs.id }, now), "Séance introuvable.");
    check("restore", await restoreOccurrenceCore(db, ctx, { occurrenceId: theirs.id }, now), "Seule une séance future d'un événement peut être rétablie.");
    check(
      "unenroll",
      await unenrollCore(db, ctx, { occurrenceId: theirs.id, bookingIds: [theirBooking], reason: null }, now),
      "Inscription introuvable sur cette séance.",
    );
    check("previewFollowing", await previewFollowingCore(db, ctx, { occurrenceId: theirs.id, startMinute: 600, durationMin: 60 }, now), "Événement introuvable ou terminé.");
    check(
      "applyFollowing",
      await applyFollowingCore(db, ctx, { occurrenceId: theirs.id, seenVersion: 1, startMinute: 600, durationMin: 60 }, now),
      "Événement introuvable ou terminé.",
    );

    // Nothing moved on the other side.
    const row = await getOccurrence(db, theirs.id);
    assert.deepEqual([row.status, row.capacity, row.seatsTaken, row.locationOverride], ["scheduled", 12, 1, null]);
    assert.equal(row.endsAt.getTime() - row.startsAt.getTime(), 60 * 60_000);
    assert.equal((await getBooking(db, theirBooking)).status, "confirmed");
    const [ev] = await db.select({ version: event.version, capacity: event.capacity }).from(event).where(eq(event.id, theirEvent));
    assert.deepEqual(ev, { version: 1, capacity: 12 });
    assert.deepEqual(await checkInvariants(db, { proId: other.proId }), []);

    // Own RDV: the engine's wording passes through, and the series cores say the event is not found.
    const rdvType = await rowRdvType(db, pro);
    const rdv = await rowRdv(db, pro, rdvType, { startsAt: instantAt(dayIn(pro, 5), 840, pro.tz) });
    await rowBooking(db, pro, { occurrenceId: rdv, customerId: await makeCustomer(db, pro) });
    check(
      "own RDV, edit",
      await updateOccurrenceCore(db, ctx, { occurrenceId: rdv, seenStartsAt: new Date().toISOString(), durationMin: 30 }, now),
      "Un rendez-vous se déplace en l'annulant puis en le réservant à nouveau.",
    );
    check("own RDV, following", await previewFollowingCore(db, ctx, { occurrenceId: rdv, startMinute: 600, durationMin: 60 }, now), "Événement introuvable ou terminé.");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────── A preview never promises what the action then refuses ───────────── */

/** The preview and the action answer an edit the engine refuses with the very same failure (text and code). */
async function sameFollowingRefusal(
  db: Db,
  ctx: ProCtx,
  name: string,
  input: { occurrenceId: string; startMinute: number; durationMin: number },
  now: Date,
  error: string,
  code: string | undefined,
): Promise<void> {
  const preview = await previewFollowingCore(db, ctx, input, now);
  const applied = await applyFollowingCore(db, ctx, { ...input, seenVersion: 1 }, now);
  assert.equal(preview.ok, false, `${name}: preview ${JSON.stringify(preview)}`);
  assert.equal(applied.ok, false, `${name}: apply ${JSON.stringify(applied)}`);
  assert.deepEqual(preview, applied, `${name}: preview and apply refuse differently`);
  assert.equal((preview as { error: string }).error, error, name);
  assert.equal((preview as { code?: string }).code, code, `${name}: code`);
}

dbTest("previewFollowingCore and applyFollowingCore refuse the same edits, with the engine's own text", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: weekly(pro, 3) });
  const [first, second] = occurrences;
  const edit = { occurrenceId: first.id, startMinute: 1080, durationMin: 90 };

  await sameFollowingRefusal(db, ctx, "a séance of the edit has started", edit, addMinutes(first.startsAt, 5), "Une séance concernée a déjà commencé.", "invalid");
  await sameFollowingRefusal(
    db,
    ctx,
    "the cut is before local today",
    edit,
    addMinutes(first.startsAt, 3 * 24 * 60),
    "La modification doit partir d'aujourd'hui ou d'une date future.",
    "invalid",
  );
  await sameFollowingRefusal(
    db,
    ctx,
    "the new time of a séance to come is already behind",
    { ...edit, startMinute: 480 },
    addMinutes(first.startsAt, -60),
    "Une séance de la nouvelle règle serait déjà passée.",
    "invalid",
  );

  // A séance kept apart beyond the last counted date of a one-off event: no rule can start there.
  const apart = await rowSeance(db, pro, await rowEvent(db, pro), { seriesDate: dayIn(pro, 5) });
  await sameFollowingRefusal(db, ctx, "detached from its series", { occurrenceId: apart, startMinute: 600, durationMin: 60 }, new Date(), FOLLOWING_DETACHED, undefined);

  // An archived event is « terminé » for both.
  const archived = await rowSeance(db, pro, await rowEvent(db, pro, { archivedAt: new Date() }));
  await sameFollowingRefusal(db, ctx, "archived event", { occurrenceId: archived, startMinute: 600, durationMin: 60 }, new Date(), "Événement introuvable ou terminé.", "not_found");

  // None of those refusals wrote anything, and the same edit on a séance to come is accepted by both.
  const rows = await Promise.all(occurrences.map((o) => getOccurrence(db, o.id)));
  assert.deepEqual(
    rows.map((r) => [r.startsAt.getTime(), r.eventId]),
    occurrences.map((o) => [o.startsAt.getTime(), eventId]),
  );
  const now = new Date();
  const ok = await previewFollowingCore(db, ctx, { occurrenceId: second.id, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(ok.ok, JSON.stringify(ok));
  const applied = await applyFollowingCore(db, ctx, { occurrenceId: second.id, seenVersion: 1, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(applied.ok, JSON.stringify(applied));
  assert.equal(applied.summaryText, ok.text);
});

dbTest("expiringBeforeCore refuses the moves updateOccurrenceCore refuses, with the same failure", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const {
    occurrences: [occ],
  } = await makeEvent(db, pro);
  const seen = occ.startsAt.toISOString();
  const move = { date: dayIn(pro, 5), startMinute: 840 };

  /** The warning and the save fail alike (same text, same code), and say `error`. */
  async function sameRefusal(name: string, occurrenceId: string, seenStartsAt: string, now: Date, to: typeof move, error: string, code: string) {
    const warned = await expiringBeforeCore(db, ctx, { occurrenceId, ...to }, now);
    const saved = await updateOccurrenceCore(db, ctx, { occurrenceId, seenStartsAt, ...to }, now);
    assert.equal(warned.ok, false, `${name}: warning ${JSON.stringify(warned)}`);
    assert.equal(saved.ok, false, `${name}: save ${JSON.stringify(saved)}`);
    assert.deepEqual(warned, saved, `${name}: the warning and the save refuse differently`);
    assert.equal((warned as { error: string }).error, error, name);
    assert.equal((warned as { code?: string }).code, code, `${name}: code`);
  }

  await sameRefusal("started", occ.id, seen, addMinutes(occ.startsAt, 5), move, "Une séance concernée a déjà commencé.", "invalid");
  await sameRefusal(
    "new start behind",
    occ.id,
    seen,
    addMinutes(occ.startsAt, -60),
    { date: String(occ.seriesDate), startMinute: 480 },
    "La nouvelle date serait déjà passée.",
    "invalid",
  );

  // A started séance whose start does not move can still be edited (place, capacity): the warning is an empty list.
  const unmoved = await expiringBeforeCore(
    db,
    ctx,
    { occurrenceId: occ.id, date: String(occ.seriesDate), startMinute: 600 },
    addMinutes(occ.startsAt, 5),
  );
  assert.ok(unmoved.ok, JSON.stringify(unmoved));
  assert.deepEqual(unmoved.bookings, []);

  // An RDV is moved by cancelling and booking again.
  const rdv = await rowRdv(db, pro, await rowRdvType(db, pro), { startsAt: instantAt(dayIn(pro, 5), 780, pro.tz) });
  await rowBooking(db, pro, { occurrenceId: rdv, customerId: await makeCustomer(db, pro) });
  await sameRefusal(
    "RDV",
    rdv,
    new Date().toISOString(),
    new Date(),
    move,
    "Un rendez-vous se déplace en l'annulant puis en le réservant à nouveau.",
    "invalid",
  );

  // A cancelled séance has nothing to move.
  const cancelled = await cancelOccurrenceCore(db, ctx, { occurrenceId: occ.id }, new Date());
  assert.ok(cancelled.ok, JSON.stringify(cancelled));
  await sameRefusal("cancelled", occ.id, seen, new Date(), move, "La séance a changé entre-temps : rafraîchissez la page.", "changed");
});

dbTest("previewFollowingCore and applyFollowingCore refuse a séance that was moved alone, and write nothing", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: weekly(pro, 3) });
  const [first, second, third] = occurrences;

  // « Cette séance » takes the second séance to another day and hour: it no longer follows the series' time.
  const moved = await updateOccurrenceCore(
    db,
    ctx,
    { occurrenceId: second.id, seenStartsAt: second.startsAt.toISOString(), date: dayIn(pro, 12), startMinute: 840 },
    now,
  );
  assert.ok(moved.ok, JSON.stringify(moved));
  const apart = await getOccurrence(db, second.id);
  assert.equal(apart.timeDetached, true);

  assert.equal(
    FOLLOWING_TIME_DETACHED,
    "Cette séance a été modifiée seule : elle ne suit plus l'horaire de la série. Enregistrez le changement pour cette séance seulement, ou ouvrez la séance suivante et choisissez « Appliquer aussi aux séances suivantes ».",
  );
  await sameFollowingRefusal(
    db,
    ctx,
    "moved alone",
    { occurrenceId: second.id, startMinute: 1080, durationMin: 90 },
    now,
    FOLLOWING_TIME_DETACHED,
    undefined,
  );
  const unchanged = async () => {
    const rows = await Promise.all(occurrences.map((o) => getOccurrence(db, o.id)));
    const [ev] = await db.select({ version: event.version }).from(event).where(eq(event.id, eventId));
    return { times: rows.map((r) => [r.startsAt.getTime(), r.endsAt.getTime(), r.eventId]), version: ev.version };
  };
  assert.deepEqual(await unchanged(), {
    times: [
      [first.startsAt.getTime(), first.endsAt.getTime(), eventId],
      [apart.startsAt.getTime(), apart.endsAt.getTime(), eventId],
      [third.startsAt.getTime(), third.endsAt.getTime(), eventId],
    ],
    version: 1,
  });

  // The way out the text gives works: from the next séance, the one moved alone stays where it was put.
  const next = await applyFollowingCore(db, ctx, { occurrenceId: third.id, seenVersion: 1, startMinute: 1080, durationMin: 90 }, now);
  assert.ok(next.ok, JSON.stringify(next));
  assert.equal(next.summaryText, "1 séance modifiée");
  const stays = await getOccurrence(db, second.id);
  assert.deepEqual([stays.startsAt.getTime(), stays.endsAt.getTime(), stays.eventId], [apart.startsAt.getTime(), apart.endsAt.getTime(), eventId]);
});

dbTest("previewFollowingCore and applyFollowingCore refuse a séance off the rule brought back by « Rétablir »", async ({ db, pro }) => {
  const ctx = proCtx(pro);
  const now = new Date();
  const { eventId, occurrences } = await makeEvent(db, pro, { rule: weekly(pro, 3) });

  // The day after the first séance is no weekday of the rule, yet inside its count: the old case-by-case guards let it through.
  const offDate = dayIn(pro, 4);
  const stray = await rowSeance(db, pro, eventId, {
    seriesDate: offDate,
    startsAt: instantAt(offDate, 600, pro.tz),
    status: "cancelled",
  });
  const restored = await restoreOccurrenceCore(db, ctx, { occurrenceId: stray }, now);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.equal((await getOccurrence(db, stray)).status, "scheduled");

  await sameFollowingRefusal(db, ctx, "off the rule", { occurrenceId: stray, startMinute: 1080, durationMin: 90 }, now, FOLLOWING_DETACHED, undefined);

  assert.equal((await getOccurrence(db, stray)).status, "scheduled", "the stray séance is still there");
  const rows = await Promise.all(occurrences.map((o) => getOccurrence(db, o.id)));
  assert.deepEqual(
    rows.map((r) => [r.startsAt.getTime(), r.eventId]),
    occurrences.map((o) => [o.startsAt.getTime(), eventId]),
  );
  const [ev] = await db.select({ version: event.version }).from(event).where(eq(event.id, eventId));
  assert.equal(ev.version, 1);
});
