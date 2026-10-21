/**
 * Backfill of the Google calendar right after a pro connects it (final review
 * COV-2, spec § 13.7): the séances and RDV that were booked before the
 * connection reach the new « Skedul » calendar without waiting for a change.
 *
 * Pure on purpose (no database, no next/*, no Google): the occurrence ids, the
 * single-occurrence sync, the pause and the log lines are injected, so the pace,
 * the cap and the failure handling are tested without a network. The real
 * wiring is src/server/google-backfill.ts.
 *
 * Bounded by BACKFILL_MAX occurrences, soonest first, with a pause between two
 * Google calls: the Calendar API limits the calls per user and per minute, and a
 * pro with years of bookings must not burn that quota (nor the lifetime of the
 * function) in one go. What is left over is not lost: the next change of an
 * occurrence syncs it (deterministic event id, so every sync is idempotent).
 */
import { logSafeMessage } from "@/lib/log-safe";

/** Occurrences synced per connection; the rest waits for its next change. */
export const BACKFILL_MAX = 200;

/** Pause between two occurrences that called Google (about 3 per second, 2 API calls each at most). */
export const BACKFILL_GAP_MS = 300;

/** What a single-occurrence sync answers: a SyncOutcome, or « failed » when it logged an error. */
export type BackfillOutcome = string;

/** Outcomes that never reached Google (no token, no API call): they cost no pause. */
const NO_GOOGLE_CALL: ReadonlySet<BackfillOutcome> = new Set(["disabled", "skipped", "noop"]);

export interface BackfillDeps {
  /** At most `limit` ids of the pro's occurrences to sync, soonest first. */
  listIds: (limit: number) => Promise<string[]>;
  sync: (occurrenceId: string) => Promise<BackfillOutcome>;
  sleep: (ms: number) => Promise<void>;
  info: (line: string) => void;
  warn: (line: string) => void;
}

export interface BackfillResult {
  attempted: number;
  failed: number;
  /** True when more than BACKFILL_MAX occurrences qualified: the rest is left to later syncs. */
  more: boolean;
}

/**
 * Syncs the pro's booked future occurrences one by one, paced. Never throws:
 * the connection is already stored, so a failure (reading the ids, a Google
 * error) is only logged, as ids and counts without any address (logSafeMessage).
 */
export async function backfillGoogleWith(professionalId: string, deps: BackfillDeps): Promise<BackfillResult> {
  const label = `[calendar-sync] backfill for pro ${professionalId}`;
  let ids: string[];
  try {
    // One id more than the cap tells whether some remain.
    ids = await deps.listIds(BACKFILL_MAX + 1);
  } catch (err) {
    deps.warn(`${label} failed: ${logSafeMessage(err)}`);
    return { attempted: 0, failed: 0, more: false };
  }
  const more = ids.length > BACKFILL_MAX;
  const batch = ids.slice(0, BACKFILL_MAX);

  let failed = 0;
  let pause = false;
  for (const id of batch) {
    if (pause) await deps.sleep(BACKFILL_GAP_MS);
    let outcome: BackfillOutcome;
    try {
      outcome = await deps.sync(id);
    } catch (err) {
      deps.warn(`[calendar-sync] backfill occurrence ${id} failed: ${logSafeMessage(err)}`);
      outcome = "failed";
    }
    if (outcome === "failed") failed++;
    pause = !NO_GOOGLE_CALL.has(outcome);
  }

  const tail = `${failed > 0 ? `, ${failed} failed` : ""}${more ? ", more remain (the next changes sync them)" : ""}`;
  deps.info(`${label}: ${batch.length} occurrence(s) processed${tail}`);
  return { attempted: batch.length, failed, more };
}
