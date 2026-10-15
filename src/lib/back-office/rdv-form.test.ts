import assert from "node:assert/strict";
import test from "node:test";

import { RDV_FREE_HAS_SALES } from "./catalog-actions";
import { NOTICE_TOO_LONG } from "./notice";
import { canBecomeFree, isFreeSalesRefusal, rdvErrorField, rdvFormFromType, rdvPatchFromForm, type RdvFormValues } from "./rdv-form";

const NO_OVERRIDES = { bookingHorizonDays: null, minNoticeMinutes: null, cancelDeadlineHours: null };

const type = {
  rdvEnabled: true,
  rdvFree: false,
  rdvDurationMin: 60,
  rdvBufferBeforeMin: 0,
  rdvBufferAfterMin: 10,
  rdvOverrides: NO_OVERRIDES,
};

test("rdvFormFromType: stored values as typed strings, 60 minutes when the type has no duration yet", () => {
  assert.deepEqual(rdvFormFromType(type), {
    enabled: true,
    free: false,
    duration: "60",
    before: "0",
    after: "10",
    overrides: NO_OVERRIDES,
  });
  assert.equal(rdvFormFromType({ ...type, rdvEnabled: false, rdvDurationMin: null }).duration, "60");
});

test("rdvPatchFromForm: RDV off sends rdvFree false and no duration, and touches nothing else", () => {
  const off: RdvFormValues = { ...rdvFormFromType(type), enabled: false, free: true };
  assert.deepEqual(rdvPatchFromForm(off), { ok: true, patch: { rdvEnabled: false, rdvFree: false, rdvDurationMin: null } });
});

test("rdvPatchFromForm: RDV on sends every RDV field", () => {
  const overrides = { bookingHorizonDays: 30, minNoticeMinutes: 120, cancelDeadlineHours: null };
  const on: RdvFormValues = { enabled: true, free: true, duration: " 15 ", before: "5", after: "10", overrides };
  assert.deepEqual(rdvPatchFromForm(on), {
    ok: true,
    patch: {
      rdvEnabled: true,
      rdvFree: true,
      rdvDurationMin: 15,
      rdvBufferBeforeMin: 5,
      rdvBufferAfterMin: 10,
      rdvOverrides: overrides,
    },
  });
});

test("rdvPatchFromForm: whole numbers only, the bounds are the server's", () => {
  const base = rdvFormFromType(type);
  assert.deepEqual(rdvPatchFromForm({ ...base, duration: "" }), {
    ok: false,
    field: "duration",
    error: "Durée du rendez-vous : indiquez un nombre entier.",
  });
  assert.deepEqual(rdvPatchFromForm({ ...base, before: "1.5" }), {
    ok: false,
    field: "before",
    error: "Marge avant : indiquez un nombre entier.",
  });
  assert.deepEqual(rdvPatchFromForm({ ...base, after: "-5" }), {
    ok: false,
    field: "after",
    error: "Marge après : indiquez un nombre entier.",
  });
  assert.equal(rdvPatchFromForm({ ...base, duration: "7" }).ok, true, "7 goes through to the server's « multiple de 5 »");
  assert.equal(rdvPatchFromForm({ ...base, enabled: false, duration: "" }).ok, true, "a hidden field is not checked");
});

test("rdvErrorField: the field a French server message belongs to", () => {
  assert.equal(rdvErrorField("Durée du rendez-vous : minimum 5."), "duration");
  assert.equal(rdvErrorField("Durée du rendez-vous : choisissez un multiple de 5."), "duration");
  assert.equal(rdvErrorField("Marge avant : maximum 240."), "before");
  assert.equal(rdvErrorField("Marge après : maximum 240."), "after");
  assert.equal(rdvErrorField("Le délai minimum dépasse l'horizon de réservation : réduisez-le ou allongez l'horizon."), null);
  assert.equal(
    rdvErrorField("Ce type a des offres en vente, un paiement en cours ou des tickets valides : il ne peut pas devenir gratuit."),
    null,
  );
});

test("canBecomeFree: no offer en vente and no usable ticket", () => {
  assert.equal(canBecomeFree({ offers: [], usableTickets: 0 }), true);
  assert.equal(canBecomeFree({ offers: [{ isActive: false }], usableTickets: 0 }), true, "an offer taken off sale");
  assert.equal(canBecomeFree({ offers: [{ isActive: false }, { isActive: true }], usableTickets: 0 }), false);
  assert.equal(canBecomeFree({ offers: [], usableTickets: 2 }), false);
});

test("isFreeSalesRefusal: recognises the server's refusal of « Gratuit » (its real text), and nothing else", () => {
  assert.equal(isFreeSalesRefusal(RDV_FREE_HAS_SALES), true, "the wording moved: update isFreeSalesRefusal");
  assert.equal(isFreeSalesRefusal(NOTICE_TOO_LONG), false);
  assert.equal(isFreeSalesRefusal("Durée du rendez-vous : minimum 5."), false);
  assert.equal(isFreeSalesRefusal("Un rendez-vous gratuit ne se vend pas : cette offre doit rester hors vente."), false);
});

test("rdv form copy carries no em dash or en dash", () => {
  const base = rdvFormFromType(type);
  const texts = [{ ...base, duration: "" }, { ...base, before: "x" }, { ...base, after: "x" }]
    .map((f) => rdvPatchFromForm(f))
    .map((r) => (r.ok ? "" : r.error));
  assert.equal(texts.filter((t) => t !== "").length, 3);
  assert.equal(/[\u2013\u2014]/.test(texts.join(" ")), false);
});
