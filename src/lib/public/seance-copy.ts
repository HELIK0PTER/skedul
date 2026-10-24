/**
 * Fixed sentences of the séance page that the shared client copy (messages.ts) does not hold (contract § 3.23, « Séance
 * page copy »). Pure and client-safe; no em dash and no en dash (ui-copy.test.ts).
 */
import type { PublicStateKind } from "@/lib/public/messages";

/** The sentence under the title of a séance that cannot be booked online, per state. */
export const SEANCE_STATE_LINES: Readonly<Record<Exclude<PublicStateKind, "free" | "open">, string>> = {
  cancelled: "Cette séance est annulée.",
  past: "Cette séance est terminée.",
  ongoing: "Cette séance a commencé.",
  onsite: "Pas de réservation en ligne : présentez-vous sur place.",
  notYet: "Les réservations ne sont pas encore ouvertes pour cette séance.",
  closed: "Les réservations en ligne sont fermées pour cette séance.",
  full: "Cette séance est complète.",
};

/** The sentence of a state, or null for free and open (the booking form is shown instead). */
export function stateLine(kind: PublicStateKind): string | null {
  return kind === "free" || kind === "open" ? null : SEANCE_STATE_LINES[kind];
}

/** The Owner's or the reference's confirmed booking on this séance. */
export const BOOKED_CONFIRMED = "Vous êtes inscrit(e) à cette séance.";
/** A pending booking: the payment is not done yet. */
export const BOOKED_PENDING = "Un paiement est en attente pour cette séance.";
export const SEE_MY_SPACE = "Voir mon espace";

/** Titles of the booking card: free registration, and the card that holds the tickets and the purchase. */
export const FREE_BOOKING_TITLE = "S'inscrire à cette séance";
export const TICKETS_BOOKING_TITLE = "Réserver cette séance";

/** Which ticket the « Réserver avec 1 ticket » button spends (the first in consumption order). */
export function ticketUsedLine(typeName: string): string {
  return `Ticket utilisé : ${typeName}.`;
}

/**
 * The id of the séance heading (`tabIndex={-1}` on the page). A success that books the signed-in visitor re-renders the
 * page as « booked » and removes the form that held the focus: the form then gives the focus to this heading, which
 * stays (WCAG 2.4.3).
 */
export const SEANCE_HEADING_ID = "seance-title";
