/**
 * Every destructive confirmation of the back-office (Q35): title, body and
 * confirm label, as pure functions of the counts the UI got from a preview.
 * The dialog (ConfirmDialog) only displays them. No dash anywhere.
 */
import { plural } from "@/lib/back-office/format";

export type ConfirmCopy = { title: string; body: string; confirm: string };

/** « Annuler cette séance ? » / « Annuler ce rendez-vous ? ». A rendez-vous ignores `past`. */
export function cancelOccurrenceCopy(a: { kind: "seance" | "rdv"; registrants: number; past: boolean }): ConfirmCopy {
  if (a.kind === "rdv") {
    return {
      title: "Annuler ce rendez-vous ?",
      body: "Le client est prévenu par email et son ticket lui est rendu.",
      confirm: "Annuler le rendez-vous",
    };
  }
  const lead =
    a.registrants <= 0
      ? "Personne n'est inscrit : la séance est simplement annulée."
      : a.registrants === 1
        ? "La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email."
        : `Les ${a.registrants} inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email.`;
  return {
    title: "Annuler cette séance ?",
    body: a.past ? `${lead} Cette séance est déjà passée : les tickets sont rendus quand même.` : lead,
    confirm: "Annuler la séance",
  };
}

export function restoreOccurrenceCopy(): ConfirmCopy {
  return {
    title: "Rétablir cette séance ?",
    body: "La séance redevient réservable ; les anciens inscrits ne sont pas réinscrits.",
    confirm: "Rétablir",
  };
}

export function unenrollCopy(a: { names: readonly string[]; ticketCount: number; pendingCount: number }): ConfirmCopy {
  const one = a.names.length === 1;
  const title = one ? `Désinscrire ${a.names[0]} ?` : `Désinscrire ${a.names.length} inscrits ?`;
  const lead =
    a.ticketCount > 0
      ? one
        ? "Le ticket est rendu au client, qui est prévenu par email."
        : "Les tickets sont rendus aux clients, qui sont prévenus par email."
      : one
        ? "Le client est prévenu par email."
        : "Les clients sont prévenus par email.";
  return {
    title,
    body: a.pendingCount > 0 ? `${lead} Le paiement en cours est annulé.` : lead,
    confirm: "Désinscrire",
  };
}

export function closeTicketsCopy(a: { count: number; reasonLabel: string }): ConfirmCopy {
  return {
    title: `Clore ${plural(a.count, "ticket", "tickets")} ?`,
    body: `Motif : ${a.reasonLabel}. Les tickets restent visibles, barrés, dans son portefeuille. Rien n'est remboursé automatiquement.`,
    confirm: "Clore",
  };
}

export function retireTicketsCopy(a: { count: number }): ConfirmCopy {
  return {
    title: `Retirer ${plural(a.count, "ticket offert", "tickets offerts")} ?`,
    body: "Ils restent visibles, barrés, dans son portefeuille.",
    confirm: "Retirer",
  };
}

export function revokeLinksCopy(a: { name: string }): ConfirmCopy {
  return {
    title: `Déconnecter les liens de ${a.name} ?`,
    body: "Les liens personnels déjà envoyés par email cessent de fonctionner. Les prochains emails contiendront un nouveau lien.",
    confirm: "Déconnecter les liens",
  };
}

export function archiveTypeCopy(a: { name: string }): ConfirmCopy {
  return {
    title: `Archiver « ${a.name} » ?`,
    body: "Ses offres ne sont plus en vente et il disparaît de votre page. Les tickets déjà détenus restent dans les portefeuilles, signalés en rouge, et les événements gardent leur lien. Vous pourrez le désarchiver.",
    confirm: "Archiver",
  };
}

/** A type that already served is archived, not deleted; an unused one is deleted and leaves the events that accepted it. */
export function deleteTypeCopy(a: { name: string; used: boolean; acceptedBy: readonly string[] }): ConfirmCopy {
  const title = `Supprimer « ${a.name} » ?`;
  if (a.used) {
    return {
      title,
      body: "Ce type a déjà servi (tickets, achats ou rendez-vous) : il sera archivé, pas supprimé.",
      confirm: "Archiver",
    };
  }
  const base = "Ses offres, ses horaires et ses questions sont supprimés.";
  return {
    title,
    body: a.acceptedBy.length > 0 ? `${base} Il est retiré de ces événements : ${a.acceptedBy.join(", ")}.` : base,
    confirm: "Supprimer",
  };
}

export function deleteOfferCopy(a: { label: string; sold: boolean }): ConfirmCopy {
  return {
    title: `Supprimer l'offre « ${a.label} » ?`,
    body: a.sold
      ? "Elle a déjà été achetée : elle sera archivée, pas supprimée. Les tickets achetés ne changent pas."
      : "Elle disparaît de votre page.",
    confirm: "Supprimer",
  };
}

export function deleteEventCopy(a: {
  title: string;
  fromLabel: string | null;
  deleteWhole: boolean;
  deletedSeances: number;
  cancelledSeances: number;
  registrants: number;
  ticketsReturned: number;
}): ConfirmCopy {
  const title =
    a.deleteWhole || a.fromLabel === null
      ? `Supprimer « ${a.title} » ?`
      : `Supprimer « ${a.title} » à partir du ${a.fromLabel} ?`;
  if (a.deleteWhole) {
    return {
      title,
      body: "L'événement n'a jamais eu d'inscription : il est supprimé définitivement.",
      confirm: "Supprimer",
    };
  }
  const parts: string[] = [];
  if (a.deletedSeances > 0) {
    parts.push(
      `${plural(a.deletedSeances, "séance sans inscrit sera supprimée", "séances sans inscrit seront supprimées")}.`,
    );
  }
  if (a.cancelledSeances > 0) {
    parts.push(
      `${plural(a.cancelledSeances, "séance avec inscrits sera annulée", "séances avec inscrits seront annulées")} : ` +
        `${plural(a.registrants, "inscrit prévenu", "inscrits prévenus")} par email, ` +
        `${plural(a.ticketsReturned, "ticket rendu", "tickets rendus")}.`,
    );
  }
  if (parts.length === 0) parts.push("Aucune séance à venir n'est concernée.");
  return { title, body: parts.join(" "), confirm: "Supprimer" };
}

export function deleteTimeOffCopy(): ConfirmCopy {
  return {
    title: "Supprimer cette indisponibilité ?",
    body: "Les séances vides qu'elle masquait réapparaissent sur votre planning et votre page.",
    confirm: "Supprimer",
  };
}

/** The dialog opened when a time off overlaps séances that have registrants. A single séance gets the singular wording. */
export function timeOffConflictCopy(a: { count: number }): {
  title: string;
  intro: string;
  cancelLabel: string;
  keepLabel: string;
  keepNote: string;
  rdvNote: string;
} {
  const single = a.count === 1;
  return {
    title: "Des séances ont des inscrits",
    intro: `Cette indisponibilité chevauche ${plural(a.count, "séance", "séances")} avec des inscrits :`,
    cancelLabel: single
      ? "Annuler cette séance (tickets rendus, clients prévenus)"
      : `Annuler ces ${plural(a.count, "séance", "séances")} (tickets rendus, clients prévenus)`,
    keepLabel: single ? "La garder" : "Les garder",
    keepNote: single
      ? "Gardée, elle reste pour ses inscrits mais n'est plus réservable en ligne. Vous pouvez encore y inscrire quelqu'un."
      : "Gardées, elles restent pour leurs inscrits mais ne sont plus réservables en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote: "Un rendez-vous compte avec ses marges avant et après.",
  };
}
