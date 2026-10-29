import { createHmac } from "node:crypto";

/**
 * Anonymous visitor id: no cookie, and the IP never leaves this function. It is
 * an HMAC keyed with the day's random salt (src/server/analytics-salt.ts), which
 * rotates daily and is deleted after 2 days. Same visitor + same salt → same
 * hash; the next day → a new one; once the salt is gone, a hash can no longer
 * be linked back to an IP, even by someone holding the app's secrets.
 */
export function visitorHash(input: {
  salt: string;
  ip: string;
  userAgent: string;
}): string {
  return createHmac("sha256", input.salt)
    .update(`${input.ip}|${input.userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * The IP alone, hashed with the same daily salt: the per-IP key of the app
 * rate limits (src/lib/throttle.ts, spec § 12). No IP is ever stored in clear.
 */
export function ipHash(salt: string, ip: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}
