"use server";

import { db } from "@/lib/db";
import { revokeMyLinksCore, updateMyNameCore } from "@/lib/public/client-actions";
import { splitActionInput } from "@/lib/public/context";
import type { PublicResult } from "@/lib/public/result";
import { cancelMyBookingCore } from "@/lib/public/space-actions";
import { runClientAction, runPublicAction } from "@/server/public-context";

/** « Modifier mon nom » on /mon-espace (L1384): the verified fresh session renames her account and her linked rows; the name is parsed by the core. */
export async function updateMyNameAction(input: { name: string }): Promise<PublicResult> {
  return runClientAction("updateMyName", (session, now) => updateMyNameCore(db, session, input, now));
}

/** « Déconnecter mes liens » on /mon-espace (L1371): every personal link of the rows of the verified fresh session stops working. */
export async function revokeMyLinksAction(): Promise<PublicResult<{ customers: number }>> {
  return runClientAction("revokeMyLinks", (session, now) => revokeMyLinksCore(db, session, now));
}

/**
 * « Annuler » in the espace (Task 21, E5): the Owner's session or the personal-link cookie cancels ONE booking of this
 * pro. `slug` is split off here and checked by runPublicAction (SLUG_PARAM_RE, an unknown or suspended pro answers
 * COPY.PAGE_GONE); the core parses the rest whole and takes the identity from the visitor the server built, never from
 * the input. Effects (the two e-mails, the Google sync) run after the response with the budget "none".
 */
export async function cancelMyBookingAction(input: { slug: string; bookingId: string }): Promise<PublicResult> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("cancelMyBooking", slug, (pro, visitor, now) => cancelMyBookingCore(db, pro, visitor, rest, now));
}
