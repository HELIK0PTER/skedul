/**
 * The séance page reads (spec L1445-1455, Decisions 9, 21, 31, 63, 71, SEC-I6). Testable core: takes `db`, imports
 * neither server-only, next/* nor the db index. The pro comes from the slug on the server and every statement filters
 * `professional_id`. A viewer here is ONE server-derived customer (an Owner or the guest cookie's customer), never the
 * customer of a typed e-mail nor of a `?p=` reference (Decision 71): activeBookingOf and usableTickets take no
 * professional, so this module checks the customer and the occurrence against the pro before it calls them.
 */
import { and, asc, desc, eq, inArray, isNull, lte, gt, or, sql } from "drizzle-orm";

import { elapsedHoldsOf } from "@/lib/back-office/planning-reads";
import type { BookingWindow } from "@/lib/booking-window";
import { loadQuestions, type QuestionRow } from "@/lib/booking/answers";
import { activeBookingOf } from "@/lib/booking/claims";
import { usableTickets } from "@/lib/booking/eligibility";
import { walletBalance } from "@/lib/booking/wallet";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, eventTicketType, occurrence, ticketOffer, ticketPurchase, ticketType } from "@/lib/db/schema";
import { offerCovers, validityOf } from "@/lib/ticket-expiry";
import { idSchema, offerLabel, validityLabel, type BookingCoverage } from "@/lib/tickets";

import type { BoutiqueOffer } from "./boutique-reads";
import { acceptedTypesOf, publicSeanceOf, UNDER_TIME_OFF, type PublicSeance } from "./planning-reads";

export type PublicOfferChoice = BoutiqueOffer & {
  ticketTypeId: string;
  ticketTypeName: string;
  /** offerCovers(now, validityOf(offer), tz, startsAt): the tickets it sells are still valid at the séance */
  covers: boolean;
};

export type PublicSeanceDetail = PublicSeance & {
  kind: "seance";
  description: string | null;
  isPrivate: boolean;
  archived: boolean;
  /** loadQuestions({ eventId }) */
  questions: QuestionRow[];
  /** active, non-archived offers of the linked non-archived, non-rdv_free types (tickets mode only) */
  offers: PublicOfferChoice[];
};

type SeancePro = { professionalId: string; timezone: string; window: BookingWindow };

async function offersOf(
  db: Db,
  pro: SeancePro,
  eventId: string,
  startsAt: Date,
  now: Date,
): Promise<PublicOfferChoice[]> {
  const rows = await db
    .select({
      offerId: ticketOffer.id,
      label: ticketOffer.label,
      quantity: ticketOffer.quantity,
      priceCents: ticketOffer.priceCents,
      validityCount: ticketOffer.validityCount,
      validityUnit: ticketOffer.validityUnit,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
    })
    .from(ticketOffer)
    .innerJoin(ticketType, eq(ticketType.id, ticketOffer.ticketTypeId))
    .innerJoin(
      eventTicketType,
      and(eq(eventTicketType.ticketTypeId, ticketType.id), eq(eventTicketType.eventId, eventId)),
    )
    .where(
      and(
        eq(ticketOffer.professionalId, pro.professionalId),
        eq(ticketType.professionalId, pro.professionalId),
        eq(eventTicketType.professionalId, pro.professionalId),
        eq(ticketOffer.isActive, true),
        isNull(ticketOffer.archivedAt),
        isNull(ticketType.archivedAt),
        eq(ticketType.rdvFree, false),
      ),
    )
    .orderBy(
      asc(ticketType.position),
      asc(ticketType.createdAt),
      asc(ticketType.id),
      asc(ticketOffer.position),
      asc(ticketOffer.createdAt),
      asc(ticketOffer.id),
    );
  return rows.map((r) => ({
    offerId: r.offerId,
    label: offerLabel({ label: r.label, quantity: r.quantity }),
    quantity: r.quantity,
    priceCents: r.priceCents,
    validityText: validityLabel(r.validityCount, r.validityUnit),
    ticketTypeId: r.ticketTypeId,
    ticketTypeName: r.ticketTypeName,
    covers: offerCovers(now, validityOf(r), pro.timezone, startsAt),
  }));
}

/**
 * One occurrence of this pro: an event séance (any status, private and archived included: the page decides),
 * { kind: "rdv" } for an RDV, null when not this pro's, unknown or not an id.
 */
