/**
 * Post-commit effects (spec § 10, § 13.6). The engine returns descriptors that
 * carry ids only; `planEffect` turns one of them into what must be done, from a
 * FRESH read of the database (names, dates, places and balances as they are
 * now). No server-only, no env: the public URL, the personal-link key and the
 * clock come in as `deps`, so the DB tests run this module as it is.
 * src/lib/notify-run.ts executes the plans (sendEmail, syncOccurrence,
 * expireCheckoutSession), best effort, after the response; src/server/notify.ts
 * wires its real dependencies.
 */
import { and, asc, count, eq, inArray, min, ne, type SQL, sql } from "drizzle-orm";

import { expiryGroups, expiryLabel, formatWhen, formatWhenShort, planningHref, type ExpiryEntry } from "@/lib/back-office/format";
import { walletBalanceByExpiry } from "@/lib/booking/wallet";
import type { Effect } from "@/lib/booking/types";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";
import { clientCancelDeadline } from "@/lib/cancellation";
import { formatDayMonthYear, todayKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import {
  booking,
  customer,
  event,
  occurrence,
  professional,
  ticket,
  ticketMovement,
  ticketPurchase,
  ticketType,
  user,
} from "@/lib/db/schema";
import { attendeeMovedEmail } from "@/lib/emails/attendee-moved";
import { bookingCancelledEmail } from "@/lib/emails/booking-cancelled";
import { bookingConfirmedEmail, type TicketsLeft } from "@/lib/emails/booking-confirmed";
import { latePaymentEmail } from "@/lib/emails/late-payment";
import { occurrenceCancelledEmail } from "@/lib/emails/occurrence-cancelled";
import { occurrenceChangedEmail } from "@/lib/emails/occurrence-changed";
import type { MailCalendarLinks } from "@/lib/emails/parts";
import { proBookingCancelledEmail } from "@/lib/emails/pro-booking-cancelled";
import { proNewBookingEmail } from "@/lib/emails/pro-new-booking";
import { purchaseReceiptEmail } from "@/lib/emails/purchase-receipt";
import { ticketsOfferedEmail } from "@/lib/emails/tickets-offered";
import { personalLinkUrl } from "@/lib/guest-link";
import { coverageLabelOf } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";

export type OutgoingEmail = { to: string; subject: string; html: string };
export type NotifyDeps = { appUrl: string; guestKey: Buffer; now: Date };
export type EffectPlan =
  | { kind: "emails"; professionalId: string | null; emails: OutgoingEmail[] }
  | { kind: "google"; occurrenceId: string }
  | { kind: "stripe"; purchaseId: string; checkoutSessionId: string };

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

// The formatter lives in src/lib/log-safe.ts (pure, no import) so the Stripe, Google and Resend
// wrappers can use it without loading this module; the export stays here for the executor.
export { logSafeMessage } from "@/lib/log-safe";

/* ───────────────────────────── Reads ───────────────────────────── */

const bookingFacts = {
  bookingId: booking.id,
  professionalId: booking.professionalId,
  occurrenceId: booking.occurrenceId,
  /** null for a rendez-vous (an occurrence with no event) */
  eventId: occurrence.eventId,
  status: booking.status,
  coverage: booking.coverage,
  createdAt: booking.createdAt,
  confirmedAt: booking.confirmedAt,
  holdExpiresAt: booking.holdExpiresAt,
  endedAt: booking.endedAt,
  endedBy: booking.endedBy,
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

/**
 * Bookings with their customer, pro and occurrence, oldest first. The customer
 * and the occurrence are joined through the booking's own professional_id (no
 * composite FK enforces it): a row that crosses two pros finds no customer or
 * no occurrence, so it plans no e-mail and never mixes two pros' data.
 */
async function readBookings(db: Db, where: SQL | undefined) {
  return db
    .select(bookingFacts)
    .from(booking)
    .innerJoin(customer, and(eq(customer.id, booking.customerId), eq(customer.professionalId, booking.professionalId)))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .innerJoin(
      occurrence,
      and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, booking.professionalId)),
    )
    .leftJoin(event, eq(event.id, occurrence.eventId))
    .leftJoin(ticketType, eq(ticketType.id, occurrence.ticketTypeId))
    .where(where)
    .orderBy(asc(booking.createdAt), asc(booking.id));
}

