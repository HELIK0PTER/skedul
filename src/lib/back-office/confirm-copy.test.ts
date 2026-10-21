import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveTypeCopy,
  cancelOccurrenceCopy,
  closeTicketsCopy,
  deleteEventCopy,
  deleteEventDoneNotice,
  deleteOfferCopy,
  deleteOfferDoneNotice,
  deleteTimeOffCopy,
  deleteTypeCopy,
  restoreOccurrenceCopy,
  retireTicketsCopy,
  revokeLinksCopy,
  revokeLinksDoneNotice,
  timeOffConflictCopy,
  timeOffConflictLine,
  unenrollCopy,
  unenrollReasonHelp,
  type ConfirmCopy,
} from "./confirm-copy";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const event = (over: Partial<Parameters<typeof deleteEventCopy>[0]> = {}) =>
  deleteEventCopy({
    title: "Roda libre",
    fromLabel: null,
    deleteWhole: false,
    deletedSeances: 0,
    cancelledSeances: 0,
    registrants: 0,
    ticketsReturned: 0,
    ...over,
  });

test("cancelOccurrenceCopy: a séance, by number of registrants, with the past sentence", () => {
  const base = { title: "Annuler cette séance ?", confirm: "Annuler la séance" };
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 0, tickets: 0, past: false }), {
    ...base,
    body: "Personne n'est inscrit : la séance est simplement annulée.",
  });
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 1, tickets: 1, past: false }), {
    ...base,
    body: "La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email.",
  });
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 3, past: false }), {
    ...base,
    body: "Les 3 inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email.",
  });
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 3, past: true }).body,
    "Les 3 inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email. Cette séance est déjà passée : les tickets sont rendus quand même.",
  );
});

test("cancelOccurrenceCopy: tickets are promised back only when the bookings hold some (final review UI-7, COV-4)", () => {
  // nobody holds a ticket (free places, guests, paid places): who is told, and no ticket sentence at all
  const none1 = cancelOccurrenceCopy({ kind: "seance", registrants: 1, tickets: 0, past: false }).body;
  assert.equal(none1, "La personne inscrite est désinscrite et prévenue par email.");
  const none3 = cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 0, past: false }).body;
  assert.equal(none3, "Les 3 inscrits sont désinscrits et prévenus par email.");
  for (const body of [none1, none3]) assert.equal(/ticket/.test(body), false, body);
  // some hold one: the count is told, with its agreement
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 2, past: false }).body,
    "Les 3 inscrits sont désinscrits et prévenus par email. 2 tickets sont rendus.",
  );
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 1, past: false }).body,
    "Les 3 inscrits sont désinscrits et prévenus par email. 1 ticket est rendu.",
  );
  // a past séance: the « rendus quand même » sentence only when there is a ticket to give back
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 0, past: true }).body,
    "Les 3 inscrits sont désinscrits et prévenus par email.",
  );
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 2, tickets: 1, past: true }).body,
    "Les 2 inscrits sont désinscrits et prévenus par email. 1 ticket est rendu, même si cette séance est déjà passée.",
  );
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, tickets: 2, past: true }).body,
    "Les 3 inscrits sont désinscrits et prévenus par email. 2 tickets sont rendus, même si cette séance est déjà passée.",
  );
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 1, tickets: 1, past: true }).body,
    "La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email. Cette séance est déjà passée : le ticket est rendu quand même.",
  );
  // never more tickets than people
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 1, tickets: 5, past: false }).body,
    "La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email.",
  );
});

test("cancelOccurrenceCopy: a rendez-vous", () => {
  const head = { title: "Annuler ce rendez-vous ?", confirm: "Annuler le rendez-vous" };
  assert.deepEqual(cancelOccurrenceCopy({ kind: "rdv", registrants: 1, tickets: 1, past: false }), {
    ...head,
    body: "Le client est prévenu par email et son ticket lui est rendu.",
  });
  // paid, free or guest: no ticket to give back
  assert.deepEqual(cancelOccurrenceCopy({ kind: "rdv", registrants: 1, tickets: 0, past: false }), {
    ...head,
    body: "Le client est prévenu par email.",
  });
  // nobody left but a lapsed hold: nobody is told
  assert.equal(
    cancelOccurrenceCopy({ kind: "rdv", registrants: 0, tickets: 0, past: false }).body,
    "Aucun client n'est concerné : le rendez-vous est simplement annulé.",
  );
});

