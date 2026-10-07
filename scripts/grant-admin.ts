import "./load-env";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { professional, user } from "@/lib/db/schema";

/**
 * Grants — or with --revoke removes — the admin role on the DATABASE_URL db.
 *   pnpm admin:grant you@example.com
 *   pnpm admin:grant you@example.com --revoke
 */
async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: pnpm admin:grant <email> [--revoke]");
    process.exit(1);
  }

  const [target] = await db
    .select({ id: user.id, proId: professional.id })
    .from(user)
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1);
  if (!target) {
    console.error(`✗ Aucun compte pour ${email}. Créez-le d'abord via /sign-up.`);
    process.exit(1);
  }

  const role = revoke ? (target.proId ? "pro" : "client") : "admin";
  await db.update(user).set({ role }).where(eq(user.id, target.id));
  console.info(
    `✓ ${email} → rôle "${role}". Reconnectez-vous pour que la session en tienne compte.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
