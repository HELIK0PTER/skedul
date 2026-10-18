/**
 * Better Auth options WITHOUT server-only / env / next: src/lib/auth.ts wraps
 * them with nextCookies(); the seed and the DB tests build their own instance
 * with a `sendEmail` that captures codes (spec § 12).
 */
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { ADMIN_HTTP_ENDPOINTS, adminPlugin } from "@/lib/auth-admin";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { loginCodeEmail } from "@/lib/emails/login-code";
import { passwordDisabledEmail } from "@/lib/emails/password-disabled";
import { passwordResetEmail } from "@/lib/emails/password-reset";
import { verifyEmailCodeEmail } from "@/lib/emails/verify-email-code";
import { consumeThrottle, otpThrottleKey, resetThrottleKey } from "@/lib/throttle";
import { normalizeEmail, OTP_EMAIL_LIMIT } from "@/lib/tickets";

export type AuthMail = { to: string; subject: string; html: string };

export type AuthDeps = {
  db: Db;
  baseURL: string;
  secret: string;
  /** Never throws (src/lib/email.ts); tests capture instead of sending. */
  sendEmail: (mail: AuthMail) => Promise<unknown>;
  google?: { clientId: string; clientSecret: string } | null;
  /** Test clock for the per-e-mail code cap; defaults to the real time. */
  now?: () => Date;
  /** Mock e-mail mode: also print the password-reset link. */
  logResetLink?: boolean;
};

export const OTP_SEND_PATH = "/email-otp/send-verification-otp";
export const OTP_SIGN_IN_PATH = "/sign-in/email-otp";
export const OTP_VERIFY_EMAIL_PATH = "/email-otp/verify-email";
export const SIGN_UP_PATH = "/sign-up/email";
export const PASSWORD_SIGN_IN_PATH = "/sign-in/email";
export const CHANGE_PASSWORD_PATH = "/change-password";
/** Routes that read the password account, then insert a session (dropSessionWithoutPassword). */
export const PASSWORD_SESSION_PATHS: readonly string[] = [PASSWORD_SIGN_IN_PATH, CHANGE_PASSWORD_PATH];
export const RESET_REQUEST_PATH = "/request-password-reset";
/** The only emailOTP endpoints served over HTTP. */
export const OTP_HTTP_PATHS = [OTP_SEND_PATH, OTP_SIGN_IN_PATH, OTP_VERIFY_EMAIL_PATH] as const;

/**
 * Encrypted storage + "reuse": a resend within the 5 minutes sends the SAME
 * code, so the per-e-mail cap below never invalidates a code already sent.
 * With overrideDefaultEmailVerification the plugin's own sendVerificationOnSignUp
 * is inert: the sign-up code comes from core emailVerification.sendOnSignUp.
 */
export const OTP_PLUGIN_OPTIONS = {
  otpLength: 6,
  expiresIn: 300,
  allowedAttempts: 3,
  storeOTP: "encrypted",
  resendStrategy: "reuse",
  overrideDefaultEmailVerification: true,
} as const;

/** Every other emailOTP endpoint (reset, change e-mail, check…), derived from the plugin. */
export const OTP_DISABLED_PATHS: string[] = Object.values(
  emailOTP({ ...OTP_PLUGIN_OPTIONS, async sendVerificationOTP() {} }).endpoints,
)
  .map((endpoint) => (endpoint as { path?: string }).path)
  .filter((path): path is string => typeof path === "string")
  .filter((path) => !(OTP_HTTP_PATHS as readonly string[]).includes(path));

/**
 * Core link-verification endpoints. With overrideDefaultEmailVerification no
 * link is ever mailed, and /send-verification-email would send address codes
 * outside the per-address cap of hooks.before (only 3 per 60 s per IP).
 * Sign-up still sends its code: core sign-up calls the sender in-process.
 */
export const CORE_DISABLED_PATHS: string[] = ["/send-verification-email", "/verify-email"];

