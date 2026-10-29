/**
 * Boot refusals of the environment (SEC-I5, SEC-M5), kept apart from env.ts so
 * they are tested without loading it (env.ts reads process.env at import).
 * Pure: no env, no I/O.
 */

const BETTER_AUTH_SECRET_MIN_LENGTH = 32;

/** Boot refusals, in this order: VERCEL_ENV "production" with APP_ENV not "production" → "APP_ENV must be production on a Vercel production deployment"; APP_ENV "production" with BETTER_AUTH_SECRET under 32 characters → "BETTER_AUTH_SECRET must be at least 32 characters in production". [] when none. */
export function envBootErrors(raw: { VERCEL_ENV?: string; APP_ENV: string; BETTER_AUTH_SECRET: string }): string[] {
  const errors: string[] = [];
  if (raw.VERCEL_ENV === "production" && raw.APP_ENV !== "production") {
    errors.push("APP_ENV must be production on a Vercel production deployment");
  }
  if (raw.APP_ENV === "production" && raw.BETTER_AUTH_SECRET.length < BETTER_AUTH_SECRET_MIN_LENGTH) {
    errors.push("BETTER_AUTH_SECRET must be at least 32 characters in production");
  }
  return errors;
}
