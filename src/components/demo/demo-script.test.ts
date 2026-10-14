import test from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLIENT } from "./demo-data";
import {
  DEMO_STEPS,
  INITIAL_STATE,
  demoHref,
  stateAfter,
  stateEntering,
  stepIndex,
} from "./demo-script";

test("12 étapes, la dernière est l'outro", () => {
  assert.equal(DEMO_STEPS.length, 12);
  assert.equal(DEMO_STEPS[11].chapter, "outro");
  assert.equal(stateEntering(11).screen, "outro");
});

test("stateEntering(0) = état initial", () => {
  assert.deepEqual(stateEntering(0), INITIAL_STATE);
});

test("parcours client : payé → pack → crédit", () => {
  assert.equal(stateAfter(3).confirmation, "booking-paid"); // étape 4 (index 3)
  assert.equal(stateAfter(4).confirmation, "pack");
  assert.equal(stateAfter(4).creditsRemaining, 10);
  assert.equal(stateAfter(4).hasCredits, true);
  assert.equal(stateAfter(5).confirmation, "booking-credit");
  assert.equal(stateAfter(5).creditsRemaining, 9);
});

test("étape 6 : email reconnu dès l'entrée (bannière crédits visible)", () => {
  const s = stateEntering(5);
  assert.equal(s.formEmail, DEMO_CLIENT.email);
  assert.equal(s.hasCredits, true);
});

test("côté pro : chaque étape démarre sur le bon écran", () => {
  assert.equal(stateEntering(6).screen, "pro-planning");
  assert.equal(stateAfter(6).planningHasLea, true);
  assert.equal(stateAfter(7).eventTypeFormOpen, true);
  assert.equal(stateAfter(8).packFormOpen, true);
  assert.equal(stateAfter(9).saturdayEnabled, true);
  assert.equal(stateAfter(10).brandColor, "#0d9488");
  assert.equal(stateAfter(10).headerLayout, "vitrine");
});

test("lien profond : ?step= ouvre la bonne étape, sinon la première", () => {
  assert.equal(demoHref(), "/demo");
  assert.equal(demoHref("packs"), "/demo?step=packs");
  assert.equal(stepIndex("planning"), 6);
  assert.equal(stepIndex("buy-pack"), 4);
  assert.equal(stepIndex(undefined), 0);
  assert.equal(stepIndex("inconnue"), 0);
  assert.equal(stepIndex(["packs", "planning"]), 0);
});

test("`paying` n'est jamais vrai à l'entrée d'une étape", () => {
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    assert.equal(stateEntering(i).paying, false, `étape ${i + 1}`);
  }
});