test("the single-line texts are exact", () => {
  assert.deepEqual(restoreOccurrenceCopy(), {
    title: "Rétablir cette séance ?",
    body: "La séance redevient réservable ; les anciens inscrits ne sont pas réinscrits.",
    confirm: "Rétablir",
  });
  assert.deepEqual(revokeLinksCopy({ name: "Beatriz Almeida" }), {
    title: "Déconnecter les liens de Beatriz Almeida ?",
    body: "Les liens personnels déjà envoyés par email cessent de fonctionner. Les prochains emails contiendront un nouveau lien.",
    confirm: "Déconnecter les liens",
  });
  assert.deepEqual(archiveTypeCopy({ name: "Cours collectif" }), {
    title: "Archiver « Cours collectif » ?",
    body: "Ses offres ne sont plus en vente et il disparaît de votre page. Les tickets déjà détenus restent dans les portefeuilles, signalés en rouge, et les événements gardent leur lien. Vous pourrez le désarchiver.",
    confirm: "Archiver",
  });
  assert.deepEqual(deleteTimeOffCopy(), {
    title: "Supprimer cette indisponibilité ?",
    body: "Les séances vides qu'elle masquait réapparaissent sur votre planning et votre page.",
    confirm: "Supprimer",
  });
});

test("unenrollCopy: the title follows the names, the body follows tickets and pending payments", () => {
  assert.deepEqual(unenrollCopy({ names: ["Léa Martin"], ticketCount: 1, pendingCount: 0 }), {
    title: "Désinscrire Léa Martin ?",
    body: "Le ticket est rendu au client, qui est prévenu par email.",
    confirm: "Désinscrire",
  });
  assert.equal(
    unenrollCopy({ names: ["Léa Martin"], ticketCount: 0, pendingCount: 0 }).body,
    "Le client est prévenu par email.",
  );
  const several = unenrollCopy({ names: ["Léa Martin", "Rafael Souza"], ticketCount: 2, pendingCount: 0 });
  assert.equal(several.title, "Désinscrire 2 inscrits ?");
  assert.equal(several.body, "Les tickets sont rendus aux clients, qui sont prévenus par email.");
  assert.equal(
    unenrollCopy({ names: ["Léa Martin", "Rafael Souza"], ticketCount: 0, pendingCount: 0 }).body,
    "Les clients sont prévenus par email.",
  );
  assert.equal(
    unenrollCopy({ names: ["Léa Martin"], ticketCount: 0, pendingCount: 1 }).body,
    "Le client est prévenu par email. Le paiement en cours est annulé.",
    "the payment sentence only with a pending payment",
  );
  assert.ok(!unenrollCopy({ names: ["Léa Martin"], ticketCount: 1, pendingCount: 0 }).body.includes("paiement"));
  // several pending payments: the sentence agrees with them (final review UI-8)
  assert.equal(
    unenrollCopy({ names: ["Léa Martin", "Rafael Souza"], ticketCount: 0, pendingCount: 2 }).body,
    "Les clients sont prévenus par email. Les paiements en cours sont annulés.",
  );
});

test("unenrollReasonHelp: the optional reason is told to go to the client (final review F11)", () => {
  assert.equal(unenrollReasonHelp({ count: 1 }), "Ce motif apparaît tel quel dans l'email envoyé au client.");
  assert.equal(unenrollReasonHelp({ count: 3 }), "Ce motif apparaît tel quel dans l'email envoyé à chaque client.");
  assert.equal(DASH.test(unenrollReasonHelp({ count: 1 }) + unenrollReasonHelp({ count: 2 })), false);
});

