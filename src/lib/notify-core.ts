/**
 * Post-commit effects (spec § 10, § 13.6). The engine returns descriptors that
 * carry ids only; `planEffect` turns one of them into what must be done, from a
 * FRESH read of the database (names, dates, places and balances as they are
 * now). No server-only, no env: the public URL, the personal-link key and the
 * clock come in as `deps`, so the DB tests run this module as it is.
 * src/server/notify.ts executes the plans (sendEmail, syncOccurrence,
 * expireCheckoutSession), best effort, after the response.
 */
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";

import { expiryLabel, formatWhen, formatWhenShort } from "@/lib/back-office/format";
import { walletBalance } from "@/lib/booking/wallet";
import type { Effect } from "@/lib/booking/types";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";
import { clientCancelDeadline } from "@/lib/cancellation";
import type { Db } from "@/lib/db/atomic";
import { booking, customer, event, occurrence, professional, ticket, ticketMovement, ticketType } from "@/lib/db/schema";
import { attendeeMovedEmail } from "@/lib/emails/attendee-moved";
import { bookingCancelledEmail } from "@/lib/emails/booking-cancelled";
import { bookingConfirmedEmail } from "@/lib/emails/booking-confirmed";
import { occurrenceCancelledEmail } from "@/lib/emails/occurrence-cancelled";
import { occurrenceChangedEmail } from "@/lib/emails/occurrence-changed";
import { ticketsOfferedEmail } from "@/lib/emails/tickets-offered";
import { personalLinkUrl } from "@/lib/guest-link";
import { COVERAGE_LABELS } from "@/lib/tickets-vocab";

export type OutgoingEmail = { to: string; subject: string; html: string };
export type NotifyDeps = { appUrl: string; guestKey: Buffer; now: Date };
export type EffectPlan =
  | { kind: "emails"; emails: OutgoingEmail[] }
  | { kind: "google"; occurrenceId: string }
  | { kind: "stripe"; purchaseId: string; checkoutSessionId: string }
  | { kind: "deferred"; type: Effect["type"] };

/* ───────────────────────────── Dedupe ───────────────────────────── */

/** JSON of the effect with its keys sorted and its id lists sorted: two effects with the same content share a key. */
function effectKey(effect: Effect): string {
  const sorted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(effect).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    sorted[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return JSON.stringify(sorted);
}

/**
 * Drops exact duplicates (the id lists compared sorted), keeps the first-seen
 * order, and puts the google.sync_occurrence effects last: a sync then reads
 * the state every e-mail of the same action was planned from.
 */
export function dedupeEffects(effects: readonly Effect[]): Effect[] {
  const seen = new Set<string>();
  const others: Effect[] = [];
  const syncs: Effect[] = [];
  for (const effect of effects) {
    const key = effectKey(effect);
    if (seen.has(key)) continue;
    seen.add(key);
    (effect.type === "google.sync_occurrence" ? syncs : others).push(effect);
  }
  return [...others, ...syncs];
}

/* ───────────────────────────── Log safety ───────────────────────────── */

/**
 * One line of an error for the server log: no e-mail address, no personal-link
 * token, no Checkout session id; whitespace collapsed; 200 characters at most.
 */
export function logSafeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "unknown error";
  return raw
    .replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, "[email]")
    .replace(/\/api\/c\/[A-Za-z0-9._-]+/g, "/api/c/[token]")
    .replace(/\bcs_(?:test|live)_[A-Za-z0-9]+/g, "[session]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/* ───────────────────────────── Reads ───────────────────────────── */

const bookingFacts = {
  bookingId: booking.id,
  professionalId: booking.professionalId,
  occurrenceId: booking.occurrenceId,
  status: booking.status,
  coverage: booking.coverage,
  createdAt: booking.createdAt,
  confirmedAt: booking.confirmedAt,
  holdExpiresAt: booking.holdExpiresAt,
  endedAt: booking.endedAt,
  movedAt: booking.movedAt,
  cancelReason: booking.cancelReason,
  customerId: customer.id,
  customerName: customer.name,
  customerEmail: customer.email,
  linkVersion: customer.linkVersion,
  businessName: professional.businessName,
  tz: professional.timezone,
  title: sql<string>`coalesce(${event.title}, ${ticketType.name})`,
  location: sql<string | null>`coalesce(${occurrence.locationOverride}, ${event.location})`,
  startsAt: occurrence.startsAt,
  endsAt: occurrence.endsAt,
  changedAt: occurrence.changedAt,
  cancelHours: sql<number>`coalesce(${event.cancelDeadlineHours}, ${ticketType.rdvCancelDeadlineHours}, ${professional.cancelDeadlineHours})`.mapWith(
    Number,
  ),
};

/** Bookings with their customer, pro and occurrence, oldest first. Every join follows the booking's own professional_id. */
async function readBookings(db: Db, where: SQL | undefined) {
  return db
    .select(bookingFacts)
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .innerJoin(occurrence, eq(occurrence.id, booking.occurrenceId))
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(where)
    .orderBy(asc(booking.createdAt), asc(booking.id));
}

type BookingFacts = Awaited<ReturnType<typeof readBookings>>[number];

/** The title and times of one occurrence of this pro, or null. */
async function readOccurrence(db: Db, professionalId: string, occurrenceId: string) {
  const [row] = await db
    .select({
      title: sql<string>`coalesce(${event.title}, ${ticketType.name})`,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
    })
    .from(occurrence)
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(and(eq(occurrence.id, occurrenceId), eq(occurrence.professionalId, professionalId)));
  return row ?? null;
}

/** The bookings (of this pro) that got a ticket back when they ended. */
async function returnedBookingIds(db: Db, professionalId: string, bookingIds: readonly string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ bookingId: ticketMovement.bookingId })
    .from(ticketMovement)
    .where(
      and(
        eq(ticketMovement.professionalId, professionalId),
        eq(ticketMovement.kind, "return"),
        inArray(ticketMovement.bookingId, [...bookingIds]),
      ),
    );
  return new Set(rows.flatMap((r) => (r.bookingId === null ? [] : [r.bookingId])));
}

