/**
 * Taking a seat (spec § 11): E1 buy + book, E2 held ticket and pro « Inscrire »,
 * E3 free registration, E4 RDV libre. Every write is ONE tryAtomic batch:
 * lock first, in the global order of spec § 10 (E1 locks occurrence →
 * customer; only E4 and E6c also take the professional lock), R + SEAT once
 * per occurrence, every guard followed by an assert, ids made in the plan. The
 * engine never calls Stripe: E1 and E4 « buy » return the pending purchase;
 * the P4/P5 action creates the Checkout session, then attachCheckoutSession.
 */
import { and, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import { effectiveWindow, fitsAvailability, onlineBookability, type BookingWindow } from "@/lib/booking-window";
import {
  G,
  PlanError,
  R,
  SEAT,
  lockRows,
  releaseEndedSeats,
  ts,
  tryAtomic,
  type BatchCtx,
  type Db,
  type Query,
} from "@/lib/db/atomic";
import {
  availabilityRule,
  booking,
  customer,
  event,
  eventTicketType,
  occurrence,
  professional,
  ticket,
  ticketOffer,
  ticketPurchase,
  ticketType,
} from "@/lib/db/schema";
import { offerCovers, validityOf } from "@/lib/ticket-expiry";
import {
  BOUNDS,
  offerLabel,
  type Actor,
  type AnswerInput,
  type BookingCoverage,
  type BookingMode,
  type BookingStatus,
  type OccurrenceStatus,
  type ValidityUnit,
} from "@/lib/tickets";

import { buildAnswers, insertAnswers, loadQuestions } from "./answers";
import { assertSpent, spendTicket, usableTickets } from "./eligibility";
import { assertHoldQuota, checkoutExpiry, expireElapsedHolds, holdExpiry } from "./holds";
import { fail, failOf, syncEffects, type Effect, type EngineResult } from "./types";

/* ───────────────────────── Shared types ───────────────────────── */

/** What every client claim on an event séance carries. */
type ClientClaimBase = {
  professionalId: string;
  occurrenceId: string;
  /** from upsertCustomer (or the verified wallet owner) */
  customerId: string;
  /** occurrence.starts_at the client saw: G(starts_at = seen, 'changed') */
  seenStartsAt: Date;
  answers?: AnswerInput[];
  customerNotes?: string | null;
};

export type BuyAndBookInput = ClientClaimBase & { offerId: string };
export type BuyAndBookData = {
  purchaseId: string;
  bookingId: string;
  checkoutExpiresAt: Date;
  amountCents: number;
  currency: string;
  label: string;
  quantity: number;
  ticketTypeName: string;
};

/** Test-only hook: runs once between the first plan and its batch (deterministic races). */
type RaceOpts = { afterPlan?: () => Promise<void> };

/* ─────────────── Engine-internal helpers (also used by fulfillment.ts) ─────────────── */

/** Customer ids are per pro: a customer of another pro is not_found. */
export async function assertCustomer(db: Db, professionalId: string, customerId: string): Promise<void> {
  const [row] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId)));
  if (!row) throw new PlanError("not_found");
}

/** An offer of this pro with its type, read for a purchase snapshot. */
export type OfferRow = {
  offerId: string;
  ticketTypeId: string;
  ticketTypeName: string;
  /** offerLabel(): « À l'unité », « Carnet de 10 » or the pro's label */
  label: string;
  quantity: number;
  priceCents: number;
  validityCount: number | null;
  validityUnit: ValidityUnit | null;
  /** active, not archived, type not archived */
  onSale: boolean;
  rdvEnabled: boolean;
  rdvFree: boolean;
  /** the pro's currency and zone */
  currency: string;
  tz: string;
};

export async function readOffer(db: Db, professionalId: string, offerId: string): Promise<OfferRow | null> {
  const [row] = await db
    .select({
      offerId: ticketOffer.id,
      ticketTypeId: ticketOffer.ticketTypeId,
      ticketTypeName: ticketType.name,
      label: ticketOffer.label,
      quantity: ticketOffer.quantity,
      priceCents: ticketOffer.priceCents,
      validityCount: ticketOffer.validityCount,
      validityUnit: ticketOffer.validityUnit,
      isActive: ticketOffer.isActive,
      archivedAt: ticketOffer.archivedAt,
      typeArchivedAt: ticketType.archivedAt,
      rdvEnabled: ticketType.rdvEnabled,
      rdvFree: ticketType.rdvFree,
      currency: professional.currency,
      tz: professional.timezone,
    })
    .from(ticketOffer)
    .innerJoin(ticketType, eq(ticketType.id, ticketOffer.ticketTypeId))
    .innerJoin(professional, eq(professional.id, ticketOffer.professionalId))
    .where(and(eq(ticketOffer.id, offerId), eq(ticketOffer.professionalId, professionalId)));
  if (!row) return null;
  return {
    offerId: row.offerId,
    ticketTypeId: row.ticketTypeId,
    ticketTypeName: row.ticketTypeName,
    label: offerLabel({ label: row.label, quantity: row.quantity }),
    quantity: row.quantity,
    priceCents: row.priceCents,
    validityCount: row.validityCount,
    validityUnit: row.validityUnit,
    onSale: row.isActive && row.archivedAt === null && row.typeArchivedAt === null,
    rdvEnabled: row.rdvEnabled,
    rdvFree: row.rdvFree,
    currency: row.currency,
    tz: row.tz,
  };
}

