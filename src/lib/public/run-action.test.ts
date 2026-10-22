import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "@/lib/booking/types";
import { COPY } from "@/lib/public/messages";
import { PUBLIC_UNEXPECTED, publicFail, publicOk } from "@/lib/public/result";
import { actionVisitorOf, sessionOf } from "@/test/public";

import type { PublicPro } from "./context";
import {
  publicImpersonationLogLine,
  runClientActionWith,
  runPublicActionWith,
  type RunClientDeps,
  type RunPublicDeps,
} from "./run-action";

const PRO: PublicPro = {
  professionalId: "pro_1",
  slug: "altinha-paris",
  businessName: "Altinha Paris",
  timezone: "Europe/Paris",
  currency: "eur",
  ownerUserId: "owner_1",
  window: { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 },
};
const NOW = new Date("2026-10-21T10:00:00.000Z");
const SYNC: Effect = { type: "google.sync_occurrence", occurrenceId: "occ_1" };
const MAIL: Effect = { type: "email.booking_confirmed", bookingId: "b1" };

/** Stands for the errors Next throws for redirect() and notFound(): the wrapper must let them through. */
class ControlFlow extends Error {}

type Spy = {
  /** schedule, info and revalidate, in call order */
  events: string[];
  scheduled: Effect[][];
  logs: string[];
  infos: string[];
  resolved: string[];
  visitorNows: Date[];
  nowCalls: number;
};

function harness(over: Partial<RunPublicDeps> = {}) {
  const spy: Spy = { events: [], scheduled: [], logs: [], infos: [], resolved: [], visitorNows: [], nowCalls: 0 };
  const shared = {
    schedule: (effects: Effect[]) => {
      spy.events.push("schedule");
      spy.scheduled.push(effects);
    },
    revalidate: () => {
      spy.events.push("revalidate");
    },
    log: (line: string) => {
      spy.logs.push(line);
    },
    info: (line: string) => {
      spy.events.push("info");
      spy.infos.push(line);
    },
    rethrowIfControlFlow: (err: unknown) => {
      if (err instanceof ControlFlow) throw err;
    },
    now: () => {
      spy.nowCalls += 1;
      return NOW;
    },
  };
  const deps: RunPublicDeps = {
    ...shared,
    resolvePro: async (slug) => {
      spy.resolved.push(slug);
      return slug === PRO.slug ? PRO : null;
    },
    visitor: async (_pro, now) => {
      spy.visitorNows.push(now);
      return actionVisitorOf();
    },
    ...over,
  };
  const client: RunClientDeps = { ...shared, session: async () => null };
  return { deps, client, spy };
}

const NAME = "startBuyAndBookAction";

test("S45: a slug that is not a string matching SLUG_PARAM_RE answers PAGE_GONE without any read and without calling fn", async () => {
  for (const slug of ["../x", "A", "a".repeat(61), "", "a b", undefined, null, 42, {}, ["altinha-paris"]]) {
    const { deps, spy } = harness();
    let called = false;
    const res = await runPublicActionWith(deps, NAME, slug, async () => {
      called = true;
      return publicOk({});
    });
    assert.deepEqual(res, { ok: false, error: COPY.PAGE_GONE }, JSON.stringify(slug));
    assert.equal(called, false);
    assert.deepEqual(spy.resolved, [], "garbage never reaches the database");
    assert.deepEqual(spy.events, []);
  }
});

test("S45: an unknown or suspended pro (resolvePro null) answers PAGE_GONE: no visitor is built, fn is not called", async () => {
  const { deps, spy } = harness();
  let called = false;
  const res = await runPublicActionWith(deps, NAME, "inconnu-ou-suspendu", async () => {
    called = true;
    return publicOk({});
  });
  assert.deepEqual(res, { ok: false, error: COPY.PAGE_GONE });
  assert.deepEqual(spy.resolved, ["inconnu-ou-suspendu"]);
  assert.equal(called, false);
  assert.deepEqual(spy.visitorNows, []);
  assert.deepEqual(spy.logs, []);
});

test("S45: a success revalidates once, schedules its effects, and hands the browser the result without them", async () => {
  const { deps, spy } = harness();
  const res = await runPublicActionWith<{ bookingId: string }>(deps, NAME, "altinha-paris", async () =>
    publicOk({ bookingId: "b1" }, [MAIL, SYNC]),
  );
  assert.deepEqual(res, { ok: true, bookingId: "b1" });
  assert.equal("effects" in res, false);
  assert.deepEqual(spy.scheduled, [[MAIL, SYNC]]);
  assert.deepEqual(spy.events, ["schedule", "revalidate"]);
  assert.deepEqual(spy.logs, []);
});

test("S45: a success without effects schedules nothing but still revalidates", async () => {
  const { deps, spy } = harness();
  const res = await runPublicActionWith(deps, NAME, "altinha-paris", async () => publicOk({}));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(spy.scheduled, []);
  assert.deepEqual(spy.events, ["revalidate"]);
});

