import { after } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";
import { mockCheckoutHtml, mockCheckoutState, mockPay } from "@/lib/payments/mock-checkout";
import { isReferenceId } from "@/lib/public/purchase-reads";
import { sameOrigin } from "@/lib/same-origin";
import { mockCheckoutEnabled } from "@/lib/stripe";
import { runEffects } from "@/server/notify";

export const dynamic = "force-dynamic";

/**
 * Every response: not cached, not framed, the origin alone as referrer (SEC-M11); the page is built by the server and the
 * route has no other output. `strict-origin`, not `no-referrer`: the policy of the document that holds the form also decides
 * the `Origin` header of its POST, and `no-referrer` makes browsers send `Origin: null`, which `sameOrigin` must refuse.
 * The CSP is the one of the personal-link page (`/api/c`): the page loads nothing but its inline style and its form posts
 * only to this origin, so a markup slip could never load or send anything elsewhere.
 */
const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin",
} as const;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { ...HEADERS } });
}

/** A throw from the database layer: the caller has logged it through `logSafeMessage`, this answers without any detail. */
function serverError(): Response {
  return new Response("Error", { status: 500, headers: { ...HEADERS } });
}

/** 303 to a path of this app: built from the trusted app URL, never from the request. */
function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: new URL(path, env.APP_URL).toString() } });
}

/**
 * Simulated Stripe Checkout, GET (spec E10, contract § 3.13). Available only
 * when mockCheckoutEnabled() (no Stripe keys, not production by APP_ENV nor
 * VERCEL_ENV): 404 everywhere else. Shows the page of a pending simulated
 * purchase and writes nothing, so a prefetcher or a link scanner can never pay
 * (L1847); a paid one goes on to its merci page; anything else is a 404. The
 * only parameter is `purchase`: there is no redirect parameter.
 */
export async function GET(request: Request): Promise<Response> {
  if (!mockCheckoutEnabled()) return notFound();
  const purchaseId = new URL(request.url).searchParams.get("purchase");
  if (!isReferenceId(purchaseId)) return notFound();
  let state: Awaited<ReturnType<typeof mockCheckoutState>>;
  try {
    state = await mockCheckoutState(db, purchaseId);
  } catch (err) {
    // Next.js would log the raw error, which can carry SQL parameters (the purchase id): log the safe message only.
    console.error("[mock-checkout] " + logSafeMessage(err));
    return serverError();
  }
  if (!state) return notFound();
  if (state.kind === "paid") return seeOther(state.merciPath);
  return new Response(mockCheckoutHtml(state.view), {
    status: 200,
    headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Simulated Stripe Checkout, POST: « Payer (simulation) ». A route handler
 * gets no automatic Origin check, so it is made here before the body is read
 * (403). The purchase id comes from the form field `purchase` only; the engine
 * fulfils it for a simulated session and the effects run after the response
 * with the budget "none" (Decision 74). 303 to the merci page of the
 * purchase's own pro.
 */
export async function POST(request: Request): Promise<Response> {
  if (!mockCheckoutEnabled()) return notFound();
  if (!sameOrigin(request.headers.get("origin"), env.APP_URL)) {
    return new Response("Forbidden", { status: 403, headers: { ...HEADERS } });
  }
  let purchaseId: unknown = null;
  try {
    purchaseId = (await request.formData()).get("purchase");
  } catch {
    return notFound();
  }
  if (!isReferenceId(purchaseId)) return notFound();
  let res: Awaited<ReturnType<typeof mockPay>>;
  try {
    res = await mockPay(db, purchaseId, new Date());
  } catch (err) {
    console.error("[mock-checkout] " + logSafeMessage(err));
    return serverError();
  }
  if (res.kind === "not_found") return notFound();
  const effects = res.effects;
  if (effects.length > 0) after(() => runEffects(effects, "none"));
  return seeOther(res.merciPath);
}
