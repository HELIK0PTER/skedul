/**
 * Test helpers of the public side (P4). Not a test file: never named *.test.ts.
 * Identity helpers first (Task 5); the action plumbing helpers follow (Task 7).
 */
import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";

import type { CheckoutCloseOutcome, CheckoutGateway, CheckoutRequest, PaymentMode } from "../lib/payments/checkout";
import { publicProOfRow, type ActionVisitor, type PublicDeps, type PublicPro } from "../lib/public/context";
import type { SessionFacts } from "../lib/public/identity";
import type { Db, TestPro } from "./db";

/** 32 random lowercase hex characters: a valid ipHash (IP_HASH_RE), a fresh throttle bucket for every call. */
export function testIpHash(): string {
  return randomBytes(16).toString("hex");
}

/** A `client` user row (verified or not), deleted by the caller with deleteTestUser. */
export async function createTestClientUser(
  db: Db,
  opts: { email: string; name?: string; verified: boolean },
): Promise<{ userId: string }> {
  const schema = await import("../lib/db/schema");
  const userId = nanoid();
  await db.insert(schema.user).values({
    id: userId,
    name: opts.name ?? "Client test",
    email: opts.email.trim().toLowerCase(),
    emailVerified: opts.verified,
    role: "client",
  });
  return { userId };
}

/** The facts of a signed-in client: verified unless `verified: false`; impersonated gives the fixed fake admin id "admin-test". */
export function sessionOf(
  u: { userId: string; email: string; name?: string },
  opts: { verified?: boolean; impersonated?: boolean } = {},
): SessionFacts {
  const impersonated = opts.impersonated === true;
  return {
    userId: u.userId,
    email: u.email,
    name: u.name ?? "Client test",
    emailVerified: opts.verified ?? true,
    impersonated,
    impersonatedBy: impersonated ? "admin-test" : null,
  };
}

/** The PublicPro of a test pro (reads its row, like resolvePublicPro does). */
export async function publicProOf(db: Db, pro: TestPro): Promise<PublicPro> {
  const schema = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select().from(schema.professional).where(eq(schema.professional.id, pro.proId));
  if (!row) throw new Error(`publicProOf: professional ${pro.proId} not found`);
  return publicProOfRow(row);
}

/** An ActionVisitor; defaults: no session, no owner, no guest, a fresh testIpHash(), wideIpHash null. */
export function actionVisitorOf(opts: Partial<ActionVisitor> = {}): ActionVisitor {
  return { session: null, owner: null, guestCustomerId: null, ipHash: testIpHash(), wideIpHash: null, ...opts };
}

export type FakeCheckout = CheckoutGateway & {
  created: CheckoutRequest[];
  expired: string[];
  closed: string[];
  failCreate: boolean;
  closeOutcome: CheckoutCloseOutcome;
  /** test hook run inside create, before it answers (e.g. expire the purchase to make the attach fail) */
  onCreate?: (req: CheckoutRequest) => Promise<void>;
};

/**
 * A recording gateway, never the network: create records the request, throws when failCreate, runs onCreate, then
 * returns { sessionId: `cs_test_fake_${purchaseId}`, url: `https://checkout.test/${purchaseId}` }; closeForRelease
 * records the session id and returns closeOutcome (default "expired"); expire records the session id.
 */
export function fakeCheckout(mode: PaymentMode = "test"): FakeCheckout {
  const fake: FakeCheckout = {
    mode,
    created: [],
    expired: [],
    closed: [],
    failCreate: false,
    closeOutcome: "expired",
    async create(req) {
      fake.created.push(req);
      if (fake.failCreate) throw new Error("fake checkout: create failed");
      await fake.onCreate?.(req);
      return { sessionId: `cs_test_fake_${req.purchaseId}`, url: `https://checkout.test/${req.purchaseId}` };
    },
    async closeForRelease(sessionId) {
      fake.closed.push(sessionId);
      return fake.closeOutcome;
    },
    async expire(sessionId) {
      fake.expired.push(sessionId);
    },
  };
  return fake;
}

/** The PublicDeps of a test; defaults: appUrl "https://app.test", env "test", the simulated checkout not allowed. */
export function publicDepsOf(
  checkout: CheckoutGateway,
  opts: { mockAllowed?: boolean; appUrl?: string; env?: string } = {},
): PublicDeps {
  return {
    appUrl: opts.appUrl ?? "https://app.test",
    checkout,
    mockAllowed: opts.mockAllowed ?? false,
    env: opts.env ?? "test",
  };
}
