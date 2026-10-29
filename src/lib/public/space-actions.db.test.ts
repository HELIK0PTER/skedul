import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { bookWithHeldTicket } from "@/lib/booking/claims";
import { revokeLinks } from "@/lib/booking/wallet";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { guestLinkKey, signGuestLink } from "@/lib/guest-link";
import { resolveVisitor } from "@/lib/public/identity";
import { cancelMyBookingCore } from "@/lib/public/space-actions";
import { checkActionThrottle, type ThrottleSubject } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES } from "@/lib/tickets";
import { createTestPro, dbTest, deleteTestUser, testEmail, type TestPro } from "@/test/db";
import { getBooking, giveTickets, makeCustomer, makeEvent, makeType, ticketsOf } from "@/test/fixtures";
import { actionVisitorOf, createTestClientUser, publicProOf, sessionOf, testIpHash } from "@/test/public";

const KEY = guestLinkKey("test-secret");

/* ───────────────────────── cancelMyBookingCore ───────────────────────── */

type Seat = { customerId: string; bookingId: string; occurrenceId: string; email: string };

/** A customer of `p` with a confirmed booking on a séance 3 days ahead, paid with a held ticket (bookWithHeldTicket). */
async function seatedBooking(db: Db, p: TestPro, opts: { now: Date; email?: string; actorUserId?: string }): Promise<Seat> {
  const email = opts.email ?? testEmail("seat");
  const typeId = await makeType(db, p, { name: "Cours collectif" });
  const {
    occurrences: [occ],
  } = await makeEvent(db, p, { ticketTypeIds: [typeId] }, opts.now);
  const customerId = await makeCustomer(db, p, { email });
  await giveTickets(db, p, customerId, typeId, 1);
  const res = await bookWithHeldTicket(
    db,
    {
      professionalId: p.proId,
      occurrenceId: occ.id,
      customerId,
      seenStartsAt: occ.startsAt,
      actorUserId: opts.actorUserId ?? p.userId,
    },
    opts.now,
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) throw new Error("unreachable");
  return { customerId, bookingId: res.bookingId, occurrenceId: occ.id, email };
}

/** The error and code of a refused core result, with a failed assertion when it was not refused. */
function refusalOf(res: { ok: boolean; error?: string; code?: string }): { error: string | undefined; code: string | undefined } {
  assert.equal(res.ok, false, JSON.stringify(res));
  return { error: res.error, code: res.code };
}

dbTest("cancelMyBookingCore: the Owner cancels before the deadline: cancelled by the client, the ticket comes back, three effects", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("owner");
  const { userId } = await createTestClientUser(db, { email, verified: true });
  try {
    const seat = await seatedBooking(db, pro, { now, email, actorUserId: userId });
    assert.deepEqual((await ticketsOf(db, seat.customerId)).map((t) => t.status), ["booked"]);
    const visitor = actionVisitorOf({
      session: sessionOf({ userId, email }),
      owner: { professionalId: pro.proId, customerId: seat.customerId, userId, email },
    });
    const publicPro = await publicProOf(db, pro);

    const res = await cancelMyBookingCore(db, publicPro, visitor, { bookingId: seat.bookingId }, now);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.effects, [
      { type: "email.booking_cancelled", bookingId: seat.bookingId, by: "client" },
      { type: "email.pro_booking_cancelled", bookingId: seat.bookingId },
      { type: "google.sync_occurrence", occurrenceId: seat.occurrenceId },
    ]);
    const booking = await getBooking(db, seat.bookingId);
    assert.equal(booking.status, "cancelled");
    assert.equal(booking.endedBy, "client");
    assert.deepEqual((await ticketsOf(db, seat.customerId)).map((t) => t.status), ["available"], "the ticket is given back");

    // A second submit finds nothing left to cancel and gives nothing back twice.
    const again = await cancelMyBookingCore(db, publicPro, visitor, { bookingId: seat.bookingId }, now);
    assert.equal(refusalOf(again).code, "too_late_or_done");
    assert.deepEqual(again.effects, []);
    assert.equal((await ticketsOf(db, seat.customerId)).length, 1);
  } finally {
    await deleteTestUser(db, userId);
  }
});

dbTest("cancelMyBookingCore: the guest cookie customer cancels their own booking (read and cancel only)", async ({ db, pro }) => {
  const now = new Date();
  const seat = await seatedBooking(db, pro, { now });
  const visitor = actionVisitorOf({ guestCustomerId: seat.customerId });
  const res = await cancelMyBookingCore(db, await publicProOf(db, pro), visitor, { bookingId: seat.bookingId }, now);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal((await getBooking(db, seat.bookingId)).status, "cancelled");
  assert.deepEqual((await ticketsOf(db, seat.customerId)).map((t) => t.status), ["available"]);
});

