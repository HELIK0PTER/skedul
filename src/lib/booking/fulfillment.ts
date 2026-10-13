/**
 * E9 shop purchase and E10 fulfillment (spec § 11). Replaces the deleted
 * src/lib/payments.ts. Three callers deliver payments (P4): the Stripe webhook
 * (`checkout.session.completed` paid, `async_payment_succeeded`) and the mock
 * route. Money received ALWAYS yields tickets, even from `expired`; a booking
 * that ended is never resurrected; a duplicate delivery is a no-op.
 */
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  G,
  PlanError,
  lockRows,
  textArray,
  ts,
  tryAtomic,
  type BatchCtx,
  type Db,
  type Query,
} from "@/lib/db/atomic";
import { booking, professional, ticketPurchase } from "@/lib/db/schema";
import { bumpHealth, HEALTH_KEYS } from "@/lib/throttle";
import { ticketExpiry, validityOf } from "@/lib/ticket-expiry";

import { assertCustomer, insertPurchase, offerUnchanged, readOffer } from "./claims";
import { checkoutExpiry } from "./holds";
import { fail, failOf, syncEffects, type Effect, type EngineOk, type EngineResult } from "./types";

export type ShopPurchaseData = {
  purchaseId: string;
  checkoutExpiresAt: Date;
  amountCents: number;
  currency: string;
  label: string;
  quantity: number;
  ticketTypeName: string;
};

/**
 * E9. Plan: offer of this pro, on sale (active, not archived, type not
 * archived), customer of this pro. Batch: G(offer unchanged, 'stale'), INSERT
 * ticket_purchase (pending, snapshot, checkout_expires_at = now + 24 h). No
 * seat, no lock. Effects: none.
 */
