/**
 * Bearer check of the nightly job (spec E12, L1184-1185). Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` when the project has that variable;
 * the route refuses everything else. Pure: no env, no request object.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** A cron secret shorter than this is refused (SEC-M5): the route stays closed until the owner sets a long one. */
export const CRON_SECRET_MIN_LENGTH = 32;

/** sha256 of a string: two digests always have the same length, so timingSafeEqual never throws and never leaks the length. */
const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** True only for exactly `Bearer <secret>` with a secret of at least CRON_SECRET_MIN_LENGTH characters (SEC-M5), compared in constant time (sha256 digests + timingSafeEqual). */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (secret === undefined || secret.trim().length < CRON_SECRET_MIN_LENGTH) return false;
  if (authorization === null) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
