import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CARNET_OFFER_ID, DEMO_CLIENT, LEA_RDV } from "./demo-data";
import {
  DEMO_STEPS,
  INITIAL_STATE,
  demoHref,
  leaTicketsLeft,
  stateAfter,
  stateEntering,
  stepIndex,
  type Patch,
} from "./demo-script";

const at = (id: string) => {
  const i = DEMO_STEPS.findIndex((s) => s.id === id);
  assert.ok(i >= 0, `no step ${id}`);
  return i;
};

/** Every patch a step applies on its way (clicks and applies), in order. */
const patchesOf = (id: string): Patch[] =>
  DEMO_STEPS[at(id)].timeline.flatMap((a) => ((a.type === "click" || a.type === "apply") && a.patch ? [a.patch] : []));

test("14 étapes : 7 côté client, 6 côté pro, puis la fin", () => {
  assert.equal(DEMO_STEPS.length, 14);
  assert.deepEqual(
    DEMO_STEPS.map((s) => s.chapter),
    [...Array(7).fill("client"), ...Array(6).fill("pro"), "outro"],
  );
  assert.equal(stateEntering(13).screen, "outro");
});

test("les identifiants d'étape sont uniques, en minuscules ASCII, et racontent la nouvelle visite", () => {
  const ids = DEMO_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/);
  assert.deepEqual(ids, [
    "page-publique",
    "carnet",
    "paiement",
    "deja-des-tickets",
    "utiliser-un-ticket",
    "rendez-vous",
    "espace-client",
    "planning",
    "evenements",
    "tickets",
    "disponibilites",
    "fiche-client",
    "couleurs",
    "a-vous",
  ]);
});

test("stateEntering(0) = état initial", () => {
  assert.deepEqual(stateEntering(0), INITIAL_STATE);
});

test("la page publique montre le planning puis descend vers la Boutique", () => {
  assert.equal(stateEntering(at("page-publique")).screen, "client-page");
  assert.equal(stateEntering(at("page-publique")).pageSection, "planning");
  assert.equal(stateAfter(at("page-publique")).pageSection, "lower");
});

test("un carnet dès la première séance : la place est gardée pendant le paiement, puis la page merci", () => {
  const carnet = stateAfter(at("carnet"));
  assert.equal(carnet.screen, "client-seance");
  assert.equal(carnet.seance, "monday");
  assert.equal(carnet.offerPicked, CARNET_OFFER_ID);
  assert.equal(carnet.formName, DEMO_CLIENT.name);
  assert.equal(carnet.formEmail, DEMO_CLIENT.email);
  assert.equal(stateEntering(at("carnet")).pageSection, "planning", "the séance is picked in the planning");

  assert.ok(
    patchesOf("paiement").some((p) => p.held === true && p.paying === true),
    "the seat is held while the payment runs",
  );
  const paid = stateAfter(at("paiement"));
  assert.equal(paid.screen, "client-merci");
  assert.equal(paid.held, false);
  assert.equal(paid.paying, false);
  assert.equal(paid.mondayBooked, true);
  assert.equal(leaTicketsLeft(paid), 3, "a carnet of 4, one used for Monday");
});

test("« J'ai déjà des tickets » : un code reçu par email, puis le portefeuille", () => {
  const before = stateEntering(at("deja-des-tickets"));
  assert.equal(before.screen, "client-page");
  assert.equal(before.signedIn, false);
  assert.equal(before.signIn, "closed");
  assert.equal(before.formEmail, "", "the code form is never prefilled with an address");
  const steps = patchesOf("deja-des-tickets").map((p) => p.signIn).filter(Boolean);
  assert.deepEqual(steps, ["email", "code", "closed"]);
  const after = stateAfter(at("deja-des-tickets"));
  assert.equal(after.signedIn, true);
  assert.match(after.formCode, /^\d{6}$/);
});

test("réserver avec un ticket : un ticket utilisé mercredi, il en reste deux", () => {
  const s = stateAfter(at("utiliser-un-ticket"));
  assert.equal(s.screen, "client-seance");
  assert.equal(s.seance, "wednesday");
  assert.equal(s.wednesdayBooked, true);
  assert.equal(leaTicketsLeft(s), 2);
});

test("prendre rendez-vous : un créneau de l'appel découverte, réservé", () => {
  const s = stateAfter(at("rendez-vous"));
  assert.equal(s.screen, "client-rdv");
  assert.equal(s.rdvDayIndex, LEA_RDV.dayIndex);
  assert.equal(s.rdvTime, LEA_RDV.time);
  assert.equal(s.rdvBooked, true);
  assert.equal(stateEntering(at("rendez-vous")).pageSection, "lower", "the RDV cards sit under the planning");
});

