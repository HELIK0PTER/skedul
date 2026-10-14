import "server-only";

import { auth } from "@/lib/auth";
import { syncOccurrenceWith } from "@/lib/calendar-sync-core";
import { loadOccurrenceForSync, saveGoogleEventId } from "@/lib/calendar-sync-load";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteEvent, insertEvent, patchEvent } from "@/lib/google-calendar";

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
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[calendar-sync] occurrence ${occurrenceId} failed: ${message}`);
  }
}