test("closeTicketsCopy and retireTicketsCopy count with plural", () => {
  assert.deepEqual(closeTicketsCopy({ count: 3, reasonLabel: "Abandonné" }), {
    title: "Clore 3 tickets ?",
    body: "Motif : Abandonné. Les tickets restent visibles, barrés, dans son portefeuille. Rien n'est remboursé automatiquement.",
    confirm: "Clore",
  });
  assert.equal(closeTicketsCopy({ count: 1, reasonLabel: "Abandonné" }).title, "Clore 1 ticket ?");
  // one ticket: the verbs and adjectives agree with it (final review UI-8)
  assert.equal(
    closeTicketsCopy({ count: 1, reasonLabel: "Abandonné" }).body,
    "Motif : Abandonné. Le ticket reste visible, barré, dans son portefeuille. Rien n'est remboursé automatiquement.",
  );
  assert.deepEqual(retireTicketsCopy({ count: 2 }), {
    title: "Retirer 2 tickets offerts ?",
    body: "Ils restent visibles, barrés, dans son portefeuille.",
    confirm: "Retirer",
  });
  assert.equal(retireTicketsCopy({ count: 1 }).title, "Retirer 1 ticket offert ?");
  assert.equal(retireTicketsCopy({ count: 1 }).body, "Il reste visible, barré, dans son portefeuille.");
});

test("deleteTypeCopy: a used type is archived, an unused one lists the events that lose it", () => {
  assert.deepEqual(deleteTypeCopy({ name: "Cours collectif", used: true, acceptedBy: ["Roda libre"] }), {
    title: "Supprimer « Cours collectif » ?",
    body: "Ce type a déjà servi (tickets, achats ou rendez-vous) : il sera archivé, pas supprimé.",
    confirm: "Archiver",
  });
  assert.deepEqual(deleteTypeCopy({ name: "Cours collectif", used: false, acceptedBy: [] }), {
    title: "Supprimer « Cours collectif » ?",
    body: "Ses offres, ses horaires et ses questions sont supprimés.",
    confirm: "Supprimer",
  });
  assert.equal(
    deleteTypeCopy({ name: "Cours collectif", used: false, acceptedBy: ["Roda libre", "Atelier technique"] }).body,
    "Ses offres, ses horaires et ses questions sont supprimés. Il est retiré de ces événements : Roda libre, Atelier technique.",
  );
});

test("deleteOfferCopy: a sold offer, or one only checked out, is archived and the copy says why", () => {
  assert.deepEqual(deleteOfferCopy({ label: "Carnet de 10", sold: false, checkedOut: false }), {
    title: "Supprimer l'offre « Carnet de 10 » ?",
    body: "Elle disparaît de votre page.",
    confirm: "Supprimer",
  });
  assert.equal(
    deleteOfferCopy({ label: "Carnet de 10", sold: true, checkedOut: true }).body,
    "Elle a déjà été achetée : elle sera archivée, pas supprimée. Les tickets achetés ne changent pas.",
  );
  assert.equal(
    deleteOfferCopy({ label: "Carnet de 10", sold: false, checkedOut: true }).body,
    "Un paiement a déjà été commencé avec cette offre : elle sera archivée, pas supprimée.",
    "a checkout never paid is not « déjà achetée »",
  );
});

test("deleteOfferDoneNotice: nothing after a delete, the right reason after an archive", () => {
  assert.equal(deleteOfferDoneNotice({ outcome: "deleted", sold: false }), null);
  assert.equal(deleteOfferDoneNotice({ outcome: "archived", sold: true }), "Offre archivée : elle avait déjà été achetée.");
  assert.equal(
    deleteOfferDoneNotice({ outcome: "archived", sold: false }),
    "Offre archivée : un paiement avait déjà été commencé avec cette offre.",
    "archived without a paid purchase: a checkout was only started",
  );
});

