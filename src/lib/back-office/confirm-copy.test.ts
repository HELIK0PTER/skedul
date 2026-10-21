import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveTypeCopy,
  cancelOccurrenceCopy,
  closeTicketsCopy,
  deleteEventCopy,
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
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 0, past: false }), {
    ...base,
    body: "Personne n'est inscrit : la séance est simplement annulée.",
  });
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 1, past: false }), {
    ...base,
    body: "La personne inscrite est désinscrite, son ticket est rendu et elle est prévenue par email.",
  });
  assert.deepEqual(cancelOccurrenceCopy({ kind: "seance", registrants: 3, past: false }), {
    ...base,
    body: "Les 3 inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email.",
  });
  assert.equal(
    cancelOccurrenceCopy({ kind: "seance", registrants: 3, past: true }).body,
    "Les 3 inscrits sont désinscrits, leurs tickets sont rendus et ils sont prévenus par email. Cette séance est déjà passée : les tickets sont rendus quand même.",
  );
});

test("cancelOccurrenceCopy: a rendez-vous", () => {
  assert.deepEqual(cancelOccurrenceCopy({ kind: "rdv", registrants: 1, past: false }), {
    title: "Annuler ce rendez-vous ?",
    body: "Le client est prévenu par email et son ticket lui est rendu.",
    confirm: "Annuler le rendez-vous",
  });
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
});

test("closeTicketsCopy and retireTicketsCopy count with plural", () => {
  assert.deepEqual(closeTicketsCopy({ count: 3, reasonLabel: "Abandonné" }), {
    title: "Clore 3 tickets ?",
    body: "Motif : Abandonné. Les tickets restent visibles, barrés, dans son portefeuille. Rien n'est remboursé automatiquement.",
    confirm: "Clore",
  });
  assert.equal(closeTicketsCopy({ count: 1, reasonLabel: "Abandonné" }).title, "Clore 1 ticket ?");
  assert.deepEqual(retireTicketsCopy({ count: 2 }), {
    title: "Retirer 2 tickets offerts ?",
    body: "Ils restent visibles, barrés, dans son portefeuille.",
    confirm: "Retirer",
  });
  assert.equal(retireTicketsCopy({ count: 1 }).title, "Retirer 1 ticket offert ?");
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

const RDV_NOTE = "Un rendez-vous compte avec ses marges avant et après.";

test("timeOffConflictCopy: séances only, plural and singular", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 2, rdvs: 0 }), {
    title: "Des séances ont des inscrits",
    intro: "Cette indisponibilité chevauche 2 séances avec des inscrits :",
    cancelLabel: "Annuler ces 2 séances (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote:
      "Gardées, elles restent pour leurs inscrits mais ne sont plus réservables en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote: RDV_NOTE,
  });
  assert.deepEqual(timeOffConflictCopy({ seances: 1, rdvs: 0 }), {
    title: "Des séances ont des inscrits",
    intro: "Cette indisponibilité chevauche 1 séance avec des inscrits :",
    cancelLabel: "Annuler cette séance (tickets rendus, clients prévenus)",
    keepLabel: "La garder",
    keepNote:
      "Gardée, elle reste pour ses inscrits mais n'est plus réservable en ligne. Vous pouvez encore y inscrire quelqu'un.",
    rdvNote: RDV_NOTE,
  });
});

test("timeOffConflictCopy: rendez-vous only never says séance nor inscrit", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 0, rdvs: 1 }), {
    title: "Un rendez-vous est réservé",
    intro: "Cette indisponibilité chevauche 1 rendez-vous réservé :",
    cancelLabel: "Annuler ce rendez-vous (ticket rendu, client prévenu)",
    keepLabel: "Le garder",
    keepNote: "Gardé, il reste pour son client mais le créneau n'est plus réservable en ligne.",
    rdvNote: RDV_NOTE,
  });
  assert.deepEqual(timeOffConflictCopy({ seances: 0, rdvs: 2 }), {
    title: "Des rendez-vous sont réservés",
    intro: "Cette indisponibilité chevauche 2 rendez-vous réservés :",
    cancelLabel: "Annuler ces 2 rendez-vous (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote: "Gardés, ils restent pour leurs clients mais les créneaux ne sont plus réservables en ligne.",
    rdvNote: RDV_NOTE,
  });
});

test("timeOffConflictCopy: séances and rendez-vous together", () => {
  assert.deepEqual(timeOffConflictCopy({ seances: 2, rdvs: 1 }), {
    title: "Des séances et des rendez-vous sont réservés",
    intro: "Cette indisponibilité chevauche 2 séances avec des inscrits et 1 rendez-vous réservé :",
    cancelLabel: "Annuler ces 3 séances et rendez-vous (tickets rendus, clients prévenus)",
    keepLabel: "Les garder",
    keepNote:
      "Gardés, ils restent pour leurs inscrits et leurs clients mais ne sont plus réservables en ligne. Vous pouvez encore inscrire quelqu'un à une séance.",
    rdvNote: RDV_NOTE,
  });
  const oneEach = timeOffConflictCopy({ seances: 1, rdvs: 1 });
  assert.equal(oneEach.intro, "Cette indisponibilité chevauche 1 séance avec des inscrits et 1 rendez-vous réservé :");
  assert.equal(oneEach.cancelLabel, "Annuler ces 2 séances et rendez-vous (tickets rendus, clients prévenus)");
  assert.equal(
    timeOffConflictCopy({ seances: 1, rdvs: 3 }).intro,
    "Cette indisponibilité chevauche 1 séance avec des inscrits et 3 rendez-vous réservés :",
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
      cancelOccurrenceCopy({ kind: "seance", registrants: n, past: n === 2 }),
      cancelOccurrenceCopy({ kind: "rdv", registrants: n, past: false }),
      unenrollCopy({ names, ticketCount: n, pendingCount: n }),
      closeTicketsCopy({ count: n, reasonLabel: "Abandonné" }),
      retireTicketsCopy({ count: n }),
      deleteTypeCopy({ name: "Type", used: n === 1, acceptedBy: names }),
      deleteOfferCopy({ label: "Offre", sold: n === 1, checkedOut: n >= 1 }),
      event({ fromLabel: n === 0 ? null : "lun. 12/10", deletedSeances: n, cancelledSeances: n, registrants: n, ticketsReturned: n }),
    );
    for (const [seances, rdvs] of [[n, 0], [0, n], [n, n]] as const) {
      const conflict = timeOffConflictCopy({ seances, rdvs });
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
