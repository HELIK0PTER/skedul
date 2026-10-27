/**
 * What the thank-you page says about a purchase (spec L1460-1461, contract § 3.22). Pure: it maps the purchase reference
 * to one of seven states and a state to its copy; the page adds the test-payment line and the buttons. A state carries only
 * what the sentence needs (a title, a date, a count, a type name): never the purchase, the customer or an address
 * (Decision 71).
 */
import { formatCount, formatWhen } from "@/lib/back-office/format";
import { COPY } from "@/lib/public/messages";
import type { PurchaseReference } from "@/lib/public/purchase-reads";

export type MerciState =
  | { kind: "booked"; title: string; whenLabel: string }
  | { kind: "paid_shop"; count: number; typeName: string }
  | { kind: "paid_late"; count: number }
  | { kind: "paid_cancelled" }
  | { kind: "processing" }
  | { kind: "pending" }
  | { kind: "expired"; withBooking: boolean };

/**
 * paid + confirmed booking → booked; paid + expired booking → paid_late (only a hold expires: the place was released
 * before the payment landed); paid + cancelled booking → paid_cancelled (G4c: a late payment and a booking cancelled after
 * it was confirmed leave the same row, so this state gives no reason); paid without booking → paid_shop; pending +
 * processing → processing; pending → pending; expired → expired (L1460-1461). A paid purchase whose booking is still
 * pending is a transient moment (fulfilment confirms both in one batch): it reads pending, and the page keeps looking.
 */
export function merciStateOf(ref: PurchaseReference, tz: string): MerciState {
  if (ref.status === "paid") {
    const count = ref.ticketCount > 0 ? ref.ticketCount : ref.quantity;
    const booking = ref.booking;
    if (booking === null) return { kind: "paid_shop", count, typeName: ref.ticketTypeName };
    if (booking.status === "confirmed") {
      return { kind: "booked", title: booking.title, whenLabel: formatWhen(booking.startsAt, booking.endsAt, tz) };
    }
    if (booking.status === "pending") return { kind: "pending" };
    if (booking.status === "cancelled") return { kind: "paid_cancelled" };
    return { kind: "paid_late", count };
  }
  if (ref.status === "pending") return ref.processing ? { kind: "processing" } : { kind: "pending" };
  return { kind: "expired", withBooking: ref.booking !== null };
}

/** Title and body of a state (exact copy, contract § 3.23). */
export function merciCopy(state: MerciState): { title: string; body: string } {
  switch (state.kind) {
    case "booked":
      return {
        title: "Inscription confirmée",
        body: `Paiement reçu. Vous êtes inscrit(e) à « ${state.title} » (${state.whenLabel}). Vous recevez par email la confirmation et le reçu.`,
      };
    case "paid_shop":
      return {
        title: COPY.PAYMENT_RECEIVED,
        body:
          state.count === 1
            ? `Votre ticket « ${state.typeName} » est dans votre portefeuille.`
            : `Vos ${formatCount(state.count)} tickets « ${state.typeName} » sont dans votre portefeuille.`,
      };
    case "paid_late":
      return {
        title: COPY.PAYMENT_RECEIVED,
        body:
          state.count === 1
            ? "Paiement reçu, votre place n'était plus réservée : votre ticket est dans votre portefeuille."
            : `Paiement reçu, votre place n'était plus réservée : vos ${formatCount(state.count)} tickets sont dans votre portefeuille.`,
      };
    case "paid_cancelled":
      return { title: COPY.PAYMENT_RECEIVED, body: "Paiement reçu. Cette réservation a été annulée." };
    case "processing":
      return {
        title: COPY.PROCESSING,
        body: "Votre banque confirme le paiement. Vous recevrez un email dès qu'il sera validé.",
      };
    case "pending":
      return {
        title: "Paiement en attente de confirmation",
        body: "La confirmation arrive dans quelques secondes. Cette page se met à jour toute seule.",
      };
    case "expired":
      return state.withBooking
        ? { title: "Place expirée", body: "Le paiement n'a pas abouti et votre réservation a expiré." }
        : { title: "Paiement non abouti", body: "Le paiement n'a pas abouti." };
  }
}
