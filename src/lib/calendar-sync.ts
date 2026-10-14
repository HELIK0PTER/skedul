import "server-only";

import { auth } from "@/lib/auth";
import { syncOccurrenceWith } from "@/lib/calendar-sync-core";
import { loadOccurrenceForSync, saveGoogleEventId } from "@/lib/calendar-sync-load";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteEvent, insertEvent, patchEvent } from "@/lib/google-calendar";
import { logSafeMessage } from "@/lib/log-safe";

/**
 * Best-effort Google sync of one occurrence, with the real dependencies. It
 * never throws: the pro's action is already committed, so a Google failure is
 * only logged (the next change of the occurrence reconciles it).
 */
export async function syncOccurrence(occurrenceId: string): Promise<void> {
  try {
    await syncOccurrenceWith(occurrenceId, {
      enabled: env.GOOGLE_CALENDAR_ENABLED,
      loadOccurrence: (id) => loadOccurrenceForSync(db, id),
      getAccessToken: async (userId) => {
        const { accessToken } = await auth.api.getAccessToken({ body: { providerId: "google", userId } });
        return accessToken;
      },
      insertEvent,
      patchEvent,
      deleteEvent,
      saveEventId: (id, eventId) => saveGoogleEventId(db, id, eventId),
    });
  } catch (err) {
    // Google's error body can echo an attendee address: only the formatted message is logged.
    console.error(`[calendar-sync] occurrence ${occurrenceId} failed: ${logSafeMessage(err)}`);
  }
}
