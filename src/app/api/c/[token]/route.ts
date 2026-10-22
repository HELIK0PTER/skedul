import { NextResponse } from "next/server";

import { guestCookieOptions, resolveGuestLink } from "@/lib/back-office/guest-access";
import { GUEST_LINK_PAGE_HEADERS, guestLinkPageHtml } from "@/lib/back-office/guest-link-page";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { GUEST_COOKIE } from "@/lib/guest-link";
import { logSafeMessage } from "@/lib/log-safe";
import { sameOrigin } from "@/lib/same-origin";
import { guestKey } from "@/server/guest-key";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The same answer for a bad MAC, an unknown customer and a suspended pro: nothing to learn from it. */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: NO_STORE });
}

/** A throw from the database layer: the caller has logged it through `logSafeMessage`, this answers without any detail and without a cookie. */
function serverError(): Response {
  return new Response("Error", { status: 500, headers: NO_STORE });
}

/** A POST that did not come from this site's own page: nothing is read and nothing is set. */
function forbidden(): Response {
  return new Response("Forbidden", { status: 403, headers: NO_STORE });
}

/** The 303 of both methods (the P3 shape). It carries no cookie; the one handler that sets one does it on the result. */
function seeOther(request: Request, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, request.url), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Personal link of a client e-mail (spec § 12, Decision 68): a valid link only shows the confirmation page, whose
 * button POSTs back here. Nothing is written and no cookie is set, so a mail scanner, a prefetch or a cross-site
 * navigation cannot plant an identity. A revoked link says so (303 to ?lien=invalide, Q21) and touches no cookie: the
 * cookie is scoped to /<slug>, so the browser never sends it here, this route could not tell whose it would delete,
 * and anyone could wipe a victim's valid cookie by making them open a revoked link. The redirect target is the slug of
 * the customer's own pro, read from the database; the token is a credential and is never logged.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;

  let decision: Awaited<ReturnType<typeof resolveGuestLink>>;
  try {
    decision = await resolveGuestLink(db, token, guestKey());
  } catch (err) {
    // Next.js would log the raw error, whose driver message carries the query parameters (the customer id): log the safe message only.
    console.error("[guest-link] " + logSafeMessage(err));
    return serverError();
  }
  if (decision.kind === "not_found") return notFound();
  if (decision.kind === "stale") return seeOther(request, `/${decision.slug}/espace?lien=invalide`);

  return new Response(
    guestLinkPageHtml({ businessName: decision.businessName, actionPath: `/api/c/${encodeURIComponent(token)}` }),
    { status: 200, headers: GUEST_LINK_PAGE_HEADERS },
  );
}

/**
 * The click on the confirmation page. Route handlers get no automatic origin check, so the Origin header is compared
 * with the site's own origin before anything is read; the link is then resolved again (MAC, customer row, address
 * segment, current link version) and only an `ok` decision sets the skedul_guest cookie and sends the client to their
 * espace (303). A stale link and an unknown one behave as on GET.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  if (!sameOrigin(request.headers.get("origin"), env.APP_URL)) return forbidden();

  const { token } = await params;
  let decision: Awaited<ReturnType<typeof resolveGuestLink>>;
  try {
    decision = await resolveGuestLink(db, token, guestKey());
  } catch (err) {
    console.error("[guest-link] " + logSafeMessage(err));
    return serverError();
  }
  if (decision.kind === "not_found") return notFound();
  if (decision.kind === "stale") return seeOther(request, `/${decision.slug}/espace?lien=invalide`);

  const res = seeOther(request, `/${decision.slug}/espace`);
  res.cookies.set(GUEST_COOKIE, token, guestCookieOptions(decision.slug, process.env.NODE_ENV === "production"));
  return res;
}
