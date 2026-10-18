import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { buildAuthOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const options = buildAuthOptions({
  db,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  sendEmail,
  google: env.GOOGLE_CALENDAR_ENABLED
    ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
    : null,
  logResetLink: !env.RESEND_ENABLED,
});

// nextCookies() must stay the last plugin so it can set cookies in actions.
export const auth = betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] });

export type Session = typeof auth.$Infer.Session;
