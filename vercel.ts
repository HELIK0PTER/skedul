import type { VercelConfig } from "@vercel/config/v1";

/**
 * Skedul — Vercel project configuration.
 *
 * Deployments are MANUAL ONLY, from the CLI:
 *   pnpm deploy:preview   → preview environment  (Neon "preview" branch)
 *   pnpm deploy:prod      → production environment (Neon "main" branch)
 *
 * `git.deploymentEnabled: false` disables Git auto-deploys on EVERY branch:
 * pushing never deploys (preview included). Deploy with the CLI only.
 *
 * `buildCommand` runs Drizzle migrations against the deployment's own
 * DATABASE_URL before building — so each environment's Neon branch is migrated
 * automatically on deploy (preview → "preview", prod → "main"). This only
 * applies on Vercel; local `pnpm build` stays plain `next build`.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm db:migrate && pnpm build",
  git: {
    deploymentEnabled: false,
  },
};
