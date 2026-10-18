/**
 * Personal link (spec § 12): every client e-mail points to /api/c/<token>,
 * which sets the `skedul_guest` cookie for this pro's path. The token is
 * `customerId.linkVersion.mac`, MAC = HMAC-SHA256 under a key derived from
 * BETTER_AUTH_SECRET. Bumping customer.link_version revokes every link: the
 * caller compares the verified version with the row's. Pure (node:crypto).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE = "skedul_guest" as const;
/** 30 days, in seconds (2_592_000). */
export const GUEST_COOKIE_MAX_AGE: number = 30 * 24 * 60 * 60;

export type GuestLink = { customerId: string; linkVersion: number };

const VERSION = /^[1-9][0-9]{0,8}$/;
const PART = /^[A-Za-z0-9_-]+$/;

/** HMAC-SHA256(secret, "skedul-guest-link-v1"). */
export function guestLinkKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("skedul-guest-link-v1").digest();
}

function mac(link: GuestLink, key: Buffer): string {
  return createHmac("sha256", key).update(`${link.customerId}|${link.linkVersion}`).digest("base64url");
}

/** `${customerId}.${linkVersion}.${base64url(HMAC-SHA256(key, `${customerId}|${linkVersion}`))}`. */
export function signGuestLink(link: GuestLink, key: Buffer): string {
  return `${link.customerId}.${link.linkVersion}.${mac(link, key)}`;
}

/** The link when the token has exactly 3 parts, an integer version ≥ 1 and a matching MAC (constant time); else null. */
export function verifyGuestLink(token: string, key: Buffer): GuestLink | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [customerId, versionText, given] = parts;
  if (!PART.test(customerId) || !VERSION.test(versionText) || !PART.test(given)) return null;
  const link = { customerId, linkVersion: Number(versionText) };
  const expected = Buffer.from(mac(link, key));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return link;
}
