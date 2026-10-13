/**
 * Better Auth test instance + cookie-jar browser for the auth DB tests (T12,
 * T13, T15 and the takeover/caps regressions). Calls go through
 * `auth.handler`, like HTTP, so the whole route runs as in production: the
 * `hooks.before` middleware, the rate limiter, and the database hooks around
 * each write. In particular the takeover purge runs in
 * `databaseHooks.user.update.before` of the `/sign-in/email-otp` route: after
 * the code was consumed, before the address is marked verified and before the
 * sign-in's session is created (spec § 12). Never named *.test.ts.
 */
import { betterAuth } from "better-auth";
import { sql } from "drizzle-orm";

import { buildAuthOptions, type AuthDeps, type AuthMail } from "../lib/auth-options";
import { textArray, type Db } from "../lib/db/atomic";
import { testIp } from "./db";

/** http (not https): cookies carry no __Secure- prefix; nothing listens there. */
export const TEST_BASE_URL = "http://localhost:3000";

/** Codes lead the subject (src/lib/emails/login-code.ts, verify-email-code.ts). */
const CODE_RE = /^(\d{6})\b/;

function buildInstance(db: Db, sendEmail: AuthDeps["sendEmail"]) {
  return betterAuth(
    buildAuthOptions({
      db,
      baseURL: TEST_BASE_URL,
      secret: process.env.BETTER_AUTH_SECRET ?? "test-secret-0123456789abcdefghijklmnop",
      sendEmail,
    }),
  );
}

/** The instance type with its plugins (a bare ReturnType<typeof betterAuth> rejects it). */
export type TestAuthInstance = ReturnType<typeof buildInstance>;

export type TestAuth = {
  auth: TestAuthInstance;
  /** every e-mail the instance sent, in order */
  mails: AuthMail[];
  /** the 6-digit code of the last code e-mail sent to `email` */
  lastCode(email: string): string | undefined;
};

export function makeTestAuth(db: Db): TestAuth {
  const mails: AuthMail[] = [];
  const auth = buildInstance(db, async (mail) => {
    mails.push(mail);
  });
  return {
    auth,
    mails,
    lastCode(email) {
      const to = email.toLowerCase();
      for (let i = mails.length - 1; i >= 0; i--) {
        const code = CODE_RE.exec(mails[i].subject)?.[1];
        if (code && mails[i].to.toLowerCase() === to) return code;
      }
      return undefined;
    },
  };
}

export type BrowserCall = (
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: Record<string, unknown> | null }>;

/** A body that is not a JSON object (404 "Not Found", `null`) reads as null. */
function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * One cookie jar = one browser. Origin = TEST_BASE_URL (passes the CSRF
 * origin check); x-forwarded-for = `ip`, a fresh random one by default, so
 * every browser gets its own Better Auth rate-limit buckets. GET when `body`
 * is undefined, else a JSON POST.
 */
export function browser(t: TestAuth, ip: string = testIp()): BrowserCall {
  const jar = new Map<string, string>();
  return async (path, body) => {
    const headers = new Headers({ origin: TEST_BASE_URL, "x-forwarded-for": ip });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await t.auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    return { status: res.status, json: parseJson(await res.text()) };
  };
}

/** The auth tests create users outside dbTest: one DELETE FROM "user" (sessions and accounts cascade). */
export async function deleteUsersByEmail(db: Db, emails: readonly string[]): Promise<void> {
  if (emails.length === 0) return;
  await db.execute(sql`delete from "user" where email = any(${textArray(emails.map((e) => e.toLowerCase()))})`);
}
