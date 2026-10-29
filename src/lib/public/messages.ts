/**
 * What a client reads on the public pages and in the client actions (spec §§ 11 to 13, contract § 3.2):
 * page states, fixed sentences, and the engine code turned into client wording per action context.
 * The pro's wording lives in src/lib/pro-messages.ts and never reaches a client. Pure: it imports only
 * the vocabulary, no server module; vouvoiement only; no dash.
 */
import { ENGINE_ERROR_MESSAGES, type EngineErrorCode } from "@/lib/tickets-vocab";

export type PublicErrorContext = "buybook" | "free" | "held" | "shop" | "release" | "cancel" | "rdv";
export type PublicStateKind = "cancelled" | "past" | "ongoing" | "onsite" | "notYet" | "closed" | "full" | "free" | "open";

/** Page and planning states (L1441, L1448-1451). */
export const PUBLIC_STATE_LABELS: Readonly<Record<Exclude<PublicStateKind, "open">, string>> = {
  cancelled: "Annulée",
  past: "Terminée",
  ongoing: "En cours",
  onsite: "Sur place",
  notYet: "Réservations pas encore ouvertes",
  closed: "Réservations fermées",
  full: "Complet",
  free: "Inscription libre",
};

const FULL_SEANCE = "Complet : il ne reste plus de place sur cette séance.";
const OFFER_CHANGED = "L'offre a changé : rafraîchissez la page.";
const SEANCE_GONE = "Cette séance n'existe plus : rafraîchissez la page.";
const CANCEL_LOCKED = "Seul(e) {businessName} peut annuler maintenant.";
/** An RDV start that is no longer offered (off the grid, past the notice, a narrowed week): P5 dossier § 3.10. */
const RDV_SLOT_GONE = "Ce créneau n'est plus disponible : choisissez-en un autre.";

/** Client wording per action context (overrides of ENGINE_ERROR_MESSAGES); « {businessName} » is substituted. */
export const CLIENT_CONTEXT_MESSAGES: Readonly<Partial<Record<PublicErrorContext, Partial<Record<EngineErrorCode, string>>>>> = {
  buybook: {
    full: FULL_SEANCE,
    stale: OFFER_CHANGED,
    not_found: "Cette séance ou cette offre n'existe plus : rafraîchissez la page.",
  },
  free: {
    full: FULL_SEANCE,
    not_found: SEANCE_GONE,
  },
  held: {
    full: FULL_SEANCE,
    not_found: SEANCE_GONE,
  },
  shop: {
    stale: OFFER_CHANGED,
    not_found: "Cette offre n'est plus proposée.",
  },
  release: {
    not_found: "Paiement introuvable : rafraîchissez la page.",
  },
  cancel: {
    too_late_or_done: CANCEL_LOCKED,
    not_found: "Inscription introuvable : rafraîchissez la page.",
    stale: "Cette inscription a changé : rafraîchissez la page.",
  },
  // RDV libre (bookRdv, every mode): a rendez-vous is never a séance, an inscription or a place (P5 copy rule).
  // `slot_taken` keeps the engine's own sentence « Ce créneau vient d'être pris. » (L711): no override needed.
  rdv: {
    unavailable: RDV_SLOT_GONE,
    stale: "Les horaires ou l'offre ont changé : rafraîchissez la page.",
    not_found: "Ce rendez-vous ou cette offre n'existe plus : rafraîchissez la page.",
    no_ticket: "Aucun ticket utilisable pour ce rendez-vous.",
    offer_too_short: "La validité de cette offre ne couvre pas la date du rendez-vous.",
    // A verified identity only: a typed address gets COPY.BUYBOOK_NOT_POSSIBLE instead (Decision 64).
    too_many_holds: "Vous avez déjà deux paiements en cours. Terminez-les avant de réserver un autre rendez-vous.",
  },
};

/** The business name goes in as typed: a function replacer, so « $& » or « $1 » in a name is not interpreted. */
function fill(template: string, businessName: string): string {
  return template.replace(/\{businessName\}/g, () => businessName);
}

/** fr-FR thousands (« 1 000 »). */
const fr = (n: number): string => n.toLocaleString("fr-FR");

/** `invalid` with an engine message → that message (French: buildAnswers, notes); else the context override; else ENGINE_ERROR_MESSAGES[code]. */
export function clientErrorMessage(
  fail: { code: EngineErrorCode; message?: string },
  context: PublicErrorContext,
  vars: { businessName: string },
): string {
  // Only `invalid` carries a message meant for the client, and only the claims.ts paths that public cores call put one there
  // (buildAnswers' « Réponse invalide pour … », the note length): those messages are French. A public core must not map an
  // engine call whose `invalid` message comes from zod (catalog, occurrences, series, wallet): that text is the schema's.
  if (fail.code === "invalid" && fail.message) return fail.message;
  const text = CLIENT_CONTEXT_MESSAGES[context]?.[fail.code] ?? ENGINE_ERROR_MESSAGES[fail.code];
  return fill(text, vars.businessName);
}

