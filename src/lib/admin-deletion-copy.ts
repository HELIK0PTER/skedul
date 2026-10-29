/**
 * French sentences of the admin « Supprimer le compte » card (pure, so the
 * agreement in number is tested; the card is a client component and this module
 * pulls in neither the database nor the server). Counts go through plural() /
 * formatCount (fr-FR thousands, 0 and 1 take the singular). Sentences are JS
 * strings on purpose: in JSX text, an apostrophe entity followed by a line
 * break makes Next's SWC drop the whitespace in front of the text.
 */
import type { ProStats } from "@/lib/admin-reads";
import { formatCount, plural, pluralWord } from "@/lib/back-office/format";

/** What the pro page holds and loses with the account. */
export function pageContentNote(slug: string, stats: ProStats): string {
  return `La page /${slug} et tout son contenu : ${plural(stats.events, "événement", "événements")}, ${plural(stats.ticketTypes, "type de ticket", "types de ticket")}, ${plural(stats.confirmedBookings, "réservation confirmée", "réservations confirmées")}, ${plural(stats.clients, "client", "clients")}, ${plural(stats.paidPurchases, "achat payé", "achats payés")}.`;
}

export function upcomingNote(count: number): string {
  const told = count === 1 ? "sans que le client soit prévenu" : "sans que les clients soient prévenus";
  return `${plural(count, "réservation à venir disparaîtra", "réservations à venir disparaîtront")} ${told}.`;
}

export function ticketsNote(count: number): string {
  return `${plural(count, "ticket en circulation sera perdu", "tickets en circulation seront perdus")} pour ses clients, sans remboursement automatique.`;
}

/** Payments in progress: their still-open Stripe sessions are expired before the deletion (E13). */
export function pendingPaymentsNote(count: number): string {
  return `${plural(count, "paiement en cours", "paiements en cours")} : ${pluralWord(count, "sa session Stripe encore ouverte sera expirée", "leurs sessions Stripe encore ouvertes seront expirées")} avant la suppression.`;
}

/** The user's client records at OTHER pros: kept, detached from the account. */
export function clientRecordsNote(count: number): string {
  if (count < 2) return "Sa fiche client chez un autre pro est conservée, mais détachée du compte.";
  return `Ses ${formatCount(count)} fiches client chez d'autres pros sont conservées, mais détachées du compte.`;
}