export async function startPurchase(
  db: Db,
  input: { professionalId: string; offerId: string; customerId: string },
  now: Date = new Date(),
): Promise<EngineResult<ShopPurchaseData>> {
  const planned: { data?: ShopPurchaseData } = {};
  const res = await tryAtomic(db, async () => {
    const [offer] = await Promise.all([
      readOffer(db, input.professionalId, input.offerId),
      assertCustomer(db, input.professionalId, input.customerId),
    ]);
    if (!offer || !offer.onSale) throw new PlanError("not_found");
    const purchaseId = nanoid();
    const checkoutExpiresAt = checkoutExpiry(now, "shop");
    planned.data = {
      purchaseId,
      checkoutExpiresAt,
      amountCents: offer.priceCents,
      currency: offer.currency,
      label: offer.label,
      quantity: offer.quantity,
      ticketTypeName: offer.ticketTypeName,
    };
    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      return [
        G(db, offerUnchanged(offer, input.professionalId, { kind: "shop" }), "stale"),
        insertPurchase(c, {
          id: purchaseId,
          professionalId: input.professionalId,
          customerId: input.customerId,
          offer,
          checkoutExpiresAt,
        }),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  if (!planned.data) throw new Error("startPurchase: the plan produced no data");
  return { ok: true, effects: [], ...planned.data };
}

export type PaymentFacts = { sessionId: string | null; paymentIntentId: string | null; livemode: boolean };
export type FulfillOutcome = "fulfilled" | "duplicate" | "orphan";
type FulfillData = { outcome: FulfillOutcome; ticketIds: string[]; bookingConfirmed: boolean };

function noop(outcome: "duplicate" | "orphan"): EngineOk<FulfillData> {
  return { ok: true, effects: [], outcome, ticketIds: [], bookingConfirmed: false };
}

/**
 * The purchase's N tickets and their N `purchase` movements in ONE statement.
 * Ticket n° 1 is `booked` to the purchase's booking when that booking is
 * confirmed (by the previous statement of this batch); every other ticket is
 * `available`. One movement per ticket, never a `spend` (spec § 9).
 */
function insertPurchasedTickets(c: BatchCtx, purchaseId: string, ticketIds: readonly string[], expiresAt: Date | null): Query {
  const expiry = expiresAt ? ts(expiresAt) : sql`null::timestamptz`;
  return c.db.execute(sql`
    with b as (select id from booking where purchase_id = ${purchaseId} and status = 'confirmed'),
    t as (
      insert into ticket (id, professional_id, customer_id, ticket_type_id, purchase_id, status, booking_id,
        expires_at, status_changed_at, created_at, updated_at)
      select x.id, p.professional_id, p.customer_id, p.ticket_type_id, p.id,
        case when x.n = 1 and exists (select 1 from b) then 'booked'::ticket_status else 'available'::ticket_status end,
        case when x.n = 1 then (select id from b) else null end,
        ${expiry}, ${ts(c.now)}, ${ts(c.now)}, ${ts(c.now)}
      from unnest(${textArray(ticketIds)}) with ordinality as x(id, n)
      join ticket_purchase p on p.id = ${purchaseId}
      returning id, professional_id, customer_id, ticket_type_id, purchase_id, status, booking_id
    )
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status, to_status,
      ticket_type_id, booking_id, purchase_id, actor, created_at)
    select professional_id, customer_id, id, ${c.aid}, 'purchase', null, status, ticket_type_id, booking_id,
      purchase_id, 'system', ${ts(c.now)}
    from t`);
}

/**
 * E10. Plan: the purchase (+ the pro's zone, + its booking if any). Unknown
 * purchase → `orphan` (logged, health counter bumped; refund by hand in
 * Stripe). Already paid → `duplicate`. N ticket ids and expires_at
 * (ticketExpiry(now, snapshot, tz)) are computed in JS. Batch: lock the
 * booking, UPDATE purchase → paid FROM pending OR expired, G(fulfilled by
 * this aid, 'already_paid') (a concurrent duplicate raises here → no-op),
 * confirm a STILL pending booking, tickets + movements. Never fails on
 * business grounds; an unexpected error is thrown (the webhook answers 500,
 * Stripe retries).
 */
export async function fulfillPurchase(
  db: Db,
  purchaseId: string,
  payment: PaymentFacts,
  now: Date = new Date(),
): Promise<EngineOk<FulfillData>> {
  const [purchase] = await db
    .select({
      status: ticketPurchase.status,
      quantity: ticketPurchase.quantity,
      validityCount: ticketPurchase.validityCount,
      validityUnit: ticketPurchase.validityUnit,
      tz: professional.timezone,
    })
    .from(ticketPurchase)
    .innerJoin(professional, eq(professional.id, ticketPurchase.professionalId))
    .where(eq(ticketPurchase.id, purchaseId));
  if (!purchase) {
    console.warn(`[stripe] orphan payment ${payment.sessionId ?? "-"}/${payment.paymentIntentId ?? "-"}`);
    await bumpHealth(db, HEALTH_KEYS.orphanPayments, 1, now);
    return noop("orphan");
  }
  if (purchase.status === "paid") return noop("duplicate");

  const [held] = await db.select({ id: booking.id }).from(booking).where(eq(booking.purchaseId, purchaseId));
  const ticketIds = Array.from({ length: purchase.quantity }, () => nanoid());
  const expiresAt = ticketExpiry(now, validityOf(purchase), purchase.tz);

  const res = await tryAtomic(db, async () => (aid) => {
    const c: BatchCtx = { db, aid, now };
    const queries: Query[] = [];
    if (held) queries.push(lockRows(db, "booking", [held.id]));
    queries.push(
      db.execute(sql`
        update ticket_purchase set status = 'paid', paid_at = ${ts(now)}, livemode = ${payment.livemode}::boolean,
          checkout_session_id = coalesce(${payment.sessionId}::text, checkout_session_id),
          payment_intent_id = ${payment.paymentIntentId}::text, fulfilled_action_id = ${aid}, updated_at = ${ts(now)}
        where id = ${purchaseId} and status in ('pending', 'expired')`),
      G(db, sql`(select fulfilled_action_id from ticket_purchase where id = ${purchaseId}) = ${aid}`, "already_paid"),
      db.execute(sql`
        update booking set status = 'confirmed', confirmed_at = ${ts(now)}, updated_at = ${ts(now)}
        where purchase_id = ${purchaseId} and status = 'pending'`),
      insertPurchasedTickets(c, purchaseId, ticketIds, expiresAt),
    );
    return queries;
  });
  if (!res.ok) {
    if (res.code === "duplicate") return noop("duplicate");
    throw new Error(`fulfillPurchase ${purchaseId}: unexpected ${res.code}`);
  }

  const [after] = await db
    .select({ id: booking.id, confirmedAt: booking.confirmedAt, occurrenceId: booking.occurrenceId })
    .from(booking)
    .where(eq(booking.purchaseId, purchaseId));
  // Confirmed by THIS fulfillment (step 4 stamps confirmed_at = now), even if a cancellation already followed.
  const bookingConfirmed = after?.confirmedAt?.getTime() === now.getTime();
  const effects: Effect[] = [{ type: "email.purchase_receipt", purchaseId }];
  if (after && bookingConfirmed) {
    effects.push(
      { type: "email.booking_confirmed", bookingId: after.id },
      { type: "email.pro_new_booking", bookingId: after.id },
      ...syncEffects([after.occurrenceId]),
    );
  } else if (after) {
    effects.push({ type: "email.late_payment", purchaseId });
  }
  return { ok: true, effects, outcome: "fulfilled", ticketIds, bookingConfirmed };
}

/**
 * `checkout.session.completed` with payment_status `unpaid` (delayed method):
 * processing_at = now (first instant kept) while pending; the nightly job then
 * leaves the purchase alone. Not pending → stale.
 */
export async function markProcessing(db: Db, purchaseId: string, now: Date = new Date()): Promise<EngineResult> {
  const rows = await db.execute<{ id: string }>(sql`
    update ticket_purchase set processing_at = coalesce(processing_at, ${ts(now)}), updated_at = ${ts(now)}
    where id = ${purchaseId} and status = 'pending'
    returning id`);
  return rows.rows.length === 1 ? { ok: true, effects: [] } : fail("stale");
}
