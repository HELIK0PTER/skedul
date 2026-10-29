import "server-only";

import { env } from "@/lib/env";
import { guestLinkKey } from "@/lib/guest-link";

let key: Buffer | null = null;

/** guestLinkKey(env.BETTER_AUTH_SECRET), computed once per server instance. */
export function guestKey(): Buffer {
  key ??= guestLinkKey(env.BETTER_AUTH_SECRET);
  return key;
}
