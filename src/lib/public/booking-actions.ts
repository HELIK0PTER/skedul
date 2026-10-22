/**
 * Public bookings and purchases of an event séance (spec § 11 E1, E2, E3) as testable cores. Every core
 * validates the WHOLE input first (parseFr on a strict schema), then refuses in a fixed order (honeypot,
 * payment availability, throttle, seat pressure) BEFORE its first write, then calls the engine with the pro of
 * the page slug (PublicPro), never with anything taken from the input. A core never reads a session or a
 * cookie: the wrapper (src/server/public-context.ts) builds the ActionVisitor. No server-only, no next/*.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { attachCheckoutSession, startBuyAndBook } from "@/lib/booking/claims";
import { releasePurchase } from "@/lib/booking/release";
import { fail } from "@/lib/booking/types";
import { upsertCustomer } from "@/lib/booking/wallet";
import { ts, type Db } from "@/lib/db/atomic";
import { event, occurrence } from "@/lib/db/schema";
import { logSafeMessage } from "@/lib/log-safe";
import {
  buybookCheckoutExpiry,
  checkoutUrls,
  type CheckoutCreated,
  type CheckoutRequest,
} from "@/lib/payments/checkout";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { upsertUserIdFor, type SessionFacts } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { plainNameSchema } from "@/lib/public/plain-name";
import {
  fromEngineClient,
  fromParse,
  publicFail,
  publicOk,
  type PublicCoreResult,
} from "@/lib/public/result";
import { checkActionThrottle, type ThrottleSubject } from "@/lib/throttle";
import {
  ENGINE_ERROR_MESSAGES,
  answersInputSchema,
  customerInputSchema,
  idSchema,
  normalizeEmail,
  type AnswerInput,
} from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

/** What the client sends as its identity (parsed by the strict schema below). */
export type IdentityInput = { name: string; email: string; phone?: string };

/** Strict typed identity (SEC-M15, SEC-M9, OUT:91): name plainNameSchema; email z.string().trim().pipe(customerInputSchema.shape.email); phone customerInputSchema.shape.phone; no other key. */
export const identityInputSchema = z
  .object({
    name: plainNameSchema,
    email: z.string().trim().pipe(customerInputSchema.shape.email),
    phone: customerInputSchema.shape.phone,
  })
  .strict();

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

export type BuyAndBookInput = {
  occurrenceId: string;
  offerId: string;
  seenStartsAt: string;
  identity: IdentityInput;
  answers: AnswerInput[];
  website?: string;
};

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
 * Steps 10 and 11 of E1 and E9: the Checkout session, then its attachment to the purchase. A throw from the
 * gateway releases the purchase at once (COPY.CHECKOUT_FAILED, L814); a refused attachment (the purchase is no
 * longer pending) expires the session, releases the purchase and answers « stale ». The seat of a buy + book
 * comes back in both cases and its sync effect is returned with the failure. Logs carry no address or session id.
 */
export async function createCheckoutAndAttach(
  db: Db,
  deps: PublicDeps,
  request: CheckoutRequest,
  context: "buybook" | "shop",
  businessName: string,
  now: Date,
): Promise<PublicCoreResult<{ purchaseId: string; checkoutUrl: string }>> {
  let created: CheckoutCreated;
  try {
    created = await deps.checkout.create(request);
  } catch (err) {
    console.error("[public] checkout create failed: " + logSafeMessage(err));
    const rel = await releasePurchase(db, request.purchaseId, now);
    return publicFail(COPY.CHECKOUT_FAILED, { effects: rel.ok ? rel.effects : [] });
  }
  const attached = await attachCheckoutSession(
    db,
    { purchaseId: request.purchaseId, checkoutSessionId: created.sessionId, checkoutUrl: created.url },
    now,
  );
  if (!attached.ok) {
    try {
      await deps.checkout.expire(created.sessionId);
    } catch (err) {
      console.error("[public] checkout expire failed: " + logSafeMessage(err));
    }
    const rel = await releasePurchase(db, request.purchaseId, now);
    return fromEngineClient(fail("stale"), context, { businessName }, rel.ok ? rel.effects : []);
  }
  return publicOk({ purchaseId: request.purchaseId, checkoutUrl: created.url });
}

/** E1 (L778-823): shape, honeypot, payment availability, throttle "buybook", seat pressure, upsertCustomer, startBuyAndBook, Checkout session, attachCheckoutSession; a Stripe failure or a refused attach releases the seat at once. */
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

  // 9. The product name shown on the Checkout page.
  const title = await seanceTitleOf(db, pro.professionalId, data.occurrenceId);
  const productName = title === null ? res.label : `${title} · ${res.label}`;

  // 10 and 11. The Checkout session (31 minutes, computed right before the call, L808), then its attachment.
  const request: CheckoutRequest = {
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
  return createCheckoutAndAttach(db, deps, request, "buybook", pro.businessName, now);
}
