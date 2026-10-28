/**
 * Public booking of an RDV libre slot (spec § 11 E4, P5 dossier § 3.5) as a testable core: a held ticket (an Owner of
 * this pro), a free booking (a « Gratuit » type) or a buy (a pending purchase holding the slot, then the Checkout
 * session). The step order of § 3.5 is binding: the WHOLE input is parsed first, then the refusals (honeypot, identity,
 * payment availability, throttle, the slot grid, the hold ceiling) come BEFORE the first write, then the engine runs with
 * the pro of the page slug, never with anything taken from the input. The engine's EXCLUDE settles two claims on one slot
 * (O1): the loser reads « Ce créneau vient d'être pris. ». No server-only, no next/*, no session read: the wrapper
 * (src/server/public.ts) builds the visitor.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { bookRdv, type BookRdvInput } from "@/lib/booking/claims";
import { lapsedHold } from "@/lib/booking/holds";
import { fail } from "@/lib/booking/types";
import { upsertCustomer } from "@/lib/booking/wallet";
import { ts, type Db } from "@/lib/db/atomic";
import { ticketOffer } from "@/lib/db/schema";
import { buybookCheckoutExpiry, checkoutUrls, type CheckoutRequest } from "@/lib/payments/checkout";
import {
  abandonPurchase,
  createCheckoutAndAttach,
  honeypotFilled,
  identityInputSchema,
  identityOf,
  throttleSubjectOf,
  type IdentityInput,
} from "@/lib/public/booking-actions";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { linkCustomerUser, type WalletOwner } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { rdvReturnHref } from "@/lib/public/rdv-form";
import { fromEngineClient, fromParse, publicFail, publicOk, type PublicCoreResult } from "@/lib/public/result";
import { checkRdvStart } from "@/lib/slots";
import { checkActionThrottle, type ThrottleSubject } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, answersInputSchema, idSchema, type AnswerInput } from "@/lib/tickets";
import { RDV_HOLD_CEILING } from "@/lib/tickets-vocab";
import { parseFr } from "@/lib/zod-fr";

/** A nanoid: the shape of every id the server renders (1 to 64 characters of [A-Za-z0-9_-]). */
const nanoidSchema = idSchema.regex(/^[A-Za-z0-9_-]+$/);

/**
 * The slot start as the server rendered it (`toISOString()`): an ISO instant in UTC, refined to whole seconds (its
 * milliseconds are zero). A start with milliseconds is no slot of any grid: it reads the same sentence as an off-grid
 * start (COPY.RDV_SLOT_GONE), and nothing is read or written.
 */
const slotStartSchema = z.iso.datetime().refine((value) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms % 1000 === 0;
}, COPY.RDV_SLOT_GONE);

/** What every mode names: the type, the slot start and the answers to the type's questions. */
const slotSchema = z.object({ ticketTypeId: nanoidSchema, startsAt: slotStartSchema, answers: answersInputSchema });

/**
 * The WHOLE input of bookRdvCore, a strict union on `mode` (SEC-M15): `held_ticket` has no identity field at all (the
 * Owner is the identity), `free` and `buy` carry the typed identity and the honeypot, `buy` names its offer.
 */
export const bookRdvInputSchema = z.discriminatedUnion("mode", [
  slotSchema.extend({ mode: z.literal("held_ticket") }).strict(),
  slotSchema.extend({ mode: z.literal("free"), identity: identityInputSchema, website: z.unknown().optional() }).strict(),
  slotSchema
    .extend({ mode: z.literal("buy"), offerId: idSchema, identity: identityInputSchema, website: z.unknown().optional() })
    .strict(),
]);

type RdvSlotInput = { ticketTypeId: string; startsAt: string; answers: AnswerInput[] };
/** What the RDV page sends (the wrapper splits the slug off). */
export type BookRdvActionInput =
  | (RdvSlotInput & { mode: "held_ticket" })
  | (RdvSlotInput & { mode: "free"; identity: IdentityInput; website?: string })
  | (RdvSlotInput & { mode: "buy"; offerId: string; identity: IdentityInput; website?: string });

/** A booked slot (held ticket, free) stays on the page; a buy leaves for the Checkout URL. */
export type BookRdvOutcome =
  | { kind: "booked"; bookingId: string }
  | { kind: "checkout"; purchaseId: string; checkoutUrl: string };

/**
 * Live RDV holds of this pro (a pending RDV booking whose hold has not lapsed: the engine's own rule, lapsedHold), for the
 * hold ceiling of a typed address (O23, the SEC-I1 analogue of seatPressureOf). A read, not a guard: a race lets one
 * extra hold through, never a stranger's slot.
 */
