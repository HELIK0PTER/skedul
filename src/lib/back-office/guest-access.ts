/**
 * Personal link and client space access (spec § 12). The pure decision of
 * /api/c/<token>, the customer lookups and the two cores the route and the
 * espace page wrap: resolveGuestLink (the route) and resolveSpaceIdentity (the
 * page). No `server-only`, no env and no process db: the callers pass `db`,
 * the guest key and whatever they read from the request.
 *
 * Tenancy: a token or a session e-mail is only a claim. Every lookup below
 * re-reads the customer, its pro and its current link_version, on every
 * request, so a revoked link dies at once, cookie or not, and a customer of
 * pro A is never reachable through pro B's page.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import { customer, professional, user } from "@/lib/db/schema";
import { GUEST_COOKIE_MAX_AGE, verifyGuestLink, type GuestLink } from "@/lib/guest-link";
import { userIsSuspended } from "@/lib/suspension";
import { normalizeEmail } from "@/lib/tickets";

/** The alphabet of a pro's address (src/lib/slug.ts, proSlugFromPath): no slash, no dot, no colon. */
const SLUG_SHAPE = /^[a-z0-9-]+$/;

/** A real token is `customerId.version.mac`, well under 150 characters. */
const MAX_TOKEN_LENGTH = 200;

/**
 * The attributes of the skedul_guest cookie (final review SEC-7), in one place so a test pins each:
 * HttpOnly (the token is a credential no script reads), SameSite=Lax (sent on the click from the
 * e-mail, not on a cross-site request), scoped to the pro's own path (another pro's pages never
 * receive it), 30 days, and Secure in a production build.
 */
export function guestCookieOptions(slug: string, production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: `/${slug}`,
    maxAge: GUEST_COOKIE_MAX_AGE,
  } as const;
}

export type GuestCustomerRow = { customerId: string; linkVersion: number; slug: string; proSuspended: boolean };

/** The customer, its pro's slug and whether that pro's user is suspended (a lapsed ban counts as lifted). */
export async function findGuestCustomer(db: Db, customerId: string): Promise<GuestCustomerRow | null> {
  const [row] = await db
    .select({
      customerId: customer.id,
      linkVersion: customer.linkVersion,
      slug: professional.slug,
      proSuspended: sql<boolean>`${userIsSuspended()}`,
    })
    .from(customer)
    .innerJoin(professional, eq(professional.id, customer.professionalId))
    .innerJoin(user, eq(user.id, professional.userId))
    .where(eq(customer.id, customerId));
  return row ?? null;
}

export type GuestLinkDecision =
  | { kind: "not_found" }
  | { kind: "stale"; slug: string }
  | { kind: "ok"; slug: string; customerId: string };

/**
 * Q21: no verified link, no customer row, a row of another customer or a
 * suspended pro are all "not found" (one answer for every unauthorised case);
 * a verified link whose version is not the customer's current one is "stale"
 * (the link was revoked); else "ok". The slug is the row's, never the request's.
 */
export function guestLinkDecision(link: GuestLink | null, row: GuestCustomerRow | null): GuestLinkDecision {
  if (!link || !row || row.proSuspended || link.customerId !== row.customerId) return { kind: "not_found" };
  // The redirect target is built from the row's slug: never follow one that is not a plain address segment.
  if (!SLUG_SHAPE.test(row.slug)) return { kind: "not_found" };
  if (link.linkVersion !== row.linkVersion) return { kind: "stale", slug: row.slug };
  return { kind: "ok", slug: row.slug, customerId: row.customerId };
}

/**
 * What /api/c/<token> does with a token: verify the MAC (constant time), read
 * the customer it names, compare the link version with the row's, and take the
 * redirect slug from that row. An overlong token is rejected before any work.
 */
export async function resolveGuestLink(db: Db, token: string, key: Buffer): Promise<GuestLinkDecision> {
  if (token.length > MAX_TOKEN_LENGTH) return { kind: "not_found" };
  const link = verifyGuestLink(token, key);
  const row = link ? await findGuestCustomer(db, link.customerId) : null;
  return guestLinkDecision(link, row);
}

/**
 * Espace by cookie: the customer of the token when the MAC verifies, the
 * customer belongs to THIS pro and the token carries its current link_version
 * (a revoked link, or a token of another pro's customer, gives null).
 */
export async function customerFromGuestCookie(
  db: Db,
  professionalId: string,
  token: string | undefined,
  key: Buffer,
): Promise<string | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const link = verifyGuestLink(token, key);
  if (!link) return null;
  const [row] = await db
    .select({ id: customer.id, linkVersion: customer.linkVersion })
    .from(customer)
    .where(and(eq(customer.id, link.customerId), eq(customer.professionalId, professionalId)));
  return row && row.linkVersion === link.linkVersion ? row.id : null;
}

/** Espace by verified session: the customer of this pro whose e-mail is normalizeEmail(email) (customer_pro_email_uq), else null. */
export async function customerFromVerifiedEmail(db: Db, professionalId: string, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.professionalId, professionalId), eq(customer.email, normalizeEmail(email))));
  return row?.id ?? null;
}

export type SpaceIdentity =
  | { kind: "customer"; customerId: string; via: "session" | "guest" }
  | { kind: "no_record"; email: string }
  | { kind: "anonymous" };

/** What the espace needs from a session: its e-mail, whether it was verified, and whether an admin is impersonating. */
export type SpaceSession = { email: string; emailVerified: boolean; impersonated: boolean };

/**
 * Who is looking at this pro's espace (spec § 12, Decision 36). A VERIFIED,
 * non-impersonated session wins: its customer at this pro, or no_record. An
 * unverified session counts for nothing (anyone can sign up with someone
 * else's address), and an admin impersonating the pro never reads a client's
 * data through the pro's session. Else the guest cookie, checked against this
 * pro and the customer's current link version. Else anonymous.
 */
export async function resolveSpaceIdentity(
  db: Db,
  professionalId: string,
  input: { session: SpaceSession | null; guestToken: string | undefined; key: Buffer },
): Promise<SpaceIdentity> {
  const { session } = input;
  if (session && session.emailVerified && !session.impersonated) {
    const customerId = await customerFromVerifiedEmail(db, professionalId, session.email);
    return customerId ? { kind: "customer", customerId, via: "session" } : { kind: "no_record", email: session.email };
  }
  const customerId = await customerFromGuestCookie(db, professionalId, input.guestToken, input.key);
  return customerId ? { kind: "customer", customerId, via: "guest" } : { kind: "anonymous" };
}
