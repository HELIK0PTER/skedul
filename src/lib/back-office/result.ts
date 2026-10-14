/**
 * Shapes shared by every pro Server Action (spec § 13, contract § 4.5). Pure:
 * the cores in src/lib/back-office/*-actions.ts return a CoreResult (with the
 * effects to run after commit); src/server/pro-context.ts runs the effects and
 * hands the browser an ActionResult without them.
 */
import type { Effect, EngineFail } from "@/lib/booking/types";
import { proErrorMessage, type ProErrorContext } from "@/lib/pro-messages";
import type { EngineErrorCode } from "@/lib/tickets-vocab";

/** Who acts: always built by requireProContext() from the session, never from input. */
export type ProCtx = {
  professionalId: string;
  actorUserId: string;
  timezone: string;
  currency: string;
  slug: string;
};

export type ActionFail = { ok: false; error: string; code?: EngineErrorCode };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFail;
export type CoreResult<T extends object = object> = ({ ok: true; effects: Effect[] } & T) | ActionFail;

export const UNEXPECTED_ERROR = "Une erreur inattendue est survenue. Réessayez dans un instant.";

/** { ok: false, error } with the code only when one is given. */
export function actionFail(error: string, code?: EngineErrorCode): ActionFail {
  return code === undefined ? { ok: false, error } : { ok: false, error, code };
}

/** An engine failure as a pro-facing failure: the French message of the context, the code kept for the UI. */
export function fromEngine(res: EngineFail, context: ProErrorContext): ActionFail {
  return { ok: false, error: proErrorMessage(res, context), code: res.code };
}

/** The same result without its effects (what reaches the browser). A failure is returned as it is. */
export function withoutEffects<T extends object>(res: CoreResult<T>): ActionResult<T> {
  if (!res.ok) return res;
  const copy: Record<string, unknown> = { ...res };
  delete copy.effects;
  return copy as unknown as ActionResult<T>;
}

/**
 * The revalidatePath calls of a successful action: the dashboard layout always;
 * with `publicPage`, every public page under /[slug] too. The path is a route
 * pattern, not a URL (Next 16 docs, revalidatePath): a dynamic segment takes
 * its pattern plus a type, whereas ("/altinha-paris", "layout") would tag a
 * path no page carries.
 */
export function revalidationTargets(publicPage: boolean): { path: string; type: "layout" }[] {
  return publicPage
    ? [
        { path: "/dashboard", type: "layout" },
        { path: "/[slug]", type: "layout" },
      ]
    : [{ path: "/dashboard", type: "layout" }];
}