export async function rdvHoldPressureOf(db: Db, professionalId: string, now: Date): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from booking b
    join occurrence o on o.id = b.occurrence_id and o.professional_id = b.professional_id
    where b.professional_id = ${professionalId} and o.event_id is null
      and b.status = 'pending' and not ${lapsedHold(now, sql`b`)}`);
  return Number(res.rows[0]?.n ?? 0);
}

/** True when this pro has an offer with this id (any state: the engine answers the rest). */
async function isOfferOfPro(db: Db, professionalId: string, offerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ticketOffer.id })
    .from(ticketOffer)
    .where(and(eq(ticketOffer.id, offerId), eq(ticketOffer.professionalId, professionalId)));
  return row !== undefined;
}

/**
 * Server-side only: the purchase of THIS Owner's own live RDV hold on this slot (a pending booking whose hold has not
 * lapsed, its purchase pending, on this pro's scheduled RDV of this type at this start), or null. It names her own
 * purchase only, so the resume link it builds never reveals another customer's (P4 Decisions 64 and 71, O6).
 */
async function ownRdvHoldAt(
  db: Db,
  professionalId: string,
  customerId: string,
  ticketTypeId: string,
  startsAt: Date,
  now: Date,
): Promise<string | null> {
  const res = await db.execute<{ purchase_id: string }>(sql`
    select p.id as purchase_id from booking b
    join ticket_purchase p on p.id = b.purchase_id and p.professional_id = b.professional_id
    join occurrence o on o.id = b.occurrence_id and o.professional_id = b.professional_id
    where b.professional_id = ${professionalId} and b.customer_id = ${customerId}
      and o.event_id is null and o.ticket_type_id = ${ticketTypeId} and o.starts_at = ${ts(startsAt)}
      and o.status = 'scheduled' and p.status = 'pending'
      and b.status = 'pending' and not ${lapsedHold(now, sql`b`)}
    order by b.hold_expires_at desc, b.id
    limit 1`);
  return res.rows[0]?.purchase_id ?? null;
}

/** Who claims the slot: the Owner herself (held ticket), or a typed identity (free, buy; an Owner's session address wins). */
type Claimant =
  | { kind: "owner"; owner: WalletOwner; subject: ThrottleSubject }
  | { kind: "typed"; identity: { name: string; email: string; phone: string | null }; subject: ThrottleSubject };

/**
 * E4 public (P5 dossier § 3.5): parse, honeypot, identity, payment availability, throttle "rdv", the slot grid, the hold
 * ceiling of a typed buyer, then the customer row, the engine, and for a buy the Checkout session and its attachment.
 * `opts.afterPlan` is test-only: it runs between the engine's plan and its batch.
 */
export async function bookRdvCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  deps: PublicDeps,
  now: Date,
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<PublicCoreResult<BookRdvOutcome>> {
  // 1. The whole input, strict: a malformed call reads and writes nothing.
  const parsed = parseFr(bookRdvInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const data = parsed.data;
  const vars = { businessName: pro.businessName };
  const startsAt = new Date(data.startsAt);

  // 2. The honeypot of the typed forms: refused before any throttle, read or write.
  if (data.mode !== "held_ticket" && honeypotFilled(data.website)) return publicFail(COPY.HONEYPOT_REFUSED);

  // 3. Who claims the slot. Only a verified, non-impersonated Owner of THIS pro spends tickets (OUT:75, COV-I11): a guest
  // cookie, an unverified or impersonated session and an Owner of another pro end here. A typed identity is rate
  // limited on its user when verified, else on its address (SEC-I6).
  const owner = visitor.owner !== null && visitor.owner.professionalId === pro.professionalId ? visitor.owner : null;
  let claimant: Claimant;
  if (data.mode === "held_ticket") {
    if (owner === null) return publicFail(COPY.CONFIRM_EMAIL_TO_SPEND);
    claimant = { kind: "owner", owner, subject: { kind: "user", userId: owner.userId } };
  } else {
    const identity = identityOf(data.identity, visitor);
    claimant = { kind: "typed", identity, subject: throttleSubjectOf(visitor.session, identity.email) };
  }
  const subject = claimant.subject;

  // 4. A simulated payment outside its allowance (Stripe on, or production): nothing is written.
  if (data.mode === "buy" && deps.checkout.mode === "mock" && !deps.mockAllowed) return publicFail(COPY.PAYMENT_UNAVAILABLE);

  // 5. The throttle of every mode (spec L1273, O22), before any write: its per-pro IP key bounds the slots one address
  // can take at this pro.
  const allowed = await checkActionThrottle(
    db,
    {
      action: "rdv",
      professionalId: pro.professionalId,
      ipHash: visitor.ipHash,
      wideIpHash: visitor.wideIpHash,
      subject,
    },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  // 6. The slot grid (a read): a type this pro does not have, or a start that is no slot of its grid, writes nothing, not
  // even a customer row. Busy, notice and horizon are the engine's (a real conflict comes back as slot_taken). For a buy,
  // an offer this pro does not have is answered here too, before the customer row.
  const grid = await checkRdvStart(db, pro.professionalId, data.ticketTypeId, startsAt);
  if (grid === "not_found") return fromEngineClient(fail("not_found"), "rdv", vars);
  if (grid === "off_grid") return publicFail(COPY.RDV_SLOT_GONE, { code: "unavailable" });
  if (data.mode === "buy" && !(await isOfferOfPro(db, pro.professionalId, data.offerId))) {
    return fromEngineClient(fail("not_found"), "rdv", vars);
  }

  // 7. The hold ceiling: a typed address costs nothing to make up, so a pro at RDV_HOLD_CEILING live RDV holds refuses a
  // new one from it (O23); a verified identity is bounded by the engine's per-customer quota instead.
  if (data.mode === "buy" && subject.kind === "email") {
    if ((await rdvHoldPressureOf(db, pro.professionalId, now)) >= RDV_HOLD_CEILING) {
      return publicFail(COPY.RDV_TOO_MANY_PAYMENTS);
    }
  }

  // 8. The writes before the engine. The Owner's account is linked to her own row (L1345) only now; a typed identity gets
  // its customer row, which identifies who books and authorises nothing (the account is linked only for a verified
  // session of this very address, upsertUserIdFor, enforced again in SQL).
  let customerId: string;
  let actorUserId: string | null;
  if (claimant.kind === "owner") {
    await linkCustomerUser(db, claimant.owner, now);
    customerId = claimant.owner.customerId;
    actorUserId = claimant.owner.userId;
  } else {
    actorUserId = subject.kind === "user" ? subject.userId : null;
    ({ customerId } = await upsertCustomer(
      db,
      {
        professionalId: pro.professionalId,
        email: claimant.identity.email,
        name: claimant.identity.name,
        phone: claimant.identity.phone,
        userId: actorUserId,
      },
      now,
    ));
  }

  // 9. The engine: the slot's occurrence and its booking (and for a buy the pending purchase holding it), or a refusal.
  const base = {
    professionalId: pro.professionalId,
    ticketTypeId: data.ticketTypeId,
    startsAt,
    customerId,
    answers: data.answers,
    actorUserId,
  };
  const engineInput: BookRdvInput =
    data.mode === "buy" ? { ...base, mode: "buy", offerId: data.offerId } : { ...base, mode: data.mode };
  const res = await bookRdv(db, engineInput, now, { afterPlan: opts.afterPlan });

  // 10. The refusals. For a typed address a refusal that depends on another customer's state says a neutral sentence
  // (Decision 64). A taken slot is the same sentence for everyone; only a verified Owner refused by HER OWN live hold
  // gets the way back to it.
  if (!res.ok) {
    if (subject.kind === "email" && res.code === "too_many_holds") return publicFail(COPY.BUYBOOK_NOT_POSSIBLE);
    const refused = fromEngineClient(res, "rdv", vars);
    if (res.code === "slot_taken" && owner !== null) {
      const held = await ownRdvHoldAt(db, pro.professionalId, owner.customerId, data.ticketTypeId, startsAt, now);
      if (held !== null) return { ...refused, resumeHref: rdvReturnHref(pro.slug, data.ticketTypeId, held) };
    }
    return refused;
  }

  // 11. A held ticket or a free booking is confirmed: the page stays, with its effects (confirmation, pro notice, sync).
  if (data.mode !== "buy") return publicOk({ kind: "booked" as const, bookingId: res.bookingId }, res.effects);

  // 12. A buy: the Checkout request from the engine's own snapshot of the offer (31 minutes, computed right before the
  // call, card only: kind "buybook"). The slot is held from here on: a throw before the session exists releases it
  // (abandonPurchase); a throw later is createCheckoutAndAttach's to clean up.
  const purchaseId = res.purchaseId;
  if (purchaseId === null) throw new Error("bookRdvCore: a buy without its purchase");
  // A buy always has a typed identity (an Owner's own address when she is signed in): the Checkout pre-fills it.
  const buyerEmail = claimant.kind === "typed" ? claimant.identity.email : null;
  let request: CheckoutRequest;
  try {
    if (res.checkout === null || res.amountCents === null || buyerEmail === null) {
      throw new Error("bookRdvCore: a buy without its Checkout facts");
    }
    request = {
      kind: "buybook",
      purchaseId,
      amountCents: res.amountCents,
      currency: res.checkout.currency,
      productName: `${res.checkout.ticketTypeName} · ${res.checkout.label}`,
      customerEmail: buyerEmail,
      env: deps.env,
      ...checkoutUrls(deps.appUrl, { kind: "rdv", slug: pro.slug, purchaseId, ticketTypeId: data.ticketTypeId }),
      expiresAt: buybookCheckoutExpiry(Date.now()),
    };
  } catch (err) {
    await abandonPurchase(db, deps, purchaseId, null, now);
    throw err;
  }
  const checkout = await createCheckoutAndAttach(db, deps, request, "rdv", pro.businessName, now);
  if (!checkout.ok) return checkout;
  return publicOk({ kind: "checkout" as const, purchaseId: checkout.purchaseId, checkoutUrl: checkout.checkoutUrl }, checkout.effects);
}
