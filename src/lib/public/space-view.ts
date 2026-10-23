/**
 * The pure rules and the fixed copy of the client espace actions (Task 22): what each spend button does for a visitor
 * state, the confirmation text of a cancellation, and which visitor state an espace identity stands for. Pure, so the
 * decisions are tested as values; the client leaves (cancel-booking-button.tsx, spend-seance-button.tsx) and the page
 * only apply them. French, vouvoiement, no dash.
 */
import type { ConfirmCopy } from "@/lib/back-office/confirm-copy";
import type { SpaceIdentity } from "@/lib/back-office/guest-access";
import type { VisitorState } from "@/lib/public/identity";
import type { BookingCoverage } from "@/lib/tickets-vocab";

/** DOM id of the « Vos prochaines inscriptions » heading: the focus lands there when a success removes the control that held it (WCAG 2.4.3). */
export const UPCOMING_HEADING_ID = "espace-upcoming";
export const UPCOMING_TITLE = "Vos prochaines inscriptions";
export const SPEND_TITLE = "Utiliser vos tickets";
export const SPEND_LABEL = "Réserver avec 1 ticket";
/** A séance with questions is booked on its own page, where they are asked. */
export const SPEND_LINK_LABEL = "Réserver";
export const SPEND_DONE = "Réservation confirmée.";
export const CANCEL_LABEL = "Annuler";

/** The confirmation of « Annuler » (COV-M12): the ticket comes back for a ticket booking, the pro is told, the client gets a confirmation e-mail. */
export function cancelBookingCopy(coverage: BookingCoverage, businessName: string): ConfirmCopy {
  const told = `${businessName} est prévenu par email. Vous recevez un email de confirmation.`;
  return {
    title: "Annuler votre inscription ?",
    body: coverage === "ticket" ? `Votre ticket vous est rendu et ${told}` : told,
    confirm: "Annuler l'inscription",
  };
}

/** The accessible name of a row's « Annuler »: starts with the visible label (WCAG 2.5.3) and says which booking. */
export function cancelButtonName(title: string, whenLabel: string): string {
  return `${CANCEL_LABEL} : ${title}, ${whenLabel}`;
}

/** The accessible name of a row's « Réserver … »: starts with the visible label (WCAG 2.5.3) and says which séance, so the rows of the list are told apart. */
export function spendButtonName(label: string, title: string, whenLabel: string): string {
  return `${label} : ${title}, ${whenLabel}`;
}

/**
 * The visitor state an espace identity stands for. The personal-link cookie alone is « anonymous » (it spends nothing:
 * it proves nothing about who holds the browser); a signed-in visitor is never anonymous (COV-C1).
 */
export function visitorStateOfIdentity(identity: SpaceIdentity): VisitorState {
  switch (identity.kind) {
    case "impersonating":
      return "impersonating";
    case "unverified":
      return "unverified";
    case "no_record":
      return "verified";
    case "customer":
      return identity.via === "session" ? "verified" : "anonymous";
    case "anonymous":
      return "anonymous";
  }
}

/** Only the Owner spends tickets: a verified session with a record at this pro (OUT:75). The cookie, an unverified or an impersonated session never do. */
export function canSpendIn(identity: SpaceIdentity): boolean {
  return identity.kind === "customer" && identity.via === "session";
}

/**
 * Who is offered « Se déconnecter » on the espace: a visitor with a session who is not an impersonating admin, verified
 * or not (an unverified visitor sees only the banner's code button otherwise and has no way out). The personal link
 * alone is no sign-in (« Ce n'est pas moi » is its exit), the admin ends the impersonation elsewhere, and a verified
 * visitor without a record has « Utiliser une autre adresse », which signs out too.
 */
export function canSignOutIn(identity: SpaceIdentity): boolean {
  switch (identity.kind) {
    case "unverified":
      return true;
    case "customer":
      return identity.via === "session";
    case "no_record":
    case "impersonating":
    case "anonymous":
      return false;
  }
}

/**
 * The e-mail confirmation banner of the espace (the dashboard layout pattern): every signed-in, non-impersonated
 * visitor gets it, with `verified` read from the visitor state, so the client component stays mounted when a code is
 * accepted and the identity flips: « Adresse confirmée. » is then announced and takes the focus (WCAG 2.4.3). The
 * personal-link cookie alone is not a sign-in (no banner) and an impersonating admin must not verify the client's
 * address. `shownEmail` is the e-mail of the customer shown, which for an Owner is her session address.
 */
export function bannerOfIdentity(
  identity: SpaceIdentity,
  shownEmail: string | null,
): { email: string; verified: boolean } | null {
  switch (identity.kind) {
    case "unverified":
      return { email: identity.email, verified: false };
    case "no_record":
      return { email: identity.email, verified: true };
    case "customer":
      return identity.via === "session" && shownEmail !== null ? { email: shownEmail, verified: true } : null;
    case "impersonating":
    case "anonymous":
      return null;
  }
}

export type SpendControl = "none" | "link" | "book" | "signin" | "disabled";

/**
 * What a « spend » row offers: nothing while an admin impersonates; a link to the séance page when it asks questions
 * (the espace posts no answers); the one-click booking to a verified Owner only (`canSpend` AND a verified state, so a
 * wrong prop cannot enable it for anyone else); the sign-in dialog to an anonymous visitor holding a personal link
 * (the code proves the address, Decision 7); a disabled, described button to an unverified one.
 */
export function spendControlOf(a: { needsAnswers: boolean; canSpend: boolean; visitorState: VisitorState }): SpendControl {
  if (a.visitorState === "impersonating") return "none";
  if (a.needsAnswers) return "link";
  if (a.canSpend && a.visitorState === "verified") return "book";
  if (a.visitorState === "anonymous") return "signin";
  if (a.visitorState === "unverified") return "disabled";
  return "none";
}
