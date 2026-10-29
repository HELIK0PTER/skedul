/**
 * The tested core of `safeRead` (P4 final review RND-1): a read that fails during a render throws an error that carries
 * the scrubbed message only, so the framework's own log line of that error (Next.js logs what a page throws) holds no
 * query parameter, e-mail or token. Pure: no database, no env.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { notFound } from "next/dist/client/components/not-found";
import { redirect } from "next/dist/client/components/redirect";
import { unstable_rethrow } from "next/dist/client/components/unstable-rethrow.server";

import { safeReadWith } from "./safe-read";

/** What Drizzle throws when a query fails (`DrizzleQueryError`): the SQL, then its parameters, and the driver error as cause. */
function drizzleFailure(): Error {
  return Object.assign(new Error("Failed query: select ... where email = $1\nparams: alice@example.com,tok_123"), {
    cause: new Error("fetch failed"),
  });
}

/** The rethrow Next's `unstable_rethrow` stands for: it throws the error it is handed when it is control flow. */
function rethrowMarked(marker: Error) {
  return (err: unknown) => {
    if (err === marker) throw err;
  };
}

/** Runs the read, expects it to reject, returns what it rejected with. */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  assert.fail("the read did not reject");
}

test("a read that succeeds answers its value, and the rethrow is never consulted", async () => {
  let consulted = false;
  const value = await safeReadWith(async () => ({ rows: 2 }), () => {
    consulted = true;
  });
  assert.deepEqual(value, { rows: 2 });
  assert.equal(consulted, false);
});

test("a control-flow error (notFound, redirect, a dynamic-usage bailout) passes through unchanged: the injected rethrow throws it first", async () => {
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  const seen: unknown[] = [];
  const rethrow = (err: unknown) => {
    seen.push(err);
    rethrowMarked(notFound)(err);
  };
  const thrown = await rejectionOf(() => safeReadWith(async () => { throw notFound; }, rethrow));
  assert.equal(thrown, notFound, "the very same object, so Next still recognises it");
  assert.deepEqual(seen, [notFound], "the rethrow is asked first, with the raw error");
});

test("with Next's own unstable_rethrow (what src/server/safe-read.ts binds), notFound, redirect and the dynamic-usage bailout pass through as they are", async () => {
  /** The error a Next helper throws. */
  const thrownBy = (call: () => never): unknown => {
    try {
      call();
    } catch (err) {
      return err;
    }
  };
  const controlFlow: [string, unknown][] = [
    // What headers() / cookies() throw while a page is being prerendered: the build must still mark the route dynamic.
    ["dynamic usage", new DynamicServerError("Route /mon-espace couldn't be rendered statically because it used `headers`.")],
    ["notFound", thrownBy(() => notFound())],
    ["redirect", thrownBy(() => redirect("/altinha-paris/espace"))],
  ];
  for (const [name, err] of controlFlow) {
    assert.ok(err instanceof Error, name);
    const thrown = await rejectionOf(() => safeReadWith(async () => { throw err; }, unstable_rethrow));
    assert.equal(thrown, err, `${name}: the very same object reaches Next`);
  }
  // A control-flow error carried as the cause of another (a library wrapping it) is what unstable_rethrow throws.
  const bailout = new DynamicServerError("cookies");
  const carried = await rejectionOf(() => safeReadWith(async () => { throw new Error("wrapped", { cause: bailout }); }, unstable_rethrow));
  assert.equal(carried, bailout);
  // And a failed query is still scrubbed with the real rethrow bound.
  const scrubbed = await rejectionOf(() => safeReadWith(async () => { throw drizzleFailure(); }, unstable_rethrow));
  assert.equal((scrubbed as Error).message, "[read] Failed query: select ... where email = $1");
});

test("a failed query comes out without its parameters, its addresses, its tokens, its cause or its stack", async () => {
  const raw = drizzleFailure();
  const thrown = await rejectionOf(() => safeReadWith(async () => { throw raw; }, () => {}));
  assert.ok(thrown instanceof Error);
  assert.notEqual(thrown, raw);
  assert.equal(thrown.message, "[read] Failed query: select ... where email = $1");
  assert.equal(thrown.cause, undefined, "no cause: Node prints a cause with its own stack and message");
  assert.equal("cause" in thrown, false);
  const printed = [thrown.message, thrown.stack ?? "", String(thrown), JSON.stringify(Object.entries(thrown))].join("\n");
  for (const secret of ["alice", "example.com", "params", "tok_123", "fetch failed"]) {
    assert.ok(!printed.includes(secret), `« ${secret} » does not reach the error`);
  }
  assert.ok((thrown.stack ?? "").startsWith("Error: [read] Failed query"), "a stack of its own, nothing copied from the raw one");
});

test("an error that is not an Error still gives a safe one, and a nested read does not stack its prefix", async () => {
  const fromString = await rejectionOf(() => safeReadWith(async () => { throw "marie@example.com"; }, () => {}));
  assert.ok(fromString instanceof Error);
  assert.equal(fromString.message, "[read] unknown error");
  // A wrapped read inside another (resolvePublicPro reads getPublicPage): the inner safe error goes through as it is.
  const inner = await rejectionOf(() => safeReadWith(async () => { throw drizzleFailure(); }, () => {}));
  const outer = await rejectionOf(() => safeReadWith(async () => { throw inner; }, () => {}));
  assert.equal(outer, inner);
  assert.equal((outer as Error).message, "[read] Failed query: select ... where email = $1");
});

test("an e-mail in the head of the message is masked too", async () => {
  const thrown = await rejectionOf(() => safeReadWith(async () => { throw new Error("no row for bob@example.com"); }, () => {}));
  assert.equal((thrown as Error).message, "[read] no row for [email]");
});
