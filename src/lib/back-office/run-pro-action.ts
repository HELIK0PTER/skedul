/**
 * The tested body of the two wrappers every pro Server Action and read goes through (P6 A28), modeled on
 * src/lib/public/run-action.ts. Pure: src/server/pro-context.ts passes the real dependencies (requireProContext,
 * after() with runEffects, revalidatePath, console, unstable_rethrow), so node:test runs every rule with fakes.
 *
 * Rules: the context is read INSIDE the try, so a database or auth outage while reading the session answers
 * UNEXPECTED_ERROR like any other failure, and a Next control-flow error (the redirect of no session or no pro page)
 * is rethrown; ONE `now` serves the core; a throw is logged « [pro] <name> failed: <message> » without any address or
 * token; a refusal is returned as it is (no revalidation, no effect, no trace); on success, the impersonation trace,
 * the revalidation of the dashboard layout (and of every /[slug] page with `publicPage`), the effects after the
 * response, and the result without its effects.
 */
import type { Effect } from "@/lib/booking/types";
import { logSafeMessage } from "@/lib/log-safe";

import {
  UNEXPECTED_ERROR,
  actionFail,
  impersonationLogLine,
  revalidationTargets,
  withoutEffects,
  type ActionFail,
  type ActionResult,
  type CoreResult,
  type ProCtx,
} from "./result";

export type RunProDeps = {
  /** requireProContext: the acting pro from the fresh session; throws Next's redirect without a session or a pro page. */
  context: () => Promise<ProCtx>;
  /** after(() => runEffects(effects, "pro")): a pro's own action spends the pro's mail budget (Decision 74). */
  schedule: (effects: Effect[]) => void;
  /** revalidatePath(target.path, target.type) */
  revalidate: (target: { path: string; type: "layout" }) => void;
  /** console.error */
  log: (line: string) => void;
  /** console.info: the impersonation trace */
  info: (line: string) => void;
  /** unstable_rethrow */
  rethrowIfControlFlow: (err: unknown) => void;
  now: () => Date;
};

/** A throw: a control-flow error goes back to Next, any other is logged (no address, no token) and answered UNEXPECTED_ERROR. */
function unexpected(deps: RunProDeps, name: string, err: unknown): ActionFail {
  deps.rethrowIfControlFlow(err);
  deps.log(`[pro] ${name} failed: ${logSafeMessage(err)}`);
  return actionFail(UNEXPECTED_ERROR);
}

/** The wrapper of every pro write (see the module comment for its rules). */
export async function runProActionWith<T extends object>(
  deps: RunProDeps,
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<CoreResult<T>>,
  opts: { publicPage?: boolean } = {},
): Promise<ActionResult<T>> {
  let ctx: ProCtx;
  let res: CoreResult<T>;
  try {
    ctx = await deps.context();
    res = await fn(ctx, deps.now());
  } catch (err) {
    return unexpected(deps, name, err);
  }
  if (!res.ok) return res;
  const impersonation = impersonationLogLine(name, ctx);
  if (impersonation) deps.info(impersonation);
  for (const target of revalidationTargets(opts.publicPage === true)) deps.revalidate(target);
  const effects = res.effects;
  if (effects.length > 0) deps.schedule(effects);
  return withoutEffects(res);
}

/** The wrapper of read cores (search, previews): context and error handling like runProActionWith, no revalidation, no effect. */
export async function runProQueryWith<T extends object>(
  deps: RunProDeps,
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await deps.context();
    return await fn(ctx, deps.now());
  } catch (err) {
    return unexpected(deps, name, err);
  }
}
