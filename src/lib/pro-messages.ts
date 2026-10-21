/**
 * What the pro reads when the booking engine refuses an action: one French
 * message per engine error code, worded for the person running the back-office
 * (the client wording lives in ENGINE_ERROR_MESSAGES, for the public pages).
 * A few codes read differently depending on the action, hence the per-context
 * overrides. Pure: no drizzle, no server module, no dash.
 */
import type { EngineErrorCode } from "@/lib/tickets-vocab";

/** The kind of action that failed; it selects the override table. */
export type ProErrorContext =
  | "catalog"
  | "event"
  | "series"
  | "occurrence"
  | "cancel"
  | "restore"
  | "register"
  | "unenroll"
  | "move"
  | "timeOff"
  | "customer"
  | "wallet"
  | "settings"
  | "profile";

/** Pro-facing French message for every engine code (never the client wording). */
export const PRO_ERROR_MESSAGES: Record<EngineErrorCode, string> = {
  full: "Cette séance est complète.",
  unavailable: "Cette séance n'est plus disponible : rafraîchissez la page.",
  changed: "La séance a changé entre-temps : rafraîchissez la page.",
  stale: "Les données ont changé entre-temps : rafraîchissez la page.",
  already_booked: "Ce client est déjà inscrit à cette séance.",
  slot_taken: "Ce créneau vient d'être pris.",
  no_ticket: "Ce client n'a aucun ticket utilisable ici.",
  too_many_holds: "Ce client a déjà deux paiements en cours.",
  too_late_or_done: "Cette inscription est déjà terminée.",
  not_found: "Élément introuvable : il a peut-être été supprimé.",
  not_eligible: "Ce ticket n'est pas accepté pour cette séance.",
  in_use: "Cet élément a déjà servi : il a été archivé.",
  invalid: "Certaines valeurs sont invalides.",
  throttled: "Trop de demandes. Réessayez dans un moment.",
  offer_too_short: "La validité de cette offre ne couvre pas la date de la séance.",
  ticket_expires_before: "Ticket expiré à la date de cette séance : déplacer quand même ?",
  retire_paid: "Un ticket payé ne peut pas être retiré : utilisez « Clore ».",
  timezone_locked: "Fuseau verrouillé : vous avez des séances planifiées, des indisponibilités à venir ou des tickets à durée limitée.",
};

/** Per-context overrides of PRO_ERROR_MESSAGES. */
export const PRO_CONTEXT_MESSAGES: Readonly<Partial<Record<ProErrorContext, Partial<Record<EngineErrorCode, string>>>>> = {
  register: {
    full: "Complet : cochez « +1 place » pour l'inscrire quand même.",
    unavailable: "Cette séance est annulée : rétablissez-la pour inscrire quelqu'un.",
    not_eligible: "Ce ticket n'est pas utilisable sur cette séance.",
    no_ticket:
      "Ce client n'a aucun ticket utilisable ici : inscrivez-le comme invité, ou offrez-lui un ticket depuis sa fiche.",
    not_found: "Séance ou client introuvable.",
  },
  move: {
    full: "La séance choisie est complète.",
    not_eligible: "Cette séance n'accepte pas le ticket de ce client : choisissez un type vers lequel le convertir.",
    already_booked: "Ce client est déjà inscrit à la séance choisie.",
    stale: "Cette inscription a changé entre-temps : rafraîchissez la page.",
    not_found: "Inscription ou séance introuvable.",
  },
  restore: {
    not_found: "Seule une séance future d'un événement peut être rétablie.",
  },
  unenroll: {
    stale: "Une de ces inscriptions est déjà terminée : rafraîchissez la page.",
    not_found: "Inscription introuvable sur cette séance.",
  },
  cancel: {
    not_found: "Séance introuvable.",
  },
  occurrence: {
    invalid: "Modification invalide.",
    not_found: "Séance introuvable.",
  },
  series: {
    not_found: "Événement introuvable ou terminé.",
    invalid: "Modification invalide.",
  },
  event: {
    not_found: "Événement introuvable ou terminé.",
    invalid: "Un type de ticket choisi n'existe plus.",
  },
  timeOff: {
    stale: "Des inscriptions ont changé pendant la vérification : voici la liste à jour.",
  },
  wallet: {
    no_ticket: "Pas assez de tickets pour cette action : rafraîchissez la page.",
    not_found: "Ticket ou type introuvable.",
    invalid: "Choix invalide.",
  },
  catalog: {
    not_found: "Type ou offre introuvable.",
  },
  customer: {
    invalid: "Vérifiez le nom, l'email et le téléphone.",
    not_found: "Client introuvable.",
  },
  settings: {
    invalid: "Valeurs hors limites.",
  },
  profile: {
    not_found: "Profil introuvable.",
  },
};

/**
 * The engine's own `message` when it has one (always French and pro-facing after
 * pre-validation), else the context override, else the general pro message.
 */
export function proErrorMessage(fail: { code: EngineErrorCode; message?: string }, context: ProErrorContext): string {
  if (fail.message) return fail.message;
  return PRO_CONTEXT_MESSAGES[context]?.[fail.code] ?? PRO_ERROR_MESSAGES[fail.code];
}

/**
 * Shown when a Server Action call itself fails (network, no answer): the form or
 * the confirmation stays as it was. One text for every back-office form and dialog.
 */
export const REQUEST_FAILED = "La demande n'a pas abouti. Vérifiez votre connexion et réessayez.";