test("deleteEventCopy: the whole event, a series from a date, nothing concerned", () => {
  assert.deepEqual(event({ deleteWhole: true }), {
    title: "Supprimer « Roda libre » ?",
    body: "L'événement n'a jamais eu d'inscription : il est supprimé définitivement.",
    confirm: "Supprimer",
  });
  assert.deepEqual(
    event({ fromLabel: "lun. 12/10", deletedSeances: 2, cancelledSeances: 1, registrants: 4, ticketsReturned: 3 }),
    {
      title: "Supprimer « Roda libre » à partir du lun. 12/10 ?",
      body: "2 séances sans inscrit seront supprimées. 1 séance avec inscrits sera annulée : 4 inscrits prévenus par email, 3 tickets rendus.",
      confirm: "Supprimer",
    },
  );
  assert.equal(event({ fromLabel: "lun. 12/10", deletedSeances: 1 }).body, "1 séance sans inscrit sera supprimée.");
  assert.equal(
    event({ fromLabel: "lun. 12/10", cancelledSeances: 2, registrants: 1, ticketsReturned: 1 }).body,
    "2 séances avec inscrits seront annulées : 1 inscrit prévenu par email, 1 ticket rendu.",
  );
  assert.equal(event({ fromLabel: "lun. 12/10" }).body, "Aucune séance à venir n'est concernée.");
  assert.equal(event().title, "Supprimer « Roda libre » ?", "no date, not whole: the plain title");
});

test("deleteEventCopy: the later segments of the series are named, the counts already include them", () => {
  const SUITE = "La suite de la série (1 segment suivant) est comprise.";
  assert.equal(
    event({ deleteWhole: true, laterSegments: 1 }).body,
    `L'événement n'a jamais eu d'inscription : il est supprimé définitivement. ${SUITE}`,
  );
  assert.equal(
    event({ fromLabel: "lun. 12/10", deletedSeances: 5, cancelledSeances: 1, registrants: 2, ticketsReturned: 1, laterSegments: 1 }).body,
    `5 séances sans inscrit seront supprimées. 1 séance avec inscrits sera annulée : 2 inscrits prévenus par email, 1 ticket rendu. ${SUITE}`,
  );
  assert.equal(
    event({ fromLabel: "lun. 12/10", deletedSeances: 1, laterSegments: 3 }).body,
    "1 séance sans inscrit sera supprimée. La suite de la série (3 segments suivants) est comprise.",
  );
  assert.equal(event({ fromLabel: "lun. 12/10", laterSegments: 0 }).body, "Aucune séance à venir n'est concernée.", "none: nothing to add");
});

test("deleteEventDoneNotice: from the first séance to come, or from a later date", () => {
  assert.equal(deleteEventDoneNotice({ fromLabel: null }), "Les séances à venir sont supprimées.");
  assert.equal(deleteEventDoneNotice({ fromLabel: "mar. 25/11" }), "Les séances à partir du mar. 25/11 sont supprimées.");
});

const RDV_NOTE = "Un rendez-vous compte avec ses marges avant et après.";

test("timeOffConflictCopy: séances only, plural and singular", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 2, rdvs: 0, tickets: 2 }), {
    title: "Des séances ont des inscrits",
    intro: "Cette indisponibilité chevauche 2 séances avec des inscrits :",
    cancelLabel: "Annuler ces 2 séances (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote:
      "Gardées, elles restent pour leurs inscrits mais ne sont plus réservables en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote: RDV_NOTE,
  });
  assert.deepEqual(timeOffConflictCopy({ seances: 1, rdvs: 0, tickets: 3 }), {
    title: "Une séance a des inscrits",
    intro: "Cette indisponibilité chevauche 1 séance avec des inscrits :",
    cancelLabel: "Annuler cette séance (tickets rendus, clients prévenus)",
    keepLabel: "La garder",
    keepNote:
      "Gardée, elle reste pour ses inscrits mais n'est plus réservable en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote: RDV_NOTE,
  });
});

