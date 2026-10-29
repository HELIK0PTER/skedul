import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";

import { buildAuthOptions } from "@/lib/auth-options";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * Better Auth's background work (the mail sends, its rate-limit cleanup) runs after the answer (P6 A3: a password-reset
 * request answers in the same time for an account and for an unknown address). The task has already started: outside
 * a request scope, where after() throws, it simply runs on (Better Auth has wrapped it in a catch that logs).
 */
function runAfterResponse(task: Promise<unknown>): void {
  try {
    after(() => task);
  } catch {
    // No request scope: the task is already running, nothing to schedule.
  }
}

const options = buildAuthOptions({
  db,
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  sendEmail,
  google: env.GOOGLE_CALENDAR_ENABLED
    ? { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }
    : null,
  // A production build (a preview deployment without Resend included) never prints the single-use reset token.
  logResetLink: !env.RESEND_ENABLED && process.env.NODE_ENV !== "production",
  backgroundTasks: runAfterResponse,
});

// nextCookies() must stay the last plugin so it can set cookies in actions.
export const auth = betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] });

export type Session = typeof auth.$Infer.Session;
