/**
 * Client history (Q27 as amended, Decision 19): ledger movements grouped into
 * readable lines. Format:
 * « JJ/MM HH:mm · {acteur} · {libellé} {n} {type}[ → {type B}][ ({motif ou note})][ · {séance}] ».
 * Newest action first (by the highest seq of its movements); the lines of an
 * action follow seq. Pure: `tz` is an argument.
 */
import { formatCount, formatDayMonthOf, formatDayMonthTime } from "@/lib/back-office/format";
import {
  ACTOR_LABELS,
  CLOSE_REASON_LABELS,
  MOVEMENT_KIND_LABELS,
  type Actor,
  type MovementKind,
  type TicketCloseReason,
} from "@/lib/tickets-vocab";

export type LedgerMovementRow = {
  seq: number;
  actionId: string;
  kind: MovementKind;
  ticketTypeId: string;
  fromTicketTypeId: string | null;
  actor: Actor;
  reason: string | null;
  createdAt: Date;
  /** the ticket's closed_reason, for close movements */
  closedReason: TicketCloseReason | null;
  /** through booking_id, for spend / return */
  occurrence: { title: string; startsAt: Date } | null;
};

export type HistoryLine = { key: string; text: string };

/** Shown for a ticket type that no longer exists. */
export const UNKNOWN_TYPE = "type supprimé";

type Group = {
  label: string;
  actor: string;
  kind: MovementKind;
  ticketTypeId: string;
  fromTicketTypeId: string | null;
  motif: string | null;
  occurrence: LedgerMovementRow["occurrence"];
  count: number;
};

type Action = { actionId: string; lastSeq: number; first: LedgerMovementRow; groups: Map<string, Group> };

/** The motif shown between parentheses: close = reason (+ note), retire / pointage / offer = the note, else none. */
function motifOf(row: LedgerMovementRow): string | null {
  const note = row.reason?.trim() || null;
  switch (row.kind) {
    case "close": {
      if (row.closedReason === "retire" || row.closedReason === null) return note;
      const label = CLOSE_REASON_LABELS[row.closedReason];
      return note ? `${label}, ${note}` : label;
    }
    case "pointage":
    case "offer":
      return note;
    default:
      return null;
  }
}

function labelOf(row: LedgerMovementRow): string {
  return row.kind === "close" && row.closedReason === "retire" ? CLOSE_REASON_LABELS.retire : MOVEMENT_KIND_LABELS[row.kind];
}

/**
 * The actor field. The fulfillment writes purchase movements with actor "system"
 * (nobody acts in the back-office): the client bought online, so it reads « Client ».
 */
function actorLabelOf(row: LedgerMovementRow): string {
  return row.kind === "purchase" && row.actor === "system" ? ACTOR_LABELS.client : ACTOR_LABELS[row.actor];
}

function nameOf(typeNames: ReadonlyMap<string, string>, id: string): string {
  return typeNames.get(id) ?? UNKNOWN_TYPE;
}

function lineText(first: LedgerMovementRow, group: Group, typeNames: ReadonlyMap<string, string>, tz: string): string {
  const type =
    group.kind === "convert" && group.fromTicketTypeId !== null
      ? `${nameOf(typeNames, group.fromTicketTypeId)} → ${nameOf(typeNames, group.ticketTypeId)}`
      : nameOf(typeNames, group.ticketTypeId);
  const what = `${group.label} ${formatCount(group.count)} ${type}${group.motif ? ` (${group.motif})` : ""}`;
  const fields = [formatDayMonthTime(first.createdAt, tz), group.actor, what];
  if (group.occurrence) {
    fields.push(`${group.occurrence.title} du ${formatDayMonthOf(group.occurrence.startsAt, tz)}`);
  }
  return fields.join(" · ");
}

export function historyLines(
  rows: readonly LedgerMovementRow[],
  typeNames: ReadonlyMap<string, string>,
  tz: string,
): HistoryLine[] {
  const actions = new Map<string, Action>();
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    let action = actions.get(row.actionId);
    if (!action) {
      action = { actionId: row.actionId, lastSeq: row.seq, first: row, groups: new Map() };
      actions.set(row.actionId, action);
    }
    action.lastSeq = row.seq; // rows are visited by seq asc: the last assignment is the highest
    const motif = motifOf(row);
    const key = JSON.stringify([
      row.kind,
      row.ticketTypeId,
      row.fromTicketTypeId,
      row.closedReason,
      motif,
      row.occurrence ? [row.occurrence.title, row.occurrence.startsAt.getTime()] : null,
    ]);
    const group = action.groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      action.groups.set(key, {
        label: labelOf(row),
        actor: actorLabelOf(row),
        kind: row.kind,
        ticketTypeId: row.ticketTypeId,
        fromTicketTypeId: row.fromTicketTypeId,
        motif,
        occurrence: row.occurrence,
        count: 1,
      });
    }
  }
  const lines: HistoryLine[] = [];
  for (const action of [...actions.values()].sort((a, b) => b.lastSeq - a.lastSeq)) {
    let index = 0;
    for (const group of action.groups.values()) {
      lines.push({ key: `${action.actionId}:${index}`, text: lineText(action.first, group, typeNames, tz) });
      index += 1;
    }
  }
  return lines;
}
