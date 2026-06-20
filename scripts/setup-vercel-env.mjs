#!/usr/bin/env node
/**
 * Pushes environment variables to Vercel, per environment, from
 * `.env.vercel-reference`. Run after `vercel link`.
 *
 *   node scripts/setup-vercel-env.mjs            # all envs
 *   node scripts/setup-vercel-env.mjs production # one env
 *
 * Requires the Vercel CLI (`npm i -g vercel`) and a linked project.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REF = ".env.vercel-reference";
const ENVS = ["production", "preview", "development"];
const only = process.argv[2];

function parse(content) {
  const sections = {};
  let current = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[(\w+)\]$/);
    if (section) {
      current = section[1];
      sections[current] = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (current && eq > 0) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      sections[current][key] = value;
    }
  }
  return sections;
}

function pushVar(key, value, env) {
  // Remove an existing value first (ignore failure), then add.
  spawnSync("vercel", ["env", "rm", key, env, "-y"], {
    stdio: "ignore",
    shell: true,
  });
  // `--yes` is required for the "preview" target to default to all preview
  // branches non-interactively (otherwise the CLI asks for a git branch).
  const res = spawnSync("vercel", ["env", "add", key, env, "--yes"], {
    input: value + "\n",
    stdio: ["pipe", "inherit", "inherit"],
    shell: true,
  });
  console.log(
    `${res.status === 0 ? "✓" : "✗"} ${env.padEnd(11)} ${key}`,
  );
}

const sections = parse(readFileSync(REF, "utf8"));
for (const env of ENVS) {
  if (only && only !== env) continue;
  const vars = sections[env];
  if (!vars) {
    console.warn(`! no [${env}] section in ${REF}`);
    continue;
  }
  console.log(`\n=== ${env} ===`);
  for (const [key, value] of Object.entries(vars)) {
    pushVar(key, value, env);
  }
}
console.log("\nDone. Re-deploy for changes to take effect: vercel --prod");