/** The type name of the ticket booked on this booking (coverage ticket), or null. */
async function bookedTicketTypeName(db: Db, b: BookingFacts): Promise<string | null> {
  const [row] = await db
    .select({ name: ticketType.name })
    .from(ticket)
    .innerJoin(ticketType, eq(ticketType.id, ticket.ticketTypeId))
    .where(and(eq(ticket.bookingId, b.bookingId), eq(ticket.professionalId, b.professionalId)));
  return row?.name ?? null;
}

/** What the client still holds right now, one line per type, by type name. */
async function ticketsLeftOf(db: Db, b: BookingFacts, now: Date) {
  const balance = await walletBalance(db, { professionalId: b.professionalId, customerId: b.customerId }, now);
  if (balance.length === 0) return [];
  const types = await db
    .select({ id: ticketType.id, name: ticketType.name })
    .from(ticketType)
    .where(and(eq(ticketType.professionalId, b.professionalId), inArray(ticketType.id, balance.map((r) => r.ticketTypeId))));
  const names = new Map(types.map((t) => [t.id, t.name]));
  return balance
    .map((r) => ({
      typeName: names.get(r.ticketTypeId) ?? "Ticket",
      count: r.usable,
      expiryText: expiryLabel(r.nextExpiry, b.tz, now),
    }))
    .sort((x, y) => x.typeName.localeCompare(y.typeName, "fr"));
}

/* ───────────────────────────── Small helpers ───────────────────────────── */

const emails = (list: OutgoingEmail[]): EffectPlan => ({ kind: "emails", emails: list });
const noEmail = (): EffectPlan => emails([]);

/** A hold the client never paid: confirmed_at is null and the hold ended before the booking did. */
function isLapsedHold(b: Pick<BookingFacts, "confirmedAt" | "holdExpiresAt" | "endedAt">): boolean {
  return b.confirmedAt === null && b.holdExpiresAt !== null && b.endedAt !== null && b.holdExpiresAt.getTime() < b.endedAt.getTime();
}

function linkOf(b: Pick<BookingFacts, "customerId" | "linkVersion">, deps: NotifyDeps): string {
  return personalLinkUrl(deps.appUrl, { id: b.customerId, linkVersion: b.linkVersion }, deps.guestKey);
}

function whenOf(b: Pick<BookingFacts, "startsAt" | "endsAt" | "tz">): string {
  return formatWhen(b.startsAt, b.endsAt, b.tz);
}

/* ───────────────────────────── Plans ───────────────────────────── */

