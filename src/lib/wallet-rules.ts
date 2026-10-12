/**
 * Wallet rules (spec § 9): ticket-type classes behind the client-list alerts,
 * the balance predicate and the consumption order. Pure; the facts come from
 * src/lib/booking/wallet.ts (loadTypeFacts) and the SQL twins live in
 * src/lib/booking/eligibility.ts.
 */
import type { TicketStatus } from "@/lib/tickets";

export type TypeFacts = {
  ticketTypeId: string;
  archived: boolean;
  rdvEnabled: boolean;
  /** linked to a non-archived tickets-mode event (private counts) with a future scheduled séance */
  linkedToUpcomingEvent: boolean;
};

/** ok, 🔴 archived, 🟠 orphan (active, not rdv_enabled, not linked). */
export type TypeClass = "ok" | "archived" | "orphan";

export function classifyTypes(types: readonly TypeFacts[]): Map<string, TypeClass> {
  const classes = new Map<string, TypeClass>();
  for (const t of types) {
    const cls: TypeClass = t.archived ? "archived" : !t.rdvEnabled && !t.linkedToUpcomingEvent ? "orphan" : "ok";
    classes.set(t.ticketTypeId, cls);
  }
  return classes;
}

/** usable = available and not expired (isUsable), counted per type. */
export type Holding = { ticketTypeId: string; usable: number };

/** red: usable tickets of an archived type; orange: usable tickets of an orphan type. */
export function customerAlerts(
  holdings: readonly Holding[],
  classes: ReadonlyMap<string, TypeClass>,
): { red: boolean; orange: boolean } {
  let red = false;
  let orange = false;
  for (const h of holdings) {
    if (h.usable <= 0) continue;
    const cls = classes.get(h.ticketTypeId);
    if (cls === "archived") red = true;
    if (cls === "orphan") orange = true;
  }
  return { red, orange };
}

/** status available AND (expiresAt null OR expiresAt > at). */
export function isUsable(t: { status: TicketStatus; expiresAt: Date | null }, at: Date): boolean {
  return t.status === "available" && (t.expiresAt === null || t.expiresAt.getTime() > at.getTime());
}

/** Ascending, nulls last (ORDER BY expires_at ASC NULLS LAST). */
function compareExpiry(a: Date | null, b: Date | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.getTime() - b.getTime();
}

/** expiresAt asc nulls last, createdAt, id; returns a new array. */
export function consumptionOrder<T extends { id: string; expiresAt: Date | null; createdAt: Date }>(
  tickets: readonly T[],
): T[] {
  return [...tickets].sort(
    (a, b) =>
      compareExpiry(a.expiresAt, b.expiresAt) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
