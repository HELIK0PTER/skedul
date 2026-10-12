import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { safeMockRedirect } from "@/lib/mock-redirect";
import { fulfillBooking, fulfillPackPurchase } from "@/lib/payments";

/**
 * Local stand-in for Stripe Checkout used when no live Stripe key is set.
 * Fulfills the order immediately, then redirects to the success page.
 * Disabled as soon as Stripe is configured: it would otherwise let anyone
 * mark a pending order as paid.
 */
export async function GET(request: Request) {
  if (env.STRIPE_ENABLED) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const ref = searchParams.get("ref");
  const redirectTo = safeMockRedirect(searchParams.get("redirect"), env.APP_URL);

  if (ref) {
    if (kind === "pack") await fulfillPackPurchase(ref);
    else if (kind === "booking") await fulfillBooking(ref);
  }

  return NextResponse.redirect(redirectTo);
}