test("S45: a failure is returned as it is without revalidation, but its effects still run (a refusal that released a seat)", async () => {
  const { deps, spy } = harness();
  const res = await runPublicActionWith(deps, NAME, "altinha-paris", async () =>
    publicFail("Complet : il ne reste plus de place sur cette séance.", { code: "full", effects: [SYNC] }),
  );
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.error, "Complet : il ne reste plus de place sur cette séance.");
  assert.equal(!res.ok && res.code, "full");
  assert.equal("effects" in res, false);
  assert.deepEqual(spy.scheduled, [[SYNC]]);
  assert.deepEqual(spy.events, ["schedule"], "scheduled, not revalidated");

  const plain = harness();
  const refused = await runPublicActionWith(plain.deps, NAME, "altinha-paris", async () => publicFail("Non."));
  assert.equal(refused.ok, false);
  assert.deepEqual(plain.spy.events, [], "a refusal without effects does nothing else");
});

test("S45, S31: a throw is logged without an address, a link token or a session id, and the browser gets PUBLIC_UNEXPECTED", async () => {
  const { deps, spy } = harness();
  const res = await runPublicActionWith(deps, NAME, "altinha-paris", async () => {
    throw new Error("boom for beatriz@example.com at /api/c/abc.def.ghi with cs_test_a1B2");
  });
  assert.deepEqual(res, { ok: false, error: PUBLIC_UNEXPECTED });
  assert.deepEqual(spy.logs, ["[public] startBuyAndBookAction failed: boom for [email] at /api/c/[token] with [session]"]);
  for (const line of spy.logs) assert.equal(line.includes("@"), false);
  assert.deepEqual(spy.events, [], "nothing scheduled, nothing revalidated");
});

test("S45: a failing resolvePro or visitor is an unexpected error too, not a crash", async () => {
  const resolveFails = harness({
    resolvePro: async () => {
      throw new Error("db down");
    },
  });
  assert.deepEqual(await runPublicActionWith(resolveFails.deps, NAME, "altinha-paris", async () => publicOk({})), {
    ok: false,
    error: PUBLIC_UNEXPECTED,
  });
  assert.deepEqual(resolveFails.spy.logs, ["[public] startBuyAndBookAction failed: db down"]);

  const visitorFails = harness({
    visitor: async () => {
      throw new Error("session read failed");
    },
  });
  assert.deepEqual(await runPublicActionWith(visitorFails.deps, NAME, "altinha-paris", async () => publicOk({})), {
    ok: false,
    error: PUBLIC_UNEXPECTED,
  });
});

test("S45: a Next control-flow error (redirect, notFound) is rethrown, not logged and not turned into a result", async () => {
  const { deps, client, spy } = harness();
  await assert.rejects(
    runPublicActionWith(deps, NAME, "altinha-paris", async () => {
      throw new ControlFlow("NEXT_REDIRECT");
    }),
    ControlFlow,
  );
  await assert.rejects(
    runClientActionWith(client, "updateMyNameAction", async () => {
      throw new ControlFlow("NEXT_NOT_FOUND");
    }),
    ControlFlow,
  );
  assert.deepEqual(spy.logs, []);
  assert.deepEqual(spy.events, []);
});

test("S45: ONE now for the visitor and for fn, read once", async () => {
  const { deps, spy } = harness();
  let seen: Date | null = null;
  await runPublicActionWith(deps, NAME, "altinha-paris", async (_pro, _visitor, now) => {
    seen = now;
    return publicOk({});
  });
  assert.equal(spy.nowCalls, 1);
  assert.equal(spy.visitorNows.length, 1);
  assert.equal(spy.visitorNows[0], seen, "the visitor and fn got the very same instant");
  assert.equal(seen, NOW);
});

test("fn receives the pro resolved from the slug and the visitor built on the server", async () => {
  const visitor = actionVisitorOf({ guestCustomerId: "cus_9" });
  const { deps } = harness({ visitor: async () => visitor });
  let got: unknown[] = [];
  await runPublicActionWith(deps, NAME, "altinha-paris", async (pro, v) => {
    got = [pro, v];
    return publicOk({});
  });
  assert.equal(got[0], PRO);
  assert.equal(got[1], visitor);
});

test("S51: a successful action of an impersonated session leaves one ids-only trace line, before the revalidation; a refusal and a plain session leave none", async () => {
  const impersonated = actionVisitorOf({
    session: sessionOf({ userId: "owner_1", email: "pro@example.com", name: "Pro" }, { impersonated: true }),
  });
  const { deps, spy } = harness({ visitor: async () => impersonated });
  await runPublicActionWith(deps, "registerFreeAction", "altinha-paris", async () => publicOk({}, [MAIL]));
  assert.deepEqual(spy.infos, ["[public] registerFreeAction by admin admin-test for pro pro_1"]);
  assert.deepEqual(spy.events, ["schedule", "info", "revalidate"]);
  for (const line of spy.infos) assert.equal(line.includes("@"), false);

  const refused = harness({ visitor: async () => impersonated });
  await runPublicActionWith(refused.deps, "registerFreeAction", "altinha-paris", async () => publicFail("Non."));
  assert.deepEqual(refused.spy.infos, [], "no « done » line for a refusal");

  const plain = harness({ visitor: async () => actionVisitorOf({ session: sessionOf({ userId: "u1", email: "a@example.com" }) }) });
  await runPublicActionWith(plain.deps, "registerFreeAction", "altinha-paris", async () => publicOk({}));
  assert.deepEqual(plain.spy.infos, []);

  const anonymous = harness();
  await runPublicActionWith(anonymous.deps, "registerFreeAction", "altinha-paris", async () => publicOk({}));
  assert.deepEqual(anonymous.spy.infos, []);
});

