import { createHash } from "node:crypto";

/**
 * Daily-rotating anonymous visitor id: no cookie, and the IP never leaves this
 * function. Same visitor + same day → same hash; the next day → a new one.
 */
export function visitorHash(input: {
  secret: string;
  dayKey: string;
  ip: string;
  userAgent: string;
}): string {
  return createHash("sha256")
    .update(`${input.secret}|${input.dayKey}|${input.ip}|${input.userAgent}`)
    .digest("hex")
    .slice(0, 32);
}
