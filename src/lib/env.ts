import { z } from "zod";

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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
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
  /** Resend logs to the console until a real API key is provided. */
  RESEND_ENABLED: !isPlaceholder(raw.RESEND_API_KEY),
  /** Image uploads use Vercel Blob; disabled (mock) until a token is provided. */
  BLOB_ENABLED: !isPlaceholder(raw.BLOB_READ_WRITE_TOKEN),
  /** Google Calendar sync is live once an OAuth client is configured. */
  GOOGLE_CALENDAR_ENABLED:
    !isPlaceholder(raw.GOOGLE_CLIENT_ID) &&
    !isPlaceholder(raw.GOOGLE_CLIENT_SECRET),
};

export type Env = typeof env;
