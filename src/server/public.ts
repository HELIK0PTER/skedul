"use server";

import { db } from "@/lib/db";
import { startBuyAndBookCore, type BuyAndBookInput } from "@/lib/public/booking-actions";
import { splitActionInput } from "@/lib/public/context";
import type { PublicResult } from "@/lib/public/result";
import { publicDeps, runPublicAction } from "@/server/public-context";

// Public writes (spec § 11). Every export splits the slug off its input, lets runPublicAction resolve the pro
// and the visitor on the server (never from input), and hands the REST of the input, as `unknown`, to a core
// that parses it whole. The wrapper owns the effects (run with the "none" budget) and the revalidation.

/** E1 from the séance page: hold a seat, then the Checkout URL to send the browser to (startBuyAndBookCore). */
export async function startBuyAndBookAction(
  input: { slug: string } & BuyAndBookInput,
): Promise<PublicResult<{ purchaseId: string; checkoutUrl: string }>> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("startBuyAndBook", slug, (pro, visitor, now) =>
    startBuyAndBookCore(db, pro, visitor, rest, publicDeps(), now),
  );
}