type BookingFacts = Awaited<ReturnType<typeof readBookings>>[number];

/** A séance of an event, or a rendez-vous (an occurrence with no event): the templates word them apart (P5 § 3.12). */
function kindOf(b: Pick<BookingFacts, "eventId">): "seance" | "rdv" {
  return b.eventId === null ? "rdv" : "seance";
}

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

/**
 * What the client still holds right now, one entry per type (by type name), with one expiry group per last valid
 * day: a type that mixes dated and undated tickets, or tickets of two carnets, names every date it has.
 */
async function ticketsLeftOf(db: Db, b: BookingFacts, now: Date): Promise<TicketsLeft[]> {
  const balance = await walletBalanceByExpiry(db, { professionalId: b.professionalId, customerId: b.customerId }, now);
  if (balance.length === 0) return [];
  const types = await db
    .select({ id: ticketType.id, name: ticketType.name })
    .from(ticketType)
    .where(and(eq(ticketType.professionalId, b.professionalId), inArray(ticketType.id, balance.map((r) => r.ticketTypeId))));
  const names = new Map(types.map((t) => [t.id, t.name]));
  const perType = new Map<string, ExpiryEntry[]>();
  for (const r of balance) {
    const entries = perType.get(r.ticketTypeId) ?? [];
    entries.push({ expiresAt: r.expiresAt, count: r.usable });
    perType.set(r.ticketTypeId, entries);
  }
  return [...perType.entries()]
    .map(([typeId, entries]) => ({
      typeName: names.get(typeId) ?? "Ticket",
      count: entries.reduce((sum, e) => sum + e.count, 0),
      expiry: expiryGroups(entries, b.tz, now),
    }))
    .sort((x, y) => x.typeName.localeCompare(y.typeName, "fr"));
}

/* ───────────────────────────── Small helpers ───────────────────────────── */

/** The mails of one effect, with the pro whose budget they spend (src/lib/mail-budget.ts); no mail, no pro. */
const emails = (professionalId: string | undefined, list: OutgoingEmail[]): EffectPlan =>
  list.length === 0 || professionalId === undefined ? noEmail() : { kind: "emails", professionalId, emails: list };
const noEmail = (): EffectPlan => ({ kind: "emails", professionalId: null, emails: [] });

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

/**
 * The « add to my calendar » links of a booking at its occurrence AS IT IS NOW: the Google and Outlook web links
 * carry its time and place, the .ics file is the booking's own (it answers only for a confirmed booking).
 */
function calendarLinksOf(b: BookingFacts, deps: NotifyDeps): MailCalendarLinks {
  const input = {
    title: b.title,
    description: `Avec ${b.businessName}`,
    location: b.location,
    startAt: b.startsAt,
    endAt: b.endsAt,
  };
  return {
    googleUrl: googleCalendarUrl(input),
    outlookUrl: outlookCalendarUrl(input),
    icsUrl: `${deps.appUrl.replace(/\/+$/, "")}/api/bookings/${b.bookingId}/calendar.ics`,
  };
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
  const mail = bookingConfirmedEmail({
    kind: kindOf(b),
    customerName: b.customerName,
    businessName: b.businessName,
    title: b.title,
    whenLabel: whenOf(b),
    location: b.location,
    coverageLabel: coverageLabelOf(b.coverage, b.eventId === null),
    ticketTypeName,
    ticketsLeft,
    cancelText,
    personalLinkUrl: linkOf(b, deps),
    calendar: calendarLinksOf(b, deps),
  });
  return emails(b.professionalId, [{ to: b.customerEmail, ...mail }]);
}