/** Fixed client sentences (one source per intent). */
export const COPY = {
  PAGE_GONE: "Cette page n'est plus disponible.",
  HONEYPOT_REFUSED: "Votre demande n'a pas pu être envoyée. Réessayez.",
  PAYMENT_UNAVAILABLE: "Le paiement en ligne n'est pas disponible pour le moment.",
  CHECKOUT_FAILED: "Le paiement n'a pas pu démarrer. Réessayez dans un instant.",
  RELEASE_CHECK_FAILED: "Le paiement n'a pas pu être vérifié. Réessayez dans un instant.",
  CONFIRM_EMAIL_TO_SPEND: "Confirmez votre email pour utiliser vos tickets.",
  SIGNED_IN_ONLY: "Connectez-vous avec une adresse confirmée pour modifier votre compte.",
  IMPERSONATING: "L'espace client n'est pas disponible quand vous êtes connecté en tant que ce compte.",
  OWNER_BANNER: "Vous êtes sur votre propre page : vos réservations de test comptent dans vos chiffres.",
  PAYMENTS_TEST_TITLE: "Paiements en mode test",
  PAYMENTS_TEST_MOCK: "Aucun paiement réel : le paiement est simulé.",
  PAYMENTS_TEST_STRIPE: "Aucun paiement réel : seules les cartes de test Stripe fonctionnent.",
  HAVE_TICKETS: "J'ai déjà des tickets",
  HAVE_TICKETS_HINT: "Vous avez déjà des tickets ? Recevez un code par email pour les utiliser.",
  MY_SPACE: "Mon espace",
  NO_SEANCE: "Aucune séance à venir",
  NO_SEANCE_WEEK: "Aucune séance cette semaine.",
  NEXT_SEANCE_WEEK: "Voir la semaine de la prochaine séance",
  NO_TICKET: "Aucun ticket",
  SEE_SHOP: "Voir la boutique",
  OFFER_GONE: "Cette offre n'est plus proposée",
  REGISTERED: "Inscription confirmée. Un email de confirmation vous a été envoyé.",
  BOOKED_WITH_TICKET: "Réservation confirmée avec 1 ticket. Un email de confirmation vous a été envoyé.",
  CANCELLED_OK: "Inscription annulée.",
  LINKS_REVOKED: "Liens déconnectés.",
  SAVED: "Enregistré",
  CODE_INTRO: "Recevez un code par email pour accéder à vos tickets et à vos réservations.",
  CODE_NAME_HELP: "Utilisé si c'est votre première connexion.",
  PASSWORD_LINK: "J'ai un mot de passe",
  GOOGLE: "Continuer avec Google",
  OTHER_ADDRESS: "Utiliser une autre adresse",
  NO_RESERVATION: "Aucune réservation pour l'instant",
  CREATE_PAGE: "Vous êtes pro ? Créer ma page",
  REVOKE_MY_LINKS: "Déconnecter mes liens",
  CLIENT_SPACE_LINK: "Espace client",
  NO_COVERING_OFFER: "Aucune offre ne permet de réserver cette séance en ligne.",
  PAYMENT_RECEIVED: "Paiement reçu",
  PROCESSING: "Paiement en cours de traitement",
  BUYBOOK_NOT_POSSIBLE: "Cette réservation ne peut pas être payée en ligne avec cette adresse. Consultez vos emails ou cliquez sur « J'ai déjà des tickets ».",
  TOO_MANY_PAYMENTS: "Plusieurs paiements sont en cours sur cette séance. Réessayez dans quelques minutes.",
  GUEST_BOOKING_EXISTS: "Une inscription existe déjà pour cette séance avec votre lien personnel.",
  NOT_ME: "Ce n'est pas moi",
  PLAIN_NAME: "Prénom et nom : n'indiquez que votre nom.",
  TEST_PAYMENT_LINE: "Paiement de test : aucun montant n'a été débité.",
  ENDED_CANCELLED: "Votre inscription est annulée.",
  ENDED_EXPIRED: "Votre place n'est plus réservée.",
  PENDING_HOLDS_TITLE: "Paiements en attente",
  CONFIRM_EMAIL_FIRST: "Confirmez votre adresse pour voir vos réservations.",
  NO_UPCOMING: "Aucune réservation à venir.",
  ORPHAN_TYPE: "Aucune séance à venir n'accepte ce type pour le moment.",
  RETURN_LINK: "Reprendre ou libérer ma réservation",
  PENDING_SEND: "Envoi…",
  PENDING_VERIFY: "Vérification…",
  PENDING_REGISTER: "Inscription…",
  PENDING_BOOK: "Réservation…",
  PENDING_SAVE: "Enregistrement…",
  PENDING_PAY: "Redirection vers le paiement…",
  /** Said by the page's status line once an inline code sign-in is accepted (AUTH-1): the form that held the focus is gone. */
  SIGNED_IN: "Connexion réussie.",
  /** The password form's submit while its call runs (`AuthForm`, P4 final review AUTH-4): the form serves clients too. */
  PENDING_SIGN_IN: "Connexion…",
  PENDING_SIGN_UP: "Création…",
  /* RDV libre (P5 dossier § 3.10): the off-grid refusal, the page states and the card. */
  RDV_SLOT_GONE,
  RDV_NO_OFFER: "Aucune offre ne couvre cette date. Choisissez un créneau plus proche.",
  /** A paid type with no offer on sale at all (R3): only ticket holders can book it (rdvTicketsOnlyLine adds the prompt). */
  RDV_TICKETS_ONLY: "Aucune offre n'est en vente en ligne : ce rendez-vous se réserve avec un ticket que vous avez déjà.",
  RDV_EMPTY_WEEK: "Aucun créneau cette semaine",
  RDV_NEXT_WEEK: "Semaine suivante",
  /** A type that can never be booked online (no hours, notice above the horizon): O14. */
  RDV_CLOSED: "Aucun créneau disponible pour le moment.",
  RDV_BOOK: "Réserver",
  RDV_CARD_CTA: "Réserver un rendez-vous",
  RDV_FREE_BADGE: "Gratuit",
} as const;

