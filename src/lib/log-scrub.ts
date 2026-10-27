/**
 * The catch-all layer of P4 final review RND-1 (contract § 1 « URLs and logs »): `src/instrumentation.ts` wraps the
 * Node server's `console.error` and `console.warn` once, at boot, with `scrubLogArgs`. Next.js logs what a page, a
 * Server Action or a route handler throws through them (`Log.error`, which looks the console method up at each call),
 * and so do the libraries; a failed query handed to them would print its parameters (Drizzle's « Failed query: …
 * params: … », its `params` field, the driver error as cause). The reads of the public pages throw a scrubbed error
 * already (`safeRead`), Better Auth has its own logger (`writeAuthLog`): this layer covers every other path (the P3
 * dashboard and admin pages, route handlers, Server Actions, a library's own line). Pure: the console is passed in.
 */
import { holdsLogSecret as holdsSecret, logSafeMessage, scrubLogText } from "@/lib/log-safe";

/** How deep a chain of causes is read (a cycle or a very long chain stops there). */
const MAX_DEPTH = 5;

/**
 * True when what Node would print for this error holds a secret: its message, its stack, its own fields (Drizzle's
 * `query` and `params`, a driver's `detail`) and its cause, down the chain.
 */
function errorHoldsSecret(err: Error, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (holdsSecret(err.message) || holdsSecret(err.stack ?? "")) return true;
  for (const value of [...Object.values(err), err.cause]) {
    if (value instanceof Error) {
      if (errorHoldsSecret(value, depth + 1)) return true;
    } else if (typeof value === "string" || Array.isArray(value)) {
      if (holdsSecret(String(value))) return true;
    }
  }
  return false;
}

/** The error Node prints instead: the safe message, the same name and the same digest (the error page's id), no cause, no field, no frame. */
function safeErrorOf(err: Error): Error {
  const safe = new Error(logSafeMessage(err));
  safe.name = err.name;
  safe.stack = `${safe.name}: ${safe.message}`;
  const digest: unknown = (err as { digest?: unknown }).digest;
  if (typeof digest === "string") Object.assign(safe, { digest });
  return safe;
}

/**
 * The arguments of one console call as they may be printed: an Error that holds a secret (message, stack, own field or
 * cause) is replaced by `safeErrorOf(err)`; a string that holds one loses its « params: » tail and has its addresses,
 * tokens and session ids masked (`scrubLogText`: lines and spacing kept). A secret is what `holdsLogSecret` names, so
 * the `pkg@1.2.3` of a stack frame's package path changes nothing. Everything else is handed over as it came, the
 * same values.
 */
export function scrubLogArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg instanceof Error) return errorHoldsSecret(arg, 0) ? safeErrorOf(arg) : arg;
    if (typeof arg === "string") return holdsSecret(arg) ? scrubLogText(arg) : arg;
    return arg;
  });
}

/** Marks a console the scrub already wraps (a registry symbol: two copies of this module see the same mark). */
const INSTALLED = Symbol.for("skedul.log-scrub");

type LogMethod = (...args: unknown[]) => unknown;
type ScrubbableConsole = { error: LogMethod; warn: LogMethod };

/**
 * Wraps `target.error` and `target.warn` so that each call goes through `scrubLogArgs` first, then on to the method
 * that was there (with the same `this`, and its result). Once only: a second call (a second register(), a second copy
 * of the module) leaves the console as it is and answers false.
 */
export function installLogScrub(target: ScrubbableConsole): boolean {
  const marked = target as ScrubbableConsole & { [INSTALLED]?: true };
  if (marked[INSTALLED]) return false;
  for (const method of ["error", "warn"] as const) {
    const previous = target[method];
    target[method] = function (this: unknown, ...args: unknown[]) {
      return previous.apply(this, scrubLogArgs(args));
    };
  }
  Object.defineProperty(marked, INSTALLED, { value: true });
  return true;
}