/** Where the offer is used: linked to the séance's event (E1), the RDV type itself (E4), or the shop (E9). */
export type OfferScope =
  | { kind: "event"; occurrenceId: string }
  | { kind: "rdv"; ticketTypeId: string }
  | { kind: "shop" };

/**
 * The offer is still on sale with the snapshot the plan read (price,
 * quantity, validity) and still usable in `scope`. Asserted with 'stale'.
 */
export function offerUnchanged(o: OfferRow, professionalId: string, scope: OfferScope): SQL {
  const link =
    scope.kind === "event"
      ? sql`join occurrence o on o.id = ${scope.occurrenceId}
        join event_ticket_type l on l.event_id = o.event_id and l.ticket_type_id = f.ticket_type_id`
      : sql``;
  const rdv =
    scope.kind === "rdv"
      ? sql`and f.ticket_type_id = ${scope.ticketTypeId} and tt.rdv_enabled and not tt.rdv_free`
      : sql``;
  return sql`exists (
    select 1 from ticket_offer f
    join ticket_type tt on tt.id = f.ticket_type_id
    ${link}
    where f.id = ${o.offerId} and f.professional_id = ${professionalId}
      and f.is_active and f.archived_at is null and tt.archived_at is null
      and f.price_cents = ${o.priceCents}::int and f.quantity = ${o.quantity}::int
      and f.validity_count is not distinct from ${o.validityCount}::int
      and f.validity_unit is not distinct from ${o.validityUnit}::validity_unit
      ${rdv}
  )`;
}

/** INSERT ticket_purchase: pending, snapshot of the offer, the pro's currency. */
export function insertPurchase(
  c: BatchCtx,
  p: { id: string; professionalId: string; customerId: string; offer: OfferRow; checkoutExpiresAt: Date },
): Query {
  return c.db.insert(ticketPurchase).values({
    id: p.id,
    professionalId: p.professionalId,
    customerId: p.customerId,
    offerId: p.offer.offerId,
    ticketTypeId: p.offer.ticketTypeId,
    label: p.offer.label,
    quantity: p.offer.quantity,
    amountCents: p.offer.priceCents,
    currency: p.offer.currency,
    validityCount: p.offer.validityCount,
    validityUnit: p.offer.validityUnit,
    status: "pending",
    checkoutExpiresAt: p.checkoutExpiresAt,
    createdAt: c.now,
    updatedAt: c.now,
  });
}

/* ───────────────────────── Claim helpers ───────────────────────── */

/** Customer notes: trimmed, empty → null, at most BOUNDS.note characters. */
function cleanNotes(notes: string | null | undefined): string | null {
  const value = notes?.trim() ?? "";
  if (value.length > BOUNDS.note) throw new PlanError("invalid", "Votre message est trop long.");
  return value === "" ? null : value;
}

/** An EVENT séance of this pro, its event and the pro's settings. An RDV occurrence is not_found here. */
type EventTarget = {
  occurrenceId: string;
  eventId: string;
  startsAt: Date;
  status: OccurrenceStatus;
  bookingMode: BookingMode;
  isPrivate: boolean;
  archived: boolean;
  tz: string;
  window: BookingWindow;
};

async function readEventTarget(db: Db, professionalId: string, occurrenceId: string): Promise<EventTarget> {
  const [row] = await db
    .select({
      eventId: event.id,
      startsAt: occurrence.startsAt,
      status: occurrence.status,
      bookingMode: event.bookingMode,
      isPrivate: event.isPrivate,
      archivedAt: event.archivedAt,
      eventHorizonDays: event.bookingHorizonDays,
      eventNoticeMinutes: event.minNoticeMinutes,
      eventCancelHours: event.cancelDeadlineHours,
      tz: professional.timezone,
      bookingHorizonDays: professional.bookingHorizonDays,
      minNoticeMinutes: professional.minNoticeMinutes,
      cancelDeadlineHours: professional.cancelDeadlineHours,
    })
    .from(occurrence)
    .innerJoin(event, eq(event.id, occurrence.eventId))
    .innerJoin(professional, eq(professional.id, occurrence.professionalId))
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId)));
  if (!row) throw new PlanError("not_found");
  return {
    occurrenceId,
    eventId: row.eventId,
    startsAt: row.startsAt,
    status: row.status,
    bookingMode: row.bookingMode,
    isPrivate: row.isPrivate,
    archived: row.archivedAt !== null,
    tz: row.tz,
    window: effectiveWindow(
      {
        bookingHorizonDays: row.bookingHorizonDays,
        minNoticeMinutes: row.minNoticeMinutes,
        cancelDeadlineHours: row.cancelDeadlineHours,
      },
      {
        bookingHorizonDays: row.eventHorizonDays,
        minNoticeMinutes: row.eventNoticeMinutes,
        cancelDeadlineHours: row.eventCancelHours,
      },
    ),
  };
}

/** Plan-time twin of ONLINE_OK + CHANGED; the batch re-asserts both under the lock. */
function assertOnline(t: EventTarget, mode: "tickets" | "free", seenStartsAt: Date, now: Date): void {
  if (t.status !== "scheduled" || t.bookingMode !== mode || t.isPrivate || t.archived) {
    throw new PlanError("unavailable");
  }
  if (t.startsAt.getTime() !== seenStartsAt.getTime()) throw new PlanError("changed");
  if (!onlineBookability({ startsAt: t.startsAt, now, tz: t.tz, window: t.window }).ok) {
    throw new PlanError("unavailable");
  }
}

