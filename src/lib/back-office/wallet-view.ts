/**
 * Wallet view model (spec § 13.1, § 9). One group per ticket type the client
 * holds tickets of, with the display lines and the EXPLICIT ticket ids every
 * wallet action sends (OUT L125: an id list is idempotent, a quantity is not).
 * Pure: `now` and `tz` are arguments, the host zone never matters. Tickets of a
 * type that is not in `types` are ignored (the foreign key makes it impossible).
 */
import { dayLabel, expiryLabel, expirySummary, yearOf } from "@/lib/back-office/format";
import { ORIGIN_LABELS, type AlertTone } from "@/lib/back-office/labels";
import { todayKey } from "@/lib/civil-date";
import { lastValidDay } from "@/lib/ticket-expiry";
import { CLOSE_REASON_LABELS, type TicketCloseReason, type TicketStatus } from "@/lib/tickets-vocab";
import { consumptionOrder, isUsable, type TypeClass } from "@/lib/wallet-rules";

export type WalletTicketRow = {
  id: string;
  ticketTypeId: string;
  status: TicketStatus;
  expiresAt: Date | null;
  purchaseId: string | null;
  closedReason: TicketCloseReason | null;
  closedNote: string | null;
  statusChangedAt: Date;
  createdAt: Date;
  /** starts_at of the occurrence of a booked ticket */
  bookingStartsAt: Date | null;
};

export type WalletTypeRow = { id: string; name: string; color: string; archived: boolean };

export type WalletTicketView = {
  id: string;
  origin: "Acheté" | "Offert";
  line: string;
  tone: "ok" | "red" | "muted";
  struck: boolean;
};

export type WalletGroup = {
  ticketTypeId: string;
  name: string;
  color: string;
  archived: boolean;
  alert: AlertTone | null;
  usableCount: number;
  expirySummary: string[];
  usable: WalletTicketView[];
  booked: WalletTicketView[];
  expired: WalletTicketView[];
  done: WalletTicketView[];
  ids: {
    point: string[];
    convert: string[];
    closePaid: string[];
    closeAny: string[];
    retire: string[];
    unpoint: string[];
  };
};

type Bucket = "usable" | "booked" | "expired" | "done";

const compareId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The local day of an instant in tz, named by the year rule of `dayLabel` (format.ts). */
function dayOf(instant: Date, tz: string, now: Date): string {
  return dayLabel(todayKey(instant, tz), yearOf(now, tz));
}

/** A booked ticket on a séance that has started is « done » (spec § 7: derived, no state change). */
function bucketOf(t: WalletTicketRow, now: Date): Bucket {
  if (isUsable(t, now)) return "usable";
  if (t.status === "available" || t.status === "expired") return "expired";
  if (t.status === "booked") {
    return t.bookingStartsAt === null || t.bookingStartsAt.getTime() > now.getTime() ? "booked" : "done";
  }
  return "done";
}

function view(t: WalletTicketRow, line: string, tone: WalletTicketView["tone"], struck: boolean): WalletTicketView {
  return {
    id: t.id,
    origin: t.purchaseId === null ? ORIGIN_LABELS.offered : ORIGIN_LABELS.purchased,
    line,
    tone,
    struck,
  };
}

function withNote(text: string, note: string | null): string {
  const trimmed = note?.trim();
  return trimmed ? `${text} (${trimmed})` : text;
}

function usableView(t: WalletTicketRow, now: Date, tz: string): WalletTicketView {
  return view(t, `Disponible · ${expiryLabel(t.expiresAt, tz, now)}`, "ok", false);
}

function bookedView(t: WalletTicketRow, tz: string, now: Date): WalletTicketView {
  const line = t.bookingStartsAt ? `Réservé pour le ${dayOf(t.bookingStartsAt, tz, now)}` : "Réservé";
  return view(t, line, "ok", false);
}

function expiredView(t: WalletTicketRow, tz: string, now: Date): WalletTicketView {
  const line = t.expiresAt
    ? `Expiré (valable jusqu'au ${dayLabel(lastValidDay(t.expiresAt, tz), yearOf(now, tz))} inclus)`
    : "Expiré";
  return view(t, line, "red", false);
}