dbTest("cancelMyBookingCore: after the deadline only the pro can cancel: the locked sentence, nothing changes", async ({ db, pro }) => {
  const now = new Date();
  const seat = await seatedBooking(db, pro, { now });
  // 240 hours of deadline against a séance 72 hours away: past the deadline, never changed, never moved.
  await db.update(schema.professional).set({ cancelDeadlineHours: 240 }).where(eq(schema.professional.id, pro.proId));
  const publicPro = await publicProOf(db, pro);

  const res = await cancelMyBookingCore(db, publicPro, actionVisitorOf({ guestCustomerId: seat.customerId }), { bookingId: seat.bookingId }, now);
  assert.deepEqual(refusalOf(res), { error: `Seul(e) ${publicPro.businessName} peut annuler maintenant.`, code: "too_late_or_done" });
  assert.deepEqual(res.effects, []);
  assert.equal((await getBooking(db, seat.bookingId)).status, "confirmed");
  assert.deepEqual((await ticketsOf(db, seat.customerId)).map((t) => t.status), ["booked"]);
});

dbTest("cancelMyBookingCore: another customer's booking and another pro's booking get the not-found wording and stay as they were", async ({ db, pro }) => {
  const now = new Date();
  const mineEmail = testEmail("mine");
  const { userId } = await createTestClientUser(db, { email: mineEmail, verified: true });
  const other = await createTestPro(db);
  try {
    const mine = await seatedBooking(db, pro, { now, email: mineEmail });
    const sibling = await seatedBooking(db, pro, { now });
    const theirs = await seatedBooking(db, other, { now });
    const publicPro = await publicProOf(db, pro);
    const owner = actionVisitorOf({
      session: sessionOf({ userId, email: mineEmail }),
      owner: { professionalId: pro.proId, customerId: mine.customerId, userId, email: mineEmail },
    });
    const notFound = { error: "Inscription introuvable : rafraîchissez la page.", code: "not_found" };

    // The Owner of one customer cannot cancel the booking of another customer of the same pro.
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, owner, { bookingId: sibling.bookingId }, now)), notFound);
    // Nor a booking of another pro, whoever asks: the Owner, or a cookie customer of that other pro.
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, owner, { bookingId: theirs.bookingId }, now)), notFound);
    const foreignCookie = actionVisitorOf({ guestCustomerId: theirs.customerId });
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, foreignCookie, { bookingId: theirs.bookingId }, now)), notFound);
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, actionVisitorOf({ guestCustomerId: "unknown" }), { bookingId: mine.bookingId }, now)), notFound);
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, owner, { bookingId: "unknown-booking" }, now)), notFound);

    for (const id of [mine.bookingId, sibling.bookingId, theirs.bookingId]) {
      assert.equal((await getBooking(db, id)).status, "confirmed");
    }
  } finally {
    await deleteTestUser(db, other.userId);
    await deleteTestUser(db, userId);
  }
});

dbTest("cancelMyBookingCore: a revoked personal link cancels nothing, the new one works (S9)", async ({ db, pro }) => {
  const now = new Date();
  const seat = await seatedBooking(db, pro, { now });
  const publicPro = await publicProOf(db, pro);
  const cookieVisitor = async (token: string) => {
    const visitor = await resolveVisitor(db, { session: null, guestToken: token, key: KEY }, { professionalId: pro.proId, ownerUserId: pro.userId });
    return { guestCustomerId: visitor.guestCustomerId, visitor: actionVisitorOf({ owner: visitor.owner, guestCustomerId: visitor.guestCustomerId }) };
  };

  const oldToken = signGuestLink({ customerId: seat.customerId, linkVersion: 1 }, KEY);
  assert.equal((await cookieVisitor(oldToken)).guestCustomerId, seat.customerId, "the link works until it is revoked");

  const revoked = await revokeLinks(db, { professionalId: pro.proId, customerId: seat.customerId });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const stale = await cookieVisitor(oldToken);
  assert.equal(stale.guestCustomerId, null, "the old cookie resolves to nobody");
  const refused = await cancelMyBookingCore(db, publicPro, stale.visitor, { bookingId: seat.bookingId }, now);
  assert.equal(refusalOf(refused).code, "not_found");
  assert.equal((await getBooking(db, seat.bookingId)).status, "confirmed");

  const fresh = await cookieVisitor(signGuestLink({ customerId: seat.customerId, linkVersion: 2 }, KEY));
  assert.equal(fresh.guestCustomerId, seat.customerId);
  const ok = await cancelMyBookingCore(db, publicPro, fresh.visitor, { bookingId: seat.bookingId }, now);
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

dbTest("cancelMyBookingCore: nobody acts for a signed-out visitor, a verified stranger or an impersonating admin, even with a planted cookie", async ({ db, pro }) => {
  const now = new Date();
  const strangerEmail = testEmail("stranger");
  const { userId } = await createTestClientUser(db, { email: strangerEmail, verified: true });
  try {
    const seat = await seatedBooking(db, pro, { now });
    const publicPro = await publicProOf(db, pro);
    const notFound = { error: "Inscription introuvable : rafraîchissez la page.", code: "not_found" };
    const input = { bookingId: seat.bookingId };

    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, actionVisitorOf(), input, now)), notFound);
    // Verified, no customer row here: the cookie is ignored (L1370).
    const stranger = actionVisitorOf({ session: sessionOf({ userId, email: strangerEmail }), guestCustomerId: seat.customerId });
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, stranger, input, now)), notFound);
    // Impersonating: no client identity at all (SEC-M6, S42).
    const impersonating = actionVisitorOf({
      session: sessionOf({ userId, email: strangerEmail }, { impersonated: true }),
      guestCustomerId: seat.customerId,
    });
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, impersonating, input, now)), notFound);
    assert.equal((await getBooking(db, seat.bookingId)).status, "confirmed");
  } finally {
    await deleteTestUser(db, userId);
  }
});

