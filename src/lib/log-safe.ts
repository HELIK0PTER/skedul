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

/** The first « params: » of a message (any case, the word itself): where a Drizzle « Failed query » lists its values. */
const PARAMS = /\bparams:/i;

/**
 * One line of an error for the server log: no query parameters, no e-mail
 * address, no personal-link token, no Checkout session id; whitespace
 * collapsed; 200 characters at most. Only the message is read: nothing else of
 * the error (headers, request, body fields) is ever logged. A Drizzle failure
 * reads « Failed query: <sql> params: <values> », and the values hold names and
 * phone numbers that no mask recognises: the message is cut at the first
 * « params: » before anything else, so only the SQL head is logged (G4b).
 */
export function logSafeMessage(err: unknown): string {
  const message = messageOf(err) ?? "unknown error";
  const cut = message.search(PARAMS);
  const raw = cut === -1 ? message : message.slice(0, cut);
  return raw
    .replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, "[email]")
    .replace(/\/api\/c\/[A-Za-z0-9._-]+/g, "/api/c/[token]")
    .replace(/\bcs_(?:test|live)_[A-Za-z0-9]+/g, "[session]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