test("publicImpersonationLogLine: ids only, null unless an admin impersonates", () => {
  const user = { userId: "owner_1", email: "pro@example.com" };
  assert.equal(publicImpersonationLogLine("x", null, "pro_1"), null);
  assert.equal(publicImpersonationLogLine("x", sessionOf(user), "pro_1"), null);
  assert.equal(publicImpersonationLogLine("x", sessionOf(user, { verified: false }), "pro_1"), null);
  assert.equal(
    publicImpersonationLogLine("cancelMyBookingAction", sessionOf(user, { impersonated: true }), "pro_1"),
    "[public] cancelMyBookingAction by admin admin-test for pro pro_1",
  );
});

test("S45: a scheduler or revalidation that throws after the commit never turns a committed success into an error", async () => {
  const { deps, spy } = harness({
    schedule: () => {
      throw new Error("scheduler down for beatriz@example.com");
    },
  });
  const res = await runPublicActionWith(deps, NAME, "altinha-paris", async () => publicOk({ bookingId: "b1" }, [MAIL]));
  assert.deepEqual(res, { ok: true, bookingId: "b1" });
  assert.deepEqual(spy.logs, ["[public] startBuyAndBookAction schedule failed: scheduler down for [email]"]);
  assert.deepEqual(spy.events, ["revalidate"], "the revalidation still runs");

  const revalidating = harness({
    revalidate: () => {
      throw new Error("no store");
    },
  });
  const ok = await runPublicActionWith(revalidating.deps, NAME, "altinha-paris", async () => publicOk({}));
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(revalidating.spy.logs, ["[public] startBuyAndBookAction revalidate failed: no store"]);
});

/* ───────────────────────────── runClientActionWith ───────────────────────────── */

test("runClientActionWith: fn receives the fresh session facts and ONE now; a success revalidates and schedules; the result has no effects", async () => {
  const facts = sessionOf({ userId: "u1", email: "beatriz@example.com", name: "Beatriz" });
  const { client, spy } = harness();
  let got: unknown[] = [];
  const res = await runClientActionWith<{ saved: boolean }>({ ...client, session: async () => facts }, "updateMyNameAction", async (session, now) => {
    got = [session, now];
    return publicOk({ saved: true }, [SYNC]);
  });
  assert.deepEqual(res, { ok: true, saved: true });
  assert.equal(got[0], facts);
  assert.equal(got[1], NOW);
  assert.equal(spy.nowCalls, 1);
  assert.deepEqual(spy.events, ["schedule", "revalidate"]);
});

test("runClientActionWith: signed out gives a null session; a failure schedules its effects without revalidating; a throw is unexpected and logged without an address", async () => {
  const { client, spy } = harness();
  let seen: unknown = "unset";
  await runClientActionWith(client, "revokeMyLinksAction", async (session) => {
    seen = session;
    return publicFail("Connectez-vous avec une adresse confirmée pour modifier votre compte.", { effects: [SYNC] });
  });
  assert.equal(seen, null);
  assert.deepEqual(spy.events, ["schedule"]);

  const thrown = harness();
  const res = await runClientActionWith(thrown.client, "cancelMyBookingAction", async () => {
    throw new Error("failure for beatriz@example.com");
  });
  assert.deepEqual(res, { ok: false, error: PUBLIC_UNEXPECTED });
  assert.deepEqual(thrown.spy.logs, ["[public] cancelMyBookingAction failed: failure for [email]"]);

  const sessionFails = harness();
  const unexpected = await runClientActionWith(
    { ...sessionFails.client, session: async () => { throw new Error("db down"); } },
    "cancelMyBookingAction",
    async () => publicOk({}),
  );
  assert.deepEqual(unexpected, { ok: false, error: PUBLIC_UNEXPECTED });
});

test("runClientActionWith: no trace line even for an impersonated session (every /mon-espace core refuses it before any write)", async () => {
  const facts = sessionOf({ userId: "owner_1", email: "pro@example.com" }, { impersonated: true });
  const { client, spy } = harness();
  await runClientActionWith({ ...client, session: async () => facts }, "updateMyNameAction", async () => publicOk({}));
  assert.deepEqual(spy.infos, []);
  assert.deepEqual(spy.events, ["revalidate"]);
});
