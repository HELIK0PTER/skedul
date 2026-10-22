import { z } from "zod";

import { CRON_SECRET_MIN_LENGTH } from "@/lib/cron-auth";
import { envBootErrors } from "@/lib/env-checks";

/**
 * Server-side environment validation.
 * Imported by server modules only (db, auth, stripe, email, scripts).
 * Client code should read NEXT_PUBLIC_* vars directly.
 */
const schema = z.object({
  APP_ENV: z
    .enum(["development", "preview", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Skedul <onboarding@resend.dev>"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // dedicated private store for support screenshots (Vercel prefix SUPPORT_BLOB)
  SUPPORT_BLOB_READ_WRITE_TOKEN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // bearer secret of the nightly job (Vercel Cron): /api/cron/daily answers 401 without it; 32 characters at least
  CRON_SECRET: z.string().optional(),
  // Provided automatically by Vercel
  VERCEL_URL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    z.flattenError(parsed.error).fieldErrors,
  );
  throw new Error("Invalid environment variables");
}

const raw = parsed.data;

// Boot refusals (SEC-I5, SEC-M5), thrown at boot and at build, never silent: a Vercel production deployment must run with
// APP_ENV=production (the mock checkout and the mock mail key off it), and production needs a session secret of 32
// characters at least. A local build has no VERCEL_ENV.
const bootErrors = envBootErrors({
  VERCEL_ENV: process.env.VERCEL_ENV,
  APP_ENV: raw.APP_ENV,
  BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
});
if (bootErrors.length > 0) throw new Error(bootErrors[0]);

/** A key is considered "not configured" when it is missing or still a placeholder. */
function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return (
    value.includes("xxx") ||
    value.endsWith("...") ||
    value.trim() === ""
  );
}

/** Canonical, absolute app URL for the current deployment. */
export function getAppUrl(): string {
  if (raw.NEXT_PUBLIC_APP_URL) return raw.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (raw.BETTER_AUTH_URL) return raw.BETTER_AUTH_URL.replace(/\/$/, "");
  if (raw.VERCEL_URL) return `https://${raw.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const env = {
  ...raw,
  APP_URL: getAppUrl(),
  /** Stripe runs in mock mode until a real secret key is provided. */
  STRIPE_ENABLED: !isPlaceholder(raw.STRIPE_SECRET_KEY),
  /** Webhook signing secret present (needed to confirm live Stripe payments). */
  STRIPE_WEBHOOK_CONFIGURED: !isPlaceholder(raw.STRIPE_WEBHOOK_SECRET),
  /** Nightly-job secret present, not a placeholder and at least CRON_SECRET_MIN_LENGTH characters (SEC-M5): otherwise /api/cron/daily answers 401. */
  CRON_CONFIGURED: !isPlaceholder(raw.CRON_SECRET) && (raw.CRON_SECRET?.length ?? 0) >= CRON_SECRET_MIN_LENGTH,
  /** Resend logs to the console until a real API key is provided. */
  RESEND_ENABLED: !isPlaceholder(raw.RESEND_API_KEY),
  /** Image uploads use Vercel Blob; disabled (mock) until a token is provided. */
  BLOB_ENABLED: !isPlaceholder(raw.BLOB_READ_WRITE_TOKEN),
  /** Support screenshots: private Blob store, separate from the public branding one. */
  SUPPORT_BLOB_ENABLED: !isPlaceholder(raw.SUPPORT_BLOB_READ_WRITE_TOKEN),
  /**
   * A Google OAuth client is configured: enables both "Continuer avec Google"
   * on sign-in/sign-up and the Google Calendar sync (same Better Auth provider).
   */
  GOOGLE_CALENDAR_ENABLED:
    !isPlaceholder(raw.GOOGLE_CLIENT_ID) &&
    !isPlaceholder(raw.GOOGLE_CLIENT_SECRET),
};

export type Env = typeof env;