test("timeOffConflictCopy: rendez-vous only never says séance nor inscrit", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 0, rdvs: 1, tickets: 1 }), {
    title: "Un rendez-vous est réservé",
    intro: "Cette indisponibilité chevauche 1 rendez-vous réservé :",
    cancelLabel: "Annuler ce rendez-vous (ticket rendu, client prévenu)",
    keepLabel: "Le garder",
    keepNote: "Gardé, il reste pour son client mais le créneau n'est plus réservable en ligne.",
    rdvNote: RDV_NOTE,
  });
  assert.deepEqual(timeOffConflictCopy({ seances: 0, rdvs: 2, tickets: 2 }), {
    title: "Des rendez-vous sont réservés",
    intro: "Cette indisponibilité chevauche 2 rendez-vous réservés :",
    cancelLabel: "Annuler ces 2 rendez-vous (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote: "Gardés, ils restent pour leurs clients mais les créneaux ne sont plus réservables en ligne.",
    rdvNote: RDV_NOTE,
  });
});

test("timeOffConflictCopy: séances and rendez-vous together", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 2, rdvs: 1, tickets: 3 }), {
    title: "Des séances et des rendez-vous sont réservés",
    intro: "Cette indisponibilité chevauche 2 séances avec des inscrits et 1 rendez-vous réservé :",
    cancelLabel: "Annuler ces 3 séances et rendez-vous (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote:
      "Gardés, ils restent pour leurs inscrits et leurs clients mais ne sont plus réservables en ligne. Vous pouvez encore inscrire quelqu'un à une séance.",
    rdvNote: RDV_NOTE,
  });
  const oneEach = timeOffConflictCopy({ seances: 1, rdvs: 1, tickets: 2 });
  assert.equal(oneEach.intro, "Cette indisponibilité chevauche 1 séance avec des inscrits et 1 rendez-vous réservé :");
  assert.equal(oneEach.cancelLabel, "Annuler ces 2 séances et rendez-vous (tickets rendus, clients prévenus)");
  assert.equal(
    timeOffConflictCopy({ seances: 1, rdvs: 3, tickets: 4 }).intro,
    "Cette indisponibilité chevauche 1 séance avec des inscrits et 3 rendez-vous réservés :",
  );
});

test("timeOffConflictCopy: tickets are promised back only when the bookings hold some (final review UI-7, COV-4)", () => {
  // nobody holds a ticket: the button says who is told, not what is given back
  assert.equal(timeOffConflictCopy({ seances: 2, rdvs: 0, tickets: 0 }).cancelLabel, "Annuler ces 2 séances (clients prévenus)");
  assert.equal(timeOffConflictCopy({ seances: 1, rdvs: 0, tickets: 0 }).cancelLabel, "Annuler cette séance (clients prévenus)");
  assert.equal(timeOffConflictCopy({ seances: 0, rdvs: 1, tickets: 0 }).cancelLabel, "Annuler ce rendez-vous (client prévenu)");
  assert.equal(timeOffConflictCopy({ seances: 0, rdvs: 3, tickets: 0 }).cancelLabel, "Annuler ces 3 rendez-vous (clients prévenus)");
  assert.equal(
    timeOffConflictCopy({ seances: 2, rdvs: 1, tickets: 0 }).cancelLabel,
    "Annuler ces 3 séances et rendez-vous (clients prévenus)",
  );
  // one ticket in all: singular
  assert.equal(
    timeOffConflictCopy({ seances: 2, rdvs: 0, tickets: 1 }).cancelLabel,
    "Annuler ces 2 séances (ticket rendu, clients prévenus)",
  );
  assert.equal(
    timeOffConflictCopy({ seances: 0, rdvs: 3, tickets: 1 }).cancelLabel,
    "Annuler ces 3 rendez-vous (ticket rendu, clients prévenus)",
  );
  // the rest of the dialog does not depend on the tickets
  assert.deepEqual(
    { ...timeOffConflictCopy({ seances: 2, rdvs: 1, tickets: 0 }), cancelLabel: "" },
    { ...timeOffConflictCopy({ seances: 2, rdvs: 1, tickets: 5 }), cancelLabel: "" },
  );
});

