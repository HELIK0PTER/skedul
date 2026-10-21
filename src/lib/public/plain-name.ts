/**
 * The name a visitor types on a public form (spec L788-792, SEC-M9). Skedul relays that name into
 * the mails it sends to the pro and to the client, so a name that carries a link, an address or a
 * phone number would turn those mails into a phishing channel. Pure and client-importable.
 *
 * The rule is on what a mail client or a reader acts on, not on how it is spelled: the check runs on
 * the NFKC-folded text without invisible characters, and a number counts however it is spaced.
 * Accepted residual (Task 31 outcome): a number or an address spelled out in words cannot be caught
 * by a pure rule.
 */
import { z } from "zod";

import { COPY } from "@/lib/public/messages";
import { BOUNDS } from "@/lib/tickets-vocab";

/** A domain shape: a letter or digit, a dot, then at least two letters (« exemple.fr », « bit.ly »). « J. Dupont » and « Dr. Martin » have a space after the dot and pass. */
const DOMAIN_SHAPE = /[\p{L}\p{M}\p{N}]\.[\p{L}\p{M}]{2,}/u;
/** What separates the digits of a number as people write it: spaces, dots, dashes, brackets, « + », any other punctuation or symbol, and the marks of a keycap digit. */
const NUMBER_SEPARATORS = /[\s\p{P}\p{S}\p{M}]/gu;
/** A phone number: 5 decimal digits or more in a row, whatever the script (« Anne 1234 » is a name, « 06 12 34 56 78 » is not). */
const LONG_NUMBER = /\p{Nd}{5,}/u;

/** False for a name with a link (« / », « www. » or a domain such as « bit.ly »), an address (« @ ») or a phone number (5 digits or more, spaced or not), checked after NFKC folding (SEC-M9: no phishing text relayed into Skedul mails). */
export function isPlainName(name: string): boolean {
  // NFKC folds the full-width digits, at sign, slash and dot into the ASCII a mail client acts on; the
  // invisible characters (zero-width space, soft hyphen, bidi marks) are dropped; the ideographic full
  // stop reads as a dot.
  const text = name
    .normalize("NFKC")
    .replace(/\p{C}/gu, "")
    .replace(/\u3002/g, ".")
    .toLowerCase();
  if (text.includes("/") || text.includes("@") || text.includes("www.") || DOMAIN_SHAPE.test(text)) return false;
  return !LONG_NUMBER.test(text.replace(NUMBER_SEPARATORS, ""));
}

/** z.string().trim().min(1).max(BOUNDS.name).refine(isPlainName, COPY.PLAIN_NAME): the name of every public identity, « Votre nom » and the first code sign-in. */
export const plainNameSchema: z.ZodString = z.string().trim().min(1).max(BOUNDS.name).refine(isPlainName, COPY.PLAIN_NAME);
