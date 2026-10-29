import "server-only";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";

import type { ActionResult, CoreResult, ProCtx } from "@/lib/back-office/result";
import { runProActionWith, runProQueryWith, type RunProDeps } from "@/lib/back-office/run-pro-action";
import { getCurrentProfessional, getFreshSession, getSession } from "@/lib/session";
import { actingSession } from "@/lib/suspension";
import { runEffects } from "@/server/notify";

/**
 * The professional row of the signed-in user, for the dashboard pages. A page
 * cannot rely on the dashboard layout to guard it (layout and page render in
 * parallel, and a layout does not render again on a client navigation), so
 * each page checks itself: no session sends to /sign-in, no professional
 * profile to /mon-espace (a client of some pro, or an account with no page yet).
 */
export async function requireProfessional(): Promise<NonNullable<Awaited<ReturnType<typeof getCurrentProfessional>>>> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const pro = await getCurrentProfessional();
  if (!pro) redirect("/mon-espace");
  return pro;
}

/**
 * The acting pro, from the session only (never from input). No session sends
 * to /sign-in, no professional profile to /mon-espace. While an admin
 * impersonates, the session is the pro's own: actions stay allowed and
 * `actorUserId` is the impersonated user (decision 10).
 * Final review SEC-2: every action and query reads the session WITHOUT the
 * 5-minute cookie cache (one session read more per call), and a suspended user
 * is answered like no session: a ban stops a pro's writes at once, not five
 * minutes later. The dashboard pages keep the cached read of requireProfessional
 * (a page only shows data; its actions check again).
 */
export async function requireProContext(): Promise<ProCtx> {
  const session = actingSession(await getFreshSession());
  if (!session) redirect("/sign-in");
  const pro = await getCurrentProfessional();
  if (!pro) redirect("/mon-espace");
  return {
    professionalId: pro.id,
    actorUserId: session.user.id,
    timezone: pro.timezone,
    currency: pro.currency,
    slug: pro.slug,
    impersonatedBy: session.session.impersonatedBy ?? null,
  };
}

/** The real dependencies of the two wrappers: their rules are src/lib/back-office/run-pro-action.ts, tested with fakes. */
const PRO_DEPS: RunProDeps = {
  context: requireProContext,
  schedule: (effects) => after(() => runEffects(effects, "pro")),
  revalidate: (target) => revalidatePath(target.path, target.type),
  log: (line) => console.error(line),
  info: (line) => console.info(line),
  rethrowIfControlFlow: unstable_rethrow,
  now: () => new Date(),
};

/**
 * The wrapper of every pro write. Builds the context (inside the core's try since P6 A28: an outage while reading the
 * session answers UNEXPECTED_ERROR, the redirect of no session still reaches Next), takes ONE `now`, runs the
 * core. A thrown error that is not a Next.js control-flow error is logged
 * (« [pro] <name> failed: <message> », without address or token) and answered
 * with UNEXPECTED_ERROR. On success: the dashboard layout is revalidated (and
 * every public page under /[slug] when `publicPage`), the effects run after the response
 * (after()), and the browser receives the result without them. A failure is
 * returned as it is: no revalidation, no effect. While an admin impersonates the
 * pro, each successful action logs « [pro] <name> by admin <id> for pro <id> »
 * (ids only).
 */
export async function runProAction<T extends object>(
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<CoreResult<T>>,
  opts: { publicPage?: boolean } = {},
): Promise<ActionResult<T>> {
  return runProActionWith(PRO_DEPS, name, fn, opts);
}

/** The wrapper of read cores (search, previews): context and error handling like runProAction, no revalidation, no effect. */
export async function runProQuery<T extends object>(
  name: string,
  fn: (ctx: ProCtx, now: Date) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  return runProQueryWith(PRO_DEPS, name, fn);
}
