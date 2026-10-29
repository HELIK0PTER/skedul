/**
 * The last layer of P4 final review RND-1 (contract § 1 « URLs and logs »): every `console.error` / `console.warn` of
 * the Node server goes through `scrubLogArgs`, installed once by `src/instrumentation.ts`, so a framework or library
 * log line (Next.js logging what a page, a Server Action or a route handler threw; a driver warning) never prints the
 * parameters of a failed query, an e-mail address or a token. Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspect } from "node:util";

import { error as nextLogError } from "next/dist/build/output/log";

import { codeView } from "@/test/source-guards";

import { installLogScrub, scrubLogArgs } from "./log-scrub";

const SECRETS = ["alice", "example.com", "params", "tok_123"] as const;

/** What Drizzle throws when a query fails (`DrizzleQueryError` keeps `query` and `params` as own fields too), with the digest Next gives it. */
function drizzleFailure(): Error {
  const err = Object.assign(new Error("Failed query: select ... where email = $1\nparams: alice@example.com,tok_123"), {
    query: "select ... where email = $1",
    params: ["alice@example.com", "tok_123"],
    cause: new Error("fetch failed"),
    digest: "2214895773",
  });
  err.name = "DrizzleQueryError";
  return err;
}

/** What the console would print for these arguments (Node formats an Error with its stack, its own fields and its cause). */
const printed = (args: readonly unknown[]): string => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 6 }))).join(" ");

function assertClean(text: string): void {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `« ${secret} » is not printed: ${text}`);
}

test("a failed query handed to the console becomes an error with the safe message, the same name and the same digest", () => {
  const raw = drizzleFailure();
  assert.ok(SECRETS.every((secret) => printed([raw]).includes(secret)), "the raw error would print every secret");
  const [out] = scrubLogArgs([raw]);
  assert.ok(out instanceof Error);
  assert.notEqual(out, raw);
  assert.equal(out.message, "Failed query: select ... where email = $1");
  assert.equal(out.name, "DrizzleQueryError");
  assert.equal((out as Error & { digest?: string }).digest, "2214895773", "the digest still pairs the log line with the error page");
  assert.equal(out.cause, undefined);
  assertClean(printed([out]));
  assert.ok(printed([out]).includes("Failed query: select"), "the SQL head stays for the operator");
});

test("the stack of that error, logged as a string, loses its params tail; an address in a string is masked", () => {
  const raw = drizzleFailure();
  const [stack] = scrubLogArgs([raw.stack]);
  assert.equal(typeof stack, "string");
  assert.ok((stack as string).startsWith("DrizzleQueryError: Failed query: select ... where email = $1"));
  assertClean(stack as string);
  assert.deepEqual(scrubLogArgs(["sent to bob@example.com", "GET /api/c/abc.1.def_ghi", "cs_test_a1B2c3 expired"]), [
    "sent to [email]",
    "GET /api/c/[token]",
    "[session] expired",
  ]);
});

test("an error is replaced when the secret sits in its cause or in one of its own fields, not only in its message", () => {
  const wrapped = new Error("render failed", { cause: drizzleFailure() });
  const [fromCause] = scrubLogArgs([wrapped]);
  assert.notEqual(fromCause, wrapped);
  assert.equal((fromCause as Error).message, "render failed");
  assertClean(printed([fromCause]));
  const unique = Object.assign(new Error('duplicate key value violates unique constraint "customer_email"'), {
    detail: "Key (email)=(alice@example.com) already exists.",
  });
  const [fromField] = scrubLogArgs([unique]);
  assert.notEqual(fromField, unique);
  assertClean(printed([fromField]));
});

test("everything else is handed over untouched: the same objects, the same strings", () => {
  const plain = new Error("ECONNRESET");
  const object = { route: "/x" };
  const args = ["⨯", plain, object, 42, null, undefined, "no secret here"];
  const out = scrubLogArgs(args);
  assert.equal(out.length, args.length);
  args.forEach((arg, i) => assert.equal(out[i], arg, `argument ${i} is the same value`));
  // A package path of a pnpm layout (`next@16.2.9_react@19.2.0`) in a frame is not an address: the error keeps its stack.
  const frame = "    at render (/var/task/node_modules/.pnpm/next@16.2.9_react-dom@19.2.0_react@19.2.0/node_modules/next/dist/server/base-server.js:1:2)";
  const framed = new Error("ECONNRESET");
  framed.stack = `Error: ECONNRESET\n${frame}`;
  assert.equal(scrubLogArgs([framed])[0], framed);
  assert.equal(scrubLogArgs([frame])[0], frame);
});

test("Next's own error log (Log.error, the path of logError and onRequestError) reaches the wrapped console and prints no secret", () => {
  const seen: unknown[][] = [];
  const target = { error: (...args: unknown[]) => void seen.push(args), warn: (...args: unknown[]) => void seen.push(args) };
  assert.equal(installLogScrub(target), true);
  const { error, warn } = console;
  // Log.error looks `console.error` up when it logs, so a wrap installed at boot sees every later call.
  console.error = target.error;
  console.warn = target.warn;
  try {
    nextLogError(drizzleFailure());
    target.warn("[driver]", drizzleFailure());
  } finally {
    console.error = error;
    console.warn = warn;
  }
  assert.equal(seen.length, 2);
  assertClean(printed(seen[0]));
  assertClean(printed(seen[1]));
  assert.ok(printed(seen[0]).includes("Failed query: select"));
});

