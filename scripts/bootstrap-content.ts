import "./load-env";

import { db } from "@/lib/db";

import { bootstrapCatalog } from "./content/apply-catalog";

/**
 * Creates the Altinha catalog ONLY (types, offers, events with their links,
 * questions and séances, RDV hours, booking settings) on an existing pro
 * page that has no domain data yet (spec § 15.4). No customer, purchase,
 * ticket, booking or time off; no e-mail.
 *
 *   ./node_modules/.bin/tsx scripts/bootstrap-content.ts --pro <slug>
 *
 * Production (P6): `vercel env pull --environment=production .env.prod.local`,
 * then set DATABASE_URL for this one command (dotenv never overrides a variable
 * that is already set). The target host is printed, after dotenv's
 * « injected env » line, before anything is read or written.
 */
async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--pro");
  const slug = at >= 0 ? args[at + 1]?.trim() : undefined;
  if (!slug || slug.startsWith("--")) {
    console.error("Usage : tsx scripts/bootstrap-content.ts --pro <slug>");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  console.info(`→ ${new URL(url).host}`);

  const outcome = await bootstrapCatalog(db, slug, new Date());
  if (!outcome.ok) {
    console.error(
      outcome.reason === "unknown_pro"
        ? `✗ Aucune page pro « ${slug} ».`
        : `✗ « ${slug} » a déjà des types, des événements ou des clients : rien n'a été écrit.`,
    );
    process.exit(1);
  }
  const { typeIds, offerIds, eventIds } = outcome.applied;
  const offers = Object.values(offerIds).reduce((n, ids) => n + ids.length, 0);
  console.info(
    `✓ ${slug} : ${Object.keys(typeIds).length} types, ${offers} offres, ${Object.keys(eventIds).length} événements créés.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
