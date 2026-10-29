/**
 * Raw row builders for the engine-core DB tests (Tasks 14 to 17), usable
 * before the catalog and wallet engine exist. Builder inserts, nanoid ids,
 * every timestamp from `now`. They bypass every engine guard on purpose: a test
 * that keeps the default invariant check (src/test/db.ts) must still leave a
 * consistent state. Later tests use the engine-backed src/test/fixtures.ts.
 */
import { nanoid } from "nanoid";

import type { Db } from "../lib/db/atomic";
import * as schema from "../lib/db/schema";
import type {
  BookingCoverage,
  BookingMode,
  BookingStatus,
  MovementKind,
  OccurrenceStatus,
  PurchaseStatus,
  TicketStatus,
} from "../lib/tickets";
import { testEmail, type TestPro } from "./db";

const MINUTE = 60_000;
const DAY = 86_400_000;

type TypeOverrides = Omit<Partial<typeof schema.ticketType.$inferInsert>, "id" | "professionalId">;

export async function rowType(db: Db, pro: TestPro, over: TypeOverrides = {}, now = new Date()): Promise<string> {
  const id = nanoid();
  await db.insert(schema.ticketType).values({
    id,
    professionalId: pro.proId,
    name: `Type ${id}`,
    createdAt: now,
    updatedAt: now,
    ...over,
  });
  return id;
}

/** A paid RDV libre type (60 min). */
export function rowRdvType(db: Db, pro: TestPro, over: TypeOverrides = {}): Promise<string> {
  return rowType(db, pro, { rdvEnabled: true, rdvDurationMin: 60, ...over });
}

