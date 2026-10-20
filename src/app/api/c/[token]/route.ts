import { NextResponse } from "next/server";

import { resolveGuestLink } from "@/lib/back-office/guest-access";
import { db } from "@/lib/db";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from "@/lib/guest-link";
import { guestKey } from "@/server/guest-key";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The same answer for a bad MAC, an unknown customer and a suspended pro: nothing to learn from it. */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: NO_STORE });
}

/**
 * Personal link of a client e-mail (spec § 12): a valid link sets the
 * skedul_guest cookie for this pro's path and sends the client to the espace;
 * a revoked one clears the cookie and says so (Q21). The redirect target is the
 * slug of the customer's own pro, read from the database; the token is a
 * credential and is never logged.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;

  const decision = await resolveGuestLink(db, token, guestKey());
  if (decision.kind === "not_found") return notFound();

  const secure = process.env.NODE_ENV === "production";
  if (decision.kind === "stale") {
    const res = NextResponse.redirect(new URL(`/${decision.slug}/espace?lien=invalide`, request.url), 303);
    res.cookies.set(GUEST_COOKIE, "", { path: `/${decision.slug}`, maxAge: 0, httpOnly: true, sameSite: "lax", secure });
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const res = NextResponse.redirect(new URL(`/${decision.slug}/espace`, request.url), 303);
  res.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: `/${decision.slug}`,
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
