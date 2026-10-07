import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * The admin plugin also serves these over HTTP (/api/auth/admin/*), authorised
 * from the 5-minute cookie-cached role. Admin actions go through the server
 * actions in src/server/admin.ts (stricter, DB-fresh checks, no delete or
 * set-password), so the raw endpoints would bypass them: close them. This only
 * affects the HTTP router; in-process `auth.api.*` calls keep working.
 */
const ADMIN_HTTP_ENDPOINTS = [
  "/admin/set-role",
  "/admin/get-user",
  "/admin/create-user",
  "/admin/update-user",
  "/admin/list-users",
  "/admin/list-user-sessions",
  "/admin/unban-user",
  "/admin/ban-user",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/has-permission",
];

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
  disabledPaths: ADMIN_HTTP_ENDPOINTS,
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
