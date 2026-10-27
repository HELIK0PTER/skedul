/**
 * What may reach a server log about a failure. Pure on purpose (no import): the
 * Stripe, Google and Resend wrappers and the effects executor all use it, and
 * none of them should have to load the database or the e-mail templates for it.
 */

/**
 * The message of an Error, or of the plain `{ message }` object Resend returns, when it is a string; null for anything
 * else, and for a value that throws when read (a getter, a revoked proxy): a logger called from a `catch` must never
 * throw in its turn (P4 final review RND-1).
 */
function messageOf(err: unknown): string | null {
  try {
    if (typeof err === "object" && err !== null && "message" in err && typeof err.message === "string") {
      return err.message;
    }
  } catch {
    // Unreadable: no message.
  }
  return null;
}

/** The first « params: » of a message (any case, the word itself): where a Drizzle « Failed query » lists its values. */
const PARAMS = /\bparams:/i;
/** Anything around an « @ » (wide on purpose: a message is masked rather than trusted). */
const AT_WORD = /[^\s@<>"'()]+@[^\s@<>"'()]+/g;
/** A personal link (`/api/c/<token>`). */
const GUEST_LINK = /\/api\/c\/[A-Za-z0-9._-]+/g;
/** A Stripe Checkout session id. */
const CHECKOUT_SESSION = /\bcs_(?:test|live)_[A-Za-z0-9]+/g;
/** An e-mail address in the strict sense: a dotted domain whose last label starts with a letter (`next@16.2.9` in a package path is not one). */
const EMAIL_ADDRESS = /[^\s@<>"'()]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z][A-Za-z0-9-]*/;

/**
 * A text with what no log may hold taken out, and nothing else changed (lines, length and spacing kept): cut at its
 * first « params: » (a Drizzle « Failed query » lists its values there, names and phone numbers that no mask
 * recognises), then every word around an « @ », personal-link token and Checkout session id masked. The cut of
 * `logSafeMessage` and of the console scrub of `src/lib/log-scrub.ts` (P4 final review RND-1), which must not reflow
 * the framework's own multi-line output.
 */
export function scrubLogText(text: string): string {
  const cut = text.search(PARAMS);
  return (cut === -1 ? text : text.slice(0, cut))
    .replace(AT_WORD, "[email]")
    .replace(GUEST_LINK, "/api/c/[token]")
    .replace(CHECKOUT_SESSION, "[session]");
}

/**
 * True when a text holds what no log may print: a « params: » tail, an e-mail address (the strict sense, so the
 * `pkg@1.2.3` of a stack frame's package path does not count), a personal-link token or a Checkout session id. The
 * console scrub of `src/lib/log-scrub.ts` leaves every other line as it came.
 */
export function holdsLogSecret(text: string): boolean {
  // search() ignores a global regex's lastIndex, so the shared patterns keep no state between calls.
  return [PARAMS, EMAIL_ADDRESS, GUEST_LINK, CHECKOUT_SESSION].some((pattern) => text.search(pattern) !== -1);
}

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
  return scrubLogText(messageOf(err) ?? "unknown error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