test("the scrub installs once: a second install leaves the wrapped methods as they are, and the wrap keeps `this` and the result", () => {
  const calls: unknown[][] = [];
  const target = {
    tag: "console",
    error(this: { tag: string }, ...args: unknown[]) {
      calls.push([this.tag, ...args]);
      return "logged";
    },
    warn(...args: unknown[]) {
      calls.push(args);
    },
  };
  assert.equal(installLogScrub(target), true, "the first install wraps");
  const wrappedError = target.error;
  const wrappedWarn = target.warn;
  assert.equal(installLogScrub(target), false, "the second does nothing");
  assert.equal(target.error, wrappedError);
  assert.equal(target.warn, wrappedWarn);
  assert.equal(target.error("mail to bob@example.com"), "logged");
  assert.deepEqual(calls, [["console", "mail to [email]"]], "scrubbed once, not twice, with the console as `this`");
});

/** Errors and values the scrub cannot read as it reads an ordinary error: each made fresh, so no case sees another's state. */
function unreadableArgs(): { name: string; arg: unknown; safe: string | null }[] {
  // The message and the head of each holds no secret, so the scrub reads on to the part that throws.
  const withGetter = Object.assign(new Error("boom"), { digest: "77" });
  Object.defineProperty(withGetter, "detail", { enumerable: true, get: () => assert.fail("a getter that throws") });
  const withStack = new Error("Failed query: select 1");
  Object.defineProperty(withStack, "stack", { get: () => assert.fail("a stack that throws") });
  const revoked = Proxy.revocable(new Error("alice@example.com"), {});
  revoked.revoke();
  return [
    // `safe`: the message of the safe Error printed instead; null: a value with nothing readable, printed as a fixed line.
    { name: "a message that is not a string", arg: Object.assign(new Error("x"), { message: 42 }), safe: "unknown error" },
    { name: "a field with a Symbol", arg: Object.assign(new Error("Failed query: select 1"), { params: [Symbol("tok_123")] }), safe: "Failed query: select 1" },
    { name: "a field with no string form", arg: Object.assign(new Error("Failed query: select 1"), { params: [Object.create(null)] }), safe: "Failed query: select 1" },
    { name: "a field whose getter throws", arg: withGetter, safe: "boom" },
    { name: "a stack that throws", arg: withStack, safe: "Failed query: select 1" },
    { name: "a revoked proxy", arg: revoked.proxy, safe: null },
  ];
}

test("the scrub never throws: what it cannot read is printed as its safe error, or as a fixed line, and the console call goes on", () => {
  for (const { name, arg, safe } of unreadableArgs()) {
    let out: unknown[] = [];
    assert.doesNotThrow(() => {
      out = scrubLogArgs(["before", arg, "after"]);
    }, name);
    assert.equal(out.length, 3, name);
    assert.equal(out[0], "before", name);
    assert.equal(out[2], "after", `${name}: the other arguments are untouched`);
    if (safe === null) {
      assert.equal(out[1], "[unreadable log argument]", name);
    } else {
      assert.ok(out[1] instanceof Error && out[1] !== arg, `${name}: a new error is printed instead`);
      assert.equal(out[1].message, safe, name);
      assert.equal(out[1].cause, undefined, name);
      assertClean(printed([out[1]]));
    }
  }
  const digest = scrubLogArgs([unreadableArgs()[3].arg])[0] as Error & { digest?: string };
  assert.equal(digest.digest, "77", "the digest is kept when it can be read");
  // Through the installed wrap: the call reaches the console, never throws back at the caller (Next's logError).
  const seen: unknown[][] = [];
  const target = { error: (...args: unknown[]) => void seen.push(args), warn: (...args: unknown[]) => void seen.push(args) };
  installLogScrub(target);
  for (const { name, arg } of unreadableArgs()) {
    assert.doesNotThrow(() => target.error("⨯", arg), name);
    assert.doesNotThrow(() => target.warn(arg), name);
  }
  assert.equal(seen.length, 2 * unreadableArgs().length);
});

test("src/instrumentation.ts installs the scrub on the console once, at boot, in the Node.js runtime only", () => {
  // Comments out, string text kept (the runtime name and the module path are string literals).
  const source = readFileSync("src/instrumentation.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(codeView(source), /export async function register\(\)/);
  const gate = code.indexOf('if (process.env.NEXT_RUNTIME === "nodejs")');
  assert.notEqual(gate, -1, "the Node.js runtime check");
  const load = code.indexOf('await import("@/lib/log-scrub")');
  const install = code.indexOf("installLogScrub(console)");
  assert.ok(load > gate && install > load, "the scrub module is loaded and installed inside the check");
  assert.doesNotMatch(code.slice(0, gate), /log-scrub/, "no static import: the Edge runtime never loads it");
  assert.equal(code.match(/installLogScrub\(/g)?.length, 1);
});