function cancelledMail(b: BookingFacts, by: "pro" | "client", ticketReturned: boolean, deps: NotifyDeps): OutgoingEmail {
  const mail = bookingCancelledEmail({
    kind: kindOf(b),
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
  return emails(b.professionalId, [cancelledMail(b, by, returned.has(b.bookingId), deps)]);
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
    heard[0].professionalId,
    heard.map((b) => {
      const mail = occurrenceCancelledEmail({
        kind: kindOf(b),
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
    active[0]?.professionalId,
    active.map((b) => {
      const mail = occurrenceChangedEmail({
        customerName: b.customerName,
        businessName: b.businessName,
        title: b.title,
        whenLabel: whenOf(b),
        location: b.location,
        canCancelUntilStart: (b.changedAt !== null && b.changedAt.getTime() > b.createdAt.getTime()) || b.movedAt !== null,
        personalLinkUrl: linkOf(b, deps),
        // the .ics file only answers for a confirmed booking: a live hold that is not paid yet has none
        calendar: b.status === "confirmed" ? calendarLinksOf(b, deps) : null,
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
    calendar: calendarLinksOf(b, deps),
  });
  return emails(b.professionalId, [{ to: b.customerEmail, ...mail }]);
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
    expiryText: expiryLabel(offered[0].expiresAt, c.tz, deps.now, offered.length),
    personalLinkUrl: personalLinkUrl(deps.appUrl, { id: c.id, linkVersion: c.linkVersion }, deps.guestKey),
  });
  return emails(c.professionalId, [{ to: c.email, ...mail }]);
}

/* ───────────── P4 plans: the receipt, the late payment and the pro's two notices ───────────── */

/** The address of the pro's own account (the recipient of the pro notices), or null. */
async function proEmailOf(db: Db, professionalId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: user.email })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(eq(professional.id, professionalId));
  return row?.email ?? null;
}

/** The séance in the pro's planning, as the pro opens it from a notice (spec L1542-1544). */
function planningUrlOf(b: Pick<BookingFacts, "occurrenceId" | "startsAt" | "tz">, deps: NotifyDeps): string {
  return `${deps.appUrl.replace(/\/+$/, "")}${planningHref({ occurrenceId: b.occurrenceId, startsAt: b.startsAt, tz: b.tz })}`;
}

/**
 * The receipt of a PAID purchase, to its customer. The customer, the pro and the ticket type are read through the
 * purchase's own professional_id: a purchase that crosses two pros plans nothing. Its booking line names the
 * purchase's confirmed booking only when that booking is the same pro's and the same customer's. `walletCount` is
 * the purchase's tickets still available (the ticket a buy + book spent is not counted); `expiryText` says
 * « valables » for several.
 */
async function planPurchaseReceipt(db: Db, purchaseId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [p] = await db
    .select({
      purchaseId: ticketPurchase.id,
      professionalId: ticketPurchase.professionalId,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      linkVersion: customer.linkVersion,
      businessName: professional.businessName,
      tz: professional.timezone,
      label: ticketPurchase.label,
      typeName: ticketType.name,
      quantity: ticketPurchase.quantity,
      amountCents: ticketPurchase.amountCents,
      currency: ticketPurchase.currency,
      paidAt: ticketPurchase.paidAt,
      livemode: ticketPurchase.livemode,
    })
    .from(ticketPurchase)
    .innerJoin(
      customer,
      and(eq(customer.id, ticketPurchase.customerId), eq(customer.professionalId, ticketPurchase.professionalId)),
    )
    .innerJoin(professional, eq(professional.id, ticketPurchase.professionalId))
    .innerJoin(
      ticketType,
      and(eq(ticketType.id, ticketPurchase.ticketTypeId), eq(ticketType.professionalId, ticketPurchase.professionalId)),
    )
    .where(and(eq(ticketPurchase.id, purchaseId), eq(ticketPurchase.status, "paid")));
  if (!p || p.paidAt === null) return noEmail();

  const [tickets] = await db
    .select({
      expiresAt: min(ticket.expiresAt),
      available: sql<number>`count(*) filter (where ${ticket.status} = 'available')`.mapWith(Number),
    })
    .from(ticket)
    .where(and(eq(ticket.purchaseId, p.purchaseId), eq(ticket.professionalId, p.professionalId)));
  const [held] = await readBookings(db, and(eq(booking.purchaseId, p.purchaseId), eq(booking.status, "confirmed")));
  // The booking is named only when it is this customer's own at this pro (the rule of planLatePayment): a purchase
  // reference never stands for its customer, so another customer's booking attached to it is never read out.
  const bookingLine =
    held && held.professionalId === p.professionalId && held.customerId === p.customerId
      ? held.eventId === null
        ? `Un des tickets a servi pour votre rendez-vous « ${held.title} » (${whenOf(held)}).`
        : `Un des tickets a servi pour votre inscription à « ${held.title} » (${whenOf(held)}).`
      : null;

  const mail = purchaseReceiptEmail({
    customerName: p.customerName,
    businessName: p.businessName,
    label: p.label,
    typeName: p.typeName,
    quantity: p.quantity,
    walletCount: tickets?.available ?? 0,
    amountLabel: formatMoney(p.amountCents, p.currency),
    paidOn: formatDayMonthYear(todayKey(p.paidAt, p.tz)),
    expiryText: expiryLabel(tickets?.expiresAt ?? null, p.tz, deps.now, p.quantity),
    bookingLine,
    test: !p.livemode,
    personalLinkUrl: linkOf(p, deps),
  });
  return emails(p.professionalId, [{ to: p.customerEmail, ...mail }]);
}

/**
 * « Paiement reçu » for a PAID purchase whose booking is not confirmed (it ended before the money arrived): the
 * tickets went to the wallet, the séance is not reserved. The booking must belong to the purchase's own pro and
 * customer, else nothing is planned.
 */
async function planLatePayment(db: Db, purchaseId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [p] = await db
    .select({
      professionalId: ticketPurchase.professionalId,
      customerId: ticketPurchase.customerId,
      slug: professional.slug,
    })
    .from(ticketPurchase)
    .innerJoin(professional, eq(professional.id, ticketPurchase.professionalId))
    .where(and(eq(ticketPurchase.id, purchaseId), eq(ticketPurchase.status, "paid")));
  if (!p) return noEmail();
  const [b] = await readBookings(db, and(eq(booking.purchaseId, purchaseId), ne(booking.status, "confirmed")));
  if (!b || b.professionalId !== p.professionalId || b.customerId !== p.customerId) return noEmail();
  const [tickets] = await db
    .select({ n: count() })
    .from(ticket)
    .where(and(eq(ticket.purchaseId, purchaseId), eq(ticket.professionalId, p.professionalId)));
  if (!tickets || tickets.n === 0) return noEmail();

  const mail = latePaymentEmail({
    kind: kindOf(b),
    customerName: b.customerName,
    businessName: b.businessName,
    title: b.title,
    whenLabel: whenOf(b),
    count: tickets.n,
    pageUrl: `${deps.appUrl.replace(/\/+$/, "")}/${p.slug}`,
    personalLinkUrl: linkOf(b, deps),
  });
  return emails(p.professionalId, [{ to: b.customerEmail, ...mail }]);
}

/** « Nouvelle inscription » to the pro's own address, for a CONFIRMED booking. No personal link. */
async function planProNewBooking(db: Db, bookingId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [b] = await readBookings(db, eq(booking.id, bookingId));
  if (!b || b.status !== "confirmed") return noEmail();
  const to = await proEmailOf(db, b.professionalId);
  if (to === null) return noEmail();
  const mail = proNewBookingEmail({
    kind: kindOf(b),
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    title: b.title,
    whenLabel: whenOf(b),
    coverageLabel: coverageLabelOf(b.coverage, b.eventId === null),
    planningUrl: planningUrlOf(b, deps),
  });
  return emails(b.professionalId, [{ to, ...mail }]);
}

/** « Annulation d'un client » to the pro's own address: the booking is cancelled AND the client ended it. */
async function planProBookingCancelled(db: Db, bookingId: string, deps: NotifyDeps): Promise<EffectPlan> {
  const [b] = await readBookings(db, eq(booking.id, bookingId));
  if (!b || b.status !== "cancelled" || b.endedBy !== "client") return noEmail();
  const to = await proEmailOf(db, b.professionalId);
  if (to === null) return noEmail();
  const returned = await returnedBookingIds(db, b.professionalId, [b.bookingId]);
  const mail = proBookingCancelledEmail({
    kind: kindOf(b),
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    title: b.title,
    whenLabel: whenOf(b),
    ticketReturned: returned.has(b.bookingId),
    planningUrl: planningUrlOf(b, deps),
  });
  return emails(b.professionalId, [{ to, ...mail }]);
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
      return planProNewBooking(db, effect.bookingId, deps);
    case "email.pro_booking_cancelled":
      return planProBookingCancelled(db, effect.bookingId, deps);
    case "email.purchase_receipt":
      return planPurchaseReceipt(db, effect.purchaseId, deps);
    case "email.late_payment":
      return planLatePayment(db, effect.purchaseId, deps);
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
