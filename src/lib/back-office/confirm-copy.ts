/**
 * Every destructive confirmation of the back-office (Q35): title, body and
 * confirm label, as pure functions of the counts the UI got from a preview.
 * The dialog (ConfirmDialog) only displays them. No dash anywhere.
 */
import { plural } from "@/lib/back-office/format";

export type ConfirmCopy = { title: string; body: string; confirm: string };

/**
 * « Annuler cette séance ? » / « Annuler ce rendez-vous ? ». `registrants`: the live bookings (a lapsed hold is not one),
 * who are told by email; `tickets`: how many of them hold a ticket, the only ones whose ticket is given back (a free,
 * guest or paid place has none). The text promises tickets back only for those. A rendez-vous ignores `past`.
 */
export function cancelOccurrenceCopy(a: {
  kind: "seance" | "rdv";
  registrants: number;
  tickets: number;
  past: boolean;
}): ConfirmCopy {
  const registrants = Math.max(a.registrants, 0);
  const tickets = Math.min(Math.max(a.tickets, 0), registrants);
  if (a.kind === "rdv") {
    return {
      title: "Annuler ce rendez-vous ?",
      body:
        registrants === 0
          ? "Aucun client n'est concerné : le rendez-vous est simplement annulé."
          : tickets > 0
            ? "Le client est prévenu par email et son ticket lui est rendu."
            : "Le client est prévenu par email.",
      confirm: "Annuler le rendez-vous",
    };
  }
  const one = registrants === 1;
  const people = one ? "La personne inscrite est désinscrite" : `Les ${registrants} inscrits sont désinscrits`;
  let body: string;
  if (registrants === 0) {
    body = "Personne n'est inscrit : la séance est simplement annulée.";
  } else if (tickets === 0) {
    body = `${people} et ${one ? "prévenue" : "prévenus"} par email.`;
  } else if (tickets === registrants) {
    body = `${people}, ${one ? "son ticket est rendu" : "leurs tickets sont rendus"} et ${one ? "elle est" : "ils sont"} ${one ? "prévenue" : "prévenus"} par email.`;
    if (a.past) body += ` Cette séance est déjà passée : ${one ? "le ticket est rendu" : "les tickets sont rendus"} quand même.`;
  } else {
    // some of the people hold a ticket, the others do not: say how many come back
    body = `${people} et prévenus par email. ${plural(tickets, "ticket est rendu", "tickets sont rendus")}${
      a.past ? ", même si cette séance est déjà passée" : ""
    }.`;
  }
  return { title: "Annuler cette séance ?", body, confirm: "Annuler la séance" };
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

/** The line shown once the links are revoked: the client account, if any, stays linked (only the e-mailed links stop working). */
export function revokeLinksDoneNotice(a: { linkedAccount: boolean }): string {
  return a.linkedAccount ? "Liens déconnectés. Le compte client reste lié." : "Liens déconnectés.";
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

/**
 * `sold`: a paid purchase exists. `checkedOut`: any purchase exists, paid or not (a checkout started, abandoned or
 * failed keeps the row, and the offer cannot be deleted either: it is archived).
 */
export function deleteOfferCopy(a: { label: string; sold: boolean; checkedOut: boolean }): ConfirmCopy {
  const body = a.sold
    ? "Elle a déjà été achetée : elle sera archivée, pas supprimée. Les tickets achetés ne changent pas."
    : a.checkedOut
      ? "Un paiement a déjà été commencé avec cette offre : elle sera archivée, pas supprimée."
      : "Elle disparaît de votre page.";
  return { title: `Supprimer l'offre « ${a.label} » ?`, body, confirm: "Supprimer" };
}

/** The line shown once the delete went through (null: the offer is simply gone). The reason follows what the engine found. */
export function deleteOfferDoneNotice(a: { outcome: "deleted" | "archived"; sold: boolean }): string | null {
  if (a.outcome === "deleted") return null;
  return a.sold
    ? "Offre archivée : elle avait déjà été achetée."
    : "Offre archivée : un paiement avait déjà été commencé avec cette offre.";
}

export function deleteEventCopy(a: {
  title: string;
  fromLabel: string | null;
  deleteWhole: boolean;
  deletedSeances: number;
  cancelledSeances: number;
  registrants: number;
  ticketsReturned: number;
  /** later segments of the series the delete reaches too (their séances are in the counts above); default 0 */
  laterSegments?: number;
}): ConfirmCopy {
  const title =
    a.deleteWhole || a.fromLabel === null
      ? `Supprimer « ${a.title} » ?`
      : `Supprimer « ${a.title} » à partir du ${a.fromLabel} ?`;
  const later = a.laterSegments ?? 0;
  const laterNote = later > 0 ? ` La suite de la série (${plural(later, "segment suivant", "segments suivants")}) est comprise.` : "";
  if (a.deleteWhole) {
    return {
      title,
      body: `L'événement n'a jamais eu d'inscription : il est supprimé définitivement.${laterNote}`,
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
  if (parts.length === 0) return { title, body: "Aucune séance à venir n'est concernée.", confirm: "Supprimer" };
  return { title, body: `${parts.join(" ")}${laterNote}`, confirm: "Supprimer" };
}

/** The line shown once the delete went through: from the first séance to come (`fromLabel` null) or from a later date. */
export function deleteEventDoneNotice(a: { fromLabel: string | null }): string {
  return a.fromLabel === null ? "Les séances à venir sont supprimées." : `Les séances à partir du ${a.fromLabel} sont supprimées.`;
}

export function deleteTimeOffCopy(): ConfirmCopy {
  return {
    title: "Supprimer cette indisponibilité ?",
    body: "Les séances vides qu'elle masquait réapparaissent sur votre planning et votre page.",
    confirm: "Supprimer",
  };
}

/**
 * The dialog opened when a time off overlaps séances with registrants and/or booked rendez-vous. The wording follows
 * what is listed: séances only (« inscrits »), rendez-vous only (« client », « réservé »), or both. One item takes the
 * singular. `tickets`: how many of the bookings in the list hold a ticket (a free, guest or paid place has none to
 * give back); the buttons promise tickets back only when there are some.
 */
export function timeOffConflictCopy(a: { seances: number; rdvs: number; tickets: number }): {
  title: string;
  intro: string;
  cancelLabel: string;
  keepLabel: string;
  keepNote: string;
  rdvNote: string;
} {
  const rdvNote = "Un rendez-vous compte avec ses marges avant et après.";
  const returned = a.tickets <= 0 ? "" : a.tickets === 1 ? "ticket rendu, " : "tickets rendus, ";
  const prevented = `(${returned}clients prévenus)`;
  const preventedOne = `(${returned}client prévenu)`;
  if (a.rdvs > 0 && a.seances > 0) {
    return {
      title: "Des séances et des rendez-vous sont réservés",
      intro: `Cette indisponibilité chevauche ${plural(a.seances, "séance", "séances")} avec des inscrits et ${plural(a.rdvs, "rendez-vous réservé", "rendez-vous réservés")} :`,
      cancelLabel: `Annuler ces ${a.seances + a.rdvs} séances et rendez-vous ${prevented}`,
      keepLabel: "Les garder",
      keepNote:
        "Gardés, ils restent pour leurs inscrits et leurs clients mais ne sont plus réservables en ligne. Vous pouvez encore inscrire quelqu'un à une séance.",
      rdvNote,
    };
  }
  if (a.rdvs > 0) {
    const single = a.rdvs === 1;
    return {
      title: single ? "Un rendez-vous est réservé" : "Des rendez-vous sont réservés",
      intro: `Cette indisponibilité chevauche ${plural(a.rdvs, "rendez-vous réservé", "rendez-vous réservés")} :`,
      cancelLabel: single
        ? `Annuler ce rendez-vous ${preventedOne}`
        : `Annuler ces ${plural(a.rdvs, "rendez-vous", "rendez-vous")} ${prevented}`,
      keepLabel: single ? "Le garder" : "Les garder",
      keepNote: single
        ? "Gardé, il reste pour son client mais le créneau n'est plus réservable en ligne."
        : "Gardés, ils restent pour leurs clients mais les créneaux ne sont plus réservables en ligne.",
      rdvNote,
    };
  }
  const single = a.seances === 1;
  return {
    title: "Des séances ont des inscrits",
    intro: `Cette indisponibilité chevauche ${plural(a.seances, "séance", "séances")} avec des inscrits :`,
    cancelLabel: single
      ? `Annuler cette séance ${prevented}`
      : `Annuler ces ${plural(a.seances, "séance", "séances")} ${prevented}`,
    keepLabel: single ? "La garder" : "Les garder",
    keepNote: single
      ? "Gardée, elle reste pour ses inscrits mais n'est plus réservable en ligne. Vous pouvez encore y inscrire quelqu'un."
      : "Gardées, elles restent pour leurs inscrits mais ne sont plus réservables en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote,
  };
}

/** One line of the conflict list: « {when} · {title} · 2 inscrits » for a séance, « ... · 1 client » for a rendez-vous. */
export function timeOffConflictLine(c: {
  kind: "seance" | "rdv";
  whenLabel: string;
  title: string;
  activeBookings: number;
}): string {
  const who = c.kind === "rdv" ? plural(c.activeBookings, "client", "clients") : plural(c.activeBookings, "inscrit", "inscrits");
  return `${c.whenLabel} · ${c.title} · ${who}`;
}
