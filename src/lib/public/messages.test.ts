import assert from "node:assert/strict";
import test from "node:test";

import { PRO_CONTEXT_MESSAGES, PRO_ERROR_MESSAGES } from "../pro-messages";
import { ENGINE_ERROR_MESSAGES, isEngineErrorCode } from "../tickets-vocab";
import {
  CLIENT_CONTEXT_MESSAGES,
  COPY,
  PUBLIC_STATE_LABELS,
  acceptedByLine,
  cancelLockedText,
  clientErrorMessage,
  dataUseLine,
  guestNote,
  heldTicketButtonLabel,
  maskEmail,
  noRecordText,
  rdvTimeZoneLine,
  seatsLeftLabel,
  walletLine,
} from "./messages";

const V = { businessName: "Altinha Paris" };
/** fr-FR groups thousands with a narrow no-break space (U+202F); the contract writes it as a plain space. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, " ");

test("PUBLIC_STATE_LABELS holds the eight fixed state labels", () => {
  assert.deepEqual(PUBLIC_STATE_LABELS, {
    cancelled: "Annulée",
    past: "Terminée",
    ongoing: "En cours",
    onsite: "Sur place",
    notYet: "Réservations pas encore ouvertes",
    closed: "Réservations fermées",
    full: "Complet",
    free: "Inscription libre",
  });
});

test("CLIENT_CONTEXT_MESSAGES is the contract table and only names real codes and contexts", () => {
  assert.deepEqual(CLIENT_CONTEXT_MESSAGES, {
    buybook: {
      full: "Complet : il ne reste plus de place sur cette séance.",
      stale: "L'offre a changé : rafraîchissez la page.",
      not_found: "Cette séance ou cette offre n'existe plus : rafraîchissez la page.",
    },
    free: {
      full: "Complet : il ne reste plus de place sur cette séance.",
      not_found: "Cette séance n'existe plus : rafraîchissez la page.",
    },
    held: {
      full: "Complet : il ne reste plus de place sur cette séance.",
      not_found: "Cette séance n'existe plus : rafraîchissez la page.",
    },
    shop: {
      stale: "L'offre a changé : rafraîchissez la page.",
      not_found: "Cette offre n'est plus proposée.",
    },
    release: {
      not_found: "Paiement introuvable : rafraîchissez la page.",
    },
    cancel: {
      too_late_or_done: "Seul(e) {businessName} peut annuler maintenant.",
      not_found: "Inscription introuvable : rafraîchissez la page.",
      stale: "Cette inscription a changé : rafraîchissez la page.",
    },
    rdv: {
      unavailable: "Ce créneau n'est plus disponible : choisissez-en un autre.",
      stale: "Les horaires ou l'offre ont changé : rafraîchissez la page.",
      not_found: "Ce rendez-vous ou cette offre n'existe plus : rafraîchissez la page.",
      no_ticket: "Aucun ticket utilisable pour ce rendez-vous.",
      offer_too_short: "La validité de cette offre ne couvre pas la date du rendez-vous.",
      too_many_holds: "Vous avez déjà deux paiements en cours. Terminez-les avant de réserver un autre rendez-vous.",
    },
  });
  const contexts = ["buybook", "free", "held", "shop", "release", "cancel", "rdv"];
  for (const [context, table] of Object.entries(CLIENT_CONTEXT_MESSAGES)) {
    assert.ok(contexts.includes(context), `unknown context ${context}`);
    for (const code of Object.keys(table ?? {})) assert.ok(isEngineErrorCode(code), `${context}.${code} is not an engine code`);
  }
});

test("clientErrorMessage: an invalid with an engine message shows that message, no other code echoes one", () => {
  assert.equal(
    clientErrorMessage({ code: "invalid", message: "Merci de répondre à : Niveau" }, "free", V),
    "Merci de répondre à : Niveau",
  );
  assert.equal(clientErrorMessage({ code: "invalid" }, "free", V), ENGINE_ERROR_MESSAGES.invalid);
  // an engine message on another code is never relayed to a client
  assert.equal(
    clientErrorMessage({ code: "stale", message: "English text from a zod check" }, "buybook", V),
    "L'offre a changé : rafraîchissez la page.",
  );
});

test("clientErrorMessage: context overrides, then the general client wording", () => {
  assert.equal(clientErrorMessage({ code: "stale" }, "buybook", V), "L'offre a changé : rafraîchissez la page.");
  assert.equal(clientErrorMessage({ code: "stale" }, "shop", V), "L'offre a changé : rafraîchissez la page.");
  assert.equal(clientErrorMessage({ code: "full" }, "buybook", V), "Complet : il ne reste plus de place sur cette séance.");
  assert.equal(clientErrorMessage({ code: "not_found" }, "shop", V), "Cette offre n'est plus proposée.");
  assert.equal(clientErrorMessage({ code: "not_found" }, "release", V), "Paiement introuvable : rafraîchissez la page.");
  assert.equal(clientErrorMessage({ code: "stale" }, "cancel", V), "Cette inscription a changé : rafraîchissez la page.");
  // no override: the general client sentence of the vocabulary
  assert.equal(clientErrorMessage({ code: "no_ticket" }, "held", V), ENGINE_ERROR_MESSAGES.no_ticket);
  assert.equal(clientErrorMessage({ code: "already_booked" }, "buybook", V), "Vous êtes déjà inscrit(e).");
  assert.equal(clientErrorMessage({ code: "throttled" }, "release", V), "Trop de demandes. Réessayez dans un moment.");
  assert.equal(clientErrorMessage({ code: "full" }, "release", V), ENGINE_ERROR_MESSAGES.full);
});

test("clientErrorMessage: cancel names the business, and cancelLockedText is the same sentence", () => {
  assert.equal(
    clientErrorMessage({ code: "too_late_or_done" }, "cancel", V),
    "Seul(e) Altinha Paris peut annuler maintenant.",
  );
  assert.equal(cancelLockedText("Altinha Paris"), "Seul(e) Altinha Paris peut annuler maintenant.");
  assert.equal(clientErrorMessage({ code: "too_late_or_done" }, "cancel", V), cancelLockedText(V.businessName));
  // outside the cancel context the code keeps the general sentence
  assert.equal(clientErrorMessage({ code: "too_late_or_done" }, "free", V), ENGINE_ERROR_MESSAGES.too_late_or_done);
});

test("clientErrorMessage: a business name is inserted literally", () => {
  const odd = "Cours $& {businessName} $1";
  assert.equal(
    clientErrorMessage({ code: "too_late_or_done" }, "cancel", { businessName: odd }),
    "Seul(e) Cours $& {businessName} $1 peut annuler maintenant.",
  );
  assert.equal(cancelLockedText(odd), "Seul(e) Cours $& {businessName} $1 peut annuler maintenant.");
});

test("seatsLeftLabel: singular below two, fr-FR thousands", () => {
  assert.equal(seatsLeftLabel(0), "0 place restante");
  assert.equal(seatsLeftLabel(1), "1 place restante");
  assert.equal(seatsLeftLabel(2), "2 places restantes");
  assert.equal(seatsLeftLabel(5), "5 places restantes");
  assert.equal(plain(seatsLeftLabel(1000)), "1 000 places restantes");
  assert.notEqual(seatsLeftLabel(1000), "1000 places restantes", "the thousands are grouped");
});

test("heldTicketButtonLabel: the last ticket reads differently", () => {
  assert.equal(heldTicketButtonLabel(0), "Réserver avec mon dernier ticket");
  assert.equal(heldTicketButtonLabel(-1), "Réserver avec mon dernier ticket");
  assert.equal(heldTicketButtonLabel(1), "Réserver avec 1 ticket (il vous en restera 1)");
  assert.equal(heldTicketButtonLabel(3), "Réserver avec 1 ticket (il vous en restera 3)");
});

test("maskEmail keeps one character, hides the rest of the local part and its length", () => {
  assert.equal(maskEmail("beatriz@example.com"), "b•••@example.com");
  assert.equal(maskEmail("b@example.com"), "b•••@example.com");
  assert.equal(maskEmail("beatriz.almeida+club@example.com"), "b•••@example.com");
  assert.equal(maskEmail("@example.com"), "•••@example.com");
  assert.equal(maskEmail("x"), "•••");
  assert.equal(maskEmail(""), "•••");
  // a character outside the basic plane is not cut in two
  assert.equal(maskEmail("𠮷ana@example.com"), "𠮷•••@example.com");
});

test("fixed sentences with a variable: dataUseLine, noRecordText, guestNote, acceptedByLine", () => {
  assert.equal(
    dataUseLine("Altinha Paris"),
    "Vos coordonnées sont transmises à Altinha Paris pour gérer votre réservation.",
  );
  assert.equal(
    noRecordText("Altinha Paris", "beatriz@example.com"),
    "Aucun ticket chez Altinha Paris pour beatriz@example.com.",
  );
  assert.equal(
    guestNote("beatriz@example.com"),
    "Vous consultez l'espace de b•••@example.com avec un lien personnel.",
  );
  assert.equal(acceptedByLine(["Altinha débutants", "Roda libre"]), "Utilisable pour : Altinha débutants, Roda libre");
  assert.equal(acceptedByLine(["Roda libre"]), "Utilisable pour : Roda libre");
  assert.equal(acceptedByLine([]), "");
});

test("walletLine: singular, plural, thousands, nothing for zero or a non-count", () => {
  assert.equal(walletLine(1), "1 ticket est dans votre portefeuille.");
  assert.equal(walletLine(3), "3 tickets sont dans votre portefeuille.");
  assert.equal(plain(walletLine(1000) ?? ""), "1 000 tickets sont dans votre portefeuille.");
  assert.equal(walletLine(0), null);
  assert.equal(walletLine(-2), null);
  assert.equal(walletLine(1.5), null);
  assert.equal(walletLine(Number.NaN), null);
});

test("COPY holds every fixed client sentence, word for word", () => {
  assert.deepEqual(COPY, {
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
    NO_UPCOMING: "Aucune inscription à venir.",
    ORPHAN_TYPE: "Aucune séance à venir n'accepte ce type pour le moment.",
    RETURN_LINK: "Reprendre ou libérer ma réservation",
    PENDING_SEND: "Envoi…",
    PENDING_VERIFY: "Vérification…",
    PENDING_REGISTER: "Inscription…",
    PENDING_BOOK: "Réservation…",
    PENDING_SAVE: "Enregistrement…",
    PENDING_PAY: "Redirection vers le paiement…",
    SIGNED_IN: "Connexion réussie.",
    PENDING_SIGN_IN: "Connexion…",
    PENDING_SIGN_UP: "Création…",
    RDV_SLOT_GONE: "Ce créneau n'est plus disponible : choisissez-en un autre.",
    RDV_NO_OFFER: "Aucune offre ne couvre cette date. Choisissez un créneau plus proche.",
    RDV_EMPTY_WEEK: "Aucun créneau cette semaine",
    RDV_NEXT_WEEK: "Semaine suivante",
    RDV_CLOSED: "Aucun créneau disponible pour le moment.",
    RDV_BOOK: "Réserver",
    RDV_CARD_CTA: "Réserver un rendez-vous",
    RDV_FREE_BADGE: "Gratuit",
    RDV_TOO_MANY_PAYMENTS: "Plusieurs paiements de rendez-vous sont en cours. Réessayez dans quelques minutes.",
  });
});

test("rdvTimeZoneLine: « Heures de {zone} », the zone label inserted literally (O30)", () => {
  assert.equal(rdvTimeZoneLine("Paris (France)"), "Heures de Paris (France)");
  assert.equal(rdvTimeZoneLine("Los Angeles (États-Unis)"), "Heures de Los Angeles (États-Unis)");
  assert.equal(rdvTimeZoneLine("$& {zone}"), "Heures de $& {zone}");
});

test("RDV wording: the off-grid refusal is the unavailable sentence, and the rdv context reads per code", () => {
  assert.equal(COPY.RDV_SLOT_GONE, CLIENT_CONTEXT_MESSAGES.rdv?.unavailable);
  assert.equal(clientErrorMessage({ code: "slot_taken" }, "rdv", V), "Ce créneau vient d'être pris.");
  assert.equal(clientErrorMessage({ code: "slot_taken" }, "rdv", V), ENGINE_ERROR_MESSAGES.slot_taken, "the engine default, L711");
  assert.equal(clientErrorMessage({ code: "stale" }, "rdv", V), "Les horaires ou l'offre ont changé : rafraîchissez la page.");
  assert.equal(clientErrorMessage({ code: "throttled" }, "rdv", V), ENGINE_ERROR_MESSAGES.throttled);
  // buildAnswers' French message still goes through on an RDV
  assert.equal(clientErrorMessage({ code: "invalid", message: "Merci de répondre à : Niveau" }, "rdv", V), "Merci de répondre à : Niveau");
});

/** « séance », « inscription », « inscrit(e) », « place »: never said of an RDV (P5 plan, copy rule). */
const SEANCE_WORDS = new RegExp(`(^|[^${"a-zàâäçéèêëîïôöùûüÿœæ"}])(séances?|inscriptions?|inscrite?s?|places?)(?![${"a-zàâäçéèêëîïôöùûüÿœæ"}])`, "i");

