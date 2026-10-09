import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { ADMIN_HTTP_ENDPOINTS, adminPlugin } from "@/lib/auth-admin";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { passwordResetEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

export const auth = betterAuth({
  appName: "Skedul",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    // "Mot de passe oublié" → /forgot-password. The link is single-use and
    // expires after one hour. Better Auth answers the same way whether or not
    // the email has an account, so never let a send failure surface either.
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendEmail({
          to: user.email,
          subject: "Réinitialisez votre mot de passe Skedul",
          html: passwordResetEmail({ name: user.name, url }),
        });
        if (!env.RESEND_ENABLED) console.info(`   reset link: ${url}\n`);
      } catch (err) {
        console.error("[auth] could not send the password reset email", err);
      }
    },
    // A reset may come from someone who had the old password: end every session.
    revokeSessionsOnPasswordReset: true,
    // Using the emailed link proves the user owns the address, so Google
    // sign-in can then link to this account without the /link-google detour.
    onPasswordReset: async ({ user }) => {
      try {
        await db
          .update(schema.user)
          .set({ emailVerified: true })
          .where(eq(schema.user.id, user.id));
      } catch (err) {
        console.error("[auth] could not mark the email verified after reset", err);
      }
    },
  },
  socialProviders: env.GOOGLE_CALENDAR_ENABLED
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          // Force Google to return a refresh_token even on re-consent.
          accessType: "offline",
          prompt: "select_account consent",
        },
      }
    : undefined,
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "client",
        input: false,
      },
    },
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  databaseHooks: {
    session: {
      create: {
        // "Dernière connexion": real sign-ins only, not admin impersonation.
        after: async (session) => {
          if (session.impersonatedBy) return;
          try {
            await db
              .update(schema.user)
              .set({ lastLoginAt: new Date() })
              .where(eq(schema.user.id, session.userId));
          } catch (err) {
            console.error("[auth] could not stamp last_login_at", err);
          }
        },
      },
    },
  },
  disabledPaths: ADMIN_HTTP_ENDPOINTS,
  plugins: [
    adminPlugin,
    // nextCookies() must be the last plugin so it can set cookies in actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
