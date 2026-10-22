/**
 * The tested body of the two wrappers every public write goes through (contract § 3.7, COV-I12). Pure: the real
 * dependencies (the slug lookup, the visitor, after(), revalidatePath, console, unstable_rethrow) are passed in by
 * src/server/public-context.ts, so node:test runs every rule below with fakes.
 *
 * Rules: the slug is checked for shape before any read; an unknown or suspended pro answers PAGE_GONE; ONE `now`
 * serves the visitor and the core; a throw is logged without any address, token or session id and answered with
 * PUBLIC_UNEXPECTED (a Next control-flow error is rethrown); the engine's effects are scheduled after a success AND
 * after a refusal that already committed something (a released seat); the cache is revalidated after a success only;
 * a scheduler or a revalidation that fails after the commit is logged and never turns the committed action into an
 * error (a retry would book twice).
 */
import type { Effect } from "@/lib/booking/types";
import { logSafeMessage } from "@/lib/log-safe";
import { COPY } from "@/lib/public/messages";
import { PUBLIC_UNEXPECTED, withoutPublicEffects, type PublicCoreResult, type PublicResult } from "@/lib/public/result";

import { SLUG_PARAM_RE, type ActionVisitor, type PublicPro } from "./context";
import type { SessionFacts } from "./identity";

export type RunPublicDeps = {
  /** null for an unknown or suspended pro */
  resolvePro: (slug: string) => Promise<PublicPro | null>;
  visitor: (pro: PublicPro, now: Date) => Promise<ActionVisitor>;
  /** after(() => runEffects(effects, "none")): a client-initiated action never spends the pro's mail budget (Decision 74) */
  schedule: (effects: Effect[]) => void;
  /** revalidatePath for each PUBLIC_REVALIDATE target */
  revalidate: () => void;
  /** console.error */
  log: (line: string) => void;
  /** console.info: the impersonation trace */
  info: (line: string) => void;
  /** unstable_rethrow */
  rethrowIfControlFlow: (err: unknown) => void;
  now: () => Date;
};

/** « [public] <name> by admin <impersonatedBy> for pro <professionalId> » (ids only), or null when no admin impersonates (Decision 75, the FR:SEC-6 line of runProAction). */
export function publicImpersonationLogLine(
  name: string,
  session: SessionFacts | null,
  professionalId: string,
): string | null {
  if (!session || !session.impersonated || session.impersonatedBy === null) return null;
  return `[public] ${name} by admin ${session.impersonatedBy} for pro ${professionalId}`;
}

type Followers = Pick<RunPublicDeps, "schedule" | "revalidate" | "log" | "info" | "rethrowIfControlFlow">;

/** Runs one follow-up step of a committed action: a failure is logged (no address) and never propagates. */
function safely(deps: Followers, name: string, step: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    deps.rethrowIfControlFlow(err);
    deps.log(`[public] ${name} ${step} failed: ${logSafeMessage(err)}`);
  }
}

/** After the core returned: effects (success or committing refusal), then, on success only, the trace line and the revalidation. */
function settle(deps: Followers, name: string, res: PublicCoreResult<object>, trace: string | null): void {
  if (res.effects.length > 0) safely(deps, name, "schedule", () => deps.schedule(res.effects));
  if (!res.ok) return;
  if (trace !== null) deps.info(trace);
  safely(deps, name, "revalidate", () => deps.revalidate());
}

function unexpected(deps: Followers, name: string, err: unknown): { ok: false; error: string } {
  deps.rethrowIfControlFlow(err);
  deps.log(`[public] ${name} failed: ${logSafeMessage(err)}`);
  return { ok: false, error: PUBLIC_UNEXPECTED };
}

/**
 * The wrapper of every public write that belongs to a pro page: slug not a string matching SLUG_PARAM_RE, or
 * resolvePro null → { ok: false, error: COPY.PAGE_GONE } without calling fn; ONE now for visitor and fn; a throw →
 * rethrowIfControlFlow(err), then log(« [public] <name> failed: <logSafeMessage(err)> ») and PUBLIC_UNEXPECTED;
 * effects scheduled on success AND on a failure carrying some; on ok only: info(publicImpersonationLogLine(…)) when
 * not null, then revalidate; returns withoutPublicEffects(res).
 */
export async function runPublicActionWith<T extends object>(
  deps: RunPublicDeps,
  name: string,
  slug: unknown,
  fn: (pro: PublicPro, visitor: ActionVisitor, now: Date) => Promise<PublicCoreResult<T>>,
): Promise<PublicResult<T>> {
  if (typeof slug !== "string" || !SLUG_PARAM_RE.test(slug)) return { ok: false, error: COPY.PAGE_GONE };
  const now = deps.now();
  let res: PublicCoreResult<T>;
  let trace: string | null;
  try {
    const pro = await deps.resolvePro(slug);
    if (!pro) return { ok: false, error: COPY.PAGE_GONE };
    const visitor = await deps.visitor(pro, now);
    res = await fn(pro, visitor, now);
    trace = publicImpersonationLogLine(name, visitor.session, pro.professionalId);
  } catch (err) {
    return unexpected(deps, name, err);
  }
  settle(deps, name, res, trace);
  return withoutPublicEffects(res);
}

export type RunClientDeps = Omit<RunPublicDeps, "resolvePro" | "visitor"> & {
  /** currentSessionFacts: the fresh session, a suspended user counted as none */
  session: () => Promise<SessionFacts | null>;
};

/** The same rules for the /mon-espace actions (no slug): fn receives the fresh session facts; no impersonation line (every /mon-espace core refuses an impersonated session before any write). */
export async function runClientActionWith<T extends object>(
  deps: RunClientDeps,
  name: string,
  fn: (session: SessionFacts | null, now: Date) => Promise<PublicCoreResult<T>>,
): Promise<PublicResult<T>> {
  const now = deps.now();
  let res: PublicCoreResult<T>;
  try {
    res = await fn(await deps.session(), now);
  } catch (err) {
    return unexpected(deps, name, err);
  }
  settle(deps, name, res, null);
  return withoutPublicEffects(res);
}
