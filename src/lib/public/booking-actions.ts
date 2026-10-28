/**
 * Public bookings and purchases of an event séance (spec § 11 E1, E2, E3) as testable cores. Every core
 * validates the WHOLE input first (parseFr on a strict schema), then refuses in a fixed order (honeypot,
 * payment availability, throttle, seat pressure) BEFORE its first write, then calls the engine with the pro of
 * the page slug (PublicPro), never with anything taken from the input. A core never reads a session or a
 * cookie: the wrapper (src/server/public-context.ts) builds the ActionVisitor. No server-only, no next/*.
 */
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { attachCheckoutSession, bookWithHeldTicket, registerFree, startBuyAndBook } from "@/lib/booking/claims";
import { releasePurchase } from "@/lib/booking/release";
import { fail, type Effect } from "@/lib/booking/types";
import { upsertCustomer } from "@/lib/booking/wallet";
import { ts, type Db } from "@/lib/db/atomic";
import { booking, event, occurrence } from "@/lib/db/schema";
import { logSafeMessage } from "@/lib/log-safe";
import {
  buybookCheckoutExpiry,
  checkoutUrls,
  type CheckoutCreated,
  type CheckoutRequest,
} from "@/lib/payments/checkout";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { linkCustomerUser, upsertUserIdFor, type SessionFacts } from "@/lib/public/identity";
import { identityInputSchema, type IdentityInput } from "@/lib/public/identity-schema";
import { COPY } from "@/lib/public/messages";
import {
  fromEngineClient,
  fromParse,
  publicFail,
  publicOk,
  type PublicCoreResult,
} from "@/lib/public/result";
import { checkActionThrottle, type ThrottleSubject } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, answersInputSchema, idSchema, normalizeEmail, type AnswerInput } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

/** The typed identity: its schema and type live in identity-schema.ts, which the browser's own check shares (G4c); re-exported for the cores and their tests. */
export { identityInputSchema, type IdentityInput };

/** The séance the client saw and its answers: the part every claim on a séance shares. */
export const claimTargetSchema = z.object({
  occurrenceId: idSchema,
  seenStartsAt: z.iso.datetime(),
  answers: answersInputSchema,
});

/** The WHOLE input of each core, `.strict()` (an extra key or a wrong type is refused before anything else, SEC-M15). */
export const buyAndBookInputSchema = claimTargetSchema
  .extend({ offerId: idSchema, identity: identityInputSchema, website: z.unknown().optional() })
  .strict();

/** The WHOLE input of a free registration, `.strict()`: a séance, answers, a typed identity and the honeypot. */
export const freeRegistrationInputSchema = claimTargetSchema
  .extend({ identity: identityInputSchema, website: z.unknown().optional() })
  .strict();

/** The WHOLE input of a held-ticket booking, `.strict()`: no identity field at all, the Owner is the identity. */
export const heldTicketInputSchema = claimTargetSchema.strict();

export type BuyAndBookInput = {
  occurrenceId: string;
  offerId: string;
  seenStartsAt: string;
  identity: IdentityInput;
  answers: AnswerInput[];
  website?: string;
};
export type FreeRegistrationInput = {
  occurrenceId: string;
  seenStartsAt: string;
  identity: IdentityInput;
  answers: AnswerInput[];
  website?: string;
};
export type HeldTicketInput = { occurrenceId: string; seenStartsAt: string; answers: AnswerInput[] };

/** The honeypot (L786, L863): filled = anything but undefined or "" (SEC-M15); checked right after the shape parse, before any read or write. */
export function honeypotFilled(website: unknown): boolean {
  return website !== undefined && website !== "";
}

/** The identity to write: an Owner's session e-mail replaces the typed one (the field is read-only for them, L1353); name and phone as parsed (phone "" → null). */
export function identityOf(
  parsed: { name: string; email: string; phone?: string },
  visitor: Pick<ActionVisitor, "owner">,
): { name: string; email: string; phone: string | null } {
  return {
    name: parsed.name,
    email: visitor.owner ? normalizeEmail(visitor.owner.email) : parsed.email,
    phone: parsed.phone ? parsed.phone : null,
  };
}

