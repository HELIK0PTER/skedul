import "./load-env";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, classSession } from "@/lib/db/schema";

async function main() {
  const now = new Date();
  const rows = await db
    .select({
      id: booking.id,
      professionalId: booking.professionalId,
      eventTypeId: booking.eventTypeId,
      startAt: booking.startAt,
      endAt: booking.endAt,
    })
    .from(booking)
    .where(
      and(
        isNull(booking.sessionId),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  let created = 0;
  for (const b of rows) {
    if (b.startAt < now) continue; // on n'ouvre des séances que pour le futur

    // 1:1 existant → séance pleine (capacity 1, 0 siège restant)
    const [sess] = await db
      .insert(classSession)
      .values({
        professionalId: b.professionalId,
        eventTypeId: b.eventTypeId,
        startAt: b.startAt,
        endAt: b.endAt,
        capacity: 1,
        seatsRemaining: 0,
      })
      .onConflictDoNothing({
        target: [classSession.eventTypeId, classSession.startAt],
      })
      .returning({ id: classSession.id });

    // si conflit (séance déjà créée par un booking précédent), la récupérer
    const sessionId =
      sess?.id ??
      (
        await db
          .select({ id: classSession.id })
          .from(classSession)
          .where(
            and(
              eq(classSession.eventTypeId, b.eventTypeId),
              eq(classSession.startAt, b.startAt),
            ),
          )
          .limit(1)
      )[0]?.id;

    if (!sessionId) continue;
    await db.update(booking).set({ sessionId }).where(eq(booking.id, b.id));
    created++;
  }

  console.info(`Backfill terminé : ${created} booking(s) reliés à une séance.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
