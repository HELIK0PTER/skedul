#!/usr/bin/env node
/**
 * Manual PREVIEW deployment.
 * Deploys to Vercel's Preview environment, then aliases the resulting
 * deployment to the stable preview domain. Fully manual — never triggered
 * by git push (vercel.ts sets git.deploymentEnabled=false).
 *
 *   pnpm deploy:preview
 */
import { execSync } from "node:child_process";

const PREVIEW_DOMAIN = "preview.myskedul.com";

console.log("▲ Deploying to Preview…");
const out = execSync("vercel deploy", { encoding: "utf8" });
const url = out.trim().split(/\s+/).pop();

if (!url || !url.startsWith("https://")) {
  console.error("✗ Could not parse the deployment URL from:\n" + out);
  process.exit(1);
}

console.log(`Aliasing ${url} → ${PREVIEW_DOMAIN}`);
execSync(`vercel alias set ${url} ${PREVIEW_DOMAIN}`, { stdio: "inherit" });
console.log(`\n✅ Preview en ligne : https://${PREVIEW_DOMAIN}`);