/** SEC-I6: a verified identity (upsertUserIdFor(session, email) not null) → { kind: "user", userId }; else { kind: "email", email }. */
export function throttleSubjectOf(session: SessionFacts | null, email: string): ThrottleSubject {
  const userId = upsertUserIdFor(session, email);
  return userId === null ? { kind: "email", email } : { kind: "user", userId };
}

/** SEC-I1: live holds one séance may carry before buy + book refuses a typed address: Math.max(3, Math.ceil(capacity / 3)). */
export function holdCeiling(capacity: number): number {
  return Math.max(3, Math.ceil(capacity / 3));
}

/** A read, not a guard (a race lets one extra hold through, never a stranger's seat): live holds (status 'pending' and hold_expires_at > now) and the capacity of THIS pro's occurrence; null when not this pro's or unknown (the engine then answers not_found). */
export async function seatPressureOf(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  now: Date,
): Promise<{ liveHolds: number; capacity: number } | null> {
  const res = await db.execute<{ capacity: number; live_holds: number }>(sql`
    select o.capacity::int as capacity,
      (select count(*)::int from booking b
        where b.occurrence_id = o.id and b.professional_id = o.professional_id
          and b.status = 'pending' and b.hold_expires_at > ${ts(now)}) as live_holds
    from occurrence o
    where o.id = ${occurrenceId} and o.professional_id = ${professionalId}`);
  const row = res.rows[0];
  return row ? { liveHolds: Number(row.live_holds), capacity: Number(row.capacity) } : null;
}

/** The title of an event séance of this pro (the Checkout product name); null when it is not found. */
async function seanceTitleOf(db: Db, professionalId: string, occurrenceId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: event.title })
    .from(occurrence)
    .innerJoin(event, eq(event.id, occurrence.eventId))
    .where(
      and(
        eq(occurrence.id, occurrenceId),
        eq(occurrence.professionalId, professionalId),
        eq(event.professionalId, professionalId),
      ),
    );
  return row?.title ?? null;
}

/**
 * Best effort once a purchase exists (a pending purchase, and its held seat for a buy + book) and a later step THREW:
 * release the purchase, then close the Checkout session when Stripe has one, each in its own try so one failure never
 * hides the other. It never throws: the caller rethrows the ORIGINAL error, which runPublicActionWith answers as
 * PUBLIC_UNEXPECTED. Without this the seat stays held until the hold lapses, and the same typed address then gets
 * COPY.BUYBOOK_NOT_POSSIBLE. The release comes FIRST (P4 final review PAY-1): the session's URL never reached the
 * browser (a throw answers no URL), so nobody can pay it, and a hung Stripe or a function killed at its duration limit
 * must not keep the seat; a payment that still lands on the session is fulfilled from `expired` as a late payment
 * (fulfillPurchase, E10). The sync effect a release returns is dropped (nothing can run it after a throw): the next
 * calendar sync heals it. Logs carry no address and no session id (logSafeMessage).
 */
async function abandonPurchase(
  db: Db,
  deps: PublicDeps,
  purchaseId: string,
  sessionId: string | null,
  now: Date,
): Promise<void> {
  try {
    await releasePurchase(db, purchaseId, now);
  } catch (err) {
    console.error("[public] purchase release failed: " + logSafeMessage(err));
  }
  if (sessionId !== null) {
    try {
      await deps.checkout.expire(sessionId);
    } catch (err) {
      console.error("[public] checkout expire failed: " + logSafeMessage(err));
    }
  }
}

/**
 * Steps 10 and 11 of E1 and E9: the Checkout session, then its attachment to the purchase. A throw from the
 * gateway releases the purchase at once (COPY.CHECKOUT_FAILED, L814); a refused attachment (the purchase is no
 * longer pending) releases the purchase, then expires the session, and answers « stale ». The seat of a buy + book
 * comes back in both cases and its sync effect is returned with the failure. Logs carry no address or session id.
 * Anything else that THROWS here (the attach UPDATE, a release) releases the purchase and closes the session that
 * exists, best effort (abandonPurchase), then rethrows. The URL leaves this function only in its success answer, so
 * every path that expires a session here released the purchase first (P4 final review PAY-1, see abandonPurchase).
 */
