import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "../booking/types";
import {
  PUBLIC_REVALIDATE,
  PUBLIC_UNEXPECTED,
  fromEngineClient,
  fromParse,
  publicFail,
  publicOk,
  withoutPublicEffects,
  type PublicCoreResult,
} from "./result";

const V = { businessName: "Altinha Paris" };
const SYNC: Effect = { type: "google.sync_occurrence", occurrenceId: "o1" };
const MAIL: Effect = { type: "email.booking_confirmed", bookingId: "b1" };

test("publicFail and publicOk default to no effects and keep an optional code and field errors", () => {
  assert.deepEqual(publicFail("Impossible."), { ok: false, error: "Impossible.", effects: [] });
  assert.deepEqual(publicFail("Impossible.", { code: "stale" }), { ok: false, error: "Impossible.", code: "stale", effects: [] });
  assert.deepEqual(
    publicFail("Nom : ce champ est obligatoire.", { fieldErrors: { name: "Nom : ce champ est obligatoire." }, effects: [SYNC] }),
    {
      ok: false,
      error: "Nom : ce champ est obligatoire.",
      fieldErrors: { name: "Nom : ce champ est obligatoire." },
      effects: [SYNC],
    },
  );
  assert.equal("code" in publicFail("Impossible."), false);
  assert.equal("fieldErrors" in publicFail("Impossible."), false);

  assert.deepEqual(publicOk({ bookingId: "b1" }), { ok: true, bookingId: "b1", effects: [] });
  assert.deepEqual(publicOk({ bookingId: "b1" }, [MAIL, SYNC]), { ok: true, bookingId: "b1", effects: [MAIL, SYNC] });
  assert.deepEqual(publicOk({}), { ok: true, effects: [] });
  // the data can neither turn the result into a failure nor swap its effects
  const hostile = publicOk({ ok: false, effects: ["x"] } as unknown as { bookingId: string }, [SYNC]);
  assert.equal(hostile.ok, true);
  assert.deepEqual(hostile.effects, [SYNC]);
});

test("fromEngineClient speaks client words, keeps the code, drops it on demand, keeps the effects", () => {
  assert.deepEqual(fromEngineClient({ ok: false, code: "full" }, "buybook", V), {
    ok: false,
    error: "Complet : il ne reste plus de place sur cette séance.",
    code: "full",
    effects: [],
  });
  assert.deepEqual(fromEngineClient({ ok: false, code: "too_late_or_done" }, "cancel", V, [SYNC]), {
    ok: false,
    error: "Seul(e) Altinha Paris peut annuler maintenant.",
    code: "too_late_or_done",
    effects: [SYNC],
  });
  assert.deepEqual(
    fromEngineClient({ ok: false, code: "invalid", message: "Merci de répondre à : Niveau" }, "free", V),
    { ok: false, error: "Merci de répondre à : Niveau", code: "invalid", effects: [] },
  );
  // dropCode removes the code only, the sentence stays: a code whose sentence is neutral shows exactly that
  const dropped = fromEngineClient({ ok: false, code: "throttled" }, "buybook", V, [], { dropCode: true });
  assert.deepEqual(dropped, { ok: false, error: "Trop de demandes. Réessayez dans un moment.", effects: [] });
  assert.equal("code" in dropped, false);
  const keptByDefault = fromEngineClient({ ok: false, code: "throttled" }, "buybook", V, [], {});
  assert.equal(keptByDefault.code, "throttled");
});

test("fromParse keeps the French error and the field errors, with no effect", () => {
  assert.deepEqual(
    fromParse({ ok: false, error: "Email : adresse email invalide.", fieldErrors: { "identity.email": "Email : adresse email invalide." } }),
    {
      ok: false,
      error: "Email : adresse email invalide.",
      fieldErrors: { "identity.email": "Email : adresse email invalide." },
      effects: [],
    },
  );
});

test("withoutPublicEffects drops only the effects, of a success and of a failure", () => {
  const success: PublicCoreResult<{ bookingId: string; purchaseId: string }> = {
    ok: true,
    bookingId: "b1",
    purchaseId: "p1",
    effects: [MAIL, SYNC],
  };
  const out = withoutPublicEffects(success);
  assert.deepEqual(out, { ok: true, bookingId: "b1", purchaseId: "p1" });
  assert.equal("effects" in out, false);
  assert.equal(success.effects.length, 2, "the input is not modified");

  const failure: PublicCoreResult = publicFail("Paiement introuvable : rafraîchissez la page.", { code: "not_found", effects: [SYNC] });
  const failed = withoutPublicEffects(failure);
  assert.deepEqual(failed, { ok: false, error: "Paiement introuvable : rafraîchissez la page.", code: "not_found" });
  assert.equal("effects" in failed, false);
  assert.equal(failure.effects.length, 1, "the input is not modified");

  assert.deepEqual(withoutPublicEffects(publicOk({})), { ok: true });
});

test("PUBLIC_REVALIDATE and PUBLIC_UNEXPECTED are the contract values", () => {
  assert.deepEqual(PUBLIC_REVALIDATE, [{ path: "/[slug]", type: "layout" }, { path: "/mon-espace" }]);
  assert.equal(PUBLIC_UNEXPECTED, "Une erreur inattendue est survenue. Réessayez dans un instant.");
});
