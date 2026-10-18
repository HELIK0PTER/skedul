/**
 * Engine-backed fixtures for the DB tests of Tasks 19 to 35: every row is
 * made through the engine (catalog, occurrences, wallet), so the state is
 * always consistent (checkInvariants runs after every dbTest). Each maker
 * throws on an engine failure: a fixture that fails is a broken test.
 */
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { createOffer, createTicketType } from "../lib/booking/catalog";
import { createEvent } from "../lib/booking/occurrences";
import { createCustomer, offerTickets } from "../lib/booking/wallet";
import { addDays, todayKey, type DateKey } from "../lib/civil-date";
import type { Db } from "../lib/db/atomic";
import { booking, occurrence, ticket, ticketMovement } from "../lib/db/schema";
import type { BookingMode, OfferInput, RecurrenceRuleInput, TicketTypeInput } from "../lib/tickets";
import { testEmail, type TestPro } from "./db";

export type OccurrenceRow = typeof occurrence.$inferSelect;
export type BookingRow = typeof booking.$inferSelect;
export type TicketRow = typeof ticket.$inferSelect;

function check<T extends { ok: boolean }>(what: string, res: T): Extract<T, { ok: true }> {
  if (!res.ok) throw new Error(`${what} failed: ${JSON.stringify(res)}`);
  return res as Extract<T, { ok: true }>;
}

/** Local date `days` after today in the pro's time zone. */
export function dayIn(pro: TestPro, days: number, now: Date = new Date()): DateKey {
  return addDays(todayKey(now, pro.tz), days);
}

/** createTicketType with { name: "Type <nanoid>" } + overrides. */
export async function makeType(db: Db, pro: TestPro, over: Partial<TicketTypeInput> = {}): Promise<string> {
  const res = await createTicketType(db, { professionalId: pro.proId, type: { name: `Type ${nanoid(6)}`, ...over } });
  return check("makeType", res).ticketTypeId;
}

/** createOffer with { quantity 1, priceCents 2500, no validity } + overrides. */
export async function makeOffer(
  db: Db,
  pro: TestPro,
  ticketTypeId: string,
  over: Partial<OfferInput> = {},
): Promise<string> {
  const res = await createOffer(db, {
    professionalId: pro.proId,
    offer: { ticketTypeId, quantity: 1, priceCents: 2500, ...over },
  });
  return check("makeOffer", res).offerId;
}

/**
 * createEvent: tickets mode, capacity 12, 60 min, once on dayIn(pro, 3) at
 * 10:00 (600), + overrides. A `rule` override is merged over that one-off
 * rule, so a recurring one must give every field it changes (e.g. freq,
 * weekdays, endMode and occurrenceCount: null). Occurrences by starts_at.
 */
export async function makeEvent(
  db: Db,
  pro: TestPro,
  over: {
    title?: string;
    bookingMode?: BookingMode;
    capacity?: number;
    durationMin?: number;
    isPrivate?: boolean;
    ticketTypeIds?: string[];
    rule?: Partial<RecurrenceRuleInput>;
  } = {},
  now: Date = new Date(),
): Promise<{ eventId: string; occurrences: OccurrenceRow[] }> {
  const rule: RecurrenceRuleInput = {
    startDate: dayIn(pro, 3, now),
    startMinute: 600,
    freq: "once",
    interval: 1,
    weekdays: null,
    monthlyBy: null,
    monthWeek: null,
    endMode: "count",
    untilDate: null,
    occurrenceCount: 1,
    ...over.rule,
  };
  const res = await createEvent(
    db,
    {
      professionalId: pro.proId,
      event: {
        title: over.title ?? `Cours ${nanoid(6)}`,
        bookingMode: over.bookingMode ?? "tickets",
        capacity: over.capacity ?? 12,
        durationMin: over.durationMin ?? 60,
        isPrivate: over.isPrivate ?? false,
        ticketTypeIds: over.ticketTypeIds ?? [],
        rule,
      },
    },
    now,
  );
  const { eventId } = check("makeEvent", res);
  return { eventId, occurrences: await occurrencesOf(db, eventId) };
}

/** createCustomer with a unique testEmail(). */
export async function makeCustomer(db: Db, pro: TestPro, over: { name?: string; email?: string } = {}): Promise<string> {
  const res = await createCustomer(db, {
    professionalId: pro.proId,
    name: over.name ?? `Client ${nanoid(6)}`,
    email: over.email ?? testEmail(),
  });
  return check("makeCustomer", res).customerId;
}

/**
 * offerTickets by the pro's user, without e-mail. offerTickets refuses an
 * expiry that is not after its `now`. With an explicit `opts.now`, the
 * fixture acts at that instant (e.g. { now: T − 30 days, expiresAt: T − 1 day }
 * for a ticket that is already expired). Without one, it acts at the wall
 * clock. If `expiresAt` is less than 1 s ahead or already past, it acts 1 s
 * before that expiry instead: tests build expiries from their own earlier clock
 * (addMinutes(now, 1)), and slow round trips since then must not turn them into
 * a refusal.
 */
export async function giveTickets(
  db: Db,
  pro: TestPro,
  customerId: string,
  ticketTypeId: string,
  quantity: number,
  opts: { expiresAt?: Date | null; now?: Date } = {},
): Promise<string[]> {
  const expiresAt = opts.expiresAt ?? null;
  const now =
    opts.now ??
    (expiresAt && expiresAt.getTime() <= Date.now() + 1_000
      ? new Date(expiresAt.getTime() - 1_000)
      : new Date());
  const res = await offerTickets(
    db,
    {
      professionalId: pro.proId,
      actorUserId: pro.userId,
      customerId,
      ticketTypeId,
      quantity,
      expiresAt,
      notify: false,
    },
    now,
  );
  return check("giveTickets", res).ticketIds;
}

export async function occurrencesOf(db: Db, eventId: string): Promise<OccurrenceRow[]> {
  return db
    .select()
    .from(occurrence)
    .where(eq(occurrence.eventId, eventId))
    .orderBy(asc(occurrence.startsAt), asc(occurrence.id));
}

export async function getOccurrence(db: Db, id: string): Promise<OccurrenceRow> {
  const [row] = await db.select().from(occurrence).where(eq(occurrence.id, id));
  if (!row) throw new Error(`occurrence ${id} not found`);
  return row;
}

export async function getBooking(db: Db, id: string): Promise<BookingRow> {
  const [row] = await db.select().from(booking).where(eq(booking.id, id));
  if (!row) throw new Error(`booking ${id} not found`);
  return row;
}

/** The customer's tickets, oldest first. */
export async function ticketsOf(db: Db, customerId: string): Promise<TicketRow[]> {
  return db
    .select()
    .from(ticket)
    .where(eq(ticket.customerId, customerId))
    .orderBy(asc(ticket.createdAt), asc(ticket.id));
}

/** Movements of a ticket ordered by seq. */
export async function movementsOf(
  db: Db,
  ticketId: string,
): Promise<{ kind: string; fromStatus: string | null; toStatus: string; actionId: string }[]> {
  return db
    .select({
      kind: ticketMovement.kind,
      fromStatus: ticketMovement.fromStatus,
      toStatus: ticketMovement.toStatus,
      actionId: ticketMovement.actionId,
    })
    .from(ticketMovement)
    .where(eq(ticketMovement.ticketId, ticketId))
    .orderBy(asc(ticketMovement.seq));
}