export async function getPublicSeance(
  db: Db,
  pro: SeancePro,
  occurrenceId: string,
  now: Date,
): Promise<PublicSeanceDetail | { kind: "rdv" } | null> {
  if (!idSchema.safeParse(occurrenceId).success) return null;
  const [row] = await db
    .select({
      occurrenceId: occurrence.id,
      occurrenceEventId: occurrence.eventId,
      eventId: event.id,
      title: event.title,
      description: event.description,
      color: event.color,
      eventLocation: event.location,
      bookingMode: event.bookingMode,
      isPrivate: event.isPrivate,
      archivedAt: event.archivedAt,
      eventHorizonDays: event.bookingHorizonDays,
      eventNoticeMinutes: event.minNoticeMinutes,
      eventCancelHours: event.cancelDeadlineHours,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      locationOverride: occurrence.locationOverride,
      status: occurrence.status,
      capacity: occurrence.capacity,
      seatsTaken: occurrence.seatsTaken,
      underTimeOff: sql<boolean>`${UNDER_TIME_OFF}`,
    })
    .from(occurrence)
    .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, pro.professionalId)))
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, pro.professionalId)));
  if (!row) return null;
  if (row.occurrenceEventId === null) return { kind: "rdv" };
  // The occurrence points at an event that is not this pro's (cannot happen): nothing to show.
  if (row.eventId === null || row.title === null || row.color === null || row.bookingMode === null) return null;

  const eventId = row.eventId;
  const bookingMode = row.bookingMode;
  const [elapsed, types, questions, offers] = await Promise.all([
    elapsedHoldsOf(db, pro.professionalId, [occurrenceId], now),
    bookingMode === "tickets"
      ? acceptedTypesOf(db, pro.professionalId, [eventId])
      : Promise.resolve(new Map<string, PublicSeance["acceptedTypes"]>()),
    loadQuestions(db, { eventId }),
    bookingMode === "tickets" ? offersOf(db, pro, eventId, row.startsAt, now) : Promise.resolve([]),
  ]);
  // The planning list's own mapper: the two pages never disagree on the seats, the place, the window or the time off.
  const seance = publicSeanceOf({ ...row, eventId, title: row.title, color: row.color, bookingMode }, elapsed, types, pro.window);
  return {
    kind: "seance",
    ...seance,
    description: row.description,
    isPrivate: row.isPrivate ?? false,
    archived: row.archivedAt !== null,
    questions,
    offers,
  };
}

export type SeanceVisitorFacts = {
  /** activeBookingOf; purchaseId and resumeUrl only for source "owner" (a guest cookie never receives a Checkout URL, Decision 63) */
  booking: {
    bookingId: string;
    status: "pending" | "confirmed";
    coverage: BookingCoverage;
    purchaseId: string | null;
    resumeUrl: string | null;
  } | null;
  /** no active booking: the status of this customer's latest booking on the séance when it ended (COV-M4a); source "owner" only */
  ended: "cancelled" | "expired" | null;
  /** source "owner" only: usableTickets[0]'s type; walletBalance(type).usable - 1 */
  usable: { typeName: string; leftAfter: number } | null;
};

const noFacts = (): SeanceVisitorFacts => ({ booking: null, ended: null, usable: null });

/**
 * The state of ONE server-derived customer of this pro on this séance: an Owner or a guest cookie customer, never a
 * typed e-mail nor the customer of a ?p= reference (Decision 71); for "guest" only the booking is filled, and its
 * purchaseId and resumeUrl stay null (no wallet, no ended state); empty facts when the customer or the séance is not
 * this pro's. A pending booking whose hold has lapsed is an ended one (« expired »): the page never waits for the sweep.
 */
export async function seanceVisitorFacts(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  viewer: { customerId: string; source: "owner" | "guest" },
  now: Date,
): Promise<SeanceVisitorFacts> {
  const { customerId } = viewer;
  const [[mine], [seance]] = await Promise.all([
    db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId))),
    db
      .select({ id: occurrence.id })
      .from(occurrence)
      .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId))),
  ]);
  if (!mine || !seance) return noFacts();

  const active = await activeBookingOf(db, { occurrenceId, customerId }, now);
  let activeFacts: SeanceVisitorFacts["booking"] = null;
  if (active) {
    const [row] = await db
      .select({ coverage: booking.coverage })
      .from(booking)
      .where(and(eq(booking.id, active.bookingId), eq(booking.professionalId, professionalId)));
    if (row) {
      activeFacts = {
        bookingId: active.bookingId,
        status: active.status === "pending" ? "pending" : "confirmed",
        coverage: row.coverage,
        purchaseId: viewer.source === "owner" ? active.purchaseId : null,
        resumeUrl: viewer.source === "owner" ? active.checkoutUrl : null,
      };
    }
  }
  if (viewer.source === "guest") return { booking: activeFacts, ended: null, usable: null };

  const [ended, usable] = await Promise.all([
    activeFacts === null ? endedStatusOf(db, professionalId, occurrenceId, customerId, now) : Promise.resolve(null),
    usableFor(db, professionalId, occurrenceId, customerId, now),
  ]);
  return { booking: activeFacts, ended, usable };
}

