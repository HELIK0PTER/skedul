import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
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
  plugins: [
    // Roles, suspension, impersonation. defaultRole must be a user_role enum
    // value — the plugin's own default ("user") would violate the enum.
    admin({
      defaultRole: "client",
      adminRoles: ["admin"],
      bannedUserMessage:
        "Votre compte a été suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
    }),
    // nextCookies() must be the last plugin so it can set cookies in actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
