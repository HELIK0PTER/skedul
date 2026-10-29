import assert from "node:assert/strict";
import test from "node:test";

import { ENGINE_ERROR_CODES, ENGINE_ERROR_MESSAGES, isEngineErrorCode } from "./tickets-vocab";
import {
  callOrFail,
  PRO_CONTEXT_MESSAGES,
  PRO_ERROR_MESSAGES,
  proErrorMessage,
  REQUEST_FAILED,
  type ProErrorContext,
} from "./pro-messages";

const CONTEXTS: readonly ProErrorContext[] = [
  "catalog",
  "event",
  "series",
  "occurrence",
  "cancel",
  "restore",
  "register",
  "unenroll",
  "move",
  "timeOff",
  "customer",
  "wallet",
  "settings",
  "profile",
];

const DASH = /[\u2014\u2013]/;
const CLIENT_WORDING = "Vous êtes déjà inscrit(e).";

/** Every message of both tables, with where it lives. */
function everyMessage(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const code of ENGINE_ERROR_CODES) out.push({ where: code, text: PRO_ERROR_MESSAGES[code] });
  for (const [context, table] of Object.entries(PRO_CONTEXT_MESSAGES)) {
    for (const [code, text] of Object.entries(table ?? {})) out.push({ where: `${context}.${code}`, text });
  }
  return out;
}

test("every engine code has a non-empty pro message, and nothing else", () => {
  assert.deepEqual(Object.keys(PRO_ERROR_MESSAGES).sort(), [...ENGINE_ERROR_CODES].sort());
  for (const code of ENGINE_ERROR_CODES) {
    assert.ok(PRO_ERROR_MESSAGES[code].trim().length > 0, code);
  }
});

test("the general pro messages are the contract table", () => {
  assert.deepEqual(PRO_ERROR_MESSAGES, {
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
  });
});

test("no pro message contains a dash", () => {
  for (const { where, text } of everyMessage()) assert.equal(DASH.test(text), false, `${where}: ${text}`);
});

test("overrides only target real contexts and real engine codes", () => {
  for (const [context, table] of Object.entries(PRO_CONTEXT_MESSAGES)) {
    assert.ok((CONTEXTS as readonly string[]).includes(context), `unknown context ${context}`);
    assert.ok(Object.keys(table ?? {}).length > 0, `${context} has no override`);
    for (const [code, text] of Object.entries(table ?? {})) {
      assert.equal(isEngineErrorCode(code), true, `${context}.${code} is not an engine code`);
      assert.ok(text.trim().length > 0, `${context}.${code}`);
    }
  }
});

test("the client wording never reaches the pro", () => {
  for (const { where, text } of everyMessage()) {
    assert.equal(text.includes(CLIENT_WORDING), false, where);
    assert.equal(text.includes("inscrit(e)"), false, where);
  }
  assert.equal(ENGINE_ERROR_MESSAGES.already_booked, CLIENT_WORDING);
  for (const context of CONTEXTS) {
    assert.notEqual(proErrorMessage({ code: "already_booked" }, context), CLIENT_WORDING, context);
  }
});

test("already_booked while registering reads « Ce client est déjà inscrit à cette séance. »", () => {
  assert.equal(proErrorMessage({ code: "already_booked" }, "register"), "Ce client est déjà inscrit à cette séance.");
});

test("an engine message wins over every table", () => {
  assert.equal(proErrorMessage({ code: "invalid", message: "Plage horaire invalide." }, "settings"), "Plage horaire invalide.");
  assert.equal(proErrorMessage({ code: "full", message: "Message du moteur." }, "register"), "Message du moteur.");
});

test("a context override beats the general text, other contexts keep the general one", () => {
  assert.equal(
    proErrorMessage({ code: "full" }, "register"),
    "Complet : cochez « +1 place » pour l'inscrire quand même.",
  );
  assert.equal(proErrorMessage({ code: "full" }, "move"), "La séance choisie est complète.");
  assert.equal(proErrorMessage({ code: "full" }, "event"), "Cette séance est complète.");
  assert.equal(proErrorMessage({ code: "not_found" }, "restore"), "Seule une séance future d'un événement peut être rétablie.");
  assert.equal(proErrorMessage({ code: "not_found" }, "customer"), "Client introuvable.");
  assert.equal(proErrorMessage({ code: "not_found" }, "timeOff"), "Élément introuvable : il a peut-être été supprimé.");
  assert.equal(proErrorMessage({ code: "invalid" }, "settings"), "Valeurs hors limites.");
  assert.equal(proErrorMessage({ code: "invalid" }, "event"), "Un type de ticket choisi n'existe plus.");
  assert.equal(proErrorMessage({ code: "stale" }, "timeOff"), "Des inscriptions ont changé pendant la vérification : voici la liste à jour.");
  assert.equal(proErrorMessage({ code: "timezone_locked" }, "profile"), "Fuseau verrouillé : vous avez des séances planifiées, des indisponibilités à venir ou des tickets à durée limitée.");
});

test("every code resolves to a message in every context", () => {
  for (const context of CONTEXTS) {
    for (const code of ENGINE_ERROR_CODES) {
      assert.ok(proErrorMessage({ code }, context).trim().length > 0, `${context}.${code}`);
    }
  }
});

test("REQUEST_FAILED is the French transport failure text, without a dash", () => {
  assert.equal(REQUEST_FAILED, "La demande n'a pas abouti. Vérifiez votre connexion et réessayez.");
  assert.ok(!DASH.test(REQUEST_FAILED));
});

test("callOrFail hands the answer of the Server Action over untouched (final review UI-4)", async () => {
  const refusal = { ok: false as const, error: "Nom : indiquez un nom." };
  assert.deepEqual(await callOrFail(async () => ({ ok: true as const, id: "t1" })), { ok: true, id: "t1" });
  assert.equal(await callOrFail(async () => refusal), refusal);
});

test("callOrFail turns a call that threw into the REQUEST_FAILED refusal, never into an exception (final review UI-4)", async () => {
  const failed = await callOrFail<{ ok: true } | { ok: false; error: string }>(async () => {
    throw new Error("fetch failed");
  });
  assert.deepEqual(failed, { ok: false, error: REQUEST_FAILED });
  const sync = await callOrFail<{ ok: true }>(() => {
    throw new TypeError("not even a promise");
  });
  assert.deepEqual(sync, { ok: false, error: REQUEST_FAILED });
});
