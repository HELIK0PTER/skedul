import type { VercelConfig } from "@vercel/config/v1";

/**
 * Skedul — Vercel project configuration.
 *
 * Deployments are MANUAL ONLY, from the CLI:
 *   pnpm deploy:preview   → preview environment  (Neon "preview" branch)
 *   pnpm deploy:prod      → production environment (Neon "main" branch)
 *
 * `git.deploymentEnabled: { main: false }` keeps PRODUCTION manual: pushing
 * `main` never auto-deploys (use `pnpm deploy:prod`). Every other branch —
 * notably `preview` — auto-deploys to the Preview environment on push.
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
    deploymentEnabled: {
      main: false,
    },
  },
};
