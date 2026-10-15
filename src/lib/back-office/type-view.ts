/**
 * Copy of the ticket type cards and pages (spec § 13.1 « Tickets »), kept pure
 * so the exact French strings are unit-tested. No React, no server module.
 */
import { formatMoney } from "@/lib/utils";

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

/**
 * The orange mark « Lié à aucun événement à venir ». An rdv_free type is an
 * orphan for the wallet alert (its tickets are usable nowhere) but needs no
 * event itself, so its card never shows the mark.
 */
export function showOrphanMark(t: { orphan: boolean; archived: boolean; rdvFree: boolean }): boolean {
  return t.orphan && !t.archived && !t.rdvFree;
}