test("the séance-word guard flags séance, inscription, inscrit(e) and place, not « remplacer » or « placement »", () => {
  for (const flagged of ["Cette séance", "Inscription confirmée", "Vous êtes inscrit(e).", "libérez une place", "3 places"]) {
    assert.equal(SEANCE_WORDS.test(flagged), true, flagged);
  }
  for (const fine of ["Ce créneau", "remplacer", "placement", "Réserver un rendez-vous"]) {
    assert.equal(SEANCE_WORDS.test(fine), false, fine);
  }
});

test("every sentence the RDV path shows is worded for a rendez-vous, never a séance (P5 copy rule)", () => {
  const texts: { where: string; text: string }[] = [];
  for (const [code, text] of Object.entries(CLIENT_CONTEXT_MESSAGES.rdv ?? {})) texts.push({ where: `rdv.${code}`, text });
  for (const [key, text] of Object.entries(COPY)) if (key.startsWith("RDV_")) texts.push({ where: `COPY.${key}`, text });
  // Every code bookRdv can return (claims.ts), read in the rdv context.
  for (const code of ["not_found", "unavailable", "offer_too_short", "invalid", "stale", "slot_taken", "no_ticket", "too_many_holds", "throttled"] as const) {
    texts.push({ where: `engine.${code}`, text: clientErrorMessage({ code }, "rdv", V) });
  }
  // The shared sentences bookRdvCore returns (dossier § 3.5).
  for (const key of ["HONEYPOT_REFUSED", "CONFIRM_EMAIL_TO_SPEND", "PAYMENT_UNAVAILABLE", "CHECKOUT_FAILED", "BUYBOOK_NOT_POSSIBLE"] as const) {
    texts.push({ where: `COPY.${key}`, text: COPY[key] });
  }
  texts.push({ where: "rdvTimeZoneLine", text: rdvTimeZoneLine("Paris (France)") });
  assert.ok(texts.length >= 25, "the list of RDV sentences is not empty");
  for (const { where, text } of texts) assert.equal(SEANCE_WORDS.test(text), false, `${where} speaks of a séance: ${text}`);
});

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
// JavaScript's \b is ASCII-only and would flag « êtes »: the boundary is spelled out with the French letters.
const FR_LETTERS = "a-zàâäçéèêëîïôöùûüÿœæ";
const TUTOIEMENT = new RegExp(`(^|[^${FR_LETTERS}])(tu|ton|ta|tes)(?![${FR_LETTERS}])`, "i");