function doneView(t: WalletTicketRow, tz: string, now: Date): WalletTicketView {
  if (t.status === "used") {
    return view(t, `Pointé le ${dayOf(t.statusChangedAt, tz, now)}`, "muted", true);
  }
  if (t.status === "closed") {
    const day = dayOf(t.statusChangedAt, tz, now);
    if (t.closedReason === "retire") return view(t, withNote(`Retiré le ${day}`, t.closedNote), "muted", true);
    const reason = t.closedReason ? ` : ${CLOSE_REASON_LABELS[t.closedReason]}` : "";
    return view(t, withNote(`Clos le ${day}${reason}`, t.closedNote), "muted", true);
  }
  return view(t, `Utilisé le ${dayOf(t.bookingStartsAt ?? t.statusChangedAt, tz, now)}`, "muted", true);
}

/** The instant a done ticket left the wallet: the séance for a booked one, else its last status change. */
const doneAt = (t: WalletTicketRow): number =>
  (t.status === "booked" ? (t.bookingStartsAt ?? t.statusChangedAt) : t.statusChangedAt).getTime();

/** One line per last valid day, then the tickets without limit (the shared `expirySummary` of format.ts, also used by the client e-mails). */
function expirySummaryOf(usable: readonly WalletTicketRow[], tz: string, now: Date): string[] {
  return expirySummary(
    usable.map((t) => ({ expiresAt: t.expiresAt, count: 1 })),
    tz,
    now,
  );
}

function buildGroup(
  type: WalletTypeRow,
  rows: readonly WalletTicketRow[],
  cls: TypeClass,
  now: Date,
  tz: string,
): WalletGroup {
  const inBucket = (bucket: Bucket) => rows.filter((t) => bucketOf(t, now) === bucket);
  const usableRows = consumptionOrder(inBucket("usable"));
  const bookedRows = inBucket("booked").sort(
    (a, b) =>
      (a.bookingStartsAt?.getTime() ?? Infinity) - (b.bookingStartsAt?.getTime() ?? Infinity) || compareId(a.id, b.id),
  );
  const expiredRows = inBucket("expired").sort(
    (a, b) =>
      (b.expiresAt?.getTime() ?? -Infinity) - (a.expiresAt?.getTime() ?? -Infinity) || compareId(a.id, b.id),
  );
  const doneRows = inBucket("done").sort((a, b) => doneAt(b) - doneAt(a) || compareId(a.id, b.id));
  // Same order as the engine's unpointTickets: statusChangedAt desc, then id desc.
  const usedRows = rows
    .filter((t) => t.status === "used")
    .sort((a, b) => b.statusChangedAt.getTime() - a.statusChangedAt.getTime() || compareId(b.id, a.id));
  const usableIds = usableRows.map((t) => t.id);
  const alert: AlertTone | null =
    usableRows.length === 0 ? null : cls === "archived" ? "red" : cls === "orphan" ? "orange" : null;
  return {
    ticketTypeId: type.id,
    name: type.name,
    color: type.color,
    archived: type.archived,
    alert,
    usableCount: usableRows.length,
    expirySummary: expirySummaryOf(usableRows, tz, now),
    usable: usableRows.map((t) => usableView(t, now, tz)),
    booked: bookedRows.map((t) => bookedView(t, tz, now)),
    expired: expiredRows.map((t) => expiredView(t, tz, now)),
    done: doneRows.map((t) => doneView(t, tz, now)),
    ids: {
      point: [...usableIds],
      convert: [...usableIds],
      closePaid: usableRows.filter((t) => t.purchaseId !== null).map((t) => t.id),
      closeAny: [...usableIds],
      retire: usableRows.filter((t) => t.purchaseId === null).map((t) => t.id),
      unpoint: usedRows.map((t) => t.id),
    },
  };
}

/**
 * Spec § 13.1 wallet: one group per type holding tickets (the `types` order),
 * red = usable tickets of an archived type, orange = usable tickets of an
 * orphan class (spec § 9); lines and actionable ids (explicit ids, consumption
 * order, « Annuler le pointage » most recent first).
 */
export function groupWallet(
  tickets: readonly WalletTicketRow[],
  types: readonly WalletTypeRow[],
  classes: ReadonlyMap<string, TypeClass>,
  now: Date,
  tz: string,
): WalletGroup[] {
  const byType = new Map<string, WalletTicketRow[]>();
  for (const t of tickets) {
    const list = byType.get(t.ticketTypeId);
    if (list) list.push(t);
    else byType.set(t.ticketTypeId, [t]);
  }
  const groups: WalletGroup[] = [];
  for (const type of types) {
    const rows = byType.get(type.id);
    if (!rows || rows.length === 0) continue;
    const cls: TypeClass = classes.get(type.id) ?? (type.archived ? "archived" : "ok");
    groups.push(buildGroup(type, rows, cls, now, tz));
  }
  return groups;
}
