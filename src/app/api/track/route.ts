import { ADMIN_TZ } from "@/lib/analytics";
import { clientIpFrom } from "@/lib/client-ip";
import { dayKeyInTz } from "@/lib/datetime";
import { db } from "@/lib/db";
import { logSafeMessage } from "@/lib/log-safe";
import { recordPageView } from "@/lib/page-view";
import { getDailySalt } from "@/server/analytics-salt";

function noContent() {
  return new Response(null, { status: 204 });
}

/**
 * Receives <PageViewTracker /> beacons. Always 204: tracking never breaks a page, and a beacon over the per-address
 * limit (P6 A8, src/lib/page-view.ts) answers the same, at once, with no page view written.
 */
export async function POST(request: Request) {
  try {
    const now = new Date();
    await recordPageView(
      db,
      {
        userAgent: request.headers.get("user-agent"),
        secFetchSite: request.headers.get("sec-fetch-site"),
        readBody: () => request.text(),
        ownHost: request.headers.get("host") ?? new URL(request.url).host,
        ip: clientIpFrom(request.headers),
        country: request.headers.get("x-vercel-ip-country"),
      },
      () => getDailySalt(dayKeyInTz(now, ADMIN_TZ)),
      now,
    );
  } catch (err) {
    console.error(`[track] could not record page view: ${logSafeMessage(err)}`);
  }
  return noContent();
}