dbTest("cancelMyBookingCore: after 10 hits on the actor's cancel key in the hour the core answers throttled and the booking is unchanged (S19)", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("throttled");
  const { userId } = await createTestClientUser(db, { email, verified: true });
  try {
    const publicPro = await publicProOf(db, pro);
    const throttled = { error: ENGINE_ERROR_MESSAGES.throttled, code: "throttled" };
    /** The 10 hits the hour allows, on fresh IP buckets so only the subject's keys fill up. */
    const burn = async (subject: ThrottleSubject) => {
      for (let hit = 1; hit <= 10; hit += 1) {
        const allowed = await checkActionThrottle(
          db,
          { action: "cancel", professionalId: pro.proId, ipHash: testIpHash(), wideIpHash: null, subject },
          now,
        );
        assert.equal(allowed, true, `hit ${hit} of 10 is allowed`);
      }
    };

    // The Owner is keyed on the user id.
    const owned = await seatedBooking(db, pro, { now, email, actorUserId: userId });
    await burn({ kind: "user", userId });
    const owner = actionVisitorOf({
      session: sessionOf({ userId, email }),
      owner: { professionalId: pro.proId, customerId: owned.customerId, userId, email },
    });
    const res = await cancelMyBookingCore(db, publicPro, owner, { bookingId: owned.bookingId }, now);
    assert.deepEqual(refusalOf(res), throttled);
    assert.deepEqual(res.effects, []);
    assert.equal((await getBooking(db, owned.bookingId)).status, "confirmed");

    // The guest cookie customer is keyed on the customer's own address, never on the cookie.
    const guestSeat = await seatedBooking(db, pro, { now });
    await burn({ kind: "email", email: guestSeat.email });
    const guest = actionVisitorOf({ guestCustomerId: guestSeat.customerId });
    assert.deepEqual(refusalOf(await cancelMyBookingCore(db, publicPro, guest, { bookingId: guestSeat.bookingId }, now)), throttled);
    assert.equal((await getBooking(db, guestSeat.bookingId)).status, "confirmed");
    assert.deepEqual((await ticketsOf(db, guestSeat.customerId)).map((t) => t.status), ["booked"]);
  } finally {
    await deleteTestUser(db, userId);
  }
});

dbTest("cancelMyBookingCore: a malformed input is refused whole, in French, before anything is read (S43)", async ({ db, pro }) => {
  const now = new Date();
  const publicPro = await publicProOf(db, pro);
  // A database that fails on any use: every refusal below must come from the parse, before the first read.
  const noDb = new Proxy({}, {
    get() {
      throw new Error("the database was used");
    },
  }) as unknown as Db;
  const visitor = actionVisitorOf({ guestCustomerId: "c-cookie" });
  const refused = async (input: unknown): Promise<string | undefined> => {
    const res = await cancelMyBookingCore(noDb, publicPro, visitor, input, now);
    assert.deepEqual(res.effects, []);
    return refusalOf(res).error;
  };
  assert.equal(await refused({ bookingId: "b1", extra: 1 }), "Champ inattendu.");
  assert.equal(await refused({ bookingId: "b1", website: ["x"] }), "Champ inattendu.");
  assert.equal(await refused({ bookingId: "b1", slug: "another-page" }), "Champ inattendu.", "the slug is split off by the wrapper, never read here");
  assert.equal(await refused({ bookingId: 5 }), "Ce champ est obligatoire.");
  assert.equal(await refused({ bookingId: "" }), "Ce champ est obligatoire.");
  assert.equal(await refused({}), "Ce champ est obligatoire.");
  assert.equal(await refused({ bookingId: "x".repeat(65) }), "64 caractères au maximum.");
  assert.equal(await refused(null), "Valeur invalide.");
  assert.equal(await refused("b1"), "Valeur invalide.");
});