export async function createCheckoutAndAttach(
  db: Db,
  deps: PublicDeps,
  request: CheckoutRequest,
  // The client wording of a refused attachment: the séance buy + book, the shop, or an RDV buy (P5 T8).
  context: "buybook" | "shop" | "rdv",
  businessName: string,
  now: Date,
): Promise<PublicCoreResult<{ purchaseId: string; checkoutUrl: string }>> {
  // The session Stripe handed out, until the code below has closed it itself: what a throw must close.
  let openSessionId: string | null = null;
  try {
    let created: CheckoutCreated;
    try {
      created = await deps.checkout.create(request);
    } catch (err) {
      console.error("[public] checkout create failed: " + logSafeMessage(err));
      const rel = await releasePurchase(db, request.purchaseId, now);
      return publicFail(COPY.CHECKOUT_FAILED, { effects: rel.ok ? rel.effects : [] });
    }
    openSessionId = created.sessionId;
    const attached = await attachCheckoutSession(
      db,
      { purchaseId: request.purchaseId, checkoutSessionId: created.sessionId, checkoutUrl: created.url },
      now,
    );
    if (!attached.ok) {
      // The URL was never handed out: free the seat first, then close the session (a throwing release leaves the
      // session open for abandonPurchase to close).
      const rel = await releasePurchase(db, request.purchaseId, now);
      openSessionId = null;
      try {
        await deps.checkout.expire(created.sessionId);
      } catch (err) {
        console.error("[public] checkout expire failed: " + logSafeMessage(err));
      }
      return fromEngineClient(fail("stale"), context, { businessName }, rel.ok ? rel.effects : []);
    }
    return publicOk({ purchaseId: request.purchaseId, checkoutUrl: created.url });
  } catch (err) {
    await abandonPurchase(db, deps, request.purchaseId, openSessionId, now);
    throw err;
  }
}

