import test from "node:test";
import assert from "node:assert/strict";

// Integration test: requires a real DATABASE_URL (Neon dev branch).
// Skipped automatically when no DB is configured, to keep the offline suite green.
const HAS_DB = !!process.env.DATABASE_URL;

test(
  "claimSeat allocates exactly `capacity` seats then refuses the rest",
  { skip: !HAS_DB && "no DATABASE_URL" },
  async () => {
    const { db } = await import("@/lib/db");
    const { professional, user, eventType, classSession } = await import(
      "@/lib/db/schema"
    );
    const { claimSeat, releaseSeat } = await import("./sessions");
    const { eq } = await import("drizzle-orm");
    const { nanoid } = await import("nanoid");

    // minimal fixtures
    const uid = `test_${nanoid()}`;
    await db.insert(user).values({
      id: uid,
      name: "Test",
      email: `${uid}@test.local`,
    });
    const [pro] = await db
      .insert(professional)
      .values({ userId: uid, slug: `test-${nanoid()}`, businessName: "T" })
      .returning({ id: professional.id });
    const [evt] = await db
      .insert(eventType)
      .values({ professionalId: pro.id, title: "Groupe", slug: "g", capacity: 3 })
      .returning({ id: eventType.id });

    const start = new Date("2099-01-01T10:00:00.000Z");
    const end = new Date("2099-01-01T11:00:00.000Z");
    const claim = () =>
      claimSeat({
        professionalId: pro.id,
        eventTypeId: evt.id,
        startAt: start,
        endAt: end,
        capacity: 3,
      });

    const results = await Promise.all([claim(), claim(), claim(), claim()]);
    const okCount = results.filter((r) => r.ok).length;
    assert.equal(okCount, 3, "exactly capacity seats are granted");
    assert.equal(results.filter((r) => !r.ok).length, 1, "the 4th is refused");

    // release returns a seat
    const ok = results.find((r) => r.ok) as { ok: true; sessionId: string };
    await releaseSeat(ok.sessionId);
    const [s] = await db
      .select({ seatsRemaining: classSession.seatsRemaining })
      .from(classSession)
      .where(eq(classSession.id, ok.sessionId))
      .limit(1);
    assert.equal(s.seatsRemaining, 1);

    // cleanup
    await db.delete(professional).where(eq(professional.id, pro.id));
    await db.delete(user).where(eq(user.id, uid));
  },
);
