/**
 * Copy of the ticket type cards and pages (spec § 13.1 « Tickets »), kept pure
 * so the exact French strings are unit-tested. No React, no server module.
 */
import { formatMoney } from "@/lib/utils";

import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "./notice";

/** « RDV libre · 60 min », « RDV gratuit · 15 min », null when the type is not bookable as an RDV. */
export function rdvBadgeLabel(t: { rdvEnabled: boolean; rdvFree: boolean; rdvDurationMin: number | null }): string | null {
  if (!t.rdvEnabled) return null;
  const base = t.rdvFree ? "RDV gratuit" : "RDV libre";
  return t.rdvDurationMin === null ? base : `${base} · ${t.rdvDurationMin} min`;
}

/** « À l'unité · 25 € », « Carnet de 4 · 85 € · 3 mois ». */
export function offerLine(o: { label: string; priceCents: number; validityText: string | null }, currency: string): string {
  const base = `${o.label} · ${formatMoney(o.priceCents, currency)}`;
  return o.validityText === null ? base : `${base} · ${o.validityText}`;
}

/** What a type without offer says. */
export function emptyOffersText(rdvFree: boolean): string {
  return rdvFree ? "Gratuit, sans ticket" : "Aucune offre";
}

/** « Accepté par : A, B » or « Accepté par aucun événement ». */
export function acceptedByText(acceptedBy: readonly { title: string }[]): string {
  return acceptedBy.length === 0 ? "Accepté par aucun événement" : `Accepté par : ${acceptedBy.map((e) => e.title).join(", ")}`;
}

/** Why an RDV type offers no slot online: `no_hours` and `notice_over_horizon` close it, `no_offer` leaves it to ticket holders. */
export type RdvIssue = "no_hours" | "notice_over_horizon" | "no_offer";

export const RDV_NOT_BOOKABLE = "Non réservable en ligne";

/**
 * The reasons an RDV type is not (fully) bookable online (P5 § 3.14, O14, P4CON:1353), the public loader's rules
 * (`rdvNeverBookable`): no hours at all (no own rule and no global one), or an effective notice above the effective
 * horizon. Only once neither holds, a paid type with no offer on sale is left to the clients who already hold its
 * tickets. Nothing for a type that is not an RDV type, has no duration or is archived (its RDV page is a 404).
 */
export function rdvIssuesOf(t: {
  rdvEnabled: boolean;
  rdvFree: boolean;
  rdvDurationMin: number | null;
  archived: boolean;
  hasHours: boolean;
  window: { minNoticeMinutes: number; bookingHorizonDays: number };
  offersOnSale: number;
}): RdvIssue[] {
  if (!t.rdvEnabled || t.rdvDurationMin === null || t.archived) return [];
  const closed: RdvIssue[] = [];
  if (!t.hasHours) closed.push("no_hours");
  if (noticeExceedsHorizon(t.window.minNoticeMinutes, t.window.bookingHorizonDays)) closed.push("notice_over_horizon");
  if (closed.length > 0) return closed;
  return !t.rdvFree && t.offersOnSale === 0 ? ["no_offer"] : [];
}

const ISSUE_LINES: Record<RdvIssue, string> = {
  no_hours: "Ce type n'a pas d'horaires propres et vos disponibilités générales sont vides : ajoutez des horaires.",
  notice_over_horizon: NOTICE_TOO_LONG,
  no_offer: "Seuls les clients qui ont déjà des tickets de ce type peuvent réserver. Mettez une offre en vente pour les autres.",
};

/** The note of the type page: « Non réservable en ligne » and each closing reason, or the ticket-holders-only note; null when bookable. */
export function rdvIssueNote(issues: readonly RdvIssue[]): { tone: "closed" | "tickets_only"; title: string; lines: string[] } | null {
  if (issues.length === 0) return null;
  const lines = issues.map((issue) => ISSUE_LINES[issue]);
  return issues.includes("no_offer")
    ? { tone: "tickets_only", title: "Réservable avec un ticket seulement", lines }
    : { tone: "closed", title: RDV_NOT_BOOKABLE, lines };
}

/**
 * The orange mark « Lié à aucun événement à venir ». An rdv_free type is an
 * orphan for the wallet alert (its tickets are usable nowhere) but needs no
 * event itself, so its card never shows the mark.
 */
export function showOrphanMark(t: { orphan: boolean; archived: boolean; rdvFree: boolean }): boolean {
  return t.orphan && !t.archived && !t.rdvFree;
}
