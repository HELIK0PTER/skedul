/**
 * The name a visitor types on a public form (spec L788-792, SEC-M9). Skedul relays that name into
 * the mails it sends to the pro and to the client, so a name that carries a link, an address or a
 * phone number would turn those mails into a phishing channel. Pure and client-importable.
 */
import { z } from "zod";

import { COPY } from "@/lib/public/messages";
import { BOUNDS } from "@/lib/tickets-vocab";

/** False for a name containing « :// », « www. », « @ » or a run of 5 digits or more (SEC-M9: no phishing text relayed into Skedul mails). */
export function isPlainName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("://") || lower.includes("www.") || lower.includes("@")) return false;
  return !/\d{5,}/.test(name);
}

/** z.string().trim().min(1).max(BOUNDS.name).refine(isPlainName, COPY.PLAIN_NAME): the name of every public identity, « Votre nom » and the first code sign-in. */
export const plainNameSchema: z.ZodString = z.string().trim().min(1).max(BOUNDS.name).refine(isPlainName, COPY.PLAIN_NAME);