test("timeOffConflictLine: a séance has inscrits, a rendez-vous has a client", () => {
  const when = "lun. 19 octobre 2026 · 12:00 à 12:15";
  assert.equal(
    timeOffConflictLine({ kind: "seance", whenLabel: when, title: "Altinha débutants", activeBookings: 3 }),
    "lun. 19 octobre 2026 · 12:00 à 12:15 · Altinha débutants · 3 inscrits",
  );
  assert.equal(
    timeOffConflictLine({ kind: "seance", whenLabel: when, title: "Altinha débutants", activeBookings: 1 }),
    "lun. 19 octobre 2026 · 12:00 à 12:15 · Altinha débutants · 1 inscrit",
  );
  assert.equal(
    timeOffConflictLine({ kind: "rdv", whenLabel: when, title: "Appel découverte", activeBookings: 1 }),
    "lun. 19 octobre 2026 · 12:00 à 12:15 · Appel découverte · 1 client",
  );
  assert.equal(DASH.test(timeOffConflictLine({ kind: "rdv", whenLabel: when, title: "Appel", activeBookings: 2 })), false);
});

test("every text is non-empty for 0, 1 and 2 and carries no dash", () => {
  const copies: ConfirmCopy[] = [];
  for (const n of [0, 1, 2]) {
    const names = Array.from({ length: n }, (_, i) => `Client ${i + 1}`);
    copies.push(
      cancelOccurrenceCopy({ kind: "seance", registrants: n, tickets: n, past: n === 2 }),
      cancelOccurrenceCopy({ kind: "seance", registrants: n, tickets: 0, past: n === 2 }),
      cancelOccurrenceCopy({ kind: "rdv", registrants: n, tickets: n, past: false }),
      cancelOccurrenceCopy({ kind: "rdv", registrants: n, tickets: 0, past: false }),
      unenrollCopy({ names, ticketCount: n, pendingCount: n }),
      closeTicketsCopy({ count: n, reasonLabel: "Abandonné" }),
      retireTicketsCopy({ count: n }),
      deleteTypeCopy({ name: "Type", used: n === 1, acceptedBy: names }),
      deleteOfferCopy({ label: "Offre", sold: n === 1, checkedOut: n >= 1 }),
      event({ fromLabel: n === 0 ? null : "lun. 12/10", deletedSeances: n, cancelledSeances: n, registrants: n, ticketsReturned: n }),
    );
    for (const [seances, rdvs] of [[n, 0], [0, n], [n, n]] as const) {
      const conflict = timeOffConflictCopy({ seances, rdvs, tickets: n });
      copies.push({
        title: conflict.title,
        body: `${conflict.intro} ${conflict.keepNote} ${conflict.rdvNote}`,
        confirm: `${conflict.cancelLabel} ${conflict.keepLabel}`,
      });
    }
  }
  copies.push(
    restoreOccurrenceCopy(),
    revokeLinksCopy({ name: "Client" }),
    archiveTypeCopy({ name: "Type" }),
    deleteTimeOffCopy(),
  );
  for (const copy of copies) {
    for (const text of [copy.title, copy.body, copy.confirm]) {
      assert.ok(text.trim().length > 0, JSON.stringify(copy));
      assert.equal(DASH.test(text), false, text);
    }
  }
});

test("the revoke notice says that a linked client account stays linked", () => {
  const plain = revokeLinksDoneNotice({ linkedAccount: false });
  const linked = revokeLinksDoneNotice({ linkedAccount: true });
  assert.equal(plain, "Liens déconnectés.");
  assert.equal(linked, "Liens déconnectés. Le compte client reste lié.");
  for (const text of [plain, linked]) assert.equal(DASH.test(text), false, text);
});
