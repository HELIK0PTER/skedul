import "./load-env";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { neon } from "@neondatabase/serverless";

/**
 * Applies one drizzle migration over Neon's HTTP driver — a stand-in for
 * `pnpm db:migrate`, whose connection fails on some Windows machines.
 * Every statement of the file and its row in drizzle's journal are submitted as
 * one non-interactive transaction (`sql.transaction`): all-or-nothing, so a
 * failing statement leaves the database untouched, and once the row is
 * recorded a later `db:migrate` skips the file. Like `db:migrate`, it cannot
 * run statements that refuse a transaction block (e.g. CREATE INDEX CONCURRENTLY).
 *
 * Guard: drizzle only compares `created_at` with the latest recorded row, so
 * recording a migration also marks every earlier one as applied. It therefore
 * refuses to run unless the journal entry right before the target is the latest
 * one recorded on the database. The target host is printed first so a wrong
 * DATABASE_URL (preview/prod instead of dev) is obvious before anything runs.
 *
 *   pnpm db:apply drizzle/0006_xxx.sql
 */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: pnpm db:apply drizzle/<migration>.sql");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  console.info(`→ ${new URL(process.env.DATABASE_URL).host}`);

  const sql = neon(process.env.DATABASE_URL);
  const content = readFileSync(file, "utf8");
  const tag = basename(file, ".sql");
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const index = journal.entries.findIndex((e) => e.tag === tag);
  if (index === -1) throw new Error(`${tag} is not in drizzle/meta/_journal.json`);
  const entry = journal.entries[index];

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

  if (index > 0) {
    const previous = journal.entries[index - 1];
    const [latest] = await sql.query(
      `select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const latestWhen = latest ? Number(latest.created_at) : null;
    if (latestWhen !== previous.when) {
      const latestTag =
        journal.entries.find((e) => e.when === latestWhen)?.tag ??
        (latest ? `an unknown migration (created_at ${latest.created_at})` : "none");
      console.error(
        `✗ Refusing to apply ${tag}: the latest migration recorded on this database is ${latestTag}, not ${previous.tag}.\n` +
          `  Earlier migrations are missing: apply them first (in order), or use \`pnpm db:migrate\`.`,
      );
      process.exit(1);
    }
  }

  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  // drizzle only compares created_at with the latest row, so recording this one
  // also marks every earlier migration as applied.
  const hash = createHash("sha256").update(content).digest("hex");

  // Statements first, journal row last. sql.query() only builds a lazy query:
  // nothing is sent until sql.transaction() submits the whole batch in a single
  // request that Postgres commits entirely or rolls back entirely.
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement)),
    sql.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [hash, entry.when],
    ),
  ]);

  for (const statement of statements) {
    console.info(`✓ ${statement.split("\n")[0]}`);
  }
  console.info(`✓ ${tag} applied and recorded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