/** Closed over HTTP only; in-process `auth.api.*` calls keep working. */
export const AUTH_DISABLED_PATHS: string[] = [...ADMIN_HTTP_ENDPOINTS, ...OTP_DISABLED_PATHS, ...CORE_DISABLED_PATHS];

/**
 * Explicitly enabled so dev and tests take the production path. Stored in the
 * `rate_limit` table (per instance memory is useless on serverless); the 600 s
 * global window lets Better Auth's purge respect the custom windows (none may
 * exceed it). The last two rules cover the other endpoints that send a mail:
 * Better Auth's per-IP defaults for them (3 per 10 s, 3 per 60 s) are too short
 * to protect the e-mail quota.
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  storage: "database",
  window: 600,
  max: 6000,
  customRules: {
    [OTP_SEND_PATH]: { window: 600, max: 5 },
    [OTP_SIGN_IN_PATH]: { window: 600, max: 10 },
    [OTP_VERIFY_EMAIL_PATH]: { window: 600, max: 10 },
    [SIGN_UP_PATH]: { window: 600, max: 3 },
    [RESET_REQUEST_PATH]: { window: 600, max: 3 },
  },
} as const;

/**
 * The emailOTP `sendVerificationOTP` callback. Only these two codes are ever
 * mailed: reset and change-email by code are closed, so any other type (an
 * in-process call, a future endpoint) sends nothing.
 */
export function buildOtpMailer(sendEmail: AuthDeps["sendEmail"]) {
  return async ({ email, otp, type }: { email: string; otp: string; type: string }): Promise<void> => {
    if (type !== "sign-in" && type !== "email-verification") return;
    const mail = type === "sign-in" ? loginCodeEmail({ code: otp }) : verifyEmailCodeEmail({ code: otp });
    await sendEmail({ to: email, ...mail });
  };
}

/**
 * The address a code request counts against, lower-cased, or null when the
 * route will reject the request: a type other than sign-in / email-verification
 * (change-email, forget-password, anything else), or an e-mail that is not a
 * string, has surrounding whitespace, or fails z.email() once lower-cased (the
 * route lower-cases without trimming, then checks z.email()). hooks.before runs
 * before that validation, and a rejected request mails nothing: it must not use
 * up the victim's cap (spec § 12).
 */
export function otpCapEmail(body: { email?: unknown; type?: unknown } | undefined): string | null {
  if (body?.type !== "sign-in" && body?.type !== "email-verification") return null;
  const raw = body.email;
  if (typeof raw !== "string" || raw !== raw.trim()) return null;
  const email = raw.toLowerCase();
  return z.email().safeParse(email).success ? email : null;
}

/**
 * True for the one `user` update that marks an address verified by a sign-in
 * CODE: `/sign-in/email-otp` runs `updateUser(id, { emailVerified: true })`
 * only when the user was unverified (better-auth plugins/email-otp/routes.mjs),
 * after the code was consumed and before the session is created. Any other
 * update during that request is not the transition: for instance the admin
 * plugin's `session.create.before` writes `{ banned: false, … }` there when a
 * timed ban has expired (plugins/admin/admin.mjs), for a user who may be long
 * verified.
 */
export function isOtpVerificationTransition(
  data: Record<string, unknown>,
  ctx: { path?: string } | null | undefined,
): boolean {
  return ctx?.path === OTP_SIGN_IN_PATH && data.emailVerified === true;
}

/**
 * Deletes the password account of a still-unverified address, with every
 * session of that user, in ONE statement: both go or neither does. Returns how
 * many password accounts were deleted. `email_verified = false` is a second
 * guard against purging an address that is already confirmed.
 *
 * One batch (one transaction) that first locks the user row FOR NO KEY UPDATE:
 * the purge statement then reads a snapshot taken after that lock, and a
 * password sign-in's check (dropSessionWithoutPassword, FOR SHARE on the same
 * row) waits until the purge commits, so it sees the password account gone.
 */