async function planBookingConfirmed(db: Db, bookingId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [b] = await readBookings(db, eq(booking.id, bookingId));
  if (!b || b.status !== "confirmed") return noEmail();
  const ticketTypeName = b.coverage === "ticket" ? await bookedTicketTypeName(db, b) : null;
  const ticketsLeft = await ticketsLeftOf(db, b, deps.now);
  const deadline = clientCancelDeadline(b.startsAt, b.cancelHours);
  const cancelText =
    deadline.getTime() > deps.now.getTime()
      ? `Vous pouvez annuler en ligne jusqu'au ${formatWhenShort(deadline, b.tz)}.`
      : `L'annulation en ligne n'est plus possible : contactez ${b.businessName}.`;
  const calendarInput = {
    title: b.title,
    description: `Avec ${b.businessName}`,
    location: b.location,
    startAt: b.startsAt,
    endAt: b.endsAt,
  };
  const mail = bookingConfirmedEmail({
    customerName: b.customerName,
    businessName: b.businessName,
    title: b.title,
    whenLabel: whenOf(b),
    location: b.location,
    coverageLabel: COVERAGE_LABELS[b.coverage],
    ticketTypeName,
    ticketsLeft,
    cancelText,
    personalLinkUrl: linkOf(b, deps),
    calendar: {
      googleUrl: googleCalendarUrl(calendarInput),
      outlookUrl: outlookCalendarUrl(calendarInput),
      icsUrl: `${deps.appUrl.replace(/\/+$/, "")}/api/bookings/${b.bookingId}/calendar.ics`,
    },
  });
  return emails([{ to: b.customerEmail, ...mail }]);
}

function cancelledMail(b: BookingFacts, by: "pro" | "client", ticketReturned: boolean, deps: NotifyDeps): OutgoingEmail {
  const mail = bookingCancelledEmail({
    customerName: b.customerName,
    businessName: b.businessName,
    title: b.title,
    whenLabel: whenOf(b),
    by,
    ticketReturned,
    reason: b.cancelReason,
    personalLinkUrl: linkOf(b, deps),
  });
  return { to: b.customerEmail, ...mail };
}

async function planBookingCancelled(db: Db, bookingId: string, by: "pro" | "client", deps: NotifyDeps): Promise<EffectPlan> {
  const [b] = await readBookings(db, eq(booking.id, bookingId));
  if (!b || b.status !== "cancelled" || isLapsedHold(b)) return noEmail();
  const returned = await returnedBookingIds(db, b.professionalId, [b.bookingId]);
  return emails([cancelledMail(b, by, returned.has(b.bookingId), deps)]);
}

async function planOccurrenceCancelled(
  db: Db,
  occurrenceId: string,
  bookingIds: readonly string[],
  deps: NotifyDeps,
): Promise<EffectPlan> {
  if (bookingIds.length === 0) return noEmail();
  const rows = await readBookings(db, and(eq(booking.occurrenceId, occurrenceId), inArray(booking.id, [...bookingIds])));
  const heard = rows.filter((b) => b.status === "cancelled" && !isLapsedHold(b));
  if (heard.length === 0) return noEmail();
  const returned = await returnedBookingIds(
    db,
    heard[0].professionalId,
    heard.map((b) => b.bookingId),
  );
  return emails(
    heard.map((b) => {
      const mail = occurrenceCancelledEmail({
        customerName: b.customerName,
        businessName: b.businessName,
        title: b.title,
        whenLabel: whenOf(b),
        ticketReturned: returned.has(b.bookingId),
        personalLinkUrl: linkOf(b, deps),
      });
      return { to: b.customerEmail, ...mail };
    }),
  );
}

async function planOccurrenceChanged(
  db: Db,
  occurrenceId: string,
  bookingIds: readonly string[],
  deps: NotifyDeps,
): Promise<EffectPlan> {
  if (bookingIds.length === 0) return noEmail();
  const rows = await readBookings(db, and(eq(booking.occurrenceId, occurrenceId), inArray(booking.id, [...bookingIds])));
  const nowMs = deps.now.getTime();
  const active = rows.filter(
    (b) =>
      b.status === "confirmed" || (b.status === "pending" && b.holdExpiresAt !== null && b.holdExpiresAt.getTime() > nowMs),
  );
  return emails(
    active.map((b) => {
      const mail = occurrenceChangedEmail({
        customerName: b.customerName,
        businessName: b.businessName,
        title: b.title,
        whenLabel: whenOf(b),
        location: b.location,
        canCancelUntilStart: (b.changedAt !== null && b.changedAt.getTime() > b.createdAt.getTime()) || b.movedAt !== null,
        personalLinkUrl: linkOf(b, deps),
      });
      return { to: b.customerEmail, ...mail };
    }),
  );
}

