/**
 * Personal link and client space access (spec § 12). The pure decision of
 * /api/c/<token>, the customer lookups (ownedCustomerId is the owner predicate
 * src/lib/public/identity.ts shares) and two cores: resolveGuestLink (the
 * route) and resolveSpaceIdentity (the espace identity rule; the page maps the
 * request's visitor with its pure twin spaceIdentityOf, same order). No
 * `server-only`, no env and no process db: the callers pass `db`, the guest key
 * and whatever they read from the request.
 *
 * Tenancy: a token or a session e-mail is only a claim. Every lookup below
 * re-reads the customer, its pro and its current link_version, on every
 * request, so a revoked link dies at once, cookie or not, and a customer of
 * pro A is never reachable through pro B's page.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";

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

export type GuestCustomerRow = {
  customerId: string;
  linkVersion: number;
  slug: string;
  /** The pro's business name: the personal-link confirmation page says whose espace it opens. */
  businessName: string;
  proSuspended: boolean;
};

/** The customer, its pro's slug and whether that pro's user is suspended (a lapsed ban counts as lifted). */
export async function findGuestCustomer(db: Db, customerId: string): Promise<GuestCustomerRow | null> {
  const [row] = await db
    .select({
      customerId: customer.id,
      linkVersion: customer.linkVersion,
      slug: professional.slug,
      businessName: professional.businessName,
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
  | { kind: "stale"; slug: string; businessName: string }
  | { kind: "ok"; slug: string; customerId: string; businessName: string };

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
  if (link.linkVersion !== row.linkVersion) return { kind: "stale", slug: row.slug, businessName: row.businessName };
  return { kind: "ok", slug: row.slug, customerId: row.customerId, businessName: row.businessName };
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

/**
 * The rows a verified session owns, at any pro: the address is normalizeEmail(s.email) (one row per pro at most,
 * customer_pro_email_uq) AND the row is not linked to another account (user_id null or the session user's own). A row
 * linked to the user under ANOTHER address is nobody's here: the e-mail change is closed today, so nothing writes
 * one, but the rule never depends on that. THE rule of the wallet Owner (ownedCustomerId, one pro) and of the cards of
 * /mon-espace (getMySpace, every pro): the card of a pro is the row the Owner of that pro is (Decision 5, G3a).
 */
export function ownedCustomerRows(s: { userId: string; email: string }): SQL {
  return sql`(${customer.email} = ${normalizeEmail(s.email)} and (${customer.userId} is null or ${customer.userId} = ${s.userId}))`;
}

/**
 * The customer of this pro a verified session owns (ownedCustomerRows at one pro; the same rule as the cards of
 * /mon-espace, Decision 5). The caller has checked that the session is verified, fresh and not impersonated; null when
 * there is no such row.
 */
export async function ownedCustomerId(
  db: Db,
  professionalId: string,
  s: { userId: string; email: string },
): Promise<string | null> {
  const [row] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.professionalId, professionalId), ownedCustomerRows(s)));
  return row?.id ?? null;
}

export type SpaceIdentity =
  | { kind: "customer"; customerId: string; via: "session" | "guest" }
  | { kind: "no_record"; email: string }
  /** signed in, address not confirmed: the banner, never the code form (a code sign-in would purge the password, risk 7); the cookie customer is shown when set, to read and cancel, never spend */
  | { kind: "unverified"; email: string; guestCustomerId: string | null }
  | { kind: "impersonating" }
  | { kind: "anonymous" };

/** What the espace needs from a session: its user and e-mail, whether it was verified, and whether an admin is impersonating. */
export type SpaceSession = { userId: string; email: string; emailVerified: boolean; impersonated: boolean };

/**
 * Who is looking at this pro's espace (spec § 12, Decision 36). An impersonating admin is `impersonating` (checked
 * first; the cookie is ignored). A VERIFIED session wins: its owned customer at this pro (ownedCustomerId) or
 * no_record, and the cookie is ignored (L1370). An unverified session counts for nothing (anyone can sign up with
 * someone else's address) but is never anonymous: `unverified` carries the cookie's customer, shown next to the
 * confirmation banner to read and cancel, never spend (contract § 3.23). With no session at all: the guest cookie,
 * checked against this pro and the customer's current link version, else anonymous.
 */
export async function resolveSpaceIdentity(
  db: Db,
  professionalId: string,
  input: { session: SpaceSession | null; guestToken: string | undefined; key: Buffer },
): Promise<SpaceIdentity> {
  const { session } = input;
  if (session?.impersonated) return { kind: "impersonating" };
  if (session?.emailVerified) {
    const customerId = await ownedCustomerId(db, professionalId, session);
    return customerId ? { kind: "customer", customerId, via: "session" } : { kind: "no_record", email: session.email };
  }
  const guestCustomerId = await customerFromGuestCookie(db, professionalId, input.guestToken, input.key);
  if (session) return { kind: "unverified", email: session.email, guestCustomerId };
  return guestCustomerId ? { kind: "customer", customerId: guestCustomerId, via: "guest" } : { kind: "anonymous" };
}
