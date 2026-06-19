import { headers } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { professional } from "@/lib/db/schema";

/** Returns the current auth session (or null), memoized per request. */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/** Returns the professional profile owned by the current user, if any. */
export const getCurrentProfessional = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await db
    .select()
    .from(professional)
    .where(eq(professional.userId, user.id))
    .limit(1);
  return rows[0] ?? null;
});
