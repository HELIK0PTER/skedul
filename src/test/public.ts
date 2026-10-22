/**
 * Test helpers of the public side (P4). Not a test file: never named *.test.ts.
 * Identity helpers first (Task 5); the action plumbing helpers follow (Task 7).
 */
import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";

import type { SessionFacts } from "../lib/public/identity";
import type { Db } from "./db";

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
