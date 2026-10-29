import assert from "node:assert/strict";
import test from "node:test";

import { proCtx } from "../../test/pro-ctx";
import {
  UNEXPECTED_ERROR,
  actionFail,
  fromEngine,
  impersonationLogLine,
  revalidationTargets,
  withoutEffects,
  type CoreResult,
} from "./result";

test("actionFail omits the code unless one is given", () => {
  assert.deepEqual(actionFail("Impossible."), { ok: false, error: "Impossible." });
  assert.deepEqual(actionFail("Impossible.", "stale"), { ok: false, error: "Impossible.", code: "stale" });
});

test("fromEngine keeps the code and speaks the pro wording of the context", () => {
  assert.deepEqual(fromEngine({ ok: false, code: "full" }, "register"), {
    ok: false,
    error: "Complet : cochez « +1 place » pour l'inscrire quand même.",
    code: "full",
  });
  assert.deepEqual(fromEngine({ ok: false, code: "full" }, "cancel"), {
    ok: false,
    error: "Cette séance est complète.",
    code: "full",
  });
  assert.deepEqual(fromEngine({ ok: false, code: "not_found" }, "cancel"), {
    ok: false,
    error: "Séance introuvable.",
    code: "not_found",
  });
  assert.deepEqual(fromEngine({ ok: false, code: "not_found" }, "catalog"), {
    ok: false,
    error: "Type ou offre introuvable.",
    code: "not_found",
  });
});

test("fromEngine prefers the engine's own message and keeps the codes the UI branches on", () => {
  assert.deepEqual(
    fromEngine({ ok: false, code: "invalid", message: "La nouvelle date serait déjà passée." }, "occurrence"),
    { ok: false, error: "La nouvelle date serait déjà passée.", code: "invalid" },
  );
  assert.deepEqual(fromEngine({ ok: false, code: "ticket_expires_before" }, "move"), {
    ok: false,
    error: "Ticket expiré à la date de cette séance : déplacer quand même ?",
    code: "ticket_expires_before",
  });
});

test("withoutEffects drops only the effects of a success", () => {
  const res: CoreResult<{ eventId: string; occurrenceCount: number }> = {
    ok: true,
    effects: [{ type: "google.sync_occurrence", occurrenceId: "o1" }],
    eventId: "e1",
    occurrenceCount: 3,
  };
  const out = withoutEffects(res);
  assert.deepEqual(out, { ok: true, eventId: "e1", occurrenceCount: 3 });
  assert.equal("effects" in out, false);
  assert.equal(res.ok && res.effects.length, 1, "the input is not modified");
  assert.deepEqual(withoutEffects({ ok: true, effects: [] }), { ok: true });
});

test("withoutEffects returns a failure as it is", () => {
  const failed: CoreResult = { ok: false, error: "Non.", code: "stale" };
  assert.deepEqual(withoutEffects(failed), { ok: false, error: "Non.", code: "stale" });
});

test("UNEXPECTED_ERROR is the French generic message", () => {
  assert.equal(UNEXPECTED_ERROR, "Une erreur inattendue est survenue. Réessayez dans un instant.");
});

test("revalidationTargets: the dashboard layout always, every public page by its route pattern on demand", () => {
  assert.deepEqual(revalidationTargets(false), [{ path: "/dashboard", type: "layout" }]);
  assert.deepEqual(revalidationTargets(true), [
    { path: "/dashboard", type: "layout" },
    { path: "/[slug]", type: "layout" },
  ]);
});

test("proCtx maps a test pro to the context requireProContext builds", () => {
  assert.deepEqual(
    proCtx({ userId: "u1", proId: "p1", slug: "t-abc", tz: "America/Los_Angeles", currency: "eur" }),
    { professionalId: "p1", actorUserId: "u1", timezone: "America/Los_Angeles", currency: "eur", slug: "t-abc" },
  );
});

test("impersonationLogLine: one line with ids only while an admin impersonates, nothing otherwise (SEC-6)", () => {
  const pro = { userId: "user_pro", proId: "pro_1", tz: "Europe/Paris", currency: "eur", slug: "alice" };
  assert.equal(impersonationLogLine("registerAttendee", proCtx(pro)), null);
  assert.equal(impersonationLogLine("registerAttendee", { ...proCtx(pro), impersonatedBy: null }), null);
  const line = impersonationLogLine("registerAttendee", { ...proCtx(pro), impersonatedBy: "user_admin" });
  assert.equal(line, "[pro] registerAttendee by admin user_admin for pro pro_1");
  assert.ok(line !== null && !line.includes("@") && !line.includes("\n"));
});