/**
 * ONLINE_OK(mode): the séance is open to online claims in `mode` (spec § 7):
 * scheduled, public, not archived, notice and local-date horizon (event
 * overrides, else the pro's), no overlapping time off. Asserted 'unavailable'.
 */
function onlineOk(c: BatchCtx, a: { professionalId: string; occurrenceId: string; mode: "tickets" | "free" }): SQL {
  return sql`exists (
    select 1 from occurrence o
    join event e on e.id = o.event_id
    join professional p on p.id = o.professional_id
    where o.id = ${a.occurrenceId} and o.professional_id = ${a.professionalId} and o.status = 'scheduled'
      and e.booking_mode = ${a.mode}::booking_mode and not e.is_private and e.archived_at is null
      and o.starts_at >= ${ts(c.now)} + make_interval(mins => coalesce(e.min_notice_minutes, p.min_notice_minutes))
      and (o.starts_at at time zone p.timezone)::date
          <= (${ts(c.now)} at time zone p.timezone)::date + coalesce(e.booking_horizon_days, p.booking_horizon_days)
      and not exists (select 1 from time_off t where t.professional_id = o.professional_id
                      and t.start_at < o.ends_at and t.end_at > o.starts_at)
  )`;
}

/** CHANGED: the séance still starts when the client saw it. Asserted 'changed'. */
function unchangedStart(occurrenceId: string, seenStartsAt: Date): SQL {
  return sql`(select starts_at from occurrence where id = ${occurrenceId}) = ${ts(seenStartsAt)}`;
}

/**
 * G(no active booking of this customer on o, 'already_booked'). Race-free:
 * every booking on o is inserted under o's lock. Place it after R(o) (so the
 * customer's own elapsed hold no longer counts) and before SEAT: otherwise a
 * double submit for the last seat would hit occurrence_seats_chk (« full »)
 * on the customer's own hold instead of reaching « already_booked ».
 */
export function assertNotBooked(c: BatchCtx, occurrenceId: string, customerId: string): Query {
  return G(
    c.db,
    sql`not exists (select 1 from booking
      where occurrence_id = ${occurrenceId} and customer_id = ${customerId} and status in ('pending', 'confirmed'))`,
    "already_booked",
  );
}

/** The offer's type is accepted by the séance's event (live link). */
async function offerLinkedToEvent(db: Db, offerId: string, eventId: string): Promise<boolean> {
  const rows = await db
    .select({ eventId: eventTicketType.eventId })
    .from(eventTicketType)
    .innerJoin(ticketOffer, eq(ticketOffer.ticketTypeId, eventTicketType.ticketTypeId))
    .where(and(eq(ticketOffer.id, offerId), eq(eventTicketType.eventId, eventId)));
  return rows.length > 0;
}

type NewBooking = {
  id: string;
  professionalId: string;
  occurrenceId: string;
  customerId: string;
  coverage: BookingCoverage;
  createdBy: Actor;
  customerNotes: string | null;
} & ({ status: "confirmed" } | { status: "pending"; purchaseId: string; holdExpiresAt: Date });

function insertBooking(c: BatchCtx, b: NewBooking): Query {
  return c.db.insert(booking).values({
    id: b.id,
    professionalId: b.professionalId,
    occurrenceId: b.occurrenceId,
    customerId: b.customerId,
    status: b.status,
    coverage: b.coverage,
    purchaseId: b.status === "pending" ? b.purchaseId : null,
    createdBy: b.createdBy,
    holdExpiresAt: b.status === "pending" ? b.holdExpiresAt : null,
    confirmedAt: b.status === "confirmed" ? c.now : null,
    customerNotes: b.customerNotes,
    createdAt: c.now,
    updatedAt: c.now,
  });
}

/* ───────────────────────── E1: buy + book ───────────────────────── */

/**
 * E1. Plan: séance scheduled and open online (tickets mode, public, not
 * archived, notice, horizon), seen start, offer on sale and linked, offer
 * validity covers the séance, answers. Batch: lock occurrence → customer,
 * R(o), G(not already booked), SEAT(o, +1), G(ONLINE_OK), G(CHANGED),
 * G(offer unchanged), hold quota, INSERT purchase (pending) and booking
 * (pending, hold), answers.
 * Effects: none (the action creates the Checkout session).
 */
