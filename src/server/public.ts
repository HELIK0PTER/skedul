"use server";

import { db } from "@/lib/db";
import {
  bookWithHeldTicketCore,
  registerFreeCore,
  startBuyAndBookCore,
  type BuyAndBookInput,
  type FreeRegistrationInput,
  type HeldTicketInput,
} from "@/lib/public/booking-actions";
import { splitActionInput } from "@/lib/public/context";
import { bookRdvCore, type BookRdvActionInput, type BookRdvOutcome } from "@/lib/public/rdv-actions";
import { abandonCheckoutCore, type AbandonOutcome } from "@/lib/public/release-actions";
import type { PublicResult } from "@/lib/public/result";
import { startShopPurchaseCore, type ShopPurchaseInput } from "@/lib/public/shop-actions";
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

/** E3 from the séance page: a free registration with a typed identity (registerFreeCore). */
export async function registerFreeAction(input: { slug: string } & FreeRegistrationInput): Promise<PublicResult> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("registerFree", slug, (pro, visitor, now) => registerFreeCore(db, pro, visitor, rest, now));
}

/** E2 client from the séance page: spend one held ticket, for an Owner of this pro only (bookWithHeldTicketCore). */
export async function bookWithHeldTicketAction(
  input: { slug: string } & HeldTicketInput,
): Promise<PublicResult<{ bookingId: string }>> {
  const { slug, rest } = splitActionInput(input);
  // The one action that spends tickets. The wrapper writes nothing: the core links the Owner's customer row to her
  // account (L1345) after its parseFr and its throttle, and still refuses anyone who is not an Owner of this pro.
  return runPublicAction("bookWithHeldTicket", slug, (pro, visitor, now) =>
    bookWithHeldTicketCore(db, pro, visitor, rest, now),
  );
}

/** E9 from the offer page: a pending purchase, then the Checkout URL to send the browser to (startShopPurchaseCore). */
export async function startShopPurchaseAction(
  input: { slug: string } & ShopPurchaseInput,
): Promise<PublicResult<{ purchaseId: string; checkoutUrl: string }>> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("startShopPurchase", slug, (pro, visitor, now) =>
    startShopPurchaseCore(db, pro, visitor, rest, publicDeps(), now),
  );
}

/** E4 from the RDV page: book a slot with a held ticket or for free, or hold it and answer the Checkout URL (bookRdvCore). */
export async function bookRdvAction(input: { slug: string } & BookRdvActionInput): Promise<PublicResult<BookRdvOutcome>> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("bookRdv", slug, (pro, visitor, now) =>
    bookRdvCore(db, pro, visitor, rest, publicDeps(), now),
  );
}

/** E11 from the payment return page: give a held seat back (abandonCheckoutCore); the purchase id is scoped to the page's pro. */
export async function abandonCheckoutAction(input: {
  slug: string;
  purchaseId: string;
}): Promise<PublicResult<{ outcome: AbandonOutcome }>> {
  const { slug, rest } = splitActionInput(input);
  return runPublicAction("abandonCheckout", slug, (pro, visitor, now) =>
    abandonCheckoutCore(db, pro, visitor, rest, publicDeps(), now),
  );
}
