/**
 * Visitor identity of the public pages and actions (spec § 12, contract § 3.5). No `server-only`, no env and no
 * process db: the callers pass `db`, the guest key and the session facts they read from the request, so the DB tests
 * run this module as it is (src/server/visitor.ts is the thin wrapper that reads the fresh session and the cookie).
 *
 * Rules: a session counts only when read fresh and not suspended (the wrapper applies actingSession first); an admin
 * impersonating a pro is a visitor with no client identity (no wallet, no cookie); the wallet Owner is a verified
 * session whose e-mail is the e-mail of a customer of THIS pro that is not linked to another account; the guest
 * cookie is read only for a signed-out or an unverified visitor, never for a verified or an impersonating one. A
 * render never writes: linkCustomerUser runs only in an action core, after the core has parsed its input and passed
 * its throttle (bookWithHeldTicketCore), never in a wrapper or a page.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  customerFromGuestCookie,
  ownedCustomerId,
  type SpaceIdentity,
} from "@/lib/back-office/guest-access";
import type { Db } from "@/lib/db/atomic";
import { customer } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/tickets";

export type SessionFacts = {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** = impersonatedBy !== null */
  impersonated: boolean;
  /** the admin's user id while an admin impersonates (session.impersonatedBy), else null: ids-only trace lines (Decision 75, FR:SEC-6) */
  impersonatedBy: string | null;
};

export type SessionLike =
  | {
      user: { id: string; email: string; name?: string | null; emailVerified?: boolean | null };
      session: { impersonatedBy?: string | null };
    }
  | null
  | undefined;

/**
 * The fields of a (fresh, not suspended: visitor.ts applies actingSession first) Better Auth session P4 relies on;
 * null without a session. Fails closed: any impersonatedBy that is not null or undefined, an empty string included,
 * counts as an impersonation.
 */
export function sessionFactsOf(session: SessionLike): SessionFacts | null {
  if (!session) return null;
  const impersonatedBy = session.session.impersonatedBy ?? null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name ?? "",
    emailVerified: session.user.emailVerified === true,
    impersonated: impersonatedBy !== null,
    impersonatedBy,
  };
}

export type VisitorState = "anonymous" | "unverified" | "verified" | "impersonating";

/** null → anonymous; impersonated → impersonating (checked first); !emailVerified → unverified; else verified. */
export function visitorState(s: SessionFacts | null): VisitorState {
  if (!s) return "anonymous";
  if (s.impersonated) return "impersonating";
  return s.emailVerified ? "verified" : "unverified";
}

export type WalletOwner = { professionalId: string; customerId: string; userId: string; email: string };

export type PublicVisitor = {
  state: VisitorState;
  /** session e-mail and name, only for "unverified" and "verified" */
  email: string | null;
  name: string | null;
  /** the session user owns this pro page (impersonation included) */
  isPageOwner: boolean;
  /** "verified" with a customer of this pro: e-mail = the session e-mail AND (user_id null OR the session user) */
  owner: WalletOwner | null;
  /** the skedul_guest cookie's customer of THIS pro at its current link_version; always null when state is "verified" (L1370) or "impersonating" (SEC-M6, Decision 19) */
  guestCustomerId: string | null;
};

/** Read-only (a render never writes): state, owner (ownedCustomerId of guest-access.ts), guest cookie customer (customerFromGuestCookie, skipped for verified and impersonating), page ownership. */
export async function resolveVisitor(
  db: Db,
  args: { session: SessionFacts | null; guestToken: string | undefined; key: Buffer },
  pro: { professionalId: string; ownerUserId: string },
): Promise<PublicVisitor> {
  const { session } = args;
  const state = visitorState(session);
  let owner: WalletOwner | null = null;
  let guestCustomerId: string | null = null;
  if (session && state === "verified") {
    const customerId = await ownedCustomerId(db, pro.professionalId, session);
    if (customerId) {
      owner = { professionalId: pro.professionalId, customerId, userId: session.userId, email: normalizeEmail(session.email) };
    }
  } else if (state === "anonymous" || state === "unverified") {
    guestCustomerId = await customerFromGuestCookie(db, pro.professionalId, args.guestToken, args.key);
  }
  const identified = session !== null && (state === "verified" || state === "unverified") ? session : null;
  return {
    state,
    email: identified ? identified.email : null,
    name: identified ? identified.name : null,
    isPageOwner: session !== null && session.userId === pro.ownerUserId,
    owner,
    guestCustomerId,
  };
}

/**
 * The Owner's link write (L1345): set customer.user_id to the owner's user when it is still null. The statement
 * names the pro and the customer (a customer of another pro is never touched), keeps a linked row as it is, and,
 * defence in depth, links only a VERIFIED user whose e-mail is the row's own (the caller has checked it).
 */
export async function linkCustomerUser(db: Db, owner: WalletOwner, now: Date): Promise<void> {
  const email = normalizeEmail(owner.email);
  await db
    .update(customer)
    .set({ userId: owner.userId, updatedAt: now })
    .where(
      and(
        eq(customer.id, owner.customerId),
        eq(customer.professionalId, owner.professionalId),
        isNull(customer.userId),
        eq(customer.email, email),
        sql`exists (select 1 from "user" u where u.id = ${owner.userId} and u.email_verified and lower(u.email) = ${email})`,
      ),
    );
}

/** userId for upsertCustomer and the throttle subject: the session user only when verified, not impersonated and normalizeEmail(email) equals the session e-mail; else null (OUT:69, defence in depth with § 3.4). */
export function upsertUserIdFor(s: SessionFacts | null, email: string): string | null {
  if (!s || !s.emailVerified || s.impersonated) return null;
  return normalizeEmail(email) === normalizeEmail(s.email) ? s.userId : null;
}

/** The e-mail of THIS pro's customer (throttle subject of a guest cancel or a release); server-side only, never returned to the browser. */
export async function customerEmailOf(db: Db, professionalId: string, customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: customer.email })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.professionalId, professionalId)));
  return row?.email ?? null;
}

/**
 * The espace identity of a visitor, in this order: impersonating; the Owner; verified without a record
 * (no_record); unverified (+ the cookie's customer: read and cancel, never spend); the cookie's customer;
 * anonymous. A signed-in visitor, verified or not, never maps to anonymous (COV-C1). The only implementation of
 * the rule, used by resolveSpaceCustomer in src/server/client-queries.ts over resolveVisitor (its DB tests,
 * "espace identity", are in identity.db.test.ts).
 */
export function spaceIdentityOf(visitor: PublicVisitor): SpaceIdentity {
  if (visitor.state === "impersonating") return { kind: "impersonating" };
  if (visitor.owner) return { kind: "customer", customerId: visitor.owner.customerId, via: "session" };
  if (visitor.state === "verified") return { kind: "no_record", email: visitor.email ?? "" };
  if (visitor.state === "unverified") {
    return { kind: "unverified", email: visitor.email ?? "", guestCustomerId: visitor.guestCustomerId };
  }
  if (visitor.guestCustomerId) return { kind: "customer", customerId: visitor.guestCustomerId, via: "guest" };
  return { kind: "anonymous" };
}
