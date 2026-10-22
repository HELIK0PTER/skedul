import { runNightly, type NightlyReport } from "@/lib/booking/nightly";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Nightly job (spec E12, contract § 3.14), called by Vercel Cron once a day
 * (`vercel.ts`). 401 « Unauthorized » unless the request carries exactly
 * `Authorization: Bearer <CRON_SECRET>` with a configured secret of 32
 * characters at least (constant-time comparison); the route then runs the
 * steps and answers counts only, never an id or an address. The `errors` of
 * the report are authoritative: 200 when there is none, 500 otherwise, and
 * each is logged once through logSafeMessage. The job sends no e-mail
 * (OUT:118), so the route runs no effect.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env.CRON_CONFIGURED ? env.CRON_SECRET : undefined;
  if (!cronAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }

  let report: NightlyReport;
  try {
    report = await runNightly(db, new Date());
  } catch (err) {
    console.error(`[cron] run failed: ${logSafeMessage(err)}`);
    return Response.json({ ok: false, errors: 1 }, { status: 500, headers: NO_STORE });
  }
  for (const error of report.errors) console.error(`[cron] ${logSafeMessage({ message: error })}`);

  const ok = report.errors.length === 0;
  return Response.json(
    {
      ok,
      expiredBookings: report.expiredBookings,
      expiredPurchases: report.expiredPurchases,
      expiredTickets: report.expiredTickets,
      horizonPros: report.horizon.pros,
      horizonInserted: report.horizon.inserted,
      archivedEvents: report.archivedEvents,
      purgedThrottle: report.purgedThrottle,
      invariantViolations: report.invariantViolations,
      errors: report.errors.length,
    },
    { status: ok ? 200 : 500, headers: NO_STORE },
  );
}
