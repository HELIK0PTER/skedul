import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { isSuspended } from "@/lib/suspension";

export type AdminUser = { id: string; name: string; email: string };

/**
 * The signed-in user when they are an active admin, else null. The role is
 * re-read from the database: the session cookie cache can lag by 5 minutes.
 */
export const getAdminUser = cache(async (): Promise<AdminUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!row || row.role !== "admin" || isSuspended(row)) return null;
  return { id: row.id, name: row.name, email: row.email };
});

/** Admin page guard: signed out → /sign-in; signed in but not admin → 404. */
export async function requireAdmin(): Promise<AdminUser> {
  if (!(await getSession())) redirect("/sign-in");
  const admin = await getAdminUser();
  if (!admin) notFound();
  return admin;
}