/** Every client string of the module, with where it lives (function outputs included). */
function everyClientString(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const [kind, text] of Object.entries(PUBLIC_STATE_LABELS)) out.push({ where: `state.${kind}`, text });
  for (const [context, table] of Object.entries(CLIENT_CONTEXT_MESSAGES)) {
    for (const [code, text] of Object.entries(table ?? {})) out.push({ where: `${context}.${code}`, text });
  }
  for (const [key, text] of Object.entries(COPY)) out.push({ where: `COPY.${key}`, text });
  const samples = [
    seatsLeftLabel(1),
    seatsLeftLabel(5),
    cancelLockedText("Altinha Paris"),
    heldTicketButtonLabel(0),
    heldTicketButtonLabel(3),
    dataUseLine("Altinha Paris"),
    noRecordText("Altinha Paris", "beatriz@example.com"),
    guestNote("beatriz@example.com"),
    acceptedByLine(["Altinha débutants", "Roda libre"]),
    walletLine(1) ?? "",
    walletLine(4) ?? "",
    rdvTimeZoneLine("Paris (France)"),
  ];
  samples.forEach((text, index) => out.push({ where: `sample.${index}`, text }));
  return out;
}

test("the tutoiement guard flags tu, ton, ta, tes and not « êtes »", () => {
  for (const flagged of ["tu es ici", "Voici ton lien", "ta page", "Vos tickets et tes réservations", "(tes)"]) {
    assert.equal(TUTOIEMENT.test(flagged), true, flagged);
  }
  for (const fine of ["Vous êtes ici", "Mon espace", "Enregistrement…", "statut", "Beta"]) {
    assert.equal(TUTOIEMENT.test(fine), false, fine);
  }
});

test("no client string has a dash, a pro wording or a tutoiement", () => {
  const proTexts = new Set<string>(Object.values(PRO_ERROR_MESSAGES));
  for (const table of Object.values(PRO_CONTEXT_MESSAGES)) {
    for (const text of Object.values(table ?? {})) if (text) proTexts.add(text);
  }
  const strings = everyClientString();
  assert.ok(strings.length > 80, "the list of strings under test is not empty");
  for (const { where, text } of strings) {
    assert.ok(text.trim().length > 0 || where.startsWith("sample."), `${where} is empty`);
    assert.equal(DASH.test(text), false, `${where} has a dash: ${text}`);
    assert.equal(TUTOIEMENT.test(text), false, `${where} is not in vouvoiement: ${text}`);
    assert.equal(proTexts.has(text), false, `${where} reuses a pro message: ${text}`);
  }
});
