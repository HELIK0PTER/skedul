import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, type Db, type TestPro } from "../../test/db";
import { makeCustomer, makeEvent } from "../../test/fixtures";
import { proCtx } from "../../test/pro-ctx";
import { rowBooking, rowEvent, rowRdv, rowRdvType, rowSeance } from "../../test/rows";
import { occurrence, professional } from "../db/schema";
import { isTimezoneLocked, updateProfileCore, type ProfileInput } from "./settings-actions";

const OK = { ok: true, effects: [] } as const;
const LOCKED = {
  ok: false,
  code: "timezone_locked",
  error: "Fuseau verrouillé : vous avez des séances planifiées.",
} as const;

const input = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  businessName: "Studio Altinha",
  headline: "Capoeira et roda",
  bio: null,
  timezone: "Europe/Paris",
  ...over,
});

async function rowOf(db: Db, proId: string) {
  const [row] = await db.select().from(professional).where(eq(professional.id, proId));
  return row;
}

/** A scheduled RDV that is really booked (seats_taken 1 and its booking): a scheduled RDV with no seat would break invariant I5. */
async function bookedRdv(db: Db, pro: TestPro, typeId: string, startsAt: Date): Promise<string> {
  const rdvId = await rowRdv(db, pro, typeId, { startsAt });
  await rowBooking(db, pro, { occurrenceId: rdvId, customerId: await makeCustomer(db, pro) });
  return rdvId;
}

dbTest("updateProfileCore saves the profile and the time zone when nothing is planned", async ({ db, pro }) => {
  const now = new Date();
  const res = await updateProfileCore(
    db,
    proCtx(pro),
    input({ businessName: "  Studio Altinha  ", headline: " Capoeira ", bio: null, timezone: "Europe/Zurich" }),
    now,
  );
  assert.deepEqual(res, OK);
  const row = await rowOf(db, pro.proId);
  assert.deepEqual([row.businessName, row.headline, row.bio, row.timezone], ["Studio Altinha", "Capoeira", null, "Europe/Zurich"]);

  // empty text fields become null
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ headline: "", bio: "" }), now), OK);
  const emptied = await rowOf(db, pro.proId);
  assert.deepEqual([emptied.headline, emptied.bio], [null, null]);
});

dbTest("a live event locks the time zone: refused with the pro message, nothing written; the same zone still saves", async ({ db, pro }) => {
  const now = new Date();
  await makeEvent(db, pro);
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true);

  const before = await rowOf(db, pro.proId);
  const refused = await updateProfileCore(db, proCtx(pro), input({ businessName: "Autre nom", timezone: "America/New_York" }), now);
  assert.deepEqual(refused, LOCKED);
  assert.deepEqual(await rowOf(db, pro.proId), before, "the whole update is refused, not only the zone");

  const sameZone = await updateProfileCore(db, proCtx(pro), input({ businessName: "Nouveau nom", timezone: "Europe/Paris" }), now);
  assert.deepEqual(sameZone, OK);
  const after = await rowOf(db, pro.proId);
  assert.deepEqual([after.businessName, after.timezone], ["Nouveau nom", "Europe/Paris"]);
});

dbTest("a future scheduled RDV alone locks the time zone; a past or a cancelled one does not", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  await bookedRdv(db, pro, typeId, addDaysMs(now, -2));
  await rowRdv(db, pro, typeId, { startsAt: addDaysMs(now, 2), status: "cancelled", seatsTaken: 0 });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  await bookedRdv(db, pro, typeId, addDaysMs(now, 3));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/London" }), now), LOCKED);
  assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Zurich");
});

dbTest("an archived event locks only through a future scheduled séance", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro, { archivedAt: now });
  await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, -2) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false, "archived, only a past séance");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  const future = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 2) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true, "archived, but a future séance is still scheduled");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "America/New_York" }), now), LOCKED);

  await db.delete(occurrence).where(eq(occurrence.id, future));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "America/New_York" }), now), OK);
  assert.equal((await rowOf(db, pro.proId)).timezone, "America/New_York");
});

dbTest("validation speaks French and writes nothing", async ({ db, pro }) => {
  const now = new Date();
  const before = await rowOf(db, pro.proId);
  const cases: [Partial<ProfileInput>, string][] = [
    [{ timezone: "Europe/Geneva" }, "Fuseau horaire inconnu."],
    [{ timezone: "" }, "Fuseau horaire inconnu."],
    [{ businessName: "   " }, "Nom de l'activité : ce champ est obligatoire."],
    [{ headline: "x".repeat(161) }, "Accroche : 160 caractères au maximum."],
  ];
  for (const [over, error] of cases) {
    assert.deepEqual(await updateProfileCore(db, proCtx(pro), input(over), now), { ok: false, error }, error);
  }
  assert.deepEqual(await rowOf(db, pro.proId), before);
});

dbTest("the core touches only the acting pro, and the lock is per pro", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  try {
    await makeEvent(db, pro);
    const otherBefore = await rowOf(db, other.proId);
    assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ businessName: "Moi", timezone: "Europe/Paris" }), now), OK);
    assert.deepEqual(await rowOf(db, other.proId), otherBefore, "the other pro is untouched");

    assert.equal(await isTimezoneLocked(db, pro.proId, now), true);
    assert.equal(await isTimezoneLocked(db, other.proId, now), false, "the event of one pro does not lock the other");
    assert.deepEqual(await updateProfileCore(db, proCtx(other), input({ timezone: "America/Montreal" }), now), OK);
    assert.equal((await rowOf(db, other.proId)).timezone, "America/Montreal");
    assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Paris");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
