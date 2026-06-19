import type { VercelConfig } from "@vercel/config/v1";

/**
 * Skedul — Vercel project configuration.
 *
 * Deployments are MANUAL ONLY, from the CLI:
 *   pnpm deploy:preview   → preview environment  (Neon "preview" branch)
 *   pnpm deploy:prod      → production environment (Neon "main" branch)
 *
 * `git.deploymentEnabled: false` disables every automatic Git-triggered
 * deployment (push / PR) on all branches. It does NOT affect `vercel deploy`,
 * so you stay in full control from the CLI.
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