export async function rowOffer(
  db: Db,
  pro: TestPro,
  ticketTypeId: string,
  over: { quantity?: number; priceCents?: number; archivedAt?: Date | null } = {},
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  await db.insert(schema.ticketOffer).values({
    id,
    professionalId: pro.proId,
    ticketTypeId,
    quantity: over.quantity ?? 1,
    priceCents: over.priceCents ?? 2500,
    archivedAt: over.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function rowCustomer(
  db: Db,
  pro: TestPro,
  over: { email?: string; name?: string; userId?: string | null } = {},
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  await db.insert(schema.customer).values({
    id,
    professionalId: pro.proId,
    email: over.email ?? testEmail(),
    name: over.name ?? `Client ${id}`,
    userId: over.userId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** A one-off event row (no séance: add them with rowSeance). */
export async function rowEvent(
  db: Db,
  pro: TestPro,
  over: { bookingMode?: BookingMode; capacity?: number; isPrivate?: boolean; archivedAt?: Date | null } = {},
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  await db.insert(schema.event).values({
    id,
    professionalId: pro.proId,
    title: `Event ${id}`,
    bookingMode: over.bookingMode ?? "tickets",
    isPrivate: over.isPrivate ?? false,
    capacity: over.capacity ?? 12,
    durationMin: 60,
    startDate: "2026-01-01",
    startMinute: 600,
    freq: "once",
    interval: 1,
    endMode: "count",
    occurrenceCount: 1,
    generatedUntil: "2026-01-01",
    seriesRootId: id,
    archivedAt: over.archivedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function rowLink(db: Db, pro: TestPro, eventId: string, ticketTypeId: string, now = new Date()): Promise<void> {
  await db.insert(schema.eventTicketType).values({ eventId, ticketTypeId, professionalId: pro.proId, createdAt: now });
}

/** A séance of `eventId`, 60 min, starting `startsAt` (default now + 2 days). */
export async function rowSeance(
  db: Db,
  pro: TestPro,
  eventId: string,
  over: { startsAt?: Date; capacity?: number; seatsTaken?: number; status?: OccurrenceStatus; seriesDate?: string } = {},
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  const startsAt = over.startsAt ?? new Date(now.getTime() + 2 * DAY);
  const endsAt = new Date(startsAt.getTime() + 60 * MINUTE);
  const status = over.status ?? "scheduled";
  await db.insert(schema.occurrence).values({
    id,
    professionalId: pro.proId,
    eventId,
    seriesDate: over.seriesDate ?? startsAt.toISOString().slice(0, 10),
    startsAt,
    endsAt,
    blockStart: startsAt,
    blockEnd: endsAt,
    capacity: over.capacity ?? 12,
    seatsTaken: over.seatsTaken ?? 0,
    status,
    cancelledAt: status === "cancelled" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** A booked RDV libre of `ticketTypeId` (capacity 1), default seats_taken 1 and starting now + 2 days. */
export async function rowRdv(
  db: Db,
  pro: TestPro,
  ticketTypeId: string,
  over: { startsAt?: Date; durationMin?: number; seatsTaken?: number; status?: OccurrenceStatus } = {},
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  const startsAt = over.startsAt ?? new Date(now.getTime() + 2 * DAY);
  const endsAt = new Date(startsAt.getTime() + (over.durationMin ?? 60) * MINUTE);
  const status = over.status ?? "scheduled";
  await db.insert(schema.occurrence).values({
    id,
    professionalId: pro.proId,
    ticketTypeId,
    startsAt,
    endsAt,
    blockStart: startsAt,
    blockEnd: endsAt,
    capacity: 1,
    seatsTaken: over.seatsTaken ?? 1,
    status,
    cancelledAt: status === "cancelled" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function rowPurchase(
  db: Db,
  pro: TestPro,
  args: {
    customerId: string;
    offerId: string;
    ticketTypeId: string;
    status?: PurchaseStatus;
    quantity?: number;
    amountCents?: number;
    currency?: string;
    livemode?: boolean;
    paymentIntentId?: string | null;
    /** default: a fresh id when paid, else null */
    fulfilledActionId?: string | null;
    paidAt?: Date;
  },
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  const status = args.status ?? "pending";
  await db.insert(schema.ticketPurchase).values({
    id,
    professionalId: pro.proId,
    customerId: args.customerId,
    offerId: args.offerId,
    ticketTypeId: args.ticketTypeId,
    label: "Offre de test",
    quantity: args.quantity ?? 1,
    amountCents: args.amountCents ?? 2500,
    currency: args.currency ?? "eur",
    status,
    livemode: args.livemode ?? false,
    checkoutExpiresAt: new Date(now.getTime() + 31 * MINUTE),
    paymentIntentId: args.paymentIntentId ?? null,
    paidAt: status === "paid" ? (args.paidAt ?? now) : null,
    fulfilledActionId:
      args.fulfilledActionId === undefined ? (status === "paid" ? nanoid() : null) : args.fulfilledActionId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function rowBooking(
  db: Db,
  pro: TestPro,
  args: {
    occurrenceId: string;
    customerId: string;
    status?: BookingStatus;
    coverage?: BookingCoverage;
    purchaseId?: string | null;
    holdExpiresAt?: Date;
  },
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  const status = args.status ?? "confirmed";
  const ended = status === "cancelled" || status === "expired";
  await db.insert(schema.booking).values({
    id,
    professionalId: pro.proId,
    occurrenceId: args.occurrenceId,
    customerId: args.customerId,
    status,
    coverage: args.coverage ?? "guest",
    purchaseId: args.purchaseId ?? null,
    createdBy: "pro",
    holdExpiresAt: status === "pending" ? (args.holdExpiresAt ?? new Date(now.getTime() + 45 * MINUTE)) : null,
    confirmedAt: status === "confirmed" ? now : null,
    endedAt: ended ? now : null,
    endedBy: ended ? "system" : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function rowMovement(
  db: Db,
  pro: TestPro,
  args: {
    ticketId: string;
    customerId: string;
    ticketTypeId: string;
    kind: MovementKind;
    fromStatus: TicketStatus | null;
    toStatus: TicketStatus;
    bookingId?: string | null;
    purchaseId?: string | null;
  },
  now = new Date(),
): Promise<void> {
  await db.insert(schema.ticketMovement).values({
    professionalId: pro.proId,
    customerId: args.customerId,
    ticketId: args.ticketId,
    actionId: nanoid(),
    kind: args.kind,
    fromStatus: args.fromStatus,
    toStatus: args.toStatus,
    ticketTypeId: args.ticketTypeId,
    bookingId: args.bookingId ?? null,
    purchaseId: args.purchaseId ?? null,
    actor: "system",
    createdAt: now,
  });
}

const SECOND_MOVE: Record<Exclude<TicketStatus, "available">, MovementKind> = {
  booked: "spend",
  used: "pointage",
  expired: "expire",
  closed: "close",
};

/**
 * A ticket in `status` (booked needs bookingId) with the movements that lead
 * there (purchase or offer, then spend / pointage / expire / close), unless
 * `movements: false` (invariant I4 tests).
 */
export async function rowTicket(
  db: Db,
  pro: TestPro,
  args: {
    customerId: string;
    ticketTypeId: string;
    status?: TicketStatus;
    bookingId?: string | null;
    purchaseId?: string | null;
    expiresAt?: Date | null;
    movements?: boolean;
  },
  now = new Date(),
): Promise<string> {
  const id = nanoid();
  const status = args.status ?? "available";
  await db.insert(schema.ticket).values({
    id,
    professionalId: pro.proId,
    customerId: args.customerId,
    ticketTypeId: args.ticketTypeId,
    purchaseId: args.purchaseId ?? null,
    status,
    bookingId: status === "booked" ? (args.bookingId ?? null) : null,
    expiresAt: args.expiresAt ?? null,
    closedReason: status === "closed" ? "autre" : null,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (args.movements === false) return id;
  const base = { ticketId: id, customerId: args.customerId, ticketTypeId: args.ticketTypeId, purchaseId: args.purchaseId ?? null };
  await rowMovement(
    db,
    pro,
    { ...base, kind: args.purchaseId ? "purchase" : "offer", fromStatus: null, toStatus: "available" },
    now,
  );
  if (status !== "available") {
    await rowMovement(
      db,
      pro,
      {
        ...base,
        kind: SECOND_MOVE[status],
        fromStatus: "available",
        toStatus: status,
        bookingId: status === "booked" ? (args.bookingId ?? null) : null,
      },
      now,
    );
  }
  return id;
}