/** « Heures de {zone} », the static time-zone line of the RDV page (O30); `zone` is `timeZoneLabel(tz)`, inserted as given. */
export function rdvTimeZoneLine(zone: string): string {
  return `Heures de ${zone}`;
}

/** « 1 place restante » / « 5 places restantes » (fr-FR thousands). */
export function seatsLeftLabel(n: number): string {
  return `${fr(n)} ${n < 2 ? "place restante" : "places restantes"}`;
}

/** « Seul(e) {businessName} peut annuler maintenant. » (L921). */
export function cancelLockedText(businessName: string): string {
  return fill(CANCEL_LOCKED, businessName);
}

/** « Réserver avec 1 ticket (il vous en restera {n}) » for n ≥ 1, « Réserver avec mon dernier ticket » for 0 (L1353). */
export function heldTicketButtonLabel(leftAfter: number): string {
  return leftAfter >= 1 ? `Réserver avec 1 ticket (il vous en restera ${fr(leftAfter)})` : "Réserver avec mon dernier ticket";
}

/** « Vos coordonnées sont transmises à {businessName} pour gérer votre réservation. » */
export function dataUseLine(businessName: string): string {
  return `Vos coordonnées sont transmises à ${businessName} pour gérer votre réservation.`;
}

/** « Aucun ticket chez {businessName} pour {email}. » (L1389). */
export function noRecordText(businessName: string, email: string): string {
  return `Aucun ticket chez ${businessName} pour ${email}.`;
}

/** First character of the local part, then « ••• », then « @domain »: maskEmail("beatriz@example.com") === "b•••@example.com"; a string without « @ » → « ••• ». */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "•••";
  const first = Array.from(email.slice(0, at))[0] ?? "";
  return `${first}•••${email.slice(at)}`;
}

/** « Vous consultez l'espace de {maskEmail(email)} avec un lien personnel. » (Decision 63). */
export function guestNote(email: string): string {
  return `Vous consultez l'espace de ${maskEmail(email)} avec un lien personnel.`;
}

/** « Utilisable pour : {titles joined by ", "} » (one label for the Boutique and the offer page). An empty list gives "": the caller hides the line. */
export function acceptedByLine(titles: readonly string[]): string {
  return titles.length === 0 ? "" : `Utilisable pour : ${titles.join(", ")}`;
}

/** Receipt wallet line (COV-M1g): 1 → « 1 ticket est dans votre portefeuille. », n ≥ 2 → « {n} tickets sont dans votre portefeuille. » (fr-FR thousands), 0 → null. */
export function walletLine(n: number): string | null {
  if (!Number.isInteger(n) || n < 1) return null;
  return n === 1 ? "1 ticket est dans votre portefeuille." : `${fr(n)} tickets sont dans votre portefeuille.`;
}