async function planAttendeeMoved(db: Db, bookingId: string, fromOccurrenceId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [b] = await readBookings(db, eq(booking.id, bookingId));
  if (!b || b.status !== "confirmed") return noEmail();
  const from = await readOccurrence(db, b.professionalId, fromOccurrenceId);
  if (!from) return noEmail();
  const mail = attendeeMovedEmail({
    customerName: b.customerName,
    businessName: b.businessName,
    fromTitle: from.title,
    fromWhenLabel: formatWhen(from.startsAt, from.endsAt, b.tz),
    toTitle: b.title,
    toWhenLabel: whenOf(b),
    toLocation: b.location,
    personalLinkUrl: linkOf(b, deps),
  });
  return emails([{ to: b.customerEmail, ...mail }]);
}

async function planTicketsOffered(db: Db, customerId: string, actionId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [c] = await db
    .select({
      id: customer.id,
      professionalId: customer.professionalId,
      name: customer.name,
      email: customer.email,
      linkVersion: customer.linkVersion,
      businessName: professional.businessName,
      tz: professional.timezone,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .where(eq(customer.id, customerId));
  if (!c) return noEmail();
  const offered = await db
    .select({ typeName: ticketType.name, expiresAt: ticket.expiresAt })
    .from(ticketMovement)
    .innerJoin(ticket, eq(ticket.id, ticketMovement.ticketId))
    .innerJoin(ticketType, eq(ticketType.id, ticket.ticketTypeId))
    .where(
      and(
        eq(ticketMovement.professionalId, c.professionalId),
        eq(ticketMovement.customerId, c.id),
        eq(ticketMovement.actionId, actionId),
        eq(ticketMovement.kind, "offer"),
      ),
    )
    .orderBy(asc(ticketMovement.seq));
  if (offered.length === 0) return noEmail();
  const mail = ticketsOfferedEmail({
    customerName: c.name,
    businessName: c.businessName,
    typeName: offered[0].typeName,
    count: offered.length,
    expiryText: expiryLabel(offered[0].expiresAt, c.tz, deps.now),
    personalLinkUrl: personalLinkUrl(deps.appUrl, { id: c.id, linkVersion: c.linkVersion }, deps.guestKey),
  });
  return emails([{ to: c.email, ...mail }]);
}

/**
 * What to do for one effect, from a fresh DB read. A row that no longer exists
 * (or no longer in the state the e-mail talks about) plans no e-mail. The
 * switch is exhaustive: a new Effect type fails the build here.
 */
export async function planEffect(db: Db, effect: Effect, deps: NotifyDeps): Promise<EffectPlan> {
  switch (effect.type) {
    case "email.booking_confirmed":
      return planBookingConfirmed(db, effect.bookingId, deps);
    case "email.booking_cancelled":
      return planBookingCancelled(db, effect.bookingId, effect.by, deps);
    case "email.occurrence_cancelled":
      return planOccurrenceCancelled(db, effect.occurrenceId, effect.bookingIds, deps);
    case "email.occurrence_changed":
      return planOccurrenceChanged(db, effect.occurrenceId, effect.bookingIds, deps);
    case "email.attendee_moved":
      return planAttendeeMoved(db, effect.bookingId, effect.fromOccurrenceId, deps);
    case "email.tickets_offered":
      return planTicketsOffered(db, effect.customerId, effect.actionId, deps);
    case "email.pro_new_booking":
    case "email.pro_booking_cancelled":
    case "email.purchase_receipt":
    case "email.late_payment":
      return { kind: "deferred", type: effect.type };
    case "google.sync_occurrence":
      return { kind: "google", occurrenceId: effect.occurrenceId };
    case "stripe.expire_session":
      return { kind: "stripe", purchaseId: effect.purchaseId, checkoutSessionId: effect.checkoutSessionId };
    default: {
      const unreachable: never = effect;
      throw new Error(`Unhandled effect: ${JSON.stringify(unreachable)}`);
    }
  }
}
