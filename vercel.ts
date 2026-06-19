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
 */
export const config: VercelConfig = {
  framework: "nextjs",
  git: {
    deploymentEnabled: false,
  },
};