/** The latest ended booking of this customer on the séance: cancelled, expired, or a hold that lapsed (« expired »). */
async function endedStatusOf(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  customerId: string,
  now: Date,
): Promise<"cancelled" | "expired" | null> {
  const [last] = await db
    .select({ status: booking.status })
    .from(booking)
    .where(
      and(
        eq(booking.professionalId, professionalId),
        eq(booking.occurrenceId, occurrenceId),
        eq(booking.customerId, customerId),
        or(
          inArray(booking.status, ["cancelled", "expired"]),
          and(eq(booking.status, "pending"), lte(booking.holdExpiresAt, now)),
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${booking.endedAt}, ${booking.holdExpiresAt})`), desc(booking.id))
    .limit(1);
  if (!last) return null;
  return last.status === "cancelled" ? "cancelled" : "expired";
}

/** The type a spend would use here (consumption order) and what the balance of that type leaves after it. */
async function usableFor(
  db: Db,
  professionalId: string,
  occurrenceId: string,
  customerId: string,
  now: Date,
): Promise<SeanceVisitorFacts["usable"]> {
  const [first] = await usableTickets(db, { customerId, occurrenceId });
  if (!first) return null;
  const [[type], balances] = await Promise.all([
    db
      .select({ name: ticketType.name })
      .from(ticketType)
      .where(and(eq(ticketType.id, first.ticketTypeId), eq(ticketType.professionalId, professionalId))),
    walletBalance(db, { professionalId, customerId }, now),
  ]);
  if (!type) return null;
  const usable = balances.find((b) => b.ticketTypeId === first.ticketTypeId)?.usable ?? 0;
  return { typeName: type.name, leftAfter: Math.max(0, usable - 1) };
}

export type LivePendingHold = {
  purchaseId: string;
  occurrenceId: string;
  /** an RDV slot (an occurrence with no event): its row says « créneau », never « place » (P5 § 3.13) */
  isRdv: boolean;
  title: string;
  startsAt: Date;
  holdExpiresAt: Date;
};

/**
 * SEC-I6: the live pending holds (booking pending, hold_expires_at > now, purchase pending) of THIS Owner's customer at
 * this pro, soonest hold end first (at most MAX_PENDING_HOLDS by the engine's quota): holds typed by strangers with her
 * address land on her row, and she can always release them. Owner only.
 */
export async function livePendingHoldsOf(
  db: Db,
  professionalId: string,
  customerId: string,
  now: Date,
): Promise<LivePendingHold[]> {
  const rows = await db
    .select({
      purchaseId: ticketPurchase.id,
      occurrenceId: booking.occurrenceId,
      eventId: occurrence.eventId,
      title: sql<string | null>`coalesce(${event.title}, ${ticketType.name})`,
      startsAt: occurrence.startsAt,
      holdExpiresAt: booking.holdExpiresAt,
    })
    .from(booking)
    .innerJoin(ticketPurchase, eq(ticketPurchase.id, booking.purchaseId))
    .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
    // The séance's event or RDV type must be this pro's own too: a row that points at another pro's event or type has
    // no title here, so it is left out instead of showing a title that is not this pro's (defence in depth, G3b).
    .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, professionalId)))
    .leftJoin(ticketType, and(eq(ticketType.id, occurrence.ticketTypeId), eq(ticketType.professionalId, professionalId)))
    .where(
      and(
        eq(booking.professionalId, professionalId),
        eq(booking.customerId, customerId),
        eq(booking.status, "pending"),
        gt(booking.holdExpiresAt, now),
        eq(ticketPurchase.status, "pending"),
        eq(ticketPurchase.professionalId, professionalId),
        eq(occurrence.professionalId, professionalId),
      ),
    )
    .orderBy(asc(booking.holdExpiresAt), asc(booking.id));
  return rows.flatMap((r) =>
    r.holdExpiresAt === null || r.title === null
      ? []
      : [
          {
            purchaseId: r.purchaseId,
            occurrenceId: r.occurrenceId,
            isRdv: r.eventId === null,
            title: r.title,
            startsAt: r.startsAt,
            holdExpiresAt: r.holdExpiresAt,
          },
        ],
  );
}