export async function startBuyAndBook(
  db: Db,
  input: BuyAndBookInput,
  now: Date = new Date(),
  opts: RaceOpts = {},
): Promise<EngineResult<BuyAndBookData>> {
  const planned: { data?: BuyAndBookData } = {};
  const res = await tryAtomic(
    db,
    async () => {
      const notes = cleanNotes(input.customerNotes);
      const [target] = await Promise.all([
        readEventTarget(db, input.professionalId, input.occurrenceId),
        assertCustomer(db, input.professionalId, input.customerId),
      ]);
      assertOnline(target, "tickets", input.seenStartsAt, now);
      const [offer, linked, questions] = await Promise.all([
        readOffer(db, input.professionalId, input.offerId),
        offerLinkedToEvent(db, input.offerId, target.eventId),
        loadQuestions(db, { eventId: target.eventId }),
      ]);
      if (!offer) throw new PlanError("not_found");
      if (!offer.onSale || !linked) throw new PlanError("unavailable");
      if (!offerCovers(now, validityOf(offer), target.tz, target.startsAt)) throw new PlanError("offer_too_short");
      const answers = buildAnswers(questions, input.answers, { enforceRequired: true });
      if (!answers.ok) throw new PlanError("invalid", answers.message);
      const answerRows = answers.rows;

      const purchaseId = nanoid();
      const bookingId = nanoid();
      const checkoutExpiresAt = checkoutExpiry(now, "buybook");
      planned.data = {
        purchaseId,
        bookingId,
        checkoutExpiresAt,
        amountCents: offer.priceCents,
        currency: offer.currency,
        label: offer.label,
        quantity: offer.quantity,
        ticketTypeName: offer.ticketTypeName,
      };

      return (aid) => {
        const c: BatchCtx = { db, aid, now };
        const { professionalId, occurrenceId, customerId } = input;
        return [
          lockRows(db, "occurrence", [occurrenceId]),
          lockRows(db, "customer", [customerId]),
          R(c, occurrenceId),
          assertNotBooked(c, occurrenceId, customerId),
          SEAT(c, occurrenceId, 1),
          G(db, onlineOk(c, { professionalId, occurrenceId, mode: "tickets" }), "unavailable"),
          G(db, unchangedStart(occurrenceId, input.seenStartsAt), "changed"),
          G(db, offerUnchanged(offer, professionalId, { kind: "event", occurrenceId }), "stale"),
          assertHoldQuota(c, customerId),
          insertPurchase(c, { id: purchaseId, professionalId, customerId, offer, checkoutExpiresAt }),
          insertBooking(c, {
            id: bookingId,
            professionalId,
            occurrenceId,
            customerId,
            status: "pending",
            coverage: "ticket",
            purchaseId,
            holdExpiresAt: holdExpiry(now),
            createdBy: "client",
            customerNotes: notes,
          }),
          ...insertAnswers(c, { professionalId, bookingId, rows: answerRows }),
        ];
      };
    },
    { afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  if (!planned.data) throw new Error("startBuyAndBook: the plan produced no data");
  return { ok: true, effects: [], ...planned.data };
}

/**
 * After Stripe answered (E1, E4 buy, E9): one guarded UPDATE. A purchase that
 * is no longer pending → stale (the action then expires the session), and so
 * is one that already carries a DIFFERENT session: an attached session is
 * never replaced, re-attaching the same id is idempotent.
 *
 * Precondition: takes no professionalId, so `purchaseId` must come from the
 * engine result of this very action (startBuyAndBook, E4, E9), never from
 * client input.
 */
export async function attachCheckoutSession(
  db: Db,
  input: { purchaseId: string; checkoutSessionId: string; checkoutUrl: string },
  now: Date = new Date(),
): Promise<EngineResult> {
  const rows = await db
    .update(ticketPurchase)
    .set({ checkoutSessionId: input.checkoutSessionId, checkoutUrl: input.checkoutUrl, updatedAt: now })
    .where(
      and(
        eq(ticketPurchase.id, input.purchaseId),
        eq(ticketPurchase.status, "pending"),
        or(isNull(ticketPurchase.checkoutSessionId), eq(ticketPurchase.checkoutSessionId, input.checkoutSessionId)),
      ),
    )
    .returning({ id: ticketPurchase.id });
  return rows.length === 1 ? { ok: true, effects: [] } : fail("stale");
}

/**
 * « Reprendre le paiement »: the customer's active booking on the occurrence
 * (confirmed, or pending with a live hold at `now`). `purchaseId` while that
 * purchase is pending (« Libérer ma place »); `checkoutUrl` only while it is
 * pending AND its Checkout session is still open (checkout_expires_at > now).
 * The session closes at 31 min but the hold lasts 45 min: in between the URL
 * would be dead, so it is withheld.
 *
 * Precondition: takes no professionalId, so both ids must be server-derived
 * (the occurrence from the page being rendered, the customer from the
 * verified session or wallet owner), never a customerId resolved from an
 * e-mail typed by an anonymous visitor: the result exposes the Checkout URL.
 */
export async function activeBookingOf(
  db: Db,
  input: { occurrenceId: string; customerId: string },
  now: Date = new Date(),
): Promise<{ bookingId: string; status: BookingStatus; purchaseId: string | null; checkoutUrl: string | null } | null> {
  const [row] = await db
    .select({
      bookingId: booking.id,
      status: booking.status,
      purchaseId: ticketPurchase.id,
      purchaseStatus: ticketPurchase.status,
      checkoutUrl: ticketPurchase.checkoutUrl,
      checkoutExpiresAt: ticketPurchase.checkoutExpiresAt,
    })
    .from(booking)
    .leftJoin(ticketPurchase, eq(ticketPurchase.id, booking.purchaseId))
    .where(
      and(
        eq(booking.occurrenceId, input.occurrenceId),
        eq(booking.customerId, input.customerId),
        inArray(booking.status, ["pending", "confirmed"]),
        or(eq(booking.status, "confirmed"), gt(booking.holdExpiresAt, now)),
      ),
    );
  if (!row) return null;
  const pendingPurchase = row.purchaseStatus === "pending";
  const resumable =
    pendingPurchase && row.checkoutExpiresAt !== null && row.checkoutExpiresAt.getTime() > now.getTime();
  return {
    bookingId: row.bookingId,
    status: row.status,
    purchaseId: pendingPurchase ? row.purchaseId : null,
    checkoutUrl: resumable ? row.checkoutUrl : null,
  };
}

/* ───────────────── E2 / E3: held ticket, free registration, pro « Inscrire » ───────────────── */

/** Effects of a confirmed booking: the client always; the pro only when the client booked (spec § 13.6). */
function confirmedEffects(bookingId: string, occurrenceId: string, byClient: boolean): Effect[] {
  const effects: Effect[] = [{ type: "email.booking_confirmed", bookingId }];
  if (byClient) effects.push({ type: "email.pro_new_booking", bookingId });
  return [...effects, ...syncEffects([occurrenceId])];
}

async function bookedTicketOf(db: Db, bookingId: string): Promise<string> {
  const [row] = await db.select({ id: ticket.id }).from(ticket).where(eq(ticket.bookingId, bookingId));
  if (!row) throw new Error(`booking ${bookingId}: no booked ticket after a committed spend`);
  return row.id;
}

/**
 * E2 client: spend a held ticket on an event séance in `tickets` mode
 * (requireWalletOwner is the P4 action's job). Batch: lock occurrence, R,
 * G(not already booked), SEAT(+1), G(ONLINE_OK 'tickets'), G(CHANGED), INSERT
 * booking (confirmed, ticket), spend (SKIP LOCKED pick) + assertSpent, answers.
 */
export async function bookWithHeldTicket(
  db: Db,
  input: ClientClaimBase & { actorUserId: string | null },
  now: Date = new Date(),
): Promise<EngineResult<{ bookingId: string; ticketId: string }>> {
  const planned: { bookingId?: string } = {};
  const res = await tryAtomic(db, async () => {
    const notes = cleanNotes(input.customerNotes);
    const [target] = await Promise.all([
      readEventTarget(db, input.professionalId, input.occurrenceId),
      assertCustomer(db, input.professionalId, input.customerId),
    ]);
    assertOnline(target, "tickets", input.seenStartsAt, now);
    const answers = buildAnswers(await loadQuestions(db, { eventId: target.eventId }), input.answers, {
      enforceRequired: true,
    });
    if (!answers.ok) throw new PlanError("invalid", answers.message);
    const answerRows = answers.rows;
    const bookingId = nanoid();
    planned.bookingId = bookingId;

    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const { professionalId, occurrenceId, customerId } = input;
      return [
        lockRows(db, "occurrence", [occurrenceId]),
        R(c, occurrenceId),
        assertNotBooked(c, occurrenceId, customerId),
        SEAT(c, occurrenceId, 1),
        G(db, onlineOk(c, { professionalId, occurrenceId, mode: "tickets" }), "unavailable"),
        G(db, unchangedStart(occurrenceId, input.seenStartsAt), "changed"),
        insertBooking(c, {
          id: bookingId,
          professionalId,
          occurrenceId,
          customerId,
          status: "confirmed",
          coverage: "ticket",
          createdBy: "client",
          customerNotes: notes,
        }),
        spendTicket(c, {
          bookingId,
          customerId,
          occurrenceId,
          by: { actor: "client", userId: input.actorUserId },
        }),
        assertSpent(c, bookingId),
        ...insertAnswers(c, { professionalId, bookingId, rows: answerRows }),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  if (!planned.bookingId) throw new Error("bookWithHeldTicket: the plan produced no booking");
  const bookingId = planned.bookingId;
  return {
    ok: true,
    effects: confirmedEffects(bookingId, input.occurrenceId, true),
    bookingId,
    ticketId: await bookedTicketOf(db, bookingId),
  };
}

/**
 * E3: an event séance in `free` mode. Batch: lock occurrence, R,
 * G(not already booked), SEAT(+1), G(ONLINE_OK 'free'), G(CHANGED), INSERT
 * booking (confirmed, free), answers. One live registration per séance and
 * customer: booking_active_uq backs the guard.
 */
export async function registerFree(
  db: Db,
  input: ClientClaimBase,
  now: Date = new Date(),
): Promise<EngineResult<{ bookingId: string }>> {
  const planned: { bookingId?: string } = {};
  const res = await tryAtomic(db, async () => {
    const notes = cleanNotes(input.customerNotes);
    const [target] = await Promise.all([
      readEventTarget(db, input.professionalId, input.occurrenceId),
      assertCustomer(db, input.professionalId, input.customerId),
    ]);
    assertOnline(target, "free", input.seenStartsAt, now);
    const answers = buildAnswers(await loadQuestions(db, { eventId: target.eventId }), input.answers, {
      enforceRequired: true,
    });
    if (!answers.ok) throw new PlanError("invalid", answers.message);
    const answerRows = answers.rows;
    const bookingId = nanoid();
    planned.bookingId = bookingId;

    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const { professionalId, occurrenceId, customerId } = input;
      return [
        lockRows(db, "occurrence", [occurrenceId]),
        R(c, occurrenceId),
        assertNotBooked(c, occurrenceId, customerId),
        SEAT(c, occurrenceId, 1),
        G(db, onlineOk(c, { professionalId, occurrenceId, mode: "free" }), "unavailable"),
        G(db, unchangedStart(occurrenceId, input.seenStartsAt), "changed"),
        insertBooking(c, {
          id: bookingId,
          professionalId,
          occurrenceId,
          customerId,
          status: "confirmed",
          coverage: "free",
          createdBy: "client",
          customerNotes: notes,
        }),
        ...insertAnswers(c, { professionalId, bookingId, rows: answerRows }),
      ];
    };
  });
  if (!res.ok) return failOf(res);
  if (!planned.bookingId) throw new Error("registerFree: the plan produced no booking");
  const bookingId = planned.bookingId;
  return { ok: true, effects: confirmedEffects(bookingId, input.occurrenceId, true), bookingId };
}

/** Coverage of a pro registration: guest on any mode, else the event's mode (`none` needs « Invité »). */
function proCoverage(asGuest: boolean, mode: BookingMode): BookingCoverage {
  if (asGuest) return "guest";
  if (mode === "tickets") return "ticket";
  if (mode === "free") return "free";
  throw new PlanError("not_eligible");
}

/** registerPro guard: a scheduled séance of this pro whose mode still matches the coverage. */
function proRegistrationOk(a: { professionalId: string; occurrenceId: string; coverage: BookingCoverage }): SQL {
  return sql`exists (select 1 from occurrence o join event e on e.id = o.event_id
    where o.id = ${a.occurrenceId} and o.professional_id = ${a.professionalId} and o.status = 'scheduled'
      and (${a.coverage}::text = 'guest'
           or (${a.coverage}::text = 'ticket' and e.booking_mode = 'tickets')
           or (${a.coverage}::text = 'free' and e.booking_mode = 'free')))`;
}

/**
 * E2 pro « Inscrire » on an EVENT séance: past, private, outside notice and
 * horizon or under a time off are allowed; a cancelled séance is not. The pro
 * may force a ticket (still eligible) and add « +1 place » (extraSeat).
 * Required questions are not enforced. Effects: the client's confirmation and
 * the Google sync, never « nouvelle inscription » to the pro. Whatever the
 * coverage (guest included: booking_active_uq allows one live booking per
 * séance and customer), a customer already registered is already_booked, and
 * « +1 place » is not applied for them (guard before SEAT).
 */
export async function registerPro(
  db: Db,
  input: {
    professionalId: string;
    actorUserId: string;
    occurrenceId: string;
    customerId: string;
    asGuest: boolean;
    ticketId?: string | null;
    extraSeat?: boolean;
    answers?: AnswerInput[];
  },
  now: Date = new Date(),
): Promise<EngineResult<{ bookingId: string; coverage: BookingCoverage; ticketId: string | null }>> {
  const planned: { bookingId?: string; coverage?: BookingCoverage } = {};
  const res = await tryAtomic(db, async () => {
    const [target] = await Promise.all([
      readEventTarget(db, input.professionalId, input.occurrenceId),
      assertCustomer(db, input.professionalId, input.customerId),
    ]);
    if (target.status !== "scheduled") throw new PlanError("unavailable");
    const coverage = proCoverage(input.asGuest, target.bookingMode);
    const forced = input.ticketId ?? null;
    if (forced !== null) {
      if (coverage !== "ticket") throw new PlanError("invalid");
      const usable = await usableTickets(db, { customerId: input.customerId, occurrenceId: input.occurrenceId });
      if (!usable.some((t) => t.id === forced)) throw new PlanError("not_eligible");
    }
    const answers = buildAnswers(await loadQuestions(db, { eventId: target.eventId }), input.answers, {
      enforceRequired: false,
    });
    if (!answers.ok) throw new PlanError("invalid", answers.message);
    const answerRows = answers.rows;
    const bookingId = nanoid();
    planned.bookingId = bookingId;
    planned.coverage = coverage;

    return (aid) => {
      const c: BatchCtx = { db, aid, now };
      const { professionalId, occurrenceId, customerId } = input;
      const queries: Query[] = [
        lockRows(db, "occurrence", [occurrenceId]),
        R(c, occurrenceId),
        assertNotBooked(c, occurrenceId, customerId),
        SEAT(c, occurrenceId, 1, { extraSeat: input.extraSeat ?? false }),
        G(db, proRegistrationOk({ professionalId, occurrenceId, coverage }), "unavailable"),
        insertBooking(c, {
          id: bookingId,
          professionalId,
          occurrenceId,
          customerId,
          status: "confirmed",
          coverage,
          createdBy: "pro",
          customerNotes: null,
        }),
      ];
      if (coverage === "ticket") {
        queries.push(
          spendTicket(c, {
            bookingId,
            customerId,
            occurrenceId,
            ticketId: forced,
            by: { actor: "pro", userId: input.actorUserId },
          }),
          assertSpent(c, bookingId),
        );
      }
      queries.push(...insertAnswers(c, { professionalId, bookingId, rows: answerRows }));
      return queries;
    };
  });
  if (!res.ok) return failOf(res);
  const { bookingId, coverage } = planned;
  if (!bookingId || !coverage) throw new Error("registerPro: the plan produced no booking");
  return {
    ok: true,
    effects: confirmedEffects(bookingId, input.occurrenceId, false),
    bookingId,
    coverage,
    ticketId: coverage === "ticket" ? await bookedTicketOf(db, bookingId) : null,
  };
}

/* ───────────────────────── E4: RDV libre ───────────────────────── */

export type BookRdvInput = {
  professionalId: string;
  ticketTypeId: string;
  /** a slot start the P5 action took from the RDV slot loader */
  startsAt: Date;
  /**
   * For « held_ticket » (it spends this customer's ticket) this must be the
   * verified wallet owner (P4 requireWalletOwner), never a customer resolved
   * from an e-mail typed by an anonymous visitor (upsertCustomer).
   */
  customerId: string;
  answers?: AnswerInput[];
  customerNotes?: string | null;
  actorUserId: string | null;
} & ({ mode: "held_ticket" } | { mode: "free" } | { mode: "buy"; offerId: string });

export type BookRdvData = {
  occurrenceId: string;
  bookingId: string;
  purchaseId: string | null;
  checkoutExpiresAt: Date | null;
  amountCents: number | null;
};

/** An RDV type of this pro with its duration, buffers and effective window (type overrides, else the pro's). */
async function readRdvType(db: Db, professionalId: string, ticketTypeId: string) {
  const [row] = await db
    .select({
      rdvEnabled: ticketType.rdvEnabled,
      rdvFree: ticketType.rdvFree,
      durationMin: ticketType.rdvDurationMin,
      bufferBeforeMin: ticketType.rdvBufferBeforeMin,
      bufferAfterMin: ticketType.rdvBufferAfterMin,
      archivedAt: ticketType.archivedAt,
      typeHorizonDays: ticketType.rdvBookingHorizonDays,
      typeNoticeMinutes: ticketType.rdvMinNoticeMinutes,
      typeCancelHours: ticketType.rdvCancelDeadlineHours,
      tz: professional.timezone,
      bookingHorizonDays: professional.bookingHorizonDays,
      minNoticeMinutes: professional.minNoticeMinutes,
      cancelDeadlineHours: professional.cancelDeadlineHours,
    })
    .from(ticketType)
    .innerJoin(professional, eq(professional.id, ticketType.professionalId))
    .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId)));
  if (!row) throw new PlanError("not_found");
  return {
    rdvEnabled: row.rdvEnabled,
    rdvFree: row.rdvFree,
    durationMin: row.durationMin,
    bufferBeforeMin: row.bufferBeforeMin,
    bufferAfterMin: row.bufferAfterMin,
    archived: row.archivedAt !== null,
    tz: row.tz,
    window: effectiveWindow(
      {
        bookingHorizonDays: row.bookingHorizonDays,
        minNoticeMinutes: row.minNoticeMinutes,
        cancelDeadlineHours: row.cancelDeadlineHours,
      },
      {
        bookingHorizonDays: row.typeHorizonDays,
        minNoticeMinutes: row.typeNoticeMinutes,
        cancelDeadlineHours: row.typeCancelHours,
      },
    ),
  };
}

/** The type's own weekly hours when it has any, else the global ones (spec § 6.4 availability_rule). */
async function rdvRules(db: Db, professionalId: string, ticketTypeId: string) {
  const rows = await db
    .select({
      ticketTypeId: availabilityRule.ticketTypeId,
      dayOfWeek: availabilityRule.dayOfWeek,
      startMinute: availabilityRule.startMinute,
      endMinute: availabilityRule.endMinute,
    })
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, professionalId),
        or(eq(availabilityRule.ticketTypeId, ticketTypeId), isNull(availabilityRule.ticketTypeId)),
      ),
    );
  const own = rows.filter((r) => r.ticketTypeId === ticketTypeId);
  return own.length > 0 ? own : rows.filter((r) => r.ticketTypeId === null);
}