/** E1 (L778-823): shape, honeypot, payment availability, throttle "buybook", seat pressure, upsertCustomer, startBuyAndBook, Checkout session, attachCheckoutSession; a Stripe failure or a refused attach releases the seat at once, and so does a throw once the seat is held (rethrown after the release). */
export async function startBuyAndBookCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  deps: PublicDeps,
  now: Date,
): Promise<PublicCoreResult<{ purchaseId: string; checkoutUrl: string }>> {
  // 1. The whole input, strict: a malformed call reads and writes nothing.
  const parsed = parseFr(buyAndBookInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const data = parsed.data;

  // 2. The honeypot: refused before any throttle, read or write.
  if (honeypotFilled(data.website)) return publicFail(COPY.HONEYPOT_REFUSED);

  // 3. The identity to write (an Owner's session address wins) and who is rate limited.
  const vars = { businessName: pro.businessName };
  const identity = identityOf(data.identity, visitor);
  const subject = throttleSubjectOf(visitor.session, identity.email);

  // 4. A simulated payment outside its allowance (Stripe on, or production): nothing is written.
  if (deps.checkout.mode === "mock" && !deps.mockAllowed) return publicFail(COPY.PAYMENT_UNAVAILABLE);

  // 5. The throttle, before any write or gateway call (SEC-I1, SEC-I2).
  const allowed = await checkActionThrottle(
    db,
    {
      action: "buybook",
      professionalId: pro.professionalId,
      ipHash: visitor.ipHash,
      wideIpHash: visitor.wideIpHash,
      subject,
      occurrenceId: data.occurrenceId,
    },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  // 6. Seat pressure: a typed address costs nothing to make up, so a séance at its hold ceiling refuses it (SEC-I1).
  if (subject.kind === "email") {
    const pressure = await seatPressureOf(db, pro.professionalId, data.occurrenceId, now);
    if (pressure && pressure.liveHolds >= holdCeiling(pressure.capacity)) return publicFail(COPY.TOO_MANY_PAYMENTS);
  }

  // 7. The customer row identifies who the purchase is for; it authorises nothing. The account is linked only
  // for a verified session of this very address (upsertUserIdFor, enforced again in SQL).
  const { customerId } = await upsertCustomer(
    db,
    {
      professionalId: pro.professionalId,
      email: identity.email,
      name: identity.name,
      phone: identity.phone,
      userId: subject.kind === "user" ? subject.userId : null,
    },
    now,
  );

  // 8. The engine: seat held, purchase pending. For a typed address the two refusals that depend on another
  // customer's state say the same neutral sentence, without a code (Decision 64).
  const res = await startBuyAndBook(
    db,
    {
      professionalId: pro.professionalId,
      occurrenceId: data.occurrenceId,
      customerId,
      offerId: data.offerId,
      seenStartsAt: new Date(data.seenStartsAt),
      answers: data.answers,
    },
    now,
  );
  if (!res.ok) {
    if (subject.kind === "email" && (res.code === "already_booked" || res.code === "too_many_holds")) {
      return publicFail(COPY.BUYBOOK_NOT_POSSIBLE);
    }
    return fromEngineClient(res, "buybook", vars);
  }

  // 9 and 10. The product name shown on the Checkout page, then the request (31 minutes, computed right before the
  // call, L808). The seat is held from here on: a throw before the Checkout session exists releases it (a throw
  // later is createCheckoutAndAttach's to clean up).
  let request: CheckoutRequest;
  try {
    const title = await seanceTitleOf(db, pro.professionalId, data.occurrenceId);
    const productName = title === null ? res.label : `${title} · ${res.label}`;
    request = {
      kind: "buybook",
      purchaseId: res.purchaseId,
      amountCents: res.amountCents,
      currency: res.currency,
      productName,
      customerEmail: identity.email,
      env: deps.env,
      ...checkoutUrls(deps.appUrl, {
        kind: "buybook",
        slug: pro.slug,
        purchaseId: res.purchaseId,
        occurrenceId: data.occurrenceId,
      }),
      expiresAt: buybookCheckoutExpiry(Date.now()),
    };
  } catch (err) {
    await abandonPurchase(db, deps, res.purchaseId, null, now);
    throw err;
  }

  // 11. The Checkout session, then its attachment.
  return createCheckoutAndAttach(db, deps, request, "buybook", pro.businessName, now);
}

/** Server-side only, never returned to the browser: the id of this customer's active booking on the séance (Decision 64). */
export async function activeBookingIdOf(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  customerId: string,
  now: Date,
): Promise<string | null> {
  const [row] = await db
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.professionalId, professionalId),
        eq(booking.occurrenceId, occurrenceId),
        eq(booking.customerId, customerId),
        inArray(booking.status, ["pending", "confirmed"]),
        or(eq(booking.status, "confirmed"), gt(booking.holdExpiresAt, now)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Seats a NEW claim would find on this pro's séance, the way the engine's batch counts them: capacity minus seats_taken,
 * the elapsed pending holds counting as free because R(o) releases them before SEAT. A refused batch rolls back, so after
 * `already_booked` those holds are still in seats_taken. null when this pro has no such séance.
 */
async function seatsLeftOf(db: Db, professionalId: string, occurrenceId: string, now: Date): Promise<number | null> {
  const res = await db.execute<{ seats_left: number }>(sql`
    select (o.capacity - o.seats_taken
      + (select count(*)::int from booking b
          where b.occurrence_id = o.id and b.professional_id = o.professional_id
            and b.status = 'pending' and b.hold_expires_at < ${ts(now)}))::int as seats_left
    from occurrence o
    where o.id = ${occurrenceId} and o.professional_id = ${professionalId}`);
  const row = res.rows[0];
  return row ? Number(row.seats_left) : null;
}

/**
 * E3 (L860-865): shape, honeypot, throttle "free", upsertCustomer, registerFree. For a typed address `already_booked` is
 * answered as a NEW address would be on this séance, a success or « Complet » when no seat is left (Decision 64).
 */
export async function registerFreeCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  now: Date,
): Promise<PublicCoreResult<object>> {
  // 1. The whole input, strict: a malformed call reads and writes nothing.
  const parsed = parseFr(freeRegistrationInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const data = parsed.data;

  // 2. The honeypot.
  if (honeypotFilled(data.website)) return publicFail(COPY.HONEYPOT_REFUSED);

  // 3. The identity to write and who is rate limited.
  const identity = identityOf(data.identity, visitor);
  const subject = throttleSubjectOf(visitor.session, identity.email);

  // 4. The throttle, with the séance: the per-séance and per-pro IP keys apply (SEC-I1).
  const allowed = await checkActionThrottle(
    db,
    {
      action: "free",
      professionalId: pro.professionalId,
      ipHash: visitor.ipHash,
      wideIpHash: visitor.wideIpHash,
      subject,
      occurrenceId: data.occurrenceId,
    },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  // 5. The customer row identifies who registers; it authorises nothing (same userId rule as E1).
  const { customerId } = await upsertCustomer(
    db,
    {
      professionalId: pro.professionalId,
      email: identity.email,
      name: identity.name,
      phone: identity.phone,
      userId: subject.kind === "user" ? subject.userId : null,
    },
    now,
  );

  // 6. The engine. For a typed address an existing registration looks exactly like what a NEW address would get on
  // this séance (Decision 64); only the inbox owner gets the confirmation of the EXISTING booking again.
  const vars = { businessName: pro.businessName };
  const res = await registerFree(
    db,
    {
      professionalId: pro.professionalId,
      occurrenceId: data.occurrenceId,
      customerId,
      seenStartsAt: new Date(data.seenStartsAt),
      answers: data.answers,
    },
    now,
  );
  if (res.ok) return publicOk({}, res.effects);
  if (res.code === "already_booked" && subject.kind === "email") {
    // The engine tests « already booked » BEFORE the seat (claims.ts: assertNotBooked, then SEAT), so on a full séance a
    // registered address would pass where a fresh one is told « Complet »: that difference alone would say who attends.
    // The two reads do not depend on each other and run together: one round trip, so the registered address takes no
    // longer than a fresh one would (the Decision 64 timing residual).
    const [existing, left] = await Promise.all([
      activeBookingIdOf(db, pro.professionalId, data.occurrenceId, customerId, now),
      seatsLeftOf(db, pro.professionalId, data.occurrenceId, now),
    ]);
    const effects: Effect[] = existing === null ? [] : [{ type: "email.booking_confirmed", bookingId: existing }];
    if (left !== null && left < 1) return fromEngineClient(fail("full"), "free", vars, effects);
    return publicOk({}, effects);
  }
  return fromEngineClient(res, "free", vars);
}

/**
 * E2 client (L825-858): ONLY for an Owner (OUT:75), never a typed e-mail nor a guest cookie; throttle "held"; then the
 * Owner's account is linked to her customer row (L1345) and bookWithHeldTicket runs with the owner's customer and user.
 * The link is written here, after the parse, the Owner check and the throttle, and not by the wrapper: a malformed or
 * throttled call writes nothing (contract § 1 Validation, Revision 3.2).
 */
export async function bookWithHeldTicketCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  now: Date,
): Promise<PublicCoreResult<{ bookingId: string }>> {
  // 1. The whole input, strict: there is no identity field to smuggle an address into.
  const parsed = parseFr(heldTicketInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const data = parsed.data;

  // 2. Only a verified, non-impersonated Owner of THIS pro spends tickets (OUT:75, COV-I11): a guest cookie, an
  // unverified or impersonated session and an Owner of another pro all end here.
  const owner = visitor.owner;
  if (!owner || owner.professionalId !== pro.professionalId) return publicFail(COPY.CONFIRM_EMAIL_TO_SPEND);

  // 3. The throttle on her user key: the ticket comes back on every cancellation, so the wallet bounds nothing (SEC-I2).
  const allowed = await checkActionThrottle(
    db,
    {
      action: "held",
      professionalId: pro.professionalId,
      ipHash: visitor.ipHash,
      wideIpHash: visitor.wideIpHash,
      subject: { kind: "user", userId: owner.userId },
    },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  // 4. Link her account to her own customer row (L1345), only now: the input is valid and the throttle let her through.
  // linkCustomerUser fills a null user_id of this pro's row for a verified user of the same address, nothing else.
  await linkCustomerUser(db, owner, now);

  // 5. The engine, with the Owner's customer and user, never anything typed.
  const res = await bookWithHeldTicket(
    db,
    {
      professionalId: pro.professionalId,
      occurrenceId: data.occurrenceId,
      customerId: owner.customerId,
      seenStartsAt: new Date(data.seenStartsAt),
      answers: data.answers,
      actorUserId: owner.userId,
    },
    now,
  );
  if (!res.ok) return fromEngineClient(res, "held", { businessName: pro.businessName });
  return publicOk({ bookingId: res.bookingId }, res.effects);
}
