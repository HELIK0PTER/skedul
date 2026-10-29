/**
 * The rules of the two pro wrappers (P6 A28), run with fakes: src/server/pro-context.ts passes the real context read,
 * after(), revalidatePath, console and unstable_rethrow.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "@/lib/booking/types";

import { UNEXPECTED_ERROR, withoutEffects, type CoreResult, type ProCtx } from "./result";
import { runProActionWith, runProQueryWith, type RunProDeps } from "./run-pro-action";

const NOW = new Date("2026-10-29T10:00:00Z");
const CTX: ProCtx = { professionalId: "pro_1", actorUserId: "user_1", timezone: "Europe/Paris", currency: "eur", slug: "altinha-paris", impersonatedBy: null };
const EFFECT = { kind: "mail" } as unknown as Effect;

class Redirect extends Error {}

function fakes(context: () => Promise<ProCtx> = async () => CTX) {
  const seen = { log: [] as string[], info: [] as string[], revalidated: [] as string[], scheduled: [] as Effect[][], nows: 0 };
  const deps: RunProDeps = {
    context,
    schedule: (effects) => void seen.scheduled.push(effects),
    revalidate: (target) => void seen.revalidated.push(`${target.path}:${target.type}`),
    log: (line) => void seen.log.push(line),
    info: (line) => void seen.info.push(line),
    rethrowIfControlFlow: (err) => {
      if (err instanceof Redirect) throw err;
    },
    now: () => {
      seen.nows++;
      return NOW;
    },
  };
  return { deps, seen };
}

test("a context that cannot be read (a database or auth outage) answers UNEXPECTED_ERROR, logged without an address, and runs nothing (P6 A28)", async () => {
  for (const run of [
    (deps: RunProDeps, fn: () => Promise<CoreResult>) => runProActionWith(deps, "saveThing", fn),
    (deps: RunProDeps, fn: () => Promise<CoreResult>) => runProQueryWith(deps, "saveThing", async () => withoutEffects(await fn())),
  ]) {
    const { deps, seen } = fakes(async () => {
      throw new Error("fetch failed for lea@example.com");
    });
    let called = false;
    const res = await run(deps, async () => {
      called = true;
      return { ok: true, effects: [] };
    });
    assert.deepEqual(res, { ok: false, error: UNEXPECTED_ERROR });
    assert.equal(called, false, "the core never runs without its context");
    assert.deepEqual(seen.log, ["[pro] saveThing failed: fetch failed for [email]"]);
    assert.deepEqual(seen.revalidated, []);
    assert.deepEqual(seen.scheduled, []);
  }
});

test("the redirect of no session or no pro page still reaches Next: a control-flow error is rethrown, not answered", async () => {
  const redirect = new Redirect("NEXT_REDIRECT");
  const { deps, seen } = fakes(async () => {
    throw redirect;
  });
  await assert.rejects(runProActionWith(deps, "saveThing", async () => ({ ok: true, effects: [] })), (err) => err === redirect);
  await assert.rejects(runProQueryWith(deps, "readThing", async () => ({ ok: true })), (err) => err === redirect);
  assert.deepEqual(seen.log, [], "nothing logged for a redirect");
});

test("a core that throws answers UNEXPECTED_ERROR with its scrubbed message; a refusal is returned as it is, with nothing after it", async () => {
  const thrown = fakes();
  const res = await runProActionWith(thrown.deps, "saveThing", async () => {
    throw new Error("Failed query: update x\nparams: Marie,0612345678");
  });
  assert.deepEqual(res, { ok: false, error: UNEXPECTED_ERROR });
  assert.deepEqual(thrown.seen.log, ["[pro] saveThing failed: Failed query: update x"]);

  const refused = fakes(async () => ({ ...CTX, impersonatedBy: "admin_1" }));
  const fail = { ok: false as const, error: "Refusé.", code: "full" as const };
  assert.deepEqual(await runProActionWith(refused.deps, "saveThing", async () => fail), fail);
  assert.deepEqual(refused.seen.info, [], "no « done » line for a refusal");
  assert.deepEqual(refused.seen.revalidated, []);
  assert.deepEqual(refused.seen.scheduled, []);
});

test("a success: ONE now for the core, the impersonation line, the revalidation of the layouts, the effects after, the result without them", async () => {
  const { deps, seen } = fakes(async () => ({ ...CTX, impersonatedBy: "admin_1" }));
  let at: Date | null = null;
  let given: ProCtx | null = null;
  const res = await runProActionWith(
    deps,
    "saveThing",
    async (ctx, now) => {
      given = ctx;
      at = now;
      return { ok: true, effects: [EFFECT], id: "x_1" };
    },
    { publicPage: true },
  );
  assert.deepEqual(res, { ok: true, id: "x_1" });
  assert.equal(at, NOW);
  assert.equal(seen.nows, 1);
  assert.deepEqual(given, { ...CTX, impersonatedBy: "admin_1" });
  assert.deepEqual(seen.info, ["[pro] saveThing by admin admin_1 for pro pro_1"]);
  assert.deepEqual(seen.revalidated, ["/dashboard:layout", "/[slug]:layout"]);
  assert.deepEqual(seen.scheduled, [[EFFECT]]);

  const plain = fakes();
  assert.deepEqual(await runProActionWith(plain.deps, "saveThing", async () => ({ ok: true, effects: [] })), { ok: true });
  assert.deepEqual(plain.seen.info, [], "no admin, no line");
  assert.deepEqual(plain.seen.revalidated, ["/dashboard:layout"], "the dashboard only without publicPage");
  assert.deepEqual(plain.seen.scheduled, [], "no effect, nothing scheduled");
});

test("runProQueryWith: the read's own answer, no revalidation and no effect", async () => {
  const { deps, seen } = fakes();
  assert.deepEqual(await runProQueryWith(deps, "readThing", async (ctx, now) => ({ ok: true, slug: ctx.slug, at: now.toISOString() })), {
    ok: true,
    slug: "altinha-paris",
    at: NOW.toISOString(),
  });
  assert.deepEqual(seen.revalidated, []);
  assert.deepEqual(seen.scheduled, []);
});