/** E4 type guard: still RDV-enabled, not archived, same free/paid nature. Asserted 'unavailable'. */
function rdvTypeOk(a: { professionalId: string; ticketTypeId: string; isFree: boolean }): SQL {
  return sql`exists (select 1 from ticket_type tt
    where tt.id = ${a.ticketTypeId} and tt.professional_id = ${a.professionalId}
      and tt.rdv_enabled and tt.archived_at is null and tt.rdv_free = ${a.isFree}::boolean)`;
}

/**
 * E4 slot guard: no scheduled event séance (private, `none` and empty ones
 * included) overlaps the block, no time off overlaps it, notice and local-date
 * horizon (type overrides, else the pro's). Asserted 'slot_taken'.
 */
function rdvSlotFree(
  c: BatchCtx,
  a: { professionalId: string; ticketTypeId: string; startsAt: Date; blockStart: Date; blockEnd: Date },
): SQL {
  return sql`not exists (select 1 from occurrence o
      where o.professional_id = ${a.professionalId} and o.event_id is not null and o.status = 'scheduled'
        and tstzrange(o.block_start, o.block_end) && tstzrange(${ts(a.blockStart)}, ${ts(a.blockEnd)}))
    and not exists (select 1 from time_off t
      where t.professional_id = ${a.professionalId} and t.start_at < ${ts(a.blockEnd)} and t.end_at > ${ts(a.blockStart)})
    and exists (select 1 from ticket_type tt join professional p on p.id = tt.professional_id
      where tt.id = ${a.ticketTypeId}
        and ${ts(a.startsAt)} >= ${ts(c.now)} + make_interval(mins => coalesce(tt.rdv_min_notice_minutes, p.min_notice_minutes))
        and (${ts(a.startsAt)} at time zone p.timezone)::date
            <= (${ts(c.now)} at time zone p.timezone)::date + coalesce(tt.rdv_booking_horizon_days, p.booking_horizon_days))`;
}

