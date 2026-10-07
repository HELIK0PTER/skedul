import "./load-env";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { neon } from "@neondatabase/serverless";

/**
 * Applies one drizzle migration over Neon's HTTP driver — a stand-in for
 * `pnpm db:migrate`, whose connection fails on some Windows machines.
 * Statements run one by one (neon-http has no transactions), then the file is
 * recorded in drizzle's journal so a later `db:migrate` skips it.
 *
 *   pnpm db:apply drizzle/0006_xxx.sql
 */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: pnpm db:apply drizzle/<migration>.sql");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const sql = neon(process.env.DATABASE_URL);
  const content = readFileSync(file, "utf8");
  const tag = basename(file, ".sql");
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) throw new Error(`${tag} is not in drizzle/meta/_journal.json`);

  await sql.query(`create schema if not exists drizzle`);
  await sql.query(
    `create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
  );
  const applied = await sql.query(
    `select 1 from drizzle.__drizzle_migrations where created_at = $1`,
    [entry.when],
  );
  if (applied.length > 0) {
    console.info(`= ${tag} already applied, nothing to do.`);
    return;
  }

  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await sql.query(statement);
    console.info(`✓ ${statement.split("\n")[0]}`);
  }

  // drizzle only compares created_at with the latest row, so this also marks
  // every earlier migration as applied.
  const hash = createHash("sha256").update(content).digest("hex");
  await sql.query(
    `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
    [hash, entry.when],
  );
  console.info(`✓ ${tag} applied and recorded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
