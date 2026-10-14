/**
 * What may reach a server log about a failure. Pure on purpose (no import): the
 * Stripe, Google and Resend wrappers and the effects executor all use it, and
 * none of them should have to load the database or the e-mail templates for it.
 */

/** The message of an Error, or of the plain `{ message }` object Resend returns; null for anything else. */
function messageOf(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return null;
}

/**
 * One line of an error for the server log: no e-mail address, no personal-link
 * token, no Checkout session id; whitespace collapsed; 200 characters at most.
 * Only the message is read: nothing else of the error (headers, request, body
 * fields) is ever logged.
 */
export function logSafeMessage(err: unknown): string {
  const raw = messageOf(err) ?? "unknown error";
  return raw
    .replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, "[email]")
    .replace(/\/api\/c\/[A-Za-z0-9._-]+/g, "/api/c/[token]")
    .replace(/\bcs_(?:test|live)_[A-Za-z0-9]+/g, "[session]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