/**
 * E4. Plan: type rdv_enabled, not archived, free iff mode free; start
 * bookable (notice, horizon) and inside the weekly hours (fitsAvailability:
 * the type's rules, else the global ones); « buy »: offer of this type on
 * sale whose validity covers the start; answers (type questions, required
 * enforced). The slot-grid membership (computeSlots) is the P5 action's job.
 * Batch: lock professional → the overlapping scheduled RDVs (block range, id
 * asc) [→ customer for « buy »]; expire their elapsed holds and release the
 * seats in aggregate (an RDV at 0 is cancelled and leaves the EXCLUDE);
 * INSERT the RDV occurrence (capacity 1, seats_taken 1, block ± buffers:
 * occurrence_rdv_excl → slot_taken); G(type); G(slot); then held ticket
 * (booking confirmed + spend), free (booking confirmed, free) or buy (offer
 * unchanged, hold quota, purchase + pending booking). Answers.
 * Effects: held/free: confirmation, pro notice, Google; buy: none.
 */
export async function bookRdv(
  db: Db,
  input: BookRdvInput,
  now: Date = new Date(),
  opts: RaceOpts = {},
): Promise<EngineResult<BookRdvData>> {
  const planned: { data?: BookRdvData } = {};
  const res = await tryAtomic(
    db,
    async () => {
      const notes = cleanNotes(input.customerNotes);
      const [type] = await Promise.all([
        readRdvType(db, input.professionalId, input.ticketTypeId),
        assertCustomer(db, input.professionalId, input.customerId),
      ]);
      const isFree = input.mode === "free";
      if (!type.rdvEnabled || type.archived || type.rdvFree !== isFree || type.durationMin === null) {
        throw new PlanError("unavailable");
      }
      const startsAt = input.startsAt;
      const endsAt = new Date(startsAt.getTime() + type.durationMin * 60_000);
      const blockStart = new Date(startsAt.getTime() - type.bufferBeforeMin * 60_000);
      const blockEnd = new Date(endsAt.getTime() + type.bufferAfterMin * 60_000);
      if (!onlineBookability({ startsAt, now, tz: type.tz, window: type.window }).ok) {
        throw new PlanError("unavailable");
      }
      const [rules, questions, offer] = await Promise.all([
        rdvRules(db, input.professionalId, input.ticketTypeId),
        loadQuestions(db, { ticketTypeId: input.ticketTypeId }),
        input.mode === "buy" ? readOffer(db, input.professionalId, input.offerId) : Promise.resolve(null),
      ]);
      if (!fitsAvailability(rules, startsAt, endsAt, type.tz)) throw new PlanError("unavailable");
      let buy: OfferRow | null = null;
      if (input.mode === "buy") {
        if (!offer) throw new PlanError("not_found");
        if (!offer.onSale || offer.ticketTypeId !== input.ticketTypeId) throw new PlanError("unavailable");
        if (!offerCovers(now, validityOf(offer), type.tz, startsAt)) throw new PlanError("offer_too_short");
        buy = offer;
      }
      const answers = buildAnswers(questions, input.answers, { enforceRequired: true });
      if (!answers.ok) throw new PlanError("invalid", answers.message);
      const answerRows = answers.rows;

      const occurrenceId = nanoid();
      const bookingId = nanoid();
      const purchaseId = buy ? nanoid() : null;
      const checkoutExpiresAt = buy ? checkoutExpiry(now, "buybook") : null;
      planned.data = {
        occurrenceId,
        bookingId,
        purchaseId,
        checkoutExpiresAt,
        amountCents: buy ? buy.priceCents : null,
      };

      return (aid) => {
        const c: BatchCtx = { db, aid, now };
        const { professionalId, ticketTypeId, customerId } = input;
        const overlappingRdvs = sql`select id from occurrence
          where professional_id = ${professionalId} and event_id is null and status = 'scheduled'
            and tstzrange(block_start, block_end) && tstzrange(${ts(blockStart)}, ${ts(blockEnd)})`;
        const queries: Query[] = [
          lockRows(db, "professional", [professionalId]),
          db.execute(sql`${overlappingRdvs} order by id for no key update`),
        ];
        if (buy) queries.push(lockRows(db, "customer", [customerId]));
        queries.push(
          expireElapsedHolds(c, overlappingRdvs),
          releaseEndedSeats(c),
          db.insert(occurrence).values({
            id: occurrenceId,
            professionalId,
            eventId: null,
            ticketTypeId,
            seriesDate: null,
            startsAt,
            endsAt,
            blockStart,
            blockEnd,
            capacity: 1,
            seatsTaken: 1,
            status: "scheduled",
            createdAt: now,
            updatedAt: now,
          }),
          G(db, rdvTypeOk({ professionalId, ticketTypeId, isFree }), "unavailable"),
          G(db, rdvSlotFree(c, { professionalId, ticketTypeId, startsAt, blockStart, blockEnd }), "slot_taken"),
        );
        const base = { id: bookingId, professionalId, occurrenceId, customerId, createdBy: "client" as const, customerNotes: notes };
        if (input.mode === "held_ticket") {
          queries.push(
            insertBooking(c, { ...base, status: "confirmed", coverage: "ticket" }),
            spendTicket(c, {
              bookingId,
              customerId,
              occurrenceId,
              by: { actor: "client", userId: input.actorUserId },
            }),
            assertSpent(c, bookingId),
          );
        } else if (input.mode === "free") {
          queries.push(insertBooking(c, { ...base, status: "confirmed", coverage: "free" }));
        } else if (buy && purchaseId && checkoutExpiresAt) {
          queries.push(
            G(db, offerUnchanged(buy, professionalId, { kind: "rdv", ticketTypeId }), "stale"),
            assertHoldQuota(c, customerId),
            insertPurchase(c, { id: purchaseId, professionalId, customerId, offer: buy, checkoutExpiresAt }),
            insertBooking(c, {
              ...base,
              status: "pending",
              coverage: "ticket",
              purchaseId,
              holdExpiresAt: holdExpiry(now),
            }),
          );
        }
        queries.push(...insertAnswers(c, { professionalId, bookingId, rows: answerRows }));
        return queries;
      };
    },
    { afterPlan: opts.afterPlan },
  );
  if (!res.ok) return failOf(res);
  if (!planned.data) throw new Error("bookRdv: the plan produced no data");
  const data = planned.data;
  const effects = input.mode === "buy" ? [] : confirmedEffects(data.bookingId, data.occurrenceId, true);
  return { ok: true, effects, ...data };
}
