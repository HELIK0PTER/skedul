import { NextResponse } from "next/server";

/**
 * Local stand-in for Stripe Checkout. P4 rebuilds it on the tickets engine
 * (fulfillPurchase); until then there is nothing to pay for.
 */
export async function GET() {
  return new NextResponse("Not found", { status: 404 });
}