async function purgeUnverifiedPassword(db: Db, email: string): Promise<number> {
  const [, result] = await db.batch([
    db.execute(sql`select id from "user" where email = ${email} for no key update`),
    db.execute<{ purged: number }>(sql`
      with gone as (
        delete from account
        where provider_id = 'credential'
          and user_id in (select id from "user" where email = ${email} and email_verified = false)
        returning user_id
      ), ended as (
        delete from session where user_id in (select user_id from gone) returning id
      )
      select count(*)::int as purged from gone`),
  ]);
  return Number(result.rows[0]?.purged ?? 0);
}

/**
 * The other half of the takeover fix (spec § 12): a password sign-in (or a
 * password change that revokes the other sessions) reads the password account,
 * checks the password (scrypt), then inserts its session. If
 * a code sign-in purged that account in between, the purge could not see the
 * session, which would survive on the now-verified user. Run after the insert:
 * locks the user row FOR SHARE (waits for a purge in progress), then deletes
 * this session when the user has no password account any more. True = deleted.
 */
async function dropSessionWithoutPassword(db: Db, session: { id: string; userId: string }): Promise<boolean> {
  const [, gone] = await db.batch([
    db.execute(sql`select id from "user" where id = ${session.userId} for share`),
    db.execute<{ id: string }>(sql`
      delete from session where id = ${session.id}
        and not exists (select 1 from account where user_id = ${session.userId} and provider_id = 'credential')
      returning id`),
  ]);
  return gone.rows.length > 0;
}

