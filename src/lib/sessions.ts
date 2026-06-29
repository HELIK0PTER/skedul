import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { classSession } from "@/lib/db/schema";

interface ClaimArgs {
  professionalId: string;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
}

type ClaimResult =
  | { ok: true; sessionId: string; seatsRemaining: number }
  | { ok: false };

/**
 * Atomically claims one seat in the session at (eventTypeId, startAt).
 * Creates the session on first booking. Mirrors the guarded credit-spend
 * pattern — safe under Neon HTTP without an interactive transaction.
 */
export async function claimSeat(args: ClaimArgs): Promise<ClaimResult> {
  const claimed = await db
    .insert(classSession)
    .values({
      professionalId: args.professionalId,
      eventTypeId: args.eventTypeId,
      startAt: args.startAt,
      endAt: args.endAt,
      capacity: args.capacity,
      seatsRemaining: args.capacity - 1,
    })
    .onConflictDoUpdate({
      target: [classSession.eventTypeId, classSession.startAt],
      set: { seatsRemaining: sql`${classSession.seatsRemaining} - 1` },
      setWhere: sql`${classSession.seatsRemaining} > 0`,
    })
    .returning({
      id: classSession.id,
      seatsRemaining: classSession.seatsRemaining,
    });

  if (claimed.length === 0) return { ok: false };
  return {
    ok: true,
    sessionId: claimed[0].id,
    seatsRemaining: claimed[0].seatsRemaining,
  };
}

/** Returns one seat to a session (guarded so it never exceeds capacity). */
export async function releaseSeat(sessionId: string): Promise<void> {
  await db
    .update(classSession)
    .set({ seatsRemaining: sql`${classSession.seatsRemaining} + 1` })
    .where(
      sql`${classSession.id} = ${sessionId} AND ${classSession.seatsRemaining} < ${classSession.capacity}`,
    );
}
