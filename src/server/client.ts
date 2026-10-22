"use server";

import { db } from "@/lib/db";
import { revokeMyLinksCore, updateMyNameCore } from "@/lib/public/client-actions";
import type { PublicResult } from "@/lib/public/result";
import { runClientAction } from "@/server/public-context";

/** « Modifier mon nom » on /mon-espace (L1384): the verified fresh session renames her account and her linked rows; the name is parsed by the core. */
export async function updateMyNameAction(input: { name: string }): Promise<PublicResult> {
  return runClientAction("updateMyName", (session, now) => updateMyNameCore(db, session, input, now));
}

/** « Déconnecter mes liens » on /mon-espace (L1371): every personal link of the rows of the verified fresh session stops working. */
export async function revokeMyLinksAction(): Promise<PublicResult<{ customers: number }>> {
  return runClientAction("revokeMyLinks", (session, now) => revokeMyLinksCore(db, session, now));
}