export function buildAuthOptions(deps: AuthDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  const otpPlugin = emailOTP({
    ...OTP_PLUGIN_OPTIONS,
    sendVerificationOTP: buildOtpMailer(deps.sendEmail),
  });

  return {
    appName: "Skedul",
    baseURL: deps.baseURL,
    secret: deps.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      // "Mot de passe oublié" → /forgot-password. The link is single-use and
      // expires after one hour. Better Auth answers the same way whether or not
      // the email has an account; sendEmail never throws, so a send failure
      // cannot reveal which addresses exist either.
      resetPasswordTokenExpiresIn: 60 * 60,
      // Per-address cap (5 reset mails an hour, own counter so that reset spam
      // cannot block the sign-in codes), taken HERE and not in hooks.before: this
      // runs only once the endpoint has validated the request and found the
      // account, so only the mails we try to send count (a Resend failure counts
      // too) and a bad request cannot burn the victim's cap. Past the cap
      // nothing is sent and nothing is thrown, so the
      // endpoint answers like for any valid request. If the counter itself
      // throws, no mail goes out (closed); Better Auth's runInBackgroundOrAwait
      // catches and logs the error, so the answer does not change either.
      sendResetPassword: async ({ user, url }) => {
        if (!(await consumeThrottle(db, resetThrottleKey(user.email), OTP_EMAIL_LIMIT, now()))) return;
        await deps.sendEmail({
          to: user.email,
          subject: "Réinitialisez votre mot de passe Skedul",
          html: passwordResetEmail({ name: user.name, url }),
        });
        if (deps.logResetLink) console.info(`   reset link: ${url}\n`);
      },
      // A reset may come from someone who had the old password: end every session.
      revokeSessionsOnPasswordReset: true,
      // Using the emailed link proves the user owns the address, so Google
      // sign-in can then link to this account without the /link-google detour.
      onPasswordReset: async ({ user }) => {
        try {
          await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
        } catch (err) {
          console.error("[auth] could not mark the email verified after reset", err);
        }
      },
    },
    // A password sign-up gets a CODE (the plugin overrides the default link).
    emailVerification: { sendOnSignUp: true },
    socialProviders: deps.google
      ? {
          google: {
            clientId: deps.google.clientId,
            clientSecret: deps.google.clientSecret,
            // Force Google to return a refresh_token even on re-consent.
            accessType: "offline",
            prompt: "select_account consent",
          },
        }
      : undefined,
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "client", input: false },
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    rateLimit: AUTH_RATE_LIMIT,
    hooks: {
      // Per-address cap on sign-in / confirmation codes (5 an hour). Past it,
      // answer like a send BEFORE the endpoint runs: no new code is generated,
      // the live one stays valid. (The reset-mail cap is in sendResetPassword.)
      // Only a request the route will mail counts: one it rejects (otpCapEmail)
      // or a confirmation code for an address without an account (the route
      // answers 200 and mails nothing) would silently lock the address out.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== OTP_SEND_PATH) return;
        const body = ctx.body as { email?: unknown; type?: unknown } | undefined;
        // Reset by code is closed (OTP_DISABLED_PATHS): never mail a forget-password code.
        if (body?.type === "forget-password") return ctx.json({ success: true });
        const email = otpCapEmail(body);
        if (email === null) return;
        if (body?.type === "email-verification") {
          const found = await db.execute<{ found: boolean }>(sql`select exists (select 1 from "user" where email = ${email}) as found`);
          if (found.rows[0]?.found !== true) return;
        }
        const allowed = await consumeThrottle(db, otpThrottleKey(email), OTP_EMAIL_LIMIT, now());
        if (!allowed) return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // A password sign-in, or a password change that revokes the other
          // sessions, first checks that its password account still exists
          // (dropSessionWithoutPassword): if a code sign-in purged it meanwhile,
          // the session is deleted and the request fails (closed; a failing
          // check fails it too). Then "Dernière connexion" (real
          // sign-ins only, not impersonation), then best-effort link of this
          // verified address's customer rows, all pros. Two separate best-effort
          // steps: a failed stamp must not skip the link.
          after: async (session, ctx) => {
            if (
              ctx?.path !== undefined &&
              PASSWORD_SESSION_PATHS.includes(ctx.path) &&
              (await dropSessionWithoutPassword(db, session))
            ) {
              throw new Error("[auth] password session refused: the password account was removed meanwhile");
            }
            if (session.impersonatedBy) return;
            try {
              await db.update(schema.user).set({ lastLoginAt: new Date() }).where(eq(schema.user.id, session.userId));
            } catch (err) {
              console.error("[auth] could not stamp last_login_at", err);
            }
            try {
              const [u] = await db
                .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId));
              if (u?.emailVerified) {
                await db
                  .update(schema.customer)
                  .set({ userId: session.userId })
                  .where(and(eq(schema.customer.email, normalizeEmail(u.email)), isNull(schema.customer.userId)));
              }
            } catch (err) {
              console.error("[auth] could not link the customer rows to the user", err);
            }
          },
        },
      },
      user: {
        update: {
          // Pre-account takeover fix (spec § 12): a sign-in CODE on an unverified
          // address proves it, but the password account on it was set by whoever
          // signed up, so it is deleted with every session, BEFORE the address is
          // marked verified (the new session does not exist yet: the route runs
          // updateUser, then createSession). Fail-closed: if the purge throws,
          // the update aborts and the user stays unverified, so the next code
          // sign-in runs the purge again. The mail is best-effort and comes
          // only once the purge succeeded.
          before: async (data, ctx) => {
            if (!isOtpVerificationTransition(data, ctx)) return;
            // The route itself looks the user up by `email.toLowerCase()`. Without
            // an e-mail the purge cannot target anyone: fail closed, never skip it.
            const raw = (ctx?.body as { email?: unknown } | undefined)?.email;
            if (typeof raw !== "string") throw new Error("[auth] code sign-in without an e-mail: refusing to verify the address");
            const email = raw.toLowerCase();
            const purged = await purgeUnverifiedPassword(db, email);
            if (purged === 0) return;
            try {
              await deps.sendEmail({ to: email, ...passwordDisabledEmail({ forgotPasswordUrl: `${deps.baseURL}/forgot-password` }) });
            } catch (err) {
              console.error("[auth] could not send the password-disabled e-mail", err);
            }
          },
        },
      },
    },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: [adminPlugin, otpPlugin],
  } satisfies BetterAuthOptions;
}
