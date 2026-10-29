import "server-only";

import { after } from "next/server";

import { backfillGoogleWith } from "@/lib/calendar-backfill";
import { syncOccurrence } from "@/lib/calendar-sync";
import { listOccurrenceIdsToBackfill } from "@/lib/calendar-sync-load";
import { db } from "@/lib/db";
import { logSafeMessage } from "@/lib/log-safe";

/** Runs the backfill of one pro with the real dependencies. Never throws (backfillGoogleWith). */
export async function runGoogleBackfill(professionalId: string): Promise<void> {
  await backfillGoogleWith(professionalId, {
    listIds: (limit) => listOccurrenceIdsToBackfill(db, professionalId, new Date(), limit),
    sync: syncOccurrence,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    info: (line) => console.info(line),
    warn: (line) => console.warn(line),
  });
}

/**
 * Final review COV-2: after a pro connects Google, the séances and RDV already
 * booked reach the new calendar (spec § 13.7). Scheduled with after(), so the
 * connection answers at once; the pro id is the session's, passed by the caller.
 * Never throws: the connection is already stored, a scheduling failure is only
 * logged.
 */
export function scheduleGoogleBackfill(professionalId: string): void {
  try {
    after(() => runGoogleBackfill(professionalId));
  } catch (err) {
    console.error(`[calendar-sync] backfill for pro ${professionalId} not scheduled: ${logSafeMessage(err)}`);
  }
}
