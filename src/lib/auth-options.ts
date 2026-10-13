/**
 * Better Auth options WITHOUT server-only / env / next: src/lib/auth.ts wraps
 * them with nextCookies(); the seed and the DB tests build their own instance
 * with a `sendEmail` that captures codes (spec § 12).
 */
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { and, eq, isNull, ne } from "drizzle-orm";

import { ADMIN_HTTP_ENDPOINTS, adminPlugin } from "@/lib/auth-admin";
import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { loginCodeEmail } from "@/lib/emails/login-code";
import { passwordDisabledEmail } from "@/lib/emails/password-disabled";
import { passwordResetEmail } from "@/lib/emails/password-reset";
import { verifyEmailCodeEmail } from "@/lib/emails/verify-email-code";
import { consumeThrottle, otpThrottleKey } from "@/lib/throttle";
import { OTP_EMAIL_LIMIT } from "@/lib/tickets";

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
 * global window lets Better Auth's purge respect the custom windows.
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
  },
} as const;

export function buildAuthOptions(deps: AuthDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  const otpPlugin = emailOTP({
    ...OTP_PLUGIN_OPTIONS,
    async sendVerificationOTP({ email, otp, type }) {
      // Only these two codes are ever mailed: reset and change-email by code are closed.
      if (type !== "sign-in" && type !== "email-verification") return;
      const mail = type === "sign-in" ? loginCodeEmail({ code: otp }) : verifyEmailCodeEmail({ code: otp });
      await deps.sendEmail({ to: email, ...mail });
    },
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
      sendResetPassword: async ({ user, url }) => {
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
      // Per-address cap (5 codes an hour). Past it, answer like a send BEFORE
      // the endpoint runs: no new code is generated, the live one stays valid.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== OTP_SEND_PATH) return;
        const body = ctx.body as { email?: unknown; type?: unknown } | undefined;
        // Reset by code is closed (OTP_DISABLED_PATHS): never mail a forget-password code.
        if (body?.type === "forget-password") return ctx.json({ success: true });
        const raw = body?.email;
        if (typeof raw !== "string") return;
        const allowed = await consumeThrottle(db, otpThrottleKey(raw), OTP_EMAIL_LIMIT, now());
        if (!allowed) return ctx.json({ success: true });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // "Dernière connexion" (real sign-ins only, not impersonation), then
          // best-effort link of this verified address's customer rows, all pros.
          after: async (session) => {
            if (session.impersonatedBy) return;
            try {
              await db.update(schema.user).set({ lastLoginAt: new Date() }).where(eq(schema.user.id, session.userId));
              const [u] = await db
                .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId));
              if (u?.emailVerified) {
                await db
                  .update(schema.customer)
                  .set({ userId: session.userId })
                  .where(and(eq(schema.customer.email, u.email.toLowerCase()), isNull(schema.customer.userId)));
              }
            } catch (err) {
              console.error("[auth] session hook failed", err);
            }
          },
        },
      },
      user: {
        update: {
          // Pre-account takeover fix (spec § 12): the first sign-in CODE on an
          // unverified password account proves the address; the password was
          // set by whoever signed up, so it is deleted, with every other
          // session. Over HTTP this runs after the endpoint, so newSession is set.
          after: async (user, ctx) => {
            if (ctx?.path !== OTP_SIGN_IN_PATH || !user.emailVerified) return;
            try {
              const credential = and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential"));
              const found = await db.select({ id: schema.account.id }).from(schema.account).where(credential);
              if (found.length === 0) return;
              const keep = ctx.context.newSession?.session.id ?? null;
              await db.delete(schema.account).where(credential);
              await db
                .delete(schema.session)
                .where(keep ? and(eq(schema.session.userId, user.id), ne(schema.session.id, keep)) : eq(schema.session.userId, user.id));
              await deps.sendEmail({ to: user.email, ...passwordDisabledEmail({ forgotPasswordUrl: `${deps.baseURL}/forgot-password` }) });
            } catch (err) {
              console.error("[auth] pre-account takeover purge failed", err);
            }
          },
        },
      },
    },
    disabledPaths: AUTH_DISABLED_PATHS,
    plugins: [adminPlugin, otpPlugin],
  } satisfies BetterAuthOptions;
}
