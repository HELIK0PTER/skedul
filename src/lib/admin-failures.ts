/**
 * The answer of an /admin/users action that threw (P6 X2): one fixed French sentence per kind of action, never the
 * thrown message (a Better Auth APIError speaks English, a database error can carry a query and its values). The
 * detail goes to the server log only, through logSafeMessage. Pure: src/server/admin.ts is a "use server" module,
 * which may export async functions only.
 */
import { logSafeMessage } from "@/lib/log-safe";

export const ADMIN_FAILURE_MESSAGES = {
  suspend: "La suspension du compte n'a pas abouti. Réessayez.",
  reactivate: "La réactivation du compte n'a pas abouti. Réessayez.",
  signOut: "La fermeture des sessions n'a pas abouti. Réessayez.",
  impersonate: "L'ouverture du compte n'a pas abouti. Réessayez.",
  role: "Le changement de rôle n'a pas abouti. Réessayez.",
  delete: "La suppression du compte n'a pas abouti. Réessayez.",
} as const;

export type AdminFailureKind = keyof typeof ADMIN_FAILURE_MESSAGES;

/** Logs `[admin] <kind> failed: <logSafeMessage(err)>` and answers the kind's sentence. */
export function adminFailure(
  kind: AdminFailureKind,
  err: unknown,
  log: (line: string) => void = console.error,
): { ok: false; error: string } {
  log(`[admin] ${kind} failed: ${logSafeMessage(err)}`);
  return { ok: false, error: ADMIN_FAILURE_MESSAGES[kind] };
}

/**
 * The browser side of an /admin/users action (P6 X4): the action's own answer, or the kind's sentence when the call
 * itself rejects (network down, server unreachable), so that the failure is said on the card instead of reaching the
 * error boundary. `rethrow` sees the error first: UserActions passes Next's unstable_rethrow, which lets the redirect
 * of « Se connecter en tant que » go on. Nothing is logged: the browser has no detail worth keeping.
 */
export async function callAdminAction<T extends { ok: boolean }>(
  kind: AdminFailureKind,
  action: () => Promise<T>,
  rethrow: (err: unknown) => void,
): Promise<T | { ok: false; error: string }> {
  try {
    return await action();
  } catch (err) {
    rethrow(err);
    return { ok: false, error: ADMIN_FAILURE_MESSAGES[kind] };
  }
}