test("l'espace client ouvre sur ses réservations et ses tickets", () => {
  const s = stateEntering(at("espace-client"));
  assert.equal(s.screen, "client-espace");
  assert.equal(leaTicketsLeft(s), 2);
  assert.equal(s.rdvBooked, true);
});

test("côté pro : chaque étape démarre sur le bon écran et finit sur son geste", () => {
  assert.equal(stateEntering(at("planning")).screen, "pro-planning");
  assert.equal(stateAfter(at("planning")).planningHasLea, true);
  assert.equal(stateAfter(at("planning")).planningSeanceOpen, true);
  assert.equal(stateEntering(at("evenements")).screen, "pro-events");
  assert.equal(stateAfter(at("evenements")).eventEditorOpen, true);
  assert.equal(stateEntering(at("tickets")).screen, "pro-tickets");
  assert.equal(stateAfter(at("tickets")).ticketTypeOpen, true);
  assert.equal(stateEntering(at("disponibilites")).screen, "pro-availability");
  assert.equal(stateAfter(at("disponibilites")).saturdayEnabled, true);
  assert.equal(stateEntering(at("fiche-client")).screen, "pro-client");
  const file = stateAfter(at("fiche-client"));
  assert.equal(file.ticketGiven, true);
  assert.equal(file.giveOpen, false);
  assert.equal(leaTicketsLeft(file), 3, "the pro gave her one ticket");
  assert.equal(stateAfter(at("couleurs")).brandColor, "#0d9488");
  assert.equal(stateAfter(at("couleurs")).headerLayout, "vitrine");
});

test("lien profond : ?step= ouvre la bonne étape, sinon la première", () => {
  assert.equal(demoHref(), "/demo");
  assert.equal(demoHref("tickets"), "/demo?step=tickets");
  DEMO_STEPS.forEach((s, i) => assert.equal(stepIndex(s.id), i, s.id));
  assert.equal(stepIndex(undefined), 0);
  assert.equal(stepIndex("inconnue"), 0);
  assert.equal(stepIndex(["tickets", "planning"]), 0);
  // The ids of the first tour open the first step, never an error.
  for (const old of ["profile", "buy-pack", "book-credit", "packs", "event-types"]) assert.equal(stepIndex(old), 0, old);
});

/** Every .tsx file under `dir`. */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(process.cwd(), path)).isDirectory()) tsxFiles(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

test("chaque DemoLink step=... du site ouvre une étape qui existe (aucun lien profond cassé)", () => {
  const ids = new Set(DEMO_STEPS.map((s) => s.id));
  const found: string[] = [];
  for (const file of [...tsxFiles("src/app"), ...tsxFiles("src/components")]) {
    const text = readFileSync(join(process.cwd(), file), "utf8");
    for (const m of text.matchAll(/<DemoLink\b[^>]*?\bstep="([^"]*)"/g)) {
      found.push(m[1]);
      assert.ok(ids.has(m[1]), `${file}: step="${m[1]}" is not a step of the tour`);
    }
  }
  assert.ok(found.length >= 3, "the landing links three sections to the tour");
});

test("`paying`, `held` et la fenêtre du code ne sont jamais ouverts à l'entrée d'une étape", () => {
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    const s = stateEntering(i);
    assert.equal(s.paying, false, `étape ${i + 1}`);
    assert.equal(s.held, false, `étape ${i + 1}`);
    assert.equal(s.signIn, "closed", `étape ${i + 1}`);
    assert.equal(s.giveOpen, false, `étape ${i + 1}`);
  }
});

test("aucune adresse e-mail dans une URL de la visite, aucun identifiant de démo affiché", () => {
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    for (const s of [stateEntering(i), stateAfter(i)]) assert.doesNotMatch(s.url, /@/, `étape ${i + 1}: ${s.url}`);
  }
  assert.doesNotMatch(JSON.stringify(DEMO_STEPS), /skedul\.test|pro@skedul|password|mot de passe/i);
});

test("le texte de la visite parle de tickets, d'offres, de carnets, de séances et de rendez-vous", () => {
  const text = DEMO_STEPS.map((s) => `${s.title} ${s.description}`).join("\n");
  assert.doesNotMatch(text, /\bpacks?\b|cr[eé]dits?|prestations?/i);
  for (const word of [/tickets?/i, /carnet/i, /séance/i, /rendez-vous/i, /offres?/i]) assert.match(text, word);
});
