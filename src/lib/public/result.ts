/**
 * Shapes shared by every public and client Server Action (contract § 3.2). Pure: the cores in
 * src/lib/public/*-actions.ts return a PublicCoreResult (with the effects to run after the
 * response); src/server/public-context.ts runs the effects and hands the browser a PublicResult
 * without them.
 */
import type { Effect, EngineFail } from "@/lib/booking/types";
import { clientErrorMessage, type PublicErrorContext } from "@/lib/public/messages";
import type { EngineErrorCode } from "@/lib/tickets-vocab";

export type PublicFail = { ok: false; error: string; code?: EngineErrorCode; fieldErrors?: Record<string, string> };
export type PublicResult<T extends object = object> = ({ ok: true } & T) | PublicFail;
/** What a core returns: the browser result plus the effects to run after the response (also on a failure that committed a release). */
export type PublicCoreResult<T extends object = object> = (({ ok: true } & T) | PublicFail) & { effects: Effect[] };

export const PUBLIC_UNEXPECTED = "Une erreur inattendue est survenue. Réessayez dans un instant.";

/** A failure with its optional code, field errors and effects (default []). */
export function publicFail(
  error: string,
  opts: { code?: EngineErrorCode; fieldErrors?: Record<string, string>; effects?: Effect[] } = {},
): PublicFail & { effects: Effect[] } {
  const out: PublicFail & { effects: Effect[] } = { ok: false, error, effects: opts.effects ?? [] };
  if (opts.code !== undefined) out.code = opts.code;
  if (opts.fieldErrors !== undefined) out.fieldErrors = opts.fieldErrors;
  return out;
}

/** A success carrying `data` and its effects (default []). */
export function publicOk<T extends object>(data: T, effects: Effect[] = []): { ok: true; effects: Effect[] } & T {
  return { ...data, ok: true, effects };
}

/**
 * An engine failure in client words: clientErrorMessage(res, context, vars), the code kept unless opts.dropCode.
 * `dropCode` removes only the code: the sentence stays the one the engine code says, so it hides nothing by itself.
 * For Decision 64 (a visitor who is not a verified identity must learn nothing about another customer's state),
 * answer `publicFail(COPY.BUYBOOK_NOT_POSSIBLE)` instead of dropping the code of `already_booked` / `too_many_holds`.
 */
export function fromEngineClient(
  res: EngineFail,
  context: PublicErrorContext,
  vars: { businessName: string },
  effects: Effect[] = [],
  opts: { dropCode?: boolean } = {},
): PublicFail & { effects: Effect[] } {
  return publicFail(clientErrorMessage(res, context, vars), { code: opts.dropCode ? undefined : res.code, effects });
}

/** A parseFr failure: its error and fieldErrors, no effect. */
export function fromParse(parsed: { ok: false; error: string; fieldErrors: Record<string, string> }): PublicFail & { effects: Effect[] } {
  return publicFail(parsed.error, { fieldErrors: parsed.fieldErrors });
}

/** The browser result: the same object without `effects`. */
export function withoutPublicEffects<T extends object>(res: PublicCoreResult<T>): PublicResult<T> {
  const copy: Record<string, unknown> = { ...res };
  delete copy.effects;
  return copy as unknown as PublicResult<T>;
}

/** revalidatePath targets of every successful public / client action. */
export const PUBLIC_REVALIDATE: readonly { path: string; type?: "layout" }[] = [
  { path: "/[slug]", type: "layout" },
  { path: "/mon-espace" },
];
